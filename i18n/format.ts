// i18n/format.ts — locale-aware display formatters (docs/I18N.md §6).
//
// ENGLISH: every helper delegates to EXACTLY the function or
// `toLocale*('en-US', opts)` call the app makes today (utils/formatters.ts,
// utils/calendarDate.ts, utils/constructionNews.ts), so English output is
// byte-identical on every platform. scripts/validate-i18n.ts proves it over
// thousands of inputs.
//
// SPANISH: Intl on the phone and Intl on the web disagree in Spanish (Hermes/
// Apple prints es-US `9/27/2026` and `sept 27, 2026`; browser ICU prints
// `27/9/2026` and `27 sept 2026`). So Spanish dates are built from our own
// tables and never passed an `es-*` locale — identical on iOS, Android, the
// web and Deno. And never numeric: `9/10` is 9 October to a Mexican foreman
// and 10 September to his owner.
//
// MONEY AND NUMBERS ARE THE SAME IN BOTH LANGUAGES: US Spanish money is US
// convention (`$1,234,567.89`). es-MX would print `USD 1,234,567.89` and plain
// `es` `1.234.567,89 US$` — both wrong for a US contractor. Money stays
// integer cents in storage; nothing here changes a stored value.
//
// PURE (no React Native import) — bun, the Hermes gate and Deno can load it.

import type { Lang } from './types';
import { getLang } from './core';
import { formatMoney, formatMoneyShort, formatNumber } from '../utils/formatters';
import { formatCalendarDay, parseCalendarDay } from '../utils/calendarDate';
import { relativeTime } from '../utils/constructionNews';

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

const EN_MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ── Money and numbers: identical in en and es ────────────────────────────

/** formatMoney in the given language. Identical output in en and es. */
export function formatMoneyL(n: number | null | undefined, decimals = 0, lang: Lang = getLang()): string {
  void lang; // es-US money is US convention — deliberately the same call.
  return formatMoney(n, decimals);
}

/**
 * formatMoneyShort in the given language ($12K, $1.2M). Identical in es for
 * now — reviewer item: confirm K/M read correctly to a Spanish-speaking office
 * (glossary §8). Changing it is one line here, not 100 call sites.
 */
export function formatMoneyShortL(n: number | null | undefined, lang: Lang = getLang()): string {
  void lang;
  return formatMoneyShort(n);
}

/** formatNumber in the given language (period decimal, comma thousands —
 *  the US and Mexican convention). Identical in en and es. */
export function formatNumberL(n: number | null | undefined, decimals = 0, lang: Lang = getLang()): string {
  void lang;
  return formatNumber(n, decimals);
}

/**
 * Dollars from INTEGER CENTS. Rounds in integer cents (half away from zero on
 * the magnitude), then formats the whole-dollar part as an integer — so it
 * cannot hit Apple NumberFormatter's half-to-even drift (on iOS
 * `formatMoney(1234.5, 0)` prints `$1,234` while the web prints `$1,235`;
 * this prints `$1,235` on both). Same sign rule as formatMoney: a negative
 * amount keeps its minus even when it rounds to $0.
 *
 * Equal to `formatMoney(cents / 100, decimals)` on V8 for every integer cents
 * value (validate-i18n proves it); on iOS it differs only on exact halves at
 * decimals = 0, where it is the one that is right.
 */
export function formatMoneyCentsL(
  cents: number | null | undefined,
  lang: Lang = getLang(),
  opts: { decimals?: 0 | 2 } = {},
): string {
  void lang;
  const decimals = opts.decimals ?? 2;
  const c = typeof cents === 'number' && Number.isFinite(cents) ? Math.round(cents) : 0;
  const neg = c < 0;
  const abs = Math.abs(c);
  let body: string;
  if (decimals === 0) {
    const dollars = Math.floor((abs + 50) / 100);
    body = dollars.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  } else {
    const dollars = Math.floor(abs / 100);
    const rem = abs % 100;
    body = dollars.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) +
      '.' + String(rem).padStart(2, '0');
  }
  return (neg ? '-$' : '$') + body;
}

// ── Date parts (respecting an optional timeZone, without formatToParts) ──

interface DateParts {
  year: number;
  month: number; // 0-11
  day: number;
  weekday: number; // 0 = Sunday
  hour: number; // 0-23
  minute: number;
  second: number;
}

function toDate(v: Date | string | number): Date {
  return v instanceof Date ? v : new Date(v);
}

function localParts(d: Date): DateParts {
  return {
    year: d.getFullYear(), month: d.getMonth(), day: d.getDate(), weekday: d.getDay(),
    hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds(),
  };
}

