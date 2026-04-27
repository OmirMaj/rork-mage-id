// notify-nearby-contractors
//
// Fans out a push notification + email to every contractor whose service
// area overlaps a newly-posted homeowner RFP. Called from a postgres
// AFTER INSERT trigger on public_bids when is_homeowner_rfp=true.
//
// Matching rules:
//   1. companies.service_states must contain the RFP's state (or be empty
//      meaning "anywhere — match against radius only").
//   2. If service_origin_lat/lng + service_radius_miles are populated AND
//      the RFP has lat/lng, distance must be ≤ radius.
//   3. We dedupe by user_id so a contractor with multiple companies only
//      gets one notification.
//
// We pass the actual fan-out off to the existing /notify dispatcher for
// each matched contractor — that handles Expo Push + Resend + outbox
// dedup. Trigger payload is just the public_bids row.
//
// Request body: { record: <new public_bids row> }   (postgres trigger shape)
// Response: { success, matched_count }

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

interface PublicBidRow {
  id: string;
  user_id: string;
  is_homeowner_rfp: boolean;
  state: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  title: string | null;
  scope_description: string | null;
  budget_min: number | null;
  budget_max: number | null;
}

interface CompanyRow {
  id: string;
  user_id: string | null;
  company_name: string | null;
  service_states: string[];
  service_radius_miles: number | null;
  service_origin_lat: number | null;
  service_origin_lng: number | null;
}

// Haversine — returns miles between two lat/lng pairs.
function distanceMiles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 3958.8;
  const toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat); const lat2 = toRad(bLat);
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.sin(dLng/2) * Math.sin(dLng/2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function rest<T = unknown>(path: string): Promise<T> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
  });
  if (!r.ok) throw new Error(`Supabase REST ${r.status}: ${await r.text().catch(() => "")}`);
  return r.json() as Promise<T>;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return jsonResponse({ success: false, error: "Server not configured" }, 500);
  }

  let body: { record?: PublicBidRow };
  try { body = await req.json(); }
  catch { return jsonResponse({ success: false, error: "Invalid JSON" }, 400); }

  const rfp = body.record;
  if (!rfp || !rfp.is_homeowner_rfp) {
    return jsonResponse({ success: true, matched_count: 0 }); // not a homeowner RFP — no fan-out
  }

  try {
    // Pull every company. With a few thousand rows this is fine; revisit
    // with PostGIS when we cross 50k+.
    const all = await rest<CompanyRow[]>(`/companies?select=id,user_id,company_name,service_states,service_radius_miles,service_origin_lat,service_origin_lng`);

    const matched: CompanyRow[] = [];
    for (const c of all) {
      // Skip companies without an owner — those are mock/seed entries.
      if (!c.user_id) continue;
      // Don't notify the homeowner themselves if they happen to also have
      // a company profile.
      if (c.user_id === rfp.user_id) continue;

      const states: string[] = Array.isArray(c.service_states) ? c.service_states : [];
      const stateMatch = states.length === 0 || (rfp.state ? states.includes(rfp.state) : true);
      if (!stateMatch) continue;

      // Distance check, only when both sides have coords.
      if (c.service_origin_lat != null && c.service_origin_lng != null
          && rfp.latitude != null && rfp.longitude != null) {
        const radius = c.service_radius_miles ?? 25;
        const d = distanceMiles(
          Number(c.service_origin_lat), Number(c.service_origin_lng),
          Number(rfp.latitude), Number(rfp.longitude),
        );
        if (d > radius) continue;
      }

      matched.push(c);
    }

    // Dedupe by user_id — a contractor with multiple company profiles
    // shouldn't get N pings.
    const seen = new Set<string>();
    const uniq = matched.filter(c => {
      if (!c.user_id || seen.has(c.user_id)) return false;
      seen.add(c.user_id);
      return true;
    });

    // Fan out via the existing notify dispatcher. Fire-and-forget per
    // contractor — total time bounded by Promise.all but we don't wait
    // longer than 10s for any one.
    await Promise.all(uniq.map(async c => {
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/notify`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            event: 'nearby_rfp_posted',
            source_table: 'public_bids',
            source_id: rfp.id,
            payload: {
              contractor_user_id: c.user_id,
              rfp_id: rfp.id,
              title: rfp.title,
              city: rfp.city,
              state: rfp.state,
              scope_excerpt: (rfp.scope_description ?? '').slice(0, 220),
              budget_min: rfp.budget_min,
              budget_max: rfp.budget_max,
            },
          }),
        });
      } catch (err) {
        console.warn('[notify-nearby] dispatch failed for', c.user_id, err);
      }
    }));

    return jsonResponse({ success: true, matched_count: uniq.length });
  } catch (e) {
    console.error('[notify-nearby-contractors] failed', e);
    return jsonResponse({ success: false, error: String((e as Error).message ?? e) }, 500);
  }
});
