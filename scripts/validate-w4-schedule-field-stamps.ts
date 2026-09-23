// validate-w4-schedule-field-stamps.ts — wave 4, lane schedule: #87 and #89.
// Run via: bun run scripts/validate-w4-schedule-field-stamps.ts
//
// #87 — a foreman's re-sent update was thrown away with "it was changed
// elsewhere while you had no signal" when nobody else touched the task. The
// field RPC stamped each key with the SERVER clock but answered only
// {applied, missing}; the phone copied the values, never the stamp, and a
// retry (which re-sends a key only while the server's value AND stamp are what
// the phone held) found the stamps different. Now the RPC answers the stamps
// it wrote (migration 20260920160000), applyFieldTaskPatches merges them, and
// stampFieldEdits keeps them instead of minting a device-clock stamp over them.
// Replayed end to end below: send ok → send fails offline → retry against a
// server row stamped by the RPC → the key is re-sent. The GC-changed-it-and-
// back case the stamp check exists for is still refused.
//
// #89 — Quick Field Update and the mic recorded no actual DAY numbers, so
// Schedule Pro's Reflow from actuals, the Gantt's buttons/badges, bring-up-to-
// date and prediction grading ignored his report. Both writers now stamp
// through stampActuals, and the readers accept a date-only actual
// (actualCalendarDay) for the rows the old code wrote.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  applyFieldTaskPatches, captureFieldSendFailure, FIELD_EDIT_STAMPS, parseWrittenStamps, planFieldRetry,
  sendFieldTaskPatches, stampFieldEdits, type FieldTaskPatch,
} from '../utils/fieldScheduleUpdate';
import { actualCalendarDay, planCatchUpToToday, reflowFromActuals } from '../utils/scheduleOps';
import type { ScheduleTask } from '../types';

let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`PASS  ${label}`); }
  else { fail++; console.log(`FAIL  ${label} ${detail}`); }
}
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const task = (over: Partial<ScheduleTask> & { id: string }): ScheduleTask => ({
  title: over.id, phase: 'General', durationDays: 5, startDay: 1, dependencies: [], crew: '', crewSize: 1,
  notes: '', status: 'not_started', progress: 0, ...over,
} as ScheduleTask);
const stampsOf = (t: ScheduleTask | undefined) => ((t as unknown as Record<string, unknown> | undefined)?.[FIELD_EDIT_STAMPS] ?? {}) as Record<string, string>;

// ── A fake server: the RPC's merge and per-key server-clock stamp ──────────
function fakeServer(initial: ScheduleTask[], answersStamps: boolean) {
  let tasks = initial.map(t => ({ ...t }));
  let clock = Date.parse('2026-09-20T10:00:00.000Z');
  const client = {
    online: true,
    rpc: async (_fn: string, args: Record<string, unknown>) => {
      if (!client.online) throw new TypeError('Network request failed');
      const patches = args.p_task_patches as FieldTaskPatch[];
      const written: Record<string, Record<string, string>> = {};
      const missing: string[] = [];
      for (const p of patches) {
        const i = tasks.findIndex(t => t.id === p.id);
        if (i < 0) { missing.push(p.id); continue; }
        const { id, ...rest } = p;
        clock += 1000;
        const st = new Date(clock).toISOString();
        const stamps = { ...stampsOf(tasks[i]) };
        const next = { ...(tasks[i] as unknown as Record<string, unknown>) };
        for (const [k, v] of Object.entries(rest)) { if (v === null) delete next[k]; else next[k] = v; stamps[k] = st; }
        written[id] = Object.fromEntries(Object.keys(rest).map(k => [k, st]));
        next[FIELD_EDIT_STAMPS] = stamps;
        tasks[i] = next as unknown as ScheduleTask;
      }
      return { data: answersStamps ? { applied: [], missing, stamps: written } : { applied: [], missing }, error: null };
    },
    read: async () => tasks.map(t => ({ ...t })),
    gcEdit: (id: string, key: string, value: unknown) => {
      clock += 1000;
      tasks = tasks.map(t => t.id !== id ? t : ({ ...t, [key]: value, [FIELD_EDIT_STAMPS]: { ...stampsOf(t), [key]: new Date(clock).toISOString() } } as unknown as ScheduleTask));
    },
  };
  return client;
}

