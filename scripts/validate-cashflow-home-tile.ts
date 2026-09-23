// validate-cashflow-home-tile.ts — the home tab's CASH · 4WK tile and the
// /cash-flow screen it opens must run the SAME forecast.
//
// WHY THIS EXISTS (audit round 2, #17). The tile called generateForecast on
// its own: the device cache only (no user id — '—' on the web and on a second
// phone), the stored balance without the payments recorded since it was set,
// no invoices, no signed subcontracts or POs, no change orders, and it re-ran
// only when `projects` changed. The screen one tap away used all of them.
//
// The harmful direction, which is the fixture below: $40,000 in the bank,
// $6,000/week of overhead and a $52,000 framing draw due now. The tile showed
// +$16,000 in GREEN; the screen showed −$36,000. Green on the home screen for
// the week the account overdraws. And even a correct negative would have been
// painted the same muted grey as "nothing here".
//
// WHAT THIS PINS: the real engine end to end (no mocks of the money path), the
// tone rule, and the wiring on both screens — a source check, because the
// runtime checks cannot see whether a screen actually calls the shared path.
//
// Run via: bun run scripts/validate-cashflow-home-tile.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildForecastInputs, forecastFromInputs, fourWeekCashPosition, generateForecast, cashBalanceTone,
  type ForecastCashData,
} from '../utils/cashFlowEngine';
import { toCalendarDayString } from '../utils/calendarDate';
import type { Commitment, Invoice, Project } from '../types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log('  ✓', label);
  else { console.error('  ✗', label, detail ? `\n      ${detail}` : ''); failures++; }
}
function eq(label: string, actual: number | null, expected: number | null, tol = 0.01) {
  const ok = actual === null || expected === null ? actual === expected : Math.abs(actual - expected) <= tol;
  check(`${label} (= ${expected})`, ok, `got ${actual}`);
}

const today = new Date();
today.setHours(0, 0, 0, 0);
const daysFromToday = (n: number) => { const d = new Date(today); d.setDate(d.getDate() + n); return d; };

// A job whose schedule already finished (started 40 days ago, 10 working days)
// but is still in progress — buildCommittedOutflows puts what is left on its
// subcontract in week 0, the conservative read.
const project = {
  id: 'p1', name: 'Henderson', type: 'residential', location: 'Denver, CO',
  squareFootage: 2000, quality: 'standard', description: '',
  createdAt: today.toISOString(), updatedAt: today.toISOString(),
  estimate: null, linkedEstimate: null, status: 'in_progress',
  schedule: {
    id: 's1', name: 'sched', projectId: 'p1',
    startDate: toCalendarDayString(daysFromToday(-40)),
    workingDaysPerWeek: 5, nonWorkingDates: [], bufferDays: 0, tasks: [],
    totalDurationDays: 10, criticalPathDays: 10,
    laborAlignmentScore: 0, riskItems: [], updatedAt: today.toISOString(),
  },
} as unknown as Project;

const framing = {
  id: 'c1', projectId: 'p1', number: 'SC-001', type: 'subcontract',
  vendorName: 'Miller Bros Framing', description: 'Framing package',
  amount: 52_000, signedDate: today.toISOString(), status: 'active',
  createdAt: today.toISOString(), updatedAt: today.toISOString(),
} as unknown as Commitment;

const cashData: ForecastCashData = {
  startingBalance: 40_000,
  balanceAsOf: daysFromToday(-16).toISOString(),
  expenses: [{
    id: 'e1', name: 'Overhead', amount: 6_000, frequency: 'weekly', category: 'overhead',
    startDate: daysFromToday(-30).toISOString(),
  }],
  expectedPayments: [],
  defaultPaymentTerms: 'net_30',
};

console.log('\ncash · 4wk tile — one forecast for the tile and the screen:\n');

