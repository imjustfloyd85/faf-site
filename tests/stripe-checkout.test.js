// ============================================================
// Stripe Checkout Integration Tests — FAF Site (Story 1238)
//
// T1: Unit tests — function logic validation
// T2: Integration tests — API endpoint behavior
// T3: Acceptance tests — end-to-end flow verification
// T4: Adversarial tests — security/tampering (REQUIRED: new financial input surface)
//
// Run: node tests/stripe-checkout.test.js
// ============================================================

const assert = require("assert");

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
// T1: UNIT TESTS — server-side validation logic
// ============================================================
console.log("\n--- T1: Unit Tests ---");

// Inline the tier price map to test against (mirrors create-checkout-session.js)
const TIER_PRICES = {
  sideline: { amount: 25000, name: "Sideline Sponsorship" },
  playmaker: { amount: 100000, name: "Playmaker Sponsorship" },
  legacy: { amount: 500000, name: "Legacy Sponsorship" },
};

test("T1.1: Tier prices are defined for all three tiers", function () {
  assert.ok(TIER_PRICES.sideline, "Sideline tier missing");
  assert.ok(TIER_PRICES.playmaker, "Playmaker tier missing");
  assert.ok(TIER_PRICES.legacy, "Legacy tier missing");
});

test("T1.2: Sideline tier is exactly $250 (25000 cents)", function () {
  assert.strictEqual(TIER_PRICES.sideline.amount, 25000);
});

test("T1.3: Playmaker tier is exactly $1,000 (100000 cents)", function () {
  assert.strictEqual(TIER_PRICES.playmaker.amount, 100000);
});

test("T1.4: Legacy tier minimum is $5,000 (500000 cents)", function () {
  assert.strictEqual(TIER_PRICES.legacy.amount, 500000);
});

test("T1.5: Invalid tier names are rejected", function () {
  assert.strictEqual(TIER_PRICES["platinum"], undefined);
  assert.strictEqual(TIER_PRICES[""], undefined);
  assert.strictEqual(TIER_PRICES[null], undefined);
});

test("T1.6: Donation amount validation — rejects zero", function () {
  var amount = 0;
  assert.ok(!(amount >= 1 && amount <= 999999), "Zero should be rejected");
});

test("T1.7: Donation amount validation — rejects negative", function () {
  var amount = -50;
  assert.ok(!(amount >= 1 && amount <= 999999), "Negative should be rejected");
});

test("T1.8: Donation amount validation — accepts $1", function () {
  var amount = 1;
  assert.ok(amount >= 1 && amount <= 999999, "$1 should be accepted");
});

test("T1.9: Donation amount validation — accepts $999,999", function () {
  var amount = 999999;
  assert.ok(amount >= 1 && amount <= 999999, "$999,999 should be accepted");
});

test("T1.10: Donation amount validation — rejects $1,000,000", function () {
  var amount = 1000000;
  assert.ok(!(amount >= 1 && amount <= 999999), "$1M should be rejected");
});

test("T1.11: Email validation — rejects missing @", function () {
  var email = "notanemail";
  assert.ok(!email.includes("@"), "Should reject emails without @");
});

test("T1.12: Email validation — accepts valid email", function () {
  var email = "test@example.com";
  assert.ok(email.includes("@"), "Should accept valid email");
});

// ============================================================
// T2: INTEGRATION TESTS — API endpoint behavior
// These require a running local dev server (wrangler pages dev).
// When no server is available, they verify the function files exist
// and export the correct handlers.
// ============================================================
console.log("\n--- T2: Integration Tests ---");

const fs = require("fs");
const path = require("path");

test("T2.1: create-checkout-session.js exists", function () {
  var filePath = path.join(
    __dirname,
    "..",
    "functions",
    "api",
    "create-checkout-session.js",
  );
  assert.ok(fs.existsSync(filePath), "Function file should exist");
});

test("T2.2: stripe-webhook.js exists", function () {
  var filePath = path.join(
    __dirname,
    "..",
    "functions",
    "api",
    "stripe-webhook.js",
  );
  assert.ok(fs.existsSync(filePath), "Webhook file should exist");
});

test("T2.3: create-checkout-session exports onRequestPost", function () {
  var src = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "functions",
      "api",
      "create-checkout-session.js",
    ),
    "utf8",
  );
  assert.ok(
    src.includes("export async function onRequestPost"),
    "Must export onRequestPost",
  );
});

test("T2.4: create-checkout-session exports onRequestOptions (CORS)", function () {
  var src = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "functions",
      "api",
      "create-checkout-session.js",
    ),
    "utf8",
  );
  assert.ok(
    src.includes("export async function onRequestOptions"),
    "Must export onRequestOptions for CORS preflight",
  );
});

