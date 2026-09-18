// scripts/validate-copilot-gaps-warranty.ts — pure-fn validator for the
// Warranty gap rules + the category→term default (the record is worthless
// without a term, so the interview must always secure one).
import { warrantyGaps, defaultDurationForCategory, groundedWarrantyTerm } from '../utils/copilot/warranty/warrantyGaps';
import { warrantyCapability } from '../utils/copilot/warranty/warrantyCapability';
import { buildWarrantyGrounding } from '../utils/copilot/warranty/warrantyGrounding';
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

// --- his saved workmanship warranty grounds the general term (voice path) ---
// A GC whose saved warranty is 24 months got a 12-month workmanship record
// from the voice flow while the warranties screen seeded 24.
{
  const g24: Grounding = { facts: [], data: { savedWarrantyMonths: 24 } };
  const q = warrantyGaps({ category: 'general' }, g24).find((x) => x.field === 'durationMonths');
  ok('general term defaults to HIS saved 24 months', q?.groundedDefault.value === 24);
  ok('…says where the number came from', q?.groundedDefault.basis === 'your saved workmanship warranty');
  ok('…and recommends that choice', !!q?.choices?.some((c) => c.value === 24 && c.recommended));
  const qNone = warrantyGaps({}, g24).find((x) => x.field === 'durationMonths');
  ok('an unstated category (workmanship) uses it too', qNone?.groundedDefault.value === 24);
  const roof = warrantyGaps({ category: 'roofing' }, g24).find((x) => x.field === 'durationMonths');
  ok('a roof keeps its manufacturer term, not his workmanship term', roof?.groundedDefault.value === 300);
  ok('no saved warranty → typical 12', groundedWarrantyTerm('general', null).months === 12);
}
await (async () => {
  const grounding = await buildWarrantyGrounding({ project: null, projectId: 'p1', tier: 'pro', ctx: { settings: { warrantyMonths: 24 } } });
  ok('grounding carries the saved term from settings', grounding.data.savedWarrantyMonths === 24);
  const added: { durationMonths?: number }[] = [];
  await warrantyCapability.apply({ title: 'Kitchen remodel', category: 'general', provider: 'Us' },
    { project: { name: 'Henderson' } as never, projectId: 'p1', tier: 'pro', ctx: { settings: { warrantyMonths: 24 }, addWarranty: (w: { durationMonths?: number }) => { added.push(w); } } });
  ok('apply() files a general warranty with HIS 24 months when the term went unanswered', added[0]?.durationMonths === 24);
})();

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
