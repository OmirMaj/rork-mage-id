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
//                                     REQUIRED in practice: without it every
//                                     CANCELLATION / PAUSE / TRANSFER is
//                                     answered 500 (retry) rather than guessed.
//       SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — standard.
//   - Point RevenueCat's webhook at:
//       {SUPABASE_URL}/functions/v1/revenuecat-webhook
//
// User mapping: the client calls Purchases.logIn(supabaseUserId) (see
// contexts/SubscriptionContext.tsx), so RC's app_user_id IS the Supabase user
// uuid. When app_user_id is a uuid we write straight to that user_id; if it's
// still an anonymous RC id ($RCAnonymousID:...) we fall back to matching the
// subscriptions row by revenuecat_customer_id.
//
// Hand-granted plans (audit wave 5, #2): paid plans are turned on by the
// founder with the service key, with no RevenueCat purchase behind them. They
// carry subscriptions.manual_tier (migration 20260923010000), and nothing here
// writes a tier below it — so a later RevenueCat event (a sandbox purchase, an
// alias, a transfer) can no longer wipe a plan the customer was given.
//
// Sandbox (TestFlight) events are processed like production ones, as they
// always were. The phone counts a sandbox entitlement too
// (tierFromCustomerInfo reads entitlements.active with no isSandbox check), so
// ignoring sandbox here would put a TestFlight buyer on Pro on the phone and
// Free on the server — the #2 split with the sides swapped. Whether a
// TestFlight purchase should grant a real tier at all is an open founder
// decision; if it changes, BOTH sides change together
// (scripts/validate-w5-paywall-webhook.ts pins them to one rule).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const REVENUECAT_WEBHOOK_SECRET = Deno.env.get("REVENUECAT_WEBHOOK_SECRET") || "";
const REVENUECAT_SECRET_API_KEY = Deno.env.get("REVENUECAT_SECRET_API_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

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

// --- BEGIN resolveWrite (pure; scripts/validate-w5-paywall-webhook.ts executes this block) ---
// Entitlement id → tier. Mirrors contexts/SubscriptionContext.tsx
// tierFromCustomerInfo and the entitlement names documented in CLAUDE.md.
type Tier = "free" | "pro" | "business" | "enterprise";
const TIER_RANK: Record<Tier, number> = { free: 0, pro: 1, business: 2, enterprise: 3 };
const ENTITLEMENT_TIERS: Tier[] = ["enterprise", "business", "pro"];

interface RCEvent {
  type?: string;
  app_user_id?: string;
  original_app_user_id?: string;
  entitlement_ids?: string[] | null;
  aliases?: string[];
  /** TRANSFER only: the ids the purchase moved FROM and TO (no app_user_id). */
  transferred_from?: string[] | null;
  transferred_to?: string[] | null;
  /** 'PRODUCTION' | 'SANDBOX' — logged only; both are decided the same way. */
  environment?: string;
}

/** The subscriptions row as the writer reads it before deciding. */
interface ExistingRow {
  tier: Tier | null;
  /** A plan MAGE ID turned on by hand (migration 20260923010000). Never written below. */
  manual_tier: Tier | null;
}

type WriteDecision =
  | { writes: { uid: string; tier: Tier }[] }
  | { retry: true; reason: string }
  | { ignore: string };

/** tier, raised to manual_tier when a hand grant outranks it (#2). */
function floorAtManual(tier: Tier, manual: Tier | null | undefined): Tier {
  return manual && TIER_RANK[manual] > TIER_RANK[tier] ? manual : tier;
}

/** Highest tier named by the event's own entitlement_ids. */
function tierFromEventEntitlements(ev: RCEvent): Tier {
  let best: Tier = "free";
  for (const id of ev.entitlement_ids ?? []) {
    const t = id.toLowerCase() as Tier;
    if (t in TIER_RANK && TIER_RANK[t] > TIER_RANK[best]) best = t;
  }
  return best;
}

// Events that START or EXTEND paid access. Without a RevenueCat re-read their
// own entitlement_ids may RAISE a tier — never lower one.
const GRANTING_EVENTS = new Set([
  "INITIAL_PURCHASE", "RENEWAL", "PRODUCT_CHANGE", "UNCANCELLATION", "NON_RENEWING_PURCHASE",
]);

/**
 * What to write for one webhook event. Pure, so it can be pinned.
 *
 *   ev            — the event body.
 *   authoritative — per app user id, the tier RevenueCat's REST API reports NOW
 *                   (tierFromRevenueCat), null when that read failed or the
 *                   secret key is unset.
 *   existing      — per app user id, the subscriptions row (null: none).
 *
 * Rules (audit wave 5, #2 and #43):
 *  - Nothing is ever written below the row's manual_tier: a plan the founder
 *    turned on by hand is not RevenueCat's to take away.
 *  - With a RevenueCat read, its answer is the tier (floored at manual_tier).
 *  - Without one, the event alone decides only what it can decide safely:
 *      EXPIRATION        → free (access HAS ended), floored at manual_tier;
 *      granting events   → their entitlement_ids, only when that names a paid
 *                          tier (a raise), floored at manual_tier;
 *      everything else   → retry (HTTP 500, RevenueCat retries with backoff).
 *    CANCELLATION and SUBSCRIPTION_PAUSED are sent when auto-renew is turned
 *    OFF, not when access ends; writing 'free' for them (as this function
 *    used to, while its comment claimed "no change") cut a paying customer
 *    off mid-month the moment the RevenueCat lookup hiccuped.
 *  - TRANSFER (a purchase restored onto another account) carries no
 *    app_user_id — it used to be ignored, so the new account stayed Free on
 *    the server while the phone showed Pro and the old account kept the plan
 *    forever. Every id on both sides is re-read from RevenueCat and written;
 *    any failed read → retry, never a guess.
 *  - A SANDBOX event is decided like any other (see the header: the phone
 *    counts sandbox entitlements, so the server must too).
 */
function resolveWrite(
  ev: RCEvent,
  authoritative: Record<string, Tier | null | undefined>,
  existing: Record<string, ExistingRow | null | undefined>,
): WriteDecision {
  const type = (ev.type ?? "").toUpperCase();
  if (type === "TEST") return { ignore: "test" };

  if (type === "TRANSFER") {
    const ids = [...new Set([...(ev.transferred_from ?? []), ...(ev.transferred_to ?? [])].filter(Boolean))];
    if (ids.length === 0) return { ignore: "transfer without ids" };
    const writes: { uid: string; tier: Tier }[] = [];
    for (const uid of ids) {
      const a = authoritative[uid];
      if (a === null || a === undefined) return { retry: true, reason: `no RevenueCat read for ${uid}` };
      writes.push({ uid, tier: floorAtManual(a, existing[uid]?.manual_tier) });
    }
    return { writes };
  }

  const uid = ev.app_user_id || ev.original_app_user_id || "";
  if (!uid) return { ignore: "no app_user_id" };
  const manual = existing[uid]?.manual_tier ?? null;
  const a = authoritative[uid];
  if (a !== null && a !== undefined) return { writes: [{ uid, tier: floorAtManual(a, manual) }] };

  if (type === "EXPIRATION") return { writes: [{ uid, tier: floorAtManual("free", manual) }] };
  if (GRANTING_EVENTS.has(type)) {
    const t = tierFromEventEntitlements(ev);
    if (t !== "free") return { writes: [{ uid, tier: floorAtManual(t, manual) }] };
  }
  return { retry: true, reason: `${type || "event"} with no RevenueCat read` };
}
// --- END resolveWrite ---

/**
 * Ask RevenueCat for the subscriber's CURRENT active entitlements and resolve
 * the highest tier. Returns null if we can't reach RC or the secret key is
 * unset — resolveWrite then decides only what the event alone can decide
 * safely, and asks RevenueCat to retry otherwise. This is authoritative and
 * immune to out-of-order webhook delivery.
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
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status, headers: { ...corsHeaders, "content-type": "application/json" },
    });

  // Settle ignores before any network call (TEST, no id).
  const pre = resolveWrite(ev, {}, {});
  if ("ignore" in pre) return json({ ok: true, ignored: pre.ignore });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Every app user id this event touches: both sides of a TRANSFER, else the one id.
  const ids = type === "TRANSFER"
    ? [...new Set([...(ev.transferred_from ?? []), ...(ev.transferred_to ?? [])].filter(Boolean))]
    : [ev.app_user_id || ev.original_app_user_id || ""];

  // Read RevenueCat (authoritative, immune to out-of-order delivery) and the
  // existing row for each id. select('*') so a missing manual_tier column
  // (migration 20260923010000 not yet applied) reads as null instead of
  // failing the read.
  const authoritative: Record<string, Tier | null> = {};
  const existing: Record<string, ExistingRow | null> = {};
  try {
    for (const id of ids) {
      authoritative[id] = await tierFromRevenueCat(id);
      const q = supabase.from("subscriptions").select("*");
      const { data, error } = UUID_RE.test(id)
        ? await q.eq("user_id", id).maybeSingle()
        : await q.eq("revenuecat_customer_id", id).limit(1).maybeSingle();
      if (error) throw error;
      const row = data as { tier?: Tier | null; manual_tier?: Tier | null } | null;
      existing[id] = row ? { tier: row.tier ?? null, manual_tier: row.manual_tier ?? null } : null;
    }
  } catch (err) {
    console.error("[rc-webhook] row read failed:", String(err));
    return new Response("Read failed", { status: 500, headers: corsHeaders });
  }

  const decision = resolveWrite(ev, authoritative, existing);
  if ("ignore" in decision) return json({ ok: true, ignored: decision.ignore });
  if ("retry" in decision) {
    // 500 so RevenueCat retries with backoff. Writing a guess here is how a
    // cancelled-but-paid customer lost his plan mid-month (#43).
    console.warn(`[rc-webhook] ${type}: ${decision.reason} — asking RevenueCat to retry`);
    return new Response("Tier unknown — retry", { status: 500, headers: corsHeaders });
  }

  // Map app_user_id → subscriptions row. Preferred: it's the Supabase user uuid.
  // Fallback: an anonymous RC id we previously stored as revenuecat_customer_id.
  try {
    for (const { uid, tier } of decision.writes) {
      if (UUID_RE.test(uid)) {
        const { error } = await supabase
          .from("subscriptions")
          .upsert(
            {
              user_id: uid,
              tier,
              revenuecat_customer_id: uid,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" },
          );
        if (error) throw error;
      } else {
        // Anonymous RC id — can only update existing linked rows, each floored
        // at its OWN manual_tier (the table's trigger floors it as well).
        const { data: rows, error: readErr } = await supabase
          .from("subscriptions")
          .select("*")
          .eq("revenuecat_customer_id", uid);
        if (readErr) throw readErr;
        if (!rows?.length) {
          console.warn(`[rc-webhook] no subscriptions row for anonymous app_user_id=${uid}`);
          continue;
        }
        for (const r of rows as { user_id: string; manual_tier?: Tier | null }[]) {
          const { error } = await supabase
            .from("subscriptions")
            .update({ tier: floorAtManual(tier, r.manual_tier), updated_at: new Date().toISOString() })
            .eq("user_id", r.user_id);
          if (error) throw error;
        }
      }
    }
  } catch (err) {
    console.error("[rc-webhook] tier write failed:", String(err));
    // 500 so RevenueCat retries — a dropped grant must not be silently lost.
    return new Response("Write failed", { status: 500, headers: corsHeaders });
  }

  const summary = decision.writes.map((w) => `${w.uid}=${w.tier}`).join(", ");
  console.log(`[rc-webhook] ${type} → ${summary} (authoritative=${ids.every((id) => authoritative[id] !== null)})`);
  return json({ ok: true, writes: decision.writes });
});
