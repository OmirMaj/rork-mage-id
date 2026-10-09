// utils/deliveries/jobEffect.ts — what a supplier date AFTER Needed On Site By
// does to the job, "if nothing else changes" (lane DELIVERIES-1).
//
// IT REUSES THE SCHEDULE'S OWN PROPOSED-CHANGE PREVIEW. The schedule can
// already draw a proposal before it is applied: dashed outlines where bars
// would move to and a "Finish +7d" marker (utils/schedulePreviewOverlay.ts
// buildSchedulePreviewOverlay, drawn by components/schedule/InteractiveGantt).
// This file builds the SAME object the copilot's review builds
// (components/copilot/ScheduleDiffView): a `before` task list, an `after` task
// list, one engine run on each, both handed to buildSchedulePreviewOverlay.
// The numbers on the delivery sheet and the bars on the schedule come from
// that one overlay.
//
// THE PROPOSAL. In the `after` copy the linked task gets the schedule's own
// "start no earlier than" anchor (types AnchorType 'start-no-earlier') on the
// first worked day after the supplier's date. Nothing else is changed; the
// engine works out what follows.
//
// THIS FILE MOVES NOTHING. `proposedTasks` returns a COPY and never touches its
// input (the validator deep-freezes the input and runs it). No function here
// writes a project, a schedule or a delivery, and nothing in the lane applies
// the copy: the only place it can be applied is the schedule screen's own
// commit (app/schedule-pro.tsx), on the person's own tap, where Undo takes it
// back.
//
// Pure: no React, no storage, no network, no clock.
import type { ScheduleTask } from '@/types';
import { runCpm, calendarDayToDate } from '@/utils/cpm';
import { resolveScheduleAnchor } from '@/utils/scheduleOps';
import { toCalendarDayString } from '@/utils/calendarDate';
import { buildSchedulePreviewOverlay, type SchedulePreviewOverlay } from '@/utils/schedulePreviewOverlay';
import type { Delivery } from '@/utils/deliverySchedule';
import { compareDays, dayOrEmpty, nextWorkedDayAfter, workingDaysFromTo } from './calendar';
import { neededOnSiteBy, type ScheduleForDeliveries } from './neededBy';

/** The schedule's own proposal for "this task cannot start before `notBefore`". A COPY; the input is not touched. */
export function proposedTasks(tasks: readonly ScheduleTask[], taskId: string, notBefore: string): ScheduleTask[] {
  return tasks.map((t) => (t.id === taskId ? { ...t, anchorType: 'start-no-earlier' as const, anchorDate: notBefore } : t));
}

export interface SlidTask {
  id: string;
  title: string;
  startWas: string;
  startNow: string;
  finishWas: string;
  finishNow: string;
  /** Working days later its start is (negative = earlier). */
  workingDaysLater: number;
}

export type JobEffect =
  /** The supplier's date is after Needed On Site By but the task can still start on its day (the load lands inside the buffer). */
  | { kind: 'start_holds'; taskId: string; taskTitle: string; taskStart: string; supplierDate: string; neededBy: string }
  /** The task cannot start on its day. Every figure is "if nothing else changes". */
  | {
      kind: 'task_slides';
      taskId: string;
      taskTitle: string;
      supplierDate: string;
      neededBy: string;
      taskStartWas: string;
      /** The first worked day after the supplier's date. */
      taskStartEarliest: string;
      taskSlipWorkingDays: number;
      finishWas: string;
      finishNow: string;
      /** Working days the finish date moves (0 = the slip is inside the float). */
      finishDeltaWorkingDays: number;
      /** The linked task itself, as it would slide. */
      linked: SlidTask;
      /** Every OTHER task that would move, in schedule order. */
      slides: SlidTask[];
      /** The schedule's own preview object, for the schedule to draw. */
      overlay: SchedulePreviewOverlay;
      /** The proposal the schedule screen may show: this task, no earlier than this day. */
      proposal: { taskId: string; notBefore: string };
    }
  /** Nothing can honestly be said, and why. */
  | { kind: 'cannot_say'; why: 'no_supplier_date' | 'no_task' | 'no_schedule' | 'schedule_undated' | 'task_removed' | 'not_after_needed' | 'cycle' | 'task_pinned' | 'task_started' | 'settled' };

/** Anchors that already pin or cap the task: a second rule on top would fight the person's own. */
const BLOCKING_ANCHORS = new Set(['start-no-later', 'finish-no-later', 'must-start-on', 'must-finish-on']);

function hasStarted(t: ScheduleTask): boolean {
  return t.status === 'in_progress' || t.status === 'done' || (t.progress ?? 0) > 0 || !!t.actualStartDate || typeof t.actualStartDay === 'number';
}

