// Cloudflare Pages Function -- Newsletter Subscriber Count (Admin)
// GET endpoint, passcode-protected (same auth as media-review.js).
// Returns the count of active subscribers for the admin compose UI.
//
// DEPENDENCIES:
//   FAF_KV                   -- KV binding
//   FAF_MEDIA_ADMIN_PASSCODE -- admin auth

function corsHeaders(origin) {
  const allowed = [
    "https://fathersandfootball.org",
    "https://www.fathersandfootball.org",
    "http://localhost:8788",
    "http://localhost:3000",
  ];
  return {
    "Access-Control-Allow-Origin": allowed.includes(origin)
      ? origin
      : allowed[0],
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function validateAdminPasscode(env, submitted) {
  const adminPasscode = env.FAF_MEDIA_ADMIN_PASSCODE;
  if (!adminPasscode)
    return { valid: false, reason: "not-configured", status: 500 };
  if (!submitted) return { valid: false, reason: "missing", status: 403 };
  if (submitted !== adminPasscode)
    return { valid: false, reason: "invalid", status: 403 };
  return { valid: true };
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get("Origin") || "";
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin") || "";
  const cors = corsHeaders(origin);
  const headers = { "Content-Type": "application/json", ...cors };

  try {
    const url = new URL(context.request.url);
    const passcode = url.searchParams.get("passcode");

    const auth = validateAdminPasscode(context.env, passcode);
    if (!auth.valid) {
      const msg =
        auth.reason === "not-configured"
          ? "Not configured."
          : "Invalid admin passcode.";
      return new Response(JSON.stringify({ error: msg }), {
        status: auth.status,
        headers,
      });
    }

    const kv = context.env.FAF_KV;
    if (!kv) {
      return new Response(
        JSON.stringify({ error: "Storage is not configured." }),
        { status: 500, headers },
      );
    }

    const indexRaw = await kv.get("newsletter:subscribers-index");
    if (!indexRaw) {
      return new Response(JSON.stringify({ count: 0 }), {
        status: 200,
        headers,
      });
    }

    let index;
    try {
      index = JSON.parse(indexRaw);
    } catch {
      return new Response(JSON.stringify({ count: 0 }), {
        status: 200,
        headers,
      });
    }

    // Count only active subscribers
    let activeCount = 0;
    for (const hash of index) {
      const raw = await kv.get(`newsletter:subscriber:${hash}`);
      if (!raw) continue;
      try {
        const sub = JSON.parse(raw);
        if (sub.status === "active") activeCount++;
      } catch {
        // skip corrupted entries
      }
    }

    return new Response(JSON.stringify({ count: activeCount }), {
      status: 200,
      headers,
    });
  } catch (err) {
    console.error("Newsletter subscribers error:", err);
    return new Response(JSON.stringify({ error: "Internal error." }), {
      status: 500,
      headers,
    });
  }
}