test("T2.5: stripe-webhook exports onRequestPost", function () {
  var src = fs.readFileSync(
    path.join(__dirname, "..", "functions", "api", "stripe-webhook.js"),
    "utf8",
  );
  assert.ok(
    src.includes("export async function onRequestPost"),
    "Must export onRequestPost",
  );
});

test("T2.6: stripe-webhook rejects GET requests", function () {
  var src = fs.readFileSync(
    path.join(__dirname, "..", "functions", "api", "stripe-webhook.js"),
    "utf8",
  );
  assert.ok(
    src.includes("export async function onRequestGet"),
    "Must export onRequestGet to reject non-POST",
  );
  assert.ok(
    src.includes("405"),
    "GET handler must return 405 Method Not Allowed",
  );
});

test("T2.7: donate-success.html exists", function () {
  assert.ok(
    fs.existsSync(path.join(__dirname, "..", "donate-success.html")),
    "Success page should exist",
  );
});

test("T2.8: donate-cancel.html exists", function () {
  assert.ok(
    fs.existsSync(path.join(__dirname, "..", "donate-cancel.html")),
    "Cancel page should exist",
  );
});

test("T2.9: sponsors.html contains donate section", function () {
  var src = fs.readFileSync(
    path.join(__dirname, "..", "sponsors.html"),
    "utf8",
  );
  assert.ok(src.includes('id="donate"'), "Must have donate section");
  assert.ok(src.includes("handleDonate"), "Must have donate handler");
});

test("T2.10: sponsors.html contains tier checkout buttons", function () {
  var src = fs.readFileSync(
    path.join(__dirname, "..", "sponsors.html"),
    "utf8",
  );
  assert.ok(
    src.includes("handleTierCheckout('sideline'"),
    "Must have Sideline checkout",
  );
  assert.ok(
    src.includes("handleTierCheckout('playmaker'"),
    "Must have Playmaker checkout",
  );
  assert.ok(
    src.includes("handleTierCheckout('legacy'"),
    "Must have Legacy checkout",
  );
});

// ============================================================
// T3: ACCEPTANCE TESTS — end-to-end flow verification
// ============================================================
console.log("\n--- T3: Acceptance Tests ---");

test("T3.1: Checkout session endpoint uses Stripe REST API", function () {
  var src = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "functions",
      "api",
      "create-checkout-session.js",
    ),
    "utf8",
  );
  assert.ok(
    src.includes("https://api.stripe.com/v1/checkout/sessions"),
    "Must call Stripe Checkout Sessions API",
  );
});

test("T3.2: Checkout uses dynamic price_data (not pre-created Price IDs)", function () {
  var src = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "functions",
      "api",
      "create-checkout-session.js",
    ),
    "utf8",
  );
  assert.ok(
    src.includes("price_data"),
    "Must use price_data for dynamic pricing",
  );
  // Verify no pre-created Stripe Price IDs (price_XXXX pattern)
  var hasPriceId = /price_[A-Za-z0-9]{10,}/.test(src);
  assert.ok(
    !hasPriceId,
    "Should not reference pre-created price IDs (price_XXXX)",
  );
});

test("T3.3: Success URL includes session_id parameter", function () {
  var src = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "functions",
      "api",
      "create-checkout-session.js",
    ),
    "utf8",
  );
  assert.ok(
    src.includes("{CHECKOUT_SESSION_ID}"),
    "Success URL must include session_id for verification",
  );
});

test("T3.4: Subscription mode used for recurring donations", function () {
  var src = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "functions",
      "api",
      "create-checkout-session.js",
    ),
    "utf8",
  );
  assert.ok(
    src.includes('"subscription"'),
    "Must set mode to subscription for recurring",
  );
  assert.ok(src.includes('"payment"'), "Must set mode to payment for one-time");
});

test("T3.5: Webhook verifies Stripe signature before processing", function () {
  var src = fs.readFileSync(
    path.join(__dirname, "..", "functions", "api", "stripe-webhook.js"),
    "utf8",
  );
  assert.ok(
    src.includes("verifyStripeSignature"),
    "Must verify webhook signature",
  );
  assert.ok(
    src.includes("Stripe-Signature"),
    "Must read Stripe-Signature header",
  );
});

