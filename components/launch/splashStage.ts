// splashStage.ts — what the launch splash has SHOWN so far, published by
// BrandSplash and adopted by BootShell (lane LAUNCH).
//
// BrandSplash is the ONLY owner of the launch timeline (coming alive at 400 ms,
// the wordmark at 500 ms, the hue shift). BootShell sits under it as a STILL
// replica of the native splash and does nothing on its own clock — if it did,
// the frames between the native splash leaving and BrandSplash's first paint
// (and the failsafe hand-back) would show a seeking bubble that BrandSplash then
// snaps back to centre. When BrandSplash finishes while the app is still not
// ready, BootShell ADOPTS these flags in the same commit: amp 1 at once if the
// splash was alive, the wordmark at rest if the splash showed it, the hue if it
// had shifted. Same ink, same level, same shared clock phase — no restart.
//
// Pure TypeScript: NO react-native import (React only, for the hook), so a bun
// validator can import it. Memory only; a property of THIS process's launch.

import { useSyncExternalStore } from 'react';

export type SplashStage = {
  /** The bubble has begun to seek (amp is leaving 0). */
  alive: boolean;
  /** The "MAGE ID" wordmark has begun to show. */
  wordmark: boolean;
  /** The hue layer has begun to mix in (the user's accent is not the baked orange). */
  hue: boolean;
  /** BrandSplash has handed back (finish() ran). */
  finished: boolean;
};

const INITIAL: SplashStage = { alive: false, wordmark: false, hue: false, finished: false };

let stage: SplashStage = INITIAL;
const listeners = new Set<() => void>();

export function getSplashStage(): SplashStage {
  return stage;
}

/** Merge a patch; notifies only when a flag actually changes (a new object then, for useSyncExternalStore). */
export function setSplashStage(patch: Partial<SplashStage>): void {
  let changed = false;
  for (const key of Object.keys(patch) as (keyof SplashStage)[]) {
    const v = patch[key];
    if (typeof v === 'boolean' && v !== stage[key]) { changed = true; break; }
  }
  if (!changed) return;
  const next: SplashStage = { ...stage };
  for (const key of Object.keys(patch) as (keyof SplashStage)[]) {
    const v = patch[key];
    if (typeof v === 'boolean') next[key] = v;
  }
  stage = next;
  listeners.forEach((fn) => {
    try { fn(); } catch { /* a listener must never break the others */ }
  });
}

export function subscribeSplashStage(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function useSplashStage(): SplashStage {
  return useSyncExternalStore(subscribeSplashStage, getSplashStage, getSplashStage);
}

/** The wordmark's container height and the gap between its bottom edge and the level's vertical centre (pt). */
export const SPLASH_WORDMARK_H = 32;
export const SPLASH_WORDMARK_GAP = 28;

/**
 * The ONE wordmark box BrandSplash and BootShell both use: full width, 32 pt
 * tall, its BOTTOM edge 28 pt above the level's vertical centre — so the level
 * never leaves the native splash's exact centre to make room for it.
 */
export function splashWordmarkBox(rect: { markTop: number; markH: number }): { top: number; height: number; left: number; right: number } {
  return {
    top: rect.markTop + rect.markH / 2 - SPLASH_WORDMARK_GAP - SPLASH_WORDMARK_H,
    height: SPLASH_WORDMARK_H,
    left: 0,
    right: 0,
  };
}

export function __resetSplashStageForTests(): void {
  stage = INITIAL;
  listeners.clear();
}
