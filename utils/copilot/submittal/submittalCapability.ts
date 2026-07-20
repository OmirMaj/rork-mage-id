// utils/copilot/submittal/submittalCapability.ts — the Submittal Copilot capability.
// Speak the submitted item → confirm the spec division + urgency → addSubmittal
// (auto-numbers, opens the review cycle).
import type { CopilotCapability, CopilotContext, Gap, Grounding } from '../types';
import { submittalGaps, type SubmittalDraft } from './submittalGaps';
import { buildSubmittalGrounding } from './submittalGrounding';

export interface SubmittalApplied { route: '/submittal'; projectId: string; params: { projectId: string } }

export const submittalCapability: CopilotCapability<SubmittalDraft, SubmittalApplied> = {
  id: 'submittal',
  label: 'Log a submittal',
  aiFeature: 'voiceCapture',
  maxQuestions: 2,
  askThreshold: 0.4,
  suggestions: [
    'Tile submittal for the primary bath — porcelain, 12x24',
    'Structural steel shop drawings for the moment frames',
  ],
  topicChecklist: [
    { label: 'Item', hint: 'what is being submitted' },
    { label: 'Spec section', hint: 'CSI division' },
    { label: 'Timing', hint: 'when you need approval' },
  ],
  copy: {
    voiceTitle: 'Log a submittal',
    composeEyebrow: 'WHAT ARE YOU SUBMITTING',
    composeQuestion: 'What’s the submittal?',
    composeHint: 'The item + spec section — I’ll number it and log it.',
    reviewHeadline: 'Here’s your submittal, ready to track.',
    reviewSub: 'Review the item + spec section, then open it to send for review.',
    buildingLabel: 'Logging the submittal…',
    webRoute: '/submittal',
  },
  buildGrounding: buildSubmittalGrounding,
  gaps: (draft: SubmittalDraft, grounding: Grounding): Gap[] => submittalGaps(draft, grounding),

  buildTurnPrompt: ({ transcript, draft, grounding, asking }) => ({
    prompt: [
      'You are MAGE Copilot capturing a construction submittal.',
      'Extract ONLY what they stated: title (a short name for the submitted item),',
      'specSection (the 2-digit CSI division ONLY if implied — 03 concrete, 05',
      'metals, 06 wood, 09 finishes, 23 mechanical, 26 electrical), urgent (true',
      'only if they implied a rush). Never invent a spec section.',
      '',
      ...grounding.facts,
      '',
      'DRAFT SO FAR: ' + JSON.stringify(draft),
      asking ? `THEY ARE ANSWERING: "${asking.question}"` : '',
      'WHAT THEY SAID: ' + transcript,
      'Return ONLY the updated draft JSON.',
    ].filter(Boolean).join('\n'),
    schemaHint: { title: 'Porcelain tile — primary bath', specSection: null, urgent: null },
  }),

  mergeDraft: (draft, aiJson, meta): SubmittalDraft => ({
    title: (typeof aiJson?.title === 'string' && aiJson.title.trim() ? aiJson.title : draft.title) ?? meta?.transcript ?? null,
    specSection: typeof aiJson?.specSection === 'string' ? aiJson.specSection : draft.specSection ?? null,
    urgent: typeof aiJson?.urgent === 'boolean' ? aiJson.urgent : draft.urgent ?? null,
  }),

  apply: async (draft: SubmittalDraft, ctx: CopilotContext): Promise<SubmittalApplied> => {
    if (!ctx.project) throw new Error('No project for this submittal.');
    const title = (draft.title ?? '').trim();
    if (!title) throw new Error('Tell me what’s being submitted first.');
    const today = new Date().toISOString().slice(0, 10);
    const requiredDate = new Date(Date.now() + (draft.urgent ? 7 : 14) * 86400000).toISOString().slice(0, 10);

    ctx.ctx?.addSubmittal?.({
      projectId: ctx.projectId,
      title: title.slice(0, 100),
      specSection: draft.specSection ?? '',
      submittedBy: '',
      submittedDate: today,
      requiredDate,
      reviewCycles: [],
      currentStatus: 'pending',
      attachments: [],
    });
    return { route: '/submittal', projectId: ctx.projectId, params: { projectId: ctx.projectId } };
  },
};
