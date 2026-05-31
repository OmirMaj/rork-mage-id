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
  // When true, only verified contractors are notified. Counters the
  // shared-lead-blast pattern by making verification valuable.
  verified_only: boolean | null;
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

interface LicenseRow {
  user_id: string | null;
  expires_date: string | null;
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

    const verifiedOnly = rfp.verified_only === true;

    // "Verified" = the contractor has at least one non-expired license on
    // file. There is NO boolean verified flag in the schema — the source of
    // truth is the contractor_licenses table (rows are created by MAGE ID
    // staff after reviewing a "Get Verified" submission). Only compute this
    // set when the RFP actually needs it.
    const verifiedUserIds = new Set<string>();
    if (verifiedOnly) {
      const today = new Date().toISOString().slice(0, 10);
      // expires_date null (no expiry) OR today-or-later → still valid.
      const licenses = await rest<LicenseRow[]>(
        `/contractor_licenses?select=user_id,expires_date&or=(expires_date.is.null,expires_date.gte.${today})`,
      );
      for (const l of licenses) {
        if (l.user_id) verifiedUserIds.add(l.user_id);
      }
    }

    const matched: CompanyRow[] = [];
    for (const c of all) {
      // Skip companies without an owner — those are mock/seed entries.
      if (!c.user_id) continue;
      // Don't notify the homeowner themselves if they happen to also have
      // a company profile.
      if (c.user_id === rfp.user_id) continue;
      // Verified-only RFPs: only fan out to contractors with a current
      // (non-expired) license on file.
      if (verifiedOnly && !verifiedUserIds.has(c.user_id)) continue;

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

    // Fan out via the existing notify dispatcher, but PACE the starts so
    // we don't burst Resend. Stress-1 found that firing 50 events in
    // parallel hit Resend's 5/sec rate limit and lost 88% to 429s.
    // Resend Pro is 10/sec, free is 5/sec — we stagger at 250ms (4/sec)
    // so we stay safely under either tier. Each notify call still runs
    // concurrently after its scheduled start; we just delay when each
    // one *begins*. For 100 bidders: total wall time ≈ 25s + notify
    // latency. The edge-function 150s budget covers up to ~580 bidders.
    //
    // We also cap at MAX_FAN_OUT to prevent a runaway broadcast from
    // exhausting the function. If a homeowner's RFP somehow matches
    // 600+ contractors, we notify the first 500 and log the rest;
    // realistic match counts are 5–50.
    const MAX_FAN_OUT = 500;
    const SPACE_MS = 250;
    const recipients = uniq.slice(0, MAX_FAN_OUT);
    const skipped = uniq.length - recipients.length;
    if (skipped > 0) {
      console.warn(`[notify-nearby] capped fan-out at ${MAX_FAN_OUT}, skipped ${skipped} extra recipients for rfp ${rfp.id}`);
    }

    let dispatched = 0;
    let failed = 0;
    const dispatchPromises = recipients.map((c, i) =>
      new Promise<void>((resolve) => {
        setTimeout(async () => {
          try {
            const resp = await fetch(`${SUPABASE_URL}/functions/v1/notify`, {
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
            if (resp.ok) dispatched++; else failed++;
          } catch (err) {
            failed++;
            console.warn('[notify-nearby] dispatch failed for', c.user_id, err);
          } finally {
            resolve();
          }
        }, i * SPACE_MS);
      }),
    );
    await Promise.all(dispatchPromises);

    return jsonResponse({
      success: true,
      matched_count: uniq.length,
      dispatched,
      failed,
      skipped_over_cap: skipped,
    });
  } catch (e) {
    console.error('[notify-nearby-contractors] failed', e);
    return jsonResponse({ success: false, error: String((e as Error).message ?? e) }, 500);
  }
});
