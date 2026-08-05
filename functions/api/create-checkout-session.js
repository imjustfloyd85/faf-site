// Cloudflare Pages Function — Stripe Checkout Session creator
// Handles both flexible donations and fixed sponsorship tiers.
// Uses Stripe REST API directly (no SDK needed in CF Pages).

const STRIPE_API = "https://api.stripe.com/v1/checkout/sessions";

// Server-side tier price map (cents). Client values are NEVER trusted for tiers.
const TIER_PRICES = {
  sideline: { amount: 25000, name: "Sideline Sponsorship" },
  playmaker: { amount: 100000, name: "Playmaker Sponsorship" },
  legacy: { amount: 500000, name: "Legacy Sponsorship" }, // minimum
};

function corsHeaders(origin) {
  const allowed = [
    "https://fathersandfootball.org",
    "https://www.fathersandfootball.org",
    "http://localhost:8788",
    "http://localhost:3000",
  ];
  return {
    "Access-Control-Allow-Origin": allowed.includes(origin)
      ? origin
      : allowed[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get("Origin") || "";
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function onRequestPost(context) {
  const origin = context.request.headers.get("Origin") || "";
  const cors = corsHeaders(origin);
  const headers = { "Content-Type": "application/json", ...cors };

  try {
    const secretKey = context.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      return new Response(
        JSON.stringify({ error: "Payment processing is not configured." }),
        { status: 500, headers },
      );
    }

    const body = await context.request.json();
    const { type, tier, amount, recurring, name, email } = body;

    // Validate common fields
    if (!email || typeof email !== "string" || !email.includes("@")) {
      return new Response(
        JSON.stringify({ error: "A valid email address is required." }),
        { status: 400, headers },
      );
    }

    let unitAmount; // in cents
    let productName;
    let mode;
    let lineItem;
    let metadata = {};

    if (type === "sponsorship") {
      // --- SPONSORSHIP TIER CHECKOUT ---
      // Server-side validation: tier prices are NEVER taken from client
      if (!tier || !TIER_PRICES[tier]) {
        return new Response(
          JSON.stringify({ error: "Invalid sponsorship tier." }),
          { status: 400, headers },
        );
      }

      const tierDef = TIER_PRICES[tier];

      if (tier === "legacy") {
        // Legacy is $5,000+ — accept custom amount if >= minimum
        const customAmount = parseInt(amount, 10);
        if (!customAmount || customAmount < 5000) {
          return new Response(
            JSON.stringify({
              error: "Legacy sponsorship requires a minimum of $5,000.",
            }),
            { status: 400, headers },
          );
        }
        unitAmount = customAmount * 100;
      } else {
        // Sideline and Playmaker are fixed — ignore any client-supplied amount
        unitAmount = tierDef.amount;
      }

      productName = tierDef.name + " — Fathers and Football";
      mode = "payment"; // sponsorships are one-time
      metadata = { type: "sponsorship", tier };

      lineItem = {
        price_data: {
          currency: "usd",
          product_data: { name: productName },
          unit_amount: unitAmount,
        },
        quantity: 1,
      };
    } else {
      // --- DONATION CHECKOUT ---
      const donationAmount = parseInt(amount, 10);
      if (!donationAmount || donationAmount < 1 || donationAmount > 999999) {
        return new Response(
          JSON.stringify({
            error: "Please enter a valid donation amount ($1 - $999,999).",
          }),
          { status: 400, headers },
        );
      }

      unitAmount = donationAmount * 100;
      const isRecurring = recurring === true || recurring === "true";
      mode = isRecurring ? "subscription" : "payment";
      productName = isRecurring
        ? "Monthly Donation — Fathers and Football"
        : "Donation — Fathers and Football";
      metadata = {
        type: "donation",
        recurring: isRecurring ? "monthly" : "one-time",
      };

      const priceData = {
        currency: "usd",
        product_data: { name: productName },
        unit_amount: unitAmount,
      };
      if (isRecurring) {
        priceData.recurring = { interval: "month" };
      }

      lineItem = { price_data: priceData, quantity: 1 };
    }

    // Build Stripe API form body
    const siteUrl = new URL(context.request.url).origin;
    const params = new URLSearchParams();
    params.append("mode", mode);
    params.append(
      "success_url",
      `${siteUrl}/donate-success.html?session_id={CHECKOUT_SESSION_ID}`,
    );
    params.append("cancel_url", `${siteUrl}/donate-cancel.html`);
    params.append("customer_email", email);
    params.append("line_items[0][quantity]", "1");
    params.append("line_items[0][price_data][currency]", "usd");
    params.append("line_items[0][price_data][product_data][name]", productName);
    params.append("line_items[0][price_data][unit_amount]", String(unitAmount));

    if (mode === "subscription") {
      params.append("line_items[0][price_data][recurring][interval]", "month");
    }

    if (name) {
      params.append("metadata[donor_name]", String(name).slice(0, 200));
    }
    Object.entries(metadata).forEach(([k, v]) => {
      params.append(`metadata[${k}]`, v);
    });

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

    // Only return the checkout URL — never expose session secrets
    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers,
    });
  } catch (err) {
    console.error("Checkout session error:", err);
    return new Response(
      JSON.stringify({ error: "Internal error. Please try again." }),
      { status: 500, headers },
    );
  }
}
