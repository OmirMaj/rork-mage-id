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
// We trust the JWT signature (Supabase gateway already verified it before
// the function even runs, when verify_jwt:true is on). We do NOT re-verify
// crypto here — that'd require sharing the JWT secret with edge functions,
// which the platform doesn't expose. We DO inspect the role + sub claims
// to identify the user, then look up their tier in the `subscriptions`
// table.

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

interface JwtPayload {
  sub?: string;
  role?: string;
  email?: string;
  exp?: number;
}

/** Decode a JWT payload without verifying signature. */
function decodeJwtPayload(token: string): JwtPayload | null {
  if (!token || token.length < 20) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const payload = JSON.parse(atob(b64));
    return payload as JwtPayload;
  } catch {
    return null;
  }
}

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
  // Caller must have a real user JWT (role 'authenticated') — anon-only
  // calls are rejected.
  const payload = decodeJwtPayload(bearer);
  if (!payload || payload.role !== 'authenticated' || !payload.sub) {
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
  // Sanity: apikey is present + non-trivial. Catches the case where someone
  // forges a JWT without the platform-issued anon key.
  if (!apikey || apikey.length < 20) {
    return {
      ok: false,
      status: 401,
      body: { success: false, error: 'Missing apikey header.', code: 'unauthenticated' },
    };
  }
  // Expiry check (Supabase gateway already does this when verify_jwt is
  // on, but for the few functions deployed with verify_jwt:false we do
  // it here too).
  if (payload.exp && payload.exp * 1000 < Date.now()) {
    return {
      ok: false,
      status: 401,
      body: { success: false, error: 'Session expired. Sign in again.', code: 'token_expired' },
    };
  }

  const userId = payload.sub;
  const email = payload.email;
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
 * Backed by `ai_usage_increment` SQL function (see migration).
 */
export async function aiUsageIncrement(userId: string, feature: string): Promise<number> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/ai_usage_increment`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_user_id: userId, p_feature: feature }),
    });
    if (!r.ok) return 0; // fail-open on infra glitch — better than blocking paid users
    const v = await r.json();
    return typeof v === 'number' ? v : 0;
  } catch {
    return 0;
  }
}

/**
 * Per-tier monthly call caps for the heavy AI features (drawing/spec/photo
 * analysis + PDF conversion). Locked to keep ≥50% gross margin even when
 * a user maxes out the cap, given current published prices:
 *   Pro $29/mo, Business $79/mo, Enterprise $150/mo.
 *
 * Free is 0 (gate denies before increment). Real users won't hit the
 * caps; a runaway script will.
 */
export const MONTHLY_CAPS: Record<Tier, Record<string, number>> = {
  free: {
    analyze_drawings: 0,
    analyze_photos: 0,
    convert_pdf: 0,
    // Text AI monthly cap = daily × 30. Keeps the math aligned with
    // utils/aiRateLimiter.ts LIMITS while giving us a non-bypassable
    // server-side ceiling. AsyncStorage on-device can be wiped by a
    // determined user; this stops the abuse.
    ai_text: 150,
  },
  pro: {
    analyze_drawings: 15,
    analyze_photos: 50,
    convert_pdf: 50,
    ai_text: 900,
  },
  business: {
    analyze_drawings: 50,
    analyze_photos: 150,
    convert_pdf: 150,
    ai_text: 2400,
  },
  enterprise: {
    analyze_drawings: 100,
    analyze_photos: 200,
    convert_pdf: 300,
    ai_text: 4500,
  },
};
