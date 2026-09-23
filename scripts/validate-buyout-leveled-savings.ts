// validate-buyout-leveled-savings.ts — one buyout-savings number on every
// screen: the leveled one the Award dialog showed (audit round 2, #5).
// Run via: bun run scripts/validate-buyout-leveled-savings.ts
//
// THE BUG. Framing package, budget $45,000. Bid B $38,000 excluding blocking
// and dumpster, AI-leveled +$3,200. The Award dialog read "Leveled total
// $41,200 · Buyout savings $3,800"; after Award the package hero and
// buyout.tsx's savings-to-date read +$7,000 — awardBidPackage stored
// budget − bid. $3,200 of savings that do not exist: the awarded sub does not
// cover that scope and he still has to buy it.
//
// The commitment amount stays the sub's bid (the subcontract is the
// subcontract). The excluded scope is NOT booked as a commitment (a placeholder
// PO read as a real supplier/lien-waiver/committed cost everywhere); it shows as
// uncommitted, estimated scope on the buyout hero and in Job Costing. The
// stored field is fixed by the ProjectContext handoff; the
// screens no longer depend on it — they level off the awarded bid, so
// packages awarded before the fix read right too.
import { readFileSync } from 'node:fs';
import {
  leveledBidTotal, leveledBuyoutSavings, packageBuyoutSavings, uncoveredScopeOf, openExcludedScope,
} from '../utils/projectFinancials';
import { computeBulkSavings } from '../utils/bulkSavings';
import type { BidPackage, BidPackageBid, Commitment } from '../types';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

const bidB = { id: 'B', amount: 38000, normalizedAdjustment: 3200 } as BidPackageBid;
const bidA = { id: 'A', amount: 42000, normalizedAdjustment: 0 } as BidPackageBid;
const bidExtra = { id: 'X', amount: 44000, normalizedAdjustment: -1500 } as BidPackageBid; // covers extra scope
// What awardBidPackage stores today: budget − bid.
const pkg = { status: 'awarded', estimateBudget: 45000, awardedBidId: 'B', buyoutSavings: 7000 } as BidPackage;

console.log('\nthe framing package');
ok('leveled total $41,200', leveledBidTotal(bidB) === 41200);
ok('dialog savings $3,800', leveledBuyoutSavings(45000, bidB) === 3800);
ok('package savings shown = the dialog\'s $3,800, not the stored $7,000', packageBuyoutSavings(pkg, [bidA, bidB]) === 3800,
  `got ${packageBuyoutSavings(pkg, [bidA, bidB])}`);
ok('the excluded scope he still has to buy is $3,200', uncoveredScopeOf(bidB) === 3200);
ok('the signed adjustment is used: a bid that covers extra scope reads $2,500 savings, not $1,000',
  leveledBuyoutSavings(45000, bidExtra) === 2500);
ok('…and it has no uncovered scope', uncoveredScopeOf(bidExtra) === 0);
ok('not awarded → no savings figure', packageBuyoutSavings({ ...pkg, status: 'open' } as BidPackage, [bidB]) === null);
ok('awarded bid row gone → falls back to the stored figure', packageBuyoutSavings(pkg, []) === 7000);
ok('money to the cent', leveledBuyoutSavings(100.1, { amount: 50.05, normalizedAdjustment: 0.02 } as BidPackageBid) === 50.03);

