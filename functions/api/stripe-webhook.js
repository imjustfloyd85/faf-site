// Cloudflare Pages Function — Stripe Webhook Handler
// Verifies Stripe signature, sends acknowledgment emails via ACS.
//
// DEPENDENCY: STRIPE_WEBHOOK_SECRET must be set as a CF Pages secret.
// Floyd will create the webhook endpoint in Stripe after deployment,
// then set this secret. Until then, this handler will reject all requests.
//
// DEPENDENCY: ACS_CONNECTION_STRING must be set as a CF Pages secret
// for email sending to work.

// --- ACS Email (same pattern as faf-chat/worker.js) ---

function acsEndpointFromConnStr(connStr) {
  const match = connStr.match(/endpoint=(https:\/\/[^;]+)/i);
  return match ? match[1].replace(/\/$/, "") : null;
}

function acsKeyFromConnStr(connStr) {
  const match = connStr.match(/accesskey=([^;]+)/i);
  return match ? match[1] : null;
}

async function sendViaACS(env, { from, to, replyTo, subject, html }) {
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

  const body = JSON.stringify({
    senderAddress: from,
    recipients: { to: [{ address: to }] },
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

// --- Stripe Webhook Signature Verification ---

async function verifyStripeSignature(payload, sigHeader, secret) {
  if (!sigHeader || !secret) return false;

  const parts = {};
  sigHeader.split(",").forEach((item) => {
    const [key, value] = item.split("=");
    if (key && value) parts[key.trim()] = value.trim();
  });

  const timestamp = parts.t;
  const expectedSig = parts.v1;
  if (!timestamp || !expectedSig) return false;

  // Reject if timestamp is older than 5 minutes (replay protection)
  const age = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
  if (isNaN(age) || age > 300 || age < -60) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const keyBytes = new TextEncoder().encode(secret);
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
    new TextEncoder().encode(signedPayload),
  );
  const computed = [...new Uint8Array(sigBytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Constant-time comparison
  if (computed.length !== expectedSig.length) return false;
  let mismatch = 0;
  for (let i = 0; i < computed.length; i++) {
    mismatch |= computed.charCodeAt(i) ^ expectedSig.charCodeAt(i);
  }
  return mismatch === 0;
}

// --- Email Templates ---

function buildDonationEmail(session) {
  const amount = (session.amount_total / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
  const donorName =
    session.metadata?.donor_name ||
    session.customer_details?.name ||
    "Supporter";
  const donorEmail =
    session.customer_details?.email || session.customer_email || "";
  const date = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const isRecurring = session.metadata?.recurring === "monthly";

  return {
    toOrg: {
      subject: `Donation Received: ${amount} from ${donorName}`,
      html: `
        <h2>Fathers and Football -- New Donation</h2>
        <p><strong>Donor:</strong> ${donorName}</p>
        <p><strong>Email:</strong> ${donorEmail}</p>
        <p><strong>Amount:</strong> ${amount}${isRecurring ? " (monthly recurring)" : " (one-time)"}</p>
        <p><strong>Date:</strong> ${date}</p>
        <p><strong>Stripe Session:</strong> ${session.id}</p>
      `,
    },
    toDonor: {
      subject: "Thank you for your donation -- Fathers and Football",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #c8923c;">Fathers and Football</h2>
          <p>Dear ${donorName},</p>
          <p>Thank you for your generous ${isRecurring ? "monthly " : ""}donation of ${amount} to Fathers and Football.</p>
          <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0;" />
          <h3>Tax Receipt / Acknowledgment</h3>
          <p>This letter serves as your official written acknowledgment for tax purposes.</p>
          <p><strong>Organization:</strong> Fathers and Football<br/>
          <strong>EIN:</strong> 42-1980182<br/>
          <strong>Status:</strong> 501(c)(3) tax-exempt organization<br/>
          <strong>Date of contribution:</strong> ${date}<br/>
          <strong>Amount:</strong> ${amount}</p>
          <p><strong>No goods or services were provided in exchange for this contribution.</strong> The full amount of your donation is tax-deductible to the extent allowed by law.</p>
          <p>Please retain this acknowledgment for your tax records. Consult your tax advisor for guidance specific to your situation.</p>
          <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0;" />
          <p>Your support directly funds programs that connect fathers to their children through football. Thank you for investing in families.</p>
          <p>With gratitude,<br/>Fathers and Football<br/>
          <a href="https://fathersandfootball.org">fathersandfootball.org</a></p>
        </div>
      `,
    },
  };
}

function buildSponsorshipEmail(session) {
  const amount = (session.amount_total / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
  const sponsorName =
    session.metadata?.donor_name || session.customer_details?.name || "Sponsor";
  const sponsorEmail =
    session.customer_details?.email || session.customer_email || "";
  const tier = session.metadata?.tier || "unknown";
  const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
  const date = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return {
    toOrg: {
      subject: `Sponsorship Received: ${tierLabel} (${amount}) from ${sponsorName}`,
      html: `
        <h2>Fathers and Football -- New Sponsorship</h2>
        <p><strong>Sponsor:</strong> ${sponsorName}</p>
        <p><strong>Email:</strong> ${sponsorEmail}</p>
        <p><strong>Tier:</strong> ${tierLabel}</p>
        <p><strong>Amount:</strong> ${amount}</p>
        <p><strong>Date:</strong> ${date}</p>
        <p><strong>Stripe Session:</strong> ${session.id}</p>
      `,
    },
    toDonor: {
      subject: `Thank you for your ${tierLabel} sponsorship -- Fathers and Football`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #c8923c;">Fathers and Football</h2>
          <p>Dear ${sponsorName},</p>
          <p>Thank you for your ${tierLabel} sponsorship of ${amount} to Fathers and Football. Your partnership directly supports programs that connect fathers to their children through the game.</p>
          <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0;" />
          <h3>Sponsorship Acknowledgment &amp; Disclosure</h3>
          <p>This letter serves as your official written acknowledgment for tax purposes.</p>
          <p><strong>Organization:</strong> Fathers and Football<br/>
          <strong>EIN:</strong> 42-1980182<br/>
          <strong>Status:</strong> 501(c)(3) tax-exempt organization<br/>
          <strong>Date of contribution:</strong> ${date}<br/>
          <strong>Amount:</strong> ${amount}<br/>
          <strong>Sponsorship tier:</strong> ${tierLabel}</p>
          <p><strong>Quid Pro Quo Disclosure (IRC Section 6115):</strong> Because each sponsorship tier includes tangible benefits (such as logo placement, event invitations, or co-branded programming), only the portion of your contribution that exceeds the fair market value of the benefits you receive may be tax-deductible. In accordance with IRC Section 6115, Fathers and Football will provide a good-faith estimate of the fair market value of the benefits associated with your selected tier under separate cover if applicable. Please consult your tax advisor for guidance specific to your situation.</p>
          <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0;" />
          <p>We will be in touch within 2 business days to discuss the details of your ${tierLabel} sponsorship benefits. Welcome to the team.</p>
          <p>With gratitude,<br/>Fathers and Football<br/>
          <a href="https://fathersandfootball.org">fathersandfootball.org</a></p>
        </div>
      `,
    },
  };
}

// --- Main Handler ---

export async function onRequestPost(context) {
  const headers = { "Content-Type": "application/json" };

  try {
    const webhookSecret = context.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error("STRIPE_WEBHOOK_SECRET not configured — rejecting webhook");
      return new Response(
        JSON.stringify({ error: "Webhook not configured." }),
        { status: 500, headers },
      );
    }

    const rawBody = await context.request.text();
    const sigHeader = context.request.headers.get("Stripe-Signature");

    const valid = await verifyStripeSignature(
      rawBody,
      sigHeader,
      webhookSecret,
    );
    if (!valid) {
      console.error("Webhook signature verification failed");
      return new Response(JSON.stringify({ error: "Invalid signature." }), {
        status: 401,
        headers,
      });
    }

    const event = JSON.parse(rawBody);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const paymentType = session.metadata?.type;

      let emails;
      if (paymentType === "sponsorship") {
        emails = buildSponsorshipEmail(session);
      } else {
        emails = buildDonationEmail(session);
      }

      // Send notification to FAF org
      const orgResult = await sendViaACS(context.env, {
        from: "Fathers and Football <info@fathersandfootball.org>",
        to: "jwfloyd85@gmail.com",
        subject: emails.toOrg.subject,
        html: emails.toOrg.html,
      });

      if (!orgResult.ok) {
        console.error("Failed to send org notification:", orgResult.status);
      }

      // Send receipt/acknowledgment to donor/sponsor
      const donorEmail =
        session.customer_details?.email || session.customer_email;
      if (donorEmail) {
        const donorResult = await sendViaACS(context.env, {
          from: "Fathers and Football <info@fathersandfootball.org>",
          to: donorEmail,
          subject: emails.toDonor.subject,
          html: emails.toDonor.html,
        });

        if (!donorResult.ok) {
          console.error("Failed to send donor receipt:", donorResult.status);
        }
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers,
    });
  } catch (err) {
    console.error("Webhook error:", err);
    return new Response(
      JSON.stringify({ error: "Webhook processing failed." }),
      { status: 500, headers },
    );
  }
}

// Reject non-POST methods
export async function onRequestGet() {
  return new Response("Method not allowed", { status: 405 });
}
