// utils/copilot/lead/leadGaps.ts — Lead-capture interview gap rules.
//
// The utterance is the homeowner inquiry; the interview secures the two things
// that make a lead actionable and measurable — WHO it is (so you can call them
// back — the first-response clock is the #1 sales lever) and WHERE it came from
// (attribution, so the GC learns which channels convert). Everything else the
// model lifts from what they said. Pure — no mageAI/RN imports.
import type { Gap, Grounding } from '../types';

export interface LeadDraft {
  name?: string | null;
  phone?: string | null;
  address?: string | null;
  projectType?: string | null;
  scope?: string | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  timeline?: string | null;
  /** LeadSource — kept loose (string) to stay pure here. */
  source?: string | null;
}

const SOURCE_CHOICES: { label: string; value: string }[] = [
  { label: 'Referral', value: 'referral' },
  { label: 'Repeat client', value: 'repeat' },
  { label: 'Website', value: 'website' },
  { label: 'Google', value: 'google' },
  { label: 'Houzz', value: 'houzz' },
  { label: 'Angi', value: 'angi' },
  { label: 'Walk-in / sign', value: 'walk_in' },
  { label: 'Other', value: 'other' },
];

export function leadGaps(draft: LeadDraft, _grounding: Grounding): Gap[] {
  const gaps: Gap[] = [];

  if (draft.name == null) {
    gaps.push({
      field: 'name', impact: 0.58, kind: 'text',
      question: 'Whose lead is it — the homeowner’s name?',
      groundedDefault: { value: '', basis: 'so you can call them back' },
    });
  }

  if (draft.source == null) {
    gaps.push({
      field: 'source', impact: 0.45, kind: 'choice',
      question: 'Where did they come from?',
      groundedDefault: { value: 'referral', basis: 'most jobs come by referral' },
      choices: SOURCE_CHOICES,
    });
  }

  return gaps;
}
