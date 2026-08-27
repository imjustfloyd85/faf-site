// Cloudflare Pages Function -- Newsletter Subscriber Management (Admin)
//
// Authenticated API for managing newsletter subscribers.
// All actions require the same admin passcode as media-review.js.
//
// GET actions (passcode in query string):
//   (no action / default) -- returns active subscriber COUNT (backward compat)
//   ?action=list          -- returns full subscriber list with email, status, signupDate
//
// POST actions (passcode in JSON body):
//   action: "remove-subscriber"    -- soft-delete: sets status to "removed-by-admin"
//   action: "send-to-subscriber"   -- send the current pending draft to one subscriber
//
// DEPENDENCIES:
//   FAF_KV                   -- KV binding
//   FAF_MEDIA_ADMIN_PASSCODE -- admin auth
//   ACS_CONNECTION_STRING    -- email transport (send-to-subscriber)
//   QBO_APPROVAL_SECRET      -- unsubscribe token signing (send-to-subscriber)

import {
  corsHeaders,
  validateAdminPasscode,
  errorResponse,
} from "../lib/admin-auth.js";
import {
  buildNewsletterEmail,
  escapeHtml,
  FROM_ADDRESS,
  REPLY_TO,
} from "../lib/newsletter-send-core.js";
import { createUnsubscribeToken } from "../lib/approval-tokens.js";
import { sendViaACS } from "../lib/acs-email.js";

export async function onRequestOptions(context) {
  const origin = context.request.headers.get("Origin") || "";
  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin, "GET, POST, OPTIONS"),
  });
}

// Load all subscribers from the index. Returns an array of
// { hash, email, status, signupDate } objects.
async function loadAllSubscribers(kv) {
  const indexRaw = await kv.get("newsletter:subscribers-index");
  if (!indexRaw) return [];

  let index;
  try {
    index = JSON.parse(indexRaw);
  } catch {
    return [];
  }

  if (!Array.isArray(index)) return [];

  const subscribers = [];
  for (const hash of index) {
    const raw = await kv.get(`newsletter:subscriber:${hash}`);
    if (!raw) continue;
    try {
      const sub = JSON.parse(raw);
      subscribers.push({
        hash,
        email: sub.email,
        status: sub.status || "unknown",
        signupDate: sub.signupDate || null,
      });
    } catch {
      // skip corrupted entries
    }
  }

  return subscribers;
}

// Find the most recent pending-approval draft in KV.
async function findPendingDraft(kv) {
  const listed = await kv.list({ prefix: "newsletter:draft:" });
  let newest = null;

  for (const key of listed.keys) {
    const raw = await kv.get(key.name);
    if (!raw) continue;
    try {
      const draft = JSON.parse(raw);
      if (draft.status !== "pending-approval") continue;
      if (!newest || new Date(draft.createdAt) > new Date(newest.createdAt)) {
        newest = draft;
      }
    } catch {
      // skip malformed
    }
  }

  return newest;
}

