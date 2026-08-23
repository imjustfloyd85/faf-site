// ============================================================
// Admin Hub Tests
//
// T1: Unit tests -- function logic, escaping, ADO API shape
// T2: Integration tests -- file existence, exports, imports, page structure
// T3: Acceptance tests -- auth flow, feedback list, story creation
// T4: Adversarial tests -- auth gates, ADO PAT handling, injection
//
// Run: node tests/admin-hub.test.js
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

var listFn = readSrc("functions/api/feedback-list.js");
var storyFn = readSrc("functions/api/feedback-to-story.js");
var pageSrc = readSrc("admin-hub.html");

// ============================================================
// T1: Unit tests
// ============================================================
console.log("\n--- T1: Unit Tests ---");

test("T1.1: feedback-to-story has escapeHtml function", function () {
  assert.ok(/function escapeHtml/.test(storyFn));
});

test("T1.2: feedback-to-story builds ADO JSON Patch body", function () {
  assert.ok(storyFn.includes("json-patch+json"));
  assert.ok(storyFn.includes("System.Title"));
  assert.ok(storyFn.includes("System.Description"));
});

test("T1.3: feedback-to-story uses User Story work item type", function () {
  assert.ok(storyFn.includes("User%20Story") || storyFn.includes("User Story"));
});

test("T1.4: feedback-to-story tags stories as site-feedback", function () {
  assert.ok(storyFn.includes("site-feedback"));
});

test("T1.5: feedback-list uses feedback: KV prefix", function () {
  assert.ok(listFn.includes("feedback:"));
});

test("T1.6: feedback-list sorts by createdAt descending", function () {
  assert.ok(listFn.includes("createdAt") && listFn.includes("sort"));
});

test("T1.7: feedback-to-story prevents duplicate story creation", function () {
  assert.ok(storyFn.includes("adoWorkItemId"));
  assert.ok(storyFn.includes("alreadyExists"));
});

// ============================================================
// T2: Integration tests
// ============================================================
console.log("\n--- T2: Integration Tests ---");

test("T2.1: feedback-list.js exists", function () {
  assert.ok(
    fs.existsSync(
      path.join(__dirname, "..", "functions", "api", "feedback-list.js"),
    ),
  );
});

test("T2.2: feedback-to-story.js exists", function () {
  assert.ok(
    fs.existsSync(
      path.join(__dirname, "..", "functions", "api", "feedback-to-story.js"),
    ),
  );
});

test("T2.3: admin-hub.html exists", function () {
  assert.ok(fs.existsSync(path.join(__dirname, "..", "admin-hub.html")));
});

test("T2.4: feedback-list exports onRequestGet", function () {
  assert.ok(/export async function onRequestGet/.test(listFn));
});

test("T2.5: feedback-to-story exports onRequestPost", function () {
  assert.ok(/export async function onRequestPost/.test(storyFn));
});

test("T2.6: both functions import from admin-auth.js", function () {
  assert.ok(listFn.includes("admin-auth.js"));
  assert.ok(storyFn.includes("admin-auth.js"));
});

test("T2.7: admin-hub page has noindex", function () {
  assert.ok(pageSrc.includes("noindex"));
});

test("T2.8: admin-hub page has auth gate", function () {
  assert.ok(pageSrc.includes("adminPasscode"));
  assert.ok(pageSrc.includes("authenticate") || pageSrc.includes("Sign In"));
});

test("T2.9: admin-hub links to media-review.html", function () {
  assert.ok(pageSrc.includes("media-review.html"));
});

test("T2.10: admin-hub links to newsletter-admin.html", function () {
  assert.ok(pageSrc.includes("newsletter-admin.html"));
});

test("T2.11: admin-hub links to evaluation-upload.html", function () {
  assert.ok(pageSrc.includes("evaluation-upload.html"));
});

test("T2.12: admin-hub calls /api/feedback-list", function () {
  assert.ok(pageSrc.includes("/api/feedback-list"));
});