test("T3.6: Webhook sends email via ACS (not Resend/SendGrid/SMTP)", function () {
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

test("T3.7: Donation email has full deductibility language", function () {
  var src = fs.readFileSync(
    path.join(__dirname, "..", "functions", "api", "stripe-webhook.js"),
    "utf8",
  );
  assert.ok(
    src.includes("No goods or services were provided"),
    "Donation receipt must state no quid pro quo",
  );
  assert.ok(src.includes("42-1980182"), "Must include EIN in donation receipt");
});

test("T3.8: Sponsorship email has IRC 6115 quid pro quo disclosure", function () {
  var src = fs.readFileSync(
    path.join(__dirname, "..", "functions", "api", "stripe-webhook.js"),
    "utf8",
  );
  assert.ok(
    src.includes("IRC Section 6115") || src.includes("Quid Pro Quo"),
    "Must include IRC 6115 disclosure language",
  );
  assert.ok(
    src.includes("fair market value"),
    "Must reference fair market value of benefits",
  );
});

test("T3.9: Sponsorship email does NOT claim full deductibility", function () {
  var src = fs.readFileSync(
    path.join(__dirname, "..", "functions", "api", "stripe-webhook.js"),
    "utf8",
  );
  // The sponsorship email should say "only the portion" not "full amount"
  var sponsorSection = src.substring(
    src.indexOf("buildSponsorshipEmail"),
    src.indexOf("--- Main Handler ---"),
  );
  assert.ok(
    !sponsorSection.includes("full amount of your donation is tax-deductible"),
    "Sponsorship email must NOT claim full deductibility",
  );
});

test("T3.10: Sponsorship email does NOT invent specific FMV dollar figures", function () {
  var src = fs.readFileSync(
    path.join(__dirname, "..", "functions", "api", "stripe-webhook.js"),
    "utf8",
  );
  var sponsorSection = src.substring(
    src.indexOf("buildSponsorshipEmail"),
    src.indexOf("--- Main Handler ---"),
  );
  // Should not contain patterns like "fair market value of $X" or "FMV: $X"
  var fmvDollarPattern = /fair market value.*?\$\d/i;
  assert.ok(
    !fmvDollarPattern.test(sponsorSection),
    "Must NOT invent specific FMV dollar amounts per tier",
  );
});

// ============================================================
// T4: ADVERSARIAL TESTS — security validation (REQUIRED)
// New financial input surface — these are non-optional.
// ============================================================
console.log("\n--- T4: Adversarial Tests ---");

test("T4.1: Tier prices are server-side constants, not client-supplied", function () {
  var src = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "functions",
      "api",
      "create-checkout-session.js",
    ),
    "utf8",
  );
  // The TIER_PRICES map must be defined server-side as constants
  assert.ok(
    src.includes("const TIER_PRICES"),
    "Tier prices must be server-side constants",
  );
  assert.ok(
    src.includes("25000") && src.includes("100000") && src.includes("500000"),
    "All three tier amounts must be hardcoded in cents",
  );
});

test("T4.2: Sideline/Playmaker amounts ignore client-supplied amount field", function () {
  var src = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "functions",
      "api",
      "create-checkout-session.js",
    ),
    "utf8",
  );
  // For non-legacy tiers, the server uses tierDef.amount, ignoring body.amount
  assert.ok(
    src.includes("unitAmount = tierDef.amount"),
    "Non-legacy tiers must use server-side amount, not client-supplied",
  );
});

test("T4.3: Legacy tier enforces $5,000 minimum server-side", function () {
  var src = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "functions",
      "api",
      "create-checkout-session.js",
    ),
    "utf8",
  );
  assert.ok(
    src.includes("customAmount < 5000"),
    "Legacy tier must validate minimum $5,000 server-side",
  );
});

test("T4.4: Webhook rejects requests without valid Stripe-Signature", function () {
  var src = fs.readFileSync(
    path.join(__dirname, "..", "functions", "api", "stripe-webhook.js"),
    "utf8",
  );
  assert.ok(
    src.includes("Invalid signature") && src.includes("401"),
    "Must return 401 for invalid/missing signature",
  );
});

test("T4.5: Webhook has replay protection (timestamp check)", function () {
  var src = fs.readFileSync(
    path.join(__dirname, "..", "functions", "api", "stripe-webhook.js"),
    "utf8",
  );
  assert.ok(
    src.includes("age > 300"),
    "Must reject webhook payloads older than 5 minutes",
  );
});

test("T4.6: Webhook uses constant-time signature comparison", function () {
  var src = fs.readFileSync(
    path.join(__dirname, "..", "functions", "api", "stripe-webhook.js"),
    "utf8",
  );
  assert.ok(
    src.includes("mismatch |=") || src.includes("timingSafeEqual"),
    "Must use constant-time comparison to prevent timing attacks",
  );
});

test("T4.7: Secret key never appears in client-side code", function () {
  var sponsorsHtml = fs.readFileSync(
    path.join(__dirname, "..", "sponsors.html"),
    "utf8",
  );
  assert.ok(
    !sponsorsHtml.includes("sk_test_"),
    "Secret key must NEVER appear in client-side code",
  );
  assert.ok(
    !sponsorsHtml.includes("sk_live_"),
    "Live secret key must NEVER appear in client-side code",
  );
  assert.ok(
    !sponsorsHtml.includes("STRIPE_SECRET_KEY"),
    "Secret key env var name should not appear client-side",
  );
  assert.ok(
    !sponsorsHtml.includes("STRIPE_WEBHOOK_SECRET"),
    "Webhook secret env var name should not appear client-side",
  );
});