// ── 1. the audit repro ─────────────────────────────────────────────────────
console.log('  1. the framing draw that overdraws him');
{
  // What the tile used to compute, reproduced exactly as the old call site.
  const old = generateForecast(cashData.startingBalance, cashData.expenses, [], cashData.expectedPayments, 12, cashData.defaultPaymentTerms);
  eq('control — the old tile call: $40k − 4 × $6k', old[3].runningBalance, 16_000);

  const tile = fourWeekCashPosition({
    cashData, setupComplete: true, invoices: [], commitments: [framing], projects: [project], changeOrders: [],
  });
  eq('the tile now counts the signed subcontract', tile, -36_000);

  const screen = forecastFromInputs(buildForecastInputs({
    cashData, invoices: [], commitments: [framing], projects: [project], changeOrders: [],
  }), 12);
  eq('...and says exactly what /cash-flow week 4 says', tile, screen[3].runningBalance);
  check('...painted as danger, not muted grey', cashBalanceTone(tile) === 'danger');
}

// ── 2. payments recorded after the balance was set ─────────────────────────
console.log('\n  2. a check recorded since the balance was typed in');
{
  const inv = {
    id: 'i1', projectId: 'p1', number: 7, type: 'full', status: 'paid',
    issueDate: toCalendarDayString(daysFromToday(-20)), dueDate: toCalendarDayString(daysFromToday(-5)),
    paymentTerms: 'net_15', notes: '', lineItems: [], subtotal: 12_000, taxRate: 0, taxAmount: 0,
    totalDue: 12_000, amountPaid: 12_000,
    payments: [{ id: 'pay1', date: daysFromToday(-7).toISOString(), amount: 12_000, method: 'check' }],
    createdAt: today.toISOString(), updatedAt: today.toISOString(),
  } as unknown as Invoice;
  const tile = fourWeekCashPosition({
    cashData, setupComplete: true, invoices: [inv], commitments: [framing], projects: [project], changeOrders: [],
  });
  eq('the $12k check lands in the starting balance', tile, -24_000);
  const inputs = buildForecastInputs({ cashData, invoices: [inv], commitments: [], projects: [project], changeOrders: [] });
  eq('buildForecastInputs: effective balance = stored + recorded since', inputs.startingBalance, 52_000);
}

// ── 3. nothing to say is still '—' ─────────────────────────────────────────
console.log('\n  3. no setup, no money → no figure');
{
  eq('setup not complete → null',
    fourWeekCashPosition({ cashData, setupComplete: false, invoices: [], commitments: [framing], projects: [project], changeOrders: [] }),
    null);
  const empty: ForecastCashData = { startingBalance: 0, expenses: [], expectedPayments: [], defaultPaymentTerms: 'net_30' };
  eq('a $0 setup with nothing on file → null',
    fourWeekCashPosition({ cashData: empty, setupComplete: true, invoices: [], commitments: [], projects: [project], changeOrders: [] }),
    null);
  eq('...but a signed subcontract alone is money on file',
    fourWeekCashPosition({ cashData: empty, setupComplete: true, invoices: [], commitments: [framing], projects: [project], changeOrders: [] }),
    -52_000);
  check('tone: positive is success, zero and null are muted',
    cashBalanceTone(1) === 'success' && cashBalanceTone(0) === 'muted' && cashBalanceTone(null) === 'muted');
}

// ── 3b. the income line names the job (wave 5, #108) ─────────────────────
console.log('\n  3b. an invoice line says which job the money is from');
{
  const inv = {
    id: 'i2', projectId: 'p1', number: 12, type: 'full', status: 'sent',
    issueDate: daysFromToday(-1).toISOString(), dueDate: daysFromToday(2).toISOString(),
    paymentTerms: 'net_30', notes: '', lineItems: [], subtotal: 9_000, taxRate: 0, taxAmount: 0,
    totalDue: 9_000, amountPaid: 0, payments: [],
    createdAt: today.toISOString(), updatedAt: today.toISOString(),
  } as unknown as Invoice;
  const weeks = forecastFromInputs(buildForecastInputs({
    cashData, invoices: [inv], commitments: [], projects: [project], changeOrders: [],
  }), 12);
  const descs = weeks.flatMap(w => w.incomeItems.map(i => i.description));
  check('the line reads "Henderson · Invoice #12"', descs.includes('Henderson · Invoice #12'), descs.join(' | '));
  check('...and carries no id fragment or N/A', !descs.some(d => d.includes('(p1') || d.includes('N/A')));
}

