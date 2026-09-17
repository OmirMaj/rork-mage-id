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
  hydrateLastPlannerStore, sendBackfillUntilUnsynced, LastPlannerSentLog, pendingFromQueue,
  createLastPlannerLoader, writeStoreToCache, touchedWrites,
  LAST_PLANNER_MUTATION_KEY, lastPlannerQueryKey,
  type LastPlannerBucket, type LastPlannerStore, type LastPlannerSnapshot, type LastPlannerLoaderIo, type WeeklyCommitment, type Constraint,
  type LastPlannerHydrateDeps, type LastPlannerRowWrite, type LastPlannerWriteOutcome,
} from '../utils/lastPlanner';
import type { ScheduleTask } from '../types';
import { QueryClient, MutationObserver } from '@tanstack/query-core';
import { readFileSync, readdirSync } from 'node:fs';
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

// 9j. the wiring. The pure helpers above are only a fix if the store's owner
//     uses them and the table enforces the same key the client derives. The
//     I/O moved from app/last-planner.tsx into hooks/useLastPlanner.ts (so every
//     reader refills — see 9k–9n), so that is the file pinned here.
{
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const hook = readFileSync(join(ROOT, 'hooks', 'useLastPlanner.ts'), 'utf8');
  const lib = readFileSync(join(ROOT, 'utils', 'lastPlanner.ts'), 'utf8');
  const migration = readFileSync(join(ROOT, 'supabase', 'migrations', '20260916150000_last_planner_cloud_mirror.sql'), 'utf8');
  check('the store hydrates through mergeCloudIntoStore (hook → createLastPlannerLoader → hydrateLastPlannerStore)',
    /createLastPlannerLoader\(/.test(hook)
      && /function createLastPlannerLoader[\s\S]*hydrateLastPlannerStore\(userId,/.test(lib)
      && /mergeCloudIntoStore\(local,/.test(lib));
  check('the store pushes through diffBucketWrites (hook → touchedWrites → diffBucketWrites)',
    /touchedWrites\(/.test(hook) && /function touchedWrites[\s\S]*?diffBucketWrites\(projectId,/.test(lib));
  check('mirror writes go through the offline queue as UPSERTS (an insert of a derived id is a terminal duplicate)',
    /supabaseWriteDetailed\(\s*w\.table,\s*'upsert'/.test(hook) && !/supabase\.from\([^)]*\)\.(insert|upsert|update|delete)\(/.test(hook),
    'hooks/useLastPlanner.ts must write via supabaseWriteDetailed(w.table, \'upsert\', …) and never call supabase.from(...).insert/upsert directly');
  check('the commitments table enforces one row per (project, task, week)',
    /UNIQUE\s*\(\s*project_id,\s*task_id,\s*week_start\s*\)/i.test(migration));
  check('the dispatches table enforces one row per (project, crew, week)',
    /UNIQUE\s*\(\s*project_id,\s*crew_key,\s*week_start\s*\)/i.test(migration));
}

// ── 9k–9n. every reader refills, not just the screen ────────────────────────
// THE OPEN ITEM (screen audit follow-up, 2026-09-16). The hydrate lived inside
// app/last-planner.tsx. The Friday Close card read the AsyncStorage key directly
// and Ask read it through a local-only loader, so on a fresh device or after a
// sign-out both reported an empty planner — "no commitments this week" shown as
// fact — until someone opened the Last Planner screen once. The load now lives
// in hooks/useLastPlanner's query and runs through hydrateLastPlannerStore,
// whose guarantees are exercised here with injected I/O.
console.log('\nlast planner hydrate (shared loader; the mirror\'s guarantees hold for every reader):');
{
  const P = 'proj-1', U = 'user-1', W = '2026-09-14';
  const commit = (over: Partial<WeeklyCommitment> = {}): WeeklyCommitment =>
    ({ taskId: 'frame', weekStart: W, committed: true, ...over });
  const cloud = {
    constraints: [],
    commitments: [commitmentToRow(P, U, commit({ outcome: 'done' }))],
    dispatches: [],
  };
  const frameKey = pendingRowKey(LAST_PLANNER_TABLES.commitments, commitmentRowId(P, 'frame', W));
  const deps = (over: Partial<LastPlannerHydrateDeps> = {}): LastPlannerHydrateDeps => ({
    fetchCloud: async () => cloud,
    readQueue: async () => ({ entries: [], readFailed: false }),
    recentlySent: () => new Map(),
    settleWrites: async () => {},
    readLocal: async () => ({}),
    ...over,
  });
  const quiet = console.warn;
  console.warn = () => {};
  const run = async () => {
    // 9k. an empty device (fresh install / after the sign-out sweep) refills.
    const fresh = await hydrateLastPlannerStore(U, deps());
    eq('an empty device store refills from the server', fresh.store[P]?.commitments.length, 1);
    eq('...and reports synced', fresh.sync, 'synced');

    // 9k'. a queued write beats the server copy.
    const queued = await hydrateLastPlannerStore(U, deps({
      readQueue: async () => ({ entries: [{ table: LAST_PLANNER_TABLES.commitments,
        data: commitmentToRow(P, U, commit({ outcome: 'missed', varianceReason: 'labor' })) }], readFailed: false }),
    }));
    eq('a pending queue entry beats the server copy', queued.store[P]?.commitments[0]?.outcome, 'missed');

    // 9k''. a row sent while the read ran beats the server copy too.
    const raced = await hydrateLastPlannerStore(U, deps({
      recentlySent: () => new Map([[frameKey, commitmentToRow(P, U, commit({ outcome: 'missed', varianceReason: 'weather' }))]]),
      readLocal: async () => ({ [P]: { constraints: [], commitments: [commit({ outcome: 'missed', varianceReason: 'weather' })], dispatches: [] } }),
    }));
    eq('a row sent during the hydrate is not reverted', raced.store[P]?.commitments[0]?.outcome, 'missed');

    // 9l. an UNREADABLE queue means give up, not "nothing pending".
    const localOnly = { [P]: { constraints: [], commitments: [commit({ outcome: 'missed', varianceReason: 'labor' }), commit({ taskId: 'roof' })], dispatches: [] } };
    const blind = await hydrateLastPlannerStore(U, deps({
      readQueue: async () => ({ entries: [], readFailed: true }),
      readLocal: async () => localOnly,
    }));
    eq('an unreadable queue stays local-only', blind.sync, 'local-only');
    eq('...keeps the device value (the server does not win blind)', blind.store[P]?.commitments[0]?.outcome, 'missed');
    eq('...and backfills nothing from an untrusted merge', blind.backfill.length, 0);
    const offline = await hydrateLastPlannerStore(U, deps({
      fetchCloud: async () => { throw new Error('network'); }, readLocal: async () => localOnly,
    }));
    eq('a failed server read keeps the device store', offline.store[P]?.commitments.length, 2);
    eq('...marked local-only', offline.sync, 'local-only');

    // 9l'. duplicate natural keys collapse through the shared loader too.
    const dup = await hydrateLastPlannerStore(U, deps({
      fetchCloud: async () => ({ constraints: [], commitments: [], dispatches: [] }),
      readLocal: async () => ({ [P]: { constraints: [], commitments: [commit(), commit({ outcome: 'done' })], dispatches: [] } }),
    }));
    eq('a duplicated natural key collapses to one row', dup.store[P]?.commitments.length, 1);
    eq('...and is backfilled once', dup.backfill.length, 1);

    // 9m. the backfill stops at the first write that does not land.
    const writes: LastPlannerRowWrite[] = ['a', 'b', 'c', 'd'].map(t => ({
      table: LAST_PLANNER_TABLES.commitments, id: commitmentRowId(P, t, W), row: commitmentToRow(P, U, commit({ taskId: t })),
    }));
    const sent: string[] = [];
    const outcomes: LastPlannerWriteOutcome[] = ['synced', 'queued', 'synced', 'synced'];
    await sendBackfillUntilUnsynced(writes, async w => { sent.push(w.id); return outcomes[sent.length - 1]!; });
    eq('the backfill stops after the first write that did not land (2 of 4 attempted)', sent.length, 2);

    // 9n. the sent log: a row stays protected until a hydrate that started
    //     AFTER it settled has run; a tenant switch forgets it.
    const log = new LastPlannerSentLog();
    let clock = 100;
    const settle = log.begin(U, frameKey, { id: 'x' }, () => clock);
    check('an unsettled send is pending for a hydrate that started later', log.pendingSince(U, 200).has(frameKey));
    clock = 150; settle();
    check('a send that settled after the hydrate started is still pending', log.pendingSince(U, 120).has(frameKey));
    check('a send that settled before the hydrate started is not', !log.pendingSince(U, 180).has(frameKey));
    log.prune(U, 120);
    check('prune keeps a row the hydrate may not have seen', log.pendingSince(U, 120).has(frameKey));
    log.prune(U, 180);
    check('prune drops a row the hydrate saw land', !log.pendingSince(U, 0).has(frameKey));
    log.begin(U, frameKey, { id: 'x' }, () => clock);
    check('another user never sees this user\'s sent rows', !log.pendingSince('user-2', 0).has(frameKey));
    check('pendingFromQueue ignores other tables and keeps the newest row',
      pendingFromQueue([
        { table: 'daily_reports', data: { id: 'r1' } },
        { table: LAST_PLANNER_TABLES.commitments, data: { id: 'k', v: 1 } },
        { table: LAST_PLANNER_TABLES.commitments, data: { id: 'k', v: 2 } },
      ]).size === 1);
  };
  await run().finally(() => { console.warn = quiet; });
}

// ── 9p–9q. the loader against the REAL query cache ──────────────────────────
// Adversarial review, 2026-09-16, of the move into the hook. Both bugs live in
// how @tanstack/query-core and the hydrate interleave, so they run the actual
// loader (createLastPlannerLoader) on a real QueryClient with in-memory I/O.
//   9p. the device copy seeded before the network read made the query FRESH, so
//       a second reader's fetchQuery returned `{}` instead of joining the merge.
//   9q. a hydrate still on the network at sign-out wrote the old account's
//       planner back to disk after the sweep and kept backfilling.
console.log('\nlast planner loader on the real query cache (overlapping readers, sign-out mid-hydrate):');
{
  const P = 'proj-1', A = 'user-a', B = 'user-b', W = '2026-09-14';
  const commit = (over: Partial<WeeklyCommitment> = {}): WeeklyCommitment =>
    ({ taskId: 'frame', weekStart: W, committed: true, ...over });
  // The app's real keys, not literals: a harness key the hook does not use
  // would prove nothing about the hook.
  const qkey = (u: string | null) => lastPlannerQueryKey(u);
  const gate = () => { let open!: () => void; const p = new Promise<void>(r => { open = r; }); return { p, open }; };
  const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));

  function harness(opts: { local?: LastPlannerStore } = {}) {
    const disk: { value: string | null } = { value: opts.local ? JSON.stringify(opts.local) : null };
    const net = gate();
    const localGate = { hold: false, g: gate() };
    const state = {
      session: A as string | null, sessionThrows: false, upserts: [] as string[], persists: 0,
      onUpsert: (_n: number) => {}, onPersist: () => {},
    };
    const io: LastPlannerLoaderIo = {
      queryKey: qkey,
      mutationKey: LAST_PLANNER_MUTATION_KEY,
      cloudEnabled: () => true,
      loadLocal: async () => {
        if (localGate.hold) await localGate.g.p;
        return disk.value ? JSON.parse(disk.value) as LastPlannerStore : {};
      },
      persist: async s => { state.persists++; disk.value = JSON.stringify(s); state.onPersist(); },
      unpersistIfUnchanged: async s => { if (disk.value === JSON.stringify(s)) disk.value = null; },
      fetchCloud: async () => {
        await net.p;
        return { constraints: [], commitments: [commitmentToRow(P, A, commit({ outcome: 'done' }))], dispatches: [] };
      },
      readQueue: async () => ({ entries: [], readFailed: false }),
      sessionUserId: async () => { if (state.sessionThrows) throw new Error('no session read'); return state.session; },
      upsert: async w => { state.upserts.push(w.id); state.onUpsert(state.upserts.length); return 'synced'; },
      now: Date.now,
    };
    const loader = createLastPlannerLoader(io);
    // gcTime Infinity: no GC timers keeping this script alive.
    const qc = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
    const options = (u: string | null) => ({
      queryKey: qkey(u), queryFn: () => loader.loadSnapshot(qc as never, u), staleTime: 30_000,
    });
    return { disk, net, localGate, state, loader, qc, options };
  }
  const commitmentsIn = (s: LastPlannerStore | undefined) => s?.[P]?.commitments.length ?? 0;

  const quiet = console.warn;
  console.warn = () => {};
  const run = async () => {
    // 9p. a second reader during the hydrate gets the merged store, not `{}`.
    {
      const h = harness();
      const first = h.qc.fetchQuery(h.options(A));
      await tick();
      check('the device copy is in the cache while the network read runs',
        h.qc.getQueryData<LastPlannerSnapshot>(qkey(A))?.sync === 'pending');
      const second = h.qc.fetchQuery(h.options(A));
      h.net.open();
      const [r1, r2] = await Promise.all([first, second]);
      eq('the first reader gets the merged store', commitmentsIn(r1.store), 1);
      eq('a reader that arrives during the hydrate joins it (fresh device, server has 1 commitment)', commitmentsIn(r2.store), 1);
      eq('...marked synced', r2.sync, 'synced');
      await h.loader.whenIdle();
    }
    // 9p'. a tap during the hydrate does not make the device copy look fresh.
    {
      const h = harness();
      const first = h.qc.fetchQuery(h.options(A));
      await tick();
      writeStoreToCache(h.qc as never, qkey(A), { [P]: { constraints: [], commitments: [], dispatches: [] } });
      const second = h.qc.fetchQuery(h.options(A));
      h.net.open();
      const [, r2] = await Promise.all([first, second]);
      eq('after a mid-hydrate cache write, a second reader still joins the merge', commitmentsIn(r2.store), 1);
      await h.loader.whenIdle();
    }
    // 9r. a tap made DURING the hydrate, under the store's mutation key, is
    //     awaited by the merge: it lands in the merged store and on disk. The
    //     hook's useMutation must carry this key (pinned in 9o'').
    {
      const h = harness();
      const first = h.qc.fetchQuery(h.options(A));
      await tick();
      const tapGate = gate();
      const tapped: Constraint = {
        id: 'c-tap', taskId: 'frame', category: 'materials', description: 'trusses', status: 'open',
        createdAt: '2026-09-15T12:00:00.000Z',
      };
      const tap = new MutationObserver(h.qc as never, {
        mutationKey: LAST_PLANNER_MUTATION_KEY,
        // No disk write here: the disk check below must see the HYDRATE's persist.
        mutationFn: async (next: LastPlannerStore) => { await tapGate.p; return next; },
        onSuccess: (next: LastPlannerStore) => { writeStoreToCache(h.qc as never, qkey(A), next); },
      }).mutate({ [P]: { constraints: [tapped], commitments: [], dispatches: [] } });
      h.net.open();
      await tick(60);
      tapGate.open();
      const [r] = await Promise.all([first, tap]);
      await h.loader.whenIdle();
      check('a tap still running when the network read returns is in the merged store',
        (r.store[P]?.constraints ?? []).some(c => c.id === 'c-tap'));
      check('...and in the store the hydrate writes to disk', (h.disk.value ?? '').includes('c-tap'));
    }
    // 9q. sign-out while the network read runs: nothing reaches disk or the server.
    {
      const local: LastPlannerStore = { p2: { constraints: [], commitments: [commit({ taskId: 'roof' })], dispatches: [] } };
      const h = harness({ local });
      const first = h.qc.fetchQuery(h.options(A)).catch(() => null);
      await tick();
      // AuthContext.logout order: signOut, wipeLocalUserCache, queryClient.clear().
      h.state.session = null; h.disk.value = null; h.qc.clear();
      h.net.open();
      await first; await tick(); await h.loader.whenIdle();
      eq('a hydrate that returns after sign-out leaves nothing on disk', h.disk.value, null);
      eq('...because it never writes (the take-back is only the fallback)', h.state.persists, 0);
      eq('...and backfills nothing under the next session', h.state.upserts.length, 0);
    }
    // 9q'. the wipe-then-clear window: the account switched, the Query is not yet cleared.
    {
      const local: LastPlannerStore = { p2: { constraints: [], commitments: [commit({ taskId: 'roof' })], dispatches: [] } };
      const h = harness({ local });
      const first = h.qc.fetchQuery(h.options(A));
      await tick();
      h.state.session = B; h.disk.value = null;
      h.net.open();
      await first; await h.loader.whenIdle();
      eq('a hydrate that lands after an account switch takes its write back', h.disk.value, null);
      eq('...and never backfills the old account\'s rows', h.state.upserts.length, 0);
    }
    // 9q'''. the cache was cleared but the session cannot be read: the cleared
    //        Query alone is enough to discard the result.
    {
      const local: LastPlannerStore = { p2: { constraints: [], commitments: [commit({ taskId: 'roof' })], dispatches: [] } };
      const h = harness({ local });
      const first = h.qc.fetchQuery(h.options(A)).catch(() => null);
      await tick();
      h.state.sessionThrows = true; h.disk.value = null; h.qc.clear();
      h.net.open();
      await first; await tick(); await h.loader.whenIdle();
      eq('a cleared hydrate with an unreadable session leaves nothing on disk', h.disk.value, null);
      eq('...and backfills nothing', h.state.upserts.length, 0);
    }
    // 9q'''''. the cache is cleared WHILE the merged store is being written to
    //          disk (the merge was current, the write is not). The session read
    //          still says "same" — clear() can land before auth settles — so
    //          only the Query-identity check can catch it: the write is taken
    //          back and nothing is backfilled.
    {
      const local: LastPlannerStore = { p2: { constraints: [], commitments: [commit({ taskId: 'roof' })], dispatches: [] } };
      const h = harness({ local });
      h.state.onPersist = () => { h.qc.clear(); };
      h.net.open();
      // clear() cancels the fetch still resolving, so the reader itself rejects.
      await h.qc.fetchQuery(h.options(A)).catch(() => null); await tick(); await h.loader.whenIdle();
      eq('a store written as the cache was cleared is taken back off disk', h.disk.value, null);
      eq('...and nothing is backfilled for the cleared query', h.state.upserts.length, 0);
    }
    // 9q''''. the account switches in the middle of a backfill: it stops there.
    {
      const roofs = ['r1', 'r2', 'r3'].map(t => commit({ taskId: t }));
      const h = harness({ local: { p2: { constraints: [], commitments: roofs, dispatches: [] } } });
      h.state.onUpsert = () => { h.state.session = B; };
      // Open the network first: an unopened gate leaves fetchCloud pending
      // forever and the whole script hangs instead of failing.
      h.net.open();
      await h.qc.fetchQuery(h.options(A)); await h.loader.whenIdle();
      eq('a backfill stops at the first row after the account changed', h.state.upserts.length, 1);
    }
    // 9q''. clear() before the device copy is even read: the seed does not resurrect the entry.
    {
      const h = harness();
      h.localGate.hold = true;
      const first = h.qc.fetchQuery(h.options(A)).catch(() => null);
      await tick();
      h.state.session = null; h.qc.clear();
      h.localGate.g.open(); h.net.open();
      await first; await tick(); await h.loader.whenIdle();
      check('a cleared user\'s cache entry is not recreated by the seed',
        h.qc.getQueryCache().find({ queryKey: qkey(A), exact: true }) === undefined);
    }
    // Positive control: a normal hydrate persists and backfills.
    {
      const local: LastPlannerStore = { p2: { constraints: [], commitments: [commit({ taskId: 'roof' })], dispatches: [] } };
      const h = harness({ local });
      const first = h.qc.fetchQuery(h.options(A));
      h.net.open();
      await first; await h.loader.whenIdle();
      check('a normal hydrate persists the merged store',
        commitmentsIn(JSON.parse(h.disk.value ?? '{}') as LastPlannerStore) === 1 && h.disk.value!.includes('roof'));
      eq('...and backfills the local-only row', h.state.upserts.length, 1);
    }
    // The backfill asks before every row.
    {
      const writes: LastPlannerRowWrite[] = ['a', 'b', 'c'].map(t => ({
        table: LAST_PLANNER_TABLES.commitments, id: commitmentRowId(P, t, W), row: commitmentToRow(P, A, commit({ taskId: t })),
      }));
      let n = 0;
      const attempted = await sendBackfillUntilUnsynced(writes, async () => { n++; return 'synced'; }, () => n < 1);
      eq('the backfill stops once its session is gone', attempted, 1);
    }
  };
  await run().finally(() => { console.warn = quiet; });
}

// 9o. the wiring: nothing reads the raw key or re-types the query key outside
//     the hook, and the other readers go through its shared loader.
{
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');
  const hook = read('hooks', 'useLastPlanner.ts');
  const screen = read('app', 'last-planner.tsx');
  const weekClose = read('hooks', 'useWeekClose.ts');
  const ask = read('app', 'ask.tsx');
  check('the hook exports the storage key and query key',
    /export const LAST_PLANNER_STORAGE_KEY\b/.test(hook)
    && /export \{[^}]*\bLAST_PLANNER_QUERY_KEY\b[^}]*\}/.test(hook));
  // 9o''. the hydrate only waits for mutations under LAST_PLANNER_MUTATION_KEY
  //       (9r). Both the loader and the hook's useMutation must carry it, or a
  //       tap mid-hydrate is dropped with every behavioural test still green.
  check('the hook\'s loader waits on the shared mutation key',
    /mutationKey:\s*LAST_PLANNER_MUTATION_KEY,/.test(/const loader = createLastPlannerLoader\(\{[\s\S]*?\n\}\);/.exec(hook)?.[0] ?? ''));
  check('the hook\'s useMutation runs under the shared mutation key',
    /useMutation\(\{\s*(?:\/\/[^\n]*\n\s*)*mutationKey:\s*LAST_PLANNER_MUTATION_KEY,/.test(hook));
  check('the hook pushes only the rows a change names (touchedWrites, not the raw diff)',
    /touchedWrites\(projectId,\s*userId,\s*before,\s*after,\s*touched\)/.test(hook) && !/diffBucketWrites\(/.test(hook));
  check('the hook\'s query runs the shared loader (every reader refills)',
    /queryFn:\s*\(\)\s*=>\s*loader\.loadSnapshot\(/.test(hook) && /const loader = createLastPlannerLoader\(/.test(hook));
  check('the hook\'s mutations write the cache through writeStoreToCache (keeps the query\'s staleness)',
    /writeStoreToCache\(queryClient,\s*key,\s*next\)/.test(hook) && !/setQueryData/.test(hook));
  check('the hydrate reads the offline queue with readFailed, not the lossy variant',
    /readQueue:\s*getOwnOfflineQueueDetailed/.test(hook));
  for (const [name, src] of [['app/last-planner.tsx', screen], ['hooks/useWeekClose.ts', weekClose], ['app/ask.tsx', ask]] as const) {
    check(`${name} does not read the raw store key`, !/mageid_last_planner/.test(src) && !/\['last-planner'\]/.test(src));
    check(`${name} does not run its own cloud read of the planner tables`, !/last_planner_|LAST_PLANNER_TABLES\./.test(src));
  }
  check('the Friday Close card reads through the shared loader', /fetchLastPlannerStore\(\s*queryClient,\s*userId\s*\)/.test(weekClose));
  check('Ask reads constraints through the shared loader', /loadAllConstraints\(\s*queryClient,\s*userId\s*\)/.test(ask));

  // 9o'. the per-file checks above only catch the literal key. Importing the
  //      exported constant and reading AsyncStorage with it is the same bug
  //      (a reader that never refills), so scan the whole source tree: outside
  //      the hook, nobody touches the key — by literal or by constant.
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const ent of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = join(dir, ent.name);
      if (ent.isDirectory()) { walk(rel); continue; }
      if (!/\.(ts|tsx)$/.test(ent.name) || rel === join('hooks', 'useLastPlanner.ts')) continue;
      const src = read(rel);
      if (/\bLAST_PLANNER_STORAGE_KEY\b/.test(src) || /['"]mageid_last_planner['"]/.test(src)) offenders.push(rel);
    }
  };
  for (const dir of ['app', 'hooks', 'components', 'contexts', 'utils', 'lib']) walk(dir);
  check('nothing outside hooks/useLastPlanner.ts reads the store key (literal or exported constant)',
    offenders.length === 0, offenders.join(', '));
}

// 9s. touchedWrites: a write built on a stale snapshot pushes only the row
//     the user changed, never a stale copy of another row.
console.log('\ntouched-row filter (a stale copy of an untouched row is never uploaded):');
{
  const P = 'proj-1', U = 'user-a', W = '2026-09-14';
  const cm = (taskId: string, over: Partial<WeeklyCommitment> = {}): WeeklyCommitment =>
    ({ taskId, weekStart: W, committed: true, ...over });
  // `before` is the stale snapshot: its roof row differs from what `after`
  // (built off the cache) carries, as if another device updated roof.
  const before: LastPlannerBucket = { constraints: [], commitments: [cm('frame'), cm('roof', { outcome: 'done' })], dispatches: [] };
  const after: LastPlannerBucket = { constraints: [], commitments: [cm('frame', { committed: false }), cm('roof', { outcome: 'missed' })], dispatches: [] };
  const frameKey = pendingRowKey(LAST_PLANNER_TABLES.commitments, commitmentRowId(P, 'frame', W));
  const writes = touchedWrites(P, U, before, after, [frameKey]);
  eq('the raw diff has both rows (control)', diffBucketWrites(P, U, before, after).length, 2);
  eq('only the touched row is pushed', writes.length, 1);
  eq('...and it is the row the user changed', writes[0]?.id, commitmentRowId(P, 'frame', W));
  eq('a change that names no rows pushes nothing', touchedWrites(P, U, before, after, []).length, 0);
}

if (failures > 0) {
  console.error(`\n✗ validate-last-planner: ${failures} failure(s)\n`);
  process.exit(1);
}
console.log('\nall last-planner checks passed\n');
