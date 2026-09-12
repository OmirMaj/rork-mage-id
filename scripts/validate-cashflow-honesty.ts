// validate-cashflow-honesty.ts — the runway must count the money going OUT,
// count it once, and not call a cash delta profit.
//
// WHY THIS EXISTS (audit 2026-09-07, do-next #12b/#12c). The one screen whose
// purpose is "can I make payroll on Friday" was systematically biased toward
// saying yes:
//
//   * The INCOME side was fully automatic — invoices and expected payments flow
//     in on their own — while the EXPENSE side counted only rows the GC had
//     typed by hand. Signed subcontracts and POs, the largest committed outflow
//     a GC has, never appeared at all. Automatic on the money coming in and
//     manual on the money going out tilts every week toward solvency, in the
//     exact direction that hurts. It propagated too: hooks/useMorningBrief.ts
//     and utils/oneMind/factBlocks.ts read this same projection.
//
//   * The summary tile called a 13-week change in cash "Net Profit". A change
//     in cash is not profit — it counts a deposit as gain before any work is
//     done, counts a materials prepay as loss, and ignores work performed but
//     unbilled entirely. A GC repeating that figure to his accountant or a
//     lender was misled by the label, not by the arithmetic.
//
//   * The setup was device-only, so a GC who set it up on the laptop opened the
//     phone to a $0 starting balance.
//
// WHAT THIS PINS. Real fixtures through the real engine — no mocks of the money
// path — plus source assertions for the facts arithmetic cannot express: that
// no label calls a cash delta profit, that the settings write goes through
// utils/offlineQueue rather than a direct supabase call, and that the screen
// actually renders what the engine computed.
//
// MUTATION-TESTED, and it needed to be. Forty-two mutations were run against
// this file; six of its checks passed while the thing they protect was broken,
// and each of those six is now stronger — the failure and the fix are recorded
// beside the check itself so the shape does not come back:
//
//   * two JSX checks matched their own condition inside `{false && …}`, so
//     dead-coding the per-row duplicate flag and the undated remainder both
//     read as rendered. Now anchored on the opening brace.
//   * the server read was matched by the query existing, not by the gate
//     running, so `if (false && userId && …)` counted as a read-through.
//   * the offline-queue check matched ONE occurrence while the module has TWO
//     write sites, so gutting markSetupComplete's queued write left it
//     verified by nothing. Each function body is now sliced and checked alone.
//   * nothing pinned the arithmetic of `netCashChange` itself — only its name —
//     so returning gross income under the corrected label passed everything.
//   * nothing pinned calendar-vs-working days or calendar-day-vs-instant, both
//     of which move the draw window without changing any total. Pinned
//     relationally and by wall-clock time, so they hold in every timezone.
//
// Run via: bun run scripts/validate-cashflow-honesty.ts

import {
  buildCommittedOutflows, generateForecast, calculateSummary, stripDerivedExpenses,
} from '../utils/cashFlowEngine';
import type { CashFlowExpense } from '../utils/cashFlowEngine';
import { computeJobCost, commitmentUnpaid, commitmentValue, commitmentPaidToDate } from '../utils/jobCostEngine';
import { toCalendarDayString } from '../utils/calendarDate';
import type { Commitment, MaterialReceipt, Project } from '../types';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { console.log('  ✓', label); }
  else { console.error('  ✗', label, detail ? `\n      ${detail}` : ''); failures++; }
}
function eq(label: string, actual: number, expected: number, tol = 0.01) {
  check(`${label} (= ${expected})`, Math.abs(actual - expected) <= tol, `got ${actual}`);
}

// ── fixtures ────────────────────────────────────────────────────────────────

const today = new Date();
today.setHours(0, 0, 0, 0);
const dayOffset = (days: number) => {
  const d = new Date(today);
  d.setDate(d.getDate() + days);
  return d;
};

/** A project whose schedule starts today and runs `workingDays` working days.
 *  Pass null to model the very common project that has no schedule at all. */
function project(
  id: string,
  workingDays: number | null,
  startsDaysAgo = 0,
  status: Project['status'] = 'in_progress',
  perWeek = 5,
  nonWorkingDates: string[] = [],
): Project {
  const schedule = workingDays === null ? null : {
    id: `s-${id}`, name: 'sched', projectId: id,
    startDate: toCalendarDayString(dayOffset(-startsDaysAgo)),
    workingDaysPerWeek: perWeek, nonWorkingDates, bufferDays: 0, tasks: [],
    totalDurationDays: workingDays, criticalPathDays: workingDays,
    laborAlignmentScore: 0, riskItems: [], updatedAt: today.toISOString(),
  };
  return {
    id, name: `Project ${id}`, type: 'residential', location: 'Denver, CO',
    squareFootage: 2000, quality: 'standard', description: '',
    createdAt: today.toISOString(), updatedAt: today.toISOString(),
    estimate: null, linkedEstimate: null, schedule, status,
  } as unknown as Project;
}

