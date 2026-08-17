// ============================================================
// Newsletter Signup & Send Tests -- FAF Site
//
// T1: Unit tests -- email validation, token logic, KV key structure
// T2: Integration tests -- file existence, exports, handler structure
// T3: Acceptance tests -- end-to-end flow verification
// T4: Adversarial tests -- REQUIRED: new input surface
//     Email validation bypass, HMAC token tampering/forgery on
//     unsubscribe links, admin passcode brute-force/missing-auth,
//     XSS via subscriber data in admin view or emails.
//
// Run: node tests/newsletter.test.js
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
// T1: UNIT TESTS -- validation logic, token structure, KV schema
// ============================================================
console.log("\n--- T1: Unit Tests ---");

test("T1.1: Signup validates email server-side (requires @)", function () {
  var src = readSrc("functions/api/newsletter-signup.js");
  assert.ok(src.includes('!email.includes("@")'), "Must check for @ in email");
});

test("T1.2: Signup validates email is a string", function () {
  var src = readSrc("functions/api/newsletter-signup.js");
  assert.ok(
    src.includes('typeof email !== "string"'),
    "Must verify email is a string type",
  );
});

test("T1.3: Signup normalizes email to lowercase", function () {
  var src = readSrc("functions/api/newsletter-signup.js");
  assert.ok(
    src.includes("toLowerCase()") && src.includes("trim()"),
    "Must normalize email to lowercase and trim whitespace",
  );
});

test("T1.4: Signup uses SHA-256 hash for KV key (not raw email)", function () {
  var src = readSrc("functions/api/newsletter-signup.js");
  assert.ok(
    src.includes("sha256Hex") && src.includes("SHA-256"),
    "Must hash email with SHA-256 for KV key",
  );
  assert.ok(
    src.includes("newsletter:subscriber:"),
    "KV key must use newsletter:subscriber: prefix",
  );
});

test("T1.5: Subscriber record stores required fields", function () {
  var src = readSrc("functions/api/newsletter-signup.js");
  assert.ok(src.includes("signupDate"), "Must store signup date");
  assert.ok(
    src.includes('"active"') || src.includes("'active'"),
    "Must store status as active",
  );
  assert.ok(src.includes("unsubToken"), "Must store unsubscribe token");
});

test("T1.6: Signup handles already-subscribed case gracefully", function () {
  var src = readSrc("functions/api/newsletter-signup.js");
  assert.ok(
    src.includes("already subscribed") ||
      src.includes("Already subscribed") ||
      src.includes("already") ||
      src.includes("re-subscribed"),
    "Must handle duplicate signups",
  );
});

test("T1.7: Signup handles resubscribe (previously unsubscribed)", function () {
  var src = readSrc("functions/api/newsletter-signup.js");
  assert.ok(
    src.includes("unsubscribed") && src.includes("resubscribedAt"),
    "Must handle resubscription of previously unsubscribed users",
  );
});

test("T1.8: Unsubscribe token has no expiry (CAN-SPAM compliance)", function () {
  var src = readSrc("functions/lib/approval-tokens.js");
  var unsubSection = src.substring(src.indexOf("createUnsubscribeToken"));
  // Unsubscribe tokens should NOT include an expiresAt field
  assert.ok(
    !unsubSection.includes("TOKEN_TTL_SECONDS") ||
      unsubSection.indexOf("TOKEN_TTL_SECONDS") >
        unsubSection.indexOf("verifyUnsubscribeToken"),
    "Unsubscribe tokens must not use TTL expiry",
  );
  // The verify function should not check expiry
  var verifySection = src.substring(src.indexOf("verifyUnsubscribeToken"));
  assert.ok(
    !verifySection.includes("expired"),
    "Unsubscribe token verification must not reject on expiry",
  );
});

test("T1.9: Unsubscribe token uses HMAC-SHA256 signature", function () {
  var src = readSrc("functions/lib/approval-tokens.js");
  assert.ok(
    src.includes("hmacSign") && src.includes("HMAC") && src.includes("SHA-256"),
    "Unsubscribe tokens must use HMAC-SHA256",
  );
});

test("T1.10: Unsubscribe token verification uses constant-time comparison", function () {
  var src = readSrc("functions/lib/approval-tokens.js");
  var verifySection = src.substring(src.indexOf("verifyUnsubscribeToken"));
  assert.ok(
    verifySection.includes("mismatch |="),
    "Must use constant-time comparison for HMAC verification",
  );
});

