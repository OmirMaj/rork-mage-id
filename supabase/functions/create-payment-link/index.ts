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

async function stripeFetch(path: string, body: Record<string, unknown>): Promise<{
  ok: boolean;
  status: number;
  json: Record<string, unknown>;
}> {
  const res = await fetch(`${STRIPE_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": STRIPE_API_VERSION,
    },
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

  const currency = (body.currency || "usd").toLowerCase();
  const productName = `Invoice #${body.invoiceNumber} — ${body.projectName}`;
  const shortDesc = body.description
    ? body.description.substring(0, 250)
    : `Payment for ${body.projectName}`;

  // Step 1: Create a Price with inline product_data. This is the supported
  // shortcut that avoids having to create a separate Product first.
  console.log("[create-payment-link] Creating price for invoice", body.invoiceId);
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
  });

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

  // Step 2: Create a Payment Link referencing that price.
  //
  // We attach `metadata.invoice_id` here as well so a future webhook handler
  // (checkout.session.completed) can reconcile the payment back to our invoice
  // without needing to look up the Price.
  console.log("[create-payment-link] Creating payment link for price", priceId);
  const linkRes = await stripeFetch("/payment_links", {
    line_items: [{ price: priceId, quantity: 1 }],
    // Short message shown above the pay button — helps the client confirm they
    // hit the right link when we email/text it to them.
    custom_text: {
      submit: { message: shortDesc },
    },
    metadata: {
      invoice_id: body.invoiceId,
      invoice_number: String(body.invoiceNumber),
    },
    // Collect billing address so the GC has a record tied to the payment.
    // `auto` keeps Stripe's default heuristics (collect when required by
    // payment method) which is fine for card + ACH.
    billing_address_collection: "auto",
    // Allow promotion codes in case the GC wants to offer an early-pay
    // discount in the future. Harmless if unused.
    allow_promotion_codes: true,
    // After payment, show Stripe's hosted confirmation page. A future
    // enhancement can redirect back to the portal with a thank-you state.
    after_completion: { type: "hosted_confirmation" },
  });

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
