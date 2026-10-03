// geocode-bids
//
// Backfills latitude/longitude on cached_bids rows that ship without
// coordinates from SAM.gov (~95% of the feed). Runs on its own cron
// to keep the per-invocation CPU budget small — fetch-external-data
// hit WORKER_RESOURCE_LIMIT when this work was inline with the SAM.gov
// fetch. Splitting also makes scaling the geocode pace independent
// from the bid-sync pace.
//
// Strategy:
//   1. Read the city_coords cache once — OpenStreetMap rows only.
//   2. Find every distinct (city, state) in cached_bids missing geo.
//   3. For each pair: cache hit → use directly; miss → call provider.
//   4. Provider is OpenStreetMap Nominatim ONLY. Google Places Text Search
//      was removed for content rights (contentfix 2026-10-03,
//      contentfix-specs/RIGHTS-VERDICT.md "Google coordinates for bid
//      cities"): Google lets coordinates be cached for 30 days at most and
//      we kept them forever. OSM data is ODbL: storing it is allowed with
//      attribution, which the app shows ("© OpenStreetMap contributors").
//      Nominatim's usage policy is honoured: an identifying User-Agent, at
//      most 1 request per second (1.1 s pause after EVERY call), results
//      cached so a pair is never asked for twice.
//   5. Upsert resolved coords into city_coords (source 'nominatim') AND
//      stamp every matching cached_bids row with the lat/long.
//
// A city_coords row whose source is anything but 'nominatim' (Google's
// 'google_places_textsearch', or the column's old 'google_geocoding'
// default) is never read here, so it is never copied onto a bid; the pair is
// re-geocoded through Nominatim and the upsert overwrites that row.
//
// Hard cap: 80 geocodes/run. Two reasons:
//   - Stays inside the edge-function CPU budget (was 200+/run before).
//   - At our cron cadence (~6×/day after this lands) that's 480
//     geocodes/day — we'll backfill every existing missing city in
//     under a week and stay caught up on new arrivals after.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { isValidCron } from '../_shared/cronAuth.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// 60 × ~1.1s/call ≈ 66s (plus Nominatim's own latency) — safely under the
// edge-function 150s budget. Total daily reach: 60 × 6 cron runs = 360/day.
// After the 2026-10-03 cleanup nulls the Google-derived coordinates, only the
// distinct (city, state) pairs of bids now missing coordinates are re-geocoded
// (the 1,237 deleted city_coords rows are not refetched unless a bid needs one).
const MAX_GEOCODES_PER_RUN = 60

interface CityRow { city: string; state: string }
interface Coords { lat: number; lng: number }

