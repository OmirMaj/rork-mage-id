// validate-cost-truth.ts — pins utils/costTruth.ts (Cost Truth benchmark compare).
// Run: bun run scripts/validate-cost-truth.ts
import { compareToBenchmark, benchmarkLabel, BENCHMARK_FLOOR } from '../utils/costTruth';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got: ', JSON.stringify(got), '\n      want:', JSON.stringify(want)); }
}

console.log('\ncost truth:');

// below the floor → insufficient, no number leaked, needed counts up to floor
const insuff = compareToBenchmark(20, { median: null, p25: null, p75: null, n: 3 });
expect('insufficient below floor', [insuff.verdict, insuff.deltaPct, insuff.needed], ['insufficient', null, BENCHMARK_FLOOR - 3]);

// median present but n below floor is still insufficient (defensive)
expect('n below floor stays insufficient even with a median',
  compareToBenchmark(20, { median: 14, p25: 12, p75: 16, n: 4 }).verdict, 'insufficient');

const stats = { median: 14, p25: 12, p75: 16, n: 8 };
expect('in_range (within p25..p75)', compareToBenchmark(14, stats).verdict, 'in_range');
expect('above (> p75)', compareToBenchmark(20, stats).verdict, 'above');
expect('below (< p25)', compareToBenchmark(9, stats).verdict, 'below');
expect('deltaPct signed vs median (+43%)', Math.round((compareToBenchmark(20, stats).deltaPct ?? 0) * 100), 43);
expect('deltaPct negative when under (−36%)', Math.round((compareToBenchmark(9, stats).deltaPct ?? 0) * 100), -36);

// labels
expect('label: building', benchmarkLabel(compareToBenchmark(20, { median: null, p25: null, p75: null, n: 2 })), `Benchmark building · 2 of ${BENCHMARK_FLOOR}`);
expect('label: above median', benchmarkLabel(compareToBenchmark(20, stats)), '+43% vs regional median · 8 pros');
expect('label: on median', benchmarkLabel(compareToBenchmark(14, stats)), 'On the regional median · 8 pros');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
