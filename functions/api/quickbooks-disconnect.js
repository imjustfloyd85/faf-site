// Cloudflare Pages Function — QuickBooks Online Disconnect Handler
// Intuit redirects the user's browser here (GET) when they disconnect
// the app from QBO's connected-apps management screen.
//
// Clears the stored OAuth tokens from KV (they're invalid once
// disconnected anyway) and shows a confirmation page.
//
// DEPENDENCY (KV binding):
//   FAF_KV — Cloudflare KV namespace for token storage

export async function onRequestGet(context) {
  const kv = context.env.FAF_KV;

  if (!kv) {
    console.error("FAF_KV binding not configured");
    return new Response(
      "<h2>Configuration Error</h2><p>KV storage not available. Contact admin.</p>",
      { status: 500, headers: { "Content-Type": "text/html" } },
    );
  }

  // Delete stored tokens — no-op if already missing
  await kv.delete("qbo:tokens");

  return new Response(
    `<h2>QuickBooks Disconnected</h2>
     <p>The QuickBooks Online integration has been disconnected and stored tokens have been cleared.</p>
     <p>To reconnect, <a href="/api/quickbooks-connect">click here</a>.</p>`,
    { status: 200, headers: { "Content-Type": "text/html" } },
  );
}

export async function onRequestPost() {
  return new Response("Method not allowed", { status: 405 });
}
