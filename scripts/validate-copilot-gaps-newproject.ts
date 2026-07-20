// scripts/validate-copilot-gaps-newproject.ts — pure-fn validator for the New
// Project gap rules: ask type + finish only when unstated, and ground the
// defaults in what the contractor usually builds (modal type/quality).
import { newProjectGaps } from '../utils/copilot/newProject/newProjectGaps';
import type { Grounding } from '../utils/copilot/types';

let pass = 0, fail = 0;
function has(n: string, fields: string[], field: string, want: boolean) {
  const ok = fields.includes(field) === want;
  if (ok) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, `(fields: ${fields.join(',')})`); }
}
function ok(n: string, cond: boolean) { if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } }

const empty: Grounding = { facts: [], data: {} };

// --- asks only what's missing ---
{
  const g = newProjectGaps({}, empty).map((x) => x.field);
  has('asks type when unstated', g, 'type', true);
  has('asks finish quality when unstated', g, 'quality', true);
}
has('type not re-asked once set', newProjectGaps({ type: 'addition' }, empty).map((x) => x.field), 'type', false);
has('quality not re-asked once set', newProjectGaps({ quality: 'premium' }, empty).map((x) => x.field), 'quality', false);
ok('a fully-specified job asks nothing', newProjectGaps({ type: 'remodel', quality: 'standard' }, empty).length === 0);

// --- defaults fall back sanely with no history ---
{
  const typeGap = newProjectGaps({}, empty).find((x) => x.field === 'type');
  ok('type default is renovation with no history', typeGap?.groundedDefault.value === 'renovation');
  ok('type is a choice', typeGap?.kind === 'choice');
  const qGap = newProjectGaps({}, empty).find((x) => x.field === 'quality');
  ok('quality default is standard with no history', qGap?.groundedDefault.value === 'standard');
}

// --- defaults + recommendation track the contractor's usual work ---
{
  const g: Grounding = { facts: [], data: { usualType: 'roofing', usualQuality: 'premium' } };
  const typeGap = newProjectGaps({}, g).find((x) => x.field === 'type');
  ok('type default is the usual type', typeGap?.groundedDefault.value === 'roofing');
  ok('the usual type is the recommended choice', !!typeGap?.choices?.find((c) => c.value === 'roofing')?.recommended);
  const qGap = newProjectGaps({}, g).find((x) => x.field === 'quality');
  ok('quality default is the usual finish', qGap?.groundedDefault.value === 'premium');
  ok('the usual finish is the recommended choice', !!qGap?.choices?.find((c) => c.value === 'premium')?.recommended);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
