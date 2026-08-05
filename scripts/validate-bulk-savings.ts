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
import type { BidPackage, Commitment } from '../types';

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
  const result = computeBulkSavings(PROJECT_ID, [], []);
  eq('empty → hasRealData false', result.hasRealData, false);
  eq('empty → bulkSavings 0', result.bulkSavings, 0);
  eq('empty → awardedPackageCount 0', result.awardedPackageCount, 0);
  eq('empty → source', result.source, 'measured_from_buyout');
}

// ── One awarded package with commitment → correct delta ───────────────────────
{
  const result = computeBulkSavings(PROJECT_ID, [pkg()], [cmt()]);
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
  const result = computeBulkSavings(PROJECT_ID, [pkgA, pkgB], [cmtA, cmtB]);
  eq('two pkgs (one overrun) → net 700', result.bulkSavings, 700);
  eq('two pkgs → count 2', result.awardedPackageCount, 2);
  ok('two pkgs → byPackage length 2', result.byPackage.length === 2);
}

// ── Awarded-but-uncommitted → excluded (hasRealData false) ───────────────────
{
  const p = pkg({ awardedCommitmentId: undefined });
  const result = computeBulkSavings(PROJECT_ID, [p], []);
  eq('awarded-uncommitted → hasRealData false', result.hasRealData, false);
  eq('awarded-uncommitted → bulkSavings 0', result.bulkSavings, 0);
}

// ── changeAmount erodes the saving ────────────────────────────────────────────
{
  // budget 10000, base award 8500, changeAmount 700 → net award 9200 → saving 800
  const c = cmt({ amount: 8500, changeAmount: 700 });
  const result = computeBulkSavings(PROJECT_ID, [pkg()], [c]);
  eq('changeAmount erodes saving → 800', result.bulkSavings, 800);
}

// ── changeAmount eliminates saving (overrun) ──────────────────────────────────
{
  // budget 10000, base 8500, changeAmount 2000 → net 10500 → saving -500
  const c = cmt({ amount: 8500, changeAmount: 2000 });
  const result = computeBulkSavings(PROJECT_ID, [pkg()], [c]);
  eq('changeAmount overrun → bulkSavings -500', result.bulkSavings, -500);
  ok('overrun → still hasRealData (counted honestly)', result.hasRealData);
}

// ── Non-awarded status ('open') → excluded ────────────────────────────────────
{
  const p = pkg({ status: 'open' });
  const c = cmt();
  const result = computeBulkSavings(PROJECT_ID, [p], [c]);
  eq('open status → hasRealData false', result.hasRealData, false);
  eq('open status → bulkSavings 0', result.bulkSavings, 0);
}

// ── Cross-project commitment → excluded ───────────────────────────────────────
{
  const c = cmt({ projectId: OTHER_PROJECT });
  const result = computeBulkSavings(PROJECT_ID, [pkg()], [c]);
  eq('cross-project commitment → hasRealData false', result.hasRealData, false);
  eq('cross-project commitment → bulkSavings 0', result.bulkSavings, 0);
}

// ── Cross-project bid package → excluded ─────────────────────────────────────
{
  const p = pkg({ projectId: OTHER_PROJECT });
  const c = cmt();
  const result = computeBulkSavings(PROJECT_ID, [p], [c]);
  eq('cross-project bid package → hasRealData false', result.hasRealData, false);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
