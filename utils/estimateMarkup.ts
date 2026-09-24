// estimateMarkup.ts — the one place that knows what a contractor adds on top
// of cost, and which of the two arithmetics the app means by it.
//
// ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
//
// Every estimate the Quick Estimate wizard produced shipped at EXACTLY cost.
// Measured on a $59,132 kitchen: baseTotal $59,132, grandTotal $59,132, gross
// margin 0.0%. Not "thin" — zero. app/estimate-wizard.tsx wrote `markup: 0` on
// every line and `globalMarkup: 0` on the estimate, because the AI prompt in
// utils/scopeQuestions.ts asks the model for materials, labor, permits and
// contingency and NOTHING for overhead or profit. The number the contractor
// copied into an email to a homeowner was his cost, and nothing on the screen
// said so.
//
// The cost-learning engine makes this WORSE the better it gets. A cold-start
// contractor got a national-average guess that happened to sit above his real
// cost often enough to leave accidental margin. A contractor with a full cost
// book gets a number that lands on his true cost — precisely, repeatedly.
//
// ── MARKUP vs MARGIN: the two arithmetics ──────────────────────────────────
//
// These are not the same number and contractors conflate them constantly:
//
//   MARKUP is a percentage OF COST added on top:   price = cost × (1 + m)
//   MARGIN is a percentage OF PRICE kept as profit: margin = (price − cost) / price
//
//   25% markup  →  20.0% margin      (100 cost → 125 price, 25/125)
//   20% margin  →  25% markup
//   50% markup  →  33.3% margin
//
// A contractor who thinks "I need 25 points" and types 25 into a MARKUP field
// walks away with 20. That five-point gap is the whole profit on a lot of
// residential work.
//
// ── WHICH ONE DOES THIS APP USE? MARKUP ON COST. ───────────────────────────
//
// Established, not chosen here. Three independent places already commit to it:
//
//   app/(tabs)/estimate/full.tsx  lineTotal = base * (1 + markup / 100) * qty
//   contexts/MaterialCartContext DEFAULT_MARKUP = 15, cascaded per cart item
//   app/judges.tsx:202-204       converts the app's markup to the margin the
//                                bid advisor wants with m / (1 + m) — the
//                                textbook markup→margin identity, which is
//                                only correct if globalMarkup is a markup.
//
// So `markupPct` everywhere in this app is a PERCENT OF COST. `marginOf` below
// is the conversion, exported so no caller has to re-derive it (judges.tsx
// derived it inline; that inline copy is now the second implementation of a
// formula that must never disagree with itself).
//
// ── WHAT THIS FILE WILL NOT DO ─────────────────────────────────────────────
//
// It will not pick a markup. A contractor's markup is his business decision —
// it encodes his overhead structure, his risk appetite, and what his market
// bears — and an app that guesses it is telling him what to charge. Every
// function here takes the percent as an argument. `UNSET_MARKUP` (null) is a
// first-class, distinguishable state: "he has not told us yet" is NOT the same
// fact as "he told us zero", and the UI must be able to tell them apart in
// order to ask exactly once and never again.

import type { LinkedEstimate, LinkedEstimateItem } from '@/types';

/** Cents. Every money figure this module emits is rounded to this grid so the
 *  Σ-lineTotal === grandTotal invariant survives float arithmetic. Exported so
 *  app/estimate-wizard.tsx rounds the model's cost lines on the SAME grid —
 *  it used to round them to whole dollars, which is a second price basis. */
export const round2 = (n: number): number => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;

/** "He has not made the markup decision yet." Distinct from 0, which is the
 *  legitimate decision to quote at cost. */
export const UNSET_MARKUP = null;
export type MarkupPct = number | typeof UNSET_MARKUP;

/** The presets offered wherever the markup question is asked. Same ladder as
 *  the estimator's MARKUP_PRESETS (app/(tabs)/estimate/full.tsx:119) so the
 *  wizard and the estimator do not offer a contractor two different menus for
 *  the same decision. */
export const MARKUP_CHOICES = [10, 15, 20, 25, 30] as const;

/** True when `pct` is a usable markup the contractor actually chose. */
export function isMarkupSet(pct: MarkupPct): pct is number {
  return typeof pct === 'number' && Number.isFinite(pct) && pct >= 0;
}

/** Normalize anything a UI or store hands us into a safe percent-of-cost.
 *  Unset / NaN / negative all collapse to 0 — an unknown markup must never
 *  become an invented one. Callers that need to TELL unset from zero must ask
 *  `isMarkupSet` first; this is the arithmetic path only. */
