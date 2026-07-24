// validate-pace.ts — unit tests for the Productivity Feedback Loop:
// as-built transition stamping + the pace book engine.
//
// These tests pin INTENDED semantics (adversarial-review fixes), not the
// implementation's current behavior:
//   • null day-basis (no schedule.startDate) → stamp ISO dates ONLY, never
//     invented day numbers (no constant-1, no createdAt-elapsed poison)
//   • leaving `done` clears the stale actuals so re-completion re-stamps
//   • retro back-fill is capped at today (no inverted pairs at the source)
//   • buildPaceBook samples only CURRENTLY-done tasks
//   • actualDays is measured in WORKING days (durationDays' unit), via the
//     schedule's calendar — raw span only when startDate is missing
//   • inverted actual pairs are EXCLUDED, not clamped to a 1-day sample
//   • missing sqft prefers trade|all; no trade|unknown entries exist
//   • the 'general' inference fallback never produces a chip suggestion
//   • suggestDuration rounds half-up (8.5 → 9)
//
// Run via: bun run test:pace
import { stampActuals, todayScheduleDay } from '../utils/pace/stampActuals';
import { buildPaceBook, lookupPace, suggestDuration, bucketForSqft, paceConfidence, paceSuggestionFor } from '../utils/pace/paceBook';
import type { PaceBookEntry } from '../utils/pace/paceBook';
import type { Project, ScheduleTask } from '../types';

let pass = 0, fail = 0;
// Canonicalize (recursively sort object keys) so assertions are insensitive
// to patch-insertion order. NOTE: JSON.stringify drops undefined-valued keys,
// so "cleared to undefined" semantics are asserted via explicit key lists +
// value arrays, never via object equality.
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
const NOW = '2026-07-23T15:00:00.000Z';
function t(over: Partial<ScheduleTask>): ScheduleTask {
  return {
    id: 'T1', title: 'Framing walls', phase: 'Structure', durationDays: 5,
    startDay: 4, progress: 0, crew: '', dependencies: [], notes: '',
    status: 'not_started', ...over,
  } as ScheduleTask;
}

console.log('\npace stampActuals:');

expect('→in_progress stamps start today',
  stampActuals(t({}), 'in_progress', 12, NOW),
  { actualStartDay: 12, actualStartDate: NOW });
expect('→in_progress never overwrites an existing start',
  stampActuals(t({ actualStartDay: 6, actualStartDate: '2026-07-17T08:00:00.000Z' }), 'in_progress', 12, NOW),
  {});
expect('→in_progress with a date-only start capture does NOT invent a day number',
  stampActuals(t({ actualStartDate: '2026-07-17T08:00:00.000Z' }), 'in_progress', 12, NOW),
  {});
expect('→done stamps end only, when start exists',
  stampActuals(t({ status: 'in_progress', actualStartDay: 6 }), 'done', 12, NOW),
  { actualEndDay: 12, actualEndDate: NOW });
expect('→done retro-stamps start from planned startDay (Gantt rule)',
  stampActuals(t({}), 'done', 12, NOW),
  { actualEndDay: 12, actualEndDate: NOW, actualStartDay: 4, actualStartDate: NOW });
expect('→done retro-fill is CAPPED at today (early finish cannot invert the pair)',
  stampActuals(t({ startDay: 30 }), 'done', 10, NOW),
  { actualEndDay: 10, actualEndDate: NOW, actualStartDay: 10, actualStartDate: NOW });
expect('→done never overwrites an existing end',
  stampActuals(t({ status: 'in_progress', actualStartDay: 6, actualEndDay: 9 }), 'done', 12, NOW),
  {});
expect('→done treats a date-only end capture as captured (no re-stamp)',
  stampActuals(t({ status: 'in_progress', actualStartDate: NOW, actualEndDate: '2026-07-20T08:00:00.000Z' }), 'done', 12, NOW),
  {});
expect('→on_hold never stamps',
  stampActuals(t({ status: 'in_progress', actualStartDay: 6 }), 'on_hold', 12, NOW),
  {});
expect('same-status call is a no-op',
  stampActuals(t({ status: 'in_progress' }), 'in_progress', 12, NOW),
  {});

// Null basis: schedule has no startDate → there is NO day-number basis.
// Stamp ISO dates only; a constant fallback would poison the pace book.
expect('null basis →in_progress stamps ISO date only',
  stampActuals(t({}), 'in_progress', null, NOW),
  { actualStartDate: NOW });
expect('null basis →done stamps ISO dates only (no day numbers)',
  stampActuals(t({}), 'done', null, NOW),
  { actualEndDate: NOW, actualStartDate: NOW });

