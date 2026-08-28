// apReconciliation.ts — did this sub invoice actually get reconciled?
//
// MAGE does not move money. "Mark paid" records a payment the GC made somewhere
// else (check, ACH, card, cash), so paid-vs-owed reconciles against a bank
// statement and the 1099/audit trail is real. A paid invoice with no method or
// reference is a bare status flip — it closes the balance in the app while
// leaving nothing to tie to the bank. This module names that gap so the UI can
// show it and the GC can close it.
//
// Pure + testable (scripts/validate-ap-reconciliation.ts).

/** How the GC paid — vocabulary pinned by the payment_method CHECK constraint
 *  in 20260826120000_ap_payment_reconciliation.sql. */
export type PaymentMethod = 'check' | 'ach' | 'card' | 'cash' | 'other';

export const PAYMENT_METHODS: readonly PaymentMethod[] = ['check', 'ach', 'card', 'cash', 'other'];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  check: 'Check',
  ach: 'ACH / transfer',
  card: 'Card',
  cash: 'Cash',
  other: 'Other',
};

/** What the reference field is called for each method — a check has a number,
 *  an ACH has a trace. Asking for the right thing is what makes it get filled. */
export const REFERENCE_LABELS: Record<PaymentMethod, string> = {
  check: 'Check number',
  ach: 'Trace / confirmation number',
  card: 'Last 4 / confirmation',
  cash: 'Receipt or note',
  other: 'Reference',
};

/** Cash genuinely may have no reference — don't nag for one. Every other
 *  method leaves a paper trail that SHOULD be recorded. */
const REFERENCE_OPTIONAL: ReadonlySet<PaymentMethod> = new Set<PaymentMethod>(['cash', 'other']);

export interface ReconcilableInvoice {
  status: string;
  paymentMethod?: string;
  paymentReference?: string;
  paidOn?: string;
}

export type ReconciliationState =
  /** Not paid yet — reconciliation doesn't apply. */
  | 'not_applicable'
  /** Paid, but recorded with no payment detail — nothing ties it to the bank. */
  | 'unreconciled'
  /** Paid with a method + date but missing the reference that method implies. */
  | 'partial'
  /** Paid with everything needed to match a bank line. */
  | 'reconciled';

export function isPaymentMethod(v: unknown): v is PaymentMethod {
  return typeof v === 'string' && (PAYMENT_METHODS as readonly string[]).includes(v);
}

/** Classify how completely a paid invoice is reconciled. */
export function reconciliationState(inv: ReconcilableInvoice): ReconciliationState {
  if (inv.status !== 'paid') return 'not_applicable';

  const method = isPaymentMethod(inv.paymentMethod) ? inv.paymentMethod : null;
  const hasDate = !!(inv.paidOn && inv.paidOn.trim());
  const hasRef = !!(inv.paymentReference && inv.paymentReference.trim());

  // No method at all → a bare status flip, the case this feature exists to fix.
  if (!method) return 'unreconciled';
  if (!hasDate) return 'partial';
  if (!hasRef && !REFERENCE_OPTIONAL.has(method)) return 'partial';
  return 'reconciled';
}

/** True when the GC should be nudged to add payment detail. */
export function needsReconciliation(inv: ReconcilableInvoice): boolean {
  const s = reconciliationState(inv);
  return s === 'unreconciled' || s === 'partial';
}

/** Short label for the reconciliation chip, or null when it doesn't apply. */
export function reconciliationLabel(inv: ReconcilableInvoice): string | null {
  switch (reconciliationState(inv)) {
    case 'reconciled': return 'Reconciled';
    case 'partial': return 'Missing detail';
    case 'unreconciled': return 'No payment detail';
    default: return null;
  }
}

/** One-line summary of how it was paid, e.g. "Check #1042 · Mar 3, 2026".
 *  Returns null when there's nothing recorded. */
export function paymentSummary(inv: ReconcilableInvoice): string | null {
  const method = isPaymentMethod(inv.paymentMethod) ? inv.paymentMethod : null;
  if (!method) return null;
  const parts: string[] = [PAYMENT_METHOD_LABELS[method]];
  const ref = inv.paymentReference?.trim();
  if (ref) parts.push(method === 'check' ? `#${ref.replace(/^#/, '')}` : ref);
  const on = inv.paidOn?.trim();
  if (on) {
    const d = new Date(on.length <= 10 ? `${on}T00:00:00` : on);
    if (!isNaN(d.getTime())) {
      parts.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }));
    }
  }
  return parts.join(' · ');
}

/** How many paid invoices still need detail — drives the "N payments need
 *  detail" nudge on the AP surface. */
export function countNeedingReconciliation(invoices: ReconcilableInvoice[]): number {
  return invoices.filter(needsReconciliation).length;
}
