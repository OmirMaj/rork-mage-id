// scripts/validate-startdate-rebase.ts — the RETIREMENT guard for what used to
// be utils/scheduleRebase.ts.
//
// History. Schedules created without a `startDate` ran the CPM engine in
// raw-day mode. Their stored `ScheduleTask.startDay` values were working-day
// ORDINALS ("the Nth day of work"). Assigning the first start date flipped the
// engine into calendar mode, where — at the time — the engine read those same
// integers as CALENDAR day indices, so every multi-day chain silently inflated:
// the finish-day jump bug, 33 → 43 on a real 20-task schedule (2026-07-12).
//
// `rebaseRawToCalendar` was the compensation: it re-mapped ordinal N onto the
// calendar index of the Nth working day, at the moment of the flip.
//
// 2026-09-11 removed the cause. `forwardPass` now converts at its `pins` line
// (`workingOrdinalToCalendarIndex`), so `startDay` means a working ordinal on
// BOTH sides of the flip and there is nothing left to re-map. Re-mapping anyway
// DOUBLE-converts — and the two surfaces that still called it
// (components/schedule/mobile/MobileScheduleScreen.tsx and
// app/(tabs)/schedule/index.tsx) wrote the result straight through
// `updateProject`, so it was persisted corruption reachable from two shipped
// screens, not a display artefact.
//
// Measured before removal, on A(10)->B(10)->C(5) authored at ordinals 1/11/21,
// 5-day week from Mon 2026-03-02:
//     startDays before rebase : 1,11,21
//     startDays after  rebase : 1,15,29   <- what those screens persisted
//     finish without rebase   : Fri Apr 03 2026   (schedule-pro, correct)
//     finish with    rebase   : Wed Apr 15 2026
//
// So this file no longer tests the helper — the helper is gone. It asserts the
// helper STAYS gone, and it re-proves the property the helper used to fake:
// setting the first start date must not move the plan.

import {
  runCpm, calendarDayToDate, workingOrdinalToCalendarIndex, calendarIndexToWorkingOrdinal,
  detectStartDayBasis, remapCalendarIndexStartDaysToWorkingOrdinals, remapCapturedBaselineDays,
  previewStartDayBasisMigration, startDayBasisAnswerPatch, startDayBasisNoticeModel,
} from '../utils/cpm';
import { buildScheduleFromTasks, mergeEditedSchedule, saveBaseline } from '../utils/scheduleEngine';
import type { ProjectSchedule, ScheduleTask } from '../types';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail === undefined ? '' : `\n      ${JSON.stringify(detail)}`); }
}
function eq<T>(name: string, actual: T, expected: T) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected });
}

console.log('\nstart-date rebase: retired');

// ── 1. The helper is gone and nothing re-introduces it ──────────────────────
{
  ok('utils/scheduleRebase.ts no longer exists', !existsSync(join(ROOT, 'utils', 'scheduleRebase.ts')));
  for (const rel of [
    'app/schedule-pro.tsx',
    'app/(tabs)/schedule/index.tsx',
    'components/schedule/mobile/MobileScheduleScreen.tsx',
  ]) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    ok(`${rel} does not re-map startDay when the first anchor is set`,
      !/rebaseRawToCalendar\s*\(/.test(src) && !/scheduleRebase/.test(src.replace(/\/\/[^\n]*/g, '')));
  }
}

// ── 2. The property the helper used to fake now holds on its own ────────────
// Setting the first start date must not move the plan. This is the ACTUAL
// regression test: it fails if anyone re-introduces a conversion at the flip,
// and it fails if the engine stops converting at `pins`.
{
  const T = (id: string, dur: number, startDay: number, deps: string[] = []): ScheduleTask => ({
    id, title: id, durationDays: dur, startDay, dependencies: deps, status: 'not_started',
  } as unknown as ScheduleTask);

  // Authored undated: A 10 working days, then B 10, then C 5 — pinned at the
  // ordinals the raw-day engine handed back (1, 11, 21).
  const tasks = [T('A', 10, 1), T('B', 10, 11, ['A']), T('C', 5, 21, ['B'])];

  // Undated (raw-day mode): the two scales coincide, so the finish is ordinal 25.
  const raw = runCpm(tasks);
  eq('undated, the plan is 25 working days long', raw.projectFinish, 25);

  // Now anchor it on Mon 2026-03-02, 5-day week. 25 working days from Mon Mar 2
  // is Fri Apr 3 — the SAME plan, laid on a calendar.
  const ISO = '2026-03-02';
  const START = new Date(2026, 2, 2);
  const dated = runCpm(tasks, { scheduleStartDate: ISO, workingDaysPerWeek: 5 });
  eq('anchoring it does not change its shape — 25 working days, finishing Fri Apr 3',
    calendarDayToDate(START, dated.projectFinish).toDateString(),
    new Date(2026, 3, 3).toDateString());
  eq('  …and no task moved off its authored working day',
    tasks.map(t => t.startDay), [1, 11, 21]);

  // What the old helper did, inlined: ordinal N → calendar index of the Nth
  // working day. Feeding THAT to the (now converting) engine is the bug.
  const rebased = tasks.map(t => ({
    ...t,
    startDay: t.id === 'A' ? 1 : t.id === 'B' ? 15 : 29,   // 1,11,21 → 1,15,29
  }));
  const doubled = runCpm(rebased, { scheduleStartDate: ISO, workingDaysPerWeek: 5 });
  eq('double-converting inflates the finish to Wed Apr 15 — which is why it was removed',
    calendarDayToDate(START, doubled.projectFinish).toDateString(),
    new Date(2026, 3, 15).toDateString());
  ok('  …and that really is a regression, not a rounding difference',
    doubled.projectFinish > dated.projectFinish + 5,
    { dated: dated.projectFinish, doubled: doubled.projectFinish });
}

