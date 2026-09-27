// levelTimeline.ts — every number behind "The Level", MAGE ID's one loading
// mark: the spirit level the baked native splash already shows. The bubble
// SEEKS (a liquid sine drift with squash-and-stretch) while work runs and
// SETTLES dead centre only when the work is truly done.
//
// WHY PRE-SAMPLED. The drift runs on the UI thread: ONE shared Animated.Value
// on ONE linear Animated.timing inside Animated.loop (components/loaders/
// levelClock.ts). The native interpolation allowlist has no `easing`, so every
// curve on the clock is a 25-point piecewise-linear range (24 segments) built
// here. One-shot timings (enter, settle) take the easing FUNCTIONS below —
// Animated.timing pre-samples its easing in JS at start, so a delay is baked in
// as a flat plateau, never a JS timer.
//
// Pure TypeScript: NO react-native import (and nothing that imports it), so
// constants/designTokens.ts can re-export LOADER and bun validators can import
// this file directly. scripts/validate-level.ts holds every rule.

import { GATE } from './loadingGate';

// ── 1.1 Tempo ────────────────────────────────────────────────────────────────

/** The ONE shared clock (every level on screen moves in step). */
export const LEVEL_PERIOD_MS = 1400;
/** The ONE Reduce-Motion clock (1.6 × the period): the bubble breathes. */
export const LEVEL_RM_PERIOD_MS = 2240;
/** Loop channels are sampled at k/24, k = 0…24. */
export const SAMPLES = 25;

export type Range = { inputRange: number[]; outputRange: number[] };

const round4 = (x: number): number => {
  const r = Math.round(x * 1e4) / 1e4;
  return r === 0 ? 0 : r; // never -0
};

// ── 1.2 Loop channels ────────────────────────────────────────────────────────

/** The 25 clock inputs k/24 (strictly increasing, 0 … 1). */
export const levelInput: number[] = Array.from({ length: SAMPLES }, (_, k) => k / (SAMPLES - 1));

function channel(fn: (k: number) => number): number[] {
  const out = Array.from({ length: SAMPLES }, (_, k) => round4(fn(k)));
  out[SAMPLES - 1] = out[0]; // the seam: sample 24 is sample 0, exactly
  return out;
}

const TAU = 2 * Math.PI;
/** Position: sin(2πk/24), × the amplitude in px at use. */
export const driftUnit: number[] = channel((k) => Math.sin((TAU * k) / 24));
/** Speed: |cos(2πk/24)| — drives the stretch and the squash. */
export const speedUnit: number[] = channel((k) => Math.abs(Math.cos((TAU * k) / 24)));
/** The graduation glint at each centre crossing (≥ 96 px only). */
export const beatRange: Range = {
  inputRange: [0, 0.07, 0.43, 0.5, 0.57, 0.93, 1],
  outputRange: [0.8, 0, 0, 0.8, 0, 0, 0.8],
};
/** Reduce Motion: bubble opacity 1 → 0.5 → 1 on the RM clock. */
export const rmBreath: number[] = channel((k) => 0.75 + 0.25 * Math.cos((TAU * k) / 24));

// ── 1.3 Optical geometry ─────────────────────────────────────────────────────

/** The four anchor rows (monotonic in width; the judges' must-fix). */
export const LEVEL_ANCHORS = {
  widths: [20, 36, 64, 120],
  bubbleW: [7, 10, 14, 18],
  bubbleH: [4, 5, 6, 7],
  amp: [5, 8, 16, 28],
  trackH: [1.5, 1.5, 1.5, 2],
  stretch: [0.1, 0.12, 0.14, 0.14],
  squash: [0.06, 0.08, 0.1, 0.1],
} as const;
/** Caps exist from 28 px; their height interpolates over these anchors. */
export const CAP_ANCHORS = { widths: [28, 36, 64, 120], capH: [6, 7, 9, 10] } as const;
export const LEVEL_MIN_W = 20;
export const LEVEL_MAX_W = 120;
export const CAPS_MIN_W = 28;
export const GRADS_MIN_W = 96;
export const LVL_MIN_W = 64;

function lerpTable(xs: readonly number[], ys: readonly number[], x: number): number {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) {
    if (x <= xs[i]) return ys[i - 1] + ((ys[i] - ys[i - 1]) * (x - xs[i - 1])) / (xs[i] - xs[i - 1]);
  }
  return ys[ys.length - 1];
}

export type LevelClass = 'S' | 'M' | 'L' | 'XL';

