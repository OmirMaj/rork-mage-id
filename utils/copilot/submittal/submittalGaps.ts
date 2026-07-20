// utils/copilot/submittal/submittalGaps.ts — submittal interview gap rules.
// The utterance is the submitted item; the interview confirms the spec division
// and how soon it's needed, only when not already stated.
import type { Gap, Grounding } from '../types';

export interface SubmittalDraft {
  title?: string | null;
  specSection?: string | null;
  urgent?: boolean | null;
}

const SECTION_CHOICES = [
  { label: 'Finishes (Div 09)', value: '09', recommended: true },
  { label: 'Metals (Div 05)', value: '05' },
  { label: 'Concrete (Div 03)', value: '03' },
  { label: 'Mechanical (Div 23)', value: '23' },
  { label: 'Electrical (Div 26)', value: '26' },
];

export function submittalGaps(draft: SubmittalDraft, _grounding: Grounding): Gap[] {
  const gaps: Gap[] = [];

  if (draft.specSection == null) {
    gaps.push({
      field: 'specSection', impact: 0.55, kind: 'choice',
      question: 'Which spec division does this fall under?',
      groundedDefault: { value: '09', basis: 'most submittals are finishes' },
      choices: SECTION_CHOICES,
    });
  }

  if (draft.urgent == null) {
    gaps.push({
      field: 'urgent', impact: 0.45, kind: 'choice',
      question: 'How soon do you need it approved?',
      groundedDefault: { value: false, basis: 'standard two-week review' },
      choices: [
        { label: 'Standard — about two weeks', value: false, recommended: true },
        { label: 'Urgent — one week', value: true },
      ],
    });
  }

  return gaps;
}