// ── 3. The MIGRATION for the data the helper already corrupted ──────────────
// Deleting the helper protected new data and fixed nothing on disk. Every
// schedule it ever ran on still carries calendar indices in `startDay` and is
// still double-converted by today's engine. This section executes the whole
// decision — detect, preview, remap — on both populations at once, so a fixture
// that is fine and a fixture that is broken are always compared side by side.
{
  const ISO = '2026-03-02';                 // Monday
  const START = new Date(2026, 2, 2);
  const SCALE = { scheduleStartDate: ISO, workingDaysPerWeek: 5 };
  const T = (id: string, dur: number, startDay: number, deps: string[] = []): ScheduleTask => ({
    id, title: id, durationDays: dur, startDay, dependencies: deps, status: 'not_started',
    // scheduleAI.materializeGeneratedTasks stamps these EQUAL to startDay at
    // authoring time. They are the pair the detection turns on, and the rebase
    // never touched them.
    baselineStartDay: startDay, baselineEndDay: startDay + Math.max(1, dur) - 1,
  } as unknown as ScheduleTask);

  // AUTHORED: working ordinals 1 / 11 / 21, the shape the engine expects.
  const authored = [T('Demo', 10, 1), T('Framing', 10, 11, ['Demo']), T('Drywall', 5, 21, ['Framing'])];
  // LEGACY: exactly what rebaseRawToCalendar persisted — ordinal N replaced by
  // the calendar index of the Nth working day. Reproduced through the shipped
  // converter rather than hard-coded, so this stays true if the calendar does.
  const legacy = authored.map(t => ({ ...t, startDay: workingOrdinalToCalendarIndex(t.startDay, SCALE) }));
  eq('the legacy fixture is the 1,11,21 → 1,15,29 rewrite the helper performed',
    legacy.map(t => t.startDay), [1, 15, 29]);

  // ── detection ─────────────────────────────────────────────────────────────
  const authoredReport = detectStartDayBasis(authored, SCALE);
  const legacyReport = detectStartDayBasis(legacy, SCALE);
  eq('an authored schedule is read as working ordinals', authoredReport.verdict, 'workingOrdinal');
  eq('a rebased schedule is read as calendar indices', legacyReport.verdict, 'calendarIndex');
  ok('  …and each verdict is EVIDENCED, in the user’s own task names',
    authoredReport.ordinalEvidence.length > 0 && authoredReport.calendarEvidence.length === 0
    && legacyReport.calendarEvidence.length > 0 && legacyReport.ordinalEvidence.length === 0,
    { ord: authoredReport.ordinalEvidence.length, cal: legacyReport.calendarEvidence.length });
  ok('  …and neither is a coin toss — the evidence names the baseline pair',
    legacyReport.calendarEvidence.some(e => /baseline working day 11/.test(e)),
    legacyReport.calendarEvidence);

  // Each signal has to carry its own weight, or deleting one leaves the verdict
  // standing on the other and nothing notices. PARALLEL tasks with baselines and
  // no links: only the baseline pair can decide these.
  {
    const parallel = [T('Roof', 4, 6), T('Windows', 4, 11)];
    const parallelLegacy = parallel.map(t => ({ ...t, startDay: workingOrdinalToCalendarIndex(t.startDay, SCALE) }));
    eq('with no links at all, the baseline pair alone reads an authored schedule',
      detectStartDayBasis(parallel, SCALE).verdict, 'workingOrdinal');
    eq('  …and the baseline pair alone reads a rebased one',
      detectStartDayBasis(parallelLegacy, SCALE).verdict, 'calendarIndex');
  }
  // And the mirror: a CHAIN with no baseline fields at all — a hand-built
  // schedule — where only the chain gap can decide.
  {
    const bare = authored.map(t => {
      const { baselineStartDay: _b, baselineEndDay: _e, ...rest } = t as ScheduleTask;
      return rest as ScheduleTask;
    });
    const bareLegacy = legacy.map(t => {
      const { baselineStartDay: _b, baselineEndDay: _e, ...rest } = t as ScheduleTask;
      return rest as ScheduleTask;
    });
    eq('with no baselines at all, the chain gap alone reads an authored schedule',
      detectStartDayBasis(bare, SCALE).verdict, 'workingOrdinal');
    eq('  …and the chain gap alone reads a rebased one',
      detectStartDayBasis(bareLegacy, SCALE).verdict, 'calendarIndex');
  }

  // ── the offer ─────────────────────────────────────────────────────────────
  const authoredPreview = previewStartDayBasisMigration({ tasks: authored, startDate: ISO, workingDaysPerWeek: 5 });
  const legacyPreview = previewStartDayBasisMigration({ tasks: legacy, startDate: ISO, workingDaysPerWeek: 5 });
  ok('a healthy schedule is never asked', authoredPreview.shouldAsk === false, authoredPreview.report.verdict);
  ok('a rebased schedule IS asked', legacyPreview.shouldAsk === true, legacyPreview.report);
  eq('the ask quotes the finish it currently claims — Wed Apr 15',
    calendarDayToDate(START, legacyPreview.storedFinishDay).toDateString(), new Date(2026, 3, 15).toDateString());
  eq('  …and the finish the authored plan really has — Fri Apr 3',
    calendarDayToDate(START, legacyPreview.remappedFinishDay).toDateString(), new Date(2026, 3, 3).toDateString());
  eq('  …a measured 12 days of inflation', legacyPreview.inflationDays, 12);
  eq('  …and the remap recovers the authored ordinals exactly',
    legacyPreview.remappedTasks.map(t => t.startDay), [1, 11, 21]);

  // ── one-shot ──────────────────────────────────────────────────────────────
  // The persisted flag is what makes this a migration and not a nag. Same
  // corrupt data, answered once: never asked again, whichever way it went.
  const answered = previewStartDayBasisMigration({
    tasks: legacy, startDate: ISO, workingDaysPerWeek: 5, startDayBasis: 'workingOrdinal',
  });
  ok('once the schedule records an answer it is never asked again', answered.shouldAsk === false);
  ok('  …and the flag suppresses the QUESTION, not the diagnosis (still readable)',
    answered.report.verdict === 'calendarIndex' && answered.report.corroboratingTaskCount >= 2);
  ok('  …and it costs no engine run — the finish numbers are not even measured',
    answered.measured === false && answered.storedFinishDay === 0 && answered.inflationDays === 0);
  ok('the ask that IS made is measured', legacyPreview.measured === true);
  const afterFix = previewStartDayBasisMigration({
    tasks: legacyPreview.remappedTasks, startDate: ISO, workingDaysPerWeek: 5,
  });
  ok('and the remapped result is not asked either, flag or no flag',
    afterFix.shouldAsk === false && afterFix.report.verdict === 'workingOrdinal',
    afterFix.report.verdict);

  // ── the remap cannot fire on data it was not asked about ──────────────────
  // The mirror of the bug is applying this to a healthy schedule, which would
  // SHORTEN it. The report argument is the lock: no calendar evidence, no
  // conversion, and the input comes back by reference.
  ok('the remap refuses an authored schedule (same array reference back)',
    remapCalendarIndexStartDaysToWorkingOrdinals(authored, SCALE, authoredReport) === authored);
  ok('the remap refuses its own output (so a second run cannot shorten the plan)',
    remapCalendarIndexStartDaysToWorkingOrdinals(
      legacyPreview.remappedTasks, SCALE,
      detectStartDayBasis(legacyPreview.remappedTasks, SCALE),
    ) === legacyPreview.remappedTasks);

  // ── it moves startDay and NOTHING else ────────────────────────────────────
  // The reviewers flagged that baselineStartDay / baselineEndDay were never
  // audited alongside startDay. They are on the working scale, the rebase never
  // touched them, and so this must not either — remapping them would destroy
  // the pair the detection turns on and drag the Gantt's baseline ghost off the
  // plan it was captured against.
  ok('the remap leaves every baseline and actual field alone',
    legacyPreview.remappedTasks.every((t, i) =>
      t.baselineStartDay === legacy[i].baselineStartDay
      && t.baselineEndDay === legacy[i].baselineEndDay
      && t.actualStartDay === legacy[i].actualStartDay
      && t.actualEndDay === legacy[i].actualEndDay
      && t.durationDays === legacy[i].durationDays
      && JSON.stringify(t.dependencies) === JSON.stringify(legacy[i].dependencies)));
  ok('a rebased schedule really had drifted off its own baseline days',
    legacy.some(t => t.startDay !== t.baselineStartDay));
  ok('  …and the remap puts every task back onto its baseline day',
    legacyPreview.remappedTasks.every(t => t.startDay === t.baselineStartDay));

  // ── nothing ambiguous is ever converted ───────────────────────────────────
  // A legacy schedule someone has since hand-edited cannot be read end to end.
  // One unreadable row is enough to refuse: a partial conversion would leave
  // the schedule holding BOTH scales, which is worse than either.
  const edited = legacy.map((t, i) => (i === 2 ? { ...t, startDay: 40 } : t));
  const editedPreview = previewStartDayBasisMigration({ tasks: edited, startDate: ISO, workingDaysPerWeek: 5 });
  eq('a hand-edited legacy schedule is indeterminate, not converted',
    editedPreview.report.verdict, 'indeterminate');
  ok('  …it is not asked, and the remap hands back the input untouched',
    editedPreview.shouldAsk === false && editedPreview.remappedTasks === edited);
  ok('  …even though the inflation is real — measured here by force, to prove '
    + 'the refusal costs something and is a choice, not a miss',
    runCpm(edited, { scheduleStartDate: ISO, workingDaysPerWeek: 5 }).projectFinish
    > runCpm(edited.map(t => ({ ...t, startDay: calendarIndexToWorkingOrdinal(t.startDay, SCALE) })),
      { scheduleStartDate: ISO, workingDaysPerWeek: 5 }).projectFinish);
  ok('  …and it names the row it could not read, so the user can check it',
    editedPreview.report.unexplainedTitles.includes('Drywall'),
    editedPreview.report.unexplainedTitles);

  // ── the notice only speaks when it has something true to say ──────────────
  // Every word of the disclosure is about the finish date, so it must not appear
  // when the finish does not move. A rebased row with float on it is exactly
  // that case: the row's own dates are wrong, the project end is not. This is a
  // DELIBERATE limit, not an oversight — see the report. Changing the copy is
  // what would license widening the gate.
  {
    const driver = T('Sitework', 30, 1);                       // owns the finish
    const floaty = ['Signage', 'Punch'].map((n, i) => ({
      ...T(n, 2, 11 + i * 2), startDay: workingOrdinalToCalendarIndex(11 + i * 2, SCALE),
    }));
    const p = previewStartDayBasisMigration({ tasks: [driver, ...floaty], startDate: ISO, workingDaysPerWeek: 5 });
    eq('rebased rows with float are still READ as rebased rows', p.report.verdict, 'calendarIndex');
    ok('  …and the remap would still move them', p.report.wouldRemapTaskCount === 2, p.report.wouldRemapTaskCount);
    ok('  …and it was measured, so the silence below is a measurement and not a bail',
      p.measured === true);
    eq('  …but the project finish does not move, so nothing is claimed', p.inflationDays, 0);
    ok('  …and the notice stays silent rather than quote a zero-day saving',
      p.shouldAsk === false);
  }

  // ── ROW COUNT IS NOT PROOF OF CAUSE, AT ANY COUNT ─────────────────────────
  // This block used to end with `…but two corroborating rows IS a rewrite`. It
  // was wrong, and it certified the defect it was written to prevent.
  //
  // A task that slipped from its baseline by exactly the weekend it spans has
  // `startDay === calendarIndexOf(baselineStartDay)` — which is the definition
  // of a re-anchored row. Adding a second such task does not make it a rewrite;
  // it makes it two slips, and a slip propagates down a chain, so two is the
  // COMMON case. The fixture below is measured both ways on purpose: it is
  // offered (the count gate holds) AND accepting it would revert real slips.
  // Both facts are true at once, and that is exactly why the disclosure states
  // the measurement and names the rows instead of stating a cause.
  {
    const B = (id: string, dur: number, startDay: number, bsd: number): ScheduleTask => ({
      ...T(id, dur, startDay), baselineStartDay: bsd, baselineEndDay: bsd + dur - 1,
    });
    const slip = [B('Slab', 5, 1, 1), B('Signage', 3, workingOrdinalToCalendarIndex(6, SCALE), 6)];
    const sp = previewStartDayBasisMigration({ tasks: slip, startDate: ISO, workingDaysPerWeek: 5 });
    eq('a single slipped row corroborates itself only once', sp.report.corroboratingTaskCount, 1);
    eq('  …so the verdict is indeterminate, not a re-anchor offer', sp.report.verdict, 'indeterminate');
    ok('  …the user is not asked, and the remap refuses the data',
      sp.shouldAsk === false && sp.remappedTasks === slip);

    const two = [...slip, B('Sign-off', 2, workingOrdinalToCalendarIndex(9, SCALE), 9)];
    const tp = previewStartDayBasisMigration({ tasks: two, startDate: ISO, workingDaysPerWeek: 5 });
    ok('two corroborating rows is enough to ASK — the count gate is a floor, not a verdict on cause',
      tp.report.corroboratingTaskCount === 2 && tp.report.verdict === 'calendarIndex' && tp.shouldAsk === true,
      { rows: tp.report.corroboratingTaskCount, verdict: tp.report.verdict });
    // The inversion. Same fixture, read as what it also is: two real slips.
    eq('  …and accepting there would move both rows back onto their baseline days — '
      + 'i.e. silently revert two real slips, if that is what they were',
      startDayBasisAnswerPatch(tp, true).tasks?.map(t => t.startDay), [1, 6, 9]);
    eq('  …which is byte-identical to reverting a re-anchor, so the data cannot tell them apart',
      two.map(t => t.baselineStartDay), [1, 6, 9]);
    // Therefore the offer must hand the user something THEY can settle: the
    // rows, with both readings of each start day.
    eq('so the ask names every row it would move, with both readings',
      tp.affectedRows.map(r => [r.title, r.storedDay, r.remappedDay]),
      [['Signage', 8, 6], ['Sign-off', 11, 9]]);
    ok('  …and only the rows that move — the unmoved row is not in the list',
      !tp.affectedRows.some(r => r.id === 'Slab'), tp.affectedRows.map(r => r.id));
    // And the copy must not claim the cause. Read from the shipped component:
    // the sentence below is the one this block used to certify.
    const noticeSrc = readFileSync(join(ROOT, 'components/schedule/StartDayBasisNotice.tsx'), 'utf8');
    ok('the notice states no cause it cannot prove',
      !/was re-anchored by an older version/.test(noticeSrc)
      && /read two ways/.test(noticeSrc));
  }

  // ── no anchor / a 7-day week: the two scales ARE the same numbers ─────────
  for (const [label, sch] of [
    ['undated', { tasks: legacy, workingDaysPerWeek: 5 }],
    ['7-day week', { tasks: legacy, startDate: ISO, workingDaysPerWeek: 7 }],
  ] as const) {
    const p = previewStartDayBasisMigration(sch);
    ok(`a ${label} schedule is never asked — there is nothing to convert`,
      p.shouldAsk === false && p.report.wouldRemapTaskCount === 0 && p.inflationDays === 0);
  }
  const emptyPreview = previewStartDayBasisMigration({ tasks: [], startDate: ISO, workingDaysPerWeek: 5 });
  ok('an empty schedule is never asked', emptyPreview.shouldAsk === false);
}

