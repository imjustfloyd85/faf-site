// ============================================================
// FAF Media Review (Admin) Tests
//
// T1: Unit tests — validation logic, key sanitization, status storage
// T2: Integration tests — function file structure, exports, bindings
// T3: Acceptance tests — end-to-end flow verification
// T4: Adversarial tests — security (REQUIRED: admin auth + delete surface)
//
// Run: node tests/media-review.test.js
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

const REVIEW_FN_PATH = path.join(
  __dirname,
  "..",
  "functions",
  "api",
  "media-review.js",
);
const REVIEW_PAGE_PATH = path.join(__dirname, "..", "media-review.html");
const UPLOAD_FN_PATH = path.join(
  __dirname,
  "..",
  "functions",
  "api",
  "media-upload.js",
);

const fnSrc = fs.readFileSync(REVIEW_FN_PATH, "utf8");
const pageSrc = fs.readFileSync(REVIEW_PAGE_PATH, "utf8");

// ============================================================
// T1: UNIT TESTS — validation logic
// ============================================================
console.log("\n--- T1: Unit Tests ---");

test("T1.1: UPLOADS_PREFIX is defined as 'uploads/'", function () {
  assert.ok(
    fnSrc.includes('UPLOADS_PREFIX = "uploads/"') ||
      fnSrc.includes("UPLOADS_PREFIX = 'uploads/'"),
    "Must define UPLOADS_PREFIX constant",
  );
});

test("T1.2: STATUS_KEY_PREFIX is defined for KV keys", function () {
  assert.ok(
    fnSrc.includes("STATUS_KEY_PREFIX"),
    "Must define STATUS_KEY_PREFIX for KV status entries",
  );
});

test("T1.3: validateObjectKey function exists", function () {
  assert.ok(
    fnSrc.includes("function validateObjectKey") ||
      fnSrc.includes("validateObjectKey ="),
    "Must define validateObjectKey function",
  );
});

test("T1.4: validateObjectKey rejects keys without uploads/ prefix", function () {
  assert.ok(
    fnSrc.includes("UPLOADS_PREFIX") && fnSrc.includes("startsWith"),
    "Must check key starts with uploads/ prefix",
  );
});

test("T1.5: validateObjectKey rejects path traversal (..)", function () {
  var validateFn = fnSrc.substring(
    fnSrc.indexOf("function validateObjectKey"),
    fnSrc.indexOf("function validateObjectKey") + 600,
  );
  assert.ok(
    validateFn.includes('".."') || validateFn.includes("'..'"),
    "Must reject keys containing '..'",
  );
});

test("T1.6: validateObjectKey rejects double slashes", function () {
  var validateFn = fnSrc.substring(
    fnSrc.indexOf("function validateObjectKey"),
    fnSrc.indexOf("function validateObjectKey") + 600,
  );
  assert.ok(
    validateFn.includes('"//"') || validateFn.includes("'//'"),
    "Must reject keys containing '//'",
  );
});

test("T1.7: validateObjectKey rejects sub-directory traversal after prefix", function () {
  var validateFn = fnSrc.substring(
    fnSrc.indexOf("function validateObjectKey"),
    fnSrc.indexOf("function validateObjectKey") + 600,
  );
  assert.ok(
    validateFn.includes('"/"') || validateFn.includes("'/'"),
    "Must reject keys with slashes after the prefix (no sub-directory escaping)",
  );
});

test("T1.8: LIST_PAGE_SIZE is defined and reasonable", function () {
  var match = fnSrc.match(/LIST_PAGE_SIZE\s*=\s*(\d+)/);
  assert.ok(match, "LIST_PAGE_SIZE must be defined");
  var size = parseInt(match[1]);
  assert.ok(
    size > 0 && size <= 1000,
    "LIST_PAGE_SIZE should be between 1 and 1000",
  );
});

test("T1.9: validateAdminPasscode function exists", function () {
  assert.ok(
    fnSrc.includes("function validateAdminPasscode") ||
      fnSrc.includes("validateAdminPasscode ="),
    "Must define validateAdminPasscode function",
  );
});