async function geocodeViaNominatim(city: string, state: string): Promise<Coords | null> {
  const url = `https://nominatim.openstreetmap.org/search?city=${encodeURIComponent(city)}&state=${encodeURIComponent(state)}&country=USA&format=json&limit=1`
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'mage-id/1.0 (cron-backfill; ops@mageid.app)' } })
    if (!r.ok) return null
    const arr = await r.json()
    if (Array.isArray(arr) && arr[0]?.lat && arr[0]?.lon) {
      const lat = parseFloat(arr[0].lat)
      const lng = parseFloat(arr[0].lon)
      if (!isNaN(lat) && !isNaN(lng)) return { lat, lng }
    }
  } catch {
    /* swallow */
  }
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (!(await isValidCron(req))) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

    // Concurrent-safety: claim the singleton geocode_run_lock row before
    // doing any work. Stress-5 found that 4 parallel runs each pulled
    // the same 60 cities — 4× hammering on Nominatim. UPDATE ... WHERE last_started_at IS NULL OR < (NOW()-4m)
    // is atomic at the row level, so only one parallel runner wins. The
    // 4-min staleness lets a stuck/crashed runner be reclaimed (the
    // function's max wall-clock is 150s, so 4 min is generous).
    const staleAfter = new Date(Date.now() - 4 * 60 * 1000).toISOString()
    const { data: claim } = await supabase
      .from('geocode_run_lock')
      .update({ last_started_at: new Date().toISOString() })
      .eq('id', 1)
      .or(`last_started_at.is.null,last_started_at.lt.${staleAfter}`)
      .select('id')
    if (!claim || claim.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        skipped: 'another_runner_active',
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // 1. Distinct (city, state) pairs in cached_bids without coords.
    //    PostgREST doesn't expose `select distinct` directly, so we
    //    pull a slim projection and dedupe in memory. With ~2k rows
    //    this is cheap.
    const { data: rawRows, error: selErr } = await supabase
      .from('cached_bids')
      .select('city,state')
      .is('latitude', null)
      .not('city', 'is', null)
      .not('state', 'is', null)
      .limit(2000)
    if (selErr) {
      return new Response(JSON.stringify({ success: false, error: selErr.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    const dedupe = new Map<string, CityRow>()
    for (const r of (rawRows ?? [])) {
      if (!r.city || !r.state) continue
      const key = `${r.city}__${r.state}`
      if (!dedupe.has(key)) dedupe.set(key, { city: r.city, state: r.state })
    }
    const allMissing = Array.from(dedupe.values())

    // 2. Hit cache first — anything we already know skips the API call.
    //    OpenStreetMap rows only: a Google-derived row is never reused.
    const { data: cacheRows } = await supabase.from('city_coords').select('city,state,latitude,longitude').eq('source', 'nominatim')
    const cache = new Map<string, Coords>()
    for (const r of (cacheRows ?? [])) {
      cache.set(`${r.city}__${r.state}`, { lat: r.latitude, lng: r.longitude })
    }

    const cacheHits: CityRow[] = []
    const needFetch: CityRow[] = []
    for (const p of allMissing) {
      const hit = cache.get(`${p.city}__${p.state}`)
      if (hit) cacheHits.push(p); else needFetch.push(p)
    }

    // 3. Hydrate cache hits without paying any API call.
    let hydratedFromCache = 0
    for (const p of cacheHits) {
      const hit = cache.get(`${p.city}__${p.state}`)!
      const upd = await supabase
        .from('cached_bids')
        .update({ latitude: hit.lat, longitude: hit.lng })
        .eq('city', p.city)
        .eq('state', p.state)
        .is('latitude', null)
      if (!upd.error) hydratedFromCache++
    }

    // 4. Fetch the remainder, capped at MAX_GEOCODES_PER_RUN.
    const toFetch = needFetch.slice(0, MAX_GEOCODES_PER_RUN)
    const newCacheRows: Record<string, unknown>[] = []
    let fetchedSucceeded = 0
    let fetchedFailed = 0
    let nominatimUsed = 0

    for (const p of toFetch) {
      // Nominatim only (no key). Its usage policy allows 1 request/second.
      const coords = await geocodeViaNominatim(p.city, p.state)
      if (coords) nominatimUsed++
      // ALWAYS pause after a Nominatim call (success OR failure),
      // otherwise back-to-back failures slam them and they rate-
      // limit / IP-ban us. Empirically: skipping this paused down
      // Nominatim resolution from 35/run to 1/run.
      await new Promise((r) => setTimeout(r, 1100))

      if (coords) {
        fetchedSucceeded++
        newCacheRows.push({
          city: p.city, state: p.state,
          latitude: coords.lat, longitude: coords.lng,
          geocoded_at: new Date().toISOString(),
          source: 'nominatim',
        })
        await supabase
          .from('cached_bids')
          .update({ latitude: coords.lat, longitude: coords.lng })
          .eq('city', p.city)
          .eq('state', p.state)
          .is('latitude', null)
      } else {
        fetchedFailed++
      }
    }

    if (newCacheRows.length > 0) {
      await supabase.from('city_coords').upsert(newCacheRows, { onConflict: 'city,state' })
    }

    // Release the lock — the next cron fire can claim it immediately
    // instead of waiting out the 4-min staleness window. Best-effort.
    await supabase.from('geocode_run_lock').update({ last_started_at: null }).eq('id', 1)

    // Heartbeat: tell BetterStack this cron ran. Alerts fire if the
    // ping doesn't show up within 4h + 30min grace. Best-effort.
    const heartbeatUrl = Deno.env.get('BETTERSTACK_HEARTBEAT_GEOCODE')
    if (heartbeatUrl) {
      await fetch(heartbeatUrl).catch(() => {})
    }

    return new Response(JSON.stringify({
      success: true,
      summary: {
        missingPairs: allMissing.length,
        hydratedFromCache,
        attempted: toFetch.length,
        fetchedSucceeded,
        fetchedFailed,
        nominatimUsed,
        remainingForNextRun: Math.max(0, needFetch.length - toFetch.length),
      },
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: String(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
