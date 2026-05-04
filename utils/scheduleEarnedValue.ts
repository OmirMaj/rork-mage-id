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
      .map(id => itemMap.get(id))
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
