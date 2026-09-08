// scripts/validate-cross-project-load.ts — runs the REAL cross-project clash
// engine over constructed Project[] fixtures. No regex over source: every
// assertion below is the output of findCrossProjectClashes on data shaped like
// a GC's actual portfolio.
//
// Anchor for every fixture is 2026-09-07, a MONDAY, so the weekday arithmetic
// in the weekend cases is checkable by eye:
//   day index 1=Mon 09-07, 2=Tue 08, 3=Wed 09, 4=Thu 10, 5=Fri 11,
//              6=Sat 12,   7=Sun 13, 8=Mon 14.
import {
  findCrossProjectClashes, clashesInvolving, clashesForTask, otherJobs,
  describeClash, describeClashes, digestClashes, summarizeClashDays, weekWindow,
} from '../utils/crossProjectLoad';
import type { Project, ProjectSchedule, ScheduleTask } from '../types';

let pass = 0, fail = 0;
function eq<T>(n: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n, '\n   got ', JSON.stringify(got), '\n   want', JSON.stringify(want)); }
}
const MON = '2026-09-07';
const WEEK = weekWindow(MON); // Mon 09-07 → Sun 09-13

type TaskOverrides = Partial<ScheduleTask> & { id: string; startDay: number; durationDays: number };
const T = (o: TaskOverrides): ScheduleTask => ({
  title: o.id.toUpperCase(), phase: '', progress: 0, crew: '', dependencies: [],
  notes: '', status: 'not_started', ...o,
} as ScheduleTask);

const P = (
  id: string,
  name: string,
  tasks: ScheduleTask[],
  sched: Partial<ProjectSchedule> = {},
  proj: Partial<Project> = {},
): Project => ({
  id, name, status: 'in_progress',
  schedule: {
    id: `${id}-s`, name: `${name} schedule`, projectId: id,
    startDate: MON, workingDaysPerWeek: 5, bufferDays: 0,
    tasks, totalDurationDays: 10, criticalPathDays: 10, laborAlignmentScore: 0,
    riskItems: [], ...sched,
  },
  ...proj,
} as unknown as Project);

// ── 1. THE FAILURE THIS EXISTS FOR: one sub, two jobs, same day ──────────────
{
  const henderson = P('p1', 'Henderson', [T({ id: 't1', startDay: 1, durationDays: 3, assignedSubId: 's-dry', title: 'Hang drywall' })]);
  const ridgeline = P('p2', 'Ridgeline', [T({ id: 't2', startDay: 1, durationDays: 1, assignedSubId: 's-dry', title: 'Drywall patch' })]);
  const c = findCrossProjectClashes([henderson, ridgeline], WEEK);
  eq('same sub, two jobs, same day → one clash', c.length, 1);
  eq('  clash names the contested day', c[0]?.dateISO, '2026-09-07');
  eq('  clash names both jobs, sorted', c[0]?.jobs.map(j => j.projectName), ['Henderson', 'Ridgeline']);
  eq('  clash carries the task that booked each job', c[0]?.jobs.map(j => j.taskTitle), ['Hang drywall', 'Drywall patch']);
  eq('  resource key is the sub id', c[0]?.resourceKey, 'sub:s-dry');
  eq('  kind is sub', c[0]?.resourceKind, 'sub');
}

// Every contested day is its own row — the GC has to solve each one.
{
  const a = P('p1', 'Henderson', [T({ id: 't1', startDay: 1, durationDays: 3, assignedSubId: 's-dry' })]); // Mon–Wed
  const b = P('p2', 'Ridgeline', [T({ id: 't2', startDay: 2, durationDays: 3, assignedSubId: 's-dry' })]); // Tue–Thu
  const c = findCrossProjectClashes([a, b], WEEK);
  eq('each overlapping working day is reported', c.map(x => x.dateISO), ['2026-09-08', '2026-09-09']);
}

