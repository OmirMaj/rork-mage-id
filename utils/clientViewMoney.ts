// utils/clientViewMoney.ts — money figures over ISSUED invoices, for the
// screens that must agree with the web portal and with each other.
//
// Pure: no React, no network, Bun-importable (validate-health-moneyreport runs it).
//
// ── 1. clientViewMoneyFigures — app/client-view.tsx's money card (MONEY-CLIENTVIEW-DUE-NOW)
//
// The GC's "preview as your client" screen computed its own figures:
//
//   outstanding      = invoicedTotal − paidTotal        ← GROSS of held retention
//   notYetBilled     = revisedContract − invoicedTotal  ← pre-tax minus tax-inclusive
//   balanceRemaining = revisedContract − paidTotal      ← pre-tax minus tax-inclusive
//
// So a $10,000 invoice holding $1,000 retention, paid down to the $9,000 the
// client was asked for, read "Due now $1,000" in the app while the web portal
// (utils/portalSnapshot.ts sections.budget) said $0 for the same job. MONEY-F5
// made the net-of-retention figure the ONLY definition of outstanding
// (utils/invoiceBilling.invoiceOutstanding → projectFinancials.getOutstandingBalance),
// and PORTAL-01 removed the pre-tax/tax-inclusive mix from the portal's bar on
// purpose. This helper is that same arithmetic, on that same population, so the
// preview and the page the homeowner opens cannot give one job two answers.
//
// Population — exactly portalSnapshot's:
//   • paidToDate is summed over every non-draft invoice (getPaidToDate): cash
//     the client sent is cash they sent, even on a document later recalled.
//   • invoicedToDate / outstanding / retentionHeld are summed over the invoices
//     the client can SEE: shared (isShared(portalState)) and not a draft.
//
// The bar is Paid + Due now + Retention held — all three tax-inclusive invoice
// dollars, denominator = their sum (marketing/portal/index.html, "BILLED TO
// DATE"). The pre-tax contract is its own figure and is never subtracted from,
// divided into, or drawn on the same axis as any of them.
//
// ── 2. issuedInvoiceWindowStats — app/weekly-snapshot.tsx (MONEY-DRAFTS-COUNTED b)
//
// The weekly snapshot summed EVERY invoice, drafts included: a draft's full
// balance sat in "Unpaid", a draft issued this week counted as issued, and the
// burn bar filled with money nobody had been asked for. A draft is a document
// issued to nobody (utils/wip.ts DEFINITION 1). Pure here so the guard can run it.

import type { Invoice, ChangeOrder, InvoicePayment } from '@/types';
import { roundCents, invoiceOutstanding } from '@/utils/invoiceBilling';
import { getPaidToDate, getInvoicedToDate, getOutstandingBalance, getRetentionHeld } from '@/utils/projectFinancials';

/** Is this invoice on the client's page? Same rule as utils/portalSnapshot.isShared
 *  (undefined portalState is grandfathered as sent; 'draft' and 'recalled' hide) —
 *  validate-health-moneyreport holds the two together. */
export function sharedWithClient(inv: Pick<Invoice, 'portalState'>): boolean {
  const s = inv.portalState;
  return s == null || s.status === 'sent';
}

export interface ClientViewBarSegment {
  key: 'paid' | 'due' | 'retention';
  label: string;
  amount: number;
  /** Share of the bar, 0–100. The three always sum to 100 when any is non-zero. */
  pct: number;
}

export interface ClientViewMoneyFigures {
  /** Tax-inclusive total of the invoices the client can see (no drafts, no recalled). */
  invoicedToDate: number;
  /** Cash received on every non-draft invoice. */
  paidToDate: number;
  /** What the client can be asked for today — net of retention still held. */
  outstanding: number;
  /** Retention billed but held until closeout (not due now). */
  retentionHeld: number;
  /** Pre-tax contract + approved change orders. Never mixed with the figures above. */
  revisedContract: number;
  /** Σ approved change orders. */
  approvedChanges: number;
  /** Paid / Due now / Retention held, as the portal's "BILLED TO DATE" bar draws it. */
  segments: ClientViewBarSegment[];
  /** Denominator of the bar: paid + outstanding + retentionHeld. */
  barTotal: number;
}

