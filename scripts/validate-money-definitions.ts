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
import { suggestCostToDate } from '../utils/wip';
import {
  billedAgainstChangeOrder, changeOrderBillKey, changeOrderBillingState, isChangeOrderBillKey,
} from '../utils/changeOrderBilling';
import {
  contractTimeline, contractTimelineSentence, suggestContractTimeline,
} from '../utils/contractTimelineCore';
import { quoteTouchBody, quotedFromTouches, QUOTE_LINE } from '../utils/leadQuoteCore';
import type {
  Project, Invoice, Commitment, LinkedEstimate, MaterialReceipt, TimeEntry,
  LeadTouch, ProposalTier, TieredProposal,
} from '../types';
// fileURLToPath + join because the repo path contains a space.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
