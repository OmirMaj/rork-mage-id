// utils/copilot/estimateEdit/estimateEditCapability.ts — conversational editing
// of an existing estimate. AI → EstimateEditOp[] → interpret + recompute → diff
// → apply via commitEstimatePatch (undo-safe, versioned) + updateProject. No
// host seam needed — the estimate persists through the standard project update.
import { createElement } from 'react';
import { COMPLETE_DRAFT_RULE, type CopilotCapability, type CopilotContext, type Gap, type Grounding } from '../types';
import { commitEstimatePatch } from '@/utils/estimateCommit';
import { normalizeEstimateOps, type EstimateEditOp } from './estimateOps';
import { interpretEstimateOps } from './interpretEstimateOps';
import { buildEstimateEditGrounding } from './estimateEditGrounding';
import EstimateDiffView from '@/components/copilot/EstimateDiffView';

export interface EstimateEditDraft { ops: EstimateEditOp[] }
export interface EstimateEditApplied { route: '/project-detail'; projectId: string }

/** One example per op SHAPE — the relay (supabase/functions/_shared/inferSchema)
 *  unions them so only `op` is required and every op can be expressed. The one
 *  setUnitPrice example this replaced meant Gemini could emit only
 *  {op, item, unitPrice}: "cut the demo quantity in half", "bump the markup to
 *  20%" and "add a line for paint" were all dropped by the normalizer.
 *  setUnitPrice stays FIRST so a relay that has not been redeployed (val[0]
 *  only) infers exactly today's schema. Refs are placeholders; mergeDraft
 *  discards an op whose OWN ref (item, or an addLine's name) is one — see
 *  isEstimateEcho — so an echoed example never edits a real line. */
export const ESTIMATE_EDIT_SCHEMA_HINT = {
  ops: [
    { op: 'setUnitPrice', item: '<line id>', unitPrice: 10 },
    { op: 'setQuantity', item: '<line id>', quantity: 150 },
    { op: 'setGlobalMarkup', markupPct: 20 },
    { op: 'addLine', name: '<new line name>', category: 'General', unit: 'ea', quantity: 5, unitPrice: 40 },
    { op: 'removeLine', item: '<line id>' },
  ],
};

const isPlaceholder = (v: unknown) => typeof v === 'string' && v.trim().startsWith('<');

/** The ref each op kind READS (review round 3). The union schema declares
 *  `item` and `name` on every op, so a decoder may fill the slot an op does not
 *  use with the example's placeholder — setUnitPrice{item:'m1', name:'<new line
 *  name>'} is a real price change and must not vanish. Only a placeholder in a
 *  ref the op actually reads marks an echo. An unknown kind is judged on both
 *  (normalizeEstimateOps then drops it anyway). */
const EST_OWN_REFS: Record<string, readonly ('item' | 'name')[]> = {
  setUnitPrice: ['item'], setQuantity: ['item'], removeLine: ['item'], addLine: ['name'], setGlobalMarkup: [],
};
export const isEstimateEcho = (o: Record<string, unknown> | null | undefined): boolean => {
  const kind = typeof o?.op === 'string' && Object.prototype.hasOwnProperty.call(EST_OWN_REFS, o.op) ? EST_OWN_REFS[o.op] : (['item', 'name'] as const);
  return kind.some(f => isPlaceholder(o?.[f]));
};

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
      'The example shows every op SHAPE — emit only the ops asked for.',
      'DRAFT OPS SO FAR (from what they said before): ' + JSON.stringify(draft.ops ?? []),
      COMPLETE_DRAFT_RULE,
      'WHAT THEY SAID (earlier turns first, separated by " | "): ' + transcript,
      'Return ONLY JSON: { "ops": [ ... ] }.',
    ].join('\n'),
    schemaHint: ESTIMATE_EDIT_SCHEMA_HINT,
  }),
  mergeDraft: (draft, aiJson, meta): EstimateEditDraft => {
    // No ops array is not an answer to the protocol — keep what is queued.
    if (!Array.isArray(aiJson?.ops)) return draft;
    // setGlobalMarkup carries no line ref, so a placeholder can't mark an echo
    // of it. It reprices every line, so it is only taken when his words are
    // about markup THIS turn, or a markup change is already queued (the
    // complete-draft answer re-sends it on every later turn, and "also add
    // paint" must not quietly drop the markup he asked for). An echoed example
    // must never move the contract.
    const lastTurn = meta?.transcript ? meta.transcript.split(' | ').pop() ?? '' : '';
    const saidMarkup = /mark-?up|margin|profit|overhead|%|percent/i.test(lastTurn)
      || (draft.ops ?? []).some(o => o.op === 'setGlobalMarkup');
    const raw = (aiJson.ops as Record<string, unknown>[]).filter(o =>
      !isEstimateEcho(o) && (o?.op !== 'setGlobalMarkup' || saidMarkup));
    // THE COMPLETE-DRAFT RULE (COMPLETE_DRAFT_RULE, the schedule editor's
    // rule): the answer is the whole list for everything he has asked so far,
    // so it REPLACES the draft. The merge this replaced matched re-sent ops by
    // key, which had to guess correction vs. another line.
    return { ops: normalizeEstimateOps(raw) };
  },
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
