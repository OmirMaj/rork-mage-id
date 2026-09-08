// utils/contractTimelineCore.ts — the React-Native-free half of the contract's
// start date + duration.
//
// CONTRACT-TIME-1 (audit 2026-09-07, "worth doing" #16). `start_date` and
// `duration_days` are real columns on project_contracts, they round-trip
// through rowToContract and saveContract, and both constructors set them to
// `undefined` — because nothing captured them and nothing read them. Meanwhile
// DEFAULT_TERMS clause 7 binds a change of TIMELINE to a written Change Order
// for a timeline the document never states, and several states require a start
// date and a completion date on a residential contract at all.
//
// CALENDAR DAYS, not working days. "Substantial completion within N days of
// commencement" is the clause a homeowner and a judge read, and neither of
// them applies the GC's 5-day week to it. `suggestContractTimeline` does the
// working→calendar conversion openly rather than shipping the schedule's
// working-day count into a binding document under a calendar-day label.
//
// WHY THIS FILE EXISTS SEPARATELY FROM utils/contractEngine.ts: contractEngine
// imports @/lib/supabase, so bun cannot parse it and no guard can EXECUTE its
// arithmetic — and a completion date on a signed contract is not something to
// pin by regex. Same reason utils/billingFlowCore.ts and utils/alertCore.ts
// exist. NOTHING here may import react-native, expo-*, @/lib/supabase, or
// anything that transitively does.

import { parseCalendarDay, toCalendarDayString, formatCalendarDay } from '@/utils/calendarDate';
import { addWorkingDays } from '@/utils/scheduleEngine';
import type { Project } from '@/types';

export interface ContractTimeline {
  /** YYYY-MM-DD. */
  startDate: string;
  /** Calendar days INCLUSIVE of the start date — day 1 is the start. */
  durationDays: number;
  /** YYYY-MM-DD of substantial completion. */
  completionDate: string;
  /** 'Mar 2, 2026'. */
  startLabel: string;
  /** 'Jun 29, 2026'. */
  completionLabel: string;
}

/**
 * Resolve a stored start date + duration into the dates a contract states.
 *
 * Returns null when either half is missing or nonsense — a half-stated
 * timeline is not a timeline, and a document must never print a completion
 * date derived from a blank. A zero, negative or non-numeric duration is
 * nonsense too: the duration input is free text.
 */
export function contractTimeline(startDate?: string, durationDays?: number): ContractTimeline | null {
  const start = parseCalendarDay(startDate);
  if (!start) return null;
  if (typeof durationDays !== 'number' || !Number.isFinite(durationDays) || durationDays < 1) return null;
  const days = Math.round(durationDays);
  // INCLUSIVE: a 1-day job starts and finishes the same day, so the offset is
  // days - 1. Off by one here is a wrong completion date on a signed contract.
  const end = new Date(start);
  end.setDate(end.getDate() + days - 1);
  const completionDate = toCalendarDayString(end);
  return {
    startDate: toCalendarDayString(start),
    durationDays: days,
    completionDate,
    startLabel: formatCalendarDay(toCalendarDayString(start)),
    completionLabel: formatCalendarDay(completionDate),
  };
}

/**
 * The timeline sentence for a client-facing document — the contract screen,
 * the email that carries the portal link, and (when it is wired) the sealed
 * PDF. One sentence, one source, so the three cannot state different dates.
 */
export function contractTimelineSentence(t: ContractTimeline): string {
  return `Work commences on ${t.startLabel} and reaches substantial completion within ${t.durationDays} calendar days — on or before ${t.completionLabel}. Any change to this timeline requires a written Change Order signed by both parties.`;
}

export interface ContractTimelineSuggestion extends ContractTimeline {
  /** What this was derived from, shown to the GC BEFORE he accepts it. */
  basis: string;
}

/**
 * Offer a timeline from the project's own schedule — never apply one.
 *
 * Grounded: the only inputs are the schedule the GC built (its start date, its
 * working-day span, its week length and its logged closures). Honest: `basis`
 * states the working → calendar conversion, because 90 working days at 5 days
 * a week is 126 calendar days and a GC who signed the smaller number would owe
 * the larger one. Adaptive: returns null rather than guessing when the schedule
 * has no start date or no duration — a contract date is not a thing to invent.
 */
export function suggestContractTimeline(project: Project): ContractTimelineSuggestion | null {
  const schedule = project.schedule;
  if (!schedule) return null;
  const start = parseCalendarDay(schedule.startDate);
  const working = schedule.totalDurationDays;
  if (!start || !Number.isFinite(working) || working < 1) return null;
  const perWeek = schedule.workingDaysPerWeek || 5;
  // The schedule's OWN calendar — its week length and its logged closures — so
  // the suggestion lands on the same finish day the Gantt draws.
  const end = addWorkingDays(start, Math.round(working) - 1, perWeek, schedule.nonWorkingDates);
  const calendarDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const resolved = contractTimeline(toCalendarDayString(start), calendarDays);
  if (!resolved) return null;
  const closures = schedule.nonWorkingDates?.length ?? 0;
  return {
    ...resolved,
    basis: `From your schedule: ${Math.round(working)} working days at ${perWeek} days/week${closures > 0 ? ` with ${closures} logged closure${closures === 1 ? '' : 's'}` : ''} = ${calendarDays} calendar days.`,
  };
}
