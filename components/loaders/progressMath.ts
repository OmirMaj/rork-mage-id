// progressMath.ts — the pure numbers behind the two honest long-wait surfaces
// (components/loaders/WorkProgress.tsx and components/CodeCheckLoader.tsx).
//
// ONE TABLE, TWO RENDERERS. The code-check laser runs on the native driver on
// iOS/Android (Animated.interpolate over these ranges) and as a CSS keyframe
// animation on the web (components/loaders/css/codeCheckCss.ts turns the SAME
// ranges into percentage keys). Both read this file, so the two can never
// drift apart. The native interpolation allowlist has no `easing`, so the
// sweep's easeInOutCubic is pre-sampled here at 25 points.
//
// Pure TypeScript: NO react-native import, so scripts/validate-level-progress.ts
// can import it under bun.

import { SAMPLES, evalRange, type Range } from '@/utils/levelTimeline';

// ── The code-check laser ─────────────────────────────────────────────────────

/** One full pass of the laser, ms (one linear loop, native and CSS alike). */
export const CODE_CHECK_SWEEP_MS = 3000;
/** The laser travels top → bottom over t ∈ [0, SWEEP_END], then holds (invisible). */
export const CODE_CHECK_SWEEP_END = 0.86;
/** The laser's own static opacity (accent at 35 %). */
export const CODE_CHECK_LASER_OPACITY = 0.35;
/** A lit review mark fades back out over this share of the loop (0.20 × 3000 = 600 ms). */
export const CODE_CHECK_MARK_DECAY = 0.2;
/** A mark starts to light this much of the loop before the laser reaches it. */
export const CODE_CHECK_MARK_LEAD = 0.04;
/** The last mark must be dark again before the wrap. */
export const CODE_CHECK_MARK_MAX_END = 0.99;

/**
 * Where each review mark sits down the sheet, 0..1. Uneven on purpose — evenly
 * spaced reads mechanical.
 */
export const MARK_STOPS: readonly number[] = [0.18, 0.33, 0.47, 0.62, 0.79];

export const easeInOutCubic = (x: number): number =>
  x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;

const round4 = (x: number): number => {
  const r = Math.round(x * 1e4) / 1e4;
  return r === 0 ? 0 : r;
};

/** The sweep in sheet units (0 = top, 1 = bottom): 25 eased samples over [0, END], then the hold at 1. */
export function codeCheckSweepUnit(): Range {
  const inputRange: number[] = [];
  const outputRange: number[] = [];
  for (let k = 0; k < SAMPLES; k++) {
    const u = k / (SAMPLES - 1);
    inputRange.push(round4(u * CODE_CHECK_SWEEP_END));
    outputRange.push(round4(easeInOutCubic(u)));
  }
  inputRange.push(1);
  outputRange.push(1);
  return { inputRange, outputRange };
}

/** The laser's travel in px for a sheet `sheetH` tall. */
export function codeCheckLaserY(sheetH: number): Range {
  const unit = codeCheckSweepUnit();
  return { inputRange: unit.inputRange, outputRange: unit.outputRange.map((y) => round4(y * sheetH)) };
}

/** The laser is invisible at the wrap, so the jump back to the top is never seen. */
export const codeCheckLaserOpacity: Range = {
  inputRange: [0, 0.06, 0.8, CODE_CHECK_SWEEP_END, 1],
  outputRange: [0, 1, 1, 0, 0],
};

/**
 * The loop time at which the DRAWN laser (the piecewise-linear sweep) crosses
 * sheet fraction `s`. The marks sit at MARK_STOPS × sheetH, so each one must
 * light when the laser really reaches that height — not at s × END, which
 * (the sweep being eased) would light the 18 % mark while the laser is still
 * at 2 % of the sheet.
 */
