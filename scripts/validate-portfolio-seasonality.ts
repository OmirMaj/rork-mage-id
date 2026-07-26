#!/usr/bin/env bun
// scripts/validate-portfolio-seasonality.ts
// Pinned validator for buildWeatherSeasonality.
// Covers: zero-loss months suppressed, observed lost days aggregated,
// never throws, noData flag, reportCount.

import { buildWeatherSeasonality } from '../utils/portfolio/seasonality';
import type { DailyFieldReport } from '../types';

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ': ' + detail : ''}`);
    failed++;
  }
}

// ── Fixture helper ────────────────────────────────────────────────────────

function makeDFR(date: string, weatherLost: boolean): DailyFieldReport {
  return {
    id: `dfr-${date}`,
    projectId: 'p1',
    date,
    weather: {
      conditions: 'Rain',
      highTemp: 55,
      lowTemp: 40,
      precipitation: weatherLost ? 0.5 : 0,
    },
    // DFR counting rules: issuesAndDelays must contain explicit stoppage phrase
    issuesAndDelays: weatherLost ? 'Rained out — no work today' : 'Proceeded on schedule',
    workCompleted: '',
    crewCount: 5,
    laborHours: weatherLost ? 0 : 8,
    materials: [],
    inspections: [],
    photos: [],
    safetyNotes: '',
    createdAt: date + 'T12:00:00Z',
    updatedAt: date + 'T12:00:00Z',
  } as unknown as DailyFieldReport;
}

// ── Test 1: basic lost-day suppression ────────────────────────────────────

console.log('\nTest 1: Zero-loss months suppressed, January with loss appears');
{
  const reports: DailyFieldReport[] = [
    makeDFR('2026-01-10', true),  // January lost day
    makeDFR('2026-01-15', true),  // January lost day
    makeDFR('2026-02-10', false), // February — no loss
    makeDFR('2026-07-20', false), // July — no loss
  ];
  const result = buildWeatherSeasonality(reports);
  assert('reportCount = 4', result.reportCount === 4);
  assert('noData = false', !result.noData);
  assert('January present (has lost days)', result.months.some(m => m.month === 0), JSON.stringify(result.months));
  assert('February absent (no lost days)', !result.months.some(m => m.month === 1));
  assert('July absent (no lost days)', !result.months.some(m => m.month === 6));
  const jan = result.months.find(m => m.month === 0)!;
  assert('January label = "Jan"', jan.label === 'Jan');
  assert('January avgLostDays > 0', jan.avgLostDays > 0);
}

// ── Test 2: no reports — noData = true ────────────────────────────────────

console.log('\nTest 2: No reports → noData');
{
  const result = buildWeatherSeasonality([]);
  assert('noData = true when no reports', result.noData);
  assert('months empty', result.months.length === 0);
  assert('reportCount = 0', result.reportCount === 0);
}

// ── Test 3: reports but no lost days → noData ─────────────────────────────

console.log('\nTest 3: Reports but no weather-lost days → noData');
{
  const reports: DailyFieldReport[] = [
    makeDFR('2026-03-01', false),
    makeDFR('2026-03-02', false),
  ];
  const result = buildWeatherSeasonality(reports);
  assert('noData = true (no losses)', result.noData);
  assert('months empty', result.months.length === 0);
}

// ── Test 4: months sorted by month number ─────────────────────────────────

console.log('\nTest 4: Months sorted in calendar order');
{
  const reports: DailyFieldReport[] = [
    makeDFR('2026-12-05', true), // December
    makeDFR('2026-01-05', true), // January
    makeDFR('2026-06-05', true), // June
  ];
  const result = buildWeatherSeasonality(reports);
  assert('3 months present', result.months.length === 3);
  const monthNums = result.months.map(m => m.month);
  assert('sorted calendar order', JSON.stringify(monthNums) === JSON.stringify([0, 5, 11]), `got ${monthNums}`);
}

// ── Test 5: never throws ──────────────────────────────────────────────────

console.log('\nTest 5: Never throws');
{
  let threw = false;
  try { buildWeatherSeasonality([]); } catch { threw = true; }
  assert('did not throw on empty', !threw);
}

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\nportfolio-seasonality: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
