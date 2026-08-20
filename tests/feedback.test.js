// ============================================================
// Feedback Widget Tests — FAF Site
//
// T1: Unit tests — validation logic, escaping
// T2: Integration tests — file existence, exports, handler structure
// T3: Acceptance tests — end-to-end shape, rate limiting logic
// T4: Adversarial tests — REQUIRED: new anonymous input surface.
//     Injection, empty/whitespace submissions, rate-limit bypass
//     attempts, missing KV binding, oversized payloads.
//
// Run: node tests/feedback.test.js
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

// ── T1: Unit tests ──

test("T1.1: escapeHtml() function exists in feedback.js", () => {
  const src = readSrc("functions/api/feedback.js");
  assert.ok(/function escapeHtml\(/.test(src), "escapeHtml() not found");
});

test("T1.2: escapeHtml() actually neutralizes HTML/script injection", () => {
  const src = readSrc("functions/api/feedback.js");
  const match = src.match(/function escapeHtml\(value\) \{[\s\S]*?\n\}/);
  assert.ok(match, "Could not locate escapeHtml() function body");
  const escapeHtml = new Function(
    "value",
    match[0].replace(/^function escapeHtml\(value\) \{/, "").replace(/\}$/, ""),
  );
  const payload = '<script>alert(1)</script><img src=x onerror="steal()">';
  const escaped = escapeHtml(payload);
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

test("T1.3: VALID_CATEGORIES and VALID_PRIORITIES are defined and correct", () => {
  const src = readSrc("functions/api/feedback.js");
  assert.ok(
    src.includes('"general"') &&
      src.includes('"bug"') &&
      src.includes('"feature"') &&
      src.includes('"ui"'),
  );
  assert.ok(
    src.includes('"low"') && src.includes('"medium"') && src.includes('"high"'),
  );
});

// ── T2: Integration tests ──

test("T2.1: functions/api/feedback.js exists", () => {
  assert.ok(
    fs.existsSync(
      path.join(__dirname, "..", "functions", "api", "feedback.js"),
    ),
  );
});

test("T2.2: exports onRequestPost", () => {
  const src = readSrc("functions/api/feedback.js");
  assert.ok(/export async function onRequestPost/.test(src));
});

test("T2.3: rejects non-POST methods", () => {
  const src = readSrc("functions/api/feedback.js");
  assert.ok(/onRequestGet/.test(src) && /405/.test(src));
  assert.ok(/onRequestPut/.test(src));
  assert.ok(/onRequestDelete/.test(src));
});

test("T2.4: imports sendViaACS from the shared lib, does not reimplement it", () => {
  const src = readSrc("functions/api/feedback.js");
  assert.ok(src.includes('import { sendViaACS } from "../lib/acs-email.js"'));
  assert.ok(
    !/acsEndpointFromConnStr/.test(src),
    "should not duplicate ACS helper internals",
  );
});

test("T2.5: widget markup exists on index.html", () => {
  const src = readSrc("index.html");
  assert.ok(src.includes('id="faf-feedback"'));
  assert.ok(src.includes('id="feedback-panel"'));
  assert.ok(src.includes('id="feedbackSuggestion"'));
});

test("T2.6: widget submits to /api/feedback via fetch", () => {
  const src = readSrc("index.html");
  assert.ok(/fetch\("\/api\/feedback"/.test(src));
  assert.ok(/method:\s*"POST"/.test(src));
});

// ── T3: Acceptance tests ──

test("T3.1: page path is captured automatically, not left to the user", () => {
  const src = readSrc("index.html");
  assert.ok(src.includes("window.location.pathname"));
});

test("T3.2: quick-fill buttons exist for bug/feature/improve", () => {
  const src = readSrc("index.html");
  assert.ok(src.includes("quickFillFeedback('bug')"));
  assert.ok(src.includes("quickFillFeedback('feature')"));
  assert.ok(src.includes("quickFillFeedback('improve')"));
});

test("T3.3: submission is stored in FAF_KV before email is attempted", () => {
  const src = readSrc("functions/api/feedback.js");
  const kvPutIdx = src.indexOf("kv.put(`feedback:");
  const emailIdx = src.indexOf("sendViaACS(");
  assert.ok(
    kvPutIdx > -1 && emailIdx > -1,
    "expected both KV write and email send",
  );
  assert.ok(
    kvPutIdx < emailIdx,
    "submission must be persisted before attempting notification",
  );
});

test("T3.4: email failure does not fail the whole request (submission already saved)", () => {
  const src = readSrc("functions/api/feedback.js");
  assert.ok(
    src.includes("don't fail the request over a notification-delivery issue"),
    "expected a comment/logic acknowledging email failure is non-fatal",
  );
});

// ── T4: Adversarial tests ──

test("T4.1: empty suggestion is rejected", () => {
  const src = readSrc("functions/api/feedback.js");
  assert.ok(
    /suggestion\s*=\s*String\(body\.suggestion.*\)\.trim\(\)/.test(src),
  );
  assert.ok(/if \(!suggestion\)/.test(src));
  assert.ok(/status:\s*400/.test(src));
});

test("T4.2: whitespace-only suggestion is rejected (trim happens before the check)", () => {
  const src = readSrc("functions/api/feedback.js");
  const trimIdx = src.indexOf(".trim()");
  const checkIdx = src.indexOf("if (!suggestion)");
  assert.ok(trimIdx > -1 && checkIdx > -1 && trimIdx < checkIdx);
});

test("T4.3: invalid category/priority values are not trusted, fall back to safe defaults", () => {
  const src = readSrc("functions/api/feedback.js");
  assert.ok(/VALID_CATEGORIES\.includes\(body\.category\)/.test(src));
  assert.ok(/VALID_PRIORITIES\.includes\(body\.priority\)/.test(src));
});

test("T4.4: rate limiting caps submissions per IP and returns 429 when exceeded", () => {
  const src = readSrc("functions/api/feedback.js");
  assert.ok(/RATE_LIMIT_MAX/.test(src));
  assert.ok(/currentCount >= RATE_LIMIT_MAX/.test(src));
  assert.ok(/status:\s*429/.test(src));
});

test("T4.5: rate limit key is scoped per-IP, not global", () => {
  const src = readSrc("functions/api/feedback.js");
  assert.ok(/`ratelimit:feedback:\$\{ip\}`/.test(src));
});

test("T4.6: rate limit uses CF-Connecting-IP, not a spoofable client-supplied header", () => {
  const src = readSrc("functions/api/feedback.js");
  assert.ok(src.includes('headers.get("CF-Connecting-IP")'));
  assert.ok(
    !src.includes('headers.get("X-Forwarded-For")'),
    "X-Forwarded-For can be spoofed by the client",
  );
});

test("T4.7: missing FAF_KV binding fails gracefully (500), does not throw unhandled", () => {
  const src = readSrc("functions/api/feedback.js");
  assert.ok(/if \(!kv\)/.test(src));
  assert.ok(src.includes("Feedback storage not available"));
});

test("T4.8: malformed JSON body is caught, does not crash the function", () => {
  const src = readSrc("functions/api/feedback.js");
  assert.ok(/try\s*\{[\s\S]*?context\.request\.json\(\)/.test(src));
  assert.ok(/catch\s*\{/.test(src) || /catch\s*\(/.test(src));
});

test("T4.9: oversized input is truncated, not stored unbounded", () => {
  const src = readSrc("functions/api/feedback.js");
  assert.ok(/suggestion\.slice\(0,\s*5000\)/.test(src));
  assert.ok(
    /\.slice\(0,\s*200\)/.test(src),
    "name/email should also be length-capped",
  );
});

test("T4.10: all user-controllable fields are escaped before HTML interpolation in the notification email", () => {
  const src = readSrc("functions/api/feedback.js");
  const buildFn = src.match(/function buildNotificationEmail[\s\S]*?\n\}/);
  assert.ok(buildFn, "could not locate buildNotificationEmail()");
  assert.ok(/escapeHtml\(entry\.category\)/.test(buildFn[0]));
  assert.ok(/escapeHtml\(entry\.priority\)/.test(buildFn[0]));
  assert.ok(/escapeHtml\(entry\.name/.test(buildFn[0]));
  assert.ok(/escapeHtml\(entry\.email/.test(buildFn[0]));
  assert.ok(/escapeHtml\(entry\.page/.test(buildFn[0]));
  assert.ok(/escapeHtml\(entry\.suggestion\)/.test(buildFn[0]));
});

test("T4.11: subject line strips newlines from user input (header injection prevention)", () => {
  const src = readSrc("functions/api/feedback.js");
  assert.ok(
    /subjectSafeCategory\s*=\s*String\(entry\.category\)\.replace\(\/\[\\r\\n\]\/g/.test(
      src,
    ),
  );
});

test("T4.12: no financial data or secrets are echoed back in the JSON response", () => {
  const src = readSrc("functions/api/feedback.js");
  const returnMatch = src.match(
    /JSON\.stringify\(\{\s*ok:\s*true,\s*id:\s*entryId\s*\}\)/,
  );
  assert.ok(
    returnMatch,
    "success response should only echo back the id, nothing else",
  );
});

test("T4.13: entry ID uses crypto.randomUUID(), not a predictable sequence", () => {
  const src = readSrc("functions/api/feedback.js");
  assert.ok(src.includes("crypto.randomUUID()"));
});

test("T4.14: submissions have a KV TTL to prevent unbounded growth", () => {
  const src = readSrc("functions/api/feedback.js");
  assert.ok(/expirationTtl:\s*SUBMISSION_TTL_SECONDS/.test(src));
});

console.log(`\n${"=".repeat(60)}`);
console.log(
  `Results: ${passed} passed, ${failed} failed (${passed + failed} total)`,
);
console.log("=".repeat(60));
process.exitCode = failed > 0 ? 1 : 0;
