// levelCss.ts — the web level's CSS motion (lane WEB). Every keyframe the web
// level uses is registered here through StyleSheet.create, so react-native-web
// compiles it into a real @keyframes rule the browser runs on the compositor —
// the level keeps moving while the page's JS is busy (pricing an estimate,
// parsing a PDF), which an Animated loop on RN-web cannot do.
//
// THE RULES (components/loaders/css/README.txt; scripts/validate-level-web.ts):
//   - only StyleSheet.create compiles a keyframe (an inline one is dropped);
//   - every duration / delay is a STRING ('700ms'); a bare number becomes px;
//   - every keyframe transform is a STRING ('translateX(5px)');
//   - animationFillMode 'backwards' only (never 'both');
//   - keyframes animate transform and opacity only;
//   - a restart without a remount switches to a byte-different TWIN (RN-web
//     names a keyframe by a hash of its content, so identical content would
//     share one name and the browser would not restart it).
//
// Every number comes from utils/levelTimeline.ts (LEVEL_PERIOD_MS, LOADER):
// the drift sweeps once per half period, so one full left-right-left is the
// same 1400 ms as the native clock.
//
// ONE PHASE (2026-09-27). Native marks all read the one shared levelClock, so
// they move in step and the BrandSplash → BootShell hand-back keeps its phase.
// The web had no shared clock: each drift started at −P/4 (dead centre) the
// moment its class landed, so when the splash's 8 s failsafe handed back to an
// adopting BootShell the bubble jumped to centre and started over. Now every
// delay is measured from LEVEL_WEB_EPOCH_MS (read once, when this module loads):
// a drift that starts at wall time T is already (T − epoch) mod P into the
// cycle, so every web level on screen, whenever it started, is at one phase.

import { StyleSheet, type ViewStyle } from 'react-native';
import { Motion } from '@/constants/designTokens';
import { GATE_BACKSTOP_MS } from '@/utils/loadingGate';
import { LEVEL_PERIOD_MS, LEVEL_RM_PERIOD_MS, LOADER } from '@/utils/levelTimeline';

/** One sweep (−A → +A): half the native period (1400 / 2 = 700 ms). */
export const LEVEL_SWEEP_MS = LEVEL_PERIOD_MS / 2;
/** Reduce Motion: one breath half-cycle (2240 / 2 = 1120 ms), alternating. */
export const LEVEL_BREATH_MS = LEVEL_RM_PERIOD_MS / 2;

/** easeInOutSine per sweep: -A·cos(πp) — the native sine, one half at a time. */
export const CSS_EASE_IN_OUT_SINE = 'cubic-bezier(0.37, 0, 0.63, 1)';
/** easeOutCubic (the settle glide). */
export const CSS_EASE_OUT_CUBIC = 'cubic-bezier(0.33, 1, 0.68, 1)';
/** ACCELERATE (levelTimeline bezier(0.4, 0, 1, 1)): exits. */
export const CSS_ACCELERATE = 'cubic-bezier(0.4, 0, 1, 1)';
/** DECELERATE (levelTimeline bezier(0, 0, 0.2, 1)): a restart's return. */
export const CSS_DECELERATE = 'cubic-bezier(0, 0, 0.2, 1)';

const ms = (v: number) => `${v}ms`;
const r4 = (x: number) => {
  const v = Math.round(x * 1e4) / 1e4;
  return v === 0 ? 0 : v;
};

export type LevelTwin = 'main' | 'twin';

/** The shared phase origin of every web level (ms since the Unix epoch). */
export const LEVEL_WEB_EPOCH_MS = Date.now();
/**
 * Phases are snapped to 10 ms so the registered classes stay bounded (140 per
 * amplitude and twin); 5 ms of error is under a third of a 60 Hz frame.
 */
export const LEVEL_PHASE_STEP_MS = 10;
/** A phase in ms, snapped to the grid and wrapped into [0, LEVEL_PERIOD_MS). */
export function levelPhaseSnap(phaseMs: number): number {
  if (!Number.isFinite(phaseMs)) return 0;
  const wrapped = ((phaseMs % LEVEL_PERIOD_MS) + LEVEL_PERIOD_MS) % LEVEL_PERIOD_MS;
  return (Math.round(wrapped / LEVEL_PHASE_STEP_MS) * LEVEL_PHASE_STEP_MS) % LEVEL_PERIOD_MS;
}
/** Where the shared cycle is at `now`: ms into the period, on the 10 ms grid. */
export function levelPhaseMs(now: number = Date.now()): number {
  return levelPhaseSnap(now - LEVEL_WEB_EPOCH_MS);
}