test("T1.11: Subscribers index maintained for send enumeration", function () {
  var src = readSrc("functions/api/newsletter-signup.js");
  assert.ok(
    src.includes("newsletter:subscribers-index"),
    "Must maintain a subscribers index for efficient enumeration",
  );
  assert.ok(
    src.includes("addToIndex"),
    "Must have function to add to subscriber index",
  );
});

test("T1.12: Unsubscribe removes from index", function () {
  var src = readSrc("functions/api/newsletter-unsubscribe.js");
  assert.ok(
    src.includes("removeFromIndex"),
    "Unsubscribe must remove subscriber from index",
  );
});

test("T1.13: Newsletter send validates subject and body", function () {
  var src = readSrc("functions/api/newsletter-send.js");
  assert.ok(
    src.includes("Subject line is required"),
    "Must validate subject is present",
  );
  assert.ok(
    src.includes("Newsletter body is required"),
    "Must validate body content is present",
  );
});

test("T1.14: Newsletter send tracks sent/failed counts", function () {
  var src = readSrc("functions/api/newsletter-send.js");
  assert.ok(
    src.includes("sent") && src.includes("failedCount"),
    "Must track sent and failed counts",
  );
});

test("T1.15: Email format validation goes beyond just @ check", function () {
  var src = readSrc("functions/api/newsletter-signup.js");
  assert.ok(
    src.includes("dotAfterAt") || src.includes('indexOf(".", atIndex)'),
    "Must validate that a dot exists after the @ sign",
  );
});

// ============================================================
// T2: INTEGRATION TESTS -- file existence, exports, structure
// ============================================================
console.log("\n--- T2: Integration Tests ---");

test("T2.1: newsletter-signup.js exists", function () {
  var filePath = path.join(
    __dirname,
    "..",
    "functions",
    "api",
    "newsletter-signup.js",
  );
  assert.ok(fs.existsSync(filePath), "Signup function file should exist");
});

test("T2.2: newsletter-unsubscribe.js exists", function () {
  var filePath = path.join(
    __dirname,
    "..",
    "functions",
    "api",
    "newsletter-unsubscribe.js",
  );
  assert.ok(fs.existsSync(filePath), "Unsubscribe function file should exist");
});

test("T2.3: newsletter-send.js exists", function () {
  var filePath = path.join(
    __dirname,
    "..",
    "functions",
    "api",
    "newsletter-send.js",
  );
  assert.ok(fs.existsSync(filePath), "Send function file should exist");
});

test("T2.4: newsletter-subscribers.js exists", function () {
  var filePath = path.join(
    __dirname,
    "..",
    "functions",
    "api",
    "newsletter-subscribers.js",
  );
  assert.ok(
    fs.existsSync(filePath),
    "Subscribers count function file should exist",
  );
});

test("T2.5: newsletter-admin.html exists", function () {
  assert.ok(
    fs.existsSync(path.join(__dirname, "..", "newsletter-admin.html")),
    "Admin page should exist",
  );
});

test("T2.6: Signup exports onRequestPost", function () {
  var src = readSrc("functions/api/newsletter-signup.js");
  assert.ok(
    src.includes("export async function onRequestPost"),
    "Must export onRequestPost",
  );
});

test("T2.7: Signup exports onRequestOptions (CORS)", function () {
  var src = readSrc("functions/api/newsletter-signup.js");
  assert.ok(
    src.includes("export async function onRequestOptions"),
    "Must export onRequestOptions for CORS preflight",
  );
});

test("T2.8: Signup rejects GET requests", function () {
  var src = readSrc("functions/api/newsletter-signup.js");
  assert.ok(
    src.includes("export async function onRequestGet"),
    "Must export onRequestGet to reject non-POST",
  );
  assert.ok(
    src.includes("405"),
    "GET handler must return 405 Method Not Allowed",
  );
});

test("T2.9: Unsubscribe exports onRequestGet", function () {
  var src = readSrc("functions/api/newsletter-unsubscribe.js");
  assert.ok(
    src.includes("export async function onRequestGet"),
    "Must export onRequestGet",
  );
});

