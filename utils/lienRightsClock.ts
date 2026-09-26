// utils/lienRightsClock.ts — THE NY LIEN-DEADLINE CLOCK on an unpaid invoice.
//
// A date reminder, not legal advice. It answers one question from his own
// data: "if this client never pays, by when must a notice of lien be filed?"
//
// SOURCE. The only table row is New York, read on the official NY Senate page
// for Lien Law § 10 (never a blog). That page says a notice of lien may be
// filed within EIGHT months after the completion of the contract, the final
// performance of the work or the final furnishing of the materials — FOUR
// months where the improvement is a single-family dwelling — dating from the
// last item of work performed or materials furnished. Those are the private-
// improvement windows; a public-improvement lien runs on a shorter clock under
// a different section we have NOT read, so this module names no date for it.
//
// LAST WORK. The clock runs from the last day he furnished work or materials.
// The app's only dated evidence of that is the daily log, so lastWorkDay is the
// latest daily report on THIS project (never another job's). No report → no
// date, and the reason says so. We never guess it from an invoice date.
//
// MONTH-END. utils/calendarDate.addCalendarMonths CLAMPS the day to the target
// month's length: Jun 30 + 8 months is Feb 28 (29 in a leap year), not Mar 2.
// Clamping can only move a deadline EARLIER, never later — the safe direction.
//
// STATE. structuredAddress.state wins; else the free-text `location` through
// utils/codeJurisdiction's own parser (jobsiteAddressForProject), which never
// guesses a state from a city name.
//
// Pure — no React, no storage, no network. The clock is an argument (`today`).
import type { Project } from '@/types';
import { addCalendarMonths, calendarDayOf, daysUntilCalendarDay, parseCalendarDay } from '@/utils/calendarDate';
import { jobsiteAddressForProject, normalizeState } from '@/utils/codeJurisdiction';

export interface LienRule {
  state: 'NY';
  statute: 'N.Y. Lien Law § 10';
  url: string;
  /** The day the official page was read for this row. */
  checkedOn: string;
  /** False = the page could not be read or did not say it plainly: the card
   *  then shows no dates and no section. */
  verified: boolean;
  months: number;
  monthsSingleFamily: number;
  trigger: string;
  /** ≤ 25 words, verbatim from the official page. */
  quote: string;
}

export const LIEN_RULES: Readonly<Record<'NY', LienRule>> = Object.freeze({
  NY: Object.freeze({
    state: 'NY',
    statute: 'N.Y. Lien Law § 10',
    url: 'https://www.nysenate.gov/legislation/laws/LIE/10',
    checkedOn: '2026-09-26',
    verified: true,
    months: 8,
    monthsSingleFamily: 4,
    trigger: 'the last item of work performed or materials furnished',
    quote: 'within eight months after the completion of the contract, or the final performance of the work, or the final furnishing of the materials',
  }) as LienRule,
});

export type LienClock =
  | {
      kind: 'ny';
      lastWorkDay: string;
      lastWorkSource: 'daily_report';
      deadline: string;
      deadlineSingleFamily: string;
      daysLeft: number;
      daysLeftSingleFamily: number;
      rule: LienRule;
    }
  | { kind: 'ny_unverified' }
  | { kind: 'no_last_work'; reason: string }
  | { kind: 'state_unknown'; reason: string }
  | { kind: 'unsupported'; state: string; reason: string };

export const NO_LAST_WORK_REASON =
  'No daily report on this job to date the last day of work — the clock runs from the last day you furnished work or materials.';
export const STATE_UNKNOWN_REASON = "Add the job's state to see a lien deadline.";
export const UNVERIFIED_SENTENCE =
  "We couldn't verify New York's lien deadline today — ask your attorney before it's too late.";
export function unsupportedReason(state: string): string {
  return `No lien-deadline table for ${state} yet — ask your attorney.`;
}

export function lienClockFor(a: {
  project: Pick<Project, 'id' | 'structuredAddress' | 'location'>;
  dailyReports: { projectId: string; date: string }[];
  /** Today's calendar day, 'YYYY-MM-DD'. */
  today: string;
}): LienClock {
  const state = normalizeState(jobsiteAddressForProject(a.project).state);
  if (!state) return { kind: 'state_unknown', reason: STATE_UNKNOWN_REASON };
  if (state !== 'NY') return { kind: 'unsupported', state, reason: unsupportedReason(state) };

  const rule = LIEN_RULES.NY;
  if (!rule.verified) return { kind: 'ny_unverified' };

  const todayDate = parseCalendarDay(a.today);
  let lastWorkDay: string | null = null;
  for (const r of a.dailyReports ?? []) {
    if (!r || r.projectId !== a.project.id) continue;
    const day = calendarDayOf(r.date);
    if (!day) continue;
    // A report dated after today is a plan, not work performed.
    if (todayDate && day > a.today) continue;
    if (!lastWorkDay || day > lastWorkDay) lastWorkDay = day;
  }
  if (!lastWorkDay) return { kind: 'no_last_work', reason: NO_LAST_WORK_REASON };

  const deadline = addCalendarMonths(lastWorkDay, rule.months);
  const deadlineSingleFamily = addCalendarMonths(lastWorkDay, rule.monthsSingleFamily);
  if (!deadline || !deadlineSingleFamily || !todayDate) return { kind: 'no_last_work', reason: NO_LAST_WORK_REASON };
  const daysLeft = daysUntilCalendarDay(deadline, todayDate);
  const daysLeftSingleFamily = daysUntilCalendarDay(deadlineSingleFamily, todayDate);
  if (daysLeft == null || daysLeftSingleFamily == null) return { kind: 'no_last_work', reason: NO_LAST_WORK_REASON };

  return {
    kind: 'ny',
    lastWorkDay,
    lastWorkSource: 'daily_report',
    deadline,
    deadlineSingleFamily,
    daysLeft,
    daysLeftSingleFamily,
    rule,
  };
}
