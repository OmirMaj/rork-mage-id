// utils/copilot/estimateEdit/interpretEstimateOps.ts — pure interpreter: apply
// EstimateEditOps to a LinkedEstimate with per-op guards, then recompute totals.
// Never throws; every op yields an OpResult. React/RN-free.
import type { LinkedEstimate, LinkedEstimateItem } from '@/types';
import { type EstimateEditOp, applyGlobalMarkupToItems, recomputeEstimate } from './estimateOps';

export interface EstimateOpResult {
  op: EstimateEditOp; ok: boolean; reason?: string;
  /** addLine only: the new line's id and the markup it was given, so the diff
   *  can say out loud what margin a voice-added line carries. */
  addedId?: string; addedMarkup?: number;
  /** The diff key (csiDivision || category — utils/estimateCommit.diffEstimates)
   *  of the line this op touched, so the diff can flag a category row that
   *  moved though no op asked it to (a recompute side effect, #6). */
  lineKey?: string;
}

const diffKey = (it: Pick<LinkedEstimateItem, 'csiDivision' | 'category'>): string =>
  (it.csiDivision || it.category || 'Uncategorized').toString();

/** Resolve an ItemRef (materialId, else case-insensitive name match) to an id. */
function resolveId(ref: string, items: LinkedEstimateItem[]): string | null {
  if (items.some((i) => i.materialId === ref)) return ref;
  const lc = ref.trim().toLowerCase();
  const hit = items.find((i) => i.name.trim().toLowerCase() === lc)
    ?? items.find((i) => i.name.trim().toLowerCase().includes(lc));
  return hit?.materialId ?? null;
}

let seq = 0;
function freshId(): string { seq += 1; return `edit-mat-${seq}-${(seq * 2654435761 % 100000)}`; }

export function interpretEstimateOps(
  ops: EstimateEditOp[],
  estimate: LinkedEstimate,
): { nextEstimate: LinkedEstimate; results: EstimateOpResult[] } {
  let items: LinkedEstimateItem[] = estimate.items.map((i) => ({ ...i }));
  let globalMarkup = estimate.globalMarkup;
  const results: EstimateOpResult[] = [];
  const patch = (id: string, over: Partial<LinkedEstimateItem>) => { items = items.map((i) => i.materialId === id ? { ...i, ...over } : i); };

  for (const op of ops) {
    try {
      switch (op.op) {
        case 'setQuantity': {
          const id = resolveId(op.item, items);
          if (!id) { results.push({ op, ok: false, reason: `no line matching "${op.item}"` }); break; }
          const cur = items.find((i) => i.materialId === id)!;
          patch(id, { quantity: op.quantity });
          results.push({ op, ok: true, lineKey: diffKey(cur) }); break;
        }
        case 'setUnitPrice': {
          const id = resolveId(op.item, items);
          if (!id) { results.push({ op, ok: false, reason: `no line matching "${op.item}"` }); break; }
          const cur = items.find((i) => i.materialId === id)!;
          patch(id, cur.usesBulk ? { bulkPrice: op.unitPrice } : { unitPrice: op.unitPrice });
          results.push({ op, ok: true, lineKey: diffKey(cur) }); break;
        }
        case 'setGlobalMarkup': {
          // AI-F5: money is per line (recomputeEstimate prices from it.markup),
          // so reassigning globalMarkup alone moved no totals — "set the markup
          // to 20%" applied, the header said 20, every line still carried 10,
          // and the quote went out at the old number. Cascade through the
          // helper: every line takes the new rate, as the estimator's chips do.
          globalMarkup = op.markupPct;
          items = applyGlobalMarkupToItems(items, op.markupPct);
          results.push({ op, ok: true }); break;
        }
        case 'removeLine': {
          const id = resolveId(op.item, items);
          if (!id) { results.push({ op, ok: false, reason: `no line matching "${op.item}"` }); break; }
          const cur = items.find((i) => i.materialId === id)!;
          items = items.filter((i) => i.materialId !== id);
          results.push({ op, ok: true, lineKey: diffKey(cur) }); break;
        }
        case 'addLine': {
          // A voice-added line carries the estimate's markup like its
          // neighbours (#6). It used to be written at markup: 0 — a line added
          // by voice was quietly priced at cost. The diff states the markup it
          // applied, so the default is never silent.
          const markup = typeof globalMarkup === 'number' && isFinite(globalMarkup) && globalMarkup >= 0 ? globalMarkup : 0;
          const line: LinkedEstimateItem = {
            materialId: freshId(), name: op.name, category: op.category, unit: op.unit,
            quantity: op.quantity, unitPrice: op.unitPrice, bulkPrice: op.unitPrice,
            markup, usesBulk: false, lineTotal: 0, supplier: '',
          };
          items = [...items, line];
          results.push({ op, ok: true, addedId: line.materialId, addedMarkup: markup, lineKey: diffKey(line) }); break;
        }
        default: results.push({ op, ok: false, reason: 'unknown op' });
      }
    } catch (e) {
      results.push({ op, ok: false, reason: (e as Error).message });
    }
  }
  const nextEstimate = recomputeEstimate({ ...estimate, items, globalMarkup });
  return { nextEstimate, results };
}
