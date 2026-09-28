// motionSpec.ts: every number the Commit Capsule moves by (moments wave, lane CAPSULE).
//
// Pure literals and one pure function, NO imports: bun loads this file directly
// (scripts/moments-checks/*.ts), so it must never reach react-native.
//
// The source of truth for every value below is the approved preview
// (scratchpad/moments-previews/morph.html, class Slide) and morph.md section 3.
// Four springs are the app's own Motion.spring presets under another name;
// scripts/moments-checks/capsule.ts (C2) compares them against the TEXT of
// constants/designTokens.ts so the two can never drift.
//
// Every spring keeps ζ = d / (2·√(k·m)) inside [0.75, 1.05] (C1): a hair of
// overshoot at most, never a bounce.

export type SpringCfg = { stiffness: number; damping: number; mass: number };

export const MOMENT_SPRING = {
  snapBack:      { stiffness: 380, damping: 39, mass: 1 },   // ζ 1.00  release short of threshold (carries vx)
  dock:          { stiffness: 420, damping: 34, mass: 1 },   // ζ 0.83  == Motion.spring.snap; x -> T on commit (carries vx)
  contractTrail: { stiffness: 240, damping: 30, mass: 1 },   // ζ 0.97  == Motion.spring.glideTrail; pill -> circle
  expand:        { stiffness: 260, damping: 31, mass: 1 },   // ζ 0.96  == Motion.spring.rise; circle -> result pill
  homeLead:      { stiffness: 520, damping: 44, mass: 1 },   // ζ 0.96  == Motion.spring.glideLead; failure: trail home first
  homeTrail:     { stiffness: 200, damping: 28, mass: 1 },   // ζ 0.99  failure: x home second (pulls itself home)
  settle:        { stiffness: 300, damping: 35, mass: 1 },   // ζ 1.01  check lifts 3 and settles
  headScale:     { stiffness: 420, damping: 34, mass: 1 },   // ζ 0.83  (preview SP.snapU) grab 1.04 / lock 1.07
  sealX:         { stiffness: 200, damping: 27, mass: 1 },   // ζ 0.95  (SIGNLINE)
  sealY:         { stiffness: 320, damping: 35, mass: 1 },   // ζ 0.98  (SIGNLINE)
  press:         { stiffness: 600, damping: 44, mass: 1 },   // ζ 0.90  (SIGNLINE) stamp return 0.97 -> 1
} as const;

/** Cubic-bezier control points; build with Easing.bezier(...MOMENT_EASE.out). */
export const MOMENT_EASE = { out: [0.2, 0, 0, 1], fold: [0.32, 0.72, 0, 1] } as const;

/** Milliseconds (and the three px values the timeline uses: settleDy, reasonRise, nudgePx). */
export const MOMENT_TIMING = {
  iconFade: 100, lockFade: 120, lockRimOut: 200, busyIn: 160, labelOut: 120, ringIn: 120, ringOut: 100,
  contractAt: 120, ringAt: 240, rigidHapticAt: 140, minBusy: 500,
  toneSuccess: 160, checkShortAt: 60, checkShort: 110, checkLongAt: 170, checkLong: 170, expandAt: 300,
  successHapticAt: 340, resultIn: 160, resultInAt: 380, settleAt: 720, settleLift: 80, settleDy: -3,
  neutralIconAt: 60, neutralIconIn: 160, neutralExpandAt: 240, neutralHapticAt: 280,
  queuedIconAt: 60, queuedExpandAt: 240, queuedResultAt: 320,
  failTone: 140, failIconAt: 60, failIcon: 120, failHomeLeadAt: 480, failHomeTrailAt: 560, failToneBack: 340,
  failChevAt: 700, failLabelAt: 800, reasonIn: 200, reasonOut: 140, reasonRise: 4,
  shimmerSweep: 2200, shimmerRest: 1400, shimmerWindow: 56,
  ringRev: 900, holdFill: 700, srOpen: 240, srBar: 180, srClose: 140,
  nudgeOut: 90, nudgePx: 16, reasonPulse: 240, reasonPulseFrom: 0.55,
  reducedFade: 100, reducedHold: 200, reducedFailHold: 700,
  holdMs: 1200, holdMsCompact: 600,
} as const;

/** H track height, D capsule diameter, inset rail padding, icon size, check box, ring inset. */
export const CAPSULE_GEOMETRY = {
  lg:   { H: 64, D: 56, inset: 4, icon: 22, checkW: 22, checkH: 11, ringInset: 10 },
  md:   { H: 52, D: 44, inset: 4, icon: 20, checkW: 18, checkH: 9,  ringInset: 8, widthPct: 0.64, minWidth: 220 },
  line: { H: 56, D: 40, inset: 20, icon: 18, checkW: 15, checkH: 7.5, ringInset: 7 },
} as const;

/**
 * Gesture and shape rules. resistA/B/C are the cubic's published coefficients
 * (rounded, as morph.md prints them); capsuleMath derives the exact ones from
 * resistKnee and resistA so the curve meets the identity at 24 with no step.
 */
export const CAPSULE_RULES = {
  threshold: 0.85, thresholdCompact: 0.70, unlockHysteresis: 0.07, notches: [0.25, 0.5, 0.75], notchHysteresis: 0.06,
  flickMinProgress: 0.55, flickMinVx: 900, flickProjectionS: 0.099,
  activeOffsetX: [-8, 8], failOffsetY: [-14, 14], hitSlop: 12,
  rubberStart: 12, rubberEnd: 14, rubberDisabled: 10,
  resistKnee: 24, resistA: 0.45, resistB: 0.04583, resistC: -0.000955,
  checkLeg: 2.6, ringStroke: 2, grabScale: 1.04, lockScale: 1.07, srConfirmFrac: 0.66,
} as const;

/** ζ = d / (2·√(k·m)). */
export function dampingRatio(s: SpringCfg): number {
  return s.damping / (2 * Math.sqrt(s.stiffness * s.mass));
}
