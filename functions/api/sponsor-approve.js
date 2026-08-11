// Cloudflare Pages Function — Sponsor Logo Approval/Rejection
//
// Mirrors the QBO approval pattern (Story 1248) for sponsor logo placements.
// Verifies a signed approval token, looks up the pending sponsor entry from
// KV, and either approves (logo goes public) or rejects the placement.
//
// Security invariants:
//   - ALL sponsor data is loaded from KV, NEVER from request params
//   - Tokens are HMAC-signed; tampering is detected
//   - Replay protection: a used or expired token is rejected
//   - Only the "token" query parameter is read; everything else is ignored
//   - Logo is served from R2 for admin preview on the approval page
//
// DEPENDENCIES (CF Pages secrets):
//   QBO_APPROVAL_SECRET — HMAC key for token verification (shared with QBO flow)
//
// DEPENDENCY (KV binding):
//   FAF_KV — pending sponsor entries + approved sponsors list
//
// DEPENDENCY (R2 binding):
//   MEDIA_BUCKET — sponsor logo storage

import { verifyApprovalToken } from "../lib/approval-tokens.js";

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
    console.error("Sponsor approval token verification failed:", result.reason);
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

  const entryRaw = await kv.get(`sponsor:pending:${entryId}`);
  if (!entryRaw) {
    return new Response(
      renderPage(
        "Entry Not Found",
        "This sponsor entry no longer exists or has already been processed.",
      ),
      { status: 404, headers },
    );
  }

  let entry;
  try {
    entry = JSON.parse(entryRaw);
  } catch {
    return new Response(
      renderPage("Data Error", "Could not parse the sponsor entry."),
      { status: 500, headers },
    );
  }

  // Replay protection: reject if already processed
  if (
    entry.status !== "pending-approval" &&
    entry.status !== "awaiting-payment"
  ) {
    const statusLabel =
      entry.status === "approved"
        ? `approved on ${entry.approvedAt || "unknown date"}`
        : `rejected on ${entry.rejectedAt || "unknown date"}`;
    return new Response(
      renderPage(
        "Already Processed",
        `This sponsor entry was already ${statusLabel}. No further action taken.`,
      ),
      { status: 409, headers },
    );
  }

  // Build logo preview URL for the approval page
  const siteUrl = new URL(context.request.url).origin;
  const logoPreviewUrl = `${siteUrl}/api/sponsor-logo?id=${encodeURIComponent(entryId)}`;

  if (action === "reject") {
    entry.status = "rejected";
    entry.rejectedAt = new Date().toISOString();
    await kv.put(`sponsor:pending:${entryId}`, JSON.stringify(entry));

    return new Response(
      renderPage(
        "Sponsor Rejected",
        `The logo placement for <strong>${escapeHtml(entry.sponsorOrg)}</strong> (${escapeHtml(entry.tier)} tier) has been rejected. Their logo will NOT appear on the website.`,
      ),
      { status: 200, headers },
    );
  }

  if (action === "approve") {
    // Mark as approved
    entry.status = "approved";
    entry.approvedAt = new Date().toISOString();
    await kv.put(`sponsor:pending:${entryId}`, JSON.stringify(entry));

    // Add to the approved sponsors list for the public page
    await addToApprovedList(kv, entry);

    const tierLabel = entry.tier.charAt(0).toUpperCase() + entry.tier.slice(1);

    return new Response(renderApprovalPage(entry, tierLabel, logoPreviewUrl), {
      status: 200,
      headers,
    });
  }

  return new Response(renderPage("Invalid Action", "Unrecognized action."), {
    status: 400,
    headers,
  });
}

export async function onRequestPost() {
  return new Response("Method not allowed", { status: 405 });
}

// Maintain a dedicated KV key with the list of approved sponsors.
// This avoids N+1 reads when the public page loads.
async function addToApprovedList(kv, entry) {
  const listRaw = await kv.get("sponsors:approved");
  let list = [];
  if (listRaw) {
    try {
      list = JSON.parse(listRaw);
    } catch {
      list = [];
    }
  }

  // Avoid duplicates
  if (list.some((s) => s.id === entry.id)) {
    return;
  }

  list.push({
    id: entry.id,
    sponsorName: entry.sponsorName,
    sponsorOrg: entry.sponsorOrg,
    tier: entry.tier,
    logoR2Key: entry.logoR2Key,
    approvedAt: entry.approvedAt,
  });

  // No TTL — approved sponsors persist until manually removed
  await kv.put("sponsors:approved", JSON.stringify(list));
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderApprovalPage(entry, tierLabel, logoPreviewUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sponsor Approved — FAF</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 600px; margin: 40px auto; padding: 0 20px; color: #333; }
    h2 { color: #c8923c; }
    .box { border: 1px solid #ddd; border-radius: 8px; padding: 24px; margin-top: 20px; }
    .logo-preview { max-width: 200px; max-height: 120px; margin: 16px 0; border: 1px solid #eee; border-radius: 4px; }
    .detail { margin: 8px 0; }
    .label { font-weight: bold; color: #555; }
  </style>
</head>
<body>
  <h2>Fathers and Football</h2>
  <div class="box">
    <h3>Sponsor Approved</h3>
    <p>The logo placement for <strong>${escapeHtml(entry.sponsorOrg)}</strong> has been approved and is now live on the sponsors page.</p>
    <div class="detail"><span class="label">Sponsor:</span> ${escapeHtml(entry.sponsorName)}</div>
    <div class="detail"><span class="label">Organization:</span> ${escapeHtml(entry.sponsorOrg)}</div>
    <div class="detail"><span class="label">Tier:</span> ${escapeHtml(tierLabel)}</div>
    <div class="detail"><span class="label">Email:</span> ${escapeHtml(entry.sponsorEmail)}</div>
    <div class="detail"><span class="label">Agreement:</span> v${escapeHtml(entry.agreementVersion)} accepted ${escapeHtml(entry.agreementAcceptedAt)}</div>
    <p style="margin-top:16px;"><strong>Logo Preview:</strong></p>
    <img src="${escapeHtml(logoPreviewUrl)}" alt="Sponsor logo" class="logo-preview" />
  </div>
</body>
</html>`;
}

function renderPage(title, message) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} — FAF Sponsors</title>
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
