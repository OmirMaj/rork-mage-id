// applyCalibration.ts — apply the contractor's persisted per-category cost
// corrections (from useEstimateCalibration) to a LinkedEstimate.
//
// The calibration engine learns "you under-estimate Tile by 12% across 4 jobs"
// and the GC can persist a correction factor per category. This util is what
// finally *spends* that learning: it scales each line's price by its category's
// multiplier and recomputes the estimate totals with the app's own math
// (lineTotal = base·(1+markup/100)·qty, grandTotal = Σ lineTotal,
//  baseTotal = Σ base·qty), so the corrected estimate stays internally
// consistent. This is the payoff of the cost-learning moat.

import type { LinkedEstimate, LinkedEstimateItem } from '@/types';
import type { AppliedCalibration } from '@/hooks/useEstimateCalibration';

/**
 * A LinkedEstimate that carries the marker below. Declared here rather than in
 * types/index.ts because nothing outside this module needs to know about it;
 * `linked_estimate` is persisted as a JSON blob, so the field survives the
 * round-trip to Postgres and back.
 */
export interface CalibratedEstimate extends LinkedEstimate {
  /**
   * WHICH MULTIPLIER IS ALREADY BAKED INTO EACH CATEGORY'S PRICES.
   * Normalised category (lowercased, trimmed) → the cumulative factor this
   * estimate has already been multiplied by for that category.
   *
   * THE FAILURE THIS STOPS. app/estimate-confidence memoizes
   * applyCalibrationToEstimate(project.linkedEstimate, corrections) and writes
   * the result back to project.linkedEstimate on Apply. `corrections` never
   * changes, so the memo immediately re-ran against the ALREADY-corrected
   * estimate and the CTA rendered again with the same multiplier, over a
   * confirm dialog that reads "lines will be re-priced from your job history"
   * with plausible new numbers. Three taps on a ×1.20 Tile correction took a
   * $1,200 estimate to $2,073.60.
   *
   * WHY PER CATEGORY, NOT A SIGNATURE OF THE SET. The first fix stamped a
   * fingerprint of the whole correction SET, so it only blocked a byte-
   * identical replay. The moment the set changed at all — and it changes on
   * the most ordinary event in this loop, closing one more job — every
   * already-corrected category was multiplied a second time. Measured:
   * [Tile ×1.2] takes a $10 Tile line to $12; then a new job adds a Painting
   * correction and the set becomes [Tile ×1.2, Painting ×1.1], and the SAME
   * screen took Tile to $14.40 while reporting alreadyApplied false. Refining
   * an existing factor did the same thing: ×1.2 then ×1.25 landed on $15
   * instead of $12.50. A correction is idempotent per CATEGORY, so the state
   * that has to be remembered is per category, and a changed factor applies
   * only the RESIDUAL (new ÷ already-applied).
   */
  calibrationApplied?: Record<string, number>;
  /**
   * Fingerprint of the last correction set applied. Retained for display and
   * for reading estimates written by the previous version of this module (see
   * `legacyApplied` below); the idempotence decision no longer depends on it.
   */
  calibrationSignature?: string;
  /** ISO stamp of that application, for "Corrections applied <date>" copy. */
  calibrationAppliedAt?: string;
}

export interface CalibrationApplyResult {
  estimate: CalibratedEstimate;
  /** Number of line items whose price was actually changed. */
  changedCount: number;
  /** Distinct categories that matched a correction. */
  changedCategories: string[];
  oldGrandTotal: number;
  newGrandTotal: number;
  /** True when this exact correction set is already baked into the estimate,
   *  so changedCount is 0 for that reason rather than "nothing matched". The
   *  CTA must stay hidden either way; the copy can differ. */
  alreadyApplied: boolean;
}

const norm = (s: string) => (s || '').trim().toLowerCase();

/**
 * Stable fingerprint of a correction SET: category → multiplier, sorted. Two
 * different multipliers on the same category produce different signatures, so
 * a genuinely NEW correction still applies on top of an old one; re-tapping
 * the same one does not.
 */
export function calibrationSignature(corrections: AppliedCalibration[]): string {
  return corrections
    .filter(c => c && c.category && typeof c.multiplier === 'number' && c.multiplier > 0)
    .map(c => `${norm(c.category)}:${c.multiplier}`)
    .sort()
    .join('|');
}

/**
 * Returns a NEW LinkedEstimate with corrections applied. Never mutates the
 * input. When no correction matches, returns the estimate unchanged with
 * changedCount 0 (caller can skip the write).
 */
