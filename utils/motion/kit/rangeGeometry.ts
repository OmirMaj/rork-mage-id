// rangeGeometry.ts — Cost Cards to Range, pure geometry (no imports).
//
// Two prices resolve into one low–high range on a 2 pt track (the Level's
// track); the expected figure is the Level bubble. This file only answers
// WHERE things sit and how far each one travels from the track's centre.

export type RangeLayout = {
  /** high ≤ low (or not a number): one value, no range motion at all. */
  single: boolean;
  /** The two labels would collide on one line: they stack under the track and do not travel. */
  stacked: boolean;
  width: number;
  /** The expected value clamped into [low, high], or null. */
  expected: number | null;
  /** The bubble's centre x on the track (pt from the left), or null. */
  expectedX: number | null;
  /** Each label's resting left edge. */
  lowX: number;
  highX: number;
  /** Travel: where each label starts relative to its resting place (centred on the track). */
  lowFromX: number;
  highFromX: number;
  /** The bubble's start relative to its resting place (the track centre). */
  bubbleFromX: number;
};

/** The minimum gap between the two labels on one line. */
export const RANGE_LABEL_GAP = 12;

const fin = (x: number | null | undefined): x is number => typeof x === 'number' && Number.isFinite(x);

/**
 * Where the range parts rest and how far each travels, for a track `widthPt`
 * wide and labels `labelW` wide (one number for both, or each).
 */
export function rangeLayout(
  low: number,
  high: number,
  expected: number | null | undefined,
  widthPt: number,
  labelW: number | { low: number; high: number },
): RangeLayout {
  const width = fin(widthPt) && widthPt > 0 ? widthPt : 0;
  const lw = typeof labelW === 'number' ? labelW : labelW.low;
  const hw = typeof labelW === 'number' ? labelW : labelW.high;
  const lowW = fin(lw) && lw > 0 ? lw : 0;
  const highW = fin(hw) && hw > 0 ? hw : 0;
  const single = !(fin(low) && fin(high) && high > low);
  const centre = width / 2;
  const base: RangeLayout = {
    single, stacked: false, width, expected: null, expectedX: null,
    lowX: 0, highX: Math.max(0, width - highW), lowFromX: 0, highFromX: 0, bubbleFromX: 0,
  };
  if (single) {
    // One value: one label, centred; nothing travels.
    return { ...base, lowX: Math.max(0, centre - lowW / 2), highX: Math.max(0, centre - lowW / 2) };
  }
  let expectedX: number | null = null;
  let clamped: number | null = null;
  if (fin(expected)) {
    clamped = Math.min(high, Math.max(low, expected));
    expectedX = width * ((clamped - low) / (high - low));
  }
  const stacked = lowW + highW + RANGE_LABEL_GAP > width;
  const lowX = 0;
  const highX = Math.max(0, width - highW);
  return {
    single: false,
    stacked,
    width,
    expected: clamped,
    expectedX,
    lowX,
    highX,
    // From the centre of the track to the resting edge. Stacked labels never travel.
    lowFromX: stacked ? 0 : (centre - lowW / 2) - lowX,
    highFromX: stacked ? 0 : (centre - highW / 2) - highX,
    bubbleFromX: expectedX == null ? 0 : centre - expectedX,
  };
}

/** Do the two labels overlap at rest? (Never, by construction: stacked labels sit on two lines.) */
export function labelsOverlap(l: RangeLayout, lowW: number, highW: number): boolean {
  if (l.single || l.stacked) return false;
  return l.lowX + lowW + RANGE_LABEL_GAP > l.highX && highW > 0 && lowW > 0;
}
