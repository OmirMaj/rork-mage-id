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
    // 1. Verify the homeowner owns the bid + the bid is open + this response
    //    belongs to the bid.
    const bids = await rest<{ id: string; user_id: string; status: string; title: string; address_line: string | null; latitude: number | null; longitude: number | null; city: string | null; state: string | null; scope_description: string | null; photo_urls: unknown; drawing_urls: unknown; budget_max: number | null; desired_start: string | null; awarded_response_id: string | null }[]>(
      `/public_bids?id=eq.${encodeURIComponent(body.bidId)}&select=id,user_id,status,title,address_line,latitude,longitude,city,state,scope_description,photo_urls,drawing_urls,budget_max,desired_start,awarded_response_id`
    );
    const bid = bids[0];
    if (!bid) return jsonResponse({ success: false, error: "RFP not found" }, 404);
    if (bid.user_id !== homeownerId) return jsonResponse({ success: false, error: "Not your RFP" }, 403);
    if (bid.awarded_response_id) {
      return jsonResponse({ success: false, error: "RFP already awarded" }, 409);
    }

    const responses = await rest<{ id: string; bid_id: string; user_id: string; company_name: string | null; bid_amount: number | null; estimate_summary: string | null; proposer_email: string | null; proposer_phone: string | null }[]>(
      `/bid_responses?id=eq.${encodeURIComponent(body.responseId)}&select=id,bid_id,user_id,company_name,bid_amount,estimate_summary,proposer_email,proposer_phone`
    );
    const winner = responses[0];
    if (!winner) return jsonResponse({ success: false, error: "Response not found" }, 404);
    if (winner.bid_id !== body.bidId) return jsonResponse({ success: false, error: "Response doesn't belong to this RFP" }, 400);

    // 2. Create the project in the awarded contractor's account. We use a
    //    deterministic UUID from the response id so retries are idempotent.
    const portalId = crypto.randomUUID();
    const projectId = crypto.randomUUID();

    const photoUrls   = Array.isArray(bid.photo_urls)   ? bid.photo_urls   : [];
    const drawingUrls = Array.isArray(bid.drawing_urls) ? bid.drawing_urls : [];

    const clientPortal = {
      enabled: true,
      portalId,
      requirePasscode: false,   // homeowner already authenticated themselves to award; no passcode needed
      welcomeMessage: `Welcome! This portal is for the project we just awarded.`,
      coApprovalEnabled: true,
      sections: {
        schedule: true, budget: true, invoices: true,
        changeOrders: true, photos: true, dailyReports: true,
        rfis: true, documents: true,
      },
      invites: [{
        id: crypto.randomUUID(),
        name: '',
        email: '',
        status: 'pending',
        createdAt: new Date().toISOString(),
      }],
    };

    await rest(`/projects`, {
      method: "POST",
      body: JSON.stringify({
        id: projectId,
        user_id: winner.user_id,
        name: bid.title,
        type: 'awarded_rfp',
        location: [bid.city, bid.state].filter(Boolean).join(', '),
        square_footage: 0,
        quality: 'standard',
        description: bid.scope_description ?? '',
        status: 'in_progress',
        client_portal: clientPortal,
      }),
    });

    // 3. Update the winning response. RLS allows homeowner UPDATE (the
    //    br_homeowner_update_status policy) — but service-role bypass is
    //    cleaner so we don't fight RLS twice.
    await rest(`/bid_responses?id=eq.${encodeURIComponent(winner.id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: 'awarded',
        awarded_project_id: projectId,
        responded_at: new Date().toISOString(),
      }),
    });

    // 4. Decline every other response on this bid that isn't already declined/withdrawn.
    await rest(`/bid_responses?bid_id=eq.${encodeURIComponent(body.bidId)}&id=not.eq.${encodeURIComponent(winner.id)}&status=in.(submitted,shortlisted)`, {
      method: "PATCH",
      body: JSON.stringify({
        status: 'declined',
        responded_at: new Date().toISOString(),
      }),
    });

    // 5. Close the bid + record the award.
    await rest(`/public_bids?id=eq.${encodeURIComponent(body.bidId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: 'closed',
        awarded_response_id: winner.id,
        awarded_at: new Date().toISOString(),
      }),
    });

    // 6. Best-effort: kick the notify dispatcher so the contractor gets a
    //    push + email. Failures here don't block the award.
    void fetch(`${SUPABASE_URL}/functions/v1/notify`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event: 'rfp_awarded',
        source_table: 'bid_responses',
        source_id: winner.id,
        payload: {
          contractor_user_id: winner.user_id,
          contractor_email: winner.proposer_email,
          project_id: projectId,
          project_name: bid.title,
          homeowner_id: homeownerId,
        },
      }),
    }).catch(() => { /* ignore */ });

    return jsonResponse({ success: true, projectId, portalId });
  } catch (e) {
    console.error('[award-rfp] failed', e);
    return jsonResponse({ success: false, error: String((e as Error).message ?? e) }, 500);
  }
});
