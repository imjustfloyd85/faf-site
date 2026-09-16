import { sendViaACS, sendViaACSWithAttachment } from "../lib/acs-email.js";
import { generatePdf } from "../lib/pdf-generate.js";
import {
  PLEDGE_AGREEMENT_VERSION,
  getPledgeAgreementPdfContent,
} from "../lib/pledge-agreement.js";

const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_SECONDS = 600;
const SUBMISSION_TTL_SECONDS = 365 * 24 * 60 * 60;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildNotificationEmail(entry) {
  const name = escapeHtml(entry.name);
  const email = escapeHtml(entry.email);
  const phone = escapeHtml(entry.phone || "(not provided)");
  const amount = escapeHtml(entry.amount);
  const frequency = escapeHtml(entry.frequency);
  const subjectSafeName = String(entry.name).replace(/[\r\n]/g, " ");

  return {
    subject: `[FAF] New Pledge: $${entry.amount} from ${subjectSafeName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #c8923c;">Fathers and Football -- New Pledge</h2>
        <p><strong>Donor:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Phone:</strong> ${phone}</p>
        <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0;" />
        <p><strong>Pledge Amount:</strong> $${amount}</p>
        <p><strong>Frequency:</strong> ${frequency}</p>
        <p><strong>Agreement Version:</strong> ${PLEDGE_AGREEMENT_VERSION}</p>
        <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0;" />
        <p style="color: #999; font-size: 12px;">Submitted: ${escapeHtml(entry.createdAt)}</p>
      </div>
    `,
  };
}

function buildDonorConfirmationEmail(entry) {
  const name = escapeHtml(entry.name);
  const amount = escapeHtml(entry.amount);
  const frequency = entry.frequency === "monthly" ? "monthly " : "";
  const date = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return {
    subject: "Your pledge confirmation -- Fathers and Football",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #c8923c;">Fathers and Football</h2>
        <p>Dear ${name},</p>
        <p>Thank you for your ${frequency}pledge of $${amount} to Fathers and Football. Your commitment directly supports programs that connect fathers to their children through the game.</p>
        <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0;" />
        <h3>Pledge Details</h3>
        <p><strong>Organization:</strong> Fathers and Football<br/>
        <strong>EIN:</strong> 42-1980182<br/>
        <strong>Status:</strong> 501(c)(3) tax-exempt organization<br/>
        <strong>Date:</strong> ${date}<br/>
        <strong>Pledge Amount:</strong> $${amount}<br/>
        <strong>Frequency:</strong> ${escapeHtml(entry.frequency)}</p>
        <p>A copy of your pledge agreement is attached to this email as a PDF.</p>
        <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0;" />
        <p>We will be in touch with next steps. Thank you for investing in families.</p>
        <p>With gratitude,<br/>Fathers and Football<br/>
        <a href="https://fathersandfootball.org">fathersandfootball.org</a></p>
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
      JSON.stringify({ error: "Pledge storage not available." }),
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

  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim();
  const amount = String(body.amount || "").trim();
  const frequency = String(body.frequency || "").trim();
  const agreed = body.agreed === true;

  if (!name || !email || !amount || !frequency) {
    return new Response(
      JSON.stringify({
        error: "Name, email, pledge amount, and frequency are all required.",
      }),
      { status: 400, headers },
    );
  }

  if (!agreed) {
    return new Response(
      JSON.stringify({
        error: "You must agree to the pledge terms before submitting.",
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

  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    return new Response(
      JSON.stringify({ error: "Please provide a valid pledge amount." }),
      { status: 400, headers },
    );
  }

  if (!["one-time", "monthly"].includes(frequency)) {
    return new Response(
      JSON.stringify({ error: "Frequency must be one-time or monthly." }),
      { status: 400, headers },
    );
  }

  if (name.length > 200) {
    return new Response(JSON.stringify({ error: "Name is too long." }), {
      status: 400,
      headers,
    });
  }
  if (email.length > 200) {
    return new Response(JSON.stringify({ error: "Email is too long." }), {
      status: 400,
      headers,
    });
  }

  const ip = context.request.headers.get("CF-Connecting-IP") || "unknown";
  const rateLimitKey = `ratelimit:pledge:${ip}`;
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
  const dateStr = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const entry = {
    id: entryId,
    name: name.slice(0, 200),
    email: email.slice(0, 200),
    phone: body.phone ? String(body.phone).slice(0, 30) : "",
    amount: parsedAmount.toFixed(2),
    frequency,
    agreementVersion: PLEDGE_AGREEMENT_VERSION,
    agreementAcceptedAt: new Date().toISOString(),
    userAgent: context.request.headers.get("user-agent") || "",
    createdAt: new Date().toISOString(),
  };

  await kv.put(`pledge:${entryId}`, JSON.stringify(entry), {
    expirationTtl: SUBMISSION_TTL_SECONDS,
  });

  // PDF generation and email sending are best-effort.
  // The pledge is stored in KV regardless of email delivery.
  let emailWarning = false;

  try {
    const pdfContent = getPledgeAgreementPdfContent(
      entry.name,
      entry.amount,
      dateStr,
      entry.email,
    );
    const pdfBytes = generatePdf(pdfContent);
    // Chunked base64 to avoid spread-operator argument limit on large PDFs
    let pdfBase64 = "";
    const chunk = 8192;
    for (let i = 0; i < pdfBytes.length; i += chunk) {
      pdfBase64 += String.fromCharCode(...pdfBytes.subarray(i, i + chunk));
    }
    pdfBase64 = btoa(pdfBase64);

    const notificationEmail = buildNotificationEmail(entry);
    const notifResult = await sendViaACS(context.env, {
      from: "DoNotReply@fathersandfootball.org",
      to: ["justin@fathersandfootball.org"],
      subject: notificationEmail.subject,
      html: notificationEmail.html,
    });

    if (!notifResult.ok) {
      console.error(
        "Failed to send pledge notification email:",
        notifResult.status,
      );
    }

    const confirmationEmail = buildDonorConfirmationEmail(entry);
    const confirmResult = await sendViaACSWithAttachment(context.env, {
      from: "communications@fathersandfootball.org",
      to: entry.email,
      subject: confirmationEmail.subject,
      html: confirmationEmail.html,
      attachments: [
        {
          name: "FAF-Pledge-Agreement.pdf",
          contentType: "application/pdf",
          contentInBase64: pdfBase64,
        },
      ],
    });

    if (!confirmResult.ok) {
      console.error(
        "Failed to send pledge confirmation email:",
        confirmResult.status,
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
