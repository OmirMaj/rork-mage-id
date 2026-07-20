// utils/copilot/jha/jhaGaps.ts — Job Hazard Analysis interview gap rules.
//
// The utterance is the TASK ("we're setting steel on the third floor today").
// MAGE writes the analysis; the only thing the interview needs that the task
// doesn't always make obvious is the TRADE performing it (drives the hazard
// library + PPE the model reasons from). Pure — no mageAI/RN imports.
import type { Gap, Grounding } from '../types';

export interface JHADraft {
  taskDescription?: string | null;
  trade?: string | null;
  title?: string | null;
}

const TRADE_CHOICES: { label: string; value: string }[] = [
  { label: 'Carpentry / framing', value: 'Carpentry' },
  { label: 'Steel / structural', value: 'Structural steel' },
  { label: 'Concrete', value: 'Concrete' },
  { label: 'Electrical', value: 'Electrical' },
  { label: 'Plumbing / mechanical', value: 'Plumbing' },
  { label: 'Roofing', value: 'Roofing' },
  { label: 'Excavation / earthwork', value: 'Excavation' },
  { label: 'General labor', value: 'General' },
];

export function jhaGaps(draft: JHADraft, _grounding: Grounding): Gap[] {
  if (draft.trade != null) return [];
  return [{
    field: 'trade', impact: 0.5, kind: 'choice',
    question: 'Which trade is doing this work?',
    groundedDefault: { value: 'General', basis: 'general labor hazards' },
    choices: TRADE_CHOICES,
  }];
}
