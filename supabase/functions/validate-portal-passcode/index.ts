// validate-portal-passcode
//
// Verifies a client-portal passcode server-side so the static portal HTML
// never has to embed it in the URL fragment. Replaces the old approach
// where buildPortalUrl() base64-encoded the passcode into `#d=...`, which
// was trivially decodable by anyone with the link.
//
// Request body: { portalId: string, passcode: string }
// Response: { ok: true } on match, { ok: false, error: '...' } on miss.
//
// The function uses the service role key (auto-injected by Supabase) to
// look up the project's stored passcode, since RLS on `projects` is scoped
// to authenticated owners — anonymous portal visitors can't read the row
// directly. We never return the actual passcode in the response, only a
// pass/fail. Constant-time comparison resists timing attacks.
//
// Rate limiting is best handled at the gateway layer (Supabase function
// invocations are throttled per-IP by default), but we add a tiny delay on
// failures to slow brute force from a single client even further.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  Deno.env.get("SERVICE_ROLE_KEY") ||
  "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still iterate one of them so the timing on length mismatch is similar.
    let _diff = 0;
    for (let i = 0; i < a.length; i++) _diff |= a.charCodeAt(i) ^ 0;
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

interface ValidateRequest {
  portalId?: string;
  passcode?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return jsonResponse({ ok: false, error: "Server not configured" }, 500);
  }

  let body: ValidateRequest;
  try {
    body = (await req.json()) as ValidateRequest;
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON" }, 400);
  }

  const portalId = (body.portalId ?? "").trim();
  const passcode = (body.passcode ?? "").trim();
  if (!portalId || !passcode) {
    return jsonResponse({ ok: false, error: "Missing portalId or passcode" }, 400);
  }

  // Look up the project that owns this portal_id and read its stored
  // client_portal JSON. We use the REST API directly with the service role
  // key — no need to bring in the supabase-js dependency for one query.
  const lookup = await fetch(
    `${SUPABASE_URL}/rest/v1/projects?select=client_portal&client_portal->>portalId=eq.${encodeURIComponent(portalId)}&limit=1`,
    {
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
    },
  );

  if (!lookup.ok) {
    console.error("[validate-portal-passcode] lookup failed", lookup.status, await lookup.text().catch(() => ""));
    return jsonResponse({ ok: false, error: "Lookup failed" }, 500);
  }

  const rows = (await lookup.json()) as Array<{ client_portal: { passcode?: string; requirePasscode?: boolean } | null }>;
  const portal = rows[0]?.client_portal ?? null;

  if (!portal) {
    // Don't reveal whether the portal exists vs. the passcode is wrong —
    // both fail the same way. Tiny delay slows brute force.
    await new Promise((r) => setTimeout(r, 250));
    return jsonResponse({ ok: false, error: "Invalid passcode" }, 401);
  }

  // If the portal isn't passcode-protected, treat any submission as a pass.
  // (Caller would normally not call this endpoint in that case, but be safe.)
  if (!portal.requirePasscode || !portal.passcode) {
    return jsonResponse({ ok: true });
  }

  const ok = constantTimeEqual(passcode, portal.passcode);
  if (!ok) {
    await new Promise((r) => setTimeout(r, 250));
    return jsonResponse({ ok: false, error: "Invalid passcode" }, 401);
  }

  return jsonResponse({ ok: true });
});
