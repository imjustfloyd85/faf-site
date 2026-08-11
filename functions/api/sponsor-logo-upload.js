// Cloudflare Pages Function — Sponsor Logo Upload
// Accepts a logo image + agreement acceptance during the sponsorship checkout
// flow. Stores the logo in R2, creates a pending sponsor entry in KV with
// status="awaiting-payment", and returns the entry ID for the Stripe checkout
// metadata.
//
// Security gates:
//   1. File type allowlist (images only — no video, no SVG)
//   2. File size cap (5 MB for logos)
//   3. Agreement acceptance required (self-attestation)
//   4. Randomized storage keys (client filenames never trusted)
//   5. Per-IP rate limiting via KV
//
// DEPENDENCIES:
//   MEDIA_BUCKET (R2) — stores logo files under sponsor-logos/ prefix
//   FAF_KV — stores pending sponsor entries
//   QBO_APPROVAL_SECRET — signs approval tokens (optional at upload time)

import { AGREEMENT_VERSION } from "../lib/sponsor-agreement.js";

const MAX_LOGO_SIZE = 5 * 1024 * 1024; // 5 MB
const RATE_LIMIT_WINDOW_SEC = 600; // 10-minute window
const RATE_LIMIT_MAX_UPLOADS = 5; // max logo uploads per IP per window

const ALLOWED_LOGO_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

const TYPE_EXTENSIONS = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

