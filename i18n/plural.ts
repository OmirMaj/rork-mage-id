// i18n/plural.ts — CLDR plural categories for en and es WITHOUT Intl.
//
// Why not Intl.PluralRules: it is `undefined` on the Hermes binary this app
// ships (RN 0.81, hermes-2025-07-07 — probed, docs/I18N.md §1). i18next falls
// back to a dummy rule there and Spanish plurals silently collapse to one
// form, on the phone only. These rules are six lines and are checked against
// Node's ICU by scripts/validate-i18n.ts on thousands of inputs.
//
// PURE — no imports beyond types.

import type { Lang, PluralCategory, PluralForms } from './types';

/**
 * Plural category.
 *  - en: EXACTLY `n === 1` → one; else other. This is the test the app's 577
 *        inline `=== 1 ? '' : 's'` ternaries use, so converting one of them
 *        to tn() cannot change the English. It deliberately differs from CLDR
 *        in one place: CLDR says -1 is "one" ("-1 item"), the ternaries print
 *        "-1 items", and English must stay byte-identical.
 *  - es: CLDR — one → |n| = 1; many → integer |n| ≠ 0 and |n| % 1,000,000 = 0;
 *        else other.
 */
export function pluralCategory(lang: Lang, n: number): PluralCategory {
  if (lang === 'en') return n === 1 ? 'one' : 'other';
  if (!Number.isFinite(n)) return 'other';
  const a = Math.abs(n);
  if (a === 1) return 'one';
  if (Number.isInteger(a) && a !== 0 && a % 1_000_000 === 0) return 'many';
  return 'other';
}

/**
 * The form to use for `count`:
 *  1. `zero` when count === 0 and a zero form exists (explicit override);
 *  2. the CLDR category, where `many` falls back to `other`;
 *  3. `one` / `other`.
 */
export function selectPluralForm(lang: Lang, count: number, forms: PluralForms): string {
  if (count === 0 && typeof forms.zero === 'string') return forms.zero;
  const cat = pluralCategory(lang, count);
  if (cat === 'many') return forms.many ?? forms.other;
  if (cat === 'one') return forms.one;
  return forms.other;
}
