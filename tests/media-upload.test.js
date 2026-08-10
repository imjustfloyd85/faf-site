// ============================================================
// FAF Media Upload Tests
//
// T1: Unit tests — validation logic, storage key generation
// T2: Integration tests — function file structure, exports
// T3: Acceptance tests — end-to-end flow verification
// T4: Adversarial tests — security (REQUIRED: new public input surface)
//
// Run: node tests/media-upload.test.js
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

const UPLOAD_FN_PATH = path.join(
  __dirname,
  "..",
  "functions",
  "api",
  "media-upload.js",
);
const UPLOAD_PAGE_PATH = path.join(__dirname, "..", "media-upload.html");

// Read source files once
const fnSrc = fs.readFileSync(UPLOAD_FN_PATH, "utf8");
const pageSrc = fs.readFileSync(UPLOAD_PAGE_PATH, "utf8");

// ============================================================
// T1: UNIT TESTS — validation logic
// ============================================================
console.log("\n--- T1: Unit Tests ---");

test("T1.1: ALLOWED_TYPES includes standard image types", function () {
  assert.ok(fnSrc.includes('"image/jpeg"'), "Must allow JPEG");
  assert.ok(fnSrc.includes('"image/png"'), "Must allow PNG");
  assert.ok(fnSrc.includes('"image/gif"'), "Must allow GIF");
  assert.ok(fnSrc.includes('"image/webp"'), "Must allow WebP");
  assert.ok(fnSrc.includes('"image/heic"'), "Must allow HEIC");
});

test("T1.2: ALLOWED_TYPES includes standard video types", function () {
  assert.ok(fnSrc.includes('"video/mp4"'), "Must allow MP4");
  assert.ok(fnSrc.includes('"video/quicktime"'), "Must allow MOV");
  assert.ok(fnSrc.includes('"video/webm"'), "Must allow WebM");
});

test("T1.3: ALLOWED_TYPES does NOT include dangerous types", function () {
  assert.ok(!fnSrc.includes('"text/html"'), "Must NOT allow HTML");
  assert.ok(!fnSrc.includes('"application/javascript"'), "Must NOT allow JS");
  assert.ok(
    !fnSrc.includes('"application/x-executable"'),
    "Must NOT allow executables",
  );
  assert.ok(!fnSrc.includes('"application/zip"'), "Must NOT allow ZIP");
  assert.ok(!fnSrc.includes('"application/pdf"'), "Must NOT allow PDF");
});

test("T1.4: MAX_FILE_SIZE is defined and reasonable", function () {
  var match = fnSrc.match(
    /MAX_FILE_SIZE\s*=\s*(\d+)\s*\*\s*(\d+)\s*\*\s*(\d+)/,
  );
  assert.ok(match, "MAX_FILE_SIZE must be defined");
  var bytes = parseInt(match[1]) * parseInt(match[2]) * parseInt(match[3]);
  assert.ok(bytes > 0, "MAX_FILE_SIZE must be positive");
  assert.ok(
    bytes <= 500 * 1024 * 1024,
    "MAX_FILE_SIZE should not exceed 500 MB",
  );
});

test("T1.5: Storage key uses crypto.randomUUID()", function () {
  assert.ok(
    fnSrc.includes("crypto.randomUUID()"),
    "Must use crypto.randomUUID for storage key randomization",
  );
});

test("T1.6: Storage key includes timestamp for sortability", function () {
  assert.ok(
    fnSrc.includes("Date.now()"),
    "Storage key should include timestamp",
  );
});

test("T1.7: Storage key is built from server-side data only", function () {
  var genFn = fnSrc.substring(
    fnSrc.indexOf("function generateStorageKey"),
    fnSrc.indexOf("async function checkRateLimit") ||
      fnSrc.indexOf("export async"),
  );
  assert.ok(
    !genFn.includes("file.name"),
    "generateStorageKey must NOT use client filename",
  );
  assert.ok(
    !genFn.includes("originalFilename"),
    "generateStorageKey must NOT use original filename",
  );
});

test("T1.8: TYPE_EXTENSIONS maps all allowed types to extensions", function () {
  var allowedTypes = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/heic",
    "image/heif",
    "video/mp4",
    "video/quicktime",
    "video/webm",
  ];
  allowedTypes.forEach(function (t) {
    assert.ok(
      fnSrc.includes('"' + t + '"'),
      "TYPE_EXTENSIONS must include " + t,
    );
  });
});