function commitment(over: Partial<Commitment>): Commitment {
  return {
    id: 'c1', projectId: 'p1', number: 'SC-001', type: 'subcontract',
    vendorName: 'Miller Bros Framing', description: 'Framing package',
    amount: 40_000, signedDate: today.toISOString(), status: 'active',
    createdAt: today.toISOString(), updatedAt: today.toISOString(),
    ...over,
  } as Commitment;
}

function receipt(commitmentId: string | undefined, total: number): MaterialReceipt {
  return {
    id: `r-${commitmentId ?? 'none'}-${total}`, projectId: 'p1', commitmentId,
    vendor: 'Lumber Co', lines: [{ id: 'l1', description: 'studs', quantity: 1, unit: 'ea', unitPrice: total, lineTotal: total }],
    subtotal: total, total, status: 'reviewed',
    createdAt: today.toISOString(), updatedAt: today.toISOString(),
  } as MaterialReceipt;
}

/**
 * The whole path, end to end: commitments → derived outflow rows → the same
 * forecast the screen renders. Returns total cash OUT over the horizon, so a
 * commitment that never reaches a week shows up here as a zero.
 */
function outflowOverHorizon(
  commitments: Commitment[],
  projects: Project[],
  manual: CashFlowExpense[] = [],
  weeks = 52,
) {
  const committed = buildCommittedOutflows({ commitments, projects, expenses: manual, now: today });
  const weeksOut = generateForecast(0, [...manual, ...committed.scheduled], [], [], weeks, 'net_30', []);
  return { committed, summary: calculateSummary(weeksOut), weeks: weeksOut };
}

const P_ACTIVE = project('p1', 20);           // ~4 working weeks from today
const P_NO_SCHEDULE = project('p1', null);

console.log('\ncash-flow honesty — committed outflow, counted once, named correctly:\n');

// ── 1. a committed subcontract appears as outflow ───────────────────────────
console.log('  1. signed commitments reach the runway');
{
  const c = commitment({});
  const { committed, summary } = outflowOverHorizon([c], [P_ACTIVE]);

  check('a signed subcontract produces a derived outflow row',
    committed.scheduled.length === 1 && committed.scheduled[0].derived === true,
    JSON.stringify(committed.scheduled));
  check('...tagged with the commitment it came from',
    committed.scheduled[0]?.commitmentId === c.id);
  eq('...and the whole remaining balance lands in the forecast', summary.totalExpenses, 40_000);

  // The control: without the commitment the same screen forecasts nothing out.
  // This is what the screen did before the fix, and it is the bias itself.
  const none = outflowOverHorizon([], [P_ACTIVE]);
  eq('with no commitments the forecast spends nothing', none.summary.totalExpenses, 0);
}

// ── 2. the money definition is jobCostEngine's, not a second one ────────────
console.log('\n  2. one definition of "what this sub is still owed"');
{
  const c = commitment({ paidToDate: 25_000 });
  const jobCost = computeJobCost({ project: P_ACTIVE, commitments: [c], changeOrders: [] });

  eq('jobCostEngine: committed − actual on this phase', jobCost.committed - jobCost.actual, 15_000);
  eq('commitmentUnpaid agrees with it', commitmentUnpaid(c), jobCost.committed - jobCost.actual);
  eq('...and the cash forecast spends exactly that',
    outflowOverHorizon([c], [P_ACTIVE]).summary.totalExpenses, 15_000);

  // A CO revision raises what is still owed. `amount` is never mutated by a CO,
  // so a reader that ignores changeAmount understates every revised commitment.
  const revised = commitment({ paidToDate: 25_000, changeAmount: 5_000 });
  eq('an approved CO revision raises the unpaid balance', commitmentUnpaid(revised), 20_000);
  eq('...and the forecast follows it',
    outflowOverHorizon([revised], [P_ACTIVE]).summary.totalExpenses, 20_000);

  eq('commitmentValue is signed + revisions', commitmentValue(revised), 45_000);
  eq('commitmentPaidToDate floors a negative rollup at zero',
    commitmentPaidToDate(commitment({ paidToDate: -900 })), 0);

  const paidOff = commitment({ paidToDate: 40_000 });
  check('a fully paid commitment produces no row at all',
    buildCommittedOutflows({ commitments: [paidOff], projects: [P_ACTIVE], expenses: [], now: today }).scheduled.length === 0);
  const overpaid = commitment({ paidToDate: 55_000 });
  eq('an overpaid commitment is zero, never negative outflow',
    outflowOverHorizon([overpaid], [P_ACTIVE]).summary.totalExpenses, 0);

  const draft = commitment({ status: 'draft' });
  eq('an unsigned draft commits nothing', outflowOverHorizon([draft], [P_ACTIVE]).summary.totalExpenses, 0);
}

