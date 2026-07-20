// utils/copilot/permit/permitGaps.ts — Permit interview gap rules.
//
// The utterance says which permit and its state ("pulled the electrical permit,
// expires in six months"). The interview fills the two fields the record needs
// that aren't always spoken: the permit TYPE (drives the inspection track) and
// the JURISDICTION that issued it (who the super coordinates with). Pure — no
// mageAI/RN imports.
import type { Gap, Grounding } from '../types';

export interface PermitDraft {
  type?: string | null;
  jurisdiction?: string | null;
  permitNumber?: string | null;
  status?: string | null;
  expiresDate?: string | null;
  /** Relative expiry ("in 6 months") — converted to expiresDate at apply. */
  expiresInMonths?: number | null;
  fee?: number | null;
}

const TYPE_CHOICES: { label: string; value: string }[] = [
  { label: 'Building', value: 'building' },
  { label: 'Electrical', value: 'electrical' },
  { label: 'Plumbing', value: 'plumbing' },
  { label: 'Mechanical', value: 'mechanical' },
  { label: 'Demolition', value: 'demolition' },
  { label: 'Grading', value: 'grading' },
  { label: 'Fire', value: 'fire' },
  { label: 'Occupancy', value: 'occupancy' },
];

export function permitGaps(draft: PermitDraft, _grounding: Grounding): Gap[] {
  const gaps: Gap[] = [];

  if (draft.type == null) {
    gaps.push({
      field: 'type', impact: 0.55, kind: 'choice',
      question: 'Which permit is it?',
      groundedDefault: { value: 'building', basis: 'the most common permit' },
      choices: TYPE_CHOICES,
    });
  }

  if (draft.jurisdiction == null) {
    gaps.push({
      field: 'jurisdiction', impact: 0.45, kind: 'text',
      question: 'Who issued it — which city or county?',
      groundedDefault: { value: '', basis: 'the authority having jurisdiction' },
    });
  }

  return gaps;
}
