// utils/languageSyncCore.ts — the decisions behind components/LanguageProfileSync.tsx
// (docs/I18N.md §5), kept PURE (no React Native, no Supabase import) so
// scripts/validate-language-sync.ts can run every case under bun.
//
// Two directions:
//   sign-in  profiles.preferred_language → this device. The account's value
//            wins and is copied to the local cache (mageid_language), so a
//            foreman's choice follows him to a new phone. NULL ("not told us")
//            keeps whatever this device already has and writes nothing. A
//            missing column (the migration not applied yet) or a failed read
//            does nothing at all.
//   change   an explicit choice in Settings → the account. The local write
//            already happened (LanguageContext); this decides whether to send
//            ONE column, { id, preferred_language }, through the offline queue.
//            The 'xx' pseudo-locale is never written anywhere.
//
// BOTH directions are inert while LANGUAGE_PICKER_ENABLED is false. A dev
// build talks to the production database and can still open the language
// screen; without this gate one Spanish tap there would be written to the
// account and applied at every production sign-in, where the picker is
// hidden and English could not be chosen back. The flag is an explicit
// input (never read here) so the validator can pin both states.

import type { Lang } from '@/i18n/types';
import { parseStoredLang } from '@/i18n/types';

/** What the sign-in read of profiles.preferred_language produced. */
export type ServerLanguage =
  | Lang
  /** The column exists and is NULL (or the profile row is missing): "not told us". */
  | null
  /** PostgREST 42703 / PGRST204 — the migration has not been applied yet. */
  | 'missing_column'
  /** Offline, a network error, or anything else unexpected. */
  | 'unavailable';

export interface SignInInput {
  /** i18n/flags.ts LANGUAGE_PICKER_ENABLED. Anything but `true` = inert. */
  pickerEnabled: boolean;
  server: ServerLanguage | unknown;
  local: {
    lang: Lang;
    /** True when the user made an explicit choice on this device WHILE the
     *  read was in flight. That tap is newer than the row the read returned
     *  (its own single-column write is already on its way), so it wins. */
    explicit: boolean;
  };
}

export interface SignInDecision {
  /** Apply this language (source 'account') and copy it to the local cache. */
  apply?: Lang;
  /** The sign-in path never writes to the server. */
  write?: false;
}

export function decideOnSignIn(input: SignInInput): SignInDecision {
  // The picker is hidden: the account's value is never applied. Whatever a
  // dev build may have stored there cannot reach a production screen.
  if (input.pickerEnabled !== true) return {};
  if (input.local.explicit) return {};
  const server = parseStoredLang(input.server);
  if (server) return { apply: server, write: false };
  // null (not told us), 'missing_column', 'unavailable' or garbage: keep the
  // device's choice, write nothing.
  return {};
}

/** A PostgREST / Postgres error shape, as supabase-js returns it. */
export interface ReadError {
  code?: string | null;
  message?: string | null;
}

/** 42703 = undefined_column (Postgres), PGRST204 = column not in PostgREST's schema cache. */
export function isMissingColumnError(error: ReadError | null | undefined): boolean {
  if (!error) return false;
  const code = typeof error.code === 'string' ? error.code : '';
  if (code === '42703' || code === 'PGRST204') return true;
  const msg = typeof error.message === 'string' ? error.message : '';
  return /preferred_language/.test(msg) && /(does not exist|could not find)/i.test(msg);
}

/**
 * Classify one `select('preferred_language').eq('id', uid).maybeSingle()`
 * result. Never throws. A stored value other than the two exact codes counts
 * as "not told us" — never guessed.
 */
export function serverLanguageFromRead(result: {
  data?: { preferred_language?: unknown } | null;
  error?: ReadError | null;
} | null | undefined): ServerLanguage {
  if (!result) return 'unavailable';
  if (result.error) return isMissingColumnError(result.error) ? 'missing_column' : 'unavailable';
  return parseStoredLang(result.data?.preferred_language ?? null);
}

export interface ChangeInput {
  /** i18n/flags.ts LANGUAGE_PICKER_ENABLED. Anything but `true` = never write. */
  pickerEnabled: boolean;
  userId: string | null | undefined;
  supabaseConfigured: boolean;
  /** The language the user just chose. Anything but 'en' / 'es' — the 'xx'
   *  pseudo-locale included — is never written. */
  lang: unknown;
  /** The sign-in read found no preferred_language column. A write now would
   *  sit in the offline queue until the migration lands, so skip it. */
  columnMissing?: boolean;
}

export type ChangeDecision =
  | { write: true; row: { id: string; preferred_language: Lang } }
  | { write: false; reason: 'picker_hidden' | 'signed_out' | 'not_configured' | 'not_a_language' | 'column_missing' };

export function decideOnChange(input: ChangeInput): ChangeDecision {
  // The picker is hidden (a dev build's language screen): the choice stays on
  // this device and never reaches the account.
  if (input.pickerEnabled !== true) return { write: false, reason: 'picker_hidden' };
  const lang = parseStoredLang(input.lang);
  if (!lang) return { write: false, reason: 'not_a_language' };
  if (!input.supabaseConfigured) return { write: false, reason: 'not_configured' };
  const userId = typeof input.userId === 'string' ? input.userId.trim() : '';
  if (!userId) return { write: false, reason: 'signed_out' };
  if (input.columnMissing) return { write: false, reason: 'column_missing' };
  // ONE column (plus the row id). Never the whole settings row: a stale
  // settings object must not overwrite fields changed on another device.
  return { write: true, row: { id: userId, preferred_language: lang } };
}
