// scripts/validate-copilot-gaps-safety.ts — pure-fn validator for safetyGaps.
// The interview asks exactly one thing — treatment level (OSHA recordability).
import { safetyGaps } from '../utils/copilot/safety/safetyGaps';
import type { Grounding } from '../utils/copilot/types';

let pass = 0, fail = 0;
function has(n: string, fields: string[], field: string, want: boolean) {
  const ok = fields.includes(field) === want;
  if (ok) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, `(fields: ${fields.join(',')})`); }
}
function ok(n: string, cond: boolean) { if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } }
const G: Grounding = { facts: [], data: {} };

has('treatment asked when unstated', safetyGaps({}, G).map((x) => x.field), 'treatment', true);
has('treatment not re-asked once set', safetyGaps({ treatment: 'first_aid' }, G).map((x) => x.field), 'treatment', false);
has('no-treatment counts as answered', safetyGaps({ treatment: 'none' }, G).map((x) => x.field), 'treatment', false);
{
  const q = safetyGaps({}, G).find((x) => x.field === 'treatment');
  ok('treatment is a choice with 3 options', q?.kind === 'choice' && q?.choices?.length === 3);
  ok('medical-beyond-first-aid is an option (OSHA recordable)', !!q?.choices?.some((c) => c.value === 'medical_beyond_first_aid'));
  ok('first aid is the recommended default', q?.choices?.find((c) => c.recommended)?.value === 'first_aid');
  ok('only one question — treatment', safetyGaps({}, G).length === 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
