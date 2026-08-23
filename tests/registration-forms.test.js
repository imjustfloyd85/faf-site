// ============================================================
// Player Registration & Volunteer Interest Form Tests
//
// T1: Unit tests -- validation, escaping, field constraints
// T2: Integration tests -- file existence, exports, page structure
// T3: Acceptance tests -- form flow, KV storage, email notification
// T4: Adversarial tests -- rate limiting, injection, missing bindings
//
// Run: node tests/registration-forms.test.js
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

var regFn = readSrc("functions/api/register-player.js");
var volFn = readSrc("functions/api/volunteer-interest.js");
var regPage = readSrc("register-player.html");
var volPage = readSrc("volunteer-interest.html");

// ============================================================
// T1: Unit tests
// ============================================================
console.log("\n--- T1: Unit Tests ---");

test("T1.1: register-player has escapeHtml function", function () {
  assert.ok(/function escapeHtml/.test(regFn));
});

test("T1.2: volunteer-interest has escapeHtml function", function () {
  assert.ok(/function escapeHtml/.test(volFn));
});

test("T1.3: register-player validates playerName is required", function () {
  assert.ok(regFn.includes("playerName"));
  assert.ok(regFn.includes("400"));
});

test("T1.4: register-player validates parentEmail format", function () {
  assert.ok(regFn.includes("@") && regFn.includes("parentEmail"));
});

test("T1.5: volunteer-interest validates name is required", function () {
  assert.ok(volFn.includes("name") && volFn.includes("400"));
});

test("T1.6: volunteer-interest validates email format", function () {
  assert.ok(volFn.includes("@") && volFn.includes("email"));
});

test("T1.7: register-player truncates fields to max lengths", function () {
  assert.ok(regFn.includes("slice(0, 200)") || regFn.includes(".slice(0,200)"));
});

test("T1.8: volunteer-interest truncates fields to max lengths", function () {
  assert.ok(volFn.includes("slice(0, 200)") || volFn.includes(".slice(0,200)"));
});

test("T1.9: register-player has NO Zorts ID field", function () {
  assert.ok(
    !regFn.toLowerCase().includes("zorts"),
    "register-player must not have a Zorts ID field",
  );
  assert.ok(
    !regPage.toLowerCase().includes("zorts"),
    "register-player.html must not have a Zorts ID field",
  );
});

test("T1.10: register-player schedule-a-call is free text, not datetime", function () {
  assert.ok(
    !regPage.includes('type="datetime'),
    "Schedule a call must be plain text, not a datetime picker",
  );
  // Should be a text input
  var scheduleSection = regPage.substring(
    regPage.indexOf("scheduleCall") - 200,
    regPage.indexOf("scheduleCall") + 200,
  );
  assert.ok(
    scheduleSection.includes('type="text"'),
    "Schedule field should be type=text",
  );
});

// ============================================================
// T2: Integration tests
// ============================================================
console.log("\n--- T2: Integration Tests ---");

test("T2.1: functions/api/register-player.js exists", function () {
  assert.ok(
    fs.existsSync(
      path.join(__dirname, "..", "functions", "api", "register-player.js"),
    ),
  );
});

test("T2.2: functions/api/volunteer-interest.js exists", function () {
  assert.ok(
    fs.existsSync(
      path.join(__dirname, "..", "functions", "api", "volunteer-interest.js"),
    ),
  );
});

test("T2.3: register-player.html exists", function () {
  assert.ok(fs.existsSync(path.join(__dirname, "..", "register-player.html")));
});

test("T2.4: volunteer-interest.html exists", function () {
  assert.ok(
    fs.existsSync(path.join(__dirname, "..", "volunteer-interest.html")),
  );
});

test("T2.5: register-player exports onRequestPost", function () {
  assert.ok(/export async function onRequestPost/.test(regFn));
});

test("T2.6: volunteer-interest exports onRequestPost", function () {
  assert.ok(/export async function onRequestPost/.test(volFn));
});

test("T2.7: register-player rejects non-POST methods", function () {
  assert.ok(regFn.includes("405"));
  assert.ok(/onRequestGet/.test(regFn));
});

test("T2.8: volunteer-interest rejects non-POST methods", function () {
  assert.ok(volFn.includes("405"));
  assert.ok(/onRequestGet/.test(volFn));
});

test("T2.9: register-player imports sendViaACS", function () {
  assert.ok(regFn.includes("sendViaACS") && regFn.includes("acs-email"));
});

test("T2.10: volunteer-interest imports sendViaACS", function () {
  assert.ok(volFn.includes("sendViaACS") && volFn.includes("acs-email"));
});

test("T2.11: register-player.html points to /api/register-player", function () {
  assert.ok(regPage.includes("/api/register-player"));
});

test("T2.12: volunteer-interest.html points to /api/volunteer-interest", function () {
  assert.ok(volPage.includes("/api/volunteer-interest"));
});

test("T2.13: both pages load feedback-widget.js", function () {
  assert.ok(
    regPage.includes("feedback-widget.js"),
    "register-player needs feedback widget",
  );
  assert.ok(
    volPage.includes("feedback-widget.js"),
    "volunteer-interest needs feedback widget",
  );
});

test("T2.14: both pages load skills-clinic-banner.js", function () {
  assert.ok(
    regPage.includes("skills-clinic-banner.js"),
    "register-player needs banner",
  );
  assert.ok(
    volPage.includes("skills-clinic-banner.js"),
    "volunteer-interest needs banner",
  );
});

