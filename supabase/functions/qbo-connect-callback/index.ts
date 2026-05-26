// supabase/functions/qbo-connect-callback/index.ts
//
// OAuth exit point for QuickBooks Online 2-way sync.
//
// This handler is intentionally NOT user-authenticated via JWT. Intuit
// redirects the user's browser back with ?code=...&realmId=...&state=...
// After the app extracts those params from the URL it POSTs them here.
// The only identity proof is the signed HMAC state token produced by
// qbo-connect-start — verifyState() validates the signature and extracts
// the MAGE userId from it. Never use a body-supplied userId.
//
// Flow:
//   1. App POSTs { code, realmId, state, environment? }
//   2. verifyState() validates HMAC + expiry → yields userId.
//   3. Exchange the code for access+refresh tokens at Intuit's token endpoint.
//   4. Best-effort fetch company name from QBO companyinfo.
//   5. saveTokens() upserts into qbo_connections.
//   6. Return { success: true, companyName }.
//
// Secrets required (set via `supabase secrets set`):
//   INTUIT_CLIENT_ID
//   INTUIT_CLIENT_SECRET
//   INTUIT_REDIRECT_URI   (optional — default: https://app.mageid.app/integrations/qbo/callback)
//   INTUIT_STATE_SECRET   (optional — falls back to INTUIT_CLIENT_SECRET)
//   INTUIT_ENVIRONMENT    (optional — 'sandbox' | 'production'; default 'production'.
//                          Set to 'sandbox' when using development keys against a sandbox company.)
//   SUPABASE_URL          (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY (auto-injected)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { verifyState, saveTokens, TOKEN_ENDPOINT, qboApiBase, parseQboError } from "../_shared/qbo.ts";

const CLIENT_ID     = Deno.env.get("INTUIT_CLIENT_ID")     || "";
const CLIENT_SECRET = Deno.env.get("INTUIT_CLIENT_SECRET") || "";
const REDIRECT_URI  = Deno.env.get("INTUIT_REDIRECT_URI")  || "https://app.mageid.app/integrations/qbo/callback";
// Development keys can only authenticate against sandbox companies and must
// hit sandbox-quickbooks.api.intuit.com. Production keys hit the real API.
// The pairing is set once per deployment via INTUIT_ENVIRONMENT.
const DEFAULT_ENV: "sandbox" | "production" =
  (Deno.env.get("INTUIT_ENVIRONMENT") === "sandbox" ? "sandbox" : "production");

// Callback does NOT need auth headers from the app — trust root is the signed state.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

interface CallbackBody {
  code: string;
  realmId: string;
  state: string;
  environment?: "sandbox" | "production";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST")   return json({ success: false, error: "Method not allowed" }, 405);

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return json({ success: false, error: "INTUIT_* not configured" }, 500);
  }

  let body: CallbackBody;
  try {
    body = await req.json() as CallbackBody;
  } catch {
    return json({ success: false, error: "Bad JSON" }, 400);
  }

  if (!body.code || !body.realmId || !body.state) {
    return json({ success: false, error: "Missing code/realmId/state" }, 400);
  }

  // verifyState is the SOLE identity check — it validates HMAC + expiry and
  // returns the userId baked into the token at sign time. Never trust a
  // userId supplied in the POST body.
  const verified = await verifyState(body.state);
  if (!verified) {
    return json({ success: false, error: "Invalid or expired state — start the connection again." }, 401);
  }

  // ── 1. Exchange authorization code for tokens ────────────────────────────
  const basic = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);

  const tokenCtrl  = new AbortController();
  const tokenTimer = setTimeout(() => tokenCtrl.abort(), 15_000);
  let r: Response;
  try {
    r = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${basic}`,
        "Content-Type":  "application/x-www-form-urlencoded",
        "Accept":        "application/json",
      },
      body: `grant_type=authorization_code&code=${encodeURIComponent(body.code)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`,
      signal: tokenCtrl.signal,
    });
  } finally {
    clearTimeout(tokenTimer);
  }

  if (!r.ok) {
    const text = await r.text().catch(() => "");
    return json({ success: false, error: `Intuit token exchange ${r.status}: ${parseQboError(text)}` }, 502);
  }

  const tok = await r.json() as { access_token: string; refresh_token: string; expires_in: number };

  // ── 2. Fetch company name for display (best-effort) ──────────────────────
  let companyName: string | null = null;
  try {
    const base = qboApiBase(body.environment ?? DEFAULT_ENV);

    const infoCtrl  = new AbortController();
    const infoTimer = setTimeout(() => infoCtrl.abort(), 15_000);
    try {
      const info = await fetch(
        `${base}/v3/company/${encodeURIComponent(body.realmId)}/companyinfo/${encodeURIComponent(body.realmId)}`,
        {
          headers: {
            "Authorization": `Bearer ${tok.access_token}`,
            "Accept":        "application/json",
          },
          signal: infoCtrl.signal,
        },
      );
      if (info.ok) {
        const j = await info.json();
        companyName = j?.CompanyInfo?.CompanyName ?? null;
      } else {
        // Non-fatal: realm or scope mismatch surfaces here. Log for ops; user-facing flow still completes.
        console.warn(`[qbo-connect-callback] companyinfo ${info.status} for realm ${body.realmId}`);
      }
    } finally {
      clearTimeout(infoTimer);
    }
  } catch { /* non-fatal — company name is display-only */ }

  // ── 3. Persist tokens ────────────────────────────────────────────────────
  await saveTokens(verified.userId, {
    realm_id:          body.realmId,
    environment:       body.environment ?? DEFAULT_ENV,
    access_token:      tok.access_token,
    refresh_token:     tok.refresh_token,
    access_expires_at: new Date(Date.now() + (tok.expires_in - 30) * 1000).toISOString(),
    company_name:      companyName,
    status:            "connected",
    last_error:        null,
  });

  return json({ success: true, companyName });
});