// ── 3b. A schedule authored from now on never enters the legacy population ──
// The flag is only a migration key if new data carries it. Executed, not
// grepped: build a schedule the way every creation flow does and read the field
// off the object. And prove the other half — an EDIT of a legacy schedule must
// not acquire the flag, or the migration retires itself on the next keystroke.
{
  const T = (id: string, dur: number, startDay: number): ScheduleTask => ({
    id, title: id, durationDays: dur, startDay, dependencies: [], status: 'not_started',
  } as unknown as ScheduleTask);
  const fresh = buildScheduleFromTasks('S', null, [T('a', 5, 1), T('b', 5, 6)]);
  // buildScheduleFromTasks must NOT stamp the flag — it cannot honestly promise
  // the scale (recalculateStartDays leaves an unlinked task on whatever startDay
  // it arrived with, and `opts.criticalPathDays` skips the resolver outright),
  // and three live call sites spread its output over the REAL stored schedule.
  // A stamp there is a forged confirmation that retires the migration for the
  // schedules that need it.
  eq('a newly built schedule does NOT stamp a confirmation nobody gave',
    fresh.startDayBasis, undefined);
  // …and nothing is lost by that, because the DATA reads as working ordinals on
  // its own. Executed on real builder output, in the shapes that carry the least
  // signal: no links at all, a milestone chain, and a 6-day week.
  const shapes: [string, ScheduleTask[]][] = [
    ['a chained build', [T('a', 5, 1), T('b', 5, 6), T('c', 5, 11)].map((t, i, all) =>
      (i === 0 ? t : { ...t, dependencies: [all[i - 1].id] }))],
    ['an unlinked parallel build', [T('a', 5, 1), T('b', 5, 6), T('c', 5, 11)]],
    ['a build with a zero-day milestone', [T('a', 10, 1), { ...T('m', 0, 11), dependencies: ['a'] },
      { ...T('b', 5, 11), dependencies: ['m'] }]],
  ];
  for (const [label, shape] of shapes) {
    for (const wd of [5, 6, 7]) {
      const built = buildScheduleFromTasks('S', null, shape);
      const p = previewStartDayBasisMigration({
        tasks: built.tasks, startDate: '2026-03-02', workingDaysPerWeek: wd,
      });
      ok(`${label} on a ${wd}-day week is never asked, with no flag to protect it`,
        p.shouldAsk === false, { verdict: p.report.verdict, cal: p.report.calendarEvidence });
    }
  }

  // A legacy schedule: no flag, because nobody has ever confirmed its scale.
  const legacySchedule: ProjectSchedule = {
    ...fresh, id: 'legacy', startDayBasis: undefined, startDate: '2026-03-02', workingDaysPerWeek: 5,
  };
  const edited = mergeEditedSchedule(legacySchedule, buildScheduleFromTasks('S', null, legacySchedule.tasks));
  eq('editing a legacy schedule does NOT invent the confirmation', edited.startDayBasis, undefined);
  const answered = mergeEditedSchedule({ ...legacySchedule, startDayBasis: 'workingOrdinal' }, fresh);
  eq('  …and editing an ANSWERED schedule keeps the answer', answered.startDayBasis, 'workingOrdinal');
}

