// Cloudflare Pages Function -- Newsletter Draft Management (Admin)
//
// Authenticated API for the newsletter-admin.html pipeline controls.
// All actions require the same admin passcode as media-review.js.
//
// GET actions (passcode in query string):
//   ?action=pending-draft   -- fetch the most recent pending-approval draft
//   ?action=schedule-info   -- last-sent timestamp + next check due date
//
// POST actions (passcode in JSON body):
//   action: "update-draft"   -- edit subject/bodyHtml of a pending draft
//   action: "send-draft"     -- send pending draft to all subscribers now
//   action: "reject-draft"   -- discard the pending draft
//   action: "generate-draft" -- trigger the AI drafting pipeline on demand
//
// DEPENDENCIES:
//   FAF_MEDIA_ADMIN_PASSCODE -- admin auth
//   FAF_KV                   -- draft storage, subscriber list, schedule state
//   ACS_CONNECTION_STRING    -- email transport (send-draft, generate-draft)
//   ANTHROPIC_API_KEY        -- Claude API (generate-draft)
//   QBO_APPROVAL_SECRET      -- approval tokens (generate-draft)

import {
  corsHeaders,
  validateAdminPasscode,
  errorResponse,
} from "../lib/admin-auth.js";
import { sendNewsletterToAll } from "../lib/newsletter-send-core.js";
import { createNewsletterDraft } from "../lib/newsletter-draft-create.js";

// Pages to scrape for live site content when no whatsNew is provided.
// Each entry maps a section label to a path on the same origin.
const CONTENT_PAGES = [
  { label: "Upcoming Events", path: "/events.html" },
  { label: "Skills Clinic", path: "/skills-clinic.html" },
  { label: "Sponsors", path: "/sponsors.html" },
  { label: "Frisco Elite", path: "/frisco-elite.html" },
];

// Strip HTML tags, scripts, style blocks, and collapse whitespace.
// Returns plain text capped at maxWords.
function extractText(html, maxWords = 300) {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#?\w+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = text.split(" ");
  if (words.length > maxWords) {
    text = words.slice(0, maxWords).join(" ") + " ...";
  }
  return text;
}

// Fetch key pages from the live site and assemble a structured whatsNew blob.
// Each page gets its own labeled section so Claude sees multiple distinct topics.
async function gatherLiveSiteContent(siteOrigin) {
  const sections = [];

  const fetches = CONTENT_PAGES.map(async ({ label, path }) => {
    try {
      const res = await fetch(`${siteOrigin}${path}`, {
        headers: { Accept: "text/html" },
      });
      if (!res.ok) return null;
      const html = await res.text();
      const text = extractText(html);
      if (text.length > 50) {
        return { label, text };
      }
      return null;
    } catch {
      return null;
    }
  });

  const results = await Promise.all(fetches);
  for (const r of results) {
    if (r) sections.push(r);
  }

  if (sections.length === 0) {
    return null;
  }

  return sections.map((s) => `=== ${s.label} ===\n${s.text}`).join("\n\n");
}

// Scan KV for newsletter drafts matching a given status.
// Returns an array sorted by createdAt descending (most recent first).
async function findDraftsByStatus(kv, status) {
  const listed = await kv.list({ prefix: "newsletter:draft:" });
  const drafts = [];

  for (const key of listed.keys) {
    const raw = await kv.get(key.name);
    if (!raw) continue;
    try {
      const draft = JSON.parse(raw);
      if (!status || draft.status === status) {
        drafts.push(draft);
      }
    } catch {
      // skip malformed entries
    }
  }

  // Sort by createdAt descending
  drafts.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return drafts;
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get("Origin") || "";
  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin, "GET, POST, OPTIONS"),
  });
}

