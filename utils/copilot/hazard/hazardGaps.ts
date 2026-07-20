// utils/copilot/hazard/hazardGaps.ts — Hazard-observation interview gap rules.
//
// The utterance is what you saw ("exposed rebar sticking up by the stair
// opening"). To turn an observation into a tracked, prioritizable hazard the
// interview needs two things the eye doesn't always state: HOW BAD it is
// (severity → drives the risk score everyone triages by) and WHERE it is (so
// the crew can find and fix it). Likelihood defaults silently. Pure — no
// mageAI/RN imports.
import type { Gap, Grounding } from '../types';

export interface HazardDraft {
  description?: string | null;
  location?: string | null;
  /** HazardScale 1..5 */
  severity?: number | null;
  likelihood?: number | null;
  correctiveAction?: string | null;
}

const SEVERITY_CHOICES = [
  { label: 'Minor — first-aid at worst', value: 2 },
  { label: 'Moderate — could injure', value: 3, recommended: true },
  { label: 'Serious — could hospitalize', value: 4 },
  { label: 'Severe — could kill', value: 5 },
];

export function hazardGaps(draft: HazardDraft, _grounding: Grounding): Gap[] {
  const gaps: Gap[] = [];

  if (draft.severity == null) {
    gaps.push({
      field: 'severity', impact: 0.5, kind: 'choice',
      question: 'How bad is it if someone’s exposed?',
      groundedDefault: { value: 3, basis: 'moderate — could injure' },
      choices: SEVERITY_CHOICES,
    });
  }

  if (draft.location == null) {
    gaps.push({
      field: 'location', impact: 0.45, kind: 'text',
      question: 'Where on site is it?',
      groundedDefault: { value: '', basis: 'so the crew can find it' },
    });
  }

  return gaps;
}
