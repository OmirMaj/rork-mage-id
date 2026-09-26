// place-lookup — which town, village or city a NY / NJ / CT jobsite is in.
//
// POST { address, lat?, lon? }
//   → { status: 'ok', state, county, town, incorporatedPlace, cdp,
//       match: 'address' | 'approximate' | 'none', matchedAddress, source, asOf }
//   → { status: 'error', code, error }   (a fixed sentence; nothing was looked up)
//
// 1. The US Census geocoder, /geographies/onelineaddress (benchmark
//    Public_AR_Current, vintage Current_Current, layers County Subdivisions,
//    Incorporated Places, Census Designated Places, Counties) → match 'address'.
// 2. No address match, and the project has a map pin (the Nominatim point
//    utils/geocodeProject.ts already saved) → /geographies/coordinates at that
//    point → match 'approximate'. The client says "from the map pin — confirm".
// 3. Neither → match 'none', every geography null. So does an address Census
//    places outside NY / NJ / CT: this function only answers for the tristate.
// An upstream failure is an ERROR, never 'none' — "Census didn't answer" must
// not read as "Census found nothing", and the client never caches an error.
//
// Everything it reads is PUBLIC and costs MAGE $0, so it is free for every
// tier. JWT stays on (supabase/config.toml) so the rate limit has a user to key
// on. Deploy: supabase functions deploy place-lookup
//
// The pure helpers are exported so scripts/validate-permit-offices.ts can drive
// them under bun with a stubbed Deno global.

import { requireTier, rateLimitCount } from '../_shared/auth.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const HOURLY_LIMIT = 120;
const UPSTREAM_TIMEOUT_MS = 8000;
const CENSUS_BASE = 'https://geocoding.geo.census.gov/geocoder/geographies';
export const CENSUS_LAYERS = 'County Subdivisions,Incorporated Places,Census Designated Places,Counties';
export const CENSUS_SOURCE = 'US Census Geocoder (Public_AR_Current, Current_Current)';

export const ERRORS = {
  bad_request: 'Send an address (and optionally the map pin) to look up.',
  rate_limited: 'Too many place lookups this hour. Try again later.',
  upstream: "The Census geocoder didn't answer, so nothing was looked up. Try again later.",
  internal: 'Something went wrong looking up this place. Nothing was looked up.',
} as const;
type ErrorCode = keyof typeof ERRORS;

/** Census state FIPS → the three states this function answers for. */
export const TRISTATE_FIPS: Readonly<Record<string, 'NY' | 'NJ' | 'CT'>> = { '36': 'NY', '34': 'NJ', '09': 'CT' };

export interface PlaceRequest { address: string; lat: number | null; lon: number | null }
export interface PlaceUnit { name: string; basename: string; geoid: string; kind: string }
export interface PlaceAnswer {
  status: 'ok';
  state: 'NY' | 'NJ' | 'CT' | null;
  county: { name: string; geoid: string } | null;
  town: PlaceUnit | null;
  incorporatedPlace: PlaceUnit | null;
  cdp: PlaceUnit | null;
  match: 'address' | 'approximate' | 'none';
  matchedAddress: string | null;
  source: string;
  asOf: string;
}
type ErrorBody = { status: 'error'; code: ErrorCode; error: string };

// ── pure helpers ────────────────────────────────────────────────────────────

/** Validate the body. The address is trimmed, stripped of control
 *  characters and capped; a pin is kept only when both halves are finite and
 *  in range. Anything else is null (→ 400). */
export function parseRequest(body: unknown): PlaceRequest | null {
  if (!body || typeof body !== 'object') return null;
  const o = body as Record<string, unknown>;
  if (typeof o.address !== 'string') return null;
  // deno-lint-ignore no-control-regex
  const address = o.address.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (address.length < 3) return null;
  const lat = typeof o.lat === 'number' && Number.isFinite(o.lat) && Math.abs(o.lat) <= 90 ? o.lat : null;
  const lon = typeof o.lon === 'number' && Number.isFinite(o.lon) && Math.abs(o.lon) <= 180 ? o.lon : null;
  return { address, lat: lat !== null && lon !== null ? lat : null, lon: lat !== null && lon !== null ? lon : null };
}

function censusParams(): URLSearchParams {
  return new URLSearchParams({
    benchmark: 'Public_AR_Current',
    vintage: 'Current_Current',
    layers: CENSUS_LAYERS,
    format: 'json',
  });
}

export function censusAddressUrl(address: string): string {
  const p = censusParams();
  p.set('address', address);
  return `${CENSUS_BASE}/onelineaddress?${p.toString()}`;
}

export function censusCoordinatesUrl(lat: number, lon: number): string {
  const p = censusParams();
  p.set('x', lon.toFixed(6));
  p.set('y', lat.toFixed(6));
  return `${CENSUS_BASE}/coordinates?${p.toString()}`;
}

/** One Census layer row → a PlaceUnit; `kind` is the type word Census puts
 *  after the base name ("Garden City village" → 'village'). */
export function unitFrom(row: unknown): PlaceUnit | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const name = typeof r.NAME === 'string' ? r.NAME.trim() : '';
  const basename = typeof r.BASENAME === 'string' ? r.BASENAME.trim() : '';
  const geoid = typeof r.GEOID === 'string' ? r.GEOID.trim() : '';
  if (!name || !basename || !/^\d{5,12}$/.test(geoid)) return null;
  if (/not defined/i.test(name)) return null;
  const kind = name.startsWith(basename) ? name.slice(basename.length).trim() : '';
  return { name, basename, geoid, kind };
}

