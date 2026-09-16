// scheduleEarnedValue — turn the schedule + linked estimate items into
// "earned value lite" metrics every project tile can show:
//
//   - Planned Value (PV)   — what the budget says we should have spent
//                            by today
//   - Earned Value (EV)    — what we've actually completed (% × cost)
//   - Actual Cost (AC)     — money the GC has paid OUT. Handed in by the
//                            caller, who takes it from computeJobCost()
//                            (utils/jobCostEngine.ts) together with the ledger
//                            records that produced it
//   - Collected to date    — money the CLIENT has paid IN. Revenue. Reported
//                            beside EV and NEVER used as AC
//   - SPI = EV / PV        — Schedule Performance Index
//   - CPI = EV / AC        — Cost Performance Index. Only when a real cost
//                            ledger backs AC; otherwise there is no CPI
//
// MONEY-EVM-1 (screen audit 2026-09-15). AC in this file used to be
// computeActualCostFromInvoices() — the sum of `Invoice.amountPaid` across the
// client's paid and partially-paid invoices. That is the cheque book, not the
// cost ledger: money IN spent as money OUT. Every cost-side number the Budget
// Dashboard printed sat on it — CPI, Cost Variance, EAC, VAC, and the AI
// forecast paragraph that was handed the same figures under the label "Actual
// Cost". Every MAGE contract is seeded with a 25/25/25/25 payment schedule
// (app/bill-from-estimate.tsx), so the day the deposit cleared on a perfectly
// healthy job the screen read CPI 0.00 and "Over budget so far" in red by a
// quarter of the contract — while a GC who was behind on his billing read a
// green "Under budget so far" as he bled on labour.
//
// utils/jobCostEngine.ts has said since MONEY-DEF-1 that ACTUAL IS COST, NEVER
// REVENUE. This engine now agrees with it: AC arrives only from a caller
// holding the cost ledger, and when that ledger is empty the engine reports NO
// CPI, NO cost variance and NO EAC rather than a confident wrong one — the
// same refusal RateProvenanceChip makes ("no resolvable provenance -> no chip.
// Never a placeholder, never a guess"). scripts/validate-money-definitions.ts
// pins both halves so the two engines cannot drift apart a second time.
//
// The CPM master schedule already owns task duration, dependencies, and
// progress %. The estimate context owns dollar values per line item.
// `task.linkedEstimateItemIds` ties the two together. We don't need a
// new data model — this is pure compute.
//
// Why "lite": full earned value uses a baseline + a cost-loaded BCWS
// curve. We can compute that, but most residential GCs read SPI/CPI
// without baselines as long as the schedule has dates + dollars.

import type { ScheduleTask, LinkedEstimate, LinkedEstimateItem } from '@/types';

export interface TaskCostLoad {
  taskId: string;
  /** Dollar value of the task — sum of linked estimate items' carry. */
  budgetedCost: number;
  /** Earned value at current `task.progress`. */
  earnedValue: number;
  /** Source items (handy for the inspector "what's in this task"). */
  items: { id: string; description: string; carry: number }[];
}

export interface ScheduleEvSnapshot {
  /** Per-task cost loading. */
  perTask: Map<string, TaskCostLoad>;
  /** Sum of budgetedCost across every task. Excludes unlinked estimate items. */
  totalBudget: number;
  /** Sum of earnedValue across every task. */
  totalEarnedValue: number;
  /**
   * Planned value at `dayCursor`, summed across all tasks. Linear
   * interpolation within a task: a task that runs day 5-9 with a $10K
   * budget shows $4K of PV at day 7 (40% of the duration consumed).
   */
  totalPlannedValue: number;
  /** Schedule Performance Index. >1 is ahead. <1 is behind. */
  spi: number;
  /**
   * Cost Performance Index. ABSENT unless a caller passed `actualCost` with a
   * non-empty ledger behind it. Absent is a real answer here — render the
   * reason on `costBasis`, never a fallback of 1.00.
   */
  cpi?: number;
  /** The AC the cost side was built on. Absent whenever `cpi` is absent. */
  actualCost?: number;
  /** Whether a cost side exists at all, and why not when it doesn't. */
  costBasis: EvmCostBasis;
  /** Money the CLIENT has paid in (revenue). Reported so a screen can show
   *  billed-vs-earned; it is never AC. Zero when no invoices were passed. */
  collectedToDate: number;
  /** "Today" used for the PV calc — caller passes a working-day cursor. */
  dayCursor: number;
}