/**
 * The drift keyframes for an amplitude (px), before registration, joining the
 * shared cycle `phaseMs` in (levelPhaseMs() when the drift starts).
 */
export function levelDriftRaw(ampPx: number, twin: LevelTwin = 'main', phaseMs = 0): ViewStyle {
  const a = r4(Math.round(ampPx * 2) / 2);
  const start = { transform: `translateX(${r4(-a)}px)` };
  const end = { transform: `translateX(${a}px)` };
  // The twin names its stops from / to instead of 0% / 100%: the same motion,
  // a different content hash, so a different animation-name.
  const frames = twin === 'twin' ? { from: start, to: end } : { '0%': start, '100%': end };
  return {
    animationKeyframes: [frames],
    animationDuration: ms(LEVEL_SWEEP_MS),
    animationTimingFunction: CSS_EASE_IN_OUT_SINE,
    animationIterationCount: 'infinite',
    animationDirection: 'alternate',
    // −P/4: the cycle's t = 0 is dead centre moving right (the native sine's
    // phase); a further −phase starts this drift where the shared cycle is now.
    animationDelay: ms(-(levelPhaseSnap(phaseMs) + LEVEL_PERIOD_MS / 4)),
    animationFillMode: 'backwards',
  } as unknown as ViewStyle;
}

/**
 * The squash-and-stretch keyframes: scale(1 + stretch·|cos|, 1 − squash·|cos|)
 * sampled at 9 stops over one sweep. |cos| is 1 at each centre crossing (0 %,
 * 100 %: the drift passes centre at 0 and 700 ms) and 0 at the turnaround (50 %).
 */
export const STRETCH_STOPS = 9;
export function levelStretchFrames(stretch: number, squash: number): { pct: number; sx: number; sy: number }[] {
  return Array.from({ length: STRETCH_STOPS }, (_, i) => {
    const c = Math.abs(Math.cos((Math.PI * i) / (STRETCH_STOPS - 1)));
    return { pct: r4((100 * i) / (STRETCH_STOPS - 1)), sx: r4(1 + stretch * c), sy: r4(1 - squash * c) };
  });
}

/** In phase with the drift: its centre crossings are the 0 % / 100 % stops. */
export function levelStretchRaw(stretch: number, squash: number, twin: LevelTwin = 'main', phaseMs = 0): ViewStyle {
  const frames: Record<string, { transform: string }> = {};
  const stops = levelStretchFrames(stretch, squash);
  stops.forEach((s, i) => {
    const key = twin === 'twin' && i === 0 ? 'from' : twin === 'twin' && i === stops.length - 1 ? 'to' : `${s.pct}%`;
    frames[key] = { transform: `scale(${s.sx}, ${s.sy})` };
  });
  return {
    animationKeyframes: [frames],
    animationDuration: ms(LEVEL_SWEEP_MS),
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
    animationDelay: ms(-(levelPhaseSnap(phaseMs) % LEVEL_SWEEP_MS)),
    animationFillMode: 'backwards',
  } as unknown as ViewStyle;
}

/**
 * The graduation glint (≥ 96 px): 0.8 at each centre crossing, 0 between —
 * levelTimeline beatRange folded onto one sweep (0.07 of the period = 14 %).
 */
export const BEAT_EDGE_PCT = r4((0.07 / 0.5) * 100);
export function levelBeatRaw(twin: LevelTwin = 'main', phaseMs = 0): ViewStyle {
  const lo = `${BEAT_EDGE_PCT}%`;
  const hi = `${r4(100 - BEAT_EDGE_PCT)}%`;
  const frames = twin === 'twin'
    ? { from: { opacity: 0.8 }, [lo]: { opacity: 0 }, [hi]: { opacity: 0 }, to: { opacity: 0.8 } }
    : { '0%': { opacity: 0.8 }, [lo]: { opacity: 0 }, [hi]: { opacity: 0 }, '100%': { opacity: 0.8 } };
  return {
    animationKeyframes: [frames],
    animationDuration: ms(LEVEL_SWEEP_MS),
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
    animationDelay: ms(-(levelPhaseSnap(phaseMs) % LEVEL_SWEEP_MS)),
    animationFillMode: 'backwards',
  } as unknown as ViewStyle;
}

/**
 * The reveal: invisible through the delay (fill 'backwards'), then a 170 ms
 * fade. A load that finishes inside the delay unmounts having shown NOTHING.
 */
