// utils/copilot/estimate/estimateCapability.ts — the Estimate Copilot capability.
//
// Voice a rough scope → the interview grounds pricing in the contractor's own
// costs (estimateGrounding, narrowed to the scope's trades), asks only what
// neither the job nor his settings resolve (finish level / size / markup),
// then PRICES the estimate on the review card (estimatePrice.ts — one metered
// quickEstimate call) so he sees the total, the base/markup split and which
// lines are his costs before anything is written. Build commits that priced
// preview undo-safely (the old version is saved) and drops him on the project.
//
// #7/#38: pricing used to happen inside Build, behind a review card that said
// "priced from your jobs — review the total" with no total on it; the markup
// was a hard-coded 18% stored outside lineTotal (the next edit erased it).
import { createElement } from 'react';
import type { CopilotCapability, CopilotContext, Gap, Grounding } from '../types';
import { estimateGaps, ESTIMATE_ASK_THRESHOLD, type EstimateDraft } from './estimateGaps';
import { buildEstimateGrounding } from './estimateGrounding';
import { buildCopilotLinkedEstimate, copilotEstimateMarkup, type PricedEstimate } from './estimatePricing';
import { commitEstimatePatch } from '@/utils/estimateCommit';
import { createId } from '@/utils/scheduleEngine';
import EstimateCopilotReview from '@/components/copilot/EstimateCopilotReview';
import type { QualityTier, LinkedEstimate, Project } from '@/types';

export interface EstimateApplied { route: '/project-detail'; projectId: string }

const QUALITIES: QualityTier[] = ['economy', 'standard', 'premium', 'luxury'];
const isQuality = (v: unknown): v is QualityTier => typeof v === 'string' && (QUALITIES as string[]).includes(v);

/** Commit a priced estimate — the only write. Pure apart from updateProject. */
export function commitCopilotEstimate(project: Project, linked: LinkedEstimate, ctx: CopilotContext): void {
  const patch = commitEstimatePatch(project, linked, { reason: 'pre_overwrite', note: 'Built by MAGE Copilot' });
  ctx.ctx?.updateProject?.(ctx.projectId, patch);
}

export const estimateCapability: CopilotCapability<EstimateDraft, EstimateApplied> = {
  id: 'estimate',
  label: 'Build an estimate',
  aiFeature: 'quickEstimate',
  // The interview turns are field extraction; the one quickEstimate trial is
  // charged on the pricing call (#35/#38: an estimate used to cost two).
  turnMeterFeature: 'copilot',
  maxQuestions: 3,
  askThreshold: ESTIMATE_ASK_THRESHOLD,
  suggestions: [
    'Kitchen gut — demo, 200 SF tile, new cabinets, rewire, repaint',
    'Full bath remodel, standard finishes, move the plumbing',
  ],
  topicChecklist: [
    { label: 'Scope', hint: 'rooms / trades / what work' },
    { label: 'Finish level', hint: 'economy → luxury' },
    { label: 'Size', hint: 'rough square footage' },
  ],
  copy: {
    voiceTitle: 'Build an estimate',
    composeEyebrow: 'TELL ME ABOUT THE SCOPE',
    composeQuestion: 'What are we pricing?',
    composeHint: 'Rooms, trades, finishes — I’ll price it from your costs where you have them.',
    // Not rendered (renderReview below owns the review card); kept honest in
    // case a caller reads it.
    reviewHeadline: 'Here’s your estimate.',
    reviewSub: 'Check the total and the lines, then build. You can fine-tune every line on the estimate grid.',
    buildingLabel: 'Saving your estimate…',
    webRoute: '/(tabs)/estimate',
  },
  buildGrounding: (ctx: CopilotContext) => buildEstimateGrounding(ctx),
  gaps: (draft: EstimateDraft, grounding: Grounding): Gap[] => estimateGaps(draft, grounding),

  buildTurnPrompt: ({ transcript, draft, grounding, asking }) => ({
    prompt: [
      'You are MAGE Copilot helping a contractor scope a construction estimate.',
      'Extract ONLY the pricing parameters the contractor actually stated. Do NOT',
      'invent them — a null field is how you ASK. Fields:',
      '• quality: economy | standard | premium | luxury — only if they named a',
      '  finish level; else null.',
      '• sizeSqft: number — only if they gave a square footage; else null.',
      '• markupPct: number — only if they stated a markup; else null.',
      '',
      'THEIR HISTORY:', ...grounding.facts,
      '',
      'DRAFT SO FAR: ' + JSON.stringify({ scope: draft.scope ?? null, quality: draft.quality ?? null, sizeSqft: draft.sizeSqft ?? null, markupPct: draft.markupPct ?? null }),
      asking ? `THEY ARE ANSWERING: "${asking.question}"` : '',
      'WHAT THEY SAID: ' + transcript,
      'Return ONLY the updated draft JSON.',
    ].filter(Boolean).join('\n'),
    schemaHint: { quality: null, sizeSqft: null, markupPct: null },
  }),

  mergeDraft: (draft, aiJson, meta): EstimateDraft => ({
    // The transcript IS the scope — keep the latest so pricing uses it. A new
    // turn drops any earlier price: the scope it priced may have changed.
    scope: meta?.transcript ?? draft.scope ?? null,
    quality: isQuality(aiJson?.quality) ? aiJson.quality : draft.quality ?? null,
    sizeSqft: typeof aiJson?.sizeSqft === 'number' ? aiJson.sizeSqft : draft.sizeSqft ?? null,
    markupPct: typeof aiJson?.markupPct === 'number' ? aiJson.markupPct : draft.markupPct ?? null,
  }),

  apply: async (draft: EstimateDraft, ctx: CopilotContext): Promise<EstimateApplied> => {
    const project = ctx.project;
    if (!project) throw new Error('No project to attach the estimate to.');
    const priced: PricedEstimate | null | undefined = draft.priced;
    // Build commits what the review showed. It never prices: a second model
    // call would write numbers he never saw.
    if (!priced || !Array.isArray(priced.costItems) || priced.costItems.length === 0) {
      throw new Error('Price the estimate on the review card first — nothing was saved.');
    }
    const markup = copilotEstimateMarkup(draft, ctx);
    if (!markup) throw new Error('Pick a markup first — MAGE won’t guess what you charge.');
    const linked = buildCopilotLinkedEstimate(priced.costItems, markup.pct, createId('est'), new Date().toISOString());
    commitCopilotEstimate(project, linked, ctx);
    return { route: '/project-detail', projectId: ctx.projectId };
  },

  renderReview: ({ draft, ctx, confirm, cancel, patchDraft, note }) =>
    createElement(EstimateCopilotReview, {
      draft: draft as EstimateDraft,
      ctx,
      onBuild: confirm,
      onDiscard: cancel,
      patchDraft: patchDraft as ((p: Partial<EstimateDraft>) => void) | undefined,
      note,
    }),
};