// A task whose duration is WORKING days must be spanned as working days. On a
// 5-day week a Friday task of 3 days finishes Tuesday, not Sunday — span it as
// calendar days and the Tuesday double-booking below disappears entirely.
{
  const a = P('p1', 'Henderson', [T({ id: 't1', startDay: 5, durationDays: 3, assignedSubId: 's-dry' })]); // Fri, Mon, Tue
  const b = P('p2', 'Ridgeline', [T({ id: 't2', startDay: 9, durationDays: 1, assignedSubId: 's-dry' })]); // Tue 09-15
  const c = findCrossProjectClashes([a, b], { startISO: MON, endISO: '2026-09-20' });
  eq('a duration walked across a weekend still reaches the clash', c.map(x => x.dateISO), ['2026-09-15']);
}

// ── 2. NON-OVERLAPPING DAYS MUST NOT FLAG ────────────────────────────────────
{
  const a = P('p1', 'Henderson', [T({ id: 't1', startDay: 1, durationDays: 3, assignedSubId: 's-dry' })]); // Mon–Wed
  const b = P('p2', 'Ridgeline', [T({ id: 't2', startDay: 4, durationDays: 1, assignedSubId: 's-dry' })]); // Thu
  eq('same sub, non-overlapping days → no clash', findCrossProjectClashes([a, b], WEEK).length, 0);
}

// ── 3. SAME JOB TWICE IS NOT A CROSS-PROJECT CLASH (cpm.ts owns that) ────────
{
  const a = P('p1', 'Henderson', [
    T({ id: 't1', startDay: 1, durationDays: 3, assignedSubId: 's-dry' }),
    T({ id: 't2', startDay: 1, durationDays: 2, assignedSubId: 's-dry' }),
  ]);
  eq('one sub twice on ONE job → no cross-project clash', findCrossProjectClashes([a], WEEK).length, 0);
  const b = P('p2', 'Ridgeline', [T({ id: 't3', startDay: 1, durationDays: 1, assignedSubId: 's-dry' })]);
  const c = findCrossProjectClashes([a, b], WEEK);
  eq('  …but the second JOB still clashes once, not twice', c.length, 1);
  eq('  …and lists each job once', c[0]?.jobs.length, 2);
  eq('  …picking a stable representative task per job', c[0]?.jobs.find(j => j.projectId === 'p1')?.taskId, 't1');
}

// EVERY task that books the resource that day has to be gated, not just the one
// the warning happens to name. Henderson hangs AND tapes with Ace on Monday; if
// only the named task refuses to commit, the other box promises Ace to
// Ridgeline in silence — the failure this module exists to stop, walked back in
// through the lookup in front of it.
{
  const a = P('p1', 'Henderson', [
    T({ id: 'z-hang', startDay: 1, durationDays: 1, assignedSubId: 's-dry', title: 'Hang drywall' }),
    T({ id: 'a-tape', startDay: 1, durationDays: 1, assignedSubId: 's-dry', title: 'Tape drywall' }),
  ]);
  const b = P('p2', 'Ridgeline', [T({ id: 't2', startDay: 1, durationDays: 1, assignedSubId: 's-dry' })]);
  const c = findCrossProjectClashes([a, b], WEEK);
  eq('two tasks on one job, one contested day → still ONE clash', c.length, 1);
  eq('  the clash carries BOTH booking tasks', c[0]?.jobs.find(j => j.projectId === 'p1')?.taskIds, ['a-tape', 'z-hang']);
  eq('  the named task is the stable representative', c[0]?.jobs.find(j => j.projectId === 'p1')?.taskTitle, 'Tape drywall');
  eq('  the NAMED task is gated', clashesForTask(c, 'p1', 'a-tape').length, 1);
  eq('  the OTHER task is gated too', clashesForTask(c, 'p1', 'z-hang').length, 1);
}

// clashesForTask is scoped to the job you are standing on. Task ids are unique
// per schedule, not globally, so an id match on another project's task must not
// gate this project's checkbox.
{
  const a = P('p1', 'Henderson', [T({ id: 'shared', startDay: 1, durationDays: 1, assignedSubId: 's-dry' })]);
  const b = P('p2', 'Ridgeline', [T({ id: 'shared', startDay: 1, durationDays: 1, assignedSubId: 's-dry' })]);
  const c = findCrossProjectClashes([a, b], WEEK);
  eq('a same-named task on the OTHER job is gated separately', clashesForTask(c, 'p1', 'shared').length, 1);
  eq('  …and an unrelated project id gates nothing', clashesForTask(c, 'p9', 'shared').length, 0);
}

