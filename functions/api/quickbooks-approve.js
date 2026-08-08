// Cloudflare Pages Function — QuickBooks Pending Entry Approval/Rejection
//
// Verifies a signed approval token, looks up the pending entry from KV,
// and either posts a Sales Receipt to QBO (approve) or discards the
// entry (reject).
//
// Security invariants:
//   - ALL financial data is loaded from KV, NEVER from request params
//   - Tokens are HMAC-signed; tampering is detected
//   - Replay protection: a used or expired token is rejected
//   - Only the "token" query parameter is read; everything else is ignored
//
// DEPENDENCIES (CF Pages secrets):
//   QBO_APPROVAL_SECRET — HMAC key for token verification
//   QBO_CLIENT_ID, QBO_CLIENT_SECRET — for QBO API calls on approval
//
// DEPENDENCY (KV binding):
//   FAF_KV — pending entries + QBO tokens

import { verifyApprovalToken } from "../lib/approval-tokens.js";
import { createSalesReceipt } from "../lib/qbo-client.js";

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

  // Verify the signed token
  const result = await verifyApprovalToken(token, secret);
  if (!result.valid) {
    console.error("Approval token verification failed:", result.reason);
    return new Response(
      renderPage(
        "Invalid or Expired Link",
        `This approval link is not valid. Reason: ${escapeHtml(result.reason)}. Please check your email for the most recent approval request.`,
      ),
      { status: 403, headers },
    );
  }

  const { entryId, action } = result;

  // Load pending entry from KV
  const kv = context.env.FAF_KV;
  if (!kv) {
    return new Response(
      renderPage("Configuration Error", "Storage not available."),
      { status: 500, headers },
    );
  }

  const entryRaw = await kv.get(`qbo:pending:${entryId}`);
  if (!entryRaw) {
    return new Response(
      renderPage(
        "Entry Not Found",
        "This pending entry no longer exists or has already been processed.",
      ),
      { status: 404, headers },
    );
  }

  let entry;
  try {
    entry = JSON.parse(entryRaw);
  } catch {
    return new Response(
      renderPage("Data Error", "Could not parse the pending entry."),
      { status: 500, headers },
    );
  }

  // Replay protection: reject if already processed
  if (entry.status !== "pending") {
    return new Response(
      renderPage(
        "Already Processed",
        `This entry was already ${entry.status} on ${entry.processedAt || "unknown date"}. No further action taken.`,
      ),
      { status: 409, headers },
    );
  }

  if (action === "reject") {
    // Mark as rejected, no QBO call
    entry.status = "rejected";
    entry.processedAt = new Date().toISOString();
    await kv.put(`qbo:pending:${entryId}`, JSON.stringify(entry));

    return new Response(
      renderPage(
        "Entry Rejected",
        `The ${entry.type} of $${(entry.amountCents / 100).toFixed(2)} from ${escapeHtml(entry.donorName)} has been rejected and will NOT be posted to QuickBooks.`,
      ),
      { status: 200, headers },
    );
  }

  if (action === "approve") {
    // Post to QuickBooks
    try {
      const qboResult = await createSalesReceipt(kv, context.env, entry);

      entry.status = "approved";
      entry.processedAt = new Date().toISOString();
      entry.qboReceiptId =
        qboResult?.SalesReceipt?.Id || qboResult?.Id || "unknown";
      await kv.put(`qbo:pending:${entryId}`, JSON.stringify(entry));

      return new Response(
        renderPage(
          "Entry Approved",
          `The ${entry.type} of $${(entry.amountCents / 100).toFixed(2)} from ${escapeHtml(entry.donorName)} has been posted to QuickBooks Online as Sales Receipt #${escapeHtml(String(entry.qboReceiptId))}.`,
        ),
        { status: 200, headers },
      );
    } catch (err) {
      console.error("QBO Sales Receipt creation failed:", err);
      // Do NOT mark as approved if QBO call failed — entry stays pending
      // so the link can be retried after fixing the issue
      return new Response(
        renderPage(
          "QuickBooks Error",
          `Approved, but the QuickBooks API call failed: ${escapeHtml(err.message)}. The entry remains pending — fix the issue and click the approve link again, or reject it.`,
        ),
        { status: 502, headers },
      );
    }
  }

  // Should never reach here due to token verification, but defend anyway
  return new Response(renderPage("Invalid Action", "Unrecognized action."), {
    status: 400,
    headers,
  });
}

export async function onRequestPost() {
  return new Response("Method not allowed", { status: 405 });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderPage(title, message) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} — FAF QuickBooks</title>
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
    <p>${message}</p>
  </div>
</body>
</html>`;
}
