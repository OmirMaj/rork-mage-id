// utils/copilot/rfi/rfiGaps.ts — RFI interview gap rules. The utterance is the
// question; the interview asks who answers it and how urgent, only when the
// contractor didn't already say.
import type { Gap, Grounding } from '../types';

export interface RFIDraft {
  subject?: string | null;
  question?: string | null;
  assignedTo?: string | null;
  urgent?: boolean | null;
}

const ASSIGNEE_CHOICES = [
  { label: 'Architect', value: 'Architect', recommended: true },
  { label: 'Structural Engineer', value: 'Structural Engineer' },
  { label: 'MEP Engineer', value: 'MEP Engineer' },
  { label: 'Owner', value: 'Owner' },
];

export function rfiGaps(draft: RFIDraft, _grounding: Grounding): Gap[] {
  const gaps: Gap[] = [];

  if (draft.assignedTo == null) {
    gaps.push({
      field: 'assignedTo', impact: 0.6, kind: 'choice',
      question: 'Who should answer this — who do you send it to?',
      groundedDefault: { value: 'Architect', basis: 'most RFIs go to the architect' },
      choices: ASSIGNEE_CHOICES,
    });
  }

  if (draft.urgent == null) {
    gaps.push({
      field: 'urgent', impact: 0.45, kind: 'choice',
      question: 'How soon do you need an answer?',
      groundedDefault: { value: false, basis: 'standard turnaround' },
      choices: [
        { label: 'Standard — about a week', value: false, recommended: true },
        { label: 'Urgent — 2-3 days', value: true },
      ],
    });
  }

  return gaps;
}
