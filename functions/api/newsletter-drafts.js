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
  // Coach letters: add new pages here as they're published.
  // Each gets its own labeled section in the newsletter input.
  { label: "Coach's Letter", path: "/coach-letter-season-opener.html" },
  // Blog posts: add new posts here as they're published.
  {
    label: "=== Blog: Rise of Flag Football ===",
    path: "/rise-of-flag-football.html",
  },
  // Community / rec league content (Neighborhood Sports NFL Flag, etc.)
  { label: "Community / Neighborhood Sports", path: "/community.html" },
];

// Remove site chrome (scripts, styles, nav, footer, header) from raw HTML
// so both text and image extraction focus on main content only.
function stripChrome(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ");
}

// Strip HTML tags, scripts, style blocks, and collapse whitespace.
// Returns plain text capped at maxWords.
function extractText(html, maxWords = 300) {
  let text = stripChrome(html)
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

// Try to parse a date string like "Aug 23", "Sep 20", "August 8", "October 10, 2026",
// "September 26 - 27, 2026", "Mar 2027" etc. Returns a Date or null if unparseable.
// When no year is provided, assumes the current year (or next year if the month
// has already passed and the text is clearly future-looking).
function tryParseEventDate(dateStr, now) {
  if (!dateStr || typeof dateStr !== "string") return null;

  // Clean up HTML entities and extra whitespace
  const cleaned = dateStr
    .replace(/&ndash;/g, "-")
    .replace(/&mdash;/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  const MONTHS = {
    jan: 0,
    january: 0,
    feb: 1,
    february: 1,
    mar: 2,
    march: 2,
    apr: 3,
    april: 3,
    may: 4,
    jun: 5,
    june: 5,
    jul: 6,
    july: 6,
    aug: 7,
    august: 7,
    sep: 8,
    september: 8,
    oct: 9,
    october: 9,
    nov: 10,
    november: 10,
    dec: 11,
    december: 11,
  };

  // Pattern: "Month Day" or "Month Day, Year" or "Month Day - Day" or "Month Year"
  const m = cleaned.match(
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\s+(\d{1,2})?(?:\s*[-–]\s*\d{1,2})?(?:[,\s]+(\d{4}))?/i,
  );
  if (!m) return null;

  const monthIdx = MONTHS[m[1].toLowerCase()];
  if (monthIdx === undefined) return null;

  const day = m[2] ? parseInt(m[2], 10) : 1;
  let year = m[3] ? parseInt(m[3], 10) : now.getFullYear();

  // If no year was given and the month is already far past, assume next year
  if (!m[3]) {
    const candidate = new Date(year, monthIdx, day);
    if (candidate.getTime() < now.getTime() - 180 * 24 * 60 * 60 * 1000) {
      year++;
    }
  }

  return new Date(year, monthIdx, day);
}

// Words/phrases that indicate recap or result content. When a past event's
// text contains any of these, the event is worth keeping because it has real
// outcome data, not just an expired date.
const RECAP_INDICATORS =
  /\b(recap|result|championship|semifinal|finals?|won|lost|defeated|record|W-L|\d+W[- ]?\d+L|overtime|quarter.?final|bracket|eliminated|advanced|placed|runner.?up|undefeated|champion)\b/i;

// Filter lines from extracted text, dropping events more than 14 days in the past
// UNLESS the line contains recap/result content worth referencing.
// Lines that don't contain a parseable date are kept (safe default).
function filterOldEvents(text, now) {
  const cutoff = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const lines = text.split("\n");
  const kept = [];

  for (const line of lines) {
    const parsed = tryParseEventDate(line.trim(), now);
    if (parsed && parsed < cutoff) {
      // Keep the line anyway if it has real recap/result content
      if (RECAP_INDICATORS.test(line)) {
        kept.push(line);
      }
      continue;
    }
    kept.push(line);
  }

  return kept.join("\n");
}

// Pull content images from main-content HTML, skipping decorative/nav/icon images.
// Returns an array of { url, alt, section } capped at maxPerPage per page.
function extractImages(html, siteOrigin, sectionLabel, maxPerPage = 3) {
  const cleaned = stripChrome(html);
  const images = [];
  const imgTagRegex = /<img\b[^>]+>/gi;
  let tagMatch;

  while ((tagMatch = imgTagRegex.exec(cleaned)) !== null) {
    const tag = tagMatch[0];

    const srcMatch = tag.match(/\bsrc=["']([^"']+)["']/i);
    if (!srcMatch) continue;
    let src = srcMatch[1];

    // Skip data URIs, SVGs, and tracking pixels
    if (src.startsWith("data:") || src.endsWith(".svg")) continue;

    // Skip likely icons, logos, favicons, spacers
    if (/favicon|icon|sprite|spacer|pixel|tracking|badge/i.test(src)) continue;

    // Skip tiny images (explicit dimension attributes under 50px)
    const widthAttr = tag.match(/\bwidth=["']?(\d+)/i);
    const heightAttr = tag.match(/\bheight=["']?(\d+)/i);
    if (widthAttr && parseInt(widthAttr[1], 10) < 50) continue;
    if (heightAttr && parseInt(heightAttr[1], 10) < 50) continue;

    // Resolve relative paths to absolute
    if (src.startsWith("/")) {
      src = `${siteOrigin}${src}`;
    } else if (!src.startsWith("http")) {
      src = `${siteOrigin}/${src}`;
    }

    const altMatch = tag.match(/\balt=["']([^"']*)["']/i);
    const alt = altMatch ? altMatch[1] : "";

    images.push({ url: src, alt, section: sectionLabel });
    if (images.length >= maxPerPage) break;
  }

  return images;
}

// Extract the #schedule section from frisco-elite.html specifically.
// Returns the text content of just that section, not the whole page.
async function fetchWeeklySchedule(siteOrigin) {
  try {
    const res = await fetch(`${siteOrigin}/frisco-elite.html`, {
      headers: { Accept: "text/html" },
    });
    if (!res.ok) return null;
    const html = await res.text();

    const startMatch = html.match(/<section[^>]*id=["']schedule["'][^>]*>/i);
    if (!startMatch) return null;

    const startIdx = startMatch.index;
    let depth = 1;
    let cursor = startIdx + startMatch[0].length;
    const openRe = /<section[\s>]/gi;
    const closeRe = /<\/section>/gi;

    while (depth > 0 && cursor < html.length) {
      openRe.lastIndex = cursor;
      closeRe.lastIndex = cursor;
      const nextOpen = openRe.exec(html);
      const nextClose = closeRe.exec(html);
      if (!nextClose) break;
      if (nextOpen && nextOpen.index < nextClose.index) {
        depth++;
        cursor = nextOpen.index + nextOpen[0].length;
      } else {
        depth--;
        cursor = nextClose.index + nextClose[0].length;
      }
    }

    const scheduleHtml = html.slice(startIdx, cursor);
    const text = scheduleHtml
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#?\w+;/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (text.length < 30) return null;
    return text;
  } catch {
    return null;
  }
}

// Fetch /api/approved-sponsors and filter to sponsors approved in the last 60 days.
// The sponsor list is loaded client-side via JS on sponsors.html, so fetching the
// raw HTML would miss them entirely. Going straight to the API is the only way.
async function fetchNewPartnerships(siteOrigin) {
  try {
    const res = await fetch(`${siteOrigin}/api/approved-sponsors`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const sponsors = data.sponsors || [];

    const sixtyDaysAgo = Date.now() - 60 * 24 * 60 * 60 * 1000;
    const recent = sponsors.filter((s) => {
      if (!s.approvedAt) return false;
      return new Date(s.approvedAt).getTime() >= sixtyDaysAgo;
    });

    if (recent.length === 0) {
      return "No new partnerships in the last 60 days.";
    }

    return recent.map((s) => `- ${s.name} (${s.tier || "Sponsor"})`).join("\n");
  } catch {
    return null;
  }
}

// Fetch key pages from the live site and assemble a structured whatsNew blob.
// Each page gets its own labeled section so Claude sees multiple distinct topics.
// Applies date filtering to event/schedule content to drop anything > 14 days old.
// Returns { text, images } where images is an array of { url, alt, section }.
async function gatherLiveSiteContent(siteOrigin) {
  const now = new Date();
  const sections = [];
  const allImages = [];

  // Labels whose text should be date-filtered (events and schedule content)
  const DATE_FILTERED_LABELS = ["Upcoming Events", "Weekly Schedule"];

  const pageFetches = CONTENT_PAGES.map(async ({ label, path }) => {
    try {
      const res = await fetch(`${siteOrigin}${path}`, {
        headers: { Accept: "text/html" },
      });
      if (!res.ok) return null;
      const html = await res.text();
      let text = extractText(html);
      const images = extractImages(html, siteOrigin, label);

      // Filter old events from event-related pages
      if (DATE_FILTERED_LABELS.includes(label)) {
        text = filterOldEvents(text, now);
      }

      if (text.length > 50) {
        return { label, text, images };
      }
      return null;
    } catch {
      return null;
    }
  });

  const [pageResults, scheduleText, partnershipsText] = await Promise.all([
    Promise.all(pageFetches),
    fetchWeeklySchedule(siteOrigin),
    fetchNewPartnerships(siteOrigin),
  ]);

  for (const r of pageResults) {
    if (r) {
      sections.push(r);
      allImages.push(...r.images);
    }
  }

  // Append dedicated Weekly Schedule section (extracted from #schedule only,
  // not diluted into the generic Frisco Elite page text).
  if (scheduleText) {
    const filtered = filterOldEvents(scheduleText, now);
    if (filtered.length > 30) {
      sections.push({ label: "Weekly Schedule", text: filtered, images: [] });
    }
  }

  // Append dedicated New Partnerships section from the approved-sponsors API.
  if (partnershipsText) {
    sections.push({
      label: "New Partnerships",
      text: partnershipsText,
      images: [],
    });
  }

  if (sections.length === 0) {
    return null;
  }

  const text = sections
    .map((s) => `=== ${s.label} ===\n${s.text}`)
    .join("\n\n");

  // Cap total images across all pages at 6
  const images = allImages.slice(0, 6);

  return { text, images };
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
      let siteImages = [];
      if (!whatsNew) {
        const liveContent = await gatherLiveSiteContent(siteUrl);
        whatsNew =
          liveContent?.text ||
          "Manual newsletter trigger from admin panel. Write a brief update newsletter for Fathers and Football families.";
        siteImages = liveContent?.images || [];
      }

      try {
        const result = await createNewsletterDraft({
          whatsNew,
          siteImages,
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
