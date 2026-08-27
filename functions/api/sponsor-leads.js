// Cloudflare Pages Function -- Sponsor Lead Management (Admin)
//
// Authenticated API for managing sponsor/partner leads ("cold call CRM").
// All actions require the same admin passcode as media-review.js.
//
// GET actions (passcode in query string):
//   ?action=list -- returns all leads from the index
//
// POST actions (passcode in JSON body):
//   action: "add-lead"      -- create a new lead
//   action: "update-lead"   -- update fields on an existing lead by id
//   action: "remove-lead"   -- soft-delete: sets status to "removed"
//
// DEPENDENCIES:
//   FAF_KV                   -- KV binding
//   FAF_MEDIA_ADMIN_PASSCODE -- admin auth

import {
  corsHeaders,
  validateAdminPasscode,
  errorResponse,
} from "../lib/admin-auth.js";

const INDEX_KEY = "sponsor-leads-index";

function leadKey(id) {
  return `sponsor-lead:${id}`;
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get("Origin") || "";
  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin, "GET, POST, OPTIONS"),
  });
}

// Load all leads from the index.
async function loadAllLeads(kv) {
  const indexRaw = await kv.get(INDEX_KEY);
  if (!indexRaw) return [];

  let ids;
  try {
    ids = JSON.parse(indexRaw);
  } catch {
    return [];
  }

  if (!Array.isArray(ids)) return [];

  const leads = [];
  for (const id of ids) {
    const raw = await kv.get(leadKey(id));
    if (!raw) continue;
    try {
      const lead = JSON.parse(raw);
      leads.push(lead);
    } catch {
      // skip corrupted entries
    }
  }

  return leads;
}

export async function onRequestGet(context) {
  const origin = context.request.headers.get("Origin") || "";
  const cors = corsHeaders(origin, "GET, POST, OPTIONS");
  const headers = { "Content-Type": "application/json", ...cors };

  try {
    const url = new URL(context.request.url);
    const passcode = url.searchParams.get("passcode");
    const action = url.searchParams.get("action");

    const auth = validateAdminPasscode(context.env, passcode);
    if (!auth.valid) {
      const msg =
        auth.reason === "not-configured"
          ? "Not configured."
          : "Invalid admin passcode.";
      return new Response(JSON.stringify({ error: msg }), {
        status: auth.status,
        headers,
      });
    }

    const kv = context.env.FAF_KV;
    if (!kv) {
      return new Response(
        JSON.stringify({ error: "Storage is not configured." }),
        { status: 500, headers },
      );
    }

    if (action === "list") {
      const leads = await loadAllLeads(kv);
      return new Response(JSON.stringify({ leads }), {
        status: 200,
        headers,
      });
    }

    // Default: return count
    const leads = await loadAllLeads(kv);
    const activeCount = leads.filter((l) => l.status !== "removed").length;

    return new Response(JSON.stringify({ count: activeCount }), {
      status: 200,
      headers,
    });
  } catch (err) {
    console.error("Sponsor leads GET error:", err);
    return new Response(JSON.stringify({ error: "Internal error." }), {
      status: 500,
      headers,
    });
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

    // --- ADD LEAD ---
    if (action === "add-lead") {
      const { businessName, category, city, contactInfo, source } = body;

      if (!businessName || !category || !city || !contactInfo || !source) {
        return errorResponse(
          "businessName, category, city, contactInfo, and source are required.",
          400,
          cors,
        );
      }

      const id = generateId();
      const now = new Date().toISOString();

      const lead = {
        id,
        businessName,
        category,
        city,
        contactInfo,
        source,
        status: body.status || "new",
        promising: body.promising || null,
        relationshipType: body.relationshipType || "undecided",
        notes: [],
        createdAt: now,
        updatedAt: now,
      };

      // Save lead
      await kv.put(leadKey(id), JSON.stringify(lead));

      // Update index
      const indexRaw = await kv.get(INDEX_KEY);
      let ids = [];
      if (indexRaw) {
        try {
          ids = JSON.parse(indexRaw);
          if (!Array.isArray(ids)) ids = [];
        } catch {
          ids = [];
        }
      }
      ids.push(id);
      await kv.put(INDEX_KEY, JSON.stringify(ids));

      return new Response(JSON.stringify({ success: true, lead }), {
        status: 200,
        headers,
      });
    }

    // --- UPDATE LEAD ---
    if (action === "update-lead") {
      const { id } = body;
      if (!id) {
        return errorResponse("id is required.", 400, cors);
      }

      const raw = await kv.get(leadKey(id));
      if (!raw) {
        return errorResponse("Lead not found.", 404, cors);
      }

      let lead;
      try {
        lead = JSON.parse(raw);
      } catch {
        return errorResponse("Lead data corrupted.", 500, cors);
      }

      // Update allowed fields
      if (body.businessName !== undefined)
        lead.businessName = body.businessName;
      if (body.category !== undefined) lead.category = body.category;
      if (body.city !== undefined) lead.city = body.city;
      if (body.contactInfo !== undefined) lead.contactInfo = body.contactInfo;
      if (body.source !== undefined) lead.source = body.source;
      if (body.status !== undefined) lead.status = body.status;
      if (body.promising !== undefined) lead.promising = body.promising;
      if (body.relationshipType !== undefined)
        lead.relationshipType = body.relationshipType;

      // Append a new note if provided
      if (body.note && typeof body.note === "string" && body.note.trim()) {
        if (!Array.isArray(lead.notes)) lead.notes = [];
        lead.notes.push({
          text: body.note.trim(),
          timestamp: new Date().toISOString(),
        });
      }

      lead.updatedAt = new Date().toISOString();

      await kv.put(leadKey(id), JSON.stringify(lead));

      return new Response(JSON.stringify({ success: true, lead }), {
        status: 200,
        headers,
      });
    }

    // --- REMOVE LEAD (soft-delete) ---
    if (action === "remove-lead") {
      const { id } = body;
      if (!id) {
        return errorResponse("id is required.", 400, cors);
      }

      const raw = await kv.get(leadKey(id));
      if (!raw) {
        return errorResponse("Lead not found.", 404, cors);
      }

      let lead;
      try {
        lead = JSON.parse(raw);
      } catch {
        return errorResponse("Lead data corrupted.", 500, cors);
      }

      lead.status = "removed";
      lead.removedAt = new Date().toISOString();
      lead.updatedAt = new Date().toISOString();

      await kv.put(leadKey(id), JSON.stringify(lead));

      return new Response(
        JSON.stringify({
          success: true,
          id: lead.id,
          businessName: lead.businessName,
          newStatus: "removed",
          removedAt: lead.removedAt,
        }),
        { status: 200, headers },
      );
    }

    return errorResponse(
      "Unknown action. Use add-lead, update-lead, or remove-lead.",
      400,
      cors,
    );
  } catch (err) {
    console.error("Sponsor leads POST error:", err);
    return errorResponse("Internal error.", 500, cors);
  }
}