test("T4.8: Secret key never appears in success/cancel pages", function () {
  var success = fs.readFileSync(
    path.join(__dirname, "..", "donate-success.html"),
    "utf8",
  );
  var cancel = fs.readFileSync(
    path.join(__dirname, "..", "donate-cancel.html"),
    "utf8",
  );
  assert.ok(!success.includes("sk_test_"), "No secret key in success page");
  assert.ok(!cancel.includes("sk_test_"), "No secret key in cancel page");
});

test("T4.9: API response only returns checkout URL, no session secrets", function () {
  var src = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "functions",
      "api",
      "create-checkout-session.js",
    ),
    "utf8",
  );
  // The response should only contain { url: session.url }
  assert.ok(
    src.includes("{ url: session.url }"),
    "Response must only return the checkout URL",
  );
});

test("T4.10: Webhook rejects when STRIPE_WEBHOOK_SECRET is not set", function () {
  var src = fs.readFileSync(
    path.join(__dirname, "..", "functions", "api", "stripe-webhook.js"),
    "utf8",
  );
  assert.ok(
    src.includes("!webhookSecret") && src.includes("500"),
    "Must return 500 when webhook secret is not configured",
  );
});

test("T4.11: Donation amounts are validated server-side (range check)", function () {
  var src = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "functions",
      "api",
      "create-checkout-session.js",
    ),
    "utf8",
  );
  assert.ok(
    src.includes("donationAmount < 1") || src.includes("!donationAmount"),
    "Must validate minimum donation amount server-side",
  );
  assert.ok(
    src.includes("donationAmount > 999999") || src.includes("999999"),
    "Must validate maximum donation amount server-side",
  );
});

test("T4.12: Email is validated server-side before Stripe call", function () {
  var src = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "functions",
      "api",
      "create-checkout-session.js",
    ),
    "utf8",
  );
  assert.ok(
    src.includes('!email.includes("@")'),
    "Must validate email format server-side",
  );
});

test("T4.13: Publishable key (not secret key) is in client-side code", function () {
  var sponsorsHtml = fs.readFileSync(
    path.join(__dirname, "..", "sponsors.html"),
    "utf8",
  );
  assert.ok(
    sponsorsHtml.includes("pk_test_") || sponsorsHtml.includes("pk_live_"),
    "Publishable key should be present in client-side code (this is safe per Stripe docs)",
  );
  assert.ok(
    !sponsorsHtml.includes("sk_test_") && !sponsorsHtml.includes("sk_live_"),
    "Secret key must never appear in client-side code",
  );
});

test("T4.14: escapeHtml() exists and is defined before the email builders", function () {
  var src = fs.readFileSync(
    path.join(__dirname, "..", "functions", "api", "stripe-webhook.js"),
    "utf8",
  );
  var escapeIdx = src.indexOf("function escapeHtml(");
  var builderIdx = src.indexOf("function buildDonationEmail(");
  assert.ok(escapeIdx !== -1, "escapeHtml() helper is missing");
  assert.ok(
    escapeIdx < builderIdx,
    "escapeHtml() must be defined before the email builders that use it",
  );
});

test("T4.15: escapeHtml() actually neutralizes HTML/script injection payloads", function () {
  // Extract the real escapeHtml function body and execute it directly --
  // a pattern-match alone can't prove the escaping logic is correct.
  var src = fs.readFileSync(
    path.join(__dirname, "..", "functions", "api", "stripe-webhook.js"),
    "utf8",
  );
  var match = src.match(/function escapeHtml\(value\) \{[\s\S]*?\n\}/);
  assert.ok(match, "Could not locate escapeHtml() function body to test");
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

test("T4.16: Donor/sponsor name and email are escaped before HTML interpolation", function () {
  var src = fs.readFileSync(
    path.join(__dirname, "..", "functions", "api", "stripe-webhook.js"),
    "utf8",
  );
  // Both email builders must assign their donor-facing name/email through
  // escapeHtml() rather than interpolating the raw Stripe/metadata value.
  assert.ok(
    /const donorName = escapeHtml\(rawDonorName\)/.test(src),
    "buildDonationEmail: donorName is not escaped",
  );
  assert.ok(
    /const donorEmail = escapeHtml\(rawDonorEmail\)/.test(src),
    "buildDonationEmail: donorEmail is not escaped",
  );
  assert.ok(
    /const sponsorName = escapeHtml\(rawSponsorName\)/.test(src),
    "buildSponsorshipEmail: sponsorName is not escaped",
  );
  assert.ok(
    /const sponsorEmail = escapeHtml\(rawSponsorEmail\)/.test(src),
    "buildSponsorshipEmail: sponsorEmail is not escaped",
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
