// kitSpec.ts — every number behind the MAGE ID motion kit (lane MOTIONKIT).
//
// The kit is the app's way of moving things that ARRIVE in front of the
// reader: a list laying itself down, a chat turn gliding up out of the
// composer, a check that ticks when the work really finished, a counter that
// steps through real partial sums, two prices settling into one range, files
// flying into the folder they really landed in.
//
// PURE LITERALS, NO IMPORTS. bun validators load this file directly
// (scripts/validate-motion-kit.ts), and marketing/assets/motion-kit.js carries
// a COPY of it that the validator executes and compares value for value.
//
// Every number is OURS. The springs are Motion.spring presets
// (constants/designTokens.ts) under the same names; the durations are
// Motion.duration; the stagger is Motion.stagger. validate-motion-kit K2.2 /
// K2.3 compare them against the TEXT of designTokens, so the two can never
// drift.

export type KitSpring = { readonly stiffness: number; readonly damping: number; readonly mass: number };
export type KitSpringName = 'rise' | 'snap' | 'glideLead' | 'glideTrail' | 'sheet';

/** Spring presets: each equals Motion.spring.<same name>; ζ in [0.75, 1.05]. */
export const KIT_SPRING = {
  /** Something rising into place (a chat turn, a badge, the Level bubble). ζ 0.961. */
  rise: { stiffness: 260, damping: 31, mass: 1 },
  /** A check landing, a folder receiving. ζ 0.830 (under 1 % overshoot). */
  snap: { stiffness: 420, damping: 34, mass: 1 },
  /** A gliding marker's leading edge. ζ 0.965. */
  glideLead: { stiffness: 520, damping: 44, mass: 1 },
  /** A gliding marker's trailing edge, a beat behind. ζ 0.968. */
  glideTrail: { stiffness: 240, damping: 30, mass: 1 },
  /** A long travel (a file flying into its folder). ζ 1.006, no overshoot. */
  sheet: { stiffness: 320, damping: 36, mass: 1 },
} as const;

/** Durations in ms. tap..hold == Motion.duration; reducedFade == the Reduce Motion fade. */
export const KIT_MS = {
  tap: 100,
  fade: 160,
  enter: 220,
  exit: 160,
  swap: 160,
  layout: 240,
  glide: 320,
  hold: 900,
  /** Every Reduce Motion fade: opacity only, no travel. */
  reducedFade: 100,
  /** CountRoll: the old figure leaves (ease-in). */
  rollOut: 90,
  /** CountRoll: the new figure arrives (ease-out). */
  rollIn: 140,
  /** CheckSync: two ticks in one burst are at least this far apart. */
  beatGap: 120,
  /** MatrixFill: the evidence cell follows its label by this much. */
  pairLag: 60,
  /** CornerTags: clockwise, this far apart. */
  tagStagger: 60,
  /** PriorityGrid: the emphasis starts this long after the last cell landed. */
  priorityAfter: 120,
  /** AccumulateCards: one card (and one counter step) per beat. */
  accumulateStep: 70,
  /** Marketing matrix pan (only when the track overflows): out, hold, back. */
  panMs: 2400,
  panHoldMs: 800,
  panBackMs: 1600,
} as const;

/** The stagger between two entries, and how many rows ever stagger. ms == Motion.stagger. */
export const KIT_STAGGER = { ms: 35, cap: 8 } as const;

/** Distances in pt / CSS px. rise == tabFadeThrough's 8; roll == LOADER.settle.contentRise 6. */
export const KIT_DIST = {
  rise: 8,
  roll: 6,
  tagInset: 12,
  pairX: 6,
  depthY: 8,
  focusLift: 2,
  rule: 2,
  sendY: { page: 56, panel: 44 },
} as const;

export const KIT_SCALE = {
  from: 0.98,
  receive: 1.04,
  depthStep: 0.04,
  checkFrom: 0.6,
  flyMin: 0.3,
  pushMax: 1.06,
} as const;

export const KIT_OPACITY = { depthStep: 0.2, pushDim: 0.55 } as const;

/** Per-instance caps (E4) and the per-screen budget of animating kit nodes. */
export const KIT_CAPS = {
  list: 8,
  matrixRows: 8,
  accumulate: 6,
  checkBeats: 4,
  flyers: 3,
  tags: 4,
  stackLayers: 3,
  chips: 8,
  screenNodes: 24,
} as const;

/** Web timing functions: easeOut == Motion.css.easeOut; easeIn / easeInOut == Motion.easing. */
export const KIT_WEB = {
  easeOut: 'cubic-bezier(0.2, 0, 0, 1)',
  easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
  easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
} as const;

/** The Motion.easing beziers the native curves come from (decelerate / accelerate / standard). */
export const KIT_BEZIER = {
  out: [0, 0, 0.2, 1],
  in: [0.4, 0, 1, 1],
  inOut: [0.4, 0, 0.2, 1],
} as const;

/** Ceil to the next 10 ms (a spring's web duration). */
export function ceil10(ms: number): number {
  return Math.ceil(ms / 10 - 1e-9) * 10;
}
