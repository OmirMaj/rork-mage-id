// _shared/verifyUser.ts — CRYPTOGRAPHICALLY verify a Supabase user JWT.
//
// Why this exists: several functions deploy with verify_jwt:false (they're
// called by cron, RevenueCat, or want to handle anon callers themselves). For
// those, the Supabase gateway does NOT verify the JWT signature before the
// function runs — so decoding the token's claims (the decodeJwtPayload /
// jwtHasRole pattern) is FORGEABLE: an attacker can craft an unsigned token
// with `{"role":"authenticated","sub":"<victim>"}` and be trusted.
//
// This helper closes that hole without needing the JWT secret or knowing the
// signing algorithm: it asks GoTrue (`/auth/v1/user`) to validate the token.
// A 200 means the signature, expiry, and user existence/ban-state are all good.
// Use this — never a bare claims decode — anywhere a verify_jwt:false function
// makes a trust decision based on the caller's identity.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const ANON_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("ANON_KEY") || "";
const SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";

export interface VerifiedUser {
  id: string;
  email?: string;
  role?: string;
}

function bearerFrom(req: Request): string {
  const auth = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  return auth.replace(/^Bearer\s+/i, "").trim();
}

/**
 * Verify the request's bearer token is a genuine, unexpired Supabase user JWT.
 * Returns the verified user on success, or null (no/forged/expired/anon token).
 * Network call to GoTrue — fail-closed: any error returns null.
 */
export async function verifyUser(req: Request): Promise<VerifiedUser | null> {
  return verifyUserToken(bearerFrom(req));
}

/** Same as verifyUser but for a raw token string. */
export async function verifyUserToken(token: string): Promise<VerifiedUser | null> {
  if (!token || token.length < 20) return null;
  // The service-role key is itself a JWT with role 'service_role'; it is NOT a
  // user token and /auth/v1/user would reject it. Short-circuit so callers that
  // (legitimately) hold the service key don't get mistaken for "no user".
  // Constant-time compare (audit 2026-09-03, EDGE-F14 appendix): `===` bails on
  // the first differing byte and leaks the key prefix through timing.
  // constantTimeEqual is declared below — function declarations hoist.
  if (SERVICE_ROLE_KEY && constantTimeEqual(token, SERVICE_ROLE_KEY)) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: ANON_KEY || SERVICE_ROLE_KEY,
      },
    });
    if (!r.ok) return null;
    const u = await r.json() as { id?: string; email?: string; role?: string; is_anonymous?: boolean };
    if (!u || !u.id) return null;
    // A1 (review 2026-09-04): anonymous GoTrue sessions are not users of this
    // app — production carries 18 stale anonymous sign-ins from spring 2026
    // that would otherwise pass every verifyUser / requireTier gate.
    if (u.is_anonymous === true) return null;
    return { id: u.id, email: u.email, role: u.role };
  } catch {
    return null;
  }
}

/**
 * Constant-time string compare — for matching a presented secret (e.g. the
 * service-role key) against the expected value without leaking length/contents
 * via timing. Returns false on length mismatch (after a dummy pass).
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    let _d = 0;
    for (let i = 0; i < a.length; i++) _d |= a.charCodeAt(i) ^ 0;
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** True when the presented token equals the project's service-role key. */
export function isServiceRoleToken(token: string): boolean {
  return !!token && !!SERVICE_ROLE_KEY && constantTimeEqual(token, SERVICE_ROLE_KEY);
}
