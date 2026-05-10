// qbo-disconnect — remove a QuickBooks Online connection.
//
// We delete the row server-side (RLS doesn't allow client deletes
// on quickbooks_connections; that would require granting a write
// policy, which would then also let a malicious client overwrite
// tokens). Best-effort revoke against Intuit's revoke endpoint to
// invalidate the refresh token on their side too.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { requireTier } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
const QBO_CLIENT_ID = Deno.env.get("QBO_CLIENT_ID") || "";
const QBO_CLIENT_SECRET = Deno.env.get("QBO_CLIENT_SECRET") || "";

const REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";

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

async function getRefreshToken(connectionId: string, userId: string): Promise<string | null> {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/quickbooks_connections?id=eq.${connectionId}&user_id=eq.${userId}&select=refresh_token`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  );
  if (!r.ok) return null;
  const rows = await r.json() as { refresh_token: string }[];
  return rows[0]?.refresh_token ?? null;
}

async function deleteConnection(connectionId: string, userId: string): Promise<boolean> {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/quickbooks_connections?id=eq.${connectionId}&user_id=eq.${userId}`,
    {
      method: "DELETE",
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
    },
  );
  return r.ok;
}

async function revokeOnIntuit(refreshToken: string): Promise<void> {
  if (!QBO_CLIENT_ID || !QBO_CLIENT_SECRET) return;
  try {
    const basic = btoa(`${QBO_CLIENT_ID}:${QBO_CLIENT_SECRET}`);
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${basic}`,
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token: refreshToken }),
    });
  } catch (err) {
    console.log("[qbo-disconnect] intuit revoke failed (non-fatal)", err);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return jsonResponse({ success: false, error: "Method not allowed" }, 405);

  const auth = await requireTier(req, ['free', 'pro', 'business', 'enterprise'], 'qbo_disconnect');
  if (!auth.ok) return jsonResponse(auth.body, auth.status);

  let body: { connectionId?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ success: false, error: "Invalid JSON body" }, 400);
  }
  if (!body.connectionId) {
    return jsonResponse({ success: false, error: "connectionId is required" }, 400);
  }

  // Fetch refresh token first so we can revoke it after deletion.
  const refreshToken = await getRefreshToken(body.connectionId, auth.userId);
  const ok = await deleteConnection(body.connectionId, auth.userId);
  if (!ok) {
    return jsonResponse({ success: false, error: "Could not delete connection (not yours, or already gone)." }, 404);
  }

  // Best-effort Intuit-side revoke. If this fails the connection
  // is still gone from our DB; the user just has to remove our app
  // from intuit.com manually if they want a full revoke.
  if (refreshToken) {
    await revokeOnIntuit(refreshToken);
  }

  return jsonResponse({ success: true });
});
