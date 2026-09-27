// scripts/validate-i18n.ts — the gate on the Spanish (i18n) layer.
//
// Run: bun run test:i18n            (stale translations WARN, except safety.*)
//      bun run test:i18n -- --strict (stale translations FAIL — phase releases)
//
// What it proves (docs/I18N.md §11):
//
//   A. ENGLISH CANNOT REGRESS. Every locale-aware formatter, called with
//      lang 'en', returns byte-for-byte what the existing helper returns
//      (formatMoney, formatMoneyShort, formatNumber, formatCalendarDay,
//      toLocaleDateString/TimeString('en-US'), relativeTime) over thousands
//      of inputs; and t()/tn() in English return the inline English.
//   B. CATALOG INTEGRITY. en / es / pseudo key parity, no orphan or missing
//      keys on complete surfaces, placeholders match, plural forms valid,
//      stale translations listed (src hash ≠ fnv1a32 of the English).
//   C. PLURAL RULES. i18n/plural.ts agrees with ICU (Node's Intl.PluralRules)
//      for en and es — the rules exist because Hermes has no PluralRules.
//   D. SPANISH FORMATTING. Goldens for dates/times/relative; never a numeric
//      date in Spanish; money identical to English.
//   E. GLOSSARY + VOICE LINT on the Spanish text (Spain forms, estimación,
//      bitácora, equipo-for-crew, tú in outbound, usted in-app).
//   F. WIRING. The storage key uses an allowed prefix; resolution and
//      recipient-language orders; the edge reply-language rule leaves English
//      untouched and carries an exact copy of the app glossary; no t()/tn()
//      at module scope in any file that imports the layer; the pure i18n
//      files never import react-native or Intl.PluralRules.
//
// Pure: imports only the PURE i18n modules (no react-native), so bun runs it.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import type { CatalogValue, EsCatalog, I18nKey, Lang, PluralForms } from '../i18n/types';
import { I18N_AREAS, isPluralForms, normalizeLang, parseStoredLang } from '../i18n/types';
import { t, tn, interpolate, placeholdersOf, setLang, getLang, getDisplayLang, __setEsCatalogForTest } from '../i18n/core';
import { pluralCategory, selectPluralForm } from '../i18n/plural';
import { pseudoize, PSEUDO_OPEN, PSEUDO_CLOSE } from '../i18n/pseudo';
import { sourceHash, fnv1a32 } from '../i18n/hash';
import {
  formatMoneyL, formatMoneyShortL, formatNumberL, formatMoneyCentsL, formatDateL, formatDateOptsL,
  formatCalendarDayL, formatTimeL, formatWeekdayL, formatRelativeL, relativeParts, renderRelative,
  compareL, DATE_STYLE_OPTIONS, type DateStyle,
} from '../i18n/format';
import { resolveLanguage } from '../i18n/resolve';
import { recipientLanguage } from '../i18n/recipient';
import { SURFACES } from '../i18n/surfaces';
import { AI_GLOSSARY_ES } from '../i18n/aiGlossary';
import { EN_CATALOG } from '../i18n/catalog/en';
import { ES_CATALOG } from '../i18n/catalog/es';
import { AI_GLOSSARY_ES as EDGE_GLOSSARY, replyLanguageRule, parseReplyLocale } from '../supabase/functions/_shared/replyLanguage';
import { formatMoney, formatMoneyShort, formatNumber } from '../utils/formatters';
import { formatCalendarDay } from '../utils/calendarDate';
import { relativeTime } from '../utils/constructionNews';
import { isAppStorageKey } from '../utils/localCacheKeys';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STRICT = process.argv.includes('--strict');

