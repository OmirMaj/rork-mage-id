// fetch-external-data
//
// Cron-driven sync that populates ONE cache:
//   - cached_bids       — SAM.gov public construction opportunities
//
// CONTENT RIGHTS (contentfix 2026-10-03; contentfix-specs/RIGHTS-VERDICT.md,
// rows "Google business listings" and "Adzuna jobs"): the Google Places step
// (-> cached_companies) and the Adzuna step (-> cached_jobs) are REMOVED. Google
// Maps Platform terms forbid storing business names, addresses and ratings at
// all, and Adzuna allows commercial use only after a 14-day trial with written
// consent. Neither provider is called any more; both still report a 'retired'
// verdict (sourceStatus.ts) so the run stays green and the response names them.
// The stored rows are purged by docs/ops/2026-10-03-content-rights-cleanup.sql
// and the public read is closed by 20261003090000_content_rights.sql. Do not
// re-add either step without the provider's written permission and the
// attribution its terms require.
//
// Triggered by pg_cron 4×/day (job: fetch-external-data-schedule).
//
// 2026-04-30 overhaul:
//   1. SAM.gov pagination — was limit=50 single page (~50 bids/run, NY had
//      29 of 1,380 because of national skew). Now limit=200, paginated
//      5x = up to 1000/run. postedFrom extended from 30 to 90 days so
//      bids posted earlier in their open period still surface.
//   2. Geocode backfill moved to its own function (geocode-bids), which
//      since 2026-10-03 uses OpenStreetMap Nominatim only (no Google).
//   3. Removed `latitude:null,longitude:null` hardcode — let upsert pull
//      coords from the city_coords cache when we already know them. Only
//      rows with source 'nominatim' are read: a Google-derived row (any other
//      source, incl. the column's old 'google_geocoding' default) is never
//      copied onto a bid, even before the cleanup SQL deletes it.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { isValidCron } from '../_shared/cronAuth.ts'
// SUPA-H1: per-source verdicts. A provider answering 401/403 or pulling zero
// rows with its key present FAILS the run (502, no heartbeat) instead of the
// old 200 {success:true} that hid a dead SAM.gov key for months.
import { sourceVerdict, cycleOutcome, type SourceResult } from './sourceStatus.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ─── Helpers ─────────────────────────────────────────────────────────

function normalizeCity(raw: string | null | undefined): string | null {
  if (!raw) return null
  // Title-case so "MECHANICSBURG" / "mechanicsburg" / "Mechanicsburg"
  // collapse to one cache key.
  return raw.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).trim()
}

function normalizeState(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = raw.trim().toUpperCase()
  return s.length >= 2 ? s.slice(0, 2) : null
}

interface CityKey { city: string; state: string }
function cityKey(city: string, state: string): string {
  return `${city}__${state}`
}

// (The old geocodeCity helper, which called Google Places Text Search first,
// was unused and is deleted: content rights, 2026-10-03.)

// ─── SAM.gov fetch with pagination ───────────────────────────────────
//
// Pulls construction-only (NAICS=23) opportunities posted in the last
// 90 days. Paginates up to maxPages × 200 results = 1000 per run. Most
// runs are mostly upserts of unchanged rows (notice_id is the unique
// key) — net effect is fresh additions trickle in across the day's 4
// runs without us re-paying SAM.gov rate limits unnecessarily.

interface SamOpp {
  noticeId: string
  title?: string
  description?: string
  solicitationNumber?: string
  department?: string
  subtierAgency?: string
  postedDate?: string
  responseDeadLine?: string
  naicsCode?: string
  typeOfSetAsideDescription?: string
  award?: { amount?: string }
  placeOfPerformance?: { city?: { name?: string }; state?: { code?: string } }
  officeAddress?: { city?: string; state?: string }
}

