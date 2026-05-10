// qbo-oauth-callback — second leg of the QuickBooks Online OAuth.
//
// Intuit redirects the user's browser to QBO_REDIRECT_URI with
//   ?code=<auth_code>&state=<our_state>&realmId=<qbo_company_id>
//
// The redirect URI points at THIS function (or at a thin web page
// that POSTs the params here). We:
//   1. Validate the `state` against the row we wrote in
//      qbo-oauth-start. Reject if missing, expired, or already used.
//   2. Exchange the auth code for access + refresh tokens via
//      Intuit's token endpoint. Requires our client_secret —
//      never exposed to the client.
//   3. Fetch CompanyInfo to get the GC's QBO company name (just for
//      display).
//   4. Upsert into quickbooks_connections keyed on (user_id,
//      realm_id). Re-authorizing the same company replaces tokens.
//   5. Delete the consumed state row so it can't be replayed.
//
// Returns either a JSON response (when called via fetch) or a
// browser-friendly HTML redirect (when called via direct browser
// navigation from Intuit's redirect). The User-Agent sniff at the
// top routes between modes.
//
// Secrets required:
//   QBO_CLIENT_ID
//   QBO_CLIENT_SECRET    — keep server-side only
//   QBO_REDIRECT_URI     — must match what oauth-start used
//   QBO_ENVIRONMENT      — 'sandbox' or 'production'
//   APP_DEEP_LINK_URL    — e.g. mageid://qbo-callback or
//                          https://mageid.app/qbo/connected
//                          where the browser bounces back to the
//                          mobile app on success

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
const QBO_CLIENT_ID = Deno.env.get("QBO_CLIENT_ID") || "";
const QBO_CLIENT_SECRET = Deno.env.get("QBO_CLIENT_SECRET") || "";
const QBO_REDIRECT_URI = Deno.env.get("QBO_REDIRECT_URI") || "";
const QBO_ENV = (Deno.env.get("QBO_ENVIRONMENT") || "production").toLowerCase();
const APP_DEEP_LINK_URL = Deno.env.get("APP_DEEP_LINK_URL") || "rork-app://qbo-connected";

const QBO_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const QBO_API_HOST = QBO_ENV === "sandbox"
  ? "sandbox-quickbooks.api.intuit.com"
  : "quickbooks.api.intuit.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

/** Browser-friendly bounce-to-app HTML page. Used when Intuit
 *  redirects via direct GET (the standard case). The page tries to
 *  open the app's deep link; if that fails (user is on desktop),
 *  it shows a "Return to MAGE ID" button. */
function bounceHtml(deepLink: string, success: boolean, message: string): Response {
  const html = `<!doctype html>
<html><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${success ? 'Connected!' : 'Connection failed'}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #F8FAFB; color: #1F2225; padding: 40px 24px; max-width: 460px; margin: 0 auto; }
    .card { background: #fff; border-radius: 16px; padding: 28px; box-shadow: 0 4px 24px rgba(0,0,0,0.06); text-align: center; }
    h1 { font-size: 24px; margin: 8px 0 4px; letter-spacing: -0.5px; }
    p { color: #677078; line-height: 1.5; }
    .btn { display: inline-block; margin-top: 16px; padding: 12px 24px; border-radius: 999px; background: #1A6B3C; color: white; text-decoration: none; font-weight: 700; }
    .icon { font-size: 48px; }
  </style>
</head><body>
  <div class="card">
    <div class="icon">${success ? '✅' : '⚠️'}</div>
    <h1>${success ? 'QuickBooks Connected' : 'Connection failed'}</h1>
    <p>${message}</p>
    <a class="btn" href="${deepLink}">Return to MAGE ID</a>
  </div>
  <script>setTimeout(function(){ window.location.href = ${JSON.stringify(deepLink)}; }, 600);</script>
</body></html>`;
  return new Response(html, {
    status: success ? 200 : 400,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

interface IntuitTokenResp {
  access_token: string;
  refresh_token: string;
  expires_in: number;            // seconds
  x_refresh_token_expires_in: number;
  token_type: string;
  scope?: string;
}

async function exchangeCode(code: string): Promise<IntuitTokenResp> {
  const basic = btoa(`${QBO_CLIENT_ID}:${QBO_CLIENT_SECRET}`);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: QBO_REDIRECT_URI,
  });
  const r = await fetch(QBO_TOKEN_URL, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basic}`,
      "Accept": "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Token exchange ${r.status}: ${txt.slice(0, 200)}`);
  }
  return await r.json() as IntuitTokenResp;
}

async function fetchCompanyName(realmId: string, accessToken: string): Promise<string | null> {
  try {
    const r = await fetch(
      `https://${QBO_API_HOST}/v3/company/${realmId}/companyinfo/${realmId}?minorversion=70`,
      {
        headers: {
          "Accept": "application/json",
          "Authorization": `Bearer ${accessToken}`,
        },
      },
    );
    if (!r.ok) return null;
    const data = await r.json();
    return data?.CompanyInfo?.CompanyName ?? null;
  } catch {
    return null;
  }
}

