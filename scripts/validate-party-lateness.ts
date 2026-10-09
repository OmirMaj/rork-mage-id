// validate-party-lateness.ts — the sub lateness engine (utils/pace/partyLateness.ts)
// and the source guards on its two surfaces.
//
// Every block names the planted mutation that turns it red. The mutation runs
// are recorded in the lane report (copy the file, plant, run, restore, cmp).
//
// Run via: bun run test:party-lateness

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  buildPartyLateness, latenessPadFor, carryLatenessPadOnSave, applyLatenessPad, revertLatenessPad,
  readLatenessPad, padRecordFor, supplierAdvisoryFor, latenessPadPatch, releasePendingPad, median, LATE_MIN_JOBS, LATE_WINDOW_JOBS,
  type LatenessPadRecord, type PartyLateness, type TaskWithLatenessPad,
} from '../utils/pace/partyLateness';
import { buildPaceBook, lookupPace } from '../utils/pace/paceBook';
import { computeSubScorecards } from '../utils/subScorecard';
import type { Contact, DelayEvent, Project, ScheduleTask, Subcontractor } from '../types';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got:  ', JSON.stringify(got), '\n      want: ', JSON.stringify(want)); }
}

// ── fixtures ──────────────────────────────────────────────────────────────
const SUBS: Subcontractor[] = [
  { id: 's1', companyName: 'Acme Framing', contactName: 'Ann' },
  { id: 's2', companyName: 'Bolt Electric', contactName: '' },
  { id: 's3', companyName: 'Twin Co' },
  { id: 's4', companyName: 'twin co ' },
].map(s => ({ trade: 'Framing', w9OnFile: false, ...s }) as unknown as Subcontractor);

function task(id: string, over: Partial<ScheduleTask> & { actualDays?: number; end?: string }): ScheduleTask {
  const { actualDays = 5, end, ...rest } = over;
  const startDay = 1;
  return {
    id, title: 'Framing walls', phase: 'Framing', durationDays: 5, startDay,
    progress: 100, crew: '', crewSize: 2, dependencies: [], notes: '', status: 'done',
    assignedSubId: 's1', actualStartDay: startDay, actualEndDay: startDay + actualDays - 1,
    actualEndDate: end, ...rest,
  } as ScheduleTask;
}
/** A 7-day-week project (calendar span == working span) with a start date. */
function project(id: string, tasks: ScheduleTask[], over: Partial<NonNullable<Project['schedule']>> = {}): Project {
  return {
    id, name: `Job ${id}`,
    schedule: { id: `sch-${id}`, name: 'S', projectId: id, startDate: '2026-01-05', workingDaysPerWeek: 7, tasks, ...over },
  } as unknown as Project;
}
/** One job per overrun: a 5-day task that took 5+overrun days, dated by index. */
function jobs(overruns: number[], subId = 's1', base = 'j'): Project[] {
  return overruns.map((o, i) => project(`${base}${i}`, [
    task(`${base}${i}-t`, { assignedSubId: subId, actualDays: 5 + o, end: `2026-0${(i % 9) + 1}-15` }),
  ]));
}
const NO_OFF: ReadonlySet<string> = new Set();
const entryFor = (projects: Project[], extra: { contacts?: Contact[]; delayEvents?: DelayEvent[] } = {}, id = 's1'): PartyLateness =>
  buildPartyLateness({ projects, subcontractors: SUBS, ...extra }).get(id)!;
const newTask = (over: Partial<ScheduleTask> = {}): ScheduleTask =>
  ({ id: 'new', title: 'Framing walls', phase: 'Framing', durationDays: 10, startDay: 1, progress: 0, crew: '',
    dependencies: [], notes: '', status: 'not_started', assignedSubId: 's1', ...over }) as ScheduleTask;

// ── V1 unit: working days, not calendar span ──────────────────────────────
// Mutation: replace actualWorkingDays(...) with the raw span (end − start + 1) → overrun 2.
console.log('V1 working-day unit');
{
  // 2026-01-05 is a Monday = day 1. A 5-day task started Thursday (day 4) and
  // finished the next Wednesday (day 10): 7 calendar days, 5 working days.
  const t = { ...task('w1', { end: '2026-01-14' }), actualStartDay: 4, actualEndDay: 10 } as ScheduleTask;
  const p = project('wk', [t], { workingDaysPerWeek: 5 });
  const e = entryFor([p]);
  expect('weekend-crossing 5-day task finished in 7 calendar days → overrun 0', e.overrunSamples, [0]);
}