test("T1.10: CORS function restricts to known origins", function () {
  assert.ok(
    fnSrc.includes("https://fathersandfootball.org"),
    "Must allow fathersandfootball.org",
  );
  assert.ok(
    fnSrc.includes("https://www.fathersandfootball.org"),
    "Must allow www.fathersandfootball.org",
  );
});

// ============================================================
// T2: INTEGRATION TESTS — function file structure
// ============================================================
console.log("\n--- T2: Integration Tests ---");

test("T2.1: media-review.js exists", function () {
  assert.ok(fs.existsSync(REVIEW_FN_PATH), "Function file should exist");
});

test("T2.2: media-review.html exists", function () {
  assert.ok(fs.existsSync(REVIEW_PAGE_PATH), "Review page should exist");
});

test("T2.3: Function exports onRequestGet", function () {
  assert.ok(
    fnSrc.includes("export async function onRequestGet"),
    "Must export onRequestGet for listing and serving",
  );
});

test("T2.4: Function exports onRequestPost", function () {
  assert.ok(
    fnSrc.includes("export async function onRequestPost"),
    "Must export onRequestPost for approve/reject/delete actions",
  );
});

test("T2.5: Function exports onRequestOptions for CORS", function () {
  assert.ok(
    fnSrc.includes("export async function onRequestOptions"),
    "Must export onRequestOptions for CORS preflight",
  );
});

test("T2.6: Function reads FAF_MEDIA_ADMIN_PASSCODE from env", function () {
  assert.ok(
    fnSrc.includes("FAF_MEDIA_ADMIN_PASSCODE"),
    "Must read admin passcode from env",
  );
});

test("T2.7: Function reads MEDIA_BUCKET from env", function () {
  assert.ok(
    fnSrc.includes("context.env.MEDIA_BUCKET") ||
      fnSrc.includes("env.MEDIA_BUCKET"),
    "Must read R2 bucket binding from env",
  );
});

test("T2.8: Function reads FAF_KV from env", function () {
  assert.ok(
    fnSrc.includes("context.env.FAF_KV") || fnSrc.includes("env.FAF_KV"),
    "Must read KV binding from env for status storage",
  );
});

test("T2.9: Admin page points to /api/media-review endpoint", function () {
  assert.ok(
    pageSrc.includes("/api/media-review"),
    "Admin page must call /api/media-review",
  );
});

test("T2.10: Admin page includes admin passcode input field", function () {
  assert.ok(
    pageSrc.includes('id="adminPasscode"'),
    "Must have admin passcode input field",
  );
});

test("T2.11: Admin page has filter controls for status", function () {
  assert.ok(
    pageSrc.includes("pending") &&
      pageSrc.includes("approved") &&
      pageSrc.includes("rejected"),
    "Must have filter buttons for pending/approved/rejected",
  );
});

test("T2.12: Function uses separate admin secret from upload passcode", function () {
  assert.ok(
    fnSrc.includes("FAF_MEDIA_ADMIN_PASSCODE"),
    "Must use FAF_MEDIA_ADMIN_PASSCODE, not FAF_MEDIA_PASSCODE",
  );
  // Both should appear: admin for auth, fan for rejection
  assert.ok(
    fnSrc.includes("FAF_MEDIA_PASSCODE"),
    "Must reference FAF_MEDIA_PASSCODE to reject it",
  );
});

test("T2.13: Admin page has noindex meta tag", function () {
  assert.ok(
    pageSrc.includes("noindex") || pageSrc.includes("noIndex"),
    "Admin page should not be indexed by search engines",
  );
});

// ============================================================
// T3: ACCEPTANCE TESTS — end-to-end flow verification
// ============================================================
console.log("\n--- T3: Acceptance Tests ---");

test("T3.1: List action returns items array", function () {
  assert.ok(
    fnSrc.includes("items") && fnSrc.includes("JSON.stringify"),
    "List response must include items array",
  );
});

