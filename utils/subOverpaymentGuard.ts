// subOverpaymentGuard — pre-approval check that prevents the GC from
// approving a sub-submitted invoice that would push their cumulative
// approved+paid invoices on a commitment ABOVE the contract value.
//
// Why this exists: pre-fix, the GC could approve $6k of invoices against
// a $5k commitment with no warning. Job-costing read commitments thinking
// nothing was over budget. Multi-thousand-dollar leak per project at
// scale. Audit finding T1.2.
//
// Usage (in the approval flow):
//   const overage = checkSubInvoiceOverpayment({ invoice, allInvoices, commitments });
//   if (overage) { Alert.alert(...) — let GC confirm or cancel; }

import type { Commitment, SubSubmittedInvoice } from '@/types';

export interface OverpaymentCheck {
  /** True when approving this invoice would tip the commitment over budget. */
  isOverpayment: boolean;
  /** Contract-to-date for the commitment (amount + changeAmount). */
  contractToDate: number;
  /** Already-approved + paid invoices on this commitment, EXCLUDING the
   *  one being approved (so the caller can show "currently approved: $X"). */
  alreadyCommitted: number;
  /** What this approval would push the total to. */
  wouldBecome: number;
  /** Commitment number for the user-facing message. */
  commitmentNumber: string;
  /** How much the approval would exceed the commitment by. >0 only when
   *  isOverpayment is true. */
  overageAmount: number;
}

interface Args {
  /** The invoice the GC is about to approve. */
  invoice: SubSubmittedInvoice;
  /** All sub-submitted invoices on the project (or at least all touching
   *  the same commitment). The check filters by commitmentId itself. */
  allInvoices: SubSubmittedInvoice[];
  /** All commitments — used to look up the contract value by id. */
  commitments: Commitment[];
}

/**
 * Run the overage check. Returns null when:
 *  - the invoice has no linked commitment (no guard possible)
 *  - the commitment can't be found (data integrity issue, fail-open
 *    rather than block — the GC might be approving valid scope they
 *    just haven't fully linked yet)
 *  - the new total stays within budget
 *
 * Returns OverpaymentCheck with isOverpayment=true when it would exceed.
 */
export function checkSubInvoiceOverpayment(args: Args): OverpaymentCheck | null {
  const { invoice, allInvoices, commitments } = args;
  if (!invoice.commitmentId) return null;
  const commitment = commitments.find(c => c.id === invoice.commitmentId);
  if (!commitment) return null;

  const contractToDate = (commitment.amount ?? 0) + (commitment.changeAmount ?? 0);

  // Sum approved + paid invoices on the same commitment, excluding this
  // one (since we're checking what it WOULD do). 'submitted' and
  // 'rejected' don't count toward exposure.
  const alreadyCommitted = allInvoices
    .filter(i => i.id !== invoice.id)
    .filter(i => i.commitmentId === commitment.id)
    .filter(i => i.status === 'approved' || i.status === 'paid')
    .reduce((sum, i) => sum + (i.amount ?? 0), 0);

  const wouldBecome = alreadyCommitted + (invoice.amount ?? 0);
  const isOverpayment = wouldBecome > contractToDate + 0.01; // float-noise guard

  return {
    isOverpayment,
    contractToDate,
    alreadyCommitted,
    wouldBecome,
    commitmentNumber: commitment.number ?? '—',
    overageAmount: Math.max(0, wouldBecome - contractToDate),
  };
}

/**
 * Build the user-facing confirmation message when a guard fires. Caller
 * passes this to Alert.alert as the body so the dialog explains the
 * exposure clearly without requiring the GC to do mental math.
 */
export function buildOverpaymentMessage(check: OverpaymentCheck, currency: string = 'USD'): string {
  const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
  return [
    `This invoice would push commitment #${check.commitmentNumber} OVER its contract value.`,
    '',
    `Contract value:        ${fmt(check.contractToDate)}`,
    `Already committed:     ${fmt(check.alreadyCommitted)}`,
    `This invoice:          ${fmt(check.wouldBecome - check.alreadyCommitted)}`,
    `New total would be:    ${fmt(check.wouldBecome)}`,
    `Overage:               ${fmt(check.overageAmount)}`,
    '',
    'This usually means a change order is missing, or the sub is over-billing scope. Approve only if you intended to.',
  ].join('\n');
}