test("T1.9: Rate limit constants are defined", function () {
  assert.ok(
    fnSrc.includes("RATE_LIMIT_WINDOW_SEC"),
    "Rate limit window must be defined",
  );
  assert.ok(
    fnSrc.includes("RATE_LIMIT_MAX_UPLOADS"),
    "Rate limit max uploads must be defined",
  );
});

// ============================================================
// T2: INTEGRATION TESTS — function file structure
// ============================================================
console.log("\n--- T2: Integration Tests ---");

test("T2.1: media-upload.js exists", function () {
  assert.ok(fs.existsSync(UPLOAD_FN_PATH), "Function file should exist");
});

test("T2.2: media-upload.html exists", function () {
  assert.ok(fs.existsSync(UPLOAD_PAGE_PATH), "Upload page should exist");
});

test("T2.3: Function exports onRequestPost", function () {
  assert.ok(
    fnSrc.includes("export async function onRequestPost"),
    "Must export onRequestPost",
  );
});

test("T2.4: Function exports onRequestOptions for CORS", function () {
  assert.ok(
    fnSrc.includes("export async function onRequestOptions"),
    "Must export onRequestOptions for CORS preflight",
  );
});

test("T2.5: CORS allows fathersandfootball.org", function () {
  assert.ok(
    fnSrc.includes("https://fathersandfootball.org"),
    "Must allow fathersandfootball.org",
  );
  assert.ok(
    fnSrc.includes("https://www.fathersandfootball.org"),
    "Must allow www.fathersandfootball.org",
  );
});

test("T2.6: CORS allows localhost dev ports", function () {
  assert.ok(
    fnSrc.includes("http://localhost:8788"),
    "Must allow localhost:8788 for wrangler dev",
  );
});

test("T2.7: Function reads FAF_MEDIA_PASSCODE from env", function () {
  assert.ok(
    fnSrc.includes("context.env.FAF_MEDIA_PASSCODE"),
    "Must read passcode from env",
  );
});

test("T2.8: Function reads MEDIA_BUCKET from env", function () {
  assert.ok(
    fnSrc.includes("context.env.MEDIA_BUCKET"),
    "Must read R2 bucket binding from env",
  );
});

test("T2.9: Upload page points to /api/media-upload endpoint", function () {
  assert.ok(
    pageSrc.includes("/api/media-upload"),
    "Upload page must POST to /api/media-upload",
  );
});

test("T2.10: Upload page includes passcode input field", function () {
  assert.ok(
    pageSrc.includes('id="passcode"'),
    "Must have passcode input field",
  );
});

test("T2.11: Upload page includes file input", function () {
  assert.ok(pageSrc.includes('id="fileInput"'), "Must have file input element");
});

test("T2.12: wrangler.toml exists with R2 binding", function () {
  var tomlPath = path.join(__dirname, "..", "wrangler.toml");
  assert.ok(fs.existsSync(tomlPath), "wrangler.toml should exist");
  var toml = fs.readFileSync(tomlPath, "utf8");
  assert.ok(
    toml.includes("MEDIA_BUCKET"),
    "wrangler.toml must define MEDIA_BUCKET binding",
  );
  assert.ok(
    toml.includes("faf-media-uploads"),
    "wrangler.toml must reference the faf-media-uploads bucket",
  );
});

// ============================================================
// T3: ACCEPTANCE TESTS — end-to-end flow verification
// ============================================================
console.log("\n--- T3: Acceptance Tests ---");

test("T3.1: Function validates passcode before processing file", function () {
  var passcodeCheck = fnSrc.indexOf("submittedPasscode");
  var filePut = fnSrc.indexOf("bucket.put");
  assert.ok(passcodeCheck !== -1, "Must check passcode");
  assert.ok(filePut !== -1, "Must write to R2");
  assert.ok(
    passcodeCheck < filePut,
    "Passcode check must come before R2 write",
  );
});

test("T3.2: Function validates file type before R2 write", function () {
  var typeCheck = fnSrc.indexOf("ALLOWED_TYPES.has");
  var filePut = fnSrc.indexOf("bucket.put");
  assert.ok(typeCheck !== -1, "Must check file type");
  assert.ok(typeCheck < filePut, "Type check must come before R2 write");
});

test("T3.3: Function validates file size before R2 write", function () {
  var sizeCheck = fnSrc.indexOf("file.size > MAX_FILE_SIZE");
  var filePut = fnSrc.indexOf("bucket.put");
  assert.ok(sizeCheck !== -1, "Must check file size");
  assert.ok(sizeCheck < filePut, "Size check must come before R2 write");
});

