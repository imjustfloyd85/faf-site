// Cloudflare Pages Function -- Newsletter Draft Approval
//
// GET endpoint. Receives a signed approval token via query string.
// On valid "approve" token: loads the pending draft from KV, sends it
// to all active subscribers via the shared send-core, marks draft as sent.
// On valid "reject" token: marks draft as rejected, no send.
//
// Follows the same security pattern as sponsor-approve.js:
//   - All draft data loaded from KV, never from request params
//   - HMAC-signed tokens with expiry and constant-time comparison
//   - Replay protection: already-processed drafts are rejected
//
// DEPENDENCIES:
//   QBO_APPROVAL_SECRET -- HMAC key (shared with sponsor-approve, unsubscribe)
//   FAF_KV             -- draft storage + subscriber list
//   ACS_CONNECTION_STRING -- email transport

import { verifyApprovalToken } from "../lib/approval-tokens.js";
import {
  sendNewsletterToAll,
  escapeHtml,
} from "../lib/newsletter-send-core.js";

export async function onRequestGet(context) {
  const headers = { "Content-Type": "text/html; charset=utf-8" };

  const secret = context.env.QBO_APPROVAL_SECRET;
  if (!secret) {
    return new Response(
      renderPage("Configuration Error", "Approval system not configured."),
      { status: 500, headers },
    );
  }

  const url = new URL(context.request.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return new Response(
      renderPage("Invalid Request", "No approval token provided."),
      { status: 400, headers },
    );
  }

  const result = await verifyApprovalToken(token, secret);
  if (!result.valid) {
    console.error("Newsletter draft token verification failed:", result.reason);
    return new Response(
      renderPage(
        "Invalid or Expired Link",
        `This approval link is not valid. Reason: ${escapeHtml(result.reason)}. Check your email for the most recent draft.`,
      ),
      { status: 403, headers },
    );
  }

  const { entryId, action } = result;

  const kv = context.env.FAF_KV;
  if (!kv) {
    return new Response(
      renderPage("Configuration Error", "Storage not available."),
      { status: 500, headers },
    );
  }

  const draftRaw = await kv.get(`newsletter:draft:${entryId}`);
  if (!draftRaw) {
    return new Response(
      renderPage(
        "Draft Not Found",
        "This newsletter draft no longer exists or has already been processed.",
      ),
      { status: 404, headers },
    );
  }

  let draft;
  try {
    draft = JSON.parse(draftRaw);
  } catch {
    return new Response(
      renderPage("Data Error", "Could not parse the draft."),
      { status: 500, headers },
    );
  }

  // Replay protection
  if (draft.status !== "pending-approval") {
    const statusLabel =
      draft.status === "sent"
        ? `sent on ${draft.sentAt || "unknown date"}`
        : `rejected on ${draft.rejectedAt || "unknown date"}`;
    return new Response(
      renderPage(
        "Already Processed",
        `This newsletter draft was already ${statusLabel}. No further action taken.`,
      ),
      { status: 409, headers },
    );
  }

  if (action === "reject") {
    draft.status = "rejected";
    draft.rejectedAt = new Date().toISOString();
    await kv.put(`newsletter:draft:${entryId}`, JSON.stringify(draft));

    return new Response(
      renderPage(
        "Draft Rejected",
        "The newsletter draft has been discarded. No emails were sent. You can still send a manual newsletter from newsletter-admin.html if needed.",
      ),
      { status: 200, headers },
    );
  }

  if (action === "approve") {
    const siteUrl = new URL(context.request.url).origin;

    try {
      const sendResult = await sendNewsletterToAll({
        subject: draft.subject,
        bodyHtml: draft.bodyHtml,
        siteUrl,
        env: context.env,
      });

      draft.status = "sent";
      draft.sentAt = new Date().toISOString();
      draft.sendResult = {
        sent: sendResult.sent,
        failed: sendResult.failed,
      };
      await kv.put(`newsletter:draft:${entryId}`, JSON.stringify(draft));

      const failNote =
        sendResult.failed > 0
          ? `<p>${sendResult.failed} email(s) failed to deliver.</p>`
          : "";

      return new Response(
        renderPage(
          "Newsletter Sent",
          `<p>The newsletter "<strong>${escapeHtml(draft.subject)}</strong>" has been sent to ${sendResult.sent} subscriber(s).</p>${failNote}`,
        ),
        { status: 200, headers },
      );
    } catch (sendErr) {
      console.error("Newsletter send failed after approval:", sendErr);

      // Don't mark as sent if the send actually failed
      draft.status = "send-failed";
      draft.failedAt = new Date().toISOString();
      draft.failReason = sendErr.message;
      await kv.put(`newsletter:draft:${entryId}`, JSON.stringify(draft));

      return new Response(
        renderPage(
          "Send Failed",
          `The newsletter was approved but the send failed: ${escapeHtml(sendErr.message)}. You can retry by sending manually from newsletter-admin.html.`,
        ),
        { status: 500, headers },
      );
    }
  }

  return new Response(renderPage("Invalid Action", "Unrecognized action."), {
    status: 400,
    headers,
  });
}

export async function onRequestPost() {
  return new Response("Method not allowed", { status: 405 });
}

function renderPage(title, message) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>${escapeHtml(title)} -- FAF Newsletter</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 600px; margin: 40px auto; padding: 0 20px; color: #333; }
    h2 { color: #c8923c; }
    .box { border: 1px solid #ddd; border-radius: 8px; padding: 24px; margin-top: 20px; }
  </style>
</head>
<body>
  <h2>Fathers and Football</h2>
  <div class="box">
    <h3>${escapeHtml(title)}</h3>
    ${message}
  </div>
</body>
</html>`;
}
