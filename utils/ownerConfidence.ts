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
import { computeProjectProgress } from '@/utils/projectProgress';
import { toCalendarDate } from '@/utils/portalOwnerCore';

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

export const STATUS_LABEL: Record<ConfidenceStatus, string> = {
  on_track: 'On track',
  minor_delays: 'Minor delays',
  behind: 'Behind schedule',
  not_started: 'Starting soon',
  complete: 'Complete',
};

// Shown in place of a verdict when the schedule gives us no evidence to judge
// pace on. The status stays inside the ConfidenceStatus union ('not_started',
// neutral colour, never read as "behind" by pacedScheduleVerdict) because
// other surfaces type the status as that union; only the WORDS change, so the
// pill never says "Starting soon" on a job that started months ago.
export const NO_PACE_LABEL = {
  noProgress: 'Progress not reported yet',
  noStartDate: 'No start date set',
} as const;

/**
 * THE pace thresholds — the one place they live. `delta` is (fraction of the
 * work reported done) minus (fraction of the scheduled time used up); positive
 * means ahead of pace. marketing/portal/index.html carries a hand-written copy
 * (a static page cannot import TypeScript), and
 * scripts/validate-portal-owner.ts fails the build if the two ever differ —
 * the in-app card and the homeowner's page must never give one job two
 * verdicts.
 */
export const OWNER_PACE_THRESHOLDS = {
  /** At or above this delta the job is keeping pace. */
  onTrackMinDelta: -0.05,
  /** At or above this (and below onTrack) it is slipping; below it, behind. */
  minorDelaysMinDelta: -0.15,
} as const;

export type OwnerPaceStatus = 'on_track' | 'minor_delays' | 'behind' | 'complete';

export interface OwnerSchedulePace {
  status: OwnerPaceStatus;
  /** 0–100, duration-weighted, milestones excluded (= computeProjectProgress). */
  pct: number;
  /** 0–1, how much of the start→finish span today has used up. */
  expected: number;
  /** Scheduled finish, local calendar day. Same convention as scheduleFinishDate. */
  finishISO: string;
}

type PaceTask = Pick<ScheduleTask, 'startDay' | 'durationDays' | 'progress' | 'status' | 'isMilestone'>;

/**
 * The PACE read, or `null` when there is no evidence to make one.
 *
 * Two gates, both required, because a verdict without them is invented:
 *  1. Work has been reported — at least one non-milestone task with progress
 *     above zero or a status of in_progress / done. The exact test
 *     utils/portalSnapshot.ts scheduleWorkComplete uses for the portal's
 *     progress bar. Without it an untouched schedule scores 0% against the
 *     elapsed calendar and reads "Behind schedule" on a job whose GC simply
 *     never updated the app — the false signal PORTAL-01 removed from the hero.
 *  2. The start date parses. Without an anchor there is no "time used up", and
 *     the old fall-through printed an unearned "On track".
 *
 * Deliberately NOT baked into the portal snapshot: a verdict frozen at publish
 * time still says "On track" weeks later. The portal page runs its own copy of
 * this against the viewer's today; scripts/validate-portal-owner.ts holds the
 * two head-to-head.
 */
