// utils/payApp/periodInvoice.ts — the progress invoice behind a pay
// application that was started from Bill This Month.
//
// A pay application on this app is keyed to a progress invoice (the period IS
// the invoice: app/aia-pay-app.tsx). Bill This Month lets the contractor start
// from the last application instead of from a new invoice, so the invoice is
// made here, from the lines he accepted or typed, when he saves the period.
//
// It is the same record Bill From Estimate writes (app/bill-from-estimate.tsx
// handleCreateDraft): a DRAFT progress invoice, one line per billed line, each
// carrying `sourceEstimateItemId` and `billedPercent` so the next Bill From
// Estimate and the pay application's own seed read it the way they read any
// other. The screen saves it through the same addInvoice path.
//
// Only money he entered becomes a line: a `thisPeriod` that is not zero (a
// credit line he entered is a negative line). A suggestion he did not accept
// is not in `thisPeriod`, so it cannot reach the invoice.
//
// THE INVOICE MATCHES THE PAY APPLICATION, TO THE CENT.
//   • Work: the subtotal is the sum of `thisPeriod`.
//   • Retainage: what the pay application holds for THIS PERIOD, line by line
//     at each line's own rate (periodRetainage). An invoice stores one percent,
//     and every reader works retainage out as percent × subtotal
//     (utils/invoiceBilling effectiveRetentionHeld), so on mixed rates the
//     percent stored is the one that gives the pay application's figure
//     exactly. One rate on every line is stored as that rate.
//   • Payment terms: never a silent Net 30. Terms the contractor has not
//     confirmed leave the due date EMPTY (`''`), and the invoice editor then
//     says the terms are the app default until he picks.
//
// Pure: ids, the clock and the number are passed in.
import type { Invoice, InvoiceLineItem, LinkedEstimateItem, PaymentTerms } from '@/types';
import type { AIASOVLine } from '@/utils/aiaBilling';
import { effectiveRetentionHeld, retainageOnWorkValue, roundCents } from '@/utils/invoiceBilling';
import { billFromEstimateLine } from '@/utils/billFromEstimateCore';
import { dueDateForTerms } from '@/utils/retainage';
import { CO_BILL_KEY_PREFIX } from '@/utils/changeOrderBilling';

/** `sov_<key>` → `<key>`: an estimate key or a change-order bill key. Null for a hand-added or imported line. */
export function billKeyOfLineId(lineId: string): string | null {
  if (!lineId.startsWith('sov_')) return null;
  const key = lineId.slice(4).replace(/__\d+$/, '');
  if (!key || key.startsWith('manual_') || key.startsWith('imp_')) return null;
  return key;
}

export interface PeriodInvoiceTerms {
  paymentTerms: PaymentTerms;
  /**
   * True when the contractor has told the app these terms (his last invoice on
   * this job, or his finished cash-flow setup). False = the app's own default:
   * the invoice then carries NO due date until he picks terms on it.
   */
  confirmed: boolean;
}

export interface PeriodInvoiceInput {
  projectId: string;
  lines: readonly AIASOVLine[];
  /** The linked estimate's items, for quantity and unit (optional). */
  estimateItems?: readonly LinkedEstimateItem[];
  applicationNumber: number;
  /** Next invoice number on the project (nextInvoiceNumberFrom). */
  number: number;
  /** ISO instant, passed in. */
  now: string;
  taxRate: number;
  terms: PeriodInvoiceTerms;
  /** Id makers, passed in so the function stays pure. */
  newInvoiceId: () => string;
  newLineId: () => string;
}

/** The lines that carry this period's money (work, or a credit), in schedule-of-values order. */
export function billedLines(lines: readonly AIASOVLine[]): AIASOVLine[] {
  return lines.filter(l => roundCents(l.thisPeriod) !== 0);
}

type PeriodLine = Pick<AIASOVLine, 'fromPreviousApp' | 'thisPeriod' | 'retainagePercent'>;

/** Work entered for this period: the sum of `thisPeriod`, to the cent. */
export function periodWork(lines: readonly Pick<AIASOVLine, 'thisPeriod'>[]): number {
  return roundCents(lines.reduce((s, l) => s + roundCents(l.thisPeriod), 0));
}

/**
 * What the pay application holds on THIS PERIOD'S work: on each line, the
 * retainage on work to date less the retainage on work before this period, at
 * that line's own rate and rounded the way the continuation sheet rounds it
 * (per line, to the cent). It is the amount the cover's retainage on completed
 * work moves by when this period's work is entered. Stored material is not a
 * line on the invoice and is not in here.
 */
export function periodRetainage(lines: readonly PeriodLine[]): number {
  return roundCents(lines.reduce((s, l) => s
    + retainageOnWorkValue(l.fromPreviousApp + l.thisPeriod, l.retainagePercent)
    - retainageOnWorkValue(l.fromPreviousApp, l.retainagePercent), 0));
}

