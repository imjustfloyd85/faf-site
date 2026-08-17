// Cloudflare Pages Function -- Newsletter Signup
// Accepts email via POST, stores subscriber in FAF_KV, sends a
// confirmation email via ACS with an HMAC-signed unsubscribe link.
//
// KV key layout:
//   newsletter:subscriber:<sha256-hex>  = { email, signupDate, status, unsubToken }
//   newsletter:subscribers-index        = JSON array of sha256 hashes (for enumeration)
//
// Single opt-in (matches the rest of the site). CAN-SPAM requires an
// unsubscribe link on every bulk email regardless of nonprofit status,
// so the confirmation email includes one.
//
// DEPENDENCIES:
//   FAF_KV               -- KV binding
//   QBO_APPROVAL_SECRET  -- HMAC key (shared, reused for unsubscribe tokens)
//   ACS_CONNECTION_STRING -- email transport

import { createUnsubscribeToken } from "../lib/approval-tokens.js";
import { sendViaACS } from "../lib/acs-email.js";

const FROM_ADDRESS = "DoNotReply@fathersandfootball.org";
const REPLY_TO = "info@fathersandfootball.org";

// Identical response regardless of prior subscription state (active,
// unsubscribed, or never signed up). Differentiating the message lets
// an unauthenticated caller enumerate whether an arbitrary email address
// is currently or was ever on the list -- the real state only ever goes
// to the address itself, via the emails already sent in each branch.
const GENERIC_SIGNUP_MESSAGE =
  "Thanks! If that address isn't already on the list, check your inbox to confirm.";

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
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function sha256Hex(str) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(str.toLowerCase().trim()),
  );
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get("Origin") || "";
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function onRequestPost(context) {
  const origin = context.request.headers.get("Origin") || "";
  const cors = corsHeaders(origin);
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

    const { email } = body;

    // Server-side email validation (same pattern as create-checkout-session.js)
    if (!email || typeof email !== "string" || !email.includes("@")) {
      return new Response(
        JSON.stringify({ error: "A valid email address is required." }),
        { status: 400, headers },
      );
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Additional validation: basic format check
    const atIndex = normalizedEmail.indexOf("@");
    const dotAfterAt = normalizedEmail.indexOf(".", atIndex);
    if (
      atIndex < 1 ||
      dotAfterAt < atIndex + 2 ||
      dotAfterAt === normalizedEmail.length - 1
    ) {
      return new Response(
        JSON.stringify({ error: "A valid email address is required." }),
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
        JSON.stringify({ error: "Signup is not configured." }),
        { status: 500, headers },
      );
    }

    const hash = await sha256Hex(normalizedEmail);
    const kvKey = `newsletter:subscriber:${hash}`;

    // Check for existing subscriber
    const existingRaw = await kv.get(kvKey);
    if (existingRaw) {
      let existing;
      try {
        existing = JSON.parse(existingRaw);
      } catch {
        existing = null;
      }

      if (existing && existing.status === "active") {
        // Already subscribed -- return the same generic response as every
        // other case (see GENERIC_SIGNUP_MESSAGE) so this endpoint can't be
        // used to probe whether an arbitrary email is on the list.
        return new Response(
          JSON.stringify({ success: true, message: GENERIC_SIGNUP_MESSAGE }),
          { status: 200, headers },
        );
      }

      // If previously unsubscribed, reactivate
      if (existing && existing.status === "unsubscribed") {
        existing.status = "active";
        existing.resubscribedAt = new Date().toISOString();
        await kv.put(kvKey, JSON.stringify(existing));

        // Re-add to index
        await addToIndex(kv, hash);

        // Notify the actual address -- both a courtesy and a safeguard: if
        // someone else triggered this resubscribe (they only need to know
        // the email address, not prove ownership), the real owner sees it
        // happened and can unsubscribe again immediately.
        const siteUrl = new URL(context.request.url).origin;
        const unsubUrl = `${siteUrl}/api/newsletter-unsubscribe?token=${encodeURIComponent(existing.unsubToken)}`;
        try {
          await sendViaACS(context.env, {
            from: FROM_ADDRESS,
            to: normalizedEmail,
            replyTo: REPLY_TO,
            subject: "You're on the list -- Fathers and Football",
            html: buildConfirmationEmail(escapeHtml(normalizedEmail), unsubUrl),
          });
        } catch (emailErr) {
          console.error("Resubscribe confirmation email failed:", emailErr);
        }

        return new Response(
          JSON.stringify({ success: true, message: GENERIC_SIGNUP_MESSAGE }),
          { status: 200, headers },
        );
      }
    }

    // Create unsubscribe token
    const unsubToken = await createUnsubscribeToken(normalizedEmail, secret);
    const siteUrl = new URL(context.request.url).origin;
    const unsubUrl = `${siteUrl}/api/newsletter-unsubscribe?token=${encodeURIComponent(unsubToken)}`;

    // Store subscriber
    const subscriber = {
      email: normalizedEmail,
      signupDate: new Date().toISOString(),
      status: "active",
      unsubToken,
    };

    await kv.put(kvKey, JSON.stringify(subscriber));

    // Add hash to subscribers index
    await addToIndex(kv, hash);

    // Send confirmation email via ACS
    try {
      await sendViaACS(context.env, {
        from: FROM_ADDRESS,
        to: normalizedEmail,
        replyTo: REPLY_TO,
        subject: "You're on the list -- Fathers and Football",
        html: buildConfirmationEmail(escapeHtml(normalizedEmail), unsubUrl),
      });
    } catch (emailErr) {
      // Subscription is stored even if the confirmation email fails.
      // Log the error but don't fail the signup.
      console.error("Confirmation email failed:", emailErr);
    }

    return new Response(
      JSON.stringify({ success: true, message: GENERIC_SIGNUP_MESSAGE }),
      { status: 200, headers },
    );
  } catch (err) {
    console.error("Newsletter signup error:", err);
    return new Response(
      JSON.stringify({ error: "Something went wrong. Please try again." }),
      { status: 500, headers },
    );
  }
}

export async function onRequestGet() {
  return new Response("Method not allowed", { status: 405 });
}

// Maintain a JSON array of subscriber hashes for efficient enumeration
// during newsletter sends. KV list-by-prefix works too, but a maintained
// index avoids the eventual-consistency lag and pagination complexity.
async function addToIndex(kv, hash) {
  const indexKey = "newsletter:subscribers-index";
  const raw = await kv.get(indexKey);
  let index = [];
  if (raw) {
    try {
      index = JSON.parse(raw);
    } catch {
      index = [];
    }
  }

  if (!index.includes(hash)) {
    index.push(hash);
    await kv.put(indexKey, JSON.stringify(index));
  }
}

function buildConfirmationEmail(escapedEmail, unsubUrl) {
  return `
<div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #333;">
  <h2 style="color: #c8923c;">Fathers and Football</h2>
  <p>You're signed up for the FAF newsletter.</p>
  <p>We'll send you updates about upcoming events, game recaps, and ways to get involved. No spam, no fluff -- just what's happening with our program.</p>
  <p style="color: #777; font-size: 13px; margin-top: 32px;">
    If you didn't sign up, or want to stop receiving emails, you can
    <a href="${escapeHtml(unsubUrl)}" style="color: #c8923c;">unsubscribe here</a>.
  </p>
  <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
  <p style="font-size: 11px; color: #999;">
    Fathers and Football | 501(c)(3) | EIN 42-1980182<br/>
    This email was sent to ${escapedEmail}.
  </p>
</div>`;
}