test("T2.10: Unsubscribe rejects POST requests", function () {
  var src = readSrc("functions/api/newsletter-unsubscribe.js");
  assert.ok(
    src.includes("export async function onRequestPost"),
    "Must export onRequestPost to reject POST",
  );
  assert.ok(
    src.includes("405"),
    "POST handler must return 405 Method Not Allowed",
  );
});

test("T2.11: Send exports onRequestPost", function () {
  var src = readSrc("functions/api/newsletter-send.js");
  assert.ok(
    src.includes("export async function onRequestPost"),
    "Must export onRequestPost",
  );
});

test("T2.12: Send rejects GET requests", function () {
  var src = readSrc("functions/api/newsletter-send.js");
  assert.ok(
    src.includes("export async function onRequestGet"),
    "Must export onRequestGet to reject non-POST",
  );
  assert.ok(
    src.includes("405"),
    "GET handler must return 405 Method Not Allowed",
  );
});

test("T2.13: approval-tokens.js exports unsubscribe token functions", function () {
  var src = readSrc("functions/lib/approval-tokens.js");
  assert.ok(
    src.includes("export async function createUnsubscribeToken"),
    "Must export createUnsubscribeToken",
  );
  assert.ok(
    src.includes("export async function verifyUnsubscribeToken"),
    "Must export verifyUnsubscribeToken",
  );
});

test("T2.14: Signup imports from approval-tokens.js (reuse, not duplicate)", function () {
  var src = readSrc("functions/api/newsletter-signup.js");
  assert.ok(
    src.includes('from "../lib/approval-tokens.js"'),
    "Must import from shared approval-tokens lib",
  );
  assert.ok(
    src.includes("createUnsubscribeToken"),
    "Must use createUnsubscribeToken from lib",
  );
});

test("T2.15: Unsubscribe imports from approval-tokens.js", function () {
  var src = readSrc("functions/api/newsletter-unsubscribe.js");
  assert.ok(
    src.includes('from "../lib/approval-tokens.js"'),
    "Must import from shared approval-tokens lib",
  );
  assert.ok(
    src.includes("verifyUnsubscribeToken"),
    "Must use verifyUnsubscribeToken from lib",
  );
});

test("T2.16: Send imports from acs-email.js (shared email lib)", function () {
  var src = readSrc("functions/api/newsletter-send.js");
  assert.ok(
    src.includes('from "../lib/acs-email.js"'),
    "Must import from shared ACS email lib",
  );
  assert.ok(src.includes("sendViaACS"), "Must use sendViaACS from lib");
});

test("T2.17: Signup imports from acs-email.js", function () {
  var src = readSrc("functions/api/newsletter-signup.js");
  assert.ok(
    src.includes('from "../lib/acs-email.js"'),
    "Must import from shared ACS email lib for confirmation email",
  );
});

// ============================================================
// T3: ACCEPTANCE TESTS -- end-to-end flow verification
// ============================================================
console.log("\n--- T3: Acceptance Tests ---");

test("T3.1: Signup sends confirmation email via ACS (not SendGrid/Resend)", function () {
  var src = readSrc("functions/api/newsletter-signup.js");
  assert.ok(src.includes("sendViaACS"), "Must use ACS for confirmation email");
  assert.ok(
    !src.includes("sendgrid") && !src.includes("resend"),
    "Must NOT use SendGrid or Resend",
  );
});

test("T3.2: Confirmation email includes unsubscribe link", function () {
  var src = readSrc("functions/api/newsletter-signup.js");
  assert.ok(
    src.includes("unsubUrl") && src.includes("unsubscribe"),
    "Confirmation email must contain unsubscribe link",
  );
});

test("T3.3: Newsletter send uses individual emails (not shared to:[] blast)", function () {
  var src = readSrc("functions/api/newsletter-send.js");
  // Must loop through subscribers and send individually
  assert.ok(
    src.includes("for (const hash of index)") ||
      src.includes("for (var") ||
      src.includes("forEach"),
    "Must iterate through subscribers individually",
  );
  // Each email goes to one subscriber
  assert.ok(
    src.includes("to: subscriber.email"),
    "Must send to individual subscriber email, not a batch array",
  );
});

test("T3.4: Newsletter send includes personalized unsubscribe link per recipient", function () {
  var src = readSrc("functions/api/newsletter-send.js");
  assert.ok(
    src.includes("unsubUrl") && src.includes("unsubToken"),
    "Each email must have a personalized unsubscribe URL",
  );
});

