// Cloudflare Pages Function — FAF Media Review (Admin)
// Admin-only tool for reviewing, approving, rejecting, and deleting
// media uploads in the R2 bucket. Completely separate credential
// from the fan-facing upload passcode.
//
// Security gates:
//   1. Server-side admin passcode check (env: FAF_MEDIA_ADMIN_PASSCODE)
//   2. Fan upload passcode (FAF_MEDIA_PASSCODE) explicitly rejected
//   3. All object keys validated to stay within uploads/ prefix
//   4. No public/unauthenticated read path into the bucket
//
// Endpoints:
//   GET  ?action=list   — list objects, optional &status= filter
//   GET  ?action=serve&key= — stream an R2 object (for previews)
//   POST {action:"approve"|"reject"|"delete", key, passcode}
//   OPTIONS — CORS preflight

import {
  corsHeaders,
  validateAdminPasscode,
  errorResponse,
} from "../lib/admin-auth.js";

const UPLOADS_PREFIX = "uploads/";
const STATUS_KEY_PREFIX = "media-status:";
const LIST_PAGE_SIZE = 50;

function validateObjectKey(key) {
  if (!key || typeof key !== "string") return false;
  // Must start with uploads/ prefix
  if (!key.startsWith(UPLOADS_PREFIX)) return false;
  // Block path traversal
  if (key.includes("..")) return false;
  if (key.includes("//")) return false;
  // Must have something after the prefix
  const remainder = key.slice(UPLOADS_PREFIX.length);
  if (!remainder || remainder.length === 0) return false;
  // No sub-directories or slashes after prefix
  if (remainder.includes("/")) return false;
  return true;
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get("Origin") || "";
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin") || "";
  const cors = corsHeaders(origin);
  const headers = { "Content-Type": "application/json", ...cors };

  try {
    const url = new URL(context.request.url);
    const action = url.searchParams.get("action");
    const passcode = url.searchParams.get("passcode");

    // Admin passcode validation
    const auth = validateAdminPasscode(context.env, passcode);
    if (!auth.valid) {
      const msg =
        auth.reason === "not-configured"
          ? "Media review is not configured."
          : "Invalid admin passcode.";
      return errorResponse(msg, auth.status, cors);
    }

    const bucket = context.env.MEDIA_BUCKET;
    if (!bucket) {
      return errorResponse("Storage is not configured.", 500, cors);
    }

    // --- LIST ---
    if (action === "list") {
      const statusFilter = url.searchParams.get("status") || "";
      const cursor = url.searchParams.get("cursor") || undefined;
      const kv = context.env.FAF_KV;

      const listed = await bucket.list({
        prefix: UPLOADS_PREFIX,
        limit: LIST_PAGE_SIZE,
        cursor,
        include: ["httpMetadata", "customMetadata"],
      });

      const items = [];
      for (const obj of listed.objects) {
        // Get status from KV (absent = pending)
        let status = "pending";
        let reviewedAt = null;
        if (kv) {
          const statusEntry = await kv.get(STATUS_KEY_PREFIX + obj.key, {
            type: "json",
          });
          if (statusEntry) {
            status = statusEntry.status || "pending";
            reviewedAt = statusEntry.reviewedAt || null;
          }
        }

        // Apply status filter
        if (statusFilter && status !== statusFilter) continue;

        // Extract metadata
        const meta = obj.customMetadata || {};
        items.push({
          key: obj.key,
          size: obj.size,
          uploaded: obj.uploaded
            ? obj.uploaded.toISOString()
            : meta.uploadedAt || null,
          contentType:
            meta.contentType ||
            obj.httpMetadata?.contentType ||
            "application/octet-stream",
          originalFilename: meta.originalFilename || null,
          submitterName: meta.submitterName || null,
          caption: meta.caption || null,
          status,
          reviewedAt,
        });
      }

      return new Response(
        JSON.stringify({
          items,
          cursor: listed.truncated ? listed.cursor : null,
          truncated: listed.truncated || false,
        }),
        { status: 200, headers },
      );
    }

    // --- SERVE ---
    if (action === "serve") {
      const key = url.searchParams.get("key");
      if (!validateObjectKey(key)) {
        return errorResponse("Invalid object key.", 400, cors);
      }

      const obj = await bucket.get(key);
      if (!obj) {
        return errorResponse("Object not found.", 404, cors);
      }

      const contentType =
        obj.httpMetadata?.contentType || "application/octet-stream";
      return new Response(obj.body, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(obj.size),
          "Cache-Control": "private, no-store",
          ...cors,
        },
      });
    }

    return errorResponse(
      "Unknown action. Use action=list or action=serve.",
      400,
      cors,
    );
  } catch (err) {
    console.error("Media review GET error:", err);
    return errorResponse("Internal error.", 500, cors);
  }
}

export async function onRequestPost(context) {
  const origin = context.request.headers.get("Origin") || "";
  const cors = corsHeaders(origin);
  const headers = { "Content-Type": "application/json", ...cors };

  try {
    let body;
    try {
      body = await context.request.json();
    } catch {
      return errorResponse("Invalid JSON body.", 400, cors);
    }

    const { action, key, passcode } = body;

    // Admin passcode validation
    const auth = validateAdminPasscode(context.env, passcode);
    if (!auth.valid) {
      const msg =
        auth.reason === "not-configured"
          ? "Media review is not configured."
          : "Invalid admin passcode.";
      return errorResponse(msg, auth.status, cors);
    }

    // Validate object key
    if (!validateObjectKey(key)) {
      return errorResponse("Invalid object key.", 400, cors);
    }

    const bucket = context.env.MEDIA_BUCKET;
    if (!bucket) {
      return errorResponse("Storage is not configured.", 500, cors);
    }

    const kv = context.env.FAF_KV;
    if (!kv) {
      return errorResponse("KV store is not configured.", 500, cors);
    }

    // --- APPROVE ---
    if (action === "approve") {
      // Confirm the object exists in R2
      const head = await bucket.head(key);
      if (!head) {
        return errorResponse("Object not found.", 404, cors);
      }

      await kv.put(
        STATUS_KEY_PREFIX + key,
        JSON.stringify({
          status: "approved",
          reviewedAt: new Date().toISOString(),
        }),
      );

      return new Response(
        JSON.stringify({ success: true, key, status: "approved" }),
        {
          status: 200,
          headers,
        },
      );
    }

    // --- REJECT ---
    if (action === "reject") {
      const head = await bucket.head(key);
      if (!head) {
        return errorResponse("Object not found.", 404, cors);
      }

      await kv.put(
        STATUS_KEY_PREFIX + key,
        JSON.stringify({
          status: "rejected",
          reviewedAt: new Date().toISOString(),
        }),
      );

      return new Response(
        JSON.stringify({ success: true, key, status: "rejected" }),
        {
          status: 200,
          headers,
        },
      );
    }

    // --- DELETE ---
    if (action === "delete") {
      // Confirm it exists before deleting
      const head = await bucket.head(key);
      if (!head) {
        return errorResponse("Object not found.", 404, cors);
      }

      await bucket.delete(key);

      // Clean up the status entry too
      await kv.delete(STATUS_KEY_PREFIX + key);

      return new Response(
        JSON.stringify({ success: true, key, deleted: true }),
        {
          status: 200,
          headers,
        },
      );
    }

    return errorResponse(
      "Unknown action. Use approve, reject, or delete.",
      400,
      cors,
    );
  } catch (err) {
    console.error("Media review POST error:", err);
    return errorResponse("Internal error.", 500, cors);
  }
}
