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

function formatDateline() {
  const d = new Date();
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function buildNewsletterEmail(
  bodyHtml,
  escapedSubject,
  escapedEmail,
  unsubUrl,
) {
  const dateline = formatDateline();
  return `
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f5f0e8; margin: 0; padding: 0;">
  <tr>
    <td align="center" style="padding: 24px 12px;">
      <table width="600" cellpadding="0" cellspacing="0" border="0" style="background-color: #ffffff; border: 1px solid #d6cdb8; max-width: 600px;">
        <!-- Masthead -->
        <tr>
          <td style="padding: 28px 32px 0 32px; text-align: center;">
            <h1 style="font-family: Georgia, 'Times New Roman', Times, serif; font-size: 30px; font-weight: 700; color: #c8923c; margin: 0; padding: 0; letter-spacing: 3px; text-transform: uppercase;">Fathers and Football</h1>
          </td>
        </tr>
        <!-- Double rule: thin, then thick -->
        <tr>
          <td style="padding: 10px 32px 0 32px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td style="border-top: 1px solid #1b2a4a; font-size: 0; line-height: 0; height: 1px;">&nbsp;</td></tr>
              <tr><td style="height: 3px; font-size: 0; line-height: 0;">&nbsp;</td></tr>
              <tr><td style="border-top: 3px solid #1b2a4a; font-size: 0; line-height: 0; height: 1px;">&nbsp;</td></tr>
            </table>
          </td>
        </tr>
        <!-- Dateline -->
        <tr>
          <td style="padding: 8px 32px 16px 32px; text-align: center;">
            <span style="font-family: Georgia, 'Times New Roman', Times, serif; font-size: 12px; color: #8a7e6b; font-style: italic;">${dateline}</span>
          </td>
        </tr>
        <!-- Subject / Edition Headline -->
        <tr>
          <td style="padding: 0 32px 8px 32px; text-align: center;">
            <h2 style="font-family: Georgia, 'Times New Roman', Times, serif; font-size: 22px; font-weight: 700; color: #1b2a4a; margin: 0; padding: 0;">${escapedSubject}</h2>
          </td>
        </tr>
        <!-- Thin accent rule below headline -->
        <tr>
          <td style="padding: 4px 32px 20px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td style="border-top: 1px solid #c8923c; font-size: 0; line-height: 0; height: 1px;">&nbsp;</td></tr>
            </table>
          </td>
        </tr>
        <!-- Body content -->
        <tr>
          <td style="padding: 0 32px 24px 32px; font-family: Georgia, 'Times New Roman', Times, serif; font-size: 15px; line-height: 1.65; color: #2a2a2a;">
            ${bodyHtml}
          </td>
        </tr>
        <!-- Footer rule: thin-thick like masthead -->
        <tr>
          <td style="padding: 0 32px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td style="border-top: 3px solid #1b2a4a; font-size: 0; line-height: 0; height: 1px;">&nbsp;</td></tr>
              <tr><td style="height: 3px; font-size: 0; line-height: 0;">&nbsp;</td></tr>
              <tr><td style="border-top: 1px solid #1b2a4a; font-size: 0; line-height: 0; height: 1px;">&nbsp;</td></tr>
            </table>
          </td>
        </tr>
        <!-- Footer content -->
        <tr>
          <td style="padding: 16px 32px 24px 32px; text-align: center; font-family: Georgia, 'Times New Roman', Times, serif; font-size: 11px; color: #8a7e6b; line-height: 1.6;">
            Fathers and Football&nbsp;&nbsp;|&nbsp;&nbsp;501(c)(3)&nbsp;&nbsp;|&nbsp;&nbsp;EIN 42-1980182<br/>
            This email was sent to ${escapedEmail}.<br/>
            <a href="${escapeHtml(unsubUrl)}" style="color: #c8923c; text-decoration: underline;">Unsubscribe</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
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