// ── 3c. What the ANSWER writes — executed, not grepped ──────────────────────
// The three screens used to hand-roll this: `tasks: accept ? remapped : stored`
// plus a `startDayBasis` literal plus two scalars, three times. A regex over a
// .tsx file can see the literal and cannot see that the wrong branch writes it.
// It is now one pure function, so the guard runs it.
{
  const ISO = '2026-03-02';
  const SCALE = { scheduleStartDate: ISO, workingDaysPerWeek: 5 };
  const T = (id: string, dur: number, startDay: number, deps: string[] = []): ScheduleTask => ({
    id, title: id, durationDays: dur, startDay, dependencies: deps, status: 'not_started',
    baselineStartDay: startDay, baselineEndDay: startDay + Math.max(1, dur) - 1,
  } as unknown as ScheduleTask);
  const authored = [T('Demo', 10, 1), T('Framing', 10, 11, ['Demo']), T('Drywall', 5, 21, ['Framing'])];
  const legacy = authored.map(t => ({ ...t, startDay: workingOrdinalToCalendarIndex(t.startDay, SCALE) }));
  const legacyPreview = previewStartDayBasisMigration({ tasks: legacy, startDate: ISO, workingDaysPerWeek: 5 });

  const yes = startDayBasisAnswerPatch(legacyPreview, true);
  const no = startDayBasisAnswerPatch(legacyPreview, false);
  eq('accepting writes the remapped ordinals', yes.tasks?.map(t => t.startDay), [1, 11, 21]);
  eq('  …and the stored finish scalar the cards read, so it stops claiming Apr 15',
    [yes.totalDurationDays, yes.criticalPathDays], [33, 33]);
  eq('  …and stamps the answer', yes.startDayBasis, 'workingOrdinal');
  ok('DECLINING has no `tasks` key at all — it cannot overwrite the plan',
    !('tasks' in no) && no.totalDurationDays === undefined && no.criticalPathDays === undefined,
    no);
  eq('  …but it IS an answer, and stamps the flag', no.startDayBasis, 'workingOrdinal');

  // The re-entrancy gate. After the first accept the schedule carries the flag,
  // so the next preview says don't ask — and a second accept (stale memo,
  // double tap, an undo that puts the notice back) must not remap again and
  // shorten the plan. This is the mirror of the original bug.
  const afterAccept = previewStartDayBasisMigration({
    tasks: yes.tasks!, startDate: ISO, workingDaysPerWeek: 5, startDayBasis: yes.startDayBasis,
  });
  const twice = startDayBasisAnswerPatch(afterAccept, true);
  ok('a SECOND accept moves nothing — the patch is gated on the preview, not the button',
    !('tasks' in twice) && twice.startDayBasis === 'workingOrdinal');
  // And on a healthy schedule an accept is inert too, however it got called.
  const healthy = previewStartDayBasisMigration({ tasks: authored, startDate: ISO, workingDaysPerWeek: 5 });
  ok('accepting on a healthy schedule moves nothing',
    !('tasks' in startDayBasisAnswerPatch(healthy, true)));
}

