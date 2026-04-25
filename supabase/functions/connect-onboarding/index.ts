// connect-onboarding
//
// Creates (or reuses) a Stripe Connect Express account for the GC and
// returns a one-time hosted onboarding URL. The GC opens that URL,
// fills in business + bank info, and Stripe redirects them back. From
// that point on, their payment links and invoices route money to THEIR
// Stripe account, not the platform's.
//
// Flow:
//   1. App calls this function with { userId, email, returnUrl, refreshUrl }.
//   2. We look up the profile. If they don't have a stripe_account_id yet,
//      create a new Express account (US, capabilities: card_payments,
//      transfers). Save the id back to profiles.
//   3. Either way, generate an Account Link of type "account_onboarding"
//      that Stripe-hosts. Return its URL to the app.
//   4. App opens the URL in an in-app browser. GC finishes onboarding.
//      Stripe sends an `account.updated` webhook -> we flip the *_enabled
//      flags on the profile.
//
// Why we DON'T bake in the platform fee here:
//   The fee is applied per-charge at PaymentLink-creation time (see
//   create-payment-link) via `application_fee_amount`. Connect itself
//   has no notion of "platform fee at the account level" — it's a
//   per-charge thing.
//
// Secrets required:
//   STRIPE_SECRET_KEY            — your platform key (sk_live_... or sk_test_...)
//   SUPABASE_URL                 — auto-injected
//   SUPABASE_SERVICE_ROLE_KEY    — auto-injected; needed for the DB write
//                                  (RLS is restrictive on profiles).
//
// Request body:
//   {
//     userId: string,
//     email: string,
//     returnUrl: string,    // where Stripe redirects after onboarding completes
//     refreshUrl: string,   // where Stripe redirects if the link expires before they finish
//     companyName?: string  // pre-fills the business name on the form
//   }
// Response:
//   { success: true, url: string, accountId: string, alreadyEnabled?: boolean }
//   { success: false, error: string }

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
const STRIPE_API_VERSION = "2024-06-20";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

interface ConnectOnboardingRequest {
  userId: string;
  email: string;
  returnUrl: string;
  refreshUrl: string;
  companyName?: string;
}

async function stripeApi(path: string, body: Record<string, string>): Promise<{ ok: boolean; data: any; error?: string }> {
  // Stripe accepts URL-encoded form bodies for both nested objects and
  // top-level fields. We flatten anything fancy at the call site.
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined && v !== null && v !== "") params.append(k, v);
  }
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "Stripe-Version": STRIPE_API_VERSION,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { /* keep null */ }
  if (!res.ok) {
    return { ok: false, data, error: data?.error?.message ?? `HTTP ${res.status}` };
  }
  return { ok: true, data };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!STRIPE_SECRET_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ success: false, error: "server misconfigured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: ConnectOnboardingRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ success: false, error: "invalid json" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { userId, email, returnUrl: rawReturnUrl, refreshUrl: rawRefreshUrl, companyName } = body;
  if (!userId || !email) {
    return new Response(JSON.stringify({ success: false, error: "missing required fields" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Stripe's account_links endpoint hard-rejects anything that isn't HTTPS
  // — custom schemes (mageid://, exp://) come back with "Not a valid URL".
  // Old app builds were sending custom schemes; rather than gate on bundle
  // freshness, we always normalize here. If the client passes an HTTPS URL,
  // we trust it; otherwise we substitute our canonical web fallback.
  const APP_WEB_BASE = "https://app.mageid.app/payments-setup";
  const isHttps = (u: unknown): u is string => typeof u === "string" && u.startsWith("https://");
  const returnUrl = isHttps(rawReturnUrl) ? rawReturnUrl : `${APP_WEB_BASE}?return=1`;
  const refreshUrl = isHttps(rawRefreshUrl) ? rawRefreshUrl : `${APP_WEB_BASE}?refresh=1`;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Look up the user's existing account id, if any.
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("stripe_account_id, stripe_charges_enabled")
    .eq("id", userId)
    .single();

  if (profileError && profileError.code !== "PGRST116") {
    // PGRST116 = no rows; we'll insert below. Anything else is a real error.
    console.error("[connect-onboarding] profile fetch error:", profileError);
    return new Response(JSON.stringify({ success: false, error: "profile lookup failed" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let accountId = profile?.stripe_account_id ?? null;

  // If they're already fully enabled, short-circuit — they don't need
  // to onboard again. The app should not have called this in that case
  // but we handle it gracefully.
  if (accountId && profile?.stripe_charges_enabled) {
    return new Response(JSON.stringify({
      success: true,
      url: "",
      accountId,
      alreadyEnabled: true,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Create the Express account if we don't have one yet.
  if (!accountId) {
    const acctRes = await stripeApi("accounts", {
      type: "express",
      country: "US",
      email,
      "capabilities[card_payments][requested]": "true",
      "capabilities[transfers][requested]": "true",
      "business_profile[name]": companyName ?? "",
      // Tag the account with our internal user id for forensics.
      "metadata[mageid_user_id]": userId,
    });
    if (!acctRes.ok || !acctRes.data?.id) {
      console.error("[connect-onboarding] account creation failed:", acctRes.error);
      return new Response(JSON.stringify({ success: false, error: acctRes.error ?? "Stripe account creation failed" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    accountId = acctRes.data.id;

    // Persist the account id immediately so a network failure during
    // link generation doesn't orphan an Express account.
    await supabase.from("profiles").update({
      stripe_account_id: accountId,
      stripe_account_country: "US",
      stripe_connect_started_at: new Date().toISOString(),
      stripe_connect_updated_at: new Date().toISOString(),
    }).eq("id", userId);
  }

  // Generate the hosted onboarding link. Account Links are single-use
  // and expire quickly (~15 min) — the app must re-call this if the
  // GC bounces and comes back later.
  const linkRes = await stripeApi("account_links", {
    account: accountId!,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: "account_onboarding",
  });
  if (!linkRes.ok || !linkRes.data?.url) {
    console.error("[connect-onboarding] account link creation failed:", linkRes.error);
    return new Response(JSON.stringify({ success: false, error: linkRes.error ?? "Stripe link creation failed" }), {
      status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({
    success: true,
    url: linkRes.data.url,
    accountId,
  }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