/**
 * Per-ledger record counts behind an `ActualCostEvidence.amount` — the union
 * of `JobCostLine.sources` (utils/jobCostEngine.ts) across the project, one
 * count per cost stream. `changeOrders` is deliberately absent from this list:
 * an approved change order moves the BUDGET, and not a dollar of it has been
 * paid to anyone.
 */
export interface ActualCostLedgers {
  /** Commitment payments — subs and POs (`commitment.paidToDate`). */
  commitments: number;
  /** Snapped supplier invoices (material receipts). */
  receipts: number;
  /** Priced crew shifts — self-perform labour. */
  timeEntries: number;
  /** Logged equipment shifts, charged at the machine's day rate. */
  equipment: number;
  /** Permit fees paid to the jurisdiction. */
  permits: number;
}

/**
 * Actual cost travelling WITH the evidence that produced it.
 *
 * The two are one type on purpose. A bare number cannot say whether `0` means
 * "this job has cost nothing yet" or "nobody has recorded anything yet", and
 * those two readings of the same job are opposites. Production today holds
 * projects with zero commitments and a handful of permits, so handing this
 * engine a bare `actualCost: 0` would simply swap a wildly pessimistic AC
 * (the client's money) for a wildly optimistic one (nothing recorded) and
 * print a glowing "Under budget" on the very screen this change exists to
 * stop lying. Evidence first, number second.
 */
export interface ActualCostEvidence {
  /** Dollars paid OUT — `computeJobCost(...).actual`. Never client payments. */
  amount: number;
  /** Which ledgers produced that amount, by record count. All zero = no
   *  evidence, and the engine then refuses to compute a cost side at all. */
  ledgers: ActualCostLedgers;
}

/** Why the cost side of a snapshot is present or absent. */
export type EvmCostBasisReason =
  /** A real ledger backs AC — the cost-side numbers are safe to render. */
  | 'grounded'
  /** Nothing is recorded on ANY cost ledger for this project. */
  | 'no_cost_ledger'
  /** Records exist but carry no dollars — equipment logged against a machine
   *  with no day rate, permits entered with no fee, crew hours on a trade with
   *  no configured rate. Hours alone carry no cost, and neither this engine nor
   *  jobCostEngine will invent a rate to fill the gap. */
  | 'no_priced_cost';

/**
 * The grounding record for every cost-side number in a snapshot. A screen
 * renders CPI / Cost Variance / EAC / VAC only when `grounded`, and otherwise
 * renders `describeCostBasisGap()` in their place — naming the ledger that is
 * empty instead of printing a plausible number off an empty book.
 */
export interface EvmCostBasis {
  grounded: boolean;
  reason: EvmCostBasisReason;
  /** Total ledger records counted across every cost stream. */
  recordCount: number;
  /** Plain-language names of the cost streams holding nothing on this
   *  project, in the order a GC would fill them. Empty when `grounded`. */
  emptyLedgers: string[];
}

export interface BuildEvOpts {
  /** Working-day index of "today" relative to project start. */
  dayCursor: number;
  /**
   * Actual COST paid out so far, with its evidence. Source it from
   * `computeJobCost(...)` — and forward that engine's FULL cost bundle
   * (receipts, timeEntries, laborRates, overtimeMultiplier, equipment,
   * permits, subcontractors), because the four-argument shorthand returns an
   * `actual` missing every material receipt, crew hour, equipment day and
   * permit fee. That partial call is how utils/financialReports.ts shipped a
   * cost-to-date made of subs only; swapping "AC is client revenue" for "AC
   * omits most of the cost" is not a fix.
   *
   * Omit it and the snapshot carries NO cost side: no AC, no CPI. That is the
   * intended behaviour for a caller that does not hold the cost ledger, not a
   * degraded one.
   */
  actualCost?: ActualCostEvidence;
  /**
   * Invoices for the project. These are the CLIENT's payments — revenue — and
   * they feed `collectedToDate` only. They have not fed AC since MONEY-EVM-1
   * (see the file header); passing them can never move CPI.
   */
  invoices?: { amountPaid?: number; status?: string }[];
}

