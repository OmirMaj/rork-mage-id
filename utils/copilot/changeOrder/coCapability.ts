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

/**
 * The reason codes the change-order screen turns into the words the client
 * signs (app/change-order.tsx, its `prefillReason` labels).
 */
export type COReasonCode = 'client_request' | 'field_condition' | 'allowance_overage';

/**
 * THE REASON THE CLIENT SIGNS IS THE REASON THAT WAS GIVEN (lane PAYFIX).
 *
 * This used to be `allowance_overage ? allowance_overage : client_request`, so
 * a GC who said "field condition — extra footing" handed his client a change
 * order that read "Client request": the client signing for a change he never
 * asked for, on the document that decides who pays for it. A known code passes
 * through unchanged; anything else ('other', a missing reason, a model
 * paraphrase) is '' — the reason box opens EMPTY for the GC to fill in, and
 * nothing is ever turned into "client request" that was not said as one.
 */
export function coReasonCode(raw: string | null | undefined): COReasonCode | '' {
  const code = (raw ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return code === 'client_request' || code === 'field_condition' || code === 'allowance_overage' ? code : '';
}

export const changeOrderCapability: CopilotCapability<CODraft, COApplied> = {
  id: 'change_order',
  label: 'Draft a Change Order',
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
      'other; "" when they gave no reason), changeAmount (dollars, number, null if',
      'not stated), scheduleImpactDays (number, null if not stated). Never invent an',
      'amount or a reason.',
      '',
      ...grounding.facts,
      '',
      'DRAFT SO FAR: ' + JSON.stringify(draft),
      asking ? `THEY ARE ANSWERING: "${asking.question}"` : '',
      'WHAT THEY SAID: ' + transcript,
      'Return ONLY the updated draft JSON.',
    ].filter(Boolean).join('\n'),
    // The relay shows this literal to the model as the example to match. The
    // reason is EMPTY here on purpose: it used to read 'client_request', which
    // offered the model a reason the contractor never gave (lane PAYFIX).
    schemaHint: { description: 'Add heat-pump upgrade', reason: '', changeAmount: null, scheduleImpactDays: null },
  }),

  mergeDraft: (draft, aiJson, meta): CODraft => ({
    description: (typeof aiJson?.description === 'string' && aiJson.description.trim() ? aiJson.description : draft.description) ?? meta?.transcript ?? null,
    // An empty reason from the model means "none given this turn": it never
    // erases a reason the contractor gave on an earlier turn.
    reason: (typeof aiJson?.reason === 'string' && aiJson.reason.trim() ? aiJson.reason : draft.reason) ?? null,
    changeAmount: typeof aiJson?.changeAmount === 'number' ? aiJson.changeAmount : draft.changeAmount ?? null,
    scheduleImpactDays: typeof aiJson?.scheduleImpactDays === 'number' ? aiJson.scheduleImpactDays : draft.scheduleImpactDays ?? null,
  }),

  apply: async (draft: CODraft, ctx: CopilotContext): Promise<COApplied> => {
    if (!ctx.project) throw new Error('No project for this change order.');
    const description = (draft.description ?? '').trim();
    if (!description) throw new Error('Tell me what the change is first.');
    const reason = coReasonCode(draft.reason);
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
