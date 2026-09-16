// scripts/validate-schedule-verdict.ts — pure-fn validator for utils/scheduleVerdict.ts.
// Run via `bun run scripts/validate-schedule-verdict.ts`. No jest in this repo.
import { scheduleVerdict } from '../utils/scheduleVerdict';
import {
  finishDriverTitle, pacedScheduleVerdict, verdictToneTokens,
  captureBaseline, applyBaselineToTasks, baselineFinishDayWorkingScale,
} from '../utils/scheduleOps';
import { runCpm, workingDaysBetween } from '../utils/cpm';
import { summarizeTaskDiff } from '../utils/scheduleAudit';
import type { ScheduleTask } from '../types';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Bun's global is not in the app tsconfig's types (tsc covers scripts/), so it
// is declared locally — same pattern as validate-calendar-date.ts.
declare const Bun: {
  Transpiler: new (opts: { loader: 'ts' | 'tsx' }) => { transformSync(code: string): string };
};

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

// ─────────────────────────────────────────────────────────────────────────────
// The phone can LOCK a plan, and what it locks is what the verdict reads.
// ─────────────────────────────────────────────────────────────────────────────
// Point 2 above was the symptom; this is the fix. A phone-only GC had no way to
// capture a baseline (the only captures were desktop-only), so the "N days
// behind plan" branch could never render for him. MobileScheduleScreen.lockPlan
// now captures into baselines[] with the schedule calendar and stamps the
// per-task fields. The trap the audit's sharpening named: writing the legacy
// singular `schedule.baseline` (scheduleEngine.saveBaseline) instead would
// LOOK fixed and change nothing, because no slip, verdict or health check
// reads it.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readSrc = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const MOBILE = 'components/schedule/mobile/MobileScheduleScreen.tsx';

