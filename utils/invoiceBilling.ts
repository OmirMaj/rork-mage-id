// Pure invoice/billing math — extracted so the money-critical formulas are
// unit-tested (scripts/validate-invoice-billing.ts) and shared by every path
// that computes a charge, a subtotal, or an "already billed" figure. Keeping
// these in one place stops the paths from drifting apart (which is exactly how
// the double-scale / retention-overcharge / already-billed bugs happened).
//
// Rounding to cents happens where each function's docblock says it does (money
// is cents at the point it is COMPUTED — see roundCents); callers own the rest
// of display formatting. All return non-negative dollars.

// ─────────────────────────────────────────────────────────────────────────────
// Cents and the retainage basis (runtime audit 2026-09-06, MISS-04).
//
// These two live HERE, beside netBalanceDue, because they are generic money
// math that both the invoice editor and the G702/G703 pay application need.
// They used to sit in utils/aiaBilling, which carries the ~400-line pay-app
// HTML printer — app/invoice.tsx should not have to import a printer to round
// a dollar. utils/aiaBilling imports them from this file.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Money is whole cents at the point it is COMPUTED, not just where it is
 * formatted. Production carried `tax_amount` 5669.625, `total_due` 81264.625
 * and `retention_amount` 4063.2312500000003 because the screens rounded only
 * on display.
 */
