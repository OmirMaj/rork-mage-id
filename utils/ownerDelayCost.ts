// utils/ownerDelayCost.ts — what a late owner decision (a change order, a
// selection) is costing, computed from HIS schedule and HIS own estimate.
//
// Pure: no React, no network, no clock — `today` ('YYYY-MM-DD') comes in.
//
// Two honesty rules this file exists to keep:
//   1. The daily site cost comes ONLY from his own General Conditions line.
//      No line → null → the screen says so. There is no default dollar figure
//      anywhere in here (app/(tabs)/schedule/index.tsx's task-detail "Schedule
//      Impact" invents one; this must never become its twin).
//   2. Units. pushesFinishDays is WORKING days (CPM totalFloat is working
//      days). So the per-day cost divides by the schedule's WORKING-day length:
//      workingDaysInSpan(1, projectFinish). runCpm's projectFinish is a
//      CALENDAR INDEX, and totalDurationDays is not guaranteed to be working
//      days — dividing by either would price a weekend as a site day.
//
// Pinned by scripts/validate-owner-delay-cost.ts.

import type { LinkedEstimateItem, Project, ProjectSchedule, ScheduleTask } from '@/types';
import { runCpm, workingDaysInSpan, type CpmResult } from '@/utils/cpm';
import { resolveScheduleAnchor, taskCalendarRange } from '@/utils/scheduleOps';
import { formatCalendarDay, toCalendarDayString } from '@/utils/calendarDate';
import { formatMoney } from '@/utils/formatters';

export interface DailySiteCost {
  cents: number;
  /** e.g. "your General Conditions line ($12,600 ÷ 60 working days)". */
  source: string;
}

const GC_LINE = /general conditions|supervision|site overhead|project management/i;

function isGcLine(i: LinkedEstimateItem): boolean {
  return GC_LINE.test(i.name ?? '') || GC_LINE.test(i.category ?? '') || String(i.csiDivision ?? '').trim() === '01';
}

function centsLabel(cents: number): string {
  return formatMoney(cents / 100, cents % 100 === 0 ? 0 : 2);
}

type ScheduleLike = Pick<ProjectSchedule, 'startDate' | 'workingDaysPerWeek' | 'nonWorkingDates' | 'tasks'>;

/** The anchor ('YYYY-MM-DD') of a schedule, or null when it has no real start. */
function anchorIso(schedule: ScheduleLike | null | undefined): string | null {
  return schedule ? resolveScheduleAnchor(schedule).iso : null;
}

function dayScale(schedule: ScheduleLike, anchor: string) {
  return {
    scheduleStartDate: anchor,
    workingDaysPerWeek: schedule.workingDaysPerWeek,
    nonWorkingDates: schedule.nonWorkingDates,
  };
}

/** runCpm with the app's day scale, or null when the engine refuses the logic
 *  (a cycle, or a link to a task that is not there). */
export function scheduleCpm(schedule: ScheduleLike | null | undefined): CpmResult | null {
  if (!schedule || !Array.isArray(schedule.tasks) || schedule.tasks.length === 0) return null;
  const anchor = anchorIso(schedule);
  const cpm = runCpm(schedule.tasks, anchor ? dayScale(schedule, anchor) : {
    workingDaysPerWeek: schedule.workingDaysPerWeek,
    nonWorkingDates: schedule.nonWorkingDates,
  });
  if (cpm.conflicts.some(c => c.kind === 'cycle' || c.kind === 'dangling_link')) return null;
  if (cpm.perTask.size === 0) return null;
  return cpm;
}

/**
 * His daily site cost: his General Conditions line(s) ÷ the schedule's length
 * in WORKING days. Null when any piece is missing — never a default.
 */
export function dailySiteCost(project: Project, cpmIn?: CpmResult | null): DailySiteCost | null {
  const items = project.linkedEstimate?.items ?? [];
  const lines = items.filter(isGcLine);
  if (lines.length === 0) return null;
  let dollars = 0;
  for (const i of lines) {
    const price = i.usesBulk ? i.bulkPrice : i.unitPrice;
    const q = Number(i.quantity);
    const p = Number(price);
    if (!Number.isFinite(q) || !Number.isFinite(p)) continue;
    dollars += q * p;
  }
  const totalCents = Math.round(dollars * 100);
  if (!(totalCents > 0)) return null;

  const schedule = project.schedule ?? null;
  const anchor = anchorIso(schedule);
  if (!schedule || !anchor) return null;
  const cpm = cpmIn === undefined ? scheduleCpm(schedule) : cpmIn;
  if (!cpm) return null;
  const workingDays = workingDaysInSpan(1, cpm.projectFinish, dayScale(schedule, anchor));
  if (!(workingDays > 0)) return null;

  const cents = Math.round(totalCents / workingDays);
  if (!(cents > 0)) return null;
  const label = lines.length === 1 ? 'your General Conditions line' : 'your General Conditions lines';
  return { cents, source: `${label} (${centsLabel(totalCents)} ÷ ${workingDays} working days)` };
}

export type DelayBasis = 'linked_task' | 'matched_by_name' | 'no_task';

