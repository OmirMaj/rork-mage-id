// scripts/validate-copilot-edit-ops.ts — pure-fn validator for the schedule
// edit-op vocabulary: the normalizer (drops junk, clamps bounds) and the
// interpreter (cycle/ref/bounds guards + partial application).
import { normalizeEditOps as normalizeDetailed, describeEditOp, describeDropped } from '../utils/copilot/scheduleEdit/editOps';
import { buildScheduleEditGrounding } from '../utils/copilot/scheduleEdit/scheduleEditGrounding';
import { mergeScheduleActions, hubOutcome } from '../utils/copilot/hubRouting';
import { isAddTaskRequest, editorSeedFor } from '../utils/copilot/scheduleEdit/addIntent';
import { interpretScheduleOps } from '../utils/copilot/scheduleEdit/interpretOps';
import type { ScheduleTask } from '../types';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// The follow-up guards run the REAL capability's mergeDraft (the code the
// copilot hook calls every turn), not a helper — the capability imports its
// React Native review view, which only renderReview uses, so it is stubbed.
type OnLoadResult = { contents: string; loader: 'ts' };
type BunPluginBuilder = { onLoad: (opts: { filter: RegExp }, cb: () => OnLoadResult) => void };
declare const Bun: { plugin: (p: { name: string; setup: (build: BunPluginBuilder) => void }) => void } | undefined;
if (typeof Bun === 'undefined') { console.error('validate-copilot-edit-ops must run under bun (needs Bun.plugin)'); process.exit(1); }
Bun!.plugin({
  name: 'stub-schedule-diff-view',
  setup(build) {
    build.onLoad({ filter: /components\/copilot\/ScheduleDiffView\.tsx$/ }, () => ({ contents: 'export default function View() { return null; }', loader: 'ts' }));
  },
});
const { scheduleEditCapability: cap } = await import('../utils/copilot/scheduleEdit/scheduleEditCapability');
type Draft = { ops: any[]; dropped?: any[] };
/** One copilot turn through the capability: `said` is the whole transcript
 *  as the hook joins it (earlier turns first, ' | '). */
const turn = (draft: Draft, answerOps: unknown[], said: string): Draft =>
  cap.mergeDraft(draft as never, { ops: answerOps }, { transcript: said, asking: null }) as Draft;
/** THE COMPLETE-DRAFT RULE: the merged draft IS the model's answer, normalized
 *  — the ops and this turn's dropped lines, nothing carried, nothing guessed. */
const isAnswer = (d: Draft, answerOps: unknown[]) => {
  const n = normalizeDetailed(answerOps);
  return JSON.stringify(d.ops) === JSON.stringify(n.ops) && JSON.stringify(d.dropped ?? []) === JSON.stringify(n.dropped);
};

// normalizeEditOps returns { ops, dropped }; the original checks read the ops.
const normalizeEditOps = (raw: unknown) => normalizeDetailed(raw).ops;

let pass = 0, fail = 0;
function ok(n: string, cond: boolean, why = '') { if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, why); } }

// --- normalizeEditOps ---
ok('non-array → []', normalizeEditOps(null).length === 0 && normalizeEditOps({}).length === 0);
ok('keeps a valid move op', normalizeEditOps([{ op: 'move', task: 't1', deltaDays: 7 }]).length === 1);
ok('drops an unknown op', normalizeEditOps([{ op: 'nuke', task: 't1' }]).length === 0);
ok('drops move with no task', normalizeEditOps([{ op: 'move', deltaDays: 3 }]).length === 0);
ok('clamps progress to 0..100', (() => {
  const o = normalizeEditOps([{ op: 'setProgress', task: 't1', pct: 250 }])[0] as any;
  return o.op === 'setProgress' && o.pct === 100;
})());
ok('drops setDuration with negative days', normalizeEditOps([{ op: 'setDuration', task: 't1', days: -4 }]).length === 0);
ok('coerces addDependency type + defaults lag 0', (() => {
  const o = normalizeEditOps([{ op: 'addDependency', from: 'a', to: 'b', type: 'SS' }])[0] as any;
  return o.type === 'SS' && o.lag === 0;
})());
ok('bad dep type → FS', (() => {
  const o = normalizeEditOps([{ op: 'addDependency', from: 'a', to: 'b', type: 'ZZ' }])[0] as any;
  return o.type === 'FS';
})());
ok('keeps level', normalizeEditOps([{ op: 'level' }]).length === 1);
ok('drops the removed setStartDate op', normalizeEditOps([{ op: 'setStartDate', iso: '2026-08-01' }]).length === 0);
ok('addTask needs a title', normalizeEditOps([{ op: 'addTask', durationDays: 3 }]).length === 0);

// --- interpretScheduleOps ---
const mk = (id: string, over: Partial<ScheduleTask> = {}): ScheduleTask => ({
  id, title: id, phase: 'P', durationDays: 5, startDay: 1, progress: 0, crew: '',
  dependencies: [], notes: '', status: 'not_started', ...over,
});
// framing(1) → rough(2, dep framing) → mep(3, dep rough)
const base = (): ScheduleTask[] => [
  mk('t1', { title: 'Framing', startDay: 1, durationDays: 5 }),
  mk('t2', { title: 'Rough-in', startDay: 6, durationDays: 4, dependencies: ['t1'] }),
  mk('t3', { title: 'MEP', startDay: 10, durationDays: 3, dependencies: ['t2'] }),
];

