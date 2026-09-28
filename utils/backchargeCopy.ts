// utils/backchargeCopy.ts — the one line the backcharge section and each
// deduction card show about where the record is kept. Pure; pinned by
// scripts/validate-backcharges-sync.ts.
//
// The words are chosen by what actually happened to the rows on screen, never
// by platform: the same hook runs on the iPhone and on the web app, and one
// line has to be true on both ("device", not "phone").

import type { BackchargeSaveState } from '@/utils/backchargeRows';

/** Signed out: today's line, unchanged. */
export const BACKCHARGE_LINE_DEVICE = 'Saved on this device until you sign out.';
export const BACKCHARGE_LINE_SAVED = 'Saved to your account.';
/** Only when the device's own queue reports the write as queued. */
export const BACKCHARGE_LINE_WAITING = "Saved on this device. It goes to your account when you're back online.";
/** Signed in, not confirmed by the account, and no queued write to blame on
 *  being offline (a write on its way, a read not back yet or failed). */
export const BACKCHARGE_LINE_UNCONFIRMED = 'Saved on this device. Not yet confirmed on your account.';
export const BACKCHARGE_LINE_NOT_SAVED = 'Not saved to your account.';
/** Shown after BACKCHARGE_LINE_NOT_SAVED when the line can resend the write. */
export const BACKCHARGE_RETRY_HINT = 'Tap to retry.';

export interface BackchargeStorageLine {
  text: string;
  /** True for the not-saved line: tapping it resends the refused writes. */
  retry: boolean;
}

/**
 * The worst state wins, because one unsaved backcharge is the one the GC has
 * to hear about: not saved → waiting → unconfirmed → saved. Signed out always reads the
 * device line. Signed in with nothing on screen says nothing: "Saved to your
 * account" about zero records would be a claim about nothing.
 */
export function backchargeStorageLine(
  states: readonly BackchargeSaveState[],
  signedIn: boolean,
): BackchargeStorageLine | null {
  if (!signedIn || states.includes('device')) return { text: BACKCHARGE_LINE_DEVICE, retry: false };
  if (states.includes('not_saved')) return { text: `${BACKCHARGE_LINE_NOT_SAVED} ${BACKCHARGE_RETRY_HINT}`, retry: true };
  if (states.includes('waiting')) return { text: BACKCHARGE_LINE_WAITING, retry: false };
  if (states.includes('unconfirmed')) return { text: BACKCHARGE_LINE_UNCONFIRMED, retry: false };
  if (states.length > 0) return { text: BACKCHARGE_LINE_SAVED, retry: false };
  return null;
}

export const BACKCHARGE_SHEET_NOTHING_SENT = 'Nothing is sent to the sub.';

/** The sheet's subtitle. Signed out it keeps today's words; signed in it only
 *  says what does not happen — where the record lands is said after the save,
 *  by the section's line, once it is true. */
export function backchargeSheetSubtitle(signedIn: boolean): string {
  return signedIn ? BACKCHARGE_SHEET_NOTHING_SENT : `${BACKCHARGE_LINE_DEVICE} ${BACKCHARGE_SHEET_NOTHING_SENT}`;
}
