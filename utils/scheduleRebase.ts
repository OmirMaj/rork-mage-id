// scheduleRebase.ts — re-anchor a "raw day-index" schedule onto a working-day
// calendar when the user first sets an explicit start date.
//
// Background: schedules created without a startDate run the CPM engine in
// raw-day mode (every day counts, `ef = es + dur - 1`). Their task startDay
// values are effectively WORKING-DAY ORDINALS — "the Nth day of work". When a
// start date is later assigned, the engine flips to calendar mode (weekends /
// closures stop counting), so those same indices silently reinterpret as
// calendar days and every multi-day chain inflates — the finish-day jump bug
// (33 → 43 on a 20-task schedule, diagnosed live 2026-07-12).
//
// This helper converts each task's startDay from working-day ordinal to the
// matching calendar day index so the plan's shape survives the transition:
// raw day N → the calendar index of the Nth working day on/after the start
// date. Durations are already working-day counts in calendar mode, so they
// pass through untouched.
//
// Pure — no I/O, no mutation. Callers route the result through the
// undo-aware commit() so the re-anchor is a single undoable step.

import type { ScheduleTask } from '@/types';
import { isWorkingDay } from '@/utils/cpm';

export function rebaseRawToCalendar(
  tasks: ScheduleTask[],
  startDateIso: string,
  workingDaysPerWeek: number,
  nonWorkingDates?: string[],
): ScheduleTask[] {
  if (tasks.length === 0) return tasks;
  // Unparseable start date → isWorkingDay is permissive (every day works),
  // making the mapping the identity. Bail early with the same array so
  // commit()'s same-ref check treats this as a no-op.
  if (!Number.isFinite(Date.parse(startDateIso + 'T00:00:00Z'))) return tasks;

  const closures = new Set(nonWorkingDates ?? []);
  const maxOrdinal = Math.max(
    ...tasks.map(t => Math.max(1, Math.round(t.startDay || 1))),
  );

  // ordinalToDay[N] = calendar day index of the Nth working day (1-based).
  // With wdpw >= 5 the Nth working day sits at most ~N*7/5 calendar days out;
  // the hard stop adds a full year of closures on top. Hitting it means the
  // calendar is corrupt (e.g. every day closed) — identity-map rather than spin.
  const ordinalToDay: number[] = [0];
  const HARD_STOP = maxOrdinal * 7 + 366;
  let day = 0;
  while (ordinalToDay.length <= maxOrdinal) {
    day++;
    if (day > HARD_STOP) return tasks;
    if (isWorkingDay(day, workingDaysPerWeek, startDateIso, closures)) {
      ordinalToDay.push(day);
    }
  }

  let changed = false;
  const next = tasks.map(t => {
    const ordinal = Math.max(1, Math.round(t.startDay || 1));
    const mapped = ordinalToDay[ordinal];
    if (mapped === t.startDay) return t;
    changed = true;
    return { ...t, startDay: mapped };
  });
  return changed ? next : tasks;
}
