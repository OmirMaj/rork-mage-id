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
//
// Pure. scripts/validate-ux-lane-b.ts runs it under bun.
// ============================================================================

import { smsUrl } from '@/utils/smsUrl';

export const OPENED_IN_MESSAGES = 'Opened in Messages';
export const SHARE_SHEET_OPENED = 'Share sheet opened';
export const YOU_MARKED_SENT = 'You marked it sent';
export const NOT_SENT_YET = 'Not sent';
export const NO_PHONE_NOTE = 'No phone on file — Send opens the share sheet so you can pick how.';

export type LineupRowStatus = 'opened' | 'shared' | 'marked_sent' | 'not_sent';

/** What a row says after its Send. Never the word "Sent" on its own. */
export function lineupRowStatusLabel(status: LineupRowStatus | null | undefined): string | null {
  switch (status) {
    case 'opened': return OPENED_IN_MESSAGES;
    case 'shared': return SHARE_SHEET_OPENED;
    case 'marked_sent': return YOU_MARKED_SENT;
    case 'not_sent': return NOT_SENT_YET;
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
): LineupSendRoute {
  const phone = textablePhone(sub.phone);
  if (!phone) return { kind: 'share', reason: NO_PHONE_NOTE };
  return { kind: 'sms', url: smsUrl(phone, { body }, platform), phone };
}

/** "Text all 4" — every sub with a message, in list order. */
export function textAllLabel(count: number): string {
  return count <= 1 ? 'Text the sub' : `Text all ${count}`;
}

/** The step-through queue after one sub is done (order kept). */
export function queueAfter(queue: readonly string[], doneId: string): string[] {
  return queue.filter(id => id !== doneId);
}

/** The banner between two texts: "Next: Bolt Electric (2 of 4)". */
export function queueBanner(queue: readonly string[], total: number, nameOf: (id: string) => string): string | null {
  if (queue.length === 0) return null;
  const position = total - queue.length + 1;
  return `Next: ${nameOf(queue[0])} (${position} of ${total})`;
}
