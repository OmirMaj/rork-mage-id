// utils/copilot/estimateEdit/estimateEditCapability.ts — conversational editing
// of an existing estimate. AI → EstimateEditOp[] → interpret + recompute → diff
// → apply via commitEstimatePatch (undo-safe, versioned) + updateProject. No
// host seam needed — the estimate persists through the standard project update.
import { createElement } from 'react';
import type { CopilotCapability, CopilotContext, Gap, Grounding } from '../types';
import { commitEstimatePatch } from '@/utils/estimateCommit';
import { normalizeEstimateOps, type EstimateEditOp } from './estimateOps';
import { interpretEstimateOps } from './interpretEstimateOps';
import { buildEstimateEditGrounding } from './estimateEditGrounding';
import EstimateDiffView from '@/components/copilot/EstimateDiffView';

export interface EstimateEditDraft { ops: EstimateEditOp[] }
export interface EstimateEditApplied { route: '/project-detail'; projectId: string }

export const estimateEditCapability: CopilotCapability<EstimateEditDraft, EstimateEditApplied> = {
  id: 'estimateEdit',
  label: 'Edit the estimate',
  aiFeature: 'quickEstimate',
  maxQuestions: 0,
  askThreshold: 1,
  suggestions: [
    'Drop the tile to $10 a foot and cut the demo quantity in half',
    'Add a line for 5 gallons of paint at $40, and bump the markup to 20%',
  ],
  copy: {
    voiceTitle: 'Edit the estimate',
    composeEyebrow: 'CHANGE THE ESTIMATE',
    composeQuestion: 'What should change?',
    composeHint: 'Say the change — a quantity, a price, a new line, the markup. I’ll show the new total before it sticks.',
    reviewHeadline: 'Here’s the change.',
    reviewSub: 'Review the new total, then apply.',
    buildingLabel: 'Applying the change…',
    webRoute: '/(tabs)/estimate',
  },
  buildGrounding: buildEstimateEditGrounding,
  gaps: (_draft: EstimateEditDraft, _g: Grounding): Gap[] => [],
  buildTurnPrompt: ({ transcript, draft, grounding }) => ({
    prompt: [
      'You are MAGE Copilot EDITING an existing construction estimate.',
      'Output edit OPERATIONS against the line items below — reference lines by',
      'their id (the token in quotes is the name; use the id). Emit ONLY changes',
      'the contractor actually asked for. Ops:',
      '• {op:"setQuantity", item, quantity}  • {op:"setUnitPrice", item, unitPrice}',
      '• {op:"setGlobalMarkup", markupPct}',
      '• {op:"addLine", name, category, unit, quantity, unitPrice}  • {op:"removeLine", item}',
      '',
      'CURRENT LINE ITEMS:', ...((grounding.data.itemList as string[]) ?? []),
      `Markup: ${grounding.data.globalMarkup ?? 0}%.`,
      '',
      'DRAFT OPS SO FAR: ' + JSON.stringify(draft.ops ?? []),
      'WHAT THEY SAID: ' + transcript,
      'Return ONLY JSON: { "ops": [ ... ] }.',
    ].join('\n'),
    schemaHint: { ops: [{ op: 'setUnitPrice', item: 'm1', unitPrice: 10 }] },
  }),
  mergeDraft: (draft, aiJson): EstimateEditDraft => ({
    ops: [...(draft.ops ?? []), ...normalizeEstimateOps(aiJson?.ops)],
  }),
  apply: async (draft: EstimateEditDraft, ctx: CopilotContext): Promise<EstimateEditApplied> => {
    const project = ctx.project;
    if (project?.linkedEstimate && ctx.ctx?.updateProject) {
      const { nextEstimate } = interpretEstimateOps(draft.ops ?? [], project.linkedEstimate);
      const patch = commitEstimatePatch(project, nextEstimate, { reason: 'manual', note: 'Edited by voice' });
      ctx.ctx.updateProject(ctx.projectId, patch);
    }
    return { route: '/project-detail', projectId: ctx.projectId };
  },
  renderReview: ({ draft, ctx, confirm, cancel }) =>
    createElement(EstimateDiffView, { ops: (draft as EstimateEditDraft).ops ?? [], ctx, onApply: confirm, onDiscard: cancel }),
};
