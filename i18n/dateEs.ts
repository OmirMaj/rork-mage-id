// i18n/dateEs.ts — the Spanish date engine: month and weekday tables, and
// the renderer that turns Intl date options into Spanish from those tables
// (docs/I18N.md §6). Split out of i18n/format.ts so utils/calendarDate.ts can
// route Spanish through it WITHOUT an import cycle: format.ts imports
// utils/calendarDate.ts (its English calendar-day path), so calendarDate.ts
// must not import format.ts. This file imports only i18n/types — nothing from
// utils/, nothing from React Native — so bun, the Hermes gate and Deno can
// load it.
//
// Never numeric: `month: 'numeric' | '2-digit'` renders as the short month
// NAME. `9/10` is 9 October to a Mexican foreman and 10 September to his owner.

// ── Spanish tables (glossary §7: lowercase months and weekdays) ──────────

export const ES_MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
] as const;
export const ES_MONTHS_SHORT = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic',
] as const;
export const ES_WEEKDAYS = [
  'domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado',
] as const;
export const ES_WEEKDAYS_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'] as const;

// ── Date parts (respecting an optional timeZone, without formatToParts) ──

export interface DateParts {
  year: number;
  month: number; // 0-11
  day: number;
  weekday: number; // 0 = Sunday
  hour: number; // 0-23
  minute: number;
  second: number;
}

export function localParts(d: Date): DateParts {
  return {
    year: d.getFullYear(), month: d.getMonth(), day: d.getDate(), weekday: d.getDay(),
    hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds(),
  };
}

export function utcParts(d: Date): DateParts {
  return {
    year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate(), weekday: d.getUTCDay(),
    hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds(),
  };
}

/**
 * Wall-clock parts of `d` in `timeZone`. Reads them from en-US NUMERIC output
 * ('9/26/2026', '15:05:09'), which is stable on Hermes, V8 and Deno —
 * formatToParts is avoided (NumberFormat's throws on the Apple backend, so
 * the family is not trusted). Falls back to local parts if the zone is bad.
 */
export function zonedParts(d: Date, timeZone?: string): DateParts {
  if (!timeZone) return localParts(d);
  if (timeZone === 'UTC' || timeZone === 'Etc/UTC' || timeZone === 'GMT') return utcParts(d);
  try {
    const date = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }).format(d);
    const time = new Intl.DateTimeFormat('en-US', {
      timeZone, hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: false,
    }).format(d);
    const dm = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(date);
    const tm = /(\d{1,2}):(\d{2}):(\d{2})/.exec(time);
    if (!dm || !tm) return localParts(d);
    const year = Number(dm[3]);
    const month = Number(dm[1]) - 1;
    const day = Number(dm[2]);
    return {
      year, month, day,
      weekday: new Date(Date.UTC(year, month, day)).getUTCDay(),
      hour: Number(tm[1]) % 24, // some ICU builds print midnight as 24
      minute: Number(tm[2]),
      second: Number(tm[3]),
    };
  } catch {
    return localParts(d);
  }
}

// ── Dates ────────────────────────────────────────────────────────────────

export type DateStyle = 'day' | 'dayYear' | 'weekdayDay' | 'long' | 'monthYear' | 'weekday';

/** The en-US options each named style has always meant in this app. */
export const DATE_STYLE_OPTIONS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  day: { month: 'short', day: 'numeric' }, //                      Sep 27        | 27 sept
  dayYear: { month: 'short', day: 'numeric', year: 'numeric' }, //   Sep 27, 2026  | 27 sept 2026
  weekdayDay: { weekday: 'short', month: 'short', day: 'numeric' }, // Sun, Sep 27 | dom 27 sept
  long: { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' },
  //                                  Sunday, September 27, 2026 | domingo, 27 de septiembre de 2026
  monthYear: { month: 'long', year: 'numeric' }, //                 September 2026 | septiembre de 2026
  weekday: { weekday: 'long' }, //                                  Sunday | domingo
};

export const pad2 = (n: number) => String(n).padStart(2, '0');

export function hasDateField(o: Intl.DateTimeFormatOptions): boolean {
  return !!(o.weekday || o.year || o.month || o.day);
}

export function hasTimeField(o: Intl.DateTimeFormatOptions): boolean {
  return !!(o.hour || o.minute || o.second);
}

export function esTime(p: DateParts, o: Intl.DateTimeFormatOptions): string {
  const h24 = o.hour12 === false || o.hourCycle === 'h23' || o.hourCycle === 'h24';
  const mm = pad2(p.minute);
  const ss = o.second ? ':' + pad2(p.second) : '';
  if (h24) {
    const h = o.hour === '2-digit' ? pad2(p.hour) : String(p.hour);
    return `${h}:${mm}${ss}`;
  }
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  const h = o.hour === '2-digit' ? pad2(h12) : String(h12);
  return `${h}:${mm}${ss} ${p.hour < 12 ? 'a.m.' : 'p.m.'}`;
}

/**
 * The Spanish rendering of a set of Intl date options, from our own tables.
 * `month: 'numeric' | '2-digit'` is rendered as the short month NAME — there
 * are no numeric dates in Spanish (glossary §6).
 */
export function esDate(p: DateParts, o: Intl.DateTimeFormatOptions): string {
  const opts = hasDateField(o) || hasTimeField(o) ? o : DATE_STYLE_OPTIONS.dayYear;
  const longMonth = opts.month === 'long';
  const monthStr = opts.month ? (longMonth ? ES_MONTHS[p.month] : ES_MONTHS_SHORT[p.month]) : '';
  const dayStr = opts.day ? (opts.day === '2-digit' ? pad2(p.day) : String(p.day)) : '';
  const yearStr = opts.year ? (opts.year === '2-digit' ? pad2(p.year % 100) : String(p.year)) : '';

  let core = '';
  if (dayStr && monthStr) core = longMonth ? `${dayStr} de ${monthStr}` : `${dayStr} ${monthStr}`;
  else if (monthStr) core = monthStr;
  else if (dayStr) core = dayStr;

  if (yearStr) {
    if (monthStr) core = longMonth ? `${core} de ${yearStr}` : `${core} ${yearStr}`;
    else core = core ? `${core} ${yearStr}` : yearStr;
  }

  if (opts.weekday) {
    const wk = opts.weekday === 'long' ? ES_WEEKDAYS[p.weekday] : ES_WEEKDAYS_SHORT[p.weekday];
    core = core ? (opts.weekday === 'long' ? `${wk}, ${core}` : `${wk} ${core}`) : wk;
  }

  if (hasTimeField(opts)) {
    const time = esTime(p, opts);
    core = core ? `${core}, ${time}` : time;
  }
  return core;
}

/**
 * A calendar day (a Date at LOCAL midnight, as utils/calendarDate
 * parseCalendarDay returns it) in Spanish. Reads the LOCAL components — a
 * calendar day does not move with a timeZone option. Options with no date or
 * time field fall back to 'dayYear' (27 sept 2026).
 */
export function esCalendarDate(d: Date, options: Intl.DateTimeFormatOptions = DATE_STYLE_OPTIONS.dayYear): string {
  return esDate(localParts(d), options);
}
