// ============================================================================
// utils/remindInvoice.ts — ONE way to chase an invoice (UX wave, Lane 0).
//
// Extracted from app/invoice.tsx's handleSendReminder, the only caller of
// sendInvoiceReminderNow before this wave. Three surfaces now send a manual
// reminder — the invoice screen, the payments list ("Remind" / "Remind all",
// Lane C) and the desktop Action Required dock (Lane A) — and each one used to
// be a chance to drop a guard. Everything that decides WHETHER a reminder
// goes and WHAT the GC is told lives here:
//
//   1. a sample job never chases anyone (invoice-dunning skips samples
//      server-side too) — refused before anything else, nothing is asked;
//   2. an invoice QuickBooks closed without a payment (credit memo, void,
//      refund gap) asks first — the dunning cron is paused on it, a manual
//      send is not — unless the caller already asked (qboClosedConfirmed);
//   3. the server's answer, in the invoice screen's exact words: a failed
//      call, the `no_recipient` skip, any other skip (reminderBlockMessage);
//   4. on a real send, the dunning-marker patch to mirror locally (the edge
//      function wrote the same values; echoing them back is idempotent).
//
// The IO is injected (`deps.send` is sendInvoiceReminderNow; `deps.confirm`
// is the caller's yes/no dialog), so this file is pure and
// scripts/validate-ux-remind-invoice.ts drives every branch under bun.
//
// It returns an outcome; it shows nothing. The caller turns `kind: 'sent'`
// into a toast and every other kind except 'cancelled' into an alert (see
// app/invoice.tsx). A batch caller ("Remind all") collects the outcomes and
// shows one line per invoice.
// ============================================================================

import type { SendReminderResult } from '@/utils/invoiceReminders';
import type { AlertButton } from '@/utils/alertCore';
import { dunningStageLabel, reminderBlockMessage } from '@/utils/billingFlowCore';
import { isSampleProject, SAMPLE_NOTHING_SENT } from '@/utils/sampleGuard';
import { qboClosedFlagOf, qboClosedFlagAlertReason } from '@/utils/qboClosedFlag';
import { ownSentence } from '@/utils/errorCopy';

export type RemindKind = 'sent' | 'skipped' | 'no_recipient' | 'failed' | 'sample' | 'cancelled';

export interface RemindPatch {
  dunningStage: number;
  dunningLastSentAt: string;
}

export interface RemindOutcome {
  kind: RemindKind;
  /** Alert title (or, for 'sent', a short heading a batch list may show). */
  title: string;
  /** The sentence the GC reads. For 'sent' it is the toast text. */
  message: string;
  /** Only on 'sent' with the server's stage + timestamp: mirror it locally. */
  patch?: RemindPatch;
  /** Who it went to, when the server said. */
  recipient?: string;
  /** Server skip reason, when there was one. */
  reason?: string;
}

export interface RemindInvoiceInput {
  invoiceId: string;
  /** The invoice's project name (the sample check reads the name prefix). */
  projectName: string | null | undefined;
  /** invoice.qboError — the QuickBooks-closed flag is read from it. */
  qboError?: unknown;
  /** True when the caller has ALREADY asked the QuickBooks-closed question
   *  (the invoice screen's button does, and a guard pins that). */
  qboClosedConfirmed?: boolean;
  /** When the last reminder went out (ms), for the too-soon wording. */
  lastReminderMs?: number | null;
}

export interface RemindInvoiceDeps {
  /** sendInvoiceReminderNow. */
  send: (invoiceId: string) => Promise<SendReminderResult>;
  /** The caller's yes/no dialog. Resolves true to go ahead. Called only for a
   *  QuickBooks-closed invoice the caller has not already confirmed. */
  confirm: (title: string, message: string, confirmLabel: string) => Promise<boolean>;
  /** Called right before the network call (after every guard and the
   *  confirm), so a button spinner never shows under an open dialog. */
  onSendStart?: () => void;
  now?: () => number;
}

// ── Copy (the invoice screen's words, moved here verbatim) ──────────────────

export const REMIND_SAMPLE_TITLE = 'Sample job';
export const REMIND_QBO_CLOSED_TITLE = 'QuickBooks shows this invoice closed';
export const REMIND_QBO_CONFIRM_LABEL = 'Send anyway';
export const REMIND_FAILED_TITLE = 'Reminder not sent';
export const REMIND_FAILED_FALLBACK = 'Could not reach the reminder service. Try again in a moment.';
export const REMIND_SKIPPED_TITLE = 'No reminder sent';
export const REMIND_NO_RECIPIENT =
  'No client email is on file for this invoice. Email the invoice to your client (the address is kept for reminders) or add a portal invitee in Client Portal setup, then try again.';
