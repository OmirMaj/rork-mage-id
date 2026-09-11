// validate-money-definitions.ts — pins ONE definition of "actual cost" across
// the two engines that compute it, pins the path an approved change order
// takes to become money, and pins the two money TERMS a contractor commits to
// that the app captured and then dropped: the contract's timeline, and the
// price he quoted a lead.
//
// WHY THIS EXISTS. The app-experience audit (docs/audits/2026-09-07-app-
// experience-audit.md) named this the single most valuable fix in the product,
// and it is two defects wearing one hat:
//
//   MONEY-DEF-1 — utils/jobCostEngine.ts summed `Invoice.amountPaid` (money the
//     CLIENT paid the GC — revenue) into `actual`, and never read
//     `commitment.paidToDate` at all. So a homeowner's deposit read as budget
//     burn, and a GC who had performed $300K and billed nothing showed Actual
//     $0, spend 0%, "on track to finish under budget". utils/wip.ts used the
//     opposite, correct definition, so two screens in one app answered "what
//     has this job cost me" with incompatible arithmetic — and the wrong one
//     fed the bank-facing WIP tab, the CPI, the margin alerts and the AI.
//     Compounding it, utils/financialReports.ts called the engine with NO
//     receipts and NO time entries, so on those two reports `actual` was 100%
//     client cash.
//
//   MONEY-DEF-2 — an approved change order moved the contract total on six
//     read-only surfaces and had a billable row on none. The GC retyped it by
//     hand, losing the CO number, the approval trail and any double-bill guard,
//     or ate it.
//
// Pins INTENDED semantics:
//   • ACTUAL is money paid OUT: commitment.paidToDate + material receipts +
//     priced crew hours. A client invoice payment moves NOTHING, ever.
//   • jobCostEngine and utils/wip.suggestCostToDate agree, dollar for dollar,
//     on the same commitments + receipts. One definition, two engines.
//   • the two utils/financialReports.ts reports FORWARD receipts/time entries
//     rather than dropping them on the floor.
//   • an approved CO is billable exactly once, through a namespaced key both
//     entry points read from the same helper (source-level — bun cannot import
//     a .tsx screen).
//   • a contract states a start date AND a completion date, or states neither
//     — never half a timeline (CONTRACT-TIME-1).
//   • the price a GC quoted a lead survives the sheet that produced it
//     (QUOTE-PERSIST-1).
//
// Run via: bun run test:money-definitions

import { computeJobCost, describeVariance } from '../utils/jobCostEngine';
import { computeWIPReport, computeProfitReport } from '../utils/financialReports';
import { suggestCostToDate, deriveEstimatedCostWithSource } from '../utils/wip';
import { effectiveEstimateTotal } from '../utils/estimateCommit';
import {
  billedAgainstChangeOrder, changeOrderBillKey, changeOrderBillingState, isChangeOrderBillKey,
  CO_BILL_KEY_PREFIX,
} from '../utils/changeOrderBilling';
import {
  contractTimeline, contractTimelineSentence, suggestContractTimeline,
} from '../utils/contractTimelineCore';
import { quoteTouchBody, quotedFromTouches, QUOTE_LINE } from '../utils/leadQuoteCore';
import { matchCommitmentByVendor } from '../utils/scanRouting';
import {
  billedAgainstMilestones, spreadMilestoneBilling, deriveMilestoneInvoiceLine, isMilestoneBillKey,
  applyMilestoneBilling, contractBilledToDate, attributableContractBilling,
  milestoneBillability, milestoneBlockMessage,
  sovFootingShortfall,
} from '../utils/billingFlowCore';
import { getPaidToDate, resolveContractSum } from '../utils/projectFinancials';
import type {
  Project, Invoice, Commitment, LinkedEstimate, MaterialReceipt, TimeEntry,
  LeadTouch, ProposalTier, TieredProposal,
} from '../types';
// fileURLToPath + join because the repo path contains a space.
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
/** Source with comments dropped — block, line and the JSX `{/* … *\/}` form —
 *  for checks about copy a USER reads rather than what the file explains. */
const stripComments = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
function expect<T>(name: string, got: T, want: T) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log('  ✓', name); }
  else {
    fail++;
    console.log('  ✗', name, '\n      got: ', JSON.stringify(got), '\n      want:', JSON.stringify(want));
  }
}
function close(name: string, got: number, want: number, tol = 0.01) {
  ok(name, Math.abs(got - want) <= tol, `got ${got}, want ${want}`);
}

// ── Fixtures ─────────────────────────────────────────────────────────────
// A $500,000 kitchen priced at a $420,000 cost budget — the audit's own
// example. Budget is seeded from unitPrice × quantity (COST), so the phase
// budgets below are the cost basis, not the sell price.

function estimate(items: { category: string; unitPrice: number }[]): LinkedEstimate {
  const baseTotal = items.reduce((s, i) => s + i.unitPrice, 0);
  return {
    id: 'est', items: items.map((i, n) => ({
      materialId: `m${n}`, name: i.category, category: i.category, unit: 'ls',
      quantity: 1, unitPrice: i.unitPrice, bulkPrice: i.unitPrice, markup: 0,
      usesBulk: false, lineTotal: i.unitPrice, supplier: '',
    })),
    globalMarkup: 0, baseTotal, markupTotal: 0, grandTotal: baseTotal,
    createdAt: '2026-01-01T00:00:00.000Z',
  } as LinkedEstimate;
}

const PROJECT = {
  id: 'p1', name: 'Kitchen', status: 'in_progress',
  linkedEstimate: estimate([{ category: 'Framing', unitPrice: 300_000 }, { category: 'Finishes', unitPrice: 120_000 }]),
} as unknown as Project;

/** A signed sub with some of it paid out. `paidToDate` is the server rollup. */
function sub(amount: number, paidToDate: number, phase: string): Commitment {
  return {
    id: `c-${phase}-${paidToDate}`, projectId: 'p1', number: 'SC-1', type: 'subcontract',
    description: phase, amount, paidToDate, phase, status: 'active',
    signedDate: '2026-01-01', createdAt: '2026-01-01', updatedAt: '2026-01-01',
  } as unknown as Commitment;
}

/** A client invoice the homeowner has paid. This is REVENUE. */
function clientPaid(amount: number, sourceEstimateItemId?: string): Invoice {
  return {
    id: 'inv1', number: 1, projectId: 'p1', type: 'progress',
    issueDate: '2026-03-01', dueDate: '2026-03-31', paymentTerms: 'net_30', notes: '',
    lineItems: [{ id: 'l1', name: 'Progress', description: '', quantity: 1, unit: 'ls', unitPrice: amount, total: amount, sourceEstimateItemId }],
    subtotal: amount, taxRate: 0, taxAmount: 0, totalDue: amount, amountPaid: amount,
    status: 'sent', payments: [], createdAt: '2026-03-01', updatedAt: '2026-03-01',
  } as unknown as Invoice;
}

/** A snapped supplier invoice whose printed total foots to its own lines. */
function receipt(lineTotal: number, category: string): MaterialReceipt {
  return {
    id: `r-${category}-${lineTotal}`, projectId: 'p1', vendor: 'Supply Co',
    lines: [{ id: 'rl1', description: 'Lumber', category, quantity: 1, unit: 'ls', unitPrice: lineTotal, lineTotal }],
    subtotal: lineTotal, total: lineTotal, status: 'reviewed',
  } as unknown as MaterialReceipt;
}

function shift(hours: number, trade: string): TimeEntry {
  return {
    id: `t-${trade}-${hours}`, projectId: 'p1', projectName: 'Kitchen',
    workerId: 'w1', workerName: 'Ana', trade,
    clockIn: '2026-03-02T08:00:00.000Z', clockOut: '2026-03-02T16:00:00.000Z',
    breakMinutes: 0, totalHours: hours, overtimeHours: 0,
    status: 'clocked_out', date: '2026-03-02',
  } as unknown as TimeEntry;
}

// ── 1. ACTUAL is cost paid out, never client revenue ─────────────────────

console.log('\nactual cost is money paid OUT (MONEY-DEF-1):');
{
  // The homeowner pays a $250,000 deposit. Nothing has been paid to anyone.
  const jc = computeJobCost({
    project: PROJECT, commitments: [], invoices: [clientPaid(250_000, 'm0')], changeOrders: [],
  });
  close('a client payment of $250,000 moves actual by $0', jc.actual, 0);
  close('…and spendPercent stays 0', jc.spendPercent, 0);
  ok('…and no phase records it as spend',
    jc.byPhase.every(p => p.actual === 0),
    jc.byPhase.map(p => `${p.phase}:${p.actual}`).join(', '));
  ok('…so the deposit is not reported as an overrun',
    describeVariance(jc.variance).tone !== 'over',
    describeVariance(jc.variance).banner);
}
{
  // A sub has been paid $180,000 against a $300,000 subcontract.
  const jc = computeJobCost({
    project: PROJECT, commitments: [sub(300_000, 180_000, 'Framing')], invoices: [], changeOrders: [],
  });
  close('a $180,000 payment to a sub IS actual cost', jc.actual, 180_000);
  const framing = jc.byPhase.find(p => p.phase === 'Framing');
  close('…attributed to that commitment’s phase', framing?.actual ?? -1, 180_000);
  close('…leaving committed at the full signed amount', framing?.committed ?? -1, 300_000);
}
{
  // The audit's inverse case: $300,000 performed, nothing billed. The old
  // engine reported Actual $0, spend 0%, "on track to finish under budget"
  // on a job that has burned 71% of its cost budget.
  const jc = computeJobCost({
    project: PROJECT,
    commitments: [sub(300_000, 300_000, 'Framing')],
    invoices: [],            // billed the client nothing at all
    changeOrders: [],
  });
  close('performed $300,000 and billed nothing → actual is $300,000', jc.actual, 300_000);
  ok('…and spend reads 71% of budget, not 0%', jc.spendPercent > 70 && jc.spendPercent < 72,
    `spendPercent = ${jc.spendPercent}`);
}
{
  // Receipts and priced labor are additive, and must survive the removal of
  // the invoice loop — deleting that loop without adding paidToDate first
  // zeroed all subcontractor cost, which is how this fix goes wrong.
  const jc = computeJobCost({
    project: PROJECT,
    commitments: [sub(300_000, 100_000, 'Framing')],
    invoices: [clientPaid(400_000, 'm0')],
    changeOrders: [],
    receipts: [receipt(25_000, 'Finishes')],
    timeEntries: [shift(10, 'carpenter')],
    laborRates: { carpenter: 60 },
  });
  close('paid sub + receipt + priced hours sum, client cash excluded',
    jc.actual, 100_000 + 25_000 + 600);
  // `.length`: MONEY-DRILL-1 turned these counters into id arrays so the phase
  // drill-down can name WHICH records built the line. The counts are unchanged.
  const src = jc.byPhase.reduce(
    (t, p) => ({
      commitments: t.commitments + p.sources.commitments.length,
      receipts: t.receipts + p.sources.receipts.length,
      timeEntries: t.timeEntries + p.sources.timeEntries.length,
    }),
    { commitments: 0, receipts: 0, timeEntries: 0 },
  );
  expect('the source counters name only the cost sources', src, { commitments: 1, receipts: 1, timeEntries: 1 });
}

// ── 2. One definition, two engines ───────────────────────────────────────
// utils/wip.suggestCostToDate is what the WIP screen seeds cost-to-date from.
// It and the job-cost engine must not answer this question differently.

console.log('\njobCostEngine and utils/wip agree on cost-to-date:');
{
  const commitments = [sub(300_000, 180_000, 'Framing'), sub(120_000, 40_000, 'Finishes')];
  const receipts = [receipt(25_000, 'Finishes')];
  const jc = computeJobCost({
    project: PROJECT, commitments, invoices: [clientPaid(500_000, 'm0')], changeOrders: [], receipts,
  });
  const wip = suggestCostToDate(commitments, receipts);
  close('the two engines produce the same cost-to-date', jc.actual, wip);
  close('…and it is not the client cash figure', wip, 245_000);
}

// ── 3. The reports forward the cost sources ──────────────────────────────
// financialReports called the engine with no receipts and no time entries, so
// the bank-facing WIP tab and the Profit report reported a cost-to-date that
// excluded every dollar of materials and self-perform labor.

