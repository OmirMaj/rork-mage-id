// i18n/index.ts — the pure i18n surface (no React Native imports).
//
// Screens use the hooks in contexts/LanguageContext.tsx (useT, useLanguage).
// Utils, payload builders and the ErrorBoundary use getLang() / t() from here.
// i18n/device.ts and utils/languageStorage.ts import React Native and are
// deliberately NOT re-exported, so bun validators and the Hermes gate can import this file.

export type {
  Lang, DisplayLang, I18nArea, I18nKey, Vars, PluralForms, PluralCategory, EsEntry, EsCatalog, EnCatalog,
} from './types';
export { LANGS, normalizeLang, parseStoredLang, isPluralForms } from './types';
export { t, tn, getLang, getDisplayLang, setLang, subscribe, interpolate, placeholdersOf } from './core';
export { pluralCategory, selectPluralForm } from './plural';
export {
  formatMoneyL, formatMoneyShortL, formatNumberL, formatMoneyCentsL,
  formatDateL, formatDateOptsL, formatCalendarDayL, formatTimeL, formatWeekdayL,
  formatRelativeL, relativeParts, renderRelative, compareL, DATE_STYLE_OPTIONS,
} from './format';
export type { DateStyle, RelativeParts } from './format';
export { resolveLanguage } from './resolve';
export type { LanguageInputs, LanguageSource, ResolvedLanguage } from './resolve';
export { recipientLanguage } from './recipient';
export { LANGUAGE_PICKER_ENABLED, AUTO_DETECT_DEVICE } from './flags';
