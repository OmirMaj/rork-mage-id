// utils/roomScan/units.ts — the ONE place a scan's metres become feet and
// inches, and the one place a typed tape measurement becomes metres.
//
// Rounding, chosen once:
//   lengths     to the nearest inch for display ("8 ft 2 in"),
//   areas       to one decimal of a square foot,
//   runs        to one decimal of a foot.
// The quantities keep full precision until the last step, so rounding happens
// once and a sum on screen is the sum of what was measured, not of rounded parts.
//
// Pure: no React, no i18n. The words "ft", "in" and "sq ft" are unit symbols
// and are the same in English and Spanish app copy here.

export const M_TO_FT = 3.28084;
export const M2_TO_SF = 10.7639;
export const IN_PER_FT = 12;

export const metresToFeet = (m: number): number => m * M_TO_FT;
export const feetToMetres = (ft: number): number => ft / M_TO_FT;
export const metresToInches = (m: number): number => m * M_TO_FT * IN_PER_FT;
export const inchesToMetres = (inches: number): number => inches / IN_PER_FT / M_TO_FT;
export const sqMetresToSqFeet = (m2: number): number => m2 * M2_TO_SF;

export const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Whole feet and whole inches, rounded to the nearest inch (11.6 in rolls to the next foot). */
export function feetInches(m: number): { ft: number; inches: number } {
  if (!Number.isFinite(m) || m <= 0) return { ft: 0, inches: 0 };
  const total = Math.round(metresToInches(m));
  return { ft: Math.floor(total / IN_PER_FT), inches: total % IN_PER_FT };
}

/** "8 ft 2 in". Always both parts, so a column of lengths lines up. */
export function formatFeetInches(m: number): string {
  const { ft, inches } = feetInches(m);
  return `${ft} ft ${inches} in`;
}

/** "41.5 sq ft" */
export function formatSqFt(sf: number): string {
  return `${round1(sf).toFixed(1)} sq ft`;
}

/** "24.0 ft" */
export function formatRunFt(lf: number): string {
  return `${round1(lf).toFixed(1)} ft`;
}

/** A door or window size: "2 ft 6 in by 6 ft 8 in". */
export function formatSizeIn(widthIn: number, heightIn: number): string {
  const part = (inches: number) => `${Math.floor(inches / IN_PER_FT)} ft ${inches % IN_PER_FT} in`;
  return `${part(widthIn)} by ${part(heightIn)}`;
}

/**
 * A typed tape measurement, in metres, or null when it cannot be read.
 *
 * Accepts what a person types off a tape:
 *   8 ft 2 in   8ft 2in   8' 2"   8'2   8 2   8-2     feet then inches
 *   8 ft        8'                                    feet only
 *   98 in       98"                                   inches only
 *   8.5                                               decimal feet
 *   8 2 1/2     8' 2 1/2"                             a fraction of an inch
 * Inches of 12 or more after feet are refused (a typo, not a measurement).
 * Zero, negatives and anything over 200 ft are refused.
 */
export function parseTapeMeasure(input: string): number | null {
  const raw = (input ?? '').trim().toLowerCase();
  if (!raw || raw.startsWith('-')) return null;
  const s = raw
    .replace(/feet|foot|ft\.?|′|'/g, ' ft ')
    .replace(/inches|inch|in\.?|″|"/g, ' in ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const num = '(\\d+(?:\\.\\d+)?)';
  const frac = '(?: (\\d+)\\/(\\d+))?';
  let feet = 0;
  let inches = 0;
  let m: RegExpMatchArray | null;
  if ((m = s.match(new RegExp(`^${num} ft(?: ${num}${frac}(?: in)?)?$`)))) {
    feet = parseFloat(m[1]);
    inches = m[2] ? parseFloat(m[2]) : 0;
    if (m[3] && m[4]) inches += parseInt(m[3], 10) / parseInt(m[4], 10);
    if (inches >= IN_PER_FT) return null;
  } else if ((m = s.match(new RegExp(`^${num}${frac} in$`)))) {
    inches = parseFloat(m[1]);
    if (m[2] && m[3]) inches += parseInt(m[2], 10) / parseInt(m[3], 10);
  } else if ((m = s.match(new RegExp(`^(\\d+) ${num}${frac}$`)))) {
    feet = parseInt(m[1], 10);
    inches = parseFloat(m[2]);
    if (m[3] && m[4]) inches += parseInt(m[3], 10) / parseInt(m[4], 10);
    if (inches >= IN_PER_FT) return null;
  } else if ((m = s.match(new RegExp(`^${num}$`)))) {
    feet = parseFloat(m[1]);
  } else {
    return null;
  }
  const totalFt = feet + inches / IN_PER_FT;
  if (!Number.isFinite(totalFt) || totalFt <= 0 || totalFt > 200) return null;
  return feetToMetres(totalFt);
}

/** Nominal interior door widths, in inches. */
export const NOMINAL_DOOR_WIDTHS_IN = [24, 28, 30, 32, 34, 36] as const;

/** The nominal width within one inch of the measured one, or null. A 31 in door does not snap to 30. */
export function nominalDoorWidthIn(measuredIn: number): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  for (const n of NOMINAL_DOOR_WIDTHS_IN) {
    const d = Math.abs(n - measuredIn);
    if (d < bestD) { bestD = d; best = n; }
  }
  return best != null && bestD < 1 ? best : null;
}