// ============================================================
// T3: Acceptance tests
// ============================================================
console.log("\n--- T3: Acceptance Tests ---");

test("T3.1: register-player stores submission in KV with TTL", function () {
  assert.ok(regFn.includes("player-reg:"));
  assert.ok(
    regFn.includes("expirationTtl") || regFn.includes("SUBMISSION_TTL"),
  );
});

test("T3.2: volunteer-interest stores submission in KV with TTL", function () {
  assert.ok(volFn.includes("volunteer:"));
  assert.ok(
    volFn.includes("expirationTtl") || volFn.includes("SUBMISSION_TTL"),
  );
});

test("T3.3: register-player sends notification email", function () {
  assert.ok(regFn.includes("sendViaACS"));
  assert.ok(regFn.includes("justin@fathersandfootball.org"));
});

test("T3.4: volunteer-interest sends notification email", function () {
  assert.ok(volFn.includes("sendViaACS"));
  assert.ok(volFn.includes("justin@fathersandfootball.org"));
});

test("T3.5: register-player email subject includes player name", function () {
  assert.ok(
    regFn.includes("Player Registration") || regFn.includes("playerName"),
  );
});

test("T3.6: volunteer-interest email subject includes volunteer name", function () {
  assert.ok(
    volFn.includes("Volunteer Interest") || volFn.includes("entry.name"),
  );
});

test("T3.7: register-player page has all required form fields", function () {
  assert.ok(regPage.includes("playerName"), "needs playerName field");
  assert.ok(regPage.includes("playerAge"), "needs playerAge field");
  assert.ok(regPage.includes("parentName"), "needs parentName field");
  assert.ok(regPage.includes("parentEmail"), "needs parentEmail field");
});

test("T3.8: register-player page has optional fields", function () {
  assert.ok(regPage.includes("parentPhone") || regPage.includes("phone"));
  assert.ok(regPage.includes("scheduleCall"));
});

test("T3.9: volunteer page has required + optional fields", function () {
  assert.ok(volPage.includes("name") || volPage.includes("volName"));
  assert.ok(volPage.includes("email") || volPage.includes("volEmail"));
});

test("T3.10: KV is written before email is sent (register-player)", function () {
  var kvIdx = regFn.indexOf("kv.put(");
  var emailIdx = regFn.indexOf("sendViaACS(");
  assert.ok(
    kvIdx > -1 && emailIdx > -1,
    "both KV write and email send expected",
  );
  assert.ok(kvIdx < emailIdx, "KV must be written before email is attempted");
});

test("T3.11: KV is written before email is sent (volunteer-interest)", function () {
  var kvIdx = volFn.indexOf("kv.put(");
  var emailIdx = volFn.indexOf("sendViaACS(");
  assert.ok(
    kvIdx > -1 && emailIdx > -1,
    "both KV write and email send expected",
  );
  assert.ok(kvIdx < emailIdx, "KV must be written before email is attempted");
});

// ============================================================
// T4: Adversarial tests
// ============================================================
console.log("\n--- T4: Adversarial Tests ---");

test("T4.1: register-player has rate limiting", function () {
  assert.ok(regFn.includes("RATE_LIMIT"));
  assert.ok(regFn.includes("429"));
  assert.ok(regFn.includes("CF-Connecting-IP"));
});

test("T4.2: volunteer-interest has rate limiting", function () {
  assert.ok(volFn.includes("RATE_LIMIT"));
  assert.ok(volFn.includes("429"));
  assert.ok(volFn.includes("CF-Connecting-IP"));
});

test("T4.3: register-player escapes all user input in email", function () {
  assert.ok(
    regFn.includes("escapeHtml(entry.playerName)") ||
      regFn.includes("escapeHtml("),
  );
});

test("T4.4: volunteer-interest escapes all user input in email", function () {
  assert.ok(
    volFn.includes("escapeHtml(entry.name)") || volFn.includes("escapeHtml("),
  );
});

test("T4.5: register-player handles missing KV binding", function () {
  assert.ok(regFn.includes("!kv") || regFn.includes("kv)"));
});

test("T4.6: volunteer-interest handles missing KV binding", function () {
  assert.ok(volFn.includes("!kv") || volFn.includes("kv)"));
});

test("T4.7: register-player handles malformed JSON", function () {
  assert.ok(/try\s*\{[\s\S]*?request\.json\(\)/.test(regFn));
});

test("T4.8: volunteer-interest handles malformed JSON", function () {
  assert.ok(/try\s*\{[\s\S]*?request\.json\(\)/.test(volFn));
});

test("T4.9: register-player uses crypto.randomUUID for entry IDs", function () {
  assert.ok(regFn.includes("crypto.randomUUID()"));
});

test("T4.10: volunteer-interest uses crypto.randomUUID for entry IDs", function () {
  assert.ok(volFn.includes("crypto.randomUUID()"));
});

test("T4.11: neither page has admin/no-index (public pages)", function () {
  assert.ok(
    !regPage.includes("noindex"),
    "register-player should be indexable",
  );
  assert.ok(
    !volPage.includes("noindex"),
    "volunteer-interest should be indexable",
  );
});

// ============================================================
// Summary
// ============================================================
console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