// ── 4. A DAY NEITHER PROJECT WORKS MUST NOT FLAG ─────────────────────────────
// Henderson: Fri 09-11 + 2 working days on a 5-day week → span Fri…Mon 09-14,
//            but Sat/Sun are closed, so it only OCCUPIES Fri and Mon.
// Ridgeline: a one-day task pinned to Sat 09-12 — a day its own calendar closes.
// The two SPANS overlap (Saturday). The two occupancies do not.
{
  const a = P('p1', 'Henderson', [T({ id: 't1', startDay: 5, durationDays: 2, assignedSubId: 's-dry' })]);
  const b = P('p2', 'Ridgeline', [T({ id: 't2', startDay: 6, durationDays: 1, assignedSubId: 's-dry' })]);
  const win = { startISO: MON, endISO: '2026-09-14' };
  eq('spans overlap only on a closed weekend → no clash', findCrossProjectClashes([a, b], win).length, 0);
}
// A site closure does the same job as a weekend.
{
  const closed = { workingDaysPerWeek: 7, nonWorkingDates: ['2026-09-09'] };
  const a = P('p1', 'Henderson', [T({ id: 't1', startDay: 3, durationDays: 1, assignedSubId: 's-dry' })], closed);
  const b = P('p2', 'Ridgeline', [T({ id: 't2', startDay: 3, durationDays: 1, assignedSubId: 's-dry' })], closed);
  eq('both jobs shut down that day → no clash', findCrossProjectClashes([a, b], WEEK).length, 0);
}
// A 6-day week works SATURDAYS — the clash must still be found there.
{
  const six = { workingDaysPerWeek: 6 };
  const a = P('p1', 'Henderson', [T({ id: 't1', startDay: 6, durationDays: 1, assignedSubId: 's-dry' })], six);
  const b = P('p2', 'Ridgeline', [T({ id: 't2', startDay: 6, durationDays: 1, assignedSubId: 's-dry' })], six);
  const c = findCrossProjectClashes([a, b], { startISO: MON, endISO: '2026-09-14' });
  eq('6-day week → Saturday clash IS reported', c.map(x => x.dateISO), ['2026-09-12']);
}

// ── 5. A PROJECT WITH NO SCHEDULE MUST NOT THROW ─────────────────────────────
{
  const bare = { id: 'p0', name: 'Just a lead', status: 'in_progress' } as unknown as Project;
  const empty = P('p3', 'No tasks', []);
  const undated = P('p4', 'Undated', [T({ id: 't9', startDay: 1, durationDays: 3, assignedSubId: 's-dry' })], { startDate: undefined });
  const real = P('p1', 'Henderson', [T({ id: 't1', startDay: 1, durationDays: 3, assignedSubId: 's-dry' })]);
  let threw = '';
  let n = -1;
  try { n = findCrossProjectClashes([bare, empty, undated, real], WEEK).length; } catch (e) { threw = String(e); }
  eq('no schedule / no tasks / no start date → does not throw', threw, '');
  eq('  …and an undated schedule cannot be placed opposite a dated one', n, 0);
  eq('empty project list → no clashes', findCrossProjectClashes([], WEEK).length, 0);
}

