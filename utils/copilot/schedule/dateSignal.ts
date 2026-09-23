// utils/copilot/schedule/dateSignal.ts — did the contractor actually state a
// start date?
//
// The schedule interview must ASK "when do you break ground?" whenever the
// contractor did NOT give a date — that clarifying question is the whole point.
// But single-turn-trained models tend to PRESUME a date and fill the field
// anyway (the ICLR "double-turn" failure the spec calls out), which silently
// skips the question. So we don't trust a model-extracted startDate unless the
// contractor's own words carry a real temporal signal. Deterministic + pure so
// it can be unit-validated without a model in the loop.

import { addCalendarDays, parseCalendarDay, todayCalendarDay } from '@/utils/calendarDate';

// Word-boundary temporal tokens: month names, weekdays, relative units, seasons,
// quarters, named days. Kept to genuinely time-bearing words to avoid false
// positives on ordinary scope text ("kitchen and two baths" has none of these).
const WORD_SIGNAL = /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sept?(ember)?|oct(ober)?|nov(ember)?|dec(ember)?|mon(day)?|tue(s(day)?)?|wed(nesday)?|thu(r(s(day)?)?)?|fri(day)?|sat(urday)?|sun(day)?|today|tonight|tomorrow|yesterday|week|weeks|month|months|quarter|spring|summer|autumn|winter|q[1-4])\b/i;

// Numeric / phrase date forms: ISO, M/D or M-D, "the 5th", "in 3 weeks/days".
const NUMERIC_SIGNAL = [
  /\b\d{4}-\d{1,2}-\d{1,2}\b/,                 // 2026-03-21
  /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/,    // 3/21 or 03-21-2026
  /\bthe\s+\d{1,2}(?:st|nd|rd|th)\b/i,         // "the 21st"
  /\bin\s+\d+\s+(?:day|days|week|weeks|month|months)\b/i, // "in 3 weeks"
  /\bnext\s+(?:week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday|spring|summer|fall|winter)\b/i,
];

/** True when the transcript contains an explicit start/timing signal the model
 *  could legitimately turn into a start date. */
export function hasDateSignal(transcript: string): boolean {
  if (!transcript) return false;
  if (WORD_SIGNAL.test(transcript)) return true;
  // "fall" is excluded from WORD_SIGNAL (too many non-seasonal senses — "fall
  // protection", "a fall"); only accept it as a season when paired with timing.
  if (/\b(this|next|by|in|early|late|mid)\s+fall\b/i.test(transcript)) return true;
  return NUMERIC_SIGNAL.some((re) => re.test(transcript));
}

/** Whether to fold a model-extracted startDate into the draft. Accept only a
 *  real CALENDAR DAY AND either a date signal in the contractor's own words or
 *  that they are directly answering the start-date question. Pure so the gate
 *  is unit-validated without the capability's (RN-heavy) dependency chain.
 *
 *  "A real calendar day" is what parseCalendarDay can read (W6 A2). The relay
 *  types an unknown field as a REQUIRED STRING, so a model with nothing to say
 *  answers "", "null", "unknown" or "end of March" — and every one of those
 *  passed `typeof === 'string'`. Any non-empty one then set startDate, which
 *  silently skipped "when do you break ground?" and wrote a string no screen
 *  can turn into a date onto the schedule. */
export function shouldAcceptStartDate(
  aiStartDate: unknown,
  transcript: string,
  answeringStartDate: boolean,
  today: string = todayCalendarDay(),
): boolean {
  const day = normalizeStartDate(aiStartDate);
  return day != null && isPlausibleStartDay(day, today) && (hasDateSignal(transcript) || answeringStartDate);
}

/** How far a stated start may sit from today before it reads as the model
 *  converting "end of March" into the wrong YEAR rather than as his date. A
 *  job that broke ground a few weeks ago is real; one 200 days ago or three
 *  years out is a conversion error. Out of range = not accepted, so "when do
 *  you break ground?" is asked instead of a wrong anchor landing. */
export const START_DAY_MAX_PAST_DAYS = 60;
export const START_DAY_MAX_FUTURE_DAYS = 730;

/** True when `day` (YYYY-MM-DD) lies within [today − 60 days, today + 2 years]. */
export function isPlausibleStartDay(day: string, today: string = todayCalendarDay()): boolean {
  const d = parseCalendarDay(day), t = parseCalendarDay(today);
  if (!d || !t) return false;
  return d >= addCalendarDays(t, -START_DAY_MAX_PAST_DAYS) && d <= addCalendarDays(t, START_DAY_MAX_FUTURE_DAYS);
}

/** The calendar day ('YYYY-MM-DD') a model value names, or null. A full ISO
 *  timestamp keeps its date half; anything parseCalendarDay rejects is null. */
export function normalizeStartDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const day = value.trim().slice(0, 10);
  return parseCalendarDay(day) ? day : null;
}
