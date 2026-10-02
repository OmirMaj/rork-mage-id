// components/brain/ask/askMotion.ts — every number behind Ask MAGE's chat motion
// (lane AILOOK). Pure literals and pure functions, NO imports, so the bun
// validator (scripts/validate-ask-look.ts) loads it directly.
//
// The numbers equal the app's Motion tokens (constants/designTokens.ts), and
// the validator reads that file's TEXT to hold them equal:
//   send.spring      == Motion.spring.rise  (ζ 0.96)
//   sendPress.spring == Motion.spring.snap  (ζ 0.83)
//   answer.fadeMs    == Motion.duration.enter
//   chips.staggerMs  == Motion.stagger;  thinking.fadeMs == Motion.duration.fade
//
// The shape matches MOTIONKIT section C's CHAT_STACK (utils/motion/kit/
// chatStack.ts on that branch): the same keys and numbers, plus its three
// additions (thinking.dot.samples, thinking.dot.reducedOpacity, chips.cap) and
// dotRanges(), so when the kit lands this file becomes a one-line re-export
// with no visual change.
//
// One question, motion on: t0 send -> the user turn glides up out of the
// composer (opacity done at +120, travel settles about +280) -> at +140 the
// thinking row fades in (160) -> the answer at T: the row fades out (120) as an
// overlay, the answer fades in from T+60 (220, 8 pt) -> its source chips from
// T+120, 35 ms apart (at most 8 staggered). An answer before +140: no row.

export const ASK_MOTION = {
  send: {
    fromY: { page: 56, panel: 44 },
    fromScale: 0.98,
    fadeMs: 120,
    spring: { stiffness: 260, damping: 31, mass: 1 },
  },
  thinking: {
    delayMs: 140,
    fadeMs: 160,
    fromY: 6,
    stillWorkingAfterMs: 10000,
    dot: {
      count: 3,
      size: 6,
      gap: 5,
      periodMs: 1200,
      riseMs: 360,
      staggerMs: 160,
      low: 0.3,
      high: 1,
      scaleLow: 0.8,
      samples: 25,
      reducedOpacity: 0.6,
    },
  },
  thinkingOut: { fadeMs: 120 },
  answer: { delayMs: 60, fadeMs: 220, fromY: 8 },
  chips: { delayMs: 120, staggerMs: 35, fadeMs: 160, cap: 8 },
  sendPress: { scale: 0.92, spring: { stiffness: 420, damping: 34, mass: 1 } },
  jump: { showAfterPx: 160, fadeMs: 160 },
  reduced: { fadeMs: 100 },
} as const;

export interface SendEntry { fromY: number; fromScale: number; fadeMs: number; spring: boolean }

/** How the user's bubble enters. Reduce Motion: a plain 100 ms fade. */
export function sendEntry(variant: 'page' | 'panel', reduced: boolean): SendEntry {
  if (reduced) return { fromY: 0, fromScale: 1, fadeMs: ASK_MOTION.reduced.fadeMs, spring: false };
  return {
    fromY: ASK_MOTION.send.fromY[variant],
    fromScale: ASK_MOTION.send.fromScale,
    fadeMs: ASK_MOTION.send.fadeMs,
    spring: true,
  };
}

export interface DotPhase { startMs: number; upMs: number; downMs: number; restMs: number }

/** Dot i's place in the 1200 ms cycle: up 360, down 360, rest 480, offset i*160. */
export function dotPhase(i: number): DotPhase {
  const d = ASK_MOTION.thinking.dot;
  return {
    startMs: i * d.staggerMs,
    upMs: d.riseMs,
    downMs: d.riseMs,
    restMs: d.periodMs - 2 * d.riseMs,
  };
}

export interface AnswerEntry { delayMs: number; fadeMs: number; fromY: number }

/** How an answer enters. Reduce Motion: a 100 ms fade, no delay, no travel. */
export function answerEntry(reduced: boolean): AnswerEntry {
  if (reduced) return { delayMs: 0, fadeMs: ASK_MOTION.reduced.fadeMs, fromY: 0 };
  return { delayMs: ASK_MOTION.answer.delayMs, fadeMs: ASK_MOTION.answer.fadeMs, fromY: ASK_MOTION.answer.fromY };
}

/** When source chip `index` starts its fade. Reduce Motion: no stagger. Chips
 *  past the cap share the last slot (a long list never trails on). */
export function chipDelay(index: number, reduced: boolean): number {
  if (reduced) return 0;
  const c = ASK_MOTION.chips;
  return c.delayMs + Math.min(Math.max(0, index), c.cap - 1) * c.staggerMs;
}

// ── The dots' one linear clock ───────────────────────────────────────────────
//
// The dots do NOT run as a looped sequence (that restarts through JS every
// cycle, so they would freeze exactly while the JS thread parses an answer).
// One linear 0 -> 1 timing loops on the native driver, and each dot reads it
// through an interpolation whose OUTPUT carries the pulse, already eased and
// already shifted by the dot's phase. No easing inside the interpolate.

/** cubic-bezier(x1, y1, x2, y2) as a pure function of x in [0, 1]. */
function bezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0, hi = 1, t = x;
    for (let k = 0; k < 40; k++) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-7) break;
      if (v < x) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return sy(t);
  };
}

/** Motion.easing.standard (the inOut curve) — the dots' rise and fall. */
const inOut = bezier(0.4, 0, 0.2, 1);

const round4 = (n: number) => Math.round(n * 10000) / 10000;

export interface DotRange { inputRange: number[]; outputRange: number[] }

/**
 * Dot i's opacity and scale over one clock cycle, sampled at `samples` points
 * on input k/(samples-1). The last sample equals the first exactly, so the
 * loop's wrap from 1 back to 0 is seamless.
 */
export function dotRanges(i: number): { opacity: DotRange; scale: DotRange } {
  const d = ASK_MOTION.thinking.dot;
  const ph = dotPhase(i);
  const n = d.samples;
  const input: number[] = [];
  const op: number[] = [];
  const sc: number[] = [];
  for (let k = 0; k < n; k++) {
    const x = k / (n - 1);
    const tMs = (k === n - 1 ? 0 : x * d.periodMs);
    const local = (((tMs - ph.startMs) % d.periodMs) + d.periodMs) % d.periodMs;
    let p: number;
    if (local < ph.upMs) p = inOut(local / ph.upMs);
    else if (local < ph.upMs + ph.downMs) p = 1 - inOut((local - ph.upMs) / ph.downMs);
    else p = 0;
    input.push(round4(x));
    op.push(round4(d.low + (d.high - d.low) * p));
    sc.push(round4(d.scaleLow + (1 - d.scaleLow) * p));
  }
  return { opacity: { inputRange: input, outputRange: op }, scale: { inputRange: input, outputRange: sc } };
}
