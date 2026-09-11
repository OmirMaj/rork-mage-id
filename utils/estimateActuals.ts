// estimateActuals.ts — what you BID vs what you COMMITTED vs what it ACTUALLY cost.
//
// Every estimate line is a prediction. The job then generates the truth: you
// sign subs/POs against that scope (committed), and you pay them (actual). The
// gap between the three is where margin is made or lost — and, compounded across
// jobs, it's the single most valuable dataset a GC owns: what work REALLY costs
// in their market, at their hands. Nobody ships this for small GCs because it
// requires a clean line-item ↔ commitment linkage most tools never built.
//
// MAGE has it: `commitment.linkedEstimateItems` ties a signed sub/PO back to the
// exact estimate lines it fulfils, and `commitment.paidToDate` carries what's
// actually been paid against it. This engine resolves both back to the line that
// predicted them, so you can see — per line and per trade — bid → committed →
// actual, and the variance between.
//
// Honesty rules (same discipline as the rest of the cost stack):
//  - "Actual" here is COST paid to subs/POs (commitment.paidToDate), NOT client
//    invoices (which are revenue). We're measuring what scope cost, not billings.
//  - Commitments split across multiple linked lines are attributed by each
//    line's share of the linked BID cost (the same weighting the job-cost and
//    living-estimate engines use).
//  - Commitments with no usable estimate link can't be attributed to a line;
//    they're disclosed as "untraced", never silently dropped. A low coverage %
//    means the ledger is partial — link more commitments (Generative Setup
//    creates them pre-linked) to sharpen it.
//
// Pure function, no storage, no network — callers pass project + commitments
// from ProjectContext and re-run on every mutation.

import type { Project, Commitment } from '@/types';

/**
 * A closed job's project status. Lives here because THREE engines need the
 * same predicate and they were disagreeing about it: utils/costDatabase
 * filtered to closed work, utils/estimateCalibration did not, so the price
 * book and the calibrator answered "what is your bid bias" from two different
 * populations and could contradict each other on the same account.
 */
export const isClosedProject = (p: Project): boolean =>
  p.status === 'completed' || p.status === 'closed';

/**
 * How much of a commitment must be paid before paid-to-date is treated as the
 * COMPLETED cost of that scope rather than a progress payment.
 *
 * THE FAILURE THIS EXISTS TO STOP. `hasActual` is literally `actual > 0`, and
 * the cost book preferred `actual` over `committed` with no proximity test at
 * all. So ONE mobilization deposit on a closed job replaced the contract sum
 * as the learned cost: a $12,000 roofing sub over 30 SQ (a true $400/SQ) with
 * a single 10% deposit paid taught the book $40.00/SQ, stamped the sample
 * "actual", and the Cost Database screen printed, in green with a downward
 * arrow, "You bid this ~90% over actual cost" — a 10x error presented as good
 * news, and the headline Bid-accuracy KPI read 10% on an account whose
 * estimating was perfect.
 *
 * Retention is the mild, common version of the same thing: a GC typically
 * closes a job in his own system before the final retention release, so the
 * cash paid is short of the cost by the retention percentage. The COST of that
 * scope is the contract sum; what has been released is a cash-flow fact.
 * Below this ratio we fall back to the signed commitment, which for a closed
 * job IS what the scope cost, and label the sample "signed" so the screen
 * never calls it a payment.
 *
 * 0.95 is a judgement call, not a standard: retainage is negotiated per
 * contract (it lives in the owner–contractor agreement, not in any general
 * condition that fixes a percentage), and 5% is the most common figure a
 * residential GC will meet. Set high enough that a normal retention hold still
 * reads as settled once released, low enough that a progress payment never
 * masquerades as a final cost.
 */
export const SETTLED_PAYMENT_RATIO = 0.95;

