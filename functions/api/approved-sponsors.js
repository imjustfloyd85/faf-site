// Cloudflare Pages Function — Approved Sponsors List
// Returns the list of approved sponsors as JSON for the public sponsors page.
// Only sponsors whose logo placement has been reviewed and approved by an
// admin appear in this list.
//
// DEPENDENCY (KV binding):
//   FAF_KV — stores the sponsors:approved list

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
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=300",
    ...cors,
  };

  try {
    const kv = context.env.FAF_KV;
    if (!kv) {
      return new Response(JSON.stringify({ sponsors: [] }), {
        status: 200,
        headers,
      });
    }

    const listRaw = await kv.get("sponsors:approved");
    if (!listRaw) {
      return new Response(JSON.stringify({ sponsors: [] }), {
        status: 200,
        headers,
      });
    }

    let list;
    try {
      list = JSON.parse(listRaw);
    } catch {
      list = [];
    }

    // Return only public-safe fields (no emails, no internal IDs beyond logo ref)
    const publicList = list.map((s) => ({
      id: s.id,
      name: s.sponsorOrg || s.sponsorName,
      tier: s.tier,
      approvedAt: s.approvedAt,
    }));

    return new Response(JSON.stringify({ sponsors: publicList }), {
      status: 200,
      headers,
    });
  } catch (err) {
    console.error("Approved sponsors error:", err);
    return new Response(JSON.stringify({ sponsors: [] }), {
      status: 200,
      headers,
    });
  }
}

export async function onRequestPost() {
  return new Response("Method not allowed", { status: 405 });
}