export function markupFactor(pct: MarkupPct): number {
  if (!isMarkupSet(pct)) return 1;
  return 1 + pct / 100;
}

/** MARKUP (percent of cost) → MARGIN (fraction of price, 0–1).
 *  25 → 0.20. The identity app/judges.tsx derives inline as m / (1 + m). */
export function marginOf(markupPct: number): number {
  const m = markupPct / 100;
  return m > -1 ? m / (1 + m) : 0;
}

/** MARGIN (fraction of price, 0–1) → MARKUP (percent of cost).
 *  0.20 → 25. Exported as the inverse so a future "I price on margin"
 *  setting has one correct conversion to reach for instead of inventing a
 *  second one. Margins at or above 1.0 (100% of price is profit) have no
 *  finite markup; clamped just under. */
export function markupForMargin(marginFraction: number): number {
  const g = Math.min(0.99, Math.max(0, marginFraction));
  return (g / (1 - g)) * 100;
}

/** Gross margin of a finished estimate, as a fraction of the price (0–1).
 *  This is the number a contractor means when he says "I made 18 points". */
export function estimateMarginPct(est: Pick<LinkedEstimate, 'baseTotal' | 'grandTotal'>): number {
  if (!(est.grandTotal > 0)) return 0;
  return (est.grandTotal - est.baseTotal) / est.grandTotal;
}

/** True when this estimate carries no profit at all — the defect condition.
 *  Uses a half-cent floor so rounding noise on a genuinely marked-up estimate
 *  never reads as at-cost. A NEGATIVE margin (priced below cost) is not
 *  "at cost" and returns false; it is a worse and separately-nameable state,
 *  which `estimateMarginPct` reports as a negative number. */
export function isAtCost(est: Pick<LinkedEstimate, 'baseTotal' | 'grandTotal'>): boolean {
  return est.grandTotal > 0 && Math.abs(est.grandTotal - est.baseTotal) < 0.005;
}

/**
 * Stamp a markup onto estimate items and rebuild the estimate's three totals
 * so they reconcile by construction.
 *
 * The invariant every consumer in this repo depends on (scripts/validate-
 * estimate-cost-basis.ts is the guard):
 *
 *   unitPrice   is COST per unit and is NEVER touched here
 *   lineTotal   is SELL           = unitPrice × qty × (1 + markup/100)
 *   baseTotal   = Σ unitPrice × qty                       (cost)
 *   grandTotal  = Σ lineTotal                             (sell)
 *   markupTotal = grandTotal − baseTotal
 *
 * unitPrice staying at cost is not cosmetic. utils/jobCostEngine seeds the job
 * budget from it, utils/estimateActuals compares buyouts against it, and
 * utils/estimateCalibration divides by it to learn the contractor's real
 * rates. Scaling unitPrice by the markup would teach the cost engine that his
 * costs went up by his profit — and the calibration loop compounds that on
 * every accepted correction.
 *
 * UNIFORM APPLICATION, INCLUDING CONTINGENCY AND PERMITS. Deliberate, and
 * arguable, so here is the argument. Contingency exists to be SPENT; if it is
 * carried at cost while everything else carries markup, then every dollar of
 * contingency the job actually consumes is a dollar of revenue at 0% margin,
 * and the realized margin falls below the bid margin by exactly the
 * contingency draw. Marking it up holds the margin percentage flat whether the
 * buffer is spent or returned. The same logic covers permits: a permit fee is
 * a cost the contractor fronts and administers. A contractor who disagrees can
 * see the base and the markup as separate lines and set the percent himself —
 * which is the point of asking him rather than guessing.
 *
 * Items already carrying an explicit markup are left alone: a contractor who
 * hand-tuned one line to 40% in the estimator does not lose it to a global
 * pass. Pass `force: true` to overwrite (what the estimator's global-markup
 * chips do).
 */
export function applyMarkupToItems(
  items: LinkedEstimateItem[],
  pct: MarkupPct,
  opts: { force?: boolean } = {},
): LinkedEstimateItem[] {
  const target = isMarkupSet(pct) ? pct : 0;
  return items.map((it) => {
    const keepOwn = !opts.force && it.markup > 0;
    const markup = keepOwn ? it.markup : target;
    const cost = (it.unitPrice ?? 0) * (it.quantity ?? 0);
    return { ...it, markup, lineTotal: round2(cost * (1 + markup / 100)) };
  });
}

/** Recompute baseTotal / markupTotal / grandTotal from the items, so the three
 *  can never drift from the rows that produced them. */
