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
// that work to sub-buy (so it acts as a floor).
//
// SIGN CONVENTION — variance = projectedFinal - budget, so POSITIVE = OVER
// BUDGET and negative = under. If commitments already exceed budget then
// EAC collapses to `committed`, and variance = committed - budget > 0 — the
// signal a PM needs to kill the project before it bleeds further.
//
// This comment used to claim the opposite ("shows up negative"), which the
// formula three lines below never did and arithmetically could not. The Job
// Costing screen believed the prose instead of the code and told a GC he was
// "$49K UNDER budget" while he was $49K over (docs/audits/2026-08-17-web-audit.md).
// Note this is the OPPOSITE of the EVM convention in utils/scheduleEarnedValue.ts,
// where `varianceAtCompletion = BAC - EAC` and positive means under. Do not
// carry a sign across the two engines. Render through `describeVariance`
// below rather than re-deriving `variance >= 0` at a call site; that
// re-derivation is exactly what shipped the bug.
//
// NOTE: we intentionally don't include progress-weighted EAC variants
// (CPI / SPI-based) here — those require earned-value output which is a
// separate concern. See utils/scheduleEarnedValue.ts
// (buildEarnedValueSnapshot, legacyEvmMetrics) for that flavor.

import type {
  Project,
  Commitment,
  Invoice,
  ChangeOrder,
  LinkedEstimate,
  MaterialReceipt,
  TimeEntry,
} from '@/types';
import {
  isEligibleLaborEntry, normalizeTradeKey, priceLaborEntry, DEFAULT_OVERTIME_MULTIPLIER,
  type LaborRateMap,
} from '@/utils/laborSamples';

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
  /** projectedFinal - budget. Positive = over budget (see header). */
  variance: number;
  /** Ratio of actual to budget, clamped to [0, 2]. */
  burnRatio: number;
  /** Status classification for dashboard chips. `unbudgeted` = real money
   *  landed on a phase carrying no budget, so there is nothing to be on
   *  track against. */
  status: 'on_track' | 'warning' | 'over' | 'unbudgeted';
  /** How many commitments, invoices, change orders, material receipts, and
   *  crew time entries contributed. */
  sources: { commitments: number; invoices: number; changeOrders: number; receipts: number; timeEntries: number };
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
  /** projectedFinal - budget. Positive = projecting over budget (see header). */
  variance: number;
  /** Percent of budget committed (signed). NOT capped at 100 — 175% means
   *  you've signed $1.75 of subs for every budgeted dollar, and capping it
   *  is how an over-budget job used to look on-budget. */
  commitmentCoverage: number;
  /** Percent of budget spent. NOT capped at 100 — see commitmentCoverage. */
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
 * - over:       projectedFinal exceeds a real budget by more than 2%
 * - warning:    actual is 90% of budget but the phase isn't visibly done
 * - unbudgeted: money landed on a phase the estimate never priced
 * - on_track:   everything else
 */
function classify(line: Omit<JobCostLine, 'status'>): JobCostLine['status'] {
  if (line.budget > 0) {
    if (line.projectedFinal > line.budget * 1.02) return 'over';
    if (line.actual / line.budget > 0.9 && line.committed > line.actual * 1.05) return 'warning';
    return 'on_track';
  }
  // No budget line at all. `variance` for this phase is its ENTIRE projected
  // cost, so calling it "on track" is the same lie the KPI card used to tell:
  // in the Henderson case a whole $49K of untraceable payments sat in
  // '(Uncategorized)' behind a green "On track" chip. A 2% tolerance is
  // meaningless against a $0 budget — any dollar is infinitely over it.
  //
  // Deliberately NOT 'over': this money isn't necessarily an overrun, it's
  // money the estimate never accounted for, which is a different and often
  // fixable thing (an invoice line that lost its estimate-item link, a
  // commitment tagged with a phase name the estimate spells differently,
  // self-perform labor that was never estimated as its own scope). Naming
  // that honestly beats both a false green and a false red.
  if (line.projectedFinal > 0) return 'unbudgeted';
  return 'on_track';
}

export interface JobCostInput {
  project: Project;
  commitments: Commitment[];
  invoices: Invoice[];
  changeOrders: ChangeOrder[];
  /** Snapped supplier invoices. Their line totals count as ACTUAL material
   *  spend, attributed to the phase of their linked PO commitment (or, when
   *  unlinked, by each line's category). Additive — omit for the original
   *  commitments+invoices-only actuals. */
  receipts?: MaterialReceipt[];
  /** Crew time entries (self-perform labor, D6). Finished shifts × the GC's
   *  configured loaded rates (laborRates) count as ACTUAL labor spend in a
   *  dedicated "Self-perform labor" phase line. Entries whose trade has no
   *  configured rate contribute nothing — hours alone carry no dollars, and
   *  we never substitute market averages. Additive — omit both for the
   *  original behavior. */
  timeEntries?: TimeEntry[];
  laborRates?: LaborRateMap;
  /** MONEY-F19: the GC's overtime premium (hooks/useLaborRates.ts
   *  overtimeMultiplier). Overtime hours on a shift are priced at
   *  rate × multiplier; omit for the 1.5× default. */
  overtimeMultiplier?: number;
}