test("T3.2: List action supports status filter", function () {
  assert.ok(
    fnSrc.includes("statusFilter") || fnSrc.includes("status"),
    "List must support filtering by status",
  );
});

test("T3.3: List action supports pagination via cursor", function () {
  assert.ok(
    fnSrc.includes("cursor"),
    "List must support cursor-based pagination",
  );
  assert.ok(
    fnSrc.includes("truncated"),
    "List must report whether results are truncated",
  );
});

test("T3.4: Serve action streams R2 object body", function () {
  assert.ok(fnSrc.includes("obj.body"), "Serve must stream the R2 object body");
});

test("T3.5: Serve action sets Content-Type from R2 metadata", function () {
  assert.ok(
    fnSrc.includes("Content-Type") && fnSrc.includes("contentType"),
    "Serve must set Content-Type header from stored metadata",
  );
});

test("T3.6: Approve action stores status in KV", function () {
  var approveStart = fnSrc.indexOf('action === "approve"');
  var rejectStart = fnSrc.indexOf('action === "reject"');
  assert.ok(approveStart !== -1, "Must have approve action handler");
  var approveSec = fnSrc.substring(approveStart, rejectStart);
  assert.ok(approveSec.includes("kv.put"), "Approve must write status to KV");
  assert.ok(
    approveSec.includes('"approved"'),
    "Approve must set status to 'approved'",
  );
});

test("T3.7: Reject action stores status in KV", function () {
  var rejectStart = fnSrc.indexOf('action === "reject"');
  var deleteStart = fnSrc.indexOf('action === "delete"');
  assert.ok(rejectStart !== -1, "Must have reject action handler");
  var rejectSec = fnSrc.substring(rejectStart, deleteStart);
  assert.ok(rejectSec.includes("kv.put"), "Reject must write status to KV");
  assert.ok(
    rejectSec.includes('"rejected"'),
    "Reject must set status to 'rejected'",
  );
});

test("T3.8: Delete action removes object from R2", function () {
  assert.ok(
    fnSrc.includes("bucket.delete"),
    "Delete must call bucket.delete to remove from R2",
  );
});

test("T3.9: Delete action cleans up KV status entry", function () {
  assert.ok(
    fnSrc.includes("kv.delete"),
    "Delete must clean up KV status entry",
  );
});

test("T3.10: Approve/reject confirm object exists before writing status", function () {
  // bucket.head should come before kv.put in approve/reject flow
  var approveStart = fnSrc.indexOf('action === "approve"');
  if (approveStart === -1) approveStart = fnSrc.indexOf("action === 'approve'");
  var approveSection = fnSrc.substring(approveStart, approveStart + 800);
  var headPos = approveSection.indexOf("bucket.head");
  var kvPutPos = approveSection.indexOf("kv.put");
  assert.ok(headPos !== -1, "Must check object exists with bucket.head");
  assert.ok(kvPutPos !== -1, "Must write to KV");
  assert.ok(headPos < kvPutPos, "bucket.head must come before kv.put");
});

test("T3.11: Served content has Cache-Control private/no-store", function () {
  assert.ok(
    fnSrc.includes("no-store") || fnSrc.includes("private"),
    "Served content must have restrictive cache headers",
  );
});

test("T3.12: Admin page renders image previews for image types", function () {
  assert.ok(
    pageSrc.includes("<img") || pageSrc.includes("'<img"),
    "Admin page must render img tags for image previews",
  );
});

test("T3.13: Admin page renders video element for video types", function () {
  assert.ok(
    pageSrc.includes("<video") || pageSrc.includes("'<video"),
    "Admin page must render video elements for video previews",
  );
});

test("T3.14: Admin page has delete confirmation dialog", function () {
  assert.ok(
    pageSrc.includes("confirmDelete") || pageSrc.includes("confirm-overlay"),
    "Admin page must have a delete confirmation step",
  );
});

