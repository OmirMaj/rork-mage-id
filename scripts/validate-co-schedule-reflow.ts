// scripts/validate-co-schedule-reflow.ts — pins the behaviour of
// utils/coScheduleReflowCore.ts, the module that makes an approved change
// order actually move the schedule.
//
// WHY: app/change-order.tsx told the user "When approved, these days extend
// the project schedule automatically." What actually happened on approval was
// three scalar increments (totalDurationDays / criticalPathDays / bufferDays)
// — no task's startDay moved, nothing reflowed, CPM never re-ran. The Gantt
// was byte-for-byte unchanged, so the owner approved "+8 days," the contract
// said +8 days, and every sub still saw the original dates.
//
// The two failures that cost real money are pinned hardest here:
//   1. a CO applied TWICE silently adds phantom weeks to a schedule;
//   2. a CO that CANNOT be placed must say so instead of doing nothing quietly.
//
// Run: bun run scripts/validate-co-schedule-reflow.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { ChangeOrder, ProjectSchedule, ScheduleTask } from '../types';
import {
  CO_REFLOW_ACTION,
  CO_REFLOW_UNANCHORED_ACTION,
  applyCoScheduleReflow,
  buildUnanchoredCoAuditEntry,
  describeAnchorReason,
  eligibleAnchorTasks,
  hasUnanchoredMarker,
  isCoScheduleReflowApplied,
  normalizeImpactDays,
  planCoScheduleReflow,
  resolveAiAffectedTaskIds,
  selectReflowAnchor,
} from '../utils/coScheduleReflowCore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

// ── Fixture ────────────────────────────────────────────────────────────────
// Canonical CPM diamond, raw-day mode (no startDate → no weekend skipping, so
// the arithmetic below is checkable by hand):
//
//            +--- B (3d) ---+
//   A (2d) --+              +--> D (4d)
//            +--- C (5d) ---+
//
//   A: ES 1  EF 2   critical
//   B: ES 3  EF 5   TF 2   (slack)
//   C: ES 3  EF 7   critical  <- longest path
//   D: ES 8  EF 11  critical
//   projectFinish = 11

function task(over: Partial<ScheduleTask> & { id: string; title: string; startDay: number; durationDays: number }): ScheduleTask {
  return {
    phase: 'General',
    progress: 0,
    crew: '',
    dependencies: [],
    notes: '',
    status: 'not_started',
    ...over,
  } as ScheduleTask;
}

function baseTasks(): ScheduleTask[] {
  return [
    task({ id: 'a', title: 'Excavate', startDay: 1, durationDays: 2 }),
    task({ id: 'b', title: 'Underslab plumbing', startDay: 3, durationDays: 3, dependencies: ['a'] }),
    task({ id: 'c', title: 'Form and pour footings', startDay: 3, durationDays: 5, dependencies: ['a'] }),
    task({ id: 'd', title: 'Backfill', startDay: 8, durationDays: 4, dependencies: ['b', 'c'] }),
  ];
}

