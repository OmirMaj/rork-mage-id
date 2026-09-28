// ============================================================================
// utils/tomorrowBlock.ts — a "Tomorrow" answer on the schedule (UX wave,
// Lane B5).
//
// "Today shows today, Lookahead shows weeks. What's tomorrow?" TodayView gets
// a Tomorrow block: the next WORKING day (the lineup's own nextWorkingDay, so
// on a Friday on a 5-day week it is Monday, and a site closure is skipped) and
// the tasks on it, through the schedule's own calendar helpers — the same
// ones the lineup and the 6 AM brief use. It never invents a day: with no
// start date on the schedule it says so; with nothing on the day it says so
// plainly (and the Send lineup button is hidden).
//
// Pure. scripts/validate-ux-lane-b.ts runs it under bun.
// ============================================================================

import type { ProjectSchedule, ScheduleTask } from '@/types';
import { nextWorkingDay } from '@/utils/tomorrowLineup';
import {
  resolveScheduleAnchor, scheduleDayOnCalendar, isTaskActiveOnScheduleDay, isMilestoneOnScheduleDay,
} from '@/utils/scheduleOps';
import { parseCalendarDay, formatCalendarDay } from '@/utils/calendarDate';
import { t, getDisplayLang } from '@/i18n/core';
import type { DisplayLang } from '@/i18n/types';

export interface TomorrowBlock {
  /** YYYY-MM-DD of the next working day. */
  date: string;
  /** "Mon, Sep 28". */
  dayLabel: string;
  tasks: Pick<ScheduleTask, 'id' | 'title' | 'phase' | 'crew' | 'isMilestone'>[];
  /** A plain sentence when there is nothing to list (no start date, nothing
   *  scheduled); null when tasks has rows. */
  emptyNote: string | null;
  /** Show "Send lineup" only when there is something to send. */
  canSend: boolean;
}

export const TOMORROW_NOTHING = 'Nothing is scheduled on the next working day.';
export const TOMORROW_NO_START = 'This schedule has no start date, so tomorrow can’t be put on the calendar. Set the start date on the schedule.';

// The two notes in the app language (Spanish Phase 1b). The English constants
// above stay for the validators that pin them; these return them unchanged in
// English. The default is the app's current language, so a caller that passes
// nothing (TodayView, the phone schedule card) follows the app.
export function tomorrowNothingNote(lang: DisplayLang = getDisplayLang()): string {
  return t('field.lineup.tomorrowNothing', 'Nothing is scheduled on the next working day.', undefined, lang);
}
export function tomorrowNoStartNote(lang: DisplayLang = getDisplayLang()): string {
  return t('field.lineup.tomorrowNoStart', 'This schedule has no start date, so tomorrow can’t be put on the calendar. Set the start date on the schedule.', undefined, lang);
}

export function tomorrowBlock(
  schedule: Pick<ProjectSchedule, 'startDate' | 'workingDaysPerWeek' | 'nonWorkingDates' | 'tasks'> | null | undefined,
  now: Date,
  lang: DisplayLang = getDisplayLang(),
): TomorrowBlock {
  const date = nextWorkingDay(now, schedule ?? null);
  const dayLabel = formatCalendarDay(date, { weekday: 'short', month: 'short', day: 'numeric' }) || date;
  const tasks = schedule?.tasks ?? [];
  const anchor = resolveScheduleAnchor(schedule ?? null, now);
  if (!schedule || tasks.length === 0) {
    return { date, dayLabel, tasks: [], emptyNote: tomorrowNothingNote(lang), canSend: false };
  }
  if (!anchor.dated || !anchor.date) {
    return { date, dayLabel, tasks: [], emptyNote: tomorrowNoStartNote(lang), canSend: false };
  }
  const target = parseCalendarDay(date);
  const dayNumber = target
    ? scheduleDayOnCalendar(anchor.date, target, schedule.workingDaysPerWeek ?? 5, schedule.nonWorkingDates)
    : null;
  const onDay = dayNumber === null ? [] : tasks.filter(t =>
    !t.isSummary && (isTaskActiveOnScheduleDay(t, dayNumber) || isMilestoneOnScheduleDay(t, dayNumber)));
  if (onDay.length === 0) return { date, dayLabel, tasks: [], emptyNote: tomorrowNothingNote(lang), canSend: false };
  return {
    date,
    dayLabel,
    tasks: onDay.map(t => ({ id: t.id, title: t.title, phase: t.phase, crew: t.crew, isMilestone: t.isMilestone })),
    emptyNote: null,
    canSend: true,
  };
}