/**
 * The retainage columns an invoice needs so that EVERY reader of it
 * (effectiveRetentionHeld: percent × subtotal) arrives at `held`, to the cent.
 */
export function invoiceRetentionFor(subtotal: number, held: number, lineRates: readonly number[]): {
  retentionPercent: number | undefined; retentionAmount: number | undefined;
} {
  const target = roundCents(held);
  if (!(target > 0) || !(subtotal > 0)) return { retentionPercent: 0, retentionAmount: undefined };
  const gives = (pct: number): boolean =>
    effectiveRetentionHeld({ subtotal, retentionPercent: pct, retentionAmount: target }) === target;
  const rates = [...new Set(lineRates)];
  if (rates.length === 1 && gives(rates[0])) return { retentionPercent: rates[0], retentionAmount: target };
  // Mixed rates (or one rate whose per-line cents do not add up to rate ×
  // subtotal): the percent that gives the pay application's figure exactly.
  const blended = (target / subtotal) * 100;
  for (const pct of [blended, blended + 1e-10, blended - 1e-10, blended + 1e-8, blended - 1e-8]) {
    if (pct > 0 && pct <= 100 && gives(pct)) return { retentionPercent: pct, retentionAmount: target };
  }
  // No percent reproduces it: the stored amount stands by itself (a row with
  // an amount and no percent is read as that amount).
  return { retentionPercent: undefined, retentionAmount: target };
}

/** The description a period invoice's line carries: how the invoice is recognised later. */
const lineTag = (applicationNumber: number, itemNo: string): string => `Pay Application ${applicationNumber}, Item ${itemNo}`;
const LINE_TAG = /^Pay Application (\d+), Item /;

function buildLineItems(input: Pick<PeriodInvoiceInput, 'lines' | 'estimateItems' | 'applicationNumber' | 'newLineId'>, keep?: readonly InvoiceLineItem[]): InvoiceLineItem[] {
  const byKey = new Map<string, LinkedEstimateItem>();
  for (const item of input.estimateItems ?? []) byKey.set(item.materialId || item.name, item);
  const keptId = new Map<string, string>();
  for (const li of keep ?? []) if (li.description && !keptId.has(li.description)) keptId.set(li.description, li.id);

  return billedLines(input.lines).map((l) => {
    const key = billKeyOfLineId(l.id);
    const item = key && !key.startsWith(CO_BILL_KEY_PREFIX) ? byKey.get(key) : undefined;
    const total = roundCents(l.thisPeriod);
    const remaining = roundCents(l.scheduledValue - l.fromPreviousApp - l.materialsPresentlyStored);
    const share = remaining !== 0 ? (total / remaining) * 100 : 100;
    const pct = Math.max(0, Math.min(100, Number.isFinite(share) ? share : 100));
    // A credit line is one lump at its own (negative) amount.
    const priced = total < 0
      ? { quantity: 1, unitPrice: total, total }
      : billFromEstimateLine({
        quantity: item?.quantity ?? 1,
        lineTotal: l.scheduledValue,
        fallbackUnitPrice: l.scheduledValue,
        billAmount: total,
      });
    const description = lineTag(input.applicationNumber, l.itemNo);
    return {
      id: keptId.get(description) ?? input.newLineId(),
      name: l.description || `Item ${l.itemNo}`,
      description,
      quantity: priced.quantity,
      unit: total < 0 ? 'ls' : (item?.unit ?? 'ls'),
      unitPrice: priced.unitPrice,
      total: priced.total,
      // billedPercent on EVERY line: it is what tells billedAmountForLine the
      // total is already this period's dollars (a progress line without it is
      // scaled by the invoice's progress percent a second time).
      billedPercent: pct,
      ...(key ? { sourceEstimateItemId: key } : {}),
    };
  });
}

/** The money columns of a period invoice, from the pay application's lines. */
function moneyColumns(lines: readonly AIASOVLine[], lineItems: readonly InvoiceLineItem[], taxRateIn: number): Pick<
  Invoice, 'subtotal' | 'taxRate' | 'taxAmount' | 'totalDue' | 'progressPercent' | 'retentionPercent' | 'retentionAmount'
> {
  const subtotal = roundCents(lineItems.reduce((s, li) => s + li.total, 0));
  const taxRate = Number.isFinite(taxRateIn) && taxRateIn > 0 ? taxRateIn : 0;
  const taxAmount = roundCents(subtotal * (taxRate / 100));
  const totalDue = roundCents(subtotal + taxAmount);
  const scheduled = roundCents(lines.reduce((s, l) => s + Math.max(0, l.scheduledValue), 0));
  const retention = invoiceRetentionFor(subtotal, periodRetainage(lines), billedLines(lines).map(l => l.retainagePercent));
  return {
    subtotal, taxRate, taxAmount, totalDue,
    progressPercent: Math.round((subtotal / (scheduled || 1)) * 100),
    retentionPercent: retention.retentionPercent,
    retentionAmount: retention.retentionAmount,
  };
}