ok('move by delta shifts startDay', (() => {
  const { nextTasks, results } = interpretScheduleOps([{ op: 'move', task: 't1', deltaDays: 7 }], base());
  return results[0].ok && nextTasks.find(t => t.id === 't1')!.startDay === 8;
})());
ok('resolves a ref by name (case-insensitive)', (() => {
  const { results } = interpretScheduleOps([{ op: 'setDuration', task: 'framing', days: 9 }], base());
  return results[0].ok;
})());
ok('rejects an unresolved ref', (() => {
  const { results } = interpretScheduleOps([{ op: 'move', task: 'nope', deltaDays: 1 }], base());
  return !results[0].ok && !!results[0].reason;
})());
ok('addDependency rejects a cycle', (() => {
  // t1 → t2 → t3; adding t3 as a predecessor of t1 closes a loop
  const { results } = interpretScheduleOps([{ op: 'addDependency', from: 't3', to: 't1', type: 'FS', lag: 0 }], base());
  return !results[0].ok && /cycle/i.test(results[0].reason || '');
})());
ok('addDependency (no cycle) adds the link', (() => {
  const { nextTasks, results } = interpretScheduleOps([{ op: 'addDependency', from: 't1', to: 't3', type: 'FS', lag: 0 }], base());
  return results[0].ok && nextTasks.find(t => t.id === 't3')!.dependencies.includes('t1');
})());
ok('removeTask strips dangling deps', (() => {
  const { nextTasks } = interpretScheduleOps([{ op: 'removeTask', task: 't2' }], base());
  return !nextTasks.find(t => t.id === 't2') && !nextTasks.find(t => t.id === 't3')!.dependencies.includes('t2');
})());
ok('addTask appends after a ref', (() => {
  const { nextTasks } = interpretScheduleOps([{ op: 'addTask', title: 'Cabinet procurement', durationDays: 10, after: 't1' }], base());
  return nextTasks.length === 4 && !!nextTasks.find(t => t.title === 'Cabinet procurement');
})());
ok('setCrew writes crewSize', (() => {
  const { nextTasks } = interpretScheduleOps([{ op: 'setCrew', task: 't1', crewSize: 6 }], base());
  return nextTasks.find(t => t.id === 't1')!.crewSize === 6;
})());
ok('partial application: valid applies, invalid reported', (() => {
  const { nextTasks, results } = interpretScheduleOps([
    { op: 'setDuration', task: 't1', days: 9 },
    { op: 'move', task: 'ghost', deltaDays: 2 },
  ], base());
  return nextTasks.find(t => t.id === 't1')!.durationDays === 9 && results[0].ok && !results[1].ok;
})());

// --- honest acknowledgement + chaining (audit 2026-09-23, "only 1 acknowledged") ---
console.log('\ndropped ops are reported, never silent');
ok('an unusable op is counted in `dropped` with a reason', (() => {
  const r = normalizeDetailed([{ op: 'addTask', title: 'Drywall hang', durationDays: 4 }, { op: 'addTask', durationDays: 3 }, { op: 'nuke', task: 't1' }]);
  return r.ops.length === 1 && r.dropped.length === 2 && r.dropped.every(d => d.summary.length > 0);
})());
ok('a 0-day move is dropped (it changes nothing), with a reason', (() => {
  const r = normalizeDetailed([{ op: 'move', task: 't1', deltaDays: 0 }]);
  return r.ops.length === 0 && r.dropped.length === 1 && /amount/.test(r.dropped[0].summary);
})());
ok('toStartDay 0 (a forced-empty field) is not "move to day 1"', (() => {
  const o = normalizeEditOps([{ op: 'move', task: 't1', deltaDays: 7, toStartDay: 0 }])[0] as any;
  return o.deltaDays === 7 && o.toStartDay === undefined;
})());

console.log('\nplaceholder refs (the schema example) never touch a real task');
ok('a pure echo of the example (every ref a placeholder) is dropped without a line', (() => {
  const r = normalizeDetailed([{ op: 'move', task: '<task id>', deltaDays: 7 }, { op: 'addTask', title: '<new task title>', durationDays: 3, after: '<task id>' }]);
  return r.ops.length === 0 && r.dropped.length === 0;
})());
ok('a real add with a placeholder `after` is dropped AND reported', (() => {
  const r = normalizeDetailed([{ op: 'addTask', title: 'Drywall hang', durationDays: 4, after: '<task id>' }]);
  return r.ops.length === 0 && r.dropped.length === 1 && /position/.test(r.dropped[0].summary);
})());
ok('a dependency with one placeholder end is dropped', normalizeEditOps([{ op: 'addDependency', from: 't1', to: '<task id>', type: 'FS', lag: 0 }]).length === 0);

console.log('\nan `after` that names nothing fails — it does not land at the end');
ok('unresolved after → ok:false "no task matching", nothing added', (() => {
  const { nextTasks, results } = interpretScheduleOps([{ op: 'addTask', title: 'Drywall', durationDays: 4, after: 'Plastering' }], base());
  return !results[0].ok && /no task matching/.test(results[0].reason ?? '') && nextTasks.length === 3;
})());

console.log('\nsame-anchor adds chain in the order spoken and push what follows');
const three = [
  { op: 'addTask' as const, title: 'Drywall hang', durationDays: 4, after: 't2' },
  { op: 'addTask' as const, title: 'Drywall tape', durationDays: 3, after: 't2' },
  { op: 'addTask' as const, title: 'Prime and paint', durationDays: 5, after: 't2' },
];
ok('three adds all "after rough-in" land hang → tape → paint, in that order', (() => {
  const { nextTasks, results } = interpretScheduleOps(three, base());
  const i = (t: string) => nextTasks.findIndex(x => x.title === t);
  const id = (t: string) => nextTasks.find(x => x.title === t)!.id;
  return results.every(r => r.ok) && i('Rough-in') < i('Drywall hang') && i('Drywall hang') < i('Drywall tape') && i('Drywall tape') < i('Prime and paint')
    && nextTasks.find(x => x.title === 'Drywall tape')!.dependencies[0] === id('Drywall hang')
    && nextTasks.find(x => x.title === 'Prime and paint')!.dependencies[0] === id('Drywall tape');
})());
ok("the anchor's FS successor (MEP) now waits on the LAST new task", (() => {
  const { nextTasks } = interpretScheduleOps(three, base());
  const paint = nextTasks.find(x => x.title === 'Prime and paint')!.id;
  return JSON.stringify(nextTasks.find(x => x.id === 't3')!.dependencies) === JSON.stringify([paint]);
})());
ok('"in parallel": each hangs off the anchor, successors untouched', (() => {
  const { nextTasks } = interpretScheduleOps(three.map(o => ({ ...o, parallel: true })), base());
  return nextTasks.filter(x => x.dependencies.includes('t2')).length === 4 // MEP + 3 new
    && JSON.stringify(nextTasks.find(x => x.id === 't3')!.dependencies) === '["t2"]';
})());
ok('an SS successor of the anchor is left alone', (() => {
  const ss = base().map(t => t.id === 't3' ? { ...t, dependencyLinks: [{ taskId: 't2', type: 'SS' as const, lagDays: 0 }] } : t);
  const { nextTasks } = interpretScheduleOps([three[0]], ss);
  return JSON.stringify(nextTasks.find(x => x.id === 't3')!.dependencies) === '["t2"]';
})());
ok('a second session repeating the same adds chains onto its own new rows (no "could mean 2 tasks")', (() => {
  const chained = [three[0], { ...three[1], after: 'Drywall hang' }, { ...three[2], after: 'Drywall tape' }];
  const once = interpretScheduleOps(chained, base()).nextTasks;
  const { nextTasks, results } = interpretScheduleOps(chained, once);
  return results.every(r => r.ok) && new Set(nextTasks.map(t => t.id)).size === nextTasks.length && nextTasks.length === 9;
})());

