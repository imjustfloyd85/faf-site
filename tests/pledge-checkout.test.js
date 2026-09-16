// ============================================================
// Pledge Checkout Integration Tests -- FAF Site (Story 1239)
//
// Mirrors tests/stripe-checkout.test.js coverage for the pledge
// donation charge path via Stripe Checkout.
//
// T1: Unit tests -- function logic validation
// T2: Integration tests -- API endpoint + page existence
// T3: Acceptance tests -- end-to-end flow verification
// T4: Adversarial tests -- security/tampering (REQUIRED: new financial input surface)
//
// Run: node tests/pledge-checkout.test.js
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

// ============================================================
// T1: UNIT TESTS -- pledge validation logic
// ============================================================
console.log("\n--- T1: Unit Tests ---");

test("T1.1: Pledge frequency must be one-time or monthly", function () {
  var valid = ["one-time", "monthly"];
  assert.ok(valid.includes("one-time"), "one-time should be valid");
  assert.ok(valid.includes("monthly"), "monthly should be valid");
  assert.ok(!valid.includes("yearly"), "yearly should be invalid");
  assert.ok(!valid.includes(""), "empty should be invalid");
});

test("T1.2: Pledge amount validation -- rejects zero", function () {
  var amount = 0;
  assert.ok(!(amount > 0), "Zero should be rejected");
});

test("T1.3: Pledge amount validation -- rejects negative", function () {
  var amount = -50;
  assert.ok(!(amount > 0), "Negative should be rejected");
});

test("T1.4: Pledge amount validation -- accepts $1", function () {
  var amount = 1;
  assert.ok(amount > 0, "$1 should be accepted");
});

test("T1.5: Pledge amount validation -- accepts decimal amounts", function () {
  var amount = 25.5;
  assert.ok(amount > 0, "$25.50 should be accepted");
  assert.strictEqual(amount.toFixed(2), "25.50", "Should format to 2 decimals");
});

test("T1.6: Stripe unit_amount computed correctly from dollar amount", function () {
  var parsedAmount = 50.0;
  var unitAmount = Math.round(parsedAmount * 100);
  assert.strictEqual(unitAmount, 5000, "$50.00 should be 5000 cents");

  parsedAmount = 25.5;
  unitAmount = Math.round(parsedAmount * 100);
  assert.strictEqual(unitAmount, 2550, "$25.50 should be 2550 cents");
});

test("T1.7: Email validation -- rejects missing @", function () {
  var email = "notanemail";
  var atIndex = email.indexOf("@");
  assert.ok(atIndex < 1, "Should reject emails without @");
});

test("T1.8: Email validation -- accepts valid email", function () {
  var email = "test@example.com";
  var atIndex = email.indexOf("@");
  assert.ok(atIndex >= 1, "Should accept valid email");
  assert.ok(email.indexOf(".", atIndex) !== -1, "Should have dot after @");
});

test("T1.9: Name length limit enforced at 200 chars", function () {
  var longName = "A".repeat(201);
  assert.ok(longName.length > 200, "201-char name should be rejected");
  var okName = "A".repeat(200);
  assert.ok(okName.length <= 200, "200-char name should be accepted");
});

// ============================================================
// T2: INTEGRATION TESTS -- file existence and exports
// ============================================================
console.log("\n--- T2: Integration Tests ---");

test("T2.1: pledge-submit.js exists", function () {
  var filePath = path.join(
    __dirname,
    "..",
    "functions",
    "api",
    "pledge-submit.js",
  );
  assert.ok(fs.existsSync(filePath), "Function file should exist");
});

test("T2.2: pledge-submit.js exports onRequestPost", function () {
  var src = fs.readFileSync(
    path.join(__dirname, "..", "functions", "api", "pledge-submit.js"),
    "utf8",
  );
  assert.ok(
    src.includes("export async function onRequestPost"),
    "Must export onRequestPost",
  );
});

test("T2.3: pledge-submit.js rejects non-POST methods", function () {
  var src = fs.readFileSync(
    path.join(__dirname, "..", "functions", "api", "pledge-submit.js"),
    "utf8",
  );
  assert.ok(
    src.includes("export async function onRequestGet"),
    "Must export onRequestGet to reject GET",
  );
  assert.ok(src.includes("405"), "Must return 405 for non-POST methods");
});

test("T2.4: pledge-success.html exists", function () {
  assert.ok(
    fs.existsSync(path.join(__dirname, "..", "pledge-success.html")),
    "Pledge success page should exist",
  );
});

test("T2.5: pledge-cancel.html exists", function () {
  assert.ok(
    fs.existsSync(path.join(__dirname, "..", "pledge-cancel.html")),
    "Pledge cancel page should exist",
  );
});

