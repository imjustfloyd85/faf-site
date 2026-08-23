// Cloudflare Pages Function — Volunteer Interest Form
//
// Public submission endpoint for the volunteer interest form.
// No passcode required; rate-limited by IP to prevent abuse.
//
// DEPENDENCY (KV binding): FAF_KV -- stores submissions + rate-limit counters
// DEPENDENCY (CF Pages secret): ACS_CONNECTION_STRING -- for email notification

import { sendViaACS } from "../lib/acs-email.js";

const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_SECONDS = 600; // 10 minutes
const SUBMISSION_TTL_SECONDS = 365 * 24 * 60 * 60; // 365 days

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
  const roles = escapeHtml(entry.roles || "(not provided)").replace(
    /\n/g,
    "<br/>",
  );
  const availability = escapeHtml(entry.availability || "(not provided)");
  const experience = escapeHtml(entry.experience || "(not provided)").replace(
    /\n/g,
    "<br/>",
  );
  const notes = escapeHtml(entry.notes || "(not provided)").replace(
    /\n/g,
    "<br/>",
  );
  const subjectSafeName = String(entry.name).replace(/[\r\n]/g, " ");

  return {
    subject: `[FAF] Volunteer Interest: ${subjectSafeName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #c8923c;">Fathers and Football -- Volunteer Interest</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Phone:</strong> ${phone}</p>
        <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0;" />
        <p><strong>How they want to help:</strong></p>
        <p>${roles}</p>
        <p><strong>Availability:</strong></p>
        <p>${availability}</p>
        <p><strong>Relevant experience:</strong></p>
        <p>${experience}</p>
        <p><strong>Additional notes:</strong></p>
        <p>${notes}</p>
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
      JSON.stringify({ error: "Volunteer storage not available." }),
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

  if (!name || !email) {
    return new Response(
      JSON.stringify({ error: "Name and email are required." }),
      { status: 400, headers },
    );
  }

  // Basic email validation: must contain @ with a dot after it
  const atIndex = email.indexOf("@");
  if (atIndex < 1 || email.indexOf(".", atIndex) === -1) {
    return new Response(
      JSON.stringify({ error: "Please enter a valid email address." }),
      { status: 400, headers },
    );
  }

  // Rate limit by IP
  const ip = context.request.headers.get("CF-Connecting-IP") || "unknown";
  const rateLimitKey = `ratelimit:volunteer:${ip}`;
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
  const entry = {
    id: entryId,
    name: name.slice(0, 200),
    email: email.slice(0, 200),
    phone: body.phone ? String(body.phone).slice(0, 30) : "",
    roles: body.roles ? String(body.roles).slice(0, 500) : "",
    availability: body.availability
      ? String(body.availability).slice(0, 500)
      : "",
    experience: body.experience ? String(body.experience).slice(0, 1000) : "",
    notes: body.notes ? String(body.notes).slice(0, 1000) : "",
    userAgent: context.request.headers.get("user-agent") || "",
    createdAt: new Date().toISOString(),
  };

  await kv.put(`volunteer:${entryId}`, JSON.stringify(entry), {
    expirationTtl: SUBMISSION_TTL_SECONDS,
  });

  const emailContent = buildNotificationEmail(entry);
  const result = await sendViaACS(context.env, {
    from: "DoNotReply@fathersandfootball.org",
    to: ["justin@fathersandfootball.org"],
    subject: emailContent.subject,
    html: emailContent.html,
  });

  if (!result.ok) {
    console.error(
      "Failed to send volunteer notification email:",
      result.status,
    );
  }

  return new Response(JSON.stringify({ ok: true, id: entryId }), {
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
