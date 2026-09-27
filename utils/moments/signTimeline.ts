// signTimeline.ts — every number of the signing ceremony, shared by the
// components and the validator. Taken from the approved preview
// (scratchpad/moments-previews/morph.html, Ceremony.onConfirmed and the CSS)
// plus the binding two-arc seal graft.
//
// All times are ms after the write CONFIRMED (t' = 0), unless stated.
// Pure literals, no imports (bun loads it).

export const LINE_GEOMETRY = {
  /** Each panel of the letter card. */
  panel: 208,
  /** Card height before the fold collapse (two panels). */
  card: 416,
  /** Panel corner radius (Tokens.radius.xl). */
  radius: 18,
  /** Pad max height, and the 300-wide coordinate space. */
  padMax: 172,
  coordW: 300,
  coordH: 150,
  placeholderTop: 70,
  xLeft: 22,
  xTop: 112,
  /** The capsule rail (CAPSULE_GEOMETRY.line: H 56, D 40, inset 20). */
  zoneTop: 110,
  zoneH: 56,
  D: 40,
  inset: 20,
  grooveTop: 27,
  grooveH: 2,
  /** Centre of the groove / the signature line, bottom-panel coords. */
  lineY: 138,
  signedLineH: 1.25,
  nameTop: 164,
  recordTop: 186,
  recordRight: 88,
  /** Label / busy / reason row, zone-relative. */
  labelTop: 76,
  labelH: 18,
  clearTop: 10,
  clearRight: 12,
  typedLeft: 72,
  typedRight: 26,
  typedTop: 96,
  /** SR Confirm/Cancel bar, zone-relative. */
  srTop: 70,
  srH: 30,
  /** The seal box and the no-start band's margin above the head's footprint. */
  seal: 64,
  noStartMargin: 4,
  /**
   * The capsule head's positive hitSlop (must equal CAPSULE_RULES.hitSlop;
   * validate-moments S7 pins it). Android RNGH honours positive hitSlop, so
   * the head can be grabbed from lineY - D/2 - hitSlop = 106.
   */
  capsuleHitSlop: 12,
  darkBodyOpacity: 0.45,
} as const;

/**
 * The no-start rect handed to the pad, in display coords (bottom-panel = pad space).
 * It starts at the HIGHER of the line zone's top (110) and the head's grab
 * area top (118 - hitSlop 12 = 106), so no touch that could reach the line
 * zone or the capsule head can ever start an ink stroke. = 106.
 */
export function noStartRectFor(W: number, padH: number): { x: number; y: number; width: number; height: number } {
  const headTop = LINE_GEOMETRY.lineY - LINE_GEOMETRY.D / 2;
  const y = Math.min(LINE_GEOMETRY.zoneTop, headTop - LINE_GEOMETRY.capsuleHitSlop, headTop - LINE_GEOMETRY.noStartMargin); // 106
  return { x: 0, y, width: W, height: Math.max(0, padH - y) };
}

/** Pad height for a card width: min(172, 150 * W / 300). */
export function padHeightFor(W: number): number {
  return Math.min(LINE_GEOMETRY.padMax, (LINE_GEOMETRY.coordH * W) / LINE_GEOMETRY.coordW);
}

export const SEAL_TIMING = {
  ringOut: 100,
  toneIn: 160,
  busyOut: 120,
  liftAt: 100,
  liftScale: 1.12,
  liftDisc: 0.85,
  shadowLift: 0.22,
  shadowLiftMs: 300,
  checkShortAt: 160,
  checkShort: 110,
  checkLongAt: 270,
  checkLong: 170,
  countAt: 160,
  countIn: 160,
  /** Closing signer: the check waits for the ring to close. */
  closeCheckShortAt: 640,
  closeCheckLongAt: 750,
  bindingAt: 920,
  chipFade: 160,
  ringAt: 200,
  ringIn: 220,
  ringFrom: 0.86,
  arcDraw: 360,
  pressAt: 560,
  press: 80,
  pressScale: 0.97,
  shadowPress: 0.08,
  contactAt: 640,
  cardDip: 1,
  lineAt: 680,
  lineDraw: 320,
  recordAt: 760,
  recordIn: 160,
  /** Reduce Motion path. */
  rmTone: 200,
  rmWait: 120,
  rmOut: 100,
  rmIn: 120,
  rmLine: 200,
  rmRecord: 200,
} as const;

export const FOLD_TIMING = {
  /** The fold starts this long after contact. */
  afterContact: 1500,
  fold: 560,
  shadeMax: 0.18,
  sealScale: 0.86,
  sealShadow: 0.16,
  sealShadowMs: 400,
  creaseAt: 560,
  collapseAt: 600,
  perspective: 1200,
  /** Reduce Motion / Android cross-fade. */
  xfSealOut: 100,
  xfFace: 200,
  xfSealIn: 200,
} as const;

export const TURN_TIMING = {
  turn: 560,
  perspective: 1400,
  xfOut: 100,
  xfIn: 100,
} as const;

export const CEREMONY_TIMING = {
  armOut: 140,
  grooveWarm: 160,
  placeholderFade: 160,
  fieldsDim: 0.4,
  consentShort: 120,
  consentLong: 120,
  consentLongDelay: 100,
} as const;

/** Easing.bezier(...) control points: the fold/turn curve and the ease-out curve. */
export const SIGN_EASE = { fold: [0.32, 0.72, 0, 1], out: [0.2, 0, 0, 1] } as const;