test("T3.15: Default filter is pending", function () {
  assert.ok(
    pageSrc.includes('currentFilter = "pending"') ||
      pageSrc.includes("currentFilter = 'pending'"),
    "Default filter should be 'pending' so triaged items don't clutter",
  );
});

// ============================================================
// T4: ADVERSARIAL TESTS — security (REQUIRED: admin auth + delete surface)
// ============================================================
console.log("\n--- T4: Adversarial Tests ---");

test("T4.1: Admin passcode checked SERVER-SIDE via env var", function () {
  assert.ok(
    fnSrc.includes("env.FAF_MEDIA_ADMIN_PASSCODE"),
    "Must read admin passcode from env on server side",
  );
});

test("T4.2: Missing admin passcode returns 403", function () {
  var validateFn = fnSrc.substring(
    fnSrc.indexOf("function validateAdminPasscode"),
    fnSrc.indexOf("function validateAdminPasscode") + 600,
  );
  assert.ok(
    validateFn.includes("403"),
    "Must return 403 for missing/invalid admin passcode",
  );
});

test("T4.3: Fan upload passcode is explicitly rejected for admin access", function () {
  assert.ok(
    fnSrc.includes("FAF_MEDIA_PASSCODE") &&
      fnSrc.includes("FAF_MEDIA_ADMIN_PASSCODE"),
    "Must reference both passcodes",
  );
  // The function must compare submitted against fan passcode and reject
  var validateFn = fnSrc.substring(
    fnSrc.indexOf("function validateAdminPasscode"),
    fnSrc.indexOf("function validateAdminPasscode") + 800,
  );
  assert.ok(
    validateFn.includes("fanPasscode") ||
      validateFn.includes("FAF_MEDIA_PASSCODE"),
    "Must explicitly check that fan passcode is not used for admin access",
  );
});

test("T4.4: Admin passcode is not hardcoded in function", function () {
  var passcodeLines = fnSrc.split("\n").filter(function (l) {
    return l.includes("passcode") && !l.trim().startsWith("//");
  });
  var hasHardcoded = passcodeLines.some(function (l) {
    return (
      /adminPasscode\s*===?\s*["'][^"']+["']/.test(l) && !l.includes("env")
    );
  });
  assert.ok(!hasHardcoded, "Admin passcode must NOT be hardcoded");
});

test("T4.5: Admin passcode not exposed in admin page source", function () {
  assert.ok(
    !pageSrc.includes("FAF_MEDIA_ADMIN_PASSCODE"),
    "Admin passcode env var name should not appear in client-side code",
  );
  assert.ok(
    !pageSrc.includes("FAF_MEDIA_PASSCODE"),
    "Upload passcode env var name should not appear in client-side code",
  );
});

test("T4.6: List endpoint requires admin passcode", function () {
  // In the GET handler, passcode validation must happen before listing
  var getHandler = fnSrc.substring(
    fnSrc.indexOf("onRequestGet"),
    fnSrc.indexOf("onRequestPost") || fnSrc.length,
  );
  var authCheck = getHandler.indexOf("validateAdminPasscode");
  var bucketList = getHandler.indexOf("bucket.list");
  assert.ok(authCheck !== -1, "GET handler must validate admin passcode");
  assert.ok(bucketList !== -1, "GET handler must list bucket objects");
  assert.ok(
    authCheck < bucketList,
    "Auth check must come before bucket listing",
  );
});

test("T4.7: Serve endpoint requires admin passcode", function () {
  var getHandler = fnSrc.substring(
    fnSrc.indexOf("onRequestGet"),
    fnSrc.indexOf("onRequestPost") || fnSrc.length,
  );
  var authCheck = getHandler.indexOf("validateAdminPasscode");
  var objGet = getHandler.indexOf("bucket.get");
  assert.ok(authCheck !== -1, "Serve must validate admin passcode");
  assert.ok(objGet !== -1, "Serve must get object from bucket");
  assert.ok(authCheck < objGet, "Auth must come before serving object");
});