/**
 * Money the CLIENT has paid in so far — paid + partially-paid invoice
 * amounts. This is REVENUE. It is worth showing beside Earned Value, because
 * billed-vs-earned is a question a GC actually has, and it is never, under any
 * circumstance, Actual Cost. The old name for this function was
 * `computeActualCostFromInvoices`, which is precisely how it ended up wired
 * into CPI.
 */
export function computeCollectedToDate(
  invoices: { amountPaid?: number; status?: string }[],
): number {
  let total = 0;
  for (const inv of invoices) {
    if (inv.status === 'paid' || inv.status === 'partially_paid') {
      total += inv.amountPaid ?? 0;
    }
  }
  return total;
}

/** Ledger key → the words a GC reads on screen. Order = the order he'd fill
 *  them in, which is the order the gap sentence lists them. */
const LEDGER_LABELS: readonly (readonly [keyof ActualCostLedgers, string])[] = [
  ['commitments', 'sub & PO payments'],
  ['receipts', 'material receipts'],
  ['timeEntries', 'crew hours'],
  ['equipment', 'equipment days'],
  ['permits', 'permit fees'],
] as const;

/**
 * Decide whether a cost side may be rendered at all, and say why not when it
 * may not. Exported because the answer belongs to this engine rather than to
 * each screen re-deriving `actualCost > 0` — the re-derivation is what would
 * quietly reintroduce the bug on the next surface.
 */
export function evaluateCostBasis(actual: ActualCostEvidence | undefined): EvmCostBasis {
  const ledgers = actual?.ledgers;
  const counts = LEDGER_LABELS.map(([key]) => Math.max(0, ledgers?.[key] ?? 0));
  const recordCount = counts.reduce((s, n) => s + n, 0);
  const emptyLedgers = LEDGER_LABELS.filter((_, i) => counts[i] === 0).map(([, label]) => label);
  const amount = actual?.amount ?? 0;

  if (recordCount === 0) {
    return { grounded: false, reason: 'no_cost_ledger', recordCount: 0, emptyLedgers };
  }
  if (!(amount > 0)) {
    return { grounded: false, reason: 'no_priced_cost', recordCount, emptyLedgers };
  }
  return { grounded: true, reason: 'grounded', recordCount, emptyLedgers: [] };
}

/**
 * One sentence a screen can print where CPI / Cost Variance / EAC would have
 * been. Empty string when the basis is grounded — there is nothing to
 * apologise for on a job with a real ledger.
 */
export function describeCostBasisGap(basis: EvmCostBasis): string {
  if (basis.grounded) return '';
  if (basis.reason === 'no_priced_cost') {
    return `This job has ${basis.recordCount} cost record${basis.recordCount === 1 ? '' : 's'}, but none of them carry a dollar amount yet — a machine logged without a day rate, or a permit with no fee. Cost performance stays hidden until there are real dollars to measure: we don't substitute an average rate.`;
  }
  const list = basis.emptyLedgers.join(', ');
  return `Nothing has been recorded as money paid OUT on this job — no ${list}. Cost performance (CPI, Cost Variance, Est. at Completion) measures what you've spent, so it stays hidden rather than showing a number built on the wrong money. Client payments are money IN and are never counted as cost.`;
}

/**
 * Build a per-task and aggregate cost loading + earned-value snapshot.
 * `linkedEstimate` is optional — if absent, every task's budget is 0
 * and the function still returns a valid (empty) snapshot.
 */