async function consumeState(state: string): Promise<{ userId: string; redirectTo: string | null } | null> {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/quickbooks_oauth_state?state=eq.${encodeURIComponent(state)}&select=user_id,redirect_to,expires_at`,
    {
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
    },
  );
  if (!r.ok) return null;
  const rows = await r.json() as { user_id: string; redirect_to: string | null; expires_at: string }[];
  if (rows.length === 0) return null;
  const row = rows[0];
  if (Date.parse(row.expires_at) < Date.now()) return null;

  // Delete so this state can't be replayed.
  await fetch(`${SUPABASE_URL}/rest/v1/quickbooks_oauth_state?state=eq.${encodeURIComponent(state)}`, {
    method: "DELETE",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
  });

  return { userId: row.user_id, redirectTo: row.redirect_to };
}

async function upsertConnection(opts: {
  userId: string;
  realmId: string;
  tokens: IntuitTokenResp;
  companyName: string | null;
}): Promise<void> {
  const accessExp = new Date(Date.now() + opts.tokens.expires_in * 1000).toISOString();
  const refreshExp = opts.tokens.x_refresh_token_expires_in
    ? new Date(Date.now() + opts.tokens.x_refresh_token_expires_in * 1000).toISOString()
    : null;
  const row = {
    user_id: opts.userId,
    realm_id: opts.realmId,
    access_token: opts.tokens.access_token,
    access_token_expires_at: accessExp,
    refresh_token: opts.tokens.refresh_token,
    refresh_token_expires_at: refreshExp,
    scope: opts.tokens.scope ?? null,
    environment: QBO_ENV === "sandbox" ? "sandbox" : "production",
    company_name: opts.companyName,
    last_used_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const r = await fetch(`${SUPABASE_URL}/rest/v1/quickbooks_connections?on_conflict=user_id,realm_id`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(row),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Connection upsert ${r.status}: ${txt.slice(0, 200)}`);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // Pull params from query (GET — Intuit's standard redirect) OR
  // body (POST — used by web wrappers / tests).
  let code: string | null = null;
  let state: string | null = null;
  let realmId: string | null = null;
  let intuitError: string | null = null;

  if (req.method === "GET") {
    const url = new URL(req.url);
    code = url.searchParams.get("code");
    state = url.searchParams.get("state");
    realmId = url.searchParams.get("realmId");
    intuitError = url.searchParams.get("error");
  } else if (req.method === "POST") {
    try {
      const body = await req.json();
      code = body.code ?? null;
      state = body.state ?? null;
      realmId = body.realmId ?? null;
    } catch { /* invalid body — fall through to error path */ }
  } else {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  // Did Intuit reject the consent? Pop the user back to the app
  // with a friendly explanation; they can retry.
  if (intuitError) {
    return bounceHtml(APP_DEEP_LINK_URL + "?error=" + encodeURIComponent(intuitError), false,
      `Intuit reported: ${intuitError}. You can try again from Settings → Integrations.`);
  }

  if (!code || !state || !realmId) {
    return bounceHtml(APP_DEEP_LINK_URL + "?error=missing_params", false,
      "The redirect from QuickBooks was incomplete. Try the connect button again.");
  }
  if (!QBO_CLIENT_ID || !QBO_CLIENT_SECRET || !QBO_REDIRECT_URI) {
    return bounceHtml(APP_DEEP_LINK_URL + "?error=server_misconfigured", false,
      "Server isn't configured for QuickBooks yet. Contact support.");
  }

  // Validate state.
  const stateRow = await consumeState(state);
  if (!stateRow) {
    return bounceHtml(APP_DEEP_LINK_URL + "?error=invalid_state", false,
      "This connect attempt expired. Tap Connect again to start over.");
  }

  // Exchange the auth code.
  let tokens: IntuitTokenResp;
  try {
    tokens = await exchangeCode(code);
  } catch (err) {
    console.error("[qbo-oauth-callback] exchange failed", err);
    return bounceHtml(APP_DEEP_LINK_URL + "?error=token_exchange", false,
      "Couldn't exchange the QuickBooks code for an access token. Try again.");
  }

  // Best-effort fetch the company name. Failure is non-fatal.
  const companyName = await fetchCompanyName(realmId, tokens.access_token);

  // Persist.
  try {
    await upsertConnection({
      userId: stateRow.userId,
      realmId,
      tokens,
      companyName,
    });
  } catch (err) {
    console.error("[qbo-oauth-callback] upsert failed", err);
    return bounceHtml(APP_DEEP_LINK_URL + "?error=persist_failed", false,
      "Got the tokens but couldn't save them. Contact support.");
  }

  return bounceHtml(
    `${APP_DEEP_LINK_URL}?status=connected&realmId=${encodeURIComponent(realmId)}`,
    true,
    `Connected to ${companyName ?? "your QuickBooks company"}. Returning you to MAGE ID…`,
  );
});
