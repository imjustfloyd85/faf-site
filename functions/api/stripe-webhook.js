// Cloudflare Pages Function — Stripe Webhook Handler
// Verifies Stripe signature, sends acknowledgment emails via ACS,
// and queues pending QBO entries for human approval (Story 1248).
//
// DEPENDENCY: STRIPE_WEBHOOK_SECRET must be set as a CF Pages secret.
// Floyd will create the webhook endpoint in Stripe after deployment,
// then set this secret. Until then, this handler will reject all requests.
//
// DEPENDENCY: ACS_CONNECTION_STRING must be set as a CF Pages secret
// for email sending to work.
//
// DEPENDENCY (KV binding, Story 1248):
//   FAF_KV — stores pending QBO entries
//   QBO_APPROVAL_SECRET — HMAC key for signing approval tokens

import { createApprovalToken } from "../lib/approval-tokens.js";

// --- ACS Email (same pattern as faf-chat/worker.js) ---

function acsEndpointFromConnStr(connStr) {
  const match = connStr.match(/endpoint=(https:\/\/[^;]+)/i);
  return match ? match[1].replace(/\/$/, "") : null;
}

function acsKeyFromConnStr(connStr) {
  const match = connStr.match(/accesskey=([^;]+)/i);
  return match ? match[1] : null;
}

async function sendViaACS(env, { from, to, replyTo, subject, html }) {
  const connStr = env.ACS_CONNECTION_STRING;
  if (!connStr) {
    console.error("ACS_CONNECTION_STRING not configured");
    return { ok: false, status: 500 };
  }

  const endpoint = acsEndpointFromConnStr(connStr);
  const accessKey = acsKeyFromConnStr(connStr);

  if (!endpoint || !accessKey) {
    console.error("Invalid ACS_CONNECTION_STRING format");
    return { ok: false, status: 500 };
  }

  const toList = Array.isArray(to) ? to : [to];
  const body = JSON.stringify({
    senderAddress: from,
    recipients: { to: toList.map((address) => ({ address })) },
    replyTo: replyTo ? [{ address: replyTo }] : undefined,
    content: { subject, html },
  });

  const date = new Date().toUTCString();
  const contentHashB64 = btoa(
    String.fromCharCode(
      ...new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)),
      ),
    ),
  );

  const url = new URL(`${endpoint}/emails:send?api-version=2023-03-31`);
  const stringToSign = `POST\n${url.pathname}${url.search}\n${date};${url.host};${contentHashB64}`;

  const keyBytes = Uint8Array.from(atob(accessKey), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBytes = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(stringToSign),
  );
  const signature = btoa(String.fromCharCode(...new Uint8Array(sigBytes)));

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Date: date,
      "x-ms-date": date,
      "x-ms-content-sha256": contentHashB64,
      Authorization: `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${signature}`,
    },
    body,
  });

  return res;
}

// --- Stripe Webhook Signature Verification ---