console.log('\none base for every surface: the signed commitment + its COs (integration round 2)');
// THE BUG. buyout.tsx / the hero / Award levelled off bid.amount; the project
// page and the client PDF levelled off commitment.amount + changeAmount. Equal
// only until he edited the commitment or logged a sub CO.
const pkgC = { ...pkg, id: 'P', projectId: 'J', name: 'Framing', awardedCommitmentId: 'C1' } as BidPackage;
const commit = (amount: number, changeAmount = 0) => [{ id: 'C1', projectId: 'J', amount, changeAmount } as Commitment];
const both = (cs: Commitment[], bids: BidPackageBid[] = [bidA, bidB]) => ({
  screen: packageBuyoutSavings(pkgC, bids, cs),
  client: computeBulkSavings('J', [pkgC], cs, bids).bulkSavings,
});
for (const [label, cs, want] of [
  ['as awarded', commit(38000), 3800],
  ['commitment edited to $37,000 in Job Costing', commit(37000), 4800],
  ['sub CO +$1,500', commit(38000, 1500), 2300],
  // Below the bid, so nothing reads as absorbed (a rise above it would —
  // openExcludedScope's stated trade-off).
  ['cents', commit(37999.63, 0.01), 3800.36],
  // Leftovers review: the sub agrees to take the blocking and dumpster and he
  // edits the commitment $38,000 → $41,200. That rise IS the excluded scope,
  // bought — levelling the award-time +$3,200 again read $600 everywhere,
  // client PDF included, while a separate PO for the same scope kept $3,800.
  ['excluded scope folded into the commitment ($38,000 → $41,200)', commit(41200), 3800],
  ['…partly folded in ($38,000 → $40,000: $1,200 still open)', commit(40000), 3800],
  ['…folded in AND the sub charged more ($38,000 → $42,000)', commit(42000), 3000],
  ['…folded in, then a sub CO +$1,500 (a CO is extra cost)', commit(41200, 1500), 2300],
] as const) {
  const r = both([...cs]);
  ok(`${label}: buyout screens $${want} = project page / client PDF`, r.screen === want && r.client === want, JSON.stringify(r));
}
ok('no commitment passed → the Award dialog\'s bid-based figure (screens before the list loads)',
  packageBuyoutSavings(pkgC, [bidA, bidB]) === 3800);
{
  // The AI says bid X covers $1,500 of scope beyond the package. His own
  // screens level it (signed); the CLIENT's PDF must not print that guess as
  // savings: budget − what he signed, no more.
  const pkgX = { ...pkgC, awardedBidId: 'X' } as BidPackage;
  const cs = commit(44000);
  ok('negative AI adjustment: his buyout screen levels it ($2,500)', packageBuyoutSavings(pkgX, [bidExtra], cs) === 2500);
  const client = computeBulkSavings('J', [pkgX], cs, [bidExtra]).bulkSavings;
  ok('negative AI adjustment: the client PDF prints only budget − signed ($1,000), never the AI-raised $2,500',
    client === 1000, `got ${client}`);
}

console.log('\nwiring');
const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const buyout = read('app/buyout.tsx');
const pkgScreen = read('app/buyout-package.tsx');
ok('buyout.tsx savings-to-date sums the leveled figure',
  /savingsToDate = packages[\s\S]{0,200}packageBuyoutSavings\(p, getBidsForPackage\(p\.id\), commitments\)/.test(buyout));
ok('buyout.tsx package cards read the leveled figure, not pkg.buyoutSavings',
  /const savings = packageBuyoutSavings\(pkg, bids, commitments\);/.test(buyout) && !/pkg\.buyoutSavings >= 0/.test(buyout));
ok('buyout-package hero reads the leveled figure, not pkg.buyoutSavings',
  /heroSavings = pkg \? packageBuyoutSavings\(pkg, bids, commitments\)/.test(pkgScreen) && !/pkg\.buyoutSavings >= 0/.test(pkgScreen));
ok('the Award dialog uses the same helper', /const savings = leveledBuyoutSavings\(pkg\.estimateBudget, bid\);/.test(pkgScreen));
ok('the Award dialog says the excluded scope is NOT in the commitment and still his to buy — no placeholder',
  /is not in it — still yours to buy/.test(pkgScreen) && !/Creates a \$\{formatMoney\(uncovered\)\} placeholder/.test(pkgScreen));
const projectDetail = read('app/project-detail.tsx');
const estimateFull = read('app/(tabs)/estimate/full.tsx');
const jobCosting = read('app/job-costing.tsx');
ok('project page Bulk Savings (hero, modal, PDFs) is leveled off the awarded bids',
  /computeBulkSavings\(id \?\? '', projectBidPackages, projectCommitments, bidPackageBids[,)]/.test(projectDetail));
ok('the client estimate PDF\'s Bulk Savings is leveled off the awarded bids',
  /computeBulkSavings\(pendingLinkProject\.id, pkgs, commitments, bidPackageBids[,)]/.test(estimateFull));