console.log('\nambiguous references are refused with the candidates named');
ok('"rough-in" matching 3 tasks → refused, names listed', (() => {
  const tasks = [mk('a', { title: 'Plumbing rough-in' }), mk('b', { title: 'Electrical rough-in' }), mk('c', { title: 'Rough-in inspection' })];
  const { results } = interpretScheduleOps([{ op: 'setDuration', task: 'rough-in', days: 3 }], tasks);
  return !results[0].ok && /could mean/.test(results[0].reason ?? '') && /Plumbing rough-in/.test(results[0].reason ?? '');
})());
ok('a unique substring still resolves', interpretScheduleOps([{ op: 'setDuration', task: 'frami', days: 3 }], base()).results[0].ok);

console.log('\nfollow-up turns replace, never double, what is queued');
ok('a follow-up answer (the complete list) replaces the draft: 3 ops, the hang now 5d', (() => {
  const d1 = turn({ ops: [] }, [{ op: 'addTask', title: 'Drywall hang', durationDays: 4, after: 't2' }, { op: 'move', task: 't1', deltaDays: 7 }], 'add drywall hang after rough-in and push framing a week');
  const a2 = [{ op: 'addTask', title: 'Drywall hang', durationDays: 5, after: 't2' }, { op: 'move', task: 't1', deltaDays: 7 }, { op: 'setDuration', task: 't3', days: 2 }];
  const d2 = turn(d1, a2, 'add drywall hang after rough-in and push framing a week | make the hang 5 days and MEP 2 days');
  return d2.ops.length === 3 && (d2.ops[0] as any).durationDays === 5 && isAnswer(d2, a2);
})());
ok('a dropped line is cleared once a later turn lands that change', (() => {
  const d1 = turn({ ops: [] }, [{ op: 'setDuration', task: 't3' }], 'shorten MEP');
  const d2 = turn(d1, [{ op: 'setDuration', task: 't3', days: 2 }], 'shorten MEP | to 2 days');
  return (d1.dropped ?? []).length === 1 && (d2.dropped ?? []).length === 0 && d2.ops.length === 1;
})());
ok('an answer with no ops array (off-schema) keeps what is queued', (() => {
  const d1 = turn({ ops: [] }, [{ op: 'setDuration', task: 't3', days: 2 }], 'MEP 2 days');
  return cap.mergeDraft(d1 as never, {}, { transcript: 'MEP 2 days | hmm', asking: null }) === (d1 as never);
})());

console.log('\nsame-named adds are separate tasks (integration round 2)');
{
  // Job names repeat — "Inspection", "Cleanup", "Delivery". opKey keyed an add
  // by title alone and the old merge collapsed ops INSIDE one answer, so three
  // inspections came back as "Understood 1 change", "+1" — the founder's bug.
  const threeInspections = [
    { op: 'addTask', title: 'Inspection', durationDays: 1, after: 't1' },
    { op: 'addTask', title: 'Inspection', durationDays: 1, after: 't2' },
    { op: 'addTask', title: 'Inspection', durationDays: 1, after: 't3' },
  ];
  const d = turn({ ops: [] }, threeInspections, 'add an inspection after framing, rough-in and MEP') as { ops: any[]; dropped: any[] };
  const { results, nextTasks } = interpretScheduleOps(d.ops, base());
  const added = nextTasks.filter(t => !base().some(b => b.id === t.id));
  // ScheduleDiffView: total = ops + dropped; "Apply N" counts ok results.
  const total = d.ops.length + d.dropped.length;
  const okCount = results.filter(r => r.ok).length;
  ok('3 same-titled adds in one answer → 3 queued ops', d.ops.length === 3);
  ok('…3 interpreted, 3 new rows, each after its own anchor', okCount === 3 && added.length === 3
    && JSON.stringify(added.map(t => t.dependencies[0]).sort()) === '["t1","t2","t3"]');
  ok('…the review reads "Understood 3 changes" and "Apply 3 changes"', total === 3 && okCount === total);
  const c1 = { op: 'addTask', title: 'Cleanup', durationDays: 1, after: 't1' };
  const turn1 = turn({ ops: [] }, [c1], 'add a cleanup after framing');
  const turn2 = turn(turn1, [c1, { op: 'addTask', title: 'Cleanup', durationDays: 1, after: 't2' }], 'add a cleanup after framing | and another cleanup after rough-in');
  ok('"another cleanup after rough-in" on a follow-up ADDS a second one (2 queued)', turn2.ops.length === 2);
  const again = turn(turn2, [c1, { op: 'addTask', title: 'Cleanup', durationDays: 2, after: 't2' }], 'add a cleanup after framing | and another cleanup after rough-in | make that one 2 days');
  ok('…while re-stating the same add at the same anchor still replaces it', again.ops.length === 2 && (again.ops[1] as any).durationDays === 2);
  // The founder-shaped sentence: "add a 1-day cleanup after framing, drywall
  // and paint" — three adds named Cleanup, anchored by TITLE.
  const job = [mk('f', { title: 'Framing', startDay: 1, durationDays: 5 }), mk('d', { title: 'Drywall', startDay: 6, durationDays: 4, dependencies: ['f'] }), mk('p', { title: 'Paint', startDay: 10, durationDays: 3, dependencies: ['d'] })];
  const cleanups = turn({ ops: [] }, ['framing', 'drywall', 'paint'].map((after) => ({ op: 'addTask', title: 'Cleanup', durationDays: 1, after })), 'add a 1-day cleanup after framing, drywall and paint') as { ops: any[]; dropped: any[] };
  const cr = interpretScheduleOps(cleanups.ops, job);
  const crAdded = cr.nextTasks.filter((t) => !job.some((b) => b.id === t.id));
  ok('"cleanup after framing, drywall and paint" → 3 adds, 3 rows, "Apply 3 changes"',
    cleanups.ops.length === 3 && cleanups.dropped.length === 0 && cr.results.filter((r) => r.ok).length === 3 && crAdded.length === 3
    && new Set(crAdded.map((t) => t.id)).size === 3);
  const sameTurnMoves = turn({ ops: [] }, [{ op: 'move', task: 't1', deltaDays: 3 }, { op: 'move', task: 't1', deltaDays: 2 }], 'push framing 3 days, then 2 more');
  ok('ops inside ONE answer are never collapsed into each other', sameTurnMoves.ops.length === 2);
}

