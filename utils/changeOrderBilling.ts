// changeOrderBilling.ts — the billed-through math for an approved change
// order, pulled out of app/bill-from-estimate.tsx for the same reason
// utils/billFromEstimateCore.ts was: a .tsx screen cannot be imported under
// bun, so money arithmetic that lives in one can only ever be regex-checked.
// This is the money the double-bill guard turns on; it gets to be executed.
//
// MONEY-DEF-2 (audit 2026-09-07): an approved change order moved the contract
// total on six read-only surfaces and had a billable row on none, so the GC
// retyped it by hand — losing the CO number, the approval trail and any
// double-bill guard — or ate it. Both entry points (the "Bill this change
// order" action on app/change-order.tsx and the CO rows on
// app/bill-from-estimate.tsx) read this module, because two implementations of
// "has this CO been billed" is exactly how a CO gets billed twice.

import type { Invoice } from '@/types';
import { billedAmountForLine } from '@/utils/invoiceBilling';

// A CO is carried on the invoice by the same field an estimate line uses,
// `InvoiceLineItem.sourceEstimateItemId`, which survives the invoice editor
// (app/invoice.tsx only ever filters or appends lineItems, never remaps them).
// The prefix is what stops a bare co.id colliding with a
// LinkedEstimateItem.materialId — both are UUIDs off the same generator.
export const CO_BILL_KEY_PREFIX = 'co:';

/** Stable invoice-line key for an approved change order. */
export function changeOrderBillKey(coId: string): string {
  return `${CO_BILL_KEY_PREFIX}${coId}`;
}

/** True when this line was written by one of the CO billing paths. */
export function isChangeOrderBillKey(key: string | undefined): boolean {
  return !!key && key.startsWith(CO_BILL_KEY_PREFIX);
}

/**
 * Dollars already invoiced against this change order, across every NON-DRAFT
 * invoice on the project. Mirrors the estimate-row math on
 * app/bill-from-estimate.tsx (and reuses the same `billedAmountForLine`,
 * including its anyPreScaled invoice-level gate), so "remaining" means one
 * thing wherever it is shown.
 *
 * Drafts are excluded deliberately: a draft the client has never seen must not
 * consume a CO, or a mis-tap would make real money unbillable. The cost of
 * that choice is `pendingDraftNumber` below.
 */
export function billedAgainstChangeOrder(coId: string, invoices: Invoice[]): number {
  const key = changeOrderBillKey(coId);
  return invoices
    .filter(inv => inv.status !== 'draft')
    .flatMap(inv => {
      const anyPreScaled = inv.lineItems.some(l => l.billedPercent != null);
      return inv.lineItems.map(li => ({ li, inv, anyPreScaled }));
    })
    .filter(({ li }) => li.sourceEstimateItemId === key)
    .reduce((sum, { li, inv, anyPreScaled }) => sum + billedAmountForLine(li, inv, anyPreScaled), 0);
}

/** Invoices carrying a line for this CO, highest number first. */
function invoicesCarrying(coId: string, invoices: Invoice[], includeDrafts: boolean): Invoice[] {
  const key = changeOrderBillKey(coId);
  return invoices
    .filter(inv => (includeDrafts ? inv.status === 'draft' : inv.status !== 'draft'))
    .filter(inv => inv.lineItems.some(li => li.sourceEstimateItemId === key))
    .sort((a, b) => (b.number ?? 0) - (a.number ?? 0));
}

/** What the "Bill this change order" control should do and say. */
export type ChangeOrderBillingState =
  /** A credit. There is no line to bill; it lowers the revised contract total. */
  | { kind: 'credit'; amount: number }
  /** Approved at $0 — a scope or schedule change with no money in it. */
  | { kind: 'no_value' }
  /** Every dollar is on a sent invoice. */
  | { kind: 'fully_billed'; already: number; invoiceNumber?: number }
  /** Billable now. `already` > 0 means this is the remainder of a part-bill;
   *  `pendingDraftNumber` means an unsent draft ALREADY carries it, which is
   *  the one way this button can be tapped twice into two invoices. */
  | { kind: 'billable'; remaining: number; already: number; pendingDraftNumber?: number };

/**
 * The whole decision, as a pure function, so the guard runs it rather than
 * grepping for it. `changeAmount` is passed in rather than the ChangeOrder so
 * this stays free of the domain type's 40 other fields.
 */
export function changeOrderBillingState(
  coId: string,
  changeAmount: number,
  invoices: Invoice[],
): ChangeOrderBillingState {
  if (changeAmount < 0) return { kind: 'credit', amount: changeAmount };
  if (changeAmount === 0) return { kind: 'no_value' };

  const already = billedAgainstChangeOrder(coId, invoices);
  const remaining = changeAmount - already;
  // Half a cent, the same tolerance bill-from-estimate uses for "nothing left".
  if (remaining <= 0.009) {
    return { kind: 'fully_billed', already, invoiceNumber: invoicesCarrying(coId, invoices, false)[0]?.number };
  }
  return {
    kind: 'billable',
    remaining,
    already,
    pendingDraftNumber: invoicesCarrying(coId, invoices, true)[0]?.number,
  };
}
