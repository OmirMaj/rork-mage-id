// utils/copilot/gapOptions.ts — the tap-to-answer options for a gap.
//
// Choice gaps carry their own `choices`. `date` gaps are handled specially by
// the shell (a real date wheel). Everything else needs a sensible option set so
// the interview never falls back to a meaningless Yes/No that would answer a
// numeric field with a boolean. Pure so it can be unit-validated.
import type { Gap } from './types';

export interface GapOption {
  label: string;
  value: unknown;
  basis?: string;
  recommended?: boolean;
}

/** Options for any non-`date` gap. Explicit choices win; a `number` gap becomes
 *  a small ladder centered on its grounded default; anything else is Yes/No. */
export function optionsForGap(gap: Pick<Gap, 'kind' | 'choices' | 'groundedDefault'>): GapOption[] {
  if (gap.choices && gap.choices.length) return gap.choices;

  if (gap.kind === 'number') {
    const base = typeof gap.groundedDefault.value === 'number' && gap.groundedDefault.value > 0
      ? Math.round(gap.groundedDefault.value)
      : 3;
    const ladder = [base - 1, base, base + 1, base + 2]
      .filter((n, i, arr) => n >= 1 && arr.indexOf(n) === i);
    return ladder.map((n) => ({
      label: String(n),
      value: n,
      recommended: n === base,
      basis: n === base ? gap.groundedDefault.basis : undefined,
    }));
  }

  return [
    { label: 'Yes', value: true, recommended: true },
    { label: 'No', value: false },
  ];
}
