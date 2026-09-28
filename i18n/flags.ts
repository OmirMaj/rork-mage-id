// i18n/flags.ts — rollout switches for Spanish (docs/I18N.md §4, §12).
//
// Both stay FALSE until the Phase 1 field surfaces are translated and
// reviewed. Before then Spanish is invisible to users: the Settings row is
// hidden and a Spanish-language phone still opens in English. Turning
// Spanish on for a half-English app would drop a foreman into a mix of two
// languages he never asked for.

/** Show the "Language / Idioma" row in Settings. */
export const LANGUAGE_PICKER_ENABLED = false;

/** Let the phone's language pick Spanish when the user has not chosen. */
export const AUTO_DETECT_DEVICE = false;

/**
 * Offer the 'xx' pseudo-locale on the language screen. Dev builds only —
 * the check is at the call site (`__DEV__`), this just lets a reviewer turn
 * it off entirely.
 */
export const PSEUDO_LOCALE_IN_DEV = true;
