// validate-w5-cashflow-forecast.ts — wave-5 cashflow lane: the runway dates,
// scopes, labels and counts money the way the GC's books do.
//
// WHAT EACH SECTION PINS (audit wave 5; the finding numbers are the audit's):
//
//   #20  an invoice's income is dated by its OWN due date. The engine used
//        issueDate + terms, so a draft staged Aug 1 and sent Sep 22 on net-30
//        (due Oct 22) was clamped into THIS week — +$40K on the week-1 balance
//        and the home tile — while A/R Aging said it was current.
//   #21  the project view's "Company Balance" is the company balance (every
//        payment since the balance was set, whichever job), and another job's
//        expected payment is not this job's income.
//   #107 week labels are LOCAL calendar days. The engine stored the UTC date
//        of local midnight and the screen parsed it back as UTC midnight, so a
//        US phone read every week as starting the day before. Run for real in
//        America/New_York, Asia/Tokyo and Asia/Kolkata (child processes with
//        TZ set), not reasoned about.
//   #108 income lines name the job, never an id fragment or 'N/A'.
//   #110 a submitted, unsigned change order is upside beside the runway, never
//        in totalIncome / runningBalance / lowestBalance / dangerWeeks — while
//        an overdue invoice stays counted (as 'hopeful').
//   #148 money boxes on the setup wizard and the retainage release go through
//        parseMoneyInput: '12,500' is 12500, never 12, and ambiguous input is
//        refused with a reason under the box.
//
// Real fixtures through the real engine, plus anchored source checks for the
// wiring the arithmetic cannot see (the screen actually passes the company
// invoices, renders the upside line, uses the calendar-day formatter).
//
// Run via: bun run scripts/validate-w5-cashflow-forecast.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  generateForecast, calculateSummary, buildForecastInputs, forecastFromInputs,
  invoiceDueDay, parseMoneyInput, setupBalanceFromInput, setupExpenseFromInput, MONEY_FORMAT_HINT,
  type ForecastCashData, type ExpectedPayment, type CashFlowExpense,
} from '../utils/cashFlowEngine';
import { toCalendarDayString, todayCalendarDay, formatCalendarDay } from '../utils/calendarDate';
import type { ChangeOrder, Invoice, Project } from '../types';

