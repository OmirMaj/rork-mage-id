// chatStack.ts — the Chat Message Stack's numbers (the Ask MAGE motion).
//
// PURE, NO IMPORTS: AILOOK's components/brain/ask/askMotion.ts can be a
// one-line re-export of this file and bun still loads it. The numbers are
// byte-equal to AILOOK.txt M1 ASK_MOTION; the only additions are
// thinking.dot.samples, thinking.dot.reducedOpacity and chips.cap.
// scripts/validate-motion-kit.ts K2.7 holds the table equal to AILOOK's.
//
// The motion, in one breath: your words leave the composer and glide up into
// the conversation (56 pt on the page, 44 in the panel, on Motion.spring.rise);
// 140 ms later — only if the answer has not already come — a calm row of three
// dots appears; the answer fades in whole (no typewriter), its chips after it.

export type ChatRange = { inputRange: number[]; outputRange: number[] };

export const CHAT_STACK = {
  send: {
    fromY: { page: 56, panel: 44 },
    fromScale: 0.98,
    fadeMs: 120,
    spring: { stiffness: 260, damping: 31, mass: 1 }, // == Motion.spring.rise, ζ 0.961
  },
  thinking: {
    delayMs: 140,
    fadeMs: 160,
    fromY: 6,
    stillWorkingAfterMs: 10000,
    dot: {
      count: 3, size: 6, gap: 5, periodMs: 1200, riseMs: 360, staggerMs: 160,
      low: 0.3, high: 1, scaleLow: 0.8, samples: 25, reducedOpacity: 0.6,
    },
  },
  thinkingOut: { fadeMs: 120 },
  answer: { delayMs: 60, fadeMs: 220, fromY: 8 }, // fadeMs == Motion.duration.enter
  chips: { delayMs: 120, staggerMs: 35, fadeMs: 160, cap: 8 }, // == Motion.stagger / duration.fade
  sendPress: { scale: 0.92, spring: { stiffness: 420, damping: 34, mass: 1 } }, // == Motion.spring.snap
  jump: { showAfterPx: 160, fadeMs: 160 },
  reduced: { fadeMs: 100 },
} as const;

export type ChatVariant = 'page' | 'panel';

/** The user turn's entrance. Reduced: no travel, no scale, a 100 ms fade. */
export function sendEntry(variant: ChatVariant, reduced: boolean): { fromY: number; fromScale: number; fadeMs: number; spring: boolean } {
  if (reduced) return { fromY: 0, fromScale: 1, fadeMs: CHAT_STACK.reduced.fadeMs, spring: false };
  const s = CHAT_STACK.send;
  return { fromY: variant === 'panel' ? s.fromY.panel : s.fromY.page, fromScale: s.fromScale, fadeMs: s.fadeMs, spring: true };
}

/** Dot i's pulse inside the 1200 ms period: starts at i·160, up 360, down 360, rest the remainder. */
export function dotPhase(i: number): { startMs: number; upMs: number; downMs: number; restMs: number } {
  const d = CHAT_STACK.thinking.dot;
  return { startMs: i * d.staggerMs, upMs: d.riseMs, downMs: d.riseMs, restMs: d.periodMs - 2 * d.riseMs };
}

/** The assistant answer's entrance. Reduced: { 0, 100, 0 }. */
export function answerEntry(reduced: boolean): { delayMs: number; fadeMs: number; fromY: number } {
  if (reduced) return { delayMs: 0, fadeMs: CHAT_STACK.reduced.fadeMs, fromY: 0 };
  const a = CHAT_STACK.answer;
  return { delayMs: a.delayMs, fadeMs: a.fadeMs, fromY: a.fromY };
}

/** Chip i's delay: 120 + min(i, 7)·35 (chip 8+ appears with chip 7). Reduced: 0. */
export function chipDelay(i: number, reduced: boolean): number {
  if (reduced) return 0;
  const c = CHAT_STACK.chips;
  const k = Math.max(0, Math.min(Math.floor(Number.isFinite(i) ? i : 0), c.cap - 1));
  return c.delayMs + k * c.staggerMs;
}

// ── the dots' pre-sampled ranges ─────────────────────────────────────────────
// The native interpolation allowlist has no `easing`, so the pulse (an inOut
// rise, an inOut fall, a rest) is sampled into 25 points on the clock's input
// k/24 and dot i's phase is baked into the OUTPUT (utils/levelTimeline.ts
// skeletonWave), so the input stays 0…1 and increasing on ONE shared clock.

const round4 = (x: number): number => {
  const r = Math.round(x * 1e4) / 1e4;
  return r === 0 ? 0 : r;
};

/** cubic-bezier(0.4, 0, 0.2, 1) — Motion.easing.standard — as a function of x. */
function inOut(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const x1 = 0.4; const y1 = 0; const x2 = 0.2; const y2 = 1;
  const cx = 3 * x1; const bx = 3 * (x2 - x1) - cx; const ax = 1 - cx - bx;
  const cy = 3 * y1; const by = 3 * (y2 - y1) - cy; const ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const dsx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  let t = x;
  for (let i = 0; i < 8; i++) {
    const e = sx(t) - x;
    const d = dsx(t);
    if (Math.abs(e) < 1e-7 || Math.abs(d) < 1e-6) break;
    t -= e / d;
  }
  let lo = 0; let hi = 1;
  if (Math.abs(sx(t) - x) > 1e-6 || t < 0 || t > 1) {
    t = x;
    for (let i = 0; i < 40; i++) {
      if (sx(t) < x) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
  }
  return ((ay * t + by) * t + cy) * t;
}

/** The pulse's lift 0…1 at `localMs` into a dot's own cycle. */
export function pulseAt(localMs: number): number {
  const d = CHAT_STACK.thinking.dot;
  const t = ((localMs % d.periodMs) + d.periodMs) % d.periodMs;
  if (t < d.riseMs) return inOut(t / d.riseMs);
  if (t < 2 * d.riseMs) return 1 - inOut((t - d.riseMs) / d.riseMs);
  return 0;
}

/** Dot i's opacity and scale on the shared clock: 25 samples on k/24, out[24] === out[0]. */
export function dotRanges(i: number): { opacity: ChatRange; scale: ChatRange } {
  const d = CHAT_STACK.thinking.dot;
  const n = d.samples;
  const inputRange = Array.from({ length: n }, (_, k) => k / (n - 1));
  const start = dotPhase(i).startMs;
  const lift = inputRange.map((x) => pulseAt(x * d.periodMs - start));
  const opacity = lift.map((p) => round4(d.low + (d.high - d.low) * p));
  const scale = lift.map((p) => round4(d.scaleLow + (1 - d.scaleLow) * p));
  opacity[n - 1] = opacity[0];
  scale[n - 1] = scale[0];
  return { opacity: { inputRange, outputRange: opacity }, scale: { inputRange: inputRange.slice(), outputRange: scale } };
}
