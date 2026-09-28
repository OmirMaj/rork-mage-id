// utils/growthAttribution.ts — which outsider page brought a sign-up (T6).
//
// A visitor who follows a "Built with MAGE ID" link lands on mageid.app with
// ?ref=<surface>; marketing/growth.js carries that ref onto every link into
// app.mageid.app. Here the app picks it up on web, keeps it on the device, and
// AuthContext adds it to the user_signed_up event.
//
// Stored under mageid_growth_ref. It is only ever an allow-listed surface name
// (parseGrowthRef), never anything personal. mageid_* is swept on a tenant switch,
// which is fine: the value is read at sign-up, before any sweep in that flow.
//
// The newest ref wins (a later arrival overwrites an earlier one). Every read and
// write is wrapped: attribution must never break a screen or a sign-up.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking, Platform } from 'react-native';
import { growthLink, parseGrowthRef, isGrowthSurface, type GrowthSurface } from '@/utils/growthLink';

export { parseGrowthRef };

export const GROWTH_REF_KEY = 'mageid_growth_ref';

export async function persistGrowthRef(ref: GrowthSurface): Promise<void> {
  if (!isGrowthSurface(ref)) return;
  try {
    await AsyncStorage.setItem(GROWTH_REF_KEY, ref);
  } catch {
    // Attribution is best-effort. A full or blocked store loses one label.
  }
}

/** The stored ref, re-checked against the allow-list (disk is not trusted). */
export async function readGrowthRef(): Promise<GrowthSurface | null> {
  try {
    const raw = await AsyncStorage.getItem(GROWTH_REF_KEY);
    return isGrowthSurface(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Web only: read ?ref= off the page address and keep it. Used on first load
 * (app/_layout.tsx, next to the ?plan= handoff) and on the sign-up screen.
 * Nothing is written when the address has no allow-listed ref.
 */
export function captureGrowthRefFromLocation(): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  try {
    const ref = parseGrowthRef(new URLSearchParams(window.location.search));
    if (ref) void persistGrowthRef(ref);
  } catch {
    // A page with no readable location keeps no ref.
  }
}

/**
 * Open the growth link for one outsider page.
 *
 * On web the link opens in a new tab with 'noopener,noreferrer': the browser
 * sends no Referer, so the address of the page the visitor was on (which can
 * carry their private link) never reaches the landing page or its analytics.
 * React Native Web's <Text href> cannot set referrerPolicy, which is why this
 * goes through window.open. On iPhone and Android it opens the system browser,
 * which sends no Referer from an app.
 */
export function openGrowthLink(surface: GrowthSurface): void {
  const url = growthLink(surface);
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  Linking.openURL(url).catch(() => {});
}
