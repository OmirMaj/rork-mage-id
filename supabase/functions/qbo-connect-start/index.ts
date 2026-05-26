// supabase/functions/qbo-connect-start/index.ts
//
// OAuth entry point for QuickBooks Online 2-way sync.
//
// Called by the MAGE app (authenticated). Returns the Intuit authorize URL
// with a signed HMAC state token. The app opens it in expo-web-browser;
// the user logs into Intuit; Intuit redirects to the MAGE callback URL.
//
// Requires: business or enterprise tier.
//
// Request: POST (no body required — caller identity comes from JWT)
// Response:
//   { success: true,  authorizeUrl: string }
//   { success: false, error: string }

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { requireTier } from "../_shared/auth.ts";
import { signState } from "../_shared/qbo.ts";

const CLIENT_ID    = Deno.env.get("INTUIT_CLIENT_ID") || "";
const REDIRECT_URI = Deno.env.get("INTUIT_REDIRECT_URI") || "https://app.mageid.app/integrations/qbo/callback";
const AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST")   return json({ success: false, error: "Method not allowed" }, 405);

  const auth = await requireTier(req, ["business", "enterprise"], "qbo_connect");
  if (!auth.ok) return json(auth.body, auth.status);

  if (!CLIENT_ID) return json({ success: false, error: "INTUIT_CLIENT_ID not configured." }, 500);

  const state = await signState(auth.userId);

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id",      CLIENT_ID);
  url.searchParams.set("response_type",  "code");
  url.searchParams.set("scope",          "com.intuit.quickbooks.accounting openid profile email");
  url.searchParams.set("redirect_uri",   REDIRECT_URI);
  url.searchParams.set("state",          state);

  return json({ success: true, authorizeUrl: url.toString() });
});
