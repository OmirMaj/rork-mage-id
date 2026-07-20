// utils/copilot/rfi/rfiCapability.ts — the RFI Copilot capability.
// Speak the question → confirm who answers it + urgency → addRFI (auto-numbers).
import type { CopilotCapability, CopilotContext, Gap, Grounding } from '../types';
import { rfiGaps, type RFIDraft } from './rfiGaps';
import { buildRFIGrounding } from './rfiGrounding';

export interface RFIApplied { route: '/rfi'; projectId: string; params: { projectId: string } }

export const rfiCapability: CopilotCapability<RFIDraft, RFIApplied> = {
  id: 'rfi',
  label: 'Raise an RFI',
  aiFeature: 'voiceCapture',
  maxQuestions: 2,
  askThreshold: 0.4,
  suggestions: [
    'Need the beam size for the second-floor opening at grid C',
    'Which fixture goes in the powder room — the spec and plan disagree',
  ],
  topicChecklist: [
    { label: 'Question', hint: 'what you need answered' },
    { label: 'Recipient', hint: 'architect / engineer / owner' },
    { label: 'Urgency', hint: 'when you need it' },
  ],
  copy: {
    voiceTitle: 'Raise an RFI',
    composeEyebrow: 'WHAT DO YOU NEED ANSWERED',
    composeQuestion: 'What’s the question?',
    composeHint: 'The question + who should answer it.',
    reviewHeadline: 'Here’s your RFI, ready to send.',
    reviewSub: 'Review who it goes to, then open it to send and track the response.',
    buildingLabel: 'Writing up the RFI…',
    webRoute: '/rfi',
  },
  buildGrounding: buildRFIGrounding,
  gaps: (draft: RFIDraft, grounding: Grounding): Gap[] => rfiGaps(draft, grounding),

  buildTurnPrompt: ({ transcript, draft, grounding, asking }) => ({
    prompt: [
      'You are MAGE Copilot capturing a construction RFI (request for information).',
      'Extract ONLY what they stated: subject (a short title), question (the full',
      'ask), assignedTo (who to send it to, if named), urgent (true only if they',
      'implied a rush). Never invent a recipient.',
      '',
      ...grounding.facts,
      '',
      'DRAFT SO FAR: ' + JSON.stringify(draft),
      asking ? `THEY ARE ANSWERING: "${asking.question}"` : '',
      'WHAT THEY SAID: ' + transcript,
      'Return ONLY the updated draft JSON.',
    ].filter(Boolean).join('\n'),
    schemaHint: { subject: 'Beam sizing at grid C', question: null, assignedTo: null, urgent: null },
  }),

  mergeDraft: (draft, aiJson, meta): RFIDraft => ({
    subject: typeof aiJson?.subject === 'string' ? aiJson.subject : draft.subject ?? null,
    question: (typeof aiJson?.question === 'string' && aiJson.question.trim() ? aiJson.question : draft.question) ?? meta?.transcript ?? null,
    assignedTo: typeof aiJson?.assignedTo === 'string' ? aiJson.assignedTo : draft.assignedTo ?? null,
    urgent: typeof aiJson?.urgent === 'boolean' ? aiJson.urgent : draft.urgent ?? null,
  }),

  apply: async (draft: RFIDraft, ctx: CopilotContext): Promise<RFIApplied> => {
    if (!ctx.project) throw new Error('No project for this RFI.');
    const question = (draft.question ?? '').trim();
    if (!question) throw new Error('Tell me the question first.');
    const today = new Date().toISOString().slice(0, 10);
    const dueMs = Date.now() + (draft.urgent ? 3 : 7) * 86400000;
    const dateRequired = new Date(dueMs).toISOString().slice(0, 10);

    ctx.ctx?.addRFI?.({
      projectId: ctx.projectId,
      subject: (draft.subject ?? question).slice(0, 80),
      question,
      submittedBy: '',
      assignedTo: draft.assignedTo ?? 'Architect',
      ballInCourt: 'gc',
      dateSubmitted: today,
      dateRequired,
      status: 'open',
      priority: draft.urgent ? 'urgent' : 'normal',
    });
    return { route: '/rfi', projectId: ctx.projectId, params: { projectId: ctx.projectId } };
  },
};