// ── 3. the same money, entered by hand AND as a commitment, lands ONCE ──────
console.log('\n  3. no double count');
{
  const c = commitment({});
  // The GC typed his own draw schedule for this sub and linked it. His dates
  // win; the derived row is not generated.
  const linked: CashFlowExpense = {
    id: 'm1', name: 'Miller Bros draw', amount: 40_000, frequency: 'one_time',
    category: 'subcontractor', startDate: today.toISOString(), commitmentId: c.id,
  };

  const both = outflowOverHorizon([c], [P_ACTIVE], [linked]);
  eq('hand-entered + commitment for the same money spends it ONCE',
    both.summary.totalExpenses, 40_000);
  check('...because the commitment was suppressed, not the manual row',
    both.committed.scheduled.length === 0 && both.committed.suppressedCommitmentIds.includes(c.id),
    JSON.stringify(both.committed));

  const manualOnly = outflowOverHorizon([], [P_ACTIVE], [linked]);
  eq('...and the total matches the manual row on its own',
    both.summary.totalExpenses, manualOnly.summary.totalExpenses);

  // The suppression is by ID and nothing else. A row with the same name and the
  // same amount but no link is NOT silently deleted — deleting real outflow off
  // a solvency screen on a name guess is worse than the double count.
  const unlinked: CashFlowExpense = { ...linked, id: 'm2', commitmentId: undefined };
  const ambiguous = outflowOverHorizon([c], [P_ACTIVE], [unlinked]);
  eq('an UNLINKED look-alike is not guessed away', ambiguous.summary.totalExpenses, 80_000);
  check('...it is reported to the GC instead',
    ambiguous.committed.ambiguousManualCount === 1, JSON.stringify(ambiguous.committed));
  // NAMED, not counted. "2 of your rows might be duplicates" leaves a GC
  // deleting rows at random on his solvency screen; the row itself has to say
  // so. The count is derived from the id list so the two cannot disagree.
  check('...by id, so the screen can mark the actual row',
    ambiguous.committed.ambiguousManualIds.length === 1 &&
    ambiguous.committed.ambiguousManualIds[0] === 'm2',
    JSON.stringify(ambiguous.committed.ambiguousManualIds));

  // A row the GC DID link is not flagged — a warning on every sub row is
  // noise, and noise on this screen is how the real one gets ignored.
  check('a linked row is not flagged as a possible duplicate',
    outflowOverHorizon([c], [P_ACTIVE], [linked]).committed.ambiguousManualIds.length === 0);
  // Neither is a row in a category commitments never produce.
  const payroll: CashFlowExpense = { ...unlinked, id: 'm3', category: 'payroll' };
  check('a payroll row is not flagged either',
    outflowOverHorizon([c], [P_ACTIVE], [payroll]).committed.ambiguousManualIds.length === 0);

  // MATERIAL DELIVERED IS NOT MATERIAL PAID, and the cash side must not net it
  // out. A MaterialReceipt is a supplier INVOICE — the type has no paid flag
  // (status is 'extracted' | 'reviewed') and its own doc says receipts are
  // never posted into `paidToDate`. generateForecast spends no receipt either,
  // so netting them removed real, unpaid, imminent cash from the runway with
  // nothing putting it back: a $10,000 PO with $6,000 delivered forecast
  // $4,000. That is the exact optimism this whole file exists to stop, arriving
  // through the dedupe. Receipts are also device-local
  // (`mageid_material_receipts`, no sync), so netting them made the laptop and
  // the phone answer differently on the same PO.
  //
  // Pinned at the source as well as the arithmetic: the builder takes no
  // receipts input at all, so nobody can re-add the netting without this
  // failing.
  const po = commitment({ id: 'c2', number: 'PO-1', type: 'purchase_order', amount: 10_000 });
  const delivered = receipt('c2', 6_000);
  eq('a delivered-but-unpaid PO still forecasts its whole unpaid balance',
    outflowOverHorizon([po], [P_ACTIVE]).summary.totalExpenses, 10_000);
  eq('commitmentUnpaid ignores what was delivered against the PO',
    commitmentUnpaid(po), 10_000);
  check('...and the builder cannot be handed receipts to net',
    !/receipts/.test(read('utils/cashFlowEngine.ts').slice(
      read('utils/cashFlowEngine.ts').indexOf('export interface CommittedOutflowInput'),
      read('utils/cashFlowEngine.ts').indexOf('export interface CommittedOutflows'))) &&
    !/deliveredAgainstIt|commitmentRemaining/.test(read('utils/jobCostEngine.ts')),
    `the receipt fixture (${delivered.total}) must have nowhere to go`);

  // Door 2: derived rows are a view, never storage. Feeding them back in as if
  // they had been persisted must not suppress, duplicate or change anything.
  const first = buildCommittedOutflows({ commitments: [c], projects: [P_ACTIVE], expenses: [], now: today });
  const again = buildCommittedOutflows({ commitments: [c], projects: [P_ACTIVE], expenses: first.scheduled, now: today });
  check('re-running the builder over its own output is a no-op',
    again.scheduled.length === 1 && Math.abs(again.scheduled[0].amount - first.scheduled[0].amount) < 0.01 &&
    again.suppressedCommitmentIds.length === 0,
    JSON.stringify(again));
  check('stripDerivedExpenses keeps only what the GC typed',
    stripDerivedExpenses([...first.scheduled, linked]).length === 1 &&
    stripDerivedExpenses([...first.scheduled, linked])[0].id === 'm1');
}

