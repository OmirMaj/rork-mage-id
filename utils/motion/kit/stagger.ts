// stagger.ts — the kit's stagger and plateau maths, pure (imports ./kitSpec only).
//
// A list lays itself down 35 ms a row for its first 8 rows; row 9 onward lands
// with no motion at all (it is below the fold on a phone and costs frames on a
// 4K monitor). A delay is never a JS timer: it is baked into a timing's easing
// as a flat plateau (utils/levelTimeline.ts plateau(), copied here because the
// kit's pure files import nothing outside this folder).

import { KIT_MS, KIT_STAGGER } from './kitSpec';

/** Row i's entrance delay: i·ms for 0 ≤ i < cap, NULL from cap on (no motion at all). */
export function staggerDelay(i: number, cap: number = KIT_STAGGER.cap, ms: number = KIT_STAGGER.ms): number | null {
  if (!Number.isFinite(i) || i < 0 || i >= cap) return null;
  return Math.floor(i) * ms;
}

/** How long a list of n rows takes to land: (min(n, cap) − 1)·ms + enter (≤ 465 ms). */
export function sequenceMs(n: number, cap: number = KIT_STAGGER.cap, ms: number = KIT_STAGGER.ms, enter: number = KIT_MS.enter): number {
  if (!(n >= 1)) return 0;
  return (Math.min(Math.floor(n), cap) - 1) * ms + enter;
}

/** The plateau a delay takes inside one timing of delay + dur: delay / (delay + dur). */
export function plateauFraction(delay: number, dur: number): number {
  const d = Math.max(0, delay);
  const total = d + Math.max(0, dur);
  return total > 0 ? d / total : 0;
}

/** Flat at 0 until d (a delay baked into the easing), then `inner` over the rest. */
export const plateauEase = (d: number, inner: (x: number) => number) => (x: number): number => {
  if (d <= 0) return inner(x);
  if (d >= 1) return x >= 1 ? 1 : 0;
  return x < d ? 0 : inner((x - d) / (1 - d));
};
