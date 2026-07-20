// utils/copilot/billing/billingGaps.ts — billing interview gap rules. Confirm
// what to draw (progress vs full); the bill-from-estimate screen owns the SOV +
// "already billed" math from there.
import type { Gap, Grounding } from '../types';

export interface BillingDraft {
  billingType?: 'progress' | 'full' | null;
}

export function billingGaps(draft: BillingDraft, _grounding: Grounding): Gap[] {
  const gaps: Gap[] = [];
  if (draft.billingType == null) {
    gaps.push({
      field: 'billingType', impact: 0.7, kind: 'choice',
      question: 'What are you billing — progress to date, or the full contract?',
      groundedDefault: { value: 'progress', basis: 'most draws are progress billing' },
      choices: [
        { label: 'Progress to date', value: 'progress', recommended: true, basis: 'bill what’s complete so far' },
        { label: 'Full contract', value: 'full' },
      ],
    });
  }
  return gaps;
}
