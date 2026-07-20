// utils/copilot/safety/safetyCapability.ts — the Safety Incident Copilot capability.
//
// Capture an incident the moment it happens: speak what happened → answer the
// one OSHA-recordability question (treatment level) → hand off to the incident
// form PRE-FILLED. apply() persists nothing (routes with prefills), so people
// involved / corrective actions / the OSHA computation stay in the safety form,
// and SafetyContext (Business-tier) isn't needed in the copilot host.
import type { CopilotCapability, CopilotContext, Gap, Grounding } from '../types';
import { safetyGaps, type SafetyDraft } from './safetyGaps';
import { buildSafetyGrounding } from './safetyGrounding';
import type { SafetyTreatment, SafetyIncidentType } from '@/types';

export interface SafetyApplied {
  route: '/safety-incidents';
  projectId: string;
  params: { projectId: string; prefillDescription: string; prefillTreatment: string; prefillType: string; prefillLocation: string };
}

const TREATMENTS: SafetyTreatment[] = ['none', 'first_aid', 'medical_beyond_first_aid'];
const TYPES: SafetyIncidentType[] = ['injury', 'near_miss', 'property', 'environmental'];
const isTreatment = (v: unknown): v is SafetyTreatment => typeof v === 'string' && (TREATMENTS as string[]).includes(v);
const isType = (v: unknown): v is SafetyIncidentType => typeof v === 'string' && (TYPES as string[]).includes(v);

export const safetyCapability: CopilotCapability<SafetyDraft, SafetyApplied> = {
  id: 'safety_incident',
  label: 'Report a safety incident',
  aiFeature: 'voiceCapture',
  maxQuestions: 1,
  askThreshold: 0.4,
  suggestions: [
    'Worker cut his hand on rebar tying steel on level 2',
    'Near miss — a pallet slipped off the forklift by the loading dock',
  ],
  topicChecklist: [
    { label: 'What happened', hint: 'the incident' },
    { label: 'Treatment', hint: 'first aid vs a doctor' },
    { label: 'Where', hint: 'location on site' },
  ],
  copy: {
    voiceTitle: 'Report a safety incident',
    composeEyebrow: 'WHAT HAPPENED',
    composeQuestion: 'What’s the incident?',
    composeHint: 'What happened + how it was treated.',
    reviewHeadline: 'Here’s the incident, ready to log.',
    reviewSub: 'Open the incident form to add who was involved + corrective actions, then save to the OSHA log.',
    buildingLabel: 'Writing up the incident…',
    webRoute: '/safety-incidents',
  },
  buildGrounding: buildSafetyGrounding,
  gaps: (draft: SafetyDraft, grounding: Grounding): Gap[] => safetyGaps(draft, grounding),

  buildTurnPrompt: ({ transcript, draft, grounding, asking }) => ({
    prompt: [
      'You are MAGE Copilot capturing a jobsite safety incident from a contractor.',
      'Extract ONLY what they stated: description (what happened), incidentType',
      '(injury | near_miss | property | environmental), location (where on site),',
      'treatment (none | first_aid | medical_beyond_first_aid — only if they said',
      'how it was treated). Never invent the treatment level.',
      '',
      ...grounding.facts,
      '',
      'DRAFT SO FAR: ' + JSON.stringify(draft),
      asking ? `THEY ARE ANSWERING: "${asking.question}"` : '',
      'WHAT THEY SAID: ' + transcript,
      'Return ONLY the updated draft JSON.',
    ].filter(Boolean).join('\n'),
    schemaHint: { description: 'Cut hand on rebar', incidentType: 'injury', location: null, treatment: null },
  }),

  mergeDraft: (draft, aiJson, meta): SafetyDraft => ({
    description: (typeof aiJson?.description === 'string' && aiJson.description.trim() ? aiJson.description : draft.description) ?? meta?.transcript ?? null,
    incidentType: isType(aiJson?.incidentType) ? aiJson.incidentType : draft.incidentType ?? null,
    location: typeof aiJson?.location === 'string' ? aiJson.location : draft.location ?? null,
    treatment: isTreatment(aiJson?.treatment) ? aiJson.treatment : draft.treatment ?? null,
  }),

  apply: async (draft: SafetyDraft, ctx: CopilotContext): Promise<SafetyApplied> => {
    if (!ctx.project) throw new Error('No project for this incident.');
    const description = (draft.description ?? '').trim();
    if (!description) throw new Error('Tell me what happened first.');
    return {
      route: '/safety-incidents',
      projectId: ctx.projectId,
      params: {
        projectId: ctx.projectId,
        prefillDescription: description,
        prefillTreatment: draft.treatment ?? 'first_aid',
        prefillType: draft.incidentType ?? 'injury',
        prefillLocation: draft.location ?? '',
      },
    };
  },
};
