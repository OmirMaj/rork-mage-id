// utils/copilot/estimateEdit/estimateOps.ts — typed edit-op vocabulary for
// conversational ESTIMATE editing + a pure normalizer + the canonical total
// recompute. React/RN-free so validators drive it.
//
// Money math (matches estimate-wizard / pdfGenerator / the estimate-create
// capability): lineTotal = qty × (usesBulk ? bulkPrice : unitPrice);
// baseTotal = Σ lineTotal; markupTotal = baseTotal × globalMarkup/100;
// grandTotal = baseTotal + markupTotal. Per-item markup is intentionally NOT an
// edit lever in v1 — globalMarkup is the canonical markup control.
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

/** Recompute every line's total + the estimate's three totals from the current
 *  items + globalMarkup. The single source of money-truth for edits. */
export function recomputeEstimate(estimate: LinkedEstimate): LinkedEstimate {
  const items: LinkedEstimateItem[] = estimate.items.map((it) => {
    const base = it.usesBulk ? it.bulkPrice : it.unitPrice;
    return { ...it, lineTotal: round2(it.quantity * base) };
  });
  const baseTotal = round2(items.reduce((s, it) => s + it.lineTotal, 0));
  const markupTotal = round2(baseTotal * (estimate.globalMarkup / 100));
  const grandTotal = round2(baseTotal + markupTotal);
  return { ...estimate, items, baseTotal, markupTotal, grandTotal };
}
