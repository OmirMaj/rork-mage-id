// utils/geocodeProject.ts
//
// Turns a project's `location` text into the jobsite coordinates every weather
// surface reads (the Schedule tab's Gantt / Today / Lookahead strips, Schedule
// Pro's reschedule prompt, the morning digest) and the jurisdiction lookup.
//
// Strategy:
//   1. If the string looks like raw coords ("40.71, -74.01"), parse it.
//   2. Otherwise ask Nominatim (OpenStreetMap) — free, no API key, and bound by
//      its usage policy: at most ONE request per second, a real User-Agent, and
//      results cached rather than re-asked. All three are enforced HERE, in the
//      one function every caller goes through, so no caller can break them:
//      a module-wide throttle spaces network requests at least
//      NOMINATIM_MIN_INTERVAL_MS apart, identical queries in flight share one
//      request, and answers (including "not found") are cached.
//
// WHAT COUNTS AS A LOCATION (the Kansas bug, 2026-09-24). "United States" used
// to be written as the address of any job saved with a blank address field.
// Nominatim resolves it to the country's centroid near Lebanon, Kansas, and
// every weather surface then showed confident, unlabelled Kansas weather for a
// job in Houston. Two rules close that:
//   • isCountryOnlyLocation(): a country on its own ('United States', 'USA',
//     'US', …) is NO location — never geocoded, never forecast.
//   • isCoarseGeocodeResult(): a result that only pins a country or a state
//     (or anything coarser than a city, place_rank < 16) is refused, so a
//     typo that only matches "Texas" doesn't become a point in the middle of it.
//
// Failures are silent — we return null and the caller shows "no location"
// honestly. Geocoding failure never blocks a save.
//
// PURE of runtime imports on purpose: utils/weatherProvenance.ts and
// utils/weatherService.ts reach this module, and bun validators import both.

const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'MAGE ID/1.0 (https://mageid.app)';

/** Nominatim's policy is an absolute maximum of 1 request per second. The
 *  extra 100 ms keeps clock jitter on the right side of it. */
export const NOMINATIM_MIN_INTERVAL_MS = 1100;
/** "Not found" / network failures are remembered this long before the same
 *  query may hit the network again. */
export const GEOCODE_NEGATIVE_TTL_MS = 10 * 60 * 1000;
const GEOCODE_CACHE_MAX = 200;

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  /** The matched display name from the geocoder — what "Weather for …" names. */
  displayName?: string;
}

// ─────────────────────────────────────────────────────────────────────────
// What counts as a location
// ─────────────────────────────────────────────────────────────────────────

/** A country on its own names no jobsite. Compared after lower-casing and
 *  stripping dots/extra spaces, so 'U.S.A.', ' usa ' and 'United  States' all
 *  match. */
export const COUNTRY_ONLY_LOCATIONS: readonly string[] = [
  'united states',
  'united states of america',
  'the united states',
  'usa',
  'us',
  'america',
  'united states (us)',
];
// Kept identical to the copies in supabase/functions/morning-digest/index.ts
// (DIGEST_COUNTRY_ONLY) and the repair migration
// 20260924120500_clear_country_centroid_coords.sql — scripts/
// validate-weather-location.ts fails if they drift.
const COUNTRY_ONLY = new Set(COUNTRY_ONLY_LOCATIONS);

function normalizeForCompare(s: string): string {
  return s.trim().toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ');
}

/** True for 'United States', 'USA', 'US', 'U.S.', 'America' and friends. */
export function isCountryOnlyLocation(location: string | null | undefined): boolean {
  if (!location) return false;
  return COUNTRY_ONLY.has(normalizeForCompare(location));
}

/**
 * The location text worth geocoding / forecasting, or null when there is none:
 * blank, under three characters, or a country on its own.
 */
export function usableLocationText(location: string | null | undefined): string | null {
  const t = (location ?? '').trim();
  if (t.length < 3) return null;
  if (isCountryOnlyLocation(t)) return null;
  return t;
}

/** Nominatim result fields we judge precision by (format=jsonv2). */
export interface NominatimHit {
  lat?: string;
  lon?: string;
  display_name?: string;
  place_rank?: number;
  addresstype?: string;
  type?: string;
  category?: string;
}

const COARSE_ADDRESS_TYPES = new Set(['country', 'state', 'continent', 'region', 'province']);

/**
 * A hit that only pins a country or state (or anything coarser than a city)
 * is not a jobsite. place_rank per Nominatim: 4 country, 5–9 state, 10–12
 * county, 13–16 city … 26–30 street/house. A hit with no rank is judged by its
 * type alone.
 */
export function isCoarseGeocodeResult(hit: NominatimHit): boolean {
  const kind = (hit.addresstype ?? hit.type ?? '').toLowerCase();
  if (COARSE_ADDRESS_TYPES.has(kind)) return true;
  if (typeof hit.place_rank === 'number' && hit.place_rank < 16) return true;
  return false;
}

