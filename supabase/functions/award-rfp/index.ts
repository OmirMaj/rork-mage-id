// award-rfp
//
// Atomic award flow for the homeowner-RFP marketplace. Called by the
// homeowner from rfp-responses-review. We use the service role key
// because the operation crosses RLS boundaries:
//   - Updating the bid_response of a contractor (homeowner doesn't own
//     that row directly — RLS allows it via "br_homeowner_update_status",
//     but doing it server-side keeps the multi-step transaction atomic).
//   - Creating a new project in the awarded contractor's account
//     (auth.uid() = contractor's id requirement on projects RLS — only
//     the service role can satisfy this on behalf of the contractor).
//   - Updating the public_bid (homeowner owns it; RLS-fine).
//   - Setting up the contractor's clientPortal record on the new project
//     so the homeowner can immediately use it as the client.
//
// Auth model: caller must send their JWT in Authorization. We verify
// they own the public_bid before doing anything destructive.
//
// Request: { bidId: string, responseId: string }
// Response: { success: true, projectId, portalId } | { success: false, error }

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

interface AwardRequest {
  bidId?: string;
  responseId?: string;
}

interface JwtPayload { sub?: string; }

function decodeJwtSub(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const json = JSON.parse(atob(padded)) as JwtPayload;
    return json.sub ?? null;
  } catch { return null; }
}

async function rest<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...((init?.headers as Record<string, string>) ?? {}),
    },
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`Supabase REST ${r.status}: ${text.slice(0, 240)}`);
  }
  return r.json() as Promise<T>;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ success: false, error: "Method not allowed" }, 405);

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return jsonResponse({ success: false, error: "Server not configured" }, 500);
  }

  // Identify the caller. Edge functions get the user's JWT in Authorization
  // when verify_jwt=true (Supabase platform forwards it). We decode it to
  // get the sub (user id) — that's the homeowner.
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const homeownerId = decodeJwtSub(token);
  if (!homeownerId) {
    return jsonResponse({ success: false, error: "Unauthorized" }, 401);
  }

  let body: AwardRequest;
  try { body = await req.json() as AwardRequest; }
  catch { return jsonResponse({ success: false, error: "Invalid JSON" }, 400); }
  if (!body.bidId || !body.responseId) {
    return jsonResponse({ success: false, error: "Missing bidId or responseId" }, 400);
  }

  try {
    // Atomic via the public.award_rfp(p_homeowner_id, p_bid_id, p_response_id)
    // Postgres function. All 4 writes (project create, winner update, others
    // declined, bid closed) happen in a single transaction — partial state
    // can't leak through a network blip mid-flight. The RPC also enforces
    // ownership + already-awarded checks server-side, identical to what the
    // edge function used to do via separate REST calls.
    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/award_rfp`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_homeowner_id: homeownerId,
        p_bid_id: body.bidId,
        p_response_id: body.responseId,
      }),
    });

    if (!rpcRes.ok) {
      const text = await rpcRes.text().catch(() => "");
      // Map Postgres-raised exceptions to user-facing HTTP statuses.
      if (/Not your RFP/i.test(text))             return jsonResponse({ success: false, error: "Not your RFP" }, 403);
      if (/RFP not found/i.test(text))            return jsonResponse({ success: false, error: "RFP not found" }, 404);
      if (/Response not found/i.test(text))       return jsonResponse({ success: false, error: "Response not found" }, 404);
      if (/already awarded/i.test(text))          return jsonResponse({ success: false, error: "RFP already awarded" }, 409);
      if (/does not belong/i.test(text))          return jsonResponse({ success: false, error: "Response doesn't belong to this RFP" }, 400);
      return jsonResponse({ success: false, error: `Award failed: ${text.slice(0, 240)}` }, 500);
    }
    const result = (await rpcRes.json()) as {
      success: boolean;
      projectId: string;
      portalId: string;
      winnerUserId: string;
      winnerEmail: string | null;
      projectName: string;
    };

    // Best-effort: kick the notify dispatcher so the awarded contractor
    // gets a push + email. Failures here don't roll back the award —
    // they're advisory.
    void fetch(`${SUPABASE_URL}/functions/v1/notify`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event: 'rfp_awarded',
        source_table: 'bid_responses',
        source_id: body.responseId,
        payload: {
          contractor_user_id: result.winnerUserId,
          contractor_email: result.winnerEmail,
          project_id: result.projectId,
          project_name: result.projectName,
          homeowner_id: homeownerId,
        },
      }),
    }).catch(() => { /* ignore */ });

    return jsonResponse({ success: true, projectId: result.projectId, portalId: result.portalId });
  } catch (e) {
    console.error('[award-rfp] failed', e);
    return jsonResponse({ success: false, error: String((e as Error).message ?? e) }, 500);
  }
});
