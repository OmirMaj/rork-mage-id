// utils/pace/stampActuals.ts — as-built capture on status transitions.
//
// The pace flywheel's intake valve: BEFORE this, actuals were only set by the
// Gantt's manual "Start today"/"Finish today" buttons
// (components/schedule/InteractiveGantt.tsx logStartToday/logFinishToday) —
// ~5% coverage. This helper mirrors those buttons' semantics (including the
// retro-start rule: finishing an unstarted task back-fills actualStartDay
// from the PLANNED startDay) so that ANY status change captures the same
// data. Rules:
//   → in_progress, start uncaptured: stamp actualStartDay/-Date
//   → in_progress FROM done:         also CLEAR actualEndDay/-Date — the task
//                                    is demonstrably not finished, so the old
//                                    end stamp is wrong; a later re-completion
//                                    re-stamps a fresh end.
//   → done, end uncaptured:          stamp actualEndDay/-Date
//                                    (+ retro-stamp start from the PLANNED
//                                    startDay if uncaptured, capped at today
//                                    so the pair can never invert)
//   → not_started FROM done:         clear ALL four actuals — a full reopen
//                                    means the whole record was a mistake.
//   anything else, or already captured: {} — NEVER overwrite real history.
// The manual Gantt buttons stay authoritative: sinks merge explicit patch
// values OVER this stamp, and stampActuals no-ops on already-captured tasks.
//
// Day-number basis: `todayDayNumber` MUST come from todayScheduleDay(
// schedule.startDate) — the single shared basis (see below). When it is null
// (schedule has no parseable startDate) there IS no day-number basis: we
// stamp ONLY the ISO date fields and never invent day numbers. A constant
// fallback (1) or a createdAt-elapsed fallback would both be poison samples
// for the pace book, on a basis no task.startDay shares.
//
// Pure — no storage, no Date.now() (callers pass todayDayNumber + nowISO).
import type { ScheduleTask, TaskStatus } from '@/types';

export interface StampOptions {
  /**
   * Whether a task finishing with NO captured start may back-fill its start
   * from the PLANNED startDay. Default true, which preserves the Gantt
   * buttons' behaviour exactly.
   *
   * The DFR path passes FALSE, and the reason is the pace book. Daily reports
   * are filed daily, so a task jumping 0 → 100 in one report almost always
   * means it started and finished inside that reporting day — not that it ran
   * from its planned start. Back-filling the plan there would hand the pace
   * book a span it invented, and utils/pace/paceBook measures duration as the
   * inclusive span between the two stamps. The book would then learn its own
   * plan back and report low variability for it, which is worse than learning
   * nothing: a confident wrong number outranks an honest gap.
   *
   * With this false, an unobserved start is simply never stamped, the task is
   * skipped by the pace book (it requires BOTH day numbers), and the schedule
   * keeps only what the field actually evidenced.
   */
  retroStartFromPlanned?: boolean;
}

export function stampActuals(
  task: Pick<ScheduleTask, 'status' | 'startDay' | 'actualStartDay' | 'actualEndDay' | 'actualStartDate' | 'actualEndDate'>,
  newStatus: TaskStatus,
  todayDayNumber: number | null,
  nowISO: string,
  opts: StampOptions = {},
): Partial<ScheduleTask> {
  const retroStart = opts.retroStartFromPlanned !== false;
  if (newStatus === task.status) return {};
  const leavingDone = task.status === 'done';
  // "Captured" = either representation exists. A date-only capture (from a
  // null-basis stamp) must not get a day number invented for it later — the
  // real start/finish was whenever the date says, not today.
  const startCaptured = task.actualStartDay != null || task.actualStartDate != null;
  const endCaptured = task.actualEndDay != null || task.actualEndDate != null;

  if (newStatus === 'in_progress') {
    const patch: Partial<ScheduleTask> = {};
    if (leavingDone) {
      // Reopening a finished task: clearing the wrong end stamp is not
      // "overwriting history" — it lets the eventual re-completion stamp
      // the REAL finish instead of no-oping on the stale one.
      patch.actualEndDay = undefined;
      patch.actualEndDate = undefined;
    }
    if (!startCaptured) {
      if (todayDayNumber != null) patch.actualStartDay = todayDayNumber;
      patch.actualStartDate = nowISO;
    }
    return patch;
  }

  if (newStatus === 'done') {
    if (endCaptured) return {};
    const patch: Partial<ScheduleTask> = {};
    if (todayDayNumber != null) patch.actualEndDay = todayDayNumber;
    patch.actualEndDate = nowISO;
    if (!startCaptured && retroStart) {
      // Mirror the Gantt's logFinishToday: back-fill the start from the PLAN,
      // not from today — finishing day is rarely the starting day. Capped at
      // today so a task finished AHEAD of its planned start can never stamp
      // an inverted pair (actualStartDay > actualEndDay).
      if (todayDayNumber != null) patch.actualStartDay = Math.min(task.startDay, todayDayNumber);
      patch.actualStartDate = nowISO;
    }
    return patch;
  }

  if (newStatus === 'not_started' && leavingDone) {
    return {
      actualStartDay: undefined,
      actualStartDate: undefined,
      actualEndDay: undefined,
      actualEndDate: undefined,
    };
  }

  return {};
}

/**
 * Today's 1-indexed schedule day number — THE single stamping basis, shared
 * by every status sink. Matches the day-index semantics of utils/cpm.ts
 * (isoToDay: day 1 = schedule.startDate, calendar-day indexing) and the
 * InteractiveGantt today line (daysBetween(projectStartDate, now) + 1),
 * clamped to >= 1.
 *
 * Returns null when the schedule has no parseable startDate: there is no
 * day-number basis then, and callers must stamp ISO dates only (stampActuals
 * does this automatically when passed null).
 *
 * DST-safe: both endpoints are normalized to local midnight and the delta is
 * ROUNDED (not floored), so the ±1h skew across a spring-forward transition
 * cannot land the day number one short during the 00:00–01:00 window.
 */
export function todayScheduleDay(scheduleStartDate: string | undefined, now: Date = new Date()): number | null {
  if (!scheduleStartDate) return null;
  const start = new Date(scheduleStartDate + 'T00:00:00');
  if (Number.isNaN(start.getTime())) return null;
  start.setHours(0, 0, 0, 0);
  const today = new Date(now.getTime());
  today.setHours(0, 0, 0, 0);
  return Math.max(1, Math.round((today.getTime() - start.getTime()) / 86400000) + 1);
}
