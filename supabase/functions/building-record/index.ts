// building-record — the read-only NYC building record.
//
// POST { mode: 'resolve', text }            → GeoSearch candidates (never auto-picked)
// POST { mode: 'record', bin, bbl }         → 7 DOB datasets + the PLUTO parcel
// POST { mode: 'permit', permitNumber }     → DOB NOW / BIS status, verbatim
// POST { mode: 'benchmark', borough }       → DOB NOW Alteration review times
// POST { mode: 'nj_resolve', text, lat, lon } → NJ tax-lot candidates (never auto-picked)
// POST { mode: 'nj_record', muniCode, block, lot } → NJ state permit data + town freshness
//
// The two NJ modes are routed BEFORE the NYC switch and live in ./nj.ts (pure).
// Their sources (Census geocoder, the NJGIN parcel layer, data.nj.gov) are
// public and cost $0; they share the NYC auth, tier and rate-limit bucket.
//
// Everything it reads is PUBLIC (NYC Open Data + NYC Planning GeoSearch) and
// costs MAGE $0, so it is FREE for every tier (founder decision 2026-09-25).
// JWT stays on (supabase/config.toml) so the rate limit has a user to key on.
//
// Honesty is enforced in ./normalize.ts: server-side ACTIVE filters, a
// `truncated` flag on every full page, and a failed or timed-out dataset kept
// as 'failed'/'timeout' with activeCount null — never dropped, never zero.
// Every error body is a fixed ERRORS text; exceptions go to console.error only.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { requireTier, rateLimitCount } from '../_shared/auth.ts';
import {
  ERRORS,
  RECORD_DATASET_IDS,
  assembleRecord,
  benchmarkFrom,
  benchmarkUrl,
  candidatesFromGeosearch,
  datasetUrl,
  failedDataset,
  failedParcel,
  geosearchUrl,
  normalizeDataset,
  normalizeParcel,
  parseRequest,
  permitMatches,
  permitUrls,
  DATASETS,
  type BuildingRecord,
  type BuildingRecordDataset,
  type BuildingRecordResponse,
  type DatasetId,
  type DobPermitMatch,
  type ReviewBenchmark,
} from './normalize.ts';
import {
  NJ_ERRORS,
  addressKey,
  assembleNjRecord,
  censusFirstMatch,
  censusLocationsUrl,
  failedNjPermits,
  mergeNjCandidates,
  njMuniFreshnessUrl,
  njParcelAddressUrl,
  njParcelBufferUrl,
  njPermitsUrl,
  normalizeNjFreshness,
  normalizeNjPermits,
  parseNjRequest,
  rankNjCandidates,
  type NjBuildingRecord,
  type NjBuildingRecordResponse,
  type NjParcelCandidate,
} from './nj.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const HOURLY_LIMIT = 120;
const UPSTREAM_TIMEOUT_MS = 8000;
const RECORD_TTL_MS = 10 * 60 * 1000;
const BENCHMARK_TTL_MS = 24 * 60 * 60 * 1000;

