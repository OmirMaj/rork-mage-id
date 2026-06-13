// mcp-token — issue / list / revoke the personal access tokens that connect
// Claude (or any MCP client) to a user's MAGE ID data via the `mcp` server.
//
// Auth: the app calls this with the signed-in user's Supabase JWT as the
// Bearer token (plus the anon apikey). This function deploys verify_jwt:false,
// so the gateway does NOT verify the token before we run — we must verify it
// ourselves. We do that via _shared/verifyUser (GoTrue /auth/v1/user), NOT a
// bare claims decode: minting an MCP token bound to a forge-able `sub` would
// let anyone exfiltrate any victim's data. All DB writes use the service role
// so the raw token hash never touches the client.
//
// Body: { action: "create" | "list" | "revoke", name?, id? }
//   create -> returns { token } ONCE (raw value, unrecoverable after this)
//   list   -> returns { tokens: [{ id, name, prefix, created_at, last_used_at, revoked_at }] }
//   revoke -> sets revoked_at on the user's token by id

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { generateMcpToken, hashMcpToken, tokenPrefix } from "../_shared/mcpToken.ts";
import { verifyUser } from "../_shared/verifyUser.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";

const H: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...H, "Content-Type": "application/json" } });
}

function svcHeaders(extra: Record<string, string> = {}) {
  return { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, ...extra };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: H });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Identify the caller by VERIFYING their Supabase session JWT against GoTrue
  // (signature + expiry + user state). A bare claims decode would be forgeable
  // and this endpoint mints data-access tokens — verification is mandatory.
  const user = await verifyUser(req);
  if (!user) {
    return json({ error: "Sign in is required." }, 401);
  }
  const userId = user.id;

  let body: { action?: string; name?: string; id?: string } = {};
  try { body = await req.json(); } catch { /* empty body ok for list */ }
  const action = body.action || "list";

  try {
    if (action === "create") {
      const raw = generateMcpToken();
      const row = {
        user_id: userId,
        token_hash: await hashMcpToken(raw),
        token_prefix: tokenPrefix(raw),
        name: (body.name || "").slice(0, 80) || "Claude",
      };
      const r = await fetch(`${SUPABASE_URL}/rest/v1/mcp_tokens`, {
        method: "POST",
        headers: svcHeaders({ "Content-Type": "application/json", Prefer: "return=representation" }),
        body: JSON.stringify(row),
      });
      if (!r.ok) return json({ error: `Could not create token (${r.status}).` }, 500);
      const created = (await r.json())[0];
      // Return the raw token exactly once — it is unrecoverable after this.
      return json({ token: raw, id: created.id, prefix: created.token_prefix, name: created.name });
    }

    if (action === "revoke") {
      if (!body.id) return json({ error: "Missing token id." }, 400);
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/mcp_tokens?id=eq.${encodeURIComponent(body.id)}&user_id=eq.${encodeURIComponent(userId)}`,
        {
          method: "PATCH",
          headers: svcHeaders({ "Content-Type": "application/json", Prefer: "return=minimal" }),
          body: JSON.stringify({ revoked_at: new Date().toISOString() }),
        },
      );
      if (!r.ok) return json({ error: `Could not revoke (${r.status}).` }, 500);
      return json({ ok: true });
    }

    // default: list (never returns token_hash)
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/mcp_tokens?user_id=eq.${userId}&select=id,name,token_prefix,created_at,last_used_at,revoked_at&order=created_at.desc`,
      { headers: svcHeaders() },
    );
    if (!r.ok) return json({ error: `Could not list tokens (${r.status}).` }, 500);
    const tokens = await r.json();
    return json({ tokens });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
