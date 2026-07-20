// utils/copilot/newProject/newProjectCapability.ts — the New Project Copilot
// capability. Top of the funnel: speak the job ("two-story addition on the
// Miller house, standard finishes") → the interview grounds type/finish in what
// you usually build → addProject creates a real project (real UUID, so it syncs)
// and drops you inside it, ready for the estimate and schedule. The only
// capability that is NOT project-scoped — it MAKES the project.
import type { CopilotCapability, CopilotContext, Gap, Grounding } from '../types';
import type { Project, ProjectType, QualityTier } from '@/types';
import { newProjectGaps, type NewProjectDraft } from './newProjectGaps';
import { buildNewProjectGrounding } from './newProjectGrounding';
import { generateUUID } from '@/utils/generateId';

export interface NewProjectApplied { route: '/project-detail'; projectId: string }

const TYPES: ProjectType[] = [
  'new_build', 'renovation', 'addition', 'remodel', 'commercial', 'landscape',
  'roofing', 'flooring', 'painting', 'plumbing', 'electrical', 'concrete',
];
const asType = (v: unknown): ProjectType | null =>
  typeof v === 'string' && (TYPES as string[]).includes(v) ? (v as ProjectType) : null;

const QUALITIES: QualityTier[] = ['economy', 'standard', 'premium', 'luxury'];
const asQuality = (v: unknown): QualityTier | null =>
  typeof v === 'string' && (QUALITIES as string[]).includes(v) ? (v as QualityTier) : null;

// A model that can't fill a free-text field sometimes echoes the literal string
// "null"/"none" instead of a JSON null — never let that become a project's name
// or location.
const JUNK = new Set(['', 'null', 'none', 'n/a', 'na', 'undefined', 'unknown']);
const clean = (v: unknown): string => {
  const t = (typeof v === 'string' ? v : '').trim();
  return JUNK.has(t.toLowerCase()) ? '' : t;
};

export const newProjectCapability: CopilotCapability<NewProjectDraft, NewProjectApplied> = {
  id: 'new_project',
  label: 'Start a project',
  aiFeature: 'voiceCapture',
  maxQuestions: 2,
  askThreshold: 0.4,
  suggestions: [
    'Two-story addition on the Miller house, standard finishes',
    'Full kitchen remodel downtown, premium finishes, about 300 square feet',
  ],
  topicChecklist: [
    { label: 'Name', hint: 'what to call the job' },
    { label: 'Type', hint: 'renovation / new build / addition…' },
    { label: 'Finish', hint: 'economy → luxury' },
  ],
  copy: {
    voiceTitle: 'Start a project',
    composeEyebrow: 'START A NEW PROJECT',
    composeQuestion: 'What are we building?',
    composeHint: 'Name it and describe the job — I’ll set it up and drop you inside.',
    reviewHeadline: 'Here’s your project, ready to open.',
    reviewSub: 'Review the basics, then create it. You’ll add the estimate and schedule next.',
    buildingLabel: 'Setting up the project…',
    webRoute: '/project-detail',
  },
  buildGrounding: buildNewProjectGrounding,
  gaps: (draft: NewProjectDraft, grounding: Grounding): Gap[] => newProjectGaps(draft, grounding),

  buildTurnPrompt: ({ transcript, draft, grounding, asking }) => ({
    prompt: [
      'You are MAGE Copilot helping a contractor start a new construction project.',
      'Extract ONLY what they stated — a null field is how you ASK, never invent:',
      '• name: a SHORT project name (e.g. "Miller Addition", "Downtown Kitchen"),',
      '  cleaned up from how they described it. Always try to produce one.',
      '• type: one of new_build | renovation | addition | remodel | commercial |',
      '  landscape | roofing | flooring | painting | plumbing | electrical |',
      '  concrete — only if the description makes it clear; else null.',
      '• quality: economy | standard | premium | luxury — only if they named a',
      '  finish level; else null.',
      '• location: a city / area only if they gave one; else null.',
      '• squareFootage: a number only if they gave a size; else null.',
      '• description: a one-line summary of the scope in their words.',
      '',
      ...grounding.facts,
      '',
      'DRAFT SO FAR: ' + JSON.stringify(draft),
      asking ? `THEY ARE ANSWERING: "${asking.question}"` : '',
      'WHAT THEY SAID: ' + transcript,
      'Return ONLY the updated draft JSON.',
    ].filter(Boolean).join('\n'),
    schemaHint: { name: 'Miller Addition', type: null, quality: null, location: null, squareFootage: null, description: 'Two-story addition' },
  }),

  mergeDraft: (draft, aiJson, meta): NewProjectDraft => ({
    name: (typeof aiJson?.name === 'string' && aiJson.name.trim() ? aiJson.name : draft.name) ?? meta?.transcript?.slice(0, 80) ?? null,
    // Validate the enum here so a junk value can't suppress the type/finish gap.
    type: asType(aiJson?.type) ?? draft.type ?? null,
    location: typeof aiJson?.location === 'string' ? aiJson.location : draft.location ?? null,
    squareFootage: typeof aiJson?.squareFootage === 'number' ? aiJson.squareFootage : draft.squareFootage ?? null,
    quality: asQuality(aiJson?.quality) ?? draft.quality ?? null,
    description: (typeof aiJson?.description === 'string' && aiJson.description.trim() ? aiJson.description : draft.description) ?? meta?.transcript ?? null,
  }),

  apply: async (draft: NewProjectDraft, ctx: CopilotContext): Promise<NewProjectApplied> => {
    const grounding = await buildNewProjectGrounding(ctx);
    const g = grounding.data as { usualType?: string | null; usualQuality?: string | null; usualLocation?: string | null };

    const name = clean(draft.name) || 'New Project';
    const type: ProjectType = asType(draft.type) ?? asType(g.usualType) ?? 'renovation';
    const quality: QualityTier = asQuality(draft.quality) ?? asQuality(g.usualQuality) ?? 'standard';
    const location = clean(draft.location) || (g.usualLocation ?? '') || 'United States';
    const squareFootage = typeof draft.squareFootage === 'number' && draft.squareFootage > 0 ? draft.squareFootage : 0;

    const now = new Date().toISOString();
    // MUST be a real UUID — projects.id is a uuid column in Supabase; a
    // synthetic id is silently rejected on upsert and the project vanishes on
    // the next refetch. (Same trap the home-screen create flow documents.)
    const id = generateUUID();
    const project: Project = {
      id,
      name: name.slice(0, 120),
      type,
      location,
      squareFootage,
      quality,
      description: clean(draft.description),
      createdAt: now,
      updatedAt: now,
      estimate: null,
      schedule: null,
      status: 'draft',
    };
    ctx.ctx?.addProject?.(project);
    return { route: '/project-detail', projectId: id };
  },
};
