// billFromEstimateCore.ts — the row math behind app/bill-from-estimate.tsx,
// pulled out so scripts/validate-estimate-cost-basis.ts can pin it (a .tsx
// screen cannot be imported under bun).
//
// MONEY-F14 (docs/audits/2026-09-03-final-push/04-money.md). The screen used to
// copy the estimate's PRE-markup unit price onto the invoice line and then
// inflate the QUANTITY so the row footed: 100 sf of tile @ $10.00 cost at 15%
// markup (estimate line 100 sf @ $11.50 = $1,150) billed at 100% printed
// "115 sf @ $10.00 = $1,150.00", and 50% printed "57.5 sf @ $10.00". The PDF,
// the client portal and QuickBooks (Qty / UnitPrice pushed verbatim) all showed
// a quantity 15% above the contract scope. The native invoice editor folds
// markup into the unit price the same way (it seeds lines with
// billFromEstimateUnitPrice below); this makes Bill-from-Estimate do the same
// and bill the SCOPE's quantity.
//
// THE FOOT IS THE INVARIANT: quantity × unitPrice must equal the billed total
// within half a cent, because the PDF prints all three and QuickBooks receives
// Qty and UnitPrice verbatim and multiplies. So the unit price is NOT rounded
// to cents (1,000 lf at a $1,234.56 line is $1.23456/lf — at $1.23 the PDF
// printed 1,000 × $1.23 beside $1,234.56 and QBO booked $1,230), and the
// quantity is rounded to the fewest decimals that still foot. Only the line
// total is rounded to cents.
//
// Pure functions — no React, no storage.

export interface BillFromEstimateLineInput {
  /** Full contracted quantity of the estimate line (100 sf). */
  quantity: number;
  /** Full contract value of the line — SELL, markup-inclusive ($1,150). */
  lineTotal: number;
  /** Unit price to fall back on when the line has no quantity (a lump sum). */
  fallbackUnitPrice: number;
  /** Dollars being billed for the line on THIS invoice (authoritative). */
  billAmount: number;
}

export interface BillFromEstimateLine {
  /** The share of the contract quantity this bill covers — never above scope. */
  quantity: number;
  /** Markup-inclusive unit price, so quantity × unitPrice foots to `total`. */
  unitPrice: number;
  /** = billAmount. The line total stays authoritative for what is charged. */
  total: number;
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The unit price an invoice line shows for an estimate line: lineTotal ÷
 *  quantity with the markup folded in — UNROUNDED (see the header: rounding
 *  it to cents breaks the foot on any line whose sell price is not cent-exact
 *  per unit; the PDF and the editor format it for display, the stored number
 *  has to multiply out). The fallback is for a quantity-less (lump-sum) line. */
export function billFromEstimateUnitPrice(lineTotal: number, quantity: number, fallbackUnitPrice: number): number {
  return quantity > 0 ? lineTotal / quantity : fallbackUnitPrice;
}

/** Fewest decimals a billed quantity can be rounded to and still foot within
 *  half a cent: rounding moves the quantity by at most ½·10⁻ᵈ units, so
 *  ½·10⁻ᵈ × unitPrice ≤ $0.005 ⇔ d ≥ log10(unitPrice) + 2; floor + 3 keeps
 *  every case strictly inside. Never fewer than 3 (what the screen always
 *  printed — 57.5 sf, 33.333 lf), never more than 10. */
export function billedQuantityDecimals(unitPrice: number): number {
  if (!(unitPrice > 0) || !Number.isFinite(unitPrice)) return 3;
  return Math.min(10, Math.max(3, Math.floor(Math.log10(unitPrice)) + 3));
}

/**
 * One invoice line for a bill against an estimate line. The billed quantity is
 * the CONTRACT quantity × the share of the line's value this bill covers
 * (billAmount ÷ lineTotal) — which equals quantity × pct/100 on a first bill,
 * and stays right on later bills where "pct" means percent of the REMAINING
 * value. 100 sf @ $11.50: bill $1,150 → 100 sf; bill $575 → 50 sf; the next
 * $575 → 50 sf again, never 100. The total is rounded to cents; the quantity
 * to the fewest decimals that keep quantity × unitPrice within $0.005 of it.
 */
export function billFromEstimateLine(input: BillFromEstimateLineInput): BillFromEstimateLine {
  const unitPrice = billFromEstimateUnitPrice(input.lineTotal, input.quantity, input.fallbackUnitPrice);
  const total = round2(input.billAmount);
  const share = input.lineTotal > 0 ? clamp01(total / input.lineTotal) : 0;
  const scale = 10 ** billedQuantityDecimals(unitPrice);
  const quantity = Math.round(Math.max(0, input.quantity) * share * scale) / scale;
  return { quantity, unitPrice, total };
}
