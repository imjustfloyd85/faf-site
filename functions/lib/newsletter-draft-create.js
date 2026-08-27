// Newsletter draft creation via Claude API.
//
// Generates a unique draft ID, calls Claude with a "what's new" summary,
// stores the resulting subject + HTML body in FAF_KV as a pending draft,
// then emails the rendered draft to the FAF approvers with approve/reject links.
//
// DEPENDENCIES:
//   ANTHROPIC_API_KEY      -- Claude API key
//   QBO_APPROVAL_SECRET    -- HMAC key for approval tokens
//   ACS_CONNECTION_STRING  -- email transport
//   FAF_KV                 -- draft storage

import { createApprovalToken } from "./approval-tokens.js";
import { sendViaACS } from "./acs-email.js";
import { escapeHtml } from "./newsletter-send-core.js";

// Same recipients as sponsor-approve and QBO approval notifications
const APPROVER_RECIPIENTS = [
  "justin@fathersandfootball.org",
  "communications@fathersandfootball.org",
];

const CLAUDE_SYSTEM_PROMPT = `You are a newsletter writer for Fathers and Football (FAF), a 501(c)(3) youth football organization in the Dallas-Fort Worth area. FAF runs the Legacy 7 United and Frisco Elite travel ball programs, hosts skills clinics, and centers everything on fatherhood, mentorship, and community.

Write a short newsletter email based only on the factual updates provided below. Your job is to summarize what actually changed on the website or in the organization -- nothing more.

Rules you must follow:
- Write in a warm, community-focused voice. Talk like a real person writing to families who care about their kids.
- State only facts present in the input. Never invent scores, dates, names, sponsor details, or event specifics that aren't explicitly provided.
- Never invent image URLs. Only use image URLs explicitly listed in the "Available images" section below the updates. If no images are provided, do not include any <img> tags.
- If the input covers multiple distinct topics (an upcoming event, a recent result, a sponsor highlight, a program update), give each topic its own visually distinct section (see "Section structure" below). Do not cherry-pick a single topic and ignore the rest.
- If the input is thin or covers only one topic, write a shorter newsletter with just one section. Do not pad it out or force extra sections.
- Include one clear call to action (visit the site, register, show up to an event, etc.) based on whatever the update is about.
- No em dashes. No words like "delve," "boasts," "intricate," "underscore," "align with," "enhance," "fostering," "showcasing," "pivotal," "crucial." No rule-of-three lists used as filler. No emoji. No formulaic sign-off sentences like "Together, we can make a difference."
- Use short paragraphs. Two to four sentences each.
- Do not mention that you are AI or that this was generated.

Section structure (each distinct topic gets its own section):
- Wrap each topic in a <div> with a gold left-border accent and padding:
  <div style="border-left: 3px solid #c8923c; padding: 4px 0 4px 16px; margin-bottom: 24px;">
- Start each section with an <h3> heading. Write a short, specific, punchy headline for that piece of content -- NOT a generic label like "Upcoming Events" or "Recent Results." Use the actual event name, date, or subject. Examples: "Skills Clinic -- September 13", "Float Fest Results Are In", "Thank You to Our Sponsors".
  <h3 style="margin: 0 0 8px; color: #1a1a1a; font-size: 18px;">Your Headline Here</h3>
- Follow the heading with <p> tags for the body text:
  <p style="margin: 0 0 10px; line-height: 1.6;">Paragraph content...</p>
- Place any relevant <img> inside the same section div, near the paragraph it relates to.
- Close the section </div> before starting the next topic's div.

Image rules (only when images are provided):
- Include an image only when it is directly relevant to the section being written. Do not add images for decoration or filler.
- Use the exact URL from the provided list. Never modify or guess a URL.
- You do not have to use every image. Skip any that do not fit naturally.
- Place each <img> inside the section div it relates to, not clustered together.
- Every <img> tag must use these inline styles: style="max-width: 100%; height: auto; display: block; margin: 12px 0;"
- Include the alt attribute from the provided image data. If alt is empty, write a brief descriptive alt based on the section context.

Style rules:
- Use inline styles on every element (email clients ignore <style> blocks and external CSS).
- Keep styles minimal and email-safe. Stick to the site palette: gold accent #c8923c, dark text #1a1a1a or #333, white/light backgrounds.
- Font is inherited from the outer wrapper (Arial, sans-serif) -- do not set font-family on inner elements.

Respond with valid JSON only, no markdown fences:
{"subject": "the email subject line", "bodyHtml": "<div style=\\"border-left: 3px solid #c8923c; ...\\">...</div>"}

The bodyHtml should use: <div> section wrappers (styled as above), <h3> for section headings, <p> for paragraphs, <a> for links, <strong> for emphasis, <img> for provided images. All elements use inline styles as described above.`;