export function retotal(est: LinkedEstimate): LinkedEstimate {
  const baseTotal = round2(est.items.reduce((s, i) => s + (i.unitPrice ?? 0) * (i.quantity ?? 0), 0));
  const grandTotal = round2(est.items.reduce((s, i) => s + (i.lineTotal ?? 0), 0));
  return { ...est, baseTotal, markupTotal: round2(grandTotal - baseTotal), grandTotal };
}

/**
 * One line's COST — what the work costs him, before his markup. The same basis
 * `retotal`'s baseTotal sums (and estimateActuals compares against):
 * `unitPrice × quantity`, rounded to the cent. `unitPrice` already holds the
 * bulk-or-retail base the estimator chose (full.tsx writes `unitPrice: base`),
 * so this never swaps to `bulkPrice` a second time.
 *
 * Why it exists (#11): buyout budgets were summed from `lineTotal`, which is
 * SELL. A sub who bid exactly the cost then showed as "buyout savings" equal
 * to the GC's own markup — and that figure went on the homeowner's PDF as
 * "Bulk Savings". A budget the buyout compares a sub's price against is a
 * cost budget.
 */
export function lineCost(it: Pick<LinkedEstimateItem, 'unitPrice' | 'quantity'>): number {
  return round2((it.unitPrice ?? 0) * (it.quantity ?? 0));
}

/** Apply a markup to a whole estimate and re-foot it. The composed operation
 *  every AI writer should use instead of hand-rolling the arithmetic. */
export function withMarkup(
  est: LinkedEstimate,
  pct: MarkupPct,
  opts: { force?: boolean } = {},
): LinkedEstimate {
  const items = applyMarkupToItems(est.items, pct, opts);
  return retotal({ ...est, items, globalMarkup: isMarkupSet(pct) ? pct : 0 });
}

// ── The AI cost breakdown → priced estimate ────────────────────────────────

/** The subset of utils/scopeQuestions EstimateResult this module prices.
 *  Structural, not an import, so the pricing math stays testable without
 *  pulling zod and the whole wizard prompt into a validator run. */
export interface CostBreakdown {
  lineItems: { category: string; description: string; quantity: number; unit: string; unitCost: number; total: number }[];
  subtotal: number;
  contingency: number;
  permits: number;
  total: number;
}

/**
 * The contingency and permit add-ons, clamped to zero, in the ONE place both
 * totals read them.
 *
 * A negative contingency is not a discount, it is a model error — and it used
 * to reach the two totals by different routes. `priceCostBreakdown` folded
 * `data.contingency` into the client's total whatever its sign, while
 * `buildQuickLinkedEstimate` dropped the row on `> 0`. Measured on
 * {subtotal 1000, contingency -200, permits 0} at 20%: the homeowner's PDF
 * quoted 960 and the project budget, WIP and portal read 1200 — a gap of
 * exactly the contingency times the markup factor, which grows with the
 * markup. Neither the zod schema (`.catch(0)`) nor the wizard's normalizer
 * clamps it, so it is clamped here, once, where both callers pass through.
 *
 * Clamping rather than carrying the negative through as a row is deliberate:
 * a LinkedEstimateItem with a negative unitPrice seeds a negative job-cost
 * budget line (utils/jobCostEngine) and a negative buyout target
 * (utils/estimateActuals), which is a worse failure than dropping a figure the
 * model should not have emitted.
 */
function addOns(data: CostBreakdown): { contingency: number; permits: number } {
  const n = (v: number): number => (Number.isFinite(v) && v > 0 ? v : 0);
  return { contingency: n(data.contingency), permits: n(data.permits) };
}

/**
 * Price an AI COST breakdown for the client.
 *
 * The model returns cost. This returns the same shape with every figure moved
 * to the SELL basis, so the on-screen hero total, the category breakdown, the
 * payment-terms preview and utils/pdfGenerator all quote the same price
 * without any of them having to know a markup exists. That is the point: there
 * is exactly one place the markup is applied, and every downstream reader of
 * an EstimateResult gets it for free rather than one of them being forgotten.
 *
 * Markup is folded INTO the unit prices rather than added as a visible
 * "Overhead & profit" row, because that row would print on the homeowner's
 * PDF. What a contractor makes is not the client's line item. The contractor
 * sees the split on his own screen, and the LinkedEstimate keeps cost and sell
 * separately for every internal consumer.
 */
