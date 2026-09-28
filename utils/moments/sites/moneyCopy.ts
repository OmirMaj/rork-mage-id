// moneyCopy.ts: every sentence the money moments say (wave-next W2, lane MOMMONEY).
//
// Sites: approve a change order (app/change-order.tsx, the job page's list row
// and the schedule-reflow preview through components/moments-sites/COApproveSheet
// and components/schedule/COScheduleReflowPreviewModal), record an invoice
// payment (app/invoice.tsx) and certify an AIA pay app (app/aia-pay-app.tsx).
//
// THE RULE (docs/I18N.md §3.5, scripts/moments-checks/rules.ts R3/R4): one
// exported function per sentence. Data (a CO number, an amount in integer
// cents, a date already formatted) enters only as a placeholder argument; a
// verb, a noun or a subject phrase never does, so the Phase 2 Spanish lane
// translates each sentence as one key. Screens never inline these strings and
// never glue two of them together.
//
// Pure: its one import (utils/formatters) has no imports, so bun loads this
// file for real in scripts/moments-checks/money-sites.ts.

import { formatMoney } from '@/utils/formatters';

/** Integer cents as "$4,200.00" (a credit reads "-$4,200.00"). Every amount on a money moment shows cents. */
function money(cents: number): string {
  return formatMoney(Math.round(cents) / 100, 2);
}

/** Integer cents with an explicit sign: "+$4,200.00" or "-$4,200.00". */
function signed(cents: number): string {
  return cents < 0 ? money(cents) : `+${money(cents)}`;
}

// ── Change order approve (B1, B2) ───────────────────────────────────────────

/** The track label: "Slide to approve · +$4,200.00". */
export function coSlideLabel(amountCents: number): string {
  return `Slide to approve · ${signed(amountCents)}`;
}

/** The reflow preview's track label: "Slide to approve and shift the schedule · +$4,200.00". */
export function coSlideLabelWithSchedule(amountCents: number): string {
  return `Slide to approve and shift the schedule · ${signed(amountCents)}`;
}

/** Busy line while the approval is on its way. */
export function coBusy(): string {
  return 'Approving…';
}

/** The screen reader's one-button label: "Approve CO #4, +$4,200.00". */
export function coSrLabel(coNumber: number, amountCents: number): string {
  return `Approve CO #${coNumber}, ${signed(amountCents)}`;
}

/** The screen reader's Confirm button: "Approve CO #4". */
export function coSrConfirm(coNumber: number): string {
  return `Approve CO #${coNumber}`;
}

/** Confirmed: "CO #4 approved · contract $52,400.00" (the contract total after this CO). */
export function coApproved(coNumber: number, contractCents: number): string {
  return `CO #${coNumber} approved · contract ${money(contractCents)}`;
}

/** Confirmed when the signed contract could not be read: "CO #4 approved · +$4,200.00" (the CO's own amount, never a guessed contract total). */
export function coApprovedNoTotal(coNumber: number, amountCents: number): string {
  return `CO #${coNumber} approved · ${signed(amountCents)}`;
}

/** Confirmed detail when the reflow moved the finish: "Finish moves to Nov 14, 2026". */
export function coFinishMoves(finishDate: string): string {
  return `Finish moves to ${finishDate}`;
}

/** Queued: the approval waits on this phone. */
export function coQueued(): string {
  return 'Approved on this phone · sends when online';
}

/** Refused: the server said no, so nothing on this phone changed. */
export function coRefused(): string {
  return 'Not approved. Something went wrong on our side.';
}

/** Timeout: "No answer yet. Check CO #4 before trying again." */
export function coTimeout(coNumber: number): string {
  return `No answer yet. Check CO #${coNumber} before trying again.`;
}

/** A confirmed answer that lands after the sheet is gone (a toast): "CO #4 approved". */
export function coApprovedToast(coNumber: number): string {
  return `CO #${coNumber} approved`;
}

