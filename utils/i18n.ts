// utils/i18n.ts — minimal i18n scaffold for the GC app.
//
// Pre-fix: utils/portalLanguages.ts covers the homeowner portal in 6
// languages, but the GC app itself is English-only. Spanish-speaking
// supers, foremen, and bilingual office staff who work for an English-
// speaking owner have to navigate English chrome with their crew. The
// audit flagged this as a real wedge for AlignOps and Workyard which
// auto-detect device language and translate the field surfaces.
//
// Scope of this scaffold:
//   1. Locale state lives on `settings.appLanguage` ('en' | 'es' …).
//      Defaults to 'en'. The user picks via the Settings screen.
//   2. `t(key)` returns the localized string from a flat dictionary.
//      Missing keys fall back to English. Logged in dev so we catch
//      drift.
//   3. Dictionaries are seed-only — covering ~50 of the most-visible
//      strings (sign-in, settings labels, primary CTAs). FULL app
//      coverage is multi-week work; this scaffold proves the
//      pattern and lets us migrate one screen at a time without
//      blocking the rest.
//
// Why not use a library (i18n-js, react-intl)?
//   - The app already pays a budget on bundle size; adding 50 KB of
//     library for a feature we'll iterate on incrementally is wasteful.
//   - The patterns we need (keyed lookup, fallback, simple
//     interpolation) are 30 lines.
//   - When a real translation team comes online and we need
//     pluralization rules, ICU MessageFormat, etc., the whole module
//     swaps cleanly behind the same `t()` API.

import enDict from './i18n/en';
import esDict from './i18n/es';

export type AppLocale = 'en' | 'es';

const DICTIONARIES: Record<AppLocale, Record<string, string>> = {
  en: enDict,
  es: esDict,
};

// Module-level current locale. Set by the AppSettings provider on
// mount + on every change. Pure function `t()` reads this — keeping
// the API ergonomic at call sites without React context plumbing.
let currentLocale: AppLocale = 'en';

export function setAppLocale(locale: AppLocale): void {
  currentLocale = locale;
}

export function getAppLocale(): AppLocale {
  return currentLocale;
}

/**
 * Look up a string by key. Falls back to English when the key is
 * missing in the active locale (common during incremental rollout).
 * Optional `vars` object swaps in {placeholder} tokens.
 *
 * Examples:
 *   t('login.title')                          → "Sign in"
 *   t('time.hoursToday', { hours: '4.5' })    → "4.5 hours today"
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const dict = DICTIONARIES[currentLocale] ?? DICTIONARIES.en;
  const fallback = DICTIONARIES.en;
  let raw = dict[key] ?? fallback[key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      raw = raw.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value));
    }
  }
  if (__DEV__ && !dict[key] && !fallback[key]) {
    console.log(`[i18n] missing key: "${key}" (locale: ${currentLocale})`);
  }
  return raw;
}

/** Languages the GC app advertises in the Settings picker. Distinct
 *  from utils/portalLanguages — that one targets homeowners; this
 *  targets the contractor's own UI. */
export const APP_LOCALES: { code: AppLocale; label: string; native: string }[] = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'es', label: 'Spanish', native: 'Español' },
];