export function priceCostBreakdown<T extends CostBreakdown>(data: T, pct: MarkupPct): T {
  const f = markupFactor(pct);
  const { contingency: c, permits: p } = addOns(data);
  // ONE PRICE BASIS (audit 2026-09-18, #118/#158). Each line is priced from its
  // PRICED UNIT — the unit the PDF prints — so qty × printed unit === printed
  // line total, and the subtotal is the sum of those lines rather than the
  // cost subtotal scaled once (which could miss its own lines by cents).
  // buildQuickLinkedEstimate prices every row through the same pricedLine, so
  // the PDF total, the project's grandTotal, the portal proposal and the
  // contract value are one number. The old `round2(li.total * f)` scaled a
  // whole-dollar-rounded cost, and the three documents printed three totals.
  const lineItems = data.lineItems.map((li) => {
    const { unit, total } = pricedLine(li.unitCost, li.quantity, f);
    return { ...li, unitCost: unit, total };
  });
  const subtotal = round2(lineItems.reduce((s, li) => s + li.total, 0));
  const contingency = pricedLine(c, 1, f).total;
  const permits = pricedLine(p, 1, f).total;
  return { ...data, lineItems, subtotal, contingency, permits, total: round2(subtotal + contingency + permits) };
}

/**
 * One priced line: the sell UNIT on the cent grid, and the line total as
 * quantity × that printed unit. The single place a quick-estimate line is
 * priced — priceCostBreakdown (the PDF, the hero, the payment preview) and
 * buildQuickLinkedEstimate (the project, the portal, the contract) both call
 * it, so they cannot disagree about a line by even a cent.
 *
 * `factor` is the markup factor (1 + pct/100), not the percent.
 */
export function pricedLine(unitCost: number, quantity: number, factor: number): { unit: number; total: number } {
  const unit = round2((Number.isFinite(unitCost) ? unitCost : 0) * factor);
  const qty = Number.isFinite(quantity) ? quantity : 0;
  return { unit, total: round2(qty * unit) };
}

/**
 * Build the project-facing LinkedEstimate from an AI COST breakdown.
 *
 * Lifted out of app/estimate-wizard.tsx (where it was a screen-local closure
 * that no validator could reach, and where it hard-coded `markup: 0` on every
 * row) so the guard can call the SAME function the wizard ships.
 *
 * Contingency and permits become explicit rows so the Estimate Items table in
 * project-detail reconciles with the Base/Total instead of leaving an
 * unexplained gap. `newId` is injected so a validator gets deterministic ids.
 */
export function buildQuickLinkedEstimate(
  data: CostBreakdown,
  pct: MarkupPct,
  newId: () => string,
): LinkedEstimate {
  const row = (
    name: string, category: string, unit: string, quantity: number, unitCost: number,
  ): LinkedEstimateItem => ({
    materialId: newId(), name, category, unit, quantity,
    unitPrice: unitCost, bulkPrice: unitCost, markup: 0, usesBulk: false,
    lineTotal: round2(unitCost * quantity), supplier: '',
  });

  const { contingency, permits } = addOns(data);
  const items: LinkedEstimateItem[] = data.lineItems.map((li) =>
    row(li.description, li.category, li.unit, li.quantity, li.unitCost));
  if (contingency > 0) items.push(row('Contingency', 'Contingency', 'ls', 1, contingency));
  if (permits > 0) items.push(row('Permits & fees', 'Permits & fees', 'ls', 1, permits));

  const est: LinkedEstimate = {
    id: newId(),
    items,
    globalMarkup: 0,
    baseTotal: 0,
    markupTotal: 0,
    grandTotal: 0,
    createdAt: new Date().toISOString(),
  };
  // `force` is belt-and-braces here and I checked that it is: `row()` builds
  // every line at markup 0, so applyMarkupToItems' keep-your-own-markup clause
  // (`!force && it.markup > 0`) is already false and the pct lands either way.
  // Removing it changes nothing today — mutating it out left all 214
  // assertions green, which is exactly how I know the claim. It stays because
  // the day `row()` learns to seed a per-line markup from the AI category, the
  // global pass must still win, and that day should not need a bug first.
  const marked = withMarkup(est, pct, { force: true });
  // Re-price each row's SELL through pricedLine — the same arithmetic the PDF
  // prints (qty × the priced unit on the cent grid). applyMarkupToItems' own
  // `round2(cost × qty × f)` is correct for the estimator, but here it is a
  // second basis: 125 SF at $3.33 +20% is $500.00 on the PDF (125 × $4.00) and
  // $499.50 by cost × qty × f, and the deposit invoice bills the second. The
  // COST side (unitPrice, baseTotal) is untouched — only the sell is re-footed.
  const f = markupFactor(pct);
  return retotal({
    ...marked,
    items: marked.items.map((it) => ({ ...it, lineTotal: pricedLine(it.unitPrice, it.quantity, f).total })),
  });
}