// ── 4. money that cannot be dated is reported, never invented ──────────────
console.log('\n  4. undated committed money is named, not guessed');
{
  const c = commitment({});
  const { committed, summary } = outflowOverHorizon([c], [P_NO_SCHEDULE]);
  eq('a commitment on a job with no schedule is NOT put in a week', summary.totalExpenses, 0);
  eq('...it is reported as undated', committed.undated, 40_000);
  check('...and names the commitment behind it',
    committed.undatedCommitmentIds.includes(c.id));

  // A schedule with no start date cannot date anything either.
  const noStart = project('p1', 20);
  (noStart.schedule as { startDate?: string }).startDate = undefined;
  eq('a schedule without a start date dates nothing',
    buildCommittedOutflows({ commitments: [c], projects: [noStart], expenses: [], now: today }).undated,
    40_000);

  // A commitment on a project this device has never loaded.
  eq('a commitment with no matching project is undated, not dropped',
    buildCommittedOutflows({ commitments: [c], projects: [], expenses: [], now: today }).undated, 40_000);
}

// ── 5. the draw is spread over the schedule, not dumped or lost ────────────
console.log('\n  5. timing follows the schedule');
{
  const c = commitment({});
  // 20 working days ≈ 4 calendar weeks, so a 1-week horizon must see roughly a
  // quarter of the balance — not all of it (which would panic the GC) and not
  // none of it (the original bug).
  const oneWeek = outflowOverHorizon([c], [P_ACTIVE], [], 1).summary.totalExpenses;
  check('a one-week horizon sees part of the draw, not all and not none',
    oneWeek > 0 && oneWeek < 40_000, `got ${oneWeek}`);

  const full = outflowOverHorizon([c], [P_ACTIVE], [], 52).summary.totalExpenses;
  eq('the spread sums back to the balance over the whole window', full, 40_000);

  // SWEPT, not sampled. The number of forecast weeks a draw window covers is
  // floor(daysOut / 7) + 1, and an off-by-one there only loses money when the
  // window happens to end on a week boundary — so a single fixture passes or
  // fails by what weekday this guard is run on. Every duration from one day to
  // nine weeks is checked, which pins the boundary itself.
  let worstDrift = 0;
  let worstAt = 0;
  for (let d = 1; d <= 45; d++) {
    const swept = outflowOverHorizon([c], [project('p1', d)], [], 52).summary.totalExpenses;
    const drift = Math.abs(swept - 40_000);
    if (drift > worstDrift) { worstDrift = drift; worstAt = d; }
  }
  check('...for every schedule length from 1 to 45 working days, not just this one',
    worstDrift < 0.01, `worst drift $${worstDrift.toFixed(2)} at ${worstAt} working days`);

  // A CALENDAR DAY IS NOT AN INSTANT, in both directions. Neither of the two
  // mistakes below changes any total — they move the draw window by a day, and
  // whether that day matters depends on the machine's timezone — so a sum
  // check cannot see them. These pin each one where it actually bites.
  //
  // Reading in: `new Date('2026-09-10')` is UTC midnight, i.e. the previous
  // evening anywhere west of Greenwich, so a schedule's start day would land
  // on the wrong calendar day and drag the whole draw window with it.
  // parseCalendarDay slices to ten characters and builds a LOCAL date, so the
  // same day written as a bare day and as a local-midnight timestamp must
  // produce byte-identical rows. Under `new Date(...)` they cannot.
  {
    const bare = project('p1', 20);
    const bareDay = (bare.schedule as { startDate: string }).startDate;
    const asInstant = project('p1', 20);
    const local = new Date(`${bareDay}T00:00:00`);
    (asInstant.schedule as { startDate: string }).startDate =
      `${bareDay}T00:00:00.000${local.getTimezoneOffset() > 0 ? '-' : '+'}` +
      `${String(Math.floor(Math.abs(local.getTimezoneOffset()) / 60)).padStart(2, '0')}:` +
      `${String(Math.abs(local.getTimezoneOffset()) % 60).padStart(2, '0')}`;
    const a = buildCommittedOutflows({ commitments: [c], projects: [bare], expenses: [], now: today }).scheduled[0];
    const b = buildCommittedOutflows({ commitments: [c], projects: [asInstant], expenses: [], now: today }).scheduled[0];
    check('a start day written bare and as a local-midnight instant date the same draw',
      !!a && !!b && a.endDate === b.endDate && Math.abs(a.amount - b.amount) < 0.01,
      `${a?.endDate} vs ${b?.endDate}`);
  }

  // Writing out: the row's endDate is compared against week boundaries with
  // `new Date(...)` inside shouldExpenseOccurInWeek, so it has to be the END of
  // the finish day as an instant. Written as a bare 'YYYY-MM-DD' it parses to
  // UTC midnight and silently drops the last week of the draw. Checked as a
  // wall-clock time rather than a string shape: 23:59:59 local is what the end
  // of a local day looks like, and no bare calendar day parses to it in any
  // real timezone offset.
  {
    const weekly = buildCommittedOutflows({
      commitments: [c], projects: [project('p1', 20)], expenses: [], now: today,
    }).scheduled[0];
    const end = new Date(weekly.endDate ?? '');
    check("the draw window ends at the END of the finish day, not at a bare calendar day",
      weekly.frequency === 'weekly' &&
      end.getHours() === 23 && end.getMinutes() === 59 && end.getSeconds() === 59,
      `endDate ${weekly.endDate} → local ${end.toString()}`);
  }

  // WORKING DAYS ARE NOT CALENDAR DAYS either. A 20-day schedule at five days
  // a week takes 26 calendar days, not 19, and reading the duration as calendar
  // days pulls roughly three weeks of subcontract draw forward per quarter into
  // weeks the crew will not have worked. Pinned relationally, so it holds in
  // every timezone and on every weekday: the same duration at five days a week
  // must touch MORE forecast weeks than at seven, and blackout days must push
  // it further still. Under a calendar-day reading all three are equal.
  const weeksTouched = (p: Project) =>
    outflowOverHorizon([c], [p], [], 52).weeks.filter(w => w.totalExpenses > 0).length;
  const fiveDayWeek = weeksTouched(project('p1', 20, 0, 'in_progress', 5));
  const sevenDayWeek = weeksTouched(project('p1', 20, 0, 'in_progress', 7));
  check('a five-day week stretches the draw further than a seven-day week',
    fiveDayWeek > sevenDayWeek, `5/wk touched ${fiveDayWeek} weeks, 7/wk touched ${sevenDayWeek}`);
  // WORKING days only, and that is the whole point of the assertion below: a
  // shutdown can only STRETCH a draw if it falls on a day the crew would have
  // worked. `n * 7` was the original spacing and it is a date-dependent trap —
  // every offset lands on the SAME weekday as `today`, so when the suite runs on
  // a Saturday or a Sunday all five blackouts are days a five-day week already
  // skips, the shutdown changes nothing, and the check fails for a reason that
  // has nothing to do with the engine. Found 2026-09-12, a Saturday; it had
  // passed the day before. The section comment above promises this holds "on
  // every weekday", so make that true rather than weakening the claim: step
  // forward one WORKING day at a time from the schedule start, which is exactly
  // the walk the engine itself performs.
  const workingDayOffsets: number[] = [];
  for (let d = 1; workingDayOffsets.length < 5; d++) {
    const dow = dayOffset(d).getDay();
    if (dow === 0 || dow === 6) continue;   // the five-day week these fixtures use
    if (workingDayOffsets.length === 0 || d - workingDayOffsets[workingDayOffsets.length - 1] >= 3) {
      workingDayOffsets.push(d);
    }
  }
  const blackout = workingDayOffsets.map(d => toCalendarDayString(dayOffset(d)));
  const withShutdown = weeksTouched(project('p1', 20, 0, 'in_progress', 5, blackout));
  check("...and the project's own non-working days stretch it further again",
    withShutdown > fiveDayWeek, `${withShutdown} weeks with a shutdown vs ${fiveDayWeek} without`);

  // And in the source, so the checks above cannot be satisfied by accident.
  const engineSrc = read('utils/cashFlowEngine.ts');
  check('...and the engine reads the schedule start as a calendar day',
    /parseCalendarDay\(schedule\.startDate\)/.test(engineSrc) &&
    !/new Date\(schedule\.startDate\)/.test(engineSrc));

  // A LIVE job whose schedule already ended: what is left is owed now, not on
  // some future week. Week 0 is the conservative read on a solvency screen.
  const overrun = project('p1', 5, 60);
  const overrunRows = buildCommittedOutflows({ commitments: [c], projects: [overrun], expenses: [], now: today });
  check('an overrun job that is still running puts the remaining balance in week 0',
    overrunRows.scheduled[0]?.frequency === 'one_time',
    JSON.stringify(overrunRows.scheduled));
  eq('...and a one-week horizon sees the whole thing',
    outflowOverHorizon([c], [overrun], [], 1).summary.totalExpenses, 40_000);
}

