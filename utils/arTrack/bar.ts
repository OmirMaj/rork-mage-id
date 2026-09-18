// utils/arTrack/bar.ts — the pass/fail bar, written down BEFORE the walk.
//
// WHY THIS FILE EXISTS. A measured trial is only a trial if the bar it is
// judged against was fixed before the data came in. Until this file, the bar
// lived only in a design prompt; after a walk it could have been moved to fit
// whatever came out, and nobody would have seen the move. Now it is code: it is
// copied into every exported session file (`_derived.passFailBar`), it is
// restated in modules/mage-ar-track/README.md, and scripts/validate-ar-spike.ts
// pins every number — so changing one is a visible diff with a name on it,
// not a quiet reinterpretation.
//
// Every number here is a DESIGN CHOICE, argued from what a wrong pin costs, not
// a published figure. The cost of a wrong pin: a sub walks to the wrong room —
// a wasted trip plus a re-opened item, usually discovered in front of the
// client. Trust in a pin is binary: after two wrong ones every pin gets checked
// and the feature is worth nothing. So the headline is ROOM-HIT, not
// centimetres, and the tolerated failure is "no pin", never "a confident wrong
// pin".
//
// R = the SHORT dimension of the median room on his floor, measured off the
// calibrated sheet (for a fit-out office typically 3–4 m). Misses are stated in
// R so the bar means the same thing on a hospital floor and a house.
//
// PURE: no imports at all. The validator executes it and the screen can read
// it, but the screen must never JUDGE a session live (that would show him a
// verdict mid-walk and contaminate the next tap) — the bar is applied offline.

export const PASS_FAIL_BAR = {
  version: 1,
  /** When this bar was fixed. A bar dated after the walk it judges is not a bar. */
  fixedOn: '2026-09-17',

  /**
   * Which samples COUNT toward the headline. The first corridor is the easy
   * part; the question is whether a pin is still right after he has been
   * walking a while since the last confirmed position.
   */
  eligibility: {
    minSinceLastConfirmS: 8 * 60,
    minWalkedSinceLastConfirmM: 40,
    /** `limited` samples stay in the file and are reported separately. */
    trustRequired: 'tracked',
    /** Stations across an un-relocalized epoch break are excluded, with the reason. */
    sameWorldAsAnchorsRequired: true,
  },

  /** Ships as a PLACED pin: it arrives pre-pinned, he only corrects. */
  placedPin: {
    roomHitMin: 0.9,
    medianMaxR: 0.5,
    worstMaxR: 1.2,
    crossFloorMax: 0,
    normalTrackingMin: 0.95,
    minSessionS: 30 * 60,
    minSessionM: 150,
  },

  /** Ships as a SUGGESTION only: greyed "probably here", his tap still required. */
  suggestion: {
    roomHitMin: 0.7,
    medianMaxR: 1.0,
    worstMaxR: 3.0,
  },

  /** Any ONE of these kills the AR track, whatever the other numbers say. */
  kill: {
    roomHitBelow: 0.7,
    medianAboveR: 1.0,
    /** Any confident cross-floor error. ARKit has no concept of a floor. */
    crossFloorErrorsAbove: 0,
    /** Tracking lost more than once per this many minutes on a bare floor. */
    trackingLossEveryMinBelow: 10,
    batteryPerHourAbove: 0.4,
    thermalThrottleWithinMin: 30,
    /** Needing a re-anchor more often than this many minutes. */
    reanchorEveryMinBelow: 10,
  },

  /**
   * THE NULL MODEL — the most important comparison in the trial. Phase 1
   * already ships "carry the last room pin" for free, over the air. If ARKit
   * does not clearly beat that, the AR track is dead whatever the metres say.
   * BOTH conditions must hold.
   */
  nullModel: {
    medianReductionMin: 0.3,
    roomHitMustExceed: true,
  },

  /** How results are reported: n, median and MAXIMUM only (no percentiles at n ≈ 20–30). */
  reporting: ['n', 'median', 'max'],

  /**
   * Loop closure at the return station is REPORTED, never used as the bar: a
   * constant scale or heading bias cancels at the start point and never
   * cancels mid-walk. The published 0.14–0.79 m figures are exactly that
   * flattering number.
   */
  loopClosureIsTheBar: false,
} as const;

export type PassFailBar = typeof PASS_FAIL_BAR;