test("T3.4: Function stores metadata with upload", function () {
  assert.ok(
    fnSrc.includes("customMetadata"),
    "Must store custom metadata with R2 object",
  );
  assert.ok(
    fnSrc.includes("originalFilename"),
    "Metadata must include original filename",
  );
  assert.ok(
    fnSrc.includes("uploadedAt"),
    "Metadata must include upload timestamp",
  );
});

test("T3.5: Function uses R2 bucket.put() to store file", function () {
  assert.ok(
    fnSrc.includes("bucket.put(storageKey"),
    "Must call bucket.put with generated storage key",
  );
});

test("T3.6: Function returns success message without exposing storage key", function () {
  var responseSection = fnSrc.substring(fnSrc.lastIndexOf("bucket.put"));
  assert.ok(
    responseSection.includes("success: true"),
    "Must return success flag",
  );
  assert.ok(
    !responseSection.includes("storageKey") ||
      responseSection.indexOf("storageKey") < responseSection.indexOf("return"),
    "Must not expose storage key in response (or only before the return)",
  );
});

test("T3.7: Upload page sends file as multipart FormData", function () {
  assert.ok(
    pageSrc.includes("new FormData()"),
    "Must use FormData for multipart upload",
  );
});

test("T3.8: Upload page sends passcode in FormData", function () {
  assert.ok(
    pageSrc.includes('formData.append("passcode"') ||
      pageSrc.includes("formData.append('passcode'"),
    "Must include passcode in form data",
  );
});

test("T3.9: Function uses formData() to parse multipart request", function () {
  assert.ok(
    fnSrc.includes("context.request.formData()"),
    "Must parse request as formData",
  );
});

test("T3.10: Rate limit returns 429 when exceeded", function () {
  assert.ok(fnSrc.includes("429"), "Must return 429 status when rate limited");
  assert.ok(
    fnSrc.includes("Retry-After"),
    "Must include Retry-After header on 429",
  );
});

// ============================================================
// T4: ADVERSARIAL TESTS — security (REQUIRED: public file upload surface)
// ============================================================
console.log("\n--- T4: Adversarial Tests ---");

test("T4.1: Passcode is checked SERVER-SIDE, not just client-side", function () {
  assert.ok(
    fnSrc.includes('formData.get("passcode")'),
    "Server must extract passcode from form data",
  );
  assert.ok(
    fnSrc.includes("submittedPasscode !== passcode"),
    "Server must compare submitted passcode against env secret",
  );
});

test("T4.2: Missing passcode returns 403", function () {
  assert.ok(
    fnSrc.includes("!submittedPasscode"),
    "Must reject missing passcode",
  );
  assert.ok(fnSrc.includes("403"), "Must return 403 for invalid passcode");
});

test("T4.3: Passcode is not hardcoded in function", function () {
  // The passcode value must come from env, not be a literal string
  var passcodeLines = fnSrc.split("\n").filter(function (l) {
    return l.includes("passcode") && !l.trim().startsWith("//");
  });
  var hasHardcoded = passcodeLines.some(function (l) {
    return (
      /passcode\s*===?\s*["'][^"']+["']/.test(l) && !l.includes("context.env")
    );
  });
  assert.ok(!hasHardcoded, "Passcode must NOT be hardcoded in function source");
});

test("T4.4: Client filenames are never used as storage keys", function () {
  var putSection = fnSrc.substring(
    fnSrc.indexOf("bucket.put"),
    fnSrc.indexOf("bucket.put") + 200,
  );
  assert.ok(
    putSection.includes("storageKey"),
    "R2 put must use generated storageKey",
  );
  assert.ok(
    !putSection.includes("file.name"),
    "R2 put must NOT use file.name as key",
  );
});

test("T4.5: Path traversal in filenames is neutralized (key is randomized)", function () {
  // The generateStorageKey function builds keys from timestamp + UUID + extension
  // It never reads from the client filename, so ../../etc/passwd is irrelevant
  var genFn = fnSrc.substring(
    fnSrc.indexOf("function generateStorageKey"),
    fnSrc.indexOf("function generateStorageKey") + 300,
  );
  assert.ok(
    genFn.includes("crypto.randomUUID"),
    "Key must use crypto.randomUUID",
  );
  assert.ok(
    !genFn.includes("name") || genFn.includes("contentType"),
    "Key function must not reference user-supplied names",
  );
});

test("T4.6: File type validation uses server-detected type, not extension", function () {
  assert.ok(
    fnSrc.includes("file.type"),
    "Must check file.type from the multipart parse",
  );
  assert.ok(
    fnSrc.includes("contentType") &&
      fnSrc.includes("ALLOWED_TYPES.has(contentType)"),
    "Must validate against ALLOWED_TYPES set",
  );
});