export function roundCents(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * THE retainage rule for this app — one definition, shared by the invoice
 * editor (app/invoice.tsx) and the G702/G703 pay application (utils/aiaBilling).
 *
 * Retainage is withheld on the VALUE OF THE WORK: completed work plus stored
 * materials. It is NOT withheld on sales tax. Two reasons, and they agree:
 *
 *  1. AIA G702 line 5 is labelled "% of Completed Work" / "% of Stored
 *     Material" and its basis is the schedule of values, which carries no tax.
 *     `computeAIATotals` has always done it this way.
 *  2. The GC remits sales tax to the state on the invoice date regardless of
 *     whether the owner holds retainage. Withholding a slice of the tax makes
 *     the GC finance the state out of pocket until closeout.
 *
 * Before this (MISS-04) app/invoice.tsx applied the percentage to
 * `subtotal + taxAmount`, so the founder's live Houston invoice held $4,063.23
 * where $3,779.75 is the defensible figure — $283.48 of retainage against tax —
 * and the invoice and the pay application for the same job disagreed.
 *
 * `workValue` is deliberately NOT floored at zero. A G703 schedule of values
 * may carry a deductive change-order line (a credit), whose retainage is a
 * negative number that reduces the certificate's total withholding; clamping it
 * to 0 makes the certificate over-withhold by `pct × |credit|` and prints
 * $0.00 in the G703 retainage column on that line. Callers whose basis cannot
 * legitimately be negative (the invoice editor's subtotal) clamp their own
 * input.
 */
export function retainageOnWorkValue(workValue: number, retainagePercent: number): number {
  const pct = Number.isFinite(retainagePercent) ? Math.max(0, Math.min(100, retainagePercent)) : 0;
  const base = Number.isFinite(workValue) ? workValue : 0;
  return roundCents(base * (pct / 100));
}

/** The stored money columns needed to judge an invoice row's retention basis. */
export interface StoredRetentionRow {
  subtotal: number;
  totalDue: number;
  retentionPercent?: number;
  retentionAmount?: number;
}

export interface TaxBasisOverhold {
  /** What the row actually stores, to the cent. */
  stored: number;
  /** What the same percentage of the work value comes to. */
  corrected: number;
  /** stored − corrected: retainage withheld against sales tax. */
  overheld: number;
}

/**
 * Identify an invoice row whose STORED `retentionAmount` was computed on the
 * tax-inclusive total (MISS-04), so a screen can say so and offer to repair it.
 *
 * SCOPE, since MONEY-05: this is now a DATA-HYGIENE check, not a money check.
 * `effectiveRetentionHeld` above means every surface already reports the work-
 * basis figure whatever the column says, so nothing a client sees or is charged
 * depends on the repair. What still depends on it is the row itself: the CSV
 * export, the closeout packet, anything reading `invoices.retention_amount`
 * outside this app, and the fleet-repair SQL. The banner's copy must say that
 * rather than implying the money moves when the button is pressed.
 *
 * Deliberately narrow, and deliberately computed from STORED columns only. An
 * earlier version of this check compared the stored amount against the LIVE,
 * recomputed retention, which diverges the instant anyone edits a line item or
 * the retention percentage — and then told the GC his retainage "included sales
 * tax" on invoices that carry no sales tax at all. A specific accusation has to
 * be earned:
 *
 *  - the row must state a percentage above zero and an amount;
 *  - the two bases must actually differ (no tax ⇒ nothing to accuse);
 *  - the stored amount must BE the taxed-total figure, to the cent. Anything
 *    else (a hand-typed amount, a partial edit, a figure already on the work
 *    basis) returns null — unexplained is not the same as tax-based.
 */
export function taxBasisRetentionOverhold(inv: StoredRetentionRow): TaxBasisOverhold | null {
  const pct = inv.retentionPercent;
  const stored = inv.retentionAmount;
  if (pct == null || !Number.isFinite(pct) || pct <= 0) return null;
  if (stored == null || !Number.isFinite(stored)) return null;
  if (!Number.isFinite(inv.subtotal) || !Number.isFinite(inv.totalDue)) return null;

  const onWork = retainageOnWorkValue(inv.subtotal, pct);
  const onTaxed = retainageOnWorkValue(inv.totalDue, pct);
  if (Math.abs(onTaxed - onWork) <= 0.01) return null;

  const storedCents = roundCents(stored);
  if (Math.abs(storedCents - onTaxed) > 0.01) return null;

  return { stored: storedCents, corrected: onWork, overheld: roundCents(storedCents - onWork) };
}

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

// ─────────────────────────────────────────────────────────────────────────────
// THE HELD FIGURE — one definition (runtime audit 2026-09-07, MONEY-05).
//
// MISS-04 corrected the BASIS the invoice editor computes retainage on, but
// every shared reader below (and utils/projectFinancials, utils/financialReports,
// utils/cashFlowEngine, utils/portalSnapshot, utils/pdfGenerator, app/payments,
// app/retention, and _shared/paymentMath on the server) still trusted the
// STORED `retentionAmount` column. Legacy rows carry the tax-inclusive figure,
// so the two halves of the app disagreed about the same invoice:
//
//   Houston Phone Booth Ad #1 — subtotal 75,595, tax 5,669.625,
//   total_due 81,264.625, retention_percent 5, retention_amount 4,063.23125
//     invoice screen / Stripe pay link : held 3,779.75 → outstanding 77,484.88
//     Summary "NEEDS YOU" / A/R / portal: held 4,063.23 → outstanding 77,201.39
//
// $283.48 apart, and the number a contractor was told to chase depended on
// which screen they opened.
// ─────────────────────────────────────────────────────────────────────────────

/** The stored columns any surface needs to know what is actually being withheld. */
export interface RetentionInput {
  subtotal?: number;
  retentionPercent?: number;
  retentionAmount?: number;
  retentionReleased?: number;
}

/**
 * Retainage withheld on this invoice — the ONE answer every surface must use.
 *
 * THE RULE: retainage held is `retentionPercent` of the WORK VALUE (subtotal),
 * and the stored `retentionAmount` is trusted only when there is nothing to
 * recompute from. A stored figure never gets to decide what a client is asked
 * to pay, because a stored figure is a snapshot of whatever formula was live
 * the day the row was written — and one of those formulas was wrong.
 *
 * The derived branch is taken only when BOTH `retentionPercent > 0` and a
 * finite `subtotal` are present. Three deliberate edge cases:
 *
 *  1. STORED AMOUNT, NO PERCENTAGE (`retentionPercent` null/undefined). There
 *     is nothing to recompute from, so the stored column stands. Inventing 0
 *     here would silently RAISE what the client is billed by the full stored
 *     amount, on no evidence at all.
 *  2. `retentionPercent === 0` WITH A STORED AMOUNT. Also falls back, for the
 *     same reason: a 0 is at least as likely to be a column that was never
 *     written as it is a deliberate "hold nothing", and the cost of guessing
 *     wrong is over-billing the client. (app/invoice.tsx persists a deliberate
 *     0% as `retentionPercent: 0` WITH `retentionAmount: undefined`, so the
 *     honest version of this row falls back to 0 anyway.)
 *  3. HAND-EDITED RETAINAGE. Checked before assuming: the invoice editor
 *     exposes a PERCENT field and nothing else (app/invoice.tsx `retentionInput`),
 *     and all three of its write sites persist
 *     `retentionAmount: retentionPctValue > 0 ? retainageOnWorkValue(...) : undefined`.
 *     No screen, importer or edge function lets a GC type a retainage DOLLAR
 *     figure. So on a row that carries a percentage, a stored amount which
 *     disagrees with pct × subtotal is by construction stale — the old basis,
 *     or a subtotal edited after the amount was written — never an intent.
 *     If a hand-typed retainage amount is ever added to the UI, it must arrive
 *     with a flag on the row; this function must not be softened to guess.
 *
 * Non-finite input degrades to 0 rather than propagating NaN through a balance.
 */
export function effectiveRetentionHeld(inv: RetentionInput): number {
  const pct = inv.retentionPercent;
  const subtotal = inv.subtotal;
  if (
    pct != null && Number.isFinite(pct) && pct > 0
    && subtotal != null && Number.isFinite(subtotal)
  ) {
    // Floored at zero for the same reason app/invoice.tsx floors its basis: a
    // negative invoice subtotal is a credit memo, which withholds nothing.
    // (retainageOnWorkValue itself stays unclamped for G703 credit lines.)
    return retainageOnWorkValue(Math.max(0, subtotal), pct);
  }
  return roundCents(Math.max(0, inv.retentionAmount ?? 0));
}

/**
 * Retainage still held — the effective withholding less what has been released.
 *
 * `retentionReleased` is netted off whatever the held figure actually is, not
 * off the stored column, and the floor at zero matters on exactly the rows this
 * fix is for: a GC who released $4,063.23 against the old tax-inclusive basis
 * has released MORE than the $3,779.75 that was ever legitimately held, and the
 * answer is "nothing is held any more", never a negative that would inflate the
 * balance past the invoice total.
 */
export function pendingRetentionHeld(inv: RetentionInput): number {
  return roundCents(Math.max(0, effectiveRetentionHeld(inv) - Math.max(0, inv.retentionReleased ?? 0)));
}

export interface NetBalanceInput extends RetentionInput {
  totalDue: number;
  amountPaid?: number;
}

/**
 * Retention-net collectible balance for a Stripe pay link.
 *
 * Retention is contractually held back until closeout, so an emailed / portal
 * pay link must charge (totalDue − pendingRetention − amountPaid) — matching the
 * in-app "Generate Payment Link" button. Charging the gross totalDue bills the
 * client the retention they're not supposed to pay yet. Never returns negative.
 *
 * `pendingRetentionHeld` — not the stored column — decides the withholding, so
 * this figure is the same one the invoice screen prints (MONEY-05).
 */
export function netBalanceDue(inv: NetBalanceInput): number {
  const netPayable = Math.max(0, (inv.totalDue ?? 0) - pendingRetentionHeld(inv));
  // Rounded to cents HERE, not only where it is displayed — the doctrine at the
  // top of this file. Pre-MISS-04 rows store sub-cent totals (production
  // total_due is 81264.625), and every caller wanted a number of cents: the
  // Stripe charge (Math.round(x * 100)), the pay-link amount comparison, the
  // A/R CSV, the receipt. Leaving it unrounded meant the screens that rounded
  // and the ones that did not printed 77484.88 and 77484.875 for one invoice.
  return roundCents(Math.max(0, netPayable - (inv.amountPaid ?? 0)));
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

// NOTE: the markup-inclusive unit price for an estimate-sourced invoice line
// lives in utils/billFromEstimateCore.billFromEstimateUnitPrice (UNROUNDED, so
// quantity × unitPrice foots; only the line total is rounded). The rounding
// helper that used to live here (markupInclusiveUnitPrice) broke the foot on
// non-cent-exact prices — 3 × $33.33 ≠ $100.00 — and was deleted 2026-09-04
// once its last caller (app/invoice.tsx) moved.

// ─────────────────────────────────────────────────────────────────────────────
// Outstanding / settled — the ONLY definitions the app may use (audit MONEY-F5).
//
// "Outstanding" is what the client can be asked for today: the invoice total
// net of retention the contract lets them hold, less what they have paid. The
// gross `totalDue - amountPaid` form reported held retention as overdue on
// eighteen surfaces (A/R aging, the home strip, the portal, the PDF, the Stripe
// receipt, the weekly client email) and made a retention invoice impossible to
// settle. A guard (scripts/validate-money-outstanding.ts) fails the build on
// `totalDue -` arithmetic outside this file.
// ─────────────────────────────────────────────────────────────────────────────

/** Amount the client currently owes on this invoice — net of held retention, never negative. */
export function invoiceOutstanding(inv: NetBalanceInput): number {
  return netBalanceDue(inv);
}

/**
 * True when everything collectible today has been paid. Held retention does not
 * keep an invoice open; a released-and-unpaid retention amount does (release
 * reduces `retentionPending`, so it flows back into the net payable).
 */
export function invoiceIsSettled(inv: NetBalanceInput): boolean {
  const netPayable = Math.max(0, (inv.totalDue ?? 0) - pendingRetentionHeld(inv));
  return (inv.amountPaid ?? 0) >= netPayable - 0.01;
}
