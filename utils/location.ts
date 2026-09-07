// utils/location.ts — the app's device-location hook, and the ONE rule it exists
// to enforce: nothing in here runs unless a person pressed something.
//
// WHY THIS FILE LOOKS THE WAY IT DOES (runtime audit 2026-09-06 — AI-2, NAV-04,
// VIS-11). `useUserLocation` used to end with
//
//     useEffect(() => { void requestLocation(); }, [requestLocation]);
//
// and `requestLocation` called `requestForegroundPermissionsAsync()`. Five list
// screens call this hook (discover/hire, discover/bids, discover/companies,
// mage-id-bids, nearby-rfps), so merely OPENING the MAGE ID Bids tab raised the
// iOS location alert. In the audit capture that alert went up at 9:20 on a job
// list and was still standing over the next eleven routes — the app is modal-
// blocked until it is answered.
//
// Two things were wrong with that, and both are fixed here:
//
//  1. THE PROMPT WAS A LIE IN THE MOMENT IT WAS SHOWN. The alert renders
//     app.json's NSLocationWhenInUseUsageDescription, which promised location
//     was "only read when you take a photo or stamp a row". No photo, no stamp
//     — a bids list. That is the repo's standing rule (an invented fact is
//     worse than an absent one) broken in the one sentence a contractor reads
//     before deciding. It is also a textbook App Review 5.1.1 rejection: the
//     stated purpose must match the observed trigger.
//
//  2. IT WAS ASKED FOR A FEATURE THAT COULD NOT RUN. mage-id-bids' Browse mode
//     and nearby-rfps' whole feed are behind RFP_BROWSE_ENABLED = false, and
//     discover/hire is behind HIRE_ENABLED = false — so on THREE of the five
//     screens the permission was being collected for a distance sort over rows
//     that are never fetched. Counted honestly after the 2026-09-06 review:
//     the first pass said two and left nearby-rfps still prompting.
//
// THE INVARIANT, which scripts/validate-location-consent.ts enforces:
//   • This module NEVER touches expo-location or navigator.geolocation from an
//     effect — useEffect, useLayoutEffect or useFocusEffect alike. `request()`
//     is the only door, and it is only ever wired to an onPress. There is no
//     `resumeIfGranted` back door either — a silent read on mount is still "the
//     app took a fix because you opened a screen", and the purpose string would
//     have to hedge to stay true.
//   • Wherever distance UI is LIVE, the screen renders a control that calls
//     `request()`, so the user can turn distances on when they want them. On the
//     screens whose distance feature is behind a launch flag (mage-id-bids and
//     nearby-rfps behind RFP_BROWSE_ENABLED, discover/hire behind HIRE_ENABLED)
//     the control is gated by that same flag — so while the feature cannot run,
//     no prompt can be raised for it either. That is deliberate, and the guard
//     checks the gating rather than crediting an unreachable button.
//   • Nothing may claim a distance, a radius filter or a "Nearest" sort while
//     `location` is null. Absent, not invented — see `locationDistanceNotice`.
//   • THE PURPOSE STRING IS NOT THIS FILE'S ALONE. app.json's
//     NSLocationWhenInUseUsageDescription is shown for EVERY location prompt the
//     app raises, including the ones that never come through this hook
//     (utils/photoGeoStamp.ts for photos and field-ticket signatures,
//     components/TakeoffFieldVerifyButton.tsx, app/post-rfp.tsx's Verify). The
//     guard holds a declared inventory of those call sites; a new one fails the
//     build until the string is widened to cover it.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Platform } from 'react-native';

export interface UserLocation {
  latitude: number;
  longitude: number;
}

/**
 * Where the one permission conversation currently stands.
 *
 * `idle` is the state every screen mounts in and stays in until a press —
 * it means "we have not asked, and we do not know", which is the honest
 * answer and the reason there is no `granted`-on-mount shortcut.
 */
export type LocationStatus =
  | 'idle'
  | 'requesting'
  | 'granted'
  | 'denied'
  | 'unavailable';

export function getDistanceMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

// --- BEGIN location consent copy ---
// Pure, executed by scripts/validate-location-consent.ts. Keep it import-free.

/**
 * Which denial story applies. iOS/Android denial is fixed in the OS Settings
 * app; a browser denial is fixed in the site permissions next to the URL, and
 * `openLocationSettings()` cannot reach it. Telling a web user to "open
 * Settings" would name a door that does not exist for them.
 */
export type LocationPlatform = 'native' | 'web';

/** Label for the "Use my location" control every live distance surface renders. */
export function locationControlLabel(
  status: LocationStatus,
  hasLocation: boolean,
  platform: LocationPlatform = 'native',
): string {
  if (status === 'requesting') return 'Getting location…';
  if (hasLocation) return 'Location set';
  if (status === 'denied') {
    return platform === 'web'
      ? 'Location blocked — allow it in your browser'
      : 'Location off — open Settings';
  }
  if (status === 'unavailable') return 'Location unavailable';
  return 'Use my location';
}