console.log('\nlocking a plan on the phone:');
{
  const T = (id: string, startDay: number, durationDays: number, deps: string[] = []): ScheduleTask => ({
    id, title: id, phase: 'General', startDay, durationDays, progress: 0, crew: '',
    dependencies: deps, notes: '', status: 'not_started',
  } as ScheduleTask);
  const scale = { scheduleStartDate: '2026-03-02', workingDaysPerWeek: 5, nonWorkingDates: [] as string[] };
  const tasks = [T('A', 1, 10), T('B', 11, 10, ['A']), T('C', 21, 5, ['B'])];
  const cpm = runCpm(tasks, scale);
  // The exact call lockPlan makes.
  const snap = captureBaseline(tasks, 'v1', 'Locked from the phone schedule', { scale, cpm });
  // The exact slip MobileScheduleScreen derives from baselines[].
  const slipOf = (live: ScheduleTask[]) => {
    const base = baselineFinishDayWorkingScale(snap, scale);
    return base == null ? null : workingDaysBetween(base, runCpm(live, scale).projectFinish, scale);
  };
  expect('the moment after locking, the plan is exactly on plan (no phantom slip)', slipOf(tasks), 0);
  expect('  …so the verdict states it against the plan', pacedScheduleVerdict({
    slipDaysVsBaseline: slipOf(tasks), finishDateLabel: 'Apr 3, 2026', overdueCount: 0, pace: 'behind', pctComplete: 10,
  }).headline, 'On pace — finishing about Apr 3, 2026');
  const grown = tasks.map((t) => (t.id === 'A' ? { ...t, durationDays: 13 } : t));
  expect('a 3-day overrun upstream reads as 3 days behind plan', slipOf(grown), 3);
  const stamped = applyBaselineToTasks(tasks, snap);
  expect('every task carries the per-task baseline the health checks filter on',
    stamped.every((t) => t.baselineStartDay != null && t.baselineEndDay != null), true);

  const src = readSrc(MOBILE);
  const lock = src.slice(src.indexOf('const lockPlan = useCallback'), src.indexOf('const requestLockPlan = useCallback'));
  expect('lockPlan captures with the schedule calendar and its CPM run',
    /captureBaseline\(schedule\.tasks, [^)]*\{\s*scale, cpm/.test(lock), true);
  expect('lockPlan appends to baselines[] (what the slip reads)',
    /baselines: \[\.\.\.existing, snap\]/.test(lock), true);
  expect('lockPlan stamps the per-task baseline fields', /applyBaselineToTasks\(schedule\.tasks, snap\)/.test(lock), true);
  expect('the phone never writes the legacy singular baseline that nothing reads',
    /\bsaveBaseline\s*\(|import[^;]*\bsaveBaseline\b/.test(src), false);
  expect('the finish-date sheet exposes the lock', /onLockPlan=\{requestLockPlan\}/.test(src), true);
  expect('setting a start date offers the lock on the schedule it just wrote',
    /lockPlan\(nextSchedule\)/.test(src), true);
}

// ─────────────────────────────────────────────────────────────────────────────
// Phone edits are LOGGED. Every write on the phone schedule goes through
// saveTasks, and it wrote no audit row — so a date moved on an iPhone left no
// record of who moved it or when. describeMobileScheduleEdit is lifted out of
// the screen and transpiled (the .tsx imports react-native, which crashes bun),
// so the shipped text is what runs here.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nphone schedule edits land in the audit log:');
{
  const src = readSrc(MOBILE);
  const save = src.slice(src.indexOf('const saveTasks = useCallback'), src.indexOf('const onUpdateTask = useCallback'));
  expect('saveTasks appends an audit entry for the write it makes',
    /appendAuditToAsyncStorage\(selectedProject\.id, buildAuditEntry\(auditDraft\)\)/.test(save), true);
  expect('  …built from the tasks on BOTH sides of that write',
    /describeMobileScheduleEdit\(\{[\s\S]*prev: prevTasks,[\s\S]*next: nextTasks/.test(save), true);
  expect('the phone mounts the History viewer', /<ScheduleAuditModal/.test(src), true);

  const start = src.indexOf('const AUDIT_IGNORED_KEYS');
  const end = src.indexOf('// Mobile-native "Schedule Pro"');
  expect('describeMobileScheduleEdit is where this guard expects it', start >= 0 && end > start, true);
  if (start >= 0 && end > start) {
    const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(
      `${src.slice(start, end)}\nglobalThis.__describe = describeMobileScheduleEdit;`);
    new Function('summarizeTaskDiff', js)(summarizeTaskDiff);
    type Draft = { kind: string; summary: string; taskId?: string } | null;
    const describe = (globalThis as unknown as { __describe: (i: unknown) => Draft }).__describe;
    const T = (id: string, over: Partial<ScheduleTask> = {}): ScheduleTask => ({
      id, title: id, phase: 'General', startDay: 1, durationDays: 5, progress: 0, crew: '',
      dependencies: ['X'], notes: '', status: 'not_started', ...over,
    } as ScheduleTask);
    const fmt = (d: number) => `day ${d}`;
    const base = { finishBefore: 20, finishAfter: 20, formatFinish: fmt, user: 'gc@example.com' };
    const prev = [T('Drywall'), T('Paint')];

    const moved = describe({ ...base, prev, next: [T('Drywall', { startDay: 5 }), prev[1]], finishAfter: 24 });
    expect('a moved task logs a dated movement with the finish before → after',
      moved && { kind: moved.kind, summary: moved.summary, taskId: moved.taskId },
      { kind: 'task_edit', summary: 'Drywall: start day 1 → 5 — finish day 20 → day 24', taskId: 'Drywall' });
    expect('a CPM-derived critical flag alone is not an edit anyone made',
      describe({ ...base, prev, next: [T('Drywall', { isCriticalPath: true }), prev[1]] }), null);
    expect('an identical dependency array re-created by the sheet is not "dependencies changed"',
      describe({ ...base, prev, next: [T('Drywall', { dependencies: ['X'] }), prev[1]] }), null);
    expect('a status tap logs as a progress update',
      describe({ ...base, prev, next: [T('Drywall', { status: 'in_progress', progress: 10 }), prev[1]] })?.kind, 'progress_update');
    expect('an added task is logged', describe({ ...base, prev, next: [...prev, T('Trim')] })?.summary, 'Added "Trim" (5d)');
    expect('a removed task is logged', describe({ ...base, prev, next: [prev[0]] })?.kind, 'task_delete');
    const bulk = describe({ ...base, prev, next: [T('Drywall', { startDay: 9 }), T('Paint', { startDay: 14 })], finishAfter: 28, reason: 'Brought the plan up to date' });
    expect('the catch-up is ONE reflow row naming the decision and the finish movement',
      bulk && { kind: bulk.kind, summary: bulk.summary },
      { kind: 'reflow', summary: 'Brought the plan up to date: 2 tasks changed — finish day 20 → day 28' });
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