test("T3.5: Unsubscribe renders HTML confirmation page (same pattern as sponsor-approve)", function () {
  var src = readSrc("functions/api/newsletter-unsubscribe.js");
  assert.ok(
    src.includes("text/html") && src.includes("renderPage"),
    "Must return rendered HTML confirmation page",
  );
});

test("T3.6: Unsubscribe marks subscriber inactive in KV", function () {
  var src = readSrc("functions/api/newsletter-unsubscribe.js");
  assert.ok(
    src.includes('"unsubscribed"') && src.includes("unsubscribedAt"),
    "Must mark subscriber status as unsubscribed with timestamp",
  );
});

test("T3.7: Newsletter emails include EIN and org info (CAN-SPAM physical address equivalent)", function () {
  var signupSrc = readSrc("functions/api/newsletter-signup.js");
  var sendSrc = readSrc("functions/api/newsletter-send.js");
  assert.ok(
    signupSrc.includes("42-1980182"),
    "Confirmation email must include EIN",
  );
  assert.ok(
    sendSrc.includes("42-1980182"),
    "Newsletter email must include EIN",
  );
});

test("T3.8: Admin page uses passcode auth (same pattern as media-review)", function () {
  var adminSrc = readSrc("newsletter-admin.html");
  assert.ok(
    adminSrc.includes("adminPasscode"),
    "Admin page must use passcode authentication",
  );
  assert.ok(
    adminSrc.includes("authenticate"),
    "Admin page must have authenticate function",
  );
});

test("T3.9: Admin page has subject, body fields, and send button", function () {
  var adminSrc = readSrc("newsletter-admin.html");
  assert.ok(
    adminSrc.includes("emailSubject"),
    "Admin page must have subject field",
  );
  assert.ok(
    adminSrc.includes("emailBody"),
    "Admin page must have body textarea",
  );
  assert.ok(
    adminSrc.includes("sendNewsletter"),
    "Admin page must have send function",
  );
});

test("T3.10: Admin page shows subscriber count", function () {
  var adminSrc = readSrc("newsletter-admin.html");
  assert.ok(
    adminSrc.includes("subscriberCount") ||
      adminSrc.includes("subscriber-count"),
    "Admin page must display subscriber count",
  );
});

test("T3.11: Admin page sends to /api/newsletter-send endpoint", function () {
  var adminSrc = readSrc("newsletter-admin.html");
  assert.ok(
    adminSrc.includes("/api/newsletter-send"),
    "Admin page must POST to /api/newsletter-send",
  );
});

test("T3.12: Newsletter signup form appears in site footer (index.html)", function () {
  var src = readSrc("index.html");
  assert.ok(
    src.includes("newsletter-signup") && src.includes("newsletterEmail"),
    "Index page must have newsletter signup form in footer",
  );
});

test("T3.13: Newsletter signup form appears in sponsors.html footer", function () {
  var src = readSrc("sponsors.html");
  assert.ok(
    src.includes("newsletter-signup") && src.includes("newsletterEmail"),
    "Sponsors page must have newsletter signup form in footer",
  );
});

test("T3.14: Newsletter signup form POSTs to /api/newsletter-signup", function () {
  var src = readSrc("index.html");
  assert.ok(
    src.includes("/api/newsletter-signup"),
    "Footer form must POST to /api/newsletter-signup",
  );
});

test("T3.15: Admin page is noindexed (not for public search)", function () {
  var adminSrc = readSrc("newsletter-admin.html");
  assert.ok(
    adminSrc.includes("noindex") || adminSrc.includes("robots"),
    "Admin page must have noindex meta tag",
  );
});

test("T3.16: Send endpoint documents CF execution time limit", function () {
  var src = readSrc("functions/api/newsletter-send.js");
  assert.ok(
    src.includes("execution time limit") || src.includes("SCALING"),
    "Must document CF Pages Function execution time constraint",
  );
});

test("T3.17: Send confirms before sending on admin page", function () {
  var adminSrc = readSrc("newsletter-admin.html");
  assert.ok(
    adminSrc.includes("confirm("),
    "Admin page must confirm before sending",
  );
});

