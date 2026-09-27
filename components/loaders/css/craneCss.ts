// craneCss.ts — the web crane's ONE 6-second cycle as CSS keyframes (lane WEB).
//
// WHY. The old web crane was three unsynchronised JS loops on SVG: the load
// lowered mid-traverse, was never placed, and froze whenever RN-web's JS was
// busy (Chrome runs CSS transforms on SVG on the main thread too). This crane
// is plain absolutely-positioned divs animating transform / opacity through
// keyframes, which the browser composites, so it keeps moving while the page
// works. Every channel shares ONE cycle and ONE timeline table (below):
//
//     0 → 1400   trolley out 120 → 250 (of 340), easeInOutSine; the load lags,
//                overshoots at the stop, settles by 2000
//  1400 → 2400   lower: cable 40 → 98, ease-out
//  2500          the beam is SET: the hook's beam hides and the tower's new
//                slab shows in the SAME pixels (one 1 % step); the new floor's
//                columns rise 2500 → 2800
//  2700 → 3600   the hook rises empty (98 → 40)
//  3600 → 4900   trolley returns 250 → 120 (lag, small overshoot)
//  4900 → 5200   the next beam fades onto the hook ("picked")
//  5200 → 6000   the tower sinks exactly ONE floor behind the ground clip
//
// THE SEAM. Every floor is identical, so "sunk one floor with the new slab
// shown" (just before 6000) looks exactly like "not sunk, new slab hidden" (0):
// the tower grows forever and never visibly resets. Every channel's 100 % stop
// equals its 0 % stop; the sunk state is held on the 99.99 % stop.
//
// Curves are PRE-SAMPLED into percentage stops (every 2 % plus an exact stop at
// each event), all linear between stops — no per-keyframe timing functions.
// Geometry is in the old 340 × 300 viewBox units × k (k = size / 340), snapped
// to whole px; the moving distances are differences of snapped positions, so
// the set beam and the new slab land on the same pixels.
//
// Pure maths first (validators import it with a stub react-native), then the
// StyleSheet.create registration, memoised per size.

import { StyleSheet, type ViewStyle } from 'react-native';
import { easeInOutSine, easeOutCubic } from '@/utils/levelTimeline';

// ── The ONE timeline table (ms) ──────────────────────────────────────────────

export const CRANE_CYCLE_MS = 6000;
/** One keyframe step: 1 % of the cycle (the beam → slab hand-over). */
export const CRANE_STEP_MS = CRANE_CYCLE_MS / 100;
export const CRANE_TIMELINE = {
  outEnd: 1400,
  outSwingSettled: 2000,
  lowerEnd: 2400,
  set: 2500,
  setEnd: 2500 + CRANE_STEP_MS,
  riseStart: 2700,
  colsEnd: 2800,
  riseEnd: 3600,
  backEnd: 4900,
  backSwingSettled: 5500,
  pickEnd: 5200,
  cycle: CRANE_CYCLE_MS,
} as const;
/** The stop that holds the sunk state before the seam (99.99 %). */
export const CRANE_WRAP_MS = CRANE_CYCLE_MS * 0.9999;

/** viewBox units. */
export const CRANE_UNITS = {
  vbW: 340,
  vbH: 300,
  trolleyHome: 120,
  trolleyOut: 250,
  cableShort: 40,
  cableLong: 98,
  pinY: 75,
  floor: 20,
  ground: 272,
} as const;

/**
 * Pendulum keypoints, degrees RELATIVE TO THE DIRECTION OF TRAVEL (negative =
 * the load lags behind the trolley, positive = it swings ahead), eased between
 * keypoints. Out: −2.5° lag, +1.5° at the stop, 0 by 2000. Back: −2°, +1°.
 */
export const CRANE_SWING = {
  out: [[0, 0], [350, -2.5], [CRANE_TIMELINE.outEnd, 1.5], [1750, -0.35], [CRANE_TIMELINE.outSwingSettled, 0]],
  back: [[CRANE_TIMELINE.riseEnd, 0], [3925, -2], [CRANE_TIMELINE.backEnd, 1], [5250, -0.25], [CRANE_TIMELINE.backSwingSettled, 0]],
} as const;

const T = CRANE_TIMELINE;
const U = CRANE_UNITS;
const clamp01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x);
const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
const wrap = (t: number) => ((t % CRANE_CYCLE_MS) + CRANE_CYCLE_MS) % CRANE_CYCLE_MS;

