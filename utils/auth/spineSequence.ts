// utils/auth/spineSequence.ts — the timing plan for the auth spine ("Take D").
//
// The welcome spine runs one sample job down a line: Ask → Estimate → Contract
// → Schedule → Paid. Every element on screen reads its opacity / transform off
// ONE clock (an Animated.Value counting milliseconds), through the beats below.
// That keeps the whole sequence on the native driver (transform and opacity
// only) and makes the plan itself pure: these numbers are checked by
// scripts/validate-auth-spine.ts without React Native.
//
// Timings come from the approved design file
// (design-previews/night-shift-x-progress-line.html, section #take-d, the
// .xkw / .xkl custom properties). About 6.5 seconds, once per mount. Reduced
// motion gets the final state at once: every beat at 0 with no duration.
//
// Pure: no react-native import (bun runs the validator on it).

export type Beat = { readonly at: number; readonly dur: number };

/** The five stops, in the order the line reaches them. */
export const SPINE_STOPS = ['ask', 'estimate', 'contract', 'schedule', 'paid'] as const;
export type SpineStop = (typeof SPINE_STOPS)[number];

/** The longest the welcome sequence may run, end to end. */
export const SPINE_MAX_MS = 7000;
/** The mini spine (login / sign-up) is a short reprise. */
export const MINI_MAX_MS = 2500;
/** A clock value past every beat of every plan: the final state. */
export const SPINE_FINAL_CLOCK = 10000;

/** The sample job's address (sample data, shown on the Ask card and chip). */
export const ASK_ADDRESS = '418 Atlantic Ave, Brooklyn';
/** The sample question, typed into the Ask card one character at a time. */
export const ASK_QUESTION = `${ASK_ADDRESS} · kitchen remodel`;
/** Milliseconds per typed character. */
export const TYPE_CHAR_MS = 14;

export const WELCOME_KEYS = [
  'askCard', 'askNode', 'askType', 'ans0', 'ans1', 'ans2', 'ansTag', 'fine',
  'line0', 'node1', 'dimAsk', 'estimateCard',
  'line1', 'node2', 'dimEstimate', 'contractCard', 'signature', 'signedBy',
  'line2', 'node3', 'dimContract', 'scheduleCard', 'bar0', 'bar1', 'bar2', 'bar3', 'today', 'todayLabel', 'onTrack',
  'line3', 'dimSchedule', 'paidCard', 'sentOut', 'paidIn', 'paidNode', 'rim', 'glow',
  'head0', 'head1', 'lede',
] as const;
export type WelcomeKey = (typeof WELCOME_KEYS)[number];
export type WelcomePlan = Readonly<Record<WelcomeKey, Beat>>;

const b = (at: number, dur: number): Beat => ({ at, dur });

// The design's welcome timeline (.xkw): --n0 240, --ty 760, --ans 1880,
// --as 130, --l0 3000/480, --l1 3700/300, --sig 4250, --l2 4950/300,
// --gb 5260, --now 5800, --ok 6020, --l3 6150/340, --flip 6520. Card
// entrances are the .xb-hang delays (260, 3250, 3760, 5000, 6020) at 680 ms.
const FLIP = 6520;
const ANS = 1880;
const ANS_STEP = 130;
const WELCOME: WelcomePlan = {
  askCard: b(260, 680),
  askNode: b(240, 460),
  askType: b(760, ASK_QUESTION.length * TYPE_CHAR_MS),
  ans0: b(ANS, 440),
  ans1: b(ANS + ANS_STEP, 440),
  ans2: b(ANS + 2 * ANS_STEP, 440),
  ansTag: b(ANS + 3 * ANS_STEP + 120, 320),
  fine: b(ANS + 3 * ANS_STEP, 500),
  line0: b(3000, 480),
  node1: b(3480, 320),
  dimAsk: b(3000, 680),
  estimateCard: b(3250, 680),
  line1: b(3700, 300),
  node2: b(4000, 320),
  dimEstimate: b(3700, 560),
  contractCard: b(3760, 680),
  signature: b(4250, 930),
  signedBy: b(5150, 400),
  line2: b(4950, 300),
  node3: b(5250, 320),
  dimContract: b(4950, 560),
  scheduleCard: b(5000, 680),
  bar0: b(5260, 440),
  bar1: b(5350, 440),
  bar2: b(5440, 440),
  bar3: b(5530, 440),
  today: b(5800, 380),
  todayLabel: b(6020, 300),
  onTrack: b(6020, 340),
  line3: b(6150, 340),
  dimSchedule: b(6150, 560),
  paidCard: b(6020, 680),
  sentOut: b(FLIP, 260),
  paidIn: b(FLIP + 120, 340),
  paidNode: b(FLIP, 460),
  rim: b(FLIP + 140, 300),
  glow: b(FLIP, 460),
  head0: b(900, 600),
  head1: b(970, 600),
  lede: b(1100, 500),
};

