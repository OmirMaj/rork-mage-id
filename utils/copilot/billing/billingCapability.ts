// utils/copilot/billing/billingCapability.ts — the Billing Copilot capability.
// Voice the intent — "bill what's done" vs "bill the full contract" — then hand
// off to bill-from-estimate, which owns the schedule-of-values, per-line %,
// retention, terms, and the "already billed" math. apply() persists nothing.
import type { CopilotCapability, CopilotContext, Gap, Grounding } from '../types';
import { billingGaps, type BillingDraft } from './billingGaps';
import { buildBillingGrounding } from './billingGrounding';

export interface BillingApplied {
  route: '/bill-from-estimate';
  projectId: string;
  params: { projectId: string; type: string };
}

export const billingCapability: CopilotCapability<BillingDraft, BillingApplied> = {
  id: 'invoice',
  label: 'Bill the client',
  aiFeature: 'invoicePrediction',
  maxQuestions: 1,
  askThreshold: 0.4,
  suggestions: [
    'Bill the owner for everything complete so far',
    'Bill the full contract amount',
  ],
  topicChecklist: [
    { label: 'Draw', hint: 'progress to date, or full' },
  ],
  copy: {
    voiceTitle: 'Bill the client',
    reviewHeadline: 'Here’s your draw, ready to itemize.',
    reviewSub: 'Open the billing screen to set each line’s %, retention, and terms, then send.',
    buildingLabel: 'Preparing your draw…',
    webRoute: '/bill-from-estimate',
  },
  buildGrounding: buildBillingGrounding,
  gaps: (draft: BillingDraft, grounding: Grounding): Gap[] => billingGaps(draft, grounding),

  buildTurnPrompt: ({ transcript, draft, grounding, asking }) => ({
    prompt: [
      'You are MAGE Copilot capturing a billing request from a contractor.',
      'Return billingType: "full" if they want to bill the entire contract, else',
      '"progress" for a partial / progress draw, else null if they didn\'t say.',
      '',
      ...grounding.facts,
      '',
      'DRAFT SO FAR: ' + JSON.stringify(draft),
      asking ? `THEY ARE ANSWERING: "${asking.question}"` : '',
      'WHAT THEY SAID: ' + transcript,
      'Return ONLY JSON.',
    ].filter(Boolean).join('\n'),
    schemaHint: { billingType: null },
  }),

  mergeDraft: (draft, aiJson): BillingDraft => ({
    billingType: aiJson?.billingType === 'progress' || aiJson?.billingType === 'full' ? aiJson.billingType : draft.billingType ?? null,
  }),

  apply: async (draft: BillingDraft, ctx: CopilotContext): Promise<BillingApplied> => {
    if (!ctx.project?.linkedEstimate) throw new Error('Add an estimate first — billing draws against it.');
    const type = draft.billingType ?? 'progress';
    return { route: '/bill-from-estimate', projectId: ctx.projectId, params: { projectId: ctx.projectId, type } };
  },
};