function keyed(points: readonly (readonly [number, number])[], t: number): number | null {
  if (t < points[0][0] || t > points[points.length - 1][0]) return null;
  for (let i = 1; i < points.length; i++) {
    const [t0, v0] = points[i - 1];
    const [t1, v1] = points[i];
    if (t <= t1) return v0 + (v1 - v0) * easeInOutSine(seg(t, t0, t1));
  }
  return points[points.length - 1][1];
}

/** The channels as fractions / degrees of t (ms, any value: taken mod the cycle). */
export const craneChannel = {
  /** Trolley travel 0 (home, 120) … 1 (out, 250). */
  trolley(t: number): number {
    const w = wrap(t);
    if (w <= T.outEnd) return easeInOutSine(seg(w, 0, T.outEnd));
    if (w <= T.riseEnd) return 1;
    if (w <= T.backEnd) return 1 - easeInOutSine(seg(w, T.riseEnd, T.backEnd));
    return 0;
  },
  /** CSS rotate, degrees (positive = clockwise = the hook swings LEFT of the pin). */
  pendulum(t: number): number {
    const w = wrap(t);
    const out = keyed(CRANE_SWING.out, w);
    if (out != null) return -out; // moving right: ahead = right = negative CSS rotate
    const back = keyed(CRANE_SWING.back, w);
    if (back != null) return back; // moving left: ahead = left = positive CSS rotate
    return 0;
  },
  /** Hook drop 0 (cable 40) … 1 (cable 98). */
  drop(t: number): number {
    const w = wrap(t);
    if (w <= T.outEnd) return 0;
    if (w <= T.lowerEnd) return easeOutCubic(seg(w, T.outEnd, T.lowerEnd));
    if (w <= T.riseStart) return 1;
    if (w <= T.riseEnd) return 1 - easeInOutSine(seg(w, T.riseStart, T.riseEnd));
    return 0;
  },
  /** The beam on the hook. */
  beam(t: number): number {
    const w = wrap(t);
    if (w <= T.set) return 1;
    if (w <= T.setEnd) return 1 - seg(w, T.set, T.setEnd);
    if (w <= T.backEnd) return 0;
    if (w <= T.pickEnd) return seg(w, T.backEnd, T.pickEnd);
    return 1;
  },
  /** The tower's new slab (the SAME stops as the beam, mirrored). */
  slab(t: number): number {
    const w = wrap(t);
    if (w <= T.set) return 0;
    if (w <= T.setEnd) return seg(w, T.set, T.setEnd);
    return 1;
  },
  /** The new floor's columns. */
  cols(t: number): number {
    const w = wrap(t);
    if (w <= T.set) return 0;
    return seg(w, T.set, T.colsEnd);
  },
  /** Tower sink 0 … 1 floor. */
  tower(t: number): number {
    const w = wrap(t);
    if (w <= T.pickEnd) return 0;
    return easeInOutSine(seg(w, T.pickEnd, T.cycle));
  },
};
export type CraneChannelName = keyof typeof craneChannel;

/** Every stop time: every 2 % plus each event boundary and swing keypoint. */
export function craneStopTimes(): number[] {
  const set = new Set<number>();
  for (let p = 0; p <= 100; p += 2) set.add((CRANE_CYCLE_MS * p) / 100);
  for (const v of Object.values(T)) set.add(v);
  for (const [t] of [...CRANE_SWING.out, ...CRANE_SWING.back]) set.add(t);
  set.add(CRANE_WRAP_MS);
  return [...set].filter((t) => t >= 0 && t <= CRANE_CYCLE_MS).sort((a, b) => a - b);
}

const round = (x: number, d: number) => {
  const f = 10 ** d;
  const v = Math.round(x * f) / f;
  return v === 0 ? 0 : v;
};
/** '41.6667%' */
export const cranePct = (t: number) => `${round((100 * t) / CRANE_CYCLE_MS, 4)}%`;

/** The sampled stops of one channel: [time, value]; the 100 % stop is the 0 % stop. */
export function craneSamples(name: CraneChannelName): [number, number][] {
  return craneStopTimes().map((t) => [t, craneChannel[name](t === CRANE_CYCLE_MS ? 0 : t)]);
}

// ── Geometry (px, snapped) ───────────────────────────────────────────────────