/**
 * What pressing that control should do.
 *
 * A hard native denial cannot be re-prompted — iOS returns `denied` without
 * showing an alert — so the only useful press is a jump to Settings. On web
 * there is no Settings row to jump to, and a browser CAN re-prompt once the
 * user resets the site permission, so the press stays a request.
 */
export function locationControlAction(
  status: LocationStatus,
  platform: LocationPlatform = 'native',
): 'request' | 'openSettings' {
  return status === 'denied' && platform === 'native' ? 'openSettings' : 'request';
}

/**
 * What the screen must say when it is showing a distance-shaped UI (a radius
 * filter, a "Near me" mode, a "Nearest" sort) with no location behind it.
 *
 * `null` means there is nothing to disclose — we have a fix, the distances on
 * screen are real. Every other branch names what is missing rather than
 * letting the list imply an ordering it does not have. None of these may
 * describe the list as near, close, nearest or sorted: with no fix the app has
 * measured nothing, and a hedged claim is still a claim.
 */
export function locationDistanceNotice(
  status: LocationStatus,
  hasLocation: boolean,
  platform: LocationPlatform = 'native',
): string | null {
  if (hasLocation) return null;
  if (status === 'requesting') return 'Getting your location…';
  if (status === 'denied') {
    return platform === 'web'
      ? 'Location is blocked for this site, so nothing here is sorted or filtered by distance. Allow it in your browser to use distance.'
      : 'Location is off for MAGE ID, so nothing here is sorted or filtered by distance. Turn it on in Settings to use distance.';
  }
  if (status === 'unavailable') {
    return 'This device could not return a location, so nothing here is sorted or filtered by distance.';
  }
  return 'Distances are off. Tap Use my location to sort and filter by how far away things are.';
}
// --- END location consent copy ---

/**
 * Which denial copy this build should use. Lives outside the copy block because
 * it needs `Platform`; screens pass it into the two copy functions.
 */
export const LOCATION_PLATFORM: LocationPlatform = Platform.OS === 'web' ? 'web' : 'native';

/** Deep-link to the app's own row in iOS/Android settings. No-op on web. */
export function openLocationSettings(): void {
  if (Platform.OS === 'web') return;
  Linking.openSettings().catch(() => {});
}

function readWebPosition(): Promise<UserLocation> {
  return new Promise<UserLocation>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      reject,
      { enableHighAccuracy: false, timeout: 10000 },
    );
  });
}

/**
 * Device location for distance sorting.
 *
 * Mounting this hook does NOTHING — no permission check, no fix, no prompt.
 * `request()` is the only thing that reaches the OS, and it must be called
 * from a press handler. Wiring it into a `useEffect` re-creates the audit bug
 * and fails `bun run test:location-consent`.
 */
export function useUserLocation() {
  const [location, setLocation] = useState<UserLocation | null>(null);
  const [status, setStatus] = useState<LocationStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  // The iOS alert can sit unanswered for minutes (three, in the audit capture),
  // and the user can leave the tab while it is up. Drop the result rather than
  // setting state into an unmounted tree.
  const alive = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const request = useCallback(async () => {
    // Double-tap while the alert is up must not stack two OS requests.
    if (inFlight.current) return;
    inFlight.current = true;
    setStatus('requesting');
    setError(null);
    try {
      if (Platform.OS === 'web') {
        if (!('geolocation' in navigator)) {
          if (alive.current) {
            setStatus('unavailable');
            setError('Geolocation is not supported by this browser');
          }
          return;
        }
        const pos = await readWebPosition();
        if (!alive.current) return;
        setLocation(pos);
        setStatus('granted');
      } else {
        const Location = await import('expo-location');
        const { status: perm } = await Location.requestForegroundPermissionsAsync();
        if (perm !== 'granted') {
          if (alive.current) {
            setStatus('denied');
            setError('Location permission denied');
          }
          return;
        }
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (!alive.current) return;
        setLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
        setStatus('granted');
      }
    } catch (err) {
      const message = (err as Error)?.message ?? 'Failed to get location';
      // GeolocationPositionError.PERMISSION_DENIED === 1. The browser rejects
      // through the same channel as a real failure, and collapsing the two told
      // a user who pressed Block that "this device could not return a location"
      // — the wrong cause, and no route back. `code` is checked on web only;
      // expo-location rejects with plain Errors that carry no such field.
      const code = (err as { code?: number } | null)?.code;
      const blockedByBrowser = Platform.OS === 'web' && code === 1;
      console.log('[Location] request failed:', blockedByBrowser ? 'blocked by browser' : message);
      if (alive.current) {
        setStatus(blockedByBrowser ? 'denied' : 'unavailable');
        setError(blockedByBrowser ? 'Location permission denied' : message);
      }
    } finally {
      inFlight.current = false;
    }
  }, []);

  return {
    location,
    status,
    /** True only while a request the user started is in flight. Never true on mount. */
    loading: status === 'requesting',
    error,
    request,
  };
}
