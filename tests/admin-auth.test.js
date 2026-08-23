// ============================================================
// Shared Admin Auth Module Tests
//
// T1: Unit tests -- validateAdminPasscode, corsHeaders, errorResponse
// T2: Integration tests -- module exists, exports, consumer imports
// T3: Acceptance tests -- consumers use shared module, no local copies
// T4: Adversarial tests -- fan-passcode rejection, missing env vars
//
// Run: node tests/admin-auth.test.js
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

const AUTH_MODULE_PATH = "functions/lib/admin-auth.js";
const authSrc = readSrc(AUTH_MODULE_PATH);

const CONSUMERS = [
  "functions/api/media-review.js",
  "functions/api/newsletter-send.js",
  "functions/api/newsletter-subscribers.js",
];

// ============================================================
// T1: Unit tests
// ============================================================
console.log("\n--- T1: Unit Tests ---");

test("T1.1: admin-auth module exports validateAdminPasscode", () => {
  assert.ok(
    /export function validateAdminPasscode/.test(authSrc),
    "validateAdminPasscode not exported",
  );
});

test("T1.2: admin-auth module exports corsHeaders", () => {
  assert.ok(
    /export function corsHeaders/.test(authSrc),
    "corsHeaders not exported",
  );
});

test("T1.3: admin-auth module exports errorResponse", () => {
  assert.ok(
    /export function errorResponse/.test(authSrc),
    "errorResponse not exported",
  );
});

test("T1.4: corsHeaders includes all four allowed origins", () => {
  assert.ok(
    authSrc.includes("https://fathersandfootball.org"),
    "missing prod origin",
  );
  assert.ok(
    authSrc.includes("https://www.fathersandfootball.org"),
    "missing www origin",
  );
  assert.ok(authSrc.includes("http://localhost:8788"), "missing wrangler dev");
  assert.ok(authSrc.includes("http://localhost:3000"), "missing local dev");
});

test("T1.5: corsHeaders accepts a methods parameter", () => {
  assert.ok(
    /function corsHeaders\(origin,\s*methods\)/.test(authSrc),
    "corsHeaders should accept origin and methods params",
  );
});

test("T1.6: corsHeaders defaults to GET, POST, OPTIONS when no methods given", () => {
  assert.ok(
    authSrc.includes('methods || "GET, POST, OPTIONS"'),
    "missing default methods fallback",
  );
});

test("T1.7: validateAdminPasscode checks FAF_MEDIA_ADMIN_PASSCODE", () => {
  assert.ok(
    authSrc.includes("FAF_MEDIA_ADMIN_PASSCODE"),
    "should reference admin passcode env var",
  );
});

test("T1.8: validateAdminPasscode returns not-configured when env var missing", () => {
  assert.ok(
    authSrc.includes('"not-configured"'),
    "should return not-configured reason",
  );
});

test("T1.9: validateAdminPasscode returns missing when no submitted value", () => {
  assert.ok(authSrc.includes('"missing"'), "should return missing reason");
});

test("T1.10: validateAdminPasscode rejects the fan upload passcode", () => {
  assert.ok(
    authSrc.includes("FAF_MEDIA_PASSCODE"),
    "should check the fan passcode",
  );
  assert.ok(
    authSrc.includes('"wrong-credential"'),
    "should return wrong-credential when fan passcode used",
  );
});

test("T1.11: errorResponse builds a JSON error response", () => {
  assert.ok(
    authSrc.includes("JSON.stringify"),
    "should serialize error as JSON",
  );
  assert.ok(
    authSrc.includes("application/json"),
    "should set JSON content type",
  );
});

// ============================================================
// T2: Integration tests
// ============================================================
console.log("\n--- T2: Integration Tests ---");

test("T2.1: admin-auth.js file exists", () => {
  const fullPath = path.join(__dirname, "..", AUTH_MODULE_PATH);
  assert.ok(fs.existsSync(fullPath), "admin-auth.js not found");
});

