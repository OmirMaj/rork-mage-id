// _shared/auth.ts — JWT decode + subscription-tier lookup for edge funcs.
//
// Audit found that every AI / cost-bearing edge function (analyze-drawings,
// analyze-photos, convert-pdf-to-images) was effectively public — anyone
// with the URL could curl them and burn Gemini/storage costs without ever
// owning a paid subscription. The tier gate lived in UI only.
//
// This module is the SERVER-SIDE twin of `useTierAccess.ts`. Every paid
// edge function should call `requireTier(req, ['pro','business'], 'feature')`
// once at the top of its handler. Returns the authenticated user_id +
// resolved tier on success, or a 401/403 Response that the caller returns
// directly.
//
// Identity is ALWAYS derived from a CRYPTOGRAPHICALLY VERIFIED user (see
// `verifyUser.ts`, which asks GoTrue `/auth/v1/user` to validate the token's
// signature, expiry, and ban-state). We do NOT trust a bare claims decode:
// a function deployed with verify_jwt:false gets no gateway verification, so
// an attacker could forge `{"role":"authenticated","sub":"<victim>","email":
// "<master>"}` and be trusted for identity, tier, AND the MASTER_EMAILS
// elevation. Verifying server-side closes that hole. The verified user_id +
// email then drive the `subscriptions` tier lookup and any master override.

import { verifyUserToken } from './verifyUser.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || '';

export type Tier = 'free' | 'pro' | 'business' | 'enterprise';

export interface AuthSuccess {
  ok: true;
  userId: string;
  tier: Tier;
  email?: string;
}
export interface AuthFailure {
  ok: false;
  status: number;
  body: { success: false; error: string; code?: string };
}
export type AuthResult = AuthSuccess | AuthFailure;

/**
 * Look up the user's current subscription tier. Reads `subscriptions`
 * (mirrored from RevenueCat by the app) and resolves to one of:
 *   - 'business' if there's an active Business subscription
 *   - 'pro' if there's an active Pro subscription
 *   - 'free' otherwise (no row, or end_date in the past)
 *
 * Always errs on the side of FREE if any check is uncertain. We'd rather
 * deny a paid feature on a glitchy lookup than grant it on a stale row.
 */
async function lookupTier(userId: string): Promise<Tier> {
  if (!userId) return 'free';
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${userId}&select=tier,end_date&order=updated_at.desc&limit=1`,
      {
        headers: {
          apikey: SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        },
      },
    );
    if (!r.ok) return 'free';
    const rows = await r.json() as { tier: string; end_date: string | null }[];
    if (!rows.length) return 'free';
    const row = rows[0];
    // end_date null = ongoing. end_date in past = expired → free.
    if (row.end_date && new Date(row.end_date).getTime() < Date.now()) return 'free';
    // Highest-to-lowest match so a future column value of 'enterprise'
    // resolves before falling through to lower tiers. Adding a tier here
    // requires the matching `Tier` union member above + a MONTHLY_CAPS row.
    if (row.tier === 'enterprise') return 'enterprise';
    if (row.tier === 'business') return 'business';
    if (row.tier === 'pro') return 'pro';
    return 'free';
  } catch {
    return 'free';
  }
}

/**
 * Master-account override list. These emails get Business tier no matter
 * what RevenueCat says — used for the team's own accounts, demo videos,
 * support troubleshooting. Keep in sync with `utils/owner.ts` in the app.
 */
const MASTER_EMAILS = new Set<string>([
  'omirmajeed2000@gmail.com',
  'support@mageid.app',
]);

/**
 * Authenticate the request and verify tier. The required tier set is
 * inclusive — 'business' satisfies a 'pro' requirement.
 *
 * Usage:
 *   const auth = await requireTier(req, ['pro', 'business'], 'analyze_drawings');
 *   if (!auth.ok) return jsonResponse(auth.body, auth.status);
 *   // …auth.userId, auth.tier are guaranteed
 */
export async function requireTier(
  req: Request,
  allowed: Tier[],
  _featureName: string,
): Promise<AuthResult> {
  const auth = req.headers.get('Authorization') || req.headers.get('authorization') || '';
  const bearer = auth.replace(/^Bearer\s+/i, '').trim();
  const apikey = req.headers.get('apikey') || req.headers.get('Apikey') || '';
  // The app always sends BOTH headers (Bearer = user JWT, apikey = anon key).
  // Sanity: apikey is present + non-trivial. Catches the case where someone
  // forges a JWT without the platform-issued anon key.
  if (!apikey || apikey.length < 20) {
    return {
      ok: false,
      status: 401,
      body: { success: false, error: 'Missing apikey header.', code: 'unauthenticated' },
    };
  }
  // CRYPTOGRAPHICALLY verify the caller's JWT via GoTrue. This validates the
  // signature, expiry, and ban-state and returns the AUTHORITATIVE user —
  // never a forgeable claims decode. A forged/expired/anon/service token
  // yields null here and is rejected. Identity, email (→ master override),
  // and the tier lookup all flow from THIS verified user.
  const verified = await verifyUserToken(bearer);
  if (!verified || !verified.id || verified.role !== 'authenticated') {
    return {
      ok: false,
      status: 401,
      body: {
        success: false,
        error: 'Sign in is required for this feature.',
        code: 'unauthenticated',
      },
    };
  }

  const userId = verified.id;
  const email = verified.email;
  const tier: Tier = email && MASTER_EMAILS.has(email.toLowerCase())
    ? 'business'
    : await lookupTier(userId);

  // Tier rank — higher always satisfies a lower requirement. We compare
  // against the MINIMUM rank in `allowed`, so callsites passing
  // ['pro','business'] mean "pro or higher" — which makes enterprise
  // (and any future tier above business) automatically pass without
  // touching every callsite. Pre-fix this was an exact-match
  // `allowed.includes(tier)` and a brand-new enterprise subscriber
  // got 403'd on every vision feature because no callsite listed
  // 'enterprise' explicitly.
  const RANK: Record<Tier, number> = { free: 0, pro: 1, business: 2, enterprise: 3 };
  const minRequiredRank = Math.min(...allowed.map((t) => RANK[t]));
  if (RANK[tier] < minRequiredRank) {
    return {
      ok: false,
      status: 403,
      body: {
        success: false,
        error: `This feature requires ${allowed.join(' or ')} or higher. You're currently on ${tier}.`,
        code: 'tier_required',
      },
    };
  }
  return { ok: true, userId, tier, email };
}

