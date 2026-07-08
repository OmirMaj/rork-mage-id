// validate-safety-risk.ts — unit tests for utils/safety/risk.ts.
// Run via: bun run scripts/validate-safety-risk.ts
//
// Bun executes TypeScript natively — import and exercise the pure fns
// directly. risk.ts has no React Native dependencies.

import { computeRiskScore, riskBand } from '../utils/safety/risk';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else    { fail++; console.log('  ✗', name, '\n      got:  ', got, '\n      want: ', want); }
}

console.log('\nsafety risk validation:');

// computeRiskScore — severity × likelihood on the 1..5 matrix
expect('1 × 1 = 1', computeRiskScore(1, 1), 1);
expect('3 × 3 = 9', computeRiskScore(3, 3), 9);
expect('5 × 5 = 25', computeRiskScore(5, 5), 25);
expect('4 × 2 = 8', computeRiskScore(4, 2), 8);

// Out-of-range + non-integer inputs clamp to 1..5 (defensive — never NaN)
expect('0 clamps up to 1 → 1 × 3 = 3', computeRiskScore(0, 3), 3);
expect('9 clamps down to 5 → 5 × 5 = 25', computeRiskScore(9, 9), 25);
expect('2.6 rounds to 3 → 3 × 2 = 6', computeRiskScore(2.6, 2), 6);
expect('NaN severity → treated as 1 → 1 × 4 = 4', computeRiskScore(NaN, 4), 4);

// riskBand — 5×5 matrix bands: 1-4 low, 5-9 medium, 10-15 high, 16-25 critical
expect('score 1 → low', riskBand(1), 'low');
expect('score 4 → low', riskBand(4), 'low');
expect('score 5 → medium', riskBand(5), 'medium');
expect('score 9 → medium', riskBand(9), 'medium');
expect('score 10 → high', riskBand(10), 'high');
expect('score 15 → high', riskBand(15), 'high');
expect('score 16 → critical', riskBand(16), 'critical');
expect('score 25 → critical', riskBand(25), 'critical');

// Composed: score then band
expect('5×5 → critical', riskBand(computeRiskScore(5, 5)), 'critical');
expect('1×2 → low', riskBand(computeRiskScore(1, 2)), 'low');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