export function buildEarnedValueSnapshot(
  tasks: ScheduleTask[],
  linkedEstimate: LinkedEstimate | undefined,
  opts: BuildEvOpts,
): ScheduleEvSnapshot {
  // LinkedEstimateItem keys by materialId (not "id"). Tasks reference
  // those material IDs in `linkedEstimateItems`.
  const itemMap = new Map<string, LinkedEstimateItem>();
  if (linkedEstimate) {
    for (const item of linkedEstimate.items) itemMap.set(item.materialId, item);
  }

  const perTask = new Map<string, TaskCostLoad>();
  let totalBudget = 0;
  let totalEarnedValue = 0;
  let totalPlannedValue = 0;

  for (const task of tasks) {
    if (task.isSummary) continue; // summary rows are derived
    const items = (task.linkedEstimateItems ?? [])
      .map(id => {
        const item = itemMap.get(id);
        if (!item && task.linkedEstimateItems && task.linkedEstimateItems.length > 0) {
          // v2.3 wedge C: surface stale linkedEstimateItems so they don't
          // silently zero out task budgets. Active re-sync on estimate edit
          // is a separate sub-project — this is honest telemetry only.
          console.warn(
            `[scheduleEarnedValue] stale linkedEstimateItems id=${id} on task=${task.id} (${task.title}). Skipping.`
          );
        }
        return item;
      })
      .filter((x): x is LinkedEstimateItem => !!x)
      .map(li => ({ id: li.materialId, description: li.name, carry: itemCarry(li) }));

    const budgetedCost = items.reduce((s, x) => s + x.carry, 0);
    const earnedValue = budgetedCost * Math.min(1, Math.max(0, (task.progress ?? 0) / 100));

    // Planned value: linear within the task's date range. day 1-indexed.
    const taskStart = task.startDay;
    const taskEnd = task.startDay + task.durationDays - 1;
    let plannedValue = 0;
    if (opts.dayCursor >= taskEnd) {
      plannedValue = budgetedCost; // task should be 100% done by now
    } else if (opts.dayCursor < taskStart) {
      plannedValue = 0;
    } else {
      const daysIn = Math.max(0, opts.dayCursor - taskStart + 1);
      const ratio = task.durationDays > 0 ? daysIn / task.durationDays : 0;
      plannedValue = budgetedCost * Math.min(1, ratio);
    }

    perTask.set(task.id, { taskId: task.id, budgetedCost, earnedValue, items });
    totalBudget += budgetedCost;
    totalEarnedValue += earnedValue;
    totalPlannedValue += plannedValue;
  }

  const spi = totalPlannedValue > 0 ? totalEarnedValue / totalPlannedValue : 1;
  // AC comes from the caller's cost ledger or it does not come at all. There
  // is deliberately no invoice fallback here any more (MONEY-EVM-1): the
  // fallback WAS the bug, and a fallback that silently substitutes revenue is
  // worse than a missing number, because a missing number shows as missing.
  const costBasis = evaluateCostBasis(opts.actualCost);
  const ac = costBasis.grounded ? opts.actualCost?.amount : undefined;
  const cpi = ac && ac > 0 ? totalEarnedValue / ac : undefined;

  return {
    perTask,
    totalBudget,
    totalEarnedValue,
    totalPlannedValue,
    spi,
    cpi,
    actualCost: ac,
    costBasis,
    collectedToDate: opts.invoices ? computeCollectedToDate(opts.invoices) : 0,
    dayCursor: opts.dayCursor,
  };
}

/**
 * Carry value of a linked estimate item — the item's SELL price, which is
 * `lineTotal` exactly as stored.
 *
 * MONEY-EVM-1 (screen audit 2026-09-15). This used to return
 * `lineTotal × (1 + markup/100)`, which charges the markup twice. The estimate
 * invariant utils/estimateMarkup.ts states and scripts/validate-estimate-cost-
 * basis.ts guards is:
 *
 *   unitPrice   is COST per unit
 *   lineTotal   is SELL  = unitPrice × qty × (1 + markup/100)
 *
 * — and app/(tabs)/estimate/full.tsx writes it that way. So a job at 20%
 * markup read 1.44× cost instead of 1.20×, inflating every task's budget and,
 * through them, BAC, EV, PV and the "Budget:" line at the top of the Budget
 * Dashboard. `lineTotal` is only missing on hand-built fixtures and very old
 * rows; that fallback re-derives sell from cost, which is the ONE place the
 * markup legitimately gets applied.
 */
function itemCarry(li: LinkedEstimateItem): number {
  if (typeof li.lineTotal === 'number' && Number.isFinite(li.lineTotal)) return li.lineTotal;
  const markup = typeof li.markup === 'number' ? li.markup : 0;
  return (li.unitPrice ?? 0) * (li.quantity ?? 0) * (1 + markup / 100);
}

/**
 * Format a money value compactly for inline UI ($1.2M, $84K, $312).
 */
