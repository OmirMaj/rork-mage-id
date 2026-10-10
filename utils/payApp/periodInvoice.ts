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
// Only money he entered becomes a line: `thisPeriod` above zero. A suggestion
// he did not accept is not in `thisPeriod`, so it cannot reach the invoice.
//
// Pure: ids, the clock and the number are passed in.
import type { Invoice, InvoiceLineItem, LinkedEstimateItem, PaymentTerms } from '@/types';
import type { AIASOVLine } from '@/utils/aiaBilling';
import { retainageOnWorkValue, roundCents } from '@/utils/invoiceBilling';
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
  paymentTerms: PaymentTerms;
  /** The pay application's completed-work rate, so the two documents hold the same retainage. */
  retainagePercent: number;
  /** Id makers, passed in so the function stays pure. */
  newInvoiceId: () => string;
  newLineId: () => string;
}

/** The lines that carry this period's money, in schedule-of-values order. */
export function billedLines(lines: readonly AIASOVLine[]): AIASOVLine[] {
  return lines.filter(l => roundCents(l.thisPeriod) > 0);
}

/**
 * The draft progress invoice for this period, or null when no line bills
 * anything (there is no period to invoice).
 */
export function buildPeriodInvoice(input: PeriodInvoiceInput): Invoice | null {
  const active = billedLines(input.lines);
  if (active.length === 0) return null;
  const byKey = new Map<string, LinkedEstimateItem>();
  for (const item of input.estimateItems ?? []) byKey.set(item.materialId || item.name, item);

  const lineItems: InvoiceLineItem[] = active.map((l) => {
    const key = billKeyOfLineId(l.id);
    const item = key && !key.startsWith(CO_BILL_KEY_PREFIX) ? byKey.get(key) : undefined;
    const total = roundCents(l.thisPeriod);
    const remaining = roundCents(l.scheduledValue - l.fromPreviousApp - l.materialsPresentlyStored);
    const pct = remaining > 0 ? Math.max(0, Math.min(100, (total / remaining) * 100)) : 100;
    const priced = billFromEstimateLine({
      quantity: item?.quantity ?? 1,
      lineTotal: l.scheduledValue,
      fallbackUnitPrice: l.scheduledValue,
      billAmount: total,
    });
    return {
      id: input.newLineId(),
      name: l.description || `Item ${l.itemNo}`,
      description: `Pay Application ${input.applicationNumber}, Item ${l.itemNo}`,
      quantity: priced.quantity,
      unit: item?.unit ?? 'ls',
      unitPrice: priced.unitPrice,
      total: priced.total,
      // billedPercent on EVERY line: it is what tells billedAmountForLine the
      // total is already this period's dollars (a progress line without it is
      // scaled by the invoice's progress percent a second time).
      billedPercent: pct,
      ...(key ? { sourceEstimateItemId: key } : {}),
    };
  });

  const subtotal = roundCents(lineItems.reduce((s, li) => s + li.total, 0));
  const taxRate = Number.isFinite(input.taxRate) && input.taxRate > 0 ? input.taxRate : 0;
  const taxAmount = roundCents(subtotal * (taxRate / 100));
  const totalDue = roundCents(subtotal + taxAmount);
  const scheduled = roundCents(input.lines.reduce((s, l) => s + Math.max(0, l.scheduledValue), 0));
  const rate = Number.isFinite(input.retainagePercent) ? Math.max(0, Math.min(100, input.retainagePercent)) : 0;

  return {
    id: input.newInvoiceId(),
    number: input.number,
    projectId: input.projectId,
    type: 'progress',
    progressPercent: Math.round((subtotal / (scheduled || 1)) * 100),
    issueDate: input.now,
    dueDate: dueDateForTerms(input.now, input.paymentTerms),
    paymentTerms: input.paymentTerms,
    notes: '',
    lineItems,
    subtotal,
    taxRate,
    taxAmount,
    totalDue,
    amountPaid: 0,
    status: 'draft',
    payments: [],
    retentionPercent: rate,
    retentionAmount: rate > 0 ? retainageOnWorkValue(subtotal, rate) : undefined,
    retentionReleased: 0,
    retentionReleases: [],
    createdAt: input.now,
    updatedAt: input.now,
  };
}
