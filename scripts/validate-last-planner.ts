// validate-last-planner.ts — the lookahead must agree with the Gantt.
//
// WHY THIS EXISTS. utils/lastPlanner.taskWindow used to treat BOTH of
// ScheduleTask's day fields as calendar days.
//
// (Historical note, corrected 2026-09-11: this header used to say `startDay`
// became a CALENDAR index once a project had a start date, because
// utils/scheduleRebase re-mapped it at that moment. That helper existed to
// compensate for the CPM engine misreading the field, the engine now converts
// at its own `pins` line, and scheduleRebase has been deleted. Both fields are
// on the WORKING scale: `startDay` is a working ORDINAL and `durationDays` a
// working-day COUNT. The unit mismatch this file guards is unchanged — the
// window has to be walked on the calendar, not multiplied by DAY_MS.)
//
// utils/lastPlanner.taskWindow treated BOTH as calendar days:
//     endMs = startMs + (dur - 1) * DAY_MS
// while utils/cpm computes the same finish as
//     walkWorkingDays(es, dur - 1, 1, ...)
//
// So on a Mon-Fri calendar a 10-day task finished 2 days early, a 20-day task 4
// days early, and the error grew with duration. Two consequences, both on the
// screen a superintendent commits next week's crews from:
//   1. Tasks displayed a finish date the Gantt disagreed with.
//   2. The horizon overlap test (`win.endMs < thisMondayMs`) FILTERED OUT tasks
//      whose real window reached into the lookahead — work vanished from the
//      3-week plan entirely rather than merely being mislabelled.
//
// Run via: bun run test:last-planner

import {
  taskWindow, buildLookahead, computePpc,
  commitmentRowId, commitmentToRow, constraintToRow, dispatchToRow,
  diffBucketWrites, mergeCloudIntoStore, pendingRowKey, LAST_PLANNER_TABLES,
  type LastPlannerBucket, type WeeklyCommitment, type Constraint,
} from '../utils/lastPlanner';
import type { ScheduleTask } from '../types';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { console.log('  ✓', label); }
  else { console.error('  ✗', label, detail ? `\n      ${detail}` : ''); failures++; }
}
function eq(label: string, actual: unknown, expected: unknown) {
  check(`${label} (= ${String(expected)})`, actual === expected, `got ${String(actual)}`);
}

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function task(over: Partial<ScheduleTask> = {}): ScheduleTask {
  return { id: 't1', name: 'Frame', startDay: 1, durationDays: 1, ...over } as ScheduleTask;
}

// 2026-08-31 is a MONDAY. Every expectation below is hand-checked against it.
const START = '2026-08-31';

console.log('\nlast planner window math (working days, not calendar days):');

check('the anchor really is a Monday', new Date(START + 'T00:00:00Z').getUTCDay() === 1);

// ── 1. a 5-working-day task on a Mon-Fri calendar ends FRIDAY ───────────────
{
  const w = taskWindow(task({ durationDays: 5 }), START, { workingDaysPerWeek: 5 });
  eq('Mon + 5 working days starts Monday', iso(w!.startMs), '2026-08-31');
  eq('...and ends Friday, not Friday-minus-nothing', iso(w!.endMs), '2026-09-04');
}

// ── 2. 10 working days spans TWO weeks — the case that was 2 days short ─────
{
  const w = taskWindow(task({ durationDays: 10 }), START, { workingDaysPerWeek: 5 });
  eq('10 working days ends the following Friday', iso(w!.endMs), '2026-09-11');
  // The old calendar-day math produced 2026-09-09. Pin the delta explicitly.
  check('...which is 2 days later than the old calendar-day result',
    (w!.endMs - w!.startMs) / DAY === 11,
    `span was ${(w!.endMs - w!.startMs) / DAY} days`);
}