export function levelRevealRaw(delayMs: number): ViewStyle {
  return {
    animationKeyframes: [{ from: { opacity: 0 }, to: { opacity: 1 } }],
    animationDuration: ms(LOADER.enter.visFadeMs),
    animationDelay: ms(Math.max(0, Math.round(delayMs))),
    animationTimingFunction: Motion.css.easeOut,
    animationFillMode: 'backwards',
  } as unknown as ViewStyle;
}

// ── Registration (each distinct call registers ONE class; cached) ─────────────

const cache = new Map<string, ViewStyle>();
function once(key: string, build: () => ViewStyle): ViewStyle {
  let s = cache.get(key);
  if (!s) {
    s = StyleSheet.create({ s: build() }).s;
    cache.set(key, s);
  }
  return s;
}

/**
 * The drift for an amplitude and a phase, memoised on the amplitude rounded to
 * 0.5 px and the phase snapped to 10 ms. A restart reads a fresh phase, so it
 * gets a fresh class that carries the delay of the moment it restarts.
 */
export function levelDriftStyle(ampPx: number, twin: LevelTwin = 'main', phaseMs = 0): ViewStyle {
  const a = Math.round(ampPx * 2) / 2;
  const p = levelPhaseSnap(phaseMs);
  return once(`drift:${a}:${twin}:${p}`, () => levelDriftRaw(a, twin, p));
}

export function levelStretchStyle(stretch: number, squash: number, twin: LevelTwin = 'main', phaseMs = 0): ViewStyle {
  const p = levelPhaseSnap(phaseMs) % LEVEL_SWEEP_MS;
  return once(`stretch:${r4(stretch)}:${r4(squash)}:${twin}:${p}`, () => levelStretchRaw(stretch, squash, twin, p));
}

export function levelBeatStyle(twin: LevelTwin = 'main', phaseMs = 0): ViewStyle {
  const p = levelPhaseSnap(phaseMs) % LEVEL_SWEEP_MS;
  return once(`beat:${twin}:${p}`, () => levelBeatRaw(twin, p));
}

export function levelRevealStyle(delayMs: number): ViewStyle {
  const d = Math.max(0, Math.round(delayMs));
  return once(`reveal:${d}`, () => levelRevealRaw(d));
}

/** Reduce Motion: no drift, no stretch, no beat — the bubble breathes 1 → 0.5. */
export const LEVEL_CSS = StyleSheet.create({
  breath: {
    animationKeyframes: [{ from: { opacity: 1 }, to: { opacity: 0.5 } }],
    animationDuration: ms(LEVEL_BREATH_MS),
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite',
    animationDirection: 'alternate',
    animationDelay: '0ms',
    animationFillMode: 'backwards',
  } as unknown as ViewStyle,
});

// ── The settle, as DOM transition strings (LevelMarkWeb writes them inline) ──

const S = LOADER.settle;
export const LEVEL_SETTLE = {
  /** (c) the bubble glides from wherever it is to dead centre and rounds up. */
  glide: `transform ${ms(S.ampMs)} ${CSS_EASE_OUT_CUBIC}`,
  /** The beat fades with the glide. */
  beatOut: `opacity ${ms(S.ampMs)} ${CSS_EASE_OUT_CUBIC}`,
  /** (d) caps + graduations take the accent: 100 ms from +160. */
  lvl: `opacity ${ms(S.lvlMs)} linear ${ms(S.lvlAtMs)}`,
  /** (e) the mark fades: 140 ms from +200 — gone at +340. */
  vis: `opacity ${ms(S.visMs)} ${CSS_ACCELERATE} ${ms(S.visAtMs)}`,
  /** 'fade' exit (inline / button, < 28 px): 120 ms, no delay. */
  fade: `opacity ${ms(LOADER.fadeExitMs)} ${CSS_ACCELERATE}`,
  /** Reduce Motion: 160 ms fade. */
  rm: `opacity ${ms(LOADER.rmSettleMs)} ${CSS_ACCELERATE}`,
  /** A restart: back to full in 170 ms, no second delay. */
  back: `opacity ${ms(LOADER.enter.visFadeMs)} ${CSS_DECELERATE}`,
  /** A restart: the accent overlays leave. */
  lvlBack: `opacity ${ms(S.lvlMs)} linear`,
  /** The glide targets. */
  centre: 'translateX(0px)',
  round: 'scale(1, 1)',
} as const;

/** How long each exit takes; the backstop fires GATE_BACKSTOP_MS (150) after. */
export function levelExitMs(kind: 'settle' | 'fade', reduce: boolean): number {
  if (reduce) return LOADER.rmSettleMs;
  if (kind === 'fade') return LOADER.fadeExitMs;
  return S.visAtMs + S.visMs;
}
export const LEVEL_BACKSTOP_MS = GATE_BACKSTOP_MS;