async function verifyStripeSignature(payload, sigHeader, secret) {
  if (!sigHeader || !secret) return false;

  const parts = {};
  sigHeader.split(",").forEach((item) => {
    const [key, value] = item.split("=");
    if (key && value) parts[key.trim()] = value.trim();
  });

  const timestamp = parts.t;
  const expectedSig = parts.v1;
  if (!timestamp || !expectedSig) return false;

  // Reject if timestamp is older than 5 minutes (replay protection)
  const age = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
  if (isNaN(age) || age > 300 || age < -60) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const keyBytes = new TextEncoder().encode(secret);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBytes = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(signedPayload),
  );
  const computed = [...new Uint8Array(sigBytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Constant-time comparison
  if (computed.length !== expectedSig.length) return false;
  let mismatch = 0;
  for (let i = 0; i < computed.length; i++) {
    mismatch |= computed.charCodeAt(i) ^ expectedSig.charCodeAt(i);
  }
  return mismatch === 0;
}

// --- Email Templates ---

// User-controllable values (donor name, tier, email) must never be
// interpolated into HTML emails unescaped -- a submitted name like
// "<script>..." or "<img onerror=...>" would otherwise land unescaped
// in both the org notification and the donor's own receipt email.
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildDonationEmail(session) {
  const amount = (session.amount_total / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
  const rawDonorName =
    session.metadata?.donor_name ||
    session.customer_details?.name ||
    "Supporter";
  const rawDonorEmail =
    session.customer_details?.email || session.customer_email || "";
  // Escaped for HTML interpolation below. Subject lines use the raw
  // (but newline-stripped) value since they are not HTML-rendered.
  const donorName = escapeHtml(rawDonorName);
  const donorEmail = escapeHtml(rawDonorEmail);
  const subjectSafeName = String(rawDonorName).replace(/[\r\n]/g, " ");
  const date = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const isRecurring = session.metadata?.recurring === "monthly";

  return {
    toOrg: {
      subject: `Donation Received: ${amount} from ${subjectSafeName}`,
      html: `
        <h2>Fathers and Football -- New Donation</h2>
        <p><strong>Donor:</strong> ${donorName}</p>
        <p><strong>Email:</strong> ${donorEmail}</p>
        <p><strong>Amount:</strong> ${amount}${isRecurring ? " (monthly recurring)" : " (one-time)"}</p>
        <p><strong>Date:</strong> ${date}</p>
        <p><strong>Stripe Session:</strong> ${session.id}</p>
      `,
    },
    toDonor: {
      subject: "Thank you for your donation -- Fathers and Football",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #c8923c;">Fathers and Football</h2>
          <p>Dear ${donorName},</p>
          <p>Thank you for your generous ${isRecurring ? "monthly " : ""}donation of ${amount} to Fathers and Football.</p>
          <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0;" />
          <h3>Tax Receipt / Acknowledgment</h3>
          <p>This letter serves as your official written acknowledgment for tax purposes.</p>
          <p><strong>Organization:</strong> Fathers and Football<br/>
          <strong>EIN:</strong> 42-1980182<br/>
          <strong>Status:</strong> 501(c)(3) tax-exempt organization<br/>
          <strong>Date of contribution:</strong> ${date}<br/>
          <strong>Amount:</strong> ${amount}</p>
          <p><strong>No goods or services were provided in exchange for this contribution.</strong> The full amount of your donation is tax-deductible to the extent allowed by law.</p>
          <p>Please retain this acknowledgment for your tax records. Consult your tax advisor for guidance specific to your situation.</p>
          <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0;" />
          <p>Your support directly funds programs that connect fathers to their children through football. Thank you for investing in families.</p>
          <p>With gratitude,<br/>Fathers and Football<br/>
          <a href="https://fathersandfootball.org">fathersandfootball.org</a></p>
        </div>
      `,
    },
  };
}

function buildSponsorshipEmail(session) {
  const amount = (session.amount_total / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
  const rawSponsorName =
    session.metadata?.donor_name || session.customer_details?.name || "Sponsor";
  const rawSponsorEmail =
    session.customer_details?.email || session.customer_email || "";
  const sponsorName = escapeHtml(rawSponsorName);
  const sponsorEmail = escapeHtml(rawSponsorEmail);
  const subjectSafeName = String(rawSponsorName).replace(/[\r\n]/g, " ");
  // tier is server-set metadata from our own create-checkout-session.js
  // (only ever "sideline"/"playmaker"/"legacy"), not user-controllable,
  // but escape anyway since it's still interpolated into HTML below.
  const tier = session.metadata?.tier || "unknown";
  const tierLabel = escapeHtml(tier.charAt(0).toUpperCase() + tier.slice(1));
  const date = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return {
    toOrg: {
      subject: `Sponsorship Received: ${tierLabel} (${amount}) from ${subjectSafeName}`,
      html: `
        <h2>Fathers and Football -- New Sponsorship</h2>
        <p><strong>Sponsor:</strong> ${sponsorName}</p>
        <p><strong>Email:</strong> ${sponsorEmail}</p>
        <p><strong>Tier:</strong> ${tierLabel}</p>
        <p><strong>Amount:</strong> ${amount}</p>
        <p><strong>Date:</strong> ${date}</p>
        <p><strong>Stripe Session:</strong> ${session.id}</p>
      `,
    },
    toDonor: {
      subject: `Thank you for your ${tierLabel} sponsorship -- Fathers and Football`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #c8923c;">Fathers and Football</h2>
          <p>Dear ${sponsorName},</p>
          <p>Thank you for your ${tierLabel} sponsorship of ${amount} to Fathers and Football. Your partnership directly supports programs that connect fathers to their children through the game.</p>
          <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0;" />
          <h3>Sponsorship Acknowledgment &amp; Disclosure</h3>
          <p>This letter serves as your official written acknowledgment for tax purposes.</p>
          <p><strong>Organization:</strong> Fathers and Football<br/>
          <strong>EIN:</strong> 42-1980182<br/>
          <strong>Status:</strong> 501(c)(3) tax-exempt organization<br/>
          <strong>Date of contribution:</strong> ${date}<br/>
          <strong>Amount:</strong> ${amount}<br/>
          <strong>Sponsorship tier:</strong> ${tierLabel}</p>
          <p><strong>Quid Pro Quo Disclosure (IRC Section 6115):</strong> Because each sponsorship tier includes tangible benefits (such as logo placement, event invitations, or co-branded programming), only the portion of your contribution that exceeds the fair market value of the benefits you receive may be tax-deductible. In accordance with IRC Section 6115, Fathers and Football will provide a good-faith estimate of the fair market value of the benefits associated with your selected tier under separate cover if applicable. Please consult your tax advisor for guidance specific to your situation.</p>
          <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0;" />
          <p>We will be in touch within 2 business days to discuss the details of your ${tierLabel} sponsorship benefits. Welcome to the team.</p>
          <p>With gratitude,<br/>Fathers and Football<br/>
          <a href="https://fathersandfootball.org">fathersandfootball.org</a></p>
        </div>
      `,
    },
  };
}

// --- QBO Pending Entry Queue (Story 1248) ---

async function createPendingQboEntry(context, session, paymentType) {
  const kv = context.env.FAF_KV;
  const approvalSecret = context.env.QBO_APPROVAL_SECRET;

  if (!kv || !approvalSecret) {
    console.error(
      "QBO pending entry skipped: FAF_KV or QBO_APPROVAL_SECRET not configured",
    );
    return;
  }

  const donorName =
    session.metadata?.donor_name || session.customer_details?.name || "Unknown";
  const donorEmail =
    session.customer_details?.email || session.customer_email || "";
  const amountCents = session.amount_total || 0;
  const type = paymentType === "sponsorship" ? "sponsorship" : "donation";

  // Suggest 990 category: donations = Program, sponsorships = Fundraising
  const category990 = type === "sponsorship" ? "Fundraising" : "Program";

  const entryId = crypto.randomUUID();
  const entry = {
    id: entryId,
    donorName,
    donorEmail,
    amountCents,
    type,
    tier: session.metadata?.tier || null,
    category990,
    date: new Date().toISOString().split("T")[0],
    stripeSessionId: session.id,
    status: "pending",
    createdAt: new Date().toISOString(),
    processedAt: null,
  };

  // Store pending entry in KV (TTL 30 days — matches approval token window)
  await kv.put(`qbo:pending:${entryId}`, JSON.stringify(entry), {
    expirationTtl: 30 * 24 * 60 * 60,
  });

  // Create signed approval tokens (one for approve, one for reject)
  const approveToken = await createApprovalToken(
    entryId,
    "approve",
    approvalSecret,
  );
  const rejectToken = await createApprovalToken(
    entryId,
    "reject",
    approvalSecret,
  );

  const siteUrl = "https://fathersandfootball.org";
  const approveUrl = `${siteUrl}/api/quickbooks-approve?token=${encodeURIComponent(approveToken)}`;
  const rejectUrl = `${siteUrl}/api/quickbooks-approve?token=${encodeURIComponent(rejectToken)}`;

  const amountStr = (amountCents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });

  const tierLabel = entry.tier
    ? ` (${entry.tier.charAt(0).toUpperCase() + entry.tier.slice(1)} tier)`
    : "";

  const approvalHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #c8923c;">QuickBooks Approval Required</h2>
      <p>A new ${type}${tierLabel} needs your review before posting to QuickBooks.</p>
      <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
        <tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Donor/Sponsor</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(donorName)}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Email</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(donorEmail)}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Amount</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${amountStr}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Type</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${type}${tierLabel}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">990 Category</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${category990}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Date</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${entry.date}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Stripe Session</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${session.id}</td></tr>
      </table>
      <p style="margin: 24px 0;">
        <a href="${approveUrl}" style="display: inline-block; padding: 12px 24px; background: #28a745; color: #fff; text-decoration: none; border-radius: 4px; margin-right: 12px;">Approve &amp; Post to QuickBooks</a>
        <a href="${rejectUrl}" style="display: inline-block; padding: 12px 24px; background: #dc3545; color: #fff; text-decoration: none; border-radius: 4px;">Reject</a>
      </p>
      <p style="font-size: 12px; color: #666;">This link expires in 7 days. All financial data is verified server-side — the link cannot be tampered with.</p>
    </div>
  `;

  // Send approval email to both justin@ and communications@
  const approvalResult = await sendViaACS(context.env, {
    from: "Fathers and Football <communications@fathersandfootball.org>",
    to: [
      "justin@fathersandfootball.org",
      "communications@fathersandfootball.org",
    ],
    subject: `[QBO Approval] ${type}: ${amountStr} from ${donorName}`,
    html: approvalHtml,
  });

  if (!approvalResult.ok) {
    console.error("Failed to send QBO approval email:", approvalResult.status);
  }

  console.log(`QBO pending entry created: ${entryId} (${type}, ${amountStr})`);
}

// --- Sponsor Logo Approval Queue ---

async function updateSponsorEntryAndNotify(context, session) {
  const kv = context.env.FAF_KV;
  const approvalSecret = context.env.QBO_APPROVAL_SECRET;

  if (!kv || !approvalSecret) {
    console.error(
      "Sponsor entry update skipped: FAF_KV or QBO_APPROVAL_SECRET not configured",
    );
    return;
  }

  const sponsorEntryId = session.metadata.sponsor_entry_id;
  const entryRaw = await kv.get(`sponsor:pending:${sponsorEntryId}`);
  if (!entryRaw) {
    console.error(`Sponsor entry not found: ${sponsorEntryId}`);
    return;
  }

  let entry;
  try {
    entry = JSON.parse(entryRaw);
  } catch {
    console.error(`Sponsor entry parse error: ${sponsorEntryId}`);
    return;
  }

  // Update entry with payment info and advance status
  entry.status = "pending-approval";
  entry.stripeSessionId = session.id;
  entry.amountCents = session.amount_total || 0;
  entry.paidAt = new Date().toISOString();

  await kv.put(`sponsor:pending:${sponsorEntryId}`, JSON.stringify(entry), {
    expirationTtl: 30 * 24 * 60 * 60,
  });

  // Create signed approval tokens
  const approveToken = await createApprovalToken(
    sponsorEntryId,
    "approve",
    approvalSecret,
  );
  const rejectToken = await createApprovalToken(
    sponsorEntryId,
    "reject",
    approvalSecret,
  );

  const siteUrl = "https://fathersandfootball.org";
  const approveUrl = `${siteUrl}/api/sponsor-approve?token=${encodeURIComponent(approveToken)}`;
  const rejectUrl = `${siteUrl}/api/sponsor-approve?token=${encodeURIComponent(rejectToken)}`;
  const logoPreviewUrl = `${siteUrl}/api/sponsor-logo?id=${encodeURIComponent(sponsorEntryId)}`;

  const amountStr = (entry.amountCents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });

  const tierLabel = entry.tier.charAt(0).toUpperCase() + entry.tier.slice(1);

  const approvalHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #c8923c;">Sponsor Logo Approval Required</h2>
      <p>A new <strong>${escapeHtml(tierLabel)}</strong> sponsor has paid and submitted a logo for placement on the website. Review the logo and approve or reject.</p>
      <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
        <tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Sponsor</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(entry.sponsorName)}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Organization</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(entry.sponsorOrg)}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Email</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(entry.sponsorEmail)}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Tier</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(tierLabel)}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Amount</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${amountStr}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Agreement</td>
            <td style="padding: 8px; border: 1px solid #ddd;">v${escapeHtml(entry.agreementVersion)} accepted ${escapeHtml(entry.agreementAcceptedAt)}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Stripe Session</td>
            <td style="padding: 8px; border: 1px solid #ddd;">${session.id}</td></tr>
      </table>
      <p style="margin: 16px 0;"><strong>Logo Preview:</strong></p>
      <p><a href="${logoPreviewUrl}" style="color: #c8923c;">View submitted logo</a></p>
      <p style="margin: 24px 0;">
        <a href="${approveUrl}" style="display: inline-block; padding: 12px 24px; background: #28a745; color: #fff; text-decoration: none; border-radius: 4px; margin-right: 12px;">Approve Logo Placement</a>
        <a href="${rejectUrl}" style="display: inline-block; padding: 12px 24px; background: #dc3545; color: #fff; text-decoration: none; border-radius: 4px;">Reject</a>
      </p>
      <p style="font-size: 12px; color: #666;">This link expires in 7 days. The sponsor accepted the logo placement agreement (rep/warranty on IP ownership + indemnification). Their logo will NOT appear on the site until you click Approve.</p>
    </div>
  `;

  const approvalResult = await sendViaACS(context.env, {
    from: "Fathers and Football <communications@fathersandfootball.org>",
    to: [
      "justin@fathersandfootball.org",
      "communications@fathersandfootball.org",
    ],
    subject: `[Sponsor Approval] ${escapeHtml(tierLabel)} logo: ${escapeHtml(entry.sponsorOrg)}`,
    html: approvalHtml,
  });

  if (!approvalResult.ok) {
    console.error(
      "Failed to send sponsor approval email:",
      approvalResult.status,
    );
  }

  console.log(
    `Sponsor entry updated to pending-approval: ${sponsorEntryId} (${entry.sponsorOrg}, ${tierLabel})`,
  );
}