/** Confirmed, approved with NO client signature ("Client approved without signing"): "CO #4 approved, unsigned · contract $52,400.00". */
export function coApprovedUnsigned(coNumber: number, contractCents: number): string {
  return `CO #${coNumber} approved, unsigned · contract ${money(contractCents)}`;
}

/** The same, when the signed contract could not be read: "CO #4 approved, unsigned · +$4,200.00". */
export function coApprovedUnsignedNoTotal(coNumber: number, amountCents: number): string {
  return `CO #${coNumber} approved, unsigned · ${signed(amountCents)}`;
}

/** An unsigned approval confirmed after the sheet is gone (a toast): "CO #4 approved, unsigned". */
export function coApprovedUnsignedToast(coNumber: number): string {
  return `CO #${coNumber} approved, unsigned`;
}

// ── Invoice record payment (B3) ─────────────────────────────────────────────

/** The track label: "Slide to record $4,200.00". */
export function paySlideLabel(amountCents: number): string {
  return `Slide to record ${money(amountCents)}`;
}

/** The track label for an overpayment: "Slide to record $5,000.00 · $800.00 over the balance". */
export function paySlideLabelOver(amountCents: number, overCents: number): string {
  return `Slide to record ${money(amountCents)} · ${money(overCents)} over the balance`;
}

/** The line under the track for an overpayment: why it is allowed, and what to check. */
export function payOverDetail(): string {
  return 'This is more than the balance. Record it only if the client paid this much, such as a combined check.';
}

/** The disabled reason when the amount field is empty: why the slide waits, and what unlocks it. */
export function payAmountEmpty(): string {
  return 'Type the amount received to record a payment.';
}

/** The disabled reason when the amount cannot be read: why, and how to type it. */
export function payAmountUnreadable(): string {
  return "Couldn't read that amount. Type it like 12500.00 or 12,500.00.";
}

/** The disabled reason when the amount is $0.00 or less. */
export function payAmountNotAboveZero(): string {
  return 'Enter an amount above $0.00 to record a payment.';
}

/** The disabled reason while an earlier change to this invoice has not sent (the exact words the spec names). */
export function payEarlierChangeReason(): string {
  return "An earlier change to this invoice hasn't sent yet. Review unsent changes first.";
}

/** The link beside the track that opens the unsent changes. */
export function payReviewUnsentLink(): string {
  return 'Review unsent changes';
}

/** Busy line while the payment is on its way. */
export function payBusy(): string {
  return 'Recording…';
}

/** The screen reader's one-button label: "Record a payment of $4,200.00". */
export function paySrLabel(amountCents: number): string {
  return `Record a payment of ${money(amountCents)}`;
}

/** The screen reader's Confirm button: "Record $4,200.00". */
export function paySrConfirm(amountCents: number): string {
  return `Record ${money(amountCents)}`;
}

/** Confirmed, settled: "Paid in full · Balance $0.00". */
export function payPaidInFull(): string {
  return 'Paid in full · Balance $0.00';
}

/** Confirmed, a balance is left: "Recorded $4,200.00 · Balance $3,150.00" (the server's balance). */
export function payRecorded(amountCents: number, balanceCents: number): string {
  return `Recorded ${money(amountCents)} · Balance ${money(balanceCents)}`;
}

/** Confirmed, but the server's balance could not be read back: "Recorded $4,200.00 on invoice #12". */
export function payRecordedOnInvoice(amountCents: number, invoiceNumber: number): string {
  return `Recorded ${money(amountCents)} on invoice #${invoiceNumber}`;
}

/** Queued: the payment waits on this phone. */
export function payQueued(): string {
  return 'Recorded on this phone · sends when online';
}

/** Queued, and the invoice has a Pay link: what to do once it sends. */
export function payQueuedPayLinkNext(): string {
  return 'Once it sends, send the invoice again so the Pay link matches the new balance.';
}

/** Refused, held: an earlier change to this invoice is waiting, so the payment was never sent. */
export function payHeld(): string {
  return "Not recorded. An earlier change to this invoice hasn't sent yet. Review unsent changes first.";
}