function schedule(over: Partial<ProjectSchedule> = {}): ProjectSchedule {
  return {
    id: 'sched-1',
    name: 'Schedule',
    projectId: 'p1',
    workingDaysPerWeek: 7,
    bufferDays: 5,
    tasks: baseTasks(),
    totalDurationDays: 11,
    criticalPathDays: 11,
    laborAlignmentScore: 80,
    riskItems: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function co(over: Partial<ChangeOrder> = {}): ChangeOrder {
  return {
    id: 'co-1',
    number: 7,
    projectId: 'p1',
    date: '2026-01-02T00:00:00.000Z',
    description: 'Add underslab conduit runs',
    reason: 'Owner direction',
    lineItems: [],
    originalContractValue: 100_000,
    changeAmount: 8_400,
    newContractTotal: 108_400,
    status: 'submitted',
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...over,
  };
}

let idSeq = 0;
const DETERMINISTIC = { now: '2026-02-01T12:00:00.000Z', newId: () => `id-${++idSeq}`, actor: 'gc@example.com' };

// ── 1. The anchor extends by EXACTLY scheduleImpactDays ────────────────────
console.log('\nco schedule reflow — anchor + successors:');
{
  const s = schedule();
  const c = co({ scheduleImpactDays: 3, scheduleImpactTaskIds: ['c'] });
  const res = applyCoScheduleReflow(s, c, DETERMINISTIC);

  ok('plan is ready when an anchor resolves', res.plan.status === 'ready', `status=${res.plan.status} — ${res.plan.message}`);
  ok('anchor is the AI-identified task', res.plan.anchorTaskId === 'c', `got ${res.plan.anchorTaskId}`);
  ok('anchor reason recorded as ai_identified', res.plan.anchorReason === 'ai_identified', res.plan.anchorReason);

  const anchorAfter = res.nextSchedule!.tasks.find(t => t.id === 'c')!;
  ok('anchor duration grows by exactly scheduleImpactDays',
    anchorAfter.durationDays === 5 + 3, `5 + 3 expected, got ${anchorAfter.durationDays}`);

  // Every OTHER task keeps its authored duration — a reflow moves dates, it
  // does not quietly re-scope work.
  const otherDurationsIntact = res.nextSchedule!.tasks
    .filter(t => t.id !== 'c')
    .every(t => t.durationDays === baseTasks().find(b => b.id === t.id)!.durationDays);
  ok('no other task duration changes', otherDurationsIntact);

  // D followed C (day 8). C now finishes 3 days later, so D starts 3 later.
  const d = res.nextSchedule!.tasks.find(t => t.id === 'd')!;
  ok('successor shifts downstream by the full impact', d.startDay === 8 + 3, `expected 11, got ${d.startDay}`);
  ok('preview listed that successor shift',
    res.plan.shifts.some(sh => sh.id === 'd' && sh.fromDay === 8 && sh.toDay === 11 && sh.deltaDays === 3),
    JSON.stringify(res.plan.shifts));

  // A precedes the anchor; B is on a parallel path with 2 days of float and
  // absorbs nothing here.
  const a = res.nextSchedule!.tasks.find(t => t.id === 'a')!;
  const b = res.nextSchedule!.tasks.find(t => t.id === 'b')!;
  ok('predecessor does not move', a.startDay === 1, `got ${a.startDay}`);
  ok('parallel task with float does not move', b.startDay === 3, `got ${b.startDay}`);

  ok('project finish is engine-derived, not hand-incremented',
    res.nextSchedule!.totalDurationDays === 14 && res.nextSchedule!.criticalPathDays === 14,
    `total=${res.nextSchedule!.totalDurationDays} critical=${res.nextSchedule!.criticalPathDays}`);
  ok('bufferDays is left alone (contingency is not contract time)',
    res.nextSchedule!.bufferDays === 5, `got ${res.nextSchedule!.bufferDays}`);
  ok('preview finish delta matches what was written',
    res.plan.finishBefore === 11 && res.plan.finishAfter === 14 && res.plan.finishDeltaDays === 3,
    `${res.plan.finishBefore} → ${res.plan.finishAfter}`);
}

// ── 2. Float + critical path are RECALCULATED, not left stale ──────────────
console.log('\nfloat + critical path recalculation:');
{
  // B carries 2 days of float. Adding 3 days to B makes A→B→D (2+6+4=12) the
  // longest path: B becomes critical and C stops being critical.
  const s = schedule();
  const c = co({ scheduleImpactDays: 3, scheduleAnchorTaskId: 'b' });
  const res = applyCoScheduleReflow(s, c, DETERMINISTIC);

  ok('a task that was NOT critical becomes critical',
    res.plan.becameCritical.some(t => t.id === 'b'), JSON.stringify(res.plan.becameCritical));
  ok('a task that WAS critical is no longer critical',
    res.plan.noLongerCritical.some(t => t.id === 'c'), JSON.stringify(res.plan.noLongerCritical));

  const written = new Map(res.nextSchedule!.tasks.map(t => [t.id, t.isCriticalPath]));
  ok('recalculated critical flags are persisted onto the tasks',
    written.get('b') === true && written.get('c') === false && written.get('a') === true && written.get('d') === true,
    JSON.stringify([...written]));
  ok('finish slips by 1 day, not by the 3 days the CO added',
    res.plan.finishAfter - res.plan.finishBefore === 1,
    `float absorbed 2 of the 3 days; got ${res.plan.finishAfter - res.plan.finishBefore}`);
}

// ── 3. Applying the same CO twice is a NO-OP ───────────────────────────────
console.log('\nidempotency (a double-applied CO adds phantom weeks):');
{
  const s = schedule();
  const c = co({ scheduleImpactDays: 3, scheduleImpactTaskIds: ['c'] });
  const first = applyCoScheduleReflow(s, c, DETERMINISTIC);
  const appliedCo: ChangeOrder = { ...c, ...first.coPatch };

  ok('apply stamps the durable audit marker',
    (appliedCo.auditTrail ?? []).some(e => e.action === CO_REFLOW_ACTION), JSON.stringify(appliedCo.auditTrail));
  ok('apply sets scheduleImpactApplied', appliedCo.scheduleImpactApplied === true);
  ok('isCoScheduleReflowApplied agrees', isCoScheduleReflowApplied(appliedCo));

  const second = applyCoScheduleReflow(first.nextSchedule!, appliedCo, DETERMINISTIC);
  ok('second apply reports already_applied', second.plan.status === 'already_applied', second.plan.status);
  ok('second apply produces no schedule', second.nextSchedule === null);
  ok('second apply produces no CO patch', second.coPatch === null);
  ok('second apply produces no audit entry', second.auditEntry === null);

  // The durable half of the guard, on its own: a partial sync that lost the
  // boolean must NOT re-open the door.
  const flagLost: ChangeOrder = { ...appliedCo, scheduleImpactApplied: undefined };
  ok('audit marker alone still blocks re-application',
    applyCoScheduleReflow(first.nextSchedule!, flagLost, DETERMINISTIC).plan.status === 'already_applied');

  // And the boolean on its own (an older CO written before the marker existed).
  const markerLost: ChangeOrder = { ...c, scheduleImpactApplied: true };
  ok('scheduleImpactApplied alone still blocks re-application',
    applyCoScheduleReflow(first.nextSchedule!, markerLost, DETERMINISTIC).plan.status === 'already_applied');

  // The whole point: dates identical after a replayed apply.
  const replayed = applyCoScheduleReflow(first.nextSchedule!, appliedCo, DETERMINISTIC);
  ok('replaying an offline-queue entry cannot move a single date',
    replayed.nextSchedule === null &&
    first.nextSchedule!.tasks.find(t => t.id === 'd')!.startDay === 11);
}

// ── 4. A CO with no anchor is handled honestly ─────────────────────────────
console.log('\nno anchor — honest, not silent:');
{
  // Nothing AI-flagged, nothing estimate-linked: we refuse to invent a task.
  const s = schedule();
  const c = co({ scheduleImpactDays: 4 });
  const res = applyCoScheduleReflow(s, c, DETERMINISTIC);

  ok('status is no_anchor', res.plan.status === 'no_anchor', res.plan.status);
  ok('nothing is written', res.nextSchedule === null && res.coPatch === null);
  ok('the CO is NOT marked applied (so it can still be placed later)',
    !isCoScheduleReflowApplied({ ...c, ...(res.coPatch ?? {}) }));
  ok('a plain-language reason is supplied', res.plan.message.length > 20, res.plan.message);
  ok('the message names the days that did not land', res.plan.message.includes('4 days'), res.plan.message);
  ok('candidate tasks are offered so the user can pick one',
    res.plan.candidates.length === 4, `got ${res.plan.candidates.length}`);

  const marker = buildUnanchoredCoAuditEntry(res.plan, DETERMINISTIC);
  ok('an unanchored marker is available for the CO history',
    marker.action === CO_REFLOW_UNANCHORED_ACTION && marker.detail!.includes('4 days'), JSON.stringify(marker));
  ok('hasUnanchoredMarker detects it', hasUnanchoredMarker({ auditTrail: [marker] }));

  // A user-picked anchor rescues exactly this case.
  const picked = applyCoScheduleReflow(s, c, { ...DETERMINISTIC, anchorTaskId: 'b' });
  ok('a user-picked anchor turns no_anchor into ready', picked.plan.status === 'ready', picked.plan.status);
  ok('user pick is recorded as the reason', picked.plan.anchorReason === 'user_picked');

  // A schedule where every task is finished/milestone/summary — nothing can
  // absorb days, and we say that rather than stretching finished work.
  const allDone = schedule({
    tasks: [
      task({ id: 'x', title: 'Closeout', startDay: 1, durationDays: 3, status: 'done', progress: 100 }),
      task({ id: 'm', title: 'Substantial completion', startDay: 4, durationDays: 0, isMilestone: true }),
      task({ id: 's', title: 'Phase 1', startDay: 1, durationDays: 4, isSummary: true }),
    ],
  });
  const none = planCoScheduleReflow(allDone, c, DETERMINISTIC);
  ok('finished / milestone / summary rows are never anchors',
    none.status === 'no_anchor' && none.candidates.length === 0, `${none.status} / ${none.candidates.length}`);
  ok('and the copy says so plainly', none.message.includes('finished'), none.message);
}

// ── 5. Zero / undefined impact days change nothing ─────────────────────────
console.log('\nzero-impact change orders:');
{
  const s = schedule();
  for (const [label, days] of [['undefined', undefined], ['zero', 0], ['negative', -3]] as const) {
    const res = applyCoScheduleReflow(s, co({ scheduleImpactDays: days, scheduleImpactTaskIds: ['c'] }), DETERMINISTIC);
    ok(`${label} impact days → no_impact`, res.plan.status === 'no_impact', res.plan.status);
    ok(`${label} impact days writes nothing`, res.nextSchedule === null && res.auditEntry === null);
  }
  ok('normalizeImpactDays floors at 0 and truncates', normalizeImpactDays(-2) === 0 && normalizeImpactDays(3.7) === 3 && normalizeImpactDays(NaN) === 0);
  ok('a no-impact CO says so without promising anything',
    planCoScheduleReflow(s, co({ scheduleImpactDays: 0 })).message.includes('no schedule impact'));
}

// ── 6. A baseline is captured BEFORE the first mutation ────────────────────
console.log('\nbaseline capture (the delay-claim artifact):');
{
  const s = schedule();
  const c = co({ scheduleImpactDays: 3, scheduleImpactTaskIds: ['c'] });
  ok('preview warns a baseline will be captured', planCoScheduleReflow(s, c, DETERMINISTIC).willCaptureBaseline);

  const res = applyCoScheduleReflow(s, c, DETERMINISTIC);
  const baselines = res.nextSchedule!.baselines ?? [];
  ok('one baseline is captured', baselines.length === 1, `got ${baselines.length}`);
  ok('the baseline is named for the CO', baselines[0].name.includes('#7'), baselines[0].name);

  // Captured from the PRE-mutation tasks: D must be at day 8, not the
  // post-reflow day 11, or the baseline records the damage as the plan.
  const bd = baselines[0].tasks.find(t => t.id === 'd')!;
  ok('the baseline snapshots the schedule BEFORE the shift',
    bd.startDay === 8, `expected 8 (pre-reflow), got ${bd.startDay}`);
  const bc = baselines[0].tasks.find(t => t.id === 'c')!;
  ok('the baseline records the anchor at its ORIGINAL duration',
    bc.endDay - bc.startDay + 1 === 5, `expected 5d, got ${bc.endDay - bc.startDay + 1}`);

  // An existing baseline IS the contractual as-planned reference. Silently
  // re-baselining on every CO would erase the slip a claim is about.
  const withBaseline = { ...res.nextSchedule!, tasks: res.nextSchedule!.tasks };
  const second = applyCoScheduleReflow(withBaseline, co({ id: 'co-2', number: 8, scheduleImpactDays: 2, scheduleImpactTaskIds: ['b'] }), DETERMINISTIC);
  ok('a second CO does NOT re-baseline over the as-planned reference',
    (second.nextSchedule!.baselines ?? []).length === 1, `got ${(second.nextSchedule!.baselines ?? []).length}`);
  ok('and the preview says so', second.plan.willCaptureBaseline === false);
}

// ── 7. The audit entry links the CO ────────────────────────────────────────
console.log('\naudit trail:');
{
  const s = schedule();
  const c = co({ scheduleImpactDays: 3, scheduleImpactTaskIds: ['c'] });
  const res = applyCoScheduleReflow(s, c, DETERMINISTIC);
  const entry = res.auditEntry!;

  ok('a schedule audit entry is produced', !!entry);
  ok('it links the change order id', entry.changeOrderId === 'co-1', String(entry.changeOrderId));
  ok('its structured payload carries the CO number and days',
    entry.after?.changeOrderNumber === 7 && entry.after?.impactDays === 3, JSON.stringify(entry.after));
  ok('it names the anchor task', entry.taskId === 'c' && entry.taskTitle === 'Form and pour footings');
  ok('it is filed as a reflow', entry.kind === 'reflow', entry.kind);
  ok('it records who applied it', entry.user === 'gc@example.com', entry.user);
  ok('it records the finish before and after',
    entry.before?.projectFinishDay === 11 && entry.after?.projectFinishDay === 14, JSON.stringify(entry.after));
  ok('it records the anchor duration before and after',
    entry.before?.anchorDurationDays === 5 && entry.after?.anchorDurationDays === 8);
  ok('it records that a baseline was captured', entry.after?.baselineCaptured === true);
  ok('the summary is human-readable', entry.summary.includes('CO #7') && entry.summary.includes('Form and pour footings'), entry.summary);

  const coEntry = (res.coPatch!.auditTrail ?? []).find(e => e.action === CO_REFLOW_ACTION)!;
  ok('the CO-side entry explains what moved', coEntry.detail!.includes('Form and pour footings'), coEntry.detail);
  ok('the CO-side entry preserves prior history',
    applyCoScheduleReflow(s, co({ scheduleImpactDays: 3, scheduleImpactTaskIds: ['c'], auditTrail: [{ id: 'old', action: 'created', actor: 'x', timestamp: 't' }] }), DETERMINISTIC)
      .coPatch!.auditTrail!.length === 2);
}

// ── 8. The anchor rule's priority order ────────────────────────────────────
console.log('\nanchor rule:');
{
  const tasks = baseTasks();
  tasks[1].linkedEstimateItems = ['est-plumb'];       // b
  const estimateItems = [{ id: 'est-plumb', name: 'Underslab plumbing rough' }];
  const lineItems = [{ id: 'li1', name: 'Underslab plumbing rough', description: '', quantity: 1, unit: 'ls', unitPrice: 1, total: 1, isNew: true }];

  const estOnly = selectReflowAnchor(tasks, co({ lineItems }), { estimateItems });
  ok('estimate-linked task is found when nothing else points anywhere',
    estOnly.taskId === 'b' && estOnly.reason === 'estimate_link', JSON.stringify(estOnly));

  const aiBeatsEstimate = selectReflowAnchor(tasks, co({ lineItems, scheduleImpactTaskIds: ['c'] }), { estimateItems });
  ok('AI-identified beats estimate-linked', aiBeatsEstimate.taskId === 'c' && aiBeatsEstimate.reason === 'ai_identified');

  const userBeatsAi = selectReflowAnchor(tasks, co({ lineItems, scheduleImpactTaskIds: ['c'] }), { estimateItems, anchorTaskId: 'd' });
  ok('a user pick beats every automatic rule', userBeatsAi.taskId === 'd' && userBeatsAi.reason === 'user_picked');

  const stored = selectReflowAnchor(tasks, co({ scheduleAnchorTaskId: 'a', scheduleImpactTaskIds: ['c'] }));
  ok('a stored scheduleAnchorTaskId also outranks the AI', stored.taskId === 'a' && stored.reason === 'user_picked');

  // The AI's affectedTasks[] lists the cause AND the consequences. Anchoring
  // on the earliest keeps CPM (not the model's arithmetic) in charge of the
  // downstream shifts.
  const multi = selectReflowAnchor(tasks, co({ scheduleImpactTaskIds: ['d', 'c'] }), { cpm: null });
  ok('among several AI tasks the earliest-starting one is the anchor',
    multi.taskId === 'c', `got ${multi.taskId}`);

  const ineligible = selectReflowAnchor(tasks, co({ scheduleImpactTaskIds: ['nope'] }));
  ok('an AI task id that no longer exists falls through', ineligible.taskId === null && ineligible.reason === 'none');

  ok('eligibility excludes summary, milestone, LOE, done and 0-day rows',
    eligibleAnchorTasks([
      task({ id: '1', title: 'ok', startDay: 1, durationDays: 2 }),
      task({ id: '2', title: 'summary', startDay: 1, durationDays: 2, isSummary: true }),
      task({ id: '3', title: 'milestone', startDay: 1, durationDays: 0, isMilestone: true }),
      task({ id: '4', title: 'loe', startDay: 1, durationDays: 5, isLevelOfEffort: true }),
      task({ id: '5', title: 'done', startDay: 1, durationDays: 2, status: 'done' }),
      task({ id: '6', title: 'complete', startDay: 1, durationDays: 2, progress: 100 }),
      task({ id: '7', title: 'finished', startDay: 1, durationDays: 2, actualEndDay: 3 }),
    ]).map(t => t.id).join(',') === '1');

  ok('every anchor reason has user-facing copy',
    (['user_picked', 'ai_identified', 'estimate_link', 'none'] as const)
      .every(r => describeAnchorReason(r).length > 5));
}

// ── 9. AI task-name resolution ─────────────────────────────────────────────
console.log('\nAI affectedTasks[] → task ids:');
{
  const tasks = baseTasks();
  ok('exact name match resolves', resolveAiAffectedTaskIds(tasks, ['Form and pour footings']).join() === 'c');
  ok('case and punctuation are ignored', resolveAiAffectedTaskIds(tasks, ['FORM AND POUR  FOOTINGS!']).join() === 'c');
  ok('a unique partial match resolves', resolveAiAffectedTaskIds(tasks, ['footings']).join() === 'c');
  ok('an unmatched name is dropped, never guessed', resolveAiAffectedTaskIds(tasks, ['Install skylights']).length === 0);
  ok('order is preserved and duplicates collapse',
    resolveAiAffectedTaskIds(tasks, ['Backfill', 'Excavate', 'Backfill']).join() === 'd,a');
  ok('an ambiguous name matching two tasks is dropped',
    resolveAiAffectedTaskIds(
      [task({ id: 'p1', title: 'Paint interior', startDay: 1, durationDays: 2 }), task({ id: 'p2', title: 'Paint exterior', startDay: 1, durationDays: 2 })],
      ['Paint'],
    ).length === 0);
  ok('empty input is safe', resolveAiAffectedTaskIds(tasks, ['', '   ']).length === 0);
}

// ── 10. Degenerate schedules ───────────────────────────────────────────────
console.log('\ndegenerate inputs:');
{
  const c = co({ scheduleImpactDays: 3 });
  ok('a null schedule is reported, not crashed', planCoScheduleReflow(null, c).status === 'no_schedule');
  ok('an empty schedule is reported', planCoScheduleReflow(schedule({ tasks: [] }), c).status === 'no_schedule');
  ok('the no-schedule copy does not promise a reflow',
    !planCoScheduleReflow(null, c).message.toLowerCase().includes('automatic'));

  // A dependency loop makes CPM unrunnable; guessing would corrupt the plan.
  const looped = schedule({
    tasks: [
      task({ id: 'x', title: 'X', startDay: 1, durationDays: 2, dependencies: ['y'] }),
      task({ id: 'y', title: 'Y', startDay: 3, durationDays: 2, dependencies: ['x'] }),
    ],
  });
  const loopPlan = planCoScheduleReflow(looped, co({ scheduleImpactDays: 2, scheduleImpactTaskIds: ['x'] }));
  ok('a dependency cycle blocks the reflow instead of guessing', loopPlan.status === 'blocked', loopPlan.status);
  ok('and explains why', loopPlan.message.includes('loop'), loopPlan.message);
  ok('a blocked reflow still produces a marker for the CO history',
    buildUnanchoredCoAuditEntry(loopPlan, DETERMINISTIC).detail!.includes('loop'));
}

// ── 11. A working calendar is honored ──────────────────────────────────────
console.log('\ncalendar awareness:');
{
  // 2026-01-05 is a Monday. On a 5-day week a 3-day extension to a task that
  // ends Friday must push its successor across the weekend, not into it.
  const s = schedule({
    startDate: '2026-01-05',
    workingDaysPerWeek: 5,
    tasks: [
      task({ id: 'p', title: 'Frame walls', startDay: 1, durationDays: 5 }),
      task({ id: 'q', title: 'Roof', startDay: 8, durationDays: 3, dependencies: ['p'] }),
    ],
  });
  const res = applyCoScheduleReflow(s, co({ scheduleImpactDays: 2, scheduleImpactTaskIds: ['p'] }), DETERMINISTIC);
  ok('reflow runs on a 5-day calendar', res.plan.status === 'ready', res.plan.message);
  const q = res.nextSchedule!.tasks.find(t => t.id === 'q')!;
  ok('the successor shift crosses the weekend (2 working days = 2 calendar days here)',
    q.startDay === 10, `expected day 10 (Wed 14 Jan), got ${q.startDay}`);
  ok('the finish moves by working days, not raw days',
    res.plan.finishDeltaDays === 2, String(res.plan.finishDeltaDays));
}

// ── 12. The screen copy matches the behaviour ──────────────────────────────
console.log('\ncopy honesty:');
{
  const coScreen = readFileSync(join(ROOT, 'app', 'change-order.tsx'), 'utf8');
  ok('change-order.tsx no longer promises an automatic schedule extension',
    !/these days extend the project schedule automatically/i.test(coScreen),
    'the helper text under "Schedule Impact (days)" claimed a reflow that never happened');
  ok('change-order.tsx does not claim any "automatically extend" behaviour',
    !/extends? the (project )?schedule automatically/i.test(coScreen));

  ok('change-order.tsx no longer claims "(applied to schedule)" regardless of state',
    !/\(applied to schedule\)/.test(coScreen),
    'that string printed on approved COs whose Gantt had never moved');

  const projectDetail = readFileSync(join(ROOT, 'app', 'project-detail.tsx'), 'utf8');
  ok('project-detail.tsx no longer hand-increments bufferDays on approval',
    !/bufferDays.*\+\s*impactDays/.test(projectDetail),
    'CO days were being folded into contingency, hiding the slip');

  const ctx = readFileSync(join(ROOT, 'contexts', 'ProjectContext.tsx'), 'utf8');
  ok('ProjectContext no longer hand-increments criticalPathDays on CO approval',
    !/criticalPathDays:\s*project\.schedule\.criticalPathDays\s*\+/.test(ctx),
    'the scalar bump left every task date untouched');
  ok('ProjectContext routes CO approval through the reflow core',
    /applyCoScheduleReflow/.test(ctx));
  ok('ProjectContext records the unanchored case instead of swallowing it',
    /buildUnanchoredCoAuditEntry/.test(ctx));

  // Preview-before-apply: neither approve surface may rewrite the Gantt on the
  // tap itself.
  ok('the project screen previews the reflow before approving',
    /COScheduleReflowPreviewModal/.test(projectDetail));
  ok('the change-order screen previews the reflow before approving',
    /COScheduleReflowPreviewModal/.test(coScreen));

  // The locked-card copy tells the user where to place days that never landed.
  // That has to be a real place, or it is just a new false promise.
  ok('project-detail offers a way to place days on an approved-but-unapplied CO',
    /place \+\{co\.scheduleImpactDays\}d on the schedule/.test(projectDetail),
    'the CO screen tells users to go there — the affordance must exist');

  // The AI analysis is used, not just rendered.
  const aiPanel = readFileSync(join(ROOT, 'components', 'AIChangeOrderImpact.tsx'), 'utf8');
  ok('AIChangeOrderImpact hands its result up instead of discarding it',
    /onResult\?\.\(data\)/.test(aiPanel));
  ok('the CO screen resolves affectedTasks[] into real task ids',
    /resolveAiAffectedTaskIds/.test(coScreen));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
