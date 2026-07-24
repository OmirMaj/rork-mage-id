// validate-pace.ts — unit tests for the Productivity Feedback Loop:
// as-built transition stamping + the pace book engine.
// Run via: bun run test:pace
import { stampActuals, todayDayNumberFrom } from '../utils/pace/stampActuals';
import { buildPaceBook, lookupPace, suggestDuration, bucketForSqft, paceConfidence } from '../utils/pace/paceBook';
import type { PaceBookEntry } from '../utils/pace/paceBook';
import type { Project, ScheduleTask } from '../types';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got:  ', JSON.stringify(got), '\n      want: ', JSON.stringify(want)); }
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
expect('→done stamps end only, when start exists',
  stampActuals(t({ status: 'in_progress', actualStartDay: 6 }), 'done', 12, NOW),
  { actualEndDay: 12, actualEndDate: NOW });
expect('→done retro-stamps start from planned startDay (Gantt rule)',
  stampActuals(t({}), 'done', 12, NOW),
  { actualEndDay: 12, actualEndDate: NOW, actualStartDay: 4, actualStartDate: NOW });
expect('→done never overwrites an existing end',
  stampActuals(t({ status: 'in_progress', actualStartDay: 6, actualEndDay: 9 }), 'done', 12, NOW),
  {});
expect('→on_hold never stamps',
  stampActuals(t({ status: 'in_progress', actualStartDay: 6 }), 'on_hold', 12, NOW),
  {});
expect('same-status call is a no-op',
  stampActuals(t({ status: 'in_progress' }), 'in_progress', 12, NOW),
  {});
expect('reopen (→not_started) never stamps or clears',
  stampActuals(t({ status: 'done', actualStartDay: 6, actualEndDay: 9 }), 'not_started', 12, NOW),
  {});

console.log('\npace todayDayNumberFrom:');

const NOON = new Date('2026-07-23T12:00:00');
expect('schedule started today → day 1', todayDayNumberFrom('2026-07-23', NOON), 1);
expect('schedule started 10 days ago → day 11', todayDayNumberFrom('2026-07-13', NOON), 11);
expect('future start clamps to day 1', todayDayNumberFrom('2026-08-01', NOON), 1);
expect('missing startDate → day 1', todayDayNumberFrom(undefined, NOON), 1);
expect('garbage startDate → day 1', todayDayNumberFrom('not-a-date', NOON), 1);

console.log('\npace bucketForSqft:');

expect('1999 → small', bucketForSqft(1999), 'small');
expect('2000 → medium', bucketForSqft(2000), 'medium');
expect('3499 → medium', bucketForSqft(3499), 'medium');
expect('3500 → large', bucketForSqft(3500), 'large');
expect('5999 → large', bucketForSqft(5999), 'large');
expect('6000 → xlarge', bucketForSqft(6000), 'xlarge');
expect('0 → unknown', bucketForSqft(0), 'unknown');
expect('undefined → unknown', bucketForSqft(undefined), 'unknown');

console.log('\npace paceConfidence:');

expect('5 jobs, cv 0.20 → high', paceConfidence(5, 0.20), 'high');
expect('5 jobs, cv 0.35 → high (inclusive edge)', paceConfidence(5, 0.35), 'high');
expect('5 jobs, cv 0.36 → medium', paceConfidence(5, 0.36), 'medium');
expect('4 jobs → medium', paceConfidence(4, 0.10), 'medium');
expect('2 jobs → low', paceConfidence(2, 0.01), 'low');

console.log('\npace buildPaceBook:');

function projWithSchedule(id: string, sqft: number, tasks: ScheduleTask[]): Project {
  return {
    id, name: `Job ${id}`, squareFootage: sqft,
    schedule: {
      id: `s-${id}`, name: 'Sched', projectId: id, workingDaysPerWeek: 5,
      bufferDays: 0, tasks, totalDurationDays: 0, criticalPathDays: 0,
      laborAlignmentScore: 0, riskItems: [],
    },
  } as unknown as Project;
}

