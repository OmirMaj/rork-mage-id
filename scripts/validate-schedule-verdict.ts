// scripts/validate-schedule-verdict.ts — pure-fn validator for utils/scheduleVerdict.ts.
// Run via `bun run scripts/validate-schedule-verdict.ts`. No jest in this repo.
import { scheduleVerdict } from '../utils/scheduleVerdict';
import { finishDriverTitle, pacedScheduleVerdict, verdictToneTokens } from '../utils/scheduleOps';
import type { ScheduleTask } from '../types';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got:  ', got, '\n      want: ', want); }
}

// On pace, no issues.
const onPace = scheduleVerdict({ slipDaysVsBaseline: 0, finishDateLabel: 'Aug 14, 2026', overdueCount: 0 });
expect('onPace tone', onPace.tone, 'onPace');
expect('onPace headline', onPace.headline, 'On pace — finishing about Aug 14, 2026');
expect('onPace detail empty', onPace.detail, '');

// Slightly behind (1..3) + driver + overdue.
const sb = scheduleVerdict({ slipDaysVsBaseline: 3, finishDateLabel: 'Sep 2, 2026', criticalDriverTitle: 'Electrical rough-in', overdueCount: 2 });
expect('slightlyBehind tone', sb.tone, 'slightlyBehind');
expect('slightlyBehind headline', sb.headline, '3 days behind plan — finishing about Sep 2, 2026');
expect('slightlyBehind detail', sb.detail, 'Electrical rough-in is your finish-date driver. 2 tasks overdue.');

// Behind (>=4), no finish date known.
const behind = scheduleVerdict({ slipDaysVsBaseline: 7, finishDateLabel: '—', overdueCount: 0 });
expect('behind tone', behind.tone, 'behind');
expect('behind headline (no finish)', behind.headline, '7 days behind plan');

// Ahead (singular day).
const ahead = scheduleVerdict({ slipDaysVsBaseline: -1, finishDateLabel: 'Jul 1, 2026', overdueCount: 0 });
expect('ahead tone', ahead.tone, 'ahead');
expect('ahead headline (singular)', ahead.headline, '1 day ahead of plan — finishing about Jul 1, 2026');

// No baseline set, but we know a finish date.
const nb = scheduleVerdict({ slipDaysVsBaseline: null, finishDateLabel: 'Aug 14, 2026', overdueCount: 0 });
expect('noBaseline tone', nb.tone, 'noBaseline');
expect('noBaseline headline', nb.headline, 'On track to finish about Aug 14, 2026');

// No baseline, no finish, overdue-only detail.
const nbEmpty = scheduleVerdict({ slipDaysVsBaseline: null, finishDateLabel: '—', overdueCount: 1 });
expect('noBaseline no-finish headline', nbEmpty.headline, 'Schedule in progress');
expect('overdue-only detail (singular)', nbEmpty.detail, '1 task overdue.');


// ─────────────────────────────────────────────────────────────────────────────
// The verdict as the PHONE renders it — utils/scheduleOps.pacedScheduleVerdict
// ─────────────────────────────────────────────────────────────────────────────
// Two things this pins, both of which produced a wrong sentence on a real job:
//
//  1. `criticalDriverTitle` had never been passed by ANY caller — the branch
//     above was tested but dead in the product. The phone now names the driver,
//     and it picks it by "whose EF is the project finish", not by "last id in
//     cpm.criticalPath" (that array is topological, so with two critical tails
//     it names whichever sorted last, which is not the one driving the date).
//
//  2. A phone user cannot create a baseline (saveBaseline has one caller and it
//     never renders on a phone), so slipDaysVsBaseline is permanently null and
//     the verdict read "On track to finish about …" on a job that was weeks
//     behind. With no baseline the line now falls back to the PACE read, and
//     says so — a baseline still outranks it, because a promise outranks an
//     inference.

