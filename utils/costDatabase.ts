// costDatabase.ts — your prices, learned from your jobs.
//
// Generic cost databases (RSMeans, national averages) are documented to drift
// from what a specific contractor actually pays — stale regional data, buried
// productivity assumptions, wrong for non-standard scopes. The most accurate
// "regional cost data" that exists for a GC is their OWN history. This engine
// builds it: it reads every closed job's bid-vs-actual ledger (utils/
// estimateActuals) and distils a personal price book — per trade + unit, what
// work actually costs at your hands, with a variability band and a read on
// whether you systematically bid that scope high or low.
//
// Cold-start handling (the known weakness of "learn from your data"): each
// entry blends your most recent BID assumption (the baseline/prior) toward your
// measured actuals as samples accumulate — w = n/(n+K). With one job it leans on
// your prior; by the fifth it's mostly your real numbers. So the book is useful
// immediately and gets sharper with every closeout.
//
// Pure function — no storage, no network. Derived live from ProjectContext data.

import type { Project, Commitment, MaterialReceipt } from '@/types';
import { computeEstimateActuals } from '@/utils/estimateActuals';
import { receiptToCostSamples } from '@/utils/materialReceipt';

/** Blend constant: at n samples, personal weight = n/(n+K). K=3 ⇒ 50/50 at n=3. */
const BLEND_K = 3;

export interface CostSample {
  projectId: string;
  projectName: string;
  trade: string;
  unit: string;
  quantity: number;
  bidUnit: number;
  /** Actual unit cost (paid-to-date if available, else committed) per unit. */
  actualUnit: number;
  basis: 'actual' | 'committed';
  closedAt: string;
}

export interface CostBookEntry {
  key: string;
  trade: string;
  unit: string;
  sampleCount: number;
  jobCount: number;
  /** Quantity-weighted mean actual unit cost — your learned rate. */
  personalRate: number;
  /** Coefficient of variation as a fraction (0.12 = ±12% spread across jobs). */
  variability: number;
  /** Weighted mean of (actualUnit/bidUnit − 1). Positive = you bid LOW (actuals
   *  came in over your bid); negative = you padded it. */
  bidBias: number;
  /** Most recent bid unit cost — the prior used for blending. */
  baseline: number;
  /** Blended suggested rate to use on the next bid (baseline → personal). */
  suggestedRate: number;
  confidence: 'low' | 'medium' | 'high';
  /** Total actual $ this entry represents — exposure / ranking weight. */
  totalActual: number;
  lastSeen: string;
  samples: CostSample[];
}

export interface CostDatabase {
  entries: CostBookEntry[];
  jobsAnalyzed: number;
  tradesTracked: number;
  /** Exposure-weighted accuracy = 1 − mean|bidBias|. null when no priced history. */
  overallBidAccuracy: number | null;
  asOf: string;
}

