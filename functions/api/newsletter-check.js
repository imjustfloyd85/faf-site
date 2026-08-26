// Cloudflare Pages Function -- Newsletter Check
//
// POST endpoint called by the faf-newsletter-cron worker.
// Accepts a shared secret in the X-Cron-Secret header for auth.
// The cron worker passes git commit/diff data in the request body.
//
// Flow:
//   1. Validate the shared secret
//   2. Check if a monthly digest is due OR if there's new event content
//   3. If either condition is true, trigger draft creation
//   4. Return status to the cron worker
//
// DEPENDENCIES:
//   FAF_NEWSLETTER_CRON_SECRET -- shared secret with the cron worker
//   ANTHROPIC_API_KEY          -- passed through to draft creation
//   QBO_APPROVAL_SECRET        -- passed through to draft creation
//   ACS_CONNECTION_STRING      -- passed through to draft creation
//   FAF_KV                     -- draft storage, subscriber list, state

import { createNewsletterDraft } from "../lib/newsletter-draft-create.js";
import {
  filterRelevantCommits,
  summarizeChanges,
  isMonthlyDigestDue,
  markMonthlySent,
  setLastProcessedSha,
} from "../lib/newsletter-change-detect.js";

export async function onRequestPost(context) {
  const headers = { "Content-Type": "application/json" };

  // Auth: shared secret header
  const cronSecret = context.env.FAF_NEWSLETTER_CRON_SECRET;
  if (!cronSecret) {
    return new Response(
      JSON.stringify({ error: "Newsletter cron not configured" }),
      { status: 500, headers },
    );
  }

  const providedSecret = context.request.headers.get("X-Cron-Secret");
  if (!providedSecret || providedSecret !== cronSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 403,
      headers,
    });
  }

  const kv = context.env.FAF_KV;
  if (!kv) {
    return new Response(JSON.stringify({ error: "FAF_KV not configured" }), {
      status: 500,
      headers,
    });
  }

  try {
    let body;
    try {
      body = await context.request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers,
      });
    }

    const { commits, headSha, trigger } = body;

    // Determine if we should create a draft
    let shouldDraft = false;
    let whatsNew = null;
    let reason = null;

    // Check for event-page changes
    const relevant = filterRelevantCommits(commits || []);
    const changeSummary = summarizeChanges(relevant);

    if (changeSummary) {
      shouldDraft = true;
      whatsNew = changeSummary;
      reason = "new-content";
    }

    // Check if monthly digest is due
    const monthlyDue = await isMonthlyDigestDue(kv);
    if (monthlyDue && !shouldDraft) {
      shouldDraft = true;
      // For monthly digest with no new content, provide a generic prompt
      whatsNew =
        whatsNew ||
        "No specific new content this month. Write a brief monthly check-in newsletter reminding families about the Fathers and Football programs and encouraging them to visit fathersandfootball.org for the latest updates.";
      reason = "monthly-digest";
    }

    if (trigger === "manual") {
      // Manual trigger from the cron worker -- always create a draft
      shouldDraft = true;
      if (!whatsNew) {
        whatsNew =
          body.whatsNew ||
          "Manual newsletter trigger. Write a brief update newsletter for Fathers and Football families.";
      }
      reason = "manual";
    }

    if (!shouldDraft) {
      return new Response(
        JSON.stringify({
          drafted: false,
          reason: "no-new-content-and-monthly-not-due",
        }),
        { status: 200, headers },
      );
    }

    const siteUrl = new URL(context.request.url).origin;

    const result = await createNewsletterDraft({
      whatsNew,
      siteUrl,
      env: context.env,
    });

    // Update the last-processed SHA if we got one
    if (headSha) {
      await setLastProcessedSha(kv, headSha);
    }

    // Mark monthly as sent if that was the trigger
    if (reason === "monthly-digest") {
      await markMonthlySent(kv);
    }

    return new Response(
      JSON.stringify({
        drafted: true,
        reason,
        draftId: result.draftId,
        subject: result.subject,
        emailSent: result.emailSent,
      }),
      { status: 200, headers },
    );
  } catch (err) {
    console.error("Newsletter check error:", err);
    return new Response(
      JSON.stringify({ error: "Internal error", detail: err.message }),
      { status: 500, headers },
    );
  }
}

// Block GET -- this is a POST-only endpoint
export async function onRequestGet() {
  return new Response("Method not allowed", { status: 405 });
}