/**
 * Atomic monthly usage increment for a (user, feature) pair. Returns
 * the post-increment count for the current calendar month. Caller
 * compares against their cap and decides whether to deny.
 *
 * `amount` defaults to 1 for back-compat with existing call sites
 * (ai_text, analyze_drawings, analyze_photos all charge per-call).
 * Page-metered features (takeoff_pages, convert_pdf) pass the actual
 * page count so a 100-page hospital set burns 100 of the user's
 * monthly quota — fair, predictable, abuse-resistant.
 *
 * Backed by `ai_usage_increment(uuid, text, integer)` SQL function
 * (see migrations/add_ai_usage_page_metering.sql).
 */
export async function aiUsageIncrement(userId: string, feature: string, amount = 1): Promise<number> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/ai_usage_increment`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_user_id: userId, p_feature: feature, p_amount: Math.max(1, amount) }),
    });
    if (!r.ok) return 0; // fail-open on infra glitch — better than blocking paid users
    const v = await r.json();
    return typeof v === 'number' ? v : 0;
  } catch {
    return 0;
  }
}

/**
 * Read the current monthly count for a (user, feature) pair WITHOUT
 * incrementing. Used by the new page-quota precheck — we read `used`,
 * read `cap` from MONTHLY_CAPS, compare `used + pageCount <= cap`, and
 * fail BEFORE running the expensive Cloudconvert / Gemini job if the
 * upload doesn't fit. Pre-fix the only way to know your usage was to
 * try and fail; now we surface the math up front.
 *
 * Backed by `ai_usage_get(uuid, text)` SQL function.
 */
export async function aiUsageGet(userId: string, feature: string): Promise<number> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/ai_usage_get`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_user_id: userId, p_feature: feature }),
    });
    if (!r.ok) return 0;
    const v = await r.json();
    return typeof v === 'number' ? v : 0;
  } catch {
    return 0;
  }
}

/**
 * Per-tier monthly caps for the heavy AI features.
 *
 * `takeoff_pages` is metered PER PAGE (the dominant cost driver — Gemini
 * Vision tokenizes each rendered PNG, Cloudconvert charges per page
 * rendered). A user uploading a 30-page residential set burns 30 of
 * their monthly pages; a 200-page hospital set burns 200. Pre-fix this
 * was metered as `convert_pdf` PER CALL — same 1 unit for kitchen and
 * hospital, which both undercharged power users and overcharged small
 * jobs. Page metering is fairer, more predictable, and abuse-resistant.
 *
 * Numbers tuned for ≥80% gross margin at the worst case (cap maxed out
 * on the priciest model in each tier):
 *   Pro: 30 pages × Gemini Flash ($0.013/pg)   = $0.39 / $29  = 98.7%
 *   Business: 100 × Gemini Pro ($0.017/pg)     = $1.70 / $79  = 97.8%
 *   Enterprise: 300 × Sonnet 4.6 ($0.04/pg)    = $12   / $150 = 92.0%
 *
 * Other features (analyze_drawings, analyze_photos, ai_text) keep
 * their per-call metering — those don't scale with PDF page count.
 *
 * Free is 0 (gate denies before increment). Real users won't hit the
 * caps; a runaway script will.
 */
export const MONTHLY_CAPS: Record<Tier, Record<string, number>> = {
  free: {
    analyze_drawings: 0,
    analyze_photos: 0,
    convert_pdf: 0,
    takeoff_pages: 0,
    // Text AI monthly cap = daily × 30. Keeps the math aligned with
    // utils/aiRateLimiter.ts LIMITS while giving us a non-bypassable
    // server-side ceiling. AsyncStorage on-device can be wiped by a
    // determined user; this stops the abuse.
    ai_text: 150,
    plan_code_review: 0,
    safety_ai: 0,
    scan_credential: 0,
  },
  pro: {
    analyze_drawings: 15,
    analyze_photos: 50,
    convert_pdf: 50,       // legacy per-call counter, kept for back-compat
    takeoff_pages: 30,     // NEW — page-metered takeoff quota
    ai_text: 900,
    plan_code_review: 10,
    safety_ai: 0,
    scan_credential: 20,
  },
  business: {
    analyze_drawings: 50,
    analyze_photos: 150,
    convert_pdf: 150,
    takeoff_pages: 100,
    ai_text: 2400,
    plan_code_review: 30,
    safety_ai: 900,
    scan_credential: 60,
  },
  enterprise: {
    analyze_drawings: 100,
    analyze_photos: 200,
    convert_pdf: 300,
    takeoff_pages: 300,
    ai_text: 4500,
    plan_code_review: 60,
    safety_ai: 1800,
    scan_credential: 150,
  },
};