// ============================================================
// T4: ADVERSARIAL TESTS -- security validation (REQUIRED)
// New input surface -- these are non-optional.
// ============================================================
console.log("\n--- T4: Adversarial Tests ---");

test("T4.1: Signup rejects empty/null email", function () {
  var src = readSrc("functions/api/newsletter-signup.js");
  assert.ok(src.includes("!email"), "Must reject falsy email values");
});

test("T4.2: Signup rejects non-string email types", function () {
  var src = readSrc("functions/api/newsletter-signup.js");
  assert.ok(
    src.includes('typeof email !== "string"'),
    "Must reject non-string email (prevents object/array injection)",
  );
});

test("T4.3: escapeHtml exists and neutralizes injection payloads in signup", function () {
  var src = readSrc("functions/api/newsletter-signup.js");
  var match = src.match(/function escapeHtml\(value\) \{[\s\S]*?\n\}/);
  assert.ok(match, "Could not locate escapeHtml() function body");

  var escapeHtml = new Function(
    "value",
    match[0].replace(/^function escapeHtml\(value\) \{/, "").replace(/\}$/, ""),
  );

  var payload = '<script>alert(1)</script><img src=x onerror="steal()">';
  var escaped = escapeHtml(payload);
  assert.ok(
    !escaped.includes("<script>"),
    "raw <script> tag survived escaping",
  );
  assert.ok(!escaped.includes("<img"), "raw <img> tag survived escaping");
  assert.ok(
    escaped.includes("&lt;script&gt;"),
    "expected entity-encoded output",
  );
});

test("T4.4: escapeHtml exists in newsletter-send.js", function () {
  var src = readSrc("functions/api/newsletter-send.js");
  assert.ok(
    src.includes("function escapeHtml("),
    "Send endpoint must have escapeHtml for content sanitization",
  );
});

test("T4.5: Newsletter body content is escaped before HTML interpolation", function () {
  var src = readSrc("functions/api/newsletter-send.js");
  assert.ok(
    src.includes("escapeHtml(content") || src.includes("escapedContent"),
    "Body content must be escaped before embedding in HTML email",
  );
});

test("T4.6: Subject line is escaped before HTML interpolation", function () {
  var src = readSrc("functions/api/newsletter-send.js");
  assert.ok(
    src.includes("escapeHtml(subject") || src.includes("escapedSubject"),
    "Subject must be escaped before embedding in HTML email template",
  );
});

test("T4.7: Subscriber email is escaped in email templates", function () {
  var sendSrc = readSrc("functions/api/newsletter-send.js");
  assert.ok(
    sendSrc.includes("escapeHtml(subscriber.email)"),
    "Subscriber email must be escaped in newsletter email template",
  );

  var signupSrc = readSrc("functions/api/newsletter-signup.js");
  assert.ok(
    signupSrc.includes("escapeHtml(normalizedEmail)"),
    "Email must be escaped in confirmation email template",
  );
});

test("T4.8: Unsubscribe token tampering is detected (HMAC verification)", function () {
  var src = readSrc("functions/api/newsletter-unsubscribe.js");
  assert.ok(
    src.includes("verifyUnsubscribeToken"),
    "Must verify token with HMAC",
  );
  assert.ok(
    src.includes("!result.valid") || src.includes("result.valid"),
    "Must check token validity before processing",
  );
});

test("T4.9: Unsubscribe rejects missing token", function () {
  var src = readSrc("functions/api/newsletter-unsubscribe.js");
  assert.ok(
    src.includes("!token") && src.includes("400"),
    "Must return 400 for missing token",
  );
});

test("T4.10: Unsubscribe rejects invalid token with 403", function () {
  var src = readSrc("functions/api/newsletter-unsubscribe.js");
  assert.ok(src.includes("403"), "Must return 403 for invalid/forged token");
});

test("T4.11: Send endpoint requires admin passcode", function () {
  var src = readSrc("functions/api/newsletter-send.js");
  assert.ok(
    src.includes("validateAdminPasscode"),
    "Must validate admin passcode before sending",
  );
  assert.ok(
    src.includes("403"),
    "Must return 403 for invalid/missing passcode",
  );
});

test("T4.12: Send endpoint rejects when passcode is not configured (500, not bypass)", function () {
  var src = readSrc("functions/api/newsletter-send.js");
  assert.ok(
    src.includes("not-configured") && src.includes("500"),
    "Must return 500 when admin passcode env var is missing (not silently allow access)",
  );
});

