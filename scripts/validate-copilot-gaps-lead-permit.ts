// scripts/validate-copilot-gaps-lead-permit.ts — pure-fn validator for the Lead
// + Permit gap rules.
import { leadGaps } from '../utils/copilot/lead/leadGaps';
import { permitGaps } from '../utils/copilot/permit/permitGaps';
import type { Grounding } from '../utils/copilot/types';

let pass = 0, fail = 0;
function has(n: string, fields: string[], field: string, want: boolean) {
  const ok = fields.includes(field) === want;
  if (ok) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, `(fields: ${fields.join(',')})`); }
}
function ok(n: string, cond: boolean) { if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } }
const G: Grounding = { facts: [], data: {} };

// --- Lead ---
{
  const g = leadGaps({}, G).map((x) => x.field);
  has('lead asks name when unstated', g, 'name', true);
  has('lead asks source when unstated', g, 'source', true);
}
has('lead name not re-asked once set', leadGaps({ name: 'Sarah Miller' }, G).map((x) => x.field), 'name', false);
has('lead source not re-asked once set', leadGaps({ source: 'houzz' }, G).map((x) => x.field), 'source', false);
ok('a named, sourced lead asks nothing', leadGaps({ name: 'X', source: 'referral' }, G).length === 0);
{
  const q = leadGaps({}, G).find((x) => x.field === 'source');
  ok('lead source is a choice', q?.kind === 'choice' && (q?.choices?.length ?? 0) >= 6);
}

// --- Permit ---
{
  const g = permitGaps({}, G).map((x) => x.field);
  has('permit asks type when unstated', g, 'type', true);
  has('permit asks jurisdiction when unstated', g, 'jurisdiction', true);
}
has('permit type not re-asked once set', permitGaps({ type: 'electrical' }, G).map((x) => x.field), 'type', false);
has('permit jurisdiction not re-asked once set', permitGaps({ jurisdiction: 'County' }, G).map((x) => x.field), 'jurisdiction', false);
ok('a typed, sourced permit asks nothing', permitGaps({ type: 'building', jurisdiction: 'City' }, G).length === 0);
{
  const q = permitGaps({}, G).find((x) => x.field === 'type');
  ok('permit type is a choice', q?.kind === 'choice' && (q?.choices?.length ?? 0) >= 6);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
