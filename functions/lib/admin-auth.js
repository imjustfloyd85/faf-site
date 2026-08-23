// Shared admin authentication helpers for FAF Cloudflare Pages Functions.
//
// Centralizes the admin-passcode validation and CORS logic that was
// previously copy-pasted across media-review.js, newsletter-send.js,
// and newsletter-subscribers.js. The fan-passcode rejection from
// media-review.js is included here so every admin gate benefits from it.

const ALLOWED_ORIGINS = [
  "https://fathersandfootball.org",
  "https://www.fathersandfootball.org",
  "http://localhost:8788",
  "http://localhost:3000",
];

export function corsHeaders(origin, methods) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin)
      ? origin
      : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": methods || "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export function validateAdminPasscode(env, submitted) {
  const adminPasscode = env.FAF_MEDIA_ADMIN_PASSCODE;
  if (!adminPasscode)
    return { valid: false, reason: "not-configured", status: 500 };
  if (!submitted) return { valid: false, reason: "missing", status: 403 };

  // Reject the fan upload passcode -- it must never grant admin access
  const fanPasscode = env.FAF_MEDIA_PASSCODE;
  if (fanPasscode && submitted === fanPasscode) {
    return { valid: false, reason: "wrong-credential", status: 403 };
  }

  if (submitted !== adminPasscode)
    return { valid: false, reason: "invalid", status: 403 };
  return { valid: true };
}

export function errorResponse(msg, status, headers) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}
