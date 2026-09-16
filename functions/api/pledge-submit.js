// Cloudflare Pages Function -- Pledge Submission + Stripe Checkout
// Validates pledge form input, stores the pledge entry in KV, and creates
// a Stripe Checkout session. PDF generation and confirmation emails are
// deferred to the webhook handler (stripe-webhook.js) so they only fire
// after payment actually confirms.

import { PLEDGE_AGREEMENT_VERSION } from "../lib/pledge-agreement.js";

const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_SECONDS = 600;
const SUBMISSION_TTL_SECONDS = 365 * 24 * 60 * 60;
const STRIPE_API = "https://api.stripe.com/v1/checkout/sessions";

export async function onRequestPost(context) {
  const headers = { "Content-Type": "application/json" };

  const kv = context.env.FAF_KV;
  if (!kv) {
    console.error("FAF_KV binding not configured");
    return new Response(
      JSON.stringify({ error: "Pledge storage not available." }),
      { status: 500, headers },
    );
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
      status: 400,
      headers,
    });
  }

  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim();
  const amount = String(body.amount || "").trim();
  const frequency = String(body.frequency || "").trim();
  const agreed = body.agreed === true;

  if (!name || !email || !amount || !frequency) {
    return new Response(
      JSON.stringify({
        error: "Name, email, pledge amount, and frequency are all required.",
      }),
      { status: 400, headers },
    );
  }

  if (!agreed) {
    return new Response(
      JSON.stringify({
        error: "You must agree to the pledge terms before submitting.",
      }),
      { status: 400, headers },
    );
  }

  const atIndex = email.indexOf("@");
  if (atIndex < 1 || email.indexOf(".", atIndex) === -1) {
    return new Response(
      JSON.stringify({ error: "Please provide a valid email address." }),
      { status: 400, headers },
    );
  }

  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    return new Response(
      JSON.stringify({ error: "Please provide a valid pledge amount." }),
      { status: 400, headers },
    );
  }

  if (!["one-time", "monthly"].includes(frequency)) {
    return new Response(
      JSON.stringify({ error: "Frequency must be one-time or monthly." }),
      { status: 400, headers },
    );
  }

  if (name.length > 200) {
    return new Response(JSON.stringify({ error: "Name is too long." }), {
      status: 400,
      headers,
    });
  }
  if (email.length > 200) {
    return new Response(JSON.stringify({ error: "Email is too long." }), {
      status: 400,
      headers,
    });
  }

  const ip = context.request.headers.get("CF-Connecting-IP") || "unknown";
  const rateLimitKey = `ratelimit:pledge:${ip}`;
  const currentCountRaw = await kv.get(rateLimitKey);
  const currentCount = currentCountRaw ? parseInt(currentCountRaw, 10) : 0;

  if (currentCount >= RATE_LIMIT_MAX) {
    return new Response(
      JSON.stringify({
        error: "Too many submissions. Please try again in a few minutes.",
      }),
      { status: 429, headers },
    );
  }

  await kv.put(rateLimitKey, String(currentCount + 1), {
    expirationTtl: RATE_LIMIT_WINDOW_SECONDS,
  });

  const secretKey = context.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return new Response(
      JSON.stringify({ error: "Payment processing is not configured." }),
      { status: 500, headers },
    );
  }

  const entryId = crypto.randomUUID();

  const entry = {
    id: entryId,
    name: name.slice(0, 200),
    email: email.slice(0, 200),
    phone: body.phone ? String(body.phone).slice(0, 30) : "",
    amount: parsedAmount.toFixed(2),
    frequency,
    agreementVersion: PLEDGE_AGREEMENT_VERSION,
    agreementAcceptedAt: new Date().toISOString(),
    userAgent: context.request.headers.get("user-agent") || "",
    status: "pending-payment",
    createdAt: new Date().toISOString(),
  };

  await kv.put(`pledge:${entryId}`, JSON.stringify(entry), {
    expirationTtl: SUBMISSION_TTL_SECONDS,
  });

  // Create Stripe Checkout session.
  // PDF and confirmation emails are sent by the webhook after payment confirms.
  const isRecurring = frequency === "monthly";
  const mode = isRecurring ? "subscription" : "payment";
  const productName = isRecurring
    ? "Monthly Pledge -- Fathers and Football"
    : "Pledge -- Fathers and Football";
  const unitAmount = Math.round(parsedAmount * 100);

  const siteUrl = new URL(context.request.url).origin;
  const params = new URLSearchParams();
  params.append("mode", mode);
  params.append(
    "success_url",
    `${siteUrl}/pledge-success.html?session_id={CHECKOUT_SESSION_ID}`,
  );
  params.append("cancel_url", `${siteUrl}/pledge-cancel.html`);
  params.append("customer_email", email);
  params.append("line_items[0][quantity]", "1");
  params.append("line_items[0][price_data][currency]", "usd");
  params.append("line_items[0][price_data][product_data][name]", productName);
  params.append("line_items[0][price_data][unit_amount]", String(unitAmount));

  if (isRecurring) {
    params.append("line_items[0][price_data][recurring][interval]", "month");
  }

  params.append("metadata[type]", "pledge");
  params.append("metadata[pledge_id]", entryId);
  params.append("metadata[donor_name]", name.slice(0, 200));
  params.append("metadata[frequency]", frequency);

  const stripeRes = await fetch(STRIPE_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const session = await stripeRes.json();

  if (!stripeRes.ok) {
    console.error("Stripe error:", JSON.stringify(session));
    return new Response(
      JSON.stringify({
        error: "Unable to create checkout session. Please try again.",
      }),
      { status: 502, headers },
    );
  }

  // Only return the checkout URL -- never expose session secrets
  return new Response(JSON.stringify({ url: session.url }), {
    status: 200,
    headers,
  });
}

export async function onRequestGet() {
  return new Response("Method not allowed", { status: 405 });
}

export async function onRequestPut() {
  return new Response("Method not allowed", { status: 405 });
}

export async function onRequestDelete() {
  return new Response("Method not allowed", { status: 405 });
}
