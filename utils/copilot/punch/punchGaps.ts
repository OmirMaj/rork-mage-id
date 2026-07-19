// utils/copilot/punch/punchGaps.ts — punch-list interview gap rules. The
// utterance is the defect + location; the interview asks which trade fixes it
// (and priority as a quiet default) only when not already stated.
import type { Gap, Grounding } from '../types';
import type { PunchItemPriority } from '@/types';

export interface PunchDraft {
  description?: string | null;
  location?: string | null;
  assignedSub?: string | null;
  priority?: PunchItemPriority | null;
}

const TRADE_CHOICES = [
  { label: 'Electrician', value: 'Electrician' },
  { label: 'Plumber', value: 'Plumber' },
  { label: 'Painter', value: 'Painter' },
  { label: 'Drywall', value: 'Drywall' },
  { label: 'GC crew', value: 'GC crew', recommended: true },
];

export function punchGaps(draft: PunchDraft, _grounding: Grounding): Gap[] {
  const gaps: Gap[] = [];

  if (draft.assignedSub == null) {
    gaps.push({
      field: 'assignedSub', impact: 0.55, kind: 'choice',
      question: 'Who should fix it — which trade?',
      groundedDefault: { value: 'GC crew', basis: 'default to your own crew' },
      choices: TRADE_CHOICES,
    });
  }

  // Priority is a quiet default (below the ask threshold) — shown, not asked.
  if (draft.priority == null) {
    gaps.push({
      field: 'priority', impact: 0.3, kind: 'choice',
      question: 'How urgent is it?',
      groundedDefault: { value: 'medium', basis: 'standard punch priority' },
      choices: [
        { label: 'Low', value: 'low' },
        { label: 'Medium', value: 'medium', recommended: true },
        { label: 'High', value: 'high' },
      ],
    });
  }

  return gaps;
}
