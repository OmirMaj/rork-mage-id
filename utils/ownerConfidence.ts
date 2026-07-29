// utils/ownerConfidence.ts
//
// The OWNER-facing "Project Confidence" summary — the at-a-glance answer to the
// only two questions an owner actually has: is my project ON TIME, and ON BUDGET?
//
// CLIENT-FACING — this NEVER exposes the GC's cost, markup, or margin. "Budget"
// here is the OWNER's contract/billing view only: contract price, approved
// change orders, invoiced, paid, balance. (See the client-facing-mode rule —
// cost/margin must never leak to the owner.)
//
// Pure: no React/network. Deterministic (caller passes nowMs, so the status is
// testable). Imports only Bun-safe utils.

import type { Project, ChangeOrder, Invoice, ScheduleTask } from '@/types';
import { addWorkingDays } from '@/utils/scheduleEngine';
import { effectiveEstimateTotal } from '@/utils/estimateCommit';

export type ConfidenceStatus = 'on_track' | 'minor_delays' | 'behind' | 'not_started' | 'complete';

export interface OwnerBilling {
  contract: number;
  approvedChanges: number;
  revisedContract: number;
  billed: number;
  paid: number;
  balance: number;
}

export interface OwnerConfidence {
  hasSchedule: boolean;
  pctComplete: number; // 0–100, duration-weighted task progress
  status: ConfidenceStatus;
  statusLabel: string;
  projectedFinishISO: string | null;
  billing: OwnerBilling;
  nextMilestones: { title: string; dateISO: string | null }[];
  awaitingApproval: number; // change orders pending the owner's decision
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

const STATUS_LABEL: Record<ConfidenceStatus, string> = {
  on_track: 'On track',
  minor_delays: 'Minor delays',
  behind: 'Behind schedule',
  not_started: 'Starting soon',
  complete: 'Complete',
};

export function buildOwnerConfidence(opts: {
  project: Project;
  changeOrders: ChangeOrder[];
  invoices: Invoice[];
  nowMs: number;
}): OwnerConfidence {
  const { project, changeOrders, invoices, nowMs } = opts;
  const tasks: ScheduleTask[] = project.schedule?.tasks ?? [];
  const hasSchedule = tasks.length > 0;
  const wpw = project.schedule?.workingDaysPerWeek ?? 5;
  const nonWorking = project.schedule?.nonWorkingDates;
  const startDate = project.schedule?.startDate;
  const isClosed = project.status === 'completed' || project.status === 'closed';

  // ── % complete — duration-weighted (a 20-day task counts more than a 1-day one).
  let pctComplete = 0;
  if (hasSchedule) {
    let num = 0;
    let den = 0;
    for (const t of tasks) {
      const w = Math.max(1, t.durationDays ?? 1);
      num += Math.max(0, Math.min(100, t.progress ?? 0)) * w;
      den += w;
    }
    pctComplete = den > 0 ? Math.round(num / den) : 0;
  }
  if (isClosed) pctComplete = 100;

  // ── Projected finish — the authored finish (max task end) on the working-day
  //    calendar, matching what the Gantt shows. (CPM is analysis; the authored
  //    startDay/durationDays ARE the plan.)
  let projectedFinishISO: string | null = null;
  let startMs = NaN;
  let finishMs = NaN;
  if (hasSchedule && startDate && Number.isFinite(Date.parse(startDate + 'T00:00:00'))) {
    const start = new Date(startDate + 'T00:00:00');
    startMs = start.getTime();
    let maxEndDay = 1;
    for (const t of tasks) {
      const endDay = (t.startDay ?? 1) + Math.max(0, (t.durationDays ?? 1) - 1);
      if (endDay > maxEndDay) maxEndDay = endDay;
    }
    try {
      const finish = addWorkingDays(start, Math.max(0, maxEndDay - 1), wpw, nonWorking);
      projectedFinishISO = isoDate(finish);
      finishMs = finish.getTime();
    } catch {
      projectedFinishISO = null;
    }
  }

  // ── On-track status — a deterministic PACE read: how much is actually done
  //    vs how much SHOULD be done by today. Honest for an owner (are we keeping
  //    pace?) and stable in tests.
  let status: ConfidenceStatus;
  if (isClosed) {
    status = 'complete';
  } else if (!hasSchedule) {
    status = 'not_started';
  } else if (Number.isFinite(startMs) && nowMs < startMs) {
    status = 'not_started';
  } else if (Number.isFinite(startMs) && Number.isFinite(finishMs) && finishMs > startMs) {
    const expected = clamp01((nowMs - startMs) / (finishMs - startMs));
    const actual = pctComplete / 100;
    const delta = actual - expected; // positive = ahead of pace
    status = delta >= -0.05 ? 'on_track' : delta >= -0.15 ? 'minor_delays' : 'behind';
  } else {
    // Schedule with no parseable dates — report progress without a pace verdict.
    status = pctComplete >= 100 ? 'complete' : 'on_track';
  }

  // ── Billing — CLIENT-FACING ONLY. Contract price + approved COs, invoiced,
  //    paid, balance. No cost, no markup, no margin.
  const contract = effectiveEstimateTotal(project);
  const approvedChanges = changeOrders
    .filter((co) => co.status === 'approved')
    .reduce((s, co) => s + (co.changeAmount ?? 0), 0);
  const revisedContract = contract + approvedChanges;
  const billed = invoices.reduce((s, inv) => s + (inv.totalDue ?? 0), 0);
  const paid = invoices.reduce((s, inv) => s + (inv.amountPaid ?? 0), 0);
  const balance = Math.max(0, revisedContract - paid);

  // ── Next milestones — upcoming, not-yet-done, mapped to dates, top 3.
  const nextMilestones: { title: string; dateISO: string | null }[] = [];
  if (hasSchedule && startDate && Number.isFinite(startMs)) {
    const start = new Date(startMs);
    const candidates = tasks
      .filter((t) => t.isMilestone && t.status !== 'done' && (t.progress ?? 0) < 100)
      .map((t) => {
        const endDay = (t.startDay ?? 1) + Math.max(0, (t.durationDays ?? 1) - 1);
        let dISO: string | null = null;
        try {
          dISO = isoDate(addWorkingDays(start, Math.max(0, endDay - 1), wpw, nonWorking));
        } catch {
          dISO = null;
        }
        return { title: t.title ?? 'Milestone', dateISO: dISO };
      })
      .filter((m) => m.dateISO == null || Date.parse(m.dateISO + 'T00:00:00') >= nowMs - 86400000)
      .sort((a, b) => (a.dateISO ?? '￿').localeCompare(b.dateISO ?? '￿'))
      .slice(0, 3);
    nextMilestones.push(...candidates);
  }

  // ── Awaiting the owner — change orders pending their decision.
  const awaitingApproval = changeOrders.filter(
    (co) => co.status === 'submitted' || co.status === 'under_review',
  ).length;

  return {
    hasSchedule,
    pctComplete,
    status,
    statusLabel: STATUS_LABEL[status],
    projectedFinishISO,
    billing: { contract, approvedChanges, revisedContract, billed, paid, balance },
    nextMilestones,
    awaitingApproval,
  };
}
