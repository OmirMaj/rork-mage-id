// photoGeoStamp
//
// Best-effort GPS stamper for newly captured photos in the field.
//
// Why this exists
//   Construction sites have terrible cell / wifi. The marketing site claims
//   "geo-stamped photos — automatic." That used to be a lie: nothing in the
//   photo capture flow recorded coordinates. This helper closes the gap.
//
// Key fact people get wrong: GPS does NOT need internet.
//   `expo-location.getCurrentPositionAsync()` reads the device's GNSS chip
//   directly. The sat fix happens whether the app has signal or not. What
//   _does_ need internet is REVERSE GEOCODING (lat/lng → human address) and
//   uploading the resulting record to Supabase. We handle those separately:
//   reverse geocoding is opportunistic (fall back to "<lat>, <lng>" string)
//   and uploads ride the existing offline queue (`utils/offlineQueue.ts`).
//
// Behavior contract
//   - Returns `{ latitude, longitude, accuracyMeters, label }` on success.
//   - Returns `null` on permission denied, no fix, or timeout.
//   - HARD 3-SECOND TIMEOUT: we never block a photo capture waiting on GPS.
//     The user took a picture; they should see the picture, not a spinner.
//     Coords either land in time or they don't. Caller decides what to do
//     with the absence (we recommend: store the photo without coords, let
//     the user re-stamp later if they care).
//   - On web, falls back to navigator.geolocation with the same 3s budget.
//   - Logs coarse diagnostics so field issues are debuggable without PII —
//     specifically we never log full coords; only first-2-decimals (~1.1 km
//     precision, fine for "did GPS work?" but useless for stalking).
//
// We deliberately do NOT use `Accuracy.Highest`. Highest tells the chip to
// keep retrying for an exact fix, which on a foggy day at the bottom of a
// trench can take 30+ seconds. `Balanced` returns whatever the chip has
// cached + a single fresh measurement, which is what we want for photo
// metadata.

import { Platform } from 'react-native';

export interface PhotoGeoStamp {
  /** Latitude in decimal degrees. */
  latitude: number;
  /** Longitude in decimal degrees. */
  longitude: number;
  /** Reported accuracy from the OS, in meters. Higher = worse. */
  accuracyMeters?: number;
  /** Best-effort human label. Either a reverse-geocoded address or a `lat, lng` string. */
  label: string;
}

const FIX_TIMEOUT_MS = 3000;

/**
 * Read a single GPS fix with a 3-second budget. Never throws — returns null
 * on any failure path so callers can stay synchronous-feeling.
 */
export async function stampPhotoLocation(): Promise<PhotoGeoStamp | null> {
  try {
    if (Platform.OS === 'web') {
      return await readWebLocation();
    }
    return await readNativeLocation();
  } catch (err) {
    console.log('[photoGeoStamp] failed:', (err as Error)?.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Native (expo-location)
// ---------------------------------------------------------------------------

async function readNativeLocation(): Promise<PhotoGeoStamp | null> {
  // Lazy import: this file is referenced from screens that may render on web
  // first. Pulling expo-location's native binding eagerly would warn there.
  const Location = await import('expo-location');

  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    console.log('[photoGeoStamp] permission denied');
    return null;
  }

  // Race the OS fix against our timeout. expo-location does NOT respect
  // a timeout option directly — we have to do the race ourselves.
  const fix = await Promise.race<Awaited<ReturnType<typeof Location.getCurrentPositionAsync>> | null>([
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
    new Promise((resolve) => setTimeout(() => resolve(null), FIX_TIMEOUT_MS)),
  ]);

  if (!fix) {
    console.log('[photoGeoStamp] timed out waiting for fix');
    return null;
  }

  const { latitude, longitude, accuracy } = fix.coords;
  const stamp: PhotoGeoStamp = {
    latitude,
    longitude,
    accuracyMeters: accuracy ?? undefined,
    label: formatCoordsLabel(latitude, longitude),
  };

  // Reverse geocoding requires network. Skip cleanly if offline; the lat/lng
  // string we already populated is plenty.
  try {
    const reverse = await Promise.race<Awaited<ReturnType<typeof Location.reverseGeocodeAsync>> | null>([
      Location.reverseGeocodeAsync({ latitude, longitude }),
      new Promise((resolve) => setTimeout(() => resolve(null), 1500)),
    ]);
    if (reverse && reverse.length > 0) {
      const r = reverse[0];
      const parts = [
        r.streetNumber,
        r.street,
        r.city,
        r.region,
      ].filter(Boolean);
      if (parts.length > 0) stamp.label = parts.join(' ');
    }
  } catch {
    // No-op: lat/lng label is already set.
  }

  console.log('[photoGeoStamp] fix at ~', stamp.latitude.toFixed(2), stamp.longitude.toFixed(2));
  return stamp;
}

// ---------------------------------------------------------------------------
// Web (navigator.geolocation)
// ---------------------------------------------------------------------------

async function readWebLocation(): Promise<PhotoGeoStamp | null> {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
    return null;
  }
  const fix = await new Promise<GeolocationPosition | null>((resolve) => {
    let settled = false;
    const t = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, FIX_TIMEOUT_MS);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (settled) return;
        settled = true;
        clearTimeout(t);
        resolve(pos);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(t);
        resolve(null);
      },
      { enableHighAccuracy: false, maximumAge: 30_000, timeout: FIX_TIMEOUT_MS },
    );
  });

  if (!fix) return null;

  return {
    latitude: fix.coords.latitude,
    longitude: fix.coords.longitude,
    accuracyMeters: fix.coords.accuracy ?? undefined,
    label: formatCoordsLabel(fix.coords.latitude, fix.coords.longitude),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCoordsLabel(lat: number, lng: number): string {
  // 4 decimals = ~11 m precision. Plenty for "this photo was taken near
  // the southwest corner." We keep the user-facing label readable.
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}
