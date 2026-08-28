// varianceDecomposition.ts — keep one-off blowouts out of the learned rate.
//
// THE PROBLEM (the moat's sharpest flaw). costDatabase learns a trade's price
// from actualUnit = totalCost / quantity. That single number conflates four
// different things:
//   • PRICE      — you paid more per unit. Real, repeatable, worth learning.
//   • PRODUCTIVITY — your crew's real pace. Also real and worth learning ("what
//     it costs at YOUR hands" is the whole pitch).
//   • SCOPE      — a change order piled work onto the line. Not a price signal.
//   • WEATHER / one-offs — a hurricane week doubled the hours. Not repeatable.
// Fold a scope/weather-blown job into the mean and the book quietly learns to
// bid that trade high forever, off one abnormal job.
//
// A FULL causal decomposition would join each cost line to its change orders and
// the jobsite's weather-delay log. That linkage does not exist per-line today
// (untraced CO dollars are already excluded upstream by estimateActuals'
// tracing; weather lives at the schedule level), and bolting it on blind would
// put the financial core at risk. So this is the correct first layer that the
// data DOES support: robust outlier rejection. Price and productivity vary
// CONTINUOUSLY (kept); scope/weather blowouts land as DISCRETE outliers against
// the trade's other jobs (rejected from the rate, still shown to the GC).
//
// Median/MAD, not mean/stdev, precisely because the mean is what a blowout
// poisons — the median shrugs it off, so we can measure "how far is this sample
// from typical" without the outlier corrupting the yardstick.
//
// Pure + testable (scripts/validate-cost-variance-decomposition.ts).

/** Need at least this many real samples before we trust an outlier call — with
 *  1-3 jobs there's no "typical" to deviate from, so a cold-start entry keeps
 *  every sample (better a noisy rate than a confidently-wrong one). */
export const ROBUST_MIN_SAMPLES = 4;

/** MAD × this ≈ one standard deviation for normally-distributed data. */
export const MAD_SIGMA = 1.4826;

/** Reject a sample past this many robust-sigmas from the median. 3.5 is
 *  deliberately generous — we only want gross one-offs, not the honest spread
 *  of a variable trade. */
export const OUTLIER_SIGMA = 3.5;

/** When the spread is degenerate (MAD ≈ 0, i.e. nearly every job priced the
 *  same), a sigma test divides by ~0 and flags noise. Fall back to a ratio test:
 *  a sample ≥2× or ≤0.5× the median is a one-off. */
export const DEGENERATE_MAD_EPS = 1e-9;
export const RATIO_HIGH = 2.0;
export const RATIO_LOW = 0.5;

/** Never reject more than this fraction of a group. If "most" samples look
 *  extreme, the distribution is just WIDE (a genuinely variable trade), not
 *  contaminated — keep them all and let variability report the spread honestly. */
export const MAX_REJECT_FRACTION = 0.4;

/** Median of a numeric list. Returns 0 for empty. Does not mutate the input. */
export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Median absolute deviation from the median — a robust spread measure. */
export function medianAbsoluteDeviation(xs: number[], med?: number): number {
  if (xs.length === 0) return 0;
  const m = med ?? median(xs);
  return median(xs.map(x => Math.abs(x - m)));
}

/**
 * Per-sample outlier flags for a trade's unit costs. `true` = a gross one-off
 * that should NOT teach the learned rate (kept visible, just not averaged in).
 *
 * Guarantees, so this can never destabilize the engine it feeds:
 *   • fewer than ROBUST_MIN_SAMPLES samples → all false (cold-start untouched)
 *   • never flags more than MAX_REJECT_FRACTION of the group
 *   • a flat distribution (all equal) → all false
 */
export function flagOutliers(actualUnits: number[]): boolean[] {
  const n = actualUnits.length;
  const none = actualUnits.map(() => false);
  if (n < ROBUST_MIN_SAMPLES) return none;

  const med = median(actualUnits);
  const mad = medianAbsoluteDeviation(actualUnits, med);

  const candidate = actualUnits.map(v => {
    if (mad > DEGENERATE_MAD_EPS) {
      return Math.abs(v - med) / (mad * MAD_SIGMA) > OUTLIER_SIGMA;
    }
    // Degenerate spread: nearly-identical prices, so a ratio test catches the
    // lone job that came in double or half.
    if (med <= 0) return false;
    const r = v / med;
    return r >= RATIO_HIGH || r <= RATIO_LOW;
  });

  const rejectCount = candidate.filter(Boolean).length;
  // Too many "outliers" means the trade is just variable, not contaminated.
  if (rejectCount > Math.floor(n * MAX_REJECT_FRACTION)) return none;
  return candidate;
}
