// validate-schedule-concurrency.ts — the SECOND writer of #25 (integration
// round, 2026-09-17).
//
// THE BUG. The field RPC made a foreman's progress reach the server, but the
// owner's or an editor's next project write put the old value back without
// telling anyone. Every updateProject sent the WHOLE `schedule` from that
// device's local copy — whatever the edit was (a DFR chip, a status change, a
// portal toggle, a geocode) — and on iOS that copy is usually hours old: the GC
// opens his phone at 07:00, the foreman sets Framing to 60% at 10:00, the GC
// changes the project status at 15:00, and the upsert carries 07:00's 0%.
//
// THE FIX, pinned here:
//   1. syncProjectToSupabase sends `schedule` only when the update touched it
//      (updateProject threads its keys; a replaced pending sync that carried
//      the schedule keeps carrying it);
//   2. per-task, per-key `fieldEditedAt` stamps + a BEFORE UPDATE trigger in
//      migration 20260917160000 that keeps a stored field value newer than
//      the incoming copy's stamp — for every writer, every build. EXECUTED on
//      PGlite (scratchpad pgtest/sched_second_writer.mjs): RPC patch, then an
//      owner upsert and an editor PATCH built from the pre-RPC schedule keep
//      the RPC values; an owner's later progress change wins; a clock-skewed
//      owner stamp cannot outrank a later RPC write; ownership and money
//      untouched; the foreman still cannot write a non-field key or a stamp.
//      Removing the trigger turned 8 of those cases red. The client applies
//      the same rule (stampFieldEdits) so the owner's screen shows what the
//      server will keep;
//   3. the projects are re-read when the app returns to the foreground.
// Plus the lane's smaller items: legacy day-0 retro start, the punch photo
// that outlived its signed URL.
//
// Run: bun run scripts/validate-schedule-concurrency.ts

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { ScheduleTask } from '../types';
import {
  FIELD_EDIT_STAMPS, FIELD_TASK_PATCH_KEYS, absorbServerScheduleTasks, applyFieldTaskPatches, fieldTaskDiff,
  projectSyncSendsSchedule, stampFieldEdits, staleFieldEdits,
} from '../utils/fieldScheduleUpdate';
import { keepProjectsWrittenSince, newProjectWriteLog, noteProjectWrite, unconfirmedProjectSyncIds } from '../utils/projectsLoadGuard';
import { stampActuals, todayScheduleDay } from '../utils/pace/stampActuals';
import { inLocalOrder, openScheduleSyncGate, resetScheduleSyncGatesForTest, takeStoreScheduleCopy } from '../utils/scheduleMerge';

