import { computeBulkSavings } from '@/utils/bulkSavings';
import type { BidPackage, Commitment } from '@/types';

let failures = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failures++; console.error(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${name}`);
}

const ASOF = '2026-08-04T00:00:00.000Z';
const pkg = (o: Partial<BidPackage>): BidPackage => ({
  id: 'p1', projectId: 'proj1', name: 'Framing', linkedEstimateItemIds: [],
  estimateBudget: 10000, status: 'awarded', createdAt: ASOF, updatedAt: ASOF, ...o,
} as BidPackage);
const com = (o: Partial<Commitment>): Commitment => ({
  id: 'c1', projectId: 'proj1', number: 'BO-1', type: 'subcontract', description: 'Framing',
  amount: 8500, signedDate: ASOF, status: 'active', createdAt: ASOF, updatedAt: ASOF, ...o,
} as Commitment);

eq('empty.hasRealData', computeBulkSavings('proj1', [], [], ASOF).hasRealData, false);
eq('empty.bulkSavings', computeBulkSavings('proj1', [], [], ASOF).bulkSavings, 0);
{
  const r = computeBulkSavings('proj1', [pkg({ awardedCommitmentId: 'c1' })], [com({})], ASOF);
  eq('one.savings', r.bulkSavings, 1500);
  eq('one.count', r.awardedPackageCount, 1);
  eq('one.hasRealData', r.hasRealData, true);
  eq('one.source', r.source, 'measured_from_buyout');
}
{
  const r = computeBulkSavings('proj1',
    [pkg({ id: 'p1', awardedCommitmentId: 'c1' }),
     pkg({ id: 'p2', name: 'Roofing', estimateBudget: 5000, awardedCommitmentId: 'c2' })],
    [com({ id: 'c1', amount: 8500 }), com({ id: 'c2', amount: 5500 })], ASOF);
  eq('overrun.net', r.bulkSavings, 1000);
  eq('overrun.count', r.awardedPackageCount, 2);
}
{
  const r = computeBulkSavings('proj1', [pkg({ awardedCommitmentId: undefined })], [], ASOF);
  eq('uncommitted.hasRealData', r.hasRealData, false);
  eq('uncommitted.savings', r.bulkSavings, 0);
}
{
  const r = computeBulkSavings('proj1', [pkg({ awardedCommitmentId: 'c1' })], [com({ changeAmount: 1000 })], ASOF);
  eq('changeAmount.savings', r.bulkSavings, 500);
}
{
  const r = computeBulkSavings('proj1', [pkg({ status: 'open', awardedCommitmentId: 'c1' })], [com({})], ASOF);
  eq('open.hasRealData', r.hasRealData, false);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
if (failures) process.exit(1);
