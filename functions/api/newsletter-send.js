// Cloudflare Pages Function -- Newsletter Send (Admin)
// POST endpoint, passcode-protected (same auth pattern as media-review.js).
// Enumerates active subscribers from FAF_KV and sends each one an
// individual email via ACS with a personalized unsubscribe link.
//
// Refactored: actual send logic lives in lib/newsletter-send-core.js
// so both this admin endpoint and the automated approval flow share
// the same code path.

import {
  sendNewsletterToAll,
  escapeHtml,
} from "../lib/newsletter-send-core.js";
import { corsHeaders, validateAdminPasscode } from "../lib/admin-auth.js";

export async function onRequestOptions(context) {
  const origin = context.request.headers.get("Origin") || "";
  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin, "POST, OPTIONS"),
  });
}

export async function onRequestPost(context) {
  const origin = context.request.headers.get("Origin") || "";
  const cors = corsHeaders(origin, "POST, OPTIONS");
  const headers = { "Content-Type": "application/json", ...cors };

  try {
    let body;
    try {
      body = await context.request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
        status: 400,
        headers,
      });
    }

    const { passcode, subject, content } = body;

    const auth = validateAdminPasscode(context.env, passcode);
    if (!auth.valid) {
      const msg =
        auth.reason === "not-configured"
          ? "Newsletter send is not configured."
          : "Invalid admin passcode.";
      return new Response(JSON.stringify({ error: msg }), {
        status: auth.status,
        headers,
      });
    }

    if (!subject || typeof subject !== "string" || !subject.trim()) {
      return new Response(
        JSON.stringify({ error: "Subject line is required." }),
        { status: 400, headers },
      );
    }

    if (!content || typeof content !== "string" || !content.trim()) {
      return new Response(
        JSON.stringify({ error: "Newsletter body is required." }),
        { status: 400, headers },
      );
    }

    // Convert plain-text body to HTML paragraphs
    const escapedContent = escapeHtml(content.trim());
    const bodyHtml = escapedContent
      .split(/\n{2,}/)
      .map((para) => `<p>${para.replace(/\n/g, "<br/>")}</p>`)
      .join("");

    const siteUrl = new URL(context.request.url).origin;

    const result = await sendNewsletterToAll({
      subject: subject.trim(),
      bodyHtml,
      siteUrl,
      env: context.env,
    });

    return new Response(
      JSON.stringify({
        success: true,
        sent: result.sent,
        failed: result.failed,
        errors: result.errors.length > 0 ? result.errors : undefined,
      }),
      { status: 200, headers },
    );
  } catch (err) {
    console.error("Newsletter send error:", err);
    return new Response(JSON.stringify({ error: "Internal error." }), {
      status: 500,
      headers,
    });
  }
}

export async function onRequestGet() {
  return new Response("Method not allowed", { status: 405 });
}