// ── 4. wiring ──────────────────────────────────────────────────────────────
console.log('\n  4. both screens use the shared path');
{
  const summary = read('app/(tabs)/summary/index.tsx');
  check('summary reads the server row (passes the user id)',
    /loadCashFlowSettings\(userId\)/.test(summary) && /const userId = user\?\.id/.test(summary),
    'Without the id the loader answers from the device cache — "—" on web and a second phone.');
  check('summary no longer runs its own generateForecast',
    !/generateForecast\(/.test(summary));
  check('summary computes the tile from fourWeekCashPosition with invoices, commitments and COs',
    /fourWeekCashPosition\(\{[\s\S]{0,200}invoices, commitments, projects, changeOrders/.test(summary) &&
    /\}, \[cashSettings, invoices, commitments, projects, changeOrders\]\)/.test(summary),
    'Recording a payment or signing a sub must refresh the tile.');
  check('summary re-reads the setup when the tab regains focus',
    /useFocusEffect\(loadCash\)/.test(summary));
  check('summary shows how old the balance is',
    /cashAsOf=\{cashAsOf\}/.test(summary));

  const strip = read('components/summary/MoneyStrip.tsx');
  check('MoneyStrip colours the tile by cashBalanceTone',
    /const tone = cashBalanceTone\(cash4wk\)/.test(strip) &&
    /tone === 'danger' \? colors\.danger/.test(strip) &&
    /style=\{\[styles\.val, \{ color: cashColor \}\]\}/.test(strip));
  check('MoneyStrip renders the balance date', /\{asOf \? <Text style=\{styles\.asOf\}/.test(strip));

  const screen = read('app/cash-flow.tsx');
  check('/cash-flow builds its forecast from buildForecastInputs',
    /buildForecastInputs\(\{/.test(screen) && /forecastFromInputs\(forecastInputs, forecastWeeks\)/.test(screen) &&
    !/generateForecast\(/.test(screen));

  // The siblings the #17 fix did not reach (integration round 1, money-
  // accounts): the Morning Brief's "Cash dips to …" and the AI's CASH block
  // read the device cache only and (the brief) no commitments, so a sub draw
  // that overdrew the account was red on the tile and absent from the brief.
  const brief = read('hooks/useMorningBrief.ts');
  check('the Morning Brief forecasts through buildForecastInputs with commitments, from the server row',
    /engine\.buildForecastInputs\(\{\s*cashData: settings\.data, invoices, commitments, projects, changeOrders,/.test(brief)
    && /forecastFromInputs\(inputs, 12\)/.test(brief)
    && /loadCashFlowSettings\(userId\)/.test(brief) && /const userId = user\?\.id \?\? null;/.test(brief)
    && !/generateForecast\(/.test(brief) && !/isSetupComplete\(\)/.test(brief));
  check('...and re-runs when commitments or the user change',
    /\}, \[enabled, invoices, changeOrders, commitments, projects, userId, refreshKey\]\);/.test(brief));
  const facts = read('utils/oneMind/factBlocks.ts');
  check('the AI CASH block reads the server row and the same assembly',
    /loadCashFlowSettings\(userId\)/.test(facts) && /engine\.buildForecastInputs\(\{/.test(facts)
    && !/generateForecast\(/.test(facts) && !/isSetupComplete\(\)/.test(facts));
}

if (failures > 0) {
  console.error(`\n✗ validate-cashflow-home-tile: ${failures} failure(s)\n`);
  process.exit(1);
}
console.log('\n✓ validate-cashflow-home-tile: all checks passed\n');