function corsHeaders(origin) {
  const allowed = [
    "https://fathersandfootball.org",
    "https://www.fathersandfootball.org",
    "http://localhost:8788",
    "http://localhost:3000",
  ];
  return {
    "Access-Control-Allow-Origin": allowed.includes(origin)
      ? origin
      : allowed[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

async function checkRateLimit(kvStore, clientIp) {
  if (!kvStore) return { allowed: true };

  const key = `ratelimit:sponsor-logo:${clientIp}`;
  const existing = await kvStore.get(key, { type: "json" });
  const now = Math.floor(Date.now() / 1000);

  if (!existing) {
    await kvStore.put(key, JSON.stringify({ count: 1, windowStart: now }), {
      expirationTtl: RATE_LIMIT_WINDOW_SEC,
    });
    return { allowed: true, remaining: RATE_LIMIT_MAX_UPLOADS - 1 };
  }

  if (now - existing.windowStart >= RATE_LIMIT_WINDOW_SEC) {
    await kvStore.put(key, JSON.stringify({ count: 1, windowStart: now }), {
      expirationTtl: RATE_LIMIT_WINDOW_SEC,
    });
    return { allowed: true, remaining: RATE_LIMIT_MAX_UPLOADS - 1 };
  }

  if (existing.count >= RATE_LIMIT_MAX_UPLOADS) {
    return { allowed: false, remaining: 0 };
  }

  await kvStore.put(
    key,
    JSON.stringify({
      count: existing.count + 1,
      windowStart: existing.windowStart,
    }),
    { expirationTtl: RATE_LIMIT_WINDOW_SEC - (now - existing.windowStart) },
  );
  return {
    allowed: true,
    remaining: RATE_LIMIT_MAX_UPLOADS - existing.count - 1,
  };
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get("Origin") || "";
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function onRequestPost(context) {
  const origin = context.request.headers.get("Origin") || "";
  const cors = corsHeaders(origin);
  const headers = { "Content-Type": "application/json", ...cors };

  try {
    const bucket = context.env.MEDIA_BUCKET;
    if (!bucket) {
      return new Response(
        JSON.stringify({ error: "Storage is not configured." }),
        { status: 500, headers },
      );
    }

    const kv = context.env.FAF_KV;
    if (!kv) {
      return new Response(
        JSON.stringify({ error: "Storage is not configured." }),
        { status: 500, headers },
      );
    }

    // Rate limit check
    const clientIp =
      context.request.headers.get("CF-Connecting-IP") || "unknown";
    const rateCheck = await checkRateLimit(kv, clientIp);
    if (!rateCheck.allowed) {
      return new Response(
        JSON.stringify({
          error: "Too many uploads. Please wait and try again.",
        }),
        {
          status: 429,
          headers: { ...headers, "Retry-After": String(RATE_LIMIT_WINDOW_SEC) },
        },
      );
    }

    // Parse multipart form data
    let formData;
    try {
      formData = await context.request.formData();
    } catch {
      return new Response(
        JSON.stringify({
          error: "Invalid request. Expected multipart form data.",
        }),
        { status: 400, headers },
      );
    }

    // Validate required fields
    const sponsorName = (formData.get("sponsorName") || "")
      .toString()
      .trim()
      .slice(0, 200);
    const sponsorEmail = (formData.get("sponsorEmail") || "")
      .toString()
      .trim()
      .slice(0, 254);
    const sponsorOrg = (formData.get("sponsorOrg") || "")
      .toString()
      .trim()
      .slice(0, 200);
    const tier = (formData.get("tier") || "").toString().trim();
    const agreementAccepted = formData.get("agreementAccepted");

    if (!sponsorName) {
      return new Response(
        JSON.stringify({ error: "Sponsor name is required." }),
        { status: 400, headers },
      );
    }

    if (!sponsorEmail || !sponsorEmail.includes("@")) {
      return new Response(
        JSON.stringify({ error: "A valid email address is required." }),
        { status: 400, headers },
      );
    }

    if (!sponsorOrg) {
      return new Response(
        JSON.stringify({ error: "Organization name is required." }),
        { status: 400, headers },
      );
    }

    const validTiers = ["sideline", "playmaker", "legacy"];
    if (!validTiers.includes(tier)) {
      return new Response(
        JSON.stringify({ error: "Invalid sponsorship tier." }),
        { status: 400, headers },
      );
    }

    if (agreementAccepted !== "true" && agreementAccepted !== true) {
      return new Response(
        JSON.stringify({
          error: "You must accept the sponsorship agreement to proceed.",
        }),
        { status: 400, headers },
      );
    }

    // Get the logo file
    const file = formData.get("logo");
    if (!file || !(file instanceof File) || file.size === 0) {
      return new Response(
        JSON.stringify({ error: "A logo image is required." }),
        { status: 400, headers },
      );
    }

    // File size check
    if (file.size > MAX_LOGO_SIZE) {
      return new Response(
        JSON.stringify({
          error: `Logo file too large. Maximum size is ${MAX_LOGO_SIZE / 1024 / 1024} MB.`,
        }),
        { status: 413, headers },
      );
    }

    // File type check — images only
    const contentType = file.type.toLowerCase();
    if (!ALLOWED_LOGO_TYPES.has(contentType)) {
      return new Response(
        JSON.stringify({
          error: "Logo must be an image file (JPEG, PNG, GIF, or WebP).",
        }),
        { status: 415, headers },
      );
    }

    // Generate entry ID and storage key
    const entryId = crypto.randomUUID();
    const ext = TYPE_EXTENSIONS[contentType] || ".png";
    const logoR2Key = `sponsor-logos/${entryId}${ext}`;

    // Store logo in R2
    await bucket.put(logoR2Key, file.stream(), {
      httpMetadata: { contentType },
      customMetadata: {
        sponsorName,
        sponsorOrg,
        originalFilename: (file.name || "logo").slice(0, 255),
        uploadedAt: new Date().toISOString(),
      },
    });

    // Create pending sponsor entry in KV
    const entry = {
      id: entryId,
      sponsorName,
      sponsorEmail,
      sponsorOrg,
      tier,
      logoR2Key,
      logoContentType: contentType,
      agreementVersion: AGREEMENT_VERSION,
      agreementAcceptedAt: new Date().toISOString(),
      agreementAcceptedBy: sponsorName,
      status: "awaiting-payment",
      stripeSessionId: null,
      amountCents: null,
      createdAt: new Date().toISOString(),
      approvedAt: null,
      rejectedAt: null,
    };

    // TTL 30 days — same as QBO pending entries
    await kv.put(`sponsor:pending:${entryId}`, JSON.stringify(entry), {
      expirationTtl: 30 * 24 * 60 * 60,
    });

    return new Response(
      JSON.stringify({
        success: true,
        entryId,
        message: "Logo uploaded and agreement accepted. Proceeding to payment.",
      }),
      { status: 200, headers },
    );
  } catch (err) {
    console.error("Sponsor logo upload error:", err);
    return new Response(
      JSON.stringify({ error: "Upload failed. Please try again." }),
      { status: 500, headers },
    );
  }
}