// Leaving done clears the stale stamps so re-completion re-stamps fresh.
const reopen = stampActuals(t({ status: 'done', actualStartDay: 6, actualEndDay: 9 }), 'in_progress', 12, NOW);
expect('done→in_progress clears exactly the end fields (start untouched)',
  Object.keys(reopen).sort(), ['actualEndDate', 'actualEndDay']);
expect('done→in_progress cleared values are undefined',
  [reopen.actualEndDay, reopen.actualEndDate], [undefined, undefined]);
const reset = stampActuals(t({ status: 'done', actualStartDay: 6, actualStartDate: NOW, actualEndDay: 9, actualEndDate: NOW }), 'not_started', 12, NOW);
expect('done→not_started clears all four actuals',
  Object.keys(reset).sort(), ['actualEndDate', 'actualEndDay', 'actualStartDate', 'actualStartDay']);
expect('done→not_started cleared values are undefined',
  [reset.actualStartDay, reset.actualStartDate, reset.actualEndDay, reset.actualEndDate],
  [undefined, undefined, undefined, undefined]);
expect('re-completion after a reopen re-stamps a fresh end',
  stampActuals(t({ status: 'in_progress', actualStartDay: 6 }), 'done', 24, NOW),
  { actualEndDay: 24, actualEndDate: NOW });
expect('in_progress→not_started does NOT clear (only leaving done clears)',
  stampActuals(t({ status: 'in_progress', actualStartDay: 6 }), 'not_started', 12, NOW),
  {});

console.log('\npace todayScheduleDay:');

const NOON = new Date('2026-07-23T12:00:00');
expect('schedule started today → day 1', todayScheduleDay('2026-07-23', NOON), 1);
expect('schedule started 10 days ago → day 11', todayScheduleDay('2026-07-13', NOON), 11);
expect('future start clamps to day 1', todayScheduleDay('2026-08-01', NOON), 1);
expect('missing startDate → null (no basis — stamp dates only)', todayScheduleDay(undefined, NOON), null);
expect('garbage startDate → null', todayScheduleDay('not-a-date', NOON), null);
// Component-normalized day math (both ends snapped to local midnight, delta
// ROUNDED): 00:30 counts as the full day. A raw-ms floor over the elapsed
// time would land a day short in the 00:00–01:00 window after a DST
// spring-forward; round() absorbs the ±1h skew.
expect('00:30 local still counts as the full day (midnight-normalized, rounded)',
  todayScheduleDay('2026-07-13', new Date('2026-07-23T00:30:00')), 11);

console.log('\npace bucketForSqft:');

expect('1999 → small', bucketForSqft(1999), 'small');
expect('2000 → medium', bucketForSqft(2000), 'medium');
expect('3499 → medium', bucketForSqft(3499), 'medium');
expect('3500 → large', bucketForSqft(3500), 'large');
expect('5999 → large', bucketForSqft(5999), 'large');
// Canonical boundary: 6000 belongs to xlarge (code doc: "xlarge ≥6000").
expect('6000 → xlarge (boundary is canonical)', bucketForSqft(6000), 'xlarge');
expect('0 → unknown', bucketForSqft(0), 'unknown');
expect('undefined → unknown', bucketForSqft(undefined), 'unknown');

console.log('\npace paceConfidence:');

expect('5 jobs, cv 0.20 → high', paceConfidence(5, 0.20), 'high');
expect('5 jobs, cv 0.35 → high (inclusive edge)', paceConfidence(5, 0.35), 'high');
expect('5 jobs, cv 0.36 → medium', paceConfidence(5, 0.36), 'medium');
expect('4 jobs → medium', paceConfidence(4, 0.10), 'medium');
expect('2 jobs → low', paceConfidence(2, 0.01), 'low');

console.log('\npace buildPaceBook:');

function projWithSchedule(
  id: string, sqft: number | undefined, tasks: ScheduleTask[],
  cal?: { startDate?: string; workingDaysPerWeek?: number; nonWorkingDates?: string[] },
): Project {
  return {
    id, name: `Job ${id}`, squareFootage: sqft,
    schedule: {
      id: `s-${id}`, name: 'Sched', projectId: id,
      workingDaysPerWeek: cal?.workingDaysPerWeek ?? 5,
      startDate: cal?.startDate,
      nonWorkingDates: cal?.nonWorkingDates,
      bufferDays: 0, tasks, totalDurationDays: 0, criticalPathDays: 0,
      laborAlignmentScore: 0, riskItems: [],
    },
  } as unknown as Project;
}