export interface LevelGeometry {
  cls: LevelClass;
  boxW: number;
  boxH: number;
  track: { x: number; y: number; w: number; h: number; opacity: number; radius: number };
  caps: null | { w: number; h: number; xL: number; xR: number; y: number; radius: number };
  grads: null | { w: number; h: number; xL: number; xR: number; y: number; opacity: number; radius: number };
  /** At rest (centred): left/top inside the box. */
  bubble: { w: number; h: number; x: number; y: number; radius: number };
  /** Bubble-centre travel each side, px. */
  amp: number;
  stretch: number;
  squash: number;
}

/**
 * The table geometry for a DRAWN width (pt). Widths are clamped to [20, 120]
 * (a larger host box centres a 120 mark; only the splash exceeds 120, and it
 * has its own geometry below). Pixel snapping happens in the component.
 */
export function levelGeometry(width: number): LevelGeometry {
  const w = Math.min(LEVEL_MAX_W, Math.max(LEVEL_MIN_W, Number.isFinite(width) ? width : LEVEL_MIN_W));
  const A = LEVEL_ANCHORS;
  const at = (ys: readonly number[]) => lerpTable(A.widths, ys, w);
  const bubbleW = Math.max(1, at(A.bubbleW));
  const bubbleH = Math.max(4, at(A.bubbleH));
  const trackH = Math.max(1, at(A.trackH));
  const amp = at(A.amp);
  const cls: LevelClass = w <= 24 ? 'S' : w <= 48 ? 'M' : w <= 96 ? 'L' : 'XL';

  const capH = w >= CAPS_MIN_W ? lerpTable(CAP_ANCHORS.widths, CAP_ANCHORS.capH, w) : null;
  const capW = trackH;
  const boxW = w;
  const boxH = Math.max(capH ?? 0, bubbleH, trackH);
  const cy = boxH / 2;

  const caps = capH == null ? null : {
    w: capW, h: capH, xL: 0, xR: boxW - capW, y: cy - capH / 2, radius: capW / 2,
  };
  const trackX = caps ? capW : 0;
  const track = {
    x: trackX,
    y: cy - trackH / 2,
    w: boxW - 2 * trackX,
    h: trackH,
    opacity: w <= 36 ? 0.3 : 0.25,
    radius: trackH / 2,
  };
  let grads: LevelGeometry['grads'] = null;
  if (w >= GRADS_MIN_W) {
    const gw = Math.max(1, (1 * w) / 120);
    const gh = (6 * w) / 120;
    const off = 0.086 * w;
    grads = {
      w: gw, h: gh, xL: boxW / 2 - off - gw / 2, xR: boxW / 2 + off - gw / 2, y: cy - gh / 2, opacity: 0.55, radius: gw / 2,
    };
  }
  return {
    cls, boxW, boxH, track, caps, grads,
    bubble: { w: bubbleW, h: bubbleH, x: boxW / 2 - bubbleW / 2, y: cy - bubbleH / 2, radius: bubbleH / 2 },
    amp,
    stretch: at(A.stretch),
    squash: at(A.squash),
  };
}

/** The clearance, px, between the bubble's extreme edge at full amplitude and the track end / cap inner edge. */
export function levelClearance(width: number): number {
  const g = levelGeometry(width);
  const inner = g.caps ? g.boxW - g.caps.w : g.boxW;
  return inner - (g.boxW / 2 + g.amp + g.bubble.w / 2);
}

// ── 1.4 The native-splash replica (the ONLY literal colours in the system) ──
// Measured from assets/images/splash-icon.png (1024 × 1024 RGBA, exactly four
// RGBA values, no anti-aliasing). scripts/validate-level-splash.ts (SPLASHPX)
// decodes the PNG and asserts these; they must equal the baked frame.

export const NATIVE_SPLASH_BG = '#0B0D10';
export const NATIVE_SPLASH_ACCENT = '#FF6A1A';
export const NATIVE_SPLASH_CAP = '#F4EFE6';
export const NATIVE_SPLASH_FG = '#F4EFE6';
/** Track and caps alpha in the PNG: draw as a View opacity of 64/255. */
export const NATIVE_SPLASH_TRACK_ALPHA = 64;
export const NATIVE_SPLASH_CAP_ALPHA = 64;
/** Part boxes, PNG pixels, EXCLUSIVE ends. */
export const NATIVE_SPLASH_PX = {
  capL: { x0: 293, x1: 301, y0: 497, y1: 527 },
  capR: { x0: 723, x1: 731, y0: 497, y1: 527 },
  track: { x0: 301, x1: 723, y0: 508, y1: 516 },
  bubble: { x0: 479, x1: 546, y0: 499, y1: 525 },
} as const;
/** Measured corner radii, PNG px (× s at use). The track is SQUARE-ended. */
export const NATIVE_SPLASH_RADII_PX = { track: 0, cap: 4, bubble: 13 } as const;
/** Bubble-centre travel each side, PNG px (× s at use). */
export const NATIVE_SPLASH_AMP_PX = 110;
export const NATIVE_SPLASH_STRETCH = 0.14;
export const NATIVE_SPLASH_SQUASH = 0.1;

