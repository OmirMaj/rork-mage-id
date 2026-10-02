// springMath.ts — the kit's spring maths, pure (imports ./kitSpec only).
//
// springAt() steps a damped spring in FIXED 1/240 s frames (the solver frame
// marketing/portal/moments.js uses), each frame integrated in four
// semi-implicit Euler sub-steps (1/960 s). marketing/assets/motion-kit.js runs
// the identical code, so the port is compared value for value; the sub-steps
// keep the curve within 1e-3 of a 1 ms reference solver on the frame grid (a
// single 1/240 s Euler step lags a real spring by ~2 % of the travel).
// t95Ms() measures on a finer 1 ms solver (the numbers the spec quotes), and
// webMsFor() turns that into the CSS duration the web runs instead of a
// spring (ceil to 10 ms).

import { ceil10, KIT_SPRING, type KitSpring, type KitSpringName } from './kitSpec';

/** The fixed solver frame, in seconds, and the Euler sub-steps inside one frame. */
export const SPRING_STEP_S = 1 / 240;
export const SPRING_SUBSTEPS = 4;

function frame(s: KitSpring, to: number, st: { x: number; v: number }): void {
  const dt = SPRING_STEP_S / SPRING_SUBSTEPS;
  for (let i = 0; i < SPRING_SUBSTEPS; i++) stepTo(s, to, st, dt);
}

/** ζ = damping / (2·√(stiffness·mass)). */
export function dampingRatio(s: KitSpring): number {
  return s.damping / (2 * Math.sqrt(s.stiffness * s.mass));
}

function stepTo(s: KitSpring, to: number, st: { x: number; v: number }, dt: number): void {
  const acc = (-s.stiffness * (st.x - to) - s.damping * st.v) / s.mass;
  st.v += acc * dt;
  st.x += st.v * dt;
}

/**
 * The spring's position `tMs` after release, from `from` at rest toward `to`.
 * Fixed 1/240 s frames (four Euler sub-steps each); between two frames the
 * value is linearly interpolated, so the curve is continuous in t.
 */
export function springAt(tMs: number, s: KitSpring, from: number, to: number): number {
  if (!(tMs > 0)) return from;
  const exact = (tMs / 1000) / SPRING_STEP_S;
  const n = Math.floor(exact + 1e-9);
  const st = { x: from, v: 0 };
  for (let i = 0; i < n; i++) frame(s, to, st);
  const frac = exact - n;
  if (frac <= 1e-9) return st.x;
  const before = st.x;
  frame(s, to, st);
  return before + (st.x - before) * frac;
}

/** The same spring on a 1 ms step (the reference solver for t95 and the checks). */
export function springAtFine(tMs: number, s: KitSpring, from: number, to: number): number {
  const st = { x: from, v: 0 };
  const n = Math.max(0, Math.round(tMs));
  for (let i = 0; i < n; i++) stepTo(s, to, st, 0.001);
  return st.x;
}

/** First time (ms, 1 ms solver) the remaining travel is within 5 % of the whole. */
export function t95Ms(s: KitSpring): number {
  const st = { x: 0, v: 0 };
  for (let ms = 1; ms <= 3000; ms++) {
    stepTo(s, 1, st, 0.001);
    if (Math.abs(1 - st.x) <= 0.05) return ms;
  }
  return 3000;
}

/** The CSS duration the web runs for this spring: t95 ceiled to 10 ms. */
export function webMsFor(s: KitSpring | KitSpringName): number {
  const cfg = typeof s === 'string' ? KIT_SPRING[s] : s;
  return ceil10(t95Ms(cfg));
}

/** Peak overshoot past the target as a fraction of the travel (1 ms solver). */
export function overshoot(s: KitSpring): number {
  const st = { x: 0, v: 0 };
  let peak = 0;
  for (let ms = 1; ms <= 3000; ms++) {
    stepTo(s, 1, st, 0.001);
    if (st.x > peak) peak = st.x;
  }
  return Math.max(0, peak - 1);
}