// ── 5b. a FINISHED job's leftover balance is reported, not billed to today ──
// `paidToDate` is only maintained by the server trigger on sub-submitted
// invoices, so a sub paid by check outside the portal leaves a full balance
// standing on a contract that closed a year ago. Dating that to week 0 put the
// whole of every historic subcontract into THIS week, on every open, forever —
// a permanent false Danger on the one screen a GC must not learn to ignore.
console.log('\n  5b. a finished job is not billed to this week');
{
  const c = commitment({});
  const finishedProject = project('p1', 20, 400, 'completed');
  const r1 = outflowOverHorizon([c], [finishedProject]);
  eq('a completed project puts nothing in week 0', r1.weeks[0].totalExpenses, 0);
  eq('...and nothing anywhere in the horizon', r1.summary.totalExpenses, 0);
  eq('...but the balance is still reported', r1.committed.undated, 40_000);
  check('...and named', r1.committed.undatedCommitmentIds.includes(c.id));

  const closedProject = project('p1', 20, 400, 'closed');
  eq('a closed project is the same', outflowOverHorizon([c], [closedProject]).committed.undated, 40_000);

  // The commitment's own status closes it independently of the project's.
  const closedCommitment = commitment({ status: 'closed' });
  const r2 = outflowOverHorizon([closedCommitment], [project('p1', 20)]);
  eq('a closed commitment on a live job is reported, not dated', r2.committed.undated, 40_000);
  eq('...and spends nothing in the weeks', r2.summary.totalExpenses, 0);

  // The control: the SAME commitment on a live job with the same dead schedule
  // does land in week 0. Without this, "reports it" could be passing because
  // the builder stopped producing rows at all.
  const live = outflowOverHorizon([c], [project('p1', 20, 400, 'in_progress')]);
  eq('a LIVE job with the same dead schedule still lands in week 0', live.weeks[0].totalExpenses, 40_000);
}

