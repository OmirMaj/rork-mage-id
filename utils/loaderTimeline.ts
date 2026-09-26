// loaderTimeline.ts — the pure timeline behind ToppingOutMark (the native
// loading mark: five floors rise into place, the last one the accent beam).
//
// WHY PRE-SAMPLED. The whole loop runs on the UI thread: ONE Animated.Value,
// ONE linear Animated.timing inside Animated.loop (the only loop shape RN runs
// natively with iterations). The native interpolation allowlist has no
// `easing`, so every curve here — the spring landing, the ease-in exit — is
// sampled into a piecewise-linear inputRange/outputRange instead.
//
// Pure TypeScript with no react-native import, so scripts/validate-loader.ts
// can import it under bun and check the maths (strictly increasing ranges,
// a seamless loop, a real hold, no bounce).

import { Motion } from '@/constants/designTokens';

/** One full build-hold-fade cycle. */
export const CYCLE_MS = 3200;
/** Five floor modules; index 4 is the accent "topping-out" beam. */
export const FLOORS = 5;
/** Each floor's landing takes 400 ms of the cycle. */
export const LAND_FRAC = 0.125;
/** When floor i starts rising (fraction of the cycle): 160, 480, 800, 1120, 1440 ms. */
export const FLOOR_START = (i: number): number => 0.05 + 0.1 * i;
/** A floor's fade-in takes 150 ms. */
export const OPACITY_IN_FRAC = 0.047;
/** The finished tower starts fading out as one (2560 ms)… */
export const EXIT_START = 0.8;
/** …and is gone by 2976 ms; the loop wraps while nothing is visible. */
export const EXIT_END = 0.93;
/** Once invisible, each floor drops back to its entry offset over ~32 ms. */
export const RESET_FRAC = 0.01;
/** The entry offset, in units of size/100. */
export const RISE_U = 6;

/** Reduce Motion: a slow fade pulse of the static tower instead. */
export const PULSE_MS = 2400;
export const pulseRange = {
  inputRange: [0, 0.25, 0.5, 0.75, 1],
  outputRange: [1, 0.78, 0.6, 0.78, 1],
};

export type SpringCfg = { damping: number; stiffness: number; mass: number };

/** Damping ratio ζ = c / (2·√(k·m)). */
export function dampingRatio(cfg: SpringCfg): number {
  return cfg.damping / (2 * Math.sqrt(cfg.stiffness * cfg.mass));
}

/** The unclamped spring position 0 → 1 at `tMs` (from rest at 0, target 1). */
export function springAt(cfg: SpringCfg, tMs: number): number {
  const t = tMs / 1000;
  const w = Math.sqrt(cfg.stiffness / cfg.mass);
  const z = dampingRatio(cfg);
  if (z < 1) {
    const wd = w * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t));
  }
  if (z === 1) return 1 - Math.exp(-w * t) * (1 + w * t);
  // Overdamped.
  const r = Math.sqrt(z * z - 1);
  const s1 = -w * (z - r);
  const s2 = -w * (z + r);
  const c2 = s1 / (s2 - s1);
  const c1 = -1 - c2;
  return 1 + c1 * Math.exp(s1 * t) + c2 * Math.exp(s2 * t);
}

/**
 * `n` samples of the spring at (k/n)·durMs for k = 1..n, clamped to [0, 1],
 * with the last forced to 1 (the landing always ends exactly in place).
 */
export function sampleSpring(cfg: SpringCfg = Motion.spring.rise, n = 10, durMs = 400): number[] {
  const out: number[] = [];
  for (let k = 1; k <= n; k++) {
    const x = springAt(cfg, (k / n) * durMs);
    out.push(Math.min(1, Math.max(0, x)));
  }
  out[n - 1] = 1;
  return out;
}

/** The unclamped peak of the spring over `durMs` (overshoot check). */
export function springPeak(cfg: SpringCfg = Motion.spring.rise, durMs = 1500, steps = 1500): number {
  let peak = 0;
  for (let k = 0; k <= steps; k++) peak = Math.max(peak, springAt(cfg, (k / steps) * durMs));
  return peak;
}

/** y for x on a CSS-style cubic bezier (x1, y1, x2, y2), by bisection on x. */
export function cubicBezierY(p: readonly [number, number, number, number], x: number): number {
  const [x1, y1, x2, y2] = p;
  const bx = (t: number) => 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
  const by = (t: number) => 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (bx(mid) < x) lo = mid; else hi = mid;
  }
  return by((lo + hi) / 2);
}

/** `n + 1` samples of the eased progress at k/n for k = 0..n (0 → 1). */
export function sampleBezier(p: readonly [number, number, number, number] = Motion.easing.accelerate, n = 6): number[] {
  const out: number[] = [];
  for (let k = 0; k <= n; k++) out.push(k === 0 ? 0 : k === n ? 1 : cubicBezierY(p, k / n));
  return out;
}

export type Range = { inputRange: number[]; outputRange: number[] };

/** The opacity and translateY (in units) interpolation ranges of floor i. */
export function floorRanges(i: number): { opacity: Range; translateY: Range } {
  const s = FLOOR_START(i);

  // Opacity: hidden → quick fade in → hold → the shared ease-in exit → hidden.
  const exit = sampleBezier();
  const exitIn: number[] = [];
  const exitOut: number[] = [];
  for (let k = 1; k < exit.length - 1; k++) {
    exitIn.push(EXIT_START + (EXIT_END - EXIT_START) * (k / (exit.length - 1)));
    exitOut.push(1 - exit[k]);
  }
  const opacity: Range = {
    inputRange: [0, s, s + OPACITY_IN_FRAC, EXIT_START, ...exitIn, EXIT_END, 1],
    outputRange: [0, 0, 1, 1, ...exitOut, 0, 0],
  };

  // translateY: wait at the entry offset, land on the spring, hold in place
  // through the exit, then (invisible) drop back to the entry offset so t=0
  // and t=1 match exactly.
  const land = sampleSpring();
  const landIn = land.map((_, k) => s + LAND_FRAC * ((k + 1) / land.length));
  const landOut = land.map((x) => RISE_U * (1 - x));
  const translateY: Range = {
    inputRange: [0, s, ...landIn, EXIT_END, EXIT_END + RESET_FRAC, 1],
    outputRange: [RISE_U, RISE_U, ...landOut, 0, RISE_U, RISE_U],
  };

  return { opacity, translateY };
}

/** Piecewise-linear evaluation of a range at t (clamped), as RN does it. */
export function evalRange(r: Range, t: number): number {
  const { inputRange: xs, outputRange: ys } = r;
  if (t <= xs[0]) return ys[0];
  if (t >= xs[xs.length - 1]) return ys[ys.length - 1];
  for (let k = 1; k < xs.length; k++) {
    if (t <= xs[k]) {
      const f = (t - xs[k - 1]) / (xs[k] - xs[k - 1]);
      return ys[k - 1] + (ys[k] - ys[k - 1]) * f;
    }
  }
  return ys[ys.length - 1];
}