export async function createNewsletterDraft({
  whatsNew,
  siteImages = [],
  siteUrl,
  env,
}) {
  const apiKey = env.ANTHROPIC_API_KEY;
  const secret = env.QBO_APPROVAL_SECRET;
  const kv = env.FAF_KV;

  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  if (!secret) throw new Error("QBO_APPROVAL_SECRET not configured");
  if (!kv) throw new Error("FAF_KV not configured");

  // Generate a unique draft ID
  const draftId = crypto.randomUUID();

  // Build the user message: text updates + optional image list
  let userContent = `Here are the recent updates to summarize for the newsletter:\n\n${whatsNew}`;

  if (siteImages.length > 0) {
    const imageLines = siteImages.map(
      (img) => `- [${img.section}] ${img.url}${img.alt ? ` (${img.alt})` : ""}`,
    );
    userContent += `\n\nAvailable images (use only these exact URLs, only where relevant):\n${imageLines.join("\n")}`;
  }

  // Call Claude to generate the newsletter
  const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2400,
      system: CLAUDE_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: userContent,
        },
      ],
    }),
  });

  if (!claudeResponse.ok) {
    const errText = await claudeResponse.text();
    throw new Error(`Claude API returned ${claudeResponse.status}: ${errText}`);
  }

  const claudeData = await claudeResponse.json();

  // Extract the text content from Claude's response
  const textBlock = claudeData.content?.find((b) => b.type === "text");
  if (!textBlock?.text) {
    throw new Error("Claude returned no text content");
  }

  // Claude sometimes wraps JSON in ```json ... ``` despite the system prompt.
  // Strip markdown code fences before parsing.
  let rawText = textBlock.text.trim();
  const fenceMatch = rawText.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  if (fenceMatch) {
    rawText = fenceMatch[1].trim();
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(`Claude returned invalid JSON: ${rawText.slice(0, 200)}`);
  }

  const { subject, bodyHtml } = parsed;
  if (!subject || !bodyHtml) {
    throw new Error("Claude response missing subject or bodyHtml");
  }

  // Store draft in KV
  const draft = {
    id: draftId,
    subject,
    bodyHtml,
    whatsNew,
    status: "pending-approval",
    createdAt: new Date().toISOString(),
  };

  // TTL of 30 days -- drafts older than that are stale
  await kv.put(`newsletter:draft:${draftId}`, JSON.stringify(draft), {
    expirationTtl: 30 * 24 * 60 * 60,
  });

  // Generate approve and reject tokens
  const approveToken = await createApprovalToken(draftId, "approve", secret);
  const rejectToken = await createApprovalToken(draftId, "reject", secret);

  const approveUrl = `${siteUrl}/api/newsletter-draft-approve?token=${encodeURIComponent(approveToken)}`;
  const rejectUrl = `${siteUrl}/api/newsletter-draft-approve?token=${encodeURIComponent(rejectToken)}`;

  // Build the approval email with the rendered draft preview
  const approvalHtml = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
  <h2 style="color: #c8923c;">Newsletter Draft Ready for Review</h2>
  <p>A new newsletter draft has been generated. Review the content below, then approve or reject it.</p>

  <div style="border: 1px solid #ddd; border-radius: 8px; padding: 20px; margin: 20px 0; background: #fafafa;">
    <h3 style="margin-top: 0;">Subject: ${escapeHtml(subject)}</h3>
    <hr style="border: none; border-top: 1px solid #eee;" />
    ${bodyHtml}
  </div>

  <p style="margin: 24px 0;">
    <a href="${escapeHtml(approveUrl)}" style="display: inline-block; padding: 12px 24px; background: #28a745; color: #fff; text-decoration: none; border-radius: 4px; margin-right: 12px;">Approve and Send</a>
    <a href="${escapeHtml(rejectUrl)}" style="display: inline-block; padding: 12px 24px; background: #dc3545; color: #fff; text-decoration: none; border-radius: 4px;">Reject Draft</a>
  </p>

  <p style="font-size: 12px; color: #666;">
    Approving will immediately send this newsletter to all active subscribers.
    These links expire in 7 days. Draft ID: ${escapeHtml(draftId)}
  </p>
</div>`;

  const emailResult = await sendViaACS(env, {
    from: "communications@fathersandfootball.org",
    to: APPROVER_RECIPIENTS,
    subject: `[Newsletter Draft] ${subject}`,
    html: approvalHtml,
  });

  if (!emailResult.ok && emailResult.status !== 202) {
    console.error("Failed to send draft approval email:", emailResult.status);
  }

  return {
    draftId,
    subject,
    approveUrl,
    rejectUrl,
    emailSent: emailResult.ok || emailResult.status === 202,
  };
}
