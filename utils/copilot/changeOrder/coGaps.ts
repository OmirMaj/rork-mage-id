// utils/copilot/changeOrder/coGaps.ts — change-order interview gap rules.
// Capture the change on-site: confirm the amount (if not stated) and the days
// it adds to the schedule. Both hand off to the change-order screen pre-filled.
import type { Gap, Grounding } from '../types';

export interface CODraft {
  /** What changed — the description (from the utterance). */
  description?: string | null;
  /** Why — client request / field condition / etc. */
  reason?: string | null;
  /** Added cost. */
  changeAmount?: number | null;
  /** Days added to the schedule. */
  scheduleImpactDays?: number | null;
}

export function coGaps(draft: CODraft, _grounding: Grounding): Gap[] {
  const gaps: Gap[] = [];

  // Amount — the CO's whole point. Ask only if the contractor didn't state a price.
  if (draft.changeAmount == null) {
    gaps.push({
      field: 'changeAmount', impact: 0.75, kind: 'number',
      question: 'What’s the change worth — the added cost?',
      groundedDefault: { value: 0, basis: 'no amount stated yet' },
    });
  }

  // Schedule impact — the differentiator. Confirm days added to the timeline.
  if (draft.scheduleImpactDays == null) {
    gaps.push({
      field: 'scheduleImpactDays', impact: 0.5, kind: 'choice',
      question: 'How many days does this add to the schedule?',
      groundedDefault: { value: 0, basis: 'assume no schedule impact' },
      choices: [
        { label: 'None', value: 0, recommended: true },
        { label: '1 day', value: 1 },
        { label: '3 days', value: 3 },
        { label: '5 days', value: 5 },
      ],
    });
  }

  return gaps;
}
