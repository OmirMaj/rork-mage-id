// jobCostEngine.ts — derive per-phase and project-level job cost lines from
// the existing Estimate / Commitment / Invoice / ChangeOrder data.
//
// The four numbers every GC needs:
//
//   BUDGET    — what you said it would cost (estimate + approved COs)
//   COMMITTED — signed subs + POs against that budget
//   ACTUAL    — what's actually been paid out (invoice payments)
//   EAC       — projected final cost at completion
//
// EAC (estimate at completion) method — MAGE opinionated default:
//
//   EAC = ACTUAL + (COMMITTED - billedAgainstCommitment)
//                + max(0, BUDGET - COMMITTED)         // uncommitted remainder
//
// Rationale: we know we'll pay out the remaining commitment balance (that
// work is signed). If budget exceeds what's been committed, we still owe
// that work to sub-buy (so it acts as a floor). If commitments already
// exceed budget, the variance shows up negative — which is the signal a PM
// needs to kill the project before it bleeds further.
//
// NOTE: we intentionally don't include progress-weighted EAC variants
// (CPI / SPI-based) here — those require earnedValueEngine output which is
// a separate concern. See utils/earnedValueEngine.ts for that flavor.

import type {
  Project,
  Commitment,
  Invoice,
  ChangeOrder,
  LinkedEstimate,
} from '@/types';

export interface JobCostLine {
  /** Grouping key — phase name or '(uncategorized)'. */
  phase: string;
  /** Estimate + approved CO deltas. */
  budget: number;
  /** Signed subs + POs. */
  committed: number;
  /** Paid invoice amount attributable to this phase. */
  actual: number;
  /** Projected final cost using the MAGE EAC method (see header). */
  projectedFinal: number;
  /** projectedFinal - budget. Negative = over budget. */
  variance: number;
  /** Ratio of actual to budget, clamped to [0, 2]. */
  burnRatio: number;
  /** Status classification for dashboard chips. */
  status: 'on_track' | 'warning' | 'over';
  /** How many commitments, invoices, change orders contributed. */
  sources: { commitments: number; invoices: number; changeOrders: number };
}

export interface JobCostSummary {
  asOf: string;
  /** Total budget including approved change orders. */
  budget: number;
  /** Sum of all committed sub/PO amounts (incl. CO revisions). */
  committed: number;
  /** Sum of all invoice payments. */
  actual: number;
  /** Sum of projected finals. */
  projectedFinal: number;
  /** projectedFinal - budget. Negative = projecting over budget. */
  variance: number;
  /** 0-100. Share of budget that's been committed (signed). */
  commitmentCoverage: number;
  /** 0-100. Share of budget spent. */
  spendPercent: number;
  byPhase: JobCostLine[];
  /** Top three phases by variance magnitude. */
  biggestVariances: JobCostLine[];
  /** Commitments that exceed their linked estimate items. */
  overcommittedCommitments: Commitment[];
  /** Engine signature for reports / telemetry. */
  method: 'mage_committed_plus_uncommitted';
}

const PHASE_UNCATEGORIZED = '(Uncategorized)';

/**
 * Pick a phase bucket for a commitment. We prefer an explicit `phase`,
 * fall back to `csiDivision`, and last resort uncategorized.
 */
function commitmentPhase(c: Commitment): string {
  if (c.phase && c.phase.trim()) return c.phase.trim();
  if (c.csiDivision && c.csiDivision.trim()) return c.csiDivision.trim();
  return PHASE_UNCATEGORIZED;
}

/**
 * Attribute an invoice line to a phase. Invoices don't carry a phase, so
 * we trace via `sourceEstimateItemId` → estimate item → category. If no
 * link, fall back to the invoice's top-level notes bucket (uncategorized).
 */
function estimateItemPhase(
  estimate: LinkedEstimate | null | undefined,
  estimateItemId: string | undefined,
): string {
  if (!estimate || !estimateItemId) return PHASE_UNCATEGORIZED;
  const item = estimate.items.find(it => it.materialId === estimateItemId);
  if (!item) return PHASE_UNCATEGORIZED;
  return item.category?.trim() || PHASE_UNCATEGORIZED;
}