// ── The estimator cart's whole-job totals ──────────────────────────────────

export interface CartCostInput {
  /** Σ (bulk-or-retail unit price × qty) across the material cart — COST. */
  materialsCost: number;
  /** Σ (unit price × (1 + per-item markup) × qty) — materials SELL. Materials
   *  keep PER-ITEM markups (a contractor can tune one line to 40%), so their
   *  sell figure cannot be derived from the global percent and is passed in. */
  materialsSell: number;
  /** Σ (adjustedRate × hours) — the loaded, all-in COST of self-perform labor. */
  laborCost: number;
  /** Σ assembly totalCost — material + labor baked into one COST figure. */
  assembliesCost: number;
  /** The contractor's global markup, percent of cost. */
  markupPct: number;
  /** Σ of the labor rows' SELL, each already on the cent grid (cartLineSell).
   *  When given it is used as-is, so the labor total is the sum of the rows
   *  the screen prints; when absent it is round2(laborCost × factor). */
  laborSell?: number;
  /** Same, for assembly rows. */
  assemblySell?: number;
}

export interface CartTotals {
  /** Whole-job cost: materials + labor + assemblies, before anything is added. */
  directCostTotal: number;
  laborSell: number;
  assemblySell: number;
  /** materialsSell + laborSell + assemblySell. */
  grandTotal: number;
  /** grandTotal − directCostTotal. Overhead + profit across the WHOLE job. */
  markupTotal: number;
  /**
   * The percent-of-cost the job ACTUALLY carries, which is only the global
   * percent when no line has been hand-tuned.
   *
   * The estimator labelled its markup row "Overhead & profit ({globalMarkup}%)"
   * unconditionally, so a cart with one tile line pulled up to 40% showed a
   * bigger number under a percentage that did not produce it — and the same
   * label understated on the way down. Materials carry per-item markups; the
   * only honest rate is the realized one.
   */
  effectiveMarkupPct: number;
}

/**
 * Total an estimator cart with the markup applied to the whole cost base.
 *
 * Extracted from app/(tabs)/estimate/full.tsx so a validator can call the same
 * arithmetic the screen ships instead of re-typing it — a guard that re-derives
 * the formula it is guarding proves only that the guard can do multiplication.
 *
 * LABOR AND ASSEMBLIES USED TO BE EXCLUDED. full.tsx summed them at cost and
 * called the materials-only difference `markupTotal`, on the argument that "the
 * adjusted hourly rate is the all-in cost". It is — which is exactly why it
 * needs a markup on top. Cost is not price, and a contractor's overhead does
 * not stop existing on the labor half of the job. On a $100K estimate split
 * $40K materials / $50K labor / $10K assemblies, a 20% markup produced $8,000
 * of margin instead of $20,000 — 7.4% of contract instead of 16.7% — and both
 * app/judges.tsx (which converts globalMarkup to the margin it prices against)
 * and utils/livingEstimate (which watches grandTotal − baseTotal for the rest
 * of the job) were handed that materials-only figure and told it described the
 * whole contract.
 */
export function cartTotals(input: CartCostInput): CartTotals {
  const f = 1 + (Number.isFinite(input.markupPct) ? input.markupPct : 0) / 100;
  // ONE CENT RULE (founder, 2026-09-24: "went up a cent after I left a
  // material"). Every figure this returns sits on the cent grid, and the
  // totals are sums of figures that already do — never a raw float sum that a
  // screen rounds on its own at the last moment. When the caller hands in the
  // per-row sums (priceEstimatorCart does), the total is exactly the sum of
  // the rows the screen prints, and cost + overhead & profit === grand total.
  const laborSell = round2(input.laborSell ?? input.laborCost * f);
  const assemblySell = round2(input.assemblySell ?? input.assembliesCost * f);
  const directCostTotal = round2(input.materialsCost + input.laborCost + input.assembliesCost);
  const grandTotal = round2(input.materialsSell + laborSell + assemblySell);
  const markupTotal = round2(grandTotal - directCostTotal);
  const effectiveMarkupPct = directCostTotal > 0
    ? (markupTotal / directCostTotal) * 100
    : (f - 1) * 100;
  return { directCostTotal, laborSell, assemblySell, grandTotal, markupTotal, effectiveMarkupPct };
}

