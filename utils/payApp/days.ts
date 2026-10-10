// utils/payApp/days.ts — calendar-day arithmetic for the pay application
// period, on 'YYYY-MM-DD' strings only.
//
// PURE and clock-free: no `new Date()` of "now", no time zone. Every figure is
// built from the three numbers in the string, so the day after 2026-10-31 is
// 2026-11-01 in New York, Honolulu and Sydney alike. (The seed this replaces
// in app/aia-pay-app.tsx parsed the day as UTC and added 86,400,000 ms.)
//
// Nothing here is a deadline. These are the two ends of a billing period the
// contractor can retype.

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

interface Ymd { y: number; m: number; d: number }

function daysInMonth(y: number, m: number): number {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

/** The first ten characters as a real calendar day, or null. */
export function readDay(value: string | null | undefined): Ymd | null {
  const m = DAY.exec(String(value ?? '').slice(0, 10));
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return { y, m: mo, d };
}

function write({ y, m, d }: Ymd): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 'YYYY-MM-DD' for a value that is one (or starts with one), else null. */
export function dayKeyOf(value: string | null | undefined): string | null {
  const r = readDay(value);
  return r ? write(r) : null;
}

/** The calendar day after `value`, or null when `value` is not a day. */
export function dayAfter(value: string | null | undefined): string | null {
  const r = readDay(value);
  if (!r) return null;
  if (r.d < daysInMonth(r.y, r.m)) return write({ ...r, d: r.d + 1 });
  if (r.m < 12) return write({ y: r.y, m: r.m + 1, d: 1 });
  return write({ y: r.y + 1, m: 1, d: 1 });
}

/** The last day of the month `value` falls in, or null. */
export function endOfMonth(value: string | null | undefined): string | null {
  const r = readDay(value);
  if (!r) return null;
  return write({ ...r, d: daysInMonth(r.y, r.m) });
}

/** Days since a fixed origin (the civil-day count), for differences only. */
function ordinal({ y, m, d }: Ymd): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe;
}

/** Whole calendar days from `from` to `to` (to − from), or null. */
export function daysBetween(from: string | null | undefined, to: string | null | undefined): number | null {
  const a = readDay(from);
  const b = readDay(to);
  if (!a || !b) return null;
  return ordinal(b) - ordinal(a);
}

/** 'Oct 28' — for a sentence that names a day in the period. '' when not a day. */
export function shortDay(value: string | null | undefined): string {
  const r = readDay(value);
  return r ? `${MONTHS[r.m - 1]} ${r.d}` : '';
}

/** 'Oct 28, 2026'. '' when not a day. */
export function longDay(value: string | null | undefined): string {
  const r = readDay(value);
  return r ? `${MONTHS[r.m - 1]} ${r.d}, ${r.y}` : '';
}
