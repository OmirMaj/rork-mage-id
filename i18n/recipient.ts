// i18n/recipient.ts — the language of something sent OUTSIDE the account
// (docs/I18N.md §9): a sub's lineup text, a crew invite, a homeowner's
// portal, email or PDF. It is the RECIPIENT's language, never the sender's:
// a Spanish-speaking foreman texting an English-speaking sub sends English.
//
// Order: explicit per-send override → the recipient record → the homeowner's
// portal language → 'en'. Outsiders default to English until their language
// is set. We never guess a language from a name. PURE.

import type { Lang } from './types';
import { normalizeLang, parseStoredLang } from './types';

export interface RecipientLanguageInput {
  /** A one-tap override in the send sheet for this send only. */
  explicit?: Lang | null;
  /** subcontractors / crew_members / contacts .preferred_language (migration pending). */
  recipient?: { preferred_language?: unknown } | null;
  /** projects.client_portal.homeownerLanguage — already exists; the portal
   *  offers six languages, of which the app itself renders en and es. */
  homeownerLanguage?: unknown;
}

export function recipientLanguage(input: RecipientLanguageInput = {}): Lang {
  const explicit = parseStoredLang(input.explicit);
  if (explicit) return explicit;
  const rec = parseStoredLang(input.recipient?.preferred_language);
  if (rec) return rec;
  // The portal stores codes like 'es' / 'en' / 'zh' / 'pt' …; only Spanish
  // maps to Spanish here. Anything else falls to English for app-rendered text.
  if (typeof input.homeownerLanguage === 'string' && input.homeownerLanguage.trim()) {
    return normalizeLang(input.homeownerLanguage) ?? 'en';
  }
  return 'en';
}
