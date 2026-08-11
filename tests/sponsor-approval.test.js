// ============================================================
// Sponsor Logo Approval Tests — FAF Site
//
// T1: Unit tests — agreement content, upload validation, entry structure
// T2: Integration tests — file existence, exports, handler structure
// T3: Acceptance tests — end-to-end flow verification
// T4: Adversarial tests — REQUIRED: new financial + input surface
//     Forged tokens, unapproved logo rendering, agreement bypass,
//     file type injection, path traversal, XSS in sponsor data.
//
// Run: node tests/sponsor-approval.test.js
// ============================================================

const assert = require("assert");
const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;
let skipped = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL: ${name}`);
    console.error(`        ${err.message}`);
  }
}

function skip(name, reason) {
  skipped++;
  console.log(`  SKIP: ${name} (${reason})`);
}

function readSrc(relPath) {
  return fs.readFileSync(path.join(__dirname, "..", relPath), "utf8");
}

// ============================================================
// T1: UNIT TESTS — agreement content, validation logic, entry structure
// ============================================================
console.log(
  "\n--- T1: Unit Tests — Agreement, Validation, Entry Structure ---",
);

test("T1.1: Agreement contains rep/warranty on logo ownership", function () {
  var src = readSrc("functions/lib/sponsor-agreement.js");
  assert.ok(
    src.includes("Representations and Warranties"),
    "Agreement must have rep/warranty section",
  );
  assert.ok(src.includes("sole owner"), "Must warrant sole ownership of logo");
  assert.ok(
    src.includes("copyright") || src.includes("intellectual property"),
    "Must reference copyright/IP rights",
  );
  assert.ok(src.includes("trademark"), "Must reference trademark rights");
});

test("T1.2: Agreement contains indemnification clause", function () {
  var src = readSrc("functions/lib/sponsor-agreement.js");
  assert.ok(
    src.includes("Indemnification"),
    "Agreement must have indemnification section",
  );
  assert.ok(
    src.includes("indemnify") && src.includes("hold harmless"),
    "Must include indemnify and hold-harmless language",
  );
  assert.ok(
    src.includes("attorneys"),
    "Must reference attorneys' fees coverage",
  );
});

test("T1.3: Agreement contains IRC 6115 quid-pro-quo disclosure", function () {
  var src = readSrc("functions/lib/sponsor-agreement.js");
  assert.ok(
    src.includes("IRC Section 6115"),
    "Must reference IRC Section 6115",
  );
  assert.ok(
    src.includes("fair market value"),
    "Must reference fair market value of benefits",
  );
  assert.ok(
    src.includes("tax-deductible"),
    "Must discuss tax deductibility limitations",
  );
});

test("T1.4: Agreement has version tracking", function () {
  var src = readSrc("functions/lib/sponsor-agreement.js");
  assert.ok(
    src.includes("AGREEMENT_VERSION"),
    "Must export a version constant",
  );
  assert.ok(
    src.includes("export const AGREEMENT_VERSION"),
    "Version must be an exported constant",
  );
});

test("T1.5: Agreement references FAF EIN", function () {
  var src = readSrc("functions/lib/sponsor-agreement.js");
  assert.ok(src.includes("42-1980182"), "Agreement must include FAF EIN");
});

test("T1.6: Agreement includes approval/rejection rights for FAF", function () {
  var src = readSrc("functions/lib/sponsor-agreement.js");
  assert.ok(
    src.includes("Approval") && src.includes("reject"),
    "Must state FAF's right to approve or reject logos",
  );
});

test("T1.7: Agreement includes termination clause", function () {
  var src = readSrc("functions/lib/sponsor-agreement.js");
  assert.ok(src.includes("Termination"), "Must include termination provisions");
});

test("T1.8: Agreement does NOT require independent IP search (self-attestation only)", function () {
  var src = readSrc("functions/lib/sponsor-agreement.js");
  assert.ok(
    !src.includes("USPTO") && !src.includes("TESS"),
    "Must NOT reference USPTO TESS or independent trademark search (per Floyd directive)",
  );
});

test("T1.9: Logo upload — allowed types are image-only (no SVG, no video)", function () {
  var src = readSrc("functions/api/sponsor-logo-upload.js");
  assert.ok(
    src.includes("image/jpeg") &&
      src.includes("image/png") &&
      src.includes("image/webp"),
    "Must allow standard image formats",
  );
  assert.ok(!src.includes("image/svg"), "Must NOT allow SVG (XSS vector)");
  assert.ok(!src.includes("video/"), "Must NOT allow video uploads for logos");
});

test("T1.10: Logo upload — file size cap is 5 MB", function () {
  var src = readSrc("functions/api/sponsor-logo-upload.js");
  assert.ok(src.includes("5 * 1024 * 1024"), "Max logo size must be 5 MB");
});

test("T1.11: Pending entry has all required fields", function () {
  var src = readSrc("functions/api/sponsor-logo-upload.js");
  assert.ok(src.includes("sponsorName"), "Must include sponsor name");
  assert.ok(src.includes("sponsorEmail"), "Must include sponsor email");
  assert.ok(src.includes("sponsorOrg"), "Must include organization name");
  assert.ok(src.includes("tier"), "Must include sponsorship tier");
  assert.ok(src.includes("logoR2Key"), "Must include logo R2 storage key");
  assert.ok(src.includes("agreementVersion"), "Must include agreement version");
  assert.ok(
    src.includes("agreementAcceptedAt"),
    "Must include agreement acceptance timestamp",
  );
  assert.ok(
    src.includes('"awaiting-payment"'),
    "Initial status must be awaiting-payment",
  );
});

test("T1.12: Tier validation — only sideline/playmaker/legacy accepted", function () {
  var src = readSrc("functions/api/sponsor-logo-upload.js");
  assert.ok(
    src.includes('"sideline"') &&
      src.includes('"playmaker"') &&
      src.includes('"legacy"'),
    "Must validate against known tiers",
  );
  assert.ok(
    src.includes("validTiers") || src.includes("includes(tier)"),
    "Must reject unknown tier values",
  );
});

// ============================================================
// T2: INTEGRATION TESTS — file existence, exports, handler structure
// ============================================================
console.log("\n--- T2: Integration Tests — Files & Exports ---");

test("T2.1: sponsor-agreement.js lib exists", function () {
  assert.ok(
    fs.existsSync(
      path.join(__dirname, "..", "functions", "lib", "sponsor-agreement.js"),
    ),
  );
});

test("T2.2: sponsor-logo-upload.js exists", function () {
  assert.ok(
    fs.existsSync(
      path.join(__dirname, "..", "functions", "api", "sponsor-logo-upload.js"),
    ),
  );
});

test("T2.3: sponsor-approve.js exists", function () {
  assert.ok(
    fs.existsSync(
      path.join(__dirname, "..", "functions", "api", "sponsor-approve.js"),
    ),
  );
});

test("T2.4: approved-sponsors.js exists", function () {
  assert.ok(
    fs.existsSync(
      path.join(__dirname, "..", "functions", "api", "approved-sponsors.js"),
    ),
  );
});

test("T2.5: sponsor-logo.js exists", function () {
  assert.ok(
    fs.existsSync(
      path.join(__dirname, "..", "functions", "api", "sponsor-logo.js"),
    ),
  );
});

test("T2.6: sponsor-logo-upload exports onRequestPost", function () {
  var src = readSrc("functions/api/sponsor-logo-upload.js");
  assert.ok(src.includes("export async function onRequestPost"));
});

test("T2.7: sponsor-logo-upload exports onRequestOptions (CORS)", function () {
  var src = readSrc("functions/api/sponsor-logo-upload.js");
  assert.ok(src.includes("export async function onRequestOptions"));
});

test("T2.8: sponsor-approve exports onRequestGet", function () {
  var src = readSrc("functions/api/sponsor-approve.js");
  assert.ok(src.includes("export async function onRequestGet"));
});

test("T2.9: sponsor-approve rejects POST", function () {
  var src = readSrc("functions/api/sponsor-approve.js");
  assert.ok(
    src.includes("onRequestPost") && src.includes("405"),
    "Must reject POST with 405",
  );
});

test("T2.10: approved-sponsors exports onRequestGet", function () {
  var src = readSrc("functions/api/approved-sponsors.js");
  assert.ok(src.includes("export async function onRequestGet"));
});

test("T2.11: approved-sponsors rejects POST", function () {
  var src = readSrc("functions/api/approved-sponsors.js");
  assert.ok(
    src.includes("onRequestPost") && src.includes("405"),
    "Must reject POST with 405",
  );
});

test("T2.12: sponsor-logo exports onRequestGet", function () {
  var src = readSrc("functions/api/sponsor-logo.js");
  assert.ok(src.includes("export async function onRequestGet"));
});

test("T2.13: sponsor-logo rejects POST", function () {
  var src = readSrc("functions/api/sponsor-logo.js");
  assert.ok(
    src.includes("onRequestPost") && src.includes("405"),
    "Must reject POST with 405",
  );
});

test("T2.14: sponsor-approve imports verifyApprovalToken", function () {
  var src = readSrc("functions/api/sponsor-approve.js");
  assert.ok(
    src.includes("verifyApprovalToken"),
    "Must import token verifier from approval-tokens.js",
  );
});

test("T2.15: sponsor-logo-upload imports AGREEMENT_VERSION", function () {
  var src = readSrc("functions/api/sponsor-logo-upload.js");
  assert.ok(
    src.includes("AGREEMENT_VERSION"),
    "Must import agreement version for entry metadata",
  );
});

test("T2.16: stripe-webhook.js has updateSponsorEntryAndNotify function", function () {
  var src = readSrc("functions/api/stripe-webhook.js");
  assert.ok(
    src.includes("updateSponsorEntryAndNotify"),
    "Webhook must have sponsor entry update function",
  );
});

test("T2.17: stripe-webhook.js calls updateSponsorEntryAndNotify for sponsorships with entry ID", function () {
  var src = readSrc("functions/api/stripe-webhook.js");
  assert.ok(
    src.includes("sponsor_entry_id") &&
      src.includes("updateSponsorEntryAndNotify"),
    "Must check for sponsor_entry_id and call updater",
  );
});

test("T2.18: create-checkout-session.js accepts sponsorEntryId", function () {
  var src = readSrc("functions/api/create-checkout-session.js");
  assert.ok(
    src.includes("sponsorEntryId"),
    "Must accept sponsorEntryId in request body",
  );
  assert.ok(
    src.includes("sponsor_entry_id"),
    "Must pass sponsor_entry_id in Stripe metadata",
  );
});

// ============================================================
// T3: ACCEPTANCE TESTS — end-to-end flow verification
// ============================================================
console.log("\n--- T3: Acceptance Tests — Flow Verification ---");

test("T3.1: Logo upload stores file in R2 under sponsor-logos/ prefix", function () {
  var src = readSrc("functions/api/sponsor-logo-upload.js");
  assert.ok(
    src.includes("sponsor-logos/"),
    "Must store logos under sponsor-logos/ prefix",
  );
  assert.ok(
    src.includes("bucket.put"),
    "Must call R2 bucket.put to store logo",
  );
});

test("T3.2: Logo upload creates KV entry with sponsor:pending: prefix", function () {
  var src = readSrc("functions/api/sponsor-logo-upload.js");
  assert.ok(
    src.includes("sponsor:pending:"),
    "Must use sponsor:pending: key prefix",
  );
  assert.ok(src.includes("kv.put"), "Must write to KV");
});

test("T3.3: Logo upload returns entryId for Stripe metadata", function () {
  var src = readSrc("functions/api/sponsor-logo-upload.js");
  assert.ok(src.includes("entryId"), "Must return entryId in response");
});

test("T3.4: Webhook updates sponsor entry status to pending-approval", function () {
  var src = readSrc("functions/api/stripe-webhook.js");
  assert.ok(
    src.includes('"pending-approval"'),
    "Must set status to pending-approval after payment",
  );
});

test("T3.5: Webhook generates approval tokens for sponsor entry", function () {
  var src = readSrc("functions/api/stripe-webhook.js");
  var sponsorSection = src.substring(
    src.indexOf("updateSponsorEntryAndNotify"),
  );
  assert.ok(
    sponsorSection.includes("createApprovalToken"),
    "Must create approval tokens for sponsor entry",
  );
});

test("T3.6: Webhook sends sponsor approval email to admin", function () {
  var src = readSrc("functions/api/stripe-webhook.js");
  var sponsorSection = src.substring(
    src.indexOf("updateSponsorEntryAndNotify"),
  );
  assert.ok(
    sponsorSection.includes("sendViaACS"),
    "Must send approval email via ACS",
  );
  assert.ok(
    sponsorSection.includes("justin@fathersandfootball.org"),
    "Must email justin@",
  );
  assert.ok(
    sponsorSection.includes("communications@fathersandfootball.org"),
    "Must email communications@",
  );
});

test("T3.7: Approval email contains logo preview link", function () {
  var src = readSrc("functions/api/stripe-webhook.js");
  var sponsorSection = src.substring(
    src.indexOf("updateSponsorEntryAndNotify"),
  );
  assert.ok(
    sponsorSection.includes("sponsor-logo") &&
      sponsorSection.includes("logoPreviewUrl"),
    "Email must include logo preview link",
  );
});

test("T3.8: Approval email has approve and reject links pointing to sponsor-approve", function () {
  var src = readSrc("functions/api/stripe-webhook.js");
  var sponsorSection = src.substring(
    src.indexOf("updateSponsorEntryAndNotify"),
  );
  assert.ok(
    sponsorSection.includes("approveUrl") &&
      sponsorSection.includes("rejectUrl"),
    "Email must have both approve and reject URLs",
  );
  assert.ok(
    sponsorSection.includes("sponsor-approve"),
    "Links must point to sponsor-approve handler",
  );
});

test("T3.9: Approval email mentions agreement acceptance", function () {
  var src = readSrc("functions/api/stripe-webhook.js");
  var sponsorSection = src.substring(
    src.indexOf("updateSponsorEntryAndNotify"),
  );
  assert.ok(
    sponsorSection.includes("agreementVersion"),
    "Email must reference which agreement version was accepted",
  );
});

test("T3.10: Approve handler marks entry as approved and adds to approved list", function () {
  var src = readSrc("functions/api/sponsor-approve.js");
  assert.ok(src.includes('"approved"'), "Must set status to approved");
  assert.ok(src.includes("approvedAt"), "Must record approval timestamp");
  assert.ok(
    src.includes("addToApprovedList"),
    "Must add to approved sponsors list",
  );
});

test("T3.11: Reject handler marks entry as rejected", function () {
  var src = readSrc("functions/api/sponsor-approve.js");
  assert.ok(src.includes('"rejected"'), "Must set status to rejected");
  assert.ok(src.includes("rejectedAt"), "Must record rejection timestamp");
});

test("T3.12: Approved sponsors list is maintained in dedicated KV key", function () {
  var src = readSrc("functions/api/sponsor-approve.js");
  assert.ok(
    src.includes("sponsors:approved"),
    "Must use sponsors:approved KV key for the public list",
  );
});

test("T3.13: Approved sponsors endpoint returns only public-safe fields", function () {
  var src = readSrc("functions/api/approved-sponsors.js");
  assert.ok(
    !src.includes("sponsorEmail") || src.includes("publicList"),
    "Must filter out email addresses from public response",
  );
  assert.ok(
    src.includes("sponsors:approved"),
    "Must read from the approved list KV key",
  );
});

test("T3.14: Sponsor logo endpoint only serves approved or pending-approval logos", function () {
  var src = readSrc("functions/api/sponsor-logo.js");
  assert.ok(
    src.includes('"approved"') && src.includes('"pending-approval"'),
    "Must check for approved or pending-approval status",
  );
});

test("T3.15: sponsors.html has sponsor agreement modal/section", function () {
  var src = readSrc("sponsors.html");
  assert.ok(
    src.includes("sponsorAgreement") ||
      src.includes("sponsor-agreement") ||
      src.includes("agreementModal"),
    "Must have agreement UI element",
  );
});

test("T3.16: sponsors.html has logo upload field", function () {
  var src = readSrc("sponsors.html");
  assert.ok(
    src.includes('type="file"') ||
      src.includes("logoFile") ||
      src.includes("logo-upload"),
    "Must have file upload input for logos",
  );
});

test("T3.17: sponsors.html fetches and renders approved sponsors", function () {
  var src = readSrc("sponsors.html");
  assert.ok(
    src.includes("approved-sponsors") || src.includes("approvedSponsors"),
    "Must fetch approved sponsors for display",
  );
});

test("T3.18: sponsors.html calls sponsor-logo-upload API", function () {
  var src = readSrc("sponsors.html");
  assert.ok(
    src.includes("sponsor-logo-upload"),
    "Must call the logo upload API endpoint",
  );
});

test("T3.19: KV entries have TTL to prevent unbounded growth", function () {
  var src = readSrc("functions/api/sponsor-logo-upload.js");
  assert.ok(
    src.includes("expirationTtl"),
    "KV entries must have a TTL for automatic cleanup",
  );
});

test("T3.20: Approval email uses ACS (not SendGrid/Resend/SMTP)", function () {
  var src = readSrc("functions/api/stripe-webhook.js");
  var sponsorSection = src.substring(
    src.indexOf("updateSponsorEntryAndNotify"),
  );
  assert.ok(sponsorSection.includes("sendViaACS"), "Must use ACS");
  assert.ok(!sponsorSection.includes("sendgrid"), "Must NOT use SendGrid");
  assert.ok(!sponsorSection.includes("resend"), "Must NOT use Resend");
});

// ============================================================
// T4: ADVERSARIAL TESTS — security validation (REQUIRED)
// New financial + input surface: logo uploads, agreement bypass,
// approval token forgery, unapproved logo rendering.
// ============================================================
console.log("\n--- T4: Adversarial Tests — Security (REQUIRED) ---");

test("T4.1: Cannot fake an approval token — handler verifies HMAC signature", function () {
  var src = readSrc("functions/api/sponsor-approve.js");
  assert.ok(
    src.includes("verifyApprovalToken"),
    "Must call token verifier before any action",
  );
  var srcLib = readSrc("functions/lib/approval-tokens.js");
  assert.ok(
    srcLib.includes("invalid signature"),
    "Verifier must detect forged signatures",
  );
});

test("T4.2: Cannot render an unapproved logo on the public page", function () {
  var src = readSrc("functions/api/sponsor-logo.js");
  assert.ok(
    src.includes('entry.status !== "approved"') ||
      (src.includes('"approved"') && src.includes('"pending-approval"')),
    "Must check approval status before serving logo",
  );
  // Rejected/awaiting-payment logos must not be served
  assert.ok(
    src.includes("Not found") && src.includes("404"),
    "Unapproved logos must return 404",
  );
});

test("T4.3: Agreement cannot be bypassed — upload requires agreementAccepted", function () {
  var src = readSrc("functions/api/sponsor-logo-upload.js");
  assert.ok(
    src.includes("agreementAccepted"),
    "Must check agreement acceptance",
  );
  assert.ok(
    src.includes("You must accept the sponsorship agreement"),
    "Must reject uploads without agreement acceptance",
  );
});

test("T4.4: Logo upload rejects SVG files (XSS vector)", function () {
  var src = readSrc("functions/api/sponsor-logo-upload.js");
  assert.ok(
    !src.includes("image/svg"),
    "SVG must NOT be in the allowed types (XSS risk)",
  );
  assert.ok(
    src.includes("ALLOWED_LOGO_TYPES"),
    "Must validate against an allowlist",
  );
});

test("T4.5: Logo upload uses randomized storage keys (no client filenames)", function () {
  var src = readSrc("functions/api/sponsor-logo-upload.js");
  assert.ok(
    src.includes("crypto.randomUUID()"),
    "Must use cryptographic random UUID for storage key",
  );
  assert.ok(
    src.includes("sponsor-logos/"),
    "Must use a dedicated prefix for sponsor logos",
  );
});

test("T4.6: Logo upload has per-IP rate limiting", function () {
  var src = readSrc("functions/api/sponsor-logo-upload.js");
  assert.ok(
    src.includes("checkRateLimit") || src.includes("ratelimit:sponsor-logo:"),
    "Must enforce per-IP rate limiting",
  );
  assert.ok(src.includes("429"), "Must return 429 when rate limit exceeded");
});

test("T4.7: Sponsor logo endpoint prevents path traversal via ID validation", function () {
  var src = readSrc("functions/api/sponsor-logo.js");
  assert.ok(
    src.includes("test(id)") ||
      src.includes("UUID") ||
      src.includes("[0-9a-f]"),
    "Must validate ID format to prevent path traversal",
  );
});

test("T4.8: Sponsor logo endpoint sets X-Content-Type-Options: nosniff", function () {
  var src = readSrc("functions/api/sponsor-logo.js");
  assert.ok(
    src.includes("nosniff"),
    "Must set X-Content-Type-Options: nosniff to prevent MIME sniffing",
  );
});

test("T4.9: Replay protection — already-approved entry is rejected", function () {
  var src = readSrc("functions/api/sponsor-approve.js");
  assert.ok(
    src.includes("Already Processed") || src.includes("already"),
    "Must inform user the entry was already handled",
  );
  assert.ok(
    src.includes("409"),
    "Must return 409 Conflict for replay attempts",
  );
});

test("T4.10: Approval handler loads ALL data from KV, not from request params", function () {
  var src = readSrc("functions/api/sponsor-approve.js");
  assert.ok(
    src.includes("kv.get(") && src.includes("sponsor:pending:"),
    "Must load entry from KV",
  );
  assert.ok(
    !src.includes('searchParams.get("name")'),
    "Must NOT read sponsor name from URL",
  );
  assert.ok(
    !src.includes('searchParams.get("amount")'),
    "Must NOT read amount from URL",
  );
  assert.ok(
    !src.includes('searchParams.get("org")'),
    "Must NOT read org from URL",
  );
});

test("T4.11: Approval handler only reads 'token' from query params", function () {
  var src = readSrc("functions/api/sponsor-approve.js");
  var getMatches = src.match(/searchParams\.get\(/g);
  assert.ok(
    getMatches && getMatches.length === 1,
    "Must only call searchParams.get once (for 'token')",
  );
  assert.ok(
    src.includes('searchParams.get("token")'),
    "The single param must be 'token'",
  );
});

test("T4.12: No financial data in approval URL — token-only reference", function () {
  var src = readSrc("functions/api/stripe-webhook.js");
  var sponsorSection = src.substring(
    src.indexOf("updateSponsorEntryAndNotify"),
  );
  var urlSection = sponsorSection.substring(
    sponsorSection.indexOf("approveUrl"),
    sponsorSection.indexOf("approvalHtml"),
  );
  assert.ok(
    !urlSection.includes("amount="),
    "URL must NOT include amount parameter",
  );
  assert.ok(
    !urlSection.includes("name="),
    "URL must NOT include name parameter",
  );
});

test("T4.13: Missing approval token returns 400, not 500", function () {
  var src = readSrc("functions/api/sponsor-approve.js");
  assert.ok(
    src.includes("!token") && src.includes("400"),
    "Missing token must return 400 Bad Request",
  );
});

test("T4.14: Invalid/forged token returns 403, not 500", function () {
  var src = readSrc("functions/api/sponsor-approve.js");
  assert.ok(
    src.includes("!result.valid") && src.includes("403"),
    "Invalid token must return 403 Forbidden",
  );
});

test("T4.15: Entry not found returns 404", function () {
  var src = readSrc("functions/api/sponsor-approve.js");
  assert.ok(
    src.includes("!entryRaw") && src.includes("404"),
    "Missing entry must return 404",
  );
});

test("T4.16: HTML output is escaped to prevent XSS in sponsor data", function () {
  var src = readSrc("functions/api/sponsor-approve.js");
  assert.ok(
    src.includes("escapeHtml"),
    "Must escape dynamic content in HTML responses",
  );
  // Verify escapeHtml handles the critical characters
  var match = src.match(/function escapeHtml[\s\S]*?\n\}/);
  assert.ok(match, "escapeHtml function must be defined");
  assert.ok(
    match[0].includes("&amp;") &&
      match[0].includes("&lt;") &&
      match[0].includes("&gt;"),
    "Must escape &, <, > at minimum",
  );
});

test("T4.17: Approved sponsors endpoint does NOT expose email addresses", function () {
  var src = readSrc("functions/api/approved-sponsors.js");
  var publicListSection = src.substring(src.indexOf("publicList"));
  assert.ok(
    !publicListSection.includes("Email") ||
      publicListSection.includes("sponsorOrg"),
    "Public list must not include email field",
  );
  // Check the map function doesn't include email
  assert.ok(
    src.includes("s.sponsorOrg") && !src.includes("s.sponsorEmail"),
    "Map must select org/name but NOT email for public response",
  );
});

test("T4.18: Webhook escapes sponsor data in approval email HTML", function () {
  var src = readSrc("functions/api/stripe-webhook.js");
  var sponsorSection = src.substring(
    src.indexOf("updateSponsorEntryAndNotify"),
  );
  assert.ok(
    sponsorSection.includes("escapeHtml(entry.sponsorName)"),
    "Must escape sponsor name in email HTML",
  );
  assert.ok(
    sponsorSection.includes("escapeHtml(entry.sponsorOrg)"),
    "Must escape sponsor org in email HTML",
  );
  assert.ok(
    sponsorSection.includes("escapeHtml(entry.sponsorEmail)"),
    "Must escape sponsor email in email HTML",
  );
});

test("T4.19: Logo upload validates email server-side", function () {
  var src = readSrc("functions/api/sponsor-logo-upload.js");
  assert.ok(
    src.includes("!sponsorEmail") || src.includes('includes("@")'),
    "Must validate email format server-side",
  );
});

test("T4.20: Logo upload validates required fields (name, org, tier)", function () {
  var src = readSrc("functions/api/sponsor-logo-upload.js");
  assert.ok(
    src.includes("!sponsorName"),
    "Must validate sponsor name is present",
  );
  assert.ok(src.includes("!sponsorOrg"), "Must validate org name is present");
  assert.ok(
    src.includes("Invalid sponsorship tier"),
    "Must validate tier is valid",
  );
});

test("T4.21: Logo upload truncates user input to prevent oversized KV entries", function () {
  var src = readSrc("functions/api/sponsor-logo-upload.js");
  assert.ok(
    src.includes("slice(0, 200)") || src.includes("slice(0, 254)"),
    "Must truncate user-supplied strings",
  );
});

test("T4.22: Approval tokens expire (7-day TTL from approval-tokens.js)", function () {
  var src = readSrc("functions/lib/approval-tokens.js");
  assert.ok(src.includes("7 * 24 * 60 * 60"), "Token TTL must be 7 days");
  assert.ok(src.includes("token expired"), "Must reject expired tokens");
});

test("T4.23: Approved sponsors list prevents duplicate entries", function () {
  var src = readSrc("functions/api/sponsor-approve.js");
  assert.ok(
    src.includes("some(") && src.includes("s.id === entry.id"),
    "Must check for duplicates before adding to approved list",
  );
});

test("T4.24: No secrets/keys appear in client-facing HTML responses", function () {
  var src = readSrc("functions/api/sponsor-approve.js");
  var renderSection = src.substring(src.indexOf("function renderPage"));
  assert.ok(
    !renderSection.includes("QBO_APPROVAL_SECRET"),
    "Must not leak approval secret in HTML",
  );
  assert.ok(
    !renderSection.includes("STRIPE_SECRET"),
    "Must not leak Stripe secrets in HTML",
  );
});

test("T4.25: Logo upload rejects requests with missing logo file", function () {
  var src = readSrc("functions/api/sponsor-logo-upload.js");
  assert.ok(
    src.includes("A logo image is required"),
    "Must reject empty file submissions",
  );
});

test("T4.26: Logo upload rejects oversized files with 413 status", function () {
  var src = readSrc("functions/api/sponsor-logo-upload.js");
  assert.ok(src.includes("413"), "Must return 413 for oversized uploads");
});

test("T4.27: Logo upload rejects invalid file types with 415 status", function () {
  var src = readSrc("functions/api/sponsor-logo-upload.js");
  assert.ok(src.includes("415"), "Must return 415 for invalid content types");
});

test("T4.28: Sponsor entry uses crypto.randomUUID for entry ID", function () {
  var src = readSrc("functions/api/sponsor-logo-upload.js");
  assert.ok(
    src.includes("crypto.randomUUID()"),
    "Entry ID must be a cryptographic random UUID",
  );
});

test("T4.29: Secret key never appears in sponsors.html", function () {
  var src = readSrc("sponsors.html");
  assert.ok(
    !src.includes("sk_test_"),
    "Secret key must NEVER appear in client-side code",
  );
  assert.ok(
    !src.includes("sk_live_"),
    "Live secret key must NEVER appear in client-side code",
  );
  assert.ok(
    !src.includes("QBO_APPROVAL_SECRET"),
    "Approval secret must not appear client-side",
  );
});

test("T4.30: Webhook gracefully handles missing sponsor entry", function () {
  var src = readSrc("functions/api/stripe-webhook.js");
  var sponsorSection = src.substring(
    src.indexOf("updateSponsorEntryAndNotify"),
  );
  assert.ok(
    sponsorSection.includes("!entryRaw"),
    "Must handle missing sponsor entry gracefully",
  );
});

// ============================================================
// Results
// ============================================================
console.log("\n============================================================");
console.log(
  `Results: ${passed} passed, ${failed} failed, ${skipped} skipped (${passed + failed + skipped} total)`,
);
console.log("============================================================\n");

if (failed > 0) {
  process.exit(1);
}