// ── V2 threshold ──────────────────────────────────────────────────────────
// Mutations: LATE_MIN_JOBS = 2 (two jobs learn); `>= LATE_MIN_JOBS` → `>` (three jobs do not).
console.log('V2 threshold');
{
  const two = entryFor(jobs([2, 3]));
  expect('2 jobs → not_enough_history', two.status, 'not_enough_history');
  expect('2 jobs → median null', two.medianOverrunDays, null);
  expect('2 jobs → no pad', latenessPadFor(two, newTask(), { paceEntry: null, offSubIds: NO_OFF }), null);
  const three = entryFor(jobs([2, 3, 1]));
  expect('3 jobs [2,3,1] → learned', three.status, 'learned');
  expect('3 jobs [2,3,1] → median 2', three.medianOverrunDays, 2);
  expect('LATE_MIN_JOBS is 3', LATE_MIN_JOBS, 3);
  const onPlan = entryFor(jobs([0, 1, 0]));
  expect('3 jobs median 0 → on_plan', onPlan.status, 'on_plan');
  expect('on_plan → no pad', latenessPadFor(onPlan, newTask(), { paceEntry: null, offSubIds: NO_OFF }), null);
  const pad = latenessPadFor(three, newTask(), { paceEntry: null, offSubIds: NO_OFF });
  expect('learned, no pace entry → pad 2, not residual', pad && { d: pad.padDays, r: pad.residualOfPace, j: pad.jobs }, { d: 2, r: false, j: 3 });
  expect('median of an even count = mean of the middle two', median([1, 4, 2, 3]), 2.5);
}

// ── V3 no double count ────────────────────────────────────────────────────
// Mutation: drop the residual subtraction (padDays = round(subMedian) always) → pad 2.
console.log('V3 residual of the trade pace');
{
  const projects = jobs([2, 2, 2]).map(p => ({
    ...p, schedule: { ...p.schedule!, tasks: p.schedule!.tasks.map(t => ({ ...t, tradeKey: 'framing' as const })) },
  })) as Project[];
  const e = entryFor(projects);
  expect('sub is learned at +2', [e.status, e.medianOverrunDays], ['learned', 2]);
  const paceEntry = lookupPace(buildPaceBook(projects), 'framing', undefined);
  expect('pace entry is usable (medium)', paceEntry?.confidence, 'medium');
  const t = newTask({ tradeKey: 'framing' });
  expect('only framer: the trade pace already holds the lateness → no pad', latenessPadFor(e, t, { paceEntry, offSubIds: NO_OFF }), null);
  // A sub that runs 2 days longer than the trade's usual overrun still gets the residual.
  const mixed = [
    ...projects,
    ...jobs([0, 0, 0], 's2', 'k').map(p => ({
      ...p, schedule: { ...p.schedule!, tasks: p.schedule!.tasks.map(t => ({ ...t, tradeKey: 'framing' as const })) },
    })) as Project[],
  ];
  const pace2 = lookupPace(buildPaceBook(mixed), 'framing', undefined);
  const r = latenessPadFor(entryFor(mixed), t, { paceEntry: pace2, offSubIds: NO_OFF });
  expect('trade median 1 (samples 2,2,2,0,0,0) → residual pad round(2−1)=1', r && [r.padDays, r.residualOfPace, r.paceTrade], [1, true, 'framing']);
  const low = { ...pace2!, confidence: 'low' as const };
  const r2 = latenessPadFor(entryFor(mixed), t, { paceEntry: low, offSubIds: NO_OFF });
  expect('a low-confidence pace entry is not subtracted', r2 && [r2.padDays, r2.residualOfPace], [2, false]);
}

// ── V4 excusal ────────────────────────────────────────────────────────────
// Mutation: drop the excused check (or add 'weather' nowhere) → the +4 counts, excusedTasks 0.
console.log('V4 excused delays');
{
  const ps = jobs([1, 1, 1]);
  ps[0] = project('j0', [
    task('j0-t', { actualDays: 6, end: '2026-01-15' }),
    task('j0-w', { actualDays: 9, end: '2026-01-16' }),
  ]);
  ps[1] = project('j1', [
    task('j1-t', { actualDays: 6, end: '2026-02-15' }),
    task('j1-c', { actualDays: 9, end: '2026-02-16' }),
  ]);
  const ev = (id: string, projectId: string, cause: DelayEvent['cause'], taskId: string) =>
    ({ id, projectId, number: 1, cause, firstObservedDate: '2026-01-10', description: '', evidence: [], impactedTaskIds: [taskId], claimedDays: 2 }) as unknown as DelayEvent;
  const e = entryFor(ps, { delayEvents: [ev('d1', 'j0', 'weather', 'j0-w'), ev('d2', 'j1', 'contractor_caused', 'j1-c')] });
  expect('weather-delayed +4 task left out, counted once', e.excusedTasks, 1);
  expect('contractor_caused +4 still counts (samples)', [...e.overrunSamples].sort(), [1, 1, 1, 4]);
  const otherProject = entryFor(ps, { delayEvents: [ev('d3', 'zz', 'weather', 'j0-w')] });
  expect('a delay on another project excuses nothing', otherProject.excusedTasks, 0);
}

