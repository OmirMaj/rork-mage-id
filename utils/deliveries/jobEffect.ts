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
// THE PROPOSAL, AND THE ONE RULE IT SHARES WITH THE FLAG. The flag
// (utils/deliveries/flags.supplierLateFlag) is raised when the supplier's date
// is AFTER Needed On Site By, which is the task's start stepped back the
// delivery's buffer in worked days. The proposal is the EARLIEST start that
// raises no flag for that supplier date (calendar.earliestStartFor): the first
// worked day whose own Needed On Site By is on or after the supplier's date.
// So:
//   - a supplier date that raises no flag proposes no move ('not_after_needed');
//   - the first date that raises one proposes the smallest move that clears it
//     (buffer 0: the supplier date itself; buffer 1: the worked day after it;
//     buffer 3: three worked days after it);
//   - once the proposal is applied the flag is gone, and one worked day
//     earlier it would still be raised.
// In the `after` copy the linked task gets the schedule's own "start no
// earlier than" anchor (types AnchorType 'start-no-earlier') on that day, and
// the id of the delivery it came from (ScheduleTask.anchorFromDeliveryId), so
// the hold can be found and offered for removal when the supplier's date
// later improves. Nothing else is changed; the engine works out what follows.
//
// ONE SET OF ENGINE OPTIONS. The delivery sheet and the schedule's banner both
// work the effect out through engineOptionsFor(schedule, tasks) below: the
// schedule's start, its working week and closed days, its critical-float
// setting and its per-task (resource) calendars, built the way Schedule Pro
// builds them. There is no second place the options are assembled, so the
// figures on the sheet are the figures the schedule draws.
//
// THIS FILE MOVES NOTHING. `proposedTasks` returns a COPY and never touches its
// input (the validator deep-freezes the input and runs it). No function here
// writes a project, a schedule or a delivery, and nothing in the lane applies
// the copy: the only place it can be applied is the schedule screen's own
// commit (app/schedule-pro.tsx), on the person's own tap, where Undo takes it
// back.
//
// Pure: no React, no storage, no network, no clock.
import type { ProjectSchedule, ScheduleTask } from '@/types';
import { runCpm, calendarDayToDate, type RunCpmOptions } from '@/utils/cpm';
import { resolveScheduleAnchor } from '@/utils/scheduleOps';
import { resolveCalendarForTask } from '@/utils/scheduleResourceCalendars';
import { toCalendarDayString } from '@/utils/calendarDate';
import { buildSchedulePreviewOverlay, type SchedulePreviewOverlay } from '@/utils/schedulePreviewOverlay';
import type { Delivery } from '@/utils/deliverySchedule';
import { compareDays, dayOrEmpty, earliestStartFor, workingDaysFromTo } from './calendar';
import { bufferDaysOf, neededOnSiteBy, type ScheduleForDeliveries } from './neededBy';

/**
 * The schedule's own proposal for "this task cannot start before `notBefore`",
 * marked with the delivery it came from. A COPY; the input is not touched.
 */
export function proposedTasks(tasks: readonly ScheduleTask[], taskId: string, notBefore: string, deliveryId: string): ScheduleTask[] {
  return tasks.map((t) => (t.id === taskId
    ? { ...t, anchorType: 'start-no-earlier' as const, anchorDate: notBefore, anchorFromDeliveryId: deliveryId }
    : t));
}

/** The hold a delivery's applied proposal left on the schedule: the task, and the day it is held to. Null when there is none (never applied, undone, or the person has since changed the anchor's kind). */
export function deliveryHold(tasks: readonly ScheduleTask[] | null | undefined, deliveryId: string | null | undefined): { taskId: string; taskTitle: string; notBefore: string } | null {
  if (!deliveryId || !tasks) return null;
  const t = tasks.find((x) => x && x.anchorFromDeliveryId === deliveryId && x.anchorType === 'start-no-earlier' && !!dayOrEmpty(x.anchorDate));
  return t ? { taskId: t.id, taskTitle: t.title ?? '', notBefore: dayOrEmpty(t.anchorDate) } : null;
}

