import { estimateGroundingProps } from '@/utils/activationSignals';
import type { CostDatabase } from '@/utils/costDatabase';

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, `\n      got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
}
const db = (entries: { provenance: string }[], jobsAnalyzed: number): CostDatabase =>
  ({ entries, jobsAnalyzed } as unknown as CostDatabase);

console.log('\nactivation signals (aha grounding props):');
eq('empty', estimateGroundingProps(db([], 0)),
  { used_learned_costs: false, learned_rate_count: 0, jobs_analyzed: 0 });
eq('seeded-only', estimateGroundingProps(db([{ provenance: 'seeded' }, { provenance: 'seeded' }], 0)),
  { used_learned_costs: true, learned_rate_count: 0, jobs_analyzed: 0 });
eq('mixed-and-earned', estimateGroundingProps(db([{ provenance: 'earned' }, { provenance: 'mixed' }, { provenance: 'seeded' }], 3)),
  { used_learned_costs: true, learned_rate_count: 2, jobs_analyzed: 3 });
eq('all-earned', estimateGroundingProps(db([{ provenance: 'earned' }, { provenance: 'earned' }], 5)),
  { used_learned_costs: true, learned_rate_count: 2, jobs_analyzed: 5 });
// A legacy entry with no provenance predates the seeded-rate feature, so it is
// earned data — it MUST count toward learned_rate_count (undefined !== 'seeded').
eq('undefined-provenance-counts-as-learned',
  estimateGroundingProps(db([{ provenance: undefined as unknown as string }], 1)),
  { used_learned_costs: true, learned_rate_count: 1, jobs_analyzed: 1 });

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
