/**
 * Pages Function — Tournament Status API
 *
 * Reads the latest tournament status from FAF_KV (written by the
 * zorts-scraper cron worker) and returns it as JSON for the frontend ticker.
 */

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
    "Cache-Control": "public, max-age=30",
  };
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get("Origin") || "";
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin") || "";
  const headers = {
    "Content-Type": "application/json",
    ...corsHeaders(origin),
  };

  try {
    const status = await context.env.FAF_KV.get("tournament-status", "json");

    if (!status) {
      return new Response(
        JSON.stringify({
          tournaments: [],
          lastUpdated: null,
          error: "No tournament data available yet",
        }),
        { status: 200, headers },
      );
    }

    return new Response(JSON.stringify(status), { status: 200, headers });
  } catch (err) {
    return new Response(
      JSON.stringify({
        tournaments: [],
        lastUpdated: null,
        error: "Failed to read tournament data",
      }),
      { status: 500, headers },
    );
  }
}