// ── V5 attribution ────────────────────────────────────────────────────────
// Mutations: accept a Contact matching 2 subs (first wins) → ambiguous sample counted;
// accept any unknown id → raw sample counted.
console.log('V5 attribution');
{
  const contacts = [
    { id: 'c-acme', companyName: '  ACME framing ', firstName: 'A', lastName: 'B', role: 'Sub' },
    { id: 'c-twin', companyName: 'Twin Co', firstName: 'T', lastName: 'C', role: 'Sub' },
  ] as unknown as Contact[];
  const ps = [
    project('a', [task('a1', { assignedSubId: 'c-acme', actualDays: 7, end: '2026-03-01' })]),
    project('b', [task('b1', { assignedSubId: 'c-twin', actualDays: 7, end: '2026-03-01' })]),
    project('c', [task('c1', { assignedSubId: 'ghost', actualDays: 7, end: '2026-03-01' })]),
  ];
  const map = buildPartyLateness({ projects: ps, subcontractors: SUBS, contacts });
  expect('unambiguous Contact maps to Acme', map.get('s1')!.overrunSamples, [2]);
  expect('Acme carries the contact id as an alias', map.get('s1')!.attributedIds, ['s1', 'c-acme']);
  expect('ambiguous Contact (2 subs share the name) is dropped', [map.get('s3')!.tasksMeasured, map.get('s4')!.tasksMeasured], [0, 0]);
  const total = [...map.values()].reduce((s, e) => s + e.tasksMeasured, 0);
  expect('unknown raw id is dropped (1 sample total)', total, 1);
}

// ── V6 silence rules ──────────────────────────────────────────────────────
// Mutations: remove any one guard (off switch / milestone / summary / already padded / assignee).
console.log('V6 silence');
{
  const e = entryFor(jobs([2, 2, 2]));
  const opts = { paceEntry: null, offSubIds: NO_OFF };
  expect('control: a plain task gets a pad', latenessPadFor(e, newTask(), opts)?.padDays, 2);
  expect('sub switched off → null', latenessPadFor(e, newTask(), { paceEntry: null, offSubIds: new Set(['s1']) }), null);
  expect('milestone → null', latenessPadFor(e, newTask({ isMilestone: true }), opts), null);
  expect('summary → null', latenessPadFor(e, newTask({ isSummary: true }), opts), null);
  expect('level of effort → null', latenessPadFor(e, newTask({ isLevelOfEffort: true }), opts), null);
  expect('zero duration → null', latenessPadFor(e, newTask({ durationDays: 0 }), opts), null);
  const padded = { ...newTask(), latenessPad: { subId: 's1', days: 2, jobs: 3, medianOverrunDays: 2, residualOfPace: false } } as TaskWithLatenessPad;
  expect('already padded → null (never re-offer)', latenessPadFor(e, padded, opts), null);
  expect('mismatched assignee → null', latenessPadFor(e, newTask({ assignedSubId: 's2' }), opts), null);
  expect('no entry → null', latenessPadFor(undefined, newTask(), opts), null);
}

// ── V7 cap ────────────────────────────────────────────────────────────────
// Mutation: drop the cap (or LATE_PAD_CAP_RATIO = 1) → pad 6 (or 2).
console.log('V7 cap');
{
  const e = entryFor(jobs([6, 6, 6]));
  expect('2-day task, median 6 → pad 1', latenessPadFor(e, newTask({ durationDays: 2 }), { paceEntry: null, offSubIds: NO_OFF })?.padDays, 1);
  expect('5-day task, median 6 → pad 3 (ceil 2.5)', latenessPadFor(e, newTask({ durationDays: 5 }), { paceEntry: null, offSubIds: NO_OFF })?.padDays, 3);
}

