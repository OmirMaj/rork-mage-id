// capsuleMath.ts: the Commit Capsule's pure geometry (moments wave, lane CAPSULE).
//
// Pure TS with one import (motionSpec, itself import-free), so bun loads it.
// The JS gesture listener uses resist() to watch thresholds; the native driver
// uses resistanceTable(T), a pre-sampled copy of the same curve, because a
// native interpolate cannot take a function or an easing.

import { CAPSULE_RULES } from './motionSpec';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** A rubber band: sign(x)·(|x|·dim·0.55)/(dim+0.55|x|). Approaches dim, never reaches it. */
export function rubber(x: number, dim: number): number {
  const a = Math.abs(x);
  if (a === 0) return 0;
  return Math.sign(x) * (a * dim * 0.55) / (dim + 0.55 * a);
}

// The start-resistance cubic f(x) = a·x + b·x² + c·x³ on [0, K]: slope a at 0,
// and f(K) = K with slope 1 at K, so the thumb catches the finger with no
// permanent lag. Solving the two end conditions gives b = 2u/K and c = −u/K²
// with u = 1 − a (a = 0.45, K = 24: b = 0.0458333, c = −0.00095486; morph.md
// prints them rounded, which would leave a 0.004 pt step at the knee).
const K = CAPSULE_RULES.resistKnee;
const A = CAPSULE_RULES.resistA;
const U = 1 - A;
const B = (2 * U) / K;
const C = -U / (K * K);

/** Drag input (pt) -> capsule travel (pt). x<0 rubber(x,12); x<24 cubic; x<=T identity; beyond T+rubber(x−T,14). */
export function resist(x: number, T: number): number {
  if (x < 0) return rubber(x, CAPSULE_RULES.rubberStart);
  if (x < K) return A * x + B * x * x + C * x * x * x;
  if (x <= T) return x;
  return T + rubber(x - T, CAPSULE_RULES.rubberEnd);
}

type Table = { inputRange: number[]; outputRange: number[] };

/** Largest |linear-interpolation − fn| on [a, b], sampled every `step`. */
function segError(fn: (x: number) => number, a: number, b: number, step: number): number {
  const ya = fn(a);
  const yb = fn(b);
  let worst = 0;
  for (let x = a; x <= b + 1e-9; x += step) {
    const t = b === a ? 0 : (x - a) / (b - a);
    const lin = ya + (yb - ya) * t;
    worst = Math.max(worst, Math.abs(lin - fn(x)));
  }
  return worst;
}

/** Insert midpoints until every segment reproduces fn within `tol` (checked every 0.125 pt). */
function refine(fn: (x: number) => number, seeds: number[], tol: number): number[] {
  let pts = [...new Set(seeds)].sort((p, q) => p - q);
  for (let pass = 0; pass < 24; pass++) {
    const next: number[] = [pts[0]];
    let split = false;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (segError(fn, a, b, 0.125) > tol && b - a > 0.25) {
        next.push(Math.round(((a + b) / 2) * 1000) / 1000);
        split = true;
      }
      next.push(b);
    }
    pts = next;
    if (!split) break;
  }
  return pts;
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * The native resistance table for travel T: interpolate(clamp) over it
 * reproduces resist() within 0.25 pt at every input in [−60, T+140]. Seeded on
 * morph.md 3's stops plus every 3 pt inside [0, 24], then refined; the outputs
 * are always recomputed from resist(), never typed by hand.
 */
export function resistanceTable(T: number): Table {
  const t = Math.max(T, K + 1);
  const seeds = [-60, -40, -20, -10, -5, 0, 3, 6, 9, 12, 15, 18, 21, 24, t, t + 5, t + 10, t + 20, t + 40, t + 60, t + 100, t + 140];
  const fn = (x: number) => resist(x, t);
  const inputRange = refine(fn, seeds, 0.2);
  return { inputRange, outputRange: inputRange.map((x) => round3(fn(x))) };
}

/** Disabled drag: rubber(x, 10) both ways, so the head gives about 10 pt at most. */
export function disabledTable(): Table {
  const dim = CAPSULE_RULES.rubberDisabled;
  const fn = (x: number) => rubber(x, dim);
  const inputRange = refine(fn, [-200, -120, -60, -30, -15, -6, 0, 6, 15, 30, 60, 120, 200], 0.2);
  return { inputRange, outputRange: inputRange.map((x) => round3(fn(x))) };
}

/** The idle label fades as the capsule covers it. */
export function labelOpacityTable(): Table {
  return { inputRange: [0, 0.15, 0.3, 0.45, 0.6], outputRange: [1, 0.78, 0.45, 0.15, 0] };
}

/** The idle label drifts right 10 pt as it fades. */
export function labelDriftTable(): Table {
  return { inputRange: [0, 0.6], outputRange: [0, 10] };
}

/** Release decision: locked, or a flick from past 55% at 900 pt/s whose d=0.99 projection reaches T. */
export function shouldCommit(a: { locked: boolean; progress: number; vx: number; f: number; T: number }): boolean {
  if (a.locked) return true;
  return a.progress >= CAPSULE_RULES.flickMinProgress
    && a.vx >= CAPSULE_RULES.flickMinVx
    && a.f + a.vx * CAPSULE_RULES.flickProjectionS >= a.T;
}

/** Lock at >= threshold; once locked, unlock only below threshold − 0.07. */
export function lockStep(locked: boolean, p: number, threshold: number): boolean {
  if (!locked && p >= threshold) return true;
  if (locked && p < threshold - CAPSULE_RULES.unlockHysteresis) return false;
  return locked;
}

/**
 * Notch ticks at 25/50/75% below the threshold, at most three per pass: fire
 * when the notch index rises past the last one fired; re-arm once p falls 6%
 * under the last notch.
 */
export function notchStep(lastN: number, p: number, threshold: number): { n: number; fire: boolean } {
  if (p >= threshold) return { n: lastN, fire: false };
  const n = Math.min(3, Math.floor(p / 0.25));
  if (n > lastN) return { n, fire: true };
  if (p < lastN * 0.25 - CAPSULE_RULES.notchHysteresis) return { n: Math.max(0, n), fire: false };
  return { n: lastN, fire: false };
}

/** The body's scaleX: it spans cap centre to cap centre, 0 when the caps meet. */
export function bodyScale(lead: number, trail: number, D: number, Wb: number): number {
  if (Wb <= 0) return 0;
  return clamp((lead - trail - D) / Wb, 0, 1);
}
