// validate-labor-samples.ts — unit tests for the self-perform labor bridge:
// time entries → cost samples → the cost book (flywheel#56).
//
// Pins INTENDED semantics:
//   • only FINISHED shifts (clocked_out) with hours > 0 on a real project
//     become samples — live shifts, zero-hour, and 'unassigned' are excluded
//   • dollars require a GC-configured rate for the trade — no rate, no
//     sample; zero/negative rates are treated as unset (never fake dollars)
//   • trade attribution comes straight off the entry; placeholder trades
//     ('', 'Crew', 'General', 'Labor') collapse into "Labor — general"
//   • samples aggregate per (project, trade): qty = summed hours,
//     actualUnit = the configured rate, bidUnit = 0 (no bid context)
//   • buildCostDatabase folds labor via the 4th param exactly like receipts
//     (additive; omitting it is byte-identical to the pre-labor behavior)
//
// Run via: bun run test:labor-samples

import {
  buildLaborSamples, computeLaborStats, normalizeTradeKey, laborTradeLabel,
  isEligibleLaborEntry, LABOR_UNIT,
} from '../utils/laborSamples';
import { buildCostDatabase, lookupRate } from '../utils/costDatabase';
import type { TimeEntry } from '../types';

let pass = 0, fail = 0;
function canon(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(canon);
  if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>;
    return Object.keys(o).sort().reduce<Record<string, unknown>>((acc, k) => { acc[k] = canon(o[k]); return acc; }, {});
  }
  return x;
}
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(canon(got)) === JSON.stringify(canon(want));
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got:  ', JSON.stringify(canon(got)), '\n      want: ', JSON.stringify(canon(want))); }
}

// ── Fixtures ──
function entry(over: Partial<TimeEntry>): TimeEntry {
  return {
    id: 'e1', projectId: 'p1', projectName: 'Henderson Remodel',
    workerId: 'w1', workerName: 'Alex', trade: 'Framing',
    clockIn: '2026-07-20T08:00:00.000Z', clockOut: '2026-07-20T16:00:00.000Z',
    breakMinutes: 0, totalHours: 8, overtimeHours: 0,
    status: 'clocked_out', date: '2026-07-20', ...over,
  };
}
const RATES = { framing: 34, electrical: 42 };

console.log('\nnormalizeTradeKey / laborTradeLabel:');
expect('specific trade lowercases', normalizeTradeKey('Framing'), 'framing');
expect("'' collapses to general", normalizeTradeKey(''), 'general');
expect("'Crew' placeholder collapses to general", normalizeTradeKey('Crew'), 'general');
expect("'Labor' placeholder collapses to general", normalizeTradeKey(' Labor '), 'general');
expect('label keeps original casing', laborTradeLabel('Framing'), 'Labor — Framing');
expect('generic label', laborTradeLabel('Crew'), 'Labor — general');

console.log('\neligibility:');
expect('finished shift on a real project is eligible', isEligibleLaborEntry(entry({})), true);
expect('live shift excluded', isEligibleLaborEntry(entry({ status: 'clocked_in' })), false);
expect('break shift excluded', isEligibleLaborEntry(entry({ status: 'break' })), false);
expect('zero-hour shift excluded', isEligibleLaborEntry(entry({ totalHours: 0 })), false);
expect("'unassigned' project excluded", isEligibleLaborEntry(entry({ projectId: 'unassigned' })), false);

console.log('\nbuildLaborSamples:');
expect('entry → sample mapping (qty=hours, actualUnit=rate, bidUnit=0)',
  buildLaborSamples([entry({})], RATES),
  [{
    projectId: 'p1', projectName: 'Henderson Remodel', trade: 'Labor — Framing',
    unit: LABOR_UNIT, quantity: 8, bidUnit: 0, actualUnit: 34, basis: 'actual',
    closedAt: '2026-07-20',
  }]);

expect('same project+trade aggregates hours; latest date wins',
  buildLaborSamples([
    entry({ id: 'a', totalHours: 8, date: '2026-07-20' }),
    entry({ id: 'b', totalHours: 6.5, date: '2026-07-22' }),
  ], RATES).map(s => ({ quantity: s.quantity, closedAt: s.closedAt })),
  [{ quantity: 14.5, closedAt: '2026-07-22' }]);

expect('different trades split into separate samples',
  buildLaborSamples([
    entry({ id: 'a', trade: 'Framing' }),
    entry({ id: 'b', trade: 'Electrical', totalHours: 4 }),
  ], RATES).map(s => `${s.trade}:${s.quantity}@${s.actualUnit}`).sort(),
  ['Labor — Electrical:4@42', 'Labor — Framing:8@34']);

expect('no configured rate ⇒ no sample (never fake dollars)',
  buildLaborSamples([entry({ trade: 'Plumbing' })], RATES), []);
expect('zero rate treated as unset',
  buildLaborSamples([entry({})], { framing: 0 }), []);
expect('placeholder trade uses the general rate bucket',
  buildLaborSamples([entry({ trade: 'Crew' })], { general: 28 }).map(s => `${s.trade}@${s.actualUnit}`),
  ['Labor — general@28']);
expect('live/zero-hour/unassigned entries contribute nothing',
  buildLaborSamples([
    entry({ id: 'a', status: 'clocked_in' }),
    entry({ id: 'b', totalHours: 0 }),
    entry({ id: 'c', projectId: 'unassigned' }),
  ], RATES), []);

console.log('\ncomputeLaborStats:');
expect('stats split sampled vs missing-rate',
  computeLaborStats([
    entry({ id: 'a', trade: 'Framing', totalHours: 8 }),
    entry({ id: 'b', trade: 'Plumbing', totalHours: 5 }),
    entry({ id: 'c', status: 'clocked_in' }), // ineligible, not counted
  ], RATES),
  { eligibleEntries: 2, sampledEntries: 1, sampledHours: 8, tradesMissingRates: ['plumbing'] });

console.log('\ncost-book fold-in:');
{
  const samples = buildLaborSamples([
    entry({ id: 'a', totalHours: 8 }),
    entry({ id: 'b', totalHours: 6, projectId: 'p2', projectName: 'Oak St Addition', date: '2026-07-21' }),
  ], RATES);
  const db = buildCostDatabase([], [], [], samples);
  const e = lookupRate(db, 'Labor — Framing', 'hour');
  expect('labor entry lands in the book keyed labor — framing|hour',
    e ? { trade: e.trade, unit: e.unit, sampleCount: e.sampleCount, jobCount: e.jobCount } : null,
    { trade: 'Labor — Framing', unit: 'hour', sampleCount: 2, jobCount: 2 });
  expect('personalRate is the configured rate (hours-weighted)',
    e?.personalRate, 34);
  expect('suggestedRate equals the rate (baseline falls back to personalRate)',
    e?.suggestedRate, 34);
  expect('totalActual = hours × rate across projects',
    e?.totalActual, 14 * 34);
  expect('labor projects count into jobsAnalyzed', db.jobsAnalyzed, 2);
}
expect('4th param default [] — omitting labor is byte-identical',
  JSON.stringify({ ...buildCostDatabase([], [], []), asOf: 'x' }),
  JSON.stringify({ ...buildCostDatabase([], [], [], []), asOf: 'x' }));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
