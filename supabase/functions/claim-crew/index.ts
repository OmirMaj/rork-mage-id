// claim-crew
//
// Worker redeems a single-use claim token to take ownership of the CrewMember
// profile a GC created for them.
//
// WHY A SERVER FUNCTION (not a client mutation): the claiming worker is a
// DIFFERENT auth user than the GC who owns the row. The crew_members RLS only
// exposes a row to the owning GC (auth.uid() = user_id) or to the ALREADY
// claimed worker (auth.uid() = claimed_by_user_id). An UNCLAIMED row
// (claimed_by_user_id IS NULL) is therefore invisible AND un-writable to the
// claiming worker under their own JWT — a client-side `select().find()` +
// `update()` can never see or mutate it. This function performs the redemption
// with the SERVICE ROLE: it looks the row up by claim_token, verifies it is
// unclaimed, and stamps claimed_by_user_id = <the verified caller>. After that
// the row satisfies `auth.uid() = claimed_by_user_id` and the worker's app can
// read and self-edit it through normal RLS.
//
// AUTH: not tier-gated (the onboarded worker is typically a free user), but we
// CRYPTOGRAPHICALLY verify the caller (verifyUser → GoTrue) so a redemption is
// always attributed to a real, signed-in identity — never an anon/forged token.
//
// SINGLE-USE + RACE-SAFE: the PATCH is conditioned on claimed_by_user_id IS
// NULL, so two concurrent redemptions cannot both win. The winning PATCH also
// NULLs claim_token, so the token is BURNED on redemption — it can never be
// re-redeemed even if claimed_by_user_id is later reset (e.g. the claimer's
// auth.users row is deleted → FK ON DELETE SET NULL). A burned token no longer
// matches the lookup, so a replay returns the generic 'invalid' path rather
// than re-claiming a row that may still carry the first worker's gov-ID-derived
// fields. A token still claimed by someone else is rejected. The image /
// masked-ID fields are never returned — the response carries only
// { success, memberId } so nothing sensitive leaks to a caller who merely
// holds a token.
//
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY

import { verifyUser } from '../_shared/verifyUser.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || '';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

/** Same shape as utils/crew/claimToken.isValidClaimTokenFormat — keep in sync. */
function isValidClaimTokenFormat(token: string): boolean {
  return /^crew_[0-9a-f-]{20,}$/i.test(token);
}

const SERVICE_HEADERS = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'POST only' }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return jsonResponse({ success: false, error: 'Server not configured.' }, 500);
  }

  // Caller must be a genuine, signed-in user (magic-link session established by
  // MagicLinkHandler before app/claim-crew.tsx invokes this).
  const user = await verifyUser(req);
  if (!user || !user.id || user.role !== 'authenticated') {
    return jsonResponse(
      { success: false, error: 'Sign in is required to claim your profile.', code: 'unauthenticated' },
      401,
    );
  }

  let body: { token?: string };
  try { body = await req.json(); } catch { return jsonResponse({ success: false, error: 'Invalid JSON' }, 400); }

  const token = (body.token ?? '').trim();
  if (!isValidClaimTokenFormat(token)) {
    return jsonResponse({ success: false, error: 'This invite link is invalid.', code: 'invalid_token' }, 400);
  }

  // Look up the row by claim_token under the SERVICE ROLE (bypasses RLS).
  let lookup: { id: string; claimed_by_user_id: string | null }[];
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/crew_members?claim_token=eq.${encodeURIComponent(token)}&select=id,claimed_by_user_id&limit=1`,
      { headers: SERVICE_HEADERS },
    );
    if (!r.ok) return jsonResponse({ success: false, error: 'Could not verify the invite.' }, 502);
    lookup = await r.json() as { id: string; claimed_by_user_id: string | null }[];
  } catch {
    return jsonResponse({ success: false, error: 'Could not verify the invite.' }, 502);
  }

  const row = lookup[0];
  if (!row) {
    return jsonResponse({ success: false, error: 'This invite link is invalid.', code: 'invalid_token' }, 404);
  }

  // Already claimed by someone else → single-use spent. Same user → idempotent.
  if (row.claimed_by_user_id) {
    if (row.claimed_by_user_id === user.id) {
      return jsonResponse({ success: true, memberId: row.id, alreadyClaimed: true });
    }
    return jsonResponse(
      { success: false, error: 'This invite link has already been used.', code: 'already_claimed' },
      409,
    );
  }

  // Race-safe stamp: only apply if STILL unclaimed. return=representation lets us
  // detect the lost-race case (another redemption won between lookup and update),
  // in which the filtered PATCH updates zero rows and returns [].
  let updated: { id: string }[];
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/crew_members?id=eq.${row.id}&claimed_by_user_id=is.null`,
      {
        method: 'PATCH',
        headers: { ...SERVICE_HEADERS, Prefer: 'return=representation' },
        body: JSON.stringify({
          claimed_by_user_id: user.id,
          claimed_at: new Date().toISOString(),
          // Burn the token on redemption. A spent token must never be
          // re-redeemable, even if claimed_by_user_id is later reset (e.g. the
          // claimer's auth.users row is deleted → FK resets it to NULL). Without
          // this, the original invite link would redeem again against a row that
          // may still carry the first worker's gov-ID-derived fields.
          claim_token: null,
        }),
      },
    );
    if (!r.ok) return jsonResponse({ success: false, error: 'Could not claim the profile.' }, 502);
    updated = await r.json() as { id: string }[];
  } catch {
    return jsonResponse({ success: false, error: 'Could not claim the profile.' }, 502);
  }

  if (!updated.length) {
    // Lost the race — claimed by another user in the interim.
    return jsonResponse(
      { success: false, error: 'This invite link has already been used.', code: 'already_claimed' },
      409,
    );
  }

  console.log(`[claim-crew] member ${row.id} claimed by ${user.id}`);
  return jsonResponse({ success: true, memberId: row.id });
});
