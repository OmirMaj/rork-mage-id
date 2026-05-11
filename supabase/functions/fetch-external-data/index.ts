// fetch-external-data
//
// Cron-driven sync that populates three caches:
//   - cached_bids       — SAM.gov public construction opportunities
//   - cached_jobs       — Adzuna job listings (construction-trade keywords)
//   - cached_companies  — Google Places contractor / supplier business listings
//
// Triggered by pg_cron 4×/day (job: fetch-external-data-schedule).
//
// 2026-04-30 overhaul:
//   1. SAM.gov pagination — was limit=50 single page (~50 bids/run, NY had
//      29 of 1,380 because of national skew). Now limit=200, paginated
//      5x = up to 1000/run. postedFrom extended from 30 to 90 days so
//      bids posted earlier in their open period still surface.
//   2. Geocode backfill — was hardcoded to latitude:null/longitude:null,
//      so 92% of cached_bids had no coordinates and "Near Me" filtering
//      worked on 8% of the feed. Now we look up every unique (city,state)
//      that's missing coords and persist to the city_coords table
//      (cache-first; never re-pay for the same pair).
//   3. Removed `latitude:null,longitude:null` hardcode — let upsert pull
//      coords from city_coords cache when we already know them.
//
// 2026-05-11 cost cut:
//   - Reordered geocoders so the FREE provider runs first.
//     Was: Google Places (paid, ~$0.032/call) → Nominatim fallback
//     Now: Nominatim (free, OSM) primary → Google Places fallback
//   - Census Geocoder evaluated and rejected: its onelineaddress
//     endpoint requires a street address; SAM.gov gives us only
//     city + state, so Census returns empty for our queries.
//     Nominatim handles city+state lookups cleanly via the
//     dedicated `?city=&state=&country=USA` parameters.
//   - Added 1.1s politeness delay between Nominatim calls per OSM's
//     usage policy (https://operations.osmfoundation.org/policies/nominatim/).
//   - Expected monthly cost: ~$3-5/mo (down from ~$19/mo). Google
//     Places only fires if Nominatim returns null, which is rare.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

