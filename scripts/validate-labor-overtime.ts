// validate-labor-overtime.ts — overtime hours are PRICED, not merely counted
// (audit MONEY-F19, docs/audits/2026-09-03-final-push/04-money.md).
//
// hooks/useTimeEntries.computeShiftHours splits every shift into totalHours
// and overtimeHours (anything past 8h/day), and nothing downstream ever priced
// the premium: utils/jobCostEngine booked totalHours × rate, and
// utils/laborSamples learned actualUnit = rate. A 10-hour day at a $50 loaded
// rate booked $500; the crew cost $550 (8 × $50 + 2 × $75). Every OT day
// understated self-perform actuals by the premium, and the cost book learned a
// $/hr that a crew on overtime never achieves.
//
// Pins INTENDED semantics:
//   • priceLaborEntry = (total − OT) × rate + OT × rate × multiplier, default 1.5
//   • a legacy entry with no overtimeHours prices at straight time
//   • OT can never exceed total hours; a multiplier below 1 (or junk) is sane-d
//   • computeJobCost books the PRICED cost (10h @ $50 → $550, not $500)
//   • buildLaborSamples learns the EFFECTIVE $/hr on OT days (qty = hours,
//     actualUnit = priced ÷ hours) and is byte-identical for straight-time days
//   • the per-GC multiplier lives in hooks/useLaborRates under a mageid_ key
//     (so it is tenant-wiped) and reaches useLaborCostSamples (source-level)
//
// Run via: bun run scripts/validate-labor-overtime.ts

import {
  priceLaborEntry, normalizeOvertimeMultiplier, buildLaborSamples,
  DEFAULT_OVERTIME_MULTIPLIER, MAX_OVERTIME_MULTIPLIER,
} from '../utils/laborSamples';
import { computeJobCost } from '../utils/jobCostEngine';
import { buildCostDatabase, lookupRate } from '../utils/costDatabase';
import type { Project, TimeEntry } from '../types';
// fileURLToPath + join because the repo path contains a space.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got: ', JSON.stringify(got), '\n      want:', JSON.stringify(want)); }
}
function ok(name: string, cond: boolean, why?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, why ? `\n      ${why}` : ''); }
}

function entry(over: Partial<TimeEntry>): TimeEntry {
  return {
    id: 'e1', projectId: 'p1', projectName: 'Henderson Remodel',
    workerId: 'w1', workerName: 'Alex', trade: 'Framing',
    clockIn: '2026-07-20T08:00:00.000Z', clockOut: '2026-07-20T18:00:00.000Z',
    breakMinutes: 0, totalHours: 10, overtimeHours: 2,
    status: 'clocked_out', date: '2026-07-20', ...over,
  };
}
const RATE = 50;
const tenHourDay = entry({});
const eightHourDay = entry({ id: 'e2', clockOut: '2026-07-20T16:00:00.000Z', totalHours: 8, overtimeHours: 0 });

console.log('\novertime pricing (MONEY-F19):');

// ── 1. the price of one entry ──────────────────────────────────────────────
expect('default multiplier is time-and-a-half', DEFAULT_OVERTIME_MULTIPLIER, 1.5);
expect('10h day @ $50 loaded books $550, not $500', priceLaborEntry(tenHourDay, RATE), 550);
expect('8h day @ $50 books $400 (straight time is untouched)', priceLaborEntry(eightHourDay, RATE), 400);
expect('a GC paying no premium (×1) books $500', priceLaborEntry(tenHourDay, RATE, 1), 500);
expect('double time (×2) books $600', priceLaborEntry(tenHourDay, RATE, 2), 600);
expect('a legacy entry with no overtimeHours prices at straight time',
  priceLaborEntry(entry({ overtimeHours: undefined as unknown as number }), RATE), 500);
expect('OT hours can never exceed total hours',
  priceLaborEntry(entry({ totalHours: 4, overtimeHours: 9 }), RATE), 300);
expect('negative OT hours count as zero',
  priceLaborEntry(entry({ overtimeHours: -3 }), RATE), 500);

