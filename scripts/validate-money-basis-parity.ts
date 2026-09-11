// validate-money-basis-parity.ts — the two bank-facing reports must strike their
// margin against the SAME cost, and must say on screen which cost that is.
//
// WHY THIS EXISTS. The polish audit of 2026-09-10 mounted all 107 routes against
// a seeded account and caught the worst thing in the app. One job — a $155,172
// contract, a $131,502 estimate, two subcontracts worth $42,200 already awarded:
//
//   /wip-report  →  "Revised contract $155,172 … Weighted margin 15%"
//   /reports     →  "Est. final cost $173,702 | Projected profit -$18,530 … -11.9 %"
//
// Same account, same session, same project. Both screens offer an Export PDF
// button. Neither said which cost basis it had used. A contractor who hands a
// lender both documents is the one who has to explain the 27-point spread.
//
// And the -11.9% was not a second defensible opinion. utils/jobCostEngine.ts
// buckets estimate budget by `item.category` ('subcontractor') and buckets a
// commitment by its free-text `phase` ('Electrical' / 'Plumbing'); the match is
// exact and case-sensitive, so awarding the two subs the estimate had ALREADY
// priced opened two new $0-budget phases and added their $42,200 on top of the
// $131,502 that still priced them. 131,502 + 42,200 = 173,702, to the dollar.
// Buying out a job — the most ordinary thing a GC does — inverted his only
// profit report.
//
// THE RULE THIS PINS, in three parts:
//
//   1. ONE DEFINITION. Cost at completion is
//        max(estimate cost basis, Σ signed commitments)
//      and it lives in exactly one place, utils/wip.deriveEstimatedCostWithSource.
//      utils/financialReports.ts adopts it rather than holding a second opinion.
//      max, never sum: a commitment that fulfils an estimate line is INSIDE the
//      estimate, and only a commitment signed ABOVE it moves the number.
//   2. BOTH SCREENS NAME IT. A margin above an Export button says what cost it
//      was measured against, from one shared helper, so the two screens and the
//      PDF cannot explain one schedule three ways.
//   3. AN EMPTY SCHEDULE IS NOT A BANK DOCUMENT. With no rows, Save period /
//      Lock / Export must refuse and say why — a WIP schedule of zeros is read
//      by a surety as a sworn statement of position.
//
// WIRED INTO ship-check as `test:money-basis-parity` (package.json). This
// header used to say it was not, which stopped being true when the entry
// landed; a guard that misreports its own coverage is the class of thing this
// file exists to catch.
//
// Run via: bun run test:money-basis-parity

import {
  deriveEstimatedCostWithSource,
  sumSignedCommitmentValue,
  describeCostBasis,
  describePortfolioCostBasis,
  computeWipRow,
  computeWipPortfolio,
  selectWipDisplayPeriod,
  applyWipEtcEntry,
  type WipEstimatedCost,
  type WipSnapshotRowWithSources,
  type WipPeriodWithSources,
} from '../utils/wip';
import { computeWIPReport, computeProfitReport } from '../utils/financialReports';
import type { Project, Commitment, LinkedEstimate } from '../types';
// fileURLToPath + join because the repo path contains a space.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, ...rel.split('/')), 'utf8');

/**
 * A file with its comment lines removed.
 *
 * Prose about the bug is not the bug. Two assertions below matched the very
 * comment that explains what they forbid — the same trap
 * scripts/validate-wip-provenance.ts and scripts/validate-calendar-date.ts
 * already document, and it is the reason a guard can be green while the thing
 * it guards is broken (or red while it is fixed, which is how I found it).
 */
function withoutComments(file: string): string {
  return file.split('\n')
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');
}

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
function close(name: string, got: number, want: number, eps = 0.5) {
  ok(name, Math.abs(got - want) <= eps, `got ${got}, want ${want}`);
}

// ── The audit's own fixture, rebuilt to the dollar ──────────────────────────
//
// The seven lines of __tests__/fixtures/world.ts's linked estimate, summing to
// the $131,502 baseTotal the dump rendered, with the two subcontractor lines
// carrying the same trade the awarded commitments carry. Costs are COST
// (unitPrice × quantity), never sell.
const ESTIMATE_LINES = [6_800, 96 * 78, 41_250, 84 * 96, 18_400, 22_600, 26_900];
const BASE_TOTAL = ESTIMATE_LINES.reduce((s, n) => s + n, 0);

function estimate(lines: number[], grandTotal?: number, category = 'subcontractor'): LinkedEstimate {
  const baseTotal = lines.reduce((s, n) => s + n, 0);
  const sell = grandTotal ?? Math.round(baseTotal * 1.18);
  return {
    id: 'est',
    items: lines.map((unitPrice, n) => ({
      materialId: `m${n}`, name: `line ${n}`, category, unit: 'ls',
      quantity: 1, unitPrice, bulkPrice: unitPrice, markup: 18,
      usesBulk: false, lineTotal: unitPrice, supplier: '',
    })),
    globalMarkup: 18, baseTotal, markupTotal: sell - baseTotal, grandTotal: sell,
    createdAt: '2026-01-01T00:00:00.000Z',
  } as unknown as LinkedEstimate;
}

/**
 * A project carrying one estimate. `id` is 'p1' and MUST stay in step with the
 * commitments' `projectId` — every engine here filters commitments by project,
 * so a fixture without an id silently tests the no-commitments path and every
 * assertion below it passes for the wrong reason.
 */
function projectWith(lines: number[], grandTotal?: number): Project {
  return {
    id: 'p1', name: 'Fixture', status: 'in_progress',
    estimate: null, linkedEstimate: estimate(lines, grandTotal),
    createdAt: '2026-01-01', updatedAt: '2026-01-01',
  } as unknown as Project;
}

const HARLOW = {
  id: 'p1', name: 'Harlow Residence — kitchen + primary suite', status: 'in_progress',
  estimate: null, linkedEstimate: estimate(ESTIMATE_LINES, 155_172),
  createdAt: '2026-01-01', updatedAt: '2026-01-01',
} as unknown as Project;

/** A signed subcontract. `phase` is the free-text field that caused all this. */
function sub(
  id: string, amount: number, phase: string,
  over: Partial<Commitment> = {},
): Commitment {
  return {
    id, projectId: 'p1', number: id, type: 'subcontract', description: phase,
    amount, paidToDate: 0, phase, status: 'active',
    signedDate: '2026-02-01', createdAt: '2026-02-01', updatedAt: '2026-02-01',
    ...over,
  } as unknown as Commitment;
}

// The two the fixture awards: exactly the estimate's two sub lines, tagged with
// trade names the estimate spells 'subcontractor'.
const AWARDED: Commitment[] = [
  sub('SC-01', 22_600, 'Electrical'),
  sub('SC-02', 18_400, 'Plumbing', { changeAmount: 1_200 }),
];
const AWARDED_TOTAL = 22_600 + 18_400 + 1_200; // 42,200 — the figure the dump shows

console.log('\nthe fixture the audit read, reproduced:');
close('the estimate\'s cost line is $131,502', BASE_TOTAL, 131_502);
close('the awarded subs total $42,200', sumSignedCommitmentValue(AWARDED), AWARDED_TOTAL);

