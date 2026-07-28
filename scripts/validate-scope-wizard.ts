// validate-scope-wizard.ts — the Quick Estimate wizard can never dead-end again.
// Pins the lenient input parsing, per-step advance rules, the block-reason
// feedback contract, and the learned-cost grounding in the prompt.
// Run via: bun run scripts/validate-scope-wizard.ts
import { firstNumber, stepCanAdvance, stepBlockReason, buildEstimatePrompt } from '../utils/scopeQuestions';
import type { WizardAnswers } from '../utils/scopeQuestions';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got:  ', JSON.stringify(got), '\n      want: ', JSON.stringify(want)); }
}

const base: WizardAnswers = {
  projectType: 'renovation', sizeSqft: '2500', location: 'Houston, TX',
  quality: 'standard', scope: 'gut and remodel the primary bath',
  timelineWeeks: '6', specialRequirements: '', targetBudget: '',
};

console.log('\nscope wizard — firstNumber (lenient parsing):');
expect('plain number', firstNumber('2500'), 2500);
expect('comma thousands', firstNumber('2,500'), 2500);
expect('trailing unit text', firstNumber('1500 sqft'), 1500);
expect('range takes the first number', firstNumber('6-8'), 6);
expect('number with words', firstNumber('about 6 weeks'), 6);
expect('decimal', firstNumber('2.5'), 2.5);
expect('no number → null', firstNumber('abc'), null);
expect('empty → null', firstNumber(''), null);
expect('zero → null (not a real size)', firstNumber('0'), null);

console.log('\nscope wizard — stepCanAdvance:');
expect('comma size advances', stepCanAdvance(1, { ...base, sizeSqft: '2,500' }), true);
expect('size with unit advances', stepCanAdvance(1, { ...base, sizeSqft: '1500 sqft' }), true);
expect('non-numeric size blocks', stepCanAdvance(1, { ...base, sizeSqft: 'big' }), false);
expect('short scope "roof" advances (4 chars)', stepCanAdvance(4, { ...base, scope: 'roof' }), true);
expect('scope "abc" blocks', stepCanAdvance(4, { ...base, scope: 'abc' }), false);
expect('timeline range advances', stepCanAdvance(5, { ...base, timelineWeeks: '6-8 weeks' }), true);
// Timeline is OPTIONAL — never blocks Next (even empty or text-only).
expect('timeline optional — text advances', stepCanAdvance(5, { ...base, timelineWeeks: 'soon' }), true);
expect('timeline optional — empty advances', stepCanAdvance(5, { ...base, timelineWeeks: '' }), true);

console.log('\nscope wizard — stepBlockReason (never a silent dead end):');
expect('advancing step → null reason', stepBlockReason(1, base), null);
expect('blocked size names the fix', (stepBlockReason(1, { ...base, sizeSqft: 'big' }) ?? '').includes('number'), true);
expect('blocked scope names the fix', (stepBlockReason(4, { ...base, scope: 'ab' }) ?? '').length > 0, true);
expect('optional timeline never blocks', stepBlockReason(5, { ...base, timelineWeeks: '' }), null);

console.log('\nscope wizard — grounded prompt:');
const facts = ['Framing runs $12.00/sf on your jobs (high confidence, 5 jobs)'];
const grounded = buildEstimatePrompt(base, facts);
expect('grounding facts embedded', grounded.includes('$12.00/sf'), true);
expect('grounding header present', grounded.includes("COST HISTORY"), true);
const ungrounded = buildEstimatePrompt(base);
expect('no facts → no grounding header', ungrounded.includes('COST HISTORY'), false);
expect('backward compatible (base prompt intact)', ungrounded.includes('construction cost estimator'), true);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
