// scripts/validate-bulk-savings.ts — permanent validator for utils/bulkSavings.ts.
//
// Guards the core invariants of computeBulkSavings:
//   • Empty input → hasRealData:false, bulkSavings:0
//   • Awarded + committed package → correct delta, count, and source
//   • Overrun packages included honestly (negative line, net reduced)
//   • Awarded-but-uncommitted (no matching commitment) → excluded
//   • changeAmount erodes the saving
//   • Non-'awarded' status ('open') → excluded
//   • Cross-project commitment → excluded
import { computeBulkSavings } from '../utils/bulkSavings';
import { packageBuyoutSavings } from '../utils/projectFinancials';
import type { BidPackage, BidPackageBid, Commitment } from '../types';

let pass = 0, fail = 0;
function eq<T>(n: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, '\n   got ', JSON.stringify(got), '\n   want', JSON.stringify(want)); }
}
function ok(n: string, cond: boolean, msg?: string) {
  if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, msg ? `— ${msg}` : ''); }
}

const PROJECT_ID = 'proj-1';
const OTHER_PROJECT = 'proj-other';

// ── Minimal fixture builders ──────────────────────────────────────────────────
function pkg(overrides: Partial<BidPackage> = {}): BidPackage {
  return {
    id: 'pkg-1',
    projectId: PROJECT_ID,
    name: 'Framing',
    status: 'awarded',
    estimateBudget: 10000,
    awardedCommitmentId: 'cmt-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as BidPackage;
}

function cmt(overrides: Partial<Commitment> = {}): Commitment {
  return {
    id: 'cmt-1',
    projectId: PROJECT_ID,
    vendorName: 'Acme Framing',
    amount: 8500,
    changeAmount: 0,
    status: 'signed',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Commitment;
}

// ── Empty input ───────────────────────────────────────────────────────────────
{
  const result = computeBulkSavings(PROJECT_ID, [], [], []);
  eq('empty → hasRealData false', result.hasRealData, false);
  eq('empty → bulkSavings 0', result.bulkSavings, 0);
  eq('empty → awardedPackageCount 0', result.awardedPackageCount, 0);
  eq('empty → source', result.source, 'measured_from_buyout');
}

// ── One awarded package with commitment → correct delta ───────────────────────
{
  const result = computeBulkSavings(PROJECT_ID, [pkg()], [cmt()], []);
  eq('one awarded pkg → hasRealData true', result.hasRealData, true);
  eq('one awarded pkg → bulkSavings 1500', result.bulkSavings, 1500);
  eq('one awarded pkg → awardedPackageCount 1', result.awardedPackageCount, 1);
  eq('one awarded pkg → source', result.source, 'measured_from_buyout');
}

// ── Two packages, one overrun → net is correct ───────────────────────────────
{
  const pkgA = pkg({ id: 'pkg-a', estimateBudget: 10000, awardedCommitmentId: 'cmt-a' });
  const pkgB = pkg({ id: 'pkg-b', estimateBudget: 5000, awardedCommitmentId: 'cmt-b' });
  const cmtA = cmt({ id: 'cmt-a', amount: 8500, changeAmount: 0 }); // saves 1500
  const cmtB = cmt({ id: 'cmt-b', amount: 5800, changeAmount: 0 }); // overrun -800
  const result = computeBulkSavings(PROJECT_ID, [pkgA, pkgB], [cmtA, cmtB], []);
  eq('two pkgs (one overrun) → net 700', result.bulkSavings, 700);
  eq('two pkgs → count 2', result.awardedPackageCount, 2);
  ok('two pkgs → byPackage length 2', result.byPackage.length === 2);
}

// ── Awarded-but-uncommitted → excluded (hasRealData false) ───────────────────
{
  const p = pkg({ awardedCommitmentId: undefined });
  const result = computeBulkSavings(PROJECT_ID, [p], [], []);
  eq('awarded-uncommitted → hasRealData false', result.hasRealData, false);
  eq('awarded-uncommitted → bulkSavings 0', result.bulkSavings, 0);
}

// ── changeAmount erodes the saving ────────────────────────────────────────────
{
  // budget 10000, base award 8500, changeAmount 700 → net award 9200 → saving 800
  const c = cmt({ amount: 8500, changeAmount: 700 });
  const result = computeBulkSavings(PROJECT_ID, [pkg()], [c], []);
  eq('changeAmount erodes saving → 800', result.bulkSavings, 800);
}

// ── changeAmount eliminates saving (overrun) ──────────────────────────────────
{
  // budget 10000, base 8500, changeAmount 2000 → net 10500 → saving -500
  const c = cmt({ amount: 8500, changeAmount: 2000 });
  const result = computeBulkSavings(PROJECT_ID, [pkg()], [c], []);
  eq('changeAmount overrun → bulkSavings -500', result.bulkSavings, -500);
  ok('overrun → still hasRealData (counted honestly)', result.hasRealData);
}

// ── Non-awarded status ('open') → excluded ────────────────────────────────────
{
  const p = pkg({ status: 'open' });
  const c = cmt();
  const result = computeBulkSavings(PROJECT_ID, [p], [c], []);
  eq('open status → hasRealData false', result.hasRealData, false);
  eq('open status → bulkSavings 0', result.bulkSavings, 0);
}

// ── Cross-project commitment → excluded ───────────────────────────────────────
{
  const c = cmt({ projectId: OTHER_PROJECT });
  const result = computeBulkSavings(PROJECT_ID, [pkg()], [c], []);
  eq('cross-project commitment → hasRealData false', result.hasRealData, false);
  eq('cross-project commitment → bulkSavings 0', result.bulkSavings, 0);
}

// ── Cross-project bid package → excluded ─────────────────────────────────────
{
  const p = pkg({ projectId: OTHER_PROJECT });
  const c = cmt();
  const result = computeBulkSavings(PROJECT_ID, [p], [c], []);
  eq('cross-project bid package → hasRealData false', result.hasRealData, false);
}

// ── Leveled: scope the awarded bid excludes is not savings (integration review) ──
// The framing package: budget $45,000, sub $38,000 excluding blocking and
// dumpster (AI-leveled +$3,200). The buyout screens show $3,800; the project
// page and the client's estimate PDF must print the same, not $7,000.
{
  const p = pkg({ estimateBudget: 45000, awardedBidId: 'bid-B' } as Partial<BidPackage>);
  const c = cmt({ amount: 38000 });
  const bids = [{ id: 'bid-A', amount: 42000, normalizedAdjustment: 0 }, { id: 'bid-B', amount: 38000, normalizedAdjustment: 3200 }];
  const r = computeBulkSavings(PROJECT_ID, [p], [c], bids);
  eq('leveled: $3,800, the buyout screens\' figure', r.bulkSavings, 3800);
  ok('leveled: equals packageBuyoutSavings to the cent',
    r.bulkSavings === packageBuyoutSavings({ ...p, status: 'awarded' } as BidPackage, [{ id: 'bid-B', amount: 38000, normalizedAdjustment: 3200 } as BidPackageBid]));
  const extra = computeBulkSavings(PROJECT_ID, [p], [c], [{ id: 'bid-B', amount: 38000, normalizedAdjustment: -1500 }]);
  // A NEGATIVE adjustment is the AI's guess that the bid covers extra scope.
  // This figure prints on the CLIENT's PDF as "Bulk Savings", so it may not
  // rise above budget − what he signed ($7,000) on that guess (integration
  // round 2, money). His own buyout screens still level it signed.
  eq('client-facing: a negative AI adjustment does not raise savings above budget − signed ($7,000, not $8,500)', extra.bulkSavings, 7000);
  const noRow = computeBulkSavings(PROJECT_ID, [p], [c], []);
  eq('awarded bid row gone → budget − commitment', noRow.bulkSavings, 7000);
  const cent = computeBulkSavings(PROJECT_ID, [pkg({ estimateBudget: 100.1, awardedBidId: 'x' } as Partial<BidPackage>)], [cmt({ amount: 50.05 })], [{ id: 'x', amount: 50.05, normalizedAdjustment: 0.02 }]);
  eq('money to the cent', cent.bulkSavings, 50.03);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
