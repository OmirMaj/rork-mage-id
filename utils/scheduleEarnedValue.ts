// scheduleEarnedValue — turn the schedule + linked estimate items into
// "earned value lite" metrics every project tile can show:
//
//   - Planned Value (PV)   — what the budget says we should have spent
//                            by today
//   - Earned Value (EV)    — what we've actually completed (% × cost)
//   - Actual Cost          — what we've recorded as spent (best
//                            available signal: invoices + COs)
//   - SPI = EV / PV        — Schedule Performance Index
//   - CPI = EV / AC        — Cost Performance Index (when AC available)
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
  /** Cost Performance Index. Optional — needs actualCost passed in. */
  cpi?: number;
  /** "Today" used for the PV calc — caller passes a working-day cursor. */
  dayCursor: number;
}

export interface BuildEvOpts {
  /** Working-day index of "today" relative to project start. */
  dayCursor: number;
  /** Optional actual cost recorded so far (e.g. paid invoices + commitments).
   *  When omitted but `invoices` is provided, AC is auto-computed from
   *  invoice amount-paid totals. */
  actualCost?: number;
  /** Invoices for the project — used to auto-compute AC by summing paid
   *  amounts. Only counted if status is 'paid' or 'partially_paid'. */
  invoices?: { amountPaid?: number; status?: string }[];
}

/**
 * Compute Actual Cost from a project's invoices. Counts paid + partial-
 * paid amounts. Caller can pass this directly via `actualCost` if they
 * want to combine invoices + commitments + payroll.
 */
export function computeActualCostFromInvoices(
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
  // AC: caller-provided wins; fall back to auto-compute from invoices.
  const ac = (typeof opts.actualCost === 'number' && opts.actualCost > 0)
    ? opts.actualCost
    : (opts.invoices ? computeActualCostFromInvoices(opts.invoices) : undefined);
  const cpi = ac && ac > 0 ? totalEarnedValue / ac : undefined;

  return {
    perTask,
    totalBudget,
    totalEarnedValue,
    totalPlannedValue,
    spi,
    cpi,
    dayCursor: opts.dayCursor,
  };
}

/** Carry value of a linked estimate item — line total × (1 + markup%). */
function itemCarry(li: LinkedEstimateItem): number {
  const baseTotal = li.lineTotal ?? (li.unitPrice * li.quantity);
  const markup = typeof li.markup === 'number' ? li.markup : 0;
  return baseTotal * (1 + markup / 100);
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
  actualCumulative: number;
  forecastCumulative: number;
}

/**
 * Period-bucket cash-flow projection. PV is linearly distributed across
 * `periods` buckets; AC is real invoice payments bucketed by period;
 * forecast = planned / CPI (so a CPI < 1 inflates the forecast). Matches
 * the shape of the dead engine's generateCashFlowData; CPI is sourced
 * from buildEarnedValueSnapshot at end-of-project (one canonical engine).
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
    { dayCursor: totalDays, invoices: projectInvoices },
  );
  const cpi = snap.cpi ?? 1;

  const data: CashFlowPoint[] = [];
  let actualCumulative = 0;

  for (let i = 0; i < periods; i++) {
    const periodStart = new Date(startDate.getTime() + i * daysPerPeriod * 86400000);
    const periodEnd = new Date(startDate.getTime() + (i + 1) * daysPerPeriod * 86400000);

    const plannedRatio = Math.min((i + 1) / periods, 1);
    const plannedCumulative = bac * plannedRatio;

    const periodPayments = projectInvoices.filter(inv => {
      const d = new Date(inv.issueDate).getTime();
      return d >= periodStart.getTime() && d < periodEnd.getTime();
    });
    actualCumulative += periodPayments.reduce((sum, inv) => sum + (inv.amountPaid ?? 0), 0);

    const forecastCumulative = cpi !== 0 ? plannedCumulative / cpi : plannedCumulative;

    data.push({
      period: `Wk ${i + 1}`,
      plannedCumulative: Math.round(plannedCumulative),
      actualCumulative: Math.round(actualCumulative),
      forecastCumulative: Math.round(forecastCumulative),
    });
  }

  return data;
}

/**
 * Legacy-shape EarnedValueMetrics adapter. Lets budget-dashboard.tsx
 * keep its existing UI code path unchanged while sourcing every number
 * from the canonical buildEarnedValueSnapshot pipeline.
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
): EarnedValueMetrics {
  const tasks = schedule?.tasks ?? [];
  const projectInvoices = invoices.filter(inv => inv.projectId === project.id);
  const dayCursor = elapsedDaysForCursor(project, schedule);

  const snap = buildEarnedValueSnapshot(
    tasks,
    project.linkedEstimate ?? undefined,
    { dayCursor, invoices: projectInvoices },
  );

  const bac = snap.totalBudget;
  const pv = snap.totalPlannedValue;
  const ev = snap.totalEarnedValue;
  const ac = computeActualCostFromInvoices(projectInvoices);
  const sv = ev - pv;
  const cv = ev - ac;
  const spi = snap.spi;
  const cpi = snap.cpi ?? 1;
  const eac = cpi !== 0 ? bac / cpi : bac;
  const etc = eac - ac;
  const vac = bac - eac;
  const percentComplete = bac > 0 ? (ev / bac) * 100 : 0;

  return {
    budgetAtCompletion: bac,
    plannedValue: pv,
    earnedValue: ev,
    actualCost: ac,
    scheduleVariance: sv,
    costVariance: cv,
    schedulePerformanceIndex: round2(spi),
    costPerformanceIndex: round2(cpi),
    estimateAtCompletion: round2(eac),
    estimateToComplete: round2(etc),
    varianceAtCompletion: round2(vac),
    percentComplete: round1(percentComplete),
    calculatedAt: new Date().toISOString(),
  };
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
