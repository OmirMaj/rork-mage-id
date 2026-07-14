// Pure invoice/billing math — extracted so the money-critical formulas are
// unit-tested (scripts/validate-invoice-billing.ts) and shared by every path
// that computes a charge, a subtotal, or an "already billed" figure. Keeping
// these in one place stops the paths from drifting apart (which is exactly how
// the double-scale / retention-overcharge / already-billed bugs happened).
//
// NONE of these functions round to currency beyond what's noted — callers own
// display formatting. All return non-negative dollars.

export interface BillingLine {
  total: number;
  // Present only on Bill-from-Estimate lines, whose `total` is ALREADY scaled
  // to the billed portion at creation. Native editor lines omit it and carry a
  // FULL line total that the invoice-level progress % scales at read time.
  billedPercent?: number | null;
}

/**
 * Progress-invoice subtotal that does NOT double-scale already-scaled lines.
 *
 * Two invoice-creation paths store `line.total` in incompatible units:
 *  - Bill-from-Estimate stores an ALREADY-scaled amount (billAmount) + billedPercent.
 *  - The native editor stores the FULL line total and scales only the subtotal.
 * Applying the invoice-level progress % to bill-from-estimate lines scales them
 * a second time (30% of a stored-30% amount = 9%). Gate the scaling: only apply
 * it when NO line is pre-scaled.
 */
export function progressSubtotal(
  lineItems: readonly BillingLine[],
  isProgressType: boolean,
  pctValue: number,
): number {
  const rawTotal = lineItems.reduce((sum, li) => sum + (li.total || 0), 0);
  const anyPreScaled = lineItems.some((li) => li.billedPercent != null);
  if (isProgressType && !anyPreScaled) return rawTotal * (pctValue / 100);
  return rawTotal;
}

export interface NetBalanceInput {
  totalDue: number;
  amountPaid?: number;
  retentionAmount?: number;
  retentionReleased?: number;
}

/**
 * Retention-net collectible balance for a Stripe pay link.
 *
 * Retention is contractually held back until closeout, so an emailed / portal
 * pay link must charge (totalDue − pendingRetention − amountPaid) — matching the
 * in-app "Generate Payment Link" button. Charging the gross totalDue bills the
 * client the retention they're not supposed to pay yet. Never returns negative.
 */
export function netBalanceDue(inv: NetBalanceInput): number {
  const retentionPending = Math.max(0, (inv.retentionAmount ?? 0) - (inv.retentionReleased ?? 0));
  const netPayable = Math.max(0, (inv.totalDue ?? 0) - retentionPending);
  return Math.max(0, netPayable - (inv.amountPaid ?? 0));
}

export interface BilledLine {
  total: number;
  billedPercent?: number | null;
}

export interface BilledInvoiceMeta {
  type?: string;
  progressPercent?: number | null;
}

/**
 * How much a single invoice line actually billed against its estimate row —
 * used to compute "already billed" so the remaining balance can be re-billed.
 * MUST stay consistent with progressSubtotal: for any invoice,
 * sum(billedAmountForLine) === progressSubtotal(its lines) — otherwise the
 * already-billed total drifts from what was actually charged.
 *
 *  - Bill-from-Estimate lines (billedPercent present) store the SCALED amount in
 *    `total`, so `total` IS the billed dollars.
 *  - Native editor progress invoices store FULL line totals and scale only at the
 *    invoice level — UNLESS the invoice also contains a pre-scaled line, in which
 *    case progressSubtotal charges every line unscaled (the anyPreScaled gate), so
 *    this line's billed amount is its full `total`, not a fraction of it. That
 *    mixed case (e.g. a voice-added line on a bill-from-estimate invoice) is why
 *    `anyPreScaledInInvoice` is threaded in: without it, a mixed line is
 *    under-counted and the difference is wrongly offered for re-billing.
 *  - Full (non-progress) invoices bill 100% of the line.
 *
 * Unknown progress % (null/undefined on a progress invoice — a data-integrity
 * edge, since both creation paths stamp it) deliberately falls back to FULL
 * weighting: over-counting merely blocks re-billing via this screen (the GC can
 * still bill in the editor), whereas under-counting would let the same work be
 * billed twice and double-charge the client. When in doubt, do not under-count.
 */
export function billedAmountForLine(
  li: BilledLine,
  inv: BilledInvoiceMeta | undefined,
  anyPreScaledInInvoice = false,
): number {
  const total = li.total || 0;
  if (li.billedPercent != null) return total;
  if (inv?.type === 'progress' && !anyPreScaledInInvoice) {
    const ratio = (inv.progressPercent ?? 100) / 100;
    return total * ratio;
  }
  return total;
}

/**
 * Fold estimate markup into the invoice line's displayed unit price so that
 * quantity × unitPrice = lineTotal on the invoice and PDF.
 *
 * The estimate stores a PRE-markup unitPrice and a markup-INCLUSIVE lineTotal;
 * copying both across verbatim makes the printed row not foot (100 × $10 shown
 * next to a $1,200 total). Derive an effective unit price from the total. The
 * line `total` stays authoritative (it drives the billed amount); only the
 * displayed unit price is adjusted, so this never changes what's charged.
 */
export function markupInclusiveUnitPrice(lineTotal: number, quantity: number, fallbackPrice: number): number {
  if (quantity > 0) return Math.round((lineTotal / quantity) * 100) / 100;
  return fallbackPrice;
}