// The phone's shared copy, updated the way updateProject does it: stampFieldEdits
// against the previous copy (ProjectContext.updateProject), device clock "now".
async function foremanScenario(answersStamps: boolean, gcTouches: boolean) {
  const server = fakeServer([task({ id: 'fr', title: 'Framing', progress: 0 })], answersStamps);
  let local = await server.read();
  const deviceNow = () => '2026-09-20T09:00:00.000Z'; // a phone clock behind the server's
  // 1) 40% lands; the realtime echo is lost (patchy signal).
  const p1: FieldTaskPatch[] = [{ id: 'fr', progress: 40 }];
  const r1 = await sendFieldTaskPatches(server, 'p', p1);
  if (!r1.ok) throw new Error('first send should land');
  local = stampFieldEdits(local, applyFieldTaskPatches(local, p1, r1.stamps), deviceNow());
  if (gcTouches) { server.gcEdit('fr', 'progress', 80); server.gcEdit('fr', 'progress', 40); }
  // 2) basement: 60% fails offline, captured from the local copy.
  server.online = false;
  const p2: FieldTaskPatch[] = [{ id: 'fr', progress: 60 }];
  const r2 = await sendFieldTaskPatches(server, 'p', p2);
  if (r2.ok) throw new Error('offline send should fail');
  const failure = captureFieldSendFailure('p', local, p2, r2);
  // 3) signal back: retry reads the row first.
  server.online = true;
  const plan = await planFieldRetry(failure, server.read);
  return { plan, local, r1 };
}