// ── 1. ONE DEFINITION ───────────────────────────────────────────────────────
console.log('\nbuying out what you estimated does not change what the job will cost:');
{
  const cost = deriveEstimatedCostWithSource(HARLOW, AWARDED, {
    approvedChangeOrders: 0, originalContract: 155_172,
  });
  close('cost at completion stays on the estimate', cost.value, 131_502);
  ok('…and says so', cost.basis === 'estimate' && cost.source === 'estimate_base_total',
    `${cost.basis} / ${cost.source}`);
  close('…while still reporting what has been signed', cost.committedFloor, 42_200);
  // The exact number the bug printed. If this ever comes back, so does
  // "Projected profit -$18,530" on a job carrying $23,670 of margin.
  ok('the double count is gone', cost.value !== 173_702, String(cost.value));

  const row = computeWipRow({
    originalContract: 155_172, approvedChangeOrders: 0,
    totalEstimatedCost: cost.value, costToDate: 0, billedToDate: 0,
  });
  close('est gross profit is the real margin', row.estGrossProfit, 23_670);
  ok('…and the job is not reported as a loss', row.anticipatedLoss === false);
}

console.log('\nthe two bank-facing reports answer with the same number:');
{
  const wipTab = computeWIPReport([HARLOW], [], [], AWARDED).rows[0];
  const profitTab = computeProfitReport([HARLOW], [], [], AWARDED).rows[0];
  const own = deriveEstimatedCostWithSource(HARLOW, AWARDED, {
    approvedChangeOrders: 0, originalContract: 155_172,
  });

  close('/reports WIP tab cost at completion', wipTab.estimatedFinalCost, own.value);
  close('/reports Profit tab cost at completion', profitTab.estimatedFinalCost, own.value);
  close('…so the two tabs report one margin', wipTab.projectedMargin, profitTab.projectedMargin);
  close('…and it is the margin the WIP engine computes', wipTab.projectedMargin, 15.25, 0.01);
  ok('…which is profit, not loss', wipTab.projectedProfit > 0, String(wipTab.projectedProfit));

  // The WIP-schedule side, computed the way app/wip-report.tsx computes it.
  const portfolioMargin =
    (own.value === 0 ? 0 : (155_172 - own.value) / 155_172) * 100;
  close('app/wip-report.tsx\'s weighted margin agrees to the basis point',
    portfolioMargin, wipTab.projectedMargin, 0.01);

  ok('every row carries the basis it used, so a report can print it',
    wipTab.costAtCompletion != null && profitTab.costAtCompletion != null);
}

console.log('\nthe floor binds only when it is ABOVE the plan:');
{
  // The divergence scripts/validate-wip-parity.ts named and could not assert:
  // $520,000 of signed subs against a $400,000 estimate.
  const project = projectWith([400_000]);
  const heavy = [sub('SC-9', 520_000, 'Everything')];
  const cost = deriveEstimatedCostWithSource(project, heavy);
  close('signed commitments above the estimate set the cost', cost.value, 520_000);
  ok('…and the source says which', cost.basis === 'commitments' && cost.source === 'signed_commitments',
    `${cost.basis} / ${cost.source}`);
  const wipTab = computeWIPReport([project], [], [], heavy).rows[0];
  close('…on /reports too', wipTab.estimatedFinalCost, 520_000);

  // One dollar under, and the estimate is still the plan.
  const under = deriveEstimatedCostWithSource(project, [sub('SC-9', 399_999, 'Everything')]);
  close('a sub one dollar under the estimate leaves it standing', under.value, 400_000);
  ok('…still named as the estimate', under.basis === 'estimate');
}

console.log('\na closed subcontract was still money spent:');
{
  // MUTATION THAT USED TO PASS: narrow isSignedCommitment to `status ===
  // 'active'`. CommitmentStatus is 'draft' | 'active' | 'closed', and the
  // fixtures above only ever use the first two — so dropping every CLOSED
  // subcontract out of the floor was invisible, all 77 assertions green. A sub
  // that has finished his scope and been closed out is the money most certainly
  // spent; leaving him out UNDERstates cost at completion on a bank document,
  // which is the dangerous direction.
  const project = projectWith([400_000]);
  const closedOut = [sub('SC-7', 520_000, 'Everything', { status: 'closed' })];
  ok('a closed commitment is signed money', sumSignedCommitmentValue(closedOut) === 520_000,
    String(sumSignedCommitmentValue(closedOut)));
  close('…and it still sets the floor', deriveEstimatedCostWithSource(project, closedOut).value, 520_000);
  close('…on /reports too',
    computeWIPReport([project], [], [], closedOut).rows[0].estimatedFinalCost, 520_000);
}

console.log('\none job\'s subs are not another job\'s cost:');
{
  // MUTATION THAT USED TO PASS: delete the `.filter(c => c.projectId ===
  // project.id)` in utils/financialReports.ts and pass the whole commitment
  // list. Every fixture above holds ONE project, so every assertion stayed
  // green while each job's cost at completion absorbed every other job's
  // subcontracts — a bank schedule where a $520,000 sub on the warehouse shows
  // up in the kitchen's projected profit.
  const kitchen = { ...projectWith([100_000]), id: 'p1', name: 'Kitchen' } as Project;
  const warehouse = { ...projectWith([100_000]), id: 'p2', name: 'Warehouse' } as Project;
  const warehouseSub = sub('SC-8', 520_000, 'Everything', { projectId: 'p2' });

  const rows = computeWIPReport([kitchen, warehouse], [], [], [warehouseSub]).rows;
  const k = rows.find(r => r.projectId === 'p1');
  const w = rows.find(r => r.projectId === 'p2');
  ok('both jobs are on the schedule', k != null && w != null);
  close('the warehouse carries its own $520,000 sub', w?.estimatedFinalCost ?? 0, 520_000);
  close('…and the kitchen carries none of it', k?.estimatedFinalCost ?? 0, 100_000);

  const profit = computeProfitReport([kitchen, warehouse], [], [], [warehouseSub]).rows;
  close('the Profit tab keeps them apart too',
    profit.find(r => r.projectId === 'p1')?.estimatedFinalCost ?? 0, 100_000);
}

console.log('\na draft commitment binds nobody:');
{
  const project = projectWith([100_000]);
  const drafted = [sub('PO-14', 900_000, 'Millwork', { status: 'draft' })];
  close('an unissued PO does not raise the cost at completion',
    deriveEstimatedCostWithSource(project, drafted).value, 100_000);
  close('…nor the signed total', sumSignedCommitmentValue(drafted), 0);
  // utils/jobCostEngine.ts draws the same line. Two cost engines with two
  // opinions about which commitments exist is how this started.
  ok('the engine excludes drafts the same way',
    /commitments\.filter\(c => c\.projectId === project\.id && c\.status !== 'draft'\)/
      .test(read('utils/jobCostEngine.ts')));
}

console.log('\nmoney spent INSIDE the budget is not money on top of it:');
{
  // This is the assertion scripts/validate-money-definitions.ts had backwards.
  // It required that forwarding material receipts and crew hours MOVE the
  // reported margin — and the margin only moved because a 'carpenter' time
  // entry landed in a phase the estimate never named, so the engine added its
  // cost on top of the estimate that already priced the work. Lumber bought
  // against a budgeted line does not make a job cost more.
  const project = projectWith([420_000]);
  const commitments = [sub('SC-1', 300_000, 'Framing', { paidToDate: 180_000 })];
  const bare = computeProfitReport([project], [], [], commitments).rows[0];
  const wired = computeProfitReport([project], [], [], commitments, {
    receipts: [{
      id: 'r1', projectId: 'p1', vendor: 'Supply Co', status: 'reviewed',
      lines: [{ id: 'rl1', description: 'Lumber', category: 'Finishes', quantity: 1, unit: 'ls', unitPrice: 25_000, lineTotal: 25_000 }],
      subtotal: 25_000, total: 25_000,
    }],
    timeEntries: [{
      id: 't1', projectId: 'p1', projectName: 'x', workerId: 'w1', workerName: 'Ana',
      trade: 'carpenter', clockIn: '2026-03-02T08:00:00.000Z', clockOut: '2026-03-02T16:00:00.000Z',
      breakMinutes: 0, totalHours: 10, overtimeHours: 0, status: 'clocked_out', date: '2026-03-02',
    }],
    laborRates: { carpenter: 60 },
  } as never).rows[0];

  ok('the cost sources still reach cost-to-date', wired.costToDate > bare.costToDate,
    `bare ${bare.costToDate}, wired ${wired.costToDate}`);
  close('…but the projected final cost stays on the estimate that priced them',
    wired.estimatedFinalCost, bare.estimatedFinalCost);
  close('…which is the estimate', wired.estimatedFinalCost, 420_000);
}