// ── 6. IDENTITY: what we match, and what we deliberately do not ──────────────
{
  const a = P('p1', 'Henderson', [T({ id: 't1', startDay: 1, durationDays: 1, crew: 'Ace Drywall' })]);
  const b = P('p2', 'Ridgeline', [T({ id: 't2', startDay: 1, durationDays: 1, crew: '  ace drywall ' })]);
  const c = findCrossProjectClashes([a, b], WEEK);
  eq('crew names match on trim + case', c.length, 1);
  eq('  crew key is normalized', c[0]?.resourceKey, 'crew:ace drywall');
  eq('  label keeps the human spelling', c[0]?.resourceLabel, 'Ace Drywall');
  eq('  kind is crew', c[0]?.resourceKind, 'crew');

  const spelled = P('p3', 'Oakmont', [T({ id: 't3', startDay: 1, durationDays: 1, crew: 'Ace Drywall LLC' })]);
  eq('DOCUMENTED MISS: a different spelling is a different crew', findCrossProjectClashes([a, spelled], WEEK).length, 0);

  const byId = P('p4', 'Cedar', [T({ id: 't4', startDay: 1, durationDays: 1, assignedSubId: 's-ace' })]);
  eq('DOCUMENTED MISS: a crew string never matches a sub id', findCrossProjectClashes([a, byId], WEEK).length, 0);

  const unassigned1 = P('p5', 'Alpha', [T({ id: 't5', startDay: 1, durationDays: 1 })]);
  const unassigned2 = P('p6', 'Beta', [T({ id: 't6', startDay: 1, durationDays: 1 })]);
  eq('two unassigned tasks are not "the same resource"', findCrossProjectClashes([unassigned1, unassigned2], WEEK).length, 0);
}

// A sub id beats the crew string when both are present, and the label upgrades.
{
  const a = P('p1', 'Henderson', [T({ id: 't1', startDay: 1, durationDays: 1, assignedSubId: 's-dry' })]);
  const b = P('p2', 'Ridgeline', [T({ id: 't2', startDay: 1, durationDays: 1, assignedSubId: 's-dry', assignedSubName: 'Ace Drywall' })]);
  eq('no name anywhere → label falls back to the id', findCrossProjectClashes([a, a2('p2', 'Ridgeline')], WEEK)[0]?.resourceLabel, 's-dry');
  eq('assignedSubName on either job names the resource', findCrossProjectClashes([a, b], WEEK)[0]?.resourceLabel, 'Ace Drywall');
  const withDir = findCrossProjectClashes([a, b], { ...WEEK, resolveSubName: (id) => (id === 's-dry' ? 'Ace Drywall LLC' : null) });
  eq('the sub directory wins over the stamped name', withDir[0]?.resourceLabel, 'Ace Drywall LLC');
}
function a2(id: string, name: string): Project {
  return P(id, name, [T({ id: `${id}-t`, startDay: 1, durationDays: 1, assignedSubId: 's-dry' })]);
}

// ── 7. WORK THAT PUTS NOBODY ON SITE ─────────────────────────────────────────
{
  const live = P('p1', 'Henderson', [T({ id: 't1', startDay: 1, durationDays: 1, assignedSubId: 's-dry' })]);
  const done = P('p2', 'Ridgeline', [T({ id: 't2', startDay: 1, durationDays: 1, assignedSubId: 's-dry', status: 'done' })]);
  eq('a finished task books nobody', findCrossProjectClashes([live, done], WEEK).length, 0);

  const milestone = P('p2', 'Ridgeline', [T({ id: 't2', startDay: 1, durationDays: 0, assignedSubId: 's-dry', isMilestone: true })]);
  eq('a 0-day milestone books nobody', findCrossProjectClashes([live, milestone], WEEK).length, 0);

  const summary = P('p2', 'Ridgeline', [T({ id: 't2', startDay: 1, durationDays: 5, assignedSubId: 's-dry', isSummary: true })]);
  eq('a summary rollup books nobody', findCrossProjectClashes([live, summary], WEEK).length, 0);

  for (const status of ['completed', 'closed', 'draft'] as const) {
    const dead = P('p2', 'Ridgeline', [T({ id: 't2', startDay: 1, durationDays: 1, assignedSubId: 's-dry' })], {}, { status });
    eq(`a ${status} project books nobody`, findCrossProjectClashes([live, dead], WEEK).length, 0);
  }
}

