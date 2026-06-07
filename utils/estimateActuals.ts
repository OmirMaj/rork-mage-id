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

export interface EstimateLineActual {
  materialId: string;
  name: string;
  category: string;
  csiDivision?: string;
  unit: string;
  quantity: number;
  /** Estimate line COST (lineTotal, pre-markup) — the bid for this scope. */
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

  let untracedCommitted = 0;
  let untracedActual = 0;
  let untracedCommitmentCount = 0;
  let tracedCommitmentCount = 0;

  const projectCommitments = commitments.filter(
    c => c.projectId === project.id && c.status !== 'draft',
  );

  for (const c of projectCommitments) {
    const committedAmt = (c.amount || 0) + (c.changeAmount || 0);
    const actualAmt = Math.max(0, c.paidToDate || 0);
    const links = (c.linkedEstimateItems || []).filter(id => itemById.has(id));
    const weightTotal = links.reduce((s, id) => s + (itemById.get(id)!.lineTotal || 0), 0);

    if (links.length === 0 || weightTotal <= 0) {
      untracedCommitted += committedAmt;
      untracedActual += actualAmt;
      untracedCommitmentCount += 1;
      continue;
    }

    tracedCommitmentCount += 1;
    for (const id of links) {
      const share = (itemById.get(id)!.lineTotal || 0) / weightTotal;
      committedByItem.set(id, (committedByItem.get(id) || 0) + committedAmt * share);
      actualByItem.set(id, (actualByItem.get(id) || 0) + actualAmt * share);
    }
  }

  const lines: EstimateLineActual[] = estimate.items.map(it => {
    const bid = it.lineTotal || 0;
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
    const trade = (l.csiDivision || l.category || 'Other').trim() || 'Other';
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
