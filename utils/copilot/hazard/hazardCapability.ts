// utils/copilot/hazard/hazardCapability.ts — the Hazard-observation Copilot
// capability. See something unsafe, say it ("exposed rebar by the stair
// opening, someone could fall on it"), confirm how bad + where, and MAGE files
// a scored hazard — severity × likelihood → risk score the safety board triages
// by — then drops you on the hazard log. Adder-based via SafetyContext
// (ctx.safety); the fast field-safety loop that turns a walk-around into a
// tracked corrective action.
import type { CopilotCapability, CopilotContext, Gap, Grounding } from '../types';
import type { HazardScale } from '@/types';
import { hazardGaps, type HazardDraft } from './hazardGaps';
import { buildHazardGrounding } from './hazardGrounding';
import { computeRiskScore } from '@/utils/safety/risk';
import { createId } from '@/utils/scheduleEngine';

export interface HazardApplied { route: '/safety-hazards'; projectId: string; params: { projectId: string } }

/** Clamp any number to the 1..5 HazardScale. */
const asScale = (v: unknown, fallback: HazardScale): HazardScale => {
  const n = typeof v === 'number' ? Math.round(v) : NaN;
  if (n >= 1 && n <= 5) return n as HazardScale;
  return fallback;
};

export const hazardCapability: CopilotCapability<HazardDraft, HazardApplied> = {
  id: 'hazard',
  label: 'Flag a hazard',
  aiFeature: 'voiceCapture',
  maxQuestions: 2,
  askThreshold: 0.4,
  suggestions: [
    'Exposed rebar sticking up by the stair opening, someone could fall on it',
    'Extension cords running through standing water at the east entrance',
  ],
  topicChecklist: [
    { label: 'What', hint: 'the hazard you saw' },
    { label: 'Severity', hint: 'how bad if exposed' },
    { label: 'Where', hint: 'location on site' },
  ],
  copy: {
    voiceTitle: 'Flag a hazard',
    composeEyebrow: 'SOMETHING UNSAFE',
    composeQuestion: 'What did you spot?',
    composeHint: 'Describe the hazard — I’ll score it and log a corrective action.',
    reviewHeadline: 'Here’s your hazard, ready to log.',
    reviewSub: 'Review the risk, then save. It lands on the hazard board so it gets assigned and fixed.',
    buildingLabel: 'Scoring the hazard…',
    webRoute: '/safety-hazards',
  },
  buildGrounding: buildHazardGrounding,
  gaps: (draft: HazardDraft, grounding: Grounding): Gap[] => hazardGaps(draft, grounding),

  buildTurnPrompt: ({ transcript, draft, grounding, asking }) => ({
    prompt: [
      'You are MAGE Copilot logging a jobsite safety hazard for a contractor.',
      'Extract ONLY what they stated — a null field is how you ASK, never invent:',
      '• description: the hazard, in their words.',
      '• location: where on site, if given.',
      '• severity: 1-5 (how bad the harm IF someone is exposed) ONLY if they made',
      '  it clear (e.g. "could kill" → 5, "minor" → 2); else null.',
      '• likelihood: 1-5 (how likely exposure is) only if implied; else null.',
      '• correctiveAction: the fix, if they suggested one.',
      '',
      ...grounding.facts,
      '',
      'DRAFT SO FAR: ' + JSON.stringify(draft),
      asking ? `THEY ARE ANSWERING: "${asking.question}"` : '',
      'WHAT THEY SAID: ' + transcript,
      'Return ONLY the updated draft JSON.',
    ].filter(Boolean).join('\n'),
    schemaHint: { description: 'Exposed rebar by the stair opening', location: null, severity: null, likelihood: null, correctiveAction: null },
  }),

  mergeDraft: (draft, aiJson, meta): HazardDraft => ({
    description: (typeof aiJson?.description === 'string' && aiJson.description.trim() ? aiJson.description : draft.description) ?? meta?.transcript ?? null,
    location: typeof aiJson?.location === 'string' ? aiJson.location : draft.location ?? null,
    severity: typeof aiJson?.severity === 'number' ? aiJson.severity : draft.severity ?? null,
    likelihood: typeof aiJson?.likelihood === 'number' ? aiJson.likelihood : draft.likelihood ?? null,
    correctiveAction: typeof aiJson?.correctiveAction === 'string' ? aiJson.correctiveAction : draft.correctiveAction ?? null,
  }),

  apply: async (draft: HazardDraft, ctx: CopilotContext): Promise<HazardApplied> => {
    if (!ctx.project) throw new Error('No project for this hazard.');
    const description = (draft.description ?? '').trim();
    if (!description) throw new Error('Tell me what the hazard is first.');

    const severity = asScale(draft.severity, 3);
    const likelihood = asScale(draft.likelihood, 3);
    const now = new Date().toISOString();

    ctx.safety?.addHazard?.({
      id: createId('haz'),
      projectId: ctx.projectId,
      description: description.slice(0, 240),
      location: (draft.location ?? '').trim() || 'On site',
      severity,
      likelihood,
      riskScore: computeRiskScore(severity, likelihood),
      status: 'open',
      ...(draft.correctiveAction ? { correctiveAction: draft.correctiveAction.trim() } : {}),
      createdBy: '',
      createdAt: now,
      updatedAt: now,
    });
    return { route: '/safety-hazards', projectId: ctx.projectId, params: { projectId: ctx.projectId } };
  },
};