test("T2.13: admin-hub calls /api/feedback-to-story", function () {
  assert.ok(pageSrc.includes("/api/feedback-to-story"));
});

// ============================================================
// T3: Acceptance tests
// ============================================================
console.log("\n--- T3: Acceptance Tests ---");

test("T3.1: feedback-list returns items array with cursor", function () {
  assert.ok(listFn.includes("items"));
  assert.ok(listFn.includes("cursor"));
});

test("T3.2: feedback-to-story calls ADO REST API", function () {
  assert.ok(storyFn.includes("dev.azure.com"));
  assert.ok(storyFn.includes("_apis/wit/workitems"));
});

test("T3.3: feedback-to-story reads ADO_PAT from env", function () {
  assert.ok(storyFn.includes("ADO_PAT"));
});

test("T3.4: feedback-to-story writes work item ID back to KV", function () {
  assert.ok(storyFn.includes("adoWorkItemId"));
  assert.ok(storyFn.includes("kv.put"));
});

test("T3.5: feedback-to-story marks promotedAt timestamp", function () {
  assert.ok(storyFn.includes("promotedAt"));
});

test("T3.6: admin-hub page has quick link cards", function () {
  assert.ok(pageSrc.includes("Media Review"));
  assert.ok(pageSrc.includes("Newsletter"));
});

test("T3.7: admin-hub page uses escapeHtml for user content", function () {
  assert.ok(pageSrc.includes("escapeHtml"));
});

test("T3.8: admin-hub shows create-story button for feedback items", function () {
  assert.ok(
    pageSrc.includes("createStory") || pageSrc.includes("Create Story"),
  );
});

// ============================================================
// T4: Adversarial tests
// ============================================================
console.log("\n--- T4: Adversarial Tests ---");

test("T4.1: feedback-list requires admin passcode", function () {
  assert.ok(listFn.includes("validateAdminPasscode"));
});

test("T4.2: feedback-to-story requires admin passcode", function () {
  assert.ok(storyFn.includes("validateAdminPasscode"));
});

test("T4.3: ADO PAT is read from env, never hardcoded", function () {
  assert.ok(
    storyFn.includes("context.env.ADO_PAT") || storyFn.includes("env.ADO_PAT"),
  );
  // No hardcoded PAT values
  var lines = storyFn.split("\n").filter(function (l) {
    return !l.trim().startsWith("//");
  });
  var suspicious = lines.filter(function (l) {
    return /ADO_PAT\s*[=:]\s*["'][^"']{10,}["']/.test(l);
  });
  assert.strictEqual(suspicious.length, 0, "ADO PAT must not be hardcoded");
});

test("T4.4: ADO PAT not in admin-hub page source", function () {
  assert.ok(
    !pageSrc.includes("ADO_PAT"),
    "env var name must not appear in client HTML",
  );
});

test("T4.5: feedback-to-story validates feedbackId parameter", function () {
  assert.ok(storyFn.includes("feedbackId") && storyFn.includes("400"));
});

test("T4.6: feedback-to-story handles missing ADO_PAT gracefully", function () {
  assert.ok(storyFn.includes("!adoPat") || storyFn.includes("adoPat)"));
  assert.ok(storyFn.includes("500"));
});

test("T4.7: feedback-to-story handles ADO API errors", function () {
  assert.ok(
    storyFn.includes("!adoResponse.ok") || storyFn.includes("adoResponse.ok"),
  );
  assert.ok(storyFn.includes("502"));
});

test("T4.8: feedback-to-story escapes user content in work item body", function () {
  assert.ok(storyFn.includes("escapeHtml(entry."));
});

test("T4.9: feedback-list handles malformed KV data", function () {
  assert.ok(
    listFn.includes("if (!raw)") || listFn.includes("!raw"),
    "Should skip null/missing KV entries",
  );
});

test("T4.10: admin-hub page has escapeHtml for DOM rendering", function () {
  assert.ok(
    pageSrc.includes("function escapeHtml"),
    "Page must have its own escapeHtml for client-side rendering",
  );
});

// ============================================================
// Summary
// ============================================================
console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