// ── 3. the error compounds with duration ────────────────────────────────────
{
  const w = taskWindow(task({ durationDays: 20 }), START, { workingDaysPerWeek: 5 });
  eq('20 working days ends four weeks out', iso(w!.endMs), '2026-09-25');
}

// ── 4. closures push the finish out too ─────────────────────────────────────
{
  const w = taskWindow(task({ durationDays: 5 }), START,
    { workingDaysPerWeek: 5, nonWorkingDates: ['2026-09-02'] });
  eq('a mid-week holiday pushes the finish to Monday', iso(w!.endMs), '2026-09-07');
}

// ── 5. 7-day weeks are the identity — behaviour is unchanged ────────────────
// This is the default, so every caller that has no calendar to pass keeps the
// exact arithmetic it had before the fix.
{
  const w7 = taskWindow(task({ durationDays: 10 }), START, { workingDaysPerWeek: 7 });
  const wNone = taskWindow(task({ durationDays: 10 }), START);
  eq('7-day weeks: 10 days is 10 calendar days', iso(w7!.endMs), '2026-09-09');
  eq('omitting the calendar matches the 7-day default', wNone!.endMs, w7!.endMs);
}

// ── 6. degenerate calendars terminate ───────────────────────────────────────
// Every day closed must not spin the walk forever; it falls back to the
// calendar span rather than hanging the lookahead.
{
  const allClosed = Array.from({ length: 400 }, (_, i) =>
    iso(Date.parse(START + 'T00:00:00Z') + i * DAY));
  const w = taskWindow(task({ durationDays: 10 }), START,
    { workingDaysPerWeek: 5, nonWorkingDates: allClosed });
  check('a fully-closed calendar terminates and falls back', !!w && Number.isFinite(w.endMs));
}

// ── 7. no start date → no window (unchanged) ────────────────────────────────
check('no project start date yields null', taskWindow(task(), null) === null);
check('an unparseable start date yields null', taskWindow(task(), 'not-a-date') === null);

// ── 8. the horizon filter no longer drops real work ─────────────────────────
// THE USER-VISIBLE BUG. A task whose working-day window reaches into the
// 3-week horizon must appear in the lookahead. Under calendar-day math its
// end fell short of `thisMonday` and it was filtered out — the superintendent
// simply never saw the work.
{
  // Starts 12 calendar days BEFORE the as-of Monday, 10 working days long.
  // Calendar math ends it before the horizon opens; working-day math does not.
  const asOf = new Date('2026-09-14T00:00:00Z'); // a Monday
  const t = task({ id: 'reach', startDay: 3, durationDays: 10 });
  const la = buildLookahead([t], START, [], {
    weeks: 3, asOf, calendar: { workingDaysPerWeek: 5 },
  });
  const ids = la.weeks.flatMap(w => w.entries.map(e => e.task.id));
  check('a task spanning into the horizon is IN the lookahead',
    ids.includes('reach'),
    'the working-day window reaches this week, so the superintendent must see it');
}

