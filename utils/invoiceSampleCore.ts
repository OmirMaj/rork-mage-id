// utils/invoiceSampleCore.ts — the pure rules behind the invoice screen's
// sample job and the invoice-to-self tutorial. No React, no RN: the email
// fragments and the two screen decisions live here so
// scripts/validate-invoice-to-self.ts can run them under bun, while
// app/invoice.tsx and utils/emailService.ts (which import react-native and
// cannot run under bun) only wire them in.
//
// WHY A SAMPLE INVOICE IS SENT AT ALL. The tutorial's promise is "see what
// your client gets": the real send path runs, the real email builder renders,
// and it lands in HIS inbox. What makes that safe is utils/sampleGuard (the
// recipient is locked to his own address, no pay link is minted, the server
// refuses one too) plus the two fragments below, which make the email say
// what it is.

import { escapeHtml, fmtMoneyCents } from '@/utils/emailLayout';
import { SAMPLE_PAY_SPECIMEN_NOTE } from '@/utils/sampleGuard';

/** The banner's leading word — pinned by the validator and the smoke check. */
export const SAMPLE_EMAIL_BANNER_WORD = 'SAMPLE';

/**
 * Top-of-email banner on an invoice sent from a sample job. Says plainly what
 * it is, so the email cannot be mistaken for a real bill if it is forwarded or
 * found later. Inline hex: email clients ignore the app's theme tokens.
 */
export function sampleInvoiceBannerHtml(): string {
  return '<div style="margin:0 0 16px;padding:10px 14px;border:1px dashed #9AA3AD;border-radius:8px;background:#F4F5F2;color:#2B3036;font-size:13px;line-height:1.45;">'
    + `<strong style="letter-spacing:0.08em;">${SAMPLE_EMAIL_BANNER_WORD}</strong> — a practice invoice from a sample job in MAGE ID. `
    + 'It was sent to you only; nothing here is owed and no client received it.'
    + '</div>';
}

/**
 * Where the Pay button sits on a real invoice: a look-alike that is NOT a link
 * (a <div>, never an <a> or an href), labelled as a specimen. The GC sees what
 * his client would tap; nobody can pay a sample.
 */
export function samplePaySpecimenHtml(totalDue: number): string {
  return '<div style="margin:14px 0 0;text-align:center;">'
    + `<div style="display:inline-block;padding:12px 22px;border-radius:999px;border:1px dashed #9AA3AD;color:#4A5159;font-weight:600;font-size:14px;">Pay securely · ${escapeHtml(fmtMoneyCents(totalDue))}</div>`
    + `<p style="margin:8px 0 0;color:#4A5159;font-size:12px;">${escapeHtml(SAMPLE_PAY_SPECIMEN_NOTE)}</p>`
    + '</div>';
}

/**
 * When the screen reports `invoice.amount.set` (the "Bill 15%" step).
 *
 * Only after HE changed the percentage (typed it, or 'Do it for me' filled
 * it). The field opens prefilled — 30 %, or the schedule's earned value — so
 * "percent > 0 and total > 0" alone is true on mount and would tick the step
 * before he had done anything: a step advances on the real action, never on
 * the screen's own default.
 */
export function invoiceAmountSignalReady(a: {
  touched: boolean;
  isProgress: boolean;
  percent: number;
  total: number;
}): boolean {
  return a.touched && a.isProgress
    && Number.isFinite(a.percent) && a.percent > 0
    && Number.isFinite(a.total) && a.total > 0;
}

/** Debounce for `invoice.amount.set`: he is still typing "15" at "1". */
export const INVOICE_AMOUNT_SIGNAL_DEBOUNCE_MS = 600;

/**
 * Whether any of the invoice screen's layer-less RN Modals is up — the
 * `invoice.modalUp` blocker sentinel (utils/tutorial/registry BLOCKER_TARGETS).
 * On iOS those modals draw ABOVE the root tutorial layer, so while one is up
 * the coach must draw nothing (no dim, ring or card behind the sheet).
 * `sendInFlight` counts too: after the sheet closes, the email takes seconds
 * and the screen then pops — the "Send to me" spotlight must not come back in
 * that window (the success stamp is exempt from blockers).
 */
export function invoiceModalUp(f: {
  sendSheet: boolean;
  retainageAsk: boolean;
  retention: boolean;
  payment: boolean;
  contactPicker: boolean;
  pdfPreSend: boolean;
  receivedDatePicker: boolean;
  sendInFlight: boolean;
}): boolean {
  return f.sendSheet || f.retainageAsk || f.retention || f.payment
    || f.contactPicker || f.pdfPreSend || f.receivedDatePicker || f.sendInFlight;
}
