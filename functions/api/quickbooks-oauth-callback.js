// Cloudflare Pages Function — QuickBooks Online OAuth Callback
// Receives the auth code from Intuit, exchanges it for access + refresh
// tokens, and stores them in Cloudflare KV.
//
// Redirect URI (registered in Intuit app):
//   https://fathersandfootball.org/api/quickbooks-oauth-callback
//
// DEPENDENCIES (CF Pages secrets):
//   QBO_CLIENT_ID, QBO_CLIENT_SECRET — Intuit app credentials
//   QBO_APPROVAL_SECRET — for CSRF state verification
//
// DEPENDENCY (KV binding):
//   FAF_KV — Cloudflare KV namespace for token storage

import { storeTokens } from "../lib/qbo-client.js";

const INTUIT_TOKEN_URL =
  "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

async function verifyState(state, secret) {
  if (!state || !secret) return false;

  const lastDot = state.lastIndexOf(".");
  if (lastDot < 1) return false;

  const payload = state.substring(0, lastDot);
  const providedSig = state.substring(lastDot + 1);

  // Check timestamp freshness (10 minute window)
  const parts = payload.split(".");
  if (parts.length !== 2) return false;
  const timestamp = parseInt(parts[1], 10);
  if (isNaN(timestamp)) return false;
  const age = Math.floor(Date.now() / 1000) - timestamp;
  if (age > 600 || age < -60) return false;

  const keyBytes = new TextEncoder().encode(secret);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBytes = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(payload),
  );
  const expectedSig = [...new Uint8Array(sigBytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (providedSig.length !== expectedSig.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expectedSig.length; i++) {
    mismatch |= providedSig.charCodeAt(i) ^ expectedSig.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const code = url.searchParams.get("code");
  const realmId = url.searchParams.get("realmId");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    console.error("QBO OAuth error:", error);
    return new Response(
      `<h2>QuickBooks Authorization Failed</h2><p>Error: ${escapeHtml(error)}</p><p><a href="/api/quickbooks-connect">Try again</a></p>`,
      { status: 400, headers: { "Content-Type": "text/html" } },
    );
  }

  if (!code || !realmId) {
    return new Response(
      "<h2>Invalid callback</h2><p>Missing authorization code or company ID.</p>",
      { status: 400, headers: { "Content-Type": "text/html" } },
    );
  }

  // Verify CSRF state
  const secret = context.env.QBO_APPROVAL_SECRET;
  const stateValid = await verifyState(state, secret);
  if (!stateValid) {
    console.error("QBO OAuth state verification failed");
    return new Response(
      '<h2>Authorization Failed</h2><p>Invalid or expired state parameter. Please try again.</p><p><a href="/api/quickbooks-connect">Retry</a></p>',
      { status: 403, headers: { "Content-Type": "text/html" } },
    );
  }

  // Exchange auth code for tokens
  const clientId = context.env.QBO_CLIENT_ID;
  const clientSecret = context.env.QBO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return new Response("QBO credentials not configured.", { status: 500 });
  }

  const basicAuth = btoa(`${clientId}:${clientSecret}`);

  const tokenRes = await fetch(INTUIT_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth}`,
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code,
      redirect_uri:
        "https://fathersandfootball.org/api/quickbooks-oauth-callback",
    }).toString(),
  });

  if (!tokenRes.ok) {
    const errBody = await tokenRes.text();
    console.error("QBO token exchange failed:", tokenRes.status, errBody);
    return new Response(
      `<h2>Token Exchange Failed</h2><p>Could not obtain access tokens. Status: ${tokenRes.status}</p><p><a href="/api/quickbooks-connect">Try again</a></p>`,
      { status: 502, headers: { "Content-Type": "text/html" } },
    );
  }

  const tokenData = await tokenRes.json();

  // Store tokens in KV
  const kv = context.env.FAF_KV;
  if (!kv) {
    console.error("FAF_KV binding not configured");
    return new Response(
      "<h2>Configuration Error</h2><p>KV storage not available. Contact admin.</p>",
      { status: 500, headers: { "Content-Type": "text/html" } },
    );
  }

  const tokens = {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (tokenData.expires_in || 3600),
    realm_id: realmId,
  };

  await storeTokens(kv, tokens);

  return new Response(
    `<h2>QuickBooks Connected</h2>
     <p>Successfully connected to QuickBooks Online company (Realm ID: ${escapeHtml(realmId)}).</p>
     <p>Access and refresh tokens have been stored. The integration is now active.</p>
     <p><a href="/">Return to site</a></p>`,
    { status: 200, headers: { "Content-Type": "text/html" } },
  );
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function onRequestPost() {
  return new Response("Method not allowed", { status: 405 });
}