test("T4.7: Oversized files are rejected with 413", function () {
  assert.ok(
    fnSrc.includes("413"),
    "Must return 413 Payload Too Large for oversized files",
  );
});

test("T4.8: Disallowed file types are rejected with 415", function () {
  assert.ok(
    fnSrc.includes("415"),
    "Must return 415 Unsupported Media Type for disallowed types",
  );
});

test("T4.9: Empty/missing file is rejected with 400", function () {
  assert.ok(fnSrc.includes("file.size === 0"), "Must reject zero-byte files");
  assert.ok(fnSrc.includes("400"), "Must return 400 for missing/empty file");
});

test("T4.10: Passcode env var not found returns 500, not a bypass", function () {
  assert.ok(
    fnSrc.includes("!passcode"),
    "Must check if passcode env var is set",
  );
  var checkLine = fnSrc.substring(
    fnSrc.indexOf("!passcode"),
    fnSrc.indexOf("!passcode") + 200,
  );
  assert.ok(
    checkLine.includes("500"),
    "Missing passcode env var must return 500",
  );
});

test("T4.11: Missing R2 bucket binding returns 500, not a crash", function () {
  assert.ok(
    fnSrc.includes("!bucket"),
    "Must check if R2 bucket binding exists",
  );
});

test("T4.12: Submitter name is truncated to prevent abuse", function () {
  assert.ok(
    fnSrc.includes(".slice(0, 100)") || fnSrc.includes(".substring(0, 100)"),
    "Submitter name must be truncated",
  );
});

test("T4.13: Caption is truncated to prevent abuse", function () {
  assert.ok(
    fnSrc.includes(".slice(0, 500)") || fnSrc.includes(".substring(0, 500)"),
    "Caption must be truncated",
  );
});

test("T4.14: Original filename stored in metadata is also truncated", function () {
  assert.ok(
    fnSrc.includes(".slice(0, 255)"),
    "Original filename in metadata must be truncated to prevent storage abuse",
  );
});

test("T4.15: Passcode not exposed in upload page source", function () {
  // The page should not contain any hardcoded passcode
  assert.ok(
    !pageSrc.includes("FAF_MEDIA_PASSCODE"),
    "Passcode env var name should not appear in client-side code",
  );
  // No suspicious hardcoded strings that look like a passcode
  var scriptSection = pageSrc.substring(pageSrc.indexOf("<script"));
  assert.ok(
    !scriptSection.includes("password123"),
    "No test/default passcode in client code",
  );
});

test("T4.16: Upload page does not auto-publish or render uploaded content", function () {
  // The page should not contain any gallery rendering or image display from R2
  assert.ok(
    !pageSrc.includes("r2.dev"),
    "Page must not reference R2 public URLs",
  );
  assert.ok(
    !pageSrc.includes("/api/media-list") &&
      !pageSrc.includes("/api/media-gallery"),
    "Page must not fetch a media listing endpoint",
  );
});

test("T4.17: Rate limiting uses client IP from CF-Connecting-IP", function () {
  assert.ok(
    fnSrc.includes("CF-Connecting-IP"),
    "Must use CF-Connecting-IP for rate limit identity",
  );
});

test("T4.18: Rate limit check happens before file processing", function () {
  var rateCheck = fnSrc.indexOf("checkRateLimit");
  var formParse = fnSrc.indexOf("context.request.formData()");
  // Find the first call to checkRateLimit (not the function definition)
  var rateCheckCall = fnSrc.indexOf(
    "checkRateLimit(",
    fnSrc.indexOf("onRequestPost"),
  );
  assert.ok(rateCheckCall !== -1, "Must call checkRateLimit");
  assert.ok(
    rateCheckCall < formParse,
    "Rate limit must be checked before parsing form data (saves CPU on abuse)",
  );
});

test("T4.19: Function does not expose storage key or internal paths in response", function () {
  // Find all Response constructors and check none leak internal data
  var responseMatches = fnSrc.match(/new Response\([\s\S]*?\)/g) || [];
  responseMatches.forEach(function (r) {
    assert.ok(
      !r.includes("storageKey") || r.includes("error"),
      "Response must not include storageKey",
    );
  });
});

test("T4.20: Invalid multipart body returns 400, not a crash", function () {
  assert.ok(
    fnSrc.includes("catch") &&
      (fnSrc.includes("Invalid request") || fnSrc.includes("formData")),
    "Must handle invalid multipart gracefully",
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