const book = buildPaceBook([
  projWithSchedule('P1', 1800, [
    t({ id: 'f1', tradeKey: 'framing', durationDays: 7, actualStartDay: 3, actualEndDay: 10, actualEndDate: '2026-06-01' }),
    t({ id: 'pl1', title: 'Rough plumbing install', durationDays: 4, actualStartDay: 5, actualEndDay: 8, actualEndDate: '2026-06-05' }),
    t({ id: 'st1', tradeKey: 'steel', durationDays: 3, actualStartDay: 4 }),                          // end never captured → excluded
    t({ id: 'ms1', tradeKey: 'roofing', durationDays: 0, isMilestone: true, actualStartDay: 1, actualEndDay: 1 }), // milestone → excluded
  ]),
  projWithSchedule('P2', 1800, [
    t({ id: 'f2', tradeKey: 'framing', durationDays: 7, actualStartDay: 1, actualEndDay: 12, actualEndDate: '2026-07-01' }),
  ]),
  projWithSchedule('P3', 4000, [
    t({ id: 'f3', tradeKey: 'framing', durationDays: 6, actualStartDay: 2, actualEndDay: 7, actualEndDate: '2026-07-10' }),
    t({ id: 'c3', tradeKey: 'concrete', durationDays: 2, actualStartDay: 9, actualEndDay: 5, actualEndDate: '2026-07-12' }), // reversed → clamp 1
  ]),
  projWithSchedule('P4', 2500, [
    t({ id: 'n4', tradeKey: 'framing', durationDays: 5 }),                                            // no actuals → excluded
  ]),
]);

expect('jobsAnalyzed counts only contributing projects', book.jobsAnalyzed, 3);
expect('tradesTracked counts distinct trades', book.tradesTracked, 3);
expect('no sample without BOTH actuals (steel absent)', lookupPace(book, 'steel', 1800), null);
expect('milestones excluded (roofing absent)', lookupPace(book, 'roofing', 1800), null);

const framingSmall = lookupPace(book, 'framing', 1800)!;
expect('exact-bucket lookup hits framing|small', framingSmall.key, 'framing|small');
expect('sampleCount', framingSmall.sampleCount, 2);
expect('jobCount', framingSmall.jobCount, 2);
expect('plannedMean', framingSmall.plannedMean, 7);
expect('actualMean', framingSmall.actualMean, 10);
expect('bias ≈ +42.9% (plans optimistic)', Math.round(framingSmall.bias * 1000), 429);
expect('variability cv 0.2', framingSmall.variability, 0.2);
expect('confidence low at 2 jobs', framingSmall.confidence, 'low');
expect('newest sample first', framingSmall.samples[0], {
  projectId: 'P2', projectName: 'Job P2', trade: 'framing', sqftBucket: 'small',
  plannedDays: 7, actualDays: 12, completedAt: '2026-07-01',
});

expect('trade inferred from title (plumbing)', lookupPace(book, 'plumbing', 1800)?.sampleCount, 1);
expect('reversed actuals clamp to 1 day', lookupPace(book, 'concrete', 4000)?.actualMean, 1);

expect('bucket miss falls back to trade-wide |all', lookupPace(book, 'framing', 2500)?.key, 'framing|all');
expect('|all jobCount spans buckets', lookupPace(book, 'framing', 2500)?.jobCount, 3);
expect('unknown sqft falls back to |all', lookupPace(book, 'framing', undefined)?.key, 'framing|all');
expect('unknown trade → null', lookupPace(book, 'hvac', 1800), null);

console.log('\npace suggestDuration:');

const pe = (over: Partial<PaceBookEntry>): PaceBookEntry => ({
  key: 'framing|small', trade: 'framing', sqftBucket: 'small',
  sampleCount: 4, jobCount: 4, plannedMean: 7, actualMean: 11,
  variability: 0.2, bias: 0.57, confidence: 'medium', samples: [], ...over,
});
expect('blend: 4 jobs, planned 7, your mean 11 → 9', suggestDuration(pe({}), 7), 9);
expect('blend: 1 job leans on the plan (mean 20, proposed 5 → 9)', suggestDuration(pe({ jobCount: 1, actualMean: 20 }), 5), 9);
expect('floor at 1 day', suggestDuration(pe({ jobCount: 5, actualMean: 1 }), 1), 1);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
