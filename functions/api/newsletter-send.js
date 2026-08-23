// Cloudflare Pages Function -- Newsletter Send (Admin)
// POST endpoint, passcode-protected (same auth pattern as media-review.js).
// Enumerates active subscribers from FAF_KV and sends each one an
// individual email via ACS with a personalized unsubscribe link.
//
// Each recipient gets their own email (not a shared to: [] blast)
// because each unsubscribe URL is subscriber-specific.
//
// SCALING NOTE: Cloudflare Pages Functions have a ~30s CPU time limit
// on the free plan (up to ~120s on paid). For large subscriber lists
// (hundreds+), this loop will hit the wall. At that point, consider
// Cloudflare Queues or Durable Objects to fan out sends. For the
// current FAF scale (dozens of subscribers), a direct loop is fine.
//
// DEPENDENCIES:
//   FAF_KV                  -- KV binding
//   FAF_MEDIA_ADMIN_PASSCODE -- admin auth (shared with media-review)
//   ACS_CONNECTION_STRING   -- email transport
//   QBO_APPROVAL_SECRET     -- HMAC key for unsubscribe tokens

import { sendViaACS } from "../lib/acs-email.js";
import { createUnsubscribeToken } from "../lib/approval-tokens.js";
import { corsHeaders, validateAdminPasscode } from "../lib/admin-auth.js";

const FROM_ADDRESS = "DoNotReply@fathersandfootball.org";
const REPLY_TO = "info@fathersandfootball.org";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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

    // Admin auth (same pattern as media-review.js)
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

    // Validate content
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

    const kv = context.env.FAF_KV;
    if (!kv) {
      return new Response(
        JSON.stringify({ error: "Storage is not configured." }),
        { status: 500, headers },
      );
    }

    const secret = context.env.QBO_APPROVAL_SECRET;
    if (!secret) {
      return new Response(
        JSON.stringify({ error: "Token signing is not configured." }),
        { status: 500, headers },
      );
    }

    // Load subscriber index
    const indexRaw = await kv.get("newsletter:subscribers-index");
    if (!indexRaw) {
      return new Response(
        JSON.stringify({ error: "No subscribers found.", sent: 0, failed: 0 }),
        { status: 200, headers },
      );
    }

    let index;
    try {
      index = JSON.parse(indexRaw);
    } catch {
      return new Response(
        JSON.stringify({ error: "Subscriber index is corrupted." }),
        { status: 500, headers },
      );
    }

    if (!Array.isArray(index) || index.length === 0) {
      return new Response(
        JSON.stringify({ error: "No subscribers found.", sent: 0, failed: 0 }),
        { status: 200, headers },
      );
    }

    // Convert plain-text body to HTML paragraphs
    // (admin writes in a textarea, so newlines become <p> tags)
    const escapedContent = escapeHtml(content.trim());
    const bodyHtml = escapedContent
      .split(/\n{2,}/)
      .map((para) => `<p>${para.replace(/\n/g, "<br/>")}</p>`)
      .join("");

    const siteUrl = new URL(context.request.url).origin;
    const escapedSubject = escapeHtml(subject.trim());

    let sent = 0;
    let failedCount = 0;
    const errors = [];

    // Send to each subscriber individually (personalized unsubscribe URL)
    // SCALING: This loop is fine for dozens of subscribers. For hundreds+,
    // this will hit CF Pages Function execution time limits. See file header.
    for (const hash of index) {
      const subscriberRaw = await kv.get(`newsletter:subscriber:${hash}`);
      if (!subscriberRaw) continue;

      let subscriber;
      try {
        subscriber = JSON.parse(subscriberRaw);
      } catch {
        continue;
      }

      if (subscriber.status !== "active") continue;

      // Build personalized unsubscribe link
      let unsubUrl;
      if (subscriber.unsubToken) {
        unsubUrl = `${siteUrl}/api/newsletter-unsubscribe?token=${encodeURIComponent(subscriber.unsubToken)}`;
      } else {
        // Generate one if missing (shouldn't happen, but defensive)
        const token = await createUnsubscribeToken(subscriber.email, secret);
        unsubUrl = `${siteUrl}/api/newsletter-unsubscribe?token=${encodeURIComponent(token)}`;
        // Backfill the token
        subscriber.unsubToken = token;
        await kv.put(
          `newsletter:subscriber:${hash}`,
          JSON.stringify(subscriber),
        );
      }

      const emailHtml = buildNewsletterEmail(
        bodyHtml,
        escapedSubject,
        escapeHtml(subscriber.email),
        unsubUrl,
      );

      try {
        const result = await sendViaACS(context.env, {
          from: FROM_ADDRESS,
          to: subscriber.email,
          replyTo: REPLY_TO,
          subject: subject.trim(),
          html: emailHtml,
        });

        if (result.ok || result.status === 202) {
          sent++;
        } else {
          failedCount++;
          errors.push(`${subscriber.email}: HTTP ${result.status}`);
        }
      } catch (emailErr) {
        failedCount++;
        errors.push(`${subscriber.email}: ${emailErr.message}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        sent,
        failed: failedCount,
        errors: errors.length > 0 ? errors : undefined,
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

function buildNewsletterEmail(
  bodyHtml,
  escapedSubject,
  escapedEmail,
  unsubUrl,
) {
  return `
<div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #333;">
  <h2 style="color: #c8923c;">Fathers and Football</h2>
  <h3>${escapedSubject}</h3>
  ${bodyHtml}
  <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0 16px;" />
  <p style="font-size: 11px; color: #999;">
    Fathers and Football | 501(c)(3) | EIN 42-1980182<br/>
    This email was sent to ${escapedEmail}.<br/>
    <a href="${escapeHtml(unsubUrl)}" style="color: #c8923c;">Unsubscribe</a>
  </p>
</div>`;
}
