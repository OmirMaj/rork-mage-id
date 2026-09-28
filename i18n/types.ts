// i18n/types.ts — the shared vocabulary of the in-house i18n layer.
//
// PURE: no React Native import, so bun validators, the Hermes gate and (by
// copy) the Deno edge functions can all load it. See docs/I18N.md §3.

/** The languages a user can pick. Two, on purpose (docs/I18N.md §1). */
export type Lang = 'en' | 'es';

/**
 * What the runtime is actually rendering. 'xx' is the pseudo-locale: dev
 * builds and a hidden Settings toggle only, never a user choice and never
 * stored (docs/I18N.md §11).
 */
export type DisplayLang = Lang | 'xx';

export const LANGS: readonly Lang[] = ['en', 'es'] as const;

/**
 * The first segment of every key. A key outside these areas is a compile
 * error, which catches typos and un-namespaced keys for almost no tsc cost.
 * Key EXISTENCE and en/es PARITY are checked by scripts/validate-i18n.ts,
 * not by a giant literal union (docs/I18N.md §3.2 explains why).
 */
export type I18nArea =
  | 'common'
  | 'nav'
  | 'field'
  | 'safety'
  | 'money'
  | 'office'
  | 'schedule'
  | 'settings'
  | 'auth'
  | 'ai'
  | 'outbound'
  | 'portal'
  | 'email';

export const I18N_AREAS: readonly I18nArea[] = [
  'common', 'nav', 'field', 'safety', 'money', 'office', 'schedule',
  'settings', 'auth', 'ai', 'outbound', 'portal', 'email',
] as const;

export type I18nKey = `${I18nArea}.${string}`;

/** Interpolation values. Numbers and money arrive PRE-FORMATTED by the caller
 *  (formatMoney, formatNumberL …); t() does no formatting of its own. */
export type Vars = Record<string, string | number>;

/** CLDR categories en + es need, plus an explicit `zero` override (like ICU
 *  `=0`, not a CLDR category). `many` exists for Spanish round millions. */
export type PluralCategory = 'one' | 'many' | 'other';

export interface PluralForms {
  zero?: string;
  one: string;
  many?: string;
  other: string;
}

export type CatalogValue = string | PluralForms;

/** The English catalog: key → the inline English (or plural forms). */
export type EnCatalog = Record<I18nKey, CatalogValue>;

/**
 * One Spanish entry. `src` is fnv1a32 of the ENGLISH it translates, so a copy
 * edit to the English flags the Spanish for re-review (stale check) without
 * hiding it. `reviewedBy` is required on LEGAL_PINNED keys.
 */
export interface EsEntry {
  s: CatalogValue;
  src: string;
  reviewedBy?: string;
  /** Translator note: where it shows, what it is, character budget. */
  note?: string;
}

export type EsCatalog = Partial<Record<I18nKey, EsEntry>>;

export function isPluralForms(v: unknown): v is PluralForms {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as PluralForms).one === 'string' &&
    typeof (v as PluralForms).other === 'string'
  );
}

/** Anything starting with `es` (es, es-US, es-MX, es-419 …) is Spanish;
 *  everything else is English. The app offers two languages. */
export function normalizeLang(tag: unknown): Lang | null {
  if (typeof tag !== 'string') return null;
  const t = tag.trim().toLowerCase().replace('_', '-');
  if (!t) return null;
  if (t === 'es' || t.startsWith('es-')) return 'es';
  return 'en';
}

/** Strict parse of a STORED value — only the two exact codes count. A stored
 *  'es-MX' or 'spanish' is treated as absent, never guessed. */
export function parseStoredLang(v: unknown): Lang | null {
  return v === 'en' || v === 'es' ? v : null;
}