// ── 3d. The captured baseline snapshots move WITH the plan ─────────────────
// `remapCalendarIndexStartDaysToWorkingOrdinals` touches `startDay` and nothing
// else, and its note used to justify that for the baselines too — "the rebase
// never touched them, so they are still working ordinals". True of the TASK
// fields. FALSE of `ProjectSchedule.baseline` / `baselines[]`, which
// `scheduleEngine.saveBaseline` records FROM `t.startDay` at capture time: a
// snapshot taken while the schedule sat on the calendar-index scale holds
// calendar indices, and moving the tasks out from under it strands the Gantt's
// baseline ghost two days per weekend away, silently and for good.
{
  const ISO = '2026-03-02';
  const SCALE = { scheduleStartDate: ISO, workingDaysPerWeek: 5 };
  const T = (id: string, dur: number, startDay: number, deps: string[] = []): ScheduleTask => ({
    id, title: id, durationDays: dur, startDay, dependencies: deps, status: 'not_started',
    baselineStartDay: startDay, baselineEndDay: startDay + Math.max(1, dur) - 1,
  } as unknown as ScheduleTask);
  const authored = [T('Demo', 10, 1), T('Framing', 10, 11, ['Demo']), T('Drywall', 5, 21, ['Framing'])];
  const legacy = authored.map(t => ({ ...t, startDay: workingOrdinalToCalendarIndex(t.startDay, SCALE) }));
  const preview = previewStartDayBasisMigration({ tasks: legacy, startDate: ISO, workingDaysPerWeek: 5 });

  // A snapshot the user captured AFTER the rebase, through the shipped helper.
  const captured = saveBaseline({ tasks: legacy } as unknown as ProjectSchedule);
  eq('a baseline captured on a legacy schedule records the CALENDAR indices',
    captured.tasks.map(b => b.startDay), [1, 15, 29]);

  const patch = startDayBasisAnswerPatch(preview, true, { baseline: captured, baselines: [captured] });
  eq('accepting moves the captured snapshot onto the same scale as the tasks',
    patch.baseline?.tasks.map(b => b.startDay), [1, 11, 21]);
  eq('  …and shifts its endDay by the SAME delta, so each row keeps its span',
    patch.baseline?.tasks.map(b => b.endDay - b.startDay),
    captured.tasks.map(b => b.endDay - b.startDay));
  eq('  …and the named-baselines sidecar with it', patch.baselines?.[0].tasks.map(b => b.startDay), [1, 11, 21]);
  ok('  …and the ghost now sits exactly on the remapped plan, zero phantom variance',
    patch.baseline?.tasks.every((b, i) => b.startDay === patch.tasks?.[i]?.startDay) === true,
    { ghost: patch.baseline?.tasks.map(b => b.startDay), plan: patch.tasks?.map(t => t.startDay) });
  eq('  …and nothing else about the snapshot is invented', patch.baseline?.savedAt, captured.savedAt);

  // The mirror, and the reason the rule is "only rows that still match": a
  // snapshot captured BEFORE the rebase is already on the working scale and
  // must not be shifted a second time.
  const older = saveBaseline({ tasks: authored } as unknown as ProjectSchedule);
  const patch2 = startDayBasisAnswerPatch(preview, true, { baseline: older });
  ok('a snapshot captured BEFORE the rebase is left alone — no key, nothing to clobber',
    !('baseline' in patch2), patch2.baseline?.tasks.map(b => b.startDay));
  ok('  …and the helper itself hands that snapshot straight back, by reference',
    remapCapturedBaselineDays(older, preview.affectedRows) === older);

  // Declining touches nothing at all — same rule as `tasks`.
  const declined = startDayBasisAnswerPatch(preview, false, { baseline: captured, baselines: [captured] });
  ok('declining carries no snapshot key either',
    !('baseline' in declined) && !('baselines' in declined), declined);
  // And a schedule with no snapshots is not given one.
  ok('a schedule with no snapshots gets no snapshot keys',
    !('baseline' in startDayBasisAnswerPatch(preview, true, {})));
}