// ── The estimator cart, line by line, on the cent grid ─────────────────────
//
// WHY (founder, 2026-09-24): "Are estimates dynamic?? Went up a cent after I
// left a material." Prices had not moved. The Full Estimator worked every line
// out to fractions of a cent ($20.723), rounded each row on its own to print
// it ($20.72), and rounded the RAW sum once for the footer ($6.532 + $20.723 =
// $27.255 → $27.26). Adding a $20.72 row moved the footer $20.73. The PDF and
// the email then nudged rows so they added up (a third rule), so the client
// saw $20.73 where the GC saw $20.72; the pop-up's "cart total after adding"
// used toFixed (a fourth), and said $27.25.
//
// THE RULE, the one the Quick Estimate wizard already used (pricedLine): each
// line's SELL is rounded to the cent ONCE, here, and every total is the SUM of
// those rounded lines. Then the rows on screen, the footer, the pop-up, the
// PDF, the email, the portal and the linked estimate are one set of cents, and
// adding or removing a row moves the total by exactly that row. The total can
// differ from "the exact math, rounded once" by under a cent per line — the
// way an invoice works — and that is the trade the founder chose.
//
// Keep the multiplication order (base × (1 + m/100) × qty): it is the order
// every earlier screen used, so a line that was not on a half-cent before
// lands on the same cents now.

const finiteOr0 = (n: number): number => (Number.isFinite(n) ? n : 0);

/** One estimator line's SELL, on the cent grid. THE cent rule. */
export function cartLineSell(unitCost: number, quantity: number, markupPct: number): number {
  return round2(finiteOr0(unitCost) * (1 + finiteOr0(markupPct) / 100) * finiteOr0(quantity));
}

/** One estimator line's COST, on the cent grid — the same figure lineCost()
 *  reads back off the LinkedEstimate row this line becomes. */
export function cartLineCost(unitCost: number, quantity: number): number {
  return round2(finiteOr0(unitCost) * finiteOr0(quantity));
}

/** Σ of cent-grid figures, re-snapped to the grid so float addition cannot
 *  leave a total at 27.250000000000004. */
function sumCents(values: readonly number[]): number {
  return round2(values.reduce((s, v) => s + v, 0));
}

/** The price fields of a catalog material — structural, so this module stays
 *  importable by a bun validator without pulling in constants/materials. */
export interface EstimatorPriceLike {
  id: string;
  baseRetailPrice: number;
  baseBulkPrice: number;
  bulkMinQty: number;
}
/** A material cart row (contexts/MaterialCartContext MaterialCartItem). */
export interface EstimatorMaterialLine<M extends EstimatorPriceLike = EstimatorPriceLike> {
  material: M;
  quantity: number;
  markup: number;
  usesBulk: boolean;
}
/** A labor cart row: `adjustedRate` is the loaded COST of one hour. */
export interface EstimatorLaborLine { adjustedRate: number; hours: number }
/** An assembly cart row: `totalCost` is its all-in COST at the chosen qty. */
export interface EstimatorAssemblyLine { totalCost: number }

export interface PricedCartLine {
  /** The unit COST the line is priced from (bulk or retail; rate; total). */
  base: number;
  /** base × qty on the cent grid. */
  cost: number;
  /** cartLineSell — what the row prints and what every total sums. */
  sell: number;
}

/** The unit cost a material row is priced at: bulk when the row qualifies. */
export function materialLineBase(item: Pick<EstimatorMaterialLine, 'material' | 'usesBulk'>): number {
  return item.usesBulk ? item.material.baseBulkPrice : item.material.baseRetailPrice;
}

export function priceMaterialLine(item: EstimatorMaterialLine): PricedCartLine {
  const base = materialLineBase(item);
  return { base, cost: cartLineCost(base, item.quantity), sell: cartLineSell(base, item.quantity, item.markup) };
}

/** Labor carries the GLOBAL markup (see cartTotals' note on why). */
export function priceLaborLine(item: EstimatorLaborLine, markupPct: number): PricedCartLine {
  return {
    base: item.adjustedRate,
    cost: cartLineCost(item.adjustedRate, item.hours),
    sell: cartLineSell(item.adjustedRate, item.hours, markupPct),
  };
}

/** An assembly is one qty-1 line priced at its total cost. */
export function priceAssemblyLine(item: EstimatorAssemblyLine, markupPct: number): PricedCartLine {
  return {
    base: item.totalCost,
    cost: cartLineCost(item.totalCost, 1),
    sell: cartLineSell(item.totalCost, 1, markupPct),
  };
}