ok('Job Costing lists the excluded scope as uncommitted, estimated — off the awarded bid, minus what the commitment absorbed',
  /openExcludedScope\(bid, committed\?\.amount\)/.test(jobCosting) && /const committed = awardedCommitmentOf\(p, projectCommitments\);/.test(jobCosting)
    && /testID="uncovered-scope-notice"/.test(jobCosting));
{
  // Separate PO bought the same scope: the commitment is untouched → the
  // excluded scope is still read open (the known, deferred "excluded scope
  // bought" link — not this rule's to solve), savings stay $3,800 either way.
  const sepPo = [...commit(38000), { id: 'PO9', projectId: 'J', amount: 3200, changeAmount: 0 } as Commitment];
  ok('separate PO for the excluded scope: $3,800 on screens and client PDF (same as folding it in)',
    packageBuyoutSavings(pkgC, [bidA, bidB], sepPo) === 3800 && computeBulkSavings('J', [pkgC], sepPo, [bidA, bidB]).bulkSavings === 3800);
  ok('openExcludedScope: award-time (no commitment) = full adj; folded in = 0; partial = remainder; never negative',
    openExcludedScope(bidB, undefined) === 3200 && openExcludedScope(bidB, 41200) === 0 && openExcludedScope(bidB, 40000) === 1200
      && openExcludedScope(bidB, 50000) === 0 && openExcludedScope(bidB, 37000) === 3200 && openExcludedScope(bidExtra, 44000) === 0);
  const pkgScreen2 = read('app/buyout-package.tsx');
  ok('the package hero\'s "still to place" uses the same open figure',
    /openExcludedScope\(bids\.find\(b => b\.id === pkg\.awardedBidId\), awardedCommitmentOf\(pkg, commitments\)\?\.amount\)/.test(pkgScreen2));
}

ok('the cost breakdown never reconciles buyout savings into the estimate total (it printed them back as "Other / unreconciled")',
  /const explained = base \+ tax \+ markup \+ \(estimate\.contingency \?\? 0\);/.test(projectDetail)
  && /Total after buyout savings/.test(projectDetail));
ok('…and labels a demo/legacy estimate\'s taxAmount and markupAmount instead of calling them unreconciled',
  /legacy\.taxAmount/.test(projectDetail) && /legacy\.markupAmount/.test(projectDetail) && /testID="cost-breakdown-markup"/.test(projectDetail));

console.log('\nawardBidPackage (contexts/ProjectContext.tsx)');
const ctx = read('contexts/ProjectContext.tsx');
const awardStart = ctx.indexOf('const awardBidPackage = useCallback(');
const awardEnd = ctx.indexOf('return commitmentId;', awardStart);
const award = awardStart >= 0 && awardEnd > awardStart ? ctx.slice(awardStart, awardEnd) : '';
ok('the award body was found', award.length > 0);
ok('stored savings are the leveled figure (the dialog\'s), not budget − bid',
  /const savings = leveledBuyoutSavings\(pkg\.estimateBudget, bid\);/.test(award)
  && !/const savings = pkg\.estimateBudget - committedAmount/.test(award));
ok('the commitment stays the sub\'s bid', /const committedAmount = bid\.amount;/.test(award) && /amount: committedAmount,/.test(award));
ok('NO placeholder commitment for the excluded scope (passport supplier, stuck lien waivers, double count)',
  !/placeholder: Commitment/.test(award) && !/'Uncovered: '/.test(award)
  && /const nextCommitments = \[commitment, \.\.\.commitments\];/.test(award));
ok('the commitment is INSERTED on the server — it was device-only',
  /supabaseWrite\('commitments', 'insert', commitmentToRow\(commitment\)\)/.test(award));
ok('signedDate is his calendar day (signed_date is a `date` column), not an ISO instant',
  /const signedDay = todayCalendarDay\(\);/.test(award) && /signedDate: signedDay,/.test(award) && !/signedDate: now/.test(award));
ok('the risk-override note rides into the award (no stale follow-up updateCommitment)',
  /opts\?\.overrideNote/.test(award) && /awardBidPackage\(pkg\.id, bid\.id, \{ overrideNote \}\)/.test(pkgScreen)
  && !/updateCommitment\(commitmentId/.test(pkgScreen));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
