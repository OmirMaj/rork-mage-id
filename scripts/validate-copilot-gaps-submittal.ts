// scripts/validate-copilot-gaps-submittal.ts — pure-fn validator for submittalGaps.
import { submittalGaps } from '../utils/copilot/submittal/submittalGaps';
import type { Grounding } from '../utils/copilot/types';

let pass = 0, fail = 0;
function has(n: string, fields: string[], field: string, want: boolean) {
  const ok = fields.includes(field) === want;
  if (ok) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, `(fields: ${fields.join(',')})`); }
}
function ok(n: string, cond: boolean) { if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } }
const G: Grounding = { facts: [], data: {} };

{
  const g = submittalGaps({}, G).map((x) => x.field);
  has('spec section asked when unstated', g, 'specSection', true);
  has('urgency asked when unstated', g, 'urgent', true);
}
has('spec section not re-asked once set', submittalGaps({ specSection: '05' }, G).map((x) => x.field), 'specSection', false);
has('urgency not re-asked once set', submittalGaps({ urgent: true }, G).map((x) => x.field), 'urgent', false);
{
  const q = submittalGaps({}, G).find((x) => x.field === 'specSection');
  ok('spec section is a choice with divisions', q?.kind === 'choice' && (q?.choices?.length ?? 0) === 5);
  ok('finishes is the recommended default', q?.choices?.find((c) => c.recommended)?.value === '09');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