// ── V8 recency window ─────────────────────────────────────────────────────
// Mutations: LATE_WINDOW_JOBS = 8; undated jobs sorted NEWEST.
console.log('V8 recency window');
{
  const dated = [1, 1, 1, 1, 1, 1, 9].map((o, i) => project(`r${i}`, [
    task(`r${i}-t`, { actualDays: 5 + o, end: `2026-0${7 - i}-01` }),
  ]));
  const undated = project('ru', [task('ru-t', { actualDays: 5 + 9, end: undefined })]);
  const e = entryFor([undated, ...dated]);
  expect('window is 6', LATE_WINDOW_JOBS, 6);
  expect('8 jobs → 6 kept', e.jobsMeasured, 6);
  expect('newest first, the oldest dated and the undated job dropped', e.jobs.map(j => j.projectId), ['r0', 'r1', 'r2', 'r3', 'r4', 'r5']);
  expect('median uses only the kept jobs', e.medianOverrunDays, 1);
  const withUndated = entryFor([undated, ...dated.slice(0, 3)]);
  expect('an undated job sorts oldest', withUndated.jobs.map(j => j.projectId), ['r0', 'r1', 'r2', 'ru']);
}

// ── V9 parity with the scorecard's eligibility ────────────────────────────
// Mutation: drift eligibility (e.g. drop the inverted-pair or status check) → counts differ.
console.log('V9 parity with subScorecard');
{
  const ps = [
    project('q1', [
      task('ok1', { actualDays: 6, end: '2026-04-01' }),
      task('ok2', { actualDays: 4, end: '2026-04-02' }),
      task('mile', { isMilestone: true }),
      task('open', { status: 'in_progress' }),
      { ...task('inv', {}), actualStartDay: 9, actualEndDay: 3 } as ScheduleTask,
      { ...task('nostamp', {}), actualEndDay: undefined } as ScheduleTask,
      task('zero', { durationDays: 0 }),
    ]),
    project('q2', [task('ok3', { actualDays: 8, end: '2026-05-01' })]),
  ];
  const lateness = entryFor(ps);
  const card = computeSubScorecards({ subcontractors: SUBS, commitments: [], projects: ps }).cards.find(c => c.subId === 's1')!;
  const detail = card.factors.find(f => f.key === 'schedule_reliability')!.detail;
  const m = /across (\d+) finished task/.exec(detail);
  expect('scorecard detail names its measured count', !!m, true);
  expect('measured-task count equals the scorecard\'s', lateness.tasksMeasured, Number(m?.[1]));
  expect('…and it is 3', lateness.tasksMeasured, 3);
}

// ── carry-through, apply, revert ──────────────────────────────────────────
// Mutations: keep a pending pad when the duration changed; keep a stored pad when edited down.
console.log('Provenance carry-through');
{
  const pad: LatenessPadRecord = { subId: 's1', days: 2, jobs: 3, medianOverrunDays: 2, residualOfPace: false };
  expect('pending pad kept at the applied duration', carryLatenessPadOnSave({ pending: { pad, appliedDuration: 12 }, savedDuration: 12, savedSubId: 's1' }), pad);
  expect('pending pad dropped when he changed the duration after', carryLatenessPadOnSave({ pending: { pad, appliedDuration: 12 }, savedDuration: 11, savedSubId: 's1' }), undefined);
  expect('pending pad dropped when the sub changed', carryLatenessPadOnSave({ pending: { pad, appliedDuration: 12 }, savedDuration: 12, savedSubId: 's2' }), undefined);
  expect('stored pad kept when untouched', carryLatenessPadOnSave({ stored: pad, storedDuration: 12, savedDuration: 12, savedSubId: 's1' }), pad);
  expect('stored pad cleared when the duration is edited down', carryLatenessPadOnSave({ stored: pad, storedDuration: 12, savedDuration: 10, savedSubId: 's1' }), undefined);
  expect('stored pad cleared when the sub is removed', carryLatenessPadOnSave({ stored: pad, storedDuration: 12, savedDuration: 12, savedSubId: undefined }), undefined);
  expect('nothing to carry → undefined', carryLatenessPadOnSave({ savedDuration: 5, savedSubId: 's1' }), undefined);
  const applied = applyLatenessPad(newTask({ durationDays: 10 }), pad);
  expect('apply grows the duration and stores the record', [applied.durationDays, readLatenessPad(applied)], [12, pad]);
  const reverted = revertLatenessPad(applied);
  expect('revert shrinks it back and removes the record', [reverted.durationDays, 'latenessPad' in reverted], [10, false]);
  expect('the save patch removes a stored pad explicitly (key present, undefined)', 'latenessPad' in latenessPadPatch({ stored: pad, storedDuration: 12, savedDuration: 9, savedSubId: 's1' }) && latenessPadPatch({ stored: pad, storedDuration: 12, savedDuration: 9, savedSubId: 's1' }).latenessPad === undefined, true);
  const pend = { pad, appliedDuration: 12 };
  expect<unknown>('undo an unsaved pad: duration back down, pad forgotten', releasePendingPad({ durationDays: '12', latenessPad: pend }), { durationDays: '10', latenessPad: undefined });
  expect('undo leaves a duration he typed since alone', releasePendingPad({ durationDays: '15', latenessPad: pend }).durationDays, '15');
  expect('no pending pad → unchanged', releasePendingPad({ durationDays: '7' }), { durationDays: '7' });
  const sug = latenessPadFor(entryFor(jobs([2, 2, 2])), newTask(), { paceEntry: null, offSubIds: NO_OFF })!;
  expect('padRecordFor carries the evidence', padRecordFor('s1', sug), { subId: 's1', days: 2, jobs: 3, medianOverrunDays: 2, residualOfPace: false });
}

