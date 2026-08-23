// Cloudflare Pages Function -- Feedback List (Admin)
// GET endpoint, admin-passcode-protected.
// Lists feedback submissions from KV for the admin hub.
//
// DEPENDENCIES:
//   FAF_KV                   -- KV binding
//   FAF_MEDIA_ADMIN_PASSCODE -- admin auth (via shared admin-auth module)

import { corsHeaders, validateAdminPasscode } from "../lib/admin-auth.js";

const FEEDBACK_PREFIX = "feedback:";
const LIST_LIMIT = 50;

export async function onRequestOptions(context) {
  const origin = context.request.headers.get("Origin") || "";
  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin, "GET, OPTIONS"),
  });
}

export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin") || "";
  const cors = corsHeaders(origin, "GET, OPTIONS");
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

    const cursor = url.searchParams.get("cursor") || undefined;

    const listed = await kv.list({
      prefix: FEEDBACK_PREFIX,
      limit: LIST_LIMIT,
      cursor,
    });

    const items = [];
    for (const key of listed.keys) {
      const raw = await kv.get(key.name, { type: "json" });
      if (!raw) continue;
      items.push(raw);
    }

    // Sort by createdAt descending (newest first)
    items.sort(function (a, b) {
      return (b.createdAt || "").localeCompare(a.createdAt || "");
    });

    return new Response(
      JSON.stringify({
        items,
        cursor: listed.list_complete ? null : listed.cursor,
      }),
      { status: 200, headers },
    );
  } catch (err) {
    console.error("Feedback list error:", err);
    return new Response(JSON.stringify({ error: "Internal error." }), {
      status: 500,
      headers,
    });
  }
}