// ── 9. the cloud mirror — one logout must not erase PPC, and sync must not ──
//       double-count it
// THE FINDING (screen audit, schedule group): the whole loop lived in one
// AsyncStorage key that every sign-out sweeps, with no server copy. The mirror
// fixes that, but a naive mirror is worse than none: WeeklyCommitment has no id,
// so a write that mints a fresh id per save turns an offline-queue replay or a
// laptop+phone edit of the same week into TWO rows, and computePpc counts the
// commitment twice — a wrong PPC shown to a GC as fact.
console.log('\nlast planner cloud mirror (one row per natural key, server wins except over pending):');
{
  const P = 'proj-1', U = 'user-1', W = '2026-09-14';
  const commit = (over: Partial<WeeklyCommitment> = {}): WeeklyCommitment =>
    ({ taskId: 'frame', weekStart: W, committed: true, ...over });
  const bucket = (over: Partial<LastPlannerBucket> = {}): LastPlannerBucket =>
    ({ constraints: [], commitments: [], dispatches: [], ...over });
  const noPending = new Map<string, Record<string, unknown>>();

  // 9a. the id is a pure function of the natural key — the same week committed
  //     on two devices, or replayed by the queue, targets ONE row.
  const rowA = commitmentToRow(P, U, commit());
  const rowB = commitmentToRow(P, U, commit({ outcome: 'done' }));
  eq('two saves of the same (project, task, week) share one row id', rowA.id, rowB.id);
  eq('...and that id is the derived natural key', rowA.id, commitmentRowId(P, 'frame', W));
  check('a different week is a different row', commitmentToRow(P, U, commit({ weekStart: '2026-09-21' })).id !== rowA.id);
  check('dispatch ids are derived too',
    dispatchToRow(P, U, { crewKey: 'sub:abc', weekStart: W, channel: 'email', sentAt: '2026-09-14T12:00:00.000Z' }).id
      === dispatchToRow(P, U, { crewKey: 'sub:abc', weekStart: W, channel: 'share', sentAt: '2026-09-15T12:00:00.000Z' }).id);

  // 9b. the new-phone case: an EMPTY device store rehydrates the PPC history.
  const cloud = {
    constraints: [],
    commitments: [
      commitmentToRow(P, U, commit({ taskId: 'frame', outcome: 'done' })),
      commitmentToRow(P, U, commit({ taskId: 'roof', outcome: 'missed', varianceReason: 'weather' })),
    ],
    dispatches: [],
  };
  const restored = mergeCloudIntoStore({}, cloud, noPending, U);
  eq('an emptied device gets its commitments back', restored.store[P]?.commitments.length, 2);
  eq('...with the PPC they had (1 of 2 kept)', computePpc(restored.store[P]!.commitments, W).ppc, 0.5);
  eq('...and nothing to backfill', restored.backfill.length, 0);

  // 9c. the laptop committed the week, the phone reviewed it: the server row and
  //     the local row are the SAME commitment and must merge to one, not two.
  const phoneLocal = { [P]: bucket({ commitments: [commit({ taskId: 'frame' })] }) };
  const merged = mergeCloudIntoStore(phoneLocal, cloud, noPending, U);
  const frames = merged.store[P]!.commitments.filter(c => c.taskId === 'frame' && c.weekStart === W);
  eq('the same commitment on device and server merges to ONE row', frames.length, 1);
  eq('...the server copy wins when nothing is pending', frames[0]?.outcome, 'done');
  eq('PPC counts it once (2 committed, not 3)', computePpc(merged.store[P]!.commitments, W).committed, 2);

  // 9d. a local store that somehow holds the key twice still counts once.
  const dup = mergeCloudIntoStore({ [P]: bucket({ commitments: [commit(), commit({ outcome: 'done' })] }) },
    { constraints: [], commitments: [], dispatches: [] }, noPending, U);
  eq('a duplicated local natural key collapses to one row', dup.store[P]!.commitments.length, 1);
  eq('...and is backfilled once', dup.backfill.length, 1);

  // 9e. a checkbox that has not landed yet is NOT reverted by the older server copy.
  const pending = new Map([[pendingRowKey(LAST_PLANNER_TABLES.commitments, String(rowA.id)),
    commitmentToRow(P, U, commit({ outcome: 'missed', varianceReason: 'labor' }))]]);
  const kept = mergeCloudIntoStore({ [P]: bucket({ commitments: [commit({ outcome: 'missed', varianceReason: 'labor' })] }) },
    cloud, pending, U);
  eq('a pending local review beats the server copy', kept.store[P]!.commitments.find(c => c.taskId === 'frame')?.outcome, 'missed');

  // 9f. same-user re-auth: the sweep emptied the store but kept the queue.
  const afterReauth = mergeCloudIntoStore({}, cloud, pending, U);
  eq('a queued write rehydrates an emptied store ahead of the server copy',
    afterReauth.store[P]!.commitments.find(c => c.taskId === 'frame')?.outcome, 'missed');

  // 9g. history recorded before the table existed is sent up, once.
  const oldHistory = mergeCloudIntoStore({ [P]: bucket({ commitments: [commit({ taskId: 'drywall', outcome: 'done' })] }) },
    { constraints: [], commitments: [], dispatches: [] }, noPending, U);
  eq('local-only history is backfilled', oldHistory.backfill.length, 1);
  eq('...as an upsert on the derived id', oldHistory.backfill[0]?.id, commitmentRowId(P, 'drywall', W));

  // 9h. a server tombstone removes the row; a constraint round-trips unchanged.
  const con: Constraint = { id: 'c1', taskId: 'frame', category: 'permit', description: 'Framing permit',
    status: 'open', createdAt: '2026-09-10T09:00:00.000Z' };
  const tomb = { ...constraintToRow(P, U, con), deleted_at: '2026-09-12T09:00:00+00:00' };
  const gone = mergeCloudIntoStore({ [P]: bucket({ constraints: [con] }) },
    { constraints: [tomb], commitments: [], dispatches: [] }, noPending, U);
  eq('a server tombstone removes the constraint here', gone.store[P]!.constraints.length, 0);
  const roundTrip = mergeCloudIntoStore({}, {
    constraints: [{ ...constraintToRow(P, U, con), created_at: '2026-09-10T09:00:00+00:00' }],
    commitments: [], dispatches: [] }, noPending, U);
  eq('a hydrated constraint diffs as unchanged (no spurious re-upload)',
    diffBucketWrites(P, U, bucket({ constraints: [con] }), roundTrip.store[P]!).length, 0);

  // 9i. the diff sends changed rows, and never turns a disappearance into a write.
  const writes = diffBucketWrites(P, U, bucket({ commitments: [commit()] }), bucket({ commitments: [commit({ outcome: 'done' })] }));
  eq('a reviewed commitment produces exactly one upsert', writes.length, 1);
  eq('...on the derived id', writes[0]?.id, commitmentRowId(P, 'frame', W));
  eq('a row that vanished from the store sends nothing',
    diffBucketWrites(P, U, bucket({ commitments: [commit()] }), bucket()).length, 0);
}