/**
 * The job effect of this delivery's supplier date, from today's schedule.
 * Worked out on every read; nothing is kept and nothing is changed.
 */
export function supplierJobEffect(
  delivery: Pick<Delivery, 'status' | 'taskId' | 'bufferDays' | 'expectedDate'>,
  schedule: ScheduleForDeliveries | null | undefined,
): JobEffect {
  if (delivery.status === 'delivered' || delivery.status === 'cancelled') return { kind: 'cannot_say', why: 'settled' };
  const supplierDate = dayOrEmpty(delivery.expectedDate);
  if (!supplierDate) return { kind: 'cannot_say', why: 'no_supplier_date' };
  const needed = neededOnSiteBy(delivery, schedule);
  if (needed.basis.kind !== 'task' || !schedule || !schedule.tasks) return { kind: 'cannot_say', why: needed.basis.kind === 'none' ? needed.basis.why : 'no_schedule' };
  if (compareDays(supplierDate, needed.date) !== 1) return { kind: 'cannot_say', why: 'not_after_needed' };

  const { taskId, taskTitle, taskStart } = needed.basis;
  const earliest = nextWorkedDayAfter(supplierDate, schedule);
  if (!earliest) return { kind: 'cannot_say', why: 'no_schedule' };
  // The first worked day after the supplier's date is on or before the task's own start: the start holds.
  if ((compareDays(earliest, taskStart) ?? 1) <= 0) {
    return { kind: 'start_holds', taskId, taskTitle, taskStart, supplierDate, neededBy: needed.date };
  }

  const before = schedule.tasks as ScheduleTask[];
  const task = before.find((t) => t.id === taskId);
  if (!task) return { kind: 'cannot_say', why: 'task_removed' };
  if (hasStarted(task)) return { kind: 'cannot_say', why: 'task_started' };
  if (task.anchorType && BLOCKING_ANCHORS.has(task.anchorType)) return { kind: 'cannot_say', why: 'task_pinned' };

  const anchor = resolveScheduleAnchor(schedule);
  if (!anchor.dated || !anchor.date || !anchor.iso) return { kind: 'cannot_say', why: 'schedule_undated' };
  const options = {
    scheduleStartDate: anchor.iso,
    workingDaysPerWeek: schedule.workingDaysPerWeek ?? undefined,
    nonWorkingDates: schedule.nonWorkingDates ? [...schedule.nonWorkingDates] : undefined,
  };
  const after = proposedTasks(before, taskId, earliest);
  const cpmBefore = runCpm(before, options);
  const cpmAfter = runCpm(after, options);
  if (cpmBefore.conflicts.some((c) => c.kind === 'cycle') || cpmAfter.conflicts.some((c) => c.kind === 'cycle')) return { kind: 'cannot_say', why: 'cycle' };

  const overlay = buildSchedulePreviewOverlay(before, after, cpmBefore, cpmAfter);
  const day = (index: number) => toCalendarDayString(calendarDayToDate(anchor.date as Date, index));
  const titleOf = new Map(before.map((t) => [t.id, t.title ?? ''] as const));
  const order = new Map(before.map((t, i) => [t.id, i] as const));
  const slid: SlidTask[] = overlay.moved
    .map((m) => {
      const startWas = day(m.fromEs);
      const startNow = day(m.toEs);
      return {
        id: m.id,
        title: titleOf.get(m.id) ?? '',
        startWas,
        startNow,
        finishWas: day(m.fromEf),
        finishNow: day(m.toEf),
        workingDaysLater: workingDaysFromTo(startWas, startNow, schedule) ?? 0,
      };
    })
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const linked = slid.find((s) => s.id === taskId);
  // The engine did not move the task after all (an anchor of its own already holds it later).
  if (!linked) return { kind: 'start_holds', taskId, taskTitle, taskStart, supplierDate, neededBy: needed.date };

  const finishWas = day(overlay.finishBefore);
  const finishNow = day(overlay.finishAfter);
  return {
    kind: 'task_slides',
    taskId,
    taskTitle,
    supplierDate,
    neededBy: needed.date,
    taskStartWas: linked.startWas,
    taskStartEarliest: linked.startNow,
    taskSlipWorkingDays: linked.workingDaysLater,
    finishWas,
    finishNow,
    finishDeltaWorkingDays: workingDaysFromTo(finishWas, finishNow, schedule) ?? 0,
    linked,
    slides: slid.filter((s) => s.id !== taskId),
    overlay,
    proposal: { taskId, notBefore: earliest },
  };
}
