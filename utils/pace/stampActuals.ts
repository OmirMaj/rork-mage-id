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
// schedule.startDate) — the single shared basis (see below).
//
// ONE SCALE FOR actualStartDay / actualEndDay: the CALENDAR index (day 1 =
// schedule.startDate, every calendar day advances it by one — the same unit as
// runCpm's es/ef and the Gantt axis). Decided 2026-09-18 (audit #50). The field
// used to carry two scales depending on who wrote it: every status sink and the
// daily report stamped a calendar index, while the Gantt's Start/Finish-today
// buttons wrote a WORKING ordinal and its badge read the field as one. A task
// the foreman finished on its planned day read "+10d late" on the web six weeks
// in. Calendar won because nearly every writer (the four status sinks, the DFR
// in ProjectContext, the AI as-built parser) and most readers (paceBook,
// subScorecard, subNetwork, gradePace, planCatchUpToToday, scheduleHealthScore)
// already used it; the Gantt, reflowFromActuals and gradeDelayRipple were the
// outliers and now convert with calendarIndexToWorkingOrdinal where they
// compare against a working-ordinal plan (asBuiltVariance below).
// scripts/validate-schedule-scale-actuals.ts pins both writers to this scale. When it is null
// (schedule has no parseable startDate) there IS no day-number basis: we
// stamp ONLY the ISO date fields and never invent day numbers. A constant
// fallback (1) or a createdAt-elapsed fallback would both be poison samples
// for the pace book, on a basis no task.startDay shares.
//
// Pure — no storage, no Date.now() (callers pass todayDayNumber + nowISO).
import type { ScheduleTask, TaskStatus } from '@/types';
import {
  calendarIndexToWorkingOrdinal, workingOrdinalToCalendarIndex, type DayScaleOptions,
} from '@/utils/cpm';

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
  /**
   * The schedule's calendar. The retro start reads the PLANNED startDay, a
   * WORKING ordinal, and stamps it into a CALENDAR-index field, so it has to be
   * converted first — without it a planned day 30 on a 5-day week would be
   * stamped as calendar day 30 (six weeks in, about two weeks early). Omitted,
   * the two scales coincide (7-day week, no closures).
   */
  calendar?: DayScaleOptions;
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
      // an inverted pair (actualStartDay > actualEndDay). Floored at day 1:
      // day numbers are 1-indexed (todayScheduleDay), but tasks older mobile
      // builds created are 0-indexed, and a retro start of 0 is a day that does
      // not exist — the field RPC refuses it (actualStartDay ≥ 1) and fails
      // the foreman's whole save with a message he cannot act on.
      // A task with no usable planned start falls back to today (NaN would
      // otherwise pass straight through both Math calls).
      // The planned startDay is a WORKING ordinal; convert it to the calendar
      // index this field holds before comparing it with today (the old
      // Math.min(ordinal, calendar) only worked because the calendar value is
      // always the larger one).
      //
      // No actualStartDate here (audit #141): nobody observed this start, and
      // an ISO "now" beside a planned day number was two different inventions
      // in one record — the follow-up engine aged its item from today while its
      // evidence cited the planned day. The day number alone is the documented
      // Gantt rule; the date stays empty. startCaptured treats either field as
      // captured, so later stamping is unchanged.
      // Every app sink now passes retroStartFromPlanned:false, so this branch
      // is only the documented default for a caller that asks for it.
      if (todayDayNumber != null) {
        const plannedOrdinal = Number.isFinite(task.startDay) ? task.startDay : null;
        const planned = plannedOrdinal != null
          ? workingOrdinalToCalendarIndex(Math.max(1, plannedOrdinal), opts.calendar)
          : todayDayNumber;
        patch.actualStartDay = Math.max(1, Math.min(planned, todayDayNumber));
      }
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
 * Today's 1-indexed schedule day number, as a CALENDAR index — THE single
 * stamping basis for actualStartDay/actualEndDay, shared by every status sink
 * and the Gantt's Start/Finish-today buttons. It is NOT a working ordinal:
 * never write it into startDay/durationDays/baseline fields (convert with
 * calendarIndexToWorkingOrdinal — scheduleOps.planCatchUpToToday shows how). Matches the day-index semantics of utils/cpm.ts
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

// ─── The Gantt's manual as-built buttons, as pure patches ───────────────────
// components/schedule/InteractiveGantt.tsx logStartToday / logFinishToday call
// these, so the Gantt and every status sink stamp through ONE module on ONE
// scale (the calendar index above), and the validator can run the real code.

// `todayDayNumber` is todayScheduleDay(schedule.startDate) — null on an
// UNDATED schedule. Then, exactly like stampActuals with a null basis, only
// the ISO date and the status are written: there is no day 1 to count from,
// and a day number counted from a display fallback would be invented.

/** "Start today": the start is observed now. Manual = authoritative. */
export function ganttLogStartPatch(
  task: Pick<ScheduleTask, 'status'>,
  todayDayNumber: number | null,
  nowISO: string,
): Partial<ScheduleTask> {
  const patch: Partial<ScheduleTask> = {
    actualStartDate: nowISO,
    status: task.status === 'not_started' ? 'in_progress' : task.status,
  };
  if (todayDayNumber != null) patch.actualStartDay = Math.max(1, Math.round(todayDayNumber));
  return patch;
}

/**
 * "Finish today". Stamps the finish only. It used to back-fill a missing start
 * with the planned startDay (an ordinal, in a calendar field) plus an ISO date
 * of NOW — a start nobody saw, recorded two different ways (audit #141). An
 * unobserved start now stays empty, as it does on every status path.
 */
export function ganttLogFinishPatch(
  todayDayNumber: number | null,
  nowISO: string,
): Partial<ScheduleTask> {
  const patch: Partial<ScheduleTask> = {
    actualEndDate: nowISO,
    status: 'done',
    progress: 100,
  };
  if (todayDayNumber != null) patch.actualEndDay = Math.max(1, Math.round(todayDayNumber));
  return patch;
}

export interface AsBuiltVariance {
  label: string;
  /** Working days; +N late, −N early, 0 on time. */
  days: number;
  tone: 'late' | 'early' | 'on_time' | 'started_late';
}

/**
 * The as-built badge. Actuals are CALENDAR indices; the plan it is compared
 * with (baseline, or the CPM row expressed back as ordinals) is WORKING
 * ordinals — so the actual is converted, and the difference is a working-day
 * count, the unit the label claims. Subtracting the raw calendar actual from
 * an ordinal plan was the "+10d late on an on-time task" bug (audit #50).
 */
export function asBuiltVariance(
  actual: { actualStartDay?: number; actualEndDay?: number },
  planStartOrdinal: number,
  planEndOrdinal: number,
  calendar: DayScaleOptions,
): AsBuiltVariance | null {
  const toOrd = (c: number) => calendarIndexToWorkingOrdinal(c, calendar);
  if (actual.actualEndDay != null) {
    const v = toOrd(actual.actualEndDay) - planEndOrdinal;
    if (v > 0) return { label: `+${v}d late`, days: v, tone: 'late' };
    if (v < 0) return { label: `${v}d early`, days: v, tone: 'early' };
    return { label: 'on time', days: 0, tone: 'on_time' };
  }
  if (actual.actualStartDay != null) {
    const v = toOrd(actual.actualStartDay) - planStartOrdinal;
    if (v > 0) return { label: `started +${v}d`, days: v, tone: 'started_late' };
    if (v < 0) return { label: `started ${v}d early`, days: v, tone: 'early' };
    return { label: 'started on time', days: 0, tone: 'on_time' };
  }
  return null;
}
