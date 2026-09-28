// i18n/core.ts — t(), tn(), interpolate() and the module-level language.
//
// THE ENGLISH GUARANTEE (docs/I18N.md §3.4): in English, t() returns the
// inline English written at the call site, interpolated — it never reads a
// catalog. English output is therefore byte-identical to today by
// construction, the ~438 validators that grep screens for English stay green,
// and the copy/voice pass keeps editing English in place.
//
//   t(key, en, vars):
//     'en'  → interpolate(en, vars)
//     'xx'  → interpolate(pseudoize(en), vars)          (dev pseudo-locale)
//     'es'  → interpolate(es[key].s ?? en, vars)        (missing Spanish → English,
//                                                        never a raw key, never a throw)
//
// NEVER call t() at module scope — a constant would freeze the language at
// import time. Label maps become functions (`statusLabel(s)`); the validator
// rejects module-scope calls in files that import this layer.
//
// PURE apart from the lazy catalog require (itself pure data), so bun and the
// Hermes gate can load it.

import type { CatalogValue, DisplayLang, EsCatalog, I18nKey, Lang, PluralForms, Vars } from './types';
import { isPluralForms } from './types';
import { selectPluralForm } from './plural';
import { pseudoize } from './pseudo';

// ── Module-level language ────────────────────────────────────────────────
// One source of truth, readable outside React (utils, ErrorBoundary, the
// payload builders that send `locale` to the AI relay). LanguageProvider is
// the only writer in the app; useT() subscribes through useSyncExternalStore.

let current: DisplayLang = 'en';
const listeners = new Set<(l: DisplayLang) => void>();

/** The language for FORMATTING and payloads: pseudo renders as English. */
export function getLang(): Lang {
  return current === 'es' ? 'es' : 'en';
}

/** What t() is rendering right now, including the 'xx' pseudo-locale. */
export function getDisplayLang(): DisplayLang {
  return current;
}

/** Called by LanguageProvider only. A no-op when unchanged, so listeners
 *  (every mounted useT consumer) never re-render for nothing. */
export function setLang(l: DisplayLang): void {
  if (l !== 'en' && l !== 'es' && l !== 'xx') return;
  if (l === current) return;
  current = l;
  listeners.forEach((fn) => {
    try {
      fn(l);
    } catch {
      /* a broken listener must not stop the others */
    }
  });
}

export function subscribe(fn: (l: DisplayLang) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// ── Catalog ──────────────────────────────────────────────────────────────

// Loaded LAZILY (docs/I18N.md §2): the Spanish catalog is required on the
// first Spanish lookup, so an English user never parses it. In English t()
// never reaches this function at all (the English guarantee above).

let esCatalog: EsCatalog | null = null;

function loadEs(): EsCatalog {
  if (esCatalog === null) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    esCatalog = (require('./catalog/es') as { ES_CATALOG: EsCatalog }).ES_CATALOG;
  }
  return esCatalog;
}

/** Test seam: swap the Spanish catalog (validators only). Returns a restore fn. */
export function __setEsCatalogForTest(cat: EsCatalog): () => void {
  const prev = esCatalog;
  esCatalog = cat;
  return () => {
    esCatalog = prev;
  };
}

function esValue(key: I18nKey): CatalogValue | undefined {
  return loadEs()[key]?.s;
}

// ── Interpolation ────────────────────────────────────────────────────────

const PLACEHOLDER = /\{\{|\}\}|\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * `{name}` → String(vars.name), exactly what a template literal `${name}`
 * prints. An unknown `{x}` is left as-is (and flagged by the validator).
 * `{{` / `}}` write a literal brace. A string with no brace is returned
 * untouched — the common English case costs one indexOf.
 */
export function interpolate(s: string, vars?: Vars): string {
  if (s.indexOf('{') === -1 && s.indexOf('}') === -1) return s;
  return s.replace(PLACEHOLDER, (m, name: string | undefined) => {
    if (m === '{{') return '{';
    if (m === '}}') return '}';
    if (name !== undefined && vars && Object.prototype.hasOwnProperty.call(vars, name)) {
      return String(vars[name]);
    }
    return m;
  });
}

/** The `{name}` placeholders a string uses, in first-seen order. */
export function placeholdersOf(s: string): string[] {
  const seen: string[] = [];
  s.replace(PLACEHOLDER, (m, name: string | undefined) => {
    if (name !== undefined && !seen.includes(name)) seen.push(name);
    return m;
  });
  return seen;
}

// ── t / tn ───────────────────────────────────────────────────────────────

/**
 * Translate. `en` is the inline English (the source of truth for English and
 * the fallback for every other language).
 *
 *   t('field.dfr.weather', 'Weather')
 *   t('field.punch.assignedTo', 'Assigned to {name}', { name })
 */
export function t(key: I18nKey, en: string, vars?: Vars, lang: DisplayLang = current): string {
  if (lang === 'en') return interpolate(en, vars);
  if (lang === 'xx') return interpolate(pseudoize(en), vars);
  const es = esValue(key);
  return interpolate(typeof es === 'string' ? es : en, vars);
}

/**
 * Translate with a count. Injects `{count}` (as String(count) — pre-format
 * the number yourself and pass it as another var if it needs separators).
 *
 *   tn('field.punch.openCount', open, { one: '{count} open item', other: '{count} open items' })
 */
export function tn(
  key: I18nKey,
  count: number,
  en: PluralForms,
  vars?: Vars,
  lang: DisplayLang = current,
): string {
  const allVars: Vars = { count, ...(vars ?? {}) };
  if (lang === 'en') return interpolate(selectPluralForm('en', count, en), allVars);
  if (lang === 'xx') return interpolate(pseudoize(selectPluralForm('en', count, en)), allVars);
  const es = esValue(key);
  if (isPluralForms(es)) return interpolate(selectPluralForm('es', count, es), allVars);
  return interpolate(selectPluralForm('en', count, en), allVars);
}

/** Resolve a catalog value for a given language without the call-site
 *  English (validators and the edge sync use this; screens use t/tn). */
export function lookup(key: I18nKey, lang: Lang, enCatalog: Record<string, CatalogValue>): CatalogValue | undefined {
  if (lang === 'es') return esValue(key) ?? enCatalog[key];
  return enCatalog[key];
}