export function codeCheckCrossing(s: number): number {
  const { inputRange: xs, outputRange: ys } = codeCheckSweepUnit();
  if (s <= ys[0]) return xs[0];
  for (let k = 1; k < ys.length; k++) {
    if (s <= ys[k]) {
      const f = (s - ys[k - 1]) / (ys[k] - ys[k - 1]);
      return round4(xs[k - 1] + (xs[k] - xs[k - 1]) * f);
    }
  }
  return CODE_CHECK_SWEEP_END;
}

/** One review mark's opacity: dark, lit as the laser crosses it, a 600 ms decay, dark at the wrap. */
export function codeCheckMarkOpacity(stop: number): Range {
  const lit = codeCheckCrossing(stop);
  return {
    inputRange: [
      0,
      round4(lit - CODE_CHECK_MARK_LEAD),
      lit,
      round4(Math.min(lit + CODE_CHECK_MARK_DECAY, CODE_CHECK_MARK_MAX_END)),
      1,
    ],
    outputRange: [0, 0, 1, 0, 0],
  };
}

export interface CssFrame { pct: string; transform?: string; opacity: number }

const pctKey = (t: number): string => `${round4(t * 100)}%`;

/**
 * The laser as CSS keyframes: one frame at EVERY breakpoint of either channel
 * (translateY and opacity), each channel evaluated there. With a linear timing
 * function CSS interpolates linearly between adjacent frames, so the web plays
 * exactly the two piecewise-linear ranges the native driver plays.
 */
export function codeCheckLaserFrames(sheetH: number): CssFrame[] {
  const y = codeCheckLaserY(sheetH);
  const ts = Array.from(new Set([...y.inputRange, ...codeCheckLaserOpacity.inputRange])).sort((a, b) => a - b);
  return ts.map((t) => ({
    pct: pctKey(t),
    transform: `translateY(${round4(evalRange(y, t))}px)`,
    opacity: round4(evalRange(codeCheckLaserOpacity, t)),
  }));
}

/** One review mark as CSS keyframes (opacity only), from the same range as the native mark. */
export function codeCheckMarkFrames(stop: number): CssFrame[] {
  const r = codeCheckMarkOpacity(stop);
  return r.inputRange.map((t, i) => ({ pct: pctKey(t), opacity: r.outputRange[i] }));
}

// ── WorkProgress ─────────────────────────────────────────────────────────────

/** The determinate rule's FLIP (scaleX) on each real count update. */
export const WORK_FILL_MS = 240;

/** Elapsed time as m:ss ("0:14", "1:12", "12:05"). Negative / non-finite → "0:00". */
export function formatElapsed(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/** A finished step's duration: "1.2 s" under a minute, else m:ss. */
export function formatTook(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 60000) return `${(Math.round(ms / 100) / 10).toFixed(1)} s`;
  return formatElapsed(ms);
}

/** The elapsed row: "0:14" or "0:14 · usually 20–40 s". */
export function elapsedLine(ms: number, typical?: string): string {
  const e = formatElapsed(ms);
  return typical && typical.trim() ? `${e} · ${typical.trim()}` : e;
}

/** The determinate rule's scaleX for a REAL count: done / total, clamped to [0, 1]. */
export function fillScale(count: { done: number; total: number } | undefined | null): number {
  if (!count || !Number.isFinite(count.total) || count.total <= 0 || !Number.isFinite(count.done)) return 0;
  return Math.min(1, Math.max(0, count.done / count.total));
}

/** "12 of 48 pages" (unit optional). */
export function countLine(count: { done: number; total: number; unit?: string }): string {
  const unit = count.unit && count.unit.trim() ? ` ${count.unit.trim()}` : '';
  return `${Math.max(0, Math.round(count.done))} of ${Math.max(0, Math.round(count.total))}${unit}`;
}

/** A list index wrapped into [0, n) (0 for an empty list) — the facts footer's rotation. */
export function wrapIndex(i: number, n: number): number {
  if (!Number.isFinite(n) || n <= 0 || !Number.isFinite(i)) return 0;
  return ((Math.trunc(i) % n) + n) % n;
}
