// ============================================================
// Evaluation Video Upload Tests
//
// T1: Unit tests -- type allowlist, size cap, key generation, metadata
// T2: Integration tests -- file existence, exports, bindings, page structure
// T3: Acceptance tests -- passcode flow, metadata storage, review compatibility
// T4: Adversarial tests -- same security surface as media-upload
//
// Run: node tests/evaluation-upload.test.js
// ============================================================

const assert = require("assert");
const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;

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

function readSrc(relPath) {
  return fs.readFileSync(path.join(__dirname, "..", relPath), "utf8");
}

var fnSrc = readSrc("functions/api/evaluation-upload.js");
var pageSrc = readSrc("evaluation-upload.html");

// ============================================================
// T1: Unit tests
// ============================================================
console.log("\n--- T1: Unit Tests ---");

test("T1.1: MAX_FILE_SIZE is 100 MB", function () {
  assert.ok(fnSrc.includes("100 * 1024 * 1024") || fnSrc.includes("104857600"));
});

test("T1.2: ALLOWED_TYPES includes video formats", function () {
  assert.ok(fnSrc.includes("video/mp4"));
  assert.ok(fnSrc.includes("video/quicktime"));
});

test("T1.3: storage key uses uploads/ prefix (same bucket as general media)", function () {
  assert.ok(fnSrc.includes("uploads/"));
});

test("T1.4: metadata includes submissionType: evaluation", function () {
  assert.ok(
    fnSrc.includes('"evaluation"') || fnSrc.includes("'evaluation'"),
    "Must tag metadata with submissionType evaluation",
  );
  assert.ok(fnSrc.includes("submissionType"));
});

test("T1.5: metadata includes playerName field", function () {
  assert.ok(fnSrc.includes("playerName"));
});

test("T1.6: metadata includes playerPosition field", function () {
  assert.ok(fnSrc.includes("playerPosition"));
});

test("T1.7: rate limit key is separate from general media uploads", function () {
  assert.ok(
    fnSrc.includes("eval-upload") || fnSrc.includes("evaluation"),
    "Rate limit key should distinguish evaluation uploads",
  );
});

// ============================================================
// T2: Integration tests
// ============================================================
console.log("\n--- T2: Integration Tests ---");

test("T2.1: evaluation-upload.js exists", function () {
  assert.ok(
    fs.existsSync(
      path.join(__dirname, "..", "functions", "api", "evaluation-upload.js"),
    ),
  );
});

test("T2.2: evaluation-upload.html exists", function () {
  assert.ok(
    fs.existsSync(path.join(__dirname, "..", "evaluation-upload.html")),
  );
});

test("T2.3: exports onRequestPost", function () {
  assert.ok(/export async function onRequestPost/.test(fnSrc));
});

test("T2.4: exports onRequestOptions for CORS", function () {
  assert.ok(/export async function onRequestOptions/.test(fnSrc));
});

test("T2.5: reads FAF_MEDIA_PASSCODE from env (fan passcode, not admin)", function () {
  assert.ok(fnSrc.includes("FAF_MEDIA_PASSCODE"));
  assert.ok(
    !fnSrc.includes("FAF_MEDIA_ADMIN_PASSCODE"),
    "Must NOT use admin passcode",
  );
});

test("T2.6: reads MEDIA_BUCKET from env", function () {
  assert.ok(fnSrc.includes("MEDIA_BUCKET"));
});

test("T2.7: page points to /api/evaluation-upload", function () {
  assert.ok(pageSrc.includes("/api/evaluation-upload"));
});

test("T2.8: page has passcode input field", function () {
  assert.ok(pageSrc.includes("passcode"));
});

test("T2.9: page has player name field", function () {
  assert.ok(pageSrc.includes("playerName"));
});

test("T2.10: page has position field", function () {
  assert.ok(pageSrc.includes("playerPosition") || pageSrc.includes("position"));
});

test("T2.11: page has noindex meta tag (semi-private)", function () {
  assert.ok(pageSrc.includes("noindex"));
});

test("T2.12: page loads feedback-widget.js", function () {
  assert.ok(pageSrc.includes("feedback-widget.js"));
});

test("T2.13: page loads skills-clinic-banner.js", function () {
  assert.ok(pageSrc.includes("skills-clinic-banner.js"));
});

// ============================================================
// T3: Acceptance tests
// ============================================================
console.log("\n--- T3: Acceptance Tests ---");

test("T3.1: stores file in R2 with custom metadata", function () {
  assert.ok(fnSrc.includes("bucket.put"));
  assert.ok(fnSrc.includes("customMetadata"));
});

test("T3.2: stored metadata distinguishes evaluations from general media", function () {
  assert.ok(fnSrc.includes("submissionType"));
});

test("T3.3: uploads go to same R2 prefix as general media (reuse review infra)", function () {
  assert.ok(
    fnSrc.includes("`uploads/"),
    "Must use uploads/ prefix so media-review.js can list them",
  );
});

test("T3.4: page XHR sends playerName and playerPosition in FormData", function () {
  assert.ok(pageSrc.includes("playerName"));
  assert.ok(pageSrc.includes("playerPosition") || pageSrc.includes("position"));
});

test("T3.5: success message reassures user about coach review", function () {
  assert.ok(
    fnSrc.includes("review") || fnSrc.includes("team"),
    "Success message should mention review process",
  );
});

// ============================================================
// T4: Adversarial tests
// ============================================================
console.log("\n--- T4: Adversarial Tests ---");

test("T4.1: server-side passcode check (not client-only)", function () {
  assert.ok(
    fnSrc.includes("env.FAF_MEDIA_PASSCODE") ||
      fnSrc.includes("context.env.FAF_MEDIA_PASSCODE"),
  );
});

test("T4.2: file type checked server-side", function () {
  assert.ok(fnSrc.includes("ALLOWED_TYPES"));
});

test("T4.3: file size checked server-side", function () {
  assert.ok(fnSrc.includes("MAX_FILE_SIZE"));
});

test("T4.4: randomized storage key (no client filename trust)", function () {
  assert.ok(fnSrc.includes("randomUUID") || fnSrc.includes("crypto"));
});

test("T4.5: rate limiting present", function () {
  assert.ok(fnSrc.includes("RATE_LIMIT"));
  assert.ok(fnSrc.includes("429"));
});

test("T4.6: rate limit uses CF-Connecting-IP", function () {
  assert.ok(fnSrc.includes("CF-Connecting-IP"));
});

test("T4.7: no passcode value in page source", function () {
  var lower = pageSrc.toLowerCase();
  assert.ok(
    !lower.includes("faf_media_passcode"),
    "Passcode env var name must not appear in client HTML",
  );
});

test("T4.8: missing env var returns 500, not bypass", function () {
  assert.ok(fnSrc.includes("500"));
  assert.ok(
    fnSrc.includes("not configured") || fnSrc.includes("is not configured"),
  );
});

test("T4.9: field lengths are truncated server-side", function () {
  assert.ok(fnSrc.includes("slice(0,") || fnSrc.includes(".slice(0, "));
});

// ============================================================
// Summary
// ============================================================
console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
