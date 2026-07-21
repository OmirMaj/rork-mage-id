// utils/copilot/estimateEdit/estimateEditGrounding.ts — the CURRENT estimate IS
// the grounding for an edit. Serializes the line items so the model can resolve
// references ("the tile line") and reason about prices. Reads the project's
// linkedEstimate (already on ctx.project).
import type { CopilotContext, Grounding } from '../types';

export async function buildEstimateEditGrounding(c: CopilotContext): Promise<Grounding> {
  const est = c.project?.linkedEstimate ?? null;
  const facts: string[] = [];
  if (c.project?.name) facts.push(`Editing the estimate for ${c.project.name}.`);
  if (!est) return { facts: [...facts, 'No estimate is linked yet.'], data: { itemList: [] } };
  facts.push(`${est.items.length} line items; ${est.globalMarkup}% markup; grand total $${Math.round(est.grandTotal).toLocaleString()}.`);
  const list = est.items.map((i) =>
    `- ${i.materialId} "${i.name}" (${i.category}): ${i.quantity} ${i.unit} @ $${i.usesBulk ? i.bulkPrice : i.unitPrice} = $${Math.round(i.lineTotal)}`);
  return { facts, data: { itemList: list, globalMarkup: est.globalMarkup, grandTotal: est.grandTotal } };
}