/**
 * The draft progress invoice for this period, or null when no line bills
 * anything (there is no period to invoice).
 */
export function buildPeriodInvoice(input: PeriodInvoiceInput): Invoice | null {
  const lineItems = buildLineItems(input);
  if (lineItems.length === 0) return null;
  return {
    id: input.newInvoiceId(),
    number: input.number,
    projectId: input.projectId,
    type: 'progress',
    issueDate: input.now,
    // No due date is worked out from terms he has not confirmed.
    dueDate: input.terms.confirmed ? dueDateForTerms(input.now, input.terms.paymentTerms) : '',
    paymentTerms: input.terms.paymentTerms,
    notes: '',
    lineItems,
    ...moneyColumns(input.lines, lineItems, input.taxRate),
    amountPaid: 0,
    status: 'draft',
    payments: [],
    retentionReleased: 0,
    retentionReleases: [],
    createdAt: input.now,
    updatedAt: input.now,
  };
}

// ── After the period is saved: the invoice and the application, kept in step ─

type InvoiceLike = Pick<Invoice, 'lineItems' | 'status' | 'amountPaid' | 'payments' | 'payLinkUrl' | 'subtotal' | 'retentionPercent' | 'retentionAmount'>;

/** The application number a period invoice was made for, or null when the invoice was not made by Bill This Month. */
export function periodInvoiceApplicationNumber(invoice: Pick<Invoice, 'lineItems'> | null | undefined): number | null {
  if (!invoice || invoice.lineItems.length === 0) return null;
  let n: number | null = null;
  for (const li of invoice.lineItems) {
    const m = LINE_TAG.exec(li.description ?? '');
    if (!m) return null;
    const here = Number(m[1]);
    if (n != null && n !== here) return null;
    n = here;
  }
  return n;
}

/**
 * May the app rewrite this invoice's amounts from the pay application? Only an
 * invoice Bill This Month made, that is still a draft, with no payment and no
 * pay link. Anything further along is a document that went somewhere, and the
 * app says the two differ instead of changing it.
 */
export function periodInvoiceCanFollow(invoice: InvoiceLike | null | undefined): boolean {
  if (!invoice || periodInvoiceApplicationNumber(invoice) == null) return false;
  return invoice.status === 'draft' && !(invoice.amountPaid > 0) && (invoice.payments ?? []).length === 0 && !invoice.payLinkUrl;
}

export interface PeriodInvoiceComparison {
  differs: boolean;
  invoiceWork: number;
  applicationWork: number;
  invoiceRetainage: number;
  applicationRetainage: number;
}

/** The invoice's work and retainage against the pay application's, for this period, to the cent. */
export function comparePeriodInvoice(invoice: InvoiceLike, lines: readonly AIASOVLine[]): PeriodInvoiceComparison {
  const invoiceWork = roundCents(invoice.subtotal);
  const applicationWork = periodWork(lines);
  const invoiceRetainage = effectiveRetentionHeld(invoice);
  const applicationRetainage = applicationWork > 0 ? Math.max(0, periodRetainage(lines)) : 0;
  return {
    differs: Math.abs(invoiceWork - applicationWork) > 0.005 || Math.abs(invoiceRetainage - applicationRetainage) > 0.005,
    invoiceWork, applicationWork, invoiceRetainage, applicationRetainage,
  };
}

/**
 * The columns to write onto a period invoice so its amounts follow the pay
 * application's lines as they are now: the line items (ids kept where the item
 * is still billed), the subtotal, tax at the invoice's own rate, the total and
 * the retainage. Number, dates, terms, notes and status are not touched. Null
 * when the invoice may not follow (periodInvoiceCanFollow) or nothing is
 * billed (an invoice with no lines is not written; the notice says they differ).
 */
export function periodInvoiceFollowUpdate(input: {
  invoice: Invoice;
  lines: readonly AIASOVLine[];
  estimateItems?: readonly LinkedEstimateItem[];
  newLineId: () => string;
}): Pick<Invoice, 'lineItems' | 'subtotal' | 'taxRate' | 'taxAmount' | 'totalDue' | 'progressPercent' | 'retentionPercent' | 'retentionAmount'> | null {
  const applicationNumber = periodInvoiceApplicationNumber(input.invoice);
  if (applicationNumber == null || !periodInvoiceCanFollow(input.invoice)) return null;
  const lineItems = buildLineItems({ lines: input.lines, estimateItems: input.estimateItems, applicationNumber, newLineId: input.newLineId }, input.invoice.lineItems);
  if (lineItems.length === 0) return null;
  return { lineItems, ...moneyColumns(input.lines, lineItems, input.invoice.taxRate) };
}