// ── S1 supplier advisory ──────────────────────────────────────────────────
// Mutations: drop the settled minimum; match case-sensitively.
console.log('S1 supplier advisory');
{
  const cards = [
    { supplier: 'Metro Lumber', settledCount: 5, lateCount: 2, avgSlipDays: 2.5 },
    { supplier: 'New Yard', settledCount: 2, lateCount: 2, avgSlipDays: 4 },
    { supplier: 'Clean Supply', settledCount: 6, lateCount: 0, avgSlipDays: null },
  ];
  expect('case-insensitive match with 3+ settled loads', supplierAdvisoryFor('  metro  LUMBER ', cards, 3), { supplier: 'Metro Lumber', late: 2, loads: 5, avgSlipDays: 2.5 });
  expect('under the settled minimum → nothing', supplierAdvisoryFor('New Yard', cards, 3), null);
  expect('never late → nothing', supplierAdvisoryFor('Clean Supply', cards, 3), null);
  expect('blank → nothing', supplierAdvisoryFor('  ', cards, 3), null);
}

// ── V10 source guards ─────────────────────────────────────────────────────
// Mutations: restore the Contacts filter in the picker; give the chip an accent background or a hex.
console.log('V10 source guards');
{
  const root = join(__dirname, '..');
  const src = readFileSync(join(root, 'app/(tabs)/schedule/index.tsx'), 'utf8');
  const start = src.indexOf('<Text style={styles.fieldLabel}>Assign Sub</Text>');
  const end = src.indexOf('Predecessors', start);
  const block = start >= 0 && end > start ? src.slice(start, end) : '';
  expect('picker block found', block.length > 0, true);
  expect('picker no longer lists Contacts', block.includes("contacts.filter(c => c.role === 'Sub')"), false);
  expect('picker lists Subcontractors', /subcontractors\.map\(/.test(block), true);
  expect('picker carries the legacy contact chip', block.includes('(from contacts)'), true);
  expect('both save paths (edit, new) spread the pad patch', (src.match(/\.\.\.latenessPadPatch\(/g) ?? []).length, 2);
  expect('changing the sub releases a pending pad', (block.match(/releasePendingPad\(p\)/g) ?? []).length >= 2, true);
  const chip = readFileSync(join(root, 'components/schedule/LatenessPadChip.tsx'), 'utf8');
  expect('chip has no accent background', /backgroundColor:\s*[a-zA-Z.]*\.accent/.test(chip), false);
  expect('chip has no hex literal', /#[0-9a-fA-F]{3,8}\b/.test(chip), false);
  expect('chip uses the warning tokens', chip.includes('warningSoft') && chip.includes('warningLabel'), true);
  const review = readFileSync(join(root, 'app/schedule-review.tsx'), 'utf8');
  expect('review builds the lateness memo', /buildPartyLateness\(/.test(review), true);
  expect('review never auto-applies (apply only from a press)', /useEffect\([^)]*applyLatenessPad/.test(review), false);
  const card = readFileSync(join(root, 'app/sub-scorecard.tsx'), 'utf8');
  expect('scorecard writes the off switch through setPref', /setPref\(\{\s*lateness_pad_off/.test(card), true);
  expect('scorecard shows no Saved toast for a queued write', /Saved/.test(card), false);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