function utcParts(d: Date): DateParts {
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
function zonedParts(d: Date, timeZone?: string): DateParts {
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

const pad2 = (n: number) => String(n).padStart(2, '0');

function hasDateField(o: Intl.DateTimeFormatOptions): boolean {
  return !!(o.weekday || o.year || o.month || o.day);
}

function hasTimeField(o: Intl.DateTimeFormatOptions): boolean {
  return !!(o.hour || o.minute || o.second);
}

function esTime(p: DateParts, o: Intl.DateTimeFormatOptions): string {
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
function esDate(p: DateParts, o: Intl.DateTimeFormatOptions): string {
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
 * Any Intl date options, in the given language. en is exactly
 * `d.toLocaleDateString('en-US', opts)`.
 */
export function formatDateOptsL(
  value: Date | string | number,
  opts: Intl.DateTimeFormatOptions,
  lang: Lang = getLang(),
): string {
  const d = toDate(value);
  if (lang === 'en') return d.toLocaleDateString('en-US', opts);
  if (!Number.isFinite(d.getTime())) return 'Fecha no válida';
  return esDate(zonedParts(d, opts.timeZone), opts);
}

/** A named date style ('day' | 'dayYear' | 'weekdayDay' | 'long' | …). */
export function formatDateL(value: Date | string | number, style: DateStyle = 'dayYear', lang: Lang = getLang()): string {
  return formatDateOptsL(value, DATE_STYLE_OPTIONS[style], lang);
}

/**
 * utils/calendarDate formatCalendarDay in the given language — the body the
 * handoff patch routes `formatCalendarDay` through (161 importing files move
 * at once, no screen edits). en is exactly formatCalendarDay(value, options).
 * Same contract in es: '' for empty input, the raw value when unparseable.
 */
export function formatCalendarDayL(
  value: string | null | undefined,
  options?: Intl.DateTimeFormatOptions,
  lang: Lang = getLang(),
): string {
  if (lang === 'en') return options ? formatCalendarDay(value, options) : formatCalendarDay(value);
  if (!value) return '';
  const d = parseCalendarDay(value);
  if (!d) return value;
  return esDate(localParts(d), options ?? DATE_STYLE_OPTIONS.dayYear);
}

/** Time of day. en is exactly `d.toLocaleTimeString('en-US', opts)` with the
 *  app's usual { hour: 'numeric', minute: '2-digit' }; es is `3:05 p.m.`. */
export function formatTimeL(
  value: Date | string | number,
  lang: Lang = getLang(),
  opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' },
): string {
  const d = toDate(value);
  if (lang === 'en') return d.toLocaleTimeString('en-US', opts);
  if (!Number.isFinite(d.getTime())) return 'Hora no válida';
  return esTime(zonedParts(d, opts.timeZone), opts.hour || opts.minute ? opts : { ...opts, hour: 'numeric', minute: '2-digit' });
}

/** Weekday name. en is exactly `toLocaleDateString('en-US', { weekday })`. */
export function formatWeekdayL(value: Date | string | number, width: 'short' | 'long' = 'short', lang: Lang = getLang()): string {
  return formatDateOptsL(value, { weekday: width }, lang);
}

// ── Relative time ────────────────────────────────────────────────────────

/**
 * The buckets of utils/constructionNews relativeTime, as data, so Spanish
 * uses the SAME thresholds. validate-i18n proves renderRelative(parts,'en')
 * equals relativeTime for thousands of (iso, now) pairs, so the buckets
 * cannot drift apart silently.
 */
export type RelativeParts =
  | { kind: 'invalid' }
  | { kind: 'justNow' }
  | { kind: 'min'; n: number }
  | { kind: 'hr'; n: number }
  | { kind: 'yesterday' }
  | { kind: 'days'; n: number }
  | { kind: 'date'; month: number; day: number; year: number | null };

export function relativeParts(iso: string, nowMs: number): RelativeParts {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return { kind: 'invalid' };
  const diff = nowMs - ts;
  if (diff < 60_000) return { kind: 'justNow' };
  const min = Math.floor(diff / 60_000);
  if (min < 60) return { kind: 'min', n: min };
  const hr = Math.floor(min / 60);
  const then = new Date(ts);
  const now = new Date(nowMs);
  const dayIndex = (d: Date) => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
  const days = dayIndex(now) - dayIndex(then);
  if (hr < 24 && days === 0) return { kind: 'hr', n: hr };
  if (days <= 1) return hr < 24 ? { kind: 'hr', n: hr } : { kind: 'yesterday' };
  if (days < 7) return { kind: 'days', n: days };
  return {
    kind: 'date',
    month: then.getMonth(),
    day: then.getDate(),
    year: then.getFullYear() === now.getFullYear() ? null : then.getFullYear(),
  };
}

/** Render relative parts. Spanish per glossary §7: `hace 5 min`, `hace 2 h`,
 *  `ayer`, `hace 3 días`, `27 sept`. */
export function renderRelative(p: RelativeParts, lang: Lang): string {
  if (lang === 'en') {
    switch (p.kind) {
      case 'invalid': return '';
      case 'justNow': return 'just now';
      case 'min': return `${p.n} min ago`;
      case 'hr': return `${p.n} hr ago`;
      case 'yesterday': return 'yesterday';
      case 'days': return `${p.n} days ago`;
      case 'date': {
        const label = `${EN_MONTHS_SHORT[p.month]} ${p.day}`;
        return p.year === null ? label : `${label}, ${p.year}`;
      }
    }
  }
  switch (p.kind) {
    case 'invalid': return '';
    case 'justNow': return 'ahora mismo';
    case 'min': return `hace ${p.n} min`;
    case 'hr': return `hace ${p.n} h`;
    case 'yesterday': return 'ayer';
    case 'days': return `hace ${p.n} días`;
    case 'date': {
      const label = `${p.day} ${ES_MONTHS_SHORT[p.month]}`;
      return p.year === null ? label : `${label} ${p.year}`;
    }
  }
}

/** Relative time in the given language. en is exactly relativeTime(iso, nowMs). */
export function formatRelativeL(iso: string, nowMs: number, lang: Lang = getLang()): string {
  if (lang === 'en') return relativeTime(iso, nowMs);
  return renderRelative(relativeParts(iso, nowMs), 'es');
}

// ── Sorting ──────────────────────────────────────────────────────────────

let esCollator: Intl.Collator | null | undefined;

/** Locale-aware compare for sorting names. es uses Intl.Collator('es')
 *  (ñ after n; works on Hermes). en is exactly `a.localeCompare(b)`. */
export function compareL(a: string, b: string, lang: Lang = getLang()): number {
  if (lang === 'en') return a.localeCompare(b);
  if (esCollator === undefined) {
    try {
      esCollator = new Intl.Collator('es');
    } catch {
      esCollator = null;
    }
  }
  return esCollator ? esCollator.compare(a, b) : a.localeCompare(b);
}