// ── 8. THE WINDOW IS RESPECTED ───────────────────────────────────────────────
{
  const a = P('p1', 'Henderson', [T({ id: 't1', startDay: 8, durationDays: 1, assignedSubId: 's-dry' })]); // Mon 09-14
  const b = P('p2', 'Ridgeline', [T({ id: 't2', startDay: 8, durationDays: 1, assignedSubId: 's-dry' })]);
  eq('a clash outside the asked window is not reported', findCrossProjectClashes([a, b], WEEK).length, 0);
  // The window has TWO edges. A job that started weeks ago and runs through the
  // asked week must report the days inside it and no others — an unclamped
  // start reported a Monday the GC never asked about, on a strip that only has
  // room for this week.
  const early = P('p1', 'Henderson', [T({ id: 'e1', startDay: 1, durationDays: 20, assignedSubId: 's-dry' })]);
  const early2 = P('p2', 'Ridgeline', [T({ id: 'e2', startDay: 1, durationDays: 20, assignedSubId: 's-dry' })]);
  eq('a task running INTO the window reports only days inside it',
    findCrossProjectClashes([early, early2], weekWindow('2026-09-14')).map(x => x.dateISO),
    ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18']);
  eq('…and IS reported once the window reaches it', findCrossProjectClashes([a, b], weekWindow('2026-09-14')).length, 1);
  eq('reversed window → nothing rather than a crash', findCrossProjectClashes([a, b], { startISO: '2026-09-14', endISO: MON }).length, 0);
  eq('garbage window → nothing rather than a crash', findCrossProjectClashes([a, b], { startISO: 'nope', endISO: 'nope' }).length, 0);
  eq('weekWindow spans Monday → Sunday', WEEK, { startISO: '2026-09-07', endISO: '2026-09-13' });
}

// ── 9. THE SLICES THE SURFACES ASK FOR ───────────────────────────────────────
{
  const a = P('p1', 'Henderson', [
    T({ id: 't1', startDay: 1, durationDays: 2, assignedSubId: 's-dry', assignedSubName: 'Ace Drywall', title: 'Hang drywall' }),
    T({ id: 'tx', startDay: 1, durationDays: 2, assignedSubId: 's-paint', title: 'Prime' }),
  ]);
  const b = P('p2', 'Ridgeline', [T({ id: 't2', startDay: 1, durationDays: 2, assignedSubId: 's-dry', title: 'Drywall patch' })]);
  const c = findCrossProjectClashes([a, b], WEEK);
  eq('two contested days for one sub', c.length, 2);
  eq('clashesInvolving finds the project', clashesInvolving(c, 'p1').length, 2);
  eq('clashesInvolving ignores a project not in any clash', clashesInvolving(c, 'p9').length, 0);
  eq('clashesForTask gates the one task that caused it', clashesForTask(c, 'p1', 't1').length, 2);
  eq('clashesForTask clears an innocent task on the same job', clashesForTask(c, 'p1', 'tx').length, 0);
  eq('otherJobs drops the job you are standing on', otherJobs(c[0], 'p1').map(j => j.projectName), ['Ridgeline']);
  eq('describeClash names resource, other job and day',
    describeClash(c[0], 'p1'),
    'Ace Drywall is already committed to Ridgeline on Mon, Sep 7.');

  const d = digestClashes(c);
  eq('digest collapses two days into one resource row', d.length, 1);
  eq('  digest names both jobs', d[0]?.jobNames, ['Henderson', 'Ridgeline']);
  eq('  digest keeps every contested day', d[0]?.dateISOs, ['2026-09-07', '2026-09-08']);
  eq('  day summary reads as days, not dates', summarizeClashDays(d[0]!.dateISOs), 'Mon + Tue');
  eq('one day reads as one day', summarizeClashDays(['2026-09-07']), 'Mon');
  eq('three or more days collapse', summarizeClashDays(['2026-09-07', '2026-09-08', '2026-09-09']), 'Mon + 2 more');
  eq('no days → empty', summarizeClashDays([]), '');
}

// Three jobs fighting over one sub name all three, in the same sentence.
{
  const mk = (id: string, name: string) => P(id, name, [T({ id: `${id}t`, startDay: 1, durationDays: 1, crew: 'Ace Drywall' })]);
  const c = findCrossProjectClashes([mk('p1', 'Henderson'), mk('p2', 'Ridgeline'), mk('p3', 'Oakmont')], WEEK);
  eq('three jobs, one day → one clash listing all three', c[0]?.jobs.map(j => j.projectName), ['Henderson', 'Oakmont', 'Ridgeline']);
  eq('describeClash names both other jobs',
    describeClash(c[0], 'p1'),
    'Ace Drywall is already committed to Oakmont and Ridgeline on Mon, Sep 7.');
}

// ── 10. DETERMINISM: input order must not change the answer ──────────────────
{
  const a = P('p1', 'Henderson', [T({ id: 't1', startDay: 1, durationDays: 2, assignedSubId: 's-dry' })]);
  const b = P('p2', 'Ridgeline', [T({ id: 't2', startDay: 2, durationDays: 2, assignedSubId: 's-dry' })]);
  const c = P('p3', 'Oakmont', [T({ id: 't3', startDay: 1, durationDays: 3, crew: 'Framers' })]);
  eq('project order does not change the result',
    JSON.stringify(findCrossProjectClashes([a, b, c], WEEK)),
    JSON.stringify(findCrossProjectClashes([c, b, a], WEEK)));
}
// TWO resources actually in conflict, so the ORDER of the emitted rows is
// observable. With one clashing resource the check above cannot see a missing
// sort at all — it was passing on a fixture that could only ever emit one row.
{
  const mk = (id: string, name: string, res: Partial<ScheduleTask>, startDay: number) =>
    P(id, name, [T({ id: `${id}t`, startDay, durationDays: 1, ...res })]);
  const set = [
    mk('p1', 'Henderson', { assignedSubId: 's-dry' }, 2),
    mk('p2', 'Ridgeline', { assignedSubId: 's-dry' }, 2),
    mk('p3', 'Oakmont', { crew: 'Framers' }, 1),
    mk('p4', 'Cedar', { crew: 'Framers' }, 1),
  ];
  const fwd = findCrossProjectClashes(set, WEEK);
  eq('two clashing resources are emitted in day order',
    fwd.map(x => `${x.dateISO} ${x.resourceLabel}`), ['2026-09-07 Framers', '2026-09-08 s-dry']);
  eq('  …and reversing the input does not reorder them',
    JSON.stringify(findCrossProjectClashes([...set].reverse(), WEEK)), JSON.stringify(fwd));
}
// The label is a per-project COPY (`assignedSubName` is stamped when the sub is
// assigned, not joined live), so two jobs can spell one sub id two ways. Which
// one wins must not depend on which project loaded first, or the Summary strip
// renames the crew between launches.
{
  const a = P('p1', 'Henderson', [T({ id: 't1', startDay: 1, durationDays: 1, assignedSubId: 's-dry', assignedSubName: 'Ace Drywall' })]);
  const b = P('p2', 'Ridgeline', [T({ id: 't2', startDay: 1, durationDays: 1, assignedSubId: 's-dry', assignedSubName: 'Zeta Drywall LLC' })]);
  eq('two spellings of one sub id resolve the same either way',
    findCrossProjectClashes([a, b], WEEK)[0]?.resourceLabel,
    findCrossProjectClashes([b, a], WEEK)[0]?.resourceLabel);
}
// Two DIFFERENT resources can share a display name — a sub record called "Ace
// Drywall" and someone else typing "Ace Drywall" into the crew field. They are
// separate problems on separate jobs; collapsing the digest by label merged them
// into one row that named four jobs and no longer described anything real.
{
  const mk = (id: string, name: string, res: Partial<ScheduleTask>) =>
    P(id, name, [T({ id: `${id}t`, startDay: 1, durationDays: 1, ...res })]);
  const d = digestClashes(findCrossProjectClashes([
    mk('p1', 'Henderson', { assignedSubId: 's1', assignedSubName: 'Ace Drywall' }),
    mk('p2', 'Ridgeline', { assignedSubId: 's1', assignedSubName: 'Ace Drywall' }),
    mk('p3', 'Oakmont', { crew: 'Ace Drywall' }),
    mk('p4', 'Cedar', { crew: 'Ace Drywall' }),
  ], WEEK));
  eq('same label, different resources → two digest rows', d.length, 2);
  eq('  and each row names only its own two jobs', d.map(x => x.jobNames),
    [['Cedar', 'Oakmont'], ['Henderson', 'Ridgeline']]);
}

// ── 11. ONE TASK'S WHOLE STORY, GROUPED BY JOB NOT BY DAY ────────────────────
// The commit box has ONE accessibilityHint and the card has limited room, so a
// task double-booked Monday AND Wednesday has to say both in one sentence.
{
  const a = P('p1', 'Henderson', [T({ id: 't1', startDay: 1, durationDays: 3, assignedSubId: 's-dry', assignedSubName: 'Ace Drywall' })]);
  const b = P('p2', 'Ridgeline', [T({ id: 't2', startDay: 1, durationDays: 1, assignedSubId: 's-dry' })]);
  const c = P('p3', 'Oakmont', [T({ id: 't3', startDay: 3, durationDays: 1, assignedSubId: 's-dry' })]);
  const cl = findCrossProjectClashes([a, b, c], WEEK);
  eq('one sentence per other job, every day of it',
    describeClashes(clashesForTask(cl, 'p1', 't1'), 'p1'),
    ['Ace Drywall is already committed to Oakmont on Wed, Sep 9.',
     'Ace Drywall is already committed to Ridgeline on Mon, Sep 7.']);
  const twoDays = P('p4', 'Cedar', [T({ id: 't4', startDay: 1, durationDays: 2, assignedSubId: 's-dry' })]);
  eq('two days on ONE job read as one sentence',
    describeClashes(clashesForTask(findCrossProjectClashes([a, twoDays], WEEK), 'p1', 't1'), 'p1'),
    ['Ace Drywall is already committed to Cedar on Mon, Sep 7 and Tue, Sep 8.']);
  eq('no clashes → nothing to say', describeClashes([], 'p1'), []);

  // Fed a whole project's clashes (two different resources fighting the same
  // job) it must not fuse them into one sentence naming one crew's days plus
  // another crew's.
  const twoRes = P('p5', 'Willow', [
    T({ id: 'w1', startDay: 1, durationDays: 1, assignedSubId: 's-dry', assignedSubName: 'Ace Drywall' }),
    T({ id: 'w2', startDay: 2, durationDays: 1, crew: 'Framers' }),
  ]);
  const rival = P('p6', 'Birch', [
    T({ id: 'b1', startDay: 1, durationDays: 1, assignedSubId: 's-dry' }),
    T({ id: 'b2', startDay: 2, durationDays: 1, crew: 'Framers' }),
  ]);
  eq('two resources against one job stay two sentences',
    describeClashes(clashesInvolving(findCrossProjectClashes([twoRes, rival], WEEK), 'p5'), 'p5'),
    ['Ace Drywall is already committed to Birch on Mon, Sep 7.',
     'Framers is already committed to Birch on Tue, Sep 8.']);
}

// ── 12. THE DAY GRID IS WHOLE DAYS, WHATEVER startDay HOLDS ──────────────────
// Nothing in the type or the importers forbids a fractional startDay. Keying
// claims off raw milliseconds put such a task's days at noon, where no other
// job's midnight claim could ever meet them — a real double-booking would have
// disappeared without a sound.
{
  const half = P('p1', 'Henderson', [T({ id: 't1', startDay: 1.5, durationDays: 1, assignedSubId: 's-dry' })]);
  const whole = P('p2', 'Ridgeline', [T({ id: 't2', startDay: 2, durationDays: 1, assignedSubId: 's-dry' })]);
  const c = findCrossProjectClashes([half, whole], WEEK);
  eq('a fractional startDay still meets a whole one', c.map(x => x.dateISO), ['2026-09-08']);
  eq('  …and the reported day is a UTC midnight',
    c[0] ? new Date(c[0].dayMs).toISOString() : '', '2026-09-08T00:00:00.000Z');
}

// summarizeClashDays is exported; it must not depend on the caller having sorted.
eq('unsorted days still read in order', summarizeClashDays(['2026-09-09', '2026-09-07']), 'Mon + Wed');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
