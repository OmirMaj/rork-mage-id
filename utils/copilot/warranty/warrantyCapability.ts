// utils/copilot/warranty/warrantyCapability.ts — the Warranty Copilot capability.
//
// Speak a warranty as you close it out ("the GAF roof, 25 years, starts at
// closeout") → the interview fills the term / provider / category it needs to
// compute expiry → addWarranty persists it with an auto-computed status, and
// drops you on the warranties list. The moat: a warranty you'd otherwise lose
// on a paper folder becomes a tracked, claimable record that reminds you before
// it lapses. Mirrors the RFI/Punch adder-based shape.
import type { CopilotCapability, CopilotContext, Gap, Grounding } from '../types';
import type { WarrantyCategory } from '@/types';
import { warrantyGaps, defaultDurationForCategory, type WarrantyDraft } from './warrantyGaps';
import { buildWarrantyGrounding } from './warrantyGrounding';

export interface WarrantyApplied { route: '/warranties'; projectId: string; params: { projectId: string } }

const CATEGORIES: WarrantyCategory[] = [
  'general', 'roofing', 'plumbing', 'electrical', 'hvac', 'foundation',
  'windows', 'appliances', 'finishes', 'structural', 'other',
];
const isCategory = (v: unknown): v is WarrantyCategory =>
  typeof v === 'string' && (CATEGORIES as string[]).includes(v);

/** Add whole months to an ISO date (YYYY-MM-DD), staying on calendar months. */
function addMonths(iso: string, months: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export const warrantyCapability: CopilotCapability<WarrantyDraft, WarrantyApplied> = {
  id: 'warranty',
  label: 'Log a warranty',
  aiFeature: 'voiceCapture',
  maxQuestions: 3,
  askThreshold: 0.4,
  suggestions: [
    'GAF roof membrane, 25-year manufacturer warranty, starts at closeout',
    'Carrier heat pump, 5 years on the compressor, installed by Delta Mechanical',
  ],
  topicChecklist: [
    { label: 'What', hint: 'the system or item covered' },
    { label: 'Term', hint: 'how long it lasts' },
    { label: 'Provider', hint: 'manufacturer / installer' },
  ],
  copy: {
    voiceTitle: 'Log a warranty',
    composeEyebrow: 'WHAT’S UNDER WARRANTY',
    composeQuestion: 'What are we covering?',
    composeHint: 'The system + who backs it — I’ll track the term and warn you before it lapses.',
    reviewHeadline: 'Here’s your warranty, ready to track.',
    reviewSub: 'Review the term, then log it. MAGE computes the expiry and reminds you before coverage ends.',
    buildingLabel: 'Logging the warranty…',
    webRoute: '/warranties',
  },
  buildGrounding: buildWarrantyGrounding,
  gaps: (draft: WarrantyDraft, grounding: Grounding): Gap[] => warrantyGaps(draft, grounding),

  buildTurnPrompt: ({ transcript, draft, grounding, asking }) => ({
    prompt: [
      'You are MAGE Copilot capturing a construction warranty for a contractor.',
      'Extract ONLY what they stated — a null field is how you ASK, so never invent:',
      '• title: a short label for what is covered (e.g. "Roof membrane", "Heat pump").',
      '• category: one of general | roofing | plumbing | electrical | hvac |',
      '  foundation | windows | appliances | finishes | structural | other — only',
      '  if the item makes it obvious; else null.',
      '• provider: the manufacturer OR the sub/installer who backs it, if named.',
      '• durationMonths: the term IN MONTHS. Convert years to months (25 years =',
      '  300, 1 year = 12). Only if they gave a length; else null.',
      '• startDate: ISO YYYY-MM-DD only if they gave a real start (e.g. a date, or',
      '  "starts at closeout" → leave null, do not guess).',
      '',
      ...grounding.facts,
      '',
      'DRAFT SO FAR: ' + JSON.stringify(draft),
      asking ? `THEY ARE ANSWERING: "${asking.question}"` : '',
      'WHAT THEY SAID: ' + transcript,
      'Return ONLY the updated draft JSON.',
    ].filter(Boolean).join('\n'),
    schemaHint: { title: 'Roof membrane', category: null, provider: null, durationMonths: null, startDate: null },
  }),

  mergeDraft: (draft, aiJson, meta): WarrantyDraft => ({
    title: (typeof aiJson?.title === 'string' && aiJson.title.trim() ? aiJson.title : draft.title) ?? meta?.transcript ?? null,
    category: isCategory(aiJson?.category) ? aiJson.category : draft.category ?? null,
    provider: typeof aiJson?.provider === 'string' ? aiJson.provider : draft.provider ?? null,
    durationMonths: typeof aiJson?.durationMonths === 'number' ? aiJson.durationMonths : draft.durationMonths ?? null,
    startDate: typeof aiJson?.startDate === 'string' ? aiJson.startDate : draft.startDate ?? null,
    coverageDetails: draft.coverageDetails ?? null,
  }),

  apply: async (draft: WarrantyDraft, ctx: CopilotContext): Promise<WarrantyApplied> => {
    const project = ctx.project;
    if (!project) throw new Error('No project to attach the warranty to.');

    const category: WarrantyCategory = draft.category ?? 'general';
    const durationMonths = draft.durationMonths ?? defaultDurationForCategory(category);
    const startDate = (draft.startDate ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
    const endDate = addMonths(startDate, durationMonths);
    const title = (draft.title ?? '').trim() || 'Warranty';

    ctx.ctx?.addWarranty?.({
      projectId: ctx.projectId,
      projectName: project.name ?? 'Project',
      title: title.slice(0, 80),
      category,
      provider: (draft.provider ?? '').trim(),
      startDate,
      durationMonths,
      endDate,
      ...(draft.coverageDetails ? { coverageDetails: draft.coverageDetails } : {}),
    });
    return { route: '/warranties', projectId: ctx.projectId, params: { projectId: ctx.projectId } };
  },
};
