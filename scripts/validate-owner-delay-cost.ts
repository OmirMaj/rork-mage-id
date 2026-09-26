// scripts/validate-owner-delay-cost.ts — pins utils/ownerDelayCost.ts and the
// two chase kinds that carry its consequence (wave 4, W2).
//
//   UNITS: the daily site cost divides by WORKING days (workingDaysInSpan over
//   the CPM span), never the calendar span and never totalDurationDays ·
//   only his own General Conditions line, else null, and no default dollar
//   figure in the source · future start → no delay · float covering the wait
//   → finish holds · critical → pushes N · dollars only with a site cost ·
//   matched_by_name prefix · no_task sentence · no start date → neededBy null ·
//   CPM refusal → "logic error" · buildChaseList without selections unchanged ·
//   a decided selection (chosen / exceeded / an isChosen option) never chases.
//
// Run: bun scripts/validate-owner-delay-cost.ts

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { ChangeOrder, LinkedEstimateItem, Project, ProjectSchedule, ScheduleTask, SelectionCategory } from '../types';
import {
  dailySiteCost, delayConsequence, scheduleCpm, NO_TASK_TEXT, LOGIC_ERROR_TEXT, NO_SITE_COST_TEXT,
} from '../utils/ownerDelayCost';
import { runCpm } from '../utils/cpm';
import { buildChaseList, chaseSummary } from '../utils/systemOfAction';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`); }
}

function task(p: Partial<ScheduleTask> & { id: string; title: string; startDay: number; durationDays: number }): ScheduleTask {
  return { phase: '', progress: 0, crew: '', dependencies: [], notes: '', status: 'not_started', ...p } as ScheduleTask;
}
function schedule(p: Partial<ProjectSchedule>): ProjectSchedule {
  return {
    id: 's', name: 'S', projectId: 'p1', startDate: '2026-06-01', workingDaysPerWeek: 5, bufferDays: 0,
    tasks: [], totalDurationDays: 0, criticalPathDays: 0, laborAlignmentScore: 0, riskItems: [], ...p,
  } as ProjectSchedule;
}
function item(p: Partial<LinkedEstimateItem>): LinkedEstimateItem {
  return {
    materialId: 'm', name: 'Line', category: 'Misc', unit: 'ls', quantity: 1, unitPrice: 0, bulkPrice: 0,
    markup: 0, usesBulk: false, lineTotal: 0, supplier: '', ...p,
  } as LinkedEstimateItem;
}
function project(p: Partial<Project>): Project {
  return { id: 'p1', name: 'Henderson', status: 'in_progress', ...p } as Project;
}

// ── §1 UNITS ──────────────────────────────────────────────────────────────
console.log('\n§1 daily site cost divides by WORKING days');
// Mon 2026-06-01, 5-day week, one 60-working-day task = 12 calendar weeks.
const longSched = schedule({
  startDate: '2026-06-01',
  tasks: [task({ id: 'long', title: 'Everything', startDay: 1, durationDays: 60 })],
  totalDurationDays: 999, // deliberately wrong: must never be read
});
const gcLine = item({ name: 'General Conditions', category: 'General Requirements', quantity: 1, unitPrice: 12600 });
const withGc = project({ schedule: longSched, linkedEstimate: { id: 'e', items: [gcLine, item({ name: 'Drywall', quantity: 100, unitPrice: 50 })], globalMarkup: 0, baseTotal: 0, markupTotal: 0, grandTotal: 0, createdAt: '' } });
{
  const cpm = runCpm(longSched.tasks, { scheduleStartDate: '2026-06-01', workingDaysPerWeek: 5 });
  ok('the CPM span is ~12 calendar weeks of CALENDAR indices (not 60)', cpm.projectFinish >= 82 && cpm.projectFinish <= 84, cpm.projectFinish);
  const site = dailySiteCost(withGc);
  ok('$12,600 ÷ 60 working days = 21000 cents/day', site?.cents === 21000, site);
  ok('the source names the real divisor', !!site && site.source.includes('$12,600 ÷ 60 working days') && site.source.startsWith('your General Conditions line'), site?.source);
  ok('not ÷ the calendar span, not ÷ totalDurationDays', site?.cents !== Math.round(1260000 / cpm.projectFinish) && site?.cents !== Math.round(1260000 / 999));
  const bulk = dailySiteCost(project({ schedule: longSched, linkedEstimate: { ...withGc.linkedEstimate!, items: [item({ name: 'Site supervision', quantity: 2, unitPrice: 9999, bulkPrice: 6300, usesBulk: true })] } }));
  ok('usesBulk prices at bulkPrice (2 × $6,300 ÷ 60 = 21000)', bulk?.cents === 21000, bulk);
  const csi = dailySiteCost(project({ schedule: longSched, linkedEstimate: { ...withGc.linkedEstimate!, items: [item({ name: 'Temp toilets', csiDivision: '01', quantity: 1, unitPrice: 6000 })] } }));
  ok("a CSI division '01' line counts (6000 ÷ 60 = $100/day)", csi?.cents === 10000, csi);
}
console.log('\n§2 only his own line — else null');
{
  ok('no GC line → null', dailySiteCost(project({ schedule: longSched, linkedEstimate: { ...withGc.linkedEstimate!, items: [item({ name: 'Drywall', quantity: 10, unitPrice: 50 })] } })) === null);
  ok('no estimate → null', dailySiteCost(project({ schedule: longSched })) === null);
  ok('no schedule → null', dailySiteCost(project({ linkedEstimate: withGc.linkedEstimate })) === null);
  ok('no schedule start date → null', dailySiteCost(project({ schedule: { ...longSched, startDate: undefined }, linkedEstimate: withGc.linkedEstimate })) === null);
  ok('no tasks → null', dailySiteCost(project({ schedule: { ...longSched, tasks: [] }, linkedEstimate: withGc.linkedEstimate })) === null);
  const cyc = schedule({ tasks: [task({ id: 'a', title: 'A', startDay: 1, durationDays: 2, dependencies: ['b'] }), task({ id: 'b', title: 'B', startDay: 3, durationDays: 2, dependencies: ['a'] })] });
  ok('a CPM refusal (cycle) → null', dailySiteCost(project({ schedule: cyc, linkedEstimate: withGc.linkedEstimate })) === null && scheduleCpm(cyc) === null);
  const src = readFileSync(join(ROOT, 'utils/ownerDelayCost.ts'), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  ok('no invented daily default (350 / 30 / dailyOverhead) in the source', !/\b350\b/.test(src) && !/dailyOverhead|avgHourlyRate/.test(src) && !/\b(DEFAULT|FALLBACK)_[A-Z_]*(COST|RATE|OVERHEAD)/.test(src));
}

// ── §3 delayConsequence ──────────────────────────────────────────────────
console.log('\n§3 delayConsequence');
// A (Mon Jun 1, 5d) → B (Mon Jun 8, 5d) on the critical path; C (Jun 1, 2d) floats.
const tA = task({ id: 'a', title: 'Demo', startDay: 1, durationDays: 5 });
const tB = task({ id: 'b', title: 'Tile', startDay: 6, durationDays: 5, dependencies: ['a'] });
const tC = task({ id: 'c', title: 'Paint', startDay: 1, durationDays: 2 });
const sched = schedule({ tasks: [tA, tB, tC] });
const cpm = scheduleCpm(sched)!;
const fB = cpm.perTask.get('b')!.totalFloat;
const fC = cpm.perTask.get('c')!.totalFloat;
ok('fixture: Tile is critical (float 0), Paint has 8 working days of float', fB === 0 && fC === 8, { fB, fC });
const site = { cents: 21000, source: 'your General Conditions line ($12,600 ÷ 60 working days)' };
{
  const r = delayConsequence({ task: tB, basis: 'linked_task', schedule: sched, cpmFloatDays: fB, today: '2026-05-20', site });
  ok('future start → "Needed by … — no delay yet", nothing pushed, no dollars', r.text === 'Needed by Jun 8 for Tile — no delay yet.' && r.pushesFinishDays === 0 && r.cents === null && r.neededBy === '2026-06-08', r);
}
{
  const r = delayConsequence({ task: tB, basis: 'linked_task', schedule: sched, cpmFloatDays: fB, today: '2026-06-11', site });
  ok('critical, 3 working days late → finish moves 3', r.pushesFinishDays === 3 && r.text.startsWith('Tile is on the critical path: finish moves 3 working days'), r);
  ok('dollars = pushes × site cents, named with the source', r.cents === 63000 && r.text.includes('about $630 in site costs (your General Conditions line ($12,600 ÷ 60 working days))'), r.text);
  const weekend = delayConsequence({ task: tB, basis: 'linked_task', schedule: sched, cpmFloatDays: fB, today: '2026-06-16', site });
  ok('a weekend inside the wait is not counted (Mon Jun 8 → Tue Jun 16 = 6)', weekend.pushesFinishDays === 6, weekend.pushesFinishDays);
}
{
  const r = delayConsequence({ task: tB, basis: 'linked_task', schedule: sched, cpmFloatDays: fB, today: '2026-06-11', site: null });
  ok('no site cost → the "add a General Conditions line" words', r.text.endsWith(NO_SITE_COST_TEXT.trimEnd()) || r.text.includes('No daily site cost on file — add a General Conditions line to see dollars.'), r.text);
  ok('no site cost → no $ and no cents', !r.text.includes('$') && r.cents === null);
}
{
  const r = delayConsequence({ task: tC, basis: 'linked_task', schedule: sched, cpmFloatDays: fC, today: '2026-06-04', site });
  ok('float covers the wait → finish holds for F − late more', r.pushesFinishDays === 0 && r.text === 'Paint has 8 days of float — finish holds for 5 more working days.' && r.cents === null, r.text);
  const used = delayConsequence({ task: tC, basis: 'linked_task', schedule: sched, cpmFloatDays: fC, today: '2026-06-15', site });
  ok('float used up → pushes late − F, with dollars', used.pushesFinishDays === 2 && used.cents === 42000 && used.text.includes('finish moves 2 working days'), used);
}
{
  const r = delayConsequence({ task: { ...tB, progress: 20 }, basis: 'linked_task', schedule: sched, cpmFloatDays: fB, today: '2026-06-11', site });
  ok('work already started → no push claimed', r.text === 'Work already started on Tile.' && r.pushesFinishDays === null && r.cents === null);
  const r2 = delayConsequence({ task: { ...tB, status: 'in_progress' }, basis: 'linked_task', schedule: sched, cpmFloatDays: fB, today: '2026-06-11', site });
  ok('status in_progress counts as started', r2.text === 'Work already started on Tile.');
}
{
  const r = delayConsequence({ task: tB, basis: 'matched_by_name', schedule: sched, cpmFloatDays: fB, today: '2026-06-11', site });
  ok('matched_by_name → "Matched by name: {task} — " prefix', r.text.startsWith('Matched by name: Tile — Tile is on the critical path'), r.text);
  const n = delayConsequence({ task: null, basis: 'no_task', schedule: sched, cpmFloatDays: null, today: '2026-06-11', site });
  ok('no_task → the "can\'t say what it holds up" sentence, never zero', n.text === NO_TASK_TEXT && n.pushesFinishDays === null && n.cents === null);
  const u = delayConsequence({ task: tB, basis: 'linked_task', schedule: { ...sched, startDate: undefined }, cpmFloatDays: fB, today: '2026-06-11', site });
  ok('no schedule start date → neededBy null (never today), no push', u.neededBy === null && u.pushesFinishDays === null && u.cents === null && !u.text.includes('Jun'), u);
  const e = delayConsequence({ task: tB, basis: 'linked_task', schedule: sched, cpmFloatDays: null, today: '2026-06-11', site });
  ok('passed start with no CPM float → "logic error", not a guess', e.text === LOGIC_ERROR_TEXT && e.cents === null && e.pushesFinishDays === null);
}

// ── §4 buildChaseList ────────────────────────────────────────────────────
console.log('\n§4 buildChaseList wiring');
const NOW = new Date(2026, 5, 11, 12, 0, 0).getTime(); // Thu Jun 11 2026, local noon
const gcProject = project({ schedule: sched, linkedEstimate: withGc.linkedEstimate });
const co = (p: Partial<ChangeOrder>) => ({ id: 'co1', projectId: 'p1', number: 7, description: 'Move the kitchen wall', status: 'submitted', date: '2026-06-01', ...p }) as unknown as ChangeOrder;
const baseInput = {
  rfis: [], submittals: [], deliveries: [], projects: [gcProject], nowMs: NOW,
  changeOrders: [co({ scheduleAnchorTaskId: 'b' }), co({ id: 'co2', number: 8, description: 'Upgrade fixtures' })],
};
const without = buildChaseList(baseInput);
const withEmpty = buildChaseList({ ...baseInput, selections: [] });
ok('selections omitted ≡ selections: [] (the list is exactly as before)', JSON.stringify(without) === JSON.stringify(withEmpty));
{
  const shape = without.map(i => [i.id, i.kind, i.daysOverdue, i.severity, i.nudge]);
  const expected = [
    ['co1', 'co_approval', 7, 'critical', 'Checking in on CO #7, sent 10 days ago. We can\'t schedule this work until it\'s approved — let us know if you have questions.'],
    ['co2', 'co_approval', 7, 'critical', 'Checking in on CO #8, sent 10 days ago. We can\'t schedule this work until it\'s approved — let us know if you have questions.'],
  ];
  ok('co_approval ids/kinds/daysOverdue (d − 3)/nudges are unchanged', JSON.stringify(shape) === JSON.stringify(expected), shape);
  const c1 = without.find(i => i.id === 'co1')!;
  ok('a CO anchored to a started-late critical task carries the consequence (10 working days on this schedule)',
    c1.consequence === 'Tile is on the critical path: finish moves 3 working days, about $3,780 in site costs (your General Conditions line ($12,600 ÷ 10 working days)).', c1.consequence);
  ok('a CO with no linked task says so', without.find(i => i.id === 'co2')!.consequence === NO_TASK_TEXT);
}
{
  const sel = (p: Partial<SelectionCategory>) => ({ id: 's1', projectId: 'p1', userId: 'u', category: 'Tile', styleBrief: '', budget: 0, status: 'pending', notes: '', displayOrder: 0, createdAt: '', updatedAt: '', dueDate: '2026-06-05', ...p }) as SelectionCategory;
  const list = buildChaseList({ ...baseInput, selections: [
    sel({}),
    sel({ id: 's2', category: 'Countertops', status: 'chosen', dueDate: '2026-05-01' }),
    sel({ id: 's3', category: 'Lighting', dueDate: '2026-06-11' }), // due today: not past
    sel({ id: 's4', category: 'Hardware', dueDate: '2026-06-20' }),
    sel({ id: 's5', category: 'Mailbox', dueDate: undefined }),
    sel({ id: 's6', category: 'Faucets', dueDate: '2026-06-09' }),
    sel({ id: 's7', category: 'Appliances', status: 'exceeded', dueDate: '2026-05-01' }),
    sel({ id: 's8', category: 'Vanity', status: 'pending', dueDate: '2026-05-01', options: [{ isChosen: false }, { isChosen: true }] as SelectionCategory['options'] }),
  ] });
  const sels = list.filter(i => i.kind === 'selection');
  ok("a 'chosen' selection never chases", !sels.some(i => i.id === 'selection:s2'));
  ok("an 'exceeded' selection (picked over the allowance) never chases", !sels.some(i => i.id === 'selection:s7'));
  ok("a 'pending' selection with an isChosen option never chases", !sels.some(i => i.id === 'selection:s8'));
  ok('only past-due, unchosen selections chase (due today / future / no date do not)', sels.map(i => i.id).sort().join() === 'selection:s1,selection:s6', sels.map(i => i.id));
  const s1 = sels.find(i => i.id === 'selection:s1')!;
  ok('selection item shape', s1.title === 'Tile selection' && s1.waitingOn === 'the owner' && s1.daysOverdue === 6 && s1.severity === 'high' && s1.route.pathname === '/selections' && s1.route.params.projectId === 'p1', s1);
  ok('selection nudge names the date and the matched task', s1.nudge === 'Checking in on the Tile selection — it was due Jun 5. We need it to keep the schedule on track for Tile.', s1.nudge);
  ok('matched by name → the prefix on its consequence', !!s1.consequence && s1.consequence.startsWith('Matched by name: Tile — '), s1.consequence);
  const s6 = sels.find(i => i.id === 'selection:s6')!;
  ok('no matching task → the no_task sentence, and no " for …" in the nudge', s6.consequence === NO_TASK_TEXT && s6.nudge.endsWith('keep the schedule on track.'), s6);
  ok('chaseSummary counts the selection kind', chaseSummary(list).byKind.selection === 2);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
