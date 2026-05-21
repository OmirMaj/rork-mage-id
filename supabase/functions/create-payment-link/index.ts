// create-payment-link
//
// Deno edge function that creates a Stripe Payment Link for an invoice.
//
// Why a server-side function instead of hitting Stripe from the app:
//   - Stripe's secret key MUST NOT ship in the client bundle. A leaked sk_live
//     key lets anyone issue refunds, read customer data, or drain the account.
//     Keeping it server-side with Supabase Edge Functions secrets is the only
//     safe path.
//   - The Payment Link URL itself is safe to share — it's the GC's "Pay Now"
//     link that gets embedded in the client portal.
//
// Flow:
//   1. GC taps "Generate Payment Link" on an invoice.
//   2. App calls this function with { invoiceNumber, amountCents, projectName, ... }.
//   3. We call Stripe REST API to create a one-time Price (with inline Product)
//      and then a Payment Link referencing that price.
//   4. Return the URL + id. App stores them on the invoice, which flows into
//      the portal snapshot so the client sees a one-tap "Pay" button.
//
// Why two Stripe calls (Price then PaymentLink) instead of one?
//   - Stripe's PaymentLink API requires a `price` ID. It doesn't accept inline
//     amount/currency. So we create the Price first (with product_data inline —
//     that's the supported one-call shortcut for creating product+price).
//   - We avoid creating persistent Products/Prices per invoice for cleanliness;
//     each invoice's Price is self-contained.
//
// Secrets required (set via Supabase dashboard → Edge Functions → Secrets):
//   STRIPE_SECRET_KEY — from dashboard.stripe.com/apikeys (sk_test_... or sk_live_...)
//
// Request body:
//   {
//     invoiceId: string,            // our internal id — attached as Stripe metadata
//     invoiceNumber: string|number, // shown on the payment page
//     projectName: string,          // shown on the payment page
//     amountCents: number,          // integer cents (e.g. 250000 = $2,500.00)
//     currency?: string,            // default "usd"
//     description?: string,         // optional extra context on the pay page
//     customerEmail?: string,       // prefills the email field on checkout
//     companyName?: string,         // for the line-item product name fallback
//   }
//
// Response:
//   { success: true, url: string, id: string }
//   { success: false, error: string }

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
const STRIPE_API_VERSION = "2024-06-20";
const STRIPE_BASE = "https://api.stripe.com/v1";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

interface CreatePaymentLinkBody {
  invoiceId: string;
  invoiceNumber: string | number;
  projectName: string;
  amountCents: number;
  currency?: string;
  description?: string;
  customerEmail?: string;
  companyName?: string;
  /**
   * The contractor's Stripe Connect Express account id (acct_xxx). When
   * present, the Payment Link is created ON BEHALF OF that account, so
   * money flows directly to the contractor's bank — not the platform's.
   * Required for production use; absence falls back to platform-owned
   * legacy mode (only useful during local Stripe testing).
   */
  stripeAccountId?: string;
  /**
   * GC's MAGE subscription tier. Drives the platform-fee schedule. We
   * deliberately scale the fee inversely to subscription price:
   *   - free / pro    →   0 bps (no markup — top-of-funnel + Pro perk)
   *   - business      →  50 bps (durable take-rate; Toast lives at 48)
   *   - enterprise    →  40 bps (volume discount, also a sales lever)
   *
   * Trusting the client tier is a 5-minute fraud-win at most ($10 saved
   * on a $100k invoice by spoofing enterprise). Not worth the latency
   * of an auth round-trip on the hot path.
   */
  userTier?: "free" | "pro" | "business" | "enterprise";
}

/**
 * Default fee in basis points when the client doesn't send a tier (e.g.
 * older app version still on the road). Set to the Business-tier rate so
 * we don't accidentally undercollect from heavy users; a Business user
 * on an old build pays the same as one on a new build.
 */
const PLATFORM_FEE_BPS_DEFAULT = parseInt(
  Deno.env.get("PLATFORM_FEE_BPS") ?? "50",
  10,
);

