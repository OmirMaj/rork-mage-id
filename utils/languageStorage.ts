// utils/languageStorage.ts — the local cache of the user's language choice.
//
// Lives in utils/ (not i18n/) on purpose: scripts/validate-storage-hygiene.ts
// scans utils/ for every key the app writes, and i18n/ stays free of React
// Native imports so bun, the Hermes gate and Deno can load it.
//
// Key: `mageid_language`, under the existing `mageid_` prefix in
// utils/localCacheKeys.ts APP_STORAGE_PREFIXES, so the prefix sweep covers it
// and `bun run test:storage-hygiene` passes with no change. Until the handoff
// adds it to DEVICE_SCOPED_KEYS it is tenant-scoped, which is safe: after a
// tenant switch the next person simply starts in English.
//
// Every read and write is wrapped: AsyncStorage can throw (private web
// windows, quota), and a language preference must never crash the app.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Lang } from '@/i18n/types';
import { parseStoredLang } from '@/i18n/types';

export const LANGUAGE_STORAGE_KEY = 'mageid_language';

export async function readStoredLanguage(): Promise<Lang | null> {
  try {
    return parseStoredLang(await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY));
  } catch {
    return null;
  }
}

export async function writeStoredLanguage(lang: Lang): Promise<void> {
  try {
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  } catch {
    /* the in-memory choice still applies for this session */
  }
}
