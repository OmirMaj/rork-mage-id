// scripts/validate-copilot-gaps-co.ts — pure-fn validator for coGaps.
import { coGaps } from '../utils/copilot/changeOrder/coGaps';
import type { Grounding } from '../utils/copilot/types';

let pass = 0, fail = 0;
function has(n: string, fields: string[], field: string, want: boolean) {
  const ok = fields.includes(field) === want;
  if (ok) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, `(fields: ${fields.join(',')})`); }
}
function ok(n: string, cond: boolean) { if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } }
const G: Grounding = { facts: [], data: {} };

{
  const g = coGaps({}, G).map((x) => x.field);
  has('amount asked when unstated', g, 'changeAmount', true);
  has('schedule impact asked when unstated', g, 'scheduleImpactDays', true);
}
{
  has('amount not re-asked once stated', coGaps({ changeAmount: 4200 }, G).map((x) => x.field), 'changeAmount', false);
}
{
  has('schedule impact not re-asked once set', coGaps({ scheduleImpactDays: 3 }, G).map((x) => x.field), 'scheduleImpactDays', false);
}
{
  // amount 0 is a real answer (not null) → not re-asked.
  has('zero amount counts as answered', coGaps({ changeAmount: 0 }, G).map((x) => x.field), 'changeAmount', false);
  has('zero schedule impact counts as answered', coGaps({ scheduleImpactDays: 0 }, G).map((x) => x.field), 'scheduleImpactDays', false);
}
{
  const q = coGaps({}, G).find((x) => x.field === 'scheduleImpactDays');
  ok('schedule-impact is a choice with day options', q?.kind === 'choice' && (q?.choices?.length ?? 0) === 4);
  ok('amount is a number gap', coGaps({}, G).find((x) => x.field === 'changeAmount')?.kind === 'number');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