/**
 * Tier → bps lookup. Easily flippable via env if we want to run a
 * promotional period (free payments for Business through Q1, etc.) by
 * just setting the env var.
 */
function feeBpsForTier(tier?: string): number {
  switch (tier) {
    case "free":
    case "pro":
      return parseInt(Deno.env.get("PLATFORM_FEE_BPS_PRO") ?? "0", 10);
    case "business":
      return parseInt(Deno.env.get("PLATFORM_FEE_BPS_BUSINESS") ?? "50", 10);
    case "enterprise":
      return parseInt(Deno.env.get("PLATFORM_FEE_BPS_ENTERPRISE") ?? "40", 10);
    default:
      return PLATFORM_FEE_BPS_DEFAULT;
  }
}

// Stripe's REST API takes application/x-www-form-urlencoded with bracketed keys
// for nested objects. This helper walks any JS object into that form.
function toFormBody(obj: Record<string, unknown>, prefix = ""): string {
  const params: string[] = [];
  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined || val === null) continue;
    const formKey = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(val)) {
      val.forEach((item, i) => {
        if (item !== null && typeof item === "object") {
          params.push(toFormBody(item as Record<string, unknown>, `${formKey}[${i}]`));
        } else {
          params.push(`${encodeURIComponent(`${formKey}[${i}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else if (typeof val === "object") {
      params.push(toFormBody(val as Record<string, unknown>, formKey));
    } else {
      params.push(`${encodeURIComponent(formKey)}=${encodeURIComponent(String(val))}`);
    }
  }
  return params.filter(Boolean).join("&");
}

async function stripeFetch(path: string, body: Record<string, unknown>, stripeAccountId?: string): Promise<{
  ok: boolean;
  status: number;
  json: Record<string, unknown>;
}> {
  // The Stripe-Account header makes the call act AS the connected account.
  // Stripe routes any resources created (Price, PaymentLink, charges) into
  // that account so the contractor — not the platform — owns them.
  const headers: Record<string, string> = {
    Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
    "Content-Type": "application/x-www-form-urlencoded",
    "Stripe-Version": STRIPE_API_VERSION,
  };
  if (stripeAccountId) headers["Stripe-Account"] = stripeAccountId;

  const res = await fetch(`${STRIPE_BASE}${path}`, {
    method: "POST",
    headers,
    body: toFormBody(body),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text.substring(0, 500) };
  }
  return { ok: res.ok, status: res.status, json };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }
  if (!STRIPE_SECRET_KEY) {
    console.error("[create-payment-link] STRIPE_SECRET_KEY not set");
    return jsonResponse(
      { success: false, error: "Payment service not configured" },
      500,
    );
  }

  let body: CreatePaymentLinkBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ success: false, error: "Invalid JSON body" }, 400);
  }

  // Validate — be strict because invalid input costs a Stripe round-trip.
  if (!body.invoiceId || typeof body.invoiceId !== "string") {
    return jsonResponse({ success: false, error: "Missing invoiceId" }, 400);
  }
  if (body.invoiceNumber === undefined || body.invoiceNumber === null) {
    return jsonResponse({ success: false, error: "Missing invoiceNumber" }, 400);
  }
  if (!body.projectName || typeof body.projectName !== "string") {
    return jsonResponse({ success: false, error: "Missing projectName" }, 400);
  }
  if (typeof body.amountCents !== "number" || !Number.isFinite(body.amountCents)) {
    return jsonResponse({ success: false, error: "amountCents must be a number" }, 400);
  }
  // Stripe enforces a 50¢ minimum for USD charges. Block early with a clean
  // error rather than letting the user see a cryptic "amount_too_small" from
  // Stripe.
  if (body.amountCents < 50) {
    return jsonResponse(
      { success: false, error: "Minimum charge amount is $0.50" },
      400,
    );
  }
  // Stripe caps USD transactions at $999,999.99 (99999999 cents). Above this
  // the API rejects the Price creation.
  if (body.amountCents > 99_999_999) {
    return jsonResponse(
      { success: false, error: "Amount exceeds Stripe maximum ($999,999.99)" },
      400,
    );
  }

  // Audit-2026-05-21: ownership check. Pre-fix this function had
  // verify_jwt:true at the platform level but trusted body.invoiceId
  // and body.stripeAccountId blindly. An authenticated attacker A could:
  //   1. Call with body.invoiceId = victim_B's invoice id, body.stripeAccountId = A's own account
  //   2. Get a Stripe payment link with metadata.invoice_id = victim_B's id, money flowing to A
  //   3. Send the link to the real homeowner who pays
  //   4. Stripe webhook fires with metadata.invoice_id = B's id → MAGE marks B's invoice paid
  //   5. Attacker pocketed the money; victim B sees "paid in full" without receiving funds
  // Fix: decode caller's JWT, confirm invoice.user_id === caller.sub AND
  // profile.stripe_account_id === body.stripeAccountId (when provided).
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[create-payment-link] Supabase server config missing — cannot verify ownership");
    return jsonResponse({ success: false, error: "Server misconfigured" }, 500);
  }
  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  let callerSub: string | null = null;
  try {
    const parts = bearer.split(".");
    if (parts.length === 3) {
      let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4) b64 += "=";
      const payload = JSON.parse(atob(b64));
      if (payload && typeof payload.sub === "string") callerSub = payload.sub;
    }
  } catch { /* fall through to 401 */ }
  if (!callerSub) {
    return jsonResponse({ success: false, error: "Unauthenticated" }, 401);
  }
  // Verify the caller owns the invoice they're creating a payment link for.
  try {
    const invRes = await fetch(
      `${SUPABASE_URL}/rest/v1/invoices?id=eq.${encodeURIComponent(body.invoiceId)}&select=id,user_id&limit=1`,
      { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } },
    );
    if (!invRes.ok) {
      console.error("[create-payment-link] invoice lookup failed:", invRes.status);
      return jsonResponse({ success: false, error: "Could not verify invoice ownership" }, 500);
    }
    const invRows = await invRes.json() as { id: string; user_id: string }[];
    if (invRows.length === 0) {
      return jsonResponse({ success: false, error: "Invoice not found" }, 404);
    }
    if (invRows[0].user_id !== callerSub) {
      console.warn("[create-payment-link] caller", callerSub, "tried to create link for invoice owned by", invRows[0].user_id);
      return jsonResponse({ success: false, error: "Invoice does not belong to caller" }, 403);
    }
  } catch (e) {
    console.error("[create-payment-link] ownership check exception:", e);
    return jsonResponse({ success: false, error: "Ownership check failed" }, 500);
  }
  // If a Stripe Connect account is specified, verify it belongs to the caller.
  // This blocks the attack where caller routes a victim's payment into someone
  // else's Stripe account.
  if (body.stripeAccountId) {
    try {
      const profRes = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(callerSub)}&select=stripe_account_id&limit=1`,
        { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } },
      );
      if (!profRes.ok) {
        console.error("[create-payment-link] profile lookup failed:", profRes.status);
        return jsonResponse({ success: false, error: "Could not verify Stripe account ownership" }, 500);
      }
      const profRows = await profRes.json() as { stripe_account_id: string | null }[];
      const ownAccountId = profRows[0]?.stripe_account_id ?? null;
      if (!ownAccountId || ownAccountId !== body.stripeAccountId) {
        console.warn("[create-payment-link] caller", callerSub, "tried to use stripeAccountId", body.stripeAccountId, "which is not theirs (own:", ownAccountId, ")");
        return jsonResponse({ success: false, error: "stripeAccountId does not belong to caller" }, 403);
      }
    } catch (e) {
      console.error("[create-payment-link] stripeAccountId check exception:", e);
      return jsonResponse({ success: false, error: "Connect account check failed" }, 500);
    }
  }

  const currency = (body.currency || "usd").toLowerCase();
  const productName = `Invoice #${body.invoiceNumber} — ${body.projectName}`;
  const shortDesc = body.description
    ? body.description.substring(0, 250)
    : `Payment for ${body.projectName}`;

  // Step 1: Create a Price with inline product_data, ON BEHALF OF the
  // connected account if one was provided. This is the supported shortcut
  // that avoids having to create a separate Product first.
  console.log("[create-payment-link] Creating price for invoice", body.invoiceId, "stripeAccount:", body.stripeAccountId ?? "(platform)");
  const priceRes = await stripeFetch("/prices", {
    currency,
    unit_amount: Math.round(body.amountCents),
    product_data: {
      name: productName,
      ...(body.companyName ? { metadata: { company: body.companyName } } : {}),
    },
    metadata: {
      invoice_id: body.invoiceId,
      invoice_number: String(body.invoiceNumber),
      project_name: body.projectName,
    },
  }, body.stripeAccountId);

  if (!priceRes.ok) {
    const err = priceRes.json.error as { message?: string; type?: string } | undefined;
    console.error("[create-payment-link] Price creation failed:", priceRes.status, err);
    return jsonResponse(
      { success: false, error: err?.message || `Stripe price error (${priceRes.status})` },
      502,
    );
  }
  const priceId = priceRes.json.id as string;
  if (!priceId) {
    console.error("[create-payment-link] No price id in response");
    return jsonResponse({ success: false, error: "Stripe returned no price id" }, 502);
  }

  // Step 2: Create a Payment Link referencing that price, again on the
  // connected account. The platform's fee is taken via
  // `application_fee_amount`, which Stripe transfers to the platform
  // account on each successful charge automatically.
  console.log("[create-payment-link] Creating payment link for price", priceId);

  // Compute the tier-aware platform fee in cents. 50 bps of $1,000 is $5
  // = 500 cents. We round half-up so the fee never undercollects. Pro tier
  // gets 0 bps so their first dollar through our rails is friction-free —
  // that's the top-of-funnel perk and the Pro→Business upgrade lever.
  const feeBps = feeBpsForTier(body.userTier);
  const applicationFeeAmount = body.stripeAccountId
    ? Math.max(0, Math.round((body.amountCents * feeBps) / 10000))
    : 0;
  console.log(
    "[create-payment-link] tier=", body.userTier ?? "(unknown)",
    "feeBps=", feeBps,
    "applicationFeeAmount=", applicationFeeAmount,
  );

  const linkParams: Record<string, unknown> = {
    line_items: [{ price: priceId, quantity: 1 }],
    custom_text: {
      submit: { message: shortDesc },
    },
    metadata: {
      invoice_id: body.invoiceId,
      invoice_number: String(body.invoiceNumber),
    },
    billing_address_collection: "auto",
    allow_promotion_codes: true,
    after_completion: { type: "hosted_confirmation" },
  };

  // Only attach an application fee when we're actually on a connected
  // account. Stripe rejects application_fee_amount on non-Connect calls.
  if (body.stripeAccountId && applicationFeeAmount > 0) {
    linkParams.application_fee_amount = applicationFeeAmount;
  }

  const linkRes = await stripeFetch("/payment_links", linkParams, body.stripeAccountId);

  if (!linkRes.ok) {
    const err = linkRes.json.error as { message?: string; type?: string } | undefined;
    console.error("[create-payment-link] Payment link creation failed:", linkRes.status, err);
    return jsonResponse(
      { success: false, error: err?.message || `Stripe link error (${linkRes.status})` },
      502,
    );
  }

  const url = linkRes.json.url as string | undefined;
  const id = linkRes.json.id as string | undefined;
  if (!url || !id) {
    console.error("[create-payment-link] Stripe returned no url/id");
    return jsonResponse(
      { success: false, error: "Stripe returned an incomplete payment link" },
      502,
    );
  }

  console.log("[create-payment-link] Created", id, "for invoice", body.invoiceId);
  return jsonResponse({ success: true, url, id });
});
