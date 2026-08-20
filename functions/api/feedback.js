// Cloudflare Pages Function — Site Feedback / Bug Reports
//
// Anonymous, no-login submission endpoint for the site feedback widget.
// Adapted from Haven's demo-feedback pattern, simplified for a static
// site with no auth system: no AI triage, no login-gated admin UI --
// submissions are stored in KV and a human is notified via ACS email.
//
// DEPENDENCY (KV binding): FAF_KV -- stores submissions + rate-limit counters
// DEPENDENCY (CF Pages secret): ACS_CONNECTION_STRING -- for email notification

import { sendViaACS } from "../lib/acs-email.js";

const VALID_CATEGORIES = ["general", "bug", "feature", "ui"];
const VALID_PRIORITIES = ["low", "medium", "high"];
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_SECONDS = 60;
const SUBMISSION_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildNotificationEmail(entry) {
  const categoryLabel = escapeHtml(entry.category);
  const priorityLabel = escapeHtml(entry.priority);
  const name = escapeHtml(entry.name || "(not provided)");
  const email = escapeHtml(entry.email || "(not provided)");
  const page = escapeHtml(entry.page || "(unknown)");
  const suggestion = escapeHtml(entry.suggestion).replace(/\n/g, "<br/>");
  const subjectSafeCategory = String(entry.category).replace(/[\r\n]/g, " ");

  return {
    subject: `[FAF Feedback: ${subjectSafeCategory}] New submission`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #c8923c;">Fathers and Football -- Site Feedback</h2>
        <p><strong>Category:</strong> ${categoryLabel}</p>
        <p><strong>Priority:</strong> ${priorityLabel}</p>
        <p><strong>Page:</strong> ${page}</p>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0;" />
        <p>${suggestion}</p>
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
      JSON.stringify({ error: "Feedback storage not available." }),
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

  const suggestion = String(body.suggestion || "").trim();
  if (!suggestion) {
    return new Response(
      JSON.stringify({ error: "Feedback message is required." }),
      { status: 400, headers },
    );
  }

  const category = VALID_CATEGORIES.includes(body.category)
    ? body.category
    : "general";
  const priority = VALID_PRIORITIES.includes(body.priority)
    ? body.priority
    : "medium";

  // Rate limit by IP
  const ip = context.request.headers.get("CF-Connecting-IP") || "unknown";
  const rateLimitKey = `ratelimit:feedback:${ip}`;
  const currentCountRaw = await kv.get(rateLimitKey);
  const currentCount = currentCountRaw ? parseInt(currentCountRaw, 10) : 0;

  if (currentCount >= RATE_LIMIT_MAX) {
    return new Response(
      JSON.stringify({
        error: "Too many submissions. Please try again in a minute.",
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
    name: body.name ? String(body.name).slice(0, 200) : "",
    email: body.email ? String(body.email).slice(0, 200) : "",
    category,
    priority,
    suggestion: suggestion.slice(0, 5000),
    page: body.page ? String(body.page).slice(0, 300) : "",
    userAgent: context.request.headers.get("user-agent") || "",
    createdAt: new Date().toISOString(),
  };

  await kv.put(`feedback:${entryId}`, JSON.stringify(entry), {
    expirationTtl: SUBMISSION_TTL_SECONDS,
  });

  const emailContent = buildNotificationEmail(entry);
  const result = await sendViaACS(context.env, {
    from: "Fathers and Football <communications@fathersandfootball.org>",
    to: [
      "justin@fathersandfootball.org",
      "communications@fathersandfootball.org",
    ],
    subject: emailContent.subject,
    html: emailContent.html,
  });

  if (!result.ok) {
    console.error("Failed to send feedback notification email:", result.status);
    // Submission is already stored in KV even if the email fails --
    // don't fail the request over a notification-delivery issue.
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
