// Shared ACS (Azure Communication Services) email helper.
// Extracted from stripe-webhook.js pattern — ACS is the ONLY
// approved email transport for FAF (site-wide rule).

function acsEndpointFromConnStr(connStr) {
  const match = connStr.match(/endpoint=(https:\/\/[^;]+)/i);
  return match ? match[1].replace(/\/$/, "") : null;
}

function acsKeyFromConnStr(connStr) {
  const match = connStr.match(/accesskey=([^;]+)/i);
  return match ? match[1] : null;
}

export async function sendViaACS(env, { from, to, replyTo, subject, html }) {
  const connStr = env.ACS_CONNECTION_STRING;
  if (!connStr) {
    console.error("ACS_CONNECTION_STRING not configured");
    return { ok: false, status: 500 };
  }

  const endpoint = acsEndpointFromConnStr(connStr);
  const accessKey = acsKeyFromConnStr(connStr);

  if (!endpoint || !accessKey) {
    console.error("Invalid ACS_CONNECTION_STRING format");
    return { ok: false, status: 500 };
  }

  // Support multiple recipients
  const toList = Array.isArray(to)
    ? to.map((addr) => ({ address: addr }))
    : [{ address: to }];

  const body = JSON.stringify({
    senderAddress: from,
    recipients: { to: toList },
    replyTo: replyTo ? [{ address: replyTo }] : undefined,
    content: { subject, html },
  });

  const date = new Date().toUTCString();
  const contentHashB64 = btoa(
    String.fromCharCode(
      ...new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)),
      ),
    ),
  );

  const url = new URL(`${endpoint}/emails:send?api-version=2023-03-31`);
  const stringToSign = `POST\n${url.pathname}${url.search}\n${date};${url.host};${contentHashB64}`;

  const keyBytes = Uint8Array.from(atob(accessKey), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBytes = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(stringToSign),
  );
  const signature = btoa(String.fromCharCode(...new Uint8Array(sigBytes)));

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Date: date,
      "x-ms-date": date,
      "x-ms-content-sha256": contentHashB64,
      Authorization: `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${signature}`,
    },
    body,
  });

  return res;
}
