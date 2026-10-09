// utils/deliveries/orderBy.ts — lead time, Order By and What To Order This Week
// (lane DELIVERIES-1, Deliveries That Follow The Schedule).
//
//     Order By = Needed On Site By, counted back the lead time in CALENDAR days
//
// Suppliers quote lead times in calendar days and weeks, so this count is in
// calendar days (a week is 7). THE LEAD TIME IS ONLY WHAT THE CONTRACTOR TYPED.
// There is no starter value: with no lead time there is no Order By date, and
// this file never reads utils/automation/leadTimeLibrary (a national guess).
//
// Order By is worked out on every read, like the date it is counted from. It is
// never stored.
//
// Pure: no React, no storage, no network. `today` is handed in.
import type { Delivery } from '@/utils/deliverySchedule';
import { addCalendarDays, parseCalendarDay, toCalendarDayString } from '@/utils/calendarDate';
import { compareDays, dayOrEmpty, stepCalendarDays } from './calendar';
import { neededOnSiteBy, type NeededBy, type ScheduleForDeliveries } from './neededBy';

/** The longest lead time the form accepts, in calendar days (the column's own check). */
export const MAX_LEAD_TIME_DAYS = 730;

export type LeadTimeUnit = 'days' | 'weeks';

/** The lead time in force: a whole number of calendar days from 1 to 730, or null when none was typed. */
export function leadTimeDaysOf(delivery: Pick<Delivery, 'leadTimeDays'>): number | null {
  const n = delivery.leadTimeDays;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const whole = Math.round(n);
  return whole < 1 || whole > MAX_LEAD_TIME_DAYS ? null : whole;
}

/** What the person typed, as calendar days. Null for a blank, a zero, a negative, a fraction of a day or more than 730 days. */
export function leadTimeFromInput(text: string, unit: LeadTimeUnit): number | null {
  const t = (text ?? '').trim();
  if (!/^\d{1,4}$/.test(t)) return null;
  const n = Number(t) * (unit === 'weeks' ? 7 : 1);
  return n >= 1 && n <= MAX_LEAD_TIME_DAYS ? n : null;
}

/** How to show a stored lead time: whole weeks when it divides by 7, days otherwise. */
export function leadTimeParts(days: number): { count: number; unit: LeadTimeUnit } {
  return days % 7 === 0 ? { count: days / 7, unit: 'weeks' } : { count: days, unit: 'days' };
}

/** Order By for a needed-by date and a typed lead time. '' when either is missing. */
export function orderByDate(neededBy: string, leadTimeDays: number | null | undefined): string {
  if (!neededBy || typeof leadTimeDays !== 'number' || !Number.isFinite(leadTimeDays) || leadTimeDays < 1) return '';
  return stepCalendarDays(neededBy, -Math.round(leadTimeDays));
}

export interface OrderRow {
  delivery: Delivery;
  needed: NeededBy;
  orderBy: string;
  leadTimeDays: number;
  /** Calendar days from today to Order By. Negative = that many days past it. */
  daysLeft: number;
}

export interface OrderList {
  /** Order By is before today and it is not marked ordered. Oldest first. Not bounded by the week. */
  overdue: OrderRow[];
  /** Order By falls from today to the end of this week (Sunday). Soonest first. */
  thisWeek: OrderRow[];
  /** `overdue` then `thisWeek`: the list as it is shown. */
  rows: OrderRow[];
}

/** The Sunday that ends the local week `today` is in (weeks run Monday to Sunday, as utils/calendarDate mondayOfLocalWeek). */
export function endOfLocalWeek(today: string): string {
  const d = parseCalendarDay(today);
  if (!d) return '';
  const toSunday = (7 - d.getDay()) % 7;
  return toCalendarDayString(addCalendarDays(d, toSunday));
}

function daysBetween(from: string, to: string): number {
  const a = parseCalendarDay(from);
  const b = parseCalendarDay(to);
  if (!a || !b) return 0;
  // Local midnights can be 23 or 25 hours apart across a clock change: round.
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/**
 * What To Order This Week. A delivery is on the list when it has a linked task
 * with a date, a typed lead time, no Ordered On date, and has not arrived or
 * been cancelled; and its Order By is this week or already past. Overdue ones
 * come first.
 */
export function whatToOrderThisWeek(
  deliveries: readonly Delivery[],
  scheduleFor: (projectId: string) => ScheduleForDeliveries | null | undefined,
  today: string,
): OrderList {
  const weekEnd = endOfLocalWeek(today);
  const overdue: OrderRow[] = [];
  const thisWeek: OrderRow[] = [];
  if (!weekEnd) return { overdue, thisWeek, rows: [] };
  for (const d of deliveries) {
    if (d.status === 'delivered' || d.status === 'cancelled') continue;
    if (dayOrEmpty(d.orderedOn)) continue;
    const lead = leadTimeDaysOf(d);
    if (lead === null) continue;
    const needed = neededOnSiteBy(d, scheduleFor(d.projectId));
    const orderBy = orderByDate(needed.date, lead);
    if (!orderBy) continue;
    const row: OrderRow = { delivery: d, needed, orderBy, leadTimeDays: lead, daysLeft: daysBetween(today, orderBy) };
    const vsToday = compareDays(orderBy, today);
    if (vsToday === null) continue;
    if (vsToday < 0) overdue.push(row);
    else if ((compareDays(orderBy, weekEnd) ?? 1) <= 0) thisWeek.push(row);
  }
  const byDate = (a: OrderRow, b: OrderRow) => (compareDays(a.orderBy, b.orderBy) ?? 0) || a.delivery.description.localeCompare(b.delivery.description);
  overdue.sort(byDate);
  thisWeek.sort(byDate);
  return { overdue, thisWeek, rows: [...overdue, ...thisWeek] };
}