export function ownerSchedulePace(input: {
  tasks: PaceTask[] | null | undefined;
  startDate?: string | null;
  workingDaysPerWeek?: number;
  nonWorkingDates?: string[];
  nowMs: number;
}): OwnerSchedulePace | null {
  const tasks = input.tasks ?? [];
  const work = tasks.filter((t) => !t.isMilestone);
  const started = work.some(
    (t) => (t.progress ?? 0) > 0 || t.status === 'in_progress' || t.status === 'done',
  );
  if (!started) return null;
  const anchor = toCalendarDate(input.startDate ?? null);
  if (!anchor) return null;
  const start = new Date(`${anchor}T00:00:00`);
  const startMs = start.getTime();
  if (!Number.isFinite(startMs)) return null;

  let maxEndDay = 1;
  for (const t of tasks) {
    const endDay = (t.startDay ?? 1) + Math.max(0, (t.durationDays ?? 1) - 1);
    if (endDay > maxEndDay) maxEndDay = endDay;
  }
  let finish: Date;
  try {
    finish = addWorkingDays(start, Math.max(0, maxEndDay - 1), input.workingDaysPerWeek ?? 5, input.nonWorkingDates);
  } catch {
    return null;
  }
  const finishMs = finish.getTime();

  const pct = computeProjectProgress({ schedule: { tasks } } as unknown as Project).pct;
  const span = finishMs - startMs;
  // A one-day job has no span to divide: before its day nothing is due, from
  // its day on all of it is.
  const expected = span > 0 ? clamp01((input.nowMs - startMs) / span) : input.nowMs >= startMs ? 1 : 0;
  const delta = pct / 100 - expected;
  const status: OwnerPaceStatus =
    pct >= 100 ? 'complete'
      : delta >= OWNER_PACE_THRESHOLDS.onTrackMinDelta ? 'on_track'
        : delta >= OWNER_PACE_THRESHOLDS.minorDelaysMinDelta ? 'minor_delays'
          : 'behind';
  return { status, pct, expected, finishISO: isoDate(finish) };
}

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

  // ── % complete — duration-weighted, milestones excluded. The same rollup as
  //    the portal's hero bar (utils/projectProgress.computeProjectProgress),
  //    so the % the GC previews is the % the homeowner reads, and the % the
  //    pace verdict below is judged on.
  let pctComplete = hasSchedule ? computeProjectProgress(project).pct : 0;
  if (isClosed) pctComplete = 100;

  // ── Projected finish — the authored finish (max task end) on the working-day
  //    calendar, matching what the Gantt shows. (CPM is analysis; the authored
  //    startDay/durationDays ARE the plan.) Anchored via toCalendarDate so a
  //    legacy full-timestamp startDate yields the same day the portal hero
  //    (scheduleFinishDate) prints, instead of no date at all.
  let projectedFinishISO: string | null = null;
  let startMs = NaN;
  const anchor = hasSchedule ? toCalendarDate(startDate ?? null) : null;
  if (anchor) {
    const start = new Date(anchor + 'T00:00:00');
    startMs = start.getTime();
    let maxEndDay = 1;
    for (const t of tasks) {
      const endDay = (t.startDay ?? 1) + Math.max(0, (t.durationDays ?? 1) - 1);
      if (endDay > maxEndDay) maxEndDay = endDay;
    }
    try {
      const finish = addWorkingDays(start, Math.max(0, maxEndDay - 1), wpw, nonWorking);
      projectedFinishISO = isoDate(finish);
    } catch {
      projectedFinishISO = null;
    }
  }

  // ── On-track status — a deterministic PACE read (ownerSchedulePace): how much
  //    is actually done vs how much SHOULD be done by today. It only speaks
  //    when it has evidence; otherwise the pill says what is missing.
  const pace = hasSchedule
    ? ownerSchedulePace({ tasks, startDate, workingDaysPerWeek: wpw, nonWorkingDates: nonWorking, nowMs })
    : null;
  let status: ConfidenceStatus;
  let statusLabel: string;
  if (isClosed) {
    status = 'complete';
    statusLabel = STATUS_LABEL.complete;
  } else if (!hasSchedule) {
    status = 'not_started';
    statusLabel = STATUS_LABEL.not_started;
  } else if (pace) {
    status = pace.status;
    statusLabel = STATUS_LABEL[pace.status];
  } else if (Number.isFinite(startMs) && nowMs < startMs) {
    // Nothing reported and the start date is still ahead — "Starting soon" is
    // a statement about the calendar, not a pace verdict, and it is true.
    status = 'not_started';
    statusLabel = STATUS_LABEL.not_started;
  } else {
    // No evidence to judge pace on. Neutral status, honest words.
    status = 'not_started';
    statusLabel = Number.isFinite(startMs) ? NO_PACE_LABEL.noProgress : NO_PACE_LABEL.noStartDate;
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
    statusLabel,
    projectedFinishISO,
    billing: { contract, approvedChanges, revisedContract, billed, paid, balance },
    nextMilestones,
    awaitingApproval,
  };
}