console.log('\nfinancialReports forwards receipts and time entries:');
{
  const commitments = [sub(300_000, 180_000, 'Framing')];
  const costSources = {
    receipts: [receipt(25_000, 'Finishes')],
    timeEntries: [shift(10, 'carpenter')],
    laborRates: { carpenter: 60 },
  };
  const bare = computeProfitReport([PROJECT], [], [], commitments).rows[0];
  const wired = computeProfitReport([PROJECT], [], [], commitments, costSources).rows[0];
  close('profit report cost-to-date without the sources is subs only', bare.costToDate, 180_000);
  close('…and with them includes materials and priced hours', wired.costToDate, 205_600);
  // The margin does NOT move here, and that is the fix rather than a regression.
  // Since the 2026-09-10 polish audit both reports take cost-at-completion from
  // utils/wip.deriveEstimatedCostWithSource — max(estimate cost, signed
  // commitments, cost already paid out) — so $25,600 of materials and crew
  // hours that were INSIDE this fixture's $420,000 estimate do not raise the
  // projected final cost, and must not: spending money you already budgeted is
  // not a cost overrun. What WOULD move it is spending past the estimate, and
  // the incurred floor below is the assertion that proves that path works.
  close('…while the projected final cost stays on the estimate that priced them',
    wired.estimatedFinalCost, bare.estimatedFinalCost);

  // THE PATH THAT MUST MOVE IT: cost past the estimate. The fixture's estimate
  // prices the job at $420,000; hand it $480,000 of incurred cost and the
  // projected final cost has to follow, because a job cannot finish for less
  // than what it has already cost. Before the incurred floor landed
  // (2026-09-10) this returned the estimate and reported a profit the job had
  // already spent its way out of — on the document a surety underwrites.
  const overspent = computeProfitReport([PROJECT], [], [], commitments, {
    ...costSources,
    receipts: [receipt(300_000, 'Finishes')],
    timeEntries: [shift(1000, 'carpenter')],
  }).rows[0];
  ok('cost past the estimate RAISES the projected final cost',
    overspent.estimatedFinalCost > wired.estimatedFinalCost,
    `wired ${wired.estimatedFinalCost}, overspent ${overspent.estimatedFinalCost}`);
  ok('…and therefore cuts the reported margin',
    overspent.projectedMargin < wired.projectedMargin,
    `wired ${wired.projectedMargin}, overspent ${overspent.projectedMargin}`);

  const wipBare = computeWIPReport([PROJECT], [], [], commitments).rows[0];
  const wipWired = computeWIPReport([PROJECT], [], [], commitments, costSources).rows[0];
  ok('WIP percent-complete moves too, so the bank sees the whole cost',
    wipWired.percentComplete > wipBare.percentComplete,
    `bare ${wipBare.percentComplete}, wired ${wipWired.percentComplete}`);
}
{
  // A paid client invoice must not reach cost on the reports either.
  const withCash = computeWIPReport([PROJECT], [clientPaid(400_000, 'm0')], [], []).rows[0];
  close('a $400,000 client payment leaves WIP cost-complete at 0', withCash.percentComplete, 0);
  close('…while still counting as billed to date', withCash.billedToDate, 400_000);
}

// ── 4. No reader of client cash may come back ────────────────────────────
// Source-level: the arithmetic above passes if someone re-adds the loop AND
// the fixtures happen to miss it. The engine must simply never read a payment.

console.log('\nthe engine has no reader of client cash (source-level):');
{
  const engine = read('utils/jobCostEngine.ts');
  const code = engine
    .split('\n')
    .filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
    .join('\n');
  ok('utils/jobCostEngine.ts never reads amountPaid', !/\bamountPaid\b/.test(code),
    'an invoice payment is revenue — see the header');
  ok('…and never iterates invoice line items', !/\.lineItems\b/.test(code));
  ok('…and reads commitment.paidToDate', /paidToDate/.test(code));
  ok('the JobCostLine source counters carry no `invoices` entry',
    !/sources:\s*\{[^}]*\binvoices\b/.test(code),
    'a client invoice contributes nothing, so counting one is a lie on the phase sheet');

  const reports = read('utils/financialReports.ts');
  ok('utils/financialReports.ts forwards cost sources at every computeJobCost call',
    (reports.match(/computeJobCost\(/g) ?? []).length ===
    (reports.match(/computeJobCost\(\{[^}]*\.\.\.costSources[^}]*\}\)/g) ?? []).length,
    'a report that drops receipts/time entries understates cost on a page a bank reads');
}

// ── 5. An approved change order is billable, exactly once ────────────────
// The arithmetic runs here for real — utils/changeOrderBilling.ts exists so it
// can (a .tsx screen cannot be imported under bun, which is why the first cut
// of this section was regex-only). Only the two SCREENS are checked by source,
// and only for the wiring a regex can honestly see.

console.log('\nan approved change order can become an invoice line (MONEY-DEF-2):');

/** An invoice carrying one CO line written by either billing entry point. */
function coInvoice(
  n: number, coId: string, amount: number, status: Invoice['status'],
): Invoice {
  return {
    id: `inv-${n}`, number: n, projectId: 'p1', type: 'progress', progressPercent: 100,
    issueDate: '2026-04-01', dueDate: '2026-05-01', paymentTerms: 'net_30', notes: '',
    lineItems: [{
      id: `l-${n}`, name: 'CO #3', description: '', quantity: 1, unit: 'lump',
      unitPrice: amount, total: amount,
      sourceEstimateItemId: changeOrderBillKey(coId), billedPercent: 100,
    }],
    subtotal: amount, taxRate: 0, taxAmount: 0, totalDue: amount, amountPaid: 0,
    status, payments: [], createdAt: '2026-04-01', updatedAt: '2026-04-01',
  } as unknown as Invoice;
}

{
  const CO = 'co-abc';
  ok('the CO billing key is namespaced', changeOrderBillKey(CO) === 'co:co-abc',
    'a bare co.id could collide with a LinkedEstimateItem.materialId — both are UUIDs');
  ok('…and a plain estimate key is not mistaken for one',
    isChangeOrderBillKey(changeOrderBillKey(CO)) && !isChangeOrderBillKey('m0'));

  const nothing = changeOrderBillingState(CO, 8_400, []);
  expect('an unbilled approved CO is billable in full',
    nothing.kind === 'billable' ? [nothing.remaining, nothing.already] : null, [8_400, 0]);

  // A draft the client has never seen must not consume the CO — but it must be
  // NAMED, or the button quietly writes a second invoice for the same work.
  const drafted = changeOrderBillingState(CO, 8_400, [coInvoice(7, CO, 8_400, 'draft')]);
  expect('a DRAFT invoice does not consume the change order',
    drafted.kind === 'billable' ? drafted.remaining : null, 8_400);
  expect('…but the draft is named so a second one is not made blind',
    drafted.kind === 'billable' ? drafted.pendingDraftNumber : null, 7);

  const partly = changeOrderBillingState(CO, 8_400, [coInvoice(3, CO, 3_400, 'sent')]);
  expect('a part-billed CO offers only the remainder',
    partly.kind === 'billable' ? [partly.remaining, partly.already] : null, [5_000, 3_400]);

  const done = changeOrderBillingState(CO, 8_400, [coInvoice(3, CO, 8_400, 'sent')]);
  expect('a fully billed CO is blocked, and says which invoice took it',
    done.kind === 'fully_billed' ? [done.already, done.invoiceNumber] : null, [8_400, 3]);

  // The whole point of the prefix: another CO's line must not pay this one off.
  const other = changeOrderBillingState(CO, 8_400, [coInvoice(4, 'co-xyz', 8_400, 'sent')]);
  expect('another change order’s invoice line does not bill this one',
    other.kind === 'billable' ? other.remaining : null, 8_400);

  // …and the collision the prefix actually exists for: an ESTIMATE line keys
  // itself with a bare materialId off the same UUID generator, so an unprefixed
  // CO key would let an estimate row silently pay a change order off.
  const estimateLine = coInvoice(5, CO, 8_400, 'sent');
  estimateLine.lineItems[0].sourceEstimateItemId = CO;   // bare id, no 'co:'
  expect('an estimate line whose materialId equals the co.id does not bill it',
    changeOrderBillingState(CO, 8_400, [estimateLine]).kind === 'billable'
      ? (changeOrderBillingState(CO, 8_400, [estimateLine]) as { remaining: number }).remaining
      : null,
    8_400);

  expect('a credit is never a billable row', changeOrderBillingState(CO, -2_400, []).kind, 'credit');
  expect('…nor is a $0 scope-only change order', changeOrderBillingState(CO, 0, []).kind, 'no_value');
  close('and billedAgainstChangeOrder ignores drafts on its own',
    billedAgainstChangeOrder(CO, [coInvoice(7, CO, 8_400, 'draft'), coInvoice(8, CO, 1_000, 'sent')]), 1_000);
}

// Source-level, for the wiring only: that both screens actually reach this
// module, and that the blocked control still explains itself.
{
  const bill = read('app/bill-from-estimate.tsx');
  const co = read('app/change-order.tsx');

  // Anchored to the sources memo, not to the file: the rows memo mentions the
  // same discriminant, so a bare /kind: 'changeOrder'/ still matched after the
  // approved-CO block was deleted (caught while mutation-testing this guard).
  ok('bill-from-estimate’s source rows include approved change orders',
    /const sources: EstimateRowSource\[\][\s\S]{0,1600}status === 'approved'[\s\S]{0,300}kind: 'changeOrder' as const/.test(bill),
    'this is the destination the Friday close routes unbilled CO money to');
  ok('…and every CO row is keyed through changeOrderBillKey',
    /key = changeOrderBillKey\(co\.id\)/.test(bill) && /sourceEstimateItemId: r\.key/.test(bill),
    'the key on the written invoice line IS the double-bill guard');
  ok('…both screens read the shared helper, not a local copy',
    /from '@\/utils\/changeOrderBilling'/.test(bill) && /from '@\/utils\/changeOrderBilling'/.test(co),
    'two implementations of "already billed" is how a CO gets billed twice');

  ok('change-order.tsx offers a billing action for an approved CO',
    /testID="bill-change-order-btn"/.test(co),
    'an approved CO had exactly one router call on this screen, and it went home');
  ok('…and when it cannot be billed the control says why',
    /disabled/.test(co) && /coBilling\.reason/.test(co),
    'a blocked control that does not say why reads as a broken feature');
  // The invoice editor has no add-a-line control (app/invoice.tsx only deletes
  // or voice-appends), so neither screen may tell a GC to add one by hand.
  // Comments are stripped first — the rule is about copy a GC reads, and the
  // two screens each carry a comment explaining exactly why they don't say it.
  ok('neither screen tells the GC to add a negative line by hand',
    !/negative line/i.test(stripComments(co)) && !/negative line/i.test(stripComments(bill)),
    'app/invoice.tsx has no add-a-line form — that instruction cannot be followed');
}

// ── 6. The contract states its own timeline (CONTRACT-TIME-1) ────────────
// `start_date` and `duration_days` are columns that round-trip through the row
// mapping and were set to undefined by both constructors and read by nothing,
// while DEFAULT_TERMS clause 7 binds a change of TIMELINE to a written Change
// Order for a timeline the document never stated.