CONSUMERS.forEach((file) => {
  test(`T2.2: ${file} imports from admin-auth.js`, () => {
    const src = readSrc(file);
    assert.ok(
      src.includes("../lib/admin-auth.js"),
      `${file} should import from admin-auth.js`,
    );
  });
});

CONSUMERS.forEach((file) => {
  test(`T2.3: ${file} imports validateAdminPasscode from admin-auth`, () => {
    const src = readSrc(file);
    assert.ok(
      src.includes("validateAdminPasscode"),
      `${file} should use validateAdminPasscode`,
    );
  });
});

CONSUMERS.forEach((file) => {
  test(`T2.4: ${file} imports corsHeaders from admin-auth`, () => {
    const src = readSrc(file);
    assert.ok(src.includes("corsHeaders"), `${file} should use corsHeaders`);
  });
});

// ============================================================
// T3: Acceptance tests -- no local copies of shared functions
// ============================================================
console.log("\n--- T3: Acceptance Tests ---");

CONSUMERS.forEach((file) => {
  test(`T3.1: ${file} has no local validateAdminPasscode definition`, () => {
    const src = readSrc(file);
    const localDefCount = (src.match(/function validateAdminPasscode/g) || [])
      .length;
    assert.strictEqual(
      localDefCount,
      0,
      `${file} still has a local validateAdminPasscode -- should import only`,
    );
  });
});

CONSUMERS.forEach((file) => {
  test(`T3.2: ${file} has no local corsHeaders definition`, () => {
    const src = readSrc(file);
    const localDefCount = (src.match(/function corsHeaders/g) || []).length;
    assert.strictEqual(
      localDefCount,
      0,
      `${file} still has a local corsHeaders -- should import only`,
    );
  });
});

test("T3.3: media-review.js imports errorResponse from admin-auth", () => {
  const src = readSrc("functions/api/media-review.js");
  assert.ok(
    /import\s*\{[^}]*errorResponse[^}]*\}\s*from\s*["']\.\.\/lib\/admin-auth\.js["']/.test(
      src,
    ),
    "media-review should import errorResponse from admin-auth",
  );
});

test("T3.4: media-review.js has no local errorResponse definition", () => {
  const src = readSrc("functions/api/media-review.js");
  const localDefCount = (src.match(/function errorResponse/g) || []).length;
  assert.strictEqual(
    localDefCount,
    0,
    "media-review still has a local errorResponse -- should import only",
  );
});

// ============================================================
// T4: Adversarial tests
// ============================================================
console.log("\n--- T4: Adversarial Tests ---");

test("T4.1: fan passcode rejection is in shared module, not just media-review", () => {
  assert.ok(
    authSrc.includes("wrong-credential"),
    "shared module should have fan-passcode rejection",
  );
  // Verify no consumer has its own fan-passcode check
  CONSUMERS.forEach((file) => {
    const src = readSrc(file);
    assert.ok(
      !src.includes('"wrong-credential"'),
      `${file} should not have its own wrong-credential check`,
    );
  });
});

test("T4.2: no hardcoded passcode values in admin-auth module", () => {
  // The module should only reference env vars, never have a literal password
  const suspicious = authSrc.match(
    /(?:password|passcode|secret)\s*[=:]\s*["'][^"']+["']/gi,
  );
  const filtered = (suspicious || []).filter(
    (m) =>
      !m.includes("not-configured") &&
      !m.includes("missing") &&
      !m.includes("invalid") &&
      !m.includes("wrong-credential"),
  );
  assert.strictEqual(
    filtered.length,
    0,
    "no hardcoded passcode values allowed in shared auth module",
  );
});

test("T4.3: ALLOWED_ORIGINS array does not include wildcard", () => {
  assert.ok(
    !authSrc.includes('"*"'),
    "CORS should never allow wildcard origin",
  );
});

// ============================================================
// Summary
// ============================================================
console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
process.exit(failed > 0 ? 1 : 0);
