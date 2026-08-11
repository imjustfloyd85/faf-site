// Cloudflare Pages Function — Sponsor Logo Server
// Serves sponsor logo images from R2. Only serves logos for sponsors
// whose status is "approved" (public access) or "pending-approval"
// (admin preview from approval email).
//
// Unapproved/rejected logos are not served to prevent enumeration.
//
// DEPENDENCIES:
//   MEDIA_BUCKET (R2) — logo storage
//   FAF_KV — sponsor entry status check

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

export async function onRequestOptions(context) {
  const origin = context.request.headers.get("Origin") || "";
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin") || "";
  const cors = corsHeaders(origin);

  try {
    const kv = context.env.FAF_KV;
    const bucket = context.env.MEDIA_BUCKET;

    if (!kv || !bucket) {
      return new Response("Not found", { status: 404, headers: cors });
    }

    const url = new URL(context.request.url);
    const id = url.searchParams.get("id");

    if (!id || typeof id !== "string" || id.length > 100) {
      return new Response("Not found", { status: 404, headers: cors });
    }

    // Sanitize: only allow UUID-shaped IDs to prevent path traversal
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      )
    ) {
      return new Response("Not found", { status: 404, headers: cors });
    }

    // Load sponsor entry to check status
    const entryRaw = await kv.get(`sponsor:pending:${id}`);
    if (!entryRaw) {
      return new Response("Not found", { status: 404, headers: cors });
    }

    let entry;
    try {
      entry = JSON.parse(entryRaw);
    } catch {
      return new Response("Not found", { status: 404, headers: cors });
    }

    // Only serve logos for approved sponsors (public) or pending-approval (admin preview)
    if (entry.status !== "approved" && entry.status !== "pending-approval") {
      return new Response("Not found", { status: 404, headers: cors });
    }

    // Fetch logo from R2
    const object = await bucket.get(entry.logoR2Key);
    if (!object) {
      return new Response("Not found", { status: 404, headers: cors });
    }

    const cacheControl =
      entry.status === "approved"
        ? "public, max-age=86400" // 24h cache for approved logos
        : "private, no-cache"; // no cache for admin previews

    return new Response(object.body, {
      status: 200,
      headers: {
        "Content-Type": entry.logoContentType || "image/png",
        "Cache-Control": cacheControl,
        "X-Content-Type-Options": "nosniff",
        ...cors,
      },
    });
  } catch (err) {
    console.error("Sponsor logo serve error:", err);
    return new Response("Not found", { status: 404, headers: cors });
  }
}

export async function onRequestPost() {
  return new Response("Method not allowed", { status: 405 });
}