export interface PricedEstimatorCart extends CartTotals {
  /** Same order as the cart passed in. */
  materials: PricedCartLine[];
  labor: PricedCartLine[];
  assemblies: PricedCartLine[];
  /** Σ material rows' cost / sell, and Σ labor / assembly rows' cost. */
  materialsCost: number;
  materialsSell: number;
  laborCost: number;
  assembliesCost: number;
}

/**
 * Price the whole estimator cart: every row on the cent grid, every total the
 * sum of those rows. THE function app/(tabs)/estimate/full.tsx, review.tsx and
 * components/EstimateComparison.tsx read their figures from, so no screen
 * re-types `base * (1 + markup / 100) * qty` and rounds it its own way.
 */
export function priceEstimatorCart(
  cart: readonly EstimatorMaterialLine[],
  labor: readonly EstimatorLaborLine[],
  assemblies: readonly EstimatorAssemblyLine[],
  markupPct: number,
): PricedEstimatorCart {
  const materials = cart.map(priceMaterialLine);
  const laborLines = labor.map(l => priceLaborLine(l, markupPct));
  const assemblyLines = assemblies.map(a => priceAssemblyLine(a, markupPct));
  const materialsCost = sumCents(materials.map(l => l.cost));
  const materialsSell = sumCents(materials.map(l => l.sell));
  const laborCost = sumCents(laborLines.map(l => l.cost));
  const assembliesCost = sumCents(assemblyLines.map(l => l.cost));
  const totals = cartTotals({
    materialsCost, materialsSell, laborCost, assembliesCost, markupPct,
    laborSell: sumCents(laborLines.map(l => l.sell)),
    assemblySell: sumCents(assemblyLines.map(l => l.sell)),
  });
  return {
    ...totals,
    materials, labor: laborLines, assemblies: assemblyLines,
    materialsCost, materialsSell, laborCost, assembliesCost,
  };
}

/**
 * The cart as it will be AFTER the item pop-up's Add / Update press — the
 * same semantics MaterialCartContext applies: a row already in the cart gets
 * the typed quantity set absolutely and KEEPS its own markup and its own price
 * snapshot; a new row comes in at the global markup. The pop-up previews
 * priceEstimatorCart() of this, so "Line total" and "Estimate total after
 * adding" are the figures the cart shows after the press, not a second
 * formula (the old preview used the global markup and parseInt, and counted
 * materials only).
 *
 * `quantity` is what handleAddFromPopup will commit (parseLenientNumber); a
 * null / non-positive quantity is refused there, so it previews no change.
 */
export function popupCartAfter<M extends EstimatorPriceLike, T extends EstimatorMaterialLine<M>>(
  cart: readonly T[],
  selected: M,
  quantity: number | null,
  globalMarkup: number,
): { next: EstimatorMaterialLine<M>[]; line: EstimatorMaterialLine<M> | null } {
  if (quantity === null || !Number.isFinite(quantity) || quantity <= 0) {
    return { next: cart.slice(), line: null };
  }
  const existing = cart.find(i => i.material.id === selected.id);
  if (existing) {
    const line: EstimatorMaterialLine<M> = {
      ...existing, quantity, usesBulk: quantity >= existing.material.bulkMinQty,
    };
    return { next: cart.map(i => (i === existing ? line : i)), line };
  }
  const line: EstimatorMaterialLine<M> = {
    material: selected, quantity, markup: globalMarkup, usesBulk: quantity >= selected.bulkMinQty,
  };
  return { next: [...cart, line], line };
}

/**
 * The unit prices the item pop-up prints above its Line Total. For an item
 * already in the cart these are THAT ROW's price snapshot, because
 * popupCartAfter (and MaterialCartContext) keep the row at its own snapshot
 * on Update; printing the catalog's prices there showed "Retail $38.97" over
 * a Line Total worked out at $37.02 whenever the GC had kept an earlier
 * market's price. `kept` is true when that snapshot differs from the
 * catalog, and `catalog` is the price book entry, so the pop-up can say so.
 */
export function popupUnitPrices<M extends EstimatorPriceLike, T extends EstimatorMaterialLine<M>>(
  cart: readonly T[],
  selected: M,
): { material: M; kept: boolean; catalog: M } {
  const existing = cart.find(i => i.material.id === selected.id);
  if (!existing) return { material: selected, kept: false, catalog: selected };
  const kept = existing.material.baseRetailPrice !== selected.baseRetailPrice
    || existing.material.baseBulkPrice !== selected.baseBulkPrice;
  return { material: existing.material, kept, catalog: selected };
}

