// utils/copilot/submittal/submittalCapability.ts — the Submittal Copilot capability.
// Speak the submitted item → confirm the spec division + urgency → addSubmittal
// (auto-numbers, opens the review cycle).
import type { CopilotCapability, CopilotContext, Gap, Grounding } from '../types';
import { submittalGaps, type SubmittalDraft } from './submittalGaps';
import { buildSubmittalGrounding } from './submittalGrounding';
import { todayCalendarDay } from '@/utils/calendarDate';

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
    reviewSub: 'Review the item + spec section, then open it from Submittals to attach the product data and send it for review.',
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
    // The LOCAL calendar day, not the UTC one. `new Date().toISOString().slice(0, 10)`
    // is tomorrow's date from about 5-8 pm anywhere west of Greenwich, so a
    // voice-logged record filed after the crew knocked off carried the NEXT
    // day and its due date was a day out (audit round 2, #2 appendix).
    //
    // #57/#60: logging is not sending. The row starts unsent (submittedDate
    // blank — the first review round records when it went) and with NO
    // required date unless he said one: "7 days if urgent, else 14" was a
    // deadline nobody set, and the chase list then blamed the reviewer for it.
    // An urgent flag becomes the date only because he said so — today, the
    // honest reading of "rush" — and he adjusts it on the screen. The product
    // data is attached on the submittal screen (attachments start empty on
    // every create path; the screen's attach control is where they come from).
    const requiredDate = draft.urgent ? todayCalendarDay() : '';

    ctx.ctx?.addSubmittal?.({
      projectId: ctx.projectId,
      title: title.slice(0, 100),
      specSection: draft.specSection ?? '',
      submittedBy: '',
      submittedDate: '',
      requiredDate,
      ...(requiredDate ? { requiredDateSource: 'manual' as const } : {}),
      reviewCycles: [],
      currentStatus: 'pending',
      attachments: [],
    });
    return { route: '/submittal', projectId: ctx.projectId, params: { projectId: ctx.projectId } };
  },
};
