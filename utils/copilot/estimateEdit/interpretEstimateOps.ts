// utils/copilot/estimateEdit/interpretEstimateOps.ts — pure interpreter: apply
// EstimateEditOps to a LinkedEstimate with per-op guards, then recompute totals.
// Never throws; every op yields an OpResult. React/RN-free.
import type { LinkedEstimate, LinkedEstimateItem } from '@/types';
import { type EstimateEditOp, recomputeEstimate } from './estimateOps';

export interface EstimateOpResult { op: EstimateEditOp; ok: boolean; reason?: string }

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
          patch(id, { quantity: op.quantity });
          results.push({ op, ok: true }); break;
        }
        case 'setUnitPrice': {
          const id = resolveId(op.item, items);
          if (!id) { results.push({ op, ok: false, reason: `no line matching "${op.item}"` }); break; }
          const cur = items.find((i) => i.materialId === id)!;
          patch(id, cur.usesBulk ? { bulkPrice: op.unitPrice } : { unitPrice: op.unitPrice });
          results.push({ op, ok: true }); break;
        }
        case 'setGlobalMarkup': {
          globalMarkup = op.markupPct;
          results.push({ op, ok: true }); break;
        }
        case 'removeLine': {
          const id = resolveId(op.item, items);
          if (!id) { results.push({ op, ok: false, reason: `no line matching "${op.item}"` }); break; }
          items = items.filter((i) => i.materialId !== id);
          results.push({ op, ok: true }); break;
        }
        case 'addLine': {
          const line: LinkedEstimateItem = {
            materialId: freshId(), name: op.name, category: op.category, unit: op.unit,
            quantity: op.quantity, unitPrice: op.unitPrice, bulkPrice: op.unitPrice,
            markup: 0, usesBulk: false, lineTotal: 0, supplier: '',
          };
          items = [...items, line];
          results.push({ op, ok: true }); break;
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
