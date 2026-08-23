// Cloudflare Pages Function -- Feedback to ADO Story (Admin)
// POST endpoint, admin-passcode-protected.
// Creates an Azure DevOps User Story work item from a feedback entry.
//
// Calls the ADO REST API with a PAT stored as a Cloudflare Pages secret.
// Marks the feedback entry in KV as promoted to prevent duplicate creation.
//
// DEPENDENCIES:
//   FAF_KV                   -- KV binding
//   FAF_MEDIA_ADMIN_PASSCODE -- admin auth
//   ADO_PAT                  -- Azure DevOps Personal Access Token (secret)

import {
  corsHeaders,
  validateAdminPasscode,
  errorResponse,
} from "../lib/admin-auth.js";

const ADO_ORG = "haivio";
const ADO_PROJECT = "FAF Development";
const ADO_API_VERSION = "7.0";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildWorkItemBody(entry) {
  var title =
    "[Site Feedback] " +
    (entry.category || "general") +
    ": " +
    (entry.suggestion || "").slice(0, 80);

  var description =
    "<h3>Site Feedback Submission</h3>" +
    "<p><strong>Category:</strong> " +
    escapeHtml(entry.category) +
    "</p>" +
    "<p><strong>Priority:</strong> " +
    escapeHtml(entry.priority) +
    "</p>" +
    "<p><strong>Page:</strong> " +
    escapeHtml(entry.page || "(unknown)") +
    "</p>" +
    "<p><strong>Submitted:</strong> " +
    escapeHtml(entry.createdAt || "(unknown)") +
    "</p>" +
    "<hr/>" +
    "<p>" +
    escapeHtml(entry.suggestion || "").replace(/\n/g, "<br/>") +
    "</p>";

  if (entry.name) {
    description +=
      "<p><strong>From:</strong> " + escapeHtml(entry.name) + "</p>";
  }
  if (entry.email) {
    description +=
      "<p><strong>Email:</strong> " + escapeHtml(entry.email) + "</p>";
  }

  description +=
    "<p><em>Auto-created from site feedback ID: " +
    escapeHtml(entry.id) +
    "</em></p>";

  // ADO work item PATCH body uses JSON Patch format
  return {
    title: title,
    ops: [
      {
        op: "add",
        path: "/fields/System.Title",
        value: title,
      },
      {
        op: "add",
        path: "/fields/System.Description",
        value: description,
      },
      {
        op: "add",
        path: "/fields/System.Tags",
        value: "site-feedback; auto-created",
      },
    ],
  };
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get("Origin") || "";
  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin, "POST, OPTIONS"),
  });
}

export async function onRequestPost(context) {
  const origin = context.request.headers.get("Origin") || "";
  const cors = corsHeaders(origin, "POST, OPTIONS");
  const headers = { "Content-Type": "application/json", ...cors };

  try {
    let body;
    try {
      body = await context.request.json();
    } catch {
      return errorResponse("Invalid JSON body.", 400, cors);
    }

    const { passcode, feedbackId } = body;

    // Admin auth
    const auth = validateAdminPasscode(context.env, passcode);
    if (!auth.valid) {
      const msg =
        auth.reason === "not-configured"
          ? "Not configured."
          : "Invalid admin passcode.";
      return errorResponse(msg, auth.status, cors);
    }

    // Validate feedbackId
    if (!feedbackId || typeof feedbackId !== "string") {
      return errorResponse("feedbackId is required.", 400, cors);
    }

    const kv = context.env.FAF_KV;
    if (!kv) {
      return errorResponse("Storage is not configured.", 500, cors);
    }

    const adoPat = context.env.ADO_PAT;
    if (!adoPat) {
      return errorResponse(
        "ADO integration is not configured. Set ADO_PAT secret.",
        500,
        cors,
      );
    }

    // Load the feedback entry
    const kvKey = "feedback:" + feedbackId;
    const entry = await kv.get(kvKey, { type: "json" });
    if (!entry) {
      return errorResponse("Feedback entry not found.", 404, cors);
    }

    // Check if already promoted
    if (entry.adoWorkItemId) {
      return new Response(
        JSON.stringify({
          success: true,
          alreadyExists: true,
          workItemId: entry.adoWorkItemId,
          message: "Story already exists for this feedback.",
        }),
        { status: 200, headers },
      );
    }

    // Build the work item
    const workItem = buildWorkItemBody(entry);

    // Call ADO REST API
    const adoUrl =
      "https://dev.azure.com/" +
      encodeURIComponent(ADO_ORG) +
      "/" +
      encodeURIComponent(ADO_PROJECT) +
      "/_apis/wit/workitems/$User%20Story?api-version=" +
      ADO_API_VERSION;

    const adoAuth = btoa(":" + adoPat);

    const adoResponse = await fetch(adoUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json-patch+json",
        Authorization: "Basic " + adoAuth,
      },
      body: JSON.stringify(workItem.ops),
    });

    if (!adoResponse.ok) {
      const adoError = await adoResponse.text();
      console.error("ADO API error:", adoResponse.status, adoError);
      return errorResponse(
        "Failed to create ADO work item (HTTP " + adoResponse.status + ").",
        502,
        cors,
      );
    }

    const adoResult = await adoResponse.json();
    const workItemId = adoResult.id;

    // Mark the feedback entry as promoted (write back to KV)
    entry.adoWorkItemId = workItemId;
    entry.promotedAt = new Date().toISOString();
    await kv.put(kvKey, JSON.stringify(entry));

    return new Response(
      JSON.stringify({
        success: true,
        workItemId: workItemId,
        message: "Story created in ADO.",
      }),
      { status: 200, headers },
    );
  } catch (err) {
    console.error("Feedback-to-story error:", err);
    return errorResponse("Internal error.", 500, cors);
  }
}

export async function onRequestGet() {
  return new Response("Method not allowed", { status: 405 });
}