/** Refused by the server: a refused append was never stored. */
export function payRefused(): string {
  return 'Not recorded. The server said no, so nothing was saved.';
}

/** Timeout: "No answer yet. Check invoice #12 before trying again." */
export function payTimeout(invoiceNumber: number): string {
  return `No answer yet. Check invoice #${invoiceNumber} before trying again.`;
}

/** A confirmed answer that lands after the sheet is gone (a toast): "Payment of $4,200.00 recorded". */
export function payRecordedToast(amountCents: number): string {
  return `Payment of ${money(amountCents)} recorded`;
}

// ── AIA pay app certify (B4) ────────────────────────────────────────────────

/** The track label: "Slide to certify · $86,310.00". */
export function certSlideLabel(amountCents: number): string {
  return `Slide to certify · ${money(amountCents)}`;
}

/** Busy line while the certification is on its way. */
export function certBusy(): string {
  return 'Certifying…';
}

/** The screen reader's one-button label: "Certify pay app #6, $86,310.00". */
export function certSrLabel(appNumber: number, amountCents: number): string {
  return `Certify pay app #${appNumber}, ${money(amountCents)}`;
}

/** The screen reader's Confirm button: "Certify pay app #6". */
export function certSrConfirm(appNumber: number): string {
  return `Certify pay app #${appNumber}`;
}

/** Confirmed: "Pay app #6 certified · $86,310.00". */
export function certConfirmed(appNumber: number, amountCents: number): string {
  return `Pay app #${appNumber} certified · ${money(amountCents)}`;
}

/** Confirmed next line: the PDF opens after the result. */
export function certNextPdf(): string {
  return 'Opening the PDF to share.';
}

/** Confirmed next line: Stripe is not connected, so no Pay button was added. */
export function certNoPayButton(): string {
  return 'No Pay button yet. Connect Stripe to add one.';
}

/** Confirmed next line: Stripe did not make the link. */
export function certPayLinkFailed(): string {
  return 'No Pay button yet. Share the pay app again later to add one.';
}

/** Confirmed next line: the server's balance for this pay app differs, so no link was made. */
export function certPayBalanceRefused(): string {
  return 'No Pay button yet. The server shows a different balance for this pay app.';
}

/** Refused: the server said no, so nothing was certified. */
export function certRefused(): string {
  return 'Not certified. Something went wrong on our side.';
}

/** Refused: an earlier change to this pay app is still waiting on this phone. */
export function certEarlierPending(): string {
  return "Not certified. An earlier change to this pay app hasn't sent yet. Try again in a moment.";
}

/** Refused: an earlier change to this pay app did not send. */
export function certEarlierUnsaved(): string {
  return "Not certified. An earlier change to this pay app hasn't sent. Review unsent changes first.";
}

/** Refused: there is no signed-in account to certify as. */
export function certNoAccount(): string {
  return 'Not certified. Sign in to certify a pay app.';
}

/** Refused: offline at the call, nothing was sent. */
export function certOfflineRefused(): string {
  return "Not certified. You're offline, so nothing was sent.";
}

/** Timeout: "No answer yet. Check pay app #6 before trying again." */
export function certTimeout(appNumber: number): string {
  return `No answer yet. Check pay app #${appNumber} before trying again.`;
}

/** A legal record answered 'queued' (it never can be). */
export function certLegalQueued(): string {
  return 'Not certified. Certifying needs a connection, so nothing was certified.';
}

/** The disabled reason while offline (byte-identical to offlineLegalReason('certifying')). */
export function certOffline(): string {
  return "You're offline. Certifying needs a connection.";
}

/** A confirmed answer that lands after the sheet is gone (a toast): "Pay app #6 certified". */
export function certConfirmedToast(appNumber: number): string {
  return `Pay app #${appNumber} certified`;
}

/** Confirmed next line: the Pay button was still being made when the result came back. */
export function certPayLinkPending(): string {
  return 'The Pay button is still being made. Open the pay app again to see it.';
}
