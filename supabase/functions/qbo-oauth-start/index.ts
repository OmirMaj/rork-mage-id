// qbo-oauth-start — first leg of the QuickBooks Online OAuth flow.
//
// Client calls this from the Settings → Integrations → Connect
// QuickBooks button. We:
//   1. Generate a random `state` token, persist it with the user_id
//      and a 10-minute expiry. This is the anti-CSRF anchor; the
//      callback function only accepts an auth code paired with a
//      state row that's still alive.
//   2. Compose Intuit's authorize URL with our client_id, the
//      registered redirect URI, the requested scopes, and the
//      state.
//   3. Return { authorizeUrl } to the client. The client opens it
//      via expo-web-browser. After the user signs in to Intuit and
//      grants access, Intuit redirects to the callback URL with
//      ?code=<auth_code>&state=<our_state>&realmId=<qbo_company_id>.
//
// Secrets required:
//   QBO_CLIENT_ID         — from developer.intuit.com → My Apps
//   QBO_REDIRECT_URI      — must EXACTLY match the URL registered
//                           on the Intuit app (e.g.
//                           https://api.mageid.app/qbo-callback or
//                           a deep link mageid://qbo-callback)
//   QBO_ENVIRONMENT       — 'sandbox' or 'production' (default:
//                           production). Sandbox uses sandbox.intuit.com
//                           hostnames during development.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { requireTier } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
const QBO_CLIENT_ID = Deno.env.get("QBO_CLIENT_ID") || "";
const QBO_REDIRECT_URI = Deno.env.get("QBO_REDIRECT_URI") || "";
const QBO_ENV = (Deno.env.get("QBO_ENVIRONMENT") || "production").toLowerCase();

const QBO_AUTHORIZE_BASE = "https://appcenter.intuit.com/connect/oauth2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function randomState(): string {
  // 32 hex chars = 128 bits of entropy. Plenty for an anti-CSRF
  // token bound to user_id.
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function persistState(userId: string, state: string, redirectTo: string | undefined): Promise<void> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/quickbooks_oauth_state`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ state, user_id: userId, redirect_to: redirectTo ?? null }),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`State persist failed (${r.status}): ${txt}`);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return jsonResponse({ success: false, error: "Method not allowed" }, 405);

  if (!QBO_CLIENT_ID || !QBO_REDIRECT_URI) {
    return jsonResponse({
      success: false,
      error: "QBO not configured. Set QBO_CLIENT_ID and QBO_REDIRECT_URI on the function's secrets.",
    }, 500);
  }

  // Auth gate — any signed-in user can connect their own QBO. We
  // intentionally don't tier-gate the OAuth start so users can wire
  // it on free tier and only pay when they actively sync.
  const auth = await requireTier(req, ['free', 'pro', 'business', 'enterprise'], 'qbo_oauth');
  if (!auth.ok) return jsonResponse(auth.body, auth.status);

  let body: { redirectTo?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const state = randomState();
  try {
    await persistState(auth.userId, state, body.redirectTo);
  } catch (err) {
    console.error("[qbo-oauth-start] state persist failed", err);
    return jsonResponse({ success: false, error: "Could not start OAuth flow." }, 500);
  }

  // Scope: accounting is the minimum we need to read invoices and
  // push invoice/customer rows. com.intuit.quickbooks.payment unlocks
  // payment recording; we'll request it later when the sync flow
  // actually uses it. Asking for fewer scopes upfront makes the
  // consent screen smaller and conversion higher.
  const scope = "com.intuit.quickbooks.accounting";
  const url = new URL(QBO_AUTHORIZE_BASE);
  url.searchParams.set("client_id", QBO_CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scope);
  url.searchParams.set("redirect_uri", QBO_REDIRECT_URI);
  url.searchParams.set("state", state);

  return jsonResponse({
    success: true,
    authorizeUrl: url.toString(),
    state,
    environment: QBO_ENV,
  });
});
