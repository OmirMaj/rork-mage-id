// create-rfp-checkout
//
// Deno edge function: creates a Stripe Checkout Session for the property-owner
// "$25 to post an RFP" fee.
//
// This is a PLATFORM-DIRECT charge (MAGE ID is the merchant) — NOT the Stripe
// Connect application-fee flow that create-payment-link uses (that routes a
// contractor's invoice payment to the contractor's Connect account and skims a
// take-rate). Here the platform simply collects the post fee.
//
// On a completed session, stripe-webhook grants one rfp_post_credit to the
// paying user (metadata.user_id), which the post-rfp flow later spends via
// the consume_rfp_post_credit() RPC. That server-confirmed grant — not any
// client call — is what unlocks a post, so the fee can't be bypassed.
//
// Secrets required (already set for create-payment-link):
//   STRIPE_SECRET_KEY
//
// Request body: { returnUrl?: string }  // where Stripe sends the user back
// Response:      { url: string, id: string } | { error: string }

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
const STRIPE_BASE = "https://api.stripe.com/v1";
const RFP_POST_FEE_CENTS = parseInt(Deno.env.get("RFP_POST_FEE_CENTS") ?? "2500", 10);
const DEFAULT_RETURN = "https://app.mageid.app/post-rfp";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// Decode `sub` (user id) + email from the caller's Supabase JWT. The app
// invokes this with the user's access token, so the sub is the paying user.
// We don't cryptographically verify here: the sub only decides who receives
// the credit they themselves paid for, so forging it is self-defeating.
function decodeCaller(auth: string | null): { sub: string; email?: string } | null {
  if (!auth) return null;
  const token = auth.replace(/^Bearer\s+/i, "");
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (!payload?.sub) return null;
    return { sub: String(payload.sub), email: payload.email ? String(payload.email) : undefined };
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  if (!STRIPE_SECRET_KEY) return jsonResponse({ error: "Payments are not configured." }, 500);

  const caller = decodeCaller(req.headers.get("Authorization"));
  if (!caller) return jsonResponse({ error: "Unauthorized" }, 401);

  let body: { returnUrl?: string } = {};
  try {
    body = await req.json();
  } catch {
    // body is optional
  }
  const base = body.returnUrl && /^https?:\/\//.test(body.returnUrl) ? body.returnUrl : DEFAULT_RETURN;
  const sep = base.includes("?") ? "&" : "?";
  const successUrl = `${base}${sep}rfp_paid=1`;
  const cancelUrl = `${base}${sep}rfp_paid=0`;

  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("success_url", successUrl);
  form.set("cancel_url", cancelUrl);
  form.set("client_reference_id", caller.sub);
  form.set("metadata[user_id]", caller.sub);
  form.set("metadata[purpose]", "rfp_post_fee");
  if (caller.email) form.set("customer_email", caller.email);
  form.set("line_items[0][quantity]", "1");
  form.set("line_items[0][price_data][currency]", "usd");
  form.set("line_items[0][price_data][unit_amount]", String(RFP_POST_FEE_CENTS));
  form.set("line_items[0][price_data][product_data][name]", "MAGE ID — Post a project (RFP)");

  try {
    const res = await fetch(`${STRIPE_BASE}/checkout/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error("[create-rfp-checkout] Stripe error:", data?.error?.message);
      return jsonResponse({ error: data?.error?.message ?? "Could not start checkout." }, 502);
    }
    console.log("[create-rfp-checkout] session", data.id, "for", caller.sub);
    return jsonResponse({ url: data.url, id: data.id });
  } catch (err) {
    console.error("[create-rfp-checkout] failed:", err);
    return jsonResponse({ error: "Could not start checkout." }, 502);
  }
});
