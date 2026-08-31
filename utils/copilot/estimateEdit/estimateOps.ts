// utils/copilot/estimateEdit/estimateOps.ts — typed edit-op vocabulary for
// conversational ESTIMATE editing + a pure normalizer + the canonical total
// recompute. React/RN-free so validators drive it.
//
// Money math. This MUST mirror the estimator that authored the estimate
// (app/(tabs)/estimate/full.tsx buildLinkedEstimate, :930-998), because an
// edit here is written straight over project.linkedEstimate and therefore
// moves the contract value:
//   lineTotal   = qty × (usesBulk ? bulkPrice : unitPrice) × (1 + markup/100)
//   baseTotal   = Σ qty × base        — pre-markup cost of every line
//   grandTotal  = Σ lineTotal         — what the client is quoted
//   markupTotal = grandTotal − baseTotal
// Markup is PER LINE (full.tsx:933). Labor lines (adjustedRate is the all-in
// rate) and assembly lines (totalCost is all-in) are stamped markup: 0 by the
// estimator and must stay at cost — see isAtCostLine below.
//
// The header here used to claim "Per-item markup is intentionally NOT an edit
// lever — globalMarkup is the canonical markup control", and the code matched
// that claim: it dropped each line's own markup and re-applied globalMarkup to
// the summed base. Both were wrong. On a $100K materials + $50K labor estimate
// at 15%, changing one quantity by voice re-marked-up the at-cost labor and
// raised the grand total by $7,500 — and the diff screen presented the inflated
// number as if it were the change the contractor had asked for.
import type { LinkedEstimate, LinkedEstimateItem } from '@/types';

/** An item reference: a LinkedEstimateItem.materialId; the interpreter also
 *  falls back to a case-insensitive name match. */
export type ItemRef = string;

export type EstimateEditOp =
  | { op: 'setQuantity'; item: ItemRef; quantity: number }
  | { op: 'setUnitPrice'; item: ItemRef; unitPrice: number }
  | { op: 'setGlobalMarkup'; markupPct: number }
  | { op: 'addLine'; name: string; category: string; unit: string; quantity: number; unitPrice: number }
  | { op: 'removeLine'; item: ItemRef };

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const numOr = (v: unknown, fb: number): number => (typeof v === 'number' && isFinite(v) ? v : fb);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Validate + clean a raw AI ops array. Pure. Unknown ops / missing refs /
 *  out-of-bounds values are dropped rather than trusted. */
export function normalizeEstimateOps(raw: unknown): EstimateEditOp[] {
  if (!Array.isArray(raw)) return [];
  const out: EstimateEditOp[] = [];
  for (const r of raw) {
    const op = (r as { op?: unknown })?.op;
    if (typeof op !== 'string') continue;
    const a = r as Record<string, unknown>;
    switch (op) {
      case 'setQuantity': {
        const item = str(a.item); const quantity = numOr(a.quantity, NaN);
        if (item && isFinite(quantity) && quantity >= 0) out.push({ op: 'setQuantity', item, quantity });
        break;
      }
      case 'setUnitPrice': {
        const item = str(a.item); const unitPrice = numOr(a.unitPrice ?? a.price, NaN);
        if (item && isFinite(unitPrice) && unitPrice >= 0) out.push({ op: 'setUnitPrice', item, unitPrice });
        break;
      }
      case 'setGlobalMarkup': {
        const markupPct = numOr(a.markupPct ?? a.markup, NaN);
        if (isFinite(markupPct) && markupPct >= 0 && markupPct <= 500) out.push({ op: 'setGlobalMarkup', markupPct });
        break;
      }
      case 'addLine': {
        const name = str(a.name); const quantity = numOr(a.quantity, NaN); const unitPrice = numOr(a.unitPrice ?? a.price, NaN);
        if (!name || !isFinite(quantity) || quantity < 0 || !isFinite(unitPrice) || unitPrice < 0) break;
        out.push({ op: 'addLine', name, category: str(a.category) || 'General', unit: str(a.unit) || 'ea', quantity, unitPrice });
        break;
      }
      case 'removeLine': {
        const item = str(a.item); if (item) out.push({ op: 'removeLine', item });
        break;
      }
      default: break;
    }
  }
  return out;
}

/** Category labels the estimator writes for lines that are ALREADY all-in cost:
 *  labor's adjustedRate carries the trade's own burden and an assembly's
 *  totalCost bakes in its material + labor, so full.tsx:963/:980 and
 *  estimate/review.tsx:196/:204 stamp both with markup: 0. Marking these up is
 *  what silently inflated the contract value on every voice edit. */
const AT_COST_CATEGORIES = new Set(['labor', 'assemblies']);

/** True when a line is priced at cost and must never receive markup. */
export function isAtCostLine(item: Pick<LinkedEstimateItem, 'category'>): boolean {
  return AT_COST_CATEGORIES.has(String(item.category ?? '').trim().toLowerCase());
}

/** Cascade a new global markup across the lines that are allowed to carry one,
 *  mirroring MaterialCartContext.setGlobalMarkup — which maps over `cart`
 *  (materials) and never touches laborCart / assemblyCart. Pure; feed the
 *  result to recomputeEstimate.
 *
 *  NOTE FOR THE setGlobalMarkup OP: interpretEstimateOps.ts currently only
 *  reassigns estimate.globalMarkup, which — now that money is per-line — moves
 *  no totals. That op's case should run its items through this helper so
 *  "bump the markup to 20%" reprices materials and leaves labor/assemblies at
 *  cost. recomputeEstimate re-zeroes at-cost lines regardless, so a cascade
 *  written any other way still cannot mark up labor. */
export function applyGlobalMarkupToItems(items: LinkedEstimateItem[], markupPct: number): LinkedEstimateItem[] {
  return items.map((it) => (isAtCostLine(it) ? { ...it, markup: 0 } : { ...it, markup: markupPct }));
}

/** Recompute every line's total + the estimate's three totals from the current
 *  items. The single source of money-truth for edits. */
export function recomputeEstimate(estimate: LinkedEstimate): LinkedEstimate {
  const items: LinkedEstimateItem[] = estimate.items.map((it) => {
    const base = it.usesBulk ? it.bulkPrice : it.unitPrice;
    // Per-line markup, exactly as the estimator prices a line (full.tsx:933).
    // At-cost lines are forced back to 0 so the line's own markup field and its
    // lineTotal always agree, and so no upstream cascade can re-price labor or
    // an assembly. numOr guards persisted rows with a missing/NaN markup, which
    // would otherwise poison every total on the estimate.
    const markup = isAtCostLine(it) ? 0 : numOr(it.markup, 0);
    return { ...it, markup, lineTotal: round2(it.quantity * base * (1 + markup / 100)) };
  });
  // baseTotal sums the PRE-markup cost of every line and grandTotal sums the
  // markup-inclusive line totals, so the two differ by exactly the markup the
  // lines actually carry. Summing the already-rounded lineTotals keeps the
  // displayed rows footing to the displayed grand total.
  const baseTotal = round2(items.reduce((s, it) => s + it.quantity * (it.usesBulk ? it.bulkPrice : it.unitPrice), 0));
  const grandTotal = round2(items.reduce((s, it) => s + it.lineTotal, 0));
  const markupTotal = round2(grandTotal - baseTotal);
  return { ...estimate, items, baseTotal, markupTotal, grandTotal };
}
