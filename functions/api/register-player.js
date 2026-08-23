// Cloudflare Pages Function -- Player Registration
//
// Public form endpoint for player registration. Rate-limited, no auth.
// Stores submissions in KV and sends a notification email via ACS.
//
// DEPENDENCY (KV binding): FAF_KV
// DEPENDENCY (CF Pages secret): ACS_CONNECTION_STRING

import { sendViaACS } from "../lib/acs-email.js";

const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_SECONDS = 10 * 60; // 10 minutes
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
  const playerName = escapeHtml(entry.playerName);
  const playerAge = escapeHtml(entry.playerAge);
  const parentName = escapeHtml(entry.parentName);
  const parentEmail = escapeHtml(entry.parentEmail);
  const parentPhone = escapeHtml(entry.parentPhone || "(not provided)");
  const scheduleCall = escapeHtml(entry.scheduleCall || "(not provided)");
  const experience = escapeHtml(entry.experience || "(not provided)").replace(
    /\n/g,
    "<br/>",
  );
  const notes = escapeHtml(entry.notes || "(not provided)").replace(
    /\n/g,
    "<br/>",
  );

  const subjectSafeName = String(entry.playerName).replace(/[\r\n]/g, " ");

  return {
    subject: `[FAF] New Player Registration: ${subjectSafeName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #c8923c;">Fathers and Football -- Player Registration</h2>
        <p><strong>Player Name:</strong> ${playerName}</p>
        <p><strong>Age / Grade:</strong> ${playerAge}</p>
        <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0;" />
        <p><strong>Parent/Guardian:</strong> ${parentName}</p>
        <p><strong>Email:</strong> ${parentEmail}</p>
        <p><strong>Phone:</strong> ${parentPhone}</p>
        <p><strong>Schedule a Call:</strong> ${scheduleCall}</p>
        <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0;" />
        <p><strong>Football Experience:</strong></p>
        <p>${experience}</p>
        <p><strong>Additional Notes:</strong></p>
        <p>${notes}</p>
        <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0;" />
        <p style="color: #999; font-size: 12px;">Submitted: ${escapeHtml(entry.createdAt)}</p>
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
      JSON.stringify({ error: "Registration storage not available." }),
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

  // Required fields
  const playerName = String(body.playerName || "").trim();
  const playerAge = String(body.playerAge || "").trim();
  const parentName = String(body.parentName || "").trim();
  const parentEmail = String(body.parentEmail || "").trim();

  if (!playerName || !playerAge || !parentName || !parentEmail) {
    return new Response(
      JSON.stringify({
        error:
          "Player name, age/grade, parent name, and parent email are all required.",
      }),
      { status: 400, headers },
    );
  }

  // Email validation: must contain @ with a dot after it
  const atIndex = parentEmail.indexOf("@");
  if (atIndex < 1 || parentEmail.indexOf(".", atIndex) === -1) {
    return new Response(
      JSON.stringify({ error: "Please provide a valid email address." }),
      { status: 400, headers },
    );
  }

  // Length limits
  if (playerName.length > 200) {
    return new Response(JSON.stringify({ error: "Player name is too long." }), {
      status: 400,
      headers,
    });
  }
  if (playerAge.length > 10) {
    return new Response(JSON.stringify({ error: "Age/grade is too long." }), {
      status: 400,
      headers,
    });
  }
  if (parentName.length > 200) {
    return new Response(JSON.stringify({ error: "Parent name is too long." }), {
      status: 400,
      headers,
    });
  }
  if (parentEmail.length > 200) {
    return new Response(JSON.stringify({ error: "Email is too long." }), {
      status: 400,
      headers,
    });
  }

  // Rate limit by IP
  const ip = context.request.headers.get("CF-Connecting-IP") || "unknown";
  const rateLimitKey = `ratelimit:register:${ip}`;
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
    playerName: playerName.slice(0, 200),
    playerAge: playerAge.slice(0, 10),
    parentName: parentName.slice(0, 200),
    parentEmail: parentEmail.slice(0, 200),
    parentPhone: body.parentPhone ? String(body.parentPhone).slice(0, 30) : "",
    scheduleCall: body.scheduleCall
      ? String(body.scheduleCall).slice(0, 200)
      : "",
    experience: body.experience ? String(body.experience).slice(0, 1000) : "",
    notes: body.notes ? String(body.notes).slice(0, 1000) : "",
    userAgent: context.request.headers.get("user-agent") || "",
    createdAt: new Date().toISOString(),
  };

  await kv.put(`player-reg:${entryId}`, JSON.stringify(entry), {
    expirationTtl: SUBMISSION_TTL_SECONDS,
  });

  const emailContent = buildNotificationEmail(entry);
  const result = await sendViaACS(context.env, {
    from: "DoNotReply <DoNotReply@fathersandfootball.org>",
    to: ["justin@fathersandfootball.org"],
    subject: emailContent.subject,
    html: emailContent.html,
  });

  if (!result.ok) {
    console.error(
      "Failed to send player registration notification email:",
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
