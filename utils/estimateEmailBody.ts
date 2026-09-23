// utils/estimateEmailBody.ts — the plain-text estimate the Full Estimator's
// cart drops into a mail draft (testID cart-share-email).
//
// Pure, so scripts/validate-w5-estimating-money.ts runs the same function the
// screen ships.
//
// ── WHAT THE CLIENT MAY SEE (audit #55) ────────────────────────────────────
//
// The body used to print, for every material, `Qty | $42.00/EA | Markup: 25% |
// Total` — his material COST per unit and his markup percentage, in a draft
// addressed to the homeowner — and for labor `8 hrs | $65.00/hr | Total
// $624.00`: his loaded labor COST rate next to a sell total it doesn't
// multiply out to. utils/estimateMarkup.ts states the house position: what he
// makes is not the client's line item.
//
// So a row is its quantity and its SELL total, nothing else. No unit price at
// all: a sell unit rounded to the cent times the quantity can miss the line
// total by a cent, and a cost unit is the leak. The lines foot to the printed
// TOTAL, which is the estimate's grand total (see footLines).

export interface EmailEstimateRow {
  /** Client-facing name (material, trade, assembly). */
  name: string;
  /** "Qty: 10 EA", "8 hrs" — the quantity only, never a rate. */
  qtyLabel: string;
  /** The line's SELL total, unrounded (Σ of these is the grand total). */
  lineTotal: number;
}

export interface EstimateEmailBodyInput {
  companyName?: string;
  tagline?: string;
  rows: EmailEstimateRow[];
  /** The estimate's grand total — the figure on the PDF and the project. */
  grandTotal: number;
  contactName?: string;
  phone?: string;
}

const toCents = (n: number): number => Math.round((Number.isFinite(n) ? n : 0) * 100);
const money = (cents: number): string =>
  `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Each line's total in whole cents, adjusted so they sum EXACTLY to the grand
 * total's cents (largest-remainder rounding). Rounding every line on its own
 * can leave the printed lines a cent or two off the printed TOTAL; this moves
 * no line by a full cent from its true value and makes the document add up.
 * Falls back to plain per-line rounding when the lines genuinely don't sum to
 * the total (more than a cent per line apart) — then there is nothing honest
 * to distribute.
 */
export function footLines(lineTotals: number[], grandTotal: number): number[] {
  const exact = lineTotals.map(n => (Number.isFinite(n) ? n : 0) * 100);
  const floors = exact.map(Math.floor);
  const target = toCents(grandTotal);
  let short = target - floors.reduce((s, c) => s + c, 0);
  if (short < 0 || short > exact.length) return exact.map(Math.round);
  const order = exact
    .map((c, i) => ({ i, rem: c - floors[i] }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  const out = floors.slice();
  for (const { i } of order) {
    if (short <= 0) break;
    out[i] += 1;
    short -= 1;
  }
  return out;
}

/** The mail body: sell-basis quantities and totals, footing to the TOTAL. */
export function buildEstimateEmailBody(input: EstimateEmailBodyInput): string {
  let text = '';
  if (input.companyName) {
    text += `${input.companyName}\n`;
    if (input.tagline) text += `${input.tagline}\n`;
    text += '\n';
  }
  text += 'MAGE ID Estimate\n\n';
  const cents = footLines(input.rows.map(r => r.lineTotal), input.grandTotal);
  input.rows.forEach((r, i) => {
    text += `${r.name}\n`;
    text += `  ${r.qtyLabel} | Total: ${money(cents[i])}\n`;
  });
  text += `\nTOTAL: ${money(toCents(input.grandTotal))}\n`;
  if (input.contactName || input.phone) {
    text += `\nContact: ${input.contactName ?? ''} ${input.phone ?? ''}\n`;
  }
  return text;
}