// 9j. the wiring. The pure helpers above are only a fix if the screen uses them
//     and the table enforces the same key the client derives.
{
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const screen = readFileSync(join(ROOT, 'app', 'last-planner.tsx'), 'utf8');
  const migration = readFileSync(join(ROOT, 'supabase', 'migrations', '20260916150000_last_planner_cloud_mirror.sql'), 'utf8');
  check('the screen hydrates through mergeCloudIntoStore', /mergeCloudIntoStore\(/.test(screen));
  check('the screen pushes through diffBucketWrites', /diffBucketWrites\(/.test(screen));
  check('mirror writes go through the offline queue as UPSERTS (an insert of a derived id is a terminal duplicate)',
    /supabaseWriteDetailed\(\s*w\.table,\s*'upsert'/.test(screen) && !/supabase\.from\([^)]*\)\.(insert|upsert|update|delete)\(/.test(screen),
    'app/last-planner.tsx must write via supabaseWriteDetailed(w.table, \'upsert\', …) and never call supabase.from(...).insert/upsert directly');
  check('the commitments table enforces one row per (project, task, week)',
    /UNIQUE\s*\(\s*project_id,\s*task_id,\s*week_start\s*\)/i.test(migration));
  check('the dispatches table enforces one row per (project, crew, week)',
    /UNIQUE\s*\(\s*project_id,\s*crew_key,\s*week_start\s*\)/i.test(migration));
}

if (failures > 0) {
  console.error(`\n✗ validate-last-planner: ${failures} failure(s)\n`);
  process.exit(1);
}
console.log('\nall last-planner checks passed\n');