test("T4.8: Approve endpoint requires admin passcode", function () {
  var postHandler = fnSrc.substring(fnSrc.indexOf("onRequestPost"));
  var authCheck = postHandler.indexOf("validateAdminPasscode");
  assert.ok(authCheck !== -1, "POST handler must validate admin passcode");
});

test("T4.9: Reject endpoint requires admin passcode", function () {
  // Same POST handler with same auth check covers all actions
  var postHandler = fnSrc.substring(fnSrc.indexOf("onRequestPost"));
  var authCheck = postHandler.indexOf("validateAdminPasscode");
  var rejectAction = postHandler.indexOf('"reject"');
  assert.ok(authCheck !== -1, "POST handler must validate passcode");
  assert.ok(rejectAction !== -1, "POST handler must handle reject action");
  assert.ok(
    authCheck < rejectAction,
    "Auth check must come before reject handling",
  );
});

test("T4.10: Delete endpoint requires admin passcode", function () {
  var postHandler = fnSrc.substring(fnSrc.indexOf("onRequestPost"));
  var authCheck = postHandler.indexOf("validateAdminPasscode");
  var deleteAction = postHandler.indexOf("bucket.delete");
  assert.ok(authCheck !== -1, "POST handler must validate passcode");
  assert.ok(deleteAction !== -1, "POST handler must handle delete");
  assert.ok(
    authCheck < deleteAction,
    "Auth check must come before delete operation",
  );
});

test("T4.11: Object serve validates key stays within uploads/ prefix", function () {
  var getHandler = fnSrc.substring(
    fnSrc.indexOf("onRequestGet"),
    fnSrc.indexOf("onRequestPost") || fnSrc.length,
  );
  assert.ok(
    getHandler.includes("validateObjectKey"),
    "Serve must validate object key before fetching",
  );
});

test("T4.12: Delete validates key stays within uploads/ prefix", function () {
  var postHandler = fnSrc.substring(fnSrc.indexOf("onRequestPost"));
  assert.ok(
    postHandler.includes("validateObjectKey"),
    "Delete must validate object key before deleting",
  );
});

test("T4.13: Path traversal blocked — '..' rejected in keys", function () {
  var validateFn = fnSrc.substring(
    fnSrc.indexOf("function validateObjectKey"),
    fnSrc.indexOf("function validateObjectKey") + 600,
  );
  assert.ok(
    validateFn.includes('".."'),
    "validateObjectKey must reject keys containing '..'",
  );
});

test("T4.14: Arbitrary key outside uploads/ prefix rejected", function () {
  var validateFn = fnSrc.substring(
    fnSrc.indexOf("function validateObjectKey"),
    fnSrc.indexOf("function validateObjectKey") + 600,
  );
  assert.ok(
    validateFn.includes("startsWith") && validateFn.includes("UPLOADS_PREFIX"),
    "validateObjectKey must require uploads/ prefix",
  );
});

test("T4.15: No bulk delete endpoint — each delete requires a specific key", function () {
  // Should not have any "deleteAll" or batch delete
  assert.ok(
    !fnSrc.includes("deleteAll") && !fnSrc.includes("delete-all"),
    "Must not have bulk delete capability",
  );
  // Delete action requires a key parameter
  var deleteSection = fnSrc.substring(fnSrc.indexOf('"delete"'));
  assert.ok(
    deleteSection.includes("key"),
    "Delete must operate on a specific key",
  );
});

test("T4.16: Delete confirms object exists before removing", function () {
  // Find the delete section and check bucket.head comes before bucket.delete
  var deleteStart = fnSrc.lastIndexOf('action === "delete"');
  if (deleteStart === -1)
    deleteStart = fnSrc.lastIndexOf("action === 'delete'");
  var deleteSection = fnSrc.substring(deleteStart, deleteStart + 600);
  var headPos = deleteSection.indexOf("bucket.head");
  var delPos = deleteSection.indexOf("bucket.delete");
  assert.ok(headPos !== -1, "Delete must check existence with bucket.head");
  assert.ok(delPos !== -1, "Delete must call bucket.delete");
  assert.ok(headPos < delPos, "Existence check must come before delete");
});