/**
 * What re-pricing the draft cart against a new catalog (a market change, or a
 * catalog shipped over the air) WOULD do — computed, never applied here.
 *
 * Decision (founder, 2026-09-24): a market change must not silently reprice a
 * draft estimate. The estimator used to swap every row's price snapshot on
 * mount and on every location change, with no notice (Houston → US average
 * took 3/4" OSB from $37.02 to $38.97). It now asks: "Reprice 3 lines for US
 * average? +$4.12", Keep / Reprice. `sellDelta` is the change to the grand
 * total — only material rows move, so it is the material sell delta.
 *
 * Rows with no catalog entry (AI-found, custom) are never touched. A row whose
 * prices already match is kept by identity, so an unchanged cart plans zero
 * changes and the screen skips the no-op write.
 *
 * `changedCount` counts only rows whose USED price moves (materialLineBase:
 * bulk when the row qualifies, else retail) — a row priced at bulk whose
 * retail price alone changed does not move the total, so it is not a "line
 * priced differently" and does not raise the question ("Reprice 1 line …
 * +$0.00" was the result). Such rows are still refreshed in `next` (and
 * counted in `staleCount`), so a Reprice or Refresh leaves no stale unused
 * price behind to surprise him when the row later crosses the bulk quantity.
 */
export interface CartRepricePlan<T> {
  next: T[];
  /** Rows whose used price — and so whose line total — would change. */
  changedCount: number;
  /** Rows whose snapshot differs at all (≥ changedCount). */
  staleCount: number;
  sellDelta: number;
  /** Stable key of WHAT would change — a "Keep" answer is remembered against
   *  it, so the same question is not asked twice but a new difference is. */
  signature: string;
}
export function planCartReprice<M extends EstimatorPriceLike, T extends EstimatorMaterialLine<M>>(
  cart: readonly T[],
  catalog: readonly M[],
): CartRepricePlan<T> {
  const byId = new Map(catalog.map(m => [m.id, m]));
  let changedCount = 0;
  let staleCount = 0;
  const keys: string[] = [];
  const next = cart.map(item => {
    const fresh = byId.get(item.material.id);
    if (!fresh) return item;
    if (fresh.baseRetailPrice === item.material.baseRetailPrice
      && fresh.baseBulkPrice === item.material.baseBulkPrice) return item;
    staleCount++;
    const refreshed = { ...item, material: fresh };
    if (materialLineBase(refreshed) !== materialLineBase(item)) {
      changedCount++;
      keys.push(`${fresh.id}:${item.usesBulk ? 'b' : 'r'}${materialLineBase(refreshed)}`);
    }
    return refreshed;
  });
  const before = sumCents(cart.map(i => priceMaterialLine(i).sell));
  const after = sumCents(next.map(i => priceMaterialLine(i).sell));
  return { next, changedCount, staleCount, sellDelta: round2(after - before), signature: keys.sort().join('|') };
}


// ── "Has he ever answered the markup question?" ────────────────────────────

/**
 * Decide, from what is actually on disk, whether the contractor has already
 * made the markup decision.
 *
 * THE REGRESSION THIS EXISTS TO CLOSE. `mageid_markup_decided` is new. Every
 * contractor who set a markup in the estimator BEFORE this shipped has his
 * percentage sitting in `mageid_material_cart_markup` and no decided-flag next
 * to it — so on first launch after the update he hydrates as "never asked".
 * app/quick-quote.tsx then stops prefilling the 25% he chose months ago and
 * the quote he sends goes out at 0%; app/estimate-wizard.tsx shows him the red
 * "This number is your cost" band and blocks his PDF behind a question he has
 * already answered. A markup that was on disk cannot be allowed to vanish
 * because the flag that records it is younger than the value.
 *
 * The seed is safe precisely because `mageid_material_cart_markup` is only
 * ever WRITTEN by a change to the markup. MaterialCartContext skips its
 * persist effect until hydration completes, and hydrating the absent key
 * resolves to DEFAULT_MARKUP — the value already in state — so the effect's
 * dependency never changes and nothing is written. The key existing therefore
 * means a real percentage was set at some point, which is the decision.
 *
 * @param decidedRaw the raw `mageid_markup_decided` value (null when absent)
 * @param markupRaw  the raw `mageid_material_cart_markup` value (null when absent)
 */
export function markupDecidedFromStorage(decidedRaw: string | null, markupRaw: string | null): boolean {
  if (decidedRaw === '1' || decidedRaw === '"1"') return true;
  if (markupRaw === null || markupRaw === '') return false;
  try {
    const parsed: unknown = JSON.parse(markupRaw);
    return typeof parsed === 'number' && Number.isFinite(parsed) && parsed >= 0;
  } catch {
    return false;
  }
}
