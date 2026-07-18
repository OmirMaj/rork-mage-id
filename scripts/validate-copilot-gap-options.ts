// scripts/validate-copilot-gap-options.ts — pure-fn validator for optionsForGap.
// Guards the "no numeric field ever gets a boolean Yes/No answer" invariant:
// a `number` gap must offer real numbers, a choice gap its own choices, and
// only a genuine yes/no gap falls back to Yes/No.
import { optionsForGap } from '../utils/copilot/gapOptions';
import type { Gap } from '../utils/copilot/types';

let pass = 0, fail = 0;
function ok(n: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, extra ?? ''); }
}
const gap = (over: Partial<Gap>): Gap => ({
  field: 'f', impact: 0.5, question: 'q', groundedDefault: { value: null, basis: 'b' }, kind: 'choice', ...over,
});

// number gap → numeric ladder centered on the grounded default, no booleans
{
  const opts = optionsForGap(gap({ kind: 'number', groundedDefault: { value: 3, basis: 'assume 3' } }));
  ok('number gap yields numbers', opts.every(o => typeof o.value === 'number'), JSON.stringify(opts));
  ok('number ladder centered on default', opts.map(o => o.value).join(',') === '2,3,4,5');
  ok('default is the recommended one', opts.find(o => o.recommended)?.value === 3);
  ok('recommended carries the basis', opts.find(o => o.recommended)?.basis === 'assume 3');
  ok('no boolean options leak in', !opts.some(o => typeof o.value === 'boolean'));
}
// number gap with default 1 → ladder never drops below 1
{
  const opts = optionsForGap(gap({ kind: 'number', groundedDefault: { value: 1, basis: 'b' } }));
  ok('ladder clamps at 1', opts.map(o => o.value).join(',') === '1,2,3');
}
// number gap with a missing/invalid default → falls back to 3-centered ladder
{
  const opts = optionsForGap(gap({ kind: 'number', groundedDefault: { value: null, basis: 'b' } }));
  ok('invalid default → 2,3,4,5', opts.map(o => o.value).join(',') === '2,3,4,5');
}
// explicit choices always win
{
  const choices = [{ label: 'A', value: 'a', recommended: true }, { label: 'B', value: 'b' }];
  const opts = optionsForGap(gap({ kind: 'choice', choices }));
  ok('explicit choices are returned as-is', opts === choices);
}
// a genuine boolean/other gap without choices → Yes/No
{
  const opts = optionsForGap(gap({ kind: 'enum', choices: undefined }));
  ok('no choices, non-number → Yes/No', opts.length === 2 && opts[0].value === true && opts[1].value === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
