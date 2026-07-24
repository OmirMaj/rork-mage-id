// utils/pace/stampActuals.ts — as-built capture on status transitions.
//
// The pace flywheel's intake valve: BEFORE this, actuals were only set by the
// Gantt's manual "Start today"/"Finish today" buttons
// (components/schedule/InteractiveGantt.tsx logStartToday/logFinishToday) —
// ~5% coverage. This helper mirrors those buttons' semantics (including the
// retro-start rule: finishing an unstarted task back-fills actualStartDay
// from the PLANNED startDay) so that ANY status change captures the same
// data. Rules:
//   → in_progress, start unset:  stamp actualStartDay/-Date
//   → done, end unset:           stamp actualEndDay/-Date
//                                (+ retro-stamp start from task.startDay if unset)
//   anything else, or already stamped: {} — NEVER overwrite, NEVER clear.
// The manual Gantt buttons stay authoritative: sinks merge explicit patch
// values OVER this stamp, and stampActuals no-ops on already-stamped tasks.
//
// Pure — no storage, no Date.now() (callers pass todayDayNumber + nowISO).
import type { ScheduleTask, TaskStatus } from '@/types';

export function stampActuals(
  task: Pick<ScheduleTask, 'status' | 'startDay' | 'actualStartDay' | 'actualEndDay'>,
  newStatus: TaskStatus,
  todayDayNumber: number,
  nowISO: string,
): Partial<ScheduleTask> {
  if (newStatus === task.status) return {};
  if (newStatus === 'in_progress') {
    if (task.actualStartDay != null) return {};
    return { actualStartDay: todayDayNumber, actualStartDate: nowISO };
  }
  if (newStatus === 'done') {
    if (task.actualEndDay != null) return {};
    const patch: Partial<ScheduleTask> = { actualEndDay: todayDayNumber, actualEndDate: nowISO };
    if (task.actualStartDay == null) {
      // Mirror the Gantt's logFinishToday: back-fill the start from the PLAN,
      // not from today — finishing day is rarely the starting day.
      patch.actualStartDay = task.startDay;
      patch.actualStartDate = nowISO;
    }
    return patch;
  }
  return {};
}

/**
 * Today's 1-indexed schedule day number — the InteractiveGantt basis
 * (daysBetween(projectStartDate, now) + 1 with a midnight anchor), clamped
 * to >= 1 like schedule-pro's own todayDayNumber memo. Callers that already
 * hold that memo (schedule-pro) keep using it; everyone else uses this.
 */
export function todayDayNumberFrom(scheduleStartDate: string | undefined, now: Date = new Date()): number {
  if (!scheduleStartDate) return 1;
  const parsed = Date.parse(scheduleStartDate + 'T00:00:00');
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.floor((now.getTime() - parsed) / 86400000) + 1);
}