console.log('\na contract states when work starts and finishes (CONTRACT-TIME-1):');
{
  const t = contractTimeline('2026-03-02', 120);
  expect('120 calendar days from Mar 2 completes Jun 29 (inclusive of day 1)',
    t ? [t.startDate, t.completionDate] : null, ['2026-03-02', '2026-06-29']);
  // The off-by-one that would put a wrong completion date on a signed contract.
  expect('a 1-day job starts and finishes the same day',
    contractTimeline('2026-03-02', 1)?.completionDate, '2026-03-02');
  expect('…and a 2-day job finishes the next day',
    contractTimeline('2026-03-02', 2)?.completionDate, '2026-03-03');
  // A calendar day is a day on a calendar. Crossing a month and a DST boundary
  // must not shift it (US DST starts 2026-03-08).
  expect('the span crosses a DST change without losing a day',
    contractTimeline('2026-03-01', 31)?.completionDate, '2026-03-31');
  expect('…and a leap February is 29 days', contractTimeline('2028-02-01', 29)?.completionDate, '2028-02-29');
}
{
  // Half a timeline is not a timeline. A document must never print a
  // completion date derived from a blank.
  ok('a start date with no duration yields nothing', contractTimeline('2026-03-02', undefined) === null);
  ok('a duration with no start date yields nothing', contractTimeline(undefined, 120) === null);
  ok('a zero duration yields nothing', contractTimeline('2026-03-02', 0) === null);
  ok('a negative duration yields nothing', contractTimeline('2026-03-02', -30) === null);
  ok('a NaN duration yields nothing (the input is free text)', contractTimeline('2026-03-02', Number.NaN) === null);
  ok('a non-date start yields nothing', contractTimeline('soon', 120) === null);
}
{
  const t = contractTimeline('2026-03-02', 120)!;
  const sentence = contractTimelineSentence(t);
  ok('the document sentence names both dates and the day count',
    sentence.includes('Mar 2, 2026') && sentence.includes('Jun 29, 2026') && sentence.includes('120 calendar days'),
    sentence);
  ok('…and says CALENDAR days, not just "days"', /calendar days/.test(sentence), sentence);
  ok('…and ties a change of timeline back to a written Change Order',
    /written Change Order/.test(sentence), sentence);
}
{
  // The suggestion is grounded in the GC's own schedule and states its
  // conversion. 90 working days at 5 days/week is 126 calendar days, and a GC
  // who signed the smaller number would owe the larger one.
  const scheduled = {
    id: 'p1', name: 'Henderson',
    schedule: { startDate: '2026-03-02', totalDurationDays: 90, workingDaysPerWeek: 5, tasks: [] },
  } as unknown as Project;
  const s = suggestContractTimeline(scheduled);
  // 90 working days is 18 five-day weeks: Mon Mar 2 through the Friday of week
  // 18 is 124 calendar days inclusive. NOT the 90 × 7/5 = 126 a back-of-envelope
  // conversion gives — which is why this runs the schedule's own calendar
  // instead of multiplying (the 126 was this guard's first, wrong, expectation).
  ok('a 90-working-day schedule at 5 days/week suggests 124 calendar days',
    s?.durationDays === 124, String(s?.durationDays));
  ok('…finishing on the schedule’s own last working day',
    s?.completionDate === '2026-07-03', s?.completionDate);
  ok('…and the basis states the conversion it made',
    !!s && /90 working days at 5 days\/week/.test(s.basis) && /124 calendar days/.test(s.basis),
    s?.basis);
  ok('…and it is NOT the raw working-day count',
    s?.durationDays !== 90, 'shipping working days under a calendar-day label is the trap');

  const sevenDay = {
    ...scheduled,
    schedule: { startDate: '2026-03-02', totalDurationDays: 90, workingDaysPerWeek: 7, tasks: [] },
  } as unknown as Project;
  ok('a 7-day-a-week schedule suggests exactly its working days',
    suggestContractTimeline(sevenDay)?.durationDays === 90);

  const withClosures = {
    ...scheduled,
    schedule: {
      startDate: '2026-03-02', totalDurationDays: 10, workingDaysPerWeek: 5, tasks: [],
      nonWorkingDates: ['2026-03-05', '2026-03-06'],
    },
  } as unknown as Project;
  const c = suggestContractTimeline(withClosures);
  ok('logged closures push the completion date out and are disclosed',
    c?.durationDays === 16 && /2 logged closures/.test(c.basis), JSON.stringify(c));

  ok('a project with no schedule suggests nothing (never invents a date)',
    suggestContractTimeline({ id: 'p2', name: 'x' } as unknown as Project) === null);
  ok('a schedule with no start date suggests nothing',
    suggestContractTimeline({
      id: 'p3', name: 'x', schedule: { totalDurationDays: 30, workingDaysPerWeek: 5, tasks: [] },
    } as unknown as Project) === null);
}
{
  const engine = read('utils/contractEngine.ts');
  ok('both contract constructors seed the timeline instead of hardcoding undefined',
    (engine.match(/\.\.\.timelineSeed\(/g) ?? []).length === 2
    && !/startDate: undefined/.test(engine),
    'buildDraftContract and buildProposalFromRevision both set it to undefined before CONTRACT-TIME-1');
  ok('…and saveContract still writes both columns',
    /start_date: c\.startDate \?\? null/.test(engine) && /duration_days: c\.durationDays \?\? null/.test(engine));

  const screen = read('app/contract.tsx');
  ok('the contract editor captures a start date and a duration',
    /testID="contract-start-date"/.test(screen) && /testID="contract-duration-days"/.test(screen),
    'the columns existed; nothing on any screen ever set them');
  // THE ONE THIS SECTION SHIPPED GREEN WHILE BROKEN. The first cut imported
  // DatePickerModal, gave the field a testID and an onPress that set
  // `startDatePicker` true — and never RENDERED the modal. Every assertion
  // above passed on a control that could not be operated on any platform.
  // A capture field is not captured until something listens to its state.
  ok('…and the start-date field actually OPENS a picker',
    /setStartDatePicker\(true\)/.test(screen)
    && /<DatePickerModal[\s\S]{0,400}visible=\{startDatePicker\}/.test(screen),
    'the state was set and nothing rendered — a dead tap, not a date');
  // DatePickerModal emits a noon-UTC instant. Reading LOCAL components off it
  // (toCalendarDayString / toIsoDate) names the NEXT day east of UTC+12, which
  // on a binding document is a commencement date the GC did not pick.
  ok('…and stores the day he tapped, not the local day of a UTC instant',
    /onChange=\{\(iso\) => \{[\s\S]{0,200}iso\.slice\(0, 10\)/.test(screen),
    'noon UTC read through local components is tomorrow in UTC+13');
  ok('…and renders the sentence from the shared helper, not its own wording',
    /contractTimelineSentence\(timeline\)/.test(screen));
  ok('…and when it cannot state a timeline it says WHICH half is missing',
    /Add a duration and this contract/.test(screen) && /Add a start date and this contract/.test(screen),
    'a blocked control that does not say why reads as a broken feature');
  ok('…and the schedule suggestion shows its basis before the GC accepts it',
    /timelineSuggestion\.basis/.test(screen),
    'a one-tap fill whose conversion is hidden is a number the GC did not choose');
  ok('the homeowner email states the timeline it asks them to counter-sign',
    /emailTimeline\.completionLabel/.test(screen) && /calendar days/.test(screen));
  ok('…from the same helper, so email and screen cannot name different days',
    /const emailTimeline = contractTimeline\(contract\.startDate, contract\.durationDays\)/.test(screen));
}

// ── 7. The price a GC quoted survives the sheet (QUOTE-PERSIST-1) ────────
// "Mark proposal sent" wrote one sentence to the touch log and nothing else,
// so the tier inclusions, the assumptions and the grounding basis were gone
// the moment the modal closed.

console.log('\nthe quote a GC sent is recoverable (QUOTE-PERSIST-1):');

const tier = (amount: number): ProposalTier => ({
  key: 'better', label: 'Better', tagline: 'Recommended', amount,
  inclusions: ['Demo and haul-off', 'Semi-custom cabinets'],
});
const proposal = (over: Partial<TieredProposal> = {}): TieredProposal => ({
  kind: 'tiered_proposal_v1', tiers: [tier(48_000)], recommendedTier: 'better',
  message: 'Here is our proposal.', assumptions: ['Existing layout retained'],
  source: 'ai', basis: 'history', groundingRateCount: 12, ...over,
} as TieredProposal);
const touch = (body: string, occurredAt: string): LeadTouch =>
  ({ id: body.slice(0, 6) + occurredAt, kind: 'email', body, occurredAt }) as LeadTouch;

{
  const body = quoteTouchBody(tier(48_000), proposal());
  const back = quotedFromTouches([touch(body, '2026-03-03T10:00:00.000Z')]);
  expect('the amount round-trips through the activity log', back?.amount, 48_000);
  ok('…the inclusions survive', /Demo and haul-off/.test(back?.detail ?? ''), back?.detail);
  ok('…the assumptions survive', /Existing layout retained/.test(back?.detail ?? ''), back?.detail);
  ok('…and the grounding basis is recorded WITH the number it qualifies',
    /anchored on 12 learned rates/.test(back?.detail ?? ''), back?.detail);
  ok('a naked AI guess is recorded as one, not as learned rates',
    /no budget or cost history/.test(quoteTouchBody(tier(48_000), proposal({ basis: 'ai_guess' }))),
    'a quote must not read three weeks later as better-grounded than it was');
  ok('the first line stays a human sentence for the timeline',
    body.split('\n')[0] === 'Sent Instant Bid proposal — Better tier.', body.split('\n')[0]);
  ok('…with the machine-readable line anchored on its own line',
    body.split('\n')[1].startsWith(QUOTE_LINE), body.split('\n')[1]);
}
{
  // A hand-typed note that happens to contain a dollar figure is NOT a quote
  // the GC sent — this is the whole reason the marker is anchored.
  const notes = [
    touch('Called — they said $60,000 felt high', '2026-03-04T10:00:00.000Z'),
    touch('Texted about the tile allowance, $2,500 or so', '2026-03-05T10:00:00.000Z'),
  ];
  ok('a hand-typed note with a dollar amount is not read back as a quote',
    quotedFromTouches(notes) === null, JSON.stringify(quotedFromTouches(notes)));
  ok('an empty log yields nothing', quotedFromTouches([]) === null && quotedFromTouches(undefined) === null);
  ok('a $0 quote is not a quote',
    quotedFromTouches([touch(quoteTouchBody(tier(0), proposal()), '2026-03-03T10:00:00.000Z')]) === null);
}
{
  // The failure that matters most: a re-quote must not read back as the
  // original price. Order is decided by occurredAt, not by array position.
  const first = touch(quoteTouchBody(tier(48_000), proposal()), '2026-03-03T10:00:00.000Z');
  const second = touch(quoteTouchBody(tier(52_500), proposal()), '2026-04-10T10:00:00.000Z');
  expect('the LATEST quote wins, whatever order the log is in',
    [quotedFromTouches([second, first])?.amount, quotedFromTouches([first, second])?.amount],
    [52_500, 52_500]);
}
{
  const modal = read('components/InstantBidProposalModal.tsx');
  ok('Mark proposal sent writes the whole quote, not a summary sentence',
    /addLeadTouch\(lead\.id, 'email', quoteTouchBody\(tier, proposal\)\)/.test(modal),
    'the old body was `Sent Instant Bid proposal — ${tier.label} ${formatMoney(tier.amount)}.`');
  const lead = read('app/lead-detail.tsx');
  ok('the lead screen shows what the GC quoted, not only the homeowner’s budget',
    /testID="lead-quoted-card"/.test(lead) && /quotedFromTouches\(existing\?\.touches\)/.test(lead));
  ok('…and labels the homeowner’s range as theirs, so the two are not confused',
    /Budget min \(theirs\)/.test(lead) && /Budget max \(theirs\)/.test(lead));
  ok('…and says where the number came from rather than implying a stored field',
    /from your activity log/.test(lead),
    'Lead has no quotedAmount column; the screen must not pretend otherwise');
}

// ─────────────────────────────────────────────────────────────────────────────
// MONEY-LEDGER-1 — ONE contract, ONE billed-to-date.
//
// Every contract MAGE creates carries a 25/25/25/25 payment schedule, and the
// contract screen puts the milestone "Create invoice" action and a button into
// /bill-from-estimate side by side. A milestone invoice used to be invisible to
// the estimate-keyed ledger, so the billing screen printed "Already billed
// $0.00" over 25/50/75/100% quick-fill buttons: bill the deposit, quick-fill
// 100%, and the homeowner is invoiced 125% of the contract.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nONE contract, ONE billed-to-date (MONEY-LEDGER-1):');
{
  const CONTRACT = 130_052;
  const deposit = { id: 'ms-1', label: 'Deposit (signing)', trigger: 'on_signing', percent: 25, status: 'pending' };
  const line = deriveMilestoneInvoiceLine(deposit as never, CONTRACT);
  close('a 25% deposit milestone bills a quarter of the contract', line.total, 32_513);
  ok('…on a namespaced key, so no estimate row is credited with it',
    isMilestoneBillKey(line.sourceEstimateItemId) && line.sourceEstimateItemId === 'milestone:ms-1',
    line.sourceEstimateItemId);

  // The path that actually runs today: app/invoice.tsx's prefill parser drops
  // line keys, but stamps Invoice.sourceMilestoneId. Both must count.
  const keyed = { status: 'sent', type: 'full', lineItems: [{ ...line }] };
  const legacy = {
    status: 'sent', type: 'full', sourceMilestoneId: 'ms-1',
    lineItems: [{ name: line.name, total: line.total }],
  };
  const draft = { status: 'draft', type: 'full', sourceMilestoneId: 'ms-2', lineItems: [{ name: 'x', total: 40_000 }] };
  close('a keyed milestone line counts', billedAgainstMilestones([keyed] as never), 32_513);
  close('…and so does a legacy invoice that only names its milestone',
    billedAgainstMilestones([legacy] as never), 32_513);
  close('…and a DRAFT counts nothing (wip.ts DEFINITION 1)',
    billedAgainstMilestones([draft] as never), 0);
  close('…and the same invoice is never counted twice',
    billedAgainstMilestones([{ ...keyed, sourceMilestoneId: 'ms-1' }] as never), 32_513);

  // The spread: Σ remaining must be remaining ON THE CONTRACT.
  const sov = [
    { key: 'a', remaining: 18_400 },
    { key: 'b', remaining: 22_600 },
    { key: 'c', remaining: 41_988 },
    { key: 'd', remaining: 47_064 },
  ];
  const total = sov.reduce((t, r) => t + r.remaining, 0);
  const spread = spreadMilestoneBilling(sov, 32_513);
  const charged = Object.values(spread.allocated).reduce((t, v) => t + v, 0);
  close('every milestone dollar lands somewhere', charged, 32_513);
  close('…so a 100% quick-fill bills the contract exactly once, not 125% of it',
    line.total + (total - charged), total);
  ok('…and no row is charged past its own remaining balance',
    sov.every(r => (spread.allocated[r.key] ?? 0) <= r.remaining + 0.005),
    JSON.stringify(spread.allocated));
  close('nothing is left over when the schedule can absorb it', spread.unallocated, 0);

  // Overflow: milestone billing beyond the whole schedule of values.
  const over = spreadMilestoneBilling(sov, 200_000);
  close('billing past the whole SOV floors every row and RETURNS the residue',
    over.unallocated, 200_000 - total);
  ok('…rather than silently reporting a remaining balance that does not exist',
    Object.values(over.allocated).reduce((t, v) => t + v, 0) <= total + 0.005);

  // APPLYING the spread to the rows, executed rather than regex-checked.
  // These eight lines used to live inside app/bill-from-estimate.tsx, where
  // `const share = allocated[r.key] ?? 0` could be neutered to
  // `0 * (allocated[r.key] ?? 0)` — restoring the whole 125% over-bill — with
  // every assertion in this block still green. They are in
  // utils/billingFlowCore now precisely so this can run them.
  type BillRow = { key: string; alreadyBilled: number; remaining: number; billPercent: number };
  const rowsIn: BillRow[] = [
    { key: 'a', alreadyBilled: 0, remaining: 18_400, billPercent: 30 },
    { key: 'b', alreadyBilled: 0, remaining: 22_600, billPercent: 30 },
    { key: 'c', alreadyBilled: 0, remaining: 41_988, billPercent: 30 },
    { key: 'd', alreadyBilled: 0, remaining: 47_064, billPercent: 30 },
    { key: 'co:x', alreadyBilled: 0, remaining: 9_000, billPercent: 30 },
  ];
  const applied = applyMilestoneBilling(rowsIn, 32_513, isChangeOrderBillKey);
  close('the deposit is CHARGED to the rows the screen renders',
    applied.rows.reduce((t, r) => t + r.alreadyBilled, 0), 32_513);
  close('…so Σ remaining is remaining ON THE CONTRACT, not on the estimate',
    applied.rows.filter(r => !isChangeOrderBillKey(r.key)).reduce((t, r) => t + r.remaining, 0),
    total - 32_513);
  const coRow = applied.rows.find(r => r.key === 'co:x')!;
  ok('…and a change-order row is untouched by it (it bills exactly, on its own key)',
    coRow.alreadyBilled === 0 && coRow.remaining === 9_000, JSON.stringify(coRow));
  const consumed = applyMilestoneBilling(rowsIn, 200_000, isChangeOrderBillKey);
  ok('a row the milestones fully consumed cannot arrive preselected at 30%',
    consumed.rows.filter(r => !isChangeOrderBillKey(r.key)).every(r => r.remaining === 0 && r.billPercent === 0),
    JSON.stringify(consumed.rows.map(r => [r.key, r.remaining, r.billPercent])));
  close('…and the residue comes back rather than being swallowed', consumed.unallocated, 200_000 - total);
  const untouched = applyMilestoneBilling(rowsIn, 0, isChangeOrderBillKey);
  ok('no milestone billing changes nothing at all',
    untouched.rows.every((r, i) => r.remaining === rowsIn[i].remaining && r.alreadyBilled === 0));

  // ── THE OTHER DIRECTION, which the first pass left wide open. ───────────
  // Bill the whole schedule of values first, then the four milestones every
  // contract is seeded with, and nothing objected: 200% of the contract.
  const sovInvoice = {
    status: 'sent', type: 'full',
    lineItems: [{ total: CONTRACT, sourceEstimateItemId: 'mat-1' }],
  };
  close('an SOV invoice is invisible to the MILESTONE ledger (it is not milestone billing)',
    billedAgainstMilestones([sovInvoice] as never), 0);
  close('…but it IS contract billing, and that is the figure the milestones must see',
    contractBilledToDate([sovInvoice] as never), CONTRACT);
  const ms = (n: number) => ({ id: `m${n}`, label: `M${n}`, percent: 25, status: 'pending' });
  let wouldBill = CONTRACT;
  for (let i = 1; i <= 4; i++) {
    const b = milestoneBillability({
      milestone: ms(i) as never, contractValue: CONTRACT, contractStatus: 'signed',
      contractBilledToDate: contractBilledToDate([sovInvoice] as never),
    });
    if (b.billable) wouldBill += b.amount;
  }
  close('billing the whole SOV then all four milestones no longer invoices 200% of the contract',
    wouldBill, CONTRACT);
  ok('…and the refusal names the reason a GC can act on', milestoneBillability({
    milestone: ms(1) as never, contractValue: CONTRACT, contractStatus: 'signed',
    contractBilledToDate: CONTRACT,
  }).reason === 'contract_fully_billed');
  {
    // THE REFUSAL MUST STATE ITS OWN ARITHMETIC. The first cut asserted "this
    // project has already been invoiced for the whole contract" on projects
    // invoiced for 75% of it — a sentence the GC disproves by opening his own
    // invoice list, which is how a guard rail teaches people to route around
    // it.
    const blocked = milestoneBillability({
      milestone: ms(1) as never, contractValue: CONTRACT, contractStatus: 'signed',
      contractBilledToDate: CONTRACT,
    });
    // `?? ''` because a mutation that stops the refusal firing leaves
    // `reason` undefined, and a crash here swallowed every later assertion.
    const copy = (blocked.reason
      ? milestoneBlockMessage(blocked.reason, blocked.ceiling, blocked.amount)
      : '') ?? '';
    ok('…with copy that states the actual arithmetic rather than asserting a fact',
      copy.includes('$130,052.00') && copy.includes('$32,513.00')
      && /already been invoiced against contract scope/.test(copy)
      && !/already been invoiced for the whole contract/.test(copy),
      copy);
    ok('…and names both ways out', /Bill from Estimate/.test(copy) && /update the contract value/.test(copy));
  }

  // ── THE CEILING MAY NOT REFUSE ON DOLLARS IT CANNOT ATTRIBUTE ──────────
  // (audit 2026-09-11, review round 3). `contractBilledToDate` counts EVERY
  // non-draft, non-`co:` line, so a single $500 quick invoice consumed
  // milestone capacity and blocked the legitimate final draw at closeout —
  // while app/bill-from-estimate.tsx, on the same dollars, only WARNS and says
  // in its own comment that they are "unattributable BY CONSTRUCTION and not
  // evidence of anything". One screen may not block on what its sibling
  // declines to judge. `attributableContractBilling` is the figure that gates.
  {
    const msInv = (n: number) => ({
      status: 'sent', sourceMilestoneId: `m${n}`,
      lineItems: [{ total: CONTRACT * 0.25, sourceEstimateItemId: null }],
    });
    const quick = { status: 'sent', type: 'full', lineItems: [{ total: 500, sourceEstimateItemId: null }] };
    const three = [msInv(1), msInv(2), msInv(3)];
    close('three milestones plus a $500 quick invoice: what the GC is SHOWN counts everything',
      contractBilledToDate([...three, quick] as never), 98_039);
    close('…but what the ceiling REFUSES on counts only attributable contract billing',
      attributableContractBilling([...three, quick] as never), 97_539);
    const final = milestoneBillability({
      milestone: ms(4) as never, contractValue: CONTRACT, contractStatus: 'signed',
      contractBilledToDate: attributableContractBilling([...three, quick] as never),
    });
    ok('…so the final milestone at closeout is NOT blocked by an unrelated $500 extra',
      final.billable, JSON.stringify(final));
    ok('…while the old, everything-counting figure DID block it',
      !milestoneBillability({
        milestone: ms(4) as never, contractValue: CONTRACT, contractStatus: 'signed',
        contractBilledToDate: contractBilledToDate([...three, quick] as never),
      }).billable,
      'if this ever passes, the two figures have converged and the regression case is dead');
    close('an SOV invoice IS attributable — bill-from-estimate stamps a key on every line',
      attributableContractBilling([sovInvoice] as never), CONTRACT);
    close('a native PROGRESS invoice is attributable whole, keys or not',
      attributableContractBilling([{ status: 'sent', type: 'progress', progressPercent: 30,
        lineItems: [{ total: 100_000, sourceEstimateItemId: null }] }] as never), 30_000);
    close('an ad-hoc line on a non-progress invoice is not attributable',
      attributableContractBilling([quick] as never), 0);
    close('…and a change-order line is not base-contract billing here either',
      attributableContractBilling([{ status: 'sent', type: 'full',
        lineItems: [{ total: 40_000, sourceEstimateItemId: changeOrderBillKey('co-9') }] }] as never), 0);
    close('a DRAFT is not attributable billing', attributableContractBilling(
      [{ ...sovInvoice, status: 'draft' }] as never), 0);
  }
  // …and it must not fire on a clean contract, on partial billing, on drafts,
  // or on change-order billing, which is additional contract value.
  ok('a clean contract still bills all four milestones', [1, 2, 3, 4].every(i => milestoneBillability({
    milestone: ms(i) as never, contractValue: CONTRACT, contractStatus: 'signed', contractBilledToDate: 0,
  }).billable));
  ok('a deposit already billed does not block the second milestone', milestoneBillability({
    milestone: ms(2) as never, contractValue: CONTRACT, contractStatus: 'signed',
    contractBilledToDate: 32_513,
  }).billable);
  close('a DRAFT SOV invoice is not contract billing',
    contractBilledToDate([{ ...sovInvoice, status: 'draft' }] as never), 0);
  close('a CHANGE-ORDER invoice is not base-contract billing',
    contractBilledToDate([{ status: 'sent', type: 'full',
      lineItems: [{ total: 40_000, sourceEstimateItemId: changeOrderBillKey('co-9') }] }] as never), 0);
  ok('…so a change order cannot consume a milestone', milestoneBillability({
    milestone: ms(1) as never, contractValue: CONTRACT, contractStatus: 'signed',
    contractBilledToDate: contractBilledToDate([{ status: 'sent', type: 'full',
      lineItems: [{ total: CONTRACT, sourceEstimateItemId: changeOrderBillKey('co-9') }] }] as never),
  }).billable);
  ok('the two namespaces this depends on have not drifted apart',
    CO_BILL_KEY_PREFIX === 'co:' && /startsWith\('co:'\)/.test(read('utils/billingFlowCore.ts')),
    'contractBilledToDate inlines the prefix; changeOrderBilling.ts owns it');

  // ── THE SOV FOOTING CHECK (F4 / verifier C4). ──────────────────────────
  close('an estimate whose lineTotals foot to its grandTotal reports no gap',
    sovFootingShortfall(155_172, 155_172), 0);
  close('…and one written at COST by Visual Takeoff reports the markup it cannot bill',
    sovFootingShortfall(130_052, 155_172), 25_120);
  close('…a schedule footing ABOVE the estimate is not a shortfall',
    sovFootingShortfall(200_000, 155_172), 0);

  const screen = read('app/bill-from-estimate.tsx');
  // Source-level, because bun cannot import a .tsx — but every number they
  // guard is now computed by a function above, so these only have to prove the
  // screen CALLS them.
  ok('the billing screen reads the milestone ledger',
    /=>\s*billedAgainstMilestones\(existingInvoices\),/.test(screen));
  ok('…and the ROWS the screen renders come from applyMilestoneBilling',
    /const applied = applyMilestoneBilling\(estimateAttributedRows, milestoneBilled, isChangeOrderBillKey\);/
      .test(screen)
    && /rows: applied\.rows, milestoneOverflow: applied\.unallocated/.test(screen),
    'rows must BE the applied result — no arithmetic in the screen for a guard to miss');
  ok('…and the screen no longer re-derives the spread itself',
    !/const share = /.test(screen),
    'the share arithmetic belongs in utils/billingFlowCore where it can be executed');
  ok('…and a cross-ledger gap is named on screen, not left to the client to find',
    /testID="billing-reconciliation"/.test(screen));
  ok('…without accusing the GC of double-billing a Quick Invoice it cannot attribute',
    !/anything billed twice lands on the client/.test(screen)
    && /billed outside this schedule/.test(screen)
    && /Math\.abs\(unaccountedBilling\) > unaccountedThreshold/.test(screen)
    && /const unaccountedThreshold = Math\.max\(50, contractTotal \* 0\.0025\);/.test(screen),
    'Invoice.type never persists as quick, so unattributable billing is not evidence of anything');
  ok('…measured PRE-TAX, the basis the schedule of values is in',
    /invoicedPreTax/.test(screen) && /inv\.subtotal \?\? 0/.test(screen),
    'comparing tax-inclusive totalDue to a pre-tax SOV reports sales tax as unaccounted billing');
  ok('…and a schedule that under-foots the contract says so',
    /testID="sov-footing"/.test(screen) && /sovFootingShortfall\(estimateRowTotal, estimateGrandTotal\)/.test(screen));
  ok('…and the screen offers the projects instead of dead-ending without one',
    /<ToolProjectPicker/.test(screen) && !/Project not found/.test(stripComments(screen)),
    'every sibling money screen mounts a picker; this one printed "Project not found"');

  const contractScreen = read('app/contract.tsx');
  ok('the CONTRACT screen measures a milestone against contract-level billing too',
    /contractBilledToDate: attributableBilled,/.test(contractScreen)
    && /attributableContractBilling\(projectInvoices\)/.test(contractScreen),
    'the reverse direction: SOV billing must be visible to the milestone rows');
  ok('…and gates on the ATTRIBUTABLE figure, never the everything-counting one',
    !/contractBilledToDate: billedOnContract/.test(contractScreen),
    'blocking on unattributable ad-hoc billing refuses the legitimate closeout draw');
  ok('…and shows the GC the figure the refusal is based on',
    /testID="contract-billed-to-date"/.test(contractScreen)
    && /contractBilledToDate\(projectInvoices\)/.test(contractScreen),
    'the displayed line stays the full picture — it is the GATE that narrows');
  ok('…and hands the refusal its arithmetic instead of a bare reason code',
    /milestoneBlockMessage\(bill\.reason!, bill\.ceiling, bill\.amount\)/.test(contractScreen));

  const engine = read('utils/contractEngine.ts');
  ok('…and the 25/25/25/25 schedule this protects against is still seeded on every contract',
    /paymentSchedule: defaultPaymentSchedule\(value\)/.test(engine));
}

// ─────────────────────────────────────────────────────────────────────────────
// JOBCOST-PHASE-1 — buying out a subcontract is a NEUTRAL event.
//
// THE FIXTURES BELOW ARE SHAPED THE WAY app/job-costing.tsx WRITES THEM (audit
// 2026-09-11, review round 2). The first cut of this block hand-set
// `vendorName: 'Northline Electric'` AND `csiDivision: '26'` on a SUBCONTRACT.
// The editor writes neither: `handleSave` sets `subcontractorId` on a
// subcontract and `vendorName` only on a purchase order, and writes no
// csiDivision and no linkedEstimateItems at all (its own comment says so). So
// the guard was green on a record the product cannot produce while the
// reproduction case still reproduced — the worst failure a guard has, because
// its existence stops anyone re-checking.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nbuyout nets against its budget (JOBCOST-PHASE-1):');
{
  const est = {
    id: 'est',
    items: [
      { materialId: 'e1', name: 'Electrical (sub)', category: 'subcontractor', unit: 'LS', quantity: 1,
        unitPrice: 22_600, bulkPrice: 22_600, markup: 0, usesBulk: false, lineTotal: 22_600,
        supplier: 'Northline Electric', csiDivision: '26' },
      { materialId: 'e2', name: 'Recessed cans', category: 'electrical', unit: 'EA', quantity: 24,
        unitPrice: 150, bulkPrice: 150, markup: 0, usesBulk: false, lineTotal: 3_600, supplier: '' },
      { materialId: 'f1', name: 'Finishes', category: 'labor', unit: 'LS', quantity: 1,
        unitPrice: 31_000, bulkPrice: 31_000, markup: 0, usesBulk: false, lineTotal: 31_000, supplier: '' },
    ],
    globalMarkup: 0, baseTotal: 57_200, markupTotal: 0, grandTotal: 57_200,
    createdAt: '2026-01-01T00:00:00.000Z',
  } as unknown as LinkedEstimate;
  const proj = { id: 'p9', name: 'Buyout', status: 'in_progress', linkedEstimate: est } as unknown as Project;

  // EXACTLY what app/job-costing.tsx's CommitmentEditor.handleSave produces for
  // a subcontract: a subcontractorId, a typed phase, and nothing else linking
  // it to the estimate.
  const editorSub = {
    id: 'sc1', projectId: 'p9', number: 'SC-01', type: 'subcontract',
    subcontractorId: 'sub-northline', vendorName: undefined,
    description: 'Electrical rough + trim', amount: 22_600, changeAmount: 0,
    phase: 'Electrical', status: 'active',
    signedDate: '2026-01-10', createdAt: '2026-01-10', updatedAt: '2026-01-10',
  } as unknown as Commitment;
  ok('the fixture is the shape the commitment editor actually writes',
    editorSub.vendorName === undefined && editorSub.csiDivision === undefined
    && editorSub.linkedEstimateItems === undefined && !!editorSub.subcontractorId,
    'app/job-costing.tsx sets vendorName only for purchase_order');

  // (a) With NO subcontractor roster there is no link to find at all — and the
  //     headline must STILL be right, because whether two records can be
  //     joined is a fact about the app, not about the job.
  const bare = computeJobCost({ project: proj, commitments: [editorSub], changeOrders: [] });
  close('an editor-created subcontract does not fabricate an overrun, roster or not',
    bare.variance, 0);
  close('…and the projected final is the budget, not budget + the subcontract',
    bare.projectedFinal, 57_200);

  // (b) With the roster, the ROW is repaired too.
  const wired = computeJobCost({
    project: proj, commitments: [editorSub], changeOrders: [],
    subcontractors: [{ id: 'sub-northline', companyName: 'Northline Electric' }],
  });
  close('the project is not reported over budget for scope it bought out', wired.variance, 0);
  close('…and the EAC is the budget, not the budget plus the subcontract',
    wired.projectedFinal, 57_200);
  ok('…and the trade is ONE row, not "Electrical unbudgeted" beside "electrical $3,600"',
    wired.byPhase.filter(pp => pp.phase.trim().toLowerCase() === 'electrical').length === 1,
    JSON.stringify(wired.byPhase.map(pp => pp.phase)));
  const elec = wired.byPhase.find(pp => pp.phase.trim().toLowerCase() === 'electrical')!;
  close('…carrying the budget the buyout moved onto it', elec.budget, 26_200);
  close('…and the money committed against it', elec.committed, 22_600);
  ok('…and it does not read Unbudgeted', elec.status !== 'unbudgeted', elec.status);
  ok('the emptied estimate bucket is dropped rather than printed as all zeros',
    !wired.byPhase.some(pp => pp.phase === 'subcontractor'),
    JSON.stringify(wired.byPhase.map(pp => pp.phase)));

  // ── (b2) THE SCREEN MUST ACTUALLY PASS THE ROSTER (MONEY-PHASE-WIRED-1,
  //         audit 2026-09-11, review round 3).
  //
  // The roster was added to the signature, used by the buyout match, and
  // documented as required for in-app subcontracts — and passed by ZERO
  // production callers. Every assertion above supplied it from inside this
  // guard, so the suite was green on a world the product could not produce
  // while the ROWS on the real screen still read "Electrical — Unbudgeted".
  // That is the failure this block's own header warns about, reproduced one
  // level up. Measured cost of the omission, same fixture, a $30,000
  // subcontract against a $26,200 electrical budget:
  const unwiredRows = computeJobCost({
    project: proj, changeOrders: [],
    commitments: [{ ...editorSub, amount: 30_000 } as Commitment],
  });
  close('WITHOUT the roster the real overrun is absorbed and reads $0', unwiredRows.variance, 0);
  // Read the ARGUMENT OBJECT, not the file. The first attempt at this
  // assertion regexed the whole screen and stayed green when the property was
  // deleted from the call, because `subcontractors` also appears in the
  // drill-down memo twenty lines below.
  const jcScreenSrc = read('app/job-costing.tsx');
  const callStart = jcScreenSrc.indexOf('return computeJobCost({');
  const callText = callStart < 0 ? '' : jcScreenSrc.slice(callStart, jcScreenSrc.indexOf('});', callStart) + 3);
  ok('…so the screen that renders this MUST hand the engine its subcontractors',
    callStart >= 0 && /\bsubcontractors\b/.test(callText),
    `app/job-costing.tsx called computeJobCost without \`subcontractors\`, so the row-level half `
    + `of this fix never fired on data the product itself creates — call was: ${callText || 'NOT FOUND'}`);
  ok('…and keeps it in the memo dependencies, or the roster goes stale',
    /overtimeMultiplier, equipment, permits, subcontractors\]\);/.test(read('app/job-costing.tsx')),
    'a roster loaded after first render would never reach the engine');
  ok('…and the roster is part of the cost-source bundle reports thread through',
    /\| 'subcontractors'>;/.test(read('utils/jobCostEngine.ts')),
    'JobCostActualSources must carry it so a costSources caller gets it for free');

  // ── (b3) WHAT THE ROWS SHOW AND THE HEADLINE DOES NOT, NAMED. ──────────
  // The project floor absorbs genuinely unbudgeted spend into uncommitted
  // budget. That is correct and it is disclosed — but the rows and
  // `biggestVariances` still show the spend, so a screen printing both with
  // nothing between them gives two answers to "am I over" in one render.
  {
    const absorbed = computeJobCost({
      project: proj, changeOrders: [],
      commitments: [{ ...editorSub, amount: 30_000 } as Commitment],
    });
    ok('the engine reports what the headline absorbed', absorbed.absorbedVariance > 0,
      String(absorbed.absorbedVariance));
    close('…and it is exactly Σ phase EAC less the headline',
      absorbed.absorbedVariance,
      Math.round((absorbed.byPhase.reduce((t, pp) => t + pp.projectedFinal, 0) - absorbed.projectedFinal) * 100) / 100);
    close('a job with nothing absorbed reports zero', wired.absorbedVariance, 0);
    const jcScreen = read('app/job-costing.tsx');
    ok('…and the screen SAYS so beside the variance rows it qualifies',
      /testID="absorbed-variance"/.test(jcScreen)
      && /summary\.absorbedVariance > 1/.test(jcScreen),
      'printing biggestVariances under a $0 headline with no sentence between them is the '
      + 'two-screens-disagree defect moved inside one screen');
    ok('…and the footer no longer describes the arithmetic this wave replaced',
      !/Budget includes approved change orders\. Actual is/.test(jcScreen)
      && /at their estimated COST/.test(jcScreen)
      && /floor ONCE across the whole job/.test(jcScreen),
      'the footer said "Budget includes approved change orders" (they now enter at cost) and '
      + '"uncommitted budget is a floor" (it is now one project-level floor)');
  }

  // (c) A genuine over-commitment must still report OVER. This is what stops
  //     the project-level floor from being a blanket "everything is fine".
  const overrun = computeJobCost({
    project: proj, changeOrders: [],
    commitments: [{ ...editorSub, amount: 90_000 } as Commitment],
  });
  close('a job committed past its whole budget still reports the overrun',
    overrun.variance, 90_000 - 57_200);

  // (d) An overrun on a trade the engine COULD price survives the project term.
  // 26,200 is the electrical bucket after the buyout moves the $22,600 line
  // onto it beside the $3,600 of cans, so $30,000 signed is $3,800 over.
  const overOnBudgeted = computeJobCost({
    project: proj, changeOrders: [],
    commitments: [{ ...editorSub, amount: 30_000 } as Commitment],
    subcontractors: [{ id: 'sub-northline', companyName: 'Northline Electric' }],
  });
  close('a subcontract signed ABOVE the budget it bought out still reports that overrun',
    overOnBudgeted.variance, 30_000 - 26_200);

  // A sub the estimate never priced still reads honestly on the ROW.
  const stranger = { ...editorSub, id: 'sc2', subcontractorId: 'nobody', phase: 'Sitework', amount: 5_000 } as Commitment;
  const r2 = computeJobCost({ project: proj, commitments: [stranger], changeOrders: [] });
  ok('a commitment matching no estimate line is still Unbudgeted on its own row',
    r2.byPhase.find(pp => pp.phase === 'Sitework')?.status === 'unbudgeted');

  // One estimate line cannot net against two subcontracts.
  const twin = { ...editorSub, id: 'sc3', number: 'SC-02', phase: 'Electrical B', signedDate: '2026-02-01' } as Commitment;
  const r3 = computeJobCost({
    project: proj, commitments: [editorSub, twin], changeOrders: [],
    subcontractors: [{ id: 'sub-northline', companyName: 'Northline Electric' }],
  });
  close('two subs cannot both claim the same estimate line', r3.budget, 57_200);

  // ── AN INFERRED SIGNAL MAY NOT OVER-CLAIM ──────────────────────────────
  // Two estimate lines share CSI division 12 — cabinets and countertops, which
  // is the collision __tests__/fixtures/world.ts itself carries. A cabinetry PO
  // took BOTH budgets, and the countertop subcontract signed later at exactly
  // its estimate then read "Unbudgeted, $8,064 over" on a job that was on
  // budget: the same fabricated overrun, one row down.
  const csiEst = {
    id: 'est12',
    items: [
      { materialId: 'cab', name: 'Cabinets', category: 'millwork', unit: 'LS', quantity: 1,
        unitPrice: 41_250, bulkPrice: 41_250, markup: 0, usesBulk: false, lineTotal: 41_250,
        supplier: '', csiDivision: '12' },
      { materialId: 'ctr', name: 'Countertops', category: 'stone', unit: 'LS', quantity: 1,
        unitPrice: 8_064, bulkPrice: 8_064, markup: 0, usesBulk: false, lineTotal: 8_064,
        supplier: '', csiDivision: '12' },
    ],
    globalMarkup: 0, baseTotal: 49_314, markupTotal: 0, grandTotal: 49_314,
    createdAt: '2026-01-01T00:00:00.000Z',
  } as unknown as LinkedEstimate;
  const csiProj = { id: 'p12', name: 'CSI', status: 'in_progress', linkedEstimate: csiEst } as unknown as Project;
  const cabPo = {
    id: 'po12', projectId: 'p12', number: 'PO-77', type: 'purchase_order', vendorName: 'Cascade Cabinet Co.',
    description: 'Cabinetry', amount: 19_900, changeAmount: 0, phase: 'Cabinetry', csiDivision: '12',
    status: 'active', signedDate: '2026-01-05', createdAt: '', updatedAt: '',
  } as unknown as Commitment;
  const stoneSub = {
    id: 'sc12', projectId: 'p12', number: 'SC-78', type: 'subcontract', description: 'Countertops',
    amount: 8_064, changeAmount: 0, phase: 'Stone', csiDivision: '12', status: 'active',
    signedDate: '2026-02-05', createdAt: '', updatedAt: '',
  } as unknown as Commitment;
  const collide = computeJobCost({ project: csiProj, commitments: [cabPo, stoneSub], changeOrders: [] });
  const cabRow = collide.byPhase.find(pp => pp.phase === 'Cabinetry');
  const stoneRow = collide.byPhase.find(pp => pp.phase.toLowerCase() === 'stone');
  close('one commitment cannot absorb the budget of every line sharing its CSI division',
    cabRow?.budget ?? 0, 41_250);
  ok('…so a later buyout of the OTHER scope is not reported as an overrun',
    (stoneRow?.budget ?? 0) === 8_064 && stoneRow?.status !== 'unbudgeted',
    JSON.stringify(collide.byPhase.map(pp => [pp.phase, pp.budget, pp.committed, pp.status])));
  close('…and the job priced at exactly its estimate reports zero variance',
    collide.variance, 0);
  // Buying a $41,250 scope out for $19,900 is a good day, not an over-claim —
  // a single-line claim is always allowed however it is priced.
  const cheapOnly = computeJobCost({ project: csiProj, commitments: [cabPo], changeOrders: [] });
  close('a single line bought out BELOW its estimate still nets against it',
    cheapOnly.byPhase.find(pp => pp.phase === 'Cabinetry')?.budget ?? 0, 41_250);
}

// ─────────────────────────────────────────────────────────────────────────────
// JOBCOST-CO-COST-1 — a change order enters a COST budget at cost.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\na change order enters the cost budget at COST (JOBCOST-CO-COST-1):');
{
  const mkProject = (cost: number, price: number) => ({
    id: 'p2', name: 'CO parity', status: 'in_progress',
    linkedEstimate: {
      id: 'e', items: [{
        materialId: 'm0', name: 'Framing', category: 'Framing', unit: 'ls', quantity: 1,
        unitPrice: cost, bulkPrice: cost, markup: 0, usesBulk: false, lineTotal: price, supplier: '',
      }],
      globalMarkup: 0, baseTotal: cost, markupTotal: price - cost, grandTotal: price,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  } as unknown as Project);
  const mkCo = (amount: number) => ({
    id: 'co9', projectId: 'p2', number: 1, title: 'Add deck', description: 'Add deck',
    status: 'approved', changeAmount: amount, lineItems: [], createdAt: '', updatedAt: '',
  } as unknown as import('../types').ChangeOrder);

  const marked = mkProject(80_000, 100_000);
  close('a $100,000 CO on a 20%-margin job adds $80,000 of COST budget, not $100,000',
    computeJobCost({ project: marked, commitments: [], changeOrders: [mkCo(100_000)] }).budget, 160_000);

  // NUMERIC PARITY, not a text match on utils/wip.ts (audit 2026-09-11, review
  // round 2). The old assertion regex-checked that wip.ts still READ a certain
  // way, and certified a parity that did not hold: jobCostEngine capped the
  // ratio at 1 and wip.ts does not, so on a job estimated at a LOSS the two
  // screens a Business subscriber can open side by side entered the same
  // change order at 50,000 and 60,000. The cap is gone; this measures both
  // engines instead of reading one of them.
  const jobCostCoDelta = (project: Project, amount: number) =>
    computeJobCost({ project, commitments: [], changeOrders: [mkCo(amount)] }).budget
    - computeJobCost({ project, commitments: [], changeOrders: [] }).budget;
  const wipCoDelta = (project: Project, amount: number) => {
    const base = { approvedChangeOrders: 0, originalContract: effectiveEstimateTotal(project) };
    return deriveEstimatedCostWithSource(project, [], { ...base, approvedChangeOrders: amount }).value
      - deriveEstimatedCostWithSource(project, [], base).value;
  };
  for (const [label, cost, price, amount] of [
    ['a 20%-margin job', 80_000, 100_000, 100_000],
    ['a job estimated at a LOSS (cost 120,000 sold at 100,000)', 120_000, 100_000, 50_000],
    ['a zero-margin job', 100_000, 100_000, 25_000],
  ] as [string, number, number, number][]) {
    const project = mkProject(cost, price);
    const a = jobCostCoDelta(project, amount);
    const b = wipCoDelta(project, amount);
    close(`/job-costing and /wip-report enter the same CO at the same cost — ${label}`, a, b);
  }
  ok('…and the fallback with no contract basis is 1.0, never 0',
    /if \(!Number\.isFinite\(contract\) \|\| contract <= 0\) return 1;/.test(read('utils/jobCostEngine.ts')));
  ok('…and the ratio is NOT capped at 1, because topUpForChangeOrders is not',
    !/Math\.min\(1, costBudget \/ contract\)/.test(read('utils/jobCostEngine.ts')),
    'a cap breaks parity on a loss job — the exact defect this function exists to prevent');
}

// ─────────────────────────────────────────────────────────────────────────────
// MONEY-PAID-DRAFT-1 / MONEY-CONTRACT-1 — the two figures the HOMEOWNER reads.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nwhat the homeowner is shown (MONEY-PAID-DRAFT-1, MONEY-CONTRACT-1):');
{
  const sent = { id: 'i1', status: 'sent', totalDue: 40_000, subtotal: 40_000, amountPaid: 40_000 };
  const draftInv = { id: 'i2', status: 'draft', totalDue: 15_000, subtotal: 15_000, amountPaid: 15_000 };
  close('a payment logged against a DRAFT is not money collected',
    getPaidToDate([sent, draftInv] as never), 40_000);
  ok('…so the portal money bar can foot: paid never exceeds invoiced',
    getPaidToDate([sent, draftInv] as never) <= 40_000);

  const proj = {
    id: 'p3', name: 'Signed', status: 'in_progress',
    linkedEstimate: { id: 'e', items: [], globalMarkup: 0, baseTotal: 0, markupTotal: 0,
      grandTotal: 131_502, createdAt: '2026-01-01T00:00:00.000Z' },
  } as unknown as Project;
  expect('a SIGNED contract is the contract sum, not the estimate',
    resolveContractSum(proj, { status: 'signed', contractValue: 155_172 }),
    { value: 155_172, source: 'signed_contract', estimateTotal: 131_502 });
  expect('a SENT contract is an offer, not an agreement — the estimate still stands',
    resolveContractSum(proj, { status: 'sent', contractValue: 155_172 }).source, 'estimate');
  expect('a signed contract with no usable value falls back rather than reporting $0',
    resolveContractSum(proj, { status: 'signed', contractValue: 0 }).value, 131_502);
  expect('no contract at all is the estimate', resolveContractSum(proj, null).source, 'estimate');

  const portal = read('app/client-view.tsx');
  ok('the homeowner portal prints the SIGNED contract, not the estimate',
    /resolveContractSum\(project, contractQ\.data\)/.test(portal));
  ok('…and says which of the two it is showing',
    /testID="contract-sum-source"/.test(portal));
  ok('…and no longer computes the client-facing figure from the estimate alone',
    !/effectiveEstimateTotal\(project\)/.test(stripComments(portal)),
    'app/client-view.tsx used to read `const contractValue = effectiveEstimateTotal(project)`');

  ok('…and reads the shared draft-filtered definitions instead of re-summing inline',
    !/invoices\.reduce\(\(s, i\) => s \+ i\.amountPaid, 0\)/.test(portal)
    && !/invoices\.reduce\(\(s, i\) => s \+ i\.totalDue, 0\)/.test(portal)
    && /getPaidToDate\(invoices\)/.test(portal) && /getInvoicedToDate\(invoices\)/.test(portal),
    'the source fix landed in getPaidToDate; this screen kept its own unfiltered reduce two lines below it');

  // ── THE SNAPSHOT PATH, which is the mode every real homeowner is in. ────
  // `contractQ` is keyed to the LOCAL project and disabled without one, so an
  // anon visitor never fetches a contract and resolveContractSum always
  // answers 'estimate'. The first cut printed "no signed agreement is on file
  // for this project yet" on the same page whose Documents list carries the
  // signed PDF.
  expect('a portal visitor who cannot fetch a contract still gets the estimate figure',
    resolveContractSum(proj, undefined).source, 'estimate');
  ok('…and the screen only asserts an ABSENCE when it could actually check',
    /const contractWasChecked = !isSnapshotMode && !!localProject\?\.id && !contractQ\.isPending;/.test(portal)
    && /contractWasChecked\s*\n?\s*\?\s*'Original Contract is the accepted estimate total — no signed agreement is on file/
      .test(portal),
    'the "no signed agreement" sentence must be behind contractWasChecked');
  ok('…and otherwise points the homeowner at the document that governs',
    /open it under Documents/.test(portal));

  const contractScreen = read('app/contract.tsx');
  ok('the contract screen finally knows change orders exist',
    /getChangeOrdersForProject/.test(contractScreen) && /testID="revised-contract-sum"/.test(contractScreen));
  ok('…and states the current contract sum beside the original',
    /revisedContractSum/.test(contractScreen));
}

// ─────────────────────────────────────────────────────────────────────────────
// MONEY-QBO-1 — the mapper writes into the customer's REAL books.
//
// THESE ASSERTIONS EXECUTE THE MAPPER (audit 2026-09-11, review round 2). The
// first cut of this block was ten `read(file)` regexes, and an adversarial
// review reinstated every one of the three headline defects with the suite
// still at 148 passed / 0 failed:
//   `if (inv.type === 'progress' && !anyPreScaled)` → `if (false)`  (green)
//   `const retentionHeld = retentionPending(inv)` → `0 * …`          (green)
//   `const taxAmount = roundCents(num(inv.tax_amount))` → `= 0`      (green)
//   `const totalsAgree = …` → `= true`                               (green)
//   `accounts.find(/retain/i)?.Id` → `… ?? accounts.at(0)?.Id`       (green)
//   payment.ts `Amount: applied` → `Amount: amount`                  (green)
// A regex cannot see behaviour. This runs the SHIPPED `upsertInvoice` and
// `upsertPaymentForInvoice` and asserts the BODY that was posted and the row
// that was written.
//
// HOW. The two mappers are Deno modules with `.ts` relative imports, so the
// real files are COPIED byte-for-byte into a temp tree beside stubbed
// `qbo.ts` / `financials.ts` / `item.ts` / `customer.ts`. Nothing is rewritten:
// a mutation to the shipped file is picked up on the next run, which is the
// whole point. `paymentMath.ts` is copied too and is the REAL one — the
// retainage basis is exactly what must not be re-implemented here.
//
// The rows are shaped the way PostgREST actually returns them: every NUMERIC
// column is a STRING. `Number.isFinite("75595")` is false, and the first cut
// of the mapper tested it directly.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nthe QuickBooks invoice is the invoice (MONEY-QBO-1):');
{
  const dir = mkdtempSync(join(tmpdir(), 'mage-qbo-'));
  mkdirSync(join(dir, '_shared', 'qbo-mapping'), { recursive: true });
  const S = join(ROOT, 'supabase', 'functions', '_shared');
  copyFileSync(join(S, 'paymentMath.ts'), join(dir, '_shared', 'paymentMath.ts'));
  copyFileSync(join(S, 'qbo-mapping', 'invoice.ts'), join(dir, '_shared', 'qbo-mapping', 'invoice.ts'));
  copyFileSync(join(S, 'qbo-mapping', 'payment.ts'), join(dir, '_shared', 'qbo-mapping', 'payment.ts'));

  writeFileSync(join(dir, '_shared', 'qbo.ts'), `
export interface QboConnectionRow { realm_id?: string }
const H = () => (globalThis as any).__QBO_HARNESS;
export async function qboFetch(_c: unknown, path: string, init: any) { return H().fetch(path, init); }
export async function qboHash(_o: unknown) { return 'HASH'; }
function thenable() {
  const o: any = { eq: () => o, then: (r: (v: any) => void) => r({ error: null }) };
  return o;
}
export function svc() {
  return {
    from(table: string) {
      const q: any = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: H().db[table] ?? null, error: null }),
        update: (patch: any) => { H().updates.push({ table, patch }); return thenable(); },
      };
      return q;
    },
  };
}
`);
  writeFileSync(join(dir, '_shared', 'qbo-mapping', 'financials.ts'), `
export interface LinkedEstimateItem { materialId: string; name: string; qboItemId?: string }
export async function readLinkedEstimateItems() {
  return ((globalThis as any).__QBO_HARNESS.linkedItems ?? []) as LinkedEstimateItem[];
}
`);
  writeFileSync(join(dir, '_shared', 'qbo-mapping', 'item.ts'), `export async function upsertItem() {}\n`);
  writeFileSync(join(dir, '_shared', 'qbo-mapping', 'customer.ts'), `export async function upsertCustomer() {}\n`);

  const invMod = await import(pathToFileURL(join(dir, '_shared', 'qbo-mapping', 'invoice.ts')).href) as
    { upsertInvoice: (c: unknown, id: string, u: string) => Promise<void> };
  const payMod = await import(pathToFileURL(join(dir, '_shared', 'qbo-mapping', 'payment.ts')).href) as
    { upsertPaymentForInvoice: (c: unknown, id: string, u: string) => Promise<void> };

  type Posted = { path: string; body: Record<string, unknown> };
  interface HarnessOpts {
    invoice: Record<string, unknown>;
    /** What QuickBooks says it recorded. Defaults to the body's own arithmetic. */
    postedTotal?: number | null;
    /** Other Current Asset accounts QuickBooks reports. */
    accounts?: { Id: string; Name: string }[];
    /** QuickBooks' OWN sales tax, when it overrides the one MAGE sent
     *  (Automated Sales Tax). Undefined = it accepts ours. */
    qboTax?: number;
    /** QuickBooks rejects the retainage Item — the provisioning failure path. */
    itemFails?: boolean;
    /** QuickBooks answers 200 but with no Item.Id — the other failure shape. */
    itemNoId?: boolean;
    payments?: unknown;
    balance?: number;
  }
  function install(o: HarnessOpts) {
    const posts: Posted[] = [];
    const updates: { table: string; patch: Record<string, unknown> }[] = [];
    (globalThis as { __QBO_HARNESS?: unknown }).__QBO_HARNESS = {
      db: { invoices: o.invoice, projects: { qbo_customer_id: 'CUST-1' } },
      updates,
      linkedItems: [],
      fetch(path: string, init: { method?: string; body?: string }) {
        if (init?.method === 'GET' && path.startsWith('/query')) {
          if (/from Item/.test(decodeURIComponent(path))) return { QueryResponse: {} };
          return { QueryResponse: { Account: o.accounts ?? [] } };
        }
        if (init?.method === 'GET' && path.startsWith('/invoice/')) {
          return { Invoice: { SyncToken: '3', Balance: o.balance ?? 0 } };
        }
        const body = init?.body ? JSON.parse(init.body) as Record<string, unknown> : {};
        posts.push({ path, body });
        if (path === '/account') return { Account: { Id: 'ACCT-RET' } };
        if (path === '/item') {
          if (o.itemFails) {
            throw new Error('QBO 400: Business Validation Error: You must specify an income account');
          }
          if (o.itemNoId) return { Item: {} };
          return { Item: { Id: 'ITEM-RET' } };
        }
        if (path === '/payment') return { Payment: { Id: 'PAY-1' } };
        // ── QUICKBOOKS RECOMPUTES THE LINE AMOUNT FROM Qty × UnitPrice ────
        // The mapper's own comment says so — "QuickBooks recomputes the line
        // amount from those two on some paths, so a body where they disagree
        // is a body whose posted total is not the one we checked". This
        // harness used to sum `Amount` alone, i.e. it modelled QuickBooks with
        // exactly the assumption the code calls unsafe, and the two mutations
        // that matter passed straight through it:
        //   `const unitPrice = billed / qty` → `num(li.unitPrice)`   (green)
        //   retainage `UnitPrice: -retentionHeld` → `retentionHeld`  (green)
        // A line carrying a SalesItemLineDetail is priced the way QuickBooks
        // prices it; a DescriptionOnly line has no Qty/UnitPrice to recompute
        // from, so its Amount stands.
        const lines = (body.Line as {
          Amount?: number; SalesItemLineDetail?: { Qty?: number; UnitPrice?: number };
        }[] | undefined) ?? [];
        const lineSum = Math.round(lines.reduce((s, l) => {
          const d = l.SalesItemLineDetail;
          const recomputed = d && typeof d.Qty === 'number' && typeof d.UnitPrice === 'number'
            ? d.Qty * d.UnitPrice
            : (l.Amount ?? 0);
          return s + recomputed;
        }, 0) * 100) / 100;
        const sentTax = ((body.TxnTaxDetail as { TotalTax?: number } | undefined)?.TotalTax) ?? 0;
        // Automated Sales Tax: QuickBooks substitutes its own tax figure.
        const tax = o.qboTax === undefined ? sentTax : o.qboTax;
        const auto = Math.round((lineSum + tax) * 100) / 100;
        return {
          Invoice: {
            Id: 'QBO-1',
            TotalAmt: o.postedTotal === undefined ? auto : o.postedTotal,
            ...(tax > 0 ? { TxnTaxDetail: { TotalTax: tax } } : {}),
          },
        };
      },
    };
    return { posts, updates };
  }
  /** The /invoice post, i.e. the body that became the customer's receivable.
   *  `{}` when nothing was posted — a refused push is a legitimate outcome to
   *  assert about, and a non-null assertion here crashed the whole suite on
   *  exactly the mutations the block exists to catch. */
  const invoiceBody = (posts: Posted[]): Record<string, unknown> =>
    posts.find(p => p.path.startsWith('/invoice'))?.body ?? {};
  const lineSumOf = (body: Record<string, unknown>) => Math.round(
    ((body.Line as { Amount?: number }[]) ?? []).reduce((s, l) => s + (l.Amount ?? 0), 0) * 100) / 100;
  /** Run the shipped mapper and return the error message, '' on success.
   *  Without this a mutation that makes the post-condition refuse killed the
   *  whole script on an unhandled rejection — a red, but a red that swallowed
   *  every later assertion and printed no summary. */
  const pushInvoice = async (): Promise<string> => {
    try { await invMod.upsertInvoice({}, 'inv-1', 'u1'); return ''; }
    catch (e) { return String((e as Error)?.message ?? e); }
  };
  /** Every priced line must satisfy Qty × UnitPrice === Amount to the cent —
   *  the invariant the mapper's own comment says QuickBooks relies on. */
  const qtyTimesPriceFoots = (body: Record<string, unknown>) =>
    ((body.Line as {
      Amount?: number; SalesItemLineDetail?: { Qty?: number; UnitPrice?: number };
    }[]) ?? []).every(l => {
      const d = l.SalesItemLineDetail;
      if (!d) return true;
      return Math.abs((d.Qty ?? 0) * (d.UnitPrice ?? 0) - (l.Amount ?? 0)) <= 0.01;
    });

  const baseRow = {
    id: 'inv-1', user_id: 'u1', project_id: 'p1', number: 12,
    issue_date: '2026-03-01', due_date: '2026-03-31', notes: null,
    qbo_id: null, qbo_hash: null,
    retention_percent: null, retention_amount: null, retention_released: null,
    tax_amount: null, progress_percent: null, type: null,
  };

  // ── A. a 30% progress billing of a $100,000 line posts $30,000 ──────────
  {
    const h = install({
      invoice: {
        ...baseRow, type: 'progress', progress_percent: '30',
        line_items: [{ id: 'l1', name: 'Framing', quantity: 1, unitPrice: 100000, total: 100000 }],
        subtotal: '30000', total_due: '30000',
      },
    });
    ok('the push succeeded', await pushInvoice() === '');
    close('a 30% progress billing of a $100,000 line posts $30,000, not $100,000',
      lineSumOf(invoiceBody(h.posts)), 30000);
    ok('…and the QuickBooks line says WHY it is not the full scope',
      /30% progress billing/.test(JSON.stringify(invoiceBody(h.posts).Line)));
    ok('…and the row is marked synced', h.updates.at(-1)?.patch.qbo_sync_status === 'synced');
    ok('…and Qty × UnitPrice EQUALS Amount on every priced line',
      qtyTimesPriceFoots(invoiceBody(h.posts)),
      JSON.stringify(invoiceBody(h.posts).Line));
  }

  // ── A2. Qty × UnitPrice is the invariant, stated as its own case ────────
  // The mapper's comment calls this load-bearing: "QuickBooks recomputes the
  // line amount from those two on some paths, so a body where they disagree is
  // a body whose posted total is not the one we checked". NOTHING used to
  // assert it — mutating `const unitPrice = billed / qty` to
  // `num(li.unitPrice)` (a 30% progress line then carrying the FULL unit
  // price) left the suite at 198 passed / 0 failed.
  {
    const h = install({
      invoice: {
        ...baseRow, type: 'progress', progress_percent: '30',
        line_items: [
          { id: 'l1', name: 'Framing', quantity: 4, unitPrice: 25000, total: 100000,
            sourceEstimateItemId: 'mat-1' },
        ],
        subtotal: '30000', total_due: '30000',
      },
    });
    (globalThis as { __QBO_HARNESS?: { linkedItems?: unknown } }).__QBO_HARNESS!.linkedItems =
      [{ materialId: 'mat-1', name: 'Framing', qboItemId: 'ITEM-9' }];
    ok('the push succeeded', await pushInvoice() === '');
    const body = invoiceBody(h.posts);
    const d = ((body.Line as { SalesItemLineDetail?: { Qty?: number; UnitPrice?: number } }[] | undefined)
      ?.[0]?.SalesItemLineDetail) ?? {};
    close('a scaled line carries the SCALED unit price, not the estimate\u2019s', d.UnitPrice ?? 0, 7500);
    close('…with the quantity the invoice actually holds', d.Qty ?? 0, 4);
    ok('…so Qty × UnitPrice foots to Amount and QuickBooks cannot repost the full scope',
      qtyTimesPriceFoots(body), JSON.stringify(body.Line));
    ok('…and the row is synced', h.updates.at(-1)?.patch.qbo_sync_status === 'synced');
  }

  // ── B. the Houston row: tax carried, retainage withheld as its own line ──
  {
    const h = install({
      invoice: {
        ...baseRow,
        line_items: [{ id: 'l1', name: 'Work', quantity: 1, unitPrice: 75595, total: 75595 }],
        subtotal: '75595', tax_amount: '5669.63', total_due: '81264.63',
        retention_percent: '5', retention_amount: '4063.23', retention_released: '0',
      },
      accounts: [{ Id: 'ACCT-1', Name: 'Inventory Asset' }, { Id: 'ACCT-9', Name: 'Retainage Receivable' }],
    });
    ok('the push succeeded', await pushInvoice() === '');
    const body = invoiceBody(h.posts);
    const lines = (body.Line ?? []) as { Amount: number; Description?: string; SalesItemLineDetail?: { ItemRef?: { value?: string } } }[];
    close('a taxed, 5%-retainage invoice posts work less retainage', lineSumOf(body), 71815.25);
    close('…with sales tax carried on the body',
      (body.TxnTaxDetail as { TotalTax?: number } | undefined)?.TotalTax ?? 0, 5669.63);
    const ret = lines.find(l => /Retainage withheld/.test(l.Description ?? ''));
    close('…and retainage as an explicit NEGATIVE line, 5% of the WORK value', ret?.Amount ?? 0, -3779.75,
      );
    ok('…so QuickBooks totals to exactly what the Pay button charges',
      Math.abs((lineSumOf(body) + 5669.63) - 77484.88) <= 0.01,
      `got ${lineSumOf(body) + 5669.63}`);
    ok('…and NOT to the stale stored retention_amount (MONEY-05 basis)',
      !lines.some(l => Math.abs((l.Amount ?? 0) + 4063.23) < 0.01));
    ok('retainage is booked to a RETAINAGE account, never the first asset account QuickBooks lists',
      ret?.SalesItemLineDetail?.ItemRef?.value === 'ITEM-RET'
      && h.posts.some(p => p.path === '/item'
        && (p.body.IncomeAccountRef as { value?: string })?.value === 'ACCT-9'),
      JSON.stringify(h.posts.filter(p => p.path === '/item')));
    // THE SIGN, on its own line. Flipping `UnitPrice: -retentionHeld` to
    // `retentionHeld` — retainage ADDED to the invoice instead of withheld —
    // used to leave this suite at 198 passed / 0 failed, because nothing read
    // a UnitPrice and the harness summed Amount alone.
    const retDetail = (ret as { SalesItemLineDetail?: { Qty?: number; UnitPrice?: number } })
      ?.SalesItemLineDetail;
    close('…whose UnitPrice is NEGATIVE, because retainage is withheld, not charged',
      retDetail?.UnitPrice ?? 0, -3779.75);
    ok('…and every line still foots Qty × UnitPrice === Amount',
      qtyTimesPriceFoots(body), JSON.stringify(body.Line));
  }

  // ── B2. AUTOMATED SALES TAX: QuickBooks recomputes the tax ──────────────
  // The body carries MAGE's `tax_amount` and the file's own comment says
  // QuickBooks may override it. The first post-condition compared the WHOLE
  // total against MAGE's figure, so on an AST company every taxed invoice
  // POSTED and was then marked error and thrown — and the reconciler re-pushed
  // it five times, failing identically. The work total is what MAGE owns.
  {
    const h = install({
      invoice: {
        ...baseRow,
        line_items: [{ id: 'l1', name: 'Work', quantity: 1, unitPrice: 75595, total: 75595 }],
        subtotal: '75595', tax_amount: '5669.63', total_due: '81264.63',
      },
      qboTax: 6200.14,
    });
    ok('the push succeeded', await pushInvoice() === '');
    const patch = h.updates.at(-1)?.patch ?? {};
    ok('QuickBooks recomputing SALES TAX does not fail the sync', patch.qbo_sync_status === 'synced',
      String(patch.qbo_error ?? ''));
    ok('…the hash IS stored, so the next push is the no-op it should be', patch.qbo_hash === 'HASH');
    ok('…and the difference is recorded on the row rather than swallowed',
      /its own tax codes recomputed it/.test(String(patch.qbo_error))
      && /\$530\.51/.test(String(patch.qbo_error)),
      String(patch.qbo_error));
  }

  // ── B3. a WORK total QuickBooks did not record is still refused ─────────
  // The tolerance above is for TAX only. If the pre-tax work total moves, the
  // number MAGE is the authority on is wrong in the customer's books.
  {
    const h = install({
      invoice: {
        ...baseRow,
        line_items: [{ id: 'l1', name: 'Work', quantity: 1, unitPrice: 75595, total: 75595 }],
        subtotal: '75595', tax_amount: '5669.63', total_due: '81264.63',
      },
      qboTax: 5669.63, postedTotal: 61264.63,
    });
    let threw = '';
    try { await invMod.upsertInvoice({}, 'inv-1', 'u1'); } catch (e) { threw = (e as Error).message; }
    ok('a WORK total QuickBooks did not record is refused out loud',
      /WORK totals disagree/.test(threw), threw);
    ok('…and the row says it is not a tax difference',
      /not QuickBooks recomputing sales tax/.test(String(h.updates.at(-1)?.patch.qbo_error)),
      String(h.updates.at(-1)?.patch.qbo_error));
  }

  // ── B4. QuickBooks refuses the retainage Item ───────────────────────────
  // The harness used to answer every `/item` with an id, so the provisioning
  // failure path — three new objects written into a customer's real books,
  // the largest blast radius in this wave — had no coverage at all. MAGE
  // refuses rather than posting the invoice gross of retainage; what this
  // pins is that the refusal posts NOTHING and carries the remedy.
  {
    const h = install({
      invoice: {
        ...baseRow,
        line_items: [{ id: 'l1', name: 'Work', quantity: 1, unitPrice: 75595, total: 75595 }],
        subtotal: '75595', total_due: '75595',
        retention_percent: '5', retention_released: '0',
      },
      accounts: [{ Id: 'ACCT-9', Name: 'Retainage Receivable' }],
      itemFails: true,
    });
    let threw = '';
    try { await invMod.upsertInvoice({}, 'inv-1', 'u1'); } catch (e) { threw = (e as Error).message; }
    ok('a rejected retainage Item does NOT post an invoice gross of retainage',
      !h.posts.some(p => p.path.startsWith('/invoice')), JSON.stringify(h.posts.map(p => p.path)));
    ok('…and the refusal tells the GC exactly what to create in QuickBooks',
      /Products & services/.test(threw) && /Other Current Asset/.test(threw)
      && /will not post the invoice gross of retainage/.test(threw), threw);

    // The OTHER failure shape: QuickBooks answers 200 with no Item.Id. Same
    // rule — nothing posts, and the message is the same remedy, not
    // "QuickBooks did not return an Item.Id".
    const h2 = install({
      invoice: {
        ...baseRow,
        line_items: [{ id: 'l1', name: 'Work', quantity: 1, unitPrice: 75595, total: 75595 }],
        subtotal: '75595', total_due: '75595',
        retention_percent: '5', retention_released: '0',
      },
      accounts: [{ Id: 'ACCT-9', Name: 'Retainage Receivable' }],
      itemNoId: true,
    });
    const threw2 = await pushInvoice();
    ok('…and it carries QuickBooks\u2019 own fault text so the cause is diagnosable',
      /Business Validation Error/.test(threw) && /QuickBooks refused to create/.test(threw), threw);
    ok('an Item response with no id refuses too, and posts no invoice',
      !h2.posts.some(p => p.path.startsWith('/invoice'))
      && /Products & services/.test(threw2)
      && /will not post the invoice gross of retainage/.test(threw2), threw2);
  }

  // ── B5. no retainage account exists → CREATE one, never borrow ──────────
  // Case B proves the RIGHT account wins when one exists, which a
  // `?? accounts.at(0)?.Id` fallback also satisfies — so that mutation stayed
  // green. This is the case that distinguishes them: the company lists only
  // "Inventory Asset". Booking withheld retainage there is not a smaller error
  // than posting gross; it lands in an account the GC reconciles against his
  // bank.
  {
    const h = install({
      invoice: {
        ...baseRow,
        line_items: [{ id: 'l1', name: 'Work', quantity: 1, unitPrice: 10000, total: 10000 }],
        subtotal: '10000', total_due: '10000',
        retention_percent: '10', retention_released: '0',
      },
      accounts: [{ Id: 'ACCT-1', Name: 'Inventory Asset' }, { Id: 'ACCT-2', Name: 'Undeposited Funds' }],
    });
    ok('the push succeeded', await pushInvoice() === '');
    const madeAccount = h.posts.find(p => p.path === '/account');
    ok('a company with no retainage account gets one CREATED',
      !!madeAccount && madeAccount.body.Name === 'Retainage Receivable'
      && madeAccount.body.AccountType === 'Other Current Asset',
      JSON.stringify(h.posts.map(p => p.path)));
    const madeItem = h.posts.find(p => p.path === '/item');
    ok('…and the retainage item points at THAT account, not Inventory Asset',
      (madeItem?.body.IncomeAccountRef as { value?: string } | undefined)?.value === 'ACCT-RET',
      JSON.stringify(madeItem?.body));
  }

  // ── C. QuickBooks disagrees → refuse, and do not store the hash ─────────
  {
    const h = install({
      invoice: {
        ...baseRow,
        line_items: [{ id: 'l1', name: 'Work', quantity: 1, unitPrice: 75595, total: 75595 }],
        subtotal: '75595', tax_amount: '5669.63', total_due: '81264.63',
        retention_percent: '5', retention_released: '0',
      },
      accounts: [{ Id: 'ACCT-9', Name: 'Retainage Receivable' }],
      postedTotal: 99999,
    });
    let threw = '';
    try { await invMod.upsertInvoice({}, 'inv-1', 'u1'); } catch (e) { threw = (e as Error).message; }
    ok('a total QuickBooks did not record is refused out loud',
      /QuickBooks recorded \$99999\.00/.test(threw) && /MAGE billed \$77484\.88/.test(threw), threw);
    const patch = h.updates.at(-1)?.patch ?? {};
    ok('…the row is marked error, not synced', patch.qbo_sync_status === 'error');
    ok('…the hash is NOT stored, so the next push is not a no-op', patch.qbo_hash === null);
    ok('…but the QuickBooks id IS stored, so a retry updates instead of duplicating',
      patch.qbo_id === 'QBO-1');
  }

  // ── D. a hand-typed invoice: DescriptionOnly lines still carry Amount ────
  // The post-condition compares QuickBooks' returned TotalAmt against
  // billedSum + tax − retainage. Every quick, milestone and change-order
  // invoice maps to DescriptionOnly lines (no estimate item to point at), so if
  // a DescriptionOnly Amount did NOT contribute to TotalAmt the mapper would
  // mark every one of them 'error' after posting it. This case pins the shape
  // we depend on: DescriptionOnly, with an Amount, and no ItemRef.
  {
    const h = install({
      invoice: {
        ...baseRow,
        line_items: [{ id: 'l1', name: 'Final cleanup', quantity: 1, unitPrice: 20000, total: 20000,
          sourceEstimateItemId: 'milestone:m1' }],
        subtotal: '20000', total_due: '20000',
      },
    });
    ok('the push succeeded', await pushInvoice() === '');
    const lines = (invoiceBody(h.posts).Line ?? []) as Record<string, unknown>[];
    expect('a namespaced billing key maps to a DescriptionOnly line carrying its Amount',
      lines.map(l => ({ DetailType: l.DetailType, Amount: l.Amount })),
      [{ DetailType: 'DescriptionOnly', Amount: 20000 }]);
    ok('…and the push is not refused for it', h.updates.at(-1)?.patch.qbo_sync_status === 'synced');
  }

  // ── G. an UPDATE stays sparse, so fields MAGE does not model survive ────
  // A full QuickBooks update NULLs every writable field the body omits —
  // BillEmail, CustomerMemo, class and location refs an accountant set inside
  // QuickBooks. Sparse still REPLACES the Line array wholesale, which is what
  // a re-scaled progress bill needs, so there is nothing to gain by dropping it.
  {
    const h = install({
      invoice: {
        ...baseRow, qbo_id: 'QBO-77',
        line_items: [{ id: 'l1', name: 'Work', quantity: 1, unitPrice: 1000, total: 1000 }],
        subtotal: '1000', total_due: '1000',
      },
    });
    ok('the push succeeded', await pushInvoice() === '');
    const body = invoiceBody(h.posts);
    ok('an update to an existing QuickBooks invoice is SPARSE and carries the SyncToken',
      body.sparse === true && body.SyncToken === '3' && body.Id === 'QBO-77',
      JSON.stringify({ sparse: body.sparse, SyncToken: body.SyncToken, Id: body.Id }));
  }

  // ── E. an internally inconsistent row is refused before anything posts ──
  {
    const h = install({
      invoice: {
        ...baseRow,
        line_items: [{ id: 'l1', name: 'Work', quantity: 1, unitPrice: 30000, total: 30000 }],
        subtotal: '0', total_due: '0',
      },
    });
    let threw = '';
    try { await invMod.upsertInvoice({}, 'inv-1', 'u1'); } catch (e) { threw = (e as Error).message; }
    ok('a row whose lines and subtotal disagree never reaches QuickBooks',
      /Refusing to push invoice #12/.test(threw) && h.posts.length === 0, threw);
  }

  // ── F. payment.ts: an overpayment never over-applies ────────────────────
  {
    // A FULL invoice row, not a payment-shaped stub: payment.ts now re-pushes
    // the invoice before reading the balance, and a stub made that push throw
    // (caught, best-effort) so the ordering this case exists to pin was never
    // actually exercised.
    const h = install({
      invoice: {
        ...baseRow, qbo_id: 'QBO-1',
        line_items: [{ id: 'l1', name: 'Work', quantity: 1, unitPrice: 5000, total: 5000 }],
        subtotal: '5000', total_due: '5000',
        payments: [{ id: 'pay-1', date: '2026-04-01', amount: 50000 }],
      },
      balance: 5000,
    });
    await payMod.upsertPaymentForInvoice({}, 'inv-1::pay-1', 'u1');
    const body = h.posts.find(p => p.path === '/payment')!.body;
    close('a $50,000 payment against a $5,000 open balance APPLIES only $5,000',
      ((body.Line as { Amount: number }[])[0]).Amount, 5000);
    close('…while TotalAmt stays the cash that actually arrived, so the bank reconciles',
      body.TotalAmt as number, 50000);
    ok('…and the unapplied remainder is explained in the books, not left to be found',
      /\$45000\.00 is unapplied customer credit/.test(String(body.PrivateNote)));
    // THE SHORTFALL IS RECORDED, not merely narrated. `if (pay.qboId) return;`
    // exits on every later run, so an under-applied payment used to be
    // permanent and invisible. This is the fact a later run (or a human) reads.
    const payPatch = h.updates.map(u => u.patch).reverse()
      .find(pt => Array.isArray(pt.payments)) as { payments: { qboApplied?: number }[] } | undefined;
    close('…and how much was applied is written back on the payment',
      payPatch?.payments?.[0]?.qboApplied ?? -1, 5000);
    // ORDER. invoice.ts now posts NET of retainage held, so a closeout payment
    // arriving before the invoice is re-pushed would be capped at a stale
    // balance and the remainder would never heal. The invoice push happens
    // first, and it is a no-op when nothing changed.
    const firstPay = h.posts.findIndex(pp => pp.path === '/payment');
    const firstInv = h.posts.findIndex(pp => pp.path.startsWith('/invoice'));
    ok('the invoice is refreshed BEFORE the payment is applied',
      firstInv >= 0 && firstInv < firstPay,
      JSON.stringify(h.posts.map(pp => pp.path)));
    ok('…and payment.ts is what orders them, not luck',
      /await import\('\.\/invoice\.ts'\)/.test(read('supabase/functions/_shared/qbo-mapping/payment.ts')));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MONEY-AP-1 — a sub's bill can be recorded against his subcontract.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\na sub bill buys down the subcontract (MONEY-AP-1):');
{
  // ── THE DEFAULT, not just the picker (F9, review round 3). ────────────
  // Widening the picker only helps a GC who notices a chip. app/scan.tsx
  // passes no commitmentId and the picker defaults to None, so the scanned sub
  // bill was still booked as unlinked direct cost by default — the exact
  // double count the two engine cases below price at $6,000.
  expect('a bill from a vendor with exactly one open commitment links itself',
    matchCommitmentByVendor('Northline  ELECTRIC', [
      { id: 'sc-ap', counterparty: 'Northline Electric' },
      { id: 'po-1', counterparty: 'Builders FirstSource' },
    ]) ?? 'none', 'sc-ap');
  expect('…two commitments with the same vendor default to NOTHING rather than guess',
    matchCommitmentByVendor('Northline Electric', [
      { id: 'a', counterparty: 'Northline Electric' },
      { id: 'b', counterparty: 'Northline Electric' },
    ]) ?? 'none', 'none');
  expect('…a partial name may not claim a commitment',
    matchCommitmentByVendor('Alder', [
      { id: 'a', counterparty: 'Alder Mechanical' },
      { id: 'b', counterparty: 'Alder Electric' },
    ]) ?? 'none', 'none');
  // The case that separates EXACT from "contains": one candidate, so an
  // ambiguity check cannot save a substring match. Loosening the compare to
  // `.includes()` books an electrician's bill against a concrete PO here, and
  // that mutation used to pass every assertion above it.
  expect('…not even when the partial name has exactly one candidate',
    matchCommitmentByVendor('Alder', [
      { id: 'a', counterparty: 'Alder Mechanical' },
      { id: 'b', counterparty: 'Bison Concrete' },
    ]) ?? 'none', 'none');
  expect('…and a longer vendor string does not claim a shorter commitment either',
    matchCommitmentByVendor('Northline Electric LLC', [
      { id: 'a', counterparty: 'Northline Electric' },
    ]) ?? 'none', 'none');
  expect('…and a blank vendor matches nothing',
    matchCommitmentByVendor('   ', [{ id: 'a', counterparty: 'Northline Electric' }]) ?? 'none', 'none');

  const receiptScreen = read('app/material-receipt.tsx');
  ok('the scan path USES that match instead of defaulting to None',
    /matchCommitmentByVendor\(\s*\n?\s*data\?\.vendor,/.test(receiptScreen)
    && /normalizeExtraction\(data, \{ projectId, commitmentId: autoLink, imageUri \}\)/.test(receiptScreen),
    'the receipt must be BUILT with the auto-linked commitment, not just have a chip selected');
  ok('…and an explicit route param still wins over the guess',
    /const autoLink = commitmentId \?\? matchCommitmentByVendor\(/.test(receiptScreen));
  ok('the commitment picker offers SUBCONTRACTS, not purchase orders only',
    /c\.type === 'purchase_order' \|\| c\.type === 'subcontract'/.test(receiptScreen),
    "the picker was filtered to purchase_order and labelled 'Link to PO'");
  ok('…and excludes drafts, which the job-cost engine filters out anyway',
    /c\.status !== 'draft'/.test(receiptScreen));
  ok('…and says what linking does instead of leaving it to be guessed',
    /pickerHelp/.test(receiptScreen) && /counted twice/.test(receiptScreen));

  // The engine half: a linked bill buys down the commitment; an unlinked one
  // is direct cost, and on a job where the vendor HAS a subcontract that is
  // the same dollar counted twice.
  const proj = {
    id: 'p4', name: 'AP', status: 'in_progress',
    linkedEstimate: { id: 'e', items: [{
      materialId: 'x1', name: 'Electrical', category: 'Electrical', unit: 'ls', quantity: 1,
      unitPrice: 20_000, bulkPrice: 20_000, markup: 0, usesBulk: false, lineTotal: 20_000, supplier: '',
    }], globalMarkup: 0, baseTotal: 20_000, markupTotal: 0, grandTotal: 20_000,
      createdAt: '2026-01-01T00:00:00.000Z' },
  } as unknown as Project;
  const sc = {
    id: 'sc-ap', projectId: 'p4', number: 'SC-9', type: 'subcontract', vendorName: 'Northline',
    description: 'Electrical', amount: 20_000, phase: 'Electrical', status: 'active',
    signedDate: '2026-01-01', createdAt: '2026-01-01', updatedAt: '2026-01-01',
  } as unknown as Commitment;
  const bill = (commitmentId?: string) => ({
    id: 'r-ap', projectId: 'p4', commitmentId, vendor: 'Northline', receiptDate: '2026-03-01',
    lines: [{ id: 'l', description: 'Rough-in', category: 'Electrical', quantity: 1, unit: 'ls',
      unitPrice: 6_000, lineTotal: 6_000 }],
    subtotal: 6_000, total: 6_000, status: 'reviewed', createdAt: '', updatedAt: '',
  }) as unknown as MaterialReceipt;

  const unlinked = computeJobCost({ project: proj, commitments: [sc], changeOrders: [], receipts: [bill()] });
  const linked = computeJobCost({ project: proj, commitments: [sc], changeOrders: [], receipts: [bill('sc-ap')] });
  close('an UNLINKED sub bill overstates the projected final by its own amount',
    unlinked.projectedFinal, 26_000);
  close('…linking it to the subcontract prices the job correctly',
    linked.projectedFinal, 20_000);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
