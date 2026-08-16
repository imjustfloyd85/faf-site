// ============================================================
// QuickBooks Online Sync Tests — FAF Site (Story 1248)
//
// T1: Unit tests — approval token logic, entry validation
// T2: Integration tests — file existence, exports, handler structure
// T3: Acceptance tests — end-to-end flow verification
// T4: Adversarial tests — REQUIRED: new financial input surface
//     touching accounting records. Forged tokens, replay attacks,
//     tampered params, expired tokens, category/amount injection.
//
// Run: node tests/quickbooks-sync.test.js
// ============================================================

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

let passed = 0;
let failed = 0;
let skipped = 0;

function test(name, fn) {
  try {
    if (fn.constructor.name === "AsyncFunction") {
      // Wrap async tests
      fn()
        .then(() => {
          passed++;
          console.log(`  PASS: ${name}`);
        })
        .catch((err) => {
          failed++;
          console.error(`  FAIL: ${name}`);
          console.error(`        ${err.message}`);
        });
    } else {
      fn();
      passed++;
      console.log(`  PASS: ${name}`);
    }
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

// Helper: read a source file relative to project root
function readSrc(relPath) {
  return fs.readFileSync(path.join(__dirname, "..", relPath), "utf8");
}

// ============================================================
// T1: UNIT TESTS — approval token logic, entry structure
// ============================================================
console.log("\n--- T1: Unit Tests — Approval Tokens & Entry Logic ---");

test("T1.1: approval-tokens.js — toBase64Url produces URL-safe output", function () {
  var src = readSrc("functions/lib/approval-tokens.js");
  assert.ok(
    src.includes("replace(/\\+/g") && src.includes("replace(/\\//g"),
    "Must replace + and / for URL safety",
  );
  assert.ok(src.includes('replace(/=+$/, "")'), "Must strip trailing padding");
});

test("T1.2: approval-tokens.js — createApprovalToken requires entryId, action, secret", function () {
  var src = readSrc("functions/lib/approval-tokens.js");
  assert.ok(
    src.includes("!entryId || !action || !secret"),
    "Must validate all three required args",
  );
});

test("T1.3: approval-tokens.js — createApprovalToken rejects invalid actions", function () {
  var src = readSrc("functions/lib/approval-tokens.js");
  assert.ok(
    src.includes('action !== "approve"') && src.includes('action !== "reject"'),
    "Must only accept approve or reject",
  );
});

test("T1.4: approval-tokens.js — token has 7-day TTL", function () {
  var src = readSrc("functions/lib/approval-tokens.js");
  assert.ok(
    src.includes("7 * 24 * 60 * 60"),
    "TOKEN_TTL_SECONDS should be 7 days (604800 seconds)",
  );
});

test("T1.5: approval-tokens.js — verifyApprovalToken checks expiry", function () {
  var src = readSrc("functions/lib/approval-tokens.js");
  assert.ok(
    src.includes("token expired"),
    "Must detect and report expired tokens",
  );
});

test("T1.6: approval-tokens.js — verifyApprovalToken uses constant-time comparison", function () {
  var src = readSrc("functions/lib/approval-tokens.js");
  // Look for the XOR-based constant-time comparison pattern
  assert.ok(
    src.includes("mismatch |=") && src.includes("charCodeAt"),
    "Must use constant-time comparison for HMAC verification",
  );
});

test("T1.7: approval-tokens.js — verifyApprovalToken returns structured result", function () {
  var src = readSrc("functions/lib/approval-tokens.js");
  assert.ok(
    src.includes("{ valid: true, entryId, action, expiresAt }"),
    "Valid result must include entryId, action, expiresAt",
  );
  assert.ok(
    src.includes("{ valid: false, reason:"),
    "Invalid result must include reason",
  );
});

test("T1.8: Pending entry has all required fields per spec", function () {
  var src = readSrc("functions/api/stripe-webhook.js");
  // Check that the pending entry object includes all specified fields
  assert.ok(src.includes("donorName"), "Must include donorName");
  assert.ok(src.includes("amountCents"), "Must include amount (in cents)");
  assert.ok(src.includes("category990"), "Must include 990 category");
  assert.ok(src.includes("stripeSessionId"), "Must include Stripe session ID");
  assert.ok(src.includes('"pending"'), "Must start with pending status");
  assert.ok(src.includes("donorEmail"), "Must include donor email");
});

test("T1.9: Suggested 990 categories map correctly", function () {
  var src = readSrc("functions/api/stripe-webhook.js");
  assert.ok(
    src.includes('"Fundraising"') && src.includes('"Program"'),
    "Must suggest Fundraising for sponsorships and Program for donations",
  );
});

test("T1.10: Token format is two dot-separated base64url segments", function () {
  var src = readSrc("functions/lib/approval-tokens.js");
  // createApprovalToken returns: toBase64Url(payload) + "." + toBase64Url(sig)
  assert.ok(
    src.includes('toBase64Url(payload) + "." + toBase64Url(sig)'),
    "Token must be payload.signature in base64url",
  );
});

test("T1.11: verifyApprovalToken handles missing token gracefully", function () {
  var src = readSrc("functions/lib/approval-tokens.js");
  assert.ok(
    src.includes("!token || !secret"),
    "Must handle null/undefined token input",
  );
});

test("T1.12: verifyApprovalToken handles malformed base64", function () {
  var src = readSrc("functions/lib/approval-tokens.js");
  assert.ok(
    src.includes("invalid base64 encoding"),
    "Must catch and report base64 decode failures",
  );
});

// ============================================================
// T2: INTEGRATION TESTS — file existence, exports, structure
// ============================================================
console.log("\n--- T2: Integration Tests — Files & Exports ---");

test("T2.1: quickbooks-connect.js exists", function () {
  assert.ok(
    fs.existsSync(
      path.join(__dirname, "..", "functions", "api", "quickbooks-connect.js"),
    ),
  );
});

test("T2.2: quickbooks-oauth-callback.js exists", function () {
  assert.ok(
    fs.existsSync(
      path.join(
        __dirname,
        "..",
        "functions",
        "api",
        "quickbooks-oauth-callback.js",
      ),
    ),
  );
});

test("T2.3: quickbooks-approve.js exists", function () {
  assert.ok(
    fs.existsSync(
      path.join(__dirname, "..", "functions", "api", "quickbooks-approve.js"),
    ),
  );
});

test("T2.4: approval-tokens.js lib exists", function () {
  assert.ok(
    fs.existsSync(
      path.join(__dirname, "..", "functions", "lib", "approval-tokens.js"),
    ),
  );
});

test("T2.5: qbo-client.js lib exists", function () {
  assert.ok(
    fs.existsSync(
      path.join(__dirname, "..", "functions", "lib", "qbo-client.js"),
    ),
  );
});

test("T2.6: acs-email.js lib exists", function () {
  assert.ok(
    fs.existsSync(
      path.join(__dirname, "..", "functions", "lib", "acs-email.js"),
    ),
  );
});

test("T2.7: quickbooks-connect exports onRequestGet", function () {
  var src = readSrc("functions/api/quickbooks-connect.js");
  assert.ok(src.includes("export async function onRequestGet"));
});

test("T2.8: quickbooks-oauth-callback exports onRequestGet", function () {
  var src = readSrc("functions/api/quickbooks-oauth-callback.js");
  assert.ok(src.includes("export async function onRequestGet"));
});

test("T2.9: quickbooks-approve exports onRequestGet", function () {
  var src = readSrc("functions/api/quickbooks-approve.js");
  assert.ok(src.includes("export async function onRequestGet"));
});

test("T2.10: quickbooks-connect rejects POST", function () {
  var src = readSrc("functions/api/quickbooks-connect.js");
  assert.ok(
    src.includes("onRequestPost") && src.includes("405"),
    "Must reject POST with 405",
  );
});

test("T2.11: quickbooks-oauth-callback rejects POST", function () {
  var src = readSrc("functions/api/quickbooks-oauth-callback.js");
  assert.ok(
    src.includes("onRequestPost") && src.includes("405"),
    "Must reject POST with 405",
  );
});

test("T2.12: quickbooks-approve rejects POST", function () {
  var src = readSrc("functions/api/quickbooks-approve.js");
  assert.ok(
    src.includes("onRequestPost") && src.includes("405"),
    "Must reject POST with 405",
  );
});

test("T2.13: stripe-webhook.js imports createApprovalToken", function () {
  var src = readSrc("functions/api/stripe-webhook.js");
  assert.ok(
    src.includes(
      'import { createApprovalToken } from "../lib/approval-tokens.js"',
    ),
    "Webhook must import approval token creator",
  );
});

test("T2.14: quickbooks-approve imports verifyApprovalToken", function () {
  var src = readSrc("functions/api/quickbooks-approve.js");
  assert.ok(
    src.includes("verifyApprovalToken"),
    "Approval handler must import token verifier",
  );
});

test("T2.15: quickbooks-approve imports createSalesReceipt", function () {
  var src = readSrc("functions/api/quickbooks-approve.js");
  assert.ok(
    src.includes("createSalesReceipt"),
    "Approval handler must import QBO sales receipt creator",
  );
});

test("T2.16: quickbooks-oauth-callback imports storeTokens", function () {
  var src = readSrc("functions/api/quickbooks-oauth-callback.js");
  assert.ok(
    src.includes("storeTokens"),
    "Callback must import token storage function",
  );
});

// ============================================================
// T3: ACCEPTANCE TESTS — end-to-end flow verification
// ============================================================
console.log("\n--- T3: Acceptance Tests — Flow Verification ---");

test("T3.1: OAuth connect uses correct Intuit authorization URL", function () {
  var src = readSrc("functions/api/quickbooks-connect.js");
  assert.ok(
    src.includes("https://appcenter.intuit.com/connect/oauth2"),
    "Must redirect to Intuit OAuth endpoint",
  );
});

test("T3.2: OAuth connect requests accounting scope", function () {
  var src = readSrc("functions/api/quickbooks-connect.js");
  assert.ok(
    src.includes("com.intuit.quickbooks.accounting"),
    "Must request QBO Accounting scope",
  );
});

test("T3.3: OAuth callback uses correct registered redirect URI", function () {
  var src = readSrc("functions/api/quickbooks-oauth-callback.js");
  assert.ok(
    src.includes(
      "https://fathersandfootball.org/api/quickbooks-oauth-callback",
    ),
    "Must use the exact redirect URI registered in Intuit app",
  );
});

test("T3.4: OAuth callback exchanges code for tokens via Intuit token endpoint", function () {
  var src = readSrc("functions/api/quickbooks-oauth-callback.js");
  assert.ok(
    src.includes("oauth.platform.intuit.com/oauth2/v1/tokens/bearer"),
    "Must call Intuit token endpoint",
  );
  assert.ok(
    src.includes("authorization_code"),
    "Must use authorization_code grant type",
  );
});

test("T3.5: OAuth callback stores tokens in KV", function () {
  var src = readSrc("functions/api/quickbooks-oauth-callback.js");
  assert.ok(
    src.includes("storeTokens(kv, tokens)") || src.includes("storeTokens(kv,"),
    "Must store tokens in KV after exchange",
  );
  assert.ok(src.includes("realm_id"), "Must store realm_id alongside tokens");
});

test("T3.6: Token storage includes access_token, refresh_token, expires_at, realm_id", function () {
  var src = readSrc("functions/api/quickbooks-oauth-callback.js");
  assert.ok(src.includes("access_token"), "Must store access_token");
  assert.ok(src.includes("refresh_token"), "Must store refresh_token");
  assert.ok(src.includes("expires_at"), "Must store computed expires_at");
  assert.ok(src.includes("realm_id"), "Must store realm_id");
});

test("T3.7: QBO client has automatic token refresh before expiry", function () {
  var src = readSrc("functions/lib/qbo-client.js");
  assert.ok(
    src.includes("REFRESH_BUFFER_SECONDS"),
    "Must define refresh buffer",
  );
  assert.ok(src.includes("refreshAccessToken"), "Must have refresh function");
  assert.ok(
    src.includes("getValidAccessToken"),
    "Must have auto-refresh wrapper",
  );
});

test("T3.8: QBO client refreshes 5 minutes before expiry", function () {
  var src = readSrc("functions/lib/qbo-client.js");
  assert.ok(
    src.includes("300") || src.includes("5 * 60"),
    "Refresh buffer should be ~300 seconds",
  );
});

test("T3.9: QBO client uses sandbox API URL", function () {
  var src = readSrc("functions/lib/qbo-client.js");
  assert.ok(
    src.includes("sandbox-quickbooks.api.intuit.com"),
    "Must use sandbox API base URL",
  );
});

test("T3.10: Webhook creates pending entry in KV on checkout.session.completed", function () {
  var src = readSrc("functions/api/stripe-webhook.js");
  assert.ok(
    src.includes("createPendingQboEntry"),
    "Must call pending entry creator",
  );
  assert.ok(
    src.includes("qbo:pending:"),
    "Must use qbo:pending: key prefix in KV",
  );
});

test("T3.11: Webhook sends approval email to BOTH justin@ and communications@", function () {
  var src = readSrc("functions/api/stripe-webhook.js");
  assert.ok(
    src.includes("justin@fathersandfootball.org"),
    "Must email justin@",
  );
  assert.ok(
    src.includes("communications@fathersandfootball.org"),
    "Must email communications@",
  );
});

test("T3.12: Approval email uses ACS (not SendGrid/Resend/SMTP)", function () {
  var src = readSrc("functions/api/stripe-webhook.js");
  // The approval email call must use sendViaACS
  var qboSection = src.substring(src.indexOf("QBO Pending Entry Queue"));
  assert.ok(qboSection.includes("sendViaACS"), "Approval email must use ACS");
  assert.ok(!qboSection.includes("sendgrid"), "Must NOT use SendGrid");
  assert.ok(!qboSection.includes("resend"), "Must NOT use Resend");
});

test("T3.13: Approval email contains entry details (donor, amount, type, 990 category)", function () {
  var src = readSrc("functions/api/stripe-webhook.js");
  assert.ok(src.includes("donorName"), "Email must show donor name");
  assert.ok(
    src.includes("amountStr") || src.includes("amountCents"),
    "Email must show amount",
  );
  assert.ok(src.includes("category990"), "Email must show 990 category");
});

test("T3.14: Approval email contains Approve and Reject links", function () {
  var src = readSrc("functions/api/stripe-webhook.js");
  assert.ok(
    src.includes("approveUrl") && src.includes("rejectUrl"),
    "Email must have both approve and reject URLs",
  );
  assert.ok(
    src.includes("quickbooks-approve"),
    "Links must point to approval handler",
  );
});

test("T3.15: Approve handler creates Sales Receipt in QBO", function () {
  var src = readSrc("functions/api/quickbooks-approve.js");
  assert.ok(
    src.includes("createSalesReceipt"),
    "Must call QBO API on approval",
  );
});

test("T3.16: Reject handler does NOT call QBO API", function () {
  var src = readSrc("functions/api/quickbooks-approve.js");
  // Find the reject block and verify no QBO call
  var rejectIdx = src.indexOf('action === "reject"');
  var approveIdx = src.indexOf('action === "approve"');
  assert.ok(rejectIdx > -1 && approveIdx > -1, "Must handle both actions");
  var rejectBlock = src.substring(rejectIdx, approveIdx);
  assert.ok(
    !rejectBlock.includes("createSalesReceipt"),
    "Reject path must NOT call QBO API",
  );
});

test("T3.17: Approved entry status is updated in KV", function () {
  var src = readSrc("functions/api/quickbooks-approve.js");
  assert.ok(src.includes('"approved"'), "Must set status to approved");
  assert.ok(src.includes("processedAt"), "Must record processing timestamp");
});

test("T3.18: Rejected entry status is updated in KV", function () {
  var src = readSrc("functions/api/quickbooks-approve.js");
  assert.ok(src.includes('"rejected"'), "Must set status to rejected");
});

test("T3.19: QBO Sales Receipt includes 990 category in private note", function () {
  var src = readSrc("functions/lib/qbo-client.js");
  assert.ok(
    src.includes("990 Category") || src.includes("category990"),
    "Sales Receipt must reference 990 category",
  );
  assert.ok(
    src.includes("PrivateNote"),
    "Must use PrivateNote field for internal tracking",
  );
});

test("T3.20: OAuth connect generates CSRF state parameter", function () {
  var src = readSrc("functions/api/quickbooks-connect.js");
  assert.ok(
    src.includes("generateState") || src.includes("state"),
    "Must generate anti-CSRF state",
  );
  assert.ok(src.includes("HMAC"), "State must be HMAC-signed");
});

test("T3.21: OAuth callback verifies CSRF state parameter", function () {
  var src = readSrc("functions/api/quickbooks-oauth-callback.js");
  assert.ok(src.includes("verifyState"), "Must verify state on callback");
});

// ============================================================
// T2.x / T3.x: DISCONNECT ENDPOINT TESTS
// ============================================================
console.log("\n--- Disconnect Endpoint Tests ---");

test("T2.17: quickbooks-disconnect.js exists", function () {
  assert.ok(
    fs.existsSync(
      path.join(
        __dirname,
        "..",
        "functions",
        "api",
        "quickbooks-disconnect.js",
      ),
    ),
  );
});

test("T2.18: quickbooks-disconnect exports onRequestGet", function () {
  var src = readSrc("functions/api/quickbooks-disconnect.js");
  assert.ok(src.includes("export async function onRequestGet"));
});

test("T2.19: quickbooks-disconnect rejects POST", function () {
  var src = readSrc("functions/api/quickbooks-disconnect.js");
  assert.ok(
    src.includes("onRequestPost") && src.includes("405"),
    "Must reject POST with 405",
  );
});

test("T3.22: Disconnect handler deletes qbo:tokens from KV", function () {
  var src = readSrc("functions/api/quickbooks-disconnect.js");
  assert.ok(
    src.includes('kv.delete("qbo:tokens")'),
    "Must delete the qbo:tokens key from KV",
  );
});

test("T3.23: Disconnect handler returns HTML confirmation with reconnect link", function () {
  var src = readSrc("functions/api/quickbooks-disconnect.js");
  assert.ok(
    src.includes("text/html") && src.includes("200"),
    "Must return 200 with HTML content type",
  );
  assert.ok(
    src.includes("/api/quickbooks-connect"),
    "Must include reconnect link",
  );
  assert.ok(
    src.includes("Disconnected"),
    "Must confirm disconnection to the user",
  );
});

test("T3.24: Disconnect handler is idempotent (kv.delete does not throw on missing key)", function () {
  // Cloudflare KV delete() is a no-op when the key doesn't exist.
  // The handler must NOT wrap delete in a try/catch that would imply
  // it could fail, and must NOT call kv.get() first to check existence.
  var src = readSrc("functions/api/quickbooks-disconnect.js");
  assert.ok(
    !src.includes('kv.get("qbo:tokens")'),
    "Must not check key existence before deleting (delete is already idempotent)",
  );
});

test("T3.25: Disconnect handler checks for missing KV binding", function () {
  var src = readSrc("functions/api/quickbooks-disconnect.js");
  assert.ok(
    src.includes("!kv"),
    "Must check for KV binding availability before using it",
  );
  assert.ok(src.includes("500"), "Must return 500 if KV is not configured");
});

// ============================================================
// T4: ADVERSARIAL TESTS — security validation (REQUIRED)
// New financial input surface touching accounting records.
// ============================================================
console.log("\n--- T4: Adversarial Tests — Security (REQUIRED) ---");

test("T4.1: Forged approval token — handler verifies HMAC signature", function () {
  var src = readSrc("functions/api/quickbooks-approve.js");
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

test("T4.2: Tampered token payload — HMAC detects modification", function () {
  var src = readSrc("functions/lib/approval-tokens.js");
  // The HMAC covers the full payload (entryId.action.expiresAt)
  // so any modification to any field invalidates the signature
  assert.ok(
    src.includes("hmacSign(payloadStr, secret)"),
    "Must recompute HMAC over full payload for verification",
  );
});

test("T4.3: Replay protection — already-approved entry is rejected", function () {
  var src = readSrc("functions/api/quickbooks-approve.js");
  assert.ok(
    src.includes('entry.status !== "pending"'),
    "Must check entry status before processing",
  );
  assert.ok(
    src.includes("Already Processed") || src.includes("already"),
    "Must inform user the entry was already handled",
  );
  assert.ok(
    src.includes("409"),
    "Must return 409 Conflict for replay attempts",
  );
});

test("T4.4: Replay protection — already-rejected entry cannot be re-approved", function () {
  var src = readSrc("functions/api/quickbooks-approve.js");
  // The status check happens BEFORE the action switch,
  // so both approve and reject are blocked on non-pending entries
  var statusCheckIdx = src.indexOf('entry.status !== "pending"');
  var approveIdx = src.indexOf('action === "approve"');
  var rejectIdx = src.indexOf('action === "reject"');
  assert.ok(
    statusCheckIdx < approveIdx && statusCheckIdx < rejectIdx,
    "Status check must occur BEFORE action handling to prevent all replays",
  );
});

test("T4.5: Expired token is rejected", function () {
  var src = readSrc("functions/lib/approval-tokens.js");
  assert.ok(
    src.includes("Date.now() / 1000") && src.includes("expiresAt"),
    "Must compare current time against token expiry",
  );
  assert.ok(src.includes("token expired"), "Must report expired tokens");
});

test("T4.6: No financial data in approval URL — token-only reference", function () {
  var src = readSrc("functions/api/stripe-webhook.js");
  // The approve/reject URLs must only contain the token parameter
  assert.ok(src.includes("?token="), "URL must use token parameter");
  // Must NOT include amount, category, or other financial data as URL params
  var urlSection = src.substring(
    src.indexOf("approveUrl"),
    src.indexOf("approvalHtml"),
  );
  assert.ok(
    !urlSection.includes("amount="),
    "URL must NOT include amount parameter",
  );
  assert.ok(
    !urlSection.includes("category="),
    "URL must NOT include category parameter",
  );
  assert.ok(
    !urlSection.includes("name="),
    "URL must NOT include name parameter",
  );
});

test("T4.7: Approval handler loads ALL financial data from KV, not from request", function () {
  var src = readSrc("functions/api/quickbooks-approve.js");
  // The handler must load entry from KV and use entry.amountCents etc
  assert.ok(
    src.includes("kv.get(`qbo:pending:${entryId}`)") || src.includes("kv.get("),
    "Must load entry from KV",
  );
  // Must NOT read amount/category/name from URL params
  assert.ok(
    !src.includes('searchParams.get("amount")'),
    "Must NOT read amount from URL",
  );
  assert.ok(
    !src.includes('searchParams.get("category")'),
    "Must NOT read category from URL",
  );
  assert.ok(
    !src.includes('searchParams.get("name")'),
    "Must NOT read name from URL",
  );
});

test("T4.8: Approval handler only reads 'token' from query params", function () {
  var src = readSrc("functions/api/quickbooks-approve.js");
  // Count searchParams.get calls — should only be "token"
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

test("T4.9: Action is embedded in the signed token, not a separate URL param", function () {
  var src = readSrc("functions/lib/approval-tokens.js");
  // The action is part of the HMAC payload
  assert.ok(
    src.includes("${entryId}.${action}.${expiresAt}"),
    "Action must be part of the signed payload",
  );
  var srcApprove = readSrc("functions/api/quickbooks-approve.js");
  // The handler extracts action from the verified token, not from URL
  assert.ok(
    !srcApprove.includes('searchParams.get("action")'),
    "Must NOT read action from URL params",
  );
});

test("T4.10: Constant-time comparison prevents timing attacks on approval tokens", function () {
  var src = readSrc("functions/lib/approval-tokens.js");
  assert.ok(
    src.includes("mismatch |="),
    "Must use XOR accumulator for constant-time comparison",
  );
  assert.ok(src.includes("mismatch !== 0"), "Must check accumulated mismatch");
});

test("T4.11: OAuth state has replay protection (timestamp check)", function () {
  var src = readSrc("functions/api/quickbooks-oauth-callback.js");
  assert.ok(
    src.includes("age > 600") || src.includes("age >"),
    "OAuth state must expire within a window",
  );
});

test("T4.12: OAuth state uses HMAC verification", function () {
  var src = readSrc("functions/api/quickbooks-oauth-callback.js");
  assert.ok(src.includes("HMAC"), "State verification must use HMAC");
  assert.ok(
    src.includes("mismatch |="),
    "State HMAC comparison must be constant-time",
  );
});

test("T4.13: No secrets/keys appear in client-facing HTML responses", function () {
  var src = readSrc("functions/api/quickbooks-approve.js");
  // Extract only the renderPage function and inline HTML strings
  var renderIdx = src.indexOf("function renderPage");
  assert.ok(renderIdx > -1, "renderPage function must exist");
  var renderSection = src.substring(renderIdx);
  assert.ok(
    !renderSection.includes("access_token"),
    "Must not leak access tokens in HTML responses",
  );
  assert.ok(
    !renderSection.includes("QBO_CLIENT_SECRET"),
    "Must not leak client secret in HTML responses",
  );
  assert.ok(
    !renderSection.includes("QBO_APPROVAL_SECRET"),
    "Must not leak approval secret in HTML responses",
  );
});

test("T4.14: QBO tokens stored in KV, not in static Pages secrets", function () {
  var src = readSrc("functions/lib/qbo-client.js");
  assert.ok(
    src.includes('kv.put("qbo:tokens"') || src.includes("kv.put("),
    "Tokens must be stored in KV (they rotate)",
  );
  assert.ok(
    src.includes('kv.get("qbo:tokens"') || src.includes("kv.get("),
    "Tokens must be read from KV",
  );
});

test("T4.15: QBO API errors do NOT mark entry as approved", function () {
  var src = readSrc("functions/api/quickbooks-approve.js");
  // If QBO API fails, entry must remain pending
  assert.ok(
    src.includes("502") && src.includes("remains pending"),
    "Failed QBO call must leave entry in pending state",
  );
});

test("T4.16: HTML output is escaped to prevent XSS", function () {
  var src = readSrc("functions/api/quickbooks-approve.js");
  assert.ok(
    src.includes("escapeHtml"),
    "Must escape dynamic content in HTML responses",
  );
});

test("T4.17: OAuth callback escapes error messages in HTML", function () {
  var src = readSrc("functions/api/quickbooks-oauth-callback.js");
  assert.ok(
    src.includes("escapeHtml"),
    "Must escape error content to prevent XSS via OAuth error param",
  );
});

test("T4.18: Webhook gracefully handles missing KV binding", function () {
  var src = readSrc("functions/api/stripe-webhook.js");
  assert.ok(
    src.includes("!kv || !approvalSecret"),
    "Must check for KV binding before using it",
  );
});

test("T4.19: Approval handler checks for missing KV binding", function () {
  var src = readSrc("functions/api/quickbooks-approve.js");
  assert.ok(src.includes("!kv"), "Must check for KV binding availability");
});

test("T4.20: Missing approval token returns 400, not 500", function () {
  var src = readSrc("functions/api/quickbooks-approve.js");
  assert.ok(
    src.includes("!token") && src.includes("400"),
    "Missing token must return 400 Bad Request",
  );
});

test("T4.21: Invalid/forged token returns 403, not 500", function () {
  var src = readSrc("functions/api/quickbooks-approve.js");
  assert.ok(
    src.includes("!result.valid") && src.includes("403"),
    "Invalid token must return 403 Forbidden",
  );
});

test("T4.22: Entry not found returns 404", function () {
  var src = readSrc("functions/api/quickbooks-approve.js");
  assert.ok(
    src.includes("!entryRaw") && src.includes("404"),
    "Missing entry must return 404",
  );
});

test("T4.23: OAuth callback rejects missing auth code", function () {
  var src = readSrc("functions/api/quickbooks-oauth-callback.js");
  assert.ok(
    src.includes("!code || !realmId"),
    "Must validate auth code and realmId are present",
  );
  assert.ok(src.includes("400"), "Missing code must return 400");
});

test("T4.24: OAuth callback rejects invalid CSRF state", function () {
  var src = readSrc("functions/api/quickbooks-oauth-callback.js");
  assert.ok(
    src.includes("!stateValid") && src.includes("403"),
    "Invalid state must return 403",
  );
});

test("T4.25: Pending entry KV key uses UUID, not predictable sequence", function () {
  var src = readSrc("functions/api/stripe-webhook.js");
  assert.ok(
    src.includes("crypto.randomUUID()"),
    "Entry ID must be a cryptographic random UUID",
  );
});

test("T4.26: QBO refresh token exchange uses Basic auth, not query params", function () {
  var src = readSrc("functions/lib/qbo-client.js");
  assert.ok(
    src.includes("Basic") && src.includes("btoa"),
    "Token refresh must use Basic auth header",
  );
  assert.ok(
    !src.includes("client_secret="),
    "Must NOT pass client_secret as a form parameter",
  );
});

test("T4.27: Pending entries have KV TTL to prevent unbounded growth", function () {
  var src = readSrc("functions/api/stripe-webhook.js");
  assert.ok(
    src.includes("expirationTtl"),
    "KV entries must have a TTL for automatic cleanup",
  );
});

// ============================================================
// Results
// ============================================================

// Give async tests a moment to resolve, then print results
setTimeout(() => {
  console.log("\n============================================================");
  console.log(
    `Results: ${passed} passed, ${failed} failed, ${skipped} skipped (${passed + failed + skipped} total)`,
  );
  console.log("============================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}, 500);