export const REMIND_NOT_ELIGIBLE = 'This invoice is not eligible for a reminder right now.';
export const REMIND_CANCELLED_TITLE = 'Not sent';
export const REMIND_CANCELLED = 'You chose not to send it. Nothing went out.';

/** The QuickBooks-closed question, for a flag read with qboClosedFlagOf. */
export function qboClosedConfirmMessage(flag: string): string {
  return `${qboClosedFlagAlertReason(flag)} Send a reminder to the client anyway?`;
}

/** The toast after a real send: "Friendly reminder sent to amy@x.com". */
export function remindSentMessage(stage: number | null | undefined, recipient: string | null | undefined): string {
  return `${dunningStageLabel(stage ?? 1)} sent${recipient ? ` to ${recipient}` : ''}`;
}

/**
 * Chase one invoice. Never throws: a send that throws is a 'failed' outcome.
 * See the file header for the order of the guards.
 */
export async function remindInvoice(input: RemindInvoiceInput, deps: RemindInvoiceDeps): Promise<RemindOutcome> {
  // 1. A sample never chases anyone.
  if (isSampleProject(input.projectName ?? '')) {
    return { kind: 'sample', title: REMIND_SAMPLE_TITLE, message: SAMPLE_NOTHING_SENT };
  }

  // 2. QuickBooks closed it without a payment: ask, unless already asked.
  const flag = qboClosedFlagOf(input.qboError);
  if (flag && !input.qboClosedConfirmed) {
    let yes = false;
    try {
      yes = await deps.confirm(REMIND_QBO_CLOSED_TITLE, qboClosedConfirmMessage(flag), REMIND_QBO_CONFIRM_LABEL);
    } catch {
      yes = false;
    }
    if (!yes) return { kind: 'cancelled', title: REMIND_CANCELLED_TITLE, message: REMIND_CANCELLED };
  }

  // 3. Ask the server.
  deps.onSendStart?.();
  let res: SendReminderResult;
  try {
    res = await deps.send(input.invoiceId);
  } catch (err) {
    // A thrown send shows its own sentence only when one was written for a
    // person (utils/errorCopy ownSentence); raw transport text never reaches
    // the alert (docs/VOICE.md: no err.message).
    const msg = ownSentence(err) ?? REMIND_FAILED_FALLBACK;
    return { kind: 'failed', title: REMIND_FAILED_TITLE, message: msg };
  }
  if (!res || !res.success) {
    return { kind: 'failed', title: REMIND_FAILED_TITLE, message: res?.error ?? REMIND_FAILED_FALLBACK };
  }
  if (res.outcome === 'skipped') {
    if (res.reason === 'no_recipient') {
      return { kind: 'no_recipient', title: REMIND_SKIPPED_TITLE, message: REMIND_NO_RECIPIENT, reason: res.reason };
    }
    const nowMs = deps.now ? deps.now() : Date.now();
    return {
      kind: 'skipped',
      title: REMIND_SKIPPED_TITLE,
      message: res.reason
        ? reminderBlockMessage(res.reason as Parameters<typeof reminderBlockMessage>[0], input.lastReminderMs, nowMs)
        : REMIND_NOT_ELIGIBLE,
      reason: res.reason,
    };
  }

  // 4. Sent. Mirror the server's markers only when it gave both.
  const out: RemindOutcome = {
    kind: 'sent',
    title: 'Reminder sent',
    message: remindSentMessage(res.stage, res.recipient),
  };
  if (res.recipient) out.recipient = res.recipient;
  if (res.stage != null && res.sentAt) out.patch = { dunningStage: res.stage, dunningLastSentAt: res.sentAt };
  return out;
}

/**
 * Build `deps.confirm` from the app's showAlert (utils/alert), so a caller
 * does not hand-roll the Promise: Cancel resolves false, the confirm button
 * true, and a dialog dismissed any other way (Android back, web Escape)
 * resolves false. Takes the function as an argument to stay RN-free.
 */
export function confirmViaAlert(
  showAlert: (
    title: string,
    message?: string,
    buttons?: AlertButton[],
    options?: { cancelable?: boolean; onDismiss?: () => void },
  ) => void,
): RemindInvoiceDeps['confirm'] {
  return (title, message, confirmLabel) => new Promise<boolean>(resolve => {
    let settled = false;
    const done = (v: boolean) => { if (!settled) { settled = true; resolve(v); } };
    showAlert(
      title,
      message,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => done(false) },
        { text: confirmLabel, onPress: () => done(true) },
      ],
      { cancelable: true, onDismiss: () => done(false) },
    );
  });
}