// ── 6. no label calls a cash delta profit ──────────────────────────────────
console.log('\n  6. the label says what the number is');
{
  // Comments are stripped first: the files explain at length WHY the word was
  // removed, and a guard that could not tell an explanation from a label would
  // either fail on the explanation or have to stop scanning strings — where the
  // actual defect lived.
  const stripComments = (src: string): string => {
    let out = '';
    let i = 0;
    let mode: 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tpl' = 'code';
    while (i < src.length) {
      const c = src[i];
      const n = src[i + 1];
      if (mode === 'code') {
        if (c === '/' && n === '/') { mode = 'line'; i += 2; continue; }
        if (c === '/' && n === '*') { mode = 'block'; i += 2; continue; }
        if (c === "'") mode = 'sq';
        else if (c === '"') mode = 'dq';
        else if (c === '`') mode = 'tpl';
        out += c; i++; continue;
      }
      if (mode === 'line') { if (c === '\n') { mode = 'code'; out += c; } i++; continue; }
      if (mode === 'block') { if (c === '*' && n === '/') { mode = 'code'; i += 2; } else { i++; } continue; }
      if (c === '\\') { out += c + (n ?? ''); i += 2; continue; }
      if ((mode === 'sq' && c === "'") || (mode === 'dq' && c === '"') || (mode === 'tpl' && c === '`')) mode = 'code';
      out += c; i++;
    }
    return out;
  };

  // The word is allowed in exactly one shape: an explicit denial ("Not profit
  // — excludes unbilled work"). Anything else is a label, an identifier or a
  // fact block presenting a cash delta as earnings.
  const offendingProfitUses = (src: string): string[] => {
    const code = stripComments(src);
    const hits: string[] = [];
    const re = /profit/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
      const before = code.slice(Math.max(0, m.index - 5), m.index);
      if (/not\s$/i.test(before)) continue;
      hits.push(code.slice(Math.max(0, m.index - 40), m.index + 20).replace(/\s+/g, ' '));
    }
    return hits;
  };

  // The figure itself, not only its name. Renaming `netProfit` to
  // `netCashChange` is worth nothing if the field stops being cash in minus
  // cash out — and every source scan above would still be green. Income and
  // expenses are deliberately different non-zero numbers, so a mutation that
  // returns either term on its own cannot coincide with the right answer.
  const known = calculateSummary(generateForecast(
    10_000,
    [{ id: 'e', name: 'rent', amount: 3_000, frequency: 'one_time', category: 'overhead',
       startDate: today.toISOString() }],
    [], [{ id: 'p', description: 'deposit', amount: 8_000, confidence: 'confirmed',
           expectedDate: today.toISOString() }],
    4, 'net_30', [],
  ));
  eq('cash in over the horizon', known.totalIncome, 8_000);
  eq('cash out over the horizon', known.totalExpenses, 3_000);
  eq('net cash change is cash in MINUS cash out', known.netCashChange, 5_000);
  check('...and is neither term on its own',
    known.netCashChange !== known.totalIncome && known.netCashChange !== known.totalExpenses);

  for (const file of ['app/cash-flow.tsx', 'utils/cashFlowEngine.ts']) {
    const hits = offendingProfitUses(read(file));
    check(`${file} never presents a cash delta as profit`, hits.length === 0, hits.join(' | '));
  }

  const screen = read('app/cash-flow.tsx');
  check('the summary tile is labelled Net Cash Change',
    screen.includes('>Net Cash Change<'),
    'the tile that shows totalIncome − totalExpenses must name the number');
  check('...and says in one line what it does not include',
    /Not profit\s*—\s*excludes unbilled work/.test(screen));

  // The stripper itself has to work, or check 6 is decorative.
  check('the comment stripper removes comments and keeps strings',
    !stripComments('// hidden profit\nconst a = 1;').includes('profit') &&
    stripComments('const a = "kept profit";').includes('kept profit'));

  // The AI reads the same summary. It must not narrate it as earnings either.
  //
  // Only buildCashBlock is scanned, not the whole file: profit-leak scans and
  // project-type profitability are different, legitimate numbers that live in
  // the same module, and a whole-file ban would either fail on them or have to
  // be weakened until it caught nothing. The first cut of this check asserted
  // only that the identifier `netProfit` was gone, and a mutation that
  // rewrote the sentence to "net profit ${…}" while still reading
  // `summary.netCashChange` sailed straight through it.
  const facts = read('utils/oneMind/factBlocks.ts');
  const cashBlock = facts.slice(
    facts.indexOf('export function buildCashBlock('),
    facts.indexOf('export function', facts.indexOf('export function buildCashBlock(') + 10),
  );
  check('the AI cash block was located for scanning', cashBlock.length > 200 && cashBlock.includes('totalIncome'),
    `extracted ${cashBlock.length} chars — the anchors moved, so the check below is scanning nothing`);
  const factHits = offendingProfitUses(cashBlock);
  check('the AI never narrates the cash delta as profit either',
    factHits.length === 0 && cashBlock.includes('summary.netCashChange') && !/\bnetProfit\b/.test(facts),
    factHits.join(' | '));
}