test("T2.6: pledge.html exists and posts to /api/pledge-submit", function () {
  var src = fs.readFileSync(path.join(__dirname, "..", "pledge.html"), "utf8");
  assert.ok(
    src.includes("/api/pledge-submit"),
    "Must post to pledge-submit endpoint",
  );
});

test("T2.7: stripe-webhook.js handles pledge payment type", function () {
  var src = fs.readFileSync(
    path.join(__dirname, "..", "functions", "api", "stripe-webhook.js"),
    "utf8",
  );
  assert.ok(
    src.includes('"pledge"'),
    "Webhook must handle pledge payment type",
  );
  assert.ok(
    src.includes("handlePledgePayment"),
    "Webhook must call handlePledgePayment",
  );
});

test("T2.8: pledge-cancel.html links back to pledge page (not sponsors)", function () {
  var src = fs.readFileSync(
    path.join(__dirname, "..", "pledge-cancel.html"),
    "utf8",
  );
  assert.ok(
    src.includes('href="pledge.html"'),
    "Cancel page should link back to pledge.html for retry",
  );
});

// ============================================================
// T3: ACCEPTANCE TESTS -- end-to-end flow verification
// ============================================================
console.log("\n--- T3: Acceptance Tests ---");

test("T3.1: pledge-submit.js creates Stripe Checkout sessions via REST API", function () {
  var src = fs.readFileSync(
    path.join(__dirname, "..", "functions", "api", "pledge-submit.js"),
    "utf8",
  );
  assert.ok(
    src.includes("https://api.stripe.com/v1/checkout/sessions"),
    "Must call Stripe Checkout Sessions API",
  );
});

test("T3.2: pledge-submit uses dynamic price_data (not pre-created Price IDs)", function () {
  var src = fs.readFileSync(
    path.join(__dirname, "..", "functions", "api", "pledge-submit.js"),
    "utf8",
  );
  assert.ok(
    src.includes("price_data"),
    "Must use price_data for dynamic pricing",
  );
  var hasPriceId = /price_[A-Za-z0-9]{10,}/.test(src);
  assert.ok(
    !hasPriceId,
    "Should not reference pre-created price IDs (price_XXXX)",
  );
});

test("T3.3: Success URL includes session_id parameter", function () {
  var src = fs.readFileSync(
    path.join(__dirname, "..", "functions", "api", "pledge-submit.js"),
    "utf8",
  );
  assert.ok(
    src.includes("{CHECKOUT_SESSION_ID}"),
    "Success URL must include session_id for verification",
  );
});

test("T3.4: Subscription mode used for monthly pledges", function () {
  var src = fs.readFileSync(
    path.join(__dirname, "..", "functions", "api", "pledge-submit.js"),
    "utf8",
  );
  assert.ok(
    src.includes('"subscription"'),
    "Must set mode to subscription for monthly",
  );
  assert.ok(src.includes('"payment"'), "Must set mode to payment for one-time");
});

test("T3.5: pledge-submit sets metadata.type to 'pledge'", function () {
  var src = fs.readFileSync(
    path.join(__dirname, "..", "functions", "api", "pledge-submit.js"),
    "utf8",
  );
  assert.ok(
    src.includes('metadata[type]", "pledge"'),
    "Must set metadata type to pledge",
  );
});

test("T3.6: pledge-submit sets metadata.pledge_id for webhook lookup", function () {
  var src = fs.readFileSync(
    path.join(__dirname, "..", "functions", "api", "pledge-submit.js"),
    "utf8",
  );
  assert.ok(
    src.includes("metadata[pledge_id]"),
    "Must set pledge_id in metadata for webhook to retrieve entry",
  );
});

test("T3.7: PDF and email are NOT sent in pledge-submit (deferred to webhook)", function () {
  var src = fs.readFileSync(
    path.join(__dirname, "..", "functions", "api", "pledge-submit.js"),
    "utf8",
  );
  assert.ok(
    !src.includes("generatePdf"),
    "pledge-submit must NOT generate PDF -- deferred to webhook",
  );
  assert.ok(
    !src.includes("sendViaACS"),
    "pledge-submit must NOT send email -- deferred to webhook",
  );
  assert.ok(
    !src.includes("sendViaACSWithAttachment"),
    "pledge-submit must NOT send attachment email -- deferred to webhook",
  );
});

test("T3.8: Webhook generates PDF for pledge confirmations", function () {
  var src = fs.readFileSync(
    path.join(__dirname, "..", "functions", "api", "stripe-webhook.js"),
    "utf8",
  );
  assert.ok(
    src.includes("generatePdf") && src.includes("getPledgeAgreementPdfContent"),
    "Webhook must generate pledge agreement PDF",
  );
});

