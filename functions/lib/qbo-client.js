// QuickBooks Online API client for Cloudflare Pages Functions.
// Handles OAuth token refresh and Sales Receipt creation.
//
// All tokens are stored in Cloudflare KV under key "qbo:tokens".
// Sandbox base URL is used — swap to production URL when going live.

const QBO_SANDBOX_BASE = "https://sandbox-quickbooks.api.intuit.com";
const QBO_PRODUCTION_BASE = "https://quickbooks.api.intuit.com";
const INTUIT_TOKEN_URL =
  "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

// Refresh tokens 5 minutes before expiry to avoid mid-request failures
const REFRESH_BUFFER_SECONDS = 300;

// Retrieve stored QBO tokens from KV.
export async function getTokens(kv) {
  const raw = await kv.get("qbo:tokens");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    console.error("Corrupt qbo:tokens in KV");
    return null;
  }
}

// Store QBO tokens in KV.
export async function storeTokens(kv, tokens) {
  await kv.put("qbo:tokens", JSON.stringify(tokens));
}

// Refresh the access token using the refresh token.
// Returns the updated token set, or throws on failure.
export async function refreshAccessToken(kv, env) {
  const tokens = await getTokens(kv);
  if (!tokens || !tokens.refresh_token) {
    throw new Error(
      "No QBO refresh token available — re-authorize via /api/quickbooks-connect",
    );
  }

  const clientId = env.QBO_CLIENT_ID;
  const clientSecret = env.QBO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("QBO_CLIENT_ID or QBO_CLIENT_SECRET not configured");
  }

  const basicAuth = btoa(`${clientId}:${clientSecret}`);

  const res = await fetch(INTUIT_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth}`,
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    }).toString(),
  });

  if (!res.ok) {
    const errBody = await res.text();
    console.error("QBO token refresh failed:", res.status, errBody);
    throw new Error(`QBO token refresh failed: ${res.status}`);
  }

  const data = await res.json();

  const updated = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || tokens.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
    realm_id: tokens.realm_id,
  };

  await storeTokens(kv, updated);
  return updated;
}

// Get a valid access token, refreshing if needed.
export async function getValidAccessToken(kv, env) {
  let tokens = await getTokens(kv);
  if (!tokens) {
    throw new Error(
      "QBO not connected — authorize via /api/quickbooks-connect",
    );
  }

  const now = Math.floor(Date.now() / 1000);
  if (tokens.expires_at - now < REFRESH_BUFFER_SECONDS) {
    tokens = await refreshAccessToken(kv, env);
  }

  return tokens;
}

// Create a Sales Receipt in QuickBooks Online.
// pendingEntry: { donorName, amountCents, type, category990, date, stripeSessionId }
export async function createSalesReceipt(kv, env, pendingEntry) {
  const tokens = await getValidAccessToken(kv, env);
  const { access_token, realm_id } = tokens;

  // Use sandbox API (swap QBO_SANDBOX_BASE -> QBO_PRODUCTION_BASE for prod)
  const useSandbox = env.QBO_SANDBOX !== "false";
  const baseUrl = useSandbox ? QBO_SANDBOX_BASE : QBO_PRODUCTION_BASE;
  const apiUrl = `${baseUrl}/v3/company/${realm_id}/salesreceipt?minorversion=73`;

  const amountDollars = (pendingEntry.amountCents / 100).toFixed(2);

  const typeLabel =
    pendingEntry.type === "sponsorship" ? "Sponsorship" : "Donation";
  const description = `${typeLabel} — ${pendingEntry.donorName} | 990: ${pendingEntry.category990} | Stripe: ${pendingEntry.stripeSessionId}`;

  const receiptBody = {
    Line: [
      {
        Amount: parseFloat(amountDollars),
        DetailType: "SalesItemLineDetail",
        Description: description,
        SalesItemLineDetail: {
          ItemRef: { value: "1", name: "Services" },
          Qty: 1,
          UnitPrice: parseFloat(amountDollars),
        },
      },
    ],
    PrivateNote: `FAF ${typeLabel} | 990 Category: ${pendingEntry.category990} | Stripe Session: ${pendingEntry.stripeSessionId}`,
    TxnDate: pendingEntry.date,
  };

  // If we have a donor name, attempt to set CustomerMemo
  if (pendingEntry.donorName) {
    receiptBody.CustomerMemo = {
      value: `${typeLabel} from ${pendingEntry.donorName}`,
    };
  }

  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${access_token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(receiptBody),
  });

  if (!res.ok) {
    const errBody = await res.text();
    console.error("QBO createSalesReceipt failed:", res.status, errBody);
    throw new Error(`QBO API error ${res.status}: ${errBody}`);
  }

  const result = await res.json();
  return result;
}

export {
  QBO_SANDBOX_BASE,
  QBO_PRODUCTION_BASE,
  INTUIT_TOKEN_URL,
  REFRESH_BUFFER_SECONDS,
};