// Resolve a (city, state) → lat/long.
//
// Tries two providers in order:
//   1. OpenStreetMap Nominatim — FREE, no API key. Handles city+state
//      cleanly via the dedicated `?city=&state=&country=USA` query
//      params. Rate-limited to 1 req/sec per OSM's usage policy; we
//      sleep 1.1s between calls to stay polite.
//   2. Google Places Text Search — paid (~$0.032/call), only fires
//      when Nominatim returns nothing (rare for US cities). Kept as
//      a safety net for edge cases (typos, weird municipal names).
//      Set NEVER_USE_GOOGLE=true in env if you want to skip entirely
//      and accept the small miss rate.
//
// Both calls capture an `errKey` so the caller can return a sample
// failure reason in the function response (we can't read console logs
// from outside the function).
async function geocodeCity(
  city: string, state: string, googleKey: string,
  diag: { lastPlacesStatus?: string; lastPlacesError?: string; lastNominatimStatus?: number },
): Promise<{ lat: number; lng: number } | null> {
  // Attempt 1: Nominatim (free).
  try {
    const nUrl = `https://nominatim.openstreetmap.org/search?city=${encodeURIComponent(city)}&state=${encodeURIComponent(state)}&country=USA&format=json&limit=1`
    const r = await fetch(nUrl, { headers: { 'User-Agent': 'mage-id/1.0 (cron-backfill; admin@mageid.app)' } })
    diag.lastNominatimStatus = r.status
    if (r.ok) {
      const arr = await r.json()
      if (Array.isArray(arr) && arr[0]?.lat && arr[0]?.lon) {
        // Politeness sleep — OSM asks ≤1 req/sec. The 1.1s buffer
        // keeps us comfortably under that limit even if multiple
        // city/state pairs need geocoding in the same run.
        await new Promise((resolve) => setTimeout(resolve, 1100))
        return { lat: parseFloat(arr[0].lat), lng: parseFloat(arr[0].lon) }
      }
    }
  } catch {
    /* fall through to Google fallback */
  }

  // Attempt 2: Google Places Text Search (paid fallback).
  // Skip entirely if NEVER_USE_GOOGLE=true is set in the function env —
  // this lets you cap costs at exactly $0 if Nominatim misses are
  // acceptable.
  const neverGoogle = (Deno.env.get('NEVER_USE_GOOGLE') ?? '').toLowerCase() === 'true'
  if (googleKey && !neverGoogle) {
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(`${city}, ${state}`)}&key=${googleKey}`
    try {
      const r = await fetch(url)
      if (r.ok) {
        const data = await r.json()
        diag.lastPlacesStatus = data.status
        if (data.error_message) diag.lastPlacesError = String(data.error_message).slice(0, 200)
        if (data.status === 'OK' && data.results?.length) {
          const loc = data.results[0]?.geometry?.location
          if (loc && typeof loc.lat === 'number' && typeof loc.lng === 'number') {
            return { lat: loc.lat, lng: loc.lng }
          }
        }
      } else {
        diag.lastPlacesStatus = `HTTP_${r.status}`
      }
    } catch (e) {
      diag.lastPlacesError = String(e).slice(0, 200)
    }
  }

  return null
}

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

async function fetchSamPage(apiKey: string, postedFrom: string, postedTo: string, offset: number, limit: number): Promise<SamOpp[]> {
  const url = `https://api.sam.gov/prod/opportunities/v2/search?api_key=${apiKey}&postedFrom=${postedFrom}&postedTo=${postedTo}&limit=${limit}&offset=${offset}&ptype=o&naics=23`
  const r = await fetch(url)
  const text = await r.text()
  if (!r.ok) {
    console.error('[sam] page failed', r.status, text.slice(0, 300))
    return []
  }
  try {
    const data = JSON.parse(text)
    return (data.opportunitiesData ?? []) as SamOpp[]
  } catch {
    console.error('[sam] page parse failed')
    return []
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    console.log('=== Starting data fetch cycle ===')

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const SAM_GOV_API_KEY = Deno.env.get('SAM_GOV_API_KEY') ?? ''
    const ADZUNA_APP_ID = Deno.env.get('ADZUNA_APP_ID') ?? ''
    const ADZUNA_APP_KEY = Deno.env.get('ADZUNA_APP_KEY') ?? ''
    const GOOGLE_PLACES_API_KEY = Deno.env.get('GOOGLE_PLACES_API_KEY') ?? ''

    console.log('keys present →',
      'sam:', !!SAM_GOV_API_KEY,
      'adzuna:', !!(ADZUNA_APP_ID && ADZUNA_APP_KEY),
      'google:', !!GOOGLE_PLACES_API_KEY)

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // ──────────────────────────────────────────────────────────────────
    // STEP 1: SAM.gov — paginated construction opportunities
    // ──────────────────────────────────────────────────────────────────
    console.log('--- Fetching bids from SAM.gov ---')

    if (SAM_GOV_API_KEY) {
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
        const pageResults = await fetchSamPage(SAM_GOV_API_KEY, postedFrom, postedTo, offset, PAGE_SIZE)
        console.log(`[sam] page ${page} (offset ${offset}) → ${pageResults.length}`)
        opportunities.push(...pageResults)
        if (pageResults.length < PAGE_SIZE) break  // no more pages
        // Tiny pause between pages to be polite to the API.
        await new Promise((r) => setTimeout(r, 250))
      }

      console.log(`[sam] total opportunities pulled: ${opportunities.length}`)

      // Pre-load the city_coords cache so we hydrate lat/long during
      // upsert without an extra geocoding round-trip per row.
      const { data: cityRows } = await supabase
        .from('city_coords')
        .select('city,state,latitude,longitude')

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
          if (r.error) console.error('[sam] upsert chunk error:', r.error.message)
        }
        console.log(`[sam] upserted ${bidsToInsert.length} bids (${missingPairs.size} cities pending geocode)`)
      }

      // Geocoding lives in a separate edge function (geocode-bids) on
      // its own cron. Doing it inline blew past the WORKER_RESOURCE_LIMIT
      // when paired with SAM.gov + Adzuna + Places work in one run.
      console.log(`[sam] ${missingPairs.size} cities pending geocode (handled by geocode-bids)`)
    } else {
      console.log('Skipping SAM.gov - no API key')
    }

    // ──────────────────────────────────────────────────────────────────
    // STEP 2: Adzuna — construction-trade jobs
    // ──────────────────────────────────────────────────────────────────
    console.log('--- Fetching jobs from Adzuna ---')

    if (ADZUNA_APP_ID && ADZUNA_APP_KEY) {
      try {
        const searchTerms = [
          'construction', 'electrician', 'plumber', 'carpenter', 'HVAC',
          'foreman', 'welder', 'roofer', 'general contractor',
        ]
        const allJobs: Record<string, unknown>[] = []

        for (const term of searchTerms) {
          try {
            const adzunaUrl = `https://api.adzuna.com/v1/api/jobs/us/search/1?app_id=${ADZUNA_APP_ID}&app_key=${ADZUNA_APP_KEY}&results_per_page=10&what=${encodeURIComponent(term)}&content-type=application/json`
            const adzResponse = await fetch(adzunaUrl)
            if (!adzResponse.ok) continue
            const adzData = await adzResponse.json()
            const results = adzData.results || []
            for (const job of results) {
              const titleLower = (job.title || '').toLowerCase()
              let tradeCategory = 'General Construction'
              if (titleLower.includes('electric')) tradeCategory = 'Electrical'
              else if (titleLower.includes('plumb')) tradeCategory = 'Plumbing'
              else if (titleLower.includes('carpenter') || titleLower.includes('carpentry')) tradeCategory = 'Carpentry'
              else if (titleLower.includes('hvac') || titleLower.includes('heating') || titleLower.includes('cooling')) tradeCategory = 'HVAC'
              else if (titleLower.includes('weld')) tradeCategory = 'Welding'
              else if (titleLower.includes('mason')) tradeCategory = 'Masonry'
              else if (titleLower.includes('roof')) tradeCategory = 'Roofing'
              else if (titleLower.includes('foreman') || titleLower.includes('superintendent')) tradeCategory = 'Management'
              else if (titleLower.includes('laborer') || titleLower.includes('labor')) tradeCategory = 'Labor'
              allJobs.push({
                external_id: String(job.id || `adzuna_${Date.now()}_${Math.random()}`),
                title: job.title || 'Untitled Position',
                company_name: job.company?.display_name || null,
                description: (job.description || '').substring(0, 1000),
                trade_category: tradeCategory,
                salary_min: job.salary_min || null,
                salary_max: job.salary_max || null,
                contract_type: job.contract_time || job.contract_type || null,
                city: job.location?.area?.[3] || job.location?.area?.[2] || null,
                state: job.location?.area?.[1] || null,
                latitude: job.latitude || null,
                longitude: job.longitude || null,
                apply_url: job.redirect_url || null,
                posted_date: job.created || null,
                fetched_at: new Date().toISOString(),
              })
            }
            await new Promise((resolve) => setTimeout(resolve, 500))
          } catch (termErr) {
            console.error('Error fetching jobs for', term, ':', String(termErr))
          }
        }

        if (allJobs.length > 0) {
          const uniqueJobs = Array.from(new Map(allJobs.map((j) => [j.external_id, j])).values())
          const result = await supabase
            .from('cached_jobs')
            .upsert(uniqueJobs, { onConflict: 'external_id' })
          if (result.error) console.error('Error inserting jobs:', result.error.message)
          else console.log('Successfully upserted', uniqueJobs.length, 'jobs')
        }
      } catch (err) {
        console.error('Adzuna fetch error:', String(err))
      }
    } else {
      console.log('Skipping Adzuna - no API keys')
    }

    // ──────────────────────────────────────────────────────────────────
    // STEP 3: Google Places — contractor / supplier listings (weekly)
    // ──────────────────────────────────────────────────────────────────
    console.log('--- Fetching companies from Google Places ---')

    if (GOOGLE_PLACES_API_KEY) {
      try {
        // Places data is stable — refresh at most once per week. Single
        // guard; cuts Google Places spend by ~95%.
        const { data: lastFetchRow } = await supabase
          .from('cached_companies')
          .select('fetched_at')
          .order('fetched_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
        const lastFetchMs = lastFetchRow?.fetched_at ? new Date(lastFetchRow.fetched_at).getTime() : 0
        const ageMs = Date.now() - lastFetchMs
        const shouldFetchPlaces = ageMs > SEVEN_DAYS_MS

        if (!shouldFetchPlaces) {
          const ageDays = Math.round(ageMs / (24 * 60 * 60 * 1000))
          console.log(`Skipping Google Places — last run ${ageDays}d ago, next refresh in ${Math.max(0, 7 - ageDays)}d`)
        } else {
          const metros = [
            { name: 'New York', lat: 40.7128, lng: -74.006 },
            { name: 'Los Angeles', lat: 34.0522, lng: -118.2437 },
            { name: 'Chicago', lat: 41.8781, lng: -87.6298 },
            { name: 'Houston', lat: 29.7604, lng: -95.3698 },
            { name: 'Dallas', lat: 32.7767, lng: -96.797 },
            { name: 'Phoenix', lat: 33.4484, lng: -112.074 },
            { name: 'Philadelphia', lat: 39.9526, lng: -75.1652 },
            { name: 'Atlanta', lat: 33.749, lng: -84.388 },
            { name: 'Miami', lat: 25.7617, lng: -80.1918 },
          ]
          const searchTypes = [
            'general contractor', 'electrical contractor', 'plumbing contractor',
            'HVAC contractor', 'roofing contractor', 'building materials store',
          ]
          const allCompanies: Record<string, unknown>[] = []

          for (const metro of metros) {
            for (const searchType of searchTypes) {
              try {
                const placesUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(searchType)}&location=${metro.lat},${metro.lng}&radius=40000&key=${GOOGLE_PLACES_API_KEY}`
                const placesResponse = await fetch(placesUrl)
                if (!placesResponse.ok) continue
                const placesData = await placesResponse.json()
                if (placesData.status !== 'OK' && placesData.status !== 'ZERO_RESULTS') continue
                const results = placesData.results || []
                for (const place of results) {
                  let tradeSpecialty = searchType.replace(' contractor', '').replace(' store', ' Supply')
                  tradeSpecialty = tradeSpecialty.charAt(0).toUpperCase() + tradeSpecialty.slice(1)
                  const addressParts = (place.formatted_address || '').split(',').map((s: string) => s.trim())
                  const city = addressParts.length >= 3 ? addressParts[addressParts.length - 3] : null
                  const stateZip = addressParts.length >= 2 ? addressParts[addressParts.length - 2] : ''
                  const state = stateZip.split(' ')[0] || null
                  allCompanies.push({
                    place_id: place.place_id,
                    name: place.name || 'Unknown Business',
                    trade_specialty: tradeSpecialty,
                    address: place.formatted_address || null,
                    city, state,
                    phone: null, website: null,
                    rating: place.rating || null,
                    total_reviews: place.user_ratings_total || null,
                    latitude: place.geometry?.location?.lat || null,
                    longitude: place.geometry?.location?.lng || null,
                    photo_url: null,
                    fetched_at: new Date().toISOString(),
                  })
                }
                await new Promise((resolve) => setTimeout(resolve, 300))
              } catch (placeErr) {
                console.error('Error fetching', searchType, 'in', metro.name, ':', String(placeErr))
              }
            }
          }

          if (allCompanies.length > 0) {
            const uniqueCompanies = Array.from(new Map(allCompanies.map((c) => [c.place_id, c])).values())
            for (let i = 0; i < uniqueCompanies.length; i += 50) {
              const batch = uniqueCompanies.slice(i, i + 50)
              const result = await supabase.from('cached_companies').upsert(batch, { onConflict: 'place_id' })
              if (result.error) console.error('Error inserting companies batch:', result.error.message)
            }
            console.log('Successfully processed', uniqueCompanies.length, 'total companies')
          }
        }
      } catch (err) {
        console.error('Google Places fetch error:', String(err))
      }
    } else {
      console.log('Skipping Google Places - no API key')
    }

    // ──────────────────────────────────────────────────────────────────
    // STEP 4: Cleanup — drop expired bids, stale jobs/companies
    // ──────────────────────────────────────────────────────────────────
    console.log('--- Cleaning up old data ---')
    try {
      const now = new Date().toISOString()
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

      await supabase.from('cached_bids').delete().lt('response_deadline', now).not('response_deadline', 'is', null)
      await supabase.from('cached_jobs').delete().lt('fetched_at', thirtyDaysAgo)
      await supabase.from('cached_companies').delete().lt('fetched_at', ninetyDaysAgo)
      console.log('Cleanup complete')
    } catch (cleanErr) {
      console.error('Cleanup error:', String(cleanErr))
    }

    console.log('=== Data fetch cycle complete ===')

    // Heartbeat: tell BetterStack this cron ran successfully. Alerts
    // fire if the ping doesn't arrive within 6h + 30min grace.
    const heartbeatUrl = Deno.env.get('BETTERSTACK_HEARTBEAT_FETCH_EXTERNAL')
    if (heartbeatUrl) {
      await fetch(heartbeatUrl).catch(() => {})
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Data fetch cycle complete', timestamp: new Date().toISOString() }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
    )
  } catch (error) {
    console.error('Fatal error:', String(error))
    return new Response(
      JSON.stringify({ success: false, error: String(error) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 },
    )
  }
})
