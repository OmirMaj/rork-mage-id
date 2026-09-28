// ============================================================================
// utils/lineupTexts.ts — the lineup goes out as real texts (UX wave, Lane B4).
//
// "It shows the sub's phone number, then opens the share sheet and makes me
// type his name. Four subs is 23 taps." Send now opens Messages ADDRESSED to
// the sub with the whole lineup in the body (Lane 0's smsUrl — the work-order
// dispatch builder, moved), and falls back to the share sheet only when there
// is no phone. "Text all N" steps through the subs one at a time.
//
// HONESTY. An opened Messages sheet proves nothing: iOS gives the app no
// signal that he pressed Send, and nothing records the lineup as delivered.
// So a row reads "Opened in Messages", never "Sent". On web (no Messages app
// behind sms:) the screen asks "Did you send it?" first, as work-order.tsx
// does, and a yes reads "You marked it sent" — his word, labelled as his.
// The same holds in Spanish: "Se abrió en Mensajes", never "Enviado".
//
// LANGUAGE (Spanish Phase 1b, W3 ESSHELL). Every label here is for the person
// holding the phone, so each takes the app language (`lang`, default 'en' —
// English byte-identical). The English constants stay exported for the
// validators that pin them. Which language a SUB's text goes out in is
// lineupLanguageFor below: the recipient's, never the sender's, and only once
// Spanish is switched on (i18n/flags LANGUAGE_PICKER_ENABLED).
//
// Pure. scripts/validate-ux-lane-b.ts and validate-tomorrow-lineup.ts run it
// under bun.
// ============================================================================

import { smsUrl } from '@/utils/smsUrl';
import { t } from '@/i18n/core';
import type { DisplayLang, Lang } from '@/i18n/types';
import { recipientLanguage } from '@/i18n/recipient';
import { LANGUAGE_PICKER_ENABLED } from '@/i18n/flags';

export const OPENED_IN_MESSAGES = 'Opened in Messages';
export const SHARE_SHEET_OPENED = 'Share sheet opened';
export const YOU_MARKED_SENT = 'You marked it sent';
export const NOT_SENT_YET = 'Not sent';
export const NO_PHONE_NOTE = 'No phone on file. Send opens the share sheet so you can pick how.';

/** "No phone on file…" in the app language. */
export function noPhoneNote(lang: DisplayLang = 'en'): string {
  return t('field.lineup.noPhoneNote', 'No phone on file. Send opens the share sheet so you can pick how.', undefined, lang);
}

export type LineupRowStatus = 'opened' | 'shared' | 'marked_sent' | 'not_sent';

/** What a row says after its Send, in English. Never the word "Sent" on its
 *  own. ONE parameter on purpose: it is passed straight to `.map()`, which
 *  would hand an index to a second one. */
export function lineupRowStatusLabel(status: LineupRowStatus | null | undefined): string | null {
  return lineupRowStatusLabelIn(status, 'en');
}

/** The same label in the app language ("Se abrió en Mensajes" — never "Enviado"). */
export function lineupRowStatusLabelIn(status: LineupRowStatus | null | undefined, lang: DisplayLang): string | null {
  switch (status) {
    case 'opened': return t('field.lineup.status.opened', 'Opened in Messages', undefined, lang);
    case 'shared': return t('field.lineup.status.shared', 'Share sheet opened', undefined, lang);
    case 'marked_sent': return t('field.lineup.status.markedSent', 'You marked it sent', undefined, lang);
    case 'not_sent': return t('field.lineup.status.notSent', 'Not sent', undefined, lang);
    default: return null;
  }
}

/** A phone worth texting: at least 7 digits once the punctuation is gone. */
export function textablePhone(phone: string | null | undefined): string | null {
  const raw = (phone ?? '').trim();
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 7 ? raw : null;
}

export type LineupSendRoute =
  | { kind: 'sms'; url: string; phone: string }
  | { kind: 'share'; reason: string };

/** Where one sub's Send goes: Messages addressed to him, or the share sheet. */
export function lineupSendRoute(
  sub: { phone?: string | null },
  body: string,
  platform: 'ios' | 'android' | 'web' | string,
  lang: DisplayLang = 'en',
): LineupSendRoute {
  const phone = textablePhone(sub.phone);
  if (!phone) return { kind: 'share', reason: noPhoneNote(lang) };
  return { kind: 'sms', url: smsUrl(phone, { body }, platform), phone };
}

/** "Text all 4" — every sub with a message, in list order. */
export function textAllLabel(count: number, lang: DisplayLang = 'en'): string {
  return count <= 1
    ? t('field.lineup.textTheSub', 'Text the sub', undefined, lang)
    : t('field.lineup.textAll', 'Text all {count}', { count }, lang);
}

/** The step-through queue after one sub is done (order kept). */
export function queueAfter(queue: readonly string[], doneId: string): string[] {
  return queue.filter(id => id !== doneId);
}

/** The banner between two texts: "Next: Bolt Electric (2 of 4)". */
export function queueBanner(queue: readonly string[], total: number, nameOf: (id: string) => string, lang: DisplayLang = 'en'): string | null {
  if (queue.length === 0) return null;
  const position = total - queue.length + 1;
  return t('field.lineup.queueNext', 'Next: {name} ({position} of {total})', { name: nameOf(queue[0]), position, total }, lang);
}

/**
 * The language ONE sub's lineup text goes out in (docs/I18N.md §9): the
 * one-tap override for this send, else the sub's record, else English — never
 * guessed from a name. Until Spanish is switched on (LANGUAGE_PICKER_ENABLED,
 * after the bilingual review) every text is English, whatever the record says.
 */
export function lineupLanguageFor(
  sub: { preferredLanguage?: Lang | null } | null | undefined,
  override?: Lang | null,
  enabled: boolean = LANGUAGE_PICKER_ENABLED,
): Lang {
  if (!enabled) return 'en';
  return recipientLanguage({ explicit: override ?? null, recipient: { preferred_language: sub?.preferredLanguage ?? null } });
}