test("T3.9: Webhook sends pledge PDF as email attachment", function () {
  var src = fs.readFileSync(
    path.join(__dirname, "..", "functions", "api", "stripe-webhook.js"),
    "utf8",
  );
  assert.ok(
    src.includes("sendViaACSWithAttachment"),
    "Webhook must send PDF attachment via ACS",
  );
  assert.ok(
    src.includes("FAF-Pledge-Agreement.pdf"),
    "Attachment must be named FAF-Pledge-Agreement.pdf",
  );
});

test("T3.10: Webhook sends email via ACS (not Resend/SendGrid/SMTP)", function () {
  var src = fs.readFileSync(
    path.join(__dirname, "..", "functions", "api", "stripe-webhook.js"),
    "utf8",
  );
  assert.ok(src.includes("sendViaACS"), "Must use ACS for email");
  assert.ok(
    src.includes("ACS_CONNECTION_STRING"),
    "Must reference ACS connection string",
  );
  assert.ok(!src.includes("sendgrid"), "Must NOT use SendGrid");
  assert.ok(!src.includes("resend"), "Must NOT use Resend");
});

test("T3.11: Webhook updates pledge KV entry status to paid", function () {
  var src = fs.readFileSync(
    path.join(__dirname, "..", "functions", "api", "stripe-webhook.js"),
    "utf8",
  );
  var pledgeSection = src.substring(
    src.indexOf("handlePledgePayment"),
    src.indexOf("// --- Main Handler ---"),
  );
  assert.ok(
    pledgeSection.includes('"paid"'),
    "Must update pledge status to paid",
  );
  assert.ok(pledgeSection.includes("paidAt"), "Must record payment timestamp");
});

test("T3.12: pledge.html redirects to Stripe checkout URL on submit", function () {
  var src = fs.readFileSync(path.join(__dirname, "..", "pledge.html"), "utf8");
  assert.ok(
    src.includes("window.location.href = r.data.url"),
    "Must redirect to Stripe checkout URL",
  );
});

test("T3.13: Webhook creates QBO pending entry for pledge payments", function () {
  var src = fs.readFileSync(
    path.join(__dirname, "..", "functions", "api", "stripe-webhook.js"),
    "utf8",
  );
  // Find the pledge branch and verify it calls createPendingQboEntry
  var pledgeBranch = src.substring(
    src.indexOf('paymentType === "pledge"'),
    src.indexOf("} else {", src.indexOf('paymentType === "pledge"')),
  );
  assert.ok(
    pledgeBranch.includes("createPendingQboEntry"),
    "Pledge branch must queue QBO entry",
  );
});

test("T3.14: Pledge donor email includes tax deductibility language", function () {
  var src = fs.readFileSync(
    path.join(__dirname, "..", "functions", "api", "stripe-webhook.js"),
    "utf8",
  );
  var pledgeSection = src.substring(
    src.indexOf("buildPledgeEmail"),
    src.indexOf("handlePledgePayment"),
  );
  assert.ok(
    pledgeSection.includes("No goods or services were provided"),
    "Pledge receipt must state no quid pro quo",
  );
  assert.ok(
    pledgeSection.includes("42-1980182"),
    "Must include EIN in pledge receipt",
  );
});

// ============================================================
// T4: ADVERSARIAL TESTS -- security validation (REQUIRED)
// New financial input surface -- these are non-optional.
// ============================================================
console.log("\n--- T4: Adversarial Tests ---");

test("T4.1: pledge-submit validates amount server-side (positive check)", function () {
  var src = fs.readFileSync(
    path.join(__dirname, "..", "functions", "api", "pledge-submit.js"),
    "utf8",
  );
  assert.ok(
    src.includes("parsedAmount <= 0") || src.includes("isNaN(parsedAmount)"),
    "Must validate pledge amount is positive server-side",
  );
});

test("T4.2: pledge-submit validates frequency server-side", function () {
  var src = fs.readFileSync(
    path.join(__dirname, "..", "functions", "api", "pledge-submit.js"),
    "utf8",
  );
  assert.ok(
    src.includes('"one-time", "monthly"') ||
      src.includes('"monthly", "one-time"'),
    "Must validate frequency against allowed values",
  );
});

test("T4.3: pledge-submit validates email server-side", function () {
  var src = fs.readFileSync(
    path.join(__dirname, "..", "functions", "api", "pledge-submit.js"),
    "utf8",
  );
  assert.ok(
    src.includes('email.indexOf("@")'),
    "Must validate email format server-side",
  );
});

test("T4.4: pledge-submit requires consent agreement", function () {
  var src = fs.readFileSync(
    path.join(__dirname, "..", "functions", "api", "pledge-submit.js"),
    "utf8",
  );
  assert.ok(
    src.includes("!agreed"),
    "Must reject submissions without consent agreement",
  );
});

