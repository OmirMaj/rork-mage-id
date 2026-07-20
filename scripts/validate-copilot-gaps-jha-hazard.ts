// scripts/validate-copilot-gaps-jha-hazard.ts — pure-fn validator for the JHA +
// Hazard gap rules (the two safety-field adapters).
import { jhaGaps } from '../utils/copilot/jha/jhaGaps';
import { hazardGaps } from '../utils/copilot/hazard/hazardGaps';
import type { Grounding } from '../utils/copilot/types';

let pass = 0, fail = 0;
function has(n: string, fields: string[], field: string, want: boolean) {
  const ok = fields.includes(field) === want;
  if (ok) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, `(fields: ${fields.join(',')})`); }
}
function ok(n: string, cond: boolean) { if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } }
const G: Grounding = { facts: [], data: {} };

// --- JHA ---
has('jha asks trade when unstated', jhaGaps({}, G).map((x) => x.field), 'trade', true);
has('jha trade not re-asked once set', jhaGaps({ trade: 'Concrete' }, G).map((x) => x.field), 'trade', false);
{
  const q = jhaGaps({}, G).find((x) => x.field === 'trade');
  ok('jha trade is a choice of trades', q?.kind === 'choice' && (q?.choices?.length ?? 0) >= 6);
}

// --- Hazard ---
{
  const g = hazardGaps({}, G).map((x) => x.field);
  has('hazard asks severity when unstated', g, 'severity', true);
  has('hazard asks location when unstated', g, 'location', true);
}
has('hazard severity not re-asked once set', hazardGaps({ severity: 4 }, G).map((x) => x.field), 'severity', false);
has('hazard location not re-asked once set', hazardGaps({ location: 'Stair opening' }, G).map((x) => x.field), 'location', false);
ok('a fully-stated hazard asks nothing', hazardGaps({ severity: 5, location: 'Trench' }, G).length === 0);
{
  const q = hazardGaps({}, G).find((x) => x.field === 'severity');
  ok('hazard severity is a 1-5 choice', q?.kind === 'choice' && !!q?.choices?.every((c) => typeof c.value === 'number'));
  ok('hazard severity defaults to moderate (3)', q?.groundedDefault.value === 3);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
