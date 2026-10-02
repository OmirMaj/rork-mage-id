// accumulate.ts — Accumulating Cards and Counter, pure (imports ./kitSpec only).
//
// The counter never tweens money digit by digit. It shows the REAL partial
// sums S1…Sn in integer cents, one step per landed card, and it always ends on
// the real total. Six steps at most: from the sixth card on, the cards land
// together and the sixth step IS the total.

import { KIT_CAPS, KIT_MS } from './kitSpec';

/** A part as integer cents (non-finite → 0; a fraction of a cent is rounded). */
export function toCents(x: number): number {
  return Number.isFinite(x) ? Math.round(x) : 0;
}

/** S1…Sn: the running totals of the parts, in integer cents. The last one is the total. */
export function partialSums(parts: readonly number[]): number[] {
  const out: number[] = [];
  let sum = 0;
  for (const p of parts) {
    sum += toCents(p);
    out.push(sum);
  }
  return out;
}

/** The sums the counter actually shows: all of them up to `cap`, else the first cap−1 then the total. */
export function shownSteps(sums: readonly number[], cap: number = KIT_CAPS.accumulate): number[] {
  if (sums.length <= cap) return sums.slice();
  return sums.slice(0, cap - 1).concat(sums[sums.length - 1]);
}

/** Card i's entrance delay: min(i, cap−1)·70 ms (cards past the cap land with the last step). */
export function cardDelay(i: number, cap: number = KIT_CAPS.accumulate, stepMs: number = KIT_MS.accumulateStep): number {
  const k = Math.max(0, Math.min(Math.floor(Number.isFinite(i) ? i : 0), cap - 1));
  return k * stepMs;
}

/** The counter's step k lands half a card entrance after card k starts (110 ms). */
export const STEP_LAG_MS = Math.round(KIT_MS.enter / 2);

/** When each shown step changes the text, for n cards: k·70 + 110, k < min(n, cap). */
export function stepSchedule(n: number, cap: number = KIT_CAPS.accumulate): number[] {
  const steps = Math.max(0, Math.min(Math.floor(n), cap));
  return Array.from({ length: steps }, (_, k) => cardDelay(k, cap) + STEP_LAG_MS);
}

/** The longest card sequence: the last capped card's delay + its entrance (≤ 570 ms). */
export function accumulateMs(n: number, cap: number = KIT_CAPS.accumulate): number {
  if (!(n >= 1)) return 0;
  return cardDelay(Math.min(n, cap) - 1, cap) + KIT_MS.enter;
}

/** The closing badge: the last step + 120 ms. */
export function badgeDelay(n: number, cap: number = KIT_CAPS.accumulate): number {
  const s = stepSchedule(n, cap);
  return (s.length ? s[s.length - 1] : 0) + KIT_MS.priorityAfter;
}
