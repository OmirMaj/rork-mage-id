// utils/copilot/punch/punchCapability.ts — the Punch List Copilot capability.
// Speak the defect + location → confirm the trade → addPunchItem.
import type { CopilotCapability, CopilotContext, Gap, Grounding } from '../types';
import { punchGaps, type PunchDraft } from './punchGaps';
import { buildPunchGrounding } from './punchGrounding';
import { createId } from '@/utils/scheduleEngine';
import type { PunchItemPriority } from '@/types';

export interface PunchApplied { route: '/punch-list'; projectId: string; params: { projectId: string } }

const PRIORITIES: PunchItemPriority[] = ['low', 'medium', 'high'];
const isPriority = (v: unknown): v is PunchItemPriority => typeof v === 'string' && (PRIORITIES as string[]).includes(v);

export const punchCapability: CopilotCapability<PunchDraft, PunchApplied> = {
  id: 'punch',
  label: 'Add a punch item',
  aiFeature: 'voiceCapture',
  maxQuestions: 2,
  askThreshold: 0.4,
  suggestions: [
    'Loose light fixture in the master bath',
    'Paint touch-up needed on the stairwell wall, second floor',
  ],
  topicChecklist: [
    { label: 'Defect', hint: 'what needs fixing' },
    { label: 'Location', hint: 'where on site' },
    { label: 'Trade', hint: 'who fixes it' },
  ],
  copy: {
    voiceTitle: 'Add a punch item',
    reviewHeadline: 'Here’s the punch item, ready to log.',
    reviewSub: 'Review the trade and location, then open the punch list to assign and track.',
    buildingLabel: 'Logging the punch item…',
    webRoute: '/punch-list',
  },
  buildGrounding: buildPunchGrounding,
  gaps: (draft: PunchDraft, grounding: Grounding): Gap[] => punchGaps(draft, grounding),

  buildTurnPrompt: ({ transcript, draft, grounding, asking }) => ({
    prompt: [
      'You are MAGE Copilot capturing a construction punch-list item.',
      'Extract ONLY what they stated: description (the defect), location (where on',
      'site, if named), assignedSub (the trade, if named), priority (low | medium |',
      'high, only if implied). Never invent a trade or location.',
      '',
      ...grounding.facts,
      '',
      'DRAFT SO FAR: ' + JSON.stringify(draft),
      asking ? `THEY ARE ANSWERING: "${asking.question}"` : '',
      'WHAT THEY SAID: ' + transcript,
      'Return ONLY the updated draft JSON.',
    ].filter(Boolean).join('\n'),
    schemaHint: { description: null, location: null, assignedSub: null, priority: null },
  }),

  mergeDraft: (draft, aiJson, meta): PunchDraft => ({
    description: (typeof aiJson?.description === 'string' && aiJson.description.trim() ? aiJson.description : draft.description) ?? meta?.transcript ?? null,
    location: typeof aiJson?.location === 'string' ? aiJson.location : draft.location ?? null,
    assignedSub: typeof aiJson?.assignedSub === 'string' ? aiJson.assignedSub : draft.assignedSub ?? null,
    priority: isPriority(aiJson?.priority) ? aiJson.priority : draft.priority ?? null,
  }),

  apply: async (draft: PunchDraft, ctx: CopilotContext): Promise<PunchApplied> => {
    if (!ctx.project) throw new Error('No project for this punch item.');
    const description = (draft.description ?? '').trim();
    if (!description) throw new Error('Tell me what needs fixing first.');
    const dueDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

    ctx.ctx?.addPunchItem?.({
      id: createId('punch'),
      projectId: ctx.projectId,
      description,
      location: draft.location ?? '',
      assignedSub: draft.assignedSub ?? 'GC crew',
      dueDate,
      priority: draft.priority ?? 'medium',
      status: 'open',
    });
    return { route: '/punch-list', projectId: ctx.projectId, params: { projectId: ctx.projectId } };
  },
};