export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin") || "";
  const cors = corsHeaders(origin, "GET, POST, OPTIONS");
  const headers = { "Content-Type": "application/json", ...cors };

  try {
    const url = new URL(context.request.url);
    const action = url.searchParams.get("action");
    const passcode = url.searchParams.get("passcode");

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

    // --- PENDING DRAFT ---
    if (action === "pending-draft") {
      const pending = await findDraftsByStatus(kv, "pending-approval");
      if (pending.length === 0) {
        return new Response(JSON.stringify({ found: false, draft: null }), {
          status: 200,
          headers,
        });
      }
      // Return the most recent pending draft
      const draft = pending[0];
      return new Response(
        JSON.stringify({
          found: true,
          draft: {
            id: draft.id,
            subject: draft.subject,
            bodyHtml: draft.bodyHtml,
            whatsNew: draft.whatsNew,
            status: draft.status,
            createdAt: draft.createdAt,
          },
        }),
        { status: 200, headers },
      );
    }

    // --- SCHEDULE INFO ---
    if (action === "schedule-info") {
      // Find the most recent sent draft
      const sentDrafts = await findDraftsByStatus(kv, "sent");
      const lastSentDraft = sentDrafts.length > 0 ? sentDrafts[0] : null;
      const lastSentAt = lastSentDraft?.sentAt || null;

      // Get the last-monthly-send timestamp
      const lastMonthlySend = await kv.get("newsletter:last-monthly-send");

      // Compute next monthly check date (one month after last monthly send)
      let nextMonthlyCheck = null;
      if (lastMonthlySend) {
        const d = new Date(lastMonthlySend);
        // Move to the 1st of next month (the system checks "same calendar month")
        d.setMonth(d.getMonth() + 1);
        d.setDate(1);
        d.setHours(0, 0, 0, 0);
        nextMonthlyCheck = d.toISOString();
      }

      return new Response(
        JSON.stringify({
          lastSentAt,
          lastSentSubject: lastSentDraft?.subject || null,
          lastMonthlySend,
          nextMonthlyCheck,
        }),
        { status: 200, headers },
      );
    }

    return errorResponse(
      "Unknown action. Use pending-draft or schedule-info.",
      400,
      cors,
    );
  } catch (err) {
    console.error("Newsletter drafts GET error:", err);
    return errorResponse("Internal error.", 500, cors);
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

    // --- UPDATE DRAFT ---
    if (action === "update-draft") {
      const { draftId, subject, bodyHtml } = body;
      if (!draftId) {
        return errorResponse("draftId is required.", 400, cors);
      }

      const raw = await kv.get(`newsletter:draft:${draftId}`);
      if (!raw) {
        return errorResponse("Draft not found.", 404, cors);
      }

      let draft;
      try {
        draft = JSON.parse(raw);
      } catch {
        return errorResponse("Draft data corrupted.", 500, cors);
      }

      if (draft.status !== "pending-approval") {
        return errorResponse(
          `Draft already ${draft.status}. Cannot edit.`,
          409,
          cors,
        );
      }

      // Apply edits without changing status
      if (subject && typeof subject === "string") {
        draft.subject = subject.trim();
      }
      if (bodyHtml && typeof bodyHtml === "string") {
        draft.bodyHtml = bodyHtml;
      }
      draft.editedAt = new Date().toISOString();

      await kv.put(`newsletter:draft:${draftId}`, JSON.stringify(draft), {
        expirationTtl: 30 * 24 * 60 * 60,
      });

      return new Response(
        JSON.stringify({ success: true, draftId, editedAt: draft.editedAt }),
        { status: 200, headers },
      );
    }

    // --- SEND DRAFT ---
    if (action === "send-draft") {
      const { draftId } = body;
      if (!draftId) {
        return errorResponse("draftId is required.", 400, cors);
      }

      const raw = await kv.get(`newsletter:draft:${draftId}`);
      if (!raw) {
        return errorResponse("Draft not found.", 404, cors);
      }

      let draft;
      try {
        draft = JSON.parse(raw);
      } catch {
        return errorResponse("Draft data corrupted.", 500, cors);
      }

      if (draft.status !== "pending-approval") {
        return errorResponse(
          `Draft already ${draft.status}. Cannot send.`,
          409,
          cors,
        );
      }

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
        await kv.put(`newsletter:draft:${draftId}`, JSON.stringify(draft), {
          expirationTtl: 30 * 24 * 60 * 60,
        });

        return new Response(
          JSON.stringify({
            success: true,
            sent: sendResult.sent,
            failed: sendResult.failed,
            errors:
              sendResult.errors.length > 0 ? sendResult.errors : undefined,
          }),
          { status: 200, headers },
        );
      } catch (sendErr) {
        console.error("Newsletter draft send error:", sendErr);

        draft.status = "send-failed";
        draft.failedAt = new Date().toISOString();
        draft.failReason = sendErr.message;
        await kv.put(`newsletter:draft:${draftId}`, JSON.stringify(draft), {
          expirationTtl: 30 * 24 * 60 * 60,
        });

        return errorResponse(`Send failed: ${sendErr.message}`, 500, cors);
      }
    }

    // --- REJECT DRAFT ---
    if (action === "reject-draft") {
      const { draftId } = body;
      if (!draftId) {
        return errorResponse("draftId is required.", 400, cors);
      }

      const raw = await kv.get(`newsletter:draft:${draftId}`);
      if (!raw) {
        return errorResponse("Draft not found.", 404, cors);
      }

      let draft;
      try {
        draft = JSON.parse(raw);
      } catch {
        return errorResponse("Draft data corrupted.", 500, cors);
      }

      if (draft.status !== "pending-approval") {
        return errorResponse(
          `Draft already ${draft.status}. Cannot reject.`,
          409,
          cors,
        );
      }

      draft.status = "rejected";
      draft.rejectedAt = new Date().toISOString();
      await kv.put(`newsletter:draft:${draftId}`, JSON.stringify(draft), {
        expirationTtl: 30 * 24 * 60 * 60,
      });

      return new Response(
        JSON.stringify({
          success: true,
          draftId,
          rejectedAt: draft.rejectedAt,
        }),
        { status: 200, headers },
      );
    }

    // --- GENERATE DRAFT ---
    if (action === "generate-draft") {
      const siteUrl = new URL(context.request.url).origin;

      // Use caller-supplied whatsNew when provided (e.g. from the cron worker).
      // Otherwise, scrape real content from the live site so Claude gets
      // multiple distinct topics instead of a vague placeholder.
      let whatsNew = body.whatsNew || null;
      if (!whatsNew) {
        const liveContent = await gatherLiveSiteContent(siteUrl);
        whatsNew =
          liveContent ||
          "Manual newsletter trigger from admin panel. Write a brief update newsletter for Fathers and Football families.";
      }

      try {
        const result = await createNewsletterDraft({
          whatsNew,
          siteUrl,
          env: context.env,
        });

        return new Response(
          JSON.stringify({
            success: true,
            draftId: result.draftId,
            subject: result.subject,
            emailSent: result.emailSent,
          }),
          { status: 200, headers },
        );
      } catch (genErr) {
        console.error("Newsletter draft generation error:", genErr);
        return errorResponse(`Generation failed: ${genErr.message}`, 500, cors);
      }
    }

    return errorResponse(
      "Unknown action. Use update-draft, send-draft, reject-draft, or generate-draft.",
      400,
      cors,
    );
  } catch (err) {
    console.error("Newsletter drafts POST error:", err);
    return errorResponse("Internal error.", 500, cors);
  }
}