export const MINI_KEYS = [
  'askNode', 'chip0', 'chip1', 'chip2', 'chip3', 'chip4',
  'dim0', 'dim1', 'dim2', 'dim3',
  'line0', 'node1', 'line1', 'node2', 'signature', 'line2', 'node3', 'line3',
  'sentOut', 'paidIn', 'paidNode', 'rim', 'glow',
] as const;
export type MiniKey = (typeof MINI_KEYS)[number];
export type MiniPlan = Readonly<Record<MiniKey, Beat>>;

// The design's login timeline (.xkl): chips arrive inside one 1800 ms window
// from 120 ms (the xk-q0…q4 keyframe stops), then each dims as the next one
// lands. --n0 140, --l0 260/260, --l1 600/260, --sig 900, --l2 960/260,
// --l3 1240/300, --flip 1560.
const MINI_START = 120;
const MINI_WINDOW = 1800;
const at = (frac: number) => Math.round(MINI_START + MINI_WINDOW * frac);
const MINI_FLIP = 1560;
const MINI_END = MINI_START + MINI_WINDOW;
const MINI: MiniPlan = {
  askNode: b(140, 460),
  chip0: b(at(0), at(0.12) - at(0)),
  chip1: b(at(0.15), at(0.27) - at(0.15)),
  chip2: b(at(0.32), at(0.44) - at(0.32)),
  chip3: b(at(0.49), at(0.61) - at(0.49)),
  chip4: b(at(0.66), at(0.8) - at(0.66)),
  dim0: b(at(0.24), MINI_END - at(0.24)),
  dim1: b(at(0.4), MINI_END - at(0.4)),
  dim2: b(at(0.57), MINI_END - at(0.57)),
  dim3: b(at(0.74), MINI_END - at(0.74)),
  line0: b(260, 260),
  node1: b(520, 320),
  line1: b(600, 260),
  node2: b(860, 320),
  signature: b(900, 930),
  line2: b(960, 260),
  node3: b(1220, 320),
  line3: b(1240, 300),
  sentOut: b(MINI_FLIP, 260),
  paidIn: b(MINI_FLIP + 120, 340),
  paidNode: b(MINI_FLIP, 460),
  rim: b(MINI_FLIP + 140, 300),
  glow: b(MINI_FLIP, 460),
};

/** How much each chip on the mini spine dims once the line has left it. */
export const MINI_DIM = [0.5, 0.38, 0.26, 0.14] as const;
/** How much each welcome card dims once the line has left it (one amount, so the stack stays even). */
export const CARD_DIM = 0.22;

function zeroed<K extends string>(plan: Readonly<Record<K, Beat>>): Readonly<Record<K, Beat>> {
  const out = {} as Record<K, Beat>;
  for (const k of Object.keys(plan) as K[]) out[k] = b(0, 0);
  return out;
}

/** The welcome plan. Reduced motion: the final state at once. */
export function welcomePlan(reduced = false): WelcomePlan {
  return reduced ? zeroed(WELCOME) : WELCOME;
}

/** The login / sign-up mini spine plan. Reduced motion: the final state at once. */
export function miniPlan(reduced = false): MiniPlan {
  return reduced ? zeroed(MINI) : MINI;
}

/** When the last beat of a plan finishes. */
export function planTotal(plan: Readonly<Record<string, Beat>>): number {
  let end = 0;
  for (const k of Object.keys(plan)) end = Math.max(end, plan[k].at + plan[k].dur);
  return end;
}

export type Curve = 'linear' | 'out' | 'sine';

/** ease-out cubic (the design's --out, close enough at these durations) and ease-in-out sine. */
export function curveAt(curve: Curve, x: number): number {
  const t = Math.min(1, Math.max(0, x));
  if (curve === 'out') return 1 - Math.pow(1 - t, 3);
  if (curve === 'sine') return -(Math.cos(Math.PI * t) - 1) / 2;
  return t;
}

