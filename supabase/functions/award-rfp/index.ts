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
//   - Setting up the contractor's clientPortal record on the new project,
//     with the homeowner's email on the invite. The portal itself is NOT
//     usable yet: it reads a published snapshot, and none exists until the
//     contractor opens client-portal-setup. So the homeowner is told the
//     contractor will send the link (rfp-responses-review), not handed one.
//
// Since 20260918120000 award_rfp also carries the homeowner's street address,
// lat/lng, the accepted price (target_budget), their contact, photos and
// drawings onto the new project, and returns contractValue / heroPhotoUrl —
// which we forward to the rfp_awarded email, whose template already reads
// contract_value and hero_photo_url and until now always got neither.
//
// Auth model: caller must send their JWT in Authorization. We verify
// they own the public_bid before doing anything destructive.
//
// Request: { bidId: string, responseId: string }
// Response: { success: true, projectId, portalId, homeownerEmail, companyName }
//         | { success: false, error }

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { verifyUser } from "../_shared/verifyUser.ts";

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

  // Identify the caller. We CRYPTOGRAPHICALLY verify the JWT via GoTrue
  // (verifyUser → /auth/v1/user) rather than trusting a bare claims decode:
  // this function's identity check must not be forgeable regardless of the
  // deployed verify_jwt setting, since award_rfp mutates rows across RLS
  // boundaries on behalf of the homeowner. A forged/expired/anon token
  // yields null and is rejected. homeownerId = the VERIFIED user id.
  const verified = await verifyUser(req);
  if (!verified || !verified.id) {
    return jsonResponse({ success: false, error: "Unauthorized" }, 401);
  }
  const homeownerId = verified.id;

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
      // Wave 5 (rfp-marketplace): award_rfp refuses a withdrawn / declined bid
      // ('This bid is no longer open for award (status: …)'). The review screen
      // hides Award on those rows; this is the race where it was withdrawn
      // while the screen was open — a sentence, not raw PostgREST text.
      if (/no longer open for award/i.test(text)) return jsonResponse({ success: false, error: "This bid was withdrawn or declined, so it can't be awarded." }, 409);
      return jsonResponse({ success: false, error: `Award failed: ${text.slice(0, 240)}` }, 500);
    }
    const result = (await rpcRes.json()) as {
      success: boolean;
      projectId: string;
      portalId: string;
      winnerUserId: string;
      winnerEmail: string | null;
      projectName: string;
      // 20260918120000+. Optional so a deploy that lands before the migration
      // still works — the keys are simply absent.
      companyName?: string | null;
      homeownerEmail?: string | null;
      contractValue?: number | string | null;
      heroPhotoUrl?: string | null;
    };

    // Best-effort: a Property Manager work order posted as this RFP
    // (post-rfp stores work_orders.rfp_id) is now ASSIGNED to the winner, so
    // the PM's list stops saying "Out for bids" after he picked someone. Only
    // this homeowner's live, still-unassigned orders move; the device mirror
    // adopts the row because its updated_at is newer. Never fails the award —
    // it has already committed (and the table may not exist before
    // 20260918180000 is applied).
    try {
      const nowIso = new Date().toISOString();
      const woRes = await fetch(
        `${SUPABASE_URL}/rest/v1/work_orders?rfp_id=eq.${encodeURIComponent(body.bidId)}`
          + `&user_id=eq.${encodeURIComponent(homeownerId)}`
          + `&deleted_at=is.null&status=in.(open,posted_for_bids)`,
        {
          method: "PATCH",
          headers: {
            apikey: SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({
            status: "assigned",
            assigned_contact_name: result.companyName ?? null,
            assigned_at: nowIso,
            updated_at: nowIso,
          }),
        },
      );
      if (!woRes.ok) {
        console.warn('[award-rfp] work order assign skipped:', woRes.status, (await woRes.text().catch(() => '')).slice(0, 200));
      }
    } catch (e) {
      console.warn('[award-rfp] work order assign skipped:', String((e as Error).message ?? e));
    }

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
          // The template renders "$X contract value" and the hero photo when
          // these are present, and omits them when they are not.
          ...(result.contractValue != null ? { contract_value: Number(result.contractValue) } : {}),
          ...(result.heroPhotoUrl ? { hero_photo_url: result.heroPhotoUrl } : {}),
          // The email tells him to send the portal link to this address.
          ...(result.homeownerEmail ? { homeowner_email: result.homeownerEmail } : {}),
        },
      }),
    }).catch(() => { /* ignore */ });

    return jsonResponse({
      success: true,
      projectId: result.projectId,
      portalId: result.portalId,
      // What the award screen needs to say who will be in touch, and where.
      homeownerEmail: result.homeownerEmail ?? null,
      companyName: result.companyName ?? null,
    });
  } catch (e) {
    console.error('[award-rfp] failed', e);
    return jsonResponse({ success: false, error: String((e as Error).message ?? e) }, 500);
  }
});