export function clientViewMoneyFigures(input: {
  invoices: readonly Invoice[] | null | undefined;
  contractValue: number;
  changeOrders: readonly ChangeOrder[] | null | undefined;
}): ClientViewMoneyFigures {
  const all = (input.invoices ?? []) as Invoice[];
  const visible = all.filter((i) => sharedWithClient(i) && i.status !== 'draft');

  // The exact four calls utils/portalSnapshot.ts makes for sections.budget.
  const paidToDate = roundCents(getPaidToDate(all));
  const invoicedToDate = roundCents(getInvoicedToDate(visible));
  const outstanding = roundCents(getOutstandingBalance(visible));
  const retentionHeld = roundCents(getRetentionHeld(visible));

  const approvedChanges = roundCents(
    (input.changeOrders ?? [])
      .filter((c) => c.status === 'approved')
      .reduce((s, c) => s + (c.changeAmount ?? 0), 0),
  );
  const contract = Number.isFinite(input.contractValue) ? input.contractValue : 0;
  const revisedContract = roundCents(contract + approvedChanges);

  const paid = Math.max(0, paidToDate);
  const due = Math.max(0, outstanding);
  const held = Math.max(0, retentionHeld);
  const barTotal = roundCents(paid + due + held);
  let segments: ClientViewBarSegment[] = [];
  if (barTotal > 0) {
    const paidPct = (paid / barTotal) * 100;
    const duePct = (due / barTotal) * 100;
    segments = [
      { key: 'paid', label: 'Paid', amount: paid, pct: paidPct },
      { key: 'due', label: 'Due now', amount: due, pct: duePct },
      { key: 'retention', label: 'Retention held', amount: held, pct: Math.max(0, 100 - paidPct - duePct) },
    ];
  }

  return { invoicedToDate, paidToDate, outstanding, retentionHeld, revisedContract, approvedChanges, segments, barTotal };
}

export interface IssuedInvoiceWindowStats {
  issuedCount: number;
  /** Tax-inclusive total of non-draft invoices issued inside the window. */
  totalIssued: number;
  /** Net-of-retention balance still owed on non-draft invoices (MONEY-F5). */
  totalUnpaid: number;
  /** Payments RECEIVED inside the window, on non-draft invoices. */
  paidThisWindow: number;
  /** Tax-inclusive total of every non-draft invoice (the burn bar's numerator). */
  totalBilled: number;
}

export function issuedInvoiceWindowStats(
  invoices: readonly Invoice[] | null | undefined,
  /** Is this issue date inside the window? */
  issuedInWindow: (iso: string | undefined) => boolean,
  /** Was this payment RECEIVED inside the window? (#85 — the received day, not the keying instant.) */
  receivedInWindow: (p: InvoicePayment) => boolean,
): IssuedInvoiceWindowStats {
  const issued = (invoices ?? []).filter((i) => i.status !== 'draft');
  const issuedThisWindow = issued.filter((i) => issuedInWindow(i.issueDate));
  const totalIssued = issuedThisWindow.reduce((s, i) => s + (i.totalDue ?? 0), 0);
  const totalUnpaid = issued.reduce((s, i) => s + invoiceOutstanding(i), 0);
  const paidThisWindow = issued
    .flatMap((i) => i.payments ?? [])
    .filter(receivedInWindow)
    .reduce((s, p) => s + (p.amount ?? 0), 0);
  const totalBilled = issued.reduce((s, i) => s + (i.totalDue ?? 0), 0);
  return { issuedCount: issuedThisWindow.length, totalIssued, totalUnpaid, paidThisWindow, totalBilled };
}
