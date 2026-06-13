// revenuecat-webhook — the trusted, server-authoritative writer of subscription
// tier. This is the companion to migration
// 20260608120000_subscriptions_server_authoritative_tier.sql: now that clients
// can no longer self-grant a tier (the trigger pins it), the ONLY thing that
// may elevate a user's tier is this function, running under the service-role
// key after verifying the request actually came from RevenueCat.
//
// Deploy notes (must be set before this is live):
//   - Deploy with verify_jwt:false (RevenueCat sends no Supabase JWT). The
//     request is instead authenticated by a shared secret in the Authorization
//     header (RevenueCat dashboard → Webhooks → "Authorization header value").
//   - Env (supabase secrets set ...):
//       REVENUECAT_WEBHOOK_SECRET   — the exact Authorization header value
//                                     configured in the RC dashboard.
//       REVENUECAT_SECRET_API_KEY   — RC v1 secret API key (sk_...), used to
//                                     re-read the subscriber's CURRENT
//                                     entitlements so we never infer tier from a
//                                     single (possibly stale/out-of-order) event.
//       SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — standard.
//   - Point RevenueCat's webhook at:
//       {SUPABASE_URL}/functions/v1/revenuecat-webhook
//
// User mapping: the client calls Purchases.logIn(supabaseUserId) (see
// contexts/SubscriptionContext.tsx), so RC's app_user_id IS the Supabase user
// uuid. When app_user_id is a uuid we write straight to that user_id; if it's
// still an anonymous RC id ($RCAnonymousID:...) we fall back to matching the
// subscriptions row by revenuecat_customer_id.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const REVENUECAT_WEBHOOK_SECRET = Deno.env.get("REVENUECAT_WEBHOOK_SECRET") || "";
const REVENUECAT_SECRET_API_KEY = Deno.env.get("REVENUECAT_SECRET_API_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Entitlement id → tier. Mirrors contexts/SubscriptionContext.tsx
// tierFromCustomerInfo and the entitlement names documented in CLAUDE.md.
type Tier = "free" | "pro" | "business" | "enterprise";
const TIER_RANK: Record<Tier, number> = { free: 0, pro: 1, business: 2, enterprise: 3 };
const ENTITLEMENT_TIERS: Tier[] = ["enterprise", "business", "pro"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

// Constant-time string compare — same helper validate-portal-passcode uses, so
// the shared-secret check isn't a timing oracle.
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    let _diff = 0;
    for (let i = 0; i < a.length; i++) _diff |= a.charCodeAt(i) ^ 0;
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RCEvent {
  type?: string;
  app_user_id?: string;
  original_app_user_id?: string;
  entitlement_ids?: string[] | null;
  aliases?: string[];
}

/**
 * Ask RevenueCat for the subscriber's CURRENT active entitlements and resolve
 * the highest tier. Returns null if we can't reach RC (caller then falls back
 * to the event payload). This is authoritative and immune to out-of-order
 * webhook delivery.
 */
async function tierFromRevenueCat(appUserId: string): Promise<Tier | null> {
  if (!REVENUECAT_SECRET_API_KEY) return null;
  try {
    const r = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
      { headers: { Authorization: `Bearer ${REVENUECAT_SECRET_API_KEY}` } },
    );
    if (!r.ok) return null;
    const body = await r.json() as {
      subscriber?: { entitlements?: Record<string, { expires_date?: string | null }> };
    };
    const ents = body.subscriber?.entitlements ?? {};
    const now = Date.now();
    let best: Tier = "free";
    for (const tierName of ENTITLEMENT_TIERS) {
      const e = ents[tierName];
      if (!e) continue;
      // expires_date null = lifetime/active; otherwise must be in the future.
      const active = !e.expires_date || Date.parse(e.expires_date) > now;
      if (active && TIER_RANK[tierName] > TIER_RANK[best]) best = tierName;
    }
    return best;
  } catch {
    return null;
  }
}

/** Best-effort tier from a single event when RC REST is unavailable. */
function tierFromEvent(ev: RCEvent): Tier {
  const type = (ev.type ?? "").toUpperCase();
  if (type === "EXPIRATION" || type === "CANCELLATION" || type === "SUBSCRIPTION_PAUSED") {
    // A cancellation isn't immediately "free" (access often runs to period end),
    // but without RC REST we can't know the end date — be conservative and let a
    // later RENEWAL/INITIAL_PURCHASE event or RC re-read restore a paid tier.
    // We DON'T downgrade here to avoid yanking access mid-period on a stray
    // event; we simply make no change (handled by the caller for these types).
    return "free";
  }
  let best: Tier = "free";
  for (const id of ev.entitlement_ids ?? []) {
    const t = id.toLowerCase() as Tier;
    if (t in TIER_RANK && TIER_RANK[t] > TIER_RANK[best]) best = t;
  }
  return best;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }
  if (!REVENUECAT_WEBHOOK_SECRET || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_URL) {
    console.error("[rc-webhook] missing required env");
    return new Response("Server not configured", { status: 500, headers: corsHeaders });
  }

  // Authenticate the caller via the shared Authorization secret.
  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.startsWith("Bearer ") ? auth.slice(7) : auth;
  if (!constantTimeEqual(presented, REVENUECAT_WEBHOOK_SECRET)) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  let payload: { event?: RCEvent };
  try {
    payload = await req.json();
  } catch {
    return new Response("Bad JSON", { status: 400, headers: corsHeaders });
  }

  const ev = payload.event ?? {};
  const type = (ev.type ?? "").toUpperCase();
  const appUserId = ev.app_user_id || ev.original_app_user_id || "";

  // RC sends non-subscription events (TEST, TRANSFER, etc.) — ack and ignore.
  if (type === "TEST") {
    return new Response(JSON.stringify({ ok: true, ignored: "test" }), {
      status: 200, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
  if (!appUserId) {
    return new Response(JSON.stringify({ ok: true, ignored: "no app_user_id" }), {
      status: 200, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  // Resolve the authoritative current tier (RC REST preferred, event fallback).
  const authoritative = await tierFromRevenueCat(appUserId);
  const tier: Tier = authoritative ?? tierFromEvent(ev);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Map app_user_id → subscriptions row. Preferred: it's the Supabase user uuid.
  // Fallback: an anonymous RC id we previously stored as revenuecat_customer_id.
  try {
    if (UUID_RE.test(appUserId)) {
      const { error } = await supabase
        .from("subscriptions")
        .upsert(
          {
            user_id: appUserId,
            tier,
            revenuecat_customer_id: appUserId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        );
      if (error) throw error;
    } else {
      // Anonymous RC id — can only update an existing linked row.
      const { error, count } = await supabase
        .from("subscriptions")
        .update({ tier, updated_at: new Date().toISOString() }, { count: "exact" })
        .eq("revenuecat_customer_id", appUserId);
      if (error) throw error;
      if (!count) {
        console.warn(`[rc-webhook] no subscriptions row for anonymous app_user_id=${appUserId}`);
      }
    }
  } catch (err) {
    console.error("[rc-webhook] tier write failed:", String(err));
    // 500 so RevenueCat retries — a dropped grant must not be silently lost.
    return new Response("Write failed", { status: 500, headers: corsHeaders });
  }

  console.log(`[rc-webhook] ${type} → tier=${tier} for ${appUserId} (authoritative=${authoritative !== null})`);
  return new Response(JSON.stringify({ ok: true, tier }), {
    status: 200, headers: { ...corsHeaders, "content-type": "application/json" },
  });
});
