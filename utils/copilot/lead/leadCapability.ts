// utils/copilot/lead/leadCapability.ts — the Lead-capture Copilot capability.
//
// Top of the sales funnel, NOT project-scoped: a homeowner calls, you say what
// they told you ("Sarah Miller called about a kitchen reno, ~$60-80k, wants it
// by spring, found us on Houzz"), and MAGE files a lead — starting the
// first-response clock the pipeline sorts on — then drops you on the leads
// board. addLead lives on ProjectContext (ctx.ctx).
import type { CopilotCapability, CopilotContext, Gap, Grounding } from '../types';
import type { LeadSource } from '@/types';
import { leadGaps, type LeadDraft } from './leadGaps';
import { buildLeadGrounding } from './leadGrounding';

export interface LeadApplied { route: '/leads'; projectId: string }

const SOURCES: LeadSource[] = [
  'referral', 'website', 'houzz', 'angi', 'yelp', 'thumbtack', 'google',
  'facebook', 'instagram', 'walk_in', 'repeat', 'sign', 'truck', 'mage_bids', 'other',
];
const asSource = (v: unknown): LeadSource =>
  typeof v === 'string' && (SOURCES as string[]).includes(v) ? (v as LeadSource) : 'other';

const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) && v > 0 ? v : null);

export const leadCapability: CopilotCapability<LeadDraft, LeadApplied> = {
  id: 'lead',
  label: 'Capture a lead',
  aiFeature: 'voiceCapture',
  maxQuestions: 2,
  askThreshold: 0.4,
  suggestions: [
    'Sarah Miller called about a kitchen reno, 60 to 80k, wants it by spring, found us on Houzz',
    'Referral from the Garcias — bathroom remodel, ballpark 30k, no rush',
  ],
  topicChecklist: [
    { label: 'Who', hint: 'homeowner name + phone' },
    { label: 'Scope', hint: 'what they want' },
    { label: 'Source', hint: 'how they found you' },
  ],
  copy: {
    voiceTitle: 'Capture a lead',
    composeEyebrow: 'A NEW INQUIRY',
    composeQuestion: 'Who reached out?',
    composeHint: 'Name, what they want, budget, timeline, how they found you — whatever you’ve got.',
    reviewHeadline: 'Here’s your lead, ready to work.',
    reviewSub: 'Review it, then save. The pipeline starts a first-response clock so it doesn’t go cold.',
    buildingLabel: 'Filing the lead…',
    webRoute: '/leads',
  },
  buildGrounding: buildLeadGrounding,
  gaps: (draft: LeadDraft, grounding: Grounding): Gap[] => leadGaps(draft, grounding),

  buildTurnPrompt: ({ transcript, draft, grounding, asking }) => ({
    prompt: [
      'You are MAGE Copilot capturing a construction sales lead for a contractor.',
      'Extract ONLY what they stated — a null field is how you ASK, never invent:',
      '• name: the homeowner’s name, if given.',
      '• phone: a phone number, if given. • address: the job address, if given.',
      '• projectType: a short free-text project type ("kitchen remodel").',
      '• scope: a one-line summary of what they want.',
      '• budgetMin / budgetMax: dollar numbers if they gave a range or ballpark',
      '  (a single number → set both). Else null.',
      '• timeline: free text ("spring", "before July"), if given.',
      '• source: how they found the contractor — one of referral | website | houzz |',
      '  angi | yelp | thumbtack | google | facebook | instagram | walk_in | repeat |',
      '  sign | truck | other — only if stated; else null.',
      '',
      ...grounding.facts,
      '',
      'DRAFT SO FAR: ' + JSON.stringify(draft),
      asking ? `THEY ARE ANSWERING: "${asking.question}"` : '',
      'WHAT THEY SAID: ' + transcript,
      'Return ONLY the updated draft JSON.',
    ].filter(Boolean).join('\n'),
    schemaHint: { name: 'Sarah Miller', phone: null, address: null, projectType: 'Kitchen remodel', scope: null, budgetMin: 60000, budgetMax: 80000, timeline: 'spring', source: 'houzz' },
  }),

  mergeDraft: (draft, aiJson, meta): LeadDraft => ({
    name: (typeof aiJson?.name === 'string' && aiJson.name.trim() ? aiJson.name : draft.name) ?? null,
    phone: typeof aiJson?.phone === 'string' ? aiJson.phone : draft.phone ?? null,
    address: typeof aiJson?.address === 'string' ? aiJson.address : draft.address ?? null,
    projectType: typeof aiJson?.projectType === 'string' ? aiJson.projectType : draft.projectType ?? null,
    scope: (typeof aiJson?.scope === 'string' && aiJson.scope.trim() ? aiJson.scope : draft.scope) ?? meta?.transcript ?? null,
    budgetMin: num(aiJson?.budgetMin) ?? draft.budgetMin ?? null,
    budgetMax: num(aiJson?.budgetMax) ?? draft.budgetMax ?? null,
    timeline: typeof aiJson?.timeline === 'string' ? aiJson.timeline : draft.timeline ?? null,
    // Only accept a VALID source — an out-of-enum string would otherwise be
    // non-null, suppress the source gap, and silently become 'other' at apply.
    source: (typeof aiJson?.source === 'string' && (SOURCES as string[]).includes(aiJson.source)) ? aiJson.source : draft.source ?? null,
  }),

  apply: async (draft: LeadDraft, ctx: CopilotContext): Promise<LeadApplied> => {
    const name = (draft.name ?? '').trim() || 'New lead';
    const budgetMin = num(draft.budgetMin);
    const budgetMax = num(draft.budgetMax) ?? budgetMin;

    ctx.ctx?.addLead?.({
      name: name.slice(0, 80),
      ...(draft.phone ? { phone: draft.phone.trim() } : {}),
      ...(draft.address ? { address: draft.address.trim() } : {}),
      ...(draft.projectType ? { projectType: draft.projectType.trim() } : {}),
      ...(draft.scope ? { scope: draft.scope.trim() } : {}),
      ...(budgetMin != null ? { budgetMin } : {}),
      ...(budgetMax != null ? { budgetMax } : {}),
      ...(draft.timeline ? { timeline: draft.timeline.trim() } : {}),
      source: asSource(draft.source),
      stage: 'new',
    });
    return { route: '/leads', projectId: ctx.projectId };
  },
};