const SELF = fileURLToPath(import.meta.url);
const ROOT = join(dirname(SELF), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
/** Code without its comments — a WHY comment may quote the old parseFloat. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const today = new Date();
today.setHours(0, 0, 0, 0);
const daysFromToday = (n: number) => { const d = new Date(today); d.setDate(d.getDate() + n); return d; };

function invoice(over: Partial<Invoice> & { id: string }): Invoice {
  return {
    projectId: 'pA', number: 12, type: 'full', status: 'sent',
    issueDate: daysFromToday(-1).toISOString(), dueDate: daysFromToday(29).toISOString(),
    paymentTerms: 'net_30', notes: '', lineItems: [], subtotal: 40_000, taxRate: 0, taxAmount: 0,
    totalDue: 40_000, amountPaid: 0, payments: [],
    createdAt: today.toISOString(), updatedAt: today.toISOString(),
    ...over,
  } as unknown as Invoice;
}

function weekOf(weeks: ReturnType<typeof generateForecast>, match: (d: string) => boolean): number {
  return weeks.findIndex(w => w.incomeItems.some(i => match(i.description)));
}

// ── TZ child: report what the engine and the formatter produce in THIS zone ──
if (process.env.W5_CF_TZ_CHILD === '1') {
  // The engine logs to stdout; the parent reads this process's stdout as JSON.
  console.log = () => {};
  const weeks = generateForecast(0, [], [
    // A bare-day due date on a week's first day: `new Date(bare)` read it as
    // the previous evening west of Greenwich and put it in the week before.
    invoice({ id: 'bare', number: 5, dueDate: toCalendarDayString(daysFromToday(7)) }),
  ], [], 4, 'net_30', []);
  process.stdout.write(JSON.stringify({
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    offset: new Date().getTimezoneOffset(),
    today: todayCalendarDay(),
    week1Start: weeks[0].weekStart,
    week3Start: weeks[2].weekStart,
    expectedWeek3: toCalendarDayString(daysFromToday(14)),
    week1Label: formatCalendarDay(weeks[0].weekStart, { month: 'short', day: 'numeric' }),
    todayLabel: today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    bareDueWeek: weekOf(weeks, d => d.includes('Invoice #5')),
  }));
  process.exit(0);
}

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log('  ✓', label);
  else { console.error('  ✗', label, detail ? `\n      ${detail}` : ''); failures++; }
}
function eq(label: string, actual: number, expected: number, tol = 0.01) {
  check(`${label} (= ${expected})`, Math.abs(actual - expected) <= tol, `got ${actual}`);
}

console.log('\nwave 5 · cashflow lane — dates, scope, labels, upside, money boxes:\n');

// ── #20 due date, not issue date + terms ──────────────────────────────────
console.log('  #20 income is dated by the invoice\'s own due date');
{
  // The audit repro: issued (staged) 52 days ago, sent today on net-30, so the
  // stored dueDate is 30 days out. issueDate + 30 is 22 days ago → clamped to
  // week 0 by the old engine.
  const staged = invoice({ id: 'staged', issueDate: daysFromToday(-52).toISOString(), dueDate: daysFromToday(30).toISOString() });
  const weeks = generateForecast(0, [], [staged], [], 12, 'net_30', []);
  const w = weekOf(weeks, d => d.includes('Invoice #12'));
  eq('a draft staged 52 days ago and sent today on net-30 lands in week 4 (day 30)', w, 4);
  check('...not in week 0', w !== 0 && weeks[0].totalIncome === 0, `week 0 income ${weeks[0].totalIncome}`);
  eq('...for its full balance', weeks[4].totalIncome, 40_000);

  const noDue = invoice({ id: 'nodue', number: 13, issueDate: daysFromToday(-10).toISOString(), dueDate: '' as unknown as string });
  const w2 = weekOf(generateForecast(0, [], [noDue], [], 12, 'net_30', []), d => d.includes('Invoice #13'));
  eq('no dueDate → issueDate + terms (day 20 → week 2)', w2, 2);
  const badDue = invoice({ id: 'baddue', number: 14, issueDate: daysFromToday(-10).toISOString(), dueDate: 'not a date' });
  eq('an unreadable dueDate falls back the same way',
    weekOf(generateForecast(0, [], [badDue], [], 12, 'net_30', []), d => d.includes('Invoice #14')), 2);

  const overdue = invoice({ id: 'od', number: 15, issueDate: daysFromToday(-40).toISOString(), dueDate: daysFromToday(-5).toISOString() });
  const odWeeks = generateForecast(0, [], [overdue], [], 12, 'net_30', []);
  const odItem = odWeeks[0].incomeItems.find(i => i.description.includes('Invoice #15'));
  check('an overdue invoice is still clamped to week 0', Boolean(odItem));
  check('...as hopeful', odItem?.confidence === 'hopeful', `got ${odItem?.confidence}`);

  const bare = invoiceDueDay({ dueDate: '2026-10-22', issueDate: '2026-08-01T15:00:00.000Z', paymentTerms: 'net_30' });
  check('invoiceDueDay reads a bare due day as that LOCAL day',
    bare !== null && toCalendarDayString(bare) === '2026-10-22', `got ${bare && toCalendarDayString(bare)}`);
  const fb = invoiceDueDay({ dueDate: '', issueDate: '2026-08-01', paymentTerms: 'net_15' } as never);
  check('...and issue day + terms only when there is no due date',
    fb !== null && toCalendarDayString(fb) === '2026-08-16', `got ${fb && toCalendarDayString(fb)}`);
  check('...null when neither can be read',
    invoiceDueDay({ dueDate: '', issueDate: '' } as never) === null);
  // Source: the forecast reads invoiceDueDay, not the issue date.
  const engine = read('utils/cashFlowEngine.ts');
  check('generateForecast dates income from invoiceDueDay',
    /const expectedDate = invoiceDueDay\(inv, defaultPaymentTerms\) \?\? today;/.test(engine) &&
    !/const issueDate = new Date\(inv\.issueDate\)/.test(engine));
}

// ── #21 the company balance, and only this job's expected payments ─────────
console.log('\n  #21 "Company Balance" is the company\'s; other jobs\' promises stay out');
{
  const cashData: ForecastCashData = {
    startingBalance: 40_000,
    balanceAsOf: daysFromToday(-20).toISOString(),
    expenses: [],
    expectedPayments: [],
    defaultPaymentTerms: 'net_30',
  };
  const paidA = invoice({
    id: 'ia', projectId: 'pA', number: 1, status: 'paid', totalDue: 20_000, amountPaid: 20_000,
    payments: [{ id: 'pa', date: daysFromToday(-10).toISOString(), amount: 20_000, method: 'check' }] as never,
  });
  const paidB = invoice({
    id: 'ib', projectId: 'pB', number: 2, status: 'paid', totalDue: 30_000, amountPaid: 30_000,
    payments: [{ id: 'pb', date: daysFromToday(-8).toISOString(), amount: 30_000, method: 'check' }] as never,
  });
  const base = { cashData, commitments: [], projects: [], changeOrders: [] };
  const company = buildForecastInputs({ ...base, invoices: [paidA, paidB] });
  eq('company view: $40K + $20K (job A) + $30K (job B)', company.startingBalance, 90_000);
  const projectOld = buildForecastInputs({ ...base, invoices: [paidA] });
  eq('control — the job-scoped balance the project view used to show', projectOld.startingBalance, 60_000);
  const projectNew = buildForecastInputs({ ...base, invoices: [paidA], balanceInvoices: [paidA, paidB] });
  eq('project view with balanceInvoices = the company figure', projectNew.startingBalance, company.startingBalance);

  const epA: ExpectedPayment = { id: 'ea', description: 'Job A deposit', amount: 5_000, expectedDate: daysFromToday(10).toISOString(), confidence: 'expected', projectId: 'pA' };
  const epB: ExpectedPayment = { id: 'eb', description: 'Job B draw', amount: 7_000, expectedDate: daysFromToday(3).toISOString(), confidence: 'expected', projectId: 'pB' };
  const withAll = { ...cashData, expectedPayments: [epA, epB] };
  const scoped = forecastFromInputs(buildForecastInputs({
    ...base, cashData: withAll, invoices: [paidA], balanceInvoices: [paidA, paidB], expectedPayments: [epA],
  }), 12);
  check('job B\'s expected payment is absent from job A\'s weeks',
    !scoped.some(w => w.incomeItems.some(i => i.description === 'Job B draw')));
  check('...and job A\'s own is present', scoped.some(w => w.incomeItems.some(i => i.description === 'Job A deposit')));
  const unscoped = forecastFromInputs(buildForecastInputs({ ...base, cashData: withAll, invoices: [paidA, paidB] }), 12);
  check('omitting the override keeps every expected payment (home tile, brief, AI facts)',
    unscoped.some(w => w.incomeItems.some(i => i.description === 'Job B draw')));

  const screen = read('app/cash-flow.tsx');
  check('the screen scopes expected payments by projectId in ONE memo',
    /const relevantExpectedPayments = useMemo\(\s*\(\) => \(projectId \? allExpectedPayments\.filter\(ep => ep\.projectId === projectId\) : allExpectedPayments\)/.test(screen));
  check('...and hands the company invoices + the scoped payments to buildForecastInputs',
    /buildForecastInputs\(\{[\s\S]{0,260}balanceInvoices: allInvoices,\s*expectedPayments: relevantExpectedPayments,/.test(screen));
  check('...and uses the scoped list for the diagnosis, Total Pending, Sources and the income list',
    /expectedPayments: relevantExpectedPayments,\s*invoices: relevantInvoices,/.test(screen) &&
    /const expectedTotal = relevantExpectedPayments\s*\.reduce/.test(screen) &&
    /const exp = relevantExpectedPayments\.length;/.test(screen) &&
    /\{relevantExpectedPayments\.map\(ep => \{/.test(screen) &&
    !/cashFlowData\?\.expectedPayments\.map\(/.test(screen) &&
    !/\(cashFlowData\?\.expectedPayments \?\? \[\]\)\s*\.reduce/.test(screen));
  check('...and names the company-wide rows it leaves out of a job view instead of dropping them silently',
    /\{companyWidePaymentsLeftOut\.length > 0 && \(\s*<Text style=\{styles\.listNote\} testID="cash-flow-company-wide-payments">/.test(screen));
}

// ── #107 local calendar days, in three real time zones ─────────────────────
console.log('\n  #107 weeks are local calendar days');
{
  const weeks = generateForecast(0, [], [], [], 3, 'net_30', []);
  check('week 1 starts on today\'s LOCAL calendar day', weeks[0].weekStart === todayCalendarDay(),
    `${weeks[0].weekStart} vs ${todayCalendarDay()}`);
  check('week 3 starts 14 local days later', weeks[2].weekStart === toCalendarDayString(daysFromToday(14)));
  check('weekEnd is day 6 of the week, local', weeks[0].weekEnd === toCalendarDayString(daysFromToday(6)));
  for (const tz of ['America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'Asia/Kolkata']) {
    const run = spawnSync(process.execPath, [SELF], {
      env: { ...process.env, TZ: tz, W5_CF_TZ_CHILD: '1' }, encoding: 'utf8', timeout: 60_000,
    });
    let r: Record<string, unknown> | null = null;
    try { r = JSON.parse(run.stdout); } catch { r = null; }
    check(`${tz}: the child ran`, r !== null, run.stderr?.slice(0, 300));
    if (!r) continue;
    // Guard against a vacuous pass: the child must really be in that zone.
    // (ICU may report Kolkata by its legacy name, Asia/Calcutta.)
    check(`${tz}: the child really runs in ${tz}`,
      r.tz === tz || (tz === 'Asia/Kolkata' && r.tz === 'Asia/Calcutta'), JSON.stringify(r));
    check(`${tz}: week 1's day === todayCalendarDay()`, r.week1Start === r.today, JSON.stringify(r));
    check(`${tz}: week 3 starts 14 days on`, r.week3Start === r.expectedWeek3, JSON.stringify(r));
    check(`${tz}: the rendered week-1 label is today`, r.week1Label === r.todayLabel, JSON.stringify(r));
    check(`${tz}: a bare due day on week 2's first day lands in week 2, not the week before`, r.bareDueWeek === 1, JSON.stringify(r));
  }
  const screen = read('app/cash-flow.tsx');
  check('the danger rows and the week-detail header render through formatCalendarDay',
    /Week \{dw\.weekNumber\} · \{formatCalendarDay\(dw\.weekDate, /.test(screen) &&
    /DETAIL · \{formatCalendarDay\(selectedWeekData\.weekStart, /.test(screen) &&
    !/new Date\(dw\.weekDate\)/.test(screen) && !/new Date\(selectedWeekData\.weekStart\)/.test(screen));
  const engine = read('utils/cashFlowEngine.ts');
  check('the engine stores toCalendarDayString, never the UTC date part',
    /weekStart: toCalendarDayString\(weekStart\),/.test(engine) && !/weekStart\.toISOString\(\)\.split/.test(engine));
}

// ── #108 the job's name, never an id fragment ──────────────────────────────
console.log('\n  #108 income lines name the job');
{
  const pid = '3f2a9c1b-77aa-4c1e-9d2b-0123456789ab';
  const projects = [{ id: pid, name: 'Henderson Remodel' }] as unknown as Project[];
  const inv = invoice({ id: 'n1', projectId: pid, number: 12, dueDate: daysFromToday(2).toISOString() });
  const orphan = invoice({ id: 'n2', projectId: 'gone-0000-1111', number: 9, dueDate: daysFromToday(2).toISOString() });
  const noJob = invoice({ id: 'n3', projectId: undefined as unknown as string, number: 7, dueDate: daysFromToday(2).toISOString() });
  const co = { id: 'co1', projectId: pid, number: 4, status: 'submitted', changeAmount: 1_000 } as unknown as ChangeOrder;
  const inputs = buildForecastInputs({
    cashData: { startingBalance: 0, expenses: [], expectedPayments: [], defaultPaymentTerms: 'net_30' },
    invoices: [inv, orphan, noJob], commitments: [], projects, changeOrders: [co],
  });
  check('buildForecastInputs carries project names', inputs.projectNames?.get(pid) === 'Henderson Remodel');
  const weeks = forecastFromInputs(inputs, 12);
  const descs = weeks.flatMap(w => w.incomeItems.map(i => i.description));
  check('a known job: "Henderson Remodel · Invoice #12"', descs.includes('Henderson Remodel · Invoice #12'), descs.join(' | '));
  check('an unresolved job: plain "Invoice #9"', descs.includes('Invoice #9'), descs.join(' | '));
  check('no job at all: plain "Invoice #7", never N/A', descs.includes('Invoice #7') && !descs.some(d => d.includes('N/A')));
  check('no line carries any fragment of a project id',
    !descs.some(d => d.includes('3f2a9c1b') || d.includes('gone-000')), descs.join(' | '));
  const coDescs = weeks.flatMap(w => (w.pendingCoItems ?? []).map(i => i.description));
  check('a pending CO names its job too', coDescs.includes('Henderson Remodel · Change Order #4 (pending)'), coDescs.join(' | '));
  const positional = generateForecast(0, [], [inv], [], 4, 'net_30', []);
  check('positional callers without names still get a clean label',
    positional[0].incomeItems.some(i => i.description === 'Invoice #12'));
}

// ── #110 unsigned COs are upside, not balance ──────────────────────────────
console.log('\n  #110 a submitted CO never moves the balance');
{
  const payroll: CashFlowExpense = {
    id: 'pr', name: 'Payroll', amount: 5_000, frequency: 'weekly', category: 'payroll', startDate: today.toISOString(),
  };
  const submitted = { id: 'c1', projectId: 'pA', number: 3, status: 'submitted', changeAmount: 25_000 } as unknown as ChangeOrder;
  const underReview = { id: 'c2', projectId: 'pA', number: 6, status: 'under_review', changeAmount: 5_000 } as unknown as ChangeOrder;
  const approved = { id: 'c3', projectId: 'pA', number: 8, status: 'approved', changeAmount: 9_000 } as unknown as ChangeOrder;
  const without = generateForecast(10_000, [payroll], [], [], 12, 'net_30', []);
  const withCo = generateForecast(10_000, [payroll], [], [], 12, 'net_30', [submitted]);
  const sWithout = calculateSummary(without);
  const sWith = calculateSummary(withCo);
  check('a lone $25K submitted CO changes no running balance',
    without.every((w, i) => w.runningBalance === withCo[i].runningBalance));
  check('...no danger week', JSON.stringify(sWithout.dangerWeeks) === JSON.stringify(sWith.dangerWeeks) && sWith.dangerWeeks.length > 0);
  eq('...not the lowest balance', sWith.lowestBalance, sWithout.lowestBalance);
  eq('...not total income', sWith.totalIncome, 0);
  eq('...not the net cash change', sWith.netCashChange, sWithout.netCashChange);
  eq('it is reported as upside instead', sWith.pendingCoUpside ?? 0, 25_000);
  const coWeek = withCo.findIndex(w => (w.pendingCoItems ?? []).length > 0);
  eq('...in the week its assumed date falls (21 days + net-30 = day 51)', coWeek, 7);
  eq('...with the week carrying the amount', withCo[coWeek]?.pendingCoIncome ?? 0, 25_000);
  const both = calculateSummary(generateForecast(0, [], [], [], 12, 'net_30', [submitted, underReview, approved]));
  eq('under_review counts as upside too; approved counts nowhere', both.pendingCoUpside ?? 0, 30_000);
  eq('...and none of it is income', both.totalIncome, 0);

  // Overdue invoices are the 'hopeful' items that MUST stay counted.
  const overdue = invoice({ id: 'od2', number: 21, issueDate: daysFromToday(-60).toISOString(), dueDate: daysFromToday(-20).toISOString(), totalDue: 12_000 });
  const withOverdue = calculateSummary(generateForecast(0, [], [overdue], [], 12, 'net_30', [submitted]));
  eq('an overdue invoice is still income (hopeful is not dropped wholesale)', withOverdue.totalIncome, 12_000);

  const screen = read('app/cash-flow.tsx');
  check('the screen shows the upside on its own line, outside the balance',
    /\{pendingCoUpside > 0 && \(\s*<Text style=\{styles\.summaryItemSub\} testID="cash-flow-pending-co-upside">\s*If pending COs are approved: \+\{formatCurrencyShort\(pendingCoUpside\)\} \(not in the balance\)/.test(screen));
  check('week-detail income rows carry the confidence badge',
    /selectedWeekData\.incomeItems\.map\(\(item, i\) => \{\s*const badge = confidenceBadge\(item\.confidence\);/.test(screen) &&
    /\{badge\.label\}<\/Text>[\s\S]{0,300}\+\{formatCurrency\(item\.amount\)\}/.test(screen));
  check('...and list pending COs apart, saying their week is assumed',
    /\{\(selectedWeekData\.pendingCoItems \?\? \[\]\)\.length > 0 && \(/.test(screen) &&
    /If approved — not in the balance/.test(screen) && /assumes the owner approves within 3 weeks/.test(screen));
  check('Sources no longer counts approved COs',
    !/c\.status === 'approved'/.test(screen) && /return inv \+ exp;/.test(screen));
}

// ── #148 money boxes read '12,500' as 12500 ────────────────────────────────
console.log('\n  #148 money boxes go through parseMoneyInput');
{
  eq("parseMoneyInput('12,500')", parseMoneyInput('12,500') ?? NaN, 12_500);
  eq("parseMoneyInput('$48,250.00')", parseMoneyInput('$48,250.00') ?? NaN, 48_250);
  check("parseMoneyInput('3200,50') is refused", parseMoneyInput('3200,50') === null);
  check("parseMoneyInput('12,50') is refused", parseMoneyInput('12,50') === null);
  eq("setup balance '48,250' → 48250 (was $48)", setupBalanceFromInput('48,250') ?? NaN, 48_250);
  eq('setup balance empty → a deliberate 0', setupBalanceFromInput('  ') ?? NaN, 0);
  eq('setup balance may be an overdraft', setupBalanceFromInput('-1,200') ?? NaN, -1_200);
  check("setup balance '3200,50' is refused", setupBalanceFromInput('3200,50') === null);
  eq("setup expense '12,500' → 12500", setupExpenseFromInput('12,500') ?? NaN, 12_500);
  check('setup expense: a negative bill is refused', setupExpenseFromInput('-50') === null);
  check('the hint says what to type', MONEY_FORMAT_HINT === 'Enter a dollar amount like 12500.00');

  const setup = read('components/CashFlowSetup.tsx');
  check('CashFlowSetup parses nothing with parseFloat', !/parseFloat\(/.test(code('components/CashFlowSetup.tsx')));
  check('...saves the balance and every row through the shared parse',
    /const balance = setupBalanceFromInput\(startingBalance\);/.test(setup) &&
    /amount: setupExpenseFromInput\(amountText\[e\.id\] \?\? ''\)/.test(setup) &&
    /if \(balance === null \|\| priced\.some\(e => e\.amount === null\)\) return;/.test(setup) &&
    /startingBalance: balance,/.test(setup));
  check('...keeps each expense box as typed (a pasted 12,500 is not re-drawn as 12)',
    /value=\{amountText\[exp\.id\] \?\? ''\}/.test(setup));
  check('...previews exactly what it saves',
    /const parsedBalance = setupBalanceFromInput\(startingBalance\);/.test(setup) &&
    /const totalMonthly = pricedExpenses\.reduce/.test(setup) &&
    /parsedBalance === null \? MONEY_FORMAT_HINT/.test(setup));
  check('...and a blocked step is disabled AND says why under the box',
    /disabled=\{stepBlocked\}/.test(setup) &&
    /\{parsedBalance === null && \(\s*<Text style=\{styles\.fieldError\} testID="starting-balance-error">\{MONEY_FORMAT_HINT\}/.test(setup) &&
    /\{unreadableExpenseIds\.length > 0 && \(\s*<Text style=\{styles\.fieldError\} testID="setup-expense-error">/.test(setup) &&
    /\(step === 0 && parsedBalance === null\)/.test(setup) &&
    /\(step === 1 && unreadableExpenseIds\.length > 0\)/.test(setup));

  const retention = read('app/retention.tsx');
  check('Retention release reads the amount with parseMoneyInput',
    /const amt = parseMoneyInput\(releaseAmountInput\);/.test(retention) && !/parseFloat\(releaseAmountInput\)/.test(code('app/retention.tsx')));
  check('...and says why Release is dead when the box cannot be read',
    /&& parseMoneyInput\(releaseAmountInput\) === null;/.test(retention) &&
    /\{amountUnreadable && \(\s*<Text style=\{styles\.previewWarn\} testID="retention-amount-unreadable">\s*\{MONEY_FORMAT_HINT\}/.test(retention));
}

if (failures > 0) {
  console.error(`\n✗ validate-w5-cashflow-forecast: ${failures} failure(s)\n`);
  process.exit(1);
}
console.log('\n✓ validate-w5-cashflow-forecast: all checks passed\n');
