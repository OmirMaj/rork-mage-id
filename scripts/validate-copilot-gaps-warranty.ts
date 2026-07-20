// scripts/validate-copilot-gaps-warranty.ts — pure-fn validator for the
// Warranty gap rules + the category→term default (the record is worthless
// without a term, so the interview must always secure one).
import { warrantyGaps, defaultDurationForCategory } from '../utils/copilot/warranty/warrantyGaps';
import type { Grounding } from '../utils/copilot/types';

let pass = 0, fail = 0;
function has(n: string, fields: string[], field: string, want: boolean) {
  const ok = fields.includes(field) === want;
  if (ok) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, `(fields: ${fields.join(',')})`); }
}
function ok(n: string, cond: boolean) { if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } }
const G: Grounding = { facts: [], data: {} };

// --- gaps fire only for what's missing ---
{
  const g = warrantyGaps({}, G).map((x) => x.field);
  has('asks the term when unstated', g, 'durationMonths', true);
  has('asks the provider when unstated', g, 'provider', true);
  has('asks the category when unstated', g, 'category', true);
}
has('term not re-asked once set', warrantyGaps({ durationMonths: 120 }, G).map((x) => x.field), 'durationMonths', false);
has('provider not re-asked once set', warrantyGaps({ provider: 'GAF' }, G).map((x) => x.field), 'provider', false);
has('category not re-asked once set', warrantyGaps({ category: 'roofing' }, G).map((x) => x.field), 'category', false);
ok('a fully-stated warranty asks nothing',
  warrantyGaps({ durationMonths: 300, provider: 'GAF', category: 'roofing' }, G).length === 0);

// --- the term is a choice, grounded in the category ---
{
  const q = warrantyGaps({ category: 'roofing' }, G).find((x) => x.field === 'durationMonths');
  ok('term is a choice', q?.kind === 'choice');
  ok('roofing default is 25 years (300 mo)', q?.groundedDefault.value === 300);
  ok('roofing recommends the 300-mo option', !!q?.choices?.some((c) => c.value === 300 && c.recommended));
}
{
  const q = warrantyGaps({ category: 'appliances' }, G).find((x) => x.field === 'durationMonths');
  ok('appliance default is 1 year (12 mo)', q?.groundedDefault.value === 12);
}

// --- category→term map ---
ok('roofing → 300', defaultDurationForCategory('roofing') === 300);
ok('hvac → 60', defaultDurationForCategory('hvac') === 60);
ok('appliances → 12', defaultDurationForCategory('appliances') === 12);
ok('unknown/general → 12', defaultDurationForCategory('general') === 12 && defaultDurationForCategory(null) === 12);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
