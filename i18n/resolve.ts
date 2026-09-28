// i18n/resolve.ts — which language to render, as a PURE decision
// (docs/I18N.md §4). The inputs are read elsewhere (i18n/device.ts,
// utils/languageStorage.ts, the profile row) so this can be validated under bun.
//
// Order:
//   1. explicit choice   profiles.preferred_language (once the column exists)
//   2. local cache       mageid_language (the same choice, cached on this device)
//   3. device language   AppleLanguages / I18nManager / navigator.languages
//                        — only when AUTO_DETECT_DEVICE is on
//   4. Intl hint         Intl.DateTimeFormat().resolvedOptions().locale
//                        — same gate as 3
//   5. 'en'
//
// The account setting beats the device on every surface: a foreman's choice
// follows him to a borrowed phone.

import type { Lang } from './types';
import { normalizeLang, parseStoredLang } from './types';
import { AUTO_DETECT_DEVICE } from './flags';

export interface LanguageInputs {
  /** profiles.preferred_language — the account's choice. */
  server?: unknown;
  /** AsyncStorage mageid_language — the cached choice. */
  stored?: unknown;
  /** BCP-47 tag from the OS (iOS AppleLanguages[0], Android locale, web navigator). */
  device?: unknown;
  /** Intl.DateTimeFormat().resolvedOptions().locale. On iOS this probably
   *  reports en-* even on a Spanish phone (app.json declares no localizations),
   *  which is why `device` ranks above it. Needs a real-device check. */
  intl?: unknown;
}

export type LanguageSource = 'server' | 'stored' | 'device' | 'intl' | 'default';

export interface ResolvedLanguage {
  lang: Lang;
  source: LanguageSource;
}

export function resolveLanguage(
  inputs: LanguageInputs,
  opts: { autoDetect?: boolean } = {},
): ResolvedLanguage {
  const autoDetect = opts.autoDetect ?? AUTO_DETECT_DEVICE;
  const server = parseStoredLang(inputs.server);
  if (server) return { lang: server, source: 'server' };
  const stored = parseStoredLang(inputs.stored);
  if (stored) return { lang: stored, source: 'stored' };
  if (autoDetect) {
    const device = normalizeLang(inputs.device);
    if (device) return { lang: device, source: 'device' };
    const intl = normalizeLang(inputs.intl);
    if (intl) return { lang: intl, source: 'intl' };
  }
  return { lang: 'en', source: 'default' };
}