console.log('\npaced verdict (the phone):');
{
  const behind = pacedScheduleVerdict({
    slipDaysVsBaseline: null, finishDateLabel: 'Aug 14, 2026',
    criticalDriverTitle: 'Drywall', overdueCount: 0, pace: 'behind', pctComplete: 32,
  });
  expect('no baseline + behind pace does NOT claim "on track"', behind.headline,
    'Behind pace — finishing about Aug 14, 2026');
  expect('  …and names the driver and its own basis', behind.detail,
    'Drywall is your finish-date driver. 32% of the work is done against the time elapsed — no baseline locked, so this is pace, not slip.');
  expect('  …with a tone the UI can colour', behind.tone, 'behind');

  const slipping = pacedScheduleVerdict({
    slipDaysVsBaseline: null, finishDateLabel: 'Aug 14, 2026',
    overdueCount: 0, pace: 'minor_delays', pctComplete: 55,
  });
  expect('minor delays reads as slipping, not behind', slipping.tone, 'slightlyBehind');
  expect('  …and says so', slipping.headline, 'Slipping behind pace — finishing about Aug 14, 2026');

  const okPace = pacedScheduleVerdict({
    slipDaysVsBaseline: null, finishDateLabel: 'Aug 14, 2026',
    overdueCount: 0, pace: 'on_track', pctComplete: 80,
  });
  expect('a healthy pace leaves the plain no-baseline line alone', okPace.headline,
    'On track to finish about Aug 14, 2026');

  // A BASELINE WINS. Otherwise the phone and the laptop would quote two
  // different answers for the same job.
  const withBaseline = pacedScheduleVerdict({
    slipDaysVsBaseline: 3, finishDateLabel: 'Sep 2, 2026',
    overdueCount: 0, pace: 'behind', pctComplete: 32,
  });
  expect('a real baseline outranks the pace read', withBaseline.headline,
    '3 days behind plan — finishing about Sep 2, 2026');

  // Undated schedule: no finish to promise, so no finish clause.
  const undated = pacedScheduleVerdict({
    slipDaysVsBaseline: null, finishDateLabel: '—',
    overdueCount: 0, pace: 'behind', pctComplete: 10,
  });
  expect('with no anchor the line states no date', undated.headline, 'Behind pace');
}

console.log('\nthe tone → theme-token map (one palette for both mobile surfaces):');
{
  expect('behind is danger', verdictToneTokens('behind'), { ink: 'dangerLabel', soft: 'dangerSoft' });
  expect('slightlyBehind is warning', verdictToneTokens('slightlyBehind'), { ink: 'warningLabel', soft: 'warningSoft' });
  expect('onPace is success', verdictToneTokens('onPace'), { ink: 'successLabel', soft: 'successSoft' });
  expect('noBaseline claims nothing', verdictToneTokens('noBaseline'), { ink: 'textSecondary', soft: 'surfaceAlt' });
}

console.log('\nthe finish-date driver is the task whose finish IS the finish:');
{
  const T = (id: string, startDay: number, durationDays: number): ScheduleTask => ({
    id, title: id, phase: 'General', startDay, durationDays, progress: 0, crew: '',
    dependencies: [], notes: '', status: 'not_started',
  } as ScheduleTask);
  // Two critical chains ending on different days. `criticalPath` is in
  // TOPOLOGICAL order, and here the SHORT chain sorts last — the old
  // "last element" rule would name PERMITS, which finishes a week earlier.
  const tasks = [T('long', 1, 20), T('permits', 1, 5)];
  const perTask = new Map([['long', { ef: 20 }], ['permits', { ef: 5 }]]);
  expect('names the task that actually ends last',
    finishDriverTitle(tasks, { perTask, projectFinish: 20, criticalTaskIds: ['long', 'permits'] }), 'long');
  expect('NOT the last id in the topological critical path',
    finishDriverTitle(tasks, { perTask, projectFinish: 20, criticalTaskIds: ['long', 'permits'] }) !== 'permits', true);
  // The lean context shape (no perTask) falls back to the latest authored end,
  // in WORKING ordinals on both sides — never startDay against a calendar index.
  expect('without a CPM result it uses the latest authored end',
    finishDriverTitle(tasks, { criticalTaskIds: ['long', 'permits'] }), 'long');
  expect('no tasks, no claim', finishDriverTitle([], { criticalTaskIds: [] }), undefined);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