/** The task list with THIS delivery's hold taken off (the anchor and its mark). A COPY; a task whose anchor is not from this delivery is left alone. */
export function releasedTasks(tasks: readonly ScheduleTask[], deliveryId: string): ScheduleTask[] {
  return tasks.map((t) => {
    if (t.anchorFromDeliveryId !== deliveryId || t.anchorType !== 'start-no-earlier') return t;
    const { anchorType: _type, anchorDate: _date, anchorFromDeliveryId: _from, ...rest } = t;
    return rest as ScheduleTask;
  });
}

/** The engine options the lane works a job effect out with: the same ones Schedule Pro passes its own engine. The ONE place they are built. */
export function engineOptionsFor(schedule: ScheduleForDeliveries, tasks: readonly ScheduleTask[], scheduleStartIso: string): RunCpmOptions {
  const full = schedule as unknown as ProjectSchedule;
  let taskCalendars: RunCpmOptions['taskCalendars'];
  for (const task of tasks) {
    if (!task.resourceIds || task.resourceIds.length === 0) continue;
    const resolved = resolveCalendarForTask(task, full);
    if (resolved.source === 'project') continue;
    (taskCalendars ??= new Map()).set(task.id, { workingDaysPerWeek: resolved.workingDaysPerWeek, closures: resolved.closures });
  }
  return {
    scheduleStartDate: scheduleStartIso,
    workingDaysPerWeek: schedule.workingDaysPerWeek ?? undefined,
    nonWorkingDates: schedule.nonWorkingDates ? [...schedule.nonWorkingDates] : undefined,
    criticalFloatThresholdDays: full.criticalFloatThresholdDays ?? 0,
    taskCalendars,
  };
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
  /** The task cannot start on its day. Every figure is "if nothing else changes". */
  | {
      kind: 'task_slides';
      taskId: string;
      taskTitle: string;
      supplierDate: string;
      neededBy: string;
      /** The delivery's buffer in worked days (the proposal is worked out with it). */
      bufferDays: number;
      taskStartWas: string;
      /** The earliest start that raises no flag for the supplier's date (calendar.earliestStartFor), as the engine then places the task. */
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
  /** Nothing can honestly be said, and why. 'not_moved' = the engine left the task where it is. */
  | { kind: 'cannot_say'; why: 'no_supplier_date' | 'no_task' | 'no_schedule' | 'schedule_undated' | 'task_removed' | 'not_after_needed' | 'cycle' | 'task_pinned' | 'task_started' | 'settled' | 'not_moved' };

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
  delivery: Pick<Delivery, 'id' | 'status' | 'taskId' | 'bufferDays' | 'expectedDate'>,
  schedule: ScheduleForDeliveries | null | undefined,
): JobEffect {
  if (delivery.status === 'delivered' || delivery.status === 'cancelled') return { kind: 'cannot_say', why: 'settled' };
  const supplierDate = dayOrEmpty(delivery.expectedDate);
  if (!supplierDate) return { kind: 'cannot_say', why: 'no_supplier_date' };
  const needed = neededOnSiteBy(delivery, schedule);
  if (needed.basis.kind !== 'task' || !schedule || !schedule.tasks) return { kind: 'cannot_say', why: needed.basis.kind === 'none' ? needed.basis.why : 'no_schedule' };
  // THE FLAG RULE: no flag, no proposal.
  if (compareDays(supplierDate, needed.date) !== 1) return { kind: 'cannot_say', why: 'not_after_needed' };

  const { taskId, taskTitle, taskStart, bufferDays } = needed.basis;
  // The earliest start that raises no flag for this supplier date: the same rule, turned round.
  const earliest = earliestStartFor(supplierDate, bufferDays, schedule);
  if (!earliest) return { kind: 'cannot_say', why: 'no_schedule' };
  if ((compareDays(earliest, taskStart) ?? 1) <= 0) return { kind: 'cannot_say', why: 'not_moved' };

  const before = schedule.tasks as ScheduleTask[];
  const task = before.find((t) => t.id === taskId);
  if (!task) return { kind: 'cannot_say', why: 'task_removed' };
  if (hasStarted(task)) return { kind: 'cannot_say', why: 'task_started' };
  if (task.anchorType && BLOCKING_ANCHORS.has(task.anchorType)) return { kind: 'cannot_say', why: 'task_pinned' };

  const anchor = resolveScheduleAnchor(schedule);
  if (!anchor.dated || !anchor.date || !anchor.iso) return { kind: 'cannot_say', why: 'schedule_undated' };
  const options = engineOptionsFor(schedule, before, anchor.iso);
  const after = proposedTasks(before, taskId, earliest, delivery.id);
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
  // The engine did not move the task after all (something else already holds it later).
  if (!linked) return { kind: 'cannot_say', why: 'not_moved' };

  const finishWas = day(overlay.finishBefore);
  const finishNow = day(overlay.finishAfter);
  return {
    kind: 'task_slides',
    taskId,
    taskTitle,
    supplierDate,
    neededBy: needed.date,
    bufferDays,
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

/** What can be said about a hold this delivery's applied proposal left on the schedule. */
export type HoldRelease =
  /** No hold from this delivery is on the schedule. */
  | { kind: 'none' }
  /** The hold is there and the supplier's date still needs it (or there is no supplier date to judge by). */
  | { kind: 'held'; taskId: string; taskTitle: string; heldTo: string }
  /**
   * The hold is there and the supplier's date has IMPROVED: the earliest start
   * its date needs now is before the day the task is held to. Removing the hold
   * is offered, as a press on the schedule screen. `overlay` is the schedule's
   * own preview of the task list without the hold.
   */
  | { kind: 'can_release'; taskId: string; taskTitle: string; heldTo: string; supplierDate: string; neededStart: string; overlay: SchedulePreviewOverlay | null };

/**
 * Whether the hold this delivery left on its task can come off. Worked out on
 * every read; it changes nothing. The hold is NEVER removed from here: the
 * only place is the schedule screen's own commit, on the person's press.
 */
export function holdRelease(
  delivery: Pick<Delivery, 'id' | 'status' | 'bufferDays' | 'expectedDate'>,
  schedule: ScheduleForDeliveries | null | undefined,
): HoldRelease {
  const tasks = (schedule?.tasks ?? null) as readonly ScheduleTask[] | null;
  const hold = deliveryHold(tasks, delivery.id);
  if (!hold || !schedule || !tasks) return { kind: 'none' };
  const held: HoldRelease = { kind: 'held', taskId: hold.taskId, taskTitle: hold.taskTitle, heldTo: hold.notBefore };
  const supplierDate = dayOrEmpty(delivery.expectedDate);
  if (!supplierDate || delivery.status === 'cancelled') return held;
  const neededStart = earliestStartFor(supplierDate, bufferDaysOf(delivery), schedule);
  if (!neededStart || (compareDays(neededStart, hold.notBefore) ?? 0) >= 0) return held;
  let overlay: SchedulePreviewOverlay | null = null;
  const anchor = resolveScheduleAnchor(schedule);
  if (anchor.dated && anchor.iso) {
    const before = tasks as ScheduleTask[];
    const after = releasedTasks(before, delivery.id);
    const options = engineOptionsFor(schedule, before, anchor.iso);
    const cpmBefore = runCpm(before, options);
    const cpmAfter = runCpm(after, options);
    if (!cpmBefore.conflicts.some((c) => c.kind === 'cycle') && !cpmAfter.conflicts.some((c) => c.kind === 'cycle')) {
      overlay = buildSchedulePreviewOverlay(before, after, cpmBefore, cpmAfter);
    }
  }
  return { kind: 'can_release', taskId: hold.taskId, taskTitle: hold.taskTitle, heldTo: hold.notBefore, supplierDate, neededStart, overlay };
}
