// Cloudflare Pages Function — QuickBooks Online OAuth Connect
// Redirects the admin to Intuit's OAuth consent screen.
//
// DEPENDENCIES (CF Pages secrets):
//   QBO_CLIENT_ID — Intuit app client ID (sandbox)
//   QBO_APPROVAL_SECRET — used to sign CSRF state param
//
// The redirect URI MUST be:
//   https://fathersandfootball.org/api/quickbooks-oauth-callback
// (already registered in the Intuit developer app)

const INTUIT_AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const REDIRECT_URI =
  "https://fathersandfootball.org/api/quickbooks-oauth-callback";
const SCOPES = "com.intuit.quickbooks.accounting";

async function generateState(secret) {
  const nonce = crypto.randomUUID();
  const payload = `${nonce}.${Math.floor(Date.now() / 1000)}`;
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
  const sig = [...new Uint8Array(sigBytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${payload}.${sig}`;
}

export async function onRequestGet(context) {
  const clientId = context.env.QBO_CLIENT_ID;
  const secret = context.env.QBO_APPROVAL_SECRET;

  if (!clientId || !secret) {
    return new Response("QuickBooks integration not configured.", {
      status: 500,
    });
  }

  const state = await generateState(secret);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    scope: SCOPES,
    redirect_uri: REDIRECT_URI,
    state: state,
  });

  const authUrl = `${INTUIT_AUTH_URL}?${params.toString()}`;

  return Response.redirect(authUrl, 302);
}

export async function onRequestPost() {
  return new Response("Method not allowed", { status: 405 });
}