let failures = 0;
let warnings = 0;
let checks = 0;
function ok(label: string, cond: boolean, detail?: string): boolean {
  checks++;
  if (cond) return true;
  failures++;
  console.error(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`);
  return false;
}
function warn(label: string) {
  warnings++;
  console.warn(`  ! ${label}`);
}
function section(name: string) {
  console.log(`\n── ${name}`);
}
function eqAll<T>(label: string, inputs: T[], got: (x: T) => string, want: (x: T) => string): void {
  let bad = 0;
  let first = '';
  for (const x of inputs) {
    const g = got(x);
    const w = want(x);
    checks++;
    if (g !== w) {
      bad++;
      if (!first) first = `input ${JSON.stringify(x)} → got ${JSON.stringify(g)}, want ${JSON.stringify(w)}`;
    }
  }
  if (bad) {
    failures++;
    console.error(`  ✗ ${label}: ${bad}/${inputs.length} differ\n      first: ${first}`);
  } else {
    console.log(`  ✓ ${label} (${inputs.length} inputs)`);
  }
}

// Deterministic PRNG so failures reproduce.
let seed = 0x9e3779b9;
function rand(): number {
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >>> 17;
  seed ^= seed << 5; seed >>>= 0;
  return seed / 0x100000000;
}
const randInt = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

const en = EN_CATALOG as Record<string, CatalogValue>;
const es = ES_CATALOG as Record<string, NonNullable<EsCatalog[I18nKey]>>;

// ═════════════════════════════════════════════════════════════════════════
section('A. English is byte-identical (formatters wrap today\'s output)');

const moneyInputs: (number | null | undefined)[] = [
  0, -0, 1, -1, 0.5, -0.5, 0.004, 0.005, 0.015, 1.005, 2.675, 999.995, 1234.5, -1234.5, 1234567.891,
  -1234567.891, 9999999.99, 1e9, -1e9, 12500, 12499.5, 99999.5, NaN, Infinity, -Infinity, null, undefined,
];
for (let i = 0; i < 3000; i++) {
  const mag = Math.pow(10, randInt(0, 9));
  moneyInputs.push((rand() - 0.3) * mag);
  moneyInputs.push(Math.round((rand() - 0.3) * mag * 100) / 100);
}
for (const d of [0, 1, 2, 3]) {
  eqAll(`formatMoneyL(n, ${d}, 'en') === formatMoney(n, ${d})`, moneyInputs, (n) => formatMoneyL(n, d, 'en'), (n) => formatMoney(n, d));
  eqAll(`formatMoneyL(n, ${d}, 'es') === formatMoney(n, ${d})  (US money in Spanish)`, moneyInputs, (n) => formatMoneyL(n, d, 'es'), (n) => formatMoney(n, d));
  eqAll(`formatNumberL(n, ${d}, 'en') === formatNumber(n, ${d})`, moneyInputs, (n) => formatNumberL(n, d, 'en'), (n) => formatNumber(n, d));
  eqAll(`formatNumberL(n, ${d}, 'es') === formatNumber(n, ${d})`, moneyInputs, (n) => formatNumberL(n, d, 'es'), (n) => formatNumber(n, d));
}
eqAll(`formatMoneyShortL(n, 'en') === formatMoneyShort(n)`, moneyInputs, (n) => formatMoneyShortL(n, 'en'), (n) => formatMoneyShort(n));
eqAll(`formatMoneyShortL(n, 'es') === formatMoneyShort(n)`, moneyInputs, (n) => formatMoneyShortL(n, 'es'), (n) => formatMoneyShort(n));

const centsInputs: number[] = [0, 1, -1, 5, 49, 50, 51, 99, 100, 101, -49, -50, -51, -99, 150, 250, -250, 123450, 123449, 123451, -123450, 100000000, 999999999];
for (let i = 0; i < 4000; i++) centsInputs.push(randInt(-500_000_000, 500_000_000));
for (let i = 0; i < 500; i++) centsInputs.push(randInt(-2000, 2000) * 100 + 50); // exact halves
eqAll(`formatMoneyCentsL(c, 'en', {decimals: 2}) === formatMoney(c / 100, 2)`, centsInputs, (c) => formatMoneyCentsL(c, 'en', { decimals: 2 }), (c) => formatMoney(c / 100, 2));
eqAll(`formatMoneyCentsL(c, 'en', {decimals: 0}) === formatMoney(c / 100, 0)  (V8 half-expand)`, centsInputs, (c) => formatMoneyCentsL(c, 'en', { decimals: 0 }), (c) => formatMoney(c / 100, 0));
eqAll(`formatMoneyCentsL(c, 'es') === formatMoneyCentsL(c, 'en')`, centsInputs, (c) => formatMoneyCentsL(c, 'es'), (c) => formatMoneyCentsL(c, 'en'));
ok(`formatMoneyCentsL rounds halves up in cents (iOS half-even drift avoided): 123450 → $1,235`, formatMoneyCentsL(123450, 'en', { decimals: 0 }) === '$1,235');
ok(`formatMoneyCentsL non-finite → $0.00`, formatMoneyCentsL(NaN, 'en') === '$0.00' && formatMoneyCentsL(undefined, 'en') === '$0.00');

// Dates
const dates: Date[] = [
  new Date(2026, 8, 27, 15, 5), new Date(2026, 0, 1, 0, 0), new Date(2026, 11, 31, 23, 59),
  new Date(2024, 1, 29, 12, 0), new Date(1999, 6, 4, 9, 7), new Date(2030, 2, 10, 2, 30), new Date(NaN),
];
for (let i = 0; i < 150; i++) dates.push(new Date(randInt(946684800000, 2208988800000)));
const dateOptionSets: Intl.DateTimeFormatOptions[] = [
  ...Object.values(DATE_STYLE_OPTIONS),
  {}, { month: 'short' }, { month: 'long' }, { day: 'numeric' }, { year: 'numeric' },
  { month: 'numeric', day: 'numeric' }, { month: 'numeric', day: 'numeric', year: 'numeric' },
  { month: '2-digit', day: '2-digit', year: '2-digit' }, { weekday: 'short' }, { weekday: 'narrow' },
  { month: 'short', year: 'numeric' }, { weekday: 'long', month: 'short', day: 'numeric' },
  { month: 'short', day: 'numeric', timeZone: 'UTC' }, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' },
  { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
];
const datePairs: Array<[Date, Intl.DateTimeFormatOptions]> = [];
for (const d of dates) for (const o of dateOptionSets) datePairs.push([d, o]);
eqAll(`formatDateOptsL(d, opts, 'en') === d.toLocaleDateString('en-US', opts)`, datePairs, ([d, o]) => formatDateOptsL(d, o, 'en'), ([d, o]) => d.toLocaleDateString('en-US', o));
const styles = Object.keys(DATE_STYLE_OPTIONS) as DateStyle[];
const stylePairs: Array<[Date, DateStyle]> = [];
for (const d of dates) for (const s of styles) stylePairs.push([d, s]);
eqAll(`formatDateL(d, style, 'en') === toLocaleDateString('en-US', STYLE)`, stylePairs, ([d, s]) => formatDateL(d, s, 'en'), ([d, s]) => d.toLocaleDateString('en-US', DATE_STYLE_OPTIONS[s]));
eqAll(`formatDateL accepts ISO strings and ms like new Date() does`, dates.filter((d) => Number.isFinite(d.getTime())), (d) => formatDateL(d.toISOString(), 'dayYear', 'en') + '|' + formatDateL(d.getTime(), 'day', 'en'), (d) => d.toLocaleDateString('en-US', DATE_STYLE_OPTIONS.dayYear) + '|' + d.toLocaleDateString('en-US', DATE_STYLE_OPTIONS.day));

const calValues: (string | null | undefined)[] = ['', null, undefined, 'garbage', '2026-13-01', '2026-02-30', '2026-09-27', '2026-09-27T00:00:00.000Z', '2024-02-29', '1999-12-31T23:59:59Z'];
for (let i = 0; i < 200; i++) {
  const d = new Date(randInt(946684800000, 2208988800000));
  calValues.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
}
const calOpts: (Intl.DateTimeFormatOptions | undefined)[] = [undefined, ...dateOptionSets.filter((o) => !o.timeZone && !o.hour)];
const calPairs: Array<[string | null | undefined, Intl.DateTimeFormatOptions | undefined]> = [];
for (const v of calValues) for (const o of calOpts) calPairs.push([v, o]);
eqAll(`formatCalendarDayL(v, opts, 'en') === formatCalendarDay(v, opts)`, calPairs, ([v, o]) => formatCalendarDayL(v, o, 'en'), ([v, o]) => (o ? formatCalendarDay(v, o) : formatCalendarDay(v)));

const timeOpts: Intl.DateTimeFormatOptions[] = [
  { hour: 'numeric', minute: '2-digit' }, { hour: '2-digit', minute: '2-digit' },
  { hour: 'numeric', minute: '2-digit', second: '2-digit' }, { hour: 'numeric', minute: '2-digit', hour12: false },
];
eqAll(`formatTimeL(d, 'en') === d.toLocaleTimeString('en-US', {hour:'numeric', minute:'2-digit'})`, dates, (d) => formatTimeL(d, 'en'), (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
const timePairs: Array<[Date, Intl.DateTimeFormatOptions]> = [];
for (const d of dates) for (const o of timeOpts) timePairs.push([d, o]);
eqAll(`formatTimeL(d, 'en', opts) === d.toLocaleTimeString('en-US', opts)`, timePairs, ([d, o]) => formatTimeL(d, 'en', o), ([d, o]) => d.toLocaleTimeString('en-US', o));
eqAll(`formatWeekdayL(d, w, 'en') === toLocaleDateString('en-US', {weekday})`, dates, (d) => formatWeekdayL(d, 'short', 'en') + formatWeekdayL(d, 'long', 'en'), (d) => d.toLocaleDateString('en-US', { weekday: 'short' }) + d.toLocaleDateString('en-US', { weekday: 'long' }));

const nowBase = new Date(2026, 8, 27, 14, 0).getTime();
const relPairs: Array<[string, number]> = [['not a date', nowBase], ['', nowBase]];
const offsets = [0, 30_000, 59_999, 60_000, 61_000, 5 * 60_000, 59 * 60_000, 3_600_000, 2 * 3_600_000, 13 * 3_600_000, 14 * 3_600_000, 15 * 3_600_000, 23 * 3_600_000, 24 * 3_600_000, 30 * 3_600_000, 47 * 3_600_000, 3 * 86_400_000, 6 * 86_400_000, 7 * 86_400_000, 40 * 86_400_000, 400 * 86_400_000, -120_000];
for (const off of offsets) relPairs.push([new Date(nowBase - off).toISOString(), nowBase]);
for (let i = 0; i < 3000; i++) {
  const now = randInt(1_700_000_000_000, 1_900_000_000_000);
  relPairs.push([new Date(now - randInt(-600_000, 800 * 86_400_000)).toISOString(), now]);
}
eqAll(`formatRelativeL(iso, now, 'en') === relativeTime(iso, now)`, relPairs, ([i, n]) => formatRelativeL(i, n, 'en'), ([i, n]) => relativeTime(i, n));
eqAll(`renderRelative(relativeParts(iso, now), 'en') === relativeTime(iso, now)  (es uses the same buckets)`, relPairs, ([i, n]) => renderRelative(relativeParts(i, n), 'en'), ([i, n]) => relativeTime(i, n));

const words = ['apple', 'Zebra', 'ñandú', 'nube', 'Éclair', 'eclair', 'a', 'A', '', '10', '9', 'Óscar', 'oscar'];
const cmpPairs: Array<[string, string]> = [];
for (const a of words) for (const b of words) cmpPairs.push([a, b]);
eqAll(`compareL(a, b, 'en') === a.localeCompare(b)`, cmpPairs, ([a, b]) => String(Math.sign(compareL(a, b, 'en'))), ([a, b]) => String(Math.sign(a.localeCompare(b))));

// t() / tn() in English return the inline English.
const tStrings: string[] = [
  ...Object.values(en).flatMap((v) => (typeof v === 'string' ? [v] : [v.one, v.other])),
  'Save', '', ' leading and trailing ', 'Crew’s “smart” quotes — dash…', 'Emoji-free ✓ ✗', 'Tab\tNewline\nEnd',
  'Price: $1,234.50', '100%', 'a/b', 'C:\\path', 'Español ñ á é í ó ú ü', '日本語',
];
eqAll(`t(key, en, undefined, 'en') === en  (no-brace strings untouched)`, tStrings.filter((s) => !/[{}]/.test(s)), (s) => t('common.x', s, undefined, 'en'), (s) => s);
const varCases: Array<[string, Record<string, string | number>, string]> = [
  ['Assigned to {name}', { name: 'Luis' }, 'Assigned to Luis'],
  ['{count} of {total} done', { count: 3, total: 10 }, '3 of 10 done'],
  ['{a}{a}', { a: 'x' }, 'xx'],
  ['Keep {unknown} as-is', { name: 'z' }, 'Keep {unknown} as-is'],
  ['Literal {{braces}}', {}, 'Literal {braces}'],
  ['Money {amount}', { amount: formatMoney(1234.5, 2) }, 'Money $1,234.50'],
  ['Zero {n}', { n: 0 }, 'Zero 0'],
  ['Dollar sign $& {v}', { v: '$1' }, 'Dollar sign $& $1'],
];
eqAll(`interpolate() matches the template-literal result`, varCases, ([s, v]) => t('common.x', s, v, 'en'), ([, , want]) => want);
const plural: PluralForms = { one: '{count} item', other: '{count} items' };
const counts = [-2, -1, 0, 1, 2, 3, 1.5, 0.5, 10, 1_000_000, 21];
eqAll(`tn(key, n, forms, undefined, 'en') === (n === 1 ? one : other) with {count}`, counts, (n) => tn('common.x', n, plural, undefined, 'en'), (n) => (n === 1 ? `${n} item` : `${n} items`));
ok(`tn zero override`, tn('common.x', 0, { zero: 'No items', one: '{count} item', other: '{count} items' }, undefined, 'en') === 'No items');

// Module state defaults to English and ignores junk.
ok(`default module language is 'en'`, getLang() === 'en' && getDisplayLang() === 'en');
setLang('fr' as never);
ok(`setLang ignores an unknown code`, getDisplayLang() === 'en');
setLang('xx');
ok(`pseudo formats as English (getLang() === 'en')`, getLang() === 'en' && getDisplayLang() === 'xx');
setLang('es');
ok(`setLang('es') → getLang() === 'es'`, getLang() === 'es');
ok(`t() without an explicit lang follows the module language`, t('field.dfr.weather', 'Weather') === 'Clima');
setLang('en');
ok(`back to English`, t('field.dfr.weather', 'Weather') === 'Weather');

// ═════════════════════════════════════════════════════════════════════════
section('B. Catalog integrity (en / es / pseudo)');

const enKeys = Object.keys(en);
const esKeys = Object.keys(es);
console.log(`  en ${enKeys.length} keys · es ${esKeys.length} keys`);
const KEY_RE = /^([a-z]+)\.[A-Za-z0-9]+(\.[A-Za-z0-9]+)*$/;
for (const k of enKeys) {
  const m = KEY_RE.exec(k);
  ok(`key format <area>.<surface>.<slug>: ${k}`, !!m && (I18N_AREAS as readonly string[]).includes(m[1]));
}
for (const k of esKeys) ok(`no orphan es key (exists in en): ${k}`, k in en);

// Coverage: complete surfaces need every key translated.
for (const s of SURFACES) {
  for (const f of s.files) ok(`surface ${s.id}: file exists ${f}`, existsSync(join(ROOT, f)));
  if (s.state === 'pending') continue;
  const owned = enKeys.filter((k) => s.keyPrefixes.some((p) => k.startsWith(p)));
  ok(`surface ${s.id}: owns at least one key`, owned.length > 0);
  if (s.state === 'complete') {
    const missing = owned.filter((k) => !(k in es));
    ok(`surface ${s.id} (complete): every key has Spanish`, missing.length === 0, `missing: ${missing.join(', ')}`);
  }
}

const FORM_KEYS = new Set(['zero', 'one', 'many', 'other']);
const stale: string[] = [];
for (const k of esKeys) {
  const e = es[k];
  const ev = en[k];
  if (ev === undefined) continue;
  const enPlural = isPluralForms(ev);
  const esPlural = isPluralForms(e.s);
  ok(`${k}: es shape matches en (${enPlural ? 'plural' : 'string'})`, enPlural === esPlural);
  ok(`${k}: es text is non-empty`, esPlural ? !!(e.s as PluralForms).one && !!(e.s as PluralForms).other : typeof e.s === 'string' && e.s.trim().length > 0);
  ok(`${k}: src is 8-hex`, /^[0-9a-f]{8}$/.test(e.src));
  if (e.src !== sourceHash(ev)) stale.push(k);
  if (/LEGAL_PINNED/.test(e.note ?? '')) ok(`${k}: LEGAL_PINNED entry has reviewedBy`, !!e.reviewedBy);

  // Placeholders
  const enPh = new Set(enPlural ? Object.values(ev as PluralForms).flatMap((s) => placeholdersOf(s ?? '')) : placeholdersOf(ev as string));
  const esPh = new Set(esPlural ? Object.values(e.s as PluralForms).flatMap((s) => placeholdersOf(s ?? '')) : placeholdersOf(e.s as string));
  if (enPlural) { enPh.add('count'); esPh.add('count'); }
  ok(`${k}: placeholders match en ⇄ es`, [...enPh].sort().join(',') === [...esPh].sort().join(','), `en {${[...enPh].join(',')}} es {${[...esPh].join(',')}}`);
}
for (const k of enKeys) {
  const v = en[k];
  if (!isPluralForms(v)) {
    ok(`${k}: en string is non-empty`, typeof v === 'string' && v.length > 0);
    continue;
  }
  // ICU-style plural validity
  ok(`${k}: en plural has only zero/one/other (English has no "many")`, Object.keys(v).every((f) => f !== 'many' && FORM_KEYS.has(f)));
  const e = es[k]?.s;
  if (isPluralForms(e)) ok(`${k}: es plural forms ⊆ {zero, one, many, other} with one + other`, Object.keys(e).every((f) => FORM_KEYS.has(f)) && !!e.one && !!e.other);
  for (const lang of ['en', 'es'] as Lang[]) {
    const forms = lang === 'en' ? v : (isPluralForms(e) ? e : v);
    for (const n of [0, 1, 2, 5, 1_000_000]) {
      const out = selectPluralForm(lang, n, forms);
      ok(`${k}: ${lang} form for ${n} is a string`, typeof out === 'string' && out.length > 0);
    }
  }
}
if (stale.length) {
  const strictStale = stale.filter((k) => STRICT || k.startsWith('safety.'));
  for (const k of stale) {
    const msg = `stale translation: ${k} (English changed since it was translated — re-review the Spanish, then set src to ${sourceHash(en[k])})`;
    if (strictStale.includes(k)) ok(msg, false);
    else warn(msg);
  }
} else {
  console.log('  ✓ no stale translations');
}

// Tab labels fit the tab bar in Spanish (glossary §4: ≤ 10 characters).
for (const k of enKeys.filter((k) => k.startsWith('nav.tab.'))) {
  const s = es[k]?.s;
  ok(`${k}: Spanish tab label ≤ 10 characters ("${String(s)}")`, typeof s === 'string' && [...s].length <= 10);
}

// Pseudo-locale parity: every en string produces a bracketed, padded,
// fully-accented pseudo string with its placeholders intact.
let pseudoBad = 0;
for (const k of enKeys) {
  const v = en[k];
  for (const s of isPluralForms(v) ? Object.values(v).filter((x): x is string => typeof x === 'string') : [v as string]) {
    const p = pseudoize(s);
    const phOk = placeholdersOf(p).sort().join(',') === placeholdersOf(s).sort().join(',');
    const stripped = p.replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/g, '');
    const asciiLeft = /[A-Za-z]/.test(stripped);
    const bracketed = p.startsWith(PSEUDO_OPEN) && p.endsWith(PSEUDO_CLOSE);
    const longer = [...p].length >= Math.ceil([...s].length * 1.3);
    if (!(phOk && !asciiLeft && bracketed && longer)) {
      pseudoBad++;
      console.error(`  ✗ pseudo ${k}: ${JSON.stringify(s)} → ${JSON.stringify(p)} (placeholders ${phOk}, ascii-free ${!asciiLeft}, bracketed ${bracketed}, ≥1.3× ${longer})`);
    }
    checks++;
  }
}
if (pseudoBad) failures++;
else console.log(`  ✓ pseudo-locale: every en string accented, padded ≥1.3×, bracketed, placeholders intact`);
ok(`t(key, en, vars, 'xx') interpolates the pseudo template`, t('field.punch.assignedTo', 'Assigned to {name}', { name: 'Luis' }, 'xx').includes('Luis'));

// ═════════════════════════════════════════════════════════════════════════
section('C. Plural rules agree with ICU (Hermes has no Intl.PluralRules)');

const icu = { en: new Intl.PluralRules('en'), es: new Intl.PluralRules('es') };
const pluralInputs: number[] = [0, 1, 2, 3, 5, 10, 11, 21, 100, 101, 999_999, 1_000_000, 1_000_001, 2_000_000, 5_000_000, 1_000_000_000, -1, -2, -1_000_000, 0.5, 1.5, 2.25, 1_000_000.5];
for (let i = 0; i <= 3000; i++) pluralInputs.push(i);
for (let i = 0; i < 2000; i++) pluralInputs.push(randInt(0, 50) * 1_000_000 + (rand() < 0.5 ? 0 : randInt(1, 999_999)));
// en agrees with CLDR for every n ≥ 0; below zero it follows the app's
// `n === 1` ternaries instead (CLDR's "-1 item" would change today's English).
eqAll(`pluralCategory('en', n) === new Intl.PluralRules('en').select(n)  (n ≥ 0)`, pluralInputs.filter((n) => n >= 0), (n) => pluralCategory('en', n), (n) => icu.en.select(n));
eqAll(`pluralCategory('en', n) === (n === 1 ? 'one' : 'other')  (the inline-ternary rule, all n)`, pluralInputs, (n) => pluralCategory('en', n), (n) => (n === 1 ? 'one' : 'other'));
eqAll(`pluralCategory('es', n) === new Intl.PluralRules('es').select(n)`, pluralInputs, (n) => pluralCategory('es', n), (n) => icu.es.select(n));

// ═════════════════════════════════════════════════════════════════════════
section('D. Spanish formatting goldens');

const sep27 = new Date(2026, 8, 27, 15, 5);
const goldens: Array<[string, string, string]> = [
  ['formatDateL day', formatDateL(sep27, 'day', 'es'), '27 sept'],
  ['formatDateL dayYear', formatDateL(sep27, 'dayYear', 'es'), '27 sept 2026'],
  ['formatDateL weekdayDay', formatDateL(sep27, 'weekdayDay', 'es'), 'dom 27 sept'],
  ['formatDateL long', formatDateL(sep27, 'long', 'es'), 'domingo, 27 de septiembre de 2026'],
  ['formatDateL monthYear', formatDateL(sep27, 'monthYear', 'es'), 'septiembre de 2026'],
  ['formatDateL weekday', formatDateL(sep27, 'weekday', 'es'), 'domingo'],
  ['numeric month becomes a name', formatDateOptsL(sep27, { month: 'numeric', day: 'numeric' }, 'es'), '27 sept'],
  ['numeric full date becomes a name', formatDateOptsL(sep27, { month: 'numeric', day: 'numeric', year: 'numeric' }, 'es'), '27 sept 2026'],
  ['empty options → dayYear', formatDateOptsL(sep27, {}, 'es'), '27 sept 2026'],
  ['date + time', formatDateOptsL(sep27, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }, 'es'), '27 sept, 3:05 p.m.'],
  ['timeZone UTC', formatDateOptsL(Date.UTC(2026, 8, 27, 2), { month: 'short', day: 'numeric', timeZone: 'UTC' }, 'es'), '27 sept'],
  ['timeZone New York', formatDateOptsL(Date.UTC(2026, 8, 27, 2), { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' }, 'es'), 'sáb 26 sept'],
  ['January 1', formatDateL(new Date(2026, 0, 1), 'long', 'es'), 'jueves, 1 de enero de 2026'],
  ['Wednesday short', formatDateL(new Date(2026, 8, 30), 'weekdayDay', 'es'), 'mié 30 sept'],
  ['time pm', formatTimeL(sep27, 'es'), '3:05 p.m.'],
  ['time midnight', formatTimeL(new Date(2026, 8, 27, 0, 7), 'es'), '12:07 a.m.'],
  ['time noon', formatTimeL(new Date(2026, 8, 27, 12, 0), 'es'), '12:00 p.m.'],
  ['time 24h', formatTimeL(sep27, 'es', { hour: 'numeric', minute: '2-digit', hour12: false }), '15:05'],
  ['weekday short', formatWeekdayL(sep27, 'short', 'es'), 'dom'],
  ['calendar day', formatCalendarDayL('2026-09-27', undefined, 'es'), '27 sept 2026'],
  ['calendar day ISO', formatCalendarDayL('2026-09-27T00:00:00.000Z', { weekday: 'long', month: 'long', day: 'numeric' }, 'es'), 'domingo, 27 de septiembre'],
  ['calendar day empty', formatCalendarDayL('', undefined, 'es'), ''],
  ['calendar day unparseable is returned as-is', formatCalendarDayL('garbage', undefined, 'es'), 'garbage'],
  ['invalid date', formatDateL(new Date(NaN), 'day', 'es'), 'Fecha no válida'],
  ['relative just now', formatRelativeL(new Date(nowBase - 10_000).toISOString(), nowBase, 'es'), 'ahora mismo'],
  ['relative 5 min', formatRelativeL(new Date(nowBase - 5 * 60_000).toISOString(), nowBase, 'es'), 'hace 5 min'],
  ['relative 2 h', formatRelativeL(new Date(nowBase - 2 * 3_600_000).toISOString(), nowBase, 'es'), 'hace 2 h'],
  ['relative yesterday', formatRelativeL(new Date(nowBase - 30 * 3_600_000).toISOString(), nowBase, 'es'), 'ayer'],
  ['relative 3 days', formatRelativeL(new Date(nowBase - 3 * 86_400_000).toISOString(), nowBase, 'es'), 'hace 3 días'],
  ['relative older this year', formatRelativeL(new Date(2026, 7, 3, 9).toISOString(), nowBase, 'es'), '3 ago'],
  ['relative older last year', formatRelativeL(new Date(2025, 11, 25, 9).toISOString(), nowBase, 'es'), '25 dic 2025'],
  ['money cents', formatMoneyCentsL(123456789, 'es'), '$1,234,567.89'],
  ['money negative', formatMoneyCentsL(-150, 'es'), '-$1.50'],
];
for (const [label, got, want] of goldens) ok(`es ${label}: ${JSON.stringify(want)}`, got === want, `got ${JSON.stringify(got)}`);

let numericHits = 0;
for (const [d, o] of datePairs) {
  if (!Number.isFinite(d.getTime())) continue;
  const s = formatDateOptsL(d, o, 'es');
  checks++;
  if (/\d{1,2}\/\d{1,2}/.test(s)) {
    numericHits++;
    if (numericHits === 1) console.error(`  ✗ numeric date in Spanish: ${JSON.stringify(o)} → ${s}`);
  }
}
if (numericHits) failures++;
else console.log(`  ✓ no numeric (d/m) date in any Spanish output (${datePairs.length} date × option pairs)`);

// t / tn in Spanish
ok(`es t(): catalog hit`, t('field.dfr.weather', 'Weather', undefined, 'es') === 'Clima');
ok(`es t(): missing key falls back to the inline English (never the key)`, t('field.dfr.notARealKey', 'Inline English', undefined, 'es') === 'Inline English');
ok(`es t(): interpolates`, t('field.punch.assignedTo', 'Assigned to {name}', { name: 'Luis' }, 'es') === 'Asignado a Luis');
ok(`es tn(): one`, tn('field.punch.openCount', 1, { one: '{count} open item', other: '{count} open items' }, undefined, 'es') === '1 pendiente abierto');
ok(`es tn(): other`, tn('field.punch.openCount', 3, { one: '{count} open item', other: '{count} open items' }, undefined, 'es') === '3 pendientes abiertos');
ok(`es tn(): 0 is other`, tn('field.punch.openCount', 0, { one: '{count} open item', other: '{count} open items' }, undefined, 'es') === '0 pendientes abiertos');
ok(`es tn(): many falls back to other`, tn('field.punch.openCount', 1_000_000, { one: '{count} open item', other: '{count} open items' }, undefined, 'es') === '1000000 pendientes abiertos');
ok(`es tn(): missing key → English forms`, tn('field.x.none', 2, { one: '{count} thing', other: '{count} things' }, undefined, 'es') === '2 things');
{
  const restore = __setEsCatalogForTest({ 'field.x.shape': { s: 'cadena', src: fnv1a32('x') } });
  ok(`es tn(): a string entry for a plural key falls back to English (never half-plural)`, tn('field.x.shape', 2, { one: '{count} a', other: '{count} b' }, undefined, 'es') === '2 b');
  restore();
}

// ═════════════════════════════════════════════════════════════════════════
section('E. Glossary + voice lint on the Spanish text');

const L = (w: string, flags = 'iu') => new RegExp(`(?<![\\p{L}\\p{N}])(?:${w})(?![\\p{L}\\p{N}])`, flags);
const FORBIDDEN: Array<{ re: RegExp; why: string; except?: (k: string) => boolean }> = [
  { re: L('vosotros|vosotras|os'), why: 'Spain vosotros forms' },
  { re: L('hormigón'), why: 'Spain word: use "concreto"' },
  { re: L('fontaner[oa]s?|fontanería'), why: 'Spain word: use "plomero / plomería"' },
  { re: L('ordenador(es)?'), why: 'Spain word: use "computadora"' },
  { re: L('móvil(es)?'), why: 'Spain word: use "celular"' },
  { re: L('vale'), why: 'Spain word' },
  { re: L('coger|coge|cogí|cogió'), why: 'offensive in Latin America' },
  { re: L('pulse|pulsa|pulsar'), why: 'Spain form: use "toca / toque"' },
  { re: L('añadir|añade|añada'), why: 'use "Agregar" (Mexican / US norm)' },
  { re: L('estimaci[oó]n(es)?'), why: '"estimación" is a pay app in Mexico: use "estimado"', except: (k) => k.startsWith('money.payApp.') },
  { re: L('bitácora'), why: '"bitácora" is a legal site log in Mexico: use "reporte diario"' },
  { re: L('peón|peones'), why: 'can read as demeaning: use "trabajador / ayudante"' },
  { re: L('sobreprecio'), why: 'reads as overcharging: use "recargo"' },
  { re: L('OT', 'u'), why: 'never "OT" for overtime: "horas extra"' },
  { re: /\d{1,2}\/\d{1,2}(\/\d{2,4})?/u, why: 'numeric date in Spanish text' },
];
const VERB_ENDING = /(?<![\p{L}])(\p{L}+(?:áis|éis))(?![\p{L}])/iu;
const VERB_ENDING_OK = new Set(['dieciséis', 'veintiséis']);
const IN_APP_USTED = L('usted|ud\\.?');
const OUTBOUND_TU = L('tú|tu|tus|te|ti|contigo');
const OUTBOUND_AREAS = ['outbound.', 'email.', 'portal.'];

function esStrings(e: CatalogValue): string[] {
  return isPluralForms(e) ? Object.values(e).filter((x): x is string => typeof x === 'string') : [e];
}
let lintBad = 0;
for (const k of esKeys) {
  for (const s of esStrings(es[k].s)) {
    for (const f of FORBIDDEN) {
      if (f.except?.(k)) continue;
      const m = f.re.exec(s);
      if (m) { lintBad++; ok(`${k}: "${m[0]}" — ${f.why}`, false, s); }
    }
    const v = VERB_ENDING.exec(s);
    if (v && !VERB_ENDING_OK.has(v[1].toLowerCase())) { lintBad++; ok(`${k}: "${v[1]}" — Spain -áis/-éis verb ending`, false, s); }
    if (k.includes('.crew.') && L('equipo').test(s)) { lintBad++; ok(`${k}: "equipo" in a crew key — use "cuadrilla"`, false, s); }
    const outbound = OUTBOUND_AREAS.some((p) => k.startsWith(p));
    if (!outbound && IN_APP_USTED.test(s)) { lintBad++; ok(`${k}: usted in an in-app string (in-app is tú)`, false, s); }
    if (outbound) {
      const m = OUTBOUND_TU.exec(s);
      if (m) { lintBad++; ok(`${k}: tú form "${m[0]}" in an outbound string (outbound is usted)`, false, s); }
    }
  }
}
checks++;
if (!lintBad) console.log(`  ✓ ${esKeys.length} Spanish entries pass the glossary and voice lint`);
// The lint must actually catch things (guards against a regex that matches nothing).
ok(`lint self-test: catches "hormigón"`, FORBIDDEN[1].re.test('Vaciar hormigón'));
ok(`lint self-test: catches "estimación" but not "estimado"`, FORBIDDEN[9].re.test('Nueva estimación') && !FORBIDDEN[9].re.test('Nuevo estimado'));
ok(`lint self-test: accented word boundary works ("dólares" as a whole word)`, L('dólares').test('100 dólares.') && !L('dólar').test('dólares'));
ok(`lint self-test: catches tú in outbound, not "tuvo"`, OUTBOUND_TU.test('Revisa tu plan') && !OUTBOUND_TU.test('Se tuvo que parar'));
ok(`lint self-test: -éis ending caught, dieciséis allowed`, !!VERB_ENDING.exec('tenéis') && VERB_ENDING_OK.has('dieciséis'));

// ═════════════════════════════════════════════════════════════════════════
section('F. Wiring: storage, resolution, recipients, AI rule, module scope');

const storageSrc = readFileSync(join(ROOT, 'utils/languageStorage.ts'), 'utf8');
const keyMatch = /LANGUAGE_STORAGE_KEY\s*=\s*'([^']+)'/.exec(storageSrc);
ok(`storage key is 'mageid_language'`, keyMatch?.[1] === 'mageid_language', keyMatch?.[1]);
ok(`storage key uses an allowed APP_STORAGE_PREFIXES prefix (test:storage-hygiene)`, !!keyMatch && isAppStorageKey(keyMatch[1]));

const resolveCases: Array<[string, Parameters<typeof resolveLanguage>[0], boolean, string]> = [
  ['nothing → en/default', {}, true, 'en/default'],
  ['server wins over stored and device', { server: 'es', stored: 'en', device: 'en-US' }, true, 'es/server'],
  ['stored when no server', { stored: 'es', device: 'en-US' }, true, 'es/stored'],
  ['stored beats device', { stored: 'en', device: 'es-MX' }, true, 'en/stored'],
  ['junk stored is ignored (never guessed)', { stored: 'spanish', device: 'en-US' }, false, 'en/default'],
  ['junk server is ignored', { server: 'es-MX', stored: 'es' }, true, 'es/stored'],
  ['device es-MX → es when auto-detect on', { device: 'es-MX' }, true, 'es/device'],
  ['device es_US (Android) → es', { device: 'es_US' }, true, 'es/device'],
  ['device es-419 → es', { device: 'es-419' }, true, 'es/device'],
  ['device fr-FR → en', { device: 'fr-FR' }, true, 'en/device'],
  ['device ignored when auto-detect off', { device: 'es-MX', intl: 'es-MX' }, false, 'en/default'],
  ['intl hint when no device', { intl: 'es-US' }, true, 'es/intl'],
  ['device beats intl (iOS trap)', { device: 'es-MX', intl: 'en-US' }, true, 'es/device'],
];
for (const [label, inputs, auto, want] of resolveCases) {
  const r = resolveLanguage(inputs, { autoDetect: auto });
  ok(`resolveLanguage: ${label}`, `${r.lang}/${r.source}` === want, `${r.lang}/${r.source}`);
}
ok(`resolveLanguage default follows AUTO_DETECT_DEVICE (off → a Spanish phone still opens in English)`, resolveLanguage({ device: 'es-MX' }).lang === 'en');
ok(`normalizeLang`, normalizeLang('ES') === 'es' && normalizeLang('es-MX') === 'es' && normalizeLang('en-GB') === 'en' && normalizeLang('') === null && normalizeLang(3) === null && normalizeLang('est') === 'en');
ok(`parseStoredLang is strict`, parseStoredLang('es') === 'es' && parseStoredLang('ES') === null && parseStoredLang('es-MX') === null);

const recipientCases: Array<[string, Parameters<typeof recipientLanguage>[0], Lang]> = [
  ['nothing → en (never guess an outsider)', {}, 'en'],
  ['recipient record', { recipient: { preferred_language: 'es' } }, 'es'],
  ['explicit override beats record', { explicit: 'en', recipient: { preferred_language: 'es' } }, 'en'],
  ['junk record ignored', { recipient: { preferred_language: 'Spanish' } }, 'en'],
  ['homeowner es', { homeownerLanguage: 'es' }, 'es'],
  ['homeowner zh → en for app-rendered text', { homeownerLanguage: 'zh' }, 'en'],
  ['record beats homeowner', { recipient: { preferred_language: 'en' }, homeownerLanguage: 'es' }, 'en'],
  ['null recipient', { recipient: null }, 'en'],
];
for (const [label, input, want] of recipientCases) ok(`recipientLanguage: ${label}`, recipientLanguage(input) === want);

// AI reply-language rule (edge)
for (const v of [undefined, null, '', 'en', 'EN', 'en-US', 'fr', 42, {}, 'spanish']) {
  ok(`replyLanguageRule(${JSON.stringify(v)}) === '' (English prompt byte-identical)`, replyLanguageRule(v) === '');
}
for (const v of ['es', 'ES', 'es-MX', 'es_US']) ok(`parseReplyLocale(${JSON.stringify(v)}) === 'es'`, parseReplyLocale(v) === 'es');
const rule = replyLanguageRule('es');
for (const must of ['REPLY LANGUAGE', 'JSON keys', 'enum values', 'dollar amounts', 'building-code citations', 'quoted source', 'usted', 'never invent', 'cuadrilla', 'never a numeric date']) {
  ok(`es reply rule mentions "${must}"`, rule.includes(must));
}
ok(`es reply rule starts on a new section ("\\n\\n")`, rule.startsWith('\n\nREPLY LANGUAGE'));
ok(`edge AI_GLOSSARY_ES is an exact copy of i18n/aiGlossary.ts`, JSON.stringify(EDGE_GLOSSARY) === JSON.stringify(AI_GLOSSARY_ES), 'edit i18n/aiGlossary.ts and paste the array into supabase/functions/_shared/replyLanguage.ts');
ok(`AI glossary ≤ 60 terms (prompt size)`, AI_GLOSSARY_ES.length <= 60, String(AI_GLOSSARY_ES.length));
const edgeSrc = readFileSync(join(ROOT, 'supabase/functions/_shared/replyLanguage.ts'), 'utf8');
ok(`edge replyLanguage.ts has no imports (pure, Deno-safe)`, !/^\s*import\s/m.test(edgeSrc));

// The pure i18n modules must load under bun, the Hermes gate and (by copy) Deno.
const I18N_DIR = join(ROOT, 'i18n');
const RN_ALLOWED = new Set(['device.ts']);
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
for (const f of walk(I18N_DIR)) {
  const src = stripComments(readFileSync(f, 'utf8'));
  const rel = relative(ROOT, f);
  const base = f.slice(f.lastIndexOf('/') + 1);
  if (!RN_ALLOWED.has(base)) {
    ok(`${rel}: pure (no react-native / async-storage import)`, !/from ['"](react-native|@react-native-async-storage\/async-storage)['"]/.test(src));
  }
  ok(`${rel}: does not use Intl.PluralRules / RelativeTimeFormat / ListFormat (absent on Hermes)`, !/Intl\.(PluralRules|RelativeTimeFormat|ListFormat|DisplayNames|Segmenter)/.test(src));
}

// No t()/tn() at module scope in any file that imports the layer.
const SCAN_DIRS = ['app', 'components', 'contexts', 'hooks', 'utils', 'constants', 'lib', 'i18n'];
const IMPORTS_I18N = /from ['"](@\/i18n(\/[a-z]+)?|\.{1,2}\/(\.\.\/)*i18n(\/[a-z]+)?|@\/contexts\/LanguageContext|\.{1,2}\/(\.\.\/)*contexts\/LanguageContext|\.\/core)['"]/;
const FN_KINDS = new Set([
  ts.SyntaxKind.FunctionDeclaration, ts.SyntaxKind.FunctionExpression, ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration, ts.SyntaxKind.Constructor, ts.SyntaxKind.GetAccessor, ts.SyntaxKind.SetAccessor,
]);
let scanned = 0;
const moduleScopeHits: string[] = [];
for (const d of SCAN_DIRS) {
  const abs = join(ROOT, d);
  if (!existsSync(abs)) continue;
  for (const f of walk(abs)) {
    const src = readFileSync(f, 'utf8');
    if (!IMPORTS_I18N.test(src)) continue;
    scanned++;
    const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, f.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node: ts.Node, inFn: boolean) => {
      const nowInFn = inFn || FN_KINDS.has(node.kind);
      if (!nowInFn && ts.isCallExpression(node) && ts.isIdentifier(node.expression) && (node.expression.text === 't' || node.expression.text === 'tn')) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
        moduleScopeHits.push(`${relative(ROOT, f)}:${line + 1}`);
      }
      ts.forEachChild(node, (c) => visit(c, nowInFn));
    };
    visit(sf, false);
  }
}
ok(`no t()/tn() at module scope (${scanned} importing files scanned) — a constant freezes the language at import`, moduleScopeHits.length === 0, moduleScopeHits.join(', '));
{
  // Self-test of the scanner on a synthetic file.
  const sf = ts.createSourceFile('x.ts', "import { t } from '@/i18n';\nconst BAD = t('common.a', 'A');\nfunction good() { return t('common.b', 'B'); }\n", ts.ScriptTarget.Latest, true);
  let hits = 0;
  const visit = (node: ts.Node, inFn: boolean) => {
    const nowInFn = inFn || FN_KINDS.has(node.kind);
    if (!nowInFn && ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't') hits++;
    ts.forEachChild(node, (c) => visit(c, nowInFn));
  };
  visit(sf, false);
  ok(`module-scope scanner self-test (1 bad, 1 good)`, hits === 1);
}

// Interpolate sanity (the one piece every language shares).
ok(`interpolate leaves strings without braces identical`, interpolate('Crew — 3 on site') === 'Crew — 3 on site');

// ═════════════════════════════════════════════════════════════════════════
console.log(`\n${failures ? '✗' : '✓'} validate-i18n: ${checks} checks, ${failures} failed, ${warnings} warning(s)${STRICT ? ' [strict]' : ''}`);
process.exit(failures ? 1 : 0);
