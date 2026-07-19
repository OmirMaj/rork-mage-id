// scripts/validate-copilot-gaps-estimate.ts — pure-fn validator for estimateGaps.
// The interview asks finish-level + size ONLY when neither the draft nor the
// project supplies them; a fully-grounded project generates with no questions.
import { estimateGaps } from '../utils/copilot/estimate/estimateGaps';
import type { Grounding } from '../utils/copilot/types';

let pass = 0, fail = 0;
function has(n: string, fields: string[], field: string, want: boolean) {
  const ok = fields.includes(field) === want;
  if (ok) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, `(fields: ${fields.join(',')})`); }
}
function ok(n: string, cond: boolean) { if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } }
const ground = (data: any): Grounding => ({ facts: [], data });

{
  const g = estimateGaps({}, ground({})).map(x => x.field);
  has('quality asked when unknown', g, 'quality', true);
  has('size asked when unknown', g, 'sizeSqft', true);
  has('markup gap present when no default', g, 'markupPct', true);
}
{
  has('quality resolved from project', estimateGaps({}, ground({ projectQuality: 'premium' })).map(x => x.field), 'quality', false);
}
{
  has('size resolved from project', estimateGaps({}, ground({ projectSqft: 3200 })).map(x => x.field), 'sizeSqft', false);
}
{
  has('quality from draft not re-asked', estimateGaps({ quality: 'luxury' }, ground({})).map(x => x.field), 'quality', false);
}
{
  has('size from draft not re-asked', estimateGaps({ sizeSqft: 450 }, ground({})).map(x => x.field), 'sizeSqft', false);
}
{
  has('markup resolved from default', estimateGaps({}, ground({ defaultMarkupPct: 20 })).map(x => x.field), 'markupPct', false);
}
{
  const g = estimateGaps({}, ground({ projectQuality: 'standard', projectSqft: 1800, defaultMarkupPct: 18 }));
  ok('fully-grounded project asks nothing', g.length === 0);
}
{
  const q = estimateGaps({}, ground({})).find(x => x.field === 'quality');
  ok('quality gap offers the 4 finish tiers', q?.choices?.length === 4);
  ok('quality gap is a choice kind', q?.kind === 'choice');
  ok('size gap is a number kind', estimateGaps({}, ground({})).find(x => x.field === 'sizeSqft')?.kind === 'number');
  ok('markup impact is below the 0.4 ask threshold', (estimateGaps({}, ground({})).find(x => x.field === 'markupPct')?.impact ?? 1) < 0.4);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
