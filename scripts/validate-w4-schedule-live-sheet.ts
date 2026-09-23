// validate-w4-schedule-live-sheet.ts — wave 4, lane schedule: #86, #88, #90, #91.
// Run via: bun run scripts/validate-w4-schedule-live-sheet.ts
//
// #86 — live updates carried the tasks but not the baseline list or the
//   active baseline id, so a baseline the GC locked on the web was deleted by
//   his next edit on the iPhone and the active one flipped back. Every live
//   path now reads the whole schedule (scheduleCopyFromRow — a missing
//   activeBaselineId key means CLEARED, because withActiveBaselineId deletes
//   it and payload.new is the whole row) and hands {stamp, baselines,
//   activeBaselineId} to absorbServerSchedule. The regression: a store at
//   [v1]/v1 that absorbs [v1,v2]/v2 with nothing pending, then saves through
//   mergeEditedSchedule, keeps [v1,v2]/v2.
// #88 — the phone task sheet printed the stored pin while the list row printed
//   the engine's pushed dates; its stepper stepped the pin.
// #90 — a field / viewer seat could build or replace a schedule in the wizard;
//   the server refused it silently.
// #91 — the web Schedule tab did not update live.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  absorbServerScheduleTasks, peerScheduleAdopt, scheduleCopyFromRow, scheduleWriteBlockedReason, SCHEDULE_NOT_SAVED_TITLE, SCHEDULE_WRITE_FIELD_REASON,
  SCHEDULE_WRITE_VIEWER_REASON, scheduleWritePathForRole,
} from '../utils/fieldScheduleUpdate';
import {
  heldByPredecessor, readActiveBaselineId, scheduledPlacements, scheduledStartOrdinal, scheduledTaskRange,
  steppedStartDay, withActiveBaselineId,
} from '../utils/scheduleOps';
import { mergeEditedSchedule } from '../utils/scheduleEngine';
import { runCpm } from '../utils/cpm';
import type { ProjectSchedule, ScheduleTask } from '../types';

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

// ── #86 ──────────────────────────────────────────────────────────────────
const v1 = { id: 'v1', name: 'Plan', capturedAt: '2026-09-01T00:00:00Z', tasks: [] };
const v2 = { id: 'v2', name: 'Re-plan', capturedAt: '2026-09-10T00:00:00Z', tasks: [] };
const rowV2 = { tasks: [task({ id: 't1' })], updatedAt: '2026-09-10T12:00:00.000Z', baselines: [v1, v2], activeBaselineId: 'v2' };
const copy = scheduleCopyFromRow(rowV2);
check('#86 the live copy carries baselines and activeBaselineId', !!copy && copy.activeBaselineId === 'v2' && copy.baselines?.length === 2 && copy.stamp === rowV2.updatedAt);
const cleared = scheduleCopyFromRow({ tasks: [], baselines: [v1] });
check('#86 a row with no activeBaselineId key reads as CLEARED (null), not unknown', cleared?.activeBaselineId === null);
check('#86 an older event without baselines leaves them undefined', scheduleCopyFromRow({ tasks: [] })?.baselines === undefined);
check('#86 no task list → no copy', scheduleCopyFromRow({ baselines: [] }) === null && scheduleCopyFromRow(null) === null);
// The regression, through the real helpers the store uses: absorb (whole —
// nothing pending) applies baselines + id via withActiveBaselineId, then the
// next phone save spreads the store copy through mergeEditedSchedule.
{
  const store: ProjectSchedule = withActiveBaselineId({ tasks: [task({ id: 't1' })], baselines: [v1] } as unknown as ProjectSchedule, 'v1');
  const absorbed = withActiveBaselineId({ ...store, tasks: copy!.tasks, updatedAt: copy!.stamp, baselines: copy!.baselines } as unknown as ProjectSchedule, copy!.activeBaselineId ?? undefined);
  const saved = mergeEditedSchedule(absorbed, { ...absorbed, tasks: [task({ id: 't1', progress: 10 })] } as ProjectSchedule);
  check('#86 regression: [v1]/v1 absorbs [v1,v2]/v2, the next save keeps [v1,v2]/v2',
    (saved.baselines ?? []).length === 2 && readActiveBaselineId(saved) === 'v2', JSON.stringify({ b: saved.baselines?.length, a: readActiveBaselineId(saved) }));
  const clearedAbsorb = withActiveBaselineId({ ...absorbed } as ProjectSchedule, cleared!.activeBaselineId ?? undefined);
  check('#86 a cleared id is removed from the store copy (key deleted)', !('activeBaselineId' in clearedAbsorb));
}
const phone = src('components/schedule/mobile/MobileScheduleScreen.tsx');
check('#86 phone onPeerSchedule hands peerScheduleAdopt(copy, queueBusyRef.current)',
  /absorbServerSchedule\(liveProjectId, copy\.tasks, peerScheduleAdopt\(copy, queueBusyRef\.current\)\)/.test(phone));