export interface EstimateLineActual {
  materialId: string;
  name: string;
  category: string;
  csiDivision?: string;
  unit: string;
  quantity: number;
  /**
   * Estimate line COST for this scope — unitPrice x quantity.
   *
   * This comment used to say "lineTotal, pre-markup". lineTotal is NOT
   * pre-markup: app/(tabs)/estimate/full.tsx:933 computes it as
   *     base * (1 + markup / 100) * quantity
   * and the code below dutifully used it, comparing a MARKED-UP bid against
   * `committed`/`actual`, which are true cost dollars from commitments and
   * paidToDate. Every buyout therefore read more favourable than reality by
   * exactly the markup percentage.
   */
  bid: number;
  /** Signed subs/POs attributed to this line. */
  committed: number;
  /** Paid-to-date attributed to this line (actual cost). */
  actual: number;
  /** committed − bid. Negative = bought out under the estimate. */
  committedVsBid: number;
  /** actual − bid. Negative = came in under. Only meaningful when hasActual. */
  actualVsBid: number;
  /** bid / quantity — the unit cost you estimated. null when no quantity. */
  bidUnit: number | null;
  /** committed / quantity — the unit cost you signed at. null when n/a. */
  committedUnit: number | null;
  /** actual / quantity — the unit cost you actually paid. null when n/a. */
  actualUnit: number | null;
  hasCommitment: boolean;
  hasActual: boolean;
  /**
   * Approved sub change-order dollars inside `committed` for this line
   * (`commitment.changeAmount`, allocated the same way as the base amount).
   *
   * WHY IT IS BROKEN OUT. `committed` is the full contract value and that is
   * correct for variance and job costing. It is NOT usable as a unit-rate
   * numerator: the denominator is still the ORIGINAL estimate quantity, so a
   * change order that bought MORE SCOPE at exactly the right price reads as a
   * price increase. A 5,000 SF painting line bid at $2.00 with a $4,000 CO for
   * 2,000 more SF at the same $2.00 taught the cost book $2.80/SF and printed
   * "You bid this ~40% under actual cost" in red, pushing the next bid up 40%
   * on a trade that was priced correctly. This is exactly the SCOPE term
   * utils/varianceDecomposition.ts names as the moat's central flaw, and
   * outlier rejection cannot see it (it needs 4 samples; this happens on one).
   * utils/costDatabase excludes a line carrying these dollars from the learned
   * rate; the line is still shown, and still counts for variance.
   */
  changeOrderAmount: number;
  /**
   * True when any commitment attributed to this line is ALSO attributed to
   * another estimate line — a package buyout split bid-proportionally.
   *
   * The split carries no information about the lines' relative unit prices: it
   * reproduces the estimator's own guess times one shared scalar. Two framing
   * lines (1,000 SF @ $5 and 500 SF @ $12) against one $13,200 commitment both
   * come back at a ratio of exactly 1.200000, and the book then learns $8.80/SF
   * with a ±45% "spread" manufactured entirely from those two guesses. Correct
   * fixes are a per-line schedule of values on the Commitment (not modelled
   * today) or excluding these from the rate — utils/costDatabase does the
   * latter.
   */
  fromSharedCommitment: boolean;
  /**
   * True when paid-to-date has substantially settled the committed amount
   * (>= SETTLED_PAYMENT_RATIO), i.e. `actual` is a completed cost rather than
   * a progress payment. Callers that learn a COST from this line must gate on
   * this, not on `hasActual` (which is only `actual > 0`).
   */
  settled: boolean;
}

export interface TradeRollup {
  /** csiDivision || category. */
  trade: string;
  bid: number;
  committed: number;
  actual: number;
  lineCount: number;
}

export interface EstimateActualsReport {
  /** False when the project has no cost/markup estimate to measure against. */
  hasEstimate: boolean;
  /** Per estimate line, traced commitments first then by bid desc. */
  lines: EstimateLineActual[];
  /** Rolled up by trade (csiDivision || category), bid desc. */
  byTrade: TradeRollup[];
  totalBid: number;
  /** Traced + untraced committed. */
  totalCommitted: number;
  /** Traced + untraced actual (paid-to-date). */
  totalActual: number;
  /** Committed $ on commitments that couldn't be attributed to a line. */
  untracedCommitted: number;
  /** Paid-to-date $ on those same untraceable commitments. */
  untracedActual: number;
  untracedCommitmentCount: number;
  tracedCommitmentCount: number;
  /** Share of committed $ that IS traced to estimate lines (0–100). */
  coveragePct: number;
  /** True once any commitment carries paid-to-date — i.e. real actuals exist. */
  hasActuals: boolean;
  asOf: string;
}

