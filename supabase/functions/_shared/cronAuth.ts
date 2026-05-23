// _shared/cronAuth.ts — shared secret gate for pg_cron-driven edge functions.
//
// These functions deploy with verify_jwt:false (the cron calls them with no
// user JWT), which left them publicly invocable — anyone with the URL could
// POST and trigger mass emails / data jobs. The cron now sends a 256-bit
// secret in the `x-cron-secret` header (see migration cron_secret_guard);
// `isValidCron` validates it via the SECURITY DEFINER `verify_cron_secret`
// RPC, so the secret value never leaves the database.
//
// Cron-only functions: require isValidCron(req).
// Dual-path functions (also invoked in-app, e.g. morning-digest preview,
// homeowner-weekly-digest recap): accept isValidCron(req) OR a valid
// authenticated user JWT via hasAuthenticatedUser(req).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";

/** True when the request carries the valid pg_cron shared secret. */
export async function isValidCron(req: Request): Promise<boolean> {
  const provided = req.headers.get("x-cron-secret") || "";
  if (provided.length < 16) return false;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/verify_cron_secret`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_secret: provided }),
    });
    if (!r.ok) return false;
    return (await r.json()) === true;
  } catch {
    return false;
  }
}

/**
 * True when the request carries a decodable, unexpired authenticated user JWT.
 * The Supabase gateway already verified the signature for verify_jwt:false
 * functions when a user token is present; we only inspect the claims to
 * distinguish a signed-in app user (role 'authenticated') from anon/cron.
 */
export function hasAuthenticatedUser(req: Request): boolean {
  const auth = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  const bearer = auth.replace(/^Bearer\s+/i, "").trim();
  const parts = bearer.split(".");
  if (parts.length !== 3) return false;
  try {
    let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const p = JSON.parse(atob(b64)) as { role?: string; sub?: string; exp?: number };
    if (p.role !== "authenticated" || !p.sub) return false;
    if (p.exp && p.exp * 1000 < Date.now()) return false;
    return true;
  } catch {
    return false;
  }
}