// --- Main Handler ---

export async function onRequestPost(context) {
  const headers = { "Content-Type": "application/json" };

  try {
    const webhookSecret = context.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error("STRIPE_WEBHOOK_SECRET not configured — rejecting webhook");
      return new Response(
        JSON.stringify({ error: "Webhook not configured." }),
        { status: 500, headers },
      );
    }

    const rawBody = await context.request.text();
    const sigHeader = context.request.headers.get("Stripe-Signature");

    const valid = await verifyStripeSignature(
      rawBody,
      sigHeader,
      webhookSecret,
    );
    if (!valid) {
      console.error("Webhook signature verification failed");
      return new Response(JSON.stringify({ error: "Invalid signature." }), {
        status: 401,
        headers,
      });
    }

    const event = JSON.parse(rawBody);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const paymentType = session.metadata?.type;

      let emails;
      if (paymentType === "sponsorship") {
        emails = buildSponsorshipEmail(session);
      } else {
        emails = buildDonationEmail(session);
      }

      // Send notification to FAF org
      const orgResult = await sendViaACS(context.env, {
        from: "Fathers and Football <communications@fathersandfootball.org>",
        to: [
          "justin@fathersandfootball.org",
          "communications@fathersandfootball.org",
        ],
        subject: emails.toOrg.subject,
        html: emails.toOrg.html,
      });

      if (!orgResult.ok) {
        console.error("Failed to send org notification:", orgResult.status);
      }

      // Send receipt/acknowledgment to donor/sponsor
      const donorEmail =
        session.customer_details?.email || session.customer_email;
      if (donorEmail) {
        const donorResult = await sendViaACS(context.env, {
          from: "Fathers and Football <communications@fathersandfootball.org>",
          to: donorEmail,
          subject: emails.toDonor.subject,
          html: emails.toDonor.html,
        });

        if (!donorResult.ok) {
          console.error("Failed to send donor receipt:", donorResult.status);
        }
      }

      // --- QBO Pending Entry Queue (Story 1248) ---
      // Write a pending entry to KV and send an approval email.
      // The entry is NOT posted to QuickBooks until a human clicks Approve.
      await createPendingQboEntry(context, session, paymentType);

      // --- Sponsor Logo Approval Queue ---
      // If this sponsorship has a linked sponsor entry (logo upload + agreement),
      // update the entry status and send an admin approval email for the logo
      // placement. The logo stays hidden on the public site until approved.
      if (paymentType === "sponsorship" && session.metadata?.sponsor_entry_id) {
        await updateSponsorEntryAndNotify(context, session);
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers,
    });
  } catch (err) {
    console.error("Webhook error:", err);
    return new Response(
      JSON.stringify({ error: "Webhook processing failed." }),
      { status: 500, headers },
    );
  }
}

// Reject non-POST methods
export async function onRequestGet() {
  return new Response("Method not allowed", { status: 405 });
}
