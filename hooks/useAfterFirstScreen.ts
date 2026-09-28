// hooks/useAfterFirstScreen.ts — false until the first screen is up, then true
// for the rest of the launch (IDEAS-1 · SPEED S2). Also home of the ONE
// module-level first-screen signal that utils/startupTiming.ts shares.
//
// A provider ANDs useAfterFirstScreen() into its FIRST load only (react-query
// `enabled`, or an effect that waits), so the less important reads stop
// competing with the first screen's on a weak signal. Once true it never goes
// back to false, so the provider's later refetches are unchanged.
//
// The signal flips on the FIRST of:
//   1. releaseFirstScreen() — utils/startupTiming markFirstUseful (Home, SPEED-3);
//   2. "after interactions" — utils/startupTiming registers
//      InteractionManager.runAfterInteractions as the scheduler when it loads
//      (app/_layout.tsx imports it first, SPEED-2); armed when the first
//      deferred provider mounts, i.e. when the root mounts;
//   3. the hard cap: FIRST_SCREEN_CAP_MS after THIS module first loaded.
// It cannot stay false forever: isFirstScreenShown() reads the clock, so it
// answers true once the cap has passed even if no timer ever fired. A missing
// patch can only delay a deferred load by 1.5 s, never block it.
//
// Imports React only — no react-native — on purpose: contexts/BidsContext.tsx
// imports this, and scripts/validate-w5-rfp-marketplace-feed.ts loads
// BidsContext under bun, which cannot parse react-native.
import { useEffect, useState } from 'react';

/** The deferred loads never wait longer than this after this module loaded. */
export const FIRST_SCREEN_CAP_MS = 1500;

let moduleLoadedAt = Date.now();
let firstScreenShown = false;
let armed = false;
let capTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
type AfterInteractions = (fn: () => void) => void;
let afterInteractions: AfterInteractions | null = null;

/** Flip the signal (idempotent) and tell every waiting provider. */
export function releaseFirstScreen(): void {
  if (firstScreenShown) return;
  firstScreenShown = true;
  if (capTimer) { clearTimeout(capTimer); capTimer = null; }
  const toCall = [...listeners];
  listeners.clear();
  for (const fn of toCall) {
    try { fn(); } catch (err) { console.log('[firstScreen] listener failed:', err); }
  }
}

/** True once the first screen is up — or once the cap has passed, whatever happened. */
export function isFirstScreenShown(): boolean {
  if (!firstScreenShown && Date.now() - moduleLoadedAt >= FIRST_SCREEN_CAP_MS) releaseFirstScreen();
  return firstScreenShown;
}

/** utils/startupTiming registers InteractionManager.runAfterInteractions here. */
export function setAfterInteractionsScheduler(fn: AfterInteractions | null): void {
  afterInteractions = fn;
}

/** Arms the cap timer (deadline measured from MODULE LOAD) and the after-interactions release, once. */
function arm(): void {
  if (armed || firstScreenShown) return;
  armed = true;
  const remaining = Math.max(0, FIRST_SCREEN_CAP_MS - (Date.now() - moduleLoadedAt));
  capTimer = setTimeout(releaseFirstScreen, remaining);
  if (afterInteractions) {
    try {
      afterInteractions(releaseFirstScreen);
    } catch (err) {
      console.log('[firstScreen] after-interactions scheduling failed; the cap still releases:', err);
    }
  }
}

/** Call `fn` once when the signal flips (at once if it already has). Returns an unsubscribe. */
export function subscribeFirstScreen(fn: () => void): () => void {
  if (isFirstScreenShown()) {
    fn();
    return () => {};
  }
  listeners.add(fn);
  arm();
  return () => { listeners.delete(fn); };
}

export function useAfterFirstScreen(): boolean {
  const [shown, setShown] = useState<boolean>(isFirstScreenShown);
  useEffect(() => {
    if (shown) return;
    return subscribeFirstScreen(() => setShown(true));
  }, [shown]);
  return shown;
}

/** Test-only: a fresh launch (the scheduler registration is kept). */
export function __resetFirstScreenSignalForTests(): void {
  moduleLoadedAt = Date.now();
  firstScreenShown = false;
  armed = false;
  if (capTimer) { clearTimeout(capTimer); capTimer = null; }
  listeners.clear();
}
