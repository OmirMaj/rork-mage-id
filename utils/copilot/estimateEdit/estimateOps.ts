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
// Markup is PER LINE (full.tsx:933), and each line keeps the markup it was
// saved with. The estimator now marks up labor and assemblies too
// (full.tsx:1061/:1078 stamp `markup: globalMarkup` on both; cartTotals in
// utils/estimateMarkup applies the global rate to every bucket), so the line's
// own stored `markup` is the contract — not its category. See isAtCostLine for
// the rule this replaced.
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

/** Category labels an OLDER estimator wrote at cost (markup: 0).
 *  @deprecated No longer used by recomputeEstimate or applyGlobalMarkupToItems
 *  (audit wave 5, #6). The estimator marks labor and assemblies up now
 *  (full.tsx:1061/:1078, cartTotals), so zeroing them by category stripped the
 *  markup off every labor and assembly line on each voice edit — a $50K labor
 *  line at 20% lost $10,000 of contract value to "change the tile quantity".
 *  Kept exported with its predicate unchanged only because app/area-takeoff.tsx
 *  and app/plan-intelligence.tsx still import it (the estimating lane's carry
 *  and w5-join-screens' cleanup remove those callers; then delete this). */
const AT_COST_CATEGORIES = new Set(['labor', 'assemblies']);

/** @deprecated See AT_COST_CATEGORIES. True when a line's category is one an
 *  older estimator priced at cost. Not a pricing rule any more. */
export function isAtCostLine(item: Pick<LinkedEstimateItem, 'category'>): boolean {
  return AT_COST_CATEGORIES.has(String(item.category ?? '').trim().toLowerCase());
}

/** Cascade a new global markup across EVERY line, mirroring the estimator's
 *  global-markup chips and utils/estimateMarkup.cartTotals, which apply one
 *  rate to materials, labor and assemblies alike. Pure; feed the result to
 *  recomputeEstimate.
 *
 *  interpretEstimateOps.ts's setGlobalMarkup case runs its items through this
 *  helper (AI-F5 — it used to reassign estimate.globalMarkup alone, which,
 *  with money per-line, moved no totals), so "bump the markup to 20%" reprices
 *  every line the way the estimator would. It used to leave labor/assemblies at
 *  0 — the same drift as #6 — so "bump the markup to 20%" on an estimate built
 *  at 20% everywhere quietly took labor to 0%. */
export function applyGlobalMarkupToItems(items: LinkedEstimateItem[], markupPct: number): LinkedEstimateItem[] {
  return items.map((it) => ({ ...it, markup: markupPct }));
}

/** Recompute every line's total + the estimate's three totals from the current
 *  items. The single source of money-truth for edits. */
export function recomputeEstimate(estimate: LinkedEstimate): LinkedEstimate {
  const items: LinkedEstimateItem[] = estimate.items.map((it) => {
    const base = it.usesBulk ? it.bulkPrice : it.unitPrice;
    // Per-line markup, exactly as the estimator prices a line (full.tsx:933):
    // the line's OWN stored markup, whatever its category. An estimate saved
    // before the estimator marked labor up stores labor at 0 and so recomputes
    // byte-identical; one saved at 20% on labor keeps its 20%. (A category rule
    // used to force labor/assemblies to 0 here — #6.) numOr guards persisted
    // rows with a missing/NaN markup, which would otherwise poison every total
    // on the estimate.
    const markup = numOr(it.markup, 0);
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