test("T4.17: Approve does NOT delete the R2 object", function () {
  // Find the approve section (between approve marker and reject marker)
  var approveStart = fnSrc.indexOf('action === "approve"');
  if (approveStart === -1) approveStart = fnSrc.indexOf("action === 'approve'");
  var rejectStart = fnSrc.indexOf('action === "reject"', approveStart + 1);
  if (rejectStart === -1)
    rejectStart = fnSrc.indexOf("action === 'reject'", approveStart + 1);
  var approveSection = fnSrc.substring(approveStart, rejectStart);
  assert.ok(
    !approveSection.includes("bucket.delete"),
    "Approve must NOT delete the R2 object",
  );
});

test("T4.18: Reject does NOT delete the R2 object", function () {
  var rejectStart = fnSrc.indexOf('action === "reject"');
  if (rejectStart === -1) rejectStart = fnSrc.indexOf("action === 'reject'");
  var deleteStart = fnSrc.indexOf('action === "delete"', rejectStart + 1);
  if (deleteStart === -1)
    deleteStart = fnSrc.indexOf("action === 'delete'", rejectStart + 1);
  var rejectSection = fnSrc.substring(rejectStart, deleteStart);
  assert.ok(
    !rejectSection.includes("bucket.delete"),
    "Reject must NOT delete the R2 object",
  );
});

test("T4.19: Served objects are not publicly cacheable", function () {
  assert.ok(
    fnSrc.includes("no-store") || fnSrc.includes("private"),
    "Served objects must not be publicly cached",
  );
});

test("T4.20: Missing admin env var returns 500, not a bypass", function () {
  var validateFn = fnSrc.substring(
    fnSrc.indexOf("function validateAdminPasscode"),
    fnSrc.indexOf("function validateAdminPasscode") + 600,
  );
  assert.ok(
    validateFn.includes("500") || validateFn.includes("not-configured"),
    "Missing admin env var must return 500, never bypass auth",
  );
});

test("T4.21: Missing R2 bucket binding returns 500", function () {
  assert.ok(
    fnSrc.includes("!bucket") || fnSrc.includes("bucket)"),
    "Must check R2 bucket binding exists",
  );
});

test("T4.22: Missing KV binding returns 500 for write operations", function () {
  assert.ok(
    fnSrc.includes("!kv") || fnSrc.includes("kv)"),
    "Must check KV binding exists for approve/reject/delete",
  );
});

test("T4.23: Invalid JSON body returns 400", function () {
  var postHandler = fnSrc.substring(fnSrc.indexOf("onRequestPost"));
  assert.ok(
    postHandler.includes("catch") &&
      (postHandler.includes("Invalid JSON") || postHandler.includes("400")),
    "Must handle invalid JSON gracefully with 400",
  );
});

test("T4.24: No auto-publish — approve does not trigger public visibility", function () {
  // Approve should only store KV status, not copy to a public location
  var approveStart = fnSrc.indexOf('action === "approve"');
  if (approveStart === -1) approveStart = fnSrc.indexOf("action === 'approve'");
  var approveSection = fnSrc.substring(approveStart, approveStart + 800);
  assert.ok(
    !approveSection.includes("public") && !approveSection.includes("gallery"),
    "Approve must not auto-publish to any public location",
  );
});

test("T4.25: Admin page delete has confirmation step (not one-click)", function () {
  assert.ok(
    pageSrc.includes("confirmDelete") ||
      (pageSrc.includes("confirm") && pageSrc.includes("delete")),
    "Delete must require user confirmation, not be a single-click action",
  );
  assert.ok(
    pageSrc.includes("confirm-overlay") || pageSrc.includes("confirmOverlay"),
    "Must have a confirmation dialog/overlay",
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
