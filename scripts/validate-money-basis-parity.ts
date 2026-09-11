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
// NOT WIRED INTO ship-check YET. This file needs a package.json entry; the exact
// text is in the wave's handoff notes. scripts/validate-guard-coverage.ts will
// fail until it is added, which is the intended way to notice.
//
// Run via: bun run scripts/validate-money-basis-parity.ts

import {
  deriveEstimatedCostWithSource,
  sumSignedCommitmentValue,
  describeCostBasis,
  describePortfolioCostBasis,
  computeWipRow,
  type WipEstimatedCost,
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
  ok('…and the fallback it actually takes when no cost is recorded',
    /average progress across its schedule tasks/.test(PDF),
    'computeWIPReport falls back to schedule progress; the banker is told the cost formula only');
  ok('…and the max-of-two cost at completion',
    /the greater of your estimate's cost before markup/.test(PDF));
  ok('…and that cost already paid out is not part of it',
    /Cost you have\s+already paid out is NOT added to it/.test(PDF));
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
  ok('the zeros themselves are replaced by an explanation, not printed above the buttons',
    /\{!hasRows \? \(/.test(WIP_SCREEN) && /No active projects<\/Text>/.test(WIP_SCREEN));
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
    /Check cost-to-date on each project before you/.test(WIP_SCREEN));
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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