void (async () => {
  // ── #87 ────────────────────────────────────────────────────────────────
  const withStamps = await foremanScenario(true, false);
  check('#87 send answers the stamps the server wrote', !!withStamps.r1.ok && withStamps.r1.ok && typeof (withStamps.r1 as { stamps: Record<string, Record<string, string>> }).stamps.fr?.progress === 'string');
  check('#87 local copy holds the server stamp after a landed send (not a device-clock restamp)',
    stampsOf(withStamps.local[0]).progress === (withStamps.r1 as { stamps: Record<string, Record<string, string>> }).stamps.fr.progress,
    JSON.stringify(stampsOf(withStamps.local[0])));
  check('#87 retry after a later failed send re-sends his 60% (nobody else touched it)',
    withStamps.plan.read && withStamps.plan.patches.length === 1 && withStamps.plan.patches[0].progress === 60 && withStamps.plan.superseded.length === 0,
    JSON.stringify(withStamps.plan));
  // Control: the shipped behaviour (no stamps answered) drops it — the bug.
  const control = await foremanScenario(false, false);
  check('#87 control: without the RPC stamps the same retry is dropped as "changed elsewhere"',
    control.plan.read && control.plan.patches.length === 0 && control.plan.superseded.length === 1, JSON.stringify(control.plan));
  // Kept: the GC changed it and back (80 → 40) with newer stamps — refused.
  const gc = await foremanScenario(true, true);
  check('#87 GC changed the value and back meanwhile → still not re-sent (stamp check kept)',
    gc.plan.read && gc.plan.patches.length === 0 && gc.plan.superseded.length === 1, JSON.stringify(gc.plan));
  // A server without the migration answers no stamps → {} and nothing breaks.
  check('#87 parseWrittenStamps: absent / junk → {}', JSON.stringify(parseWrittenStamps(undefined)) === '{}'
    && JSON.stringify(parseWrittenStamps({ t: { progress: 'nope', startDay: '2026-01-01T00:00:00Z' } })) === '{}');
  check('#87 parseWrittenStamps keeps only field keys with real times',
    JSON.stringify(parseWrittenStamps({ t: { progress: '2026-09-20T10:00:00.000Z', title: '2026-09-20T10:00:00.000Z' } })) === '{"t":{"progress":"2026-09-20T10:00:00.000Z"}}');
  // An RPC stamp is kept only for the exact value it stamped: a later OWNER
  // edit of that task on a copy carrying it is a new edit and gets a new stamp.
  {
    const base = [task({ id: 'x', progress: 0 })];
    const applied = applyFieldTaskPatches(base, [{ id: 'x', progress: 30 }], { x: { progress: '2026-09-20T11:00:00.000Z' } });
    const kept = stampFieldEdits(base, applied, '2026-09-20T09:00:00.000Z');
    check('#87 stampFieldEdits keeps the RPC stamp for the value it wrote', stampsOf(kept[0]).progress === '2026-09-20T11:00:00.000Z');
    const edited = stampFieldEdits(applied, [{ ...applied[0], progress: 55 }], '2026-09-20T09:00:00.000Z');
    check('#87 a further edit of that task still mints a newer stamp', Date.parse(stampsOf(edited[0]).progress) > Date.parse('2026-09-20T11:00:00.000Z'));
  }
  // Every caller passes the stamps through.
  const callers: [string, RegExp][] = [
    ['components/schedule/mobile/MobileScheduleScreen.tsx', /accepted = applyFieldTaskPatches\(baseTasks, patches\);\s*(\/\/[^\n]*\n\s*)*accepted = mergeWrittenStamps\(accepted, sent\.stamps\);/],
    ['app/schedule-pro.tsx', /accepted = applyFieldTaskPatches\(baseTasks, patches\);\s*(\/\/[^\n]*\n\s*)*accepted = mergeWrittenStamps\(accepted, sent\.stamps\);/],
    ['components/QuickFieldUpdate.tsx', /mergeWrittenStamps\(applyFieldTaskPatches\(tasks, \[fieldPatch\]\), sent\.stamps\)/],
    ['components/UniversalMicButton.tsx', /mergeWrittenStamps\(applyFieldTaskPatches\(schedule\.tasks, patches\), sent\.stamps\)/],
  ];
  for (const [f, re] of callers) check(`#87 ${f} merges the returned stamps`, re.test(src(f)));
  const mig = src('supabase/migrations/20260920160000_field_update_returns_stamps.sql');
  check('#87 migration answers stamps and keeps the signature + grants',
    /'stamps', v_written/.test(mig) && /create or replace function public\.field_update_schedule_tasks\(\s*p_project_id uuid,\s*p_task_patches jsonb\s*\)/.test(mig)
    && /grant execute on function public\.field_update_schedule_tasks\(uuid, jsonb\) to authenticated/.test(mig)
    && /revoke all on function public\.field_update_schedule_tasks\(uuid, jsonb\) from public, anon/.test(mig));
  // Integration round 2: the SECURITY INVOKER trigger projects_keep_newer_field_
  // progress calls schedule_field_stamp_ts as the caller; production's default
  // function ACL gave it to service_role only, so every schedule save of a job
  // with one stamped task was refused 42501. Executed on the production-ACL
  // PGlite harness (owner edit #2 fails without this grant).
  check('schedule_field_stamp_ts is executable by authenticated (the invoker trigger calls it) and not by anon',
    /grant execute on function public\.schedule_field_stamp_ts\(text\) to authenticated, service_role;/.test(mig)
    && /revoke all on function public\.schedule_field_stamp_ts\(text\) from public, anon;/.test(mig));

  // ── #89 ────────────────────────────────────────────────────────────────
  const qfu = src('components/QuickFieldUpdate.tsx');
  check('#89 Quick Field Update stamps actuals through stampActuals on a status change',
    /if \(patch\.status && patch\.status !== task\.status\) \{\s*Object\.assign\(patch, stampActuals\(task, patch\.status, todayScheduleDay\(schedule\.startDate\), new Date\(\)\.toISOString\(\), \{ retroStartFromPlanned: false \}\)\);/.test(qfu));
  check('#89 Quick Field Update no longer hand-writes actualEndDate / actualStartDate',
    !/patch\.actualEndDate = /.test(qfu) && !/patch\.actualStartDate = /.test(qfu));
  const mic = src('components/UniversalMicButton.tsx');
  check('#89 the mic stamps actuals and sends them to the field RPC',
    /stampActuals\(t, status, todayScheduleDay\(schedule\.startDate\), now, \{ retroStartFromPlanned: false \}\)/.test(mic)
    && /for \(const k of \['actualStartDate', 'actualEndDate', 'actualStartDay', 'actualEndDay'\] as const\)/.test(mic));
  // Readers: a date-only finish (what the old Quick Field Update wrote).
  const anchor = '2026-09-07'; // a Monday
  const finishedIso = new Date(2026, 8, 11, 15, 30).toISOString(); // local Fri Sep 11 → calendar day 5
  check('#89 actualCalendarDay reads a date-only finish on the anchor', actualCalendarDay({ actualEndDate: finishedIso }, 'end', anchor) === 5);
  check('#89 actualCalendarDay prefers the day number', actualCalendarDay({ actualEndDay: 9, actualEndDate: finishedIso }, 'end', anchor) === 9);
  check('#89 actualCalendarDay: no anchor → no invented day', actualCalendarDay({ actualEndDate: finishedIso }, 'end', undefined) === null);
  const a = task({ id: 'a', title: 'Framing', startDay: 1, durationDays: 2, status: 'done', progress: 100, actualEndDate: finishedIso });
  const b = task({ id: 'b', title: 'Drywall', startDay: 3, durationDays: 2, dependencies: ['a'], dependencyLinks: [{ taskId: 'a', type: 'FS', lagDays: 0 }] });
  const cal = { scheduleStartDate: anchor, workingDaysPerWeek: 7 };
  const reflowed = reflowFromActuals([a, b], cal);
  check('#89 Reflow from actuals cascades from a date-only finish (Drywall pushed to day 6)', reflowed[1].startDay === 6, JSON.stringify(reflowed.map(t => t.startDay)));
  check('#89 Reflow leaves the recorded task itself pinned', reflowed[0].startDay === 1);
  // Bring-up-to-date: running work is pinned — a crew already on site is not
  // pushed by a slipping predecessor. B was started (date-only, Tue = day 2)
  // from Quick Field Update; A slips to today (day 3). B must stay on day 4.
  const A = task({ id: 'A', title: 'Demo', startDay: 1, durationDays: 3, progress: 0 });
  const B = task({ id: 'B', title: 'Rough-in', startDay: 4, durationDays: 5, status: 'in_progress', progress: 10,
    dependencies: ['A'], dependencyLinks: [{ taskId: 'A', type: 'FS', lagDays: 0 }], actualStartDate: new Date(2026, 8, 8, 8).toISOString() });
  const catchUp = planCatchUpToToday([A, B], { todayCalendarIndex: 3, calendar: cal });
  check('#89 bring-up-to-date reads a date-only start as started (running work stays pinned)',
    catchUp.tasks[0].startDay === 3 && catchUp.tasks[1].startDay === 4, JSON.stringify(catchUp.tasks.map(t => t.startDay)));
  const pro = src('app/schedule-pro.tsx');
  check('#89 Schedule Pro Reflow counts date-only actuals', /actualCalendarDay\(t, 'start', summaryScale\.scheduleStartDate\) != null\s*\|\| actualCalendarDay\(t, 'end', summaryScale\.scheduleStartDate\) != null/.test(pro));
  const gantt = src('components/schedule/InteractiveGantt.tsx');
  check('#89 Gantt hides Start/Finish today when a date-only actual is recorded, badge reads it',
    /\{!startRecorded && \(/.test(gantt) && /\{!finishRecorded && \(/.test(gantt) && /!!bar\.task\.actualEndDate/.test(gantt)
    && !/bar\.task\.actualStartDay == null && \(/.test(gantt));
  const grade = src('utils/brain/gradePredictions.ts');
  check('#89 prediction grading reads date-only actuals', (grade.match(/actualCalendarDay\(/g) ?? []).length >= 4);

  console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `\nALL PASS (${pass})`);
  if (fail) process.exit(1);
})();