function firstRow(geos: Record<string, unknown>, layer: string): unknown {
  const v = geos[layer];
  return Array.isArray(v) && v.length ? v[0] : null;
}

export function noneAnswer(asOf: string): PlaceAnswer {
  return {
    status: 'ok', state: null, county: null, town: null, incorporatedPlace: null, cdp: null,
    match: 'none', matchedAddress: null, source: CENSUS_SOURCE, asOf,
  };
}

/** A Census `geographies` object → the answer. Outside NY / NJ / CT, or with
 *  no county at all, it is 'none'. */
export function answerFromGeographies(
  geographies: unknown,
  match: 'address' | 'approximate',
  matchedAddress: string | null,
  asOf: string,
): PlaceAnswer {
  if (!geographies || typeof geographies !== 'object') return noneAnswer(asOf);
  const g = geographies as Record<string, unknown>;
  const countyRow = firstRow(g, 'Counties') as Record<string, unknown> | null;
  const fips = countyRow && typeof countyRow.STATE === 'string' ? countyRow.STATE : '';
  const state = TRISTATE_FIPS[fips] ?? null;
  const county = unitFrom(countyRow);
  if (!state || !county || !/^\d{5}$/.test(county.geoid)) return noneAnswer(asOf);
  return {
    status: 'ok',
    state,
    county: { name: county.name, geoid: county.geoid },
    town: unitFrom(firstRow(g, 'County Subdivisions')),
    incorporatedPlace: unitFrom(firstRow(g, 'Incorporated Places')),
    cdp: unitFrom(firstRow(g, 'Census Designated Places')),
    match,
    matchedAddress: matchedAddress ? matchedAddress.slice(0, 200) : null,
    source: match === 'approximate' ? `${CENSUS_SOURCE}, at the project's map pin` : CENSUS_SOURCE,
    asOf,
  };
}

/** The onelineaddress body → its first match, or null when Census matched
 *  nothing. Throws on a body that isn't a geocoder answer at all. */
export function firstAddressMatch(body: unknown): { geographies: unknown; matchedAddress: string | null } | null {
  const result = (body as { result?: { addressMatches?: unknown } } | null)?.result;
  if (!result || !Array.isArray(result.addressMatches)) throw new Error('not a geocoder answer');
  const m = result.addressMatches[0] as { geographies?: unknown; matchedAddress?: unknown } | undefined;
  if (!m) return null;
  return { geographies: m.geographies, matchedAddress: typeof m.matchedAddress === 'string' ? m.matchedAddress : null };
}

/** The coordinates body → its geographies. Throws on a malformed body. */
export function coordinateGeographies(body: unknown): unknown {
  const result = (body as { result?: { geographies?: unknown } } | null)?.result;
  if (!result || !result.geographies || typeof result.geographies !== 'object') throw new Error('not a geocoder answer');
  return result.geographies;
}

// ── I/O ─────────────────────────────────────────────────────────────────────

function json(body: PlaceAnswer | ErrorBody, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}
const fail = (code: ErrorCode, status: number) => json({ status: 'error', code, error: ERRORS[code] }, status);

async function getJson(url: string): Promise<unknown> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: ac.signal });
    if (!res.ok) throw new Error(`census ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function lookup(req: PlaceRequest, get: (url: string) => Promise<unknown> = getJson): Promise<PlaceAnswer | null> {
  const asOf = new Date().toISOString();
  let addressFailed = false;
  try {
    const hit = firstAddressMatch(await get(censusAddressUrl(req.address)));
    if (hit) return answerFromGeographies(hit.geographies, 'address', hit.matchedAddress, asOf);
  } catch (e) {
    console.error('[place-lookup] address call failed:', e);
    addressFailed = true;
  }
  if (req.lat !== null && req.lon !== null) {
    try {
      return answerFromGeographies(coordinateGeographies(await get(censusCoordinatesUrl(req.lat, req.lon))), 'approximate', null, asOf);
    } catch (e) {
      console.error('[place-lookup] coordinates call failed:', e);
      return null;
    }
  }
  // null = Census never answered (an error); 'none' = it answered "no match".
  return addressFailed ? null : noneAnswer(asOf);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  try {
    if (req.method !== 'POST') return fail('bad_request', 405);

    const auth = await requireTier(req, ['free', 'pro', 'business', 'enterprise'], 'place_lookup');
    if (!auth.ok) return new Response(JSON.stringify(auth.body), { status: auth.status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });

    // Fail-OPEN when the limiter itself is down (rl < 0): the data is public
    // and costs MAGE $0, so refusing a contractor buys nothing.
    const rl = await rateLimitCount(`place_lookup:${auth.userId}`);
    if (rl > HOURLY_LIMIT) return fail('rate_limited', 429);

    let body: unknown = null;
    try { body = await req.json(); } catch { body = null; }
    const parsed = parseRequest(body);
    if (!parsed) return fail('bad_request', 400);

    const answer = await lookup(parsed);
    return answer ? json(answer) : fail('upstream', 502);
  } catch (e) {
    console.error('[place-lookup] error:', e);
    return fail('internal', 500);
  }
});