// Bun's transpiler, typed locally (the app's tsconfig carries no bun types).
declare const Bun: { Transpiler: new (o: { loader: 'ts' }) => { transformSync(code: string): string } };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');
const CTX = read(...(process.env.PROJECT_CONTEXT_PATH ? [process.env.PROJECT_CONTEXT_PATH] : ['contexts', 'ProjectContext.tsx']));
const MIG = read('supabase', 'migrations', '20260917160000_field_update_schedule_tasks.sql');
const HOOK = read('hooks', 'useProjectsFocusRefetch.ts');
const PRO = read(...(process.env.SCHEDULE_PRO_PATH ? [process.env.SCHEDULE_PRO_PATH] : ['app', 'schedule-pro.tsx']));

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean, detail = ''): void {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`); }
}
function slice(src: string, start: string, end: string): string {
  const i = src.indexOf(start);
  if (i < 0) return '';
  const j = src.indexOf(end, i + start.length);
  return j < 0 ? '' : src.slice(i, j);
}

const t = (o: Partial<ScheduleTask> & Record<string, unknown>): ScheduleTask => ({
  id: 'x', title: 'X', phase: 'P', durationDays: 5, startDay: 1, progress: 0, crew: '', dependencies: [], notes: '', status: 'not_started', ...o,
} as unknown as ScheduleTask);
/** What Schedule Pro shows after a copy reaches project.schedule from OUTSIDE
 *  (the foreground refetch, the post-queue re-pull): the store-copy rule
 *  (utils/scheduleMerge.ts takeStoreScheduleCopy) — not taken while the screen
 *  has an unsaved edit (`busy` here), taken WHOLE otherwise. */
let screenSeq = 0;
function screenTakes(incoming: ScheduleTask[], working: ScheduleTask[], busy: boolean): ScheduleTask[] {
  resetScheduleSyncGatesForTest();
  const gate = openScheduleSyncGate(`conc-${++screenSeq}`, 'LOADED');
  const copy = takeStoreScheduleCopy(gate, { tasks: incoming, stamp: 'REFETCH' }, busy, !busy);
  return copy ? inLocalOrder(copy.tasks, working) : working;
}
const stamps = (task: ScheduleTask | undefined) => ((task as unknown as Record<string, unknown> | undefined)?.[FIELD_EDIT_STAMPS] ?? {}) as Record<string, string>;

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nthe client rule (stampFieldEdits):');
{
  const NOW = '2026-09-17T15:00:00.000Z';
  const FIELD = '2026-09-17T10:00:00.000Z';
  // projectsRef after the refetch: the foreman's 60% with its RPC stamp.
  const fresh = [t({ id: 'a', title: 'Framing', progress: 60, status: 'in_progress', fieldEditedAt: { progress: FIELD, status: FIELD } }), t({ id: 'b', title: 'Drywall' })];
  // A screen's working copy from 07:00 — no stamps, 0%.
  const stale0700 = [t({ id: 'a', title: 'Framing' }), t({ id: 'b', title: 'Drywall' })];

  const out = stampFieldEdits(fresh, stale0700.map(x => x.id === 'b' ? { ...x, startDay: 9 } : x), NOW);
  ok('a stale working copy does not undo the foreman\'s progress (value + stamp kept)',
    out[0].progress === 60 && out[0].status === 'in_progress' && stamps(out[0]).progress === FIELD, JSON.stringify(out[0]));
  ok('...while the edit it carried (a date move on another task) goes through', out[1].startDay === 9);

  const edited = stampFieldEdits(fresh, [{ ...fresh[0], progress: 80 }, fresh[1]], NOW);
  ok('an owner who changes progress on a copy that saw the field value wins, stamped now',
    edited[0].progress === 80 && stamps(edited[0]).progress === NOW && stamps(edited[0]).status === FIELD, JSON.stringify(edited[0]));

  const behind = stampFieldEdits(fresh, [{ ...fresh[0], progress: 90 }, fresh[1]], '2026-09-17T09:00:00.000Z');
  ok('...even when this device\'s clock runs behind the server\'s (stamp is later than the field stamp)',
    behind[0].progress === 90 && Date.parse(stamps(behind[0]).progress) > Date.parse(FIELD), JSON.stringify(stamps(behind[0])));

  const neverStamped = stampFieldEdits(stale0700, [{ ...stale0700[0], progress: 25 }, stale0700[1]], NOW);
  ok('a task no field write ever touched: the owner\'s change is stamped and kept',
    neverStamped[0].progress === 25 && stamps(neverStamped[0]).progress === NOW);

  const untouched = stampFieldEdits(stale0700, stale0700, NOW);
  ok('nothing changed → the same task objects back (no stamp invented)', untouched[0] === stale0700[0] && untouched[1] === stale0700[1]);

  const added = stampFieldEdits(fresh, [...fresh, t({ id: 'c', title: 'Paint', progress: 10 })], NOW);
  ok('an added task is the editor\'s, unstamped', added[2].progress === 10 && !(FIELD_EDIT_STAMPS in (added[2] as object)));

  const lostStamp = stampFieldEdits(fresh, [t({ id: 'a', title: 'Framing', progress: 60, status: 'in_progress' }), fresh[1]], NOW);
  ok('a rebuilt task that lost its stamps gets the freshest back', stamps(lostStamp[0]).progress === FIELD);

  const cleared = stampFieldEdits(
    [t({ id: 'a', actualEndDate: '2026-09-17T12:00:00Z', fieldEditedAt: { actualEndDate: FIELD } })],
    [t({ id: 'a' })], NOW);
  ok('a stale copy without an actual the field recorded does not clear it', cleared[0].actualEndDate === '2026-09-17T12:00:00Z');

  ok('the stamp map is never a field edit or a blocked change on the field path',
    JSON.stringify(fieldTaskDiff([fresh[0]], [{ ...fresh[0], fieldEditedAt: { progress: NOW } } as unknown as ScheduleTask]))
      === JSON.stringify({ patches: [], blocked: [] }));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nthe GC\'s own deliberate change after the foreman\'s (fix round 1 review):');
{
  // Task ids/stamps here are unique to this block: stampFieldEdits remembers
  // the stamps this runtime mints, and a shared id would leak across cases.
  const FIELD = '2026-09-17T10:04:00.000Z';
  const LATER = '2026-09-17T15:00:00.000Z';
  const loaded0700 = [t({ id: 'r1', title: 'Framing' }), t({ id: 'r2', title: 'Drywall' })];
  const refetched = [t({ id: 'r1', title: 'Framing', progress: 60, status: 'in_progress', fieldEditedAt: { progress: FIELD, status: FIELD } }), t({ id: 'r2', title: 'Drywall' })];
  const done = (tasks: ScheduleTask[]) => tasks.map(x => x.id === 'r1' ? { ...x, progress: 100, status: 'done' as const } : x);

  // WITHOUT the rebase: the screen copy is still 07:00's. The change cannot
  // land (the server keeps the newer field value) — so it must be REPORTED.
  const refused = staleFieldEdits(refetched, done(loaded0700));
  ok('a change built on a copy older than the field stamp is reported, not silently dropped',
    refused.length === 2 && refused.every(r => r.taskId === 'r1' && r.fieldEditedAt === FIELD)
      && refused.map(r => r.key).sort().join() === 'progress,status', JSON.stringify(refused));
  const kept = stampFieldEdits(refetched, done(loaded0700), LATER);
  ok('...and what it reports is exactly what the save keeps from the field', kept[0].progress === 60 && kept[0].status === 'in_progress');

  // WITH the refetch taken: it reaches the screen (quiet) before he edits.
  const rebased = screenTakes(refetched, loaded0700, false);
  ok('the foreground refetch brings the foreman\'s value and stamps into the working copy (quiet → taken whole)',
    rebased[0].progress === 60 && stamps(rebased[0]).progress === FIELD, JSON.stringify(rebased[0]));
  const landed = stampFieldEdits(refetched, done(rebased), LATER);
  ok('...so the GC\'s deliberate change after it LANDS, stamped later than the field write',
    landed[0].progress === 100 && landed[0].status === 'done' && Date.parse(stamps(landed[0]).progress) > Date.parse(FIELD)
      && staleFieldEdits(refetched, done(rebased)).length === 0, JSON.stringify(landed[0]));

  // Unsaved local edits: the screen is busy, so the copy is not taken at all
  // (no merge) — the edits stay exactly as he left them, and whatever of the
  // foreman's his save would overwrite is reported, not silently dropped.
  const localEdited = [{ ...loaded0700[0], startDay: 4 }, { ...loaded0700[1], startDay: 9 }];
  const r2 = screenTakes(refetched, localEdited, true);
  ok('an unsaved date move stays (a busy screen takes no outside copy)', r2[0].startDay === 4 && r2[1].startDay === 9 && r2 === localEdited);
  ok('...and the save keeps the foreman\'s progress it did not touch (server rule, stampFieldEdits)',
    stampFieldEdits(refetched, r2, LATER)[0].progress === 60 && stampFieldEdits(refetched, r2, LATER)[0].startDay === 4);
  const both = screenTakes(refetched, [{ ...loaded0700[0], progress: 30 }, loaded0700[1]], true);
  // (His stale copy also carries the old status; the screen's refusal notice
  // tells the keys he changed HERE from those, against lastServerTasksRef.)
  ok('a key BOTH changed stays local and the save reports it',
    both[0].progress === 30 && stamps(both[0]).progress === undefined
      && staleFieldEdits(refetched, both).some(r => r.taskId === 'r1' && r.key === 'progress'));
  const mine = [loaded0700[0], t({ id: 'r4', title: 'Mine' })];
  const added = screenTakes([...refetched, t({ id: 'r3', title: 'Roof' })], mine, true);
  ok('busy: a local delete stays deleted, a local add stays', added.map(x => x.id).join() === 'r1,r4', added.map(x => x.id).join());
  const quietAdd = screenTakes([...refetched, t({ id: 'r3', title: 'Roof' })], loaded0700, false);
  ok('quiet: a server add appears, in the grid\'s order', quietAdd.map(x => x.id).join() === 'r1,r2,r3', quietAdd.map(x => x.id).join());
  ok('no unsaved edits → the server copy as it is', screenTakes(refetched, loaded0700, false).every((x, i) => JSON.stringify(x) === JSON.stringify(refetched[i])));
  // The screen's own write coming back stamped: taken whole, with its stamp.
  const sent = [{ ...loaded0700[0], progress: 40 }, loaded0700[1]];
  const echoed = stampFieldEdits(loaded0700, sent, '2026-09-17T11:00:00.000Z');
  const afterEcho = screenTakes(echoed, sent, false);
  ok('this screen\'s own write coming back stamped is absorbed with its stamp', afterEcho[0].progress === 40 && !!stamps(afterEcho[0]).progress);
}
{
  // This device's own stamp is not someone else's newer write.
  const COPY = [t({ id: 'o1', title: 'Framing' })];
  const first = stampFieldEdits(COPY, [{ ...COPY[0], progress: 50 }], '2026-09-17T12:00:00.000Z');
  // The screen copy never got the stamp (no echo yet) — his second change:
  const second = [{ ...COPY[0], progress: 70 }];
  ok('a second change to the same task from a copy that missed his OWN stamp is not refused',
    staleFieldEdits(first, second).length === 0 && stampFieldEdits(first, second, '2026-09-17T12:05:00.000Z')[0].progress === 70);
  ok('...nor is undoing his first change', stampFieldEdits(first, COPY, '2026-09-17T12:06:00.000Z')[0].progress === 0);
  const foreign = [t({ id: 'o1', title: 'Framing', progress: 50, fieldEditedAt: { progress: '2026-09-17T12:00:00.001Z' } })];
  ok('...while a stamp someone else set still makes that copy stale', staleFieldEdits(foreign, second).length === 1);
}
{
  // Wiring in Schedule Pro.
  // Integration round 1: no rebase any more. A copy reaching project.schedule
  // from outside is taken WHOLE (utils/scheduleMerge.ts takeStoreScheduleCopy —
  // round 3: once the screen has no edit left to hand over; validate-schedule-
  // live-merge replays it).
  const effect = slice(PRO, 'useLiveSchedule(project?.id, onPeerSchedule, onLiveGap);', '}, [project?.schedule?.tasks, project?.schedule?.updatedAt, project?.schedule?.baselines]);');
  ok('Schedule Pro takes a copy reaching project.schedule from outside, whole, once it has no edit left to hand over',
    /takeStoreScheduleCopy\(gate, \{[\s\S]*\}, persistPendingRef\.current \|\| fieldSavesInFlightRef\.current > 0, settled\);\s*if \(copy\) adoptServerCopy\(copy, settled\);/.test(effect)
      && !/rebaseWorkingTasks/.test(PRO));
  ok('...and a save still waiting knows it is waiting',
    /persistPendingRef\.current = true;\s*persistTimer\.current = setTimeout\(\(\) => \{\s*persistPendingRef\.current = false;/.test(PRO));
  const row = slice(PRO, 'const saveAsRow = useCallback(', '}, [updateProjectRaw]);');
  ok('the owner/editor save asks which field values will be refused before it writes',
    /const refused = sentTasks \? staleFieldEdits\(keptTasks, sentTasks\) : \[\];\s*if \(stamp\) noteOwnScheduleSave\(syncGateRef\.current, stamp\);\s*updateProjectRaw\(id, updates\);/.test(row)
      && /onFieldRefusalsRef\.current\?\.\(refused, keptTasks, sentTasks\)/.test(row)
      && /writePath === 'row'\s*\? saveAsRow/.test(PRO));
  ok('...and the screen says so', /writePath === 'row' && fieldConflictNotice \?/.test(PRO) && /setFieldConflictNotice\(`\$\{title\}'s \$\{what\} was updated elsewhere — in the field or on another device — at/.test(PRO)
    && /useEffect\(\(\) => \{ setFieldConflictNotice\(null\); \}, \[projectId\]\);/.test(PRO));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nthe server rule (migration 20260917160000):');
{
  const trig = slice(MIG, 'create or replace function public.projects_keep_newer_field_progress()', '$$;');
  const keys = [...(/v_keys constant text\[\] := array\[([^\]]*)\]/.exec(trig)?.[1] ?? '').matchAll(/'([^']+)'/g)].map(m => m[1]).sort();
  ok('the trigger protects exactly FIELD_TASK_PATCH_KEYS', JSON.stringify(keys) === JSON.stringify([...FIELD_TASK_PATCH_KEYS].sort()), `sql=${keys}`);
  ok('...reads the same stamp key the client writes',
    trig.includes(`-> '${FIELD_EDIT_STAMPS}'`) && MIG.includes(`jsonb_build_object('${FIELD_EDIT_STAMPS}', v_stamps)`));
  ok('...keeps the stored value when the incoming stamp is missing or older',
    /if v_nts is null or v_nts < v_ots then/.test(trig) && /v_task := v_task \|\| jsonb_build_object\(v_k, v_old -> v_k\);/.test(trig));
  ok('...runs BEFORE UPDATE OF schedule for every row whose schedule changes',
    /create trigger projects_keep_newer_field_progress\s+before update of schedule on public\.projects\s+for each row\s+when \(NEW\.schedule is distinct from OLD\.schedule\)/.test(MIG));
  ok('...and is re-runnable (drop trigger if exists)', /drop trigger if exists projects_keep_newer_field_progress on public\.projects;/.test(MIG));
  ok('the RPC stamps what it writes, never earlier than the stored stamp',
    /greatest\(v_now, coalesce\(v_prev \+ interval '1 millisecond', v_now\)\)/.test(MIG));
  ok('a malformed stamp reads as none rather than failing the write',
    /create or replace function public\.schedule_field_stamp_ts\(p_stamp text\)[\s\S]*?exception when others then\s*return null;/.test(MIG));
  ok('the foreman cannot send a stamp (not in the RPC allowlist)', !/v_allowed constant text\[\] := array\[[^\]]*fieldEditedAt/.test(MIG));
  // Integration round 1: linear, not O(n²). Executed on PGlite with the real
  // file (scratchpad pgtest/trig_perf.mjs): 1000 tasks, owner upsert 193 → 31
  // ms, one-task RPC 309 → 14 ms, same results on every semantic case.
  ok('neither the trigger nor the RPC rebuilds the task array by appending one task at a time',
    !/v_new_tasks := v_new_tasks \|\| jsonb_build_array\(v_task\)/.test(MIG)
      && !/v_old_by_id := v_old_by_id \|\| jsonb_build_object/.test(MIG));
  ok('...the trigger rebuilds once, and only when it changed a task',
    /if v_fix <> '\{\}'::jsonb then\s*NEW\.schedule := jsonb_set\(NEW\.schedule, '\{tasks\}', \(\s*select jsonb_agg\(coalesce\(v_fix -> e\.ordinality::text, e\.value\) order by e\.ordinality\)/.test(trig));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nthe project sync sends the schedule only when the edit touched it:');
{
  ok('updateProject\'s keys without schedule → not sent', !projectSyncSendsSchedule(['status']));
  ok('with schedule → sent', projectSyncSendsSchedule(['schedule', 'status']));
  ok('a caller that says nothing → sent (old behaviour)', projectSyncSendsSchedule(undefined));
  ok('a status toggle replacing a pending schedule sync inside the debounce keeps the schedule', projectSyncSendsSchedule(['status'], true));

  const sync = slice(CTX, 'const syncProjectToSupabase = useCallback(', 'const flushPendingProjectSyncs = useCallback(');
  ok('syncProjectToSupabase takes the changed keys', /opts\?: \{ immediate\?: boolean; changedKeys\?: readonly string\[\] \}/.test(sync));
  ok('...inherits the schedule from a still-waiting sync it replaces',
    /const sendsSchedule = projectSyncSendsSchedule\(opts\?\.changedKeys, !!existing && !existing\.inFlight && existing\.sendsSchedule\);/.test(sync));
  ok('...the payload carries `schedule` only behind includeSchedule',
    /\.\.\.\(includeSchedule \? \{ schedule: project\.schedule as unknown \} : \{\}\),/.test(sync)
      && (sync.match(/schedule: project\.schedule/g) ?? []).length === 1, `schedule: project.schedule sites: ${(sync.match(/schedule: project\.schedule/g) ?? []).length}`);
  ok('...and an owner upsert still sends it when the server may not hold the row yet',
    /const includeSchedule = ownerUpsertCarriesSchedule\(sendsSchedule, shared, serverProjectIdsRef\.current\.has\(project\.id\)\);/.test(sync)
      && /serverProjectIdsRef\.current = new Set\(remoteIds\);/.test(CTX));

  const upd = slice(CTX, 'const updateProject = useCallback(', '// deleteProject is defined further down');
  ok('updateProject passes its own keys to the sync', /syncProjectToSupabase\(proj, 'upsert', \{ changedKeys: Object\.keys\(rawUpdates\) \}\);/.test(upd));
  ok('...and runs every schedule edit through stampFieldEdits against the live copy',
    /stampFieldEdits\(prior\?\.schedule\?\.tasks, rawUpdates\.schedule\.tasks, nowISO\)/.test(upd) && /const prior = base\.find\(p => p\.id === id\);/.test(upd));
  ok('the geocode write carries coordinates only',
    /syncProjectToSupabase\(updated, 'upsert', \{ changedKeys: \['locationLatitude', 'locationLongitude', 'locationGeocodedAt'\] \}\)/.test(CTX));
  ok('the change-order reflow (a schedule write built from the render) is stamped against the live ref',
    /const nextSchedule = \{ \.\.\.result\.nextSchedule, tasks: stampFieldEdits\(liveTasks, result\.nextSchedule\.tasks, now\) \};/.test(CTX));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nthe GC sees field progress before he edits (foreground refetch):');
{
  const fnSrc = slice(HOOK, 'export function shouldRefetchOnForeground(', '\nexport function useProjectsFocusRefetch');
  const constSrc = /export const FOREGROUND_REFETCH_MIN_GAP_MS = [^;]+;/.exec(HOOK)?.[0] ?? '';
  type Should = (prev: string | null, next: string, last: number | null, now: number) => boolean;
  let should = null as Should | null;
  try {
    const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(`${constSrc}\n${fnSrc}`).replace(/export /g, '');
    should = new Function(`${js}\nreturn shouldRefetchOnForeground;`)() as Should;
  } catch (e) { ok('the foreground decision transpiles', false, String(e)); }
  if (should) {
    ok('background → active refetches', should('background', 'active', null, 1_000_000));
    ok('inactive → active refetches', should('inactive', 'active', null, 1_000_000));
    ok('active → active does not (no transition)', !should('active', 'active', null, 1_000_000));
    ok('going to the background does not', !should('active', 'background', null, 1_000_000));
    ok('twice inside the window does not', !should('background', 'active', 1_000_000 - 5_000, 1_000_000));
    ok('after the window does', should('background', 'active', 1_000_000 - 60_000, 1_000_000));
  }
  ok('the hook listens to AppState', /AppState\.addEventListener\('change'/.test(HOOK) && /sub\.remove\(\)/.test(HOOK));
  const body = slice(CTX, 'const refetchProjectsOnForeground = useCallback(', 'useProjectsFocusRefetch(canSync, refetchProjectsOnForeground);');
  ok('ProjectContext mounts it for a syncing account', CTX.includes('useProjectsFocusRefetch(canSync, refetchProjectsOnForeground);'));
  // Executed: the callback's own arrow function, with the flush, the queue and
  // the query client stubbed. A write already on the wire stays in the map
  // (A-8) and is in neither the flush's list nor the queue.
  const fnText = slice(body, 'const refetchProjectsOnForeground = useCallback(', '}, [flushPendingProjectSyncs');
  type Refetch = () => Promise<void>;
  const make = (mapSize: number, queued: number, calls: string[]) => {
    const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(`const __f = ${fnText.replace('const refetchProjectsOnForeground = useCallback(', '')}};`);
    return new Function('flushPendingProjectSyncs', 'syncDebounceMap', 'inFlightProjectSyncsRef', 'unconfirmedProjectSyncIds', 'ownQueuedProjectIds', 'queryClient', 'userId', 'projectsReloadOwedRef', `${js}\nreturn __f;`)(
      async () => { calls.push('flush'); },
      { current: new Map(Array.from({ length: mapSize }, (_, i) => [`p${i}`, { inFlight: true }])) },
      { current: new Map() },
      unconfirmedProjectSyncIds,
      async () => new Set(Array.from({ length: queued }, (_, i) => `q${i}`)),
      { invalidateQueries: async () => { calls.push('invalidate'); } },
      'u1',
      { current: false },
    ) as Refetch;
  };
  try {
    const idle: string[] = []; await make(0, 0, idle)();
    ok('...executed: nothing pending → flush, then refetch', idle.join() === 'flush,invalidate', idle.join());
    const onWire: string[] = []; await make(1, 0, onWire)();
    ok('...executed: a project write still on the wire → no refetch over it', onWire.join() === 'flush', onWire.join());
    const queuedRun: string[] = []; await make(0, 1, queuedRun)();
    ok('...executed: a queued projects write → no refetch', queuedRun.join() === 'flush', queuedRun.join());
  } catch (e) { ok('refetchProjectsOnForeground transpiles', false, String(e)); }
  ok('...flushing pending syncs first, and skipping while a projects write is still queued',
    body.indexOf('await flushPendingProjectSyncs();') >= 0
      && body.indexOf('await flushPendingProjectSyncs();') < body.indexOf('if (unconfirmedProjectSyncIds(syncDebounceMap.current, inFlightProjectSyncsRef.current).size > 0) {')
      && body.indexOf('if (unconfirmedProjectSyncIds(syncDebounceMap.current, inFlightProjectSyncsRef.current).size > 0) {') < body.indexOf("invalidateQueries({ queryKey: ['projects', userId] })")
      && body.indexOf('await flushPendingProjectSyncs();') < body.indexOf('if ((await ownQueuedProjectIds(userId)).size > 0) {')
      && body.indexOf('if ((await ownQueuedProjectIds(userId)).size > 0) {') < body.indexOf("invalidateQueries({ queryKey: ['projects', userId] })"));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nlegacy day-0 tasks on the field path:');
{
  const start = '2026-09-01';
  const today = todayScheduleDay(start, new Date(2026, 8, 17, 12))!;
  const legacy = { status: 'not_started' as const, startDay: 0 };
  const stamp = stampActuals(legacy, 'done', today, '2026-09-17T19:00:00.000Z');
  ok('done from not started on a 0-indexed task stamps a start of day 1, never 0', stamp.actualStartDay === 1, JSON.stringify(stamp));
  const d = fieldTaskDiff([t({ id: 'l', startDay: 0 })], [t({ id: 'l', startDay: 0, status: 'done', ...stamp })]);
  const sent = d.patches[0] as Record<string, unknown> | undefined;
  ok('...so the field patch carries only day numbers the RPC accepts (≥ 1)',
    !!sent && ['actualStartDay', 'actualEndDay'].every(k => sent[k] == null || (Number(sent[k]) >= 1 && Number.isInteger(sent[k]))), JSON.stringify(sent));
  ok('a normal task still retro-stamps its planned start', stampActuals({ status: 'not_started', startDay: 5 }, 'done', 17, 'x').actualStartDay === 5);
  ok('...capped at today', stampActuals({ status: 'not_started', startDay: 30 }, 'done', 17, 'x').actualStartDay === 17);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\na punch item raised from someone else\'s gallery photo:');
{
  const body = slice(CTX, 'const stagePunchPhoto = useCallback(', '// Snake/camel mapping for the punch_items insert payload');
  ok('takes the source photo\'s durable storage path instead of keeping its 24 h signed URL',
    /if \(!item\.photoStoragePath && item\.sourcePhotoId\) \{\s*const source = projectPhotosRef\.current\.find\(p => p\.id === item\.sourcePhotoId\);\s*if \(source\?\.storagePath\) return \{ \.\.\.item, photoStoragePath: source\.storagePath \};/.test(body));
  // Executed, not just read: the callback's own arrow function, with the
  // gallery and the upload queue stubbed.
  const fnText = slice(body, '(item: PunchItem): PunchItem => {', '}, [userId]);');
  type Item = { id: string; projectId: string; photoUri?: string; photoStoragePath?: string; photoLocalUri?: string; sourcePhotoId?: string };
  type Stage = (item: Item) => Item;
  let stage = null as Stage | null;
  try {
    const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(`const __f = ${fnText}};`);
    stage = new Function('isDeviceLocalUri', 'projectPhotosRef', 'stagePhotoUpload', 'userId', `${js}\nreturn __f;`)(
      (u: string) => u.startsWith('file://'),
      { current: [{ id: 'ph1', storagePath: 'u1/p1/ph1.jpg', uri: 'https://x/sign/ph1?token=24h' }] },
      () => 'u1/p1/punch-local.jpg',
      'u1',
    ) as Stage;
  } catch (e) { ok('stagePunchPhoto transpiles', false, String(e)); }
  if (stage) {
    const fromGallery = stage({ id: 'k1', projectId: 'p1', photoUri: 'https://x/sign/ph1?token=24h', sourcePhotoId: 'ph1' });
    ok('...executed: an office punch from a field photo gets the durable path', fromGallery.photoStoragePath === 'u1/p1/ph1.jpg', JSON.stringify(fromGallery));
    const noSource = stage({ id: 'k2', projectId: 'p1', photoUri: 'https://x/other.jpg' });
    ok('...executed: a remote photo with no source is left alone', noSource.photoStoragePath === undefined);
    const local = stage({ id: 'k3', projectId: 'p1', photoUri: 'file:///tmp/a.jpg' });
    ok('...executed: a device photo is still staged for upload', local.photoStoragePath === 'u1/p1/punch-local.jpg' && local.photoLocalUri === 'file:///tmp/a.jpg');
  }
  ok('...reading the live gallery ref', /const projectPhotosRef = useRef<ProjectPhoto\[\]>\(\[\]\);\s*useEffect\(\(\) => \{ projectPhotosRef\.current = projectPhotos; \}, \[projectPhotos\]\);/.test(CTX));
  ok('the row writer prefers that path over the URL', /photo_uri: durablePhotoValue\(item\.photoStoragePath, item\.photoUri\) \|\| null,/.test(CTX));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nrealtime reaches the stamping base, not only the screen (integration round 1):');
{
  const S1 = '2026-09-18T10:00:00.000Z'; // foreman's 60 — absorbed by the GC's tab
  const S2 = '2026-09-18T10:05:00.000Z'; // foreman's 80 — landed, not absorbed yet
  const NOW = '2026-09-18T10:06:00.000Z';
  const server0 = [t({ id: 't1', title: 'Framing' }), t({ id: 't2', title: 'Drywall', startDay: 15 })];
  const echo60 = [t({ id: 't1', title: 'Framing', progress: 60, fieldEditedAt: { progress: S1 } }), t({ id: 't2', title: 'Drywall', startDay: 15 })];
  // The screen's working copy after onPeerSchedule's merge, then the GC drags Drywall.
  // (Adopted whole — the screen was quiet — then he drags.)
  const hist = echo60.map(x => x.id === 't2' ? { ...x, startDay: 18 } : x);
  // The server's trigger, reduced to the one key: the incoming stamp must be
  // newer than the stored one for the incoming value to land.
  const serverKeeps = (payload: ScheduleTask[]) => {
    const p1 = payload.find(x => x.id === 't1')!;
    const inMs = Date.parse(stamps(p1).progress ?? '') || -1;
    return inMs < Date.parse(S2) ? 80 : p1.progress;
  };
  const staleBase = stampFieldEdits(server0, hist, NOW);
  ok('control — the base the screen never fed: the GC\'s drag mints an owner stamp for t1 and the foreman\'s 80 is reverted',
    serverKeeps(staleBase) === 60, `server t1=${serverKeeps(staleBase)} stamp=${stamps(staleBase[0]).progress}`);
  const absorbed = absorbServerScheduleTasks(server0, echo60, server0);
  ok('absorbServerScheduleTasks brings the absorbed 60 and its stamp into the base', absorbed[0].progress === 60 && stamps(absorbed[0]).progress === S1);
  const payload = stampFieldEdits(absorbed, hist, NOW);
  ok('a GC edit to ANOTHER task then mints no stamp for t1 (it carries the foreman\'s)', stamps(payload[0]).progress === S1, JSON.stringify(stamps(payload[0])));
  ok('...so the server keeps the foreman\'s 80', serverKeeps(payload) === 80);
  ok('...and the GC\'s drag still goes', payload[1].startDay === 18);

  // An older echo arriving after a newer value is already in the base.
  const newer = [t({ id: 't1', title: 'Framing', progress: 80, fieldEditedAt: { progress: S2 } })];
  const late = absorbServerScheduleTasks(newer, [t({ id: 't1', title: 'Framing', progress: 60, fieldEditedAt: { progress: S1 } })], newer);
  ok('an older echo cannot take a field value back (newer stamp wins)', late[0].progress === 80 && stamps(late[0]).progress === S2);
  // A pending local edit of a non-field key survives a peer event that did not touch it.
  const pendingLocal = [t({ id: 't1', title: 'Framing', startDay: 9 })];
  const kept = absorbServerScheduleTasks([t({ id: 't1', title: 'Framing', startDay: 5 })],
    [t({ id: 't1', title: 'Framing', startDay: 5, progress: 60, fieldEditedAt: { progress: S1 } })], pendingLocal);
  ok('this device\'s pending date edit is kept while the peer\'s progress comes in', kept[0].startDay === 9 && kept[0].progress === 60);
  const peerMoved = absorbServerScheduleTasks(server0, [server0[0], t({ id: 't2', title: 'Drywall', startDay: 18 })], server0);
  ok('a key only the peer changed is taken', peerMoved[1].startDay === 18);
  const structure = absorbServerScheduleTasks(
    [t({ id: 'a' }), t({ id: 'gone' })],
    [t({ id: 'a' }), t({ id: 'new' })],
    [t({ id: 'a' }), t({ id: 'gone' }), t({ id: 'mine' })],
  );
  ok('server-added in, server-deleted (unedited) out, locally added kept', structure.map(x => x.id).join() === 'a,new,mine', structure.map(x => x.id).join());

  // Field path: a task only the peer (the GC) changed is never reported blocked.
  const fServer0 = [t({ id: 'f', title: 'Framing' }), t({ id: 'd', title: 'Drywall', startDay: 15 })];
  const fIncoming = [t({ id: 'f', title: 'Framing' }), t({ id: 'd', title: 'Drywall', startDay: 18 })];
  const fHist = fIncoming.map(x => x.id === 'f' ? { ...x, progress: 40 } : x);
  const staleDiff = fieldTaskDiff(fServer0, fHist);
  ok('control — diffed against the unfed base, Drywall reads as the foreman\'s blocked edit', staleDiff.blocked.join() === 'Drywall');
  const fBase = absorbServerScheduleTasks(fServer0, fIncoming, fServer0);
  const d = fieldTaskDiff(fBase, fHist);
  ok('diffed against the fed base: nothing blocked, only his progress is sent', d.blocked.length === 0 && d.patches.length === 1 && d.patches[0].id === 'f', JSON.stringify(d));
  ok('...and the reset copy keeps the GC\'s move', applyFieldTaskPatches(fBase, d.patches).find(x => x.id === 'd')?.startDay === 18);

  const adoptFn = slice(PRO, 'const adoptServerCopy = useCallback(', '}, [livePeerProjectId, absorbServerSchedule]);');
  ok('every server copy the screen adopts reaches ProjectContext (with its stamp), so owner saves are stamped against it',
    /absorbServerSchedule\(livePeerProjectId, copy\.tasks, \{ stamp: copy\.stamp \}\)/.test(adoptFn));
  const peer = slice(PRO, 'const onPeerSchedule = useCallback(', 'useLiveSchedule(project?.id, onPeerSchedule, onLiveGap);');
  ok('a realtime echo is taken only through the gate — never merged into a save still waiting (it is busy then)',
    /takeScheduleCopy\(syncGateRef\.current, incoming, 'echo', syncBusy\(\)\)/.test(peer) && !/schedulePersist/.test(peer));
  const abs = slice(CTX, 'const absorbServerSchedule = useCallback(', 'const saveChangeOrdersMutation = useMutation(');
  ok('ProjectContext.absorbServerSchedule merges with absorbServerScheduleTasks into projectsRef, locally only',
    /absorbServerScheduleTasks\(prevServer, tasks, localTasks\)/.test(abs) && /projectsRef\.current = updated;/.test(abs)
      && !/syncProjectToSupabase/.test(abs) && !/\.\.\.x, updatedAt|updatedAt: nowISO/.test(abs));
  ok('...and is exposed on the stable actions', /absorbServerSchedule,\n    isProjectSyncUnconfirmed,\n    onProjectSyncSettled,\n  \}\), \[completeOnboarding, setUserRole, flushPendingProjectSyncs, writePortalMessage, absorbServerSchedule, isProjectSyncUnconfirmed, onProjectSyncSettled\]\);/.test(CTX));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\na load in flight does not undo a write made meanwhile (integration round 1):');
{
  const log = newProjectWriteLog();
  noteProjectWrite(log, 'p1');
  const since = log.seq; // the load starts here
  const edited = [t({ id: 'x', startDay: 9 })];
  const pre = [t({ id: 'x', startDay: 5 })];
  type P = { id: string; name: string; tasks: ScheduleTask[] };
  const loaded: P[] = [{ id: 'p1', name: 'A', tasks: pre }, { id: 'p2', name: 'server-new-name', tasks: [] }, { id: 'p4', name: 'D', tasks: [] }];
  // During the load: the drag on p1, a project created, one deleted.
  noteProjectWrite(log, 'p1');
  noteProjectWrite(log, 'p3');
  noteProjectWrite(log, 'p4');
  const local: P[] = [{ id: 'p3', name: 'C', tasks: [] }, { id: 'p1', name: 'A', tasks: edited }, { id: 'p2', name: 'B', tasks: [] }];
  const out = keepProjectsWrittenSince(loaded, local, log, since);
  ok('the project written during the load keeps the device copy', out.find(p => p.id === 'p1')?.tasks[0].startDay === 9);
  ok('an untouched project takes the server\'s', out.find(p => p.id === 'p2')?.name === 'server-new-name');
  ok('one created meanwhile stays, one deleted meanwhile stays deleted', out.map(p => p.id).join() === 'p3,p1,p2', out.map(p => p.id).join());
  ok('nothing written since → the load as it came', keepProjectsWrittenSince(loaded, local, log, log.seq).map(p => p.name).join() === 'A,server-new-name,D');
  // End to end on Schedule Pro: the load lands as an OUTSIDE copy once the
  // screen is quiet (his drag saved and reported), and is taken whole.
  const guarded = out.find(p => p.id === 'p1')!.tasks;
  ok('...so the screen, taking the guarded load whole, keeps the drag', screenTakes(guarded, edited, false)[0].startDay === 9);
  ok('control — unguarded, the screen took the pre-drag row', screenTakes(pre, edited, false)[0].startDay === 5);

  const qf = slice(CTX, "queryKey: ['projects', userId],", 'const settingsQuery = useQuery({');
  ok('the loader takes its sequence number before the first read',
    qf.indexOf('const writeSeqAtStart = projectWriteLogRef.current.seq;') >= 0
      && qf.indexOf('const writeSeqAtStart = projectWriteLogRef.current.seq;') < qf.indexOf(".from('projects')"));
  ok('...and guards the result BEFORE caching it',
    /const plan = planProjectsLoad\(\s*\[\.\.\.mapped, \.\.\.localForMerge\.filter\(\(p\) => !remoteIds\.has\(p\.id\)\)\],\s*planLocal, projectWriteLogRef\.current, writeSeqAtStart,\s*\{ pending: pendingAtStart, fold: foldServerSchedule<Project>\(baseAtStart\) \},\s*\);\s*const merged = plan\.projects;/.test(qf)
      && qf.indexOf('planProjectsLoad(') < qf.indexOf('await saveLocal(PROJECTS_KEY, merged);'));
  ok('`projects` takes the result through the same guard',
    /const plan = planProjectsLoad\(projectsQuery\.data, local, projectWriteLogRef\.current, projectsLoadSinceRef\.current, \{\s*pending: projectsLoadPendingRef\.current,[\s\S]{0,200}?\}\);\s*setProjects\(plan\.projects\);/.test(CTX)
      && !/if \(projectsQuery\.data\) setProjects\(projectsQuery\.data\);/.test(CTX));
  const sync = slice(CTX, 'const syncProjectToSupabase = useCallback(', 'const existing = syncDebounceMap.current.get(project.id);');
  ok('every synced project write records itself', /noteProjectWrite\(projectWriteLogRef\.current, project\.id\);\s*if \(!canSync\) return;/.test(sync));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