/**
 * An Animated interpolation for one beat, eased by sampling the curve: the
 * native driver ignores an interpolation's `easing`, so the curve is baked into
 * the input / output points. Before the beat it holds `from`, after it `to`
 * (the caller clamps). A zero-length beat (reduced motion) still yields a
 * strictly rising input range, reaching `to` one millisecond after `at`.
 */
export function ramp(beat: Beat, from: number, to: number, curve: Curve = 'out', steps = 6): {
  inputRange: number[]; outputRange: number[];
} {
  if (beat.dur <= 0) return { inputRange: [beat.at, beat.at + 1], outputRange: [from, to] };
  const n = curve === 'linear' ? 1 : Math.max(1, Math.round(steps));
  const inputRange: number[] = [];
  const outputRange: number[] = [];
  for (let i = 0; i <= n; i++) {
    inputRange.push(beat.at + (beat.dur * i) / n);
    outputRange.push(from + (to - from) * curveAt(curve, i / n));
  }
  return { inputRange, outputRange };
}

// ── The signature ──────────────────────────────────────────────────────────
// "Dana Ruiz" as five pen strokes (D, ana, R stem, R bowl + uiz + tail, i dot),
// drawn by hand as paths for the sample contract; not a real person's. Each
// entry is [path, start offset ms, duration ms]: about one path unit per
// millisecond, with short lifts between strokes. The whole name takes ~0.9 s.
export const SIGNATURE_VIEWBOX = '8 10 238 58';
export const SIGNATURE_STROKES: readonly (readonly [string, number, number])[] = [
  ['M30 19C29 29 25 41 22 50C21 54 14 55 13 51C12 47 20 46 30 48C47 51 62 41 60 29C58 17 41 12 27 18C20 21 17 25 21 27', 0, 160],
  ['M72 38C68 34 62 37 61 44C60 50 65 52 69 48C72 45 74 40 75 36C74 41 72 47 73 50C74 52 77 50 79 47C81 44 82 39 83 36C83 40 81 46 80 50C82 42 87 36 91 37C95 38 94 44 93 50C94 52 97 50 99 47C101 44 107 38 114 37C110 34 104 38 103 44C102 50 107 52 111 48C114 45 116 40 117 36C116 41 114 47 115 50C116 53 121 51 126 45', 210, 220],
  ['M152 17C150 28 146 41 142 51', 500, 45],
  ['M151 19C161 12 175 17 168 27C164 32 157 33 150 31C157 35 160 44 164 49C166 52 169 50 171 46C172 42 173 39 174 36C173 41 171 47 173 50C175 52 179 48 181 43C182 40 183 38 183 36C182 41 181 47 183 50C184 52 187 50 189 47C190 44 191 40 192 37C191 42 190 47 192 50C193 52 196 50 198 47C201 41 206 37 211 37C215 37 213 43 207 48C205 49 208 48 212 50C217 53 215 62 208 64C202 65 203 58 211 55C221 51 232 45 242 39', 575, 285],
  ['M193 31C194 30.2 195.5 29.5 196.8 29', 880, 30],
];

/** When the last stroke lifts, relative to the signature beat. */
export function signatureSpan(): number {
  let end = 0;
  for (const [, so, sd] of SIGNATURE_STROKES) end = Math.max(end, so + sd);
  return end;
}

/**
 * The length of an absolute SVG path made of M and C commands (the signature's
 * only commands), by sampling each cubic. Used as the stroke's dash length so
 * strokeDashoffset can draw it from nothing to whole.
 */
export function pathLength(d: string): number {
  const tokens = d.match(/[MC]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  let i = 0;
  let cmd = '';
  let x = 0;
  let y = 0;
  let len = 0;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const tk = tokens[i];
    if (/^[MC]$/i.test(tk)) { cmd = tk.toUpperCase(); i++; continue; }
    if (cmd === 'M') { x = num(); y = num(); cmd = 'C'; continue; }
    if (cmd === 'C') {
      const x1 = num(), y1 = num(), x2 = num(), y2 = num(), x3 = num(), y3 = num();
      let px = x;
      let py = y;
      const N = 24;
      for (let s = 1; s <= N; s++) {
        const t = s / N;
        const u = 1 - t;
        const qx = u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3;
        const qy = u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3;
        len += Math.hypot(qx - px, qy - py);
        px = qx;
        py = qy;
      }
      x = x3;
      y = y3;
      continue;
    }
    i++; // an unknown token: skip it rather than loop forever
  }
  return len;
}