const isClosed = (p: Project): boolean =>
  p.status === 'completed' || p.status === 'closed';

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function buildCostDatabase(
  projects: Project[],
  commitments: Commitment[],
  /** Snapped supplier invoices. Their line-item unit prices feed the price book
   *  as live `actual` material samples — additive; pass [] (default) for the
   *  original closed-jobs-only behavior. */
  receipts: MaterialReceipt[] = [],
  /** Self-perform labor samples (utils/laborSamples.ts buildLaborSamples):
   *  crew clocked hours priced at the GC's configured loaded rates. Keyed
   *  like everything else ("labor — framing|hour"). Additive; [] (default)
   *  = zero behavior change for existing callers. */
  laborSamples: CostSample[] = [],
): CostDatabase {
  const asOf = new Date().toISOString();
  const groups = new Map<string, CostSample[]>();
  const jobs = new Set<string>();

  const pushSample = (key: string, s: CostSample) => {
    const bucket = groups.get(key);
    if (bucket) bucket.push(s);
    else groups.set(key, [s]);
  };

  for (const project of projects) {
    if (!isClosed(project)) continue;
    const report = computeEstimateActuals(project, commitments);
    if (!report.hasEstimate) continue;
    const closedAt = project.closedAt || project.substantialCompletionDate || '';

    let contributed = false;
    for (const l of report.lines) {
      if (l.quantity <= 0) continue;
      // Prefer real actuals; fall back to the signed commitment as the cost
      // proxy for a closed job (a signed sub IS what that scope cost you).
      const cost = l.hasActual ? l.actual : l.hasCommitment ? l.committed : 0;
      if (cost <= 0) continue;

      // Human category first (readable price-book labels); CSI division only
      // as a fallback. Matches estimateActuals + jobCostEngine grouping.
      const trade = (l.category || l.csiDivision || 'Other').trim() || 'Other';
      const unit = (l.unit || 'unit').trim() || 'unit';
      const key = `${trade.toLowerCase()}|${unit.toLowerCase()}`;
      const sample: CostSample = {
        projectId: project.id,
        projectName: project.name,
        trade,
        unit,
        quantity: l.quantity,
        bidUnit: l.bidUnit ?? 0,
        actualUnit: cost / l.quantity,
        basis: l.hasActual ? 'actual' : 'committed',
        closedAt,
      };
      pushSample(key, sample);
      contributed = true;
    }
    if (contributed) jobs.add(project.id);
  }

  // Fold in supplier-invoice samples — live material prices, available the day
  // the GC snaps the receipt (no wait for project closeout). Keyed the same way
  // (trade|unit) so a material that already has a closed-job history just gets
  // more, fresher samples.
  if (receipts.length > 0) {
    const nameById = new Map(projects.map(p => [p.id, p.name]));
    for (const receipt of receipts) {
      const samples = receiptToCostSamples(receipt, nameById.get(receipt.projectId) ?? 'Project');
      for (const s of samples) {
        pushSample(`${s.trade.toLowerCase()}|${s.unit.toLowerCase()}`, s);
        jobs.add(receipt.projectId);
      }
    }
  }

  // Fold in self-perform labor — crew hours × the GC's own loaded rates,
  // available the day the shift is clocked out (no wait for closeout). Same
  // additive shape as receipts; the "Labor — <trade>" label keeps these
  // entries legible as labor in the price book, never a subcontract scope.
  for (const s of laborSamples) {
    if (s.quantity <= 0 || s.actualUnit <= 0) continue;
    pushSample(`${s.trade.toLowerCase()}|${s.unit.toLowerCase()}`, s);
    jobs.add(s.projectId);
  }

  const entries: CostBookEntry[] = [];
  for (const [key, ss] of groups) {
    const qtyTotal = ss.reduce((a, s) => a + s.quantity, 0);
    const personalRate =
      qtyTotal > 0
        ? ss.reduce((a, s) => a + s.actualUnit * s.quantity, 0) / qtyTotal
        : mean(ss.map(s => s.actualUnit));

    const variance =
      qtyTotal > 0
        ? ss.reduce((a, s) => a + s.quantity * (s.actualUnit - personalRate) ** 2, 0) / qtyTotal
        : 0;
    const variability = personalRate > 0 ? Math.sqrt(variance) / personalRate : 0;

    const biasSamples = ss.filter(s => s.bidUnit > 0);
    const biasQty = biasSamples.reduce((a, s) => a + s.quantity, 0);
    const bidBias =
      biasQty > 0
        ? biasSamples.reduce((a, s) => a + s.quantity * (s.actualUnit / s.bidUnit - 1), 0) / biasQty
        : 0;

    const sorted = [...ss].sort((a, b) => (a.closedAt < b.closedAt ? 1 : -1));
    const baseline = sorted.find(s => s.bidUnit > 0)?.bidUnit || personalRate;
    const lastSeen = sorted[0]?.closedAt || '';

    const jobIds = new Set(ss.map(s => s.projectId));
    const n = jobIds.size;
    const w = n / (n + BLEND_K);
    const suggestedRate = baseline > 0 ? baseline * (1 - w) + personalRate * w : personalRate;

    const confidence: CostBookEntry['confidence'] =
      n >= 5 && variability <= 0.2 ? 'high' : n >= 3 ? 'medium' : 'low';

    const totalActual = ss.reduce((a, s) => a + s.actualUnit * s.quantity, 0);

    entries.push({
      key,
      trade: ss[0].trade,
      unit: ss[0].unit,
      sampleCount: ss.length,
      jobCount: n,
      personalRate,
      variability,
      bidBias,
      baseline,
      suggestedRate,
      confidence,
      totalActual,
      lastSeen,
      samples: sorted,
    });
  }

  entries.sort((a, b) => b.totalActual - a.totalActual);

  const expTotal = entries.reduce((a, e) => a + e.totalActual, 0);
  const overallBidAccuracy =
    expTotal > 0
      ? 1 - entries.reduce((a, e) => a + e.totalActual * Math.abs(e.bidBias), 0) / expTotal
      : null;

  return {
    entries,
    jobsAnalyzed: jobs.size,
    tradesTracked: entries.length,
    overallBidAccuracy,
    asOf,
  };
}

/**
 * Look up a learned rate for a trade+unit — used by the estimate-confidence
 * layer (Build A3) to flag a line whose price deviates from your history.
 */
export function lookupRate(db: CostDatabase, trade: string, unit: string): CostBookEntry | null {
  const key = `${(trade || '').trim().toLowerCase()}|${(unit || 'unit').trim().toLowerCase()}`;
  return db.entries.find(e => e.key === key) ?? null;
}
