// utils/proposalValidity.ts — "Prices valid until" on a proposal, a quote and
// the shared estimate link.
//
// A FIXED date the GC picks, defaulting to 30 days out. It is never computed
// from how much his prices move: there are too few receipts per item for that
// number to be anything but a default dressed up as insight (roadmap T2,
// "price-hold dates computed from volatility" — killed).
//
// Every date here is a CALENDAR DAY ('YYYY-MM-DD'), moved with the local-
// component helpers in utils/calendarDate — never `getTime() + n × 86 400 000`,
// which lands an hour short across a DST change and names the wrong day.
//
// Pure — no React, no storage, no clock (callers pass today's calendar day).
import { addCalendarDays, formatCalendarDay, parseCalendarDay, toCalendarDayString } from '@/utils/calendarDate';

/** How long prices hold by default: 30 calendar days. */
export const DEFAULT_VALID_DAYS = 30;

const DAY_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar day in the exact 'YYYY-MM-DD' shape (no time part,
 *  no rolled-over month like 2026-02-30). */
export function isCalendarDay(value: unknown): value is string {
  return typeof value === 'string' && DAY_SHAPE.test(value) && parseCalendarDay(value) !== null;
}

/** Today's calendar day + DEFAULT_VALID_DAYS, or null when `today` is not a
 *  calendar day. Oct 1 → Oct 31; Sep 28 → Oct 28. */
export function defaultValidUntil(today: string): string | null {
  const d = isCalendarDay(today) ? parseCalendarDay(today) : null;
  return d ? toCalendarDayString(addCalendarDays(d, DEFAULT_VALID_DAYS)) : null;
}

/** "Prices valid until Oct 28, 2026." — null for anything that is not a
 *  calendar day, so a bad value prints nothing rather than a raw string. */
export function validUntilLine(day: string | null | undefined): string | null {
  return isCalendarDay(day) ? `Prices valid until ${formatCalendarDay(day)}.` : null;
}

/** True once `today` is AFTER the valid-until day. The day itself still
 *  counts as valid. False when either value is not a calendar day. */
export function isExpired(day: string | null | undefined, today: string | null | undefined): boolean {
  if (!isCalendarDay(day) || !isCalendarDay(today)) return false;
  return today > day;
}

/** The client-facing sentence once the date has passed:
 *  "These prices were valid until Oct 28, 2026. Ask Acme Builders to confirm
 *  them before you go ahead." Null for a bad day. */
export function expiredValidityLine(day: string | null | undefined, gcName?: string | null): string | null {
  if (!isCalendarDay(day)) return null;
  const who = typeof gcName === 'string' && gcName.trim() ? gcName.trim() : 'your contractor';
  return `These prices were valid until ${formatCalendarDay(day)}. Ask ${who} to confirm them before you go ahead.`;
}