export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin") || "";
  const cors = corsHeaders(origin, "GET, POST, OPTIONS");
  const headers = { "Content-Type": "application/json", ...cors };

  try {
    const url = new URL(context.request.url);
    const passcode = url.searchParams.get("passcode");
    const action = url.searchParams.get("action");

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

    // --- LIST SUBSCRIBERS ---
    if (action === "list") {
      const subscribers = await loadAllSubscribers(kv);
      return new Response(JSON.stringify({ subscribers }), {
        status: 200,
        headers,
      });
    }

    // --- DEFAULT: COUNT ONLY (backward compat) ---
    const subscribers = await loadAllSubscribers(kv);
    const activeCount = subscribers.filter((s) => s.status === "active").length;

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

export async function onRequestPost(context) {
  const origin = context.request.headers.get("Origin") || "";
  const cors = corsHeaders(origin, "GET, POST, OPTIONS");
  const headers = { "Content-Type": "application/json", ...cors };

  try {
    let body;
    try {
      body = await context.request.json();
    } catch {
      return errorResponse("Invalid JSON body.", 400, cors);
    }

    const { action, passcode } = body;

    const auth = validateAdminPasscode(context.env, passcode);
    if (!auth.valid) {
      const msg =
        auth.reason === "not-configured"
          ? "Not configured."
          : "Invalid admin passcode.";
      return errorResponse(msg, auth.status, cors);
    }

    const kv = context.env.FAF_KV;
    if (!kv) {
      return errorResponse("KV store not configured.", 500, cors);
    }

    // --- REMOVE SUBSCRIBER (soft-delete) ---
    if (action === "remove-subscriber") {
      const { subscriberHash } = body;
      if (!subscriberHash) {
        return errorResponse("subscriberHash is required.", 400, cors);
      }

      const raw = await kv.get(`newsletter:subscriber:${subscriberHash}`);
      if (!raw) {
        return errorResponse("Subscriber not found.", 404, cors);
      }

      let subscriber;
      try {
        subscriber = JSON.parse(raw);
      } catch {
        return errorResponse("Subscriber data corrupted.", 500, cors);
      }

      // Soft-delete: mark as removed-by-admin with timestamp
      subscriber.status = "removed-by-admin";
      subscriber.removedAt = new Date().toISOString();

      await kv.put(
        `newsletter:subscriber:${subscriberHash}`,
        JSON.stringify(subscriber),
      );

      return new Response(
        JSON.stringify({
          success: true,
          email: subscriber.email,
          newStatus: "removed-by-admin",
          removedAt: subscriber.removedAt,
        }),
        { status: 200, headers },
      );
    }

    // --- SEND TO ONE SUBSCRIBER ---
    if (action === "send-to-subscriber") {
      const { subscriberHash } = body;
      if (!subscriberHash) {
        return errorResponse("subscriberHash is required.", 400, cors);
      }

      const subRaw = await kv.get(`newsletter:subscriber:${subscriberHash}`);
      if (!subRaw) {
        return errorResponse("Subscriber not found.", 404, cors);
      }

      let subscriber;
      try {
        subscriber = JSON.parse(subRaw);
      } catch {
        return errorResponse("Subscriber data corrupted.", 500, cors);
      }

      // Load the pending draft (or a specific draft if draftId provided)
      let draft;
      if (body.draftId) {
        const draftRaw = await kv.get(`newsletter:draft:${body.draftId}`);
        if (!draftRaw) {
          return errorResponse("Draft not found.", 404, cors);
        }
        try {
          draft = JSON.parse(draftRaw);
        } catch {
          return errorResponse("Draft data corrupted.", 500, cors);
        }
      } else {
        draft = await findPendingDraft(kv);
        if (!draft) {
          return errorResponse(
            "No pending draft available. Create or select a draft first.",
            404,
            cors,
          );
        }
      }

      const secret = context.env.QBO_APPROVAL_SECRET;
      if (!secret) {
        return errorResponse("Approval secret not configured.", 500, cors);
      }

      const siteUrl = new URL(context.request.url).origin;

      // Build unsubscribe URL
      let unsubUrl;
      if (subscriber.unsubToken) {
        unsubUrl = `${siteUrl}/api/newsletter-unsubscribe?token=${encodeURIComponent(subscriber.unsubToken)}`;
      } else {
        const token = await createUnsubscribeToken(subscriber.email, secret);
        unsubUrl = `${siteUrl}/api/newsletter-unsubscribe?token=${encodeURIComponent(token)}`;
        subscriber.unsubToken = token;
        await kv.put(
          `newsletter:subscriber:${subscriberHash}`,
          JSON.stringify(subscriber),
        );
      }

      const escapedSubject = escapeHtml(draft.subject.trim());
      const emailHtml = buildNewsletterEmail(
        draft.bodyHtml,
        escapedSubject,
        escapeHtml(subscriber.email),
        unsubUrl,
      );

      try {
        const result = await sendViaACS(context.env, {
          from: FROM_ADDRESS,
          to: subscriber.email,
          replyTo: REPLY_TO,
          subject: draft.subject.trim(),
          html: emailHtml,
        });

        if (result.ok || result.status === 202) {
          return new Response(
            JSON.stringify({
              success: true,
              email: subscriber.email,
              draftSubject: draft.subject,
            }),
            { status: 200, headers },
          );
        } else {
          return errorResponse(`Send failed: HTTP ${result.status}`, 502, cors);
        }
      } catch (emailErr) {
        console.error("Send to subscriber error:", emailErr);
        return errorResponse(`Send failed: ${emailErr.message}`, 500, cors);
      }
    }

    return errorResponse(
      "Unknown action. Use remove-subscriber or send-to-subscriber.",
      400,
      cors,
    );
  } catch (err) {
    console.error("Newsletter subscribers POST error:", err);
    return errorResponse("Internal error.", 500, cors);
  }
}