/** The mark box inside the PNG. */
export const SPLASH_MARK_X0 = 293;
export const SPLASH_MARK_Y0 = 497;
export const SPLASH_MARK_W = 438;
export const SPLASH_MARK_H = 30;
/** Web has no native splash; its level is capped at this width. */
export const SPLASH_WEB_MAX_W = 240;

export interface SplashRect { s: number; imgLeft: number; imgTop: number; markLeft: number; markTop: number; markW: number; markH: number }

/**
 * Where the native splash draws the level, for a W × H window. The storyboard
 * aspect-fits the 1024² PNG full screen (the legacy `splash` key; app.json has
 * no expo-splash-screen plugin). Web caps the mark at 240 px wide.
 */
export function splashRect(W: number, H: number, platform: 'ios' | 'android' | 'web' | string): SplashRect {
  let s = Math.min(W, H) / 1024;
  if (platform === 'web') s = Math.min(s, SPLASH_WEB_MAX_W / SPLASH_MARK_W);
  const imgLeft = (W - 1024 * s) / 2;
  const imgTop = (H - 1024 * s) / 2;
  return {
    s, imgLeft, imgTop,
    markLeft: imgLeft + SPLASH_MARK_X0 * s,
    markTop: imgTop + SPLASH_MARK_Y0 * s,
    markW: SPLASH_MARK_W * s,
    markH: SPLASH_MARK_H * s,
  };
}

export interface PartRect { left: number; top: number; width: number; height: number }

/** Each splash part relative to the mark box, at scale s. */
export function splashPartRects(s: number): { capL: PartRect; capR: PartRect; track: PartRect; bubble: PartRect } {
  const r = (p: { x0: number; x1: number; y0: number; y1: number }): PartRect => ({
    left: (p.x0 - SPLASH_MARK_X0) * s,
    top: (p.y0 - SPLASH_MARK_Y0) * s,
    width: (p.x1 - p.x0) * s,
    height: (p.y1 - p.y0) * s,
  });
  const P = NATIVE_SPLASH_PX;
  return { capL: r(P.capL), capR: r(P.capR), track: r(P.track), bubble: r(P.bubble) };
}

// ── The resolved parts every renderer draws (native LevelMark, LevelMarkWeb) ─

export interface LevelRect { left: number; top: number; width: number; height: number; radius: number }
export interface LevelParts {
  splash: boolean;
  boxW: number;
  boxH: number;
  capL: LevelRect | null;
  capR: LevelRect | null;
  track: LevelRect;
  grads: [LevelRect, LevelRect] | null;
  bubble: LevelRect;
  amp: number;
  stretch: number;
  squash: number;
  /** Static View opacity (never an alpha suffix). */
  trackOpacity: number;
  capOpacity: number;
  gradOpacity: number;
  /** Caps + graduations take the accent on settle ("it's level"). */
  hasLvl: boolean;
}

/**
 * Geometry for a drawn width and tone, unsnapped. The SPLASH tone scales the
 * measured PNG parts by s = size/438 and takes its radii from
 * NATIVE_SPLASH_RADII_PX (the track is SQUARE-ended) — never the table's
 * 'track h/2', which would round the replica's track ends and break the
 * pixel-identical frame 0. Every other tone uses levelGeometry.
 */
