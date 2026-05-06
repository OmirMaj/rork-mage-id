// utils/geocodeProject.ts
//
// Best-effort geocoding for a project's `location` string. Used by the
// morning-digest pipeline to fetch hyperlocal weather (OpenWeather works
// far better with lat/lng than with free-text city queries, especially
// for rural sites).
//
// Strategy:
//   1. If the string looks like raw coords ("40.71, -74.01"), parse it.
//   2. Otherwise hit Nominatim (OpenStreetMap) — free, no API key, but
//      rate-limited to 1 req/sec. We send a polite User-Agent (Nominatim
//      ToS) and cache nothing client-side; the digest function caches
//      server-side for 30 days.
//
// Failures are silent — we just return null and the caller falls back to
// "no weather in this digest." Geocoding failure is never user-visible
// because the project still saves with `location` as text.
//
// This file is imported by ProjectContext.addProject / updateProject and
// the morning-digest edge function (re-export from supabase/functions/_shared
// kept in sync).

const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'MAGE ID/1.0 (https://mageid.app)';

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  /** The matched display name from the geocoder — useful when the user
   *  typed a half-address and we want to show them "did you mean…". */
  displayName?: string;
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

/**
 * Geocode a free-form location string via Nominatim. Returns null on any
 * failure — caller should treat null as "we'll use the city-name path or
 * skip weather entirely."
 *
 * Caller is expected to debounce: don't call on every keystroke. We ship
 * this from ProjectContext.updateProject only when the location string
 * has actually changed since the last geocode.
 */
export async function geocodeProjectLocation(location: string): Promise<GeocodeResult | null> {
  const trimmed = location.trim();
  if (!trimmed || trimmed.length < 3) return null;

  const coords = tryParseCoords(trimmed);
  if (coords) return coords;

  const params = new URLSearchParams({
    q: trimmed,
    format: 'json',
    limit: '1',
    addressdetails: '0',
  });

  try {
    const res = await fetch(`${NOMINATIM_ENDPOINT}?${params.toString()}`, {
      headers: {
        // Nominatim ToS requires a real User-Agent. Web fetch may strip this
        // (browsers pin UA), but the edge-function geocode pipeline does send it.
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
      },
    });
    if (!res.ok) return null;
    const arr = (await res.json()) as Array<{ lat?: string; lon?: string; display_name?: string }>;
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const first = arr[0];
    const lat = first.lat ? parseFloat(first.lat) : NaN;
    const lng = first.lon ? parseFloat(first.lon) : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { latitude: lat, longitude: lng, displayName: first.display_name };
  } catch {
    return null;
  }
}

/**
 * Decide whether to re-geocode a project on update.
 *
 * Conditions:
 *   1. No coords yet AND we have a location string → geocode.
 *   2. Location string changed since last geocode → re-geocode.
 *   3. Last geocode > 90 days old → re-geocode (catches addresses that
 *      moved e.g. typo correction long after initial save).
 */
export function shouldGeocode(
  prevLocation: string | undefined,
  nextLocation: string | undefined,
  hasCoords: boolean,
  lastGeocodedAt: string | undefined,
): boolean {
  if (!nextLocation || nextLocation.trim().length < 3) return false;
  if (!hasCoords) return true;
  if (prevLocation !== nextLocation) return true;
  if (!lastGeocodedAt) return true;
  const ageMs = Date.now() - Date.parse(lastGeocodedAt);
  return Number.isFinite(ageMs) && ageMs > 90 * 24 * 60 * 60 * 1000;
}
