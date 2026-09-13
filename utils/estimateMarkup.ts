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
 *  Σ-lineTotal === grandTotal invariant survives float arithmetic. */
const round2 = (n: number): number => Math.round(n * 100) / 100;

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
  const lineItems = data.lineItems.map((li) => ({
    ...li,
    unitCost: round2(li.unitCost * f),
    total: round2(li.total * f),
  }));
  const subtotal = round2(data.subtotal * f);
  const contingency = round2(c * f);
  const permits = round2(p * f);
  return { ...data, lineItems, subtotal, contingency, permits, total: round2(subtotal + contingency + permits) };
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
  return withMarkup(est, pct, { force: true });
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
  const laborSell = input.laborCost * f;
  const assemblySell = input.assembliesCost * f;
  const directCostTotal = input.materialsCost + input.laborCost + input.assembliesCost;
  const grandTotal = input.materialsSell + laborSell + assemblySell;
  const markupTotal = grandTotal - directCostTotal;
  const effectiveMarkupPct = directCostTotal > 0
    ? (markupTotal / directCostTotal) * 100
    : (f - 1) * 100;
  return { directCostTotal, laborSell, assemblySell, grandTotal, markupTotal, effectiveMarkupPct };
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