// P1–P5 have NO schedule.startDate → actualDays falls back to the raw
// calendar span (matching cpm.ts raw-day degradation: no anchor ⇒ every day
// counts). P6/P7 pin the working-day conversion with a real calendar.
const book = buildPaceBook([
  projWithSchedule('P1', 1800, [
    t({ id: 'f1', tradeKey: 'framing', status: 'done', durationDays: 7, actualStartDay: 3, actualEndDay: 10, actualEndDate: '2026-06-01' }),
    t({ id: 'pl1', title: 'Rough plumbing install', status: 'done', durationDays: 4, actualStartDay: 5, actualEndDay: 8, actualEndDate: '2026-06-05' }),
    t({ id: 'g1', title: 'Order windows', status: 'done', durationDays: 2, actualStartDay: 3, actualEndDay: 4, actualEndDate: '2026-06-02' }),
    t({ id: 'st1', tradeKey: 'steel', status: 'done', durationDays: 3, actualStartDay: 4 }),                          // end never captured → excluded
    t({ id: 'ms1', tradeKey: 'roofing', status: 'done', durationDays: 0, isMilestone: true, actualStartDay: 1, actualEndDay: 1 }), // milestone → excluded
    t({ id: 'e1', tradeKey: 'electrical', status: 'in_progress', actualStartDay: 1, actualEndDay: 3, actualEndDate: '2026-06-03' }), // reopened → excluded
  ]),
  projWithSchedule('P2', 1800, [
    t({ id: 'f2', tradeKey: 'framing', status: 'done', durationDays: 7, actualStartDay: 1, actualEndDay: 12, actualEndDate: '2026-07-01' }),
    t({ id: 'g2', title: 'Permit pickup', status: 'done', durationDays: 1, actualStartDay: 5, actualEndDay: 5, actualEndDate: '2026-07-02' }),
  ]),
  projWithSchedule('P3', 4000, [
    t({ id: 'f3', tradeKey: 'framing', status: 'done', durationDays: 6, actualStartDay: 2, actualEndDay: 7, actualEndDate: '2026-07-10' }),
    t({ id: 'c3', tradeKey: 'concrete', status: 'done', durationDays: 2, actualStartDay: 9, actualEndDay: 5, actualEndDate: '2026-07-12' }), // inverted → EXCLUDED
    t({ id: 'g3', title: 'Site cleanup', status: 'done', durationDays: 1, actualStartDay: 2, actualEndDay: 2, actualEndDate: '2026-07-11' }),
  ]),
  projWithSchedule('P4', 2500, [
    t({ id: 'n4', tradeKey: 'framing', status: 'done', durationDays: 5 }),                                            // no actuals → excluded
  ]),
  // Missing sqft → samples land ONLY in |all (no framing|unknown entry).
  projWithSchedule('P5', undefined, [
    t({ id: 'f5', tradeKey: 'framing', status: 'done', durationDays: 7, actualStartDay: 1, actualEndDay: 7, actualEndDate: '2026-07-15' }),
  ]),
  // 2026-06-01 is a Monday. 5-day week: day 1..5 = Mon–Fri, 6/7 = weekend.
  projWithSchedule('P6', 3600, [
    // 7-calendar-day span (Mon→Sun) pins to 5 WORKING days.
    t({ id: 'h1', tradeKey: 'hvac', status: 'done', durationDays: 5, actualStartDay: 1, actualEndDay: 7, actualEndDate: '2026-06-07' }),
    // On-plan weekend-crossing task: 7 working days planned, day 8 (Mon) →
    // day 16 (Tue) = 9 calendar days = exactly 7 working days → bias 0.
    t({ id: 'h2', tradeKey: 'hvac', status: 'done', durationDays: 7, actualStartDay: 8, actualEndDay: 16, actualEndDate: '2026-06-16' }),
  ], { startDate: '2026-06-01', workingDaysPerWeek: 5 }),
  // nonWorkingDates closure (Wed 2026-06-03) also skipped: Mon–Fri span = 4.
  projWithSchedule('P7', 1200, [
    t({ id: 'd1', tradeKey: 'demo', status: 'done', durationDays: 4, actualStartDay: 1, actualEndDay: 5, actualEndDate: '2026-06-05' }),
  ], { startDate: '2026-06-01', workingDaysPerWeek: 5, nonWorkingDates: ['2026-06-03'] }),
]);

expect('jobsAnalyzed counts only contributing projects', book.jobsAnalyzed, 6);
expect('tradesTracked counts distinct trades', book.tradesTracked, 5);
expect('no sample without BOTH actual day numbers (steel absent)', lookupPace(book, 'steel', 1800), null);
expect('milestones excluded (roofing absent)', lookupPace(book, 'roofing', 1800), null);
expect('non-done tasks excluded even with both actuals (electrical absent)', lookupPace(book, 'electrical', 1800), null);
expect('inverted pairs EXCLUDED, not clamped (concrete absent)', lookupPace(book, 'concrete', 4000), null);
expect('no trade|unknown entries are ever emitted', book.entries.some(e => e.key.endsWith('|unknown')), false);