export function formatMoneyCompact(n: number): string {
  if (!Number.isFinite(n)) return '$0';
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/**
 * SPI / CPI label tone. >0.95 = good, 0.85-0.95 = warn, <0.85 = bad.
 */
export function performanceTone(value: number): 'good' | 'warn' | 'bad' {
  if (value >= 0.95) return 'good';
  if (value >= 0.85) return 'warn';
  return 'bad';
}

/**
 * v2.4 (audit Item 5) — Count stale linkedEstimateItems references on the
 * given tasks. A reference is stale when the materialId points to an
 * item that's no longer in linkedEstimate.items (deleted or
 * recategorized). v2.3 wedge C surfaced these via console.warn but
 * didn't actively prune them — this helper enables the active cleanup
 * path: count first (for "show me how many"), then call
 * pruneStaleLinkedEstimateItems to apply.
 */
export function countStaleLinkedEstimateItems(
  tasks: ScheduleTask[],
  linkedEstimate: LinkedEstimate | undefined,
): number {
  if (!linkedEstimate) return 0;
  const valid = new Set(linkedEstimate.items.map(i => i.materialId));
  let count = 0;
  for (const t of tasks) {
    if (!t.linkedEstimateItems) continue;
    for (const id of t.linkedEstimateItems) {
      if (!valid.has(id)) count++;
    }
  }
  return count;
}

/**
 * v2.4 (audit Item 5) — Active cleanup of stale linkedEstimateItems
 * references. Returns a new task array with every dead materialId
 * removed from each task's linkedEstimateItems + a count of refs
 * pruned. Caller decides when to apply (typically: an explicit user
 * tap of a "Clean up N stale references" button surfaced when the
 * count from countStaleLinkedEstimateItems > 0).
 *
 * Non-destructive: a task whose linkedEstimateItems becomes empty
 * after pruning gets `linkedEstimateItems: []` (not `undefined`) so
 * the user can still see "no items linked" vs "never linked any."
 */
export function pruneStaleLinkedEstimateItems(
  tasks: ScheduleTask[],
  linkedEstimate: LinkedEstimate | undefined,
): { cleanedTasks: ScheduleTask[]; removed: number } {
  if (!linkedEstimate) return { cleanedTasks: tasks, removed: 0 };
  const valid = new Set(linkedEstimate.items.map(i => i.materialId));
  let removed = 0;
  let mutated = false;
  const cleanedTasks = tasks.map(t => {
    if (!t.linkedEstimateItems || t.linkedEstimateItems.length === 0) return t;
    const kept = t.linkedEstimateItems.filter(id => {
      const ok = valid.has(id);
      if (!ok) removed++;
      return ok;
    });
    if (kept.length === t.linkedEstimateItems.length) return t;
    mutated = true;
    return { ...t, linkedEstimateItems: kept };
  });
  // Return original array reference when no changes — preserves React
  // referential-equality so consumers' useMemo deps don't trigger
  // needlessly.
  return { cleanedTasks: mutated ? cleanedTasks : tasks, removed };
}

// ---------------------------------------------------------------------------
// Cash flow + legacy-EVM adapter
//
// These two exports replace the dead utils/earnedValueEngine.ts. They route
// every EV-derived number through buildEarnedValueSnapshot above so the
// Schedule Pro panel and the Budget Dashboard agree on SPI/CPI for the same
// project. See spec §4.3 for the collapse rationale.
// ---------------------------------------------------------------------------

import type { Project, Invoice, ProjectSchedule, EarnedValueMetrics } from '@/types';
import { effectiveEstimateTotal } from '@/utils/estimateCommit';

export interface CashFlowPoint {
  period: string;
  plannedCumulative: number;
  /**
   * Cumulative CLIENT payments — revenue, not spend. Named `actualCumulative`
   * until MONEY-EVM-1, under a chart legend that read "Actual" beside
   * "Planned", which is the same money-in-as-money-out mislabel this file's
   * header describes. The series is genuinely useful — it is the draw curve —
   * so it kept its data and lost its wrong name.
   */
  collectedCumulative: number;
  /**
   * Planned ÷ CPI. NULL whenever there is no grounded CPI to divide by: the
   * old code fell back to CPI = 1, which drew a "Forecast" dashed line sitting
   * exactly on top of Planned and looking like a confirmed projection.
   */
  forecastCumulative: number | null;
}

/**
 * Period-bucket cash-flow projection. PV is linearly distributed across
 * `periods` buckets; the collected curve is real client payments bucketed by
 * period; forecast = planned / CPI (so a CPI < 1 inflates the forecast).
 * Matches the shape of the dead engine's generateCashFlowData; CPI is sourced
 * from buildEarnedValueSnapshot at end-of-project (one canonical engine).
 *
 * `actual` is the cost evidence from computeJobCost — pass it and the forecast
 * curve is drawn from a real CPI; omit it and every `forecastCumulative` is
 * null, because there is nothing to forecast from (MONEY-EVM-1).
 *
 * Per-task PV-per-period (more accurate than linear) is deliberately
 * deferred — same approximation the dead engine used. v2.1 = engine-
 * truth at the SPI/CPI level; cash-flow accuracy is its own product
 * question.
 */
export function buildCashFlow(
  project: Project,
  invoices: Invoice[],
  schedule: ProjectSchedule | null | undefined,
  periods: number = 12,
  actual?: ActualCostEvidence,
): CashFlowPoint[] {
  const bac = effectiveEstimateTotal(project);
  const totalDays = schedule?.totalDurationDays ?? 180;
  const daysPerPeriod = Math.ceil(totalDays / periods);
  const startDate = new Date(project.createdAt);

  const projectInvoices = invoices
    .filter(inv => inv.projectId === project.id)
    .sort((a, b) => new Date(a.issueDate).getTime() - new Date(b.issueDate).getTime());

  // Canonical CPI source — same engine the Schedule Pro panel uses.
  const snap = buildEarnedValueSnapshot(
    schedule?.tasks ?? [],
    project.linkedEstimate ?? undefined,
    { dayCursor: totalDays, invoices: projectInvoices, actualCost: actual },
  );
  // No grounded CPI → no forecast curve. Not `?? 1`: that printed a forecast
  // identical to the plan and dressed it as a projection (MONEY-EVM-1).
  const cpi = snap.cpi;

  const data: CashFlowPoint[] = [];
  let collectedCumulative = 0;

  for (let i = 0; i < periods; i++) {
    const periodStart = new Date(startDate.getTime() + i * daysPerPeriod * 86400000);
    const periodEnd = new Date(startDate.getTime() + (i + 1) * daysPerPeriod * 86400000);

    const plannedRatio = Math.min((i + 1) / periods, 1);
    const plannedCumulative = bac * plannedRatio;

    const periodPayments = projectInvoices.filter(inv => {
      const d = new Date(inv.issueDate).getTime();
      return d >= periodStart.getTime() && d < periodEnd.getTime();
    });
    collectedCumulative += periodPayments.reduce((sum, inv) => sum + (inv.amountPaid ?? 0), 0);

    const forecastCumulative = cpi && cpi > 0 ? Math.round(plannedCumulative / cpi) : null;

    data.push({
      period: `Wk ${i + 1}`,
      plannedCumulative: Math.round(plannedCumulative),
      collectedCumulative: Math.round(collectedCumulative),
      forecastCumulative,
    });
  }

  return data;
}

/**
 * The shape `legacyEvmMetrics` returns.
 *
 * Every cost-side field is OPTIONAL, and that is the whole point. The legacy
 * `EarnedValueMetrics` type in types/index.ts types them as plain numbers,
 * which left no way to say "this job has no cost ledger" other than filling
 * them with a number — and the numbers it got filled with were the client's
 * payments (see the file header). A consumer must now branch on `costBasis`,
 * which is a compile-time nudge in the right direction: `metrics.actualCost`
 * no longer typechecks as a number you can print.
 *
 * The schedule side (BAC / PV / EV / SV / SPI / percentComplete) needs no cost
 * ledger and is always present — app/invoice.tsx and app/aia-pay-app.tsx read
 * `percentComplete` off this and are unaffected.
 */
export interface EvmMetricsResult extends Omit<EarnedValueMetrics,
  'actualCost' | 'costVariance' | 'costPerformanceIndex'
  | 'estimateAtCompletion' | 'estimateToComplete' | 'varianceAtCompletion'
> {
  /** Money paid OUT. Present only when `costBasis.grounded`. */
  actualCost?: number;
  /** EV − AC. Present only when `costBasis.grounded`. */
  costVariance?: number;
  /** EV / AC. Present only when `costBasis.grounded`. */
  costPerformanceIndex?: number;
  /** BAC / CPI. Present only when `costBasis.grounded`. */
  estimateAtCompletion?: number;
  /** EAC − AC. Present only when `costBasis.grounded`. */
  estimateToComplete?: number;
  /** BAC − EAC (positive = under; the OPPOSITE sign convention to
   *  jobCostEngine — see that file's header). Grounded only. */
  varianceAtCompletion?: number;
  /** Whether a cost side exists at all, and why not when it doesn't. */
  costBasis: EvmCostBasis;
  /** Client money IN over the same window. Revenue, never AC. */
  collectedToDate: number;
}

/**
 * Legacy-shape EarnedValueMetrics adapter. Lets budget-dashboard.tsx
 * keep its existing UI code path unchanged while sourcing every number
 * from the canonical buildEarnedValueSnapshot pipeline.
 *
 * `actual` is the cost evidence from computeJobCost (utils/jobCostEngine.ts),
 * forwarded with that engine's FULL cost bundle. Omit it — as app/invoice.tsx
 * and app/aia-pay-app.tsx do, both of which want `percentComplete` only — and
 * the result carries the schedule side and no cost side at all. That is
 * correct behaviour, not a degraded one: there is no cost ledger in hand, so
 * there is no honest CPI to report (MONEY-EVM-1).
 *
 * Deliberate semantic shift on `percentComplete`: the dead engine used
 * avg(task.progress) — equally weighted regardless of dollar value. The
 * new shape uses cost-weighted EV/BAC × 100. Same scenario can produce
 * a much lower (correct) number on schedules with uneven task budgets.
 * Documented in spec §4.4.
 */
export function legacyEvmMetrics(
  project: Project,
  invoices: Invoice[],
  schedule: ProjectSchedule | null | undefined,
  actual?: ActualCostEvidence,
): EvmMetricsResult {
  const tasks = schedule?.tasks ?? [];
  const projectInvoices = invoices.filter(inv => inv.projectId === project.id);
  const dayCursor = elapsedDaysForCursor(project, schedule);

  const snap = buildEarnedValueSnapshot(
    tasks,
    project.linkedEstimate ?? undefined,
    { dayCursor, invoices: projectInvoices, actualCost: actual },
  );

  const bac = snap.totalBudget;
  const pv = snap.totalPlannedValue;
  const ev = snap.totalEarnedValue;
  const sv = ev - pv;
  const spi = snap.spi;
  const percentComplete = bac > 0 ? (ev / bac) * 100 : 0;

  const metrics: EvmMetricsResult = {
    budgetAtCompletion: bac,
    plannedValue: pv,
    earnedValue: ev,
    scheduleVariance: sv,
    schedulePerformanceIndex: round2(spi),
    percentComplete: round1(percentComplete),
    costBasis: snap.costBasis,
    collectedToDate: snap.collectedToDate,
    calculatedAt: new Date().toISOString(),
  };

  // The cost half lands as a block or not at all — half a cost picture (an AC
  // with no CPI, a CV with no EAC) is how a screen ends up rendering one
  // grounded number beside five invented ones.
  const ac = snap.actualCost;
  const cpi = snap.cpi;
  if (snap.costBasis.grounded && typeof ac === 'number' && typeof cpi === 'number' && cpi > 0) {
    const eac = bac / cpi;
    // Positive = UNDER budget here — the OPPOSITE of jobCostEngine's variance
    // convention, deliberately (see that file's header; do not carry a sign
    // across the two engines). scripts/validate-job-cost-variance.ts pins this
    // line verbatim, so keep the expression spelled out.
    const vac = bac - eac;
    metrics.actualCost = ac;
    metrics.costVariance = ev - ac;
    metrics.costPerformanceIndex = round2(cpi);
    metrics.estimateAtCompletion = round2(eac);
    metrics.estimateToComplete = round2(eac - ac);
    metrics.varianceAtCompletion = round2(vac);
  }

  return metrics;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/** Calendar-days elapsed since project start, clamped to 1..totalDurationDays.
 *  v2.1 keeps the same calendar-days approximation the dead engine used.
 *  Calendar-aware (working days + holidays) lands in v2.2. */
function elapsedDaysForCursor(
  project: Project,
  schedule: ProjectSchedule | null | undefined,
): number {
  if (!project.createdAt) return 1;
  const start = new Date(project.createdAt).getTime();
  const now = Date.now();
  if (now <= start) return 1;
  const elapsed = Math.floor((now - start) / (1000 * 60 * 60 * 24)) + 1;
  const cap = schedule?.totalDurationDays ?? elapsed;
  return Math.min(Math.max(1, elapsed), Math.max(1, cap));
}

function round1(n: number): number { return Math.round(n * 10) / 10; }
function round2(n: number): number { return Math.round(n * 100) / 100; }