export function levelParts(size: number, tone: 'accent' | 'onAccent' | 'muted' | 'splash'): LevelParts {
  if (tone === 'splash') {
    const s = size / SPLASH_MARK_W;
    const p = splashPartRects(s);
    const R = NATIVE_SPLASH_RADII_PX;
    return {
      splash: true,
      boxW: SPLASH_MARK_W * s,
      boxH: SPLASH_MARK_H * s,
      capL: { ...p.capL, radius: R.cap * s },
      capR: { ...p.capR, radius: R.cap * s },
      track: { ...p.track, radius: R.track * s },
      grads: null,
      bubble: { ...p.bubble, radius: R.bubble * s },
      amp: NATIVE_SPLASH_AMP_PX * s,
      stretch: NATIVE_SPLASH_STRETCH,
      squash: NATIVE_SPLASH_SQUASH,
      trackOpacity: NATIVE_SPLASH_TRACK_ALPHA / 255,
      capOpacity: NATIVE_SPLASH_CAP_ALPHA / 255,
      gradOpacity: 0,
      hasLvl: false,
    };
  }
  const g = levelGeometry(size);
  const cap = (x: number): LevelRect | null => (g.caps ? { left: x, top: g.caps.y, width: g.caps.w, height: g.caps.h, radius: g.caps.radius } : null);
  const grad = (x: number): LevelRect => ({ left: x, top: g.grads!.y, width: g.grads!.w, height: g.grads!.h, radius: g.grads!.radius });
  return {
    splash: false,
    boxW: g.boxW,
    boxH: g.boxH,
    capL: cap(0),
    capR: g.caps ? cap(g.caps.xR) : null,
    track: { left: g.track.x, top: g.track.y, width: g.track.w, height: g.track.h, radius: g.track.radius },
    grads: g.grads ? [grad(g.grads.xL), grad(g.grads.xR)] : null,
    bubble: { left: g.bubble.x, top: g.bubble.y, width: g.bubble.w, height: g.bubble.h, radius: g.bubble.radius },
    amp: g.amp,
    stretch: g.stretch,
    squash: g.squash,
    trackOpacity: tone === 'onAccent' ? 0.35 : tone === 'muted' ? 0.3 : g.track.opacity,
    capOpacity: 1,
    gradOpacity: g.grads ? g.grads.opacity : 0,
    hasLvl: g.boxW >= LVL_MIN_W,
  };
}

// ── 1.5 Plateau and easing functions (for Animated.timing, never interpolate) ─

/** Flat at 0 until d (a delay baked into the easing), then `inner` over the rest. */
export const plateau = (d: number, inner: (x: number) => number) => (x: number): number => {
  if (d <= 0) return inner(x);
  if (d >= 1) return x >= 1 ? 1 : 0;
  return x < d ? 0 : inner((x - d) / (1 - d));
};

/** A CSS-style cubic-bezier(x1, y1, x2, y2) as a function of x (Newton, then bisection). */
export function bezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dsx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  const solve = (x: number): number => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x;
      if (Math.abs(e) < 1e-7) return t;
      const d = dsx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 60; i++) {
      const e = sx(t);
      if (Math.abs(e - x) < 1e-7) return t;
      if (e < x) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };
  return (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : sy(solve(x)));
}

export const DECELERATE = bezier(0, 0, 0.2, 1);
export const ACCELERATE = bezier(0.4, 0, 1, 1);
export const STANDARD = bezier(0.4, 0, 0.2, 1);
export const easeOutCubic = (x: number): number => 1 - Math.pow(1 - x, 3);
export const easeInOutSine = (x: number): number => -(Math.cos(Math.PI * x) - 1) / 2;
export const linear = (x: number): number => x;

// ── 1.6 Enter / settle / exit — the numbers every host uses ──────────────────

export const LOADER = {
  periodMs: LEVEL_PERIOD_MS,
  rmPeriodMs: LEVEL_RM_PERIOD_MS,
  /** Only once the gate reveals: vis total = d + 170, amp total = d + 480, plateau = d / total. */
  enter: { visFadeMs: 170, ampDriftMs: 480, defaultRevealMs: 150 },
  /** `done` false→true, all started in ONE tick: gone at +340, content lands by +400. */
  settle: { ampMs: 280, lvlAtMs: 160, lvlMs: 100, visAtMs: 200, visMs: 140, contentAtMs: 200, contentMs: 200, contentRise: 6 },
  fadeExitMs: 120,
  rmSettleMs: 160,
  gate: GATE,
  button: { revealMs: 120, minHoldMs: 400 },
  skeleton: { periodMs: 1600, alpha: 0.09, dip: 0.4, bumpWidth: 0.35, rowPhase: 0.1, colPhase: 0.04, rmFactor: 0.8, samples: 33 },
  workProgress: { summaryHoldMs: 600, elapsedAfterMs: 8000 },
  splash: {
    aliveAtMs: 400,
    ampDriftMs: 480,
    hueMs: 280,
    wordmarkAtMs: 500,
    wordmarkMs: 240,
    failsafeMs: 8000,
    /**
     * THE SPLASH EXIT, ONE SET OF NUMBERS (tr = the exit start): amp settles
     * tr+0→tr+280; the retract value r runs 0→1 LINEAR over 300 ms from tr+180;
     * track + caps scaleX 1→0 over 220 ms (r 0→.7333); bubble scale 1→0.6 and
     * opacity 1→0 over 160 ms from tr+260 (r .2667→.8); the ink fades tr+180→tr+480.
     */
    exit: {
      ampMs: 280, retractAtMs: 180, retractSpanMs: 300, trackMs: 220, bubbleOutAtMs: 260, bubbleOutMs: 160,
      inkAtMs: 180, inkMs: 300, fastInkMs: 280, rmInkMs: 200,
    },
  },
} as const;

