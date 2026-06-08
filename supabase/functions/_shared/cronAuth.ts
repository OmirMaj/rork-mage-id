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

import { verifyUser } from "./verifyUser.ts";

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
 * True when the request carries a genuine, unexpired authenticated user JWT.
 *
 * These functions deploy verify_jwt:false, so the gateway does NOT verify the
 * token signature — a bare claims decode would accept a forged
 * `role:'authenticated'` token and let anyone trigger the dual-path (in-app)
 * branch (e.g. mass digest emails). We therefore VERIFY the token against
 * GoTrue (_shared/verifyUser) instead of trusting its claims. Async as a result.
 */
export async function hasAuthenticatedUser(req: Request): Promise<boolean> {
  return (await verifyUser(req)) !== null;
}
