// utils/copilot/changeOrder/coCapability.ts — the Change Order Copilot capability.
//
// Capture a change the owner asked for on-site: speak it, confirm the amount +
// schedule impact, then hand off to the change-order screen PRE-FILLED (no CO is
// created until the contractor saves there, so approval routing / portal send
// stay in the existing flow). apply() persists nothing — it only routes.
import type { CopilotCapability, CopilotContext, Gap, Grounding } from '../types';
import { coGaps, type CODraft } from './coGaps';
import { buildCOGrounding } from './coGrounding';

export interface COApplied {
  route: '/change-order';
  projectId: string;
  params: { projectId: string; prefillReason: string; prefillDescription: string; prefillAmount: string; prefillScheduleDays: string };
}

export const changeOrderCapability: CopilotCapability<CODraft, COApplied> = {
  id: 'change_order',
  label: 'Draft a change order',
  aiFeature: 'changeOrderImpact',
  maxQuestions: 2,
  askThreshold: 0.4,
  suggestions: [
    'Owner wants to add a heat-pump upgrade, about $4,200 installed',
    'Field condition — extra footing at the addition, roughly $1,800',
  ],
  topicChecklist: [
    { label: 'Change', hint: 'what the owner wants' },
    { label: 'Amount', hint: 'added cost' },
    { label: 'Schedule', hint: 'days it adds' },
  ],
  copy: {
    voiceTitle: 'Draft a change order',
    composeEyebrow: 'TELL ME ABOUT THE CHANGE',
    composeQuestion: 'What’s the change?',
    composeHint: 'What the owner wants + the added cost, if you have it.',
    reviewHeadline: 'Here’s the change order, ready to finalize.',
    reviewSub: 'Review the amount + schedule impact, then open it to route for approval.',
    buildingLabel: 'Drafting the change order…',
    webRoute: '/change-order',
  },
  buildGrounding: buildCOGrounding,
  gaps: (draft: CODraft, grounding: Grounding): Gap[] => coGaps(draft, grounding),

  buildTurnPrompt: ({ transcript, draft, grounding, asking }) => ({
    prompt: [
      'You are MAGE Copilot capturing a construction change order from a contractor.',
      'Extract ONLY what they stated: description (the changed scope in a short',
      'phrase), reason (client_request | field_condition | allowance_overage |',
      'other), changeAmount (dollars, number, null if not stated), scheduleImpactDays',
      '(number, null if not stated). Never invent an amount.',
      '',
      ...grounding.facts,
      '',
      'DRAFT SO FAR: ' + JSON.stringify(draft),
      asking ? `THEY ARE ANSWERING: "${asking.question}"` : '',
      'WHAT THEY SAID: ' + transcript,
      'Return ONLY the updated draft JSON.',
    ].filter(Boolean).join('\n'),
    schemaHint: { description: 'Add heat-pump upgrade', reason: 'client_request', changeAmount: null, scheduleImpactDays: null },
  }),

  mergeDraft: (draft, aiJson, meta): CODraft => ({
    description: (typeof aiJson?.description === 'string' && aiJson.description.trim() ? aiJson.description : draft.description) ?? meta?.transcript ?? null,
    reason: typeof aiJson?.reason === 'string' ? aiJson.reason : draft.reason ?? null,
    changeAmount: typeof aiJson?.changeAmount === 'number' ? aiJson.changeAmount : draft.changeAmount ?? null,
    scheduleImpactDays: typeof aiJson?.scheduleImpactDays === 'number' ? aiJson.scheduleImpactDays : draft.scheduleImpactDays ?? null,
  }),

  apply: async (draft: CODraft, ctx: CopilotContext): Promise<COApplied> => {
    if (!ctx.project) throw new Error('No project for this change order.');
    const description = (draft.description ?? '').trim();
    if (!description) throw new Error('Tell me what the change is first.');
    const reason = draft.reason === 'allowance_overage' ? 'allowance_overage' : 'client_request';
    return {
      route: '/change-order',
      projectId: ctx.projectId,
      params: {
        projectId: ctx.projectId,
        prefillReason: reason,
        prefillDescription: description,
        prefillAmount: String(draft.changeAmount ?? 0),
        prefillScheduleDays: String(draft.scheduleImpactDays ?? 0),
      },
    };
  },
};