/** The enter timings for a reveal delay d (ms): totals and plateau fractions. */
export function enterTimings(d: number): { visTotal: number; visPlateau: number; ampTotal: number; ampPlateau: number } {
  const dd = Math.max(0, d);
  const visTotal = dd + LOADER.enter.visFadeMs;
  const ampTotal = dd + LOADER.enter.ampDriftMs;
  return { visTotal, visPlateau: dd / visTotal, ampTotal, ampPlateau: dd / ampTotal };
}

// ── 1.7 Channels Phase B needs ───────────────────────────────────────────────

function bump(x: number): number {
  const w = LOADER.skeleton.bumpWidth;
  return x < w ? (1 - Math.cos((TAU * x) / w)) / 2 : 0;
}

/**
 * The skeleton "breath wave": opacity = alpha × (1 − dip·bump((t − phase) mod 1)).
 * The phase is baked into the OUTPUT so the input stays 0…1 and increasing.
 */
export function skeletonWave(phase: number): Range {
  const n = LOADER.skeleton.samples; // 33
  const { alpha, dip } = LOADER.skeleton;
  const inputRange = Array.from({ length: n }, (_, k) => k / (n - 1));
  const outputRange = inputRange.map((t) => {
    const x = (((t - phase) % 1) + 1) % 1;
    return round4(alpha * (1 - dip * bump(x)));
  });
  outputRange[n - 1] = outputRange[0];
  return { inputRange, outputRange };
}

/** (row·0.10 + col·0.04) mod 1; unindexed skeletons pulse in unison (phase 0). */
export function skeletonPhase(row?: number, col?: number): number {
  const p = (row ?? 0) * LOADER.skeleton.rowPhase + (col ?? 0) * LOADER.skeleton.colPhase;
  return round4(((p % 1) + 1) % 1);
}

/** The retract-value fractions the splash exit numbers produce. */
export const RETRACT_FRACTIONS = (() => {
  const e = LOADER.splash.exit;
  return {
    trackEnd: round4(e.trackMs / e.retractSpanMs), // .7333
    bubbleStart: round4((e.bubbleOutAtMs - e.retractAtMs) / e.retractSpanMs), // .2667
    bubbleEnd: round4((e.bubbleOutAtMs + e.bubbleOutMs - e.retractAtMs) / e.retractSpanMs), // .8
  };
})();

/**
 * Splash exit channels on ONE host-driven value r (0→1, 300 ms linear, from
 * ready+180). Curves are ACCELERATE-sampled; inputs strictly increasing.
 */
export const retractRanges: { trackScaleX: Range; bubbleScale: Range; bubbleOpacity: Range } = (() => {
  const { trackEnd, bubbleEnd } = RETRACT_FRACTIONS;
  const e = LOADER.splash.exit;
  // track + caps: k/12 for k = 0…8, then 0 at trackEnd, held to 1.
  const tIn: number[] = [];
  const tOut: number[] = [];
  for (let k = 0; k <= 8; k++) {
    const x = round4(k / 12);
    if (x >= trackEnd) break;
    tIn.push(x);
    tOut.push(round4(1 - ACCELERATE(x / trackEnd)));
  }
  tIn.push(trackEnd, 1);
  tOut.push(0, 0);
  // bubble: flat to bubbleStart, 8 sampled segments to bubbleEnd, held to 1.
  const bIn: number[] = [0];
  const sOut: number[] = [1];
  const oOut: number[] = [1];
  for (let k = 0; k <= 8; k++) {
    const x = k === 8 ? bubbleEnd : round4((e.bubbleOutAtMs - e.retractAtMs + (e.bubbleOutMs * k) / 8) / e.retractSpanMs);
    const p = ACCELERATE(k / 8);
    bIn.push(x);
    sOut.push(k === 8 ? 0.6 : round4(1 - 0.4 * p));
    oOut.push(k === 8 ? 0 : round4(1 - p));
  }
  bIn.push(1);
  sOut.push(0.6);
  oOut.push(0);
  return {
    trackScaleX: { inputRange: tIn, outputRange: tOut },
    bubbleScale: { inputRange: bIn, outputRange: sOut },
    bubbleOpacity: { inputRange: [...bIn], outputRange: oOut },
  };
})();

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