/**
 * "Park Slope, Brooklyn" from Nominatim's long display name
 * ("124, Park Slope, Brooklyn, Kings County, City of New York, New York,
 * 11215, United States"). Drops house numbers, ZIP codes, counties and the
 * country, then keeps the first two parts that remain.
 */
export function shortPlaceName(displayName: string | null | undefined): string | null {
  if (!displayName) return null;
  const parts = displayName
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .filter((p) => !/^\d[\d\s-]*$/.test(p))
    .filter((p) => !/\bcounty\b/i.test(p))
    .filter((p) => !isCountryOnlyLocation(p));
  if (parts.length === 0) return null;
  return parts.slice(0, 2).join(', ');
}

/**
 * Try to extract raw coordinates from the location string. Accepts a few
 * common shapes: "lat, lng", "lat,lng", "(lat, lng)". Returns null if the
 * string isn't a coordinate pair.
 */
function tryParseCoords(s: string): GeocodeResult | null {
  const cleaned = s.trim().replace(/^\(|\)$/g, '');
  const m = cleaned.match(/^(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lng = parseFloat(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { latitude: lat, longitude: lng };
}

// ─────────────────────────────────────────────────────────────────────────
// Throttle + cache (Nominatim usage policy)
// ─────────────────────────────────────────────────────────────────────────

interface GeocodeDeps {
  fetch: (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

const defaultDeps: GeocodeDeps = {
  fetch: (url, init) => fetch(url, init),
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

let deps: GeocodeDeps = defaultDeps;
/** Earliest moment the next network request may start. */
let nextSlotAt = 0;
const cache = new Map<string, { result: GeocodeResult | null; at: number }>();
const inFlight = new Map<string, Promise<GeocodeResult | null>>();

function cacheKey(query: string): string {
  return normalizeForCompare(query).replace(/\s*,\s*/g, ',');
}

/** Reserve the next request slot; resolves when the request may be sent. */
async function takeNetworkSlot(): Promise<void> {
  const now = deps.now();
  const startAt = Math.max(now, nextSlotAt);
  nextSlotAt = startAt + NOMINATIM_MIN_INTERVAL_MS;
  const wait = startAt - now;
  if (wait > 0) await deps.sleep(wait);
}

function remember(key: string, result: GeocodeResult | null): void {
  if (cache.size >= GEOCODE_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { result, at: deps.now() });
}

/**
 * The display name the geocoder returned for this exact location text, if it
 * was geocoded on this device this session. "Weather for …" prefers it over
 * the typed text.
 */
export function cachedPlaceName(location: string | null | undefined): string | null {
  const text = usableLocationText(location);
  if (!text) return null;
  return shortPlaceName(cache.get(cacheKey(text))?.result?.displayName);
}

async function lookup(query: string): Promise<GeocodeResult | null> {
  await takeNetworkSlot();
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: '1',
    addressdetails: '0',
  });
  try {
    const res = await deps.fetch(`${NOMINATIM_ENDPOINT}?${params.toString()}`, {
      headers: {
        // Nominatim's policy requires a real User-Agent. A browser pins its
        // own UA and drops this header; native and the edge functions send it.
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
      },
    });
    if (!res.ok) return null;
    const arr = (await res.json()) as NominatimHit[];
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const first = arr[0];
    if (isCoarseGeocodeResult(first)) return null;
    const lat = first.lat ? parseFloat(first.lat) : NaN;
    const lng = first.lon ? parseFloat(first.lon) : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { latitude: lat, longitude: lng, displayName: first.display_name };
  } catch {
    return null;
  }
}

/**
 * Geocode a free-form location string. Returns null for no usable location
 * (blank, a country on its own), a coarse match, or any failure.
 *
 * Throttled and cached module-wide, so callers need no rate limiting of their
 * own — but they should still not call it per keystroke.
 */
export async function geocodeProjectLocation(location: string): Promise<GeocodeResult | null> {
  const trimmed = usableLocationText(location);
  if (!trimmed) return null;

  const coords = tryParseCoords(trimmed);
  if (coords) return coords;

  const key = cacheKey(trimmed);
  const hit = cache.get(key);
  if (hit) {
    if (hit.result) return hit.result;
    if (deps.now() - hit.at < GEOCODE_NEGATIVE_TTL_MS) return null;
  }
  const pending = inFlight.get(key);
  if (pending) return pending;

  const p = lookup(trimmed).then((result) => {
    remember(key, result);
    inFlight.delete(key);
    return result;
  });
  inFlight.set(key, p);
  return p;
}

/** Test seam: swap the network/clock and clear throttle + cache state. */
export function __resetGeocodeForTests(overrides?: Partial<GeocodeDeps>): void {
  deps = { ...defaultDeps, ...(overrides ?? {}) };
  nextSlotAt = 0;
  cache.clear();
  inFlight.clear();
}

// ─────────────────────────────────────────────────────────────────────────
// When to geocode, and what a project's coordinates are worth
// ─────────────────────────────────────────────────────────────────────────

/**
 * Decide whether to (re-)geocode a project.
 *
 *   0. No usable location (blank, short, a country on its own) → never.
 *   1. No coords yet → geocode.
 *   2. Location string changed since last geocode → re-geocode.
 *   3. Last geocode > 90 days old → re-geocode.
 */
export function shouldGeocode(
  prevLocation: string | undefined,
  nextLocation: string | undefined,
  hasCoords: boolean,
  lastGeocodedAt: string | undefined,
): boolean {
  if (!usableLocationText(nextLocation)) return false;
  if (!hasCoords) return true;
  if (prevLocation !== nextLocation) return true;
  if (!lastGeocodedAt) return true;
  const ageMs = Date.now() - Date.parse(lastGeocodedAt);
  return Number.isFinite(ageMs) && ageMs > 90 * 24 * 60 * 60 * 1000;
}

/** Structural slice of Project this module needs (no types/ import). */
export interface GeoProjectLike {
  id: string;
  location?: string;
  locationLatitude?: number;
  locationLongitude?: number;
  locationGeocodedAt?: string;
  ownerUserId?: string;
}

export function hasProjectCoords(p: Pick<GeoProjectLike, 'locationLatitude' | 'locationLongitude'>): boolean {
  return p.locationLatitude != null && p.locationLongitude != null;
}

/** How many never-geocoded projects one app session will look up. */
export const GEOCODE_BACKFILL_MAX_PER_SESSION = 10;

/**
 * Projects that have a usable address but no coordinates — the ones that were
 * saved before geocoding existed, or whose lookup failed (The Henderson
 * Residence, 2026-09-24). Only the caller's own projects (a collaborator's
 * write would be refused), each at most once per session (`attempted`), and at
 * most `max` in total.
 */
export function pickGeocodeBackfill<P extends GeoProjectLike>(
  projects: readonly P[],
  attempted: ReadonlySet<string>,
  userId: string | null | undefined,
  max: number = GEOCODE_BACKFILL_MAX_PER_SESSION,
): P[] {
  const budget = Math.max(0, max - attempted.size);
  if (budget === 0) return [];
  const out: P[] = [];
  for (const p of projects) {
    if (out.length >= budget) break;
    if (attempted.has(p.id)) continue;
    if (p.ownerUserId && userId && p.ownerUserId !== userId) continue;
    if (hasProjectCoords(p)) continue;
    if (!usableLocationText(p.location)) continue;
    out.push(p);
  }
  return out;
}

/**
 * Projects carrying coordinates for a location that names no place — the
 * country centroid written for 'United States' before 2026-09-24. Matches the
 * scope of supabase/migrations/*_clear_country_centroid_coords.sql exactly.
 */
export function pickCountryCentroidCoords<P extends GeoProjectLike>(projects: readonly P[]): P[] {
  return projects.filter((p) => isCountryOnlyLocation(p.location) && (hasProjectCoords(p) || !!p.locationGeocodedAt));
}

/**
 * The same update with the old coordinates cleared when it changes the
 * address. Without this, an address Nominatim cannot resolve kept the OLD
 * site's coordinates and every forecast stayed on the old site. An update that
 * sets coordinates itself is left alone.
 */
export function clearCoordsOnLocationChange<U extends Partial<GeoProjectLike>>(
  prior: Pick<GeoProjectLike, 'location'> | undefined,
  updates: U,
): U {
  if (!prior) return updates;
  if (!('location' in updates)) return updates;
  if ((updates.location ?? '') === (prior.location ?? '')) return updates;
  if ('locationLatitude' in updates || 'locationLongitude' in updates) return updates;
  return { ...updates, locationLatitude: undefined, locationLongitude: undefined, locationGeocodedAt: undefined };
}

/**
 * A geocode applies only to the address it was asked about. Two quick edits
 * could resolve out of order and stamp the FIRST address's coordinates onto
 * the project after the second was saved.
 */
export function geocodeStillApplies(currentLocation: string | undefined, geocodedLocation: string | undefined): boolean {
  return (currentLocation ?? '') === (geocodedLocation ?? '');
}

export type ProjectLocationState = 'geocoded' | 'text_only' | 'blank';

/** For the digest's location-coverage card: a country on its own is blank,
 *  whatever coordinates it carries. */
export function classifyProjectLocation(p: Pick<GeoProjectLike, 'location' | 'locationLatitude' | 'locationLongitude'>): ProjectLocationState {
  if (!usableLocationText(p.location)) return 'blank';
  if (hasProjectCoords(p)) return 'geocoded';
  return 'text_only';
}
