// validate-co-advance.ts — pins utils/coAdvance.ts (advances on drafted COs).
// Run: bun run scripts/validate-co-advance.ts
import {
  buildAdvanceOffer, totalAdvanceAvailable, MIN_ADVANCE_CO, MAX_ADVANCE_RATE,
} from '../utils/coAdvance';
import type { AdvanceInput } from '../utils/coAdvance';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got: ', JSON.stringify(got), '\n      want:', JSON.stringify(want)); }
}
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

const base = (o: Partial<AdvanceInput> = {}): AdvanceInput => ({
  amount: 10000, ageDays: 5, isAuto: true, billedRate: 0.8, gradedCount: 8, ...o,
});

console.log('\nCO advance underwriting:');

// ── eligibility ──
expect('zero amount ineligible', buildAdvanceOffer(base({ amount: 0 })).tier, 'ineligible');
expect('below minimum ineligible', buildAdvanceOffer(base({ amount: MIN_ADVANCE_CO - 1 })).tier, 'ineligible');
expect('stale >120d ineligible', buildAdvanceOffer(base({ ageDays: 121 })).tier, 'ineligible');
expect('ineligible advances nothing', buildAdvanceOffer(base({ amount: 0 })).advanceAmount, 0);

// ── strong tier (proven billing history) ──
const strong = buildAdvanceOffer(base({ billedRate: 0.8, gradedCount: 8 }));
expect('strong tier at >=70% billed rate', strong.tier, 'strong');
expect('strong advances the max rate', strong.advanceRate, MAX_ADVANCE_RATE);
expect('strong: $10k → $8,000 advance, 2.5% fee = $200, net $7,800',
  [strong.advanceAmount, strong.feeAmount, strong.netToday], [8000, 200, 7800]);
ok('strong reason cites the real rate + sample', /80%/.test(strong.reason) && /8 scans/.test(strong.reason), strong.reason);

// ── moderate + thin ──
expect('moderate tier at 50% billed', buildAdvanceOffer(base({ billedRate: 0.5 })).tier, 'moderate');
expect('thin tier at 20% billed', buildAdvanceOffer(base({ billedRate: 0.2 })).tier, 'thin');
ok('worse history → smaller advance',
  buildAdvanceOffer(base({ billedRate: 0.2 })).advanceAmount < buildAdvanceOffer(base({ billedRate: 0.8 })).advanceAmount);
ok('worse history → higher fee rate',
  buildAdvanceOffer(base({ billedRate: 0.2 })).feeRate > buildAdvanceOffer(base({ billedRate: 0.8 })).feeRate);

// ── honesty gate: history below the gate is not trusted ──
const ungated = buildAdvanceOffer(base({ billedRate: 0.95, gradedCount: 2 }));
expect('great rate but too few graded scans → still conservative', ungated.tier, 'thin');
ok('ungated reason admits thin history', /Not enough billing history/.test(ungated.reason), ungated.reason);
expect('null billedRate → conservative base offer', buildAdvanceOffer(base({ billedRate: null, gradedCount: 0 })).tier, 'thin');

// ── staleness haircut ──
const fresh = buildAdvanceOffer(base({ ageDays: 5 }));
const stale = buildAdvanceOffer(base({ ageDays: 90 }));
ok('60–120d draft is trimmed vs fresh', stale.advanceRate < fresh.advanceRate, `${stale.advanceRate} vs ${fresh.advanceRate}`);
ok('stale reason explains the trim', /sitting a while/.test(stale.reason), stale.reason);
ok('advance rate never exceeds the cap', buildAdvanceOffer(base()).advanceRate <= MAX_ADVANCE_RATE);

// ── totals ──
expect('total across offers',
  totalAdvanceAvailable([buildAdvanceOffer(base({ amount: 10000 })), buildAdvanceOffer(base({ amount: 5000 }))]),
  8000 + 4000);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