// ── 2. the multiplier is sane-d, never trusted raw ─────────────────────────
expect('NaN / undefined / 0 fall back to the default',
  [NaN, undefined, 0, -1].map(normalizeOvertimeMultiplier),
  [1.5, 1.5, 1.5, 1.5]);
expect('below 1× (OT cheaper than straight time) clamps to 1×', normalizeOvertimeMultiplier(0.5), 1);
expect('a typo like 15 caps at the ceiling', normalizeOvertimeMultiplier(15), MAX_OVERTIME_MULTIPLIER);
expect('a real value passes through', normalizeOvertimeMultiplier(1.75), 1.75);
expect('priceLaborEntry applies the same sanity', priceLaborEntry(tenHourDay, RATE, 0.5), 500);

// ── 3. the job-cost engine books the priced cost ───────────────────────────
{
  const project = { id: 'p1', name: 'Henderson Remodel' } as unknown as Project;
  const base = { project, commitments: [], invoices: [], changeOrders: [], laborRates: { framing: RATE } };
  const labor = (s: ReturnType<typeof computeJobCost>) => s.byPhase.find(l => l.phase === 'Self-perform labor');

  expect('Job Costing books a 10h day at $550 (audit worked example)',
    labor(computeJobCost({ ...base, timeEntries: [tenHourDay] }))?.actual, 550);
  expect('…and the project actual carries the premium', computeJobCost({ ...base, timeEntries: [tenHourDay] }).actual, 550);
  expect('a per-GC multiplier of 1× books $500',
    labor(computeJobCost({ ...base, timeEntries: [tenHourDay], overtimeMultiplier: 1 }))?.actual, 500);
  expect('an 8h day is byte-identical to the pre-fix engine',
    labor(computeJobCost({ ...base, timeEntries: [eightHourDay] }))?.actual, 400);
  expect('a week of 8h + 10h books $950', computeJobCost({ ...base, timeEntries: [eightHourDay, tenHourDay] }).actual, 950);
}

// ── 4. the learned labor sample is the priced cost ─────────────────────────
{
  const [s] = buildLaborSamples([tenHourDay], { framing: RATE });
  expect('a 10h OT day learns quantity = 10 hours', s.quantity, 10);
  expect('…and actualUnit = $55/hr — the rate the crew actually cost', s.actualUnit, 55);
  expect('a straight-time day still learns exactly the configured rate',
    buildLaborSamples([eightHourDay], { framing: RATE })[0].actualUnit, RATE);
  const [wk] = buildLaborSamples([eightHourDay, tenHourDay], { framing: RATE });
  expect('a week of 8h + 10h aggregates 18 hours', wk.quantity, 18);
  ok('…at an effective rate whose hours × rate reproduces the $950 priced cost',
    Math.abs(wk.quantity * wk.actualUnit - 950) < 0.01, `got ${wk.quantity * wk.actualUnit}`);
  expect('a 1× GC learns the configured rate even on OT days',
    buildLaborSamples([tenHourDay], { framing: RATE }, 1)[0].actualUnit, RATE);

  const db = buildCostDatabase([], [], [], buildLaborSamples([eightHourDay, tenHourDay], { framing: RATE }));
  const e = lookupRate(db, 'Labor — Framing', 'hour');
  ok('the cost book totals the priced $950, not $900',
    e != null && Math.abs(e.totalActual - 950) < 0.01, `got ${e?.totalActual}`);
}

// ── 5. the per-GC setting is wired (source-level — hooks cannot run under bun) ──
{
  const hook = src('hooks/useLaborRates.ts');
  ok('useLaborRates persists the multiplier under a mageid_ key (tenant-wiped)',
    /mageid_labor_overtime/.test(hook));
  ok('useLaborRates exposes overtimeMultiplier + setOvertimeMultiplier',
    /overtimeMultiplier/.test(hook) && /setOvertimeMultiplier/.test(hook));
  ok('useLaborCostSamples threads the multiplier into buildLaborSamples',
    /buildLaborSamples\(entries, rates, overtimeMultiplier\)/.test(hook));
  const engine = src('utils/jobCostEngine.ts');
  ok('the engine prices through priceLaborEntry, never totalHours × rate',
    /priceLaborEntry\(/.test(engine) && !/e\.totalHours \* rate/.test(engine));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