// ── 4. The disclosure: the decision it renders, and the wiring around it ────
// WHAT CHANGED AND WHY. This section used to be three regexes per screen —
// "`previewStartDayBasisMigration(` occurs", "`preview={startDayBasisPreview}`
// occurs", "`...startDayBasisAnswerPatch(startDayBasisPreview, accept)` occurs".
// A verifier broke the feature THREE ways with all of them green at 88/0:
//   (a) `if (true) return;` as the first line of `answerStartDayBasis` — both
//       buttons dead, no answer ever persisted, the notice never goes away;
//   (b) `{false ? <StartDayBasisNotice/> : null}` — never renders;
//   (c) `onReAnchor={() => answerStartDayBasis(false)}` — the ACCEPT button
//       declines: it stamps the flag, permanently retires the one-shot offer,
//       and leaves the plan inflated while the user believes they fixed it.
// A regex over a .tsx cannot see a branch, an early return, or which boolean a
// handler receives, so (c) is now gone STRUCTURALLY rather than pinned: the
// button→boolean binding is data on `cpm.startDayBasisNoticeModel()`, the
// component maps over it, the screens pass the handler by reference, and 4a
// below EXECUTES the binding. (a) and (b) live inside a .tsx and can only be
// shape-checked; 4c says exactly what each of those checks does and does not
// establish. Nothing here claims to prove a screen renders.
{
  // ── 4a. The decision, EXECUTED ───────────────────────────────────────────
  const ISO = '2026-03-02';
  const SCALE = { scheduleStartDate: ISO, workingDaysPerWeek: 5 };
  const T = (id: string, dur: number, startDay: number, deps: string[] = []): ScheduleTask => ({
    id, title: id, durationDays: dur, startDay, dependencies: deps, status: 'not_started',
    baselineStartDay: startDay, baselineEndDay: startDay + Math.max(1, dur) - 1,
  } as unknown as ScheduleTask);
  const authored = [T('Demo', 10, 1), T('Framing', 10, 11, ['Demo']), T('Drywall', 5, 21, ['Framing'])];
  const legacy = authored.map(t => ({ ...t, startDay: workingOrdinalToCalendarIndex(t.startDay, SCALE) }));
  const legacyPreview = previewStartDayBasisMigration({ tasks: legacy, startDate: ISO, workingDaysPerWeek: 5 });
  const healthyPreview = previewStartDayBasisMigration({ tasks: authored, startDate: ISO, workingDaysPerWeek: 5 });
  const answeredPreview = previewStartDayBasisMigration({
    tasks: legacy, startDate: ISO, workingDaysPerWeek: 5, startDayBasis: 'workingOrdinal',
  });

  const model = startDayBasisNoticeModel(legacyPreview);
  ok('the notice is visible for a legacy schedule and hidden for every other',
    model.visible === true
    && startDayBasisNoticeModel(healthyPreview).visible === false
    && startDayBasisNoticeModel(answeredPreview).visible === false);
  ok('  …and a hidden notice offers NO buttons at all — nothing to press by accident',
    startDayBasisNoticeModel(healthyPreview).actions.length === 0
    && startDayBasisNoticeModel(answeredPreview).actions.length === 0
    && startDayBasisNoticeModel(healthyPreview).rows.length === 0);
  eq('the visible notice names the rows it would move, with both readings',
    model.rows.map(r => [r.title, r.storedDay, r.remappedDay]),
    [['Framing', 15, 11], ['Drywall', 29, 21]]);
  eq('it offers exactly two answers, decline first', model.actions.map(a => a.key), ['keep', 'reAnchor']);

  // THE BINDING. This is mutation (c), executed rather than grepped: take the
  // accept boolean off the action the user pressed and run the real patch with
  // it. Wiring the accept button to `false` now means changing THIS value, and
  // these three assertions are what that breaks.
  const byKey = Object.fromEntries(model.actions.map(a => [a.key, a]));
  eq('the Re-anchor action carries accept=true', byKey.reAnchor.accept, true);
  eq('the Keep action carries accept=false', byKey.keep.accept, false);
  const accepted = startDayBasisAnswerPatch(legacyPreview, byKey.reAnchor.accept);
  const declined = startDayBasisAnswerPatch(legacyPreview, byKey.keep.accept);
  eq('pressing Re-anchor yields a patch carrying the REMAPPED tasks',
    accepted.tasks?.map(t => t.startDay), [1, 11, 21]);
  eq('  …and the corrected finish scalars with them',
    [accepted.totalDurationDays, accepted.criticalPathDays], [33, 33]);
  ok('pressing Keep yields the flag and NO tasks key — it cannot move the plan',
    !('tasks' in declined) && declined.startDayBasis === 'workingOrdinal', declined);
  // NOT SWAPPABLE: the two answers must not be interchangeable, or (c) is a
  // no-op rename. Swap the booleans and the outcomes swap with them.
  ok('the two answers are not interchangeable — swapping them swaps the outcome',
    'tasks' in startDayBasisAnswerPatch(legacyPreview, byKey.reAnchor.accept)
    && !('tasks' in startDayBasisAnswerPatch(legacyPreview, byKey.keep.accept))
    && byKey.reAnchor.accept !== byKey.keep.accept);
  ok('  …and both testIDs are distinct, so a screen test cannot press the wrong one',
    byKey.reAnchor.testID !== byKey.keep.testID
    && /accept/.test(byKey.reAnchor.testID) && /keep/.test(byKey.keep.testID));

  // ── 4b. The component consumes the model rather than re-deciding ─────────
  const notice = readFileSync(join(ROOT, 'components/schedule/StartDayBasisNotice.tsx'), 'utf8');
  ok('the notice renders nothing unless the model says it is visible',
    /if\s*\(!model\.visible\)\s*return null;/.test(notice)
    && /startDayBasisNoticeModel\(preview\)/.test(notice));
  ok('the notice never converts anything itself — both answers are the caller’s',
    !/remapCalendarIndexStartDaysToWorkingOrdinals|startDayBasis:\s*'workingOrdinal'/.test(notice));
  ok('the notice shows the measured before AND after finish, not a scale name',
    /storedFinishDay/.test(notice) && /remappedFinishDay/.test(notice) && /inflationDays/.test(notice));
  // ONE handler, over the model's actions. Two hand-written onPress lines is
  // the surface mutation (c) lived on, so there must not be two.
  ok('every button sends the accept boolean off its own model action',
    /onPress=\{\(\) => onAnswer\(a\.accept\)\}/.test(notice)
    && (notice.match(/onPress=/g) ?? []).length === 1
    && !/onAnswer\((true|false)\)/.test(notice), (notice.match(/onPress=/g) ?? []).length);
  ok('  …and the notice takes ONE answer prop, so there are no two callbacks to transpose',
    !/onReAnchor|onKeep/.test(notice) && /onAnswer:\s*\(accept: boolean\) => void;/.test(notice));

  // ── 4c. Screen wiring — SHAPE CHECKS, and only what regex can establish ──
  // Read this honestly. These are regexes over .tsx source. They can establish
  // that a call is written, that a prop is passed by reference rather than
  // through a lambda that could flip its argument, that the answer callback has
  // exactly one early return and it is the null guard, and that the element is
  // not sitting behind an inline conditional. They CANNOT establish that the
  // component renders, that the callback runs, or that the screen is mounted.
  // The decision itself is executed in 4a; this is the seam, pinned by shape.
  for (const rel of [
    'app/schedule-pro.tsx',
    'app/(tabs)/schedule/index.tsx',
    'components/schedule/mobile/MobileScheduleScreen.tsx',
  ]) {
    const raw = readFileSync(join(ROOT, rel), 'utf8');
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

    ok(`${rel} computes the preview and hands THAT to the notice`,
      /previewStartDayBasisMigration\(/.test(src)
      && /<StartDayBasisNotice[\s\S]{0,400}?preview=\{startDayBasisPreview\}/.test(src));
    // The handler is passed BY REFERENCE. `onAnswer={() => answer(false)}` and
    // `onAnswer={() => answer(true)}` are both writable, so neither is allowed:
    // the boolean has one source and it is the model action.
    ok(`${rel} passes the answer handler by reference, with no boolean of its own`,
      /onAnswer=\{answerStartDayBasis\}/.test(src)
      && !/answerStartDayBasis\((true|false)\)/.test(src), rel);
    ok(`${rel} writes the answer through the shared patch, not its own copy`,
      /startDayBasisAnswerPatch\(startDayBasisPreview, accept[,)]/.test(src));
    ok(`${rel} does not hand-roll the answer alongside it`,
      !/startDayBasis: 'workingOrdinal',\n/.test(raw), rel);
    // The element is not behind an inline gate: it starts its own line, and the
    // last thing before it is not a conditional's consequent. Catches
    // `{false ? <Tag/> : null}`, `{false ? (<Tag/>) : null}` and `{flag && <Tag/>}`
    // wrapped directly around the tag. It does NOT catch a gate further out —
    // an `if` in the render body, a parent that never mounts — and does not
    // claim to. Nothing a regex can do reaches that.
    const at = src.indexOf('<StartDayBasisNotice');
    const linePrefix = at > 0 ? src.slice(src.lastIndexOf('\n', at) + 1, at) : 'x';
    const prevCh = at > 0 ? src.slice(0, at).trimEnd().slice(-1) : '?';
    ok(`${rel} mounts the notice unconditionally — no inline gate on the element`,
      at > 0 && /^\s*$/.test(linePrefix) && !'?:&('.includes(prevCh),
      { linePrefix, prevCh });
    // The answer callback has exactly ONE return and it is the null guard.
    // `if (true) return;` at the top of it — the mutation that killed both
    // buttons at 88/0 — makes two.
    const cbStart = src.indexOf('const answerStartDayBasis = useCallback((accept: boolean) => {');
    const cbEnd = src.indexOf('\n  }, [', cbStart);
    const body = cbStart > 0 && cbEnd > cbStart ? src.slice(cbStart, cbEnd) : '';
    const returns = body.match(/\breturn\b/g) ?? [];
    ok(`${rel}'s answer callback has exactly one early return, and it is the null guard`,
      body.length > 0 && returns.length === 1 && /\n\s*if \(![^\n]*\) return;/.test(body),
      { returns: returns.length, found: body.length > 0 });
    ok(`  …and it reaches updateProject`, /updateProject\(/.test(body), rel);
    // The question is about what is on DISK. Feeding it the screen's live
    // working copy would make the notice appear and disappear as the user types
    // and would offer to remap rows that are not what got persisted.
    const arg = /previewStartDayBasisMigration\(\{([\s\S]*?)\}\)/.exec(src)?.[1] ?? '';
    ok(`${rel} asks about the PERSISTED plan, not a working copy`,
      /\btasks\b/.test(arg) && !/workingTasks|rolledTasks|sortedTasks|hist\.present|present\b/.test(arg),
      arg);
  }

  // A routine edit must never forge the confirmation. `saveSchedule` takes a raw
  // buildScheduleFromTasks output from seven call sites on the classic screen,
  // and that output carries the flag because everything IT authors is on the
  // working scale — on an EXISTING schedule that would be a lie, and it would
  // silently retire the migration for the schedules that need it.
  const classic = readFileSync(join(ROOT, 'app/(tabs)/schedule/index.tsx'), 'utf8');
  // TWO assertions, because one is a lie. The derivation alone was green with
  // the WRITE deleted (measured: 87/0 with the spread removed) — a value
  // computed and thrown away reads exactly like a value used. Pin the
  // derivation AND its arrival in the record that gets persisted.
  ok('saveSchedule derives the basis from the STORED schedule, not the rebuild',
    /const startDayBasis = project\.schedule \? project\.schedule\.startDayBasis : schedule\.startDayBasis;/.test(classic));
  ok('  …and actually writes it into the schedule it persists',
    /\.\.\.\(startDayBasis \? \{ startDayBasis \} : \{ startDayBasis: undefined \}\),/.test(classic)
    && /updateProject\(project\.id, \{\s*\n\s*schedule: \{[\s\S]{0,400}?startDayBasis/.test(classic));
  const pro = readFileSync(join(ROOT, 'app/schedule-pro.tsx'), 'utf8');
  // All THREE of schedule-pro's persist paths (debounced keystroke, unmount
  // flush, weather re-plan) used to write a raw build as the whole schedule —
  // which reset workingDaysPerWeek to 5 and bufferDays to 3, dropped
  // resourceCalendars / fragnets / weatherAlerts, and would now have forged the
  // basis flag. Counted, so reverting ONE is not hidden by the other two.
  eq('all three schedule-pro persist paths merge onto the existing schedule',
    (pro.match(/mergeEditedSchedule\(project\.schedule as ProjectSchedule,/g) ?? []).length, 3);
  ok('  …and none of them writes a freshly built schedule as the whole record',
    !/schedule:\s*\{\s*\n?\s*\.\.\.(newSchedule|rebuilt)\b/.test(pro)
    && !/schedule:\s*(newSchedule|rebuilt)\s*[,}]/.test(pro));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