check('#86 phone onLiveGap reads the whole schedule and passes the same',
  /const fresh = liveScheduleCopyFromRow\(\(data as \{ schedule\?: unknown \} \| null\)\?\.schedule\);\s*if \(fresh\) absorbServerSchedule\(pid, fresh\.tasks, peerScheduleAdopt\(fresh, queueBusyRef\.current\)\);/.test(phone));
// Review round 1: a whole-copy adopt replaces the store's tasks, and
// ProjectContext guards it only against the debounce / in-flight maps — a
// write that answered 'queued' has left both. The phone must hold the adopt
// back while the project has a write in the offline queue.
check('#86 phone keeps a queue-busy ref: busy until read, busy while signalled, from projectWriteQueued',
  /const queueBusyRef = useRef\(true\);/.test(phone)
  && /queueBusyRef\.current = true;\s*void getOwnOfflineQueue\(\)/.test(phone)
  && /queueBusyRef\.current = projectWriteQueued\(queue, pid\);/.test(phone)
  && /onQueueChanged\(refresh\)/.test(phone));
{
  const c = scheduleCopyFromRow(rowV2)!;
  const a = peerScheduleAdopt(c, false);
  check('#86 nothing queued → the whole copy (stamp, baselines, active id)',
    !!a && a.stamp === c.stamp && a.baselines?.length === 2 && a.activeBaselineId === 'v2');
  check('#86 a queued offline write → no adopt (tasks-only 3-way merge)', peerScheduleAdopt(c, true) === undefined);
  // The case: he edited t1 with no signal (queued); a peer's copy arrives
  // before the flush, carrying the server's old t1. Modelled on
  // absorbServerSchedule: adopt → `next = tasks` (whole); none → the 3-way.
  const serverPrev = [task({ id: 't1', progress: 0 }), task({ id: 't2' })];
  const local = [task({ id: 't1', progress: 60, status: 'in_progress' }), task({ id: 't2' })];
  const incoming = [task({ id: 't1', progress: 0 }), task({ id: 't2', notes: 'peer' })];
  const absorb = (adopt: unknown) => adopt ? incoming : absorbServerScheduleTasks(serverPrev, incoming, local);
  const kept = absorb(peerScheduleAdopt({ ...c, tasks: incoming }, true));
  check('#86 queued offline write + peer copy → his local task edit kept, the peer change taken',
    kept.find(t => t.id === 't1')?.progress === 60 && kept.find(t => t.id === 't2')?.notes === 'peer', JSON.stringify(kept.map(t => [t.id, t.progress, t.notes])));
  const lost = absorb(peerScheduleAdopt({ ...c, tasks: incoming }, false));
  check('#86 control: the same copy taken whole would drop it (why the guard exists)', lost.find(t => t.id === 't1')?.progress === 0);
}
const hook = src('hooks/useLiveSchedule.ts');
check('#86 useLiveSchedule reads events through scheduleCopyFromRow', /liveScheduleCopyFromRow\(\(payload\.new as \{ schedule\?: unknown \} \| null\)\?\.schedule\)/.test(hook) && /export const liveScheduleCopyFromRow = scheduleCopyFromRow;/.test(hook));
const pro = src('app/schedule-pro.tsx');
check('#86 Schedule Pro adopts the active id with the copy and forwards it',
  /if \(copy\.activeBaselineId !== undefined\) \{\s*const nextId = copy\.activeBaselineId \?\? undefined;\s*if \(nextId !== activeBaselineIdRef\.current\) setActiveBaselineId\(nextId\);/.test(pro)
  && /\.\.\.\(copy\.activeBaselineId !== undefined \? \{ activeBaselineId: copy\.activeBaselineId \} : \{\}\)/.test(pro));
check('#86 Schedule Pro re-read uses the same reader', /answered\(error \? null : liveScheduleCopyFromRow\(/.test(pro));
check('#86 Schedule Pro store effect never overwrites an Activate waiting in the debounce',
  /if \(!switched && persistPendingRef\.current\) return;\s*setActiveBaselineId\(storedActiveBaselineId\);/.test(pro));
// Cross-lane (context-core, chain A): absorbServerSchedule must apply it. A
// NOTE, not a failure, until the JOIN — this lane does not own ProjectContext.
if (!/withActiveBaselineId/.test(src('contexts/ProjectContext.tsx').slice(src('contexts/ProjectContext.tsx').indexOf('const absorbServerSchedule = useCallback')))) {
  console.log('NOTE  #86 contexts/ProjectContext.tsx absorbServerSchedule does not apply adopt.activeBaselineId yet (context-core)');
}

// ── #88 ──────────────────────────────────────────────────────────────────
{
  const anchor = '2026-03-02'; // Monday
  const base = new Date(2026, 2, 2);
  const framing = task({ id: 'f', title: 'Framing', startDay: 1, durationDays: 10 });
  const drywall = task({ id: 'd', title: 'Drywall', startDay: 2, durationDays: 5, dependencies: ['f'], dependencyLinks: [{ taskId: 'f', type: 'FS', lagDays: 0 }] });
  const tasks = [framing, drywall];
  const cpm = runCpm(tasks, { scheduleStartDate: anchor, workingDaysPerWeek: 5 });
  const placements = scheduledPlacements(cpm, true);
  const cal = { scheduleStartDate: anchor, workingDaysPerWeek: 5 };
  const rowRange = scheduledTaskRange(drywall, placements.get('d'), base, 5);
  const ord = scheduledStartOrdinal(drywall, placements.get('d'), cal);
  check('#88 the scheduled start ordinal is the pushed one (day 11), not the pin (day 2)', ord === 11, String(ord));
  // What the sheet prints: the same call over the same placement.
  const sheetSrc = src('components/schedule/mobile/TaskDetailSheet.tsx');
  check('#88 the sheet computes its range with scheduledTaskRange over placements.get(task.id)',
    /const placement = placements\?\.get\(task\.id\);/.test(sheetSrc) && /scheduledTaskRange\(task, placement, base, workingDaysPerWeek, nonWorkingDates\)/.test(sheetSrc)
    && !/const range = base \? taskCalendarRange\(/.test(sheetSrc));
  const pinRange = scheduledTaskRange(drywall, undefined, base, 5);
  check('#88 row date differs from the pin date for a pushed task (the case)', rowRange.start.getTime() !== pinRange.start.getTime());
  check('#88 the stepper writes steppedStartDay(pinDay, startDayNumber, delta)', /startDay: steppedStartDay\(pinDay, startDayNumber, delta\)/.test(sheetSrc) && /const startDayNumber = scheduledStartOrdinal\(task, placement, calendar\);/.test(sheetSrc));
  check('#88 "+" on a held task steps from the scheduled start (pin 1, held to 6 → 7)', steppedStartDay(1, 6, 1) === 7);
  check('#88 "−" on a held task steps from the pin, never rewriting it later (pin 1, held to 6 → 1, not 5)', steppedStartDay(1, 6, -1) === 1);
  check('#88 "−" on a held task with room steps the pin down (pin 3, held to 6 → 2)', steppedStartDay(3, 6, -1) === 2);
  check('#88 unheld task steps both ways from its start', steppedStartDay(4, 4, 1) === 5 && steppedStartDay(4, 4, -1) === 3);
  check('#88 held-by names the predecessor', heldByPredecessor(drywall, tasks, placements, cal) === 'Framing');
  check('#88 not held when on its pin', heldByPredecessor(framing, tasks, placements, cal) === null);
  check('#88 the sheet prints "Held to <date> by <predecessor> (you set <pin>)"', /Held to \$\{/.test(sheetSrc) && /\(you set \$\{pinLabel\}\)/.test(sheetSrc));
  // Undated: the working-day placement.
  const ucpm = runCpm(tasks, {});
  const up = scheduledPlacements(ucpm, false);
  check('#88 undated: the scheduled day is the engine\'s, not the pin', scheduledStartOrdinal(drywall, up.get('d'), {}) === 11);
  check('#88 MobileScheduleScreen passes the placements into the sheet', /writePath=\{writePath\}[\s\S]{0,200}placements=\{placements\}\s*\/>/.test(phone));
}

// ── #90 ──────────────────────────────────────────────────────────────────
check('#90 shared refusal: field / viewer / row', scheduleWriteBlockedReason(scheduleWritePathForRole('field')) === SCHEDULE_WRITE_FIELD_REASON
  && scheduleWriteBlockedReason(scheduleWritePathForRole('viewer')) === SCHEDULE_WRITE_VIEWER_REASON
  && scheduleWriteBlockedReason(scheduleWritePathForRole('editor')) === null && scheduleWriteBlockedReason(scheduleWritePathForRole(null)) === null);
const wiz = src('app/schedule-wizard.tsx');
const onSave = wiz.slice(wiz.indexOf('const onSavePressed = useCallback'));
const gateAt = onSave.indexOf('if (saveBlockedReason) { showAlert(SCHEDULE_NOT_SAVED_TITLE, saveBlockedReason); return; }');
check('#90 the wizard refuses at the TOP of onSavePressed, before the replace confirm',
  gateAt > 0 && gateAt < onSave.indexOf('scheduleReplacementLoss('));
const handle = wiz.slice(wiz.indexOf('const handleSave = useCallback'), wiz.indexOf('const onSavePressed = useCallback'));
const hGate = handle.indexOf('if (saveBlockedReason) { showAlert(SCHEDULE_NOT_SAVED_TITLE, saveBlockedReason); return; }');
check('#90 handleSave refuses before updateProject / clearDraft', hGate > 0 && hGate < handle.indexOf('updateProject(') && hGate < handle.indexOf('clearDraft()'));
check('#90 the gate uses the live role then myRole, like schedule-review',
  /const projectRole = useProjectRole\(project\?\.id\);\s*const saveBlockedReason = scheduleWriteBlockedReason\(scheduleWritePathForRole\(projectRole \?\? project\?\.myRole\)\);/.test(wiz));
check('#90 the picker annotates jobs he cannot build on', (wiz.match(/<SeatNote role=\{p\.myRole\} \/>/g) ?? []).length === 2);
const review = src('app/schedule-review.tsx');
check('#90 schedule-review uses the same shared wording', /showAlert\('Schedule not saved', scheduleWriteBlockedReason\)/.test(review) && /scheduleWriteBlockedReasonFor\(scheduleWritePath\)/.test(review));
check('#90 the title is "Schedule not saved"', SCHEDULE_NOT_SAVED_TITLE === 'Schedule not saved');

// ── #91 ──────────────────────────────────────────────────────────────────
const tab = src('app/(tabs)/schedule/index.tsx');
const screen = tab.slice(tab.indexOf('function ScheduleScreen('));
const hookAt = screen.indexOf("useLiveSchedule(liveProjectId, onPeerSchedule, onLiveGap, 'schedule-tab-web');");
check('#91 the web Schedule tab subscribes live', hookAt > 0);
check('#91 before the screen\'s return (no early return ahead of it)', hookAt > 0 && !/\n {2}if \([^\n]*\) return[^\n]*;/.test(screen.slice(0, hookAt)));
check('#91 absorbs tasks only (no whole-copy adopt under a pushed Schedule Pro)',
  /absorbServerSchedule\(liveProjectId, copy\.tasks\);/.test(screen) && /if \(fresh\) absorbServerSchedule\(pid, fresh\.tasks\);/.test(screen));
check('#91 the open editor does not write back field values he did not change',
  /progress: progressChanged \? progress : item\.progress/.test(screen) && /notes: notesChanged \? draftNotes : item\.notes/.test(screen) && /const nextStatus = statusChanged \? draft\.status : item\.status;/.test(screen));

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `\nALL PASS (${pass})`);
if (fail) process.exit(1);
