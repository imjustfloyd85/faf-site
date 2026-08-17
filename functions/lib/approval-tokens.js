// Signed approval-token creation and verification for the QBO
// pending-entry queue.  The token encodes entryId + action + expiry,
// signed with HMAC-SHA256.  Financial data is NEVER embedded in the
// token — the handler always looks it up server-side from KV.
//
// Token format (URL-safe):
//   base64url(entryId.action.expiresAt).base64url(hmac)
//
// Replay protection: the handler checks the entry status in KV.
// A used or expired token is rejected.

const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

function toBase64Url(str) {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(b64) {
  const padded = b64.replace(/-/g, "+").replace(/_/g, "/");
  return atob(padded);
}

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSign(payload, secret) {
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
  return bytesToHex(sigBytes);
}

// Create a signed approval token for a given entry and action.
// action must be "approve" or "reject".
export async function createApprovalToken(entryId, action, secret) {
  if (!entryId || !action || !secret) {
    throw new Error("createApprovalToken: missing required arguments");
  }
  if (action !== "approve" && action !== "reject") {
    throw new Error("createApprovalToken: action must be approve or reject");
  }

  const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const payload = `${entryId}.${action}.${expiresAt}`;
  const sig = await hmacSign(payload, secret);

  return toBase64Url(payload) + "." + toBase64Url(sig);
}

// Verify and decode an approval token.
// Returns { valid: true, entryId, action, expiresAt } or
//         { valid: false, reason: string }.
export async function verifyApprovalToken(token, secret) {
  if (!token || !secret) {
    return { valid: false, reason: "missing token or secret" };
  }

  const dotIndex = token.lastIndexOf(".");
  if (dotIndex < 1) {
    return { valid: false, reason: "malformed token" };
  }

  let payloadStr, providedSig;
  try {
    payloadStr = fromBase64Url(token.substring(0, dotIndex));
    providedSig = fromBase64Url(token.substring(dotIndex + 1));
  } catch {
    return { valid: false, reason: "invalid base64 encoding" };
  }

  const parts = payloadStr.split(".");
  if (parts.length !== 3) {
    return { valid: false, reason: "malformed payload" };
  }

  const [entryId, action, expiresAtStr] = parts;
  const expiresAt = parseInt(expiresAtStr, 10);
  if (isNaN(expiresAt)) {
    return { valid: false, reason: "invalid expiry" };
  }

  // Check expiry
  if (Math.floor(Date.now() / 1000) > expiresAt) {
    return { valid: false, reason: "token expired" };
  }

  // Validate action
  if (action !== "approve" && action !== "reject") {
    return { valid: false, reason: "invalid action" };
  }

  // Verify HMAC — constant-time comparison
  const expectedSig = await hmacSign(payloadStr, secret);
  if (providedSig.length !== expectedSig.length) {
    return { valid: false, reason: "invalid signature" };
  }
  let mismatch = 0;
  for (let i = 0; i < expectedSig.length; i++) {
    mismatch |= providedSig.charCodeAt(i) ^ expectedSig.charCodeAt(i);
  }
  if (mismatch !== 0) {
    return { valid: false, reason: "invalid signature" };
  }

  return { valid: true, entryId, action, expiresAt };
}

// --- Newsletter unsubscribe tokens ---
// Non-expiring HMAC token tied to a subscriber email.
// Format: base64url(email).base64url(hmac)
// No expiry because CAN-SPAM unsubscribe links must work indefinitely.

export async function createUnsubscribeToken(email, secret) {
  if (!email || !secret) {
    throw new Error("createUnsubscribeToken: missing required arguments");
  }
  const payload = `unsub:${email}`;
  const sig = await hmacSign(payload, secret);
  return toBase64Url(payload) + "." + toBase64Url(sig);
}

export async function verifyUnsubscribeToken(token, secret) {
  if (!token || !secret) {
    return { valid: false, reason: "missing token or secret" };
  }

  const dotIndex = token.lastIndexOf(".");
  if (dotIndex < 1) {
    return { valid: false, reason: "malformed token" };
  }

  let payloadStr, providedSig;
  try {
    payloadStr = fromBase64Url(token.substring(0, dotIndex));
    providedSig = fromBase64Url(token.substring(dotIndex + 1));
  } catch {
    return { valid: false, reason: "invalid base64 encoding" };
  }

  if (!payloadStr.startsWith("unsub:")) {
    return { valid: false, reason: "wrong token type" };
  }

  const email = payloadStr.slice("unsub:".length);
  if (!email) {
    return { valid: false, reason: "missing email in token" };
  }

  // Verify HMAC with constant-time comparison
  const expectedSig = await hmacSign(payloadStr, secret);
  if (providedSig.length !== expectedSig.length) {
    return { valid: false, reason: "invalid signature" };
  }
  let mismatch = 0;
  for (let i = 0; i < expectedSig.length; i++) {
    mismatch |= providedSig.charCodeAt(i) ^ expectedSig.charCodeAt(i);
  }
  if (mismatch !== 0) {
    return { valid: false, reason: "invalid signature" };
  }

  return { valid: true, email };
}

// Exported for testing
export { TOKEN_TTL_SECONDS, toBase64Url, fromBase64Url };
