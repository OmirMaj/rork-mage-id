// utils/copilot/safety/safetyGaps.ts — safety-incident interview gap rules.
// The one question that matters: treatment level, which decides OSHA
// recordability. Everything else comes from the dictation.
import type { Gap, Grounding } from '../types';
import type { SafetyTreatment, SafetyIncidentType } from '@/types';

export interface SafetyDraft {
  description?: string | null;
  incidentType?: SafetyIncidentType | null;
  location?: string | null;
  treatment?: SafetyTreatment | null;
}

export function safetyGaps(draft: SafetyDraft, _grounding: Grounding): Gap[] {
  const gaps: Gap[] = [];
  if (draft.treatment == null) {
    gaps.push({
      field: 'treatment', impact: 0.85, kind: 'choice',
      question: 'Did it need more than first aid? That decides if it’s OSHA-recordable.',
      groundedDefault: { value: 'first_aid', basis: 'first aid only is not recordable' },
      choices: [
        { label: 'First aid only', value: 'first_aid', recommended: true, basis: 'not OSHA-recordable' },
        { label: 'Needed a doctor / ER', value: 'medical_beyond_first_aid', basis: 'OSHA-recordable' },
        { label: 'No treatment needed', value: 'none' },
      ],
    });
  }
  return gaps;
}
