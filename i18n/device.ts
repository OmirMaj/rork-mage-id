// i18n/device.ts — read the phone's / browser's language WITHOUT a native
// module. expo-localization is not in the installed build (OTA only), so this
// uses React Native core modules that are already linked:
//
//   iOS      Settings.get('AppleLanguages')[0]            (RCTSettings / NSUserDefaults)
//   Android  I18nManager.getConstants().localeIdentifier  (e.g. 'es_US')
//   Web      navigator.languages[0] ?? navigator.language
//   all      Intl.DateTimeFormat().resolvedOptions().locale  (a weaker hint)
//
// The iOS trap: Hermes's default locale is matched against the app's declared
// localizations, and app.json declares none, so a Spanish iPhone probably
// reports en-* through Intl. AppleLanguages is the user's real list. This
// needs a real-device check before AUTO_DETECT_DEVICE is turned on.
//
// Every step is wrapped: a missing or renamed native constant must fall
// through to English, never crash startup.

import { I18nManager, Platform, Settings } from 'react-native';

export interface DeviceLanguageHints {
  device: string | null;
  intl: string | null;
}

function iosAppleLanguage(): string | null {
  try {
    const langs: unknown = Settings?.get?.('AppleLanguages');
    if (Array.isArray(langs) && typeof langs[0] === 'string') return langs[0];
    if (typeof langs === 'string') return langs;
  } catch {
    /* fall through */
  }
  return null;
}

function androidLocale(): string | null {
  try {
    const c = (I18nManager as unknown as { getConstants?: () => { localeIdentifier?: unknown } }).getConstants?.();
    return typeof c?.localeIdentifier === 'string' ? c.localeIdentifier : null;
  } catch {
    return null;
  }
}

function webLanguage(): string | null {
  try {
    if (typeof navigator === 'undefined') return null;
    const nav = navigator as Navigator & { languages?: readonly string[] };
    const first = nav.languages?.[0] ?? nav.language;
    return typeof first === 'string' ? first : null;
  } catch {
    return null;
  }
}

function intlLocale(): string | null {
  try {
    const l = Intl.DateTimeFormat().resolvedOptions().locale;
    return typeof l === 'string' ? l : null;
  } catch {
    return null;
  }
}

export function detectDeviceLanguage(): DeviceLanguageHints {
  let device: string | null = null;
  if (Platform.OS === 'ios') device = iosAppleLanguage();
  else if (Platform.OS === 'android') device = androidLocale();
  else if (Platform.OS === 'web') device = webLanguage();
  return { device, intl: intlLocale() };
}