// ── 7. the setup syncs, and every write goes through the offline queue ─────
console.log('\n  7. the setup is not device-only, and writes survive no signal');
{
  const storage = read('utils/cashFlowStorage.ts');

  // EVERY write site, not "at least one somewhere in the file". This module has
  // two — the settings row and the setup flag — and the first cut of this check
  // matched a single occurrence, so gutting markSetupComplete's queued write
  // left it protected by nothing at all. Each function body is sliced out and
  // checked on its own, and the slices are length-checked so a rename that
  // makes an anchor miss fails loudly instead of scanning an empty string.
  const bodyOf = (name: string): string => {
    const from = storage.indexOf(`export async function ${name}(`);
    if (from < 0) return '';
    const next = storage.indexOf('\nexport ', from + 10);
    const nextPrivate = storage.indexOf('\nasync function ', from + 10);
    const ends = [next, nextPrivate].filter(i => i > from);
    return storage.slice(from, ends.length ? Math.min(...ends) : storage.length);
  };
  check('import of the offline queue is present',
    /import \{ supabaseWrite \} from '@\/utils\/offlineQueue'/.test(storage));
  for (const fn of ['saveCashFlowData', 'markSetupComplete']) {
    const body = bodyOf(fn);
    check(`${fn} was located for scanning`, body.length > 120,
      `sliced ${body.length} chars — the anchor moved, so the check below scans nothing`);
    check(`${fn} writes through utils/offlineQueue.supabaseWrite`,
      /supabaseWrite\(CASHFLOW_TABLE, 'upsert'/.test(body),
      'A direct write is lost the moment the GC is in a basement; the queue is ' +
      'the only thing in this app that holds it until the phone finds a tower.');
  }

  check('...and no direct supabase mutation bypasses it',
    !/\.from\([^)]*\)[\s\S]{0,40}\.(insert|upsert|update|delete)\(/.test(storage),
    'utils/cashFlowStorage.ts must not call supabase.from(...).upsert() itself.');

  // Anchored on the GATE, not on the query merely existing. `if (false &&
  // userId && isSupabaseConfigured)` leaves the whole read in the file and
  // never runs it, and the first cut of this check called that a server read.
  check('the load reads the server row, not just the device',
    /\.from\(CASHFLOW_TABLE\)[\s\S]{0,60}\.select\(/.test(storage) &&
    /export async function loadCashFlowSettings\(userId\?: string \| null\)/.test(storage) &&
    /\n  if \(userId && isSupabaseConfigured\) \{/.test(storage),
    'Without a read-through that actually runs, the phone still opens to a $0 balance.');

  check('AsyncStorage stays as the offline cache under an app-owned prefix',
    storage.includes("const CASHFLOW_DATA_KEY = 'mage_cashflow_data'") &&
    /await AsyncStorage\.setItem\(CASHFLOW_DATA_KEY/.test(storage),
    'A key outside mage_/mageid_ is invisible to the tenant-switch sweep.');

  check('derived rows are stripped before anything is persisted',
    /const toSave = \{[\s\S]{0,200}expenses: stripDerivedExpenses\(data\.expenses\)/.test(storage),
    'A frozen derived row would be counted alongside the live commitment it ' +
    'came from, at whatever amount it had the day it was written.');

  // The setup-complete flag is MONOTONIC. Nothing in the app un-completes
  // setup, so a false server flag must not overwrite a true device one — a
  // plain mirror reopened the wizard over a fully configured screen for as
  // long as markSetupComplete's own upsert sat in the offline queue.
  check('a false server flag cannot un-complete a finished setup',
    /const setupComplete = serverFlag \|\| cachedFlag/.test(storage) &&
    /if \(setupComplete && !serverFlag\) void markSetupComplete\(userId\)/.test(storage),
    'loadCashFlowSettings must OR the two flags and push the device answer up.');

  const screen = read('app/cash-flow.tsx');
  check('the screen passes the signed-in user so the read is a server read',
    /loadCashFlowSettings\(user\?\.id\)/.test(screen) &&
    /saveCashFlowData\((?:data|updated), user\?\.id\)/.test(screen));
  check('...and tells the GC these two lists are last-writer-wins',
    /last save wins/.test(screen),
    'The migration header says not to present the jsonb lists as merged.');
  // "Saved to your account" is a claim about a write that only happens with a
  // user id AND a configured Supabase — saveCashFlowData skips the server
  // entirely without the first, and supabaseWrite is a no-op without the
  // second. Printing it unconditionally promised a sync that never ran.
  check('...and only claims an account save when there is one',
    /const syncsToAccount = Boolean\(user\?\.id\) && isSupabaseConfigured/.test(screen) &&
    /syncsToAccount\s*\n?\s*\? 'Saved to your account/.test(screen) &&
    /Saved on this device only/.test(screen),
    'Both list captions must branch on syncsToAccount.');
}

// ── 8. every surface that reads this forecast reads the committed side ─────
// The runtime checks above prove the ENGINE counts committed outflow. They
// cannot see whether a screen actually hands it to generateForecast — drop the
// concat at a call site and every runtime check here still passes while the GC
// sees the old, optimistic runway. These pin the wiring itself.
console.log('\n  8. the surfaces are wired to it');
{
  const screen = read('app/cash-flow.tsx');
  // Anchored INSIDE the generateForecast call, not just anywhere in the file:
  // the same concat also builds the section's monthly total, so an unanchored
  // match stayed green while the forecast itself had been reverted.
  check('the Cash Flow screen forecasts the committed rows alongside the typed ones',
    /buildCommittedOutflows\(\{/.test(screen) &&
    /generateForecast\([\s\S]{0,900}\[\.\.\.cashFlowData\.expenses, \.\.\.committed\.scheduled\]/.test(screen),
    'Without the concat the derived rows are computed and thrown away.');
  // Likewise anchored on the rendered figure — `committed.undated > 0` on its
  // own also appears in the AI prompt string, where it proves nothing about
  // what the GC can see.
  // Anchored on the OPENING BRACE of the JSX conditional, not merely on the
  // test appearing somewhere. `{false && committed.undated > 0 && (…)}` still
  // contains the test, and a presence check would have called that rendered.
  check('...and shows the undated remainder rather than dropping it',
    /\{committed\.undated > 0 && \([\s\S]{0,300}formatCurrencyShort\(committed\.undated\)/.test(screen));
  // The count alone is not the fix — the ROW has to carry the warning, or the
  // GC is told a duplicate exists somewhere in a list he then guesses at.
  // Same brace anchor, plus the style, plus the sentence that tells him what
  // to do: this first shipped as an unanchored presence check and a `false &&`
  // in front of the condition sailed straight through it.
  check('...and marks the specific hand-typed rows that may be duplicates',
    /const ambiguousIds = useMemo\(\(\) => new Set\(committed\.ambiguousManualIds\)/.test(screen) &&
    /\{ambiguousIds\.has\(exp\.id\) && \(\s*\n\s*<Text style=\{styles\.expenseListWarn\}>/.test(screen) &&
    /counted twice/.test(screen) &&
    /expenseListWarn: \{/.test(screen),
    'app/cash-flow.tsx must render a per-row flag, not only a footer count.');

  // The morning brief and the AI read the same projection, which is how the
  // bias propagated off this screen in the first place.
  const facts = read('utils/oneMind/factBlocks.ts');
  check('the AI cash block forecasts the committed rows too',
    /engine\.buildCommittedOutflows\(\{/.test(facts) &&
    /\[\.\.\.data\.expenses, \.\.\.committed\.scheduled\]/.test(facts),
    'utils/oneMind/factBlocks.ts must not build a forecast the screen would ' +
    'not recognise — that is how "you are fine this week" got said.');
  check('...and states the undated committed balance as a fact',
    /buildCashBlock\([\s\S]{0,160}committed\.undated/.test(facts));
}

if (failures > 0) {
  console.error(`\n✗ validate-cashflow-honesty: ${failures} failure(s)\n`);
  process.exit(1);
}
console.log('\n✓ validate-cashflow-honesty: all checks passed\n');
