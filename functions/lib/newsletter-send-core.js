// Shared newsletter-send logic.
// Extracted so both the admin UI (newsletter-send.js) and the automated
// approval flow (newsletter-draft-approve.js) use the same send path.
//
// This function loads the subscriber list from KV, builds personalized
// unsubscribe links, and sends each email individually via ACS.

import { sendViaACS } from "./acs-email.js";
import { createUnsubscribeToken } from "./approval-tokens.js";

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

// Send a newsletter to all active subscribers.
// subject: plain text subject line
// bodyHtml: already-rendered HTML body content (between the header and footer)
// siteUrl: origin URL for building unsubscribe links
// env: Cloudflare env with FAF_KV, QBO_APPROVAL_SECRET, ACS_CONNECTION_STRING
//
// Returns { sent, failed, errors }
export async function sendNewsletterToAll({ subject, bodyHtml, siteUrl, env }) {
  const kv = env.FAF_KV;
  const secret = env.QBO_APPROVAL_SECRET;

  if (!kv) throw new Error("FAF_KV not configured");
  if (!secret) throw new Error("QBO_APPROVAL_SECRET not configured");

  const indexRaw = await kv.get("newsletter:subscribers-index");
  if (!indexRaw) return { sent: 0, failed: 0, errors: [] };

  let index;
  try {
    index = JSON.parse(indexRaw);
  } catch {
    throw new Error("Subscriber index is corrupted");
  }

  if (!Array.isArray(index) || index.length === 0) {
    return { sent: 0, failed: 0, errors: [] };
  }

  const escapedSubject = escapeHtml(subject.trim());

  let sent = 0;
  let failedCount = 0;
  const errors = [];

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

    let unsubUrl;
    if (subscriber.unsubToken) {
      unsubUrl = `${siteUrl}/api/newsletter-unsubscribe?token=${encodeURIComponent(subscriber.unsubToken)}`;
    } else {
      const token = await createUnsubscribeToken(subscriber.email, secret);
      unsubUrl = `${siteUrl}/api/newsletter-unsubscribe?token=${encodeURIComponent(token)}`;
      subscriber.unsubToken = token;
      await kv.put(`newsletter:subscriber:${hash}`, JSON.stringify(subscriber));
    }

    const emailHtml = buildNewsletterEmail(
      bodyHtml,
      escapedSubject,
      escapeHtml(subscriber.email),
      unsubUrl,
    );

    try {
      const result = await sendViaACS(env, {
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

  return { sent, failed: failedCount, errors };
}

export { FROM_ADDRESS, REPLY_TO, escapeHtml, buildNewsletterEmail };
