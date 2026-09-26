// launchCurtain.ts — the cold-start hand-off between BrandSplash and the first
// screen (slick round 3, lane A1).
//
// A tiny module store: no React context, memory only (never AsyncStorage — the
// curtain is a property of THIS process's launch, not of the account).
//
// Phases:
//   'open'     — no splash. The DEFAULT: jest, a hot reload and every screen
//                mounted after the splash see this, and nothing arms.
//   'covered'  — the ink splash is over the app. A screen that mounts now
//                arms its entrance (it is under the ink, so nothing flashes).
//   'lifting'  — the splash has started its exit: the entrance runs.
//   'landed'   — the splash wordmark has reached the screen's own wordmark;
//                the screen shows its real one beneath the cross-fade.
//
// NOTHING CAN STAY HIDDEN. A non-'open' phase goes stale LAUNCH_STALE_MS after
// the last 'covered' (the clock read in getLaunchPhase), and a heal timer
// NOTIFIES subscribers at that moment, so a splash that never mounts, a hot
// reload mid-launch or a crashed exit always ends at 'open' with a re-render.

import { useSyncExternalStore } from 'react';
import { Dimensions } from 'react-native';

export type LaunchPhase = 'open' | 'covered' | 'lifting' | 'landed';

export interface LaunchRect { x: number; y: number; width: number; height: number }

/** Longer than BrandSplash's SPLASH_MAX_LIFETIME_MS (3000). */
export const LAUNCH_STALE_MS = 3500;

let phase: LaunchPhase = 'open';
let coveredAt = 0;
let bootReady = false;
let target: LaunchRect | null = null;
let healTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((fn) => {
    try { fn(); } catch { /* a listener must never break the others */ }
  });
}

function clearHeal(): void {
  if (healTimer != null) {
    clearTimeout(healTimer);
    healTimer = null;
  }
}

function heal(): void {
  healTimer = null;
  if (phase !== 'open') {
    phase = 'open';
    notify();
  }
}

function armHeal(): void {
  clearHeal();
  const wait = Math.max(0, LAUNCH_STALE_MS - (Date.now() - coveredAt)) + 50;
  healTimer = setTimeout(heal, wait);
}

/** The current phase; 'open' once the curtain has gone stale. */
export function getLaunchPhase(): LaunchPhase {
  if (phase !== 'open' && Date.now() - coveredAt > LAUNCH_STALE_MS) return 'open';
  return phase;
}

export function setLaunchPhase(p: LaunchPhase): void {
  phase = p;
  if (p === 'open') {
    clearHeal();
  } else {
    if (p === 'covered') coveredAt = Date.now();
    armHeal();
  }
  notify();
}

/** The app tree renders under the NATIVE splash before BrandSplash mounts. */
export function markLaunchPending(): void {
  setLaunchPhase('covered');
}

export function subscribeLaunch(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function useLaunchPhase(): LaunchPhase {
  return useSyncExternalStore(subscribeLaunch, getLaunchPhase, () => 'open' as LaunchPhase);
}

/** RootLayoutNav's `!bootstrapping`: auth, projects and onboarding state read. */
export function setBootReady(v: boolean): void {
  if (v === bootReady) return;
  bootReady = v;
  notify();
}

export function getBootReady(): boolean {
  return bootReady;
}

/** Window rect of the screen's own "MAGE ID" wordmark; last writer wins. */
export function registerLaunchTarget(rect: LaunchRect | null): void {
  if (rect) {
    const win = Dimensions.get('window');
    const bad = ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
      || rect.width <= 0
      || rect.height <= 0
      || rect.x + rect.width <= 0
      || rect.y + rect.height <= 0
      || rect.x >= win.width
      || rect.y >= win.height;
    if (bad) return;
  }
  target = rect;
  notify();
}

export function getLaunchTarget(): LaunchRect | null {
  return target;
}

export function __resetLaunchCurtainForTests(): void {
  clearHeal();
  phase = 'open';
  coveredAt = 0;
  bootReady = false;
  target = null;
  listeners.clear();
}