// The page AND how it went: a 401 is no longer indistinguishable from "no
// opportunities this page" (SUPA-H1). status 0 = the body did not parse.
async function fetchSamPage(apiKey: string, postedFrom: string, postedTo: string, offset: number, limit: number): Promise<{ opps: SamOpp[]; failedStatus: number | null }> {
  const url = `https://api.sam.gov/prod/opportunities/v2/search?api_key=${apiKey}&postedFrom=${postedFrom}&postedTo=${postedTo}&limit=${limit}&offset=${offset}&ptype=o&naics=23`
  const r = await fetch(url)
  const text = await r.text()
  if (!r.ok) {
    console.error('[sam] page failed', r.status, text.slice(0, 300))
    return { opps: [], failedStatus: r.status }
  }
  try {
    const data = JSON.parse(text)
    return { opps: (data.opportunitiesData ?? []) as SamOpp[], failedStatus: null }
  } catch {
    console.error('[sam] page parse failed')
    return { opps: [], failedStatus: 0 }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (!(await isValidCron(req))) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  try {
    console.log('=== Starting data fetch cycle ===')

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const SAM_GOV_API_KEY = Deno.env.get('SAM_GOV_API_KEY') ?? ''

    console.log('keys present →', 'sam:', !!SAM_GOV_API_KEY)

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // One verdict per provider (sourceStatus.ts). SAM.gov is the ONLY writer
    // of cached_bids in this repo: its rows carry source_name NULL (the 119
    // null-source rows in prod). The 40 'SAM.gov via GovCon API' rows were
    // written by a writer that is no longer in the repo and are never
    // refreshed; the null-deadline cleanup below retires them.
    const sources: SourceResult[] = []

    // ──────────────────────────────────────────────────────────────────
    // STEP 1: SAM.gov — paginated construction opportunities
    // ──────────────────────────────────────────────────────────────────
    console.log('--- Fetching bids from SAM.gov ---')

    const sam = { failedStatuses: [] as number[], rows: 0, error: null as string | null, writeError: null as string | null }
    if (SAM_GOV_API_KEY) {
     try {
      const today = new Date()
      const ninetyDaysAgo = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000)
      const fmtDate = (d: Date) =>
        `${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}/${d.getFullYear()}`
      const postedFrom = fmtDate(ninetyDaysAgo)
      const postedTo = fmtDate(today)

      // Pull 2 × 200 = 400 per run. The cron fires 4×/day so we still
      // touch ~1,600 rows daily, but each invocation stays inside the
      // edge-function CPU budget. Larger fetches were hitting the
      // WORKER_RESOURCE_LIMIT ceiling.
      const PAGE_SIZE = 200
      const MAX_PAGES = 2
      const opportunities: SamOpp[] = []

      for (let page = 0; page < MAX_PAGES; page++) {
        const offset = page * PAGE_SIZE
        const { opps: pageResults, failedStatus } = await fetchSamPage(SAM_GOV_API_KEY, postedFrom, postedTo, offset, PAGE_SIZE)
        if (failedStatus !== null) sam.failedStatuses.push(failedStatus)
        console.log(`[sam] page ${page} (offset ${offset}) → ${pageResults.length}`)
        opportunities.push(...pageResults)
        if (pageResults.length < PAGE_SIZE) break  // no more pages
        // Tiny pause between pages to be polite to the API.
        await new Promise((r) => setTimeout(r, 250))
      }

      console.log(`[sam] total opportunities pulled: ${opportunities.length}`)
      sam.rows = opportunities.length

      // Pre-load the city_coords cache so we hydrate lat/long during
      // upsert without an extra geocoding round-trip per row.
      // OpenStreetMap rows only (content rights, 2026-10-03): Google-derived
      // coordinates may not be kept past 30 days, so they are never reused.
      const { data: cityRows } = await supabase
        .from('city_coords')
        .select('city,state,latitude,longitude')
        .eq('source', 'nominatim')

      const cityCache = new Map<string, { lat: number; lng: number }>()
      for (const r of (cityRows ?? [])) {
        cityCache.set(cityKey(r.city, r.state), { lat: r.latitude, lng: r.longitude })
      }
      console.log(`[geocode] preloaded ${cityCache.size} city coords from cache`)

      const bidsToInsert: Record<string, unknown>[] = []
      const missingPairs = new Map<string, CityKey>()

      for (const opp of opportunities) {
        if (!opp.noticeId) continue
        const rawCity = opp.placeOfPerformance?.city?.name ?? opp.officeAddress?.city ?? null
        const rawState = opp.placeOfPerformance?.state?.code ?? opp.officeAddress?.state ?? null
        const city = normalizeCity(rawCity)
        const state = normalizeState(rawState)

        let lat: number | null = null
        let lng: number | null = null
        if (city && state) {
          const hit = cityCache.get(cityKey(city, state))
          if (hit) {
            lat = hit.lat
            lng = hit.lng
          } else {
            // Defer to STEP 1b — collect unique pairs.
            missingPairs.set(cityKey(city, state), { city, state })
          }
        }

        bidsToInsert.push({
          notice_id: opp.noticeId,
          title: opp.title || 'Untitled',
          description: (opp.description || '').substring(0, 2000),
          solicitation_number: opp.solicitationNumber || null,
          department: opp.department || opp.subtierAgency || null,
          posted_date: opp.postedDate || null,
          response_deadline: opp.responseDeadLine || null,
          naics_code: opp.naicsCode || null,
          set_aside: opp.typeOfSetAsideDescription || null,
          estimated_value: opp.award?.amount ? parseFloat(opp.award.amount) : null,
          city,
          state,
          latitude: lat,
          longitude: lng,
          source_url: `https://sam.gov/opp/${opp.noticeId}/view`,
          fetched_at: new Date().toISOString(),
        })
      }

      if (bidsToInsert.length > 0) {
        // Upsert in chunks — large batches sometimes hit Supabase's row-
        // count cap on a single request.
        for (let i = 0; i < bidsToInsert.length; i += 100) {
          const slice = bidsToInsert.slice(i, i + 100)
          const r = await supabase.from('cached_bids').upsert(slice, { onConflict: 'notice_id' })
          if (r.error) {
            console.error('[sam] upsert chunk error:', r.error.message)
            sam.writeError = r.error.message
          }
        }
        console.log(`[sam] upserted ${bidsToInsert.length} bids (${missingPairs.size} cities pending geocode)`)
      }

      // Geocoding lives in a separate edge function (geocode-bids) on
      // its own cron. Doing it inline blew past the WORKER_RESOURCE_LIMIT
      // when it shared one run with the other providers.
      console.log(`[sam] ${missingPairs.size} cities pending geocode (handled by geocode-bids)`)
     } catch (samErr) {
      console.error('[sam] fetch error:', String(samErr))
      sam.error = String(samErr).slice(0, 300)
     }
    } else {
      console.log('Skipping SAM.gov - no API key')
    }
    sources.push(sourceVerdict({ name: 'sam', keyPresent: !!SAM_GOV_API_KEY, ...sam }))

    // ──────────────────────────────────────────────────────────────────
    // STEPS 2 + 3 (Adzuna jobs, Google Places companies): RETIRED for content
    // rights (contentfix 2026-10-03, RIGHTS-VERDICT.md). No call is made and
    // nothing is written; each reports a skipped 'retired' verdict.
    // ──────────────────────────────────────────────────────────────────
    sources.push(sourceVerdict({ name: 'adzuna', keyPresent: false, retired: true, rows: 0 }))
    sources.push(sourceVerdict({ name: 'google_places', keyPresent: false, retired: true, rows: 0 }))

    // ──────────────────────────────────────────────────────────────────
    // STEP 4: Cleanup — drop expired bids, and age out any jobs/companies
    // rows left from before the retirement (the cleanup SQL empties both
    // tables right after deploy; these deletes are the backstop).
    // ──────────────────────────────────────────────────────────────────
    console.log('--- Cleaning up old data ---')
    try {
      const now = new Date().toISOString()
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
      const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()

      await supabase.from('cached_bids').delete().lt('response_deadline', now).not('response_deadline', 'is', null)
      // SUPA-H1: a bid with NO deadline was never deleted, so it sat in
      // Discover as "open" forever (39 of the 40 GovCon rows, last fetched
      // 2026-04-11). cached_bids is a re-fetchable cache: a no-deadline row
      // posted more than 60 days ago goes; SAM re-supplies it if still live.
      await supabase.from('cached_bids').delete().is('response_deadline', null).lt('posted_date', sixtyDaysAgo)
      await supabase.from('cached_jobs').delete().lt('fetched_at', thirtyDaysAgo)
      await supabase.from('cached_companies').delete().lt('fetched_at', ninetyDaysAgo)
      console.log('Cleanup complete')
    } catch (cleanErr) {
      console.error('Cleanup error:', String(cleanErr))
    }

    const outcome = cycleOutcome(sources, new Date().toISOString())
    console.log('=== Data fetch cycle complete ===', JSON.stringify(sources))

    if (outcome.allOk) {
      // Heartbeat: tell BetterStack this cron ran successfully. Alerts
      // fire if the ping doesn't arrive within 6h + 30min grace. ONLY when
      // every provider is ok or skipped — a dead key must page someone.
      const heartbeatUrl = Deno.env.get('BETTERSTACK_HEARTBEAT_FETCH_EXTERNAL')
      if (heartbeatUrl) {
        await fetch(heartbeatUrl).catch(() => {})
      }
    } else {
      console.error('[fetch-external-data] failed sources:', outcome.failedSources.join(', '), '— heartbeat skipped')
    }

    return new Response(
      JSON.stringify(outcome.body),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: outcome.status },
    )
  } catch (error) {
    console.error('Fatal error:', String(error))
    return new Response(
      JSON.stringify({ success: false, error: String(error) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 },
    )
  }
})
