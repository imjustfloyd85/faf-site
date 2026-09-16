// Cloudflare Pages Function -- Business Sponsorship Application
//
// Public form endpoint for business sponsorship applications (#1240).
// Captures click-wrap consent, generates a sponsor packet PDF,
// and emails it to both the applicant and the FAF team via ACS.
//
// DEPENDENCY (KV binding): FAF_KV
// DEPENDENCY (CF Pages secret): ACS_CONNECTION_STRING

import { sendViaACS, sendViaACSWithAttachment } from "../lib/acs-email.js";
import { generatePdf } from "../lib/pdf-generate.js";
import {
  getSponsorPacketPdfContent,
  getSponsorPacketHtml,
} from "../lib/sponsor-packet.js";

const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_SECONDS = 10 * 60;
const SUBMISSION_TTL_SECONDS = 365 * 24 * 60 * 60;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildOrgNotificationEmail(entry) {
  const biz = escapeHtml(entry.businessName);
  const contact = escapeHtml(entry.contactName);
  const email = escapeHtml(entry.email);
  const phone = escapeHtml(entry.phone || "(not provided)");
  const website = escapeHtml(entry.website || "(not provided)");
  const tier = escapeHtml(entry.tier);
  const heardAbout = escapeHtml(entry.heardAbout || "(not provided)").replace(
    /\n/g,
    "<br/>",
  );
  const message = escapeHtml(entry.message || "(not provided)").replace(
    /\n/g,
    "<br/>",
  );
  const subjectSafeName = String(entry.businessName).replace(/[\r\n]/g, " ");

  return {
    subject: `[FAF] Sponsor Application: ${subjectSafeName} (${tier})`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #c8923c;">Fathers and Football -- Sponsor Application</h2>
        <p style="background: #fff3cd; padding: 10px 14px; border-radius: 4px;">
          <strong>Follow up within 2 business days.</strong>
          Sponsorship agreement v1.0 accepted at submission.
        </p>
        <p><strong>Business:</strong> ${biz}</p>
        <p><strong>Contact:</strong> ${contact}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Phone:</strong> ${phone}</p>
        <p><strong>Website:</strong> ${website}</p>
        <p><strong>Tier Interest:</strong> ${tier}</p>
        <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0;" />
        <p><strong>How they heard about FAF:</strong></p>
        <p>${heardAbout}</p>
        <p><strong>Message:</strong></p>
        <p>${message}</p>
        <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0;" />
        <p style="color: #999; font-size: 12px;">
          Agreement: v${escapeHtml(entry.agreementVersion)} accepted ${escapeHtml(entry.agreementAcceptedAt)}<br/>
          Submitted: ${escapeHtml(entry.createdAt)}
        </p>
      </div>
    `,
  };
}

export async function onRequestPost(context) {
  const headers = { "Content-Type": "application/json" };

  const kv = context.env.FAF_KV;
  if (!kv) {
    console.error("FAF_KV binding not configured");
    return new Response(
      JSON.stringify({ error: "Application storage not available." }),
      { status: 500, headers },
    );
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
      status: 400,
      headers,
    });
  }

  const businessName = String(body.businessName || "").trim();
  const contactName = String(body.contactName || "").trim();
  const email = String(body.email || "").trim();
  const tier = String(body.tier || "").trim();
  const agreementAccepted = body.agreementAccepted === true;

  if (!businessName || !contactName || !email || !tier) {
    return new Response(
      JSON.stringify({
        error:
          "Business name, contact name, email, and tier selection are required.",
      }),
      { status: 400, headers },
    );
  }

  const atIndex = email.indexOf("@");
  if (atIndex < 1 || email.indexOf(".", atIndex) === -1) {
    return new Response(
      JSON.stringify({ error: "Please provide a valid email address." }),
      { status: 400, headers },
    );
  }

  if (!agreementAccepted) {
    return new Response(
      JSON.stringify({
        error: "You must accept the sponsorship agreement to proceed.",
      }),
      { status: 400, headers },
    );
  }

  if (businessName.length > 300) {
    return new Response(
      JSON.stringify({ error: "Business name is too long." }),
      { status: 400, headers },
    );
  }
  if (contactName.length > 200) {
    return new Response(
      JSON.stringify({ error: "Contact name is too long." }),
      { status: 400, headers },
    );
  }
  if (email.length > 200) {
    return new Response(JSON.stringify({ error: "Email is too long." }), {
      status: 400,
      headers,
    });
  }

  // Rate limit by IP
  const ip = context.request.headers.get("CF-Connecting-IP") || "unknown";
  const rateLimitKey = `ratelimit:sponsor-app:${ip}`;
  const currentCountRaw = await kv.get(rateLimitKey);
  const currentCount = currentCountRaw ? parseInt(currentCountRaw, 10) : 0;

  if (currentCount >= RATE_LIMIT_MAX) {
    return new Response(
      JSON.stringify({
        error: "Too many submissions. Please try again in a few minutes.",
      }),
      { status: 429, headers },
    );
  }

  await kv.put(rateLimitKey, String(currentCount + 1), {
    expirationTtl: RATE_LIMIT_WINDOW_SECONDS,
  });

  const entryId = crypto.randomUUID();
  const now = new Date().toISOString();
  const entry = {
    id: entryId,
    businessName: businessName.slice(0, 300),
    contactName: contactName.slice(0, 200),
    email: email.slice(0, 200),
    phone: body.phone ? String(body.phone).slice(0, 30) : "",
    website: body.website ? String(body.website).slice(0, 300) : "",
    tier: tier.slice(0, 20),
    heardAbout: body.heardAbout ? String(body.heardAbout).slice(0, 1000) : "",
    message: body.message ? String(body.message).slice(0, 1000) : "",
    agreementAccepted: true,
    agreementAcceptedAt: now,
    agreementVersion: "1.0",
    userAgent: context.request.headers.get("user-agent") || "",
    createdAt: now,
  };

  await kv.put(`sponsor-app:${entryId}`, JSON.stringify(entry), {
    expirationTtl: SUBMISSION_TTL_SECONDS,
  });

  // PDF generation and email sending are best-effort.
  // The application is stored in KV regardless of email delivery.
  let emailWarning = false;

  try {
    const pdfContent = getSponsorPacketPdfContent(
      businessName,
      contactName,
      tier,
    );
    const pdfBytes = generatePdf(pdfContent);
    // Chunked base64 to avoid spread-operator argument limit on large PDFs
    let pdfBase64 = "";
    const chunk = 8192;
    for (let i = 0; i < pdfBytes.length; i += chunk) {
      pdfBase64 += String.fromCharCode(...pdfBytes.subarray(i, i + chunk));
    }
    pdfBase64 = btoa(pdfBase64);

    // Send org notification (no PDF -- they don't need the packet)
    const orgEmail = buildOrgNotificationEmail(entry);
    const orgResult = await sendViaACS(context.env, {
      from: "DoNotReply@fathersandfootball.org",
      to: [
        "justin@fathersandfootball.org",
        "communications@fathersandfootball.org",
      ],
      replyTo: email,
      subject: orgEmail.subject,
      html: orgEmail.html,
    });

    if (!orgResult.ok) {
      console.error(
        "Failed to send sponsor application org notification:",
        orgResult.status,
      );
    }

    // Send sponsor packet email to applicant with PDF attached
    const packetHtml = getSponsorPacketHtml(businessName, contactName, tier);
    const applicantResult = await sendViaACSWithAttachment(context.env, {
      from: "communications@fathersandfootball.org",
      to: email,
      subject: "Your Sponsorship Packet -- Fathers and Football",
      html: packetHtml,
      attachments: [
        {
          name: "FAF-Sponsorship-Packet.pdf",
          contentType: "application/pdf",
          contentInBase64: pdfBase64,
        },
      ],
    });

    if (!applicantResult.ok) {
      console.error(
        "Failed to send sponsor packet to applicant:",
        applicantResult.status,
      );
      emailWarning = true;
    }
  } catch (err) {
    console.error("PDF generation or email send failed:", err);
    emailWarning = true;
  }

  return new Response(JSON.stringify({ ok: true, id: entryId, emailWarning }), {
    status: 200,
    headers,
  });
}

export async function onRequestGet() {
  return new Response("Method not allowed", { status: 405 });
}

export async function onRequestPut() {
  return new Response("Method not allowed", { status: 405 });
}

export async function onRequestDelete() {
  return new Response("Method not allowed", { status: 405 });
}
