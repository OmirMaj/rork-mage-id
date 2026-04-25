// connect-status
//
// Returns the current Stripe Connect status for a GC's profile. Used
// by the app's Settings → Payments screen to show one of:
//   • Not connected           — they've never started onboarding
//   • Onboarding incomplete   — they started but haven't finished
//   • Pending verification    — Stripe is verifying KYC docs
//   • Connected               — they can accept payments
//
// We could read straight from the profiles table (which the webhook
// keeps current), but on first onboarding-completion the webhook can
// arrive seconds after the user lands back in the app. To make the
// "Connected ✓" state feel instant we ALSO hit Stripe's account API
// directly here and update the row if Stripe says they're enabled but
// our DB hasn't caught up yet.
//
// Secrets: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
//
// Request: { userId: string }
// Response:
//   {
//     success: true,
//     status: 'none' | 'incomplete' | 'pending' | 'connected',
//     accountId?: string,
//     chargesEnabled: boolean,
//     payoutsEnabled: boolean,
//     detailsSubmitted: boolean,
//   }
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

type ConnectStatus = "none" | "incomplete" | "pending" | "connected";

function deriveStatus(charges: boolean, details: boolean): ConnectStatus {
  if (charges) return "connected";
  if (details) return "pending"; // submitted but Stripe hasn't enabled yet (KYC review)
  return "incomplete";
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

  let body: { userId: string };
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ success: false, error: "invalid json" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!body.userId) {
    return new Response(JSON.stringify({ success: false, error: "missing userId" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted")
    .eq("id", body.userId)
    .single();

  if (error && error.code !== "PGRST116") {
    return new Response(JSON.stringify({ success: false, error: "profile lookup failed" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!profile?.stripe_account_id) {
    return new Response(JSON.stringify({
      success: true,
      status: "none" as ConnectStatus,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Pull the live account from Stripe so we don't lag the webhook on
  // the post-onboarding "did it land?" check. If Stripe is unreachable,
  // fall back to the cached DB values rather than failing the call.
  let charges = !!profile.stripe_charges_enabled;
  let details = !!profile.stripe_details_submitted;
  let payouts = !!profile.stripe_payouts_enabled;

  try {
    const res = await fetch(`https://api.stripe.com/v1/accounts/${profile.stripe_account_id}`, {
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        "Stripe-Version": STRIPE_API_VERSION,
      },
    });
    if (res.ok) {
      const acct = await res.json();
      const liveCharges = !!acct.charges_enabled;
      const liveDetails = !!acct.details_submitted;
      const livePayouts = !!acct.payouts_enabled;
      // Reconcile back to our DB if Stripe says something newer than
      // what we have (covers the post-onboarding race-with-webhook).
      if (liveCharges !== charges || liveDetails !== details || livePayouts !== payouts) {
        await supabase.from("profiles").update({
          stripe_charges_enabled: liveCharges,
          stripe_details_submitted: liveDetails,
          stripe_payouts_enabled: livePayouts,
          stripe_connect_updated_at: new Date().toISOString(),
        }).eq("id", body.userId);
      }
      charges = liveCharges;
      details = liveDetails;
      payouts = livePayouts;
    }
  } catch (err) {
    console.warn("[connect-status] Stripe fetch failed, using cached values:", err);
  }

  return new Response(JSON.stringify({
    success: true,
    status: deriveStatus(charges, details),
    accountId: profile.stripe_account_id,
    chargesEnabled: charges,
    payoutsEnabled: payouts,
    detailsSubmitted: details,
  }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