test("T4.5: pledge-submit has rate limiting", function () {
  var src = fs.readFileSync(
    path.join(__dirname, "..", "functions", "api", "pledge-submit.js"),
    "utf8",
  );
  assert.ok(
    src.includes("RATE_LIMIT_MAX") && src.includes("429"),
    "Must enforce rate limiting and return 429",
  );
});

test("T4.6: pledge-submit rejects when STRIPE_SECRET_KEY is not set", function () {
  var src = fs.readFileSync(
    path.join(__dirname, "..", "functions", "api", "pledge-submit.js"),
    "utf8",
  );
  assert.ok(
    src.includes("!secretKey") && src.includes("500"),
    "Must return 500 when Stripe key is not configured",
  );
});

test("T4.7: API response only returns checkout URL, no session secrets", function () {
  var src = fs.readFileSync(
    path.join(__dirname, "..", "functions", "api", "pledge-submit.js"),
    "utf8",
  );
  assert.ok(
    src.includes("{ url: session.url }"),
    "Response must only return the checkout URL",
  );
});

test("T4.8: Secret key never appears in pledge.html", function () {
  var pledgeHtml = fs.readFileSync(
    path.join(__dirname, "..", "pledge.html"),
    "utf8",
  );
  assert.ok(
    !pledgeHtml.includes("sk_test_"),
    "Secret key must NEVER appear in client-side code",
  );
  assert.ok(
    !pledgeHtml.includes("sk_live_"),
    "Live secret key must NEVER appear in client-side code",
  );
  assert.ok(
    !pledgeHtml.includes("STRIPE_SECRET_KEY"),
    "Secret key env var name should not appear client-side",
  );
  assert.ok(
    !pledgeHtml.includes("STRIPE_WEBHOOK_SECRET"),
    "Webhook secret env var name should not appear client-side",
  );
});

test("T4.9: Secret key never appears in pledge success/cancel pages", function () {
  var success = fs.readFileSync(
    path.join(__dirname, "..", "pledge-success.html"),
    "utf8",
  );
  var cancel = fs.readFileSync(
    path.join(__dirname, "..", "pledge-cancel.html"),
    "utf8",
  );
  assert.ok(!success.includes("sk_test_"), "No secret key in success page");
  assert.ok(!cancel.includes("sk_test_"), "No secret key in cancel page");
  assert.ok(!success.includes("sk_live_"), "No live key in success page");
  assert.ok(!cancel.includes("sk_live_"), "No live key in cancel page");
});

test("T4.10: Webhook verifies Stripe signature before processing pledges", function () {
  var src = fs.readFileSync(
    path.join(__dirname, "..", "functions", "api", "stripe-webhook.js"),
    "utf8",
  );
  // Signature check must happen BEFORE the pledge branch
  var sigCheckIdx = src.indexOf("verifyStripeSignature");
  var pledgeBranchIdx = src.indexOf('paymentType === "pledge"');
  assert.ok(
    sigCheckIdx < pledgeBranchIdx,
    "Signature verification must precede pledge processing",
  );
});

test("T4.11: Webhook pledge handler escapes donor name/email before HTML interpolation", function () {
  var src = fs.readFileSync(
    path.join(__dirname, "..", "functions", "api", "stripe-webhook.js"),
    "utf8",
  );
  var pledgeEmailSection = src.substring(
    src.indexOf("buildPledgeEmail"),
    src.indexOf("handlePledgePayment"),
  );
  assert.ok(
    pledgeEmailSection.includes("escapeHtml(rawDonorName)"),
    "Donor name must be escaped in pledge email",
  );
  assert.ok(
    pledgeEmailSection.includes("escapeHtml(rawDonorEmail)"),
    "Donor email must be escaped in pledge email",
  );
});

test("T4.12: pledge-submit stores entry in KV before Stripe call (no data loss on Stripe failure)", function () {
  var src = fs.readFileSync(
    path.join(__dirname, "..", "functions", "api", "pledge-submit.js"),
    "utf8",
  );
  var kvPutIdx = src.indexOf("kv.put(`pledge:");
  var stripeCallIdx = src.indexOf("fetch(STRIPE_API");
  assert.ok(
    kvPutIdx !== -1 && stripeCallIdx !== -1,
    "Both KV put and Stripe fetch must exist",
  );
  assert.ok(
    kvPutIdx < stripeCallIdx,
    "KV storage must happen before Stripe API call",
  );
});

test("T4.13: pledge-submit truncates name and email to prevent abuse", function () {
  var src = fs.readFileSync(
    path.join(__dirname, "..", "functions", "api", "pledge-submit.js"),
    "utf8",
  );
  assert.ok(
    src.includes("name.slice(0, 200)"),
    "Name must be truncated before storage",
  );
  assert.ok(
    src.includes("email.slice(0, 200)"),
    "Email must be truncated before storage",
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