/**
 * Run the cost-to-complete engine on one project's numbers.
 *
 * Pure function — all data is passed in, no storage side effects. Callers
 * wire it up from ProjectContext and re-run on every mutation. Results are
 * cheap to recompute because the input arrays are already in memory.
 */
export function computeJobCost({
  project, commitments, invoices, changeOrders, receipts = [], timeEntries = [], laborRates = {},
  overtimeMultiplier = DEFAULT_OVERTIME_MULTIPLIER,
}: JobCostInput): JobCostSummary {
  const projectCommitments = commitments.filter(c => c.projectId === project.id && c.status !== 'draft');
  const projectInvoices = invoices.filter(inv => inv.projectId === project.id);
  const projectCOs = changeOrders.filter(co => co.projectId === project.id && co.status === 'approved');
  const projectReceipts = receipts.filter(r => r.projectId === project.id);

  const estimate = project.linkedEstimate ?? null;
  const phases = new Map<string, JobCostLine>();

  // Seed from estimate items — every category that exists in the budget
  // gets a line, even if no commitments / invoices landed on it yet. This
  // keeps the "$0 committed against $50K budget" visible early.
  if (estimate) {
    for (const item of estimate.items) {
      const phase = item.category?.trim() || PHASE_UNCATEGORIZED;
      const existing = phases.get(phase) ?? emptyLine(phase);
      // COST, not sell. `lineTotal` is the MARKED-UP figure —
      // app/(tabs)/estimate/full.tsx:933 computes it as
      //     base * (1 + markup / 100) * quantity
      // and grandTotal is the sum of those. Seeding a job-COST budget with it
      // made budget === revenue, so projectedFinal === projectedRevenue and
      // every job reported $0 projected profit before any work happened. Real
      // cost erosion then looked identical to that baseline noise, and the
      // same inflated EAC flowed into the profit report and the bank-facing
      // WIP row.
      //
      // `unitPrice` is the cost basis and is already bulk-aware (full.tsx:932
      // assigns `usesBulk ? baseBulkPrice : baseRetailPrice`). Labor and
      // assemblies carry markup: 0 with unitPrice × quantity equal to their
      // all-in cost, so this sum reproduces the estimate's own baseTotal
      // exactly — which is the same cost basis utils/wip.deriveEstimatedCost
      // uses. One definition of cost across the app.
      existing.budget += (item.unitPrice ?? 0) * (item.quantity ?? 0);
      phases.set(phase, existing);
    }
  } else if (project.estimate) {
    // Legacy estimate — one catch-all bucket.
    //
    // grandTotal stays here deliberately. EstimateBreakdown (types/index.ts:66)
    // has no markup or profit line at all — materials, labor, permits,
    // overhead, contingency, tax — so its grandTotal is cost + tax, not
    // cost + margin. There is no markup to strip, and it is the same call
    // utils/wip.deriveEstimatedCost makes for the legacy shape.
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

  // Material receipts — snapped supplier invoices count as ACTUAL material
  // spend. A receipt linked to a PO commitment lands in that commitment's
  // phase (the whole receipt); an unlinked receipt is split per line by the
  // line's category → phase, so material cost shows up against the right scope.
  for (const r of projectReceipts) {
    const linked = r.commitmentId ? projectCommitments.find(c => c.id === r.commitmentId) : undefined;
    if (linked) {
      const phase = commitmentPhase(linked);
      const existing = phases.get(phase) ?? emptyLine(phase);
      existing.actual += r.lines.reduce((s, l) => s + (l.lineTotal || 0), 0);
      existing.sources.receipts += 1;
      phases.set(phase, existing);
    } else {
      for (const line of r.lines) {
        const cat = (line.category || '').trim();
        const phase = cat && phases.has(cat) ? cat : (cat || PHASE_UNCATEGORIZED);
        const existing = phases.get(phase) ?? emptyLine(phase);
        existing.actual += line.lineTotal || 0;
        existing.sources.receipts += 1;
        phases.set(phase, existing);
      }
    }
  }

  // Self-perform labor — finished shifts × the GC's configured loaded rates
  // count as ACTUAL labor spend, in a dedicated phase line. Estimates rarely
  // carry a matching phase, so it reads as unbudgeted actuals — the honest
  // story until self-perform labor is estimated as its own scope. Same
  // no-budget behavior as an unbudgeted commitment phase.
  {
    let laborActual = 0;
    let counted = 0;
    for (const e of timeEntries) {
      if (e.projectId !== project.id || !isEligibleLaborEntry(e)) continue;
      const rate = laborRates[normalizeTradeKey(e.trade)];
      if (!Number.isFinite(rate) || rate <= 0) continue;
      // MONEY-F19: overtime is PRICED, not just counted. totalHours × rate
      // booked a 10-hour day at $500 when the crew cost $550.
      laborActual += priceLaborEntry(e, rate, overtimeMultiplier);
      counted++;
    }
    if (laborActual > 0) {
      const phase = 'Self-perform labor';
      const existing = phases.get(phase) ?? emptyLine(phase);
      existing.actual += laborActual;
      existing.sources.timeEntries += counted;
      phases.set(phase, existing);
    }
  }

  // Overcommitted detection — any commitment whose sum exceeds the sum
  // of its linked estimate items. Useful for the dashboard call-out.
  const overcommitted: Commitment[] = [];
  if (estimate) {
    for (const c of projectCommitments) {
      if (!c.linkedEstimateItems || c.linkedEstimateItems.length === 0) continue;
      // MONEY-F11: COST basis (unitPrice × quantity), not the marked-up
      // lineTotal — a commitment is at cost, and measuring it against sell
      // hid a sub signed 17% over the estimate behind the 15% markup.
      const linkedTotal = c.linkedEstimateItems.reduce((s, id) => {
        const item = estimate.items.find(it => it.materialId === id);
        return s + (item ? (item.unitPrice ?? 0) * (item.quantity ?? 0) : 0);
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
    // NOT clamped to 100. These are reported numbers, not bar widths: a
    // Math.min(100, …) here made $49K spent against a $48K budget read
    // "100% of budget", so an over-budget job could never look over-budget
    // (docs/audits/2026-08-17-web-audit.md). Anything drawing a progress bar
    // from these must clamp the WIDTH at the call site, never the value.
    commitmentCoverage: totalBudget > 0 ? (totalCommitted / totalBudget) * 100 : 0,
    spendPercent: totalBudget > 0 ? (totalActual / totalBudget) * 100 : 0,
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
    sources: { commitments: 0, invoices: 0, changeOrders: 0, receipts: 0, timeEntries: 0 },
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

// ─────────────────────────────────────────────────────────────
// Variance presentation
// ─────────────────────────────────────────────────────────────

/**
 * Below this many dollars a variance displays as `$0`, so it must not read
 * as a direction — otherwise float noise paints the card red or green.
 */
export const VARIANCE_EPSILON = 0.5;

export type VarianceTone = 'over' | 'under' | 'on_budget';

export interface VarianceDisplay {
  /** Which side of budget this lands on. */
  tone: VarianceTone;
  /** KPI card label — pair with `amount`, e.g. "Over by" + "$49K". */
  label: string;
  /** One-sentence projection banner. */
  banner: string;
  /** Magnitude in dollars, always >= 0. */
  amount: number;
  /** Theme colour family. Map to `colors.danger` / `.success` at the call site. */
  colorKey: 'danger' | 'success' | 'neutral';
  /** Trend arrow direction. */
  trend: 'up' | 'down' | 'flat';
}

/**
 * Turn a signed variance into the words and colour that go on screen.
 *
 * Pure and exported so it can be tested without rendering a screen —
 * see scripts/validate-job-cost-variance.ts.
 */
export function describeVariance(variance: number): VarianceDisplay {
  const amount = Math.abs(variance);
  // variance = projectedFinal - budget, so POSITIVE MEANS OVER. Read the
  // arithmetic at the top of computeJobCost, not any prose about it.
  if (variance > VARIANCE_EPSILON) {
    return {
      tone: 'over',
      label: 'Over by',
      banner: `Projecting ${formatMoney(amount)} over budget`,
      amount,
      colorKey: 'danger',
      trend: 'up',
    };
  }
  if (variance < -VARIANCE_EPSILON) {
    return {
      tone: 'under',
      label: 'Under by',
      banner: `On track to finish ${formatMoney(amount)} under budget`,
      amount,
      colorKey: 'success',
      trend: 'down',
    };
  }
  // Landing on the number is neither a win nor a loss, and must not be
  // painted as one — `formatMoney` would render "$0" beside "Under by".
  return {
    tone: 'on_budget',
    label: 'On budget',
    banner: 'Projecting to finish on budget',
    amount: 0,
    colorKey: 'neutral',
    trend: 'flat',
  };
}