function json(body: BuildingRecordResponse, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function njJson(body: NjBuildingRecordResponse, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// ── upstream fetch ──────────────────────────────────────────────────────────

class TimeoutError extends Error {}

type Fetched = { rows: unknown; lastModified: string | null };

/** GET one builder-made URL with an 8 s timeout. The Socrata app token is
 *  sent only when the secret exists (none today; adding it later needs no
 *  code change or redeploy). */
async function getJson(url: string, soda: boolean): Promise<Fetched> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (soda) {
    const token = Deno.env.get('NYC_SODA_APP_TOKEN') ?? '';
    if (token.trim()) headers['X-App-Token'] = token.trim();
  }
  try {
    const res = await fetch(url, { headers, signal: ac.signal });
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`upstream status ${res.status}`);
    }
    const rows = await res.json();
    return { rows, lastModified: res.headers.get('X-SODA2-Truth-Last-Modified') };
  } catch (e) {
    if (ac.signal.aborted) throw new TimeoutError('upstream timeout');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ── in-isolate caches ───────────────────────────────────────────────────────

const recordCache = new Map<string, { at: number; record: BuildingRecord }>();
const benchmarkCache = new Map<string, { at: number; benchmark: ReviewBenchmark }>();
const njRecordCache = new Map<string, { at: number; record: NjBuildingRecord }>();

function prune<T extends { at: number }>(m: Map<string, T>, ttl: number) {
  const now = Date.now();
  for (const [k, v] of m) if (now - v.at > ttl) m.delete(k);
  while (m.size > 500) {
    const first = m.keys().next().value;
    if (first === undefined) break;
    m.delete(first);
  }
}

// ── modes ───────────────────────────────────────────────────────────────────

async function resolve(text: string): Promise<Response> {
  const url = geosearchUrl(text);
  if (!url) return json({ status: 'error', code: 'bad_request', error: ERRORS.bad_request }, 400);
  let got: Fetched;
  try {
    got = await getJson(url, false);
  } catch (e) {
    console.error('[building-record] geosearch failed:', e);
    return json({ status: 'error', code: 'upstream', error: ERRORS.upstream }, 502);
  }
  const { candidates, droppedPlaceholders } = candidatesFromGeosearch(got.rows);
  // ALWAYS candidates: the contractor confirms the building, MAGE never picks.
  return json({ status: 'candidates', candidates, droppedPlaceholders });
}

async function record(bin: string, bbl: string): Promise<Response> {
  // Keyed on BOTH, so a different bbl never gets another lot's PLUTO facts.
  const cacheKey = `${bin}:${bbl}`;
  prune(recordCache, RECORD_TTL_MS);
  const hit = recordCache.get(cacheKey);
  if (hit) return json({ status: 'record', record: hit.record });

  const today = new Date();
  const ids: DatasetId[] = [...RECORD_DATASET_IDS, '64uk-42ks'];
  const settled = await Promise.allSettled(ids.map((id) => {
    const url = datasetUrl(id, bin, bbl, today);
    if (!url) return Promise.reject(new Error('unbuildable url'));
    return getJson(url, true);
  }));

  const datasets: BuildingRecordDataset[] = [];
  let ecbRaw: unknown = null;
  let parcel = failedParcel('failed');
  settled.forEach((s, i) => {
    const id = ids[i];
    if (s.status === 'rejected') {
      console.error(`[building-record] ${id} failed:`, s.reason);
      const kind = s.reason instanceof TimeoutError ? 'timeout' : 'failed';
      if (id === '64uk-42ks') parcel = failedParcel(kind);
      else datasets.push(failedDataset(id, kind));
      return;
    }
    if (id === '64uk-42ks') { parcel = normalizeParcel(s.value.rows, s.value.lastModified); return; }
    if (id === '6bgk-3dad') ecbRaw = s.value.rows;
    datasets.push(normalizeDataset(id, s.value.rows, s.value.lastModified, today));
  });

  const rec = assembleRecord({ bin, bbl, fetchedAt: today, datasets, parcel, ecbRaw });
  // Only a fully answered record is cached: a failed or timed-out set must be
  // retried on the next open, not pinned for the full TTL.
  if (rec.parcel.status === 'ok' && rec.datasets.every((d) => d.status === 'ok')) {
    recordCache.set(cacheKey, { at: Date.now(), record: rec });
  }
  return json({ status: 'record', record: rec });
}

async function permit(permitNumber: string): Promise<Response> {
  const targets = permitUrls(permitNumber);
  if (!targets.length) return json({ status: 'error', code: 'bad_request', error: ERRORS.bad_request }, 400);
  const settled = await Promise.allSettled(targets.map((t) => getJson(t.url, true)));
  const matches: DobPermitMatch[] = [];
  const failed: string[] = [];
  settled.forEach((s, i) => {
    const id = targets[i].id;
    if (s.status === 'rejected') {
      console.error(`[building-record] permit ${id} failed:`, s.reason);
      failed.push(DATASETS[id].name);
      return;
    }
    matches.push(...permitMatches(id, s.value.rows, s.value.lastModified));
  });
  return json({ status: 'permit', lookup: { permitNumber, matches, failed } });
}

async function benchmark(borough: string): Promise<Response> {
  const today = new Date();
  const url = benchmarkUrl(borough, today);
  if (!url) return json({ status: 'error', code: 'bad_request', error: ERRORS.bad_request }, 400);
  prune(benchmarkCache, BENCHMARK_TTL_MS);
  const hit = benchmarkCache.get(borough);
  if (hit) return json({ status: 'benchmark', benchmark: hit.benchmark });
  let got: Fetched;
  try {
    got = await getJson(url, true);
  } catch (e) {
    console.error('[building-record] benchmark failed:', e);
    return json({ status: 'error', code: 'upstream', error: ERRORS.upstream }, 502);
  }
  const b = benchmarkFrom(got.rows, borough, today, got.lastModified);
  benchmarkCache.set(borough, { at: Date.now(), benchmark: b });
  return json({ status: 'benchmark', benchmark: b });
}

// ── New Jersey modes ────────────────────────────────────────────────────────

/** Census → the 30 m parcel buffer → ranked candidates. If no buffered lot
 *  carries the street address, the address is looked up by PROP_LOC in the
 *  same towns and its hits go first. No Census match + a map pin → the buffer
 *  at the pin, every lot 'approximate'. ALWAYS candidates: never auto-picked. */
async function njResolve(text: string, lat: number | null, lon: number | null): Promise<Response> {
  const cUrl = censusLocationsUrl(text);
  if (!cUrl) return njJson({ status: 'error', code: 'bad_request', error: ERRORS.bad_request }, 400);
  try {
    const census = await getJson(cUrl, false);
    const first = censusFirstMatch(census.rows);
    let candidates: NjParcelCandidate[] = [];
    if (first) {
      const key = addressKey(first.matchedAddress);
      const bUrl = njParcelBufferUrl(first.lat, first.lon);
      if (bUrl) candidates = rankNjCandidates((await getJson(bUrl, false)).rows, key, 'nearby');
      if (candidates.length && !candidates.some((c) => c.match === 'address')) {
        const aUrl = njParcelAddressUrl([...new Set(candidates.map((c) => c.muniCode))], key);
        if (aUrl) {
          try {
            candidates = mergeNjCandidates(rankNjCandidates((await getJson(aUrl, false)).rows, key, 'nearby'), candidates);
          } catch (e) {
            // The buffered lots still stand; the address query only reorders.
            console.error('[building-record] nj address query failed:', e);
          }
        }
      }
    } else if (lat !== null && lon !== null) {
      const pUrl = njParcelBufferUrl(lat, lon);
      if (pUrl) candidates = rankNjCandidates((await getJson(pUrl, false)).rows, null, 'approximate');
    }
    return njJson({ status: 'nj_candidates', candidates });
  } catch (e) {
    console.error('[building-record] nj resolve failed:', e);
    return njJson({ status: 'error', code: 'upstream', error: NJ_ERRORS.upstream }, 502);
  }
}

async function njRecord(muniCode: string, block: string, lot: string): Promise<Response> {
  const cacheKey = `nj:${muniCode}:${block}:${lot}`;
  prune(njRecordCache, RECORD_TTL_MS);
  const hit = njRecordCache.get(cacheKey);
  if (hit) return njJson({ status: 'nj_record', record: hit.record });

  const today = new Date();
  const pUrl = njPermitsUrl(muniCode, block, lot, today);
  const fUrl = njMuniFreshnessUrl(muniCode);
  const [ps, fs] = await Promise.allSettled([
    pUrl ? getJson(pUrl, false) : Promise.reject(new Error('unbuildable url')),
    fUrl ? getJson(fUrl, false) : Promise.reject(new Error('unbuildable url')),
  ]);

  let permits = failedNjPermits('failed');
  let muniName: string | null = null;
  if (ps.status === 'fulfilled') {
    const n = normalizeNjPermits(ps.value.rows, block, lot, ps.value.lastModified, today);
    permits = n.dataset;
    muniName = n.muniName;
  } else {
    console.error('[building-record] nj permits failed:', ps.reason);
    permits = failedNjPermits(ps.reason instanceof TimeoutError ? 'timeout' : 'failed');
  }
  let muniLastReport: { status: 'ok' | 'failed' | 'timeout'; date: string | null } = { status: 'failed', date: null };
  if (fs.status === 'fulfilled') {
    const f = normalizeNjFreshness(fs.value.rows);
    muniLastReport = { status: f.status, date: f.date };
    muniName = muniName ?? f.muniName;
  } else {
    console.error('[building-record] nj freshness failed:', fs.reason);
  }

  const rec = assembleNjRecord({ muniCode, block, lot, fetchedAt: today, muniName, permits, muniLastReport });
  // Only a fully answered record is cached (a failed half is retried next open).
  if (rec.permits.status === 'ok' && rec.muniLastReport.status === 'ok') {
    njRecordCache.set(cacheKey, { at: Date.now(), record: rec });
  }
  return njJson({ status: 'nj_record', record: rec });
}

// ── handler ─────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    if (req.method !== 'POST') return json({ status: 'error', code: 'bad_request', error: ERRORS.bad_request }, 405);

    const auth = await requireTier(req, ['free', 'pro', 'business', 'enterprise'], 'building_record');
    if (!auth.ok) return new Response(JSON.stringify(auth.body), { status: auth.status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });

    // Fail-OPEN when the limiter itself is down (rl < 0): the data is public
    // and costs MAGE $0, so refusing a contractor buys nothing.
    const rl = await rateLimitCount(`building_record:${auth.userId}`);
    if (rl > HOURLY_LIMIT) return json({ status: 'error', code: 'rate_limited', error: ERRORS.rate_limited }, 429);

    let body: unknown = null;
    try {
      body = await req.json();
    } catch {
      body = null;
    }
    const nj = parseNjRequest(body);
    if (nj) {
      if (nj.mode === 'nj_resolve') return await njResolve(nj.text, nj.lat, nj.lon);
      return await njRecord(nj.muniCode, nj.block, nj.lot);
    }

    const parsed = parseRequest(body);
    if (!parsed) return json({ status: 'error', code: 'bad_request', error: ERRORS.bad_request }, 400);

    switch (parsed.mode) {
      case 'resolve': return await resolve(parsed.text);
      case 'record': return await record(parsed.bin, parsed.bbl);
      case 'permit': return await permit(parsed.permitNumber);
      case 'benchmark': return await benchmark(parsed.borough);
    }
  } catch (e) {
    console.error('[building-record] error:', e);
    return json({ status: 'error', code: 'internal', error: ERRORS.internal }, 500);
  }
});