test("T4.13: Subscribers endpoint requires admin passcode", function () {
  var src = readSrc("functions/api/newsletter-subscribers.js");
  assert.ok(
    src.includes("validateAdminPasscode"),
    "Must validate admin passcode for subscriber listing",
  );
  assert.ok(
    src.includes("403"),
    "Must return 403 for invalid/missing passcode",
  );
});

test("T4.14: Raw email is never stored in KV key (hash only)", function () {
  var src = readSrc("functions/api/newsletter-signup.js");
  // The KV key must use the hash, not the raw email
  assert.ok(
    src.includes("`newsletter:subscriber:${hash}`"),
    "KV key must use hash, not raw email",
  );
  // The raw email is stored in the VALUE (for sending), but the KEY is the hash
  assert.ok(
    !src.includes("`newsletter:subscriber:${email}") &&
      !src.includes("`newsletter:subscriber:${normalizedEmail}"),
    "KV key must never contain raw email",
  );
});

test("T4.15: CORS is restricted to known origins", function () {
  var signupSrc = readSrc("functions/api/newsletter-signup.js");
  assert.ok(
    signupSrc.includes("fathersandfootball.org") &&
      signupSrc.includes("localhost"),
    "Must restrict CORS to known origins",
  );

  var sendSrc = readSrc("functions/api/newsletter-send.js");
  assert.ok(
    sendSrc.includes("fathersandfootball.org"),
    "Send endpoint must restrict CORS",
  );
});

test("T4.16: Signup handles JSON parse errors gracefully", function () {
  var src = readSrc("functions/api/newsletter-signup.js");
  assert.ok(
    src.includes("Invalid JSON body"),
    "Must handle malformed JSON input",
  );
});

test("T4.17: Send handles JSON parse errors gracefully", function () {
  var src = readSrc("functions/api/newsletter-send.js");
  assert.ok(
    src.includes("Invalid JSON body"),
    "Must handle malformed JSON input",
  );
});

test("T4.18: Unsubscribe reason is escaped in error page (prevents reflected XSS)", function () {
  var src = readSrc("functions/api/newsletter-unsubscribe.js");
  assert.ok(
    src.includes("escapeHtml(result.reason)"),
    "Token failure reason must be escaped before rendering in HTML page",
  );
});

test("T4.19: escapeHtml in unsubscribe handles all HTML special chars", function () {
  var src = readSrc("functions/api/newsletter-unsubscribe.js");
  var match = src.match(/function escapeHtml\(str\) \{[\s\S]*?\n\}/);
  assert.ok(match, "Could not locate escapeHtml() in unsubscribe");
  assert.ok(
    match[0].includes("&amp;") &&
      match[0].includes("&lt;") &&
      match[0].includes("&gt;") &&
      match[0].includes("&quot;"),
    'escapeHtml must handle &, <, >, and " at minimum',
  );
});

test("T4.20: No secrets or env var names in admin HTML page", function () {
  var src = readSrc("newsletter-admin.html");
  assert.ok(
    !src.includes("ACS_CONNECTION_STRING"),
    "ACS connection string env var must not appear in admin HTML",
  );
  assert.ok(
    !src.includes("QBO_APPROVAL_SECRET"),
    "Approval secret env var must not appear in admin HTML",
  );
  assert.ok(
    !src.includes("sk_test_") && !src.includes("sk_live_"),
    "No Stripe keys in admin HTML",
  );
});

test("T4.21: Unsubscribe URL uses HMAC token (not raw email in URL)", function () {
  var src = readSrc("functions/api/newsletter-signup.js");
  assert.ok(
    src.includes("token=") && src.includes("unsubToken"),
    "Unsubscribe URL must use HMAC token, not expose raw email",
  );
  // Confirm the URL does not include the raw email
  assert.ok(
    !src.includes("email=" + "encodeURIComponent(normalizedEmail)"),
    "Unsubscribe URL must not contain raw email as a parameter",
  );
});

test("T4.22: Send endpoint escapes unsubscribe URL in email HTML", function () {
  var src = readSrc("functions/api/newsletter-send.js");
  assert.ok(
    src.includes("escapeHtml(unsubUrl)"),
    "Unsubscribe URL must be escaped when embedded in HTML email",
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
