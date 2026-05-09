// Geofence helpers — power the on-site / off-site detection that gates
// clock-in. Pre-fix `app/time-tracking.tsx` had no expo-location usage
// at all, so a worker could clock in from their living room. This
// module is the math + capture primitive; the screen layer calls
// `getCurrentLocation()` and `distanceToProject()` on demand.
//
// Why no continuous tracking?
//   - Battery drain: continuous foreground location costs ~3% / hour
//     on iPhone. We only need a one-shot reading at clock-in / clock-out.
//   - Privacy: subs and homeowners are skeptical of "always tracking"
//     apps. A point-in-time GPS at clock-in matches the audit trail
//     payroll software like Workyard / Raken provides — no more, no
//     less.
//
// Permission policy:
//   - Request `Location.requestForegroundPermissionsAsync` lazily on
//     first geofence call. Don't gate clock-in on permission — if the
//     user denies, we still let them clock in but flag the row as
//     "self-reported, no GPS confirmation."
//   - Background permission (constant tracking) is never requested —
//     it requires a justification string in app.json and Apple
//     reviewers reject construction-app submissions that ask for it
//     without continuous-tracking value.

import * as Location from 'expo-location';
import { Platform } from 'react-native';

export interface GeoPoint {
  latitude: number;
  longitude: number;
  /** Reported accuracy in meters. Higher = less precise. Useful for
   *  filtering "junk" fixes (>200m) where GPS fell back to wifi/IP. */
  accuracy?: number;
  /** When the fix was taken. Surfaced on the time-entry row so an
   *  audit can verify the GPS was contemporaneous with clock-in. */
  timestamp: string;
}

export interface GeofenceResult {
  /** Distance from the device to the geofence anchor, in meters.
   *  null when we couldn't get a fix (denied permission, indoor with
   *  no reception, web platform). */
  distanceMeters: number | null;
  /** True iff distance <= radius. False or null still allows clock-in
   *  — it just gets flagged on the entry. */
  withinFence: boolean;
  /** The fix we used (null if not available). */
  point: GeoPoint | null;
  /** Human-readable label: "On site", "0.4 mi away", "GPS unavailable".
   *  Drives the chip below each project in the clock-in picker. */
  label: string;
}

const EARTH_RADIUS_METERS = 6_371_000;

/**
 * Great-circle distance between two lat/lng points using the
 * Haversine formula. Returns meters. ~0.5% accurate for the
 * sub-100km distances every construction site falls within.
 */
export function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

/**
 * Format a distance in meters as a human-friendly label. Uses imperial
 * by default (US construction market); short distances drop to "On
 * site" once under the geofence radius.
 */
export function formatDistance(meters: number, radius: number): string {
  if (meters <= radius) return 'On site';
  const miles = meters / 1609.34;
  if (miles < 0.1) return `${Math.round(meters)} m away`;
  if (miles < 1) return `${(miles * 5280).toFixed(0)} ft away`;
  if (miles < 10) return `${miles.toFixed(1)} mi away`;
  return `${Math.round(miles)} mi away`;
}

/**
 * Get a one-shot location reading. Returns null when:
 *   - User denied permission
 *   - Web platform (browser geolocation works but the construction
 *     workflow is mobile-first; we skip web to keep the surface small)
 *   - The OS couldn't get a fix in 8 seconds
 *
 * The 8s timeout matches Apple's native dictation cancel timeout —
 * any longer and the worker abandons the screen.
 */
export async function getCurrentLocation(): Promise<GeoPoint | null> {
  if (Platform.OS === 'web') return null;
  try {
    const { status: existing } = await Location.getForegroundPermissionsAsync();
    let granted = existing === 'granted';
    if (!granted) {
      const { status } = await Location.requestForegroundPermissionsAsync();
      granted = status === 'granted';
    }
    if (!granted) return null;

    // Race the location fetch against an 8s timeout so the UI never
    // hangs. Balanced accuracy is plenty for "are you within 500m of
    // the site" — High precision burns battery and rarely matters.
    const fetchPromise = Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), 8000),
    );
    const result = await Promise.race([fetchPromise, timeoutPromise]);
    if (!result) return null;

    return {
      latitude: result.coords.latitude,
      longitude: result.coords.longitude,
      accuracy: result.coords.accuracy ?? undefined,
      timestamp: new Date(result.timestamp).toISOString(),
    };
  } catch (err) {
    console.log('[geofence] getCurrentLocation failed:', err);
    return null;
  }
}

/**
 * High-level helper — combine "where am I" with "where's the project"
 * into the result the clock-in UI consumes. Default radius is 500m,
 * which covers a small jobsite plus its parking + adjacent street;
 * tune up for large commercial sites via the third arg.
 */
export async function checkGeofence(
  projectLatLng: { latitude: number; longitude: number } | null,
  radiusMeters: number = 500,
): Promise<GeofenceResult> {
  const point = await getCurrentLocation();
  if (!point) {
    return {
      distanceMeters: null,
      withinFence: false,
      point: null,
      label: 'GPS unavailable',
    };
  }
  if (!projectLatLng) {
    // Project has no geocoded coords — we have a fix but no anchor to
    // compare against. Stamp the entry with the point so payroll has
    // an audit trail, but we can't say "on site / off site."
    return {
      distanceMeters: null,
      withinFence: false,
      point,
      label: 'No project location set',
    };
  }
  const meters = haversineMeters(
    point.latitude, point.longitude,
    projectLatLng.latitude, projectLatLng.longitude,
  );
  return {
    distanceMeters: meters,
    withinFence: meters <= radiusMeters,
    point,
    label: formatDistance(meters, radiusMeters),
  };
}
