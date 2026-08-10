// Cloudflare Pages Function — FAF Media Upload
// Private media drop box for parents and fans to submit photos/video.
// Uploads land in R2 only — no auto-publish. Team reviews and pulls later.
//
// Security gates:
//   1. Server-side shared passcode check (env: FAF_MEDIA_PASSCODE)
//   2. File type allowlist (images + video only)
//   3. File size cap (100 MB)
//   4. Randomized storage keys (client filenames are never trusted)
//   5. Per-IP rate limiting via KV (env: FAF_KV)

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB
const RATE_LIMIT_WINDOW_SEC = 600; // 10-minute window
const RATE_LIMIT_MAX_UPLOADS = 20; // max uploads per IP per window

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "video/mp4",
  "video/quicktime",
  "video/x-msvideo",
  "video/webm",
  "video/x-matroska",
]);

// Map content types to file extensions for storage
const TYPE_EXTENSIONS = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/x-msvideo": ".avi",
  "video/webm": ".webm",
  "video/x-matroska": ".mkv",
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

function generateStorageKey(contentType) {
  const ext = TYPE_EXTENSIONS[contentType] || "";
  const timestamp = Date.now();
  const rand = crypto.randomUUID();
  return `uploads/${timestamp}-${rand}${ext}`;
}

async function checkRateLimit(kvStore, clientIp) {
  if (!kvStore) return { allowed: true };

  const key = `ratelimit:media:${clientIp}`;
  const existing = await kvStore.get(key, { type: "json" });

  const now = Math.floor(Date.now() / 1000);

  if (!existing) {
    await kvStore.put(key, JSON.stringify({ count: 1, windowStart: now }), {
      expirationTtl: RATE_LIMIT_WINDOW_SEC,
    });
    return { allowed: true, remaining: RATE_LIMIT_MAX_UPLOADS - 1 };
  }

  // Window expired — reset
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
    // Validate environment
    const passcode = context.env.FAF_MEDIA_PASSCODE;
    if (!passcode) {
      return new Response(
        JSON.stringify({ error: "Media upload is not configured." }),
        { status: 500, headers },
      );
    }

    const bucket = context.env.MEDIA_BUCKET;
    if (!bucket) {
      return new Response(
        JSON.stringify({ error: "Storage is not configured." }),
        { status: 500, headers },
      );
    }

    // Rate limit check
    const clientIp =
      context.request.headers.get("CF-Connecting-IP") || "unknown";
    const rateCheck = await checkRateLimit(context.env.FAF_KV, clientIp);
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

    // Server-side passcode validation
    const submittedPasscode = formData.get("passcode");
    if (!submittedPasscode || submittedPasscode !== passcode) {
      return new Response(JSON.stringify({ error: "Invalid team passcode." }), {
        status: 403,
        headers,
      });
    }

    // Get the file
    const file = formData.get("file");
    if (!file || !(file instanceof File) || file.size === 0) {
      return new Response(JSON.stringify({ error: "No file provided." }), {
        status: 400,
        headers,
      });
    }

    // File size check
    if (file.size > MAX_FILE_SIZE) {
      return new Response(
        JSON.stringify({
          error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024} MB.`,
        }),
        { status: 413, headers },
      );
    }

    // File type check — use the detected content type, not the extension
    const contentType = file.type.toLowerCase();
    if (!ALLOWED_TYPES.has(contentType)) {
      return new Response(
        JSON.stringify({
          error: "File type not allowed. Only images and videos are accepted.",
        }),
        { status: 415, headers },
      );
    }

    // Generate a randomized storage key — never trust client-supplied filenames
    const storageKey = generateStorageKey(contentType);

    // Optional metadata from submitter
    const submitterName = (formData.get("name") || "").toString().slice(0, 100);
    const caption = (formData.get("caption") || "").toString().slice(0, 500);

    // Store in R2 with metadata
    const r2Metadata = {
      originalFilename: (file.name || "unknown").slice(0, 255),
      contentType,
      submitterName,
      caption,
      uploadedAt: new Date().toISOString(),
      clientIp,
    };

    await bucket.put(storageKey, file.stream(), {
      httpMetadata: { contentType },
      customMetadata: r2Metadata,
    });

    return new Response(
      JSON.stringify({
        success: true,
        message:
          "Upload received. Thank you! The team will review your submission.",
      }),
      { status: 200, headers },
    );
  } catch (err) {
    console.error("Media upload error:", err);
    return new Response(
      JSON.stringify({ error: "Upload failed. Please try again." }),
      { status: 500, headers },
    );
  }
}