console.log('\nthe AI drawer hands "add tasks" to the editor, keeps edits');
ok('add requests are recognised', ['Add three tasks after rough-in: drywall hang 4 days, drywall tape 3 days', 'Add a punch walk milestone', 'insert a cure period between slab and framing', 'create a new task for cabinets'].every(isAddTaskRequest));
ok('edits that say "add" are not', !['add 2 days to framing', 'add a crew to framing', 'Add 10% to each duration', 'add one more day to drywall', 'Move them all out by one week', 'We finished the foundation today'].some(isAddTaskRequest));
ok('the seed carries the selected rows', editorSeedFor('Add drywall after these', ['Framing', 'Rough-in']) === 'Add drywall after these (selected: Framing, Rough-in)');

console.log('\nthe "what landed" lines say what actually happened (integration round 1)');
{
  const tasks = [mk('t1', { title: 'Framing' }), mk('t2', { title: 'Rough-in inspection', dependencies: ['t1'] }), mk('t3', { title: 'Cabinets', dependencies: ['t2'] })];
  const sameAnchor = [
    { op: 'addTask' as const, title: 'Drywall hang', durationDays: 4, after: 't2' },
    { op: 'addTask' as const, title: 'Drywall tape', durationDays: 3, after: 't2' },
    { op: 'addTask' as const, title: 'Prime and paint', durationDays: 5, after: 't2' },
  ];
  const { results, nextTasks } = interpretScheduleOps(sameAnchor, tasks);
  const named = [...tasks, ...nextTasks.filter(t => !tasks.some(b => b.id === t.id))];
  const lines = results.map(r => describeEditOp(r.op, named, { anchorTitle: r.anchorTitle }));
  ok('same-anchor adds are described CHAINED, as they landed', lines[0] === 'Added Drywall hang (4d) after Rough-in inspection'
    && lines[1] === 'Added Drywall tape (3d) after Drywall hang' && lines[2] === 'Added Prime and paint (5d) after Drywall tape');
  const upper = [sameAnchor[0], { ...sameAnchor[1], after: 'DRYWALL HANG' }];
  const r2 = interpretScheduleOps(upper, tasks);
  const named2 = [...tasks, ...r2.nextTasks.filter(t => !tasks.some(b => b.id === t.id))];
  ok('a title ref prints in the schedule\'s casing, not the model\'s', describeEditOp(r2.results[1].op, named2, { anchorTitle: r2.results[1].anchorTitle }) === 'Added Drywall tape (3d) after Drywall hang');
  ok('without detail, a title ref still resolves to the real casing', describeEditOp({ op: 'setDuration', task: 'CABINETS', days: 2 }, tasks) === 'Cabinets is now 2d');

  const amb = [mk('a', { title: 'Plumbing rough-in' }), mk('b', { title: 'Electrical rough-in' })];
  const chained = [
    { op: 'addTask' as const, title: 'Drywall hang', durationDays: 4, after: 'rough-in' },
    { op: 'addTask' as const, title: 'Drywall tape', durationDays: 3, after: 'Drywall hang' },
  ];
  const r3 = interpretScheduleOps(chained, amb).results;
  ok('an add whose anchor was never placed says so (not "no task matching")', !r3[0].ok && /could mean/.test(r3[0].reason ?? '')
    && !r3[1].ok && /which wasn't added/.test(r3[1].reason ?? '') && !/no task matching/.test(r3[1].reason ?? ''));

  const uuid = '3f2c9a1e-8b7d-4c6a-9e21-0d5f4b3a2c1e';
  const withUuid = [mk(uuid, { title: 'Insulation' })];
  const d = normalizeDetailed([{ op: 'setDuration', task: uuid, days: -3 }]).dropped[0];
  ok('a couldn\'t-read line names the task by title, not its UUID', describeDropped(d, withUuid) === 'setDuration “Insulation” — no valid duration' && !describeDropped(d, withUuid).includes(uuid));
  ok('an unresolved ref prints as sent', describeDropped(d, []) === d.summary);
}

console.log('\nthe hub keeps a multi-part schedule request whole');
{
  const utter = 'Add three tasks after rough-in: drywall hang 4 days, drywall tape 3 days, prime and paint 5 days';
  const split = [
    { capabilityId: 'schedule' as const, text: 'add drywall hang 4 days after rough-in', label: 'Add drywall hang' },
    { capabilityId: 'schedule' as const, text: 'drywall tape 3 days', label: 'Drywall tape' },
    { capabilityId: 'schedule' as const, text: 'prime and paint 5 days', label: 'Paint' },
  ];
  const o = hubOutcome({ actions: split }, utter);
  ok('three schedule fragments → ONE route seeded with the whole utterance', o.kind === 'route' && o.action.capabilityId === 'schedule' && o.action.text === utter);
  const mixed = mergeScheduleActions([split[0], { capabilityId: 'rfi', text: 'RFI on the beam', label: 'RFI' }, split[1]], utter);
  ok('mixed with another action: one schedule card (fragments in order) + the other card', mixed.length === 2 && mixed[0].capabilityId === 'schedule'
    && mixed[0].text === 'add drywall hang 4 days after rough-in; drywall tape 3 days' && mixed[1].capabilityId === 'rfi');
  ok('a single schedule action is untouched', mergeScheduleActions([split[0]], utter)[0].text === split[0].text);
}

console.log('\na placeholder only counts in a field the op READS (review round 3)');
{
  // Written for the wave-6a union schema (every item declared task/from/to/
  // after/title, only `op` required — rolled back live 2026-09-23). The anyOf
  // schema declares only each op's own slots, but the production relay
  // (6065b326, val[0] = move) still forces `task` onto every op, so a decoder
  // that fills an unused slot with the example's placeholder must not cost
  // him a complete op.
  const kept = (o: Record<string, unknown>) => normalizeDetailed([o]).ops.length === 1;
  ok('addTask with task:"<task id>" in the unused slot is KEPT', kept({ op: 'addTask', title: 'Drywall hang', durationDays: 4, after: 't1', task: '<task id>' }));
  ok('addTask with from/to placeholders is KEPT', kept({ op: 'addTask', title: 'Drywall hang', durationDays: 4, after: 't1', from: '<task id>', to: '<task id>' }));
  ok('move with an `after` placeholder is KEPT', kept({ op: 'move', task: 't2', deltaDays: 7, after: '<task id, or the exact title of a task you added just before>' }));
  ok('move with a `title` placeholder is KEPT', kept({ op: 'move', task: 't2', deltaDays: 7, title: '<new task title>' }));
  ok('addDependency with task/title/after placeholders is KEPT', kept({ op: 'addDependency', from: 't1', to: 't3', type: 'FS', lag: 0, task: '<task id>', title: '<new task title>', after: '<task id>' }));
  const own = normalizeDetailed([{ op: 'move', task: '<task id>', deltaDays: 7, title: 'Drywall' }]);
  ok('…while a placeholder in the field the op reads is still an echo (dropped, no line)', own.ops.length === 0 && own.dropped.length === 0);
  const half = normalizeDetailed([{ op: 'addTask', title: 'Drywall hang', durationDays: 4, after: '<task id>', task: '<task id>' }]);
  ok('…and a real add with a placeholder anchor is reported, named by its title', half.ops.length === 0 && half.dropped.length === 1 && half.dropped[0].summary === 'addTask “Drywall hang” — no position given for the new task');
}

console.log('\na move CPM would ignore is not counted as a change (review round 3)');
{
  // Framing 1–10 → Drywall (waits on Framing) → Paint.
  const job = [mk('f', { title: 'Framing', startDay: 1, durationDays: 10 }), mk('d', { title: 'Drywall', startDay: 11, durationDays: 4, dependencies: ['f'] }), mk('p', { title: 'Paint', startDay: 15, durationDays: 3, dependencies: ['d'] })];
  const earlier = interpretScheduleOps([{ op: 'move', task: 'd', deltaDays: -5 }], job);
  ok('"pull drywall in 5 days" while it waits on framing → not applied', !earlier.results[0].ok);
  ok('…says which task holds it and when that finishes', earlier.results[0].reason === '“Drywall” waits on “Framing” (finishes day 10) — shorten “Framing” or unlink it');
  ok('…and writes nothing (startDay restored)', earlier.nextTasks.find((t) => t.id === 'd')!.startDay === 11);
  ok('"move drywall to day 3" → not applied either', !interpretScheduleOps([{ op: 'move', task: 'd', toStartDay: 3 }], job).results[0].ok);
  const later = interpretScheduleOps([{ op: 'move', task: 'd', deltaDays: 7 }], job);
  ok('"push drywall a week" still lands (+7 → day 18)', later.results[0].ok && later.nextTasks.find((t) => t.id === 'd')!.startDay === 18);
  ok('"move drywall to day 20" still lands', interpretScheduleOps([{ op: 'move', task: 'd', toStartDay: 20 }], job).results[0].ok);
  ok('pulling in a task with no predecessor lands', interpretScheduleOps([{ op: 'move', task: 'f', toStartDay: 1 }], [mk('f', { title: 'Framing', startDay: 4 })]).results[0].ok);
  const both = interpretScheduleOps([{ op: 'removeDependency', from: 'f', to: 'd' }, { op: 'move', task: 'd', toStartDay: 3 }], job);
  ok('unlink framing, THEN pull drywall to day 3 → both land', both.results.every((r) => r.ok) && both.nextTasks.find((t) => t.id === 'd')!.startDay === 3);
  const src = readFileSync(join(ROOT, 'utils/copilot/scheduleEdit/scheduleEditCapability.ts'), 'utf8');
  const view = readFileSync(join(ROOT, 'components/copilot/ScheduleDiffView.tsx'), 'utf8');
  ok('the review and Apply check on the HOST\'s calendar (ctx.cpmOptions)',
    /interpretScheduleOps\(ops, before, ctx\.cpmOptions \?\? \{\}\)/.test(view)
    && (src.match(/interpretScheduleOps\(ops, (before|prev), ctx\.cpmOptions \?\? \{\}\)/g) ?? []).length === 2);
  ok('"nothing waits on it yet" is keyed by task id, not title', /loose\.has\(a\.id\)/.test(view) && !/loose\.has\(a\.name\)/.test(view));
  const { diffSchedule } = await import('../utils/copilot/scheduleEdit/diffSchedule');
  const { runCpm } = await import('../utils/cpm');
  const job3 = [mk('f', { title: 'Framing', startDay: 1, durationDays: 5 }), mk('d', { title: 'Drywall', startDay: 6, durationDays: 4, dependencies: ['f'] }), mk('p', { title: 'Paint', startDay: 10, durationDays: 3, dependencies: ['d'] })];
  const three = interpretScheduleOps(['f', 'd', 'p'].map((after) => ({ op: 'addTask' as const, title: 'Cleanup', durationDays: 1, after })), job3).nextTasks;
  const dd = diffSchedule(job3, three, runCpm(job3, {}), runCpm(three, {}));
  // ScheduleDiffView's rule over the diff's own ids.
  const loose = new Set(dd.added.map((a) => a.id).filter((id) => !three.some((t) => t.dependencies.includes(id))));
  ok('three "Cleanup" rows: only the one nothing waits on is flagged (1 of 3)', dd.added.length === 3 && dd.added.every((a) => typeof a.id === 'string') && loose.size === 1);
}

console.log('\nmoves: counted from the SCHEDULED start, judged by where the task ends up (review round 4)');
{
  // Framing (1, 10d) → Drywall hang (11, 4d) → Prime and paint (15, 5d): a
  // generated schedule, no slack between tasks.
  const chain = () => [mk('f', { title: 'Framing', startDay: 1, durationDays: 10 }), mk('d', { title: 'Drywall hang', startDay: 11, durationDays: 4, dependencies: ['f'] }), mk('p', { title: 'Prime and paint', startDay: 15, durationDays: 5, dependencies: ['d'] })];
  const { runCpm } = await import('../utils/cpm');
  const es = (ts: ScheduleTask[], id: string) => runCpm(ts, {}).perTask.get(id)!.es;
  const describe = (r: ReturnType<typeof interpretScheduleOps>, before: ScheduleTask[]) => {
    const named = [...before, ...r.nextTasks.filter((t) => !before.some((b) => b.id === t.id))];
    return r.results.filter((x) => x.ok).map((x) => describeEditOp(x.op, named, x));
  };
  const c = chain();
  const three = interpretScheduleOps(['f', 'd', 'p'].map((task) => ({ op: 'move' as const, task, deltaDays: 7 })), c);
  ok('"push framing, drywall and paint a week" → 3 of 3 land', three.results.filter((r) => r.ok).length === 3);
  ok('…each starts exactly a week later (8 / 18 / 22), not drywall +14', es(three.nextTasks, 'f') === 8 && es(three.nextTasks, 'd') === 18 && es(three.nextTasks, 'p') === 22);
  ok('…and the what-landed lines say so', JSON.stringify(describe(three, c)) === JSON.stringify(['Moved Framing to day 8 (was day 1)', 'Moved Drywall hang to day 18 (was day 11)', 'Moved Prime and paint to day 22 (was day 15)']));
  // The daily-report delay preview: one move per hit task (daily-report.tsx).
  const delay = interpretScheduleOps([{ op: 'move', task: 'f', deltaDays: 2 }, { op: 'move', task: 'd', deltaDays: 2 }], c);
  ok('a two-hit delay preview (framing +2, drywall +2) → 2 of 2', delay.results.filter((r) => r.ok).length === 2 && es(delay.nextTasks, 'd') === 13);
  const longer = interpretScheduleOps([{ op: 'setDuration', task: 'f', days: 13 }, { op: 'move', task: 'd', deltaDays: 3 }], c);
  ok('"framing 3 days longer + push drywall 3 days" → 2 of 2', longer.results.every((r) => r.ok));
  const pull = interpretScheduleOps([{ op: 'move', task: 'd', deltaDays: -3 }], c);
  ok('a −3 pull that framing holds is still refused, with the pull advice', !pull.results[0].ok && /waits on “Framing”.*shorten/.test(pull.results[0].reason ?? ''));
  const shortened = interpretScheduleOps([{ op: 'setDuration', task: 'f', days: 5 }, { op: 'move', task: 'd', deltaDays: -5 }], c);
  ok('framing shortened by 5 + drywall pulled in 5 → 2 of 2 (drywall starts day 6)', shortened.results.every((r) => r.ok) && es(shortened.nextTasks, 'd') === 6);

  // Schedule Pro commits rows as they are (no CPM write-back), so after the
  // founder's 3-task add every later task's pin sits ~12 days behind its bar.
  const job = () => [
    mk('t1', { title: 'Demo & site prep', startDay: 1, durationDays: 3 }), mk('t2', { title: 'Framing', startDay: 4, durationDays: 8, dependencies: ['t1'] }),
    mk('t3', { title: 'Rough-in (MEP)', startDay: 12, durationDays: 6, dependencies: ['t2'] }), mk('t4', { title: 'Insulation', startDay: 18, durationDays: 2, dependencies: ['t3'] }),
    mk('t5', { title: 'Cabinets & countertops', startDay: 20, durationDays: 5, dependencies: ['t4'] }), mk('t6', { title: 'Trim & finish carpentry', startDay: 25, durationDays: 4, dependencies: ['t5'] }),
  ];
  const adds = [
    { op: 'addTask' as const, title: 'Drywall hang', durationDays: 4, after: 't3' },
    { op: 'addTask' as const, title: 'Drywall tape', durationDays: 3, after: 'Drywall hang' },
    { op: 'addTask' as const, title: 'Prime and paint', durationDays: 5, after: 'Drywall tape' },
  ];
  const committed = interpretScheduleOps(adds, job()).nextTasks; // written verbatim
  ok('(setup) after the add, Cabinets is pinned day 20 but scheduled day 32', committed.find((t) => t.id === 't5')!.startDay === 20 && es(committed, 't5') === 32);
  const push = interpretScheduleOps([{ op: 'move', task: 't5', deltaDays: 7 }], committed);
  ok('then "push cabinets back a week" lands: Cabinets 32 → 39', push.results[0].ok && es(push.nextTasks, 't5') === 39);
  ok('…and the landed line equals the ripple', JSON.stringify(describe(push, committed)) === JSON.stringify(['Moved Cabinets & countertops to day 39 (was day 32)']));
  const trim = interpretScheduleOps([{ op: 'move', task: 't6', deltaDays: 14 }], committed);
  ok('"push trim two weeks" moves trim 14 days (37 → 51), not 2', trim.results[0].ok && es(trim.nextTasks, 't6') === 51);
  const oneReq = interpretScheduleOps([...adds, { op: 'move', task: 't5', deltaDays: 7 }], job());
  ok('the 3 adds + "push cabinets a week" in ONE request → 4 of 4, Cabinets day 39', oneReq.results.every((r) => r.ok) && es(oneReq.nextTasks, 't5') === 39);
  const pull3 = interpretScheduleOps([{ op: 'move', task: 't5', deltaDays: -3 }], committed);
  ok('…while a −3 pull behind Insulation is still refused', !pull3.results[0].ok && /waits on “Insulation”/.test(pull3.results[0].reason ?? ''));
  const g = await buildScheduleEditGrounding({ currentTasks: committed, cpmOptions: {} } as never);
  ok('the grounding lists the SCHEDULED start (Cabinets day 32), not the pin', (g.data.taskList as string[]).some((l) => /"Cabinets & countertops" start day 32,/.test(l)));
}

console.log('\nTHE COMPLETE-DRAFT RULE: every follow-up answer replaces the draft (integration round 6)');
{
  // Five review rounds circled a merge that guessed, from word lists
  // (ANOTHER_RE), whether a re-sent add was a correction or another one. The
  // prompt now asks for the COMPLETE list every turn and mergeDraft adopts it,
  // so each case below is "the draft is exactly the answer".
  const prompt = cap.buildTurnPrompt({ transcript: 'x', draft: { ops: [] }, grounding: { facts: [], data: { taskList: [] } } as never, asking: null }).prompt;
  ok('the prompt asks for the COMPLETE list of ops for everything asked so far, which REPLACES the draft',
    /Return the COMPLETE list of ops for EVERYTHING they have asked for so far/.test(prompt) && /REPLACES the draft/.test(prompt)
    && /leave out anything they took back/.test(prompt));
  ok('…and no longer says "return only NEW ops"', !/only NEW ops/i.test(prompt));

  // Rough-in (1st floor) → Rough-in inspection → Rough-in (2nd floor) → Cabinets.
  const job = [
    mk('p', { title: 'Rough-in (1st floor)', startDay: 1, durationDays: 5 }),
    mk('i', { title: 'Rough-in inspection', startDay: 6, durationDays: 1, dependencies: ['p'] }),
    mk('s', { title: 'Rough-in (2nd floor)', startDay: 7, durationDays: 5, dependencies: ['i'] }),
    mk('c', { title: 'Cabinets', startDay: 12, durationDays: 4, dependencies: ['s'] }),
  ];
  const chainAfter = (after: string, paintDays = 5) => [
    { op: 'addTask', title: 'Drywall hang', durationDays: 4, after },
    { op: 'addTask', title: 'Drywall tape', durationDays: 3, after: 'Drywall hang' },
    { op: 'addTask', title: 'Prime and paint', durationDays: paintDays, after: 'Drywall tape' },
  ];
  const FIRST = 'Add three tasks after rough-in: drywall hang 4 days, drywall tape 3 days, prime and paint 5 days';
  const t1 = turn({ ops: [] }, chainAfter('p'), FIRST);
  ok('(setup) turn 1 queues the 3 adds after the 1st-floor rough-in', t1.ops.length === 3 && isAnswer(t1, chainAfter('p')));

  // Round-5 critics: each of these reached ANOTHER_RE ("too", "also", "as
  // well", "second") and the re-sent chain was APPENDED — two Drywall hangs,
  // tape and paint left on the wrong anchor.
  const corrections: [string, string, number][] = [
    ['no, put them after the rough-in inspection', 'i', 5],
    ['no, that is too early — put them after the rough-in inspection', 'i', 5],
    ['Put them after the rough-in inspection too', 'i', 5],
    ['no, put them after the rough-in inspection, and also make the paint 6 days', 'i', 6],
    ['no, put them after the inspection. Paint is 6 days as well', 'i', 6],
    ['they should also wait for the inspection', 'i', 5],
    ['no, after the second floor rough-in', 's', 5],
  ];
  for (const [said, anchor, paint] of corrections) {
    const answer = chainAfter(anchor, paint);
    const d = turn(t1, answer, `${FIRST} | ${said}`);
    const r = interpretScheduleOps(d.ops, job);
    const added = r.nextTasks.filter((t) => !job.some((b) => b.id === t.id));
    const by = (title: string) => added.find((t) => t.title === title);
    ok(`"${said}" → the draft IS the answer: 3 ops, 3 new rows, chained after ${anchor === 'i' ? 'the inspection' : 'the 2nd-floor rough-in'}`,
      isAnswer(d, answer) && d.ops.length === 3 && added.length === 3 && r.results.every((x) => x.ok)
      && by('Drywall hang')?.dependencies.join() === anchor && by('Drywall tape')?.dependencies.join() === by('Drywall hang')?.id
      && by('Prime and paint')?.dependencies.join() === by('Drywall tape')?.id && by('Prime and paint')?.durationDays === paint);
  }

  // "another set of the same three": the model returns BOTH chains (6 ops);
  // the old key match collapsed the second chain's tape and paint (4 ops).
  const six = [...chainAfter('p'), ...chainAfter('s')];
  const d6 = turn(t1, six, `${FIRST} | and add another set of the same three after the second floor rough-in`);
  const r6 = interpretScheduleOps(d6.ops, job);
  const added6 = r6.nextTasks.filter((t) => !job.some((b) => b.id === t.id));
  const hangs = added6.filter((t) => t.title === 'Drywall hang');
  const tapes = added6.filter((t) => t.title === 'Drywall tape');
  ok('"another set of the same three after the second floor rough-in" → 6 ops, 6 new rows, two separate chains',
    isAnswer(d6, six) && d6.ops.length === 6 && r6.results.every((x) => x.ok) && added6.length === 6
    && hangs.map((h) => h.dependencies.join()).sort().join() === 'p,s'
    && tapes.every((t) => hangs.some((h) => h.id === t.dependencies[0])) && new Set(tapes.map((t) => t.dependencies[0])).size === 2);

  // Same-named additions at a new anchor, with no "another": the title-only
  // match REPLACED the framing inspection (1 op, the first request gone).
  const fr = [mk('f', { title: 'Framing', startDay: 1, durationDays: 5 }), mk('d', { title: 'Drywall hang', startDay: 6, durationDays: 4, dependencies: ['f'] }), mk('pt', { title: 'Paint', startDay: 10, durationDays: 3, dependencies: ['d'] })];
  const insp1 = { op: 'addTask', title: 'Inspection', durationDays: 1, after: 'f' };
  const q1 = turn({ ops: [] }, [insp1], 'add a 1 day inspection after framing');
  for (const said of ['add a 1 day inspection after drywall', 'and an inspection after drywall hang']) {
    const answer = [insp1, { op: 'addTask', title: 'Inspection', durationDays: 1, after: 'd' }];
    const q2 = turn(q1, answer, `add a 1 day inspection after framing | ${said}`);
    const rq = interpretScheduleOps(q2.ops, fr);
    const insps = rq.nextTasks.filter((t) => t.title === 'Inspection');
    ok(`"${said}" while one is queued after framing → both kept (2 ops, 2 rows)`,
      isAnswer(q2, answer) && q2.ops.length === 2 && insps.length === 2 && insps.map((t) => t.dependencies.join()).sort().join() === 'd,f');
  }

  // A take-back: the model leaves the paint out, so it is not applied.
  const back = chainAfter('i').slice(0, 2);
  const dr = turn(turn({ ops: [] }, chainAfter('i'), FIRST), back, `${FIRST} | actually drop the paint, just hang and tape`);
  ok('"drop the paint" → the draft is the answer (2 ops) and no paint row is written',
    isAnswer(dr, back) && dr.ops.length === 2 && !interpretScheduleOps(dr.ops, job).nextTasks.some((t) => t.title === 'Prime and paint'));
  const dm = turn(turn({ ops: [] }, [{ op: 'move', task: 'c', deltaDays: 7 }, { op: 'setDuration', task: 's', days: 3 }], 'push cabinets a week and 2nd floor rough-in is 3 days'),
    [{ op: 'setDuration', task: 's', days: 3 }], 'push cabinets a week and 2nd floor rough-in is 3 days | never mind the cabinets');
  ok('"never mind the cabinets" → the queued move is gone (1 op)', dm.ops.length === 1 && dm.ops[0].op === 'setDuration');

  // "In parallel" is read from THIS turn's words, and only for adds new this
  // turn; a queued add keeps its own flag (the schema cannot carry it).
  const par1 = turn({ ops: [] }, [{ op: 'addTask', title: 'Order cabinets', durationDays: 10, after: 'p' }], 'add order cabinets after rough-in, in parallel');
  const par2 = turn(par1, [{ op: 'addTask', title: 'Order cabinets', durationDays: 10, after: 'p' }, { op: 'addTask', title: 'Punch walk', durationDays: 1, after: 'c' }], 'add order cabinets after rough-in, in parallel | and a punch walk after cabinets');
  ok('an "in parallel" add stays parallel on a later turn; the new add this turn is in sequence',
    par1.ops[0].parallel === true && par2.ops[0].parallel === true && par2.ops[1].parallel === undefined);
}

console.log('\nthe "what landed" card and the interpreter tell the truth (integration round 6 minors)');
{
  const { runCpm } = await import('../utils/cpm');
  const es = (ts: ScheduleTask[], id: string, o = {}) => runCpm(ts, o).perTask.get(id)!.es;
  // (b) an add with no `after` starts after the SCHEDULED finish, so the
  // card's "at the end" is true. Schedule Pro commits rows with stale pins:
  // after the founder's 3 adds Trim is PINNED day 25 but SCHEDULED 37–40.
  const job = [
    mk('t1', { title: 'Demo & site prep', startDay: 1, durationDays: 3 }), mk('t2', { title: 'Framing', startDay: 4, durationDays: 8, dependencies: ['t1'] }),
    mk('t3', { title: 'Rough-in (MEP)', startDay: 12, durationDays: 6, dependencies: ['t2'] }), mk('t4', { title: 'Insulation', startDay: 18, durationDays: 2, dependencies: ['t3'] }),
    mk('t5', { title: 'Cabinets & countertops', startDay: 20, durationDays: 5, dependencies: ['t4'] }), mk('t6', { title: 'Trim & finish carpentry', startDay: 25, durationDays: 4, dependencies: ['t5'] }),
  ];
  const committed = interpretScheduleOps([
    { op: 'addTask', title: 'Drywall hang', durationDays: 4, after: 't3' },
    { op: 'addTask', title: 'Drywall tape', durationDays: 3, after: 'Drywall hang' },
    { op: 'addTask', title: 'Prime and paint', durationDays: 5, after: 'Drywall tape' },
  ], job).nextTasks;
  const finish = runCpm(committed, {}).projectFinish;
  ok('(setup) after the 3 adds the plan finishes day 40 (Trim pinned 25, scheduled 37)', finish === 40 && es(committed, 't6') === 37);
  const end = interpretScheduleOps([{ op: 'addTask', title: 'Final clean', durationDays: 1 }], committed);
  const fc = end.nextTasks.find((t) => t.title === 'Final clean')!;
  ok('"add a final clean at the end" starts day 41, after the scheduled finish (not day 29 mid-plan)', end.results[0].ok && fc.startDay === 41 && es(end.nextTasks, fc.id) === 41);
  ok('…and the card that says "at the end" is now true', describeEditOp(end.results[0].op, end.nextTasks, end.results[0]) === 'Added Final clean (1d) at the end, with nothing linked to it');

  // (c) two relative moves of the SAME task in one answer compound.
  const chain = [mk('f', { title: 'Framing', startDay: 1, durationDays: 10 }), mk('d', { title: 'Drywall hang', startDay: 11, durationDays: 4, dependencies: ['f'] }), mk('p', { title: 'Prime and paint', startDay: 15, durationDays: 5, dependencies: ['d'] })];
  const twice = interpretScheduleOps([{ op: 'move', task: 'f', deltaDays: 3 }, { op: 'move', task: 'f', deltaDays: 2 }], chain);
  ok('"push framing 3 days, then 2 more" → Framing starts day 6 (1 + 3 + 2), not 3', twice.results.every((r) => r.ok) && es(twice.nextTasks, 'f') === 6);

  // (d) on a DATED plan the card prints the move as dates — the dates the
  // review and the Gantt show, not a working-day ordinal that reads as a
  // second, different move ("day 20 → 27" next to "start +11d").
  const dated = { scheduleStartDate: '2026-09-07', workingDaysPerWeek: 5 };
  const { calendarDayToDate } = await import('../utils/cpm');
  const { formatCalendarDay, toCalendarDayString, parseCalendarDay } = await import('../utils/calendarDate');
  const dateOf = (calendarIndex: number) => formatCalendarDay(toCalendarDayString(calendarDayToDate(parseCalendarDay(dated.scheduleStartDate)!, calendarIndex)), { weekday: 'short', month: 'short', day: 'numeric' });
  let committedTasks: ScheduleTask[] | null = null;
  const applied = await cap.apply({ ops: [{ op: 'move', task: 't5', deltaDays: 7 }] } as never, {
    currentTasks: committed, cpmOptions: dated, tier: 'pro', project: null, projectId: 'p1', ctx: {},
    commitTasks: (producer: (prev: ScheduleTask[]) => ScheduleTask[]) => { committedTasks = producer(committed); return true; },
  } as never);
  const beforeEs = es(committed, 't5', dated), afterEs = es(committedTasks!, 't5', dated);
  const expected = `Moved Cabinets & countertops to ${dateOf(afterEs)} (was ${dateOf(beforeEs)})`;
  ok('a dated "push cabinets a week" card names the Gantt dates, not "day N"', applied.landed.length === 1 && applied.landed[0] === expected && !/\bday \d/.test(applied.landed[0]), `${applied.landed[0]} vs ${expected}`);
  ok('…an undated plan keeps "day N"', describeEditOp({ op: 'move', task: 't5', deltaDays: 7 }, committed, { fromDay: 32, toDay: 39 }) === 'Moved Cabinets & countertops to day 39 (was day 32)');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
