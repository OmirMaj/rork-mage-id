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
   * PER LINE (materialId → factor already accounted for on that line). Written
   * instead of `calibrationApplied` since audit round 2 #2: a category
   * correction now skips lines that already sit at his book rate, so "Tile is
   * done" is no longer true of every Tile line — only of the ones it changed.
   * A line's residual base is this, else the legacy category record, else 1.
   */
  calibrationAppliedByLine?: Record<string, number>;
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
  /** Lines in a corrected category that were LEFT ALONE because they already
   *  sit at (or past) the rate his own jobs measured — the correction's bias
   *  is already in their price. The CTA names them. */
  skippedAtBookRate: Array<{ name: string; category: string }>;
  /** Lines moved only part-way — to his measured rate — because the full
   *  category multiplier would have overshot it. */
  cappedToBookRate: number;
}

/**
 * The per-line evidence the Estimate Confidence screen already computed
 * (utils/estimateConfidence EstimateLineCheck satisfies this structurally).
 */
export interface CalibrationLineEvidence {
  materialId: string;
  trade: string;
  unit: string;
  learnedRate: number | null;
  jobCount: number;
}

/** Same band utils/estimateConfidence calls 'aligned' (DEVIATION_THRESHOLD);
 *  scripts/validate-calibration-double-count.ts pins the two equal. */
export const ALIGNED_BAND = 0.1;

/** The key estimateConfidence derives a line's lookup from, so an item and its
 *  EstimateLineCheck meet on the same (materialId, trade, unit). */
function evidenceKey(materialId: string, trade: string, unit: string): string {
  return `${materialId}|${norm(trade)}|${norm(unit)}`;
}
function itemEvidenceKey(it: LinkedEstimateItem): string {
  const trade = (it.category || it.csiDivision || 'Other').trim() || 'Other';
  const unit = (it.unit || 'unit').trim() || 'unit';
  return evidenceKey(it.materialId, trade, unit);
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
  opts?: {
    now?: string;
    /**
     * WHY THIS EXISTS (audit round 2, #2 — the bias counted twice). The
     * category multiplier is measured as actual ÷ OLD BID on his closed jobs.
     * The cost book (utils/costDatabase suggestedRate) ALREADY moves his rate
     * toward those actuals. A Tile line priced at the book's $11 — bids $10,
     * actuals $12, three jobs — took the ×1.20 anyway, landed on $13.20, and
     * the same screen then flagged it 'Padded +20%' and dropped it out of
     * backedCost. With evidence for a line, the multiplier may move it only
     * TOWARD his measured rate and never past it:
     *   • at/above the rate (aligned or overpriced, for a ×>1) → untouched;
     *   • below it → min(multiplier, rate ÷ price);
     *   • no book entry, or one with no closed job behind it → the full
     *     multiplier (the category factor is the only evidence there is).
     * Mirror image for a ×<1 correction.
     */
    lineChecks?: ReadonlyArray<CalibrationLineEvidence>;
  },
): CalibrationApplyResult {
  const signature = calibrationSignature(corrections);
  const prior = estimate as CalibratedEstimate;

  // WHAT IS ALREADY BAKED IN. Prefer the per-category record. An estimate
  // written by the previous (whole-set signature) version has no such record,
  // so its signature is decoded back into one — otherwise the first apply
  // after this ships would re-multiply every category it had already
  // corrected, which is the very bug being fixed.
  const applied: Record<string, number> = { ...(prior.calibrationApplied ?? {}) };
  const appliedByLine: Record<string, number> = { ...(prior.calibrationAppliedByLine ?? {}) };
  const evidence = new Map<string, CalibrationLineEvidence>();
  for (const c of opts?.lineChecks ?? []) evidence.set(evidenceKey(c.materialId, c.trade, c.unit), c);
  // (An estimate written by THIS version carries calibrationAppliedByLine and
  // still writes the signature for display — that signature must not be
  // decoded back into a category-wide "done", or a line skipped at his book
  // rate could never be corrected later.)
  if (!prior.calibrationApplied && !prior.calibrationAppliedByLine && prior.calibrationSignature) {
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
  // Residuals are per LINE: base = what that line already absorbed (its own
  // stamp, else the legacy category record, else nothing).
  const targetByCategory = new Map<string, number>();
  let anyCorrection = false;
  for (const c of corrections) {
    if (!c || !c.category || typeof c.multiplier !== 'number' || !(c.multiplier > 0)) continue;
    anyCorrection = true;
    targetByCategory.set(norm(c.category), c.multiplier);
  }

  let changedCount = 0;
  let matchedCount = 0;
  let pendingCount = 0;
  let cappedToBookRate = 0;
  const changedCategories = new Set<string>();
  const skippedAtBookRate: Array<{ name: string; category: string }> = [];
  const stamped: Record<string, number> = {};

  const items: LinkedEstimateItem[] = estimate.items.map(item => {
    const cat = norm(item.category);
    const target = targetByCategory.get(cat);
    if (target === undefined) return item;
    matchedCount += 1;
    const base = appliedByLine[item.materialId] ?? applied[cat] ?? 1;
    const residual = target / base;
    if (Math.abs(residual - 1) <= RESIDUAL_EPS) return item;
    pendingCount += 1;

    let m = residual;
    const price = item.usesBulk ? item.bulkPrice : item.unitPrice;
    const ev = evidence.get(itemEvidenceKey(item));
    if (ev && ev.jobCount >= 1 && ev.learnedRate != null && ev.learnedRate > 0 && price > 0) {
      const toRate = ev.learnedRate / price;
      const deviation = (price - ev.learnedRate) / ev.learnedRate;
      const alreadyThere = Math.abs(deviation) <= ALIGNED_BAND
        || (residual > 1 ? toRate <= 1 : toRate >= 1);
      if (alreadyThere) {
        skippedAtBookRate.push({ name: item.name, category: item.category });
        return item;
      }
      const capped = residual > 1 ? Math.min(residual, toRate) : Math.max(residual, toRate);
      if (Math.abs(capped - residual) > RESIDUAL_EPS) cappedToBookRate += 1;
      m = capped;
    }
    changedCount += 1;
    changedCategories.add(item.category);
    // Stamp the TARGET, not m: the correction is now accounted for on this
    // line (fully, or up to his measured rate), so a revisit is a no-op.
    stamped[item.materialId] = target;
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
      alreadyApplied: anyCorrection && matchedCount > 0 && pendingCount === 0,
      skippedAtBookRate,
      cappedToBookRate: 0,
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
      // Only lines it actually changed are recorded (per line, audit round 2
      // #2): a line skipped because it already sat at his book rate must
      // still take the correction if he later prices it below that rate.
      ...(prior.calibrationApplied || prior.calibrationSignature ? { calibrationApplied: applied } : {}),
      calibrationAppliedByLine: { ...appliedByLine, ...stamped },
      calibrationSignature: signature,
      calibrationAppliedAt: opts?.now ?? new Date().toISOString(),
    },
    changedCount,
    changedCategories: Array.from(changedCategories),
    oldGrandTotal: estimate.grandTotal,
    newGrandTotal: grandTotal,
    alreadyApplied: false,
    skippedAtBookRate,
    cappedToBookRate,
  };
}