function emptyReport(hasEstimate: boolean): EstimateActualsReport {
  return {
    hasEstimate,
    lines: [],
    byTrade: [],
    totalBid: 0,
    totalCommitted: 0,
    totalActual: 0,
    untracedCommitted: 0,
    untracedActual: 0,
    untracedCommitmentCount: 0,
    tracedCommitmentCount: 0,
    coveragePct: 0,
    hasActuals: false,
    asOf: new Date().toISOString(),
  };
}

export function computeEstimateActuals(
  project: Project,
  commitments: Commitment[],
): EstimateActualsReport {
  const estimate = project.linkedEstimate;
  if (!estimate || estimate.items.length === 0) {
    return emptyReport(false);
  }

  const itemById = new Map(estimate.items.map(it => [it.materialId, it]));
  const committedByItem = new Map<string, number>();
  const actualByItem = new Map<string, number>();
  // Rate-learning provenance, per line — see the field docs on
  // EstimateLineActual.changeOrderAmount / .fromSharedCommitment.
  const changeByItem = new Map<string, number>();
  const sharedItems = new Set<string>();

  let untracedCommitted = 0;
  let untracedActual = 0;
  let untracedCommitmentCount = 0;
  let tracedCommitmentCount = 0;

  const projectCommitments = commitments.filter(
    c => c.projectId === project.id && c.status !== 'draft',
  );

  for (const c of projectCommitments) {
    const changeAmt = c.changeAmount || 0;
    const committedAmt = (c.amount || 0) + changeAmt;
    const actualAmt = Math.max(0, c.paidToDate || 0);
    const links = (c.linkedEstimateItems || []).filter(id => itemById.has(id));
    // Allocate on COST, not sell. Markup is per-item, so weighting by
    // lineTotal hands a disproportionate share of a commitment to whichever
    // line happens to carry the higher markup.
    const itemCost = (id: string) => {
      const it = itemById.get(id)!;
      return (it.unitPrice ?? 0) * (it.quantity ?? 0);
    };
    const weightTotal = links.reduce((s, id) => s + itemCost(id), 0);

    if (links.length === 0 || weightTotal <= 0) {
      untracedCommitted += committedAmt;
      untracedActual += actualAmt;
      untracedCommitmentCount += 1;
      continue;
    }

    tracedCommitmentCount += 1;
    for (const id of links) {
      const share = itemCost(id) / weightTotal;
      committedByItem.set(id, (committedByItem.get(id) || 0) + committedAmt * share);
      actualByItem.set(id, (actualByItem.get(id) || 0) + actualAmt * share);
      if (changeAmt !== 0) changeByItem.set(id, (changeByItem.get(id) || 0) + changeAmt * share);
      if (links.length > 1) sharedItems.add(id);
    }
  }

  const lines: EstimateLineActual[] = estimate.items.map(it => {
    // COST basis — see the `bid` doc above. Comparing a marked-up bid against
    // at-cost actuals made a line bought out EXACTLY at cost look like a win
    // by the markup percentage, and utils/estimateCalibration.ts:138 turns that
    // straight into `bias = actual / estimated` -> a suggested multiplier below
    // 1.0. Applying that correction reprices future estimates BELOW cost, and
    // the error compounds every time a correction is accepted. This is the loop
    // the product's cost moat is built on; it was learning the wrong lesson.
    const bid = (it.unitPrice ?? 0) * (it.quantity ?? 0);
    const committed = committedByItem.get(it.materialId) || 0;
    const actual = actualByItem.get(it.materialId) || 0;
    const qty = it.quantity || 0;
    return {
      materialId: it.materialId,
      name: it.name,
      category: it.category,
      csiDivision: it.csiDivision,
      unit: it.unit,
      quantity: qty,
      bid,
      committed,
      actual,
      committedVsBid: committed - bid,
      actualVsBid: actual - bid,
      bidUnit: qty > 0 ? bid / qty : null,
      committedUnit: qty > 0 && committed > 0 ? committed / qty : null,
      actualUnit: qty > 0 && actual > 0 ? actual / qty : null,
      hasCommitment: committed > 0,
      hasActual: actual > 0,
      changeOrderAmount: changeByItem.get(it.materialId) || 0,
      fromSharedCommitment: sharedItems.has(it.materialId),
      // A payment only proves a COST once it has substantially settled what was
      // signed. Below that it is a deposit or a progress draw (see
      // SETTLED_PAYMENT_RATIO).
      //
      // AND THERE IS NO "PAYMENT WITHOUT A CONTRACT SUM" CASE HERE. This used
      // to read `: actual > 0` for committed <= 0, on the reasoning that with
      // nothing committed there is nothing to compare against so the payment
      // stands on its own. That reasoning does not survive reading where
      // `actual` comes from: every dollar in it is a commitment's paidToDate
      // (see the allocation loop above — there is no other source). So
      // committed <= 0 never means "an untracked direct expense"; it means the
      // commitment's amount is blank, or a deductive change order cancelled it
      // out. Both are holes in the record, and the old branch turned a hole
      // into proof: a closed 30 SQ roofing job bid at $400/SQ with an
      // amount-less commitment carrying $1,200 paid learned $40/SQ, basis
      // 'actual', bidBias -0.90, and drove the headline Bid-accuracy KPI to
      // 10% — byte-identical to the mobilization-deposit bug this flag was
      // added to stop, reached by the one door it left open. No contract sum,
      // no settlement. (costDatabase then declines the line as rate evidence
      // rather than falling back to the raw payment — see the `cost` ladder
      // there, which no longer has an "unsettled and uncommitted" branch that
      // can return dollars.)
      settled: committed > 0 && actual >= committed * SETTLED_PAYMENT_RATIO,
    };
  });

  // Traced lines first (most actionable), then biggest bid.
  lines.sort(
    (a, b) =>
      Number(b.hasCommitment) - Number(a.hasCommitment) ||
      b.bid - a.bid,
  );

  const tradeMap = new Map<string, TradeRollup>();
  for (const l of lines) {
    // Group/label by the human category (matches jobCostEngine's phase
    // grouping); fall back to the CSI division only when no category is set.
    const trade = (l.category || l.csiDivision || 'Other').trim() || 'Other';
    const r = tradeMap.get(trade) || { trade, bid: 0, committed: 0, actual: 0, lineCount: 0 };
    r.bid += l.bid;
    r.committed += l.committed;
    r.actual += l.actual;
    r.lineCount += 1;
    tradeMap.set(trade, r);
  }
  const byTrade = [...tradeMap.values()].sort((a, b) => b.bid - a.bid);

  const totalBid = lines.reduce((s, l) => s + l.bid, 0);
  const tracedCommitted = lines.reduce((s, l) => s + l.committed, 0);
  const tracedActual = lines.reduce((s, l) => s + l.actual, 0);
  const totalCommitted = tracedCommitted + untracedCommitted;
  const totalActual = tracedActual + untracedActual;
  const coveragePct = totalCommitted > 0 ? (tracedCommitted / totalCommitted) * 100 : 0;

  return {
    hasEstimate: true,
    lines,
    byTrade,
    totalBid,
    totalCommitted,
    totalActual,
    untracedCommitted,
    untracedActual,
    untracedCommitmentCount,
    tracedCommitmentCount,
    coveragePct,
    hasActuals: totalActual > 0,
    asOf: new Date().toISOString(),
  };
}

/** Variance as a signed fraction of bid (e.g. -0.08 = 8% under). null when no bid. */
export function variancePct(actualOrCommitted: number, bid: number): number | null {
  if (bid <= 0) return null;
  return (actualOrCommitted - bid) / bid;
}
