// Cloudflare Pages Function -- Newsletter Unsubscribe
// GET endpoint that verifies an HMAC-signed token and marks the
// subscriber inactive in FAF_KV. Returns a rendered HTML confirmation
// page (same pattern as sponsor-approve.js).
//
// CAN-SPAM requires that unsubscribe links work indefinitely, so
// these tokens have no expiry.
//
// DEPENDENCIES:
//   FAF_KV              -- KV binding
//   QBO_APPROVAL_SECRET -- HMAC key for token verification

import { verifyUnsubscribeToken } from "../lib/approval-tokens.js";

export async function onRequestGet(context) {
  const headers = { "Content-Type": "text/html; charset=utf-8" };

  const secret = context.env.QBO_APPROVAL_SECRET;
  if (!secret) {
    return new Response(
      renderPage(
        "Configuration Error",
        "Unsubscribe system is not configured.",
      ),
      { status: 500, headers },
    );
  }

  const url = new URL(context.request.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return new Response(
      renderPage("Invalid Request", "No unsubscribe token provided."),
      { status: 400, headers },
    );
  }

  const result = await verifyUnsubscribeToken(token, secret);
  if (!result.valid) {
    console.error("Unsubscribe token verification failed:", result.reason);
    return new Response(
      renderPage(
        "Invalid Link",
        `This unsubscribe link is not valid. Reason: ${escapeHtml(result.reason)}. If you need help, email <a href="mailto:info@fathersandfootball.org">info@fathersandfootball.org</a>.`,
      ),
      { status: 403, headers },
    );
  }

  const { email } = result;

  const kv = context.env.FAF_KV;
  if (!kv) {
    return new Response(
      renderPage("Configuration Error", "Storage is not available."),
      { status: 500, headers },
    );
  }

  // Find subscriber by hashing the email from the token
  const hash = await sha256Hex(email);
  const kvKey = `newsletter:subscriber:${hash}`;

  const subscriberRaw = await kv.get(kvKey);
  if (!subscriberRaw) {
    // Already removed or never existed -- show success anyway
    // (CAN-SPAM: don't make unsubscribe harder than subscribe)
    return new Response(
      renderPage(
        "Unsubscribed",
        "You have been removed from our mailing list.",
      ),
      { status: 200, headers },
    );
  }

  let subscriber;
  try {
    subscriber = JSON.parse(subscriberRaw);
  } catch {
    return new Response(
      renderPage(
        "Error",
        'Could not process your request. Please try again or email <a href="mailto:info@fathersandfootball.org">info@fathersandfootball.org</a>.',
      ),
      { status: 500, headers },
    );
  }

  if (subscriber.status === "unsubscribed") {
    return new Response(
      renderPage(
        "Already Unsubscribed",
        "You were already removed from our mailing list. No further action needed.",
      ),
      { status: 200, headers },
    );
  }

  // Mark inactive
  subscriber.status = "unsubscribed";
  subscriber.unsubscribedAt = new Date().toISOString();
  await kv.put(kvKey, JSON.stringify(subscriber));

  // Remove from index
  await removeFromIndex(kv, hash);

  return new Response(
    renderPage(
      "Unsubscribed",
      "You've been removed from the Fathers and Football newsletter. You won't receive any more emails from us.",
    ),
    { status: 200, headers },
  );
}

export async function onRequestPost() {
  return new Response("Method not allowed", { status: 405 });
}

async function sha256Hex(str) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(str.toLowerCase().trim()),
  );
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function removeFromIndex(kv, hash) {
  const indexKey = "newsletter:subscribers-index";
  const raw = await kv.get(indexKey);
  if (!raw) return;

  let index;
  try {
    index = JSON.parse(raw);
  } catch {
    return;
  }

  const filtered = index.filter((h) => h !== hash);
  await kv.put(indexKey, JSON.stringify(filtered));
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderPage(title, message) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} -- Fathers and Football</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 600px; margin: 40px auto; padding: 0 20px; color: #333; }
    h2 { color: #c8923c; }
    .box { border: 1px solid #ddd; border-radius: 8px; padding: 24px; margin-top: 20px; }
    a { color: #c8923c; }
  </style>
</head>
<body>
  <h2>Fathers and Football</h2>
  <div class="box">
    <h3>${escapeHtml(title)}</h3>
    <p>${message}</p>
  </div>
</body>
</html>`;
}