const framingSmall = lookupPace(book, 'framing', 1800)!;
expect('exact-bucket lookup hits framing|small', framingSmall.key, 'framing|small');
expect('sampleCount', framingSmall.sampleCount, 2);
expect('jobCount', framingSmall.jobCount, 2);
expect('plannedMean', framingSmall.plannedMean, 7);
expect('actualMean (raw span when schedule has no startDate)', framingSmall.actualMean, 10);
expect('bias ≈ +42.9% (plans optimistic)', Math.round(framingSmall.bias * 1000), 429);
expect('variability cv 0.2', framingSmall.variability, 0.2);
expect('confidence low at 2 jobs', framingSmall.confidence, 'low');
expect('newest sample first', framingSmall.samples[0], {
  projectId: 'P2', projectName: 'Job P2', trade: 'framing', sqftBucket: 'small',
  plannedDays: 7, actualDays: 12, completedAt: '2026-07-01',
});

expect('trade inferred from title (plumbing)', lookupPace(book, 'plumbing', 1800)?.sampleCount, 1);

// Working-day unit consistency (actualDays must share durationDays' unit).
const hvacLarge = lookupPace(book, 'hvac', 3600)!;
expect('7-calendar-day span over a 5-day week pins to 5 working days',
  hvacLarge.samples.find(s => s.completedAt === '2026-06-07')?.actualDays, 5);
expect('on-plan weekend-crossing tasks read bias 0 (no calendar inflation)', hvacLarge.bias, 0);
expect('working-day actualMean matches working-day plannedMean when on plan', hvacLarge.actualMean, 6);
expect('nonWorkingDates closures are skipped too (Mon–Fri minus Wed = 4)',
  lookupPace(book, 'demo', 1200)?.actualMean, 4);

expect('bucket miss falls back to trade-wide |all', lookupPace(book, 'framing', 2500)?.key, 'framing|all');
expect('|all jobCount spans buckets (incl. the sqft-less project)', lookupPace(book, 'framing', 2500)?.jobCount, 4);
expect('missing sqft goes STRAIGHT to |all (never a |unknown subset)', lookupPace(book, 'framing', undefined)?.key, 'framing|all');
expect('unknown trade → null', lookupPace(book, 'masonry', 1800), null);

console.log('\npace suggestDuration:');

const pe = (over: Partial<PaceBookEntry>): PaceBookEntry => ({
  key: 'framing|small', trade: 'framing', sqftBucket: 'small',
  sampleCount: 4, jobCount: 4, plannedMean: 7, actualMean: 11,
  variability: 0.2, bias: 0.57, confidence: 'medium', samples: [], ...over,
});
expect('blend: 4 jobs, planned 7, your mean 11 → 9', suggestDuration(pe({}), 7), 9);
expect('blend: 1 job leans on the plan (mean 20, proposed 5 → 9)', suggestDuration(pe({ jobCount: 1, actualMean: 20 }), 5), 9);
expect('floor at 1 day', suggestDuration(pe({ jobCount: 5, actualMean: 1 }), 1), 1);
// Half-tie pin: jobCount 3 ⇒ w = 0.5; 0.5·7 + 0.5·10 = 8.5 → rounds UP to 9.
expect('half-tie rounds up (8.5 → 9) — canonical', suggestDuration(pe({ jobCount: 3, actualMean: 10 }), 7), 9);

console.log('\npace paceSuggestionFor (chip decision):');

// The book DOES know 'general' at medium confidence (3 jobs)…
expect('general|all exists at medium confidence (setup sanity)',
  lookupPace(book, 'general', undefined)?.confidence, 'medium');
// …but the chip must stay silent: general pools unrelated misc tasks.
expect('general-trade tasks NEVER get a chip suggestion',
  paceSuggestionFor(book, t({ title: 'Mobilization', durationDays: 5 }), undefined), null);
expect('milestones never get a suggestion',
  paceSuggestionFor(book, t({ tradeKey: 'framing', isMilestone: true, durationDays: 5 }), 2500), null);
expect('low-confidence entries stay silent (hvac|large has 1 job)',
  paceSuggestionFor(book, t({ tradeKey: 'hvac', durationDays: 20 }), 3600), null);
// framing|all: jobCount 4 (w = 4/7), actualMean 8.25.
// dur 20 → (3/7)·20 + (4/7)·8.25 = 93/7 ≈ 13.29 → 13.
expect('medium-confidence disagreement suggests the blend',
  paceSuggestionFor(book, t({ tradeKey: 'framing', durationDays: 20 }), 2500),
  { days: 13, jobCount: 4, confidence: 'medium' });
// dur 8 → (3/7)·8 + (4/7)·8.25 = 57/7 ≈ 8.14 → 8 → agrees within a day → silent.
expect('agreement within a day stays silent',
  paceSuggestionFor(book, t({ tradeKey: 'framing', durationDays: 8 }), 2500), null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