// ── 2. BOTH SCREENS NAME THE BASIS ──────────────────────────────────────────
console.log('\nthe basis is a sentence a GC can read to his banker:');
{
  const onEstimate = deriveEstimatedCostWithSource(HARLOW, AWARDED, { originalContract: 155_172 });
  const line = describeCostBasis(onEstimate);
  ok('it names the dollars of the basis', line.includes('$131,502'), line);
  ok('…and the dollars that are inside it', line.includes('$42,200'), line);
  ok('…and says which way round that is', /INSIDE|not added on top/i.test(line), line);

  const onCommitments = deriveEstimatedCostWithSource(
    projectWith([400_000]), [sub('SC-9', 520_000, 'Everything')],
  );
  const heavyLine = describeCostBasis(onCommitments);
  ok('the commitments basis names itself differently', heavyLine !== line);
  ok('…and names both figures', heavyLine.includes('$520,000') && heavyLine.includes('$400,000'), heavyLine);
  // This branch says the awarded subs ARE the cost at completion. A reader
  // takes that as the whole cost; on a self-perform-heavy job it is a floor.
  ok('…and admits what is NOT in that figure',
    /self-perform/i.test(heavyLine), heavyLine);

  // IT MAY NOT ASSERT WHAT MAGE CANNOT KNOW. Nothing ties a commitment to the
  // estimate line it fulfils — the job-cost engine's attempt to, matching a
  // free-text phase against an item category, is the double count that started
  // all this. So "is INSIDE that figure" was a second false statement replacing
  // the first one: a sub signed for scope the estimate never priced IS on top.
  // The sentence has to state the convention and what it costs the reader when
  // the convention is wrong for his job.
  ok('it does not claim to know the commitments are inside the estimate',
    !/\bis INSIDE that figure\b/.test(line), line);
  ok('…it says how the figure is READ, and what it costs if that is wrong',
    /read as work that estimate already prices/.test(line)
    && /will cost more than the figure above/.test(line), line);

  // The floor stops at signed commitments — money already PAID OUT is not a
  // third candidate (WipSource is pinned exactly by validate-wip-parity). So a
  // job that has spent past its estimate reports the estimate, and the only
  // thing that stops that being a silent overstatement of profit is this line.
  const overspent = describeCostBasis(onEstimate, 180_000);
  ok('a job that has already outspent its cost at completion is told so',
    /already recorded \$180,000 of cost/.test(overspent)
    && /overstated/.test(overspent), overspent);
  ok('…and a job that has not is not warned for nothing',
    describeCostBasis(onEstimate, 42_200) === line, describeCostBasis(onEstimate, 42_200));
  ok('…and an unknown cost-to-date says nothing rather than assuming zero',
    describeCostBasis(onEstimate) === line);
  ok('…the roll-up carries the same warning',
    /overstated/.test(describePortfolioCostBasis([onEstimate, onCommitments], 10_000_000)));
  ok('…and does not fire when the book is inside its cost at completion',
    !/overstated/.test(describePortfolioCostBasis([onEstimate, onCommitments], 1)));

  const none = deriveEstimatedCostWithSource({} as unknown as Project, []);
  const noneLine = describeCostBasis(none);
  ok('no cost on file admits it rather than implying a measured zero',
    /nothing on file/i.test(noneLine) && !/\$0\b/.test(noneLine), noneLine);

  // Every basis has to produce a real sentence, not a fragment or a blank.
  for (const c of [onEstimate, onCommitments, none]) {
    ok(`the ${c.basis} basis is a full sentence`,
      describeCostBasis(c).length > 60 && describeCostBasis(c).trim().endsWith('.'),
      describeCostBasis(c));
  }

  // A roll-up may not pick one basis to speak for a mixed portfolio.
  const mixed = describePortfolioCostBasis([onEstimate, onCommitments]);
  ok('a mixed portfolio says it is mixed', /mixed/i.test(mixed), mixed);
  ok('…and sends the reader to the project', /open a project/i.test(mixed), mixed);
  ok('an empty roll-up says nothing at all rather than a basis for no rows',
    describePortfolioCostBasis([]) === '');
  const allEstimate = describePortfolioCostBasis([onEstimate, onEstimate]);
  ok('a uniform portfolio states the one basis', /estimates' cost before markup/.test(allEstimate), allEstimate);
}

console.log('\nboth screens actually render it, and neither prints a bare margin:');
{
  const REPORTS = read('app/reports.tsx');
  const WIP_SCREEN = read('app/wip-report.tsx');
  const PDF = read('utils/financialReportPdf.ts');
  const FIN = read('utils/financialReports.ts');

  ok('/reports takes its cost at completion from the shared definition',
    /deriveEstimatedCostWithSource\(project, projectCommitments/.test(FIN));
  // The regression, stated as the line that would bring it back.
  ok('…and no longer reads the job-cost engine\'s per-phase EAC for it',
    !/(?:const|let)\s+estimatedFinalCost\s*=\s*job\.projectedFinal/.test(FIN),
    'estimatedFinalCost must not be job.projectedFinal — that is the double-counted figure');
  ok('…and percent complete divides by the same figure',
    /job\.actual \/ estimatedFinalCost/.test(FIN));

  ok('/reports renders the basis under its totals', /<CostBasisLine rows=/.test(REPORTS));
  ok('…on BOTH the WIP tab and the ungated Profit tab',
    (REPORTS.match(/<CostBasisLine rows=/g) ?? []).length >= 2);
  ok('…from the shared helper, not a sentence of its own',
    /describePortfolioCostBasis/.test(REPORTS));
  ok('/wip-report renders it under the weighted margin',
    /testID="wip-cost-basis"/.test(WIP_SCREEN)
    && /describePortfolioCostBasis\(portfolioBases, portfolio\.costToDate\)/.test(WIP_SCREEN));
  ok('…and the drill-in names the basis as well as the branch',
    /describeCostBasis\(drillRow\.cost, drillInput\.costToDate\)/.test(WIP_SCREEN));
  // MUTATION THAT USED TO PASS: hardcode the sentence in CostBasisLine and
  // leave the import standing, and every assertion above stayed green because
  // it only proved the identifier appeared SOMEWHERE in the file. Pin the call
  // that actually feeds the rendered <Text>.
  ok('…and /reports renders the helper\'s output, not a sentence of its own',
    /describePortfolioCostBasis\(bases, incurred\)/.test(REPORTS));
  // A cost-at-completion below what the job has already cost is a margin the GC
  // has spent his way out of; the sentence is the only thing that says so,
  // because the number itself does not move.
  // Both rows, counted — the Profit row has carried `costToDate` since
  // MONEY-DEF-1, so a presence test passed with the WIP row's copy deleted.
  ok('…and BOTH report rows hand it what the work has already cost',
    (FIN.match(/costToDate: job\.actual/g) ?? []).length === 2
    && /r\.costToDate/.test(REPORTS),
    `${(FIN.match(/costToDate: job\.actual/g) ?? []).length} of 2 rows carry it`);
  ok('…and the exported PDF does too', /r\.costToDate/.test(PDF));
  // WIPRow.costToDate is optional (hand-built rows exist), and absent must mean
  // UNKNOWN. Summing a partial spend against a full cost at completion would
  // print "you are inside your cost" — the reassurance this line exists to
  // withhold — on the one job that has blown through it.
  ok('…and a row that cannot say what it cost makes the sum unknown, not short',
    (REPORTS.match(/withBasis\.every\(r => r\.costToDate \!= null\)/g) ?? []).length === 1
    && (PDF.match(/withBasis\.every\(r => r\.costToDate \!= null\)/g) ?? []).length === 1);

  // MUTATION THAT USED TO PASS: give Lock the export reason. On a healthy
  // account with a 15% margin and no SAVED period, Lock is dim and that reason
  // ("needs at least one active project with a cost-and-markup estimate") is
  // false — the GC has the project and the estimate. A screen reader reads it
  // out as fact.
  ok('Lock is blocked for its own reason, not the export one',
    /const lockBlockedReason =/.test(WIP_SCREEN)
    && /accessibilityHint=\{lockBlockedReason \?\? undefined\}/.test(WIP_SCREEN));
  ok('…and the visible note prints every reason in force, not only the empty one',
    /const blockedNotes = \[\.\.\.new Set\(\[/.test(WIP_SCREEN)
    && /blockedNotes\.length > 0 \? \(/.test(WIP_SCREEN));
  ok('the exported PDF carries the same sentence',
    /costBasisNote\(report\.rows\)/.test(PDF) && /costBasisNote\(rows\)/.test(PDF));

  // A margin pill that is only a number, decoded by colour, does not survive a
  // screenshot in an email or a black-and-white print.
  const barePill = /\{r\.projectedMargin\.toFixed\(1\)\}%\s*\n?\s*</.test(REPORTS);
  ok('no margin on /reports renders without the noun "margin"', !barePill,
    'a `{r.projectedMargin.toFixed(1)}%` with no following word is back');
  ok('…both pills carry it',
    (REPORTS.match(/\{r\.projectedMargin\.toFixed\(1\)\}% margin/g) ?? []).length === 2);

  // The PDF methodology block is read by the banker, so it has to describe the
  // arithmetic the code actually does. It claimed "% Complete = Billed to Date ÷
  // Revised Contract" for two audits after MONEY-F13 made it cost-based.
  ok('the PDF methodology states the cost-based percent complete',
    /% Complete = Cost to Date ÷ Estimated Final Cost/.test(PDF));
  // AXIS 7. The schedule fallback is GONE from the engine, so the sentence that
  // described it would now be a lie on a bank document. What the methodology
  // has to say instead is that 0% means UNMEASURED — a reader who takes it as
  // "not started" on a job holding signed subcontracts has been misled by the
  // page rather than by the data.
  ok('…and no longer describes a schedule-progress fallback the engine dropped',
    !/average progress across its schedule tasks/.test(PDF),
    'computeWIPReport no longer substitutes schedule progress; the methodology must not claim it does');
  ok('…and says what a 0% actually means',
    /it is 0%,\s*\n?\s*which means UNMEASURED/.test(PDF));
  ok('…and the max-of-THREE cost at completion, including the incurred floor',
    /the greatest of your estimate's cost before markup/.test(PDF)
    && /cost you\s+have already paid out/.test(PDF));
  // The old sentence said cost already paid out is NOT part of it, which stopped
  // being true when the incurred floor landed on 2026-09-10 and stayed on the
  // page for a day. A methodology block that describes arithmetic the code no
  // longer does is its own defect.
  ok('…and the retired claim that paid-out cost is excluded is gone',
    !/already paid out is NOT added to it/.test(PDF),
    'the incurred floor has been live since 2026-09-10; the page must not deny it');
  // PINNED TO THE PARAMETER, NOT TO THE PROSE (adversarial review 2026-09-11).
  // This sentence was TRUE of utils/wip.computeWipRow and FALSE of the engine
  // behind this PDF: computeWIPReport had no cost-to-complete parameter at all,
  // so the block described a methodology the document could not perform, on a
  // page a bank reads. The prose and the capability are asserted together so
  // neither can drift from the other again — remove the parameter and the
  // sentence goes red, keep the parameter and drop the sentence and it goes red
  // too.
  ok('…and it names the cost-to-complete override',
    /Estimated Final Cost =\s*\n?\s*Cost to Date \+ Cost to Complete/.test(PDF));
  ok('…and the engine behind the page can actually do that',
    /costToCompleteByProject: Record<string, number> = \{\}/.test(FIN)
    && /estimatedCostToComplete: costToCompleteByProject\[project\.id\]/.test(FIN),
    'the sentence describes utils/wip.computeWipRow; computeWIPReport must read an ETC too');
  ok('…and BOTH builders read it, not just the WIP tab',
    (FIN.match(/estimatedCostToComplete: costToCompleteByProject\[project\.id\]/g) ?? []).length === 2,
    'the Profit tab is the one every free and Pro user lands on');

  // THE OVER/(UNDER) TOTAL IS NOT A NET (adversarial review 2026-09-11). It was
  // `overbilled − unbilled` across the book, which offsets a LIABILITY (billings
  // in excess of costs) against an ASSET (costs in excess of billings) — the same
  // offsetting the loss-provision disclosure on this very page refuses under ASC
  // 605-35-25-46. A $300,000-over / $300,000-under book printed "$0".
  ok('the PORTFOLIO over/(under) cell prints both sides, netting neither',
    !/overUnderCell\(report\.totals\.overbilled - report\.totals\.unbilled\)/.test(PDF)
    && /fmtMoney\(report\.totals\.overbilled\)\} over/.test(PDF)
    && /fmtMoney\(report\.totals\.unbilled\)\}\) under/.test(PDF));
  ok('…and the methodology says why', /does not net them/.test(PDF));

  // THE PAID COLUMN WAS DROPPED FROM A BANK DOCUMENT and restored. The spec
  // asked for four columns to be ADDED; removing a shipped one was nobody's
  // request, and a reader comparing last month's PDF to this one would find a
  // column simply gone.
  // Count, not presence: the A/R aging table further down this same file also
  // has a "Paid" header, so `includes` stayed true with the WIP column deleted.
  ok('the /reports WIP PDF still prints "Paid"',
    (PDF.match(/header: 'Paid',/g) ?? []).length === 2,
    'one on the WIP table, one on A/R aging');
  ok('…on the row and on the total',
    /fmtMoney\(r\.paidToDate\)/.test(PDF) && /fmtMoney\(report\.totals\.paidToDate\)/.test(PDF));
  ok('…and the methodology states it is CASH, tax-inclusive',
    /Paid is CASH collected against issued invoices/.test(PDF)
    && /tax-inclusive, unlike every\s*\n?\s*contract figure/.test(PDF));

  // F14: A CONTRACT WITH NO COST BASIS PRINTS NO MARGIN. Both engines fall back
  // to a target budget for REVENUE and deliberately not for COST, so such a job
  // reported its entire contract as profit at 100%.
  ok('a job with no cost basis prints an em dash for profit and margin',
    /const measurable = wipReportRowHasCostBasis\(r\);/.test(PDF)
    && (PDF.match(/measurable\s*\n?\s*\?/g) ?? []).length >= 2);
  ok('…the PORTFOLIO profit sums only the measurable jobs',
    /fmtMoney\(report\.totals\.measurableProjectedProfit\)/.test(PDF));
  ok('…and the page names the ones it excluded',
    /carry a contract value with no cost `/.test(PDF)
    || /noCostBasisCount > 0/.test(PDF));
  // The four columns the export dropped. Each is a figure an underwriter reads,
  // and every one of them was already on the row being iterated.
  //
  // A HEADER IS NOT A VALUE (adversarial review 2026-09-11). These four used to
  // be asserted as `header: 'Earned Rev.'` and nothing more, so replacing the
  // row cell with an em dash left an empty column under a correct heading with
  // every guard green. Pin the expression that fills the cell as well as the
  // heading above it.
  const rowCell: [string, RegExp][] = [
    ['Cost to Date', /r\.costToDate == null \? '—' : `<span class="num">\$\{fmtMoney\(r\.costToDate\)\}/],
    ['Cost to Complete', /const ctc = wipRowCostToComplete\(r\);/],
    ['Earned Rev.', /const earned = wipRowEarned\(r\);/],
    ['Over/(Under)', /const overUnder = wipRowOverbilled\(r\) - r\.unbilled;/],
  ];
  for (const [col, valueRe] of rowCell) {
    ok(`the /reports WIP PDF prints "${col}"`, PDF.includes(`header: '${col}'`), col);
    ok(`…and actually renders a value into it`, valueRe.test(PDF), col);
  }
  // …and the three derived ones reach the row array rather than being computed
  // and dropped, which is the shape the column set was in before this pass.
  for (const expr of ['fmtMoney(earned)', 'overUnderCell(overUnder)']) {
    ok(`…"${expr}" is in the row array`, PDF.includes(expr), expr);
  }
  ok('…and the cost-to-complete cell reads ctc, not a recomputation',
    /ctc == null \? '—' : `<span class="num">\$\{fmtMoney\(ctc\)\}/.test(PDF));
  // The PORTFOLIO row's over/under is NOT netted — both sides print — and that
  // one was already pinned; keep it beside its row-level siblings.
  ok('…while the PORTFOLIO row prints both sides rather than a net figure',
    /fmtMoney\(report\.totals\.overbilled\)\} over/.test(PDF)
    && /fmtMoney\(report\.totals\.unbilled\)\}\) under/.test(PDF));
}

// ── 3. AN EMPTY SCHEDULE IS NOT A BANK DOCUMENT ─────────────────────────────
console.log('\nan all-zero WIP schedule cannot be frozen or exported:');
{
  const WIP_SCREEN = read('app/wip-report.tsx');
  const REPORTS = read('app/reports.tsx');

  ok('there is one reason, written once', /const NOTHING_TO_REPORT =/.test(WIP_SCREEN));
  ok('…and it names the prerequisite, not the failure',
    /at least one active project with a cost-and-markup estimate/.test(WIP_SCREEN));
  ok('…and says what a bank would read a zero schedule as',
    /bank or a surety would read as your actual position/.test(WIP_SCREEN));

  ok('Save period refuses with no rows',
    /if \(liveRows\.length === 0\) \{ showAlert\('Nothing to save yet', NOTHING_TO_REPORT\); return; \}/.test(WIP_SCREEN));
  // Locking is irreversible, so it checks the PERIOD it would freeze — a period
  // saved before this guard existed can still be all-zero.
  ok('Lock refuses to freeze an empty period',
    /if \(target\.rows\.length === 0\)/.test(WIP_SCREEN));
  ok('Export CSV refuses',
    /if \(exportPeriod\.rows\.length === 0\) \{ showAlert\('Nothing to export yet', NOTHING_TO_REPORT\); return; \}/.test(WIP_SCREEN));
  ok('Export PDF refuses',
    (WIP_SCREEN.match(/if \(exportPeriod\.rows\.length === 0\)/g) ?? []).length === 2);
  // `displayRows`, not `hasRows`: the Portfolio card follows the period chip
  // now, so a frozen period must be able to render on a book whose projects
  // have since closed — and an empty one must still say so rather than print
  // seven zeros above two Export buttons.
  ok('the zeros themselves are replaced by an explanation, not printed above the buttons',
    /\{displayRows\.length === 0 \? \(/.test(WIP_SCREEN)
    && /'No active projects'\}<\/Text>/.test(WIP_SCREEN));
  ok('…and the blocked buttons say why, visibly',
    /testID="wip-export-blocked"/.test(WIP_SCREEN));
  ok('…and read as unavailable', /actionBtnBlocked/.test(WIP_SCREEN));

  // The sibling screen had the same hole in the opposite place: its EmptyState
  // is inside the tab body and its export bar is in the parent.
  ok('/reports blocks its exports on an empty report',
    /const nothingToExport = exportableRows === 0;/.test(REPORTS));
  ok('…in both handlers',
    (REPORTS.match(/if \(nothingToExport\) \{ showAlert\('Nothing to report yet', blockedReason\); return; \}/g) ?? []).length === 2);
  ok('…and says why beside them', /testID="reports-export-blocked"/.test(REPORTS));

  // A SUCCESS VERDICT MAY NOT BE READ OFF ABSENT DATA. The A/R tab printed
  // "Every invoice is fully paid. Nice work." on an account holding NO invoices
  // at all, and this wave's first pass added "Nothing is owed to you right now"
  // underneath it. Both are the same lie the /cash-flow "Healthy" pill tells.
  // The population is ISSUED invoices, because an account holding nothing but
  // drafts has collected nothing.
  ok('the A/R tab does not congratulate an account with no invoices',
    !/Every invoice is fully paid\. Nice work\./.test(withoutComments(REPORTS)),
    'a collected-in-full verdict is back on the zero-invoice path');
  ok('…it distinguishes "collected" from "never issued"',
    /const collected = anyIssued;/.test(REPORTS) && /No invoices yet/.test(REPORTS));
  ok('…on the export note too, from the same population',
    /issuedInvoices === 0/.test(REPORTS) && /invoices\.filter\(isWipBilling\)/.test(REPORTS));
  ok('…and a draft is not counted as a billing here either',
    !/Nothing is owed to you right now/.test(withoutComments(REPORTS)));

  // And the save confirmation no longer recommends bank review of a period the
  // app has not checked.
  // withoutComments, because the comment ABOVE the alert quotes the old string
  // to say what it replaced. Matching the explanation would fail the fix.
  ok('the snapshot alert no longer invites CPA/bank review unprompted',
    !/Lock it to freeze for CPA\/bank review/.test(withoutComments(WIP_SCREEN)));
  ok('…it asks the GC to top up cost-to-date first',
    /Check cost-to-date and cost-to-complete on each project/.test(WIP_SCREEN));
  // AND IT SAYS WHAT THE SNAPSHOT ACTUALLY IS. Every figure frozen into a
  // period is derived from CURRENT context state — MAGE holds no as-of ledger
  // to restate a closed month from — so a period dated 3/31 saved on 4/10
  // contains ten days of April. Now that the date is pickable, saying so is the
  // difference between a labelling convenience and a misdated document.
  ok('…and admits the figures are current-state, not restated to the period end',
    /AS THEY STAND TODAY/.test(WIP_SCREEN)
    && /does not restate a closed month/.test(WIP_SCREEN));
}

// ── The shape of the contract, so a widening cannot go unnoticed ────────────
console.log('\nthe definition returns both candidates, always:');
{
  const cases: WipEstimatedCost[] = [
    deriveEstimatedCostWithSource(HARLOW, AWARDED, { originalContract: 155_172 }),
    deriveEstimatedCostWithSource(projectWith([400_000]), [sub('SC-9', 520_000, 'x')]),
    deriveEstimatedCostWithSource({ estimate: { grandTotal: 300_000 } } as unknown as Project, []),
    deriveEstimatedCostWithSource({} as unknown as Project, []),
  ];
  for (const c of cases) {
    ok(`a ${c.basis} result carries value, source, and both candidates`,
      typeof c.value === 'number' && typeof c.source === 'string'
      && typeof c.estimateBasis === 'number' && typeof c.committedFloor === 'number',
      JSON.stringify(c));
    ok(`…and value is one of the two candidates (${c.basis})`,
      c.value === c.estimateBasis || c.value === c.committedFloor,
      JSON.stringify(c));
  }
  // A CO-topped estimate is still the estimate candidate, not a third number.
  const topped = deriveEstimatedCostWithSource(
    projectWith([400_000]), [],
    { approvedChangeOrders: 100_000, originalContract: 500_000 });
  close('a CO tops the estimate candidate at the job cost ratio', topped.value, 480_000);
  close('…and estimateBasis is the topped figure, so the sentence matches the number',
    topped.estimateBasis, topped.value);
}

// ── every caller feeds the incurred floor, not just most of them ───────────
//
// `deriveEstimatedCostWithSource` takes cost-already-paid-out as the third
// floor under cost-at-completion. A caller that omits it silently reports the
// ESTIMATE for a job that has burned past it — a profit the job has already
// spent its way out of, on a document a bank underwrites.
//
// There are three call sites, and on 2026-09-10 the floor was wired into two of
// them. /reports floored an overrun job at its real cost while /wip-report kept
// reporting the estimate: two bank-facing schedules, same job, margins 27 points
// apart — the exact divergence the floor had just been added to CLOSE, recreated
// by a partial wiring. An optional parameter that some callers pass is a
// divergence generator, and this is the second time in one day that shape has
// bitten in this repo.
{
  const CALLERS = [
    'app/wip-report.tsx',
    'utils/financialReports.ts',
  ];
  for (const rel of CALLERS) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    const calls = [...src.matchAll(/deriveEstimatedCostWithSource\(/g)].length;
    const fed = [...src.matchAll(/costIncurred:/g)].length;
    ok(`${rel}: every deriveEstimatedCostWithSource call feeds costIncurred`,
      calls > 0 && fed >= calls,
      `${calls} call(s), ${fed} costIncurred. A call that omits it reports the estimate ` +
      'for an overrun job, and disagrees with the sibling schedule that does pass it.');
  }
}

// ── THE SAME CHECK ONE LEVEL UP: THE REPORT BUILDERS' OWN CALL SITES ────────
//
// `costSources` is the argument computeProfitReport's own doc says, in these
// words, "paints a bleeding job green" if omitted — and app/reports.tsx omitted
// it at BOTH call sites, on the tab (Profit) that every free and Pro user lands
// on by default. Cost-to-date there was subcontract payments and nothing else:
// no materials, no self-perform labour, no machine time, no permit fees, while
// app/job-costing.tsx had wired all six for two audits.
//
// scripts/validate-money-definitions.ts already measures bare-vs-wired and
// proves the two differ by $25,600 on its fixture — the repo knew the
// difference and the screen shipped bare. Nothing pinned the CALL SITE. This
// does, the same way the incurred floor above is pinned, because a wired
// argument that some callers pass is what produced the last two divergences in
// this area.
console.log('\nthe report builders are called with everything they take:');
{
  const REPORTS = read('app/reports.tsx');
  const calls = [...REPORTS.matchAll(/compute(?:WIP|Profit)Report\(/g)].length;
  ok('app/reports.tsx calls both report builders', calls === 2, `${calls} call(s)`);
  const wired = [...REPORTS.matchAll(/commitments,\s*costSources,\s*aiaPayApps,\s*etcEntries\)/g)].length;
  ok('…and every one of them is handed costSources, the pay apps AND the cost-to-complete map',
    wired === calls, `${wired} of ${calls} calls wired`);
  // THE ETC MAP HAS TO BE READ, not just passed. It lives in AsyncStorage under
  // utils/wip.wipEtcStorageKey — the same key /wip-report writes — and an
  // `etcEntries` initialised and never hydrated would satisfy the regex above
  // while every /reports figure stayed on the derived forecast, which is the
  // divergence this argument exists to close.
  ok('…and the cost-to-complete map is hydrated from the shared key',
    /AsyncStorage\.getItem\(wipEtcStorageKey\(userId\)\)/.test(REPORTS)
    && /wipEtcValueMap\(normalizeWipEtcMap\(JSON\.parse\(raw\)\)\)/.test(REPORTS),
    'a passed-but-never-loaded map is an empty map, and an empty map is the old behaviour');
  // …AND RE-READ ON FOCUS. Hydrating once per mount meant a cost to complete
  // typed on /wip-report was not reflected here until this screen remounted —
  // two engines fed different maps in one session, which is the same
  // two-schedules-disagree state the map exists to close.
  ok('…and re-read whenever the screen is focused, not once per mount',
    /useFocusEffect\(loadEtc\)/.test(REPORTS) && /useFocusEffect/.test(REPORTS),
    'an ETC typed on /wip-report must reach this tab without a remount');
  // A `costSources` built from an empty literal would satisfy the regex above
  // and change nothing, so pin what it is built FROM. These are the six fields
  // JobCostActualSources carries; app/job-costing.tsx passes the same set.
  for (const field of ['receipts', 'timeEntries', 'laborRates', 'overtimeMultiplier', 'equipment', 'permits']) {
    ok(`…and costSources actually carries ${field}`,
      new RegExp(`const costSources = useMemo\\(\\(\\) => \\(\\{[^}]*\\b${field}\\b`).test(REPORTS));
  }
  ok('…from the hooks that hold them, not from empty arrays',
    /useMaterialReceipts\(\)/.test(REPORTS)
    && /useTimeEntriesMirror\(\)/.test(REPORTS)
    && /useLaborRates\(\)/.test(REPORTS),
    'the receipts, crew hours and rates must come from the same hooks /job-costing uses');
}

// ── THE FLAGSHIP SCREEN SHOWS WHAT IT EXPORTS, AND SAYS WHOSE IT IS ─────────
console.log('\nthe WIP screen renders the period it would export:');
{
  const WIP_SCREEN = read('app/wip-report.tsx');

  // A locked period chip changed `selectedPeriodId`, which fed the Export
  // buttons and nothing else. A GC tapped the locked "2026-03-31" chip, read today's revised
  // contract, today's underbilling and today's weighted margin, pressed Export
  // PDF and mailed March.
  // BEHAVIOUR, NOT SOURCE SHAPE (adversarial review 2026-09-11). This used to be
  // two regexes over the screen's text, and `const viewingFrozen = false`
  // restored the whole defect with every one of them still matching. The
  // decision now lives in a pure selector the validator CALLS.
  {
    const rowOf = (id: string, contract: number): WipSnapshotRowWithSources => {
      const input = {
        originalContract: contract, approvedChangeOrders: 0, totalEstimatedCost: contract * 0.8,
        costToDate: contract * 0.4, billedToDate: contract * 0.3,
      };
      return { projectId: id, projectName: id, input, output: computeWipRow(input) };
    };
    const liveRows = [rowOf('live', 1_000_000)];
    const livePortfolio = computeWipPortfolio(liveRows);
    const marchRows = [rowOf('march', 400_000)];
    const march: WipPeriodWithSources = {
      id: 'per-march', periodEndDate: '2026-03-31', createdAt: '2026-04-01T00:00:00.000Z',
      lockedAt: '2026-04-01T00:00:00.000Z',
      rows: marchRows, portfolioTotals: computeWipPortfolio(marchRows),
    };

    const live = selectWipDisplayPeriod(null, [march], liveRows, livePortfolio);
    ok('with no chip selected the screen shows the LIVE book',
      live.rows === liveRows && live.portfolio === livePortfolio && live.viewingFrozen === false);

    const frozen = selectWipDisplayPeriod('per-march', [march], liveRows, livePortfolio);
    ok('the Portfolio card renders the SELECTED period, not always the live rows',
      frozen.portfolio.revisedContract === 400_000
      && frozen.portfolio.revisedContract !== livePortfolio.revisedContract,
      `got ${frozen.portfolio.revisedContract}`);
    ok('…and so does the project list',
      frozen.rows.length === 1 && frozen.rows[0].projectId === 'march');
    ok('…and the screen knows it is frozen, which is what blocks Save and the edits',
      frozen.viewingFrozen === true && frozen.period?.id === 'per-march');
    // A chip pointing at a period that is not in the list falls back to live —
    // and must NOT report itself frozen, or the screen locks editing on figures
    // that are today's.
    const stale = selectWipDisplayPeriod('gone', [march], liveRows, livePortfolio);
    ok('…while a chip whose period is gone falls back to live, unfrozen',
      stale.rows === liveRows && stale.viewingFrozen === false);
  }
  // …and the screen actually routes through it rather than keeping a second copy.
  ok('the screen takes its display period from the shared selector',
    /selectWipDisplayPeriod\(selectedPeriodId, periods, liveRows, portfolio\)/.test(WIP_SCREEN)
    && /value=\{money\(displayPortfolio\.revisedContract\)\}/.test(WIP_SCREEN)
    && /\) : displayRows\.map\(\(r\) => \{/.test(WIP_SCREEN));

  // THE COST-TO-COMPLETE COMMIT PATH, BY BEHAVIOUR. Inserting an early `return`
  // at the top of `commitDrillEtc` made the top finding's entire fix inert with
  // every guard green, because the guards only matched the surrounding source.
  {
    const NOW = '2026-09-11T12:00:00.000Z';
    const empty = {} as Record<string, { value: number; updatedAt: string }>;
    ok('typing a cost to complete records it',
      applyWipEtcEntry(empty, 'p1', '180000', NOW).p1?.value === 180_000);
    ok('…with the currency furniture a GC types stripped',
      applyWipEtcEntry(empty, 'p1', '$180,000', NOW).p1?.value === 180_000);
    ok('…and ZERO is a deliberate forecast, not an empty box',
      applyWipEtcEntry(empty, 'p1', '0', NOW).p1?.value === 0);
    ok('clearing the box removes the entry so MAGE\u2019s forecast stands again',
      applyWipEtcEntry({ p1: { value: 5, updatedAt: NOW } }, 'p1', '', NOW).p1 === undefined);
    ok('…unparseable text records nothing and leaves the previous forecast',
      applyWipEtcEntry({ p1: { value: 5, updatedAt: NOW } }, 'p1', '1.2.3', NOW).p1?.value === 5);
    ok('…a negative cost to complete is not a forecast',
      applyWipEtcEntry(empty, 'p1', '-5', NOW).p1 === undefined,
      'the minus is stripped before parsing, so "-5" must not become 5 either');
    ok('…and an unchanged value does not re-stamp updatedAt',
      applyWipEtcEntry({ p1: { value: 180_000.4, updatedAt: 'old' } }, 'p1', '180000', NOW)
        .p1.updatedAt === 'old');
    ok('…while a real edit does',
      applyWipEtcEntry({ p1: { value: 180_000, updatedAt: 'old' } }, 'p1', '190000', NOW)
        .p1.updatedAt === NOW);
    ok('…and other projects are untouched',
      applyWipEtcEntry({ p2: { value: 7, updatedAt: 'old' } }, 'p1', '9', NOW).p2.value === 7);
  }
  ok('the drill-in commit routes through that reducer',
    /applyWipEtcEntry\(prev, drillProjectId, drillEtcText, now\)/.test(WIP_SCREEN));
  // …AND THAT CALL IS REACHABLE. The assertion above is a PRESENCE test, and a
  // presence test cannot see an early return placed above the call it looks for.
  //
  // Found 2026-09-11 by mutation, after a review pass had flagged it and a
  // remediation pass had claimed to close it. Inserting `if (drillProjectId)
  // return;` at the top of commitDrillEtc — inverting the guard clause, so the
  // handler no-ops for every real project — makes the estimated-cost-to-complete
  // box record NOTHING, which is the whole of the top WIP blocker: without an
  // ETC the engine floors cost-at-completion at cost-to-date, every overrun job
  // reports exactly 100% complete with $0 backlog BY CONSTRUCTION, and the
  // schedule forecasts that a job already over budget will incur no further
  // cost. All four WIP validators stayed at 100% through that mutation.
  //
  // So pin the SHAPE of the handler, not the presence of a string in it: one
  // guard clause, and it is the negated one. Anything else — a second return, or
  // a positive test on the id — fails here.
  {
    const start = WIP_SCREEN.indexOf('const commitDrillEtc = useCallback(() => {');
    const body = start < 0 ? '' : WIP_SCREEN.slice(start, WIP_SCREEN.indexOf('}, [', start));
    const returns = [...body.matchAll(/\breturn\b/g)].length;
    ok('…and nothing short-circuits the commit before it runs',
      start >= 0 && returns === 1 && /if \(!drillProjectId\) return;/.test(body),
      start < 0
        ? 'commitDrillEtc not found — if it was renamed, re-point this assertion rather than deleting it'
        : `${returns} return statement(s) in commitDrillEtc; expected exactly one, the !drillProjectId guard. ` +
          'An extra return makes the ETC box silently record nothing and every WIP guard stays green.');
  }
  ok('…and a frozen period says so on screen rather than looking like today',
    /testID="wip-frozen-banner"/.test(WIP_SCREEN)
    && /Frozen snapshot — as of/.test(WIP_SCREEN));
  // A frozen row's cost-to-date must not be editable: the period is the
  // document, and the drill-in writes an override.
  ok('…and a frozen row cannot be edited from the list',
    /disabled=\{viewingFrozen\}/.test(WIP_SCREEN));
  // Save builds from TODAY'S book, so with a frozen period on screen it would
  // freeze figures the reader is not looking at — the same class of defect as
  // an Export button that sends a period the screen is not showing.
  ok('…and Save refuses while a saved period is being read, for its own reason',
    /const saveBlockedReason = viewingFrozen/.test(WIP_SCREEN)
    && /accessibilityHint=\{saveBlockedReason \?\? undefined\}/.test(WIP_SCREEN));

  // ONE NOTION OF "THE LATEST PERIOD". `lockTarget`/`handleLock` took
  // periods[0] — insertion order, local-only offline periods prepended in front
  // of a cloud list ordered by created_at — while the fade comparison sorted by
  // periodEndDate. They coincided only because there was no date picker.
  ok('there is one sorted period list and Lock reads it',
    /const periodsByEnd = useMemo\(/.test(WIP_SCREEN)
    && (WIP_SCREEN.match(/periodsByEnd\[0\]/g) ?? []).length === 2,
    'handleLock and lockTarget must both take the latest period by PERIOD END');
  ok('…and periods[0] is gone from both of them',
    !/= selectedPeriodId \? periods\.find\(\(p\) => p\.id === selectedPeriodId\) : periods\[0\]/
      .test(withoutComments(WIP_SCREEN)));
  ok('…and the chips render in that order too',
    /\{periodsByEnd\.map\(\(p\) => \(/.test(WIP_SCREEN));

  // THE PERIOD END IS PICKABLE AND LOCAL. `toISOString().slice(0,10)` is UTC:
  // a save at 5pm Pacific on the 31st dated the period to the 1st of the next
  // month, and there was no way to date a March close on April 10 at all.
  ok('the period end is picked, not stamped',
    /testID="wip-period-end"/.test(WIP_SCREEN) && /<DatePickerModal/.test(WIP_SCREEN));
  ok('…and it defaults to the close a contractor is actually working on',
    /const defaultPeriodEnd = useCallback/.test(WIP_SCREEN)
    && /now\.getDate\(\) <= 14/.test(WIP_SCREEN));
  ok('…from LOCAL calendar components, never the UTC day',
    !/new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/.test(withoutComments(WIP_SCREEN))
    && /todayCalendarDay|toCalendarDayString/.test(WIP_SCREEN),
    'toISOString() names TOMORROW from early evening anywhere west of Greenwich');
  ok('…and the export is dated the same day the save would be',
    /id: 'live', periodEndDate: periodEndDraft,/.test(WIP_SCREEN));

  // THE PDF IS HEADED WITH THE CONTRACTOR'S NAME. It passed the literal
  // 'MAGE ID', so the H1 of the page a GC emails his banker named the software.
  ok('the exported WIP PDF is headed with the CONTRACTOR, not the vendor',
    /shareWipPeriodPdf\(exportPeriod, settings\?\.branding\?\.companyName \|\| 'MAGE ID'/.test(WIP_SCREEN),
    "app/reports.tsx has always read settings.branding.companyName; this passed the string 'MAGE ID'");

  // THE LIVE EXPORT SAYS WHAT DAY ITS FIGURES ARE FROM (adversarial review
  // 2026-09-11). `defaultPeriodEnd` backdates the period end by up to fourteen
  // days inside the first fortnight of a month — which is the day a GC closing
  // his books wants — and `exportPeriod` stamps it onto the LIVE period, so a
  // PDF headed "As of 2026-08-31" left the building carrying September 11
  // figures. MAGE has no as-of ledger and cannot restate them, so the document
  // has to say so; the honest sentence existed only in the Save alert, which
  // neither export passes through.
  ok('both live exports are handed TODAY, so the document can disclose the backdating',
    /wipPeriodToCSV\(exportPeriod, todayCalendarDay\(\)\)/.test(WIP_SCREEN)
    && /shareWipPeriodPdf\(exportPeriod, [^)]*, todayCalendarDay\(\)\)/.test(WIP_SCREEN),
    'without it the PDF prints a period end up to 14 days before the figures it carries');

  // PROFIT FADE REACHES THE EXPORTS, AND THE SCREEN SAYS WHEN IT IS NOT BEING
  // MEASURED (F8 parts 1 and 2). An empty flag column used to read as "no
  // fade" when it meant "not measured" — every new account, and every GC who
  // has not saved twice.
  ok('the SAVED period carries the flags the row was struck with',
    /addPeriod\(\{ periodEndDate, rows: liveRowsWithFlags, portfolioTotals: portfolio \}\)/.test(WIP_SCREEN)
    && /flags: flagWipRow\(r\.output, prior,/.test(WIP_SCREEN),
    'recomputing at export time compares today\'s book, not the comparison the period was struck with');
  ok('…and the LIVE export carries them too',
    /createdAt: new Date\(\)\.toISOString\(\), rows: liveRowsWithFlags/.test(WIP_SCREEN));
  ok('…and the screen states what fade is measured against, or that it is not',
    /testID="wip-fade-basis"/.test(WIP_SCREEN)
    && /Profit fade is not being measured/.test(WIP_SCREEN)
    && /Profit fade is measured against/.test(WIP_SCREEN));
  ok('…including whether the comparison period is locked or merely saved',
    /SAVED but not locked/.test(WIP_SCREEN),
    'the comparison no longer requires lockedAt, and an unlocked prior period can still be edited');

  // A LOSS JOB IS MARKED ON THE LIST. `flagged` excluded anticipatedLoss, so
  // the one condition the engine treats as an accounting event was the one the
  // list did not mark.
  ok('a loss job is flagged on the project list',
    /const flagged = r\.output\.anticipatedLoss/.test(WIP_SCREEN));
  ok('…and labelled in words, not by a bare red triangle',
    /testID="wip-loss-tag"/.test(WIP_SCREEN) && /LOSS JOB<\/Text>/.test(WIP_SCREEN));
  ok('…and the portfolio headline discloses the provision it nets away',
    /testID="wip-loss-provision"/.test(WIP_SCREEN)
    && /Provision to book now/.test(WIP_SCREEN));

  // THE COST TO COMPLETE — the input that stops an overrun job reading 100%.
  ok('the drill-in takes an estimated cost to complete',
    /testID="wip-etc-input"/.test(WIP_SCREEN)
    && /estimatedCostToComplete: etc\?\.value/.test(WIP_SCREEN));
  ok('…and the Source cell says the GC entered it, not that MAGE derived it',
    /totalEstimatedCost: etc \? 'cost_to_complete_entered' : cost\.source/.test(WIP_SCREEN));
  ok('…and the box starts EMPTY, so opening the sheet cannot record a forecast',
    /setDrillEtcText\(existing \? String\(Math\.round\(existing\.value\)\) : ''\)/.test(WIP_SCREEN));
  // With an ETC in force the DERIVED basis is no longer what the row was struck
  // against, so printing describeCostBasis beside it would explain a number the
  // page is not showing — the exact failure the provenance layer exists for.
  ok('…and the basis sentence names the forecast when one is in force',
    /\{drillRow\.etc\s*\n?\s*\? `Cost basis: the \$\{money\(drillInput\.costToDate\)\}/.test(WIP_SCREEN)
    && /: describeCostBasis\(drillRow\.cost, drillInput\.costToDate\)/.test(WIP_SCREEN));
  ok('…and the screen admits the forecast is device-local',
    /saved\s*\n?\s*.{0,20}on THIS device only/.test(WIP_SCREEN)
    || /on THIS device only/.test(WIP_SCREEN));

  // RETAINAGE reaches the schedule at all.
  ok('retainage held is carried onto the row and rendered',
    /retainageHeld: billings\.retainageHeld/.test(WIP_SCREEN)
    && /label="Retainage held"/.test(WIP_SCREEN)
    && /label="Retainage held by owner"/.test(WIP_SCREEN),
    'the portfolio strip AND the per-project drill-in both have to carry it');
  // A period frozen before the column existed must read "not recorded", never
  // $0 — a zero asserts the owner is holding nothing back, which is the
  // opposite of the truth on most contracts.
  ok('…and a period that predates the column says so rather than printing $0',
    /'Not recorded on this period'/.test(WIP_SCREEN) && /'Not recorded'/.test(WIP_SCREEN));

  // The schedule cross-check finally has a caller.
  ok('flagWipRow is given the schedule percent it has always taken',
    /flagWipRow\(r\.output, prior, evm\)/.test(WIP_SCREEN)
    && /const schedulePercentByProject = useMemo/.test(WIP_SCREEN),
    'the evm argument had no three-argument caller, so scheduleDivergence could never fire');
  ok('…but only against TODAY\u2019s schedule, never a frozen row',
    /const evm = viewingFrozen\s*\n?\s*\? undefined/.test(WIP_SCREEN));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