/** Floating-point tolerance for "this residual is 1, i.e. nothing left to do".
 *  1.2/1.2 is exactly 1 in IEEE-754, but 1.1*1.09/1.199 is not, and a residual
 *  of 1.0000000000000002 must not re-price a line by a rounding error. */
const RESIDUAL_EPS = 1e-9;

export function applyCalibrationToEstimate(
  estimate: LinkedEstimate,
  corrections: AppliedCalibration[],
  opts?: { now?: string },
): CalibrationApplyResult {
  const signature = calibrationSignature(corrections);
  const prior = estimate as CalibratedEstimate;

  // WHAT IS ALREADY BAKED IN. Prefer the per-category record. An estimate
  // written by the previous (whole-set signature) version has no such record,
  // so its signature is decoded back into one — otherwise the first apply
  // after this ships would re-multiply every category it had already
  // corrected, which is the very bug being fixed.
  const applied: Record<string, number> = { ...(prior.calibrationApplied ?? {}) };
  if (!prior.calibrationApplied && prior.calibrationSignature) {
    for (const part of prior.calibrationSignature.split('|')) {
      const idx = part.lastIndexOf(':');
      if (idx <= 0) continue;
      const m = Number(part.slice(idx + 1));
      if (Number.isFinite(m) && m > 0) applied[part.slice(0, idx)] = m;
    }
  }

  // The RESIDUAL per category: what still has to be multiplied in, given what
  // already was. A repeat of the same factor residuals to 1 and changes
  // nothing; a refinement from ×1.2 to ×1.25 applies ×1.0417, landing on the
  // intended 1.25× of the ORIGINAL price rather than 1.5×.
  const residualByCategory = new Map<string, number>();
  const targetByCategory = new Map<string, number>();
  let anyCorrection = false;
  for (const c of corrections) {
    if (!c || !c.category || typeof c.multiplier !== 'number' || !(c.multiplier > 0)) continue;
    anyCorrection = true;
    const key = norm(c.category);
    targetByCategory.set(key, c.multiplier);
    const residual = c.multiplier / (applied[key] ?? 1);
    if (Math.abs(residual - 1) > RESIDUAL_EPS) residualByCategory.set(key, residual);
  }

  let changedCount = 0;
  const changedCategories = new Set<string>();

  const items: LinkedEstimateItem[] = estimate.items.map(item => {
    const m = residualByCategory.get(norm(item.category));
    if (m === undefined) return item;
    changedCount += 1;
    changedCategories.add(item.category);
    return {
      ...item,
      unitPrice: item.unitPrice * m,
      bulkPrice: item.bulkPrice * m,
      lineTotal: item.lineTotal * m,
    };
  });

  if (changedCount === 0) {
    return {
      estimate,
      changedCount: 0,
      changedCategories: [],
      oldGrandTotal: estimate.grandTotal,
      newGrandTotal: estimate.grandTotal,
      // "Already applied" and "nothing in this estimate matched" are different
      // sentences. It is the first only when there was something to apply and
      // every part of it is already in the price.
      alreadyApplied: anyCorrection && residualByCategory.size === 0,
    };
  }

  // Recompute totals from the corrected items using the app's own formula.
  const baseTotal = items.reduce((s, it) => {
    const base = it.usesBulk ? it.bulkPrice : it.unitPrice;
    return s + base * it.quantity;
  }, 0);
  const grandTotal = items.reduce((s, it) => s + it.lineTotal, 0);
  const markupTotal = grandTotal - baseTotal;

  return {
    estimate: {
      ...estimate,
      items,
      baseTotal,
      markupTotal,
      grandTotal,
      // The marker rides on the corrected estimate, so a second call is a
      // no-op no matter which screen makes it — and, because it is per
      // category, that stays true when the correction SET grows or one of its
      // factors is refined. Only categories that actually reached a line are
      // recorded: a correction for a category this estimate does not contain
      // must still apply if such a line is added later.
      calibrationApplied: {
        ...applied,
        ...Object.fromEntries(
          Array.from(changedCategories, c => [norm(c), targetByCategory.get(norm(c)) ?? 1]),
        ),
      },
      calibrationSignature: signature,
      calibrationAppliedAt: opts?.now ?? new Date().toISOString(),
    },
    changedCount,
    changedCategories: Array.from(changedCategories),
    oldGrandTotal: estimate.grandTotal,
    newGrandTotal: grandTotal,
    alreadyApplied: false,
  };
}
