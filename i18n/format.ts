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
import { formatCalendarDay } from '../utils/calendarDate';
import {
  DATE_STYLE_OPTIONS, ES_MONTHS_SHORT, esDate, esTime, zonedParts, type DateStyle,
} from './dateEs';
import { relativeTime } from '../utils/constructionNews';

// ── Spanish tables (glossary §7: lowercase months and weekdays) ──────────
// They live in i18n/dateEs.ts (utils/calendarDate.ts renders Spanish days
// through it, and must not import this file — see there). Re-exported here so
// the public surface is unchanged.

export {
  ES_MONTHS, ES_MONTHS_SHORT, ES_WEEKDAYS, ES_WEEKDAYS_SHORT, DATE_STYLE_OPTIONS,
} from './dateEs';
export type { DateStyle } from './dateEs';

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

// ── Dates ────────────────────────────────────────────────────────────────

function toDate(v: Date | string | number): Date {
  return v instanceof Date ? v : new Date(v);
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
 * utils/calendarDate formatCalendarDay in the given language. formatCalendarDay
 * itself now takes `lang` (default getLang()) and renders Spanish through
 * i18n/dateEs.ts esCalendarDate — so its 161 importing files follow the app
 * language with no screen edits. This is the same function with the language
 * made explicit: en is exactly formatCalendarDay(value, options, 'en'); es has
 * the same contract ('' for empty input, the raw value when unparseable).
 * An omitted `options` reaches formatCalendarDay as undefined, so its own
 * default ('Aug 30, 2026' / '30 ago 2026') applies.
 */
export function formatCalendarDayL(
  value: string | null | undefined,
  options?: Intl.DateTimeFormatOptions,
  lang: Lang = getLang(),
): string {
  return formatCalendarDay(value, options, lang === 'es' ? 'es' : 'en');
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