export interface DelayConsequence {
  basis: DelayBasis;
  taskTitle: string | null;
  neededBy: string | null;
  pushesFinishDays: number | null;
  cents: number | null;
  text: string;
}

export const NO_TASK_TEXT = "Not linked to a schedule task — can't say what it holds up.";
export const LOGIC_ERROR_TEXT = 'Schedule has a logic error — delay not computed.';
export const NO_SITE_COST_TEXT = ' · No daily site cost on file — add a General Conditions line to see dollars.';

function wd(n: number): string {
  return `${n} working day${n === 1 ? '' : 's'}`;
}

function calIndex(anchor: string, day: string): number {
  return Math.round((Date.parse(day.slice(0, 10) + 'T00:00:00Z') - Date.parse(anchor + 'T00:00:00Z')) / 86400000) + 1;
}

/**
 * What waiting on this decision costs. Every branch says something true;
 * nothing is presented as zero when it was not computed.
 */
export function delayConsequence(a: {
  task: ScheduleTask | null;
  basis: DelayBasis;
  schedule: ScheduleLike | null;
  cpmFloatDays: number | null;
  today: string;
  site: DailySiteCost | null;
}): DelayConsequence {
  const { task, schedule, site } = a;
  if (!task || a.basis === 'no_task') {
    return { basis: 'no_task', taskTitle: null, neededBy: null, pushesFinishDays: null, cents: null, text: NO_TASK_TEXT };
  }
  const basis = a.basis;
  const title = task.title?.trim() || 'this task';
  const prefix = basis === 'matched_by_name' ? `Matched by name: ${title} — ` : '';
  const base = { basis, taskTitle: title };

  const anchor = anchorIso(schedule);
  if (!schedule || !anchor) {
    return {
      ...base, neededBy: null, pushesFinishDays: null, cents: null,
      text: `${prefix}The schedule has no start date, so MAGE can't say when ${title} is needed.`,
    };
  }
  const anchorDate = resolveScheduleAnchor(schedule).date as Date;
  const start = taskCalendarRange(
    { startDay: Math.floor(task.startDay), durationDays: 1 },
    anchorDate, schedule.workingDaysPerWeek, schedule.nonWorkingDates,
  ).start;
  const neededBy = toCalendarDayString(start);
  const label = formatCalendarDay(neededBy, { month: 'short', day: 'numeric' });

  if ((task.progress ?? 0) > 0 || task.status === 'in_progress' || task.status === 'done') {
    return { ...base, neededBy, pushesFinishDays: null, cents: null, text: `${prefix}Work already started on ${title}.` };
  }

  const today = a.today.slice(0, 10);
  const scale = dayScale(schedule, anchor);
  const late = neededBy < today ? workingDaysInSpan(calIndex(anchor, neededBy), calIndex(anchor, today) - 1, scale) : 0;
  if (late <= 0) {
    return { ...base, neededBy, pushesFinishDays: 0, cents: null, text: `${prefix}Needed by ${label} for ${title} — no delay yet.` };
  }
  if (a.cpmFloatDays == null || !Number.isFinite(a.cpmFloatDays)) {
    return { ...base, neededBy, pushesFinishDays: null, cents: null, text: `${prefix}${LOGIC_ERROR_TEXT}` };
  }
  const float = Math.max(0, Math.floor(a.cpmFloatDays));
  const pushes = Math.max(0, late - float);
  let text: string;
  if (float === 0) {
    text = `${title} is on the critical path: finish moves ${wd(pushes)}`;
  } else if (pushes === 0) {
    text = late < float
      ? `${title} has ${float} days of float — finish holds for ${float - late} more working day${float - late === 1 ? '' : 's'}`
      : `${title} had ${float} days of float, now used up — finish moves if this waits another day`;
  } else {
    text = `${title} had ${float} days of float, now used up: finish moves ${wd(pushes)}`;
  }
  let cents: number | null = null;
  if (pushes > 0) {
    if (site) {
      cents = pushes * site.cents;
      text += `, about ${centsLabel(cents)} in site costs (${site.source})`;
    } else {
      text += NO_SITE_COST_TEXT;
    }
  }
  if (!text.endsWith('.')) text += '.';
  return { ...base, neededBy, pushesFinishDays: pushes, cents, text: `${prefix}${text}` };
}

/** Everything delayConsequence needs from one project, computed once. */
export interface ProjectDelayContext {
  schedule: ProjectSchedule | null;
  cpm: CpmResult | null;
  site: DailySiteCost | null;
}

export function projectDelayContext(project: Project | undefined): ProjectDelayContext {
  const schedule = project?.schedule ?? null;
  const cpm = scheduleCpm(schedule);
  const site = project ? dailySiteCost(project, cpm) : null;
  return { schedule, cpm, site };
}

export function consequenceFor(ctx: ProjectDelayContext, task: ScheduleTask | null, basis: DelayBasis, today: string): DelayConsequence {
  const float = task && ctx.cpm ? ctx.cpm.perTask.get(task.id)?.totalFloat ?? null : null;
  return delayConsequence({ task, basis: task ? basis : 'no_task', schedule: ctx.schedule, cpmFloatDays: float, today, site: ctx.site });
}