/**
 * Classify a phase by how its actual + projected stack up.
 * - over:    projectedFinal > budget (or burnRatio > 1 if no budget)
 * - warning: actual is 90% of budget but phase isn't visibly done
 * - on_track: everything else
 */
function classify(line: Omit<JobCostLine, 'status'>): JobCostLine['status'] {
  if (line.budget > 0 && line.projectedFinal > line.budget * 1.02) return 'over';
  if (line.budget > 0 && line.actual / line.budget > 0.9 && line.committed > line.actual * 1.05) return 'warning';
  if (line.budget <= 0 && line.committed > 0 && line.actual > line.committed * 0.9) return 'warning';
  return 'on_track';
}

export interface JobCostInput {
  project: Project;
  commitments: Commitment[];
  invoices: Invoice[];
  changeOrders: ChangeOrder[];
}

/**
 * Run the cost-to-complete engine on one project's numbers.
 *
 * Pure function — all data is passed in, no storage side effects. Callers
 * wire it up from ProjectContext and re-run on every mutation. Results are
 * cheap to recompute because the input arrays are already in memory.
 */
export function computeJobCost({ project, commitments, invoices, changeOrders }: JobCostInput): JobCostSummary {
  const projectCommitments = commitments.filter(c => c.projectId === project.id && c.status !== 'draft');
  const projectInvoices = invoices.filter(inv => inv.projectId === project.id);
  const projectCOs = changeOrders.filter(co => co.projectId === project.id && co.status === 'approved');

  const estimate = project.linkedEstimate ?? null;
  const phases = new Map<string, JobCostLine>();

  // Seed from estimate items — every category that exists in the budget
  // gets a line, even if no commitments / invoices landed on it yet. This
  // keeps the "$0 committed against $50K budget" visible early.
  if (estimate) {
    for (const item of estimate.items) {
      const phase = item.category?.trim() || PHASE_UNCATEGORIZED;
      const existing = phases.get(phase) ?? emptyLine(phase);
      existing.budget += item.lineTotal;
      phases.set(phase, existing);
    }
  } else if (project.estimate) {
    // Legacy estimate — one catch-all bucket.
    phases.set('Budget', {
      ...emptyLine('Budget'),
      budget: project.estimate.grandTotal,
    });
  }

  // Change orders bump budget at the phase level. COs don't carry phase
  // data directly either — we use the CO description as a best-effort tag
  // and, if it doesn't map to an existing phase, we drop it into a
  // 'Change Orders' bucket so PMs can see the new work.
  for (const co of projectCOs) {
    const phaseKey = co.description?.trim() || 'Change Orders';
    const match = phases.has(phaseKey) ? phaseKey : 'Change Orders';
    const existing = phases.get(match) ?? emptyLine(match);
    existing.budget += co.changeAmount;
    existing.sources.changeOrders += 1;
    phases.set(match, existing);
  }

  // Commitments — signed subs/POs push into their phase.
  for (const c of projectCommitments) {
    const phase = commitmentPhase(c);
    const existing = phases.get(phase) ?? emptyLine(phase);
    existing.committed += c.amount + (c.changeAmount ?? 0);
    existing.sources.commitments += 1;
    phases.set(phase, existing);
  }

  // Actuals — sum payments per invoice and attribute by line-item → phase.
  for (const inv of projectInvoices) {
    const paid = Math.max(0, inv.amountPaid || 0);
    if (paid <= 0) continue;

    const lineTotal = inv.lineItems.reduce((s, l) => s + (l.total || 0), 0);
    const ratio = lineTotal > 0 ? paid / lineTotal : 0;

    for (const line of inv.lineItems) {
      const phase = estimateItemPhase(estimate, line.sourceEstimateItemId);
      const existing = phases.get(phase) ?? emptyLine(phase);
      existing.actual += (line.total || 0) * ratio;
      existing.sources.invoices += 1;
      phases.set(phase, existing);
    }
  }

  // Overcommitted detection — any commitment whose sum exceeds the sum
  // of its linked estimate items. Useful for the dashboard call-out.
  const overcommitted: Commitment[] = [];
  if (estimate) {
    for (const c of projectCommitments) {
      if (!c.linkedEstimateItems || c.linkedEstimateItems.length === 0) continue;
      const linkedTotal = c.linkedEstimateItems.reduce((s, id) => {
        const item = estimate.items.find(it => it.materialId === id);
        return s + (item?.lineTotal ?? 0);
      }, 0);
      if (linkedTotal > 0 && (c.amount + (c.changeAmount ?? 0)) > linkedTotal * 1.02) {
        overcommitted.push(c);
      }
    }
  }

  // Finalize each phase — compute projectedFinal + variance + status.
  const byPhase: JobCostLine[] = [];
  for (const line of phases.values()) {
    const actual = Math.max(0, line.actual);
    const committed = Math.max(0, line.committed);
    const budget = Math.max(0, line.budget);

    // MAGE EAC: actual + (committed - actual) + max(0, budget - committed)
    const remainingCommitted = Math.max(0, committed - actual);
    const uncommittedRemainder = Math.max(0, budget - committed);
    const projectedFinal = actual + remainingCommitted + uncommittedRemainder;
    const variance = projectedFinal - budget;
    const burnRatio = budget > 0 ? Math.min(2, actual / budget) : (committed > 0 ? Math.min(2, actual / committed) : 0);

    const enriched: Omit<JobCostLine, 'status'> = {
      ...line,
      actual,
      committed,
      budget,
      projectedFinal,
      variance,
      burnRatio,
    };
    byPhase.push({ ...enriched, status: classify(enriched) });
  }

  byPhase.sort((a, b) => b.budget - a.budget);

  // Totals.
  const totalBudget = byPhase.reduce((s, p) => s + p.budget, 0);
  const totalCommitted = byPhase.reduce((s, p) => s + p.committed, 0);
  const totalActual = byPhase.reduce((s, p) => s + p.actual, 0);
  const totalProjected = byPhase.reduce((s, p) => s + p.projectedFinal, 0);

  const biggestVariances = [...byPhase]
    .filter(p => Math.abs(p.variance) > 1)
    .sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance))
    .slice(0, 3);

  return {
    asOf: new Date().toISOString(),
    budget: totalBudget,
    committed: totalCommitted,
    actual: totalActual,
    projectedFinal: totalProjected,
    variance: totalProjected - totalBudget,
    commitmentCoverage: totalBudget > 0 ? Math.min(100, (totalCommitted / totalBudget) * 100) : 0,
    spendPercent: totalBudget > 0 ? Math.min(100, (totalActual / totalBudget) * 100) : 0,
    byPhase,
    biggestVariances,
    overcommittedCommitments: overcommitted,
    method: 'mage_committed_plus_uncommitted',
  };
}

function emptyLine(phase: string): JobCostLine {
  return {
    phase,
    budget: 0,
    committed: 0,
    actual: 0,
    projectedFinal: 0,
    variance: 0,
    burnRatio: 0,
    status: 'on_track',
    sources: { commitments: 0, invoices: 0, changeOrders: 0 },
  };
}

/**
 * Format helper so screens don't reinvent currency formatting. We use
 * `Intl.NumberFormat` because `toLocaleString` varies by platform.
 */
export function formatMoney(n: number, opts?: { sign?: boolean }): string {
  const abs = Math.abs(n);
  const sign = opts?.sign && n >= 0 ? '+' : n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${sign}$${Math.round(abs / 1000)}K`;
  if (abs >= 1_000) return `${sign}$${(abs / 1000).toFixed(1)}K`;
  return `${sign}$${Math.round(abs).toLocaleString('en-US')}`;
}

export function formatMoneyFull(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}