export interface CraneGeometry {
  k: number;
  W: number;
  H: number;
  u: (v: number) => number;
  sw: (w: number) => number;
  pinX: number;
  pinY: number;
  trolleyDx: number;
  hookDy: number;
  cableRest: number;
  cableFull: number;
  slabW: number;
  slabH: number;
  slabBorder: number;
  beamLeft: number;
  beamTop: number;
  newSlabLeft: number;
  newSlabTop: number;
  floorPx: number;
  groundY: number;
  colW: number;
  colInset: number;
}

export function craneGeometry(size: number): CraneGeometry {
  const k = size / U.vbW;
  const u = (v: number) => Math.round(v * k);
  const sw = (w: number) => Math.max(1, Math.round(w * k));
  const pinX = u(U.trolleyHome);
  const pinY = u(U.pinY);
  const trolleyDx = u(U.trolleyOut) - pinX;
  const hookTop = u(U.pinY + U.cableShort); // the cable's end at 40
  const hookDy = Math.round((U.cableLong - U.cableShort) * k);
  const cableRest = hookTop - pinY;
  const slabW = u(38);
  const slabH = Math.max(3, u(5));
  const beamLeft = pinX - Math.round(slabW / 2);
  const beamTop = u(131);
  return {
    k, W: size, H: (size * U.vbH) / U.vbW, u, sw,
    pinX, pinY, trolleyDx, hookDy,
    cableRest, cableFull: cableRest + hookDy,
    slabW, slabH, slabBorder: sw(2),
    beamLeft, beamTop,
    // The new slab sits EXACTLY where the set beam is: home + the two moves.
    newSlabLeft: beamLeft + trolleyDx,
    newSlabTop: beamTop + hookDy,
    floorPx: Math.max(slabH + 2, Math.round(U.floor * k)),
    groundY: u(U.ground),
    colW: sw(2),
    colInset: u(4),
  };
}

/** The px/deg value a channel's fraction becomes for a geometry. */
export function craneValue(g: CraneGeometry, name: CraneChannelName, v: number): string {
  switch (name) {
    case 'trolley': return `translateX(${round(v * g.trolleyDx, 2)}px)`;
    case 'pendulum': return `rotate(${round(v, 3)}deg)`;
    case 'drop': return `translateY(${round(v * g.hookDy, 2)}px)`;
    case 'tower': return `translateY(${round(v * g.floorPx, 2)}px)`;
    default: return String(round(v, 4));
  }
}
/** The cable follows the hook: its visible length always ends at the hook. */
export function craneCableScale(g: CraneGeometry, drop: number): number {
  return round((g.cableRest + drop * g.hookDy) / g.cableFull, 4);
}

// ── Keyframes + registration ─────────────────────────────────────────────────

export type CraneLayer = CraneChannelName | 'cable';
export const CRANE_LAYERS: readonly CraneLayer[] = ['trolley', 'pendulum', 'drop', 'cable', 'beam', 'slab', 'cols', 'tower'];

/** One layer's keyframe object: { '0%': {…}, …, '100%': {…} } — transform or opacity only. */
export function craneFrames(g: CraneGeometry, layer: CraneLayer): Record<string, { transform: string } | { opacity: number }> {
  const frames: Record<string, { transform: string } | { opacity: number }> = {};
  const src: CraneChannelName = layer === 'cable' ? 'drop' : layer;
  for (const [t, v] of craneSamples(src)) {
    const key = cranePct(t);
    if (layer === 'cable') frames[key] = { transform: `scaleY(${craneCableScale(g, v)})` };
    else if (layer === 'beam' || layer === 'slab' || layer === 'cols') frames[key] = { opacity: round(v, 4) };
    else frames[key] = { transform: craneValue(g, src, v) };
  }
  return frames;
}

export function craneLayerRaw(g: CraneGeometry, layer: CraneLayer): ViewStyle {
  return {
    animationKeyframes: [craneFrames(g, layer)],
    animationDuration: `${CRANE_CYCLE_MS}ms`,
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
    animationDelay: '0ms',
    animationFillMode: 'backwards',
  } as unknown as ViewStyle;
}

const cache = new Map<string, Record<CraneLayer, ViewStyle>>();
/** The registered classes for a size (one StyleSheet.create per distinct size). */
export function craneStyles(size: number): Record<CraneLayer, ViewStyle> {
  const key = String(Math.round(size * 10) / 10);
  let s = cache.get(key);
  if (!s) {
    const g = craneGeometry(size);
    const raw = {} as Record<CraneLayer, ViewStyle>;
    for (const l of CRANE_LAYERS) raw[l] = craneLayerRaw(g, l);
    s = StyleSheet.create(raw);
    cache.set(key, s);
  }
  return s;
}
