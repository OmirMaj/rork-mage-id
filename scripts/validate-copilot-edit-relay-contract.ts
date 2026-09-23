// scripts/validate-copilot-edit-relay-contract.ts — the schedule-edit (and
// estimate-edit) copilot's AI contract, end to end, the way it actually runs.
//
// The relay (supabase/functions/ai) turns the capability's schemaHint into
// Gemini's responseSchema, and constrained decoding can only emit the keys
// that schema declares — the required ones always. The older validator fed
// hand-written ops straight to normalizeEditOps and never crossed that
// boundary, which is how "add a task" shipped unable to work: the one-move
// hint made every op {op, task, deltaDays}, so an add had nowhere to put its
// title and was dropped ("I asked for several new tasks, only 1 acknowledged").
//
// Here the responseSchema is built from the capability's REAL hint by the
// relay's REAL inferSchema (_shared/inferSchema.ts), Gemini's strict decoder
// is simulated over it (declared keys only; a required key it lacks is still
// emitted, empty; under items.anyOf it picks ONE closed alternative — the one
// whose `op` enum matches — and can emit nothing an alternative lacks), and
// the result is pushed through normalize → merge → interpret → diff → commit.
//
// 2026-09-23: the ops item is anyOf (one closed shape per example op), not the
// wave-6a union (15 optional fields, required [op]) that made Gemini loop in
// addDependency's `type` on an addTask live — see
// docs/deploy/2026-09-23-ai-relay-rollback.md.
//
// Run: bun run scripts/validate-copilot-edit-relay-contract.ts
import type { ScheduleTask } from '../types';

// @types/bun is not installed (same note as validate-oac-actions.ts); only the
// sliver used here is declared.
type OnLoadResult = { contents: string; loader: 'ts' };
type BunPluginBuilder = { onLoad: (opts: { filter: RegExp }, cb: () => OnLoadResult) => void };
declare const Bun: { plugin: (p: { name: string; setup: (build: BunPluginBuilder) => void }) => void } | undefined;
if (typeof Bun === 'undefined') {
  console.error('\n✗ validate-copilot-edit-relay-contract must run under bun (needs Bun.plugin)\n');
  process.exit(1);
}

// The capabilities import their React Native review components, which only
// renderReview uses. Stub them so the REAL capability modules load under bun.
Bun!.plugin({
  name: 'stub-copilot-review-views',
  setup(build) {
    build.onLoad({ filter: /components\/copilot\/(ScheduleDiffView|EstimateDiffView)\.tsx$/ }, () => ({
      contents: 'export default function View() { return null; }',
      loader: 'ts',
    }));
    // The network edge for utils/scheduleAI: every call returns what the
    // simulated decoder produced (see __fakeAI below).
    build.onLoad({ filter: /utils\/mageAI\.ts$/ }, () => ({
      contents: 'export async function mageAI(p) { return globalThis.__fakeAI(p); }',
      loader: 'ts',
    }));
  },
});

const { inferSchema } = await import('../supabase/functions/_shared/inferSchema');
const { scheduleEditCapability: cap } = await import('../utils/copilot/scheduleEdit/scheduleEditCapability');
const { normalizeEditOps } = await import('../utils/copilot/scheduleEdit/editOps');
const { interpretScheduleOps, applyEditEffects } = await import('../utils/copilot/scheduleEdit/interpretOps');
const { diffSchedule } = await import('../utils/copilot/scheduleEdit/diffSchedule');
const { runCpm } = await import('../utils/cpm');
const { estimateEditCapability: estCap } = await import('../utils/copilot/estimateEdit/estimateEditCapability');
const { normalizeEstimateOps } = await import('../utils/copilot/estimateEdit/estimateOps');

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, why = '') => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, why); } };

// What Gemini can emit for an intended object under a responseSchema:
// declared properties only; a required key the intent lacks is still emitted.
function pickAlternative(anyOf: any[], v: any): any | null {
  const intentKeys = Object.keys(v ?? {});
  // An alternative whose `op` enum names another op can never carry this one.
  const fits = anyOf.filter((a) => {
    const e = a?.properties?.op?.enum;
    return !Array.isArray(e) || e.includes(v?.op);
  });
  if (fits.length === 0) return null;
  const score = (a: any) => intentKeys.filter(k => k in (a.properties ?? {})).length * 100 - (a.required ?? []).filter((k: string) => !(k in (v ?? {}))).length;
  return fits.reduce((best, a) => (score(a) > score(best) ? a : best));
}
function emit(schema: any, v: any): any {
  if (Array.isArray(schema?.anyOf)) {
    const alt = pickAlternative(schema.anyOf, v);
    // No alternative can express this intent: the decoder cannot emit it.
    return alt ? emit(alt, v) : null;
  }
  if (schema?.type === 'object') {
    const out: Record<string, any> = {};
    for (const k of Object.keys(schema.properties ?? {})) {
      const val = v?.[k] !== undefined ? v[k] : ((schema.required ?? []).includes(k) ? (schema.properties[k].type === 'number' ? 0 : schema.properties[k].type === 'boolean' ? false : '') : undefined);
      if (val !== undefined) out[k] = emit(schema.properties[k], val);
    }
    return out;
  }
  if (schema?.type === 'array') return (Array.isArray(v) ? v : [v]).map((x: any) => emit(schema.items, x)).filter((x: any) => x !== null);
  return v;
}

const grounding = { facts: [], data: { taskList: [] } };
const hint = cap.buildTurnPrompt({ transcript: 'x', draft: { ops: [] }, grounding, asking: null }).schemaHint;
// The hint travels as JSON; the relay infers from the parsed copy.
const schema = inferSchema(JSON.parse(JSON.stringify(hint))) as any;
const item = schema?.properties?.ops?.items;

console.log('relay contract — every EditOp kind survives the responseSchema + normalizeEditOps intact');
const CANON: Record<string, any> = {
  move: { op: 'move', task: 't2', deltaDays: 5 }, moveTo: { op: 'move', task: 't2', toStartDay: 20 },
  setDuration: { op: 'setDuration', task: 't2', days: 6 }, setCrew: { op: 'setCrew', task: 't2', crewSize: 4 },
  setProgress: { op: 'setProgress', task: 't2', pct: 50 }, addDependency: { op: 'addDependency', from: 't1', to: 't3', type: 'SS', lag: 1 },
  removeDependency: { op: 'removeDependency', from: 't1', to: 't2' }, addTask: { op: 'addTask', title: 'Drywall hang', durationDays: 4, after: 't2' },
  removeTask: { op: 'removeTask', task: 't3' }, level: { op: 'level' },
  // No position given ("add a two-week cabinet procurement milestone"): the
  // unanchored addTask shape, so the decoder is never forced to invent `after`
  // (an echoed '<task id…>' there is dropped as "no position given").
  addTaskAtEnd: { op: 'addTask', title: 'Cabinet procurement', durationDays: 10 },
};
for (const [k, intent] of Object.entries(CANON)) {
  const got = normalizeEditOps([emit(item, intent)]).ops[0];
  ok(`${k} round-trips`, !!got && Object.entries(intent).every(([f, v]) => (got as any)[f] === v), JSON.stringify(got ?? 'DROPPED'));
}
{
  const alts: any[] = item?.anyOf ?? [];
  ok('ops.items is anyOf — one CLOSED alternative per example op shape', alts.length === (hint as any).ops.length
    && alts.every((a) => JSON.stringify(a.required) === JSON.stringify(Object.keys(a.properties)) && Array.isArray(a.properties.op?.enum) && a.properties.op.enum.length === 1),
    JSON.stringify(item));
  ok('no ops-level union: no single item schema with required ["op"] and 15 optional fields', !('properties' in (item ?? {})));
  ok('an addTask can carry ONLY title/durationDays/after/isMilestone (no `type` slot to loop in)',
    JSON.stringify(alts.filter((a) => a.properties.op.enum[0] === 'addTask').map((a) => Object.keys(a.properties))) === '[["op","title","durationDays","after","isMilestone"],["op","title","durationDays","isMilestone"]]');
  ok('level is an alternative (a closed anyOf cannot emit an op the hint does not list)', alts.some((a) => a.properties.op.enum[0] === 'level'));
  const atEnd = normalizeEditOps([emit(item, CANON.addTaskAtEnd)]);
  ok('an unanchored add survives normalizeEditOps with NO `after` (not "no position given")', atEnd.ops.length === 1 && !('after' in atEnd.ops[0]) && atEnd.dropped.length === 0, JSON.stringify(atEnd));
}
ok('move(deltaDays) is the FIRST example (an un-redeployed relay reads val[0])',
  JSON.stringify(Object.keys((hint as any).ops[0])) === '["op","task","deltaDays"]' && (hint as any).ops[0].op === 'move');

// Review round 3 (written against the union schema): Gemini may FILL a
// declared slot the op kind never reads, echoing the example's value. Under
// the anyOf schema an alternative declares only its own op's slots, so the
// decoder drops these fills — kept as a regression net in case a later rule
// ever declares foreign slots on an op again.
const READS: Record<string, string[]> = {
  move: ['op', 'task', 'deltaDays', 'toStartDay'], setDuration: ['op', 'task', 'days'], setCrew: ['op', 'task', 'crewSize'],
  setProgress: ['op', 'task', 'pct'], addDependency: ['op', 'from', 'to', 'type', 'lag'], removeDependency: ['op', 'from', 'to'],
  addTask: ['op', 'title', 'durationDays', 'after', 'isMilestone'], removeTask: ['op', 'task'], level: ['op'],
};
function fillUnused(examples: Record<string, unknown>[], reads: Record<string, string[]>, intent: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...intent };
  const mine = reads[String(intent.op)] ?? ['op'];
  for (const ex of examples) for (const [k, v] of Object.entries(ex)) if (!mine.includes(k) && !(k in out)) out[k] = v;
  return out;
}
console.log('\n…and survives a decoder that fills every UNUSED slot with the example\'s value');
for (const [k, intent] of Object.entries(CANON)) {
  const filled = fillUnused((hint as any).ops, READS, intent);
  const got = normalizeEditOps([emit(item, filled)]).ops[0];
  ok(`${k} round-trips with every unused slot filled`, !!got && Object.entries(intent).every(([f, v]) => (got as any)[f] === v), JSON.stringify(got ?? normalizeEditOps([emit(item, filled)]).dropped));
}
{
  const filledThree = emit(schema, { ops: [
    { op: 'addTask', title: 'Drywall hang', durationDays: 4, after: 't2' },
    { op: 'addTask', title: 'Drywall tape', durationDays: 3, after: 'Drywall hang' },
    { op: 'addTask', title: 'Prime and paint', durationDays: 5, after: 'Drywall tape' },
  ].map((o) => fillUnused((hint as any).ops, READS, o)) });
  const d = cap.mergeDraft({ ops: [] }, filledThree, { transcript: 'Add three tasks after rough-in', asking: null });
  ok('the founder\'s three adds with every unused slot echoed → 3 ops, 0 "couldn\'t read"', d.ops.length === 3 && (d.dropped ?? []).length === 0, JSON.stringify(d));
}

console.log('\nan echoed example can never touch a real task');
const echo = normalizeEditOps(emit(schema, hint).ops);
ok('the whole example list echoed back → zero ops (its { op: \'level\' } included — no ref to tell it from a request)', echo.ops.length === 0, JSON.stringify(echo.ops));
{
  const real = normalizeEditOps(emit(schema, { ops: [{ op: 'move', task: 't2', deltaDays: 7 }, { op: 'level' }] }).ops);
  ok('…but a real "push it a week and re-level" keeps its level', JSON.stringify(real.ops.map((o: any) => o.op)) === '["move","level"]', JSON.stringify(real));
}
ok('…and it is not reported as a request he made', echo.dropped.length === 0, JSON.stringify(echo.dropped));

console.log('\nmulti-add — "add three tasks after rough-in" lands three chained tasks');
const mk = (id: string, title: string, startDay: number, durationDays: number, deps: string[] = []): ScheduleTask => ({ id, title, phase: 'P', durationDays, startDay, progress: 0, crew: '', dependencies: deps, notes: '', status: 'not_started' });
const base = [mk('t1', 'Framing', 1, 5), mk('t2', 'Rough-in inspection', 6, 1, ['t1']), mk('t3', 'Cabinets', 7, 4, ['t2'])];
const aiJson = emit(schema, { ops: [
  { op: 'addTask', title: 'Drywall hang', durationDays: 4, after: 't2' },
  { op: 'addTask', title: 'Drywall tape', durationDays: 3, after: 'Drywall hang' },
  { op: 'addTask', title: 'Prime and paint', durationDays: 5, after: 'Drywall tape' },
] });
const draft = cap.mergeDraft({ ops: [] }, aiJson, { transcript: 'Add three tasks after rough-in: drywall hang 4 days, drywall tape 3 days, prime and paint 5 days', asking: null });
ok('mergeDraft keeps 3 addTask ops', draft.ops.filter((o: any) => o.op === 'addTask').length === 3, `got ${draft.ops.length}`);
const { nextTasks, results } = interpretScheduleOps(draft.ops, base);
const after = applyEditEffects(draft.ops, nextTasks, {});
ok('interpreter applies all 3', results.filter((r: any) => r.ok).length === 3, JSON.stringify(results.filter((r: any) => !r.ok)));
const diff = diffSchedule(base, after, runCpm(base, {}), runCpm(after, {}));
ok('preview lists 3 added ("+3")', diff.added.length === 3);
const byTitle = (ts: any[], t: string) => ts.find(x => x.title === t);
ok('chained in spoken order: tape after hang, paint after tape',
  byTitle(after, 'Drywall tape').dependencies[0] === byTitle(after, 'Drywall hang').id
  && byTitle(after, 'Prime and paint').dependencies[0] === byTitle(after, 'Drywall tape').id);
ok('cabinets now waits on the last new task (inserted work pushes the finish)',
  JSON.stringify(byTitle(after, 'Cabinets').dependencies) === JSON.stringify([byTitle(after, 'Prime and paint').id]));
ok('finish moves by the 12 inserted days', diff.finishDeltaDays === 12, `Δ ${diff.finishDeltaDays}`);
let committed: any[] = base;
const applied = await cap.apply(draft, { project: null, projectId: 'p', ctx: {}, tier: 'pro', cpmOptions: {}, currentTasks: base, commitTasks: (f: any) => { committed = f(committed); } });
ok('apply commits 3 new rows', committed.length === base.length + 3, `got ${committed.length - base.length}`);
ok('apply reports the 3 that landed', applied.landed.length === 3 && applied.notLanded.length === 0, JSON.stringify(applied));

console.log('\nids — a new task never reuses an id already on the schedule (page reloads, second device)');
const legacy = Array.from({ length: 60 }, (_, i) => mk(`edit-${i + 1}-${((i + 1) * 2654435761) % 100000}`, `Earlier add ${i + 1}`, 1, 1));
const out = interpretScheduleOps([{ op: 'addTask', title: 'A', durationDays: 1 }, { op: 'addTask', title: 'B', durationDays: 1 }], legacy).nextTasks;
ok('no duplicate ids against ids the old counter minted', new Set(out.map((t: any) => t.id)).size === out.length);
// Two page loads = two module instances. The query string makes bun load the
// module afresh (typed through a string so tsc does not try to resolve it).
type InterpretMod = typeof import('../utils/copilot/scheduleEdit/interpretOps');
const fresh = (n: number): Promise<InterpretMod> => import(String(`../utils/copilot/scheduleEdit/interpretOps.ts?fresh=${n}`));
const a = await fresh(1);
const b = await fresh(2);
const idA = a.interpretScheduleOps([{ op: 'addTask', title: 'A', durationDays: 1 }], []).nextTasks[0].id;
const idB = b.interpretScheduleOps([{ op: 'addTask', title: 'B', durationDays: 1 }], []).nextTasks[0].id;
ok('two fresh module instances (two page loads) mint different ids', idA !== idB, `${idA} vs ${idB}`);
// "Reload, repeat, expect 6 distinct ids": the same request applied twice.
const twice = interpretScheduleOps(draft.ops, committed).nextTasks;
ok('the same 3-task request applied again → 6 distinct new ids', new Set(twice.map((t: any) => t.id)).size === twice.length && twice.length === base.length + 6);

console.log('\nbackward compatibility — single-example hints infer exactly as before');
ok('lead-style object hint unchanged', JSON.stringify(inferSchema({ name: 'x', phone: null, budgetMin: 1 })) === '{"type":"object","properties":{"name":{"type":"string"},"phone":{"type":"string"},"budgetMin":{"type":"number"}},"required":["name","phone","budgetMin"]}');
ok('one-element array hint unchanged', JSON.stringify(inferSchema({ actions: [{ capabilityId: 'x', text: 'y' }] })) === '{"type":"object","properties":{"actions":{"type":"array","items":{"type":"object","properties":{"capabilityId":{"type":"string"},"text":{"type":"string"}},"required":["capabilityId","text"]}}},"required":["actions"]}');

console.log('\nestimate edit — quantity, markup and new lines survive the schema');
const estHint = estCap.buildTurnPrompt({ transcript: 'x', draft: { ops: [] }, grounding: { facts: [], data: { itemList: [] } }, asking: null }).schemaHint;
const estItem = (inferSchema(JSON.parse(JSON.stringify(estHint))) as any).properties.ops.items;
ok('setUnitPrice is the FIRST example (un-redeployed relay reads val[0])', (estHint as any).ops[0].op === 'setUnitPrice');
const EST: Record<string, any> = {
  setUnitPrice: { op: 'setUnitPrice', item: 'm1', unitPrice: 12 },
  setQuantity: { op: 'setQuantity', item: 'm1', quantity: 40 },
  setGlobalMarkup: { op: 'setGlobalMarkup', markupPct: 18 },
  addLine: { op: 'addLine', name: 'Paint', category: 'Finishes', unit: 'gal', quantity: 5, unitPrice: 40 },
  removeLine: { op: 'removeLine', item: 'm2' },
};
for (const [k, intent] of Object.entries(EST)) {
  const got = normalizeEstimateOps([emit(estItem, intent)])[0];
  ok(`${k} round-trips`, !!got && Object.entries(intent).every(([f, v]) => (got as any)[f] === v), JSON.stringify(got ?? 'DROPPED'));
}
const estDraft = estCap.mergeDraft({ ops: [] }, emit({ type: 'object', properties: { ops: { type: 'array', items: estItem } }, required: ['ops'] }, { ops: Object.values(EST) }), { transcript: 'cut the tile, bump the markup to 18%, add paint', asking: null });
ok('estimate mergeDraft keeps all 5 ops', estDraft.ops.length === 5, JSON.stringify(estDraft.ops.map((o: any) => o.op)));
{
  const EST_READS: Record<string, string[]> = {
    setUnitPrice: ['op', 'item', 'unitPrice'], setQuantity: ['op', 'item', 'quantity'], setGlobalMarkup: ['op', 'markupPct'],
    addLine: ['op', 'name', 'category', 'unit', 'quantity', 'unitPrice'], removeLine: ['op', 'item'],
  };
  const filled = Object.values(EST).map((o) => emit(estItem, fillUnused((estHint as any).ops, EST_READS, o)));
  const fd = estCap.mergeDraft({ ops: [] }, { ops: filled }, { transcript: 'cut the tile, bump the markup to 18%, add paint', asking: null });
  ok('estimate: every op survives a decoder that fills its unused item/name slot with the placeholder', fd.ops.length === 5, JSON.stringify(fd.ops.map((o: any) => o.op)));
}
const estEcho = estCap.mergeDraft({ ops: [] }, emit({ type: 'object', properties: { ops: { type: 'array', items: estItem } }, required: ['ops'] }, estHint), { transcript: 'drop the tile price', asking: null });
ok('an echoed estimate example edits nothing (placeholders + markup guard)', estEcho.ops.length === 0, JSON.stringify(estEcho.ops));

console.log('\nbulk edit (the AI drawer) — one closed single-field shape per field; one row per task; the count is what Apply changes');
const { aiBulkEdit, mergeBulkUpdates } = await import('../utils/scheduleAI');
const bt = [mk('t1', 'Framing', 1, 5), mk('t2', 'Drywall', 6, 4, ['t1'])].map(t => ({ ...t, crew: 'Frame crew', phase: 'Structure', progress: 50 }));
let lastParams: any = null;
const bulkSchema = () => inferSchema(JSON.parse(JSON.stringify(lastParams.schemaHint))) as any;
(globalThis as any).__fakeAI = async (p: any) => {
  lastParams = p;
  const s = inferSchema(JSON.parse(JSON.stringify(p.schemaHint))) as any;
  // The model answers per field, each in its own single-field shape; none
  // restates the fields it is not changing.
  return { success: true, data: emit(s, { summary: 'move, recrew, compress', updates: [
    { alias: 'T1', startDay: 3 }, { alias: 'T1', crew: 'Finish crew' }, { alias: 'T1', durationDays: 4 },
  ] }) };
};
const bulk = await aiBulkEdit(bt as any, runCpm(bt as any, {}), ['t1', 't2'], 'compress framing by 20% and move it to day 3');
ok('bulk edit is tagged as the schedule copilot on the relay', lastParams?.feature === 'scheduleCopilot', lastParams?.feature);
ok('3 per-field updates for one task → ONE row', bulk.patches.length === 1, `rows ${bulk.patches.length}`);
ok('…carrying exactly those three fields', JSON.stringify(bulk.patches[0]?.patch) === '{"startDay":3,"crew":"Finish crew","durationDays":4}', JSON.stringify(bulk.patches[0]?.patch));
ok('phase and progress are NOT forced by a single-field shape', !('phase' in (bulk.patches[0]?.patch ?? {})) && !('progress' in (bulk.patches[0]?.patch ?? {})));
{
  // Every field the full shape carries has its own single-field shape, so no
  // one-field change is forced into the 7-field shape (which requires
  // progressPercent — the model would guess it and overwrite real progress).
  const anyOf: any[] = bulkSchema().properties.updates.items.anyOf;
  const fields = Object.keys(anyOf[0].properties).filter(k => k !== 'alias' && k !== 'rationale');
  const single = (k: string) => anyOf.some(a => JSON.stringify(a.required) === JSON.stringify(['alias', k]));
  ok('every bulk field (duration, start, crew, phase, progress) has a single-field {alias, field} shape', fields.length === 5 && fields.every(single), JSON.stringify(fields.filter(k => !single(k))));
  // A duration-only intent under the decoder lands in {alias, durationDays} —
  // it carries no progressPercent at all.
  const one = emit(bulkSchema().properties.updates, [{ alias: 'T2', durationDays: 3 }]);
  ok('"compress drywall to 3 days" is emitted with no progressPercent / phase / crew slot', JSON.stringify(one) === '[{"alias":"T2","durationDays":3}]', JSON.stringify(one));
  ok('the prompt shows each selected task\'s current progress (a restated full shape keeps it)', /T1: Framing \| start=1 \| dur=5d \| crew=Frame crew \| phase=Structure \| progress=50%/.test(lastParams?.prompt ?? ''), '');
}
(globalThis as any).__fakeAI = async () => ({ success: true, data: { summary: 's', updates: [{ alias: 'T2', durationDays: 3, startDay: 6, crew: 'Frame crew', phase: 'Structure', progressPercent: 50, rationale: 'compress' }] } });
const full = await aiBulkEdit(bt as any, runCpm(bt as any, {}), ['t2'], 'compress drywall to 3 days');
ok('a full-shape answer restating the CURRENT progress changes duration only (progress untouched)', JSON.stringify(full.patches[0]?.patch) === '{"durationDays":3}', JSON.stringify(full.patches));
(globalThis as any).__fakeAI = async () => ({ success: true, data: { summary: 's', updates: [{ alias: 'T2', durationDays: 4, startDay: 6, crew: '', phase: '', progressPercent: 50, rationale: '' }] } });
const noop = await aiBulkEdit(bt as any, runCpm(bt as any, {}), ['t2'], 'x');
ok('an old-relay answer (every field forced: blank crew/phase, current values) changes nothing', noop.patches.length === 0, JSON.stringify(noop.patches));
{
  // A task with NO crew / phase is printed `crew=-` / `phase=-`, and the prompt
  // asks a full-shape answer to restate unchanged fields at their current value
  // — so the model restates '-'. That is not a crew: written, CPM leveling made
  // it a `crew:-` resource and the reports stopped flagging the task unstaffed.
  const bare = [mk('t1', 'Framing', 1, 5), { ...mk('t2', 'Drywall', 6, 4, ['t1']), crew: '', phase: '', progress: 50 }];
  let bareParams: any = null;
  (globalThis as any).__fakeAI = async (p: any) => { bareParams = p; return { success: true, data: { summary: 's', updates: [{ alias: 'T2', durationDays: 3, startDay: 6, crew: '-', phase: '-', progressPercent: 50, rationale: 'compress' }] } }; };
  const r = await aiBulkEdit(bare as any, runCpm(bare as any, {}), ['t2'], 'compress drywall to 3 days');
  ok('a crewless, phaseless task is printed crew=- / phase=- (never "undefined")', /T2: Drywall \| start=6 \| dur=4d \| crew=- \| phase=- \| progress=50%/.test(bareParams?.prompt ?? ''), '');
  ok('a full shape restating crew "-" / phase "-" on that task changes duration only', JSON.stringify(r.patches[0]?.patch) === '{"durationDays":3}', JSON.stringify(r.patches));
  for (const marker of ['\u2014', '(none)', 'None', 'n/a', ' - ']) {
    const m = mergeBulkUpdates(bare as any, [{ alias: 'T2', crew: marker, phase: marker }], new Map([['T2', 't2']]), new Set(['t2']));
    ok(`restated blank marker ${JSON.stringify(marker)} writes no crew / phase`, m.length === 0, JSON.stringify(m));
  }
  const real = mergeBulkUpdates(bare as any, [{ alias: 'T2', crew: 'Finish crew', phase: 'Finishes' }], new Map([['T2', 't2']]), new Set(['t2']));
  ok('…while a real crew / phase on that task is still written', JSON.stringify(real[0]?.patch) === '{"crew":"Finish crew","phase":"Finishes"}', JSON.stringify(real));
}

console.log('\nentry points — Schedule Pro, the editor panel, the shell (source)');
const { readFileSync } = await import('node:fs');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const src = (f: string) => strip(readFileSync(f, 'utf8'));
const pro = src('app/schedule-pro.tsx');
const persist = pro.slice(pro.indexOf('const schedulePersist = useCallback('), pro.indexOf('useEffect(() => { schedulePersistRef.current = schedulePersist; }'));
ok('the debounced save writes the LIVE finish (liveCpm), not the stale closure', /criticalPathDays: liveCpm\?\.projectFinish \?\? cpm\.projectFinish/.test(persist) && !/\{ criticalPathDays: cpm\.projectFinish \}/.test(persist));
ok('the unreachable VoiceCommandModal is gone', !/VoiceCommandModal|showVoice|voiceUpdateFunctions/.test(pro));
const voiceCase = pro.slice(pro.indexOf("case 'voice':"), pro.indexOf("case 'example':"));
ok('empty-schedule "Build by voice" routes to the schedule Copilot for this job', /router\.push\(\{ pathname: '\/copilot', params: \{ capabilityId: 'schedule', projectId: project\.id \} \}/.test(voiceCase) && !/setEditOpen/.test(voiceCase));
ok('the editor panel gets memoised cpm options and the audited commit', /<ScheduleEditPanel[\s\S]{0,300}commit=\{commitEditorBatch\}[\s\S]{0,80}cpmOptions=\{editCpmOptions\}/.test(pro) && /const editCpmOptions = useMemo\(/.test(pro));
const batch = pro.slice(pro.indexOf('const commitAiBatch = useCallback('), pro.indexOf('const commitEditorBatch'));
ok('AI batches write the audit log (summarizeTaskDiff, per task) before committing', /writeAudit\(/.test(batch) && /summarizeTaskDiff\(/.test(batch) && /commit\(prev =>/.test(batch));
ok('bulk "Apply all" and Generate go through the audited batch', /onApplyBulkPatches=\{[\s\S]{0,600}commitAiBatch\(/.test(pro) && /commitAiBatch\(\(\) => generateWbsCodes\(tasks\)/.test(pro));
ok('bulk "Apply all" merges patches per task (no Map overwrite)', /patchMap\.set\(p\.taskId, \{ \.\.\.\(patchMap\.get\(p\.taskId\) \?\? \{\}\), \.\.\.p\.patch \}\)/.test(pro));
ok('the AI drawer hands add requests to the editor, seeded', /onHandOffToEditor=\{\(seed\) => \{[\s\S]{0,120}setEditSeed\(seed\);[\s\S]{0,40}setEditOpen\(true\)/.test(pro) && /seed=\{editSeed\}/.test(pro));
const panel = src('components/copilot/ScheduleEditPanel.tsx');
ok('ScheduleEditPanel memoises ctx (no preview re-run per render)', /const ctx = useMemo<CopilotContext>\(/.test(panel) && /ctx=\{ctx\}/.test(panel));
ok('ScheduleEditPanel offers Undo through the host commit', /onUndo=\{undo\}/.test(panel));
const shell = src('components/copilot/CopilotShell.tsx');
ok('"Open on web" pushes projectId (Schedule Pro reads it) and hides on that screen', /params: \{ id: ctx\.projectId, projectId: ctx\.projectId \}/.test(shell) && /\{!onWebRoute && \(/.test(shell));
ok('the review keeps a compose box ("say it another way" needs somewhere to say it)', /testID="copilot-review-compose"/.test(shell));
ok('after Apply the shell lists what landed, with Undo', /testID="copilot-landed"/.test(shell) && /testID="copilot-undo"/.test(shell));
const relaySrc = src('supabase/functions/ai/index.ts');
ok('the relay joins every non-thought text part (not parts[0] only)', !/parts\?\.\[0\]\?\.text/.test(relaySrc) && /p\.thought !== true/.test(relaySrc));
const sai = src('utils/scheduleAI.ts');
ok('every schedule-drawer AI call is tagged scheduleCopilot', (sai.match(/await mageAI\(\{/g) ?? []).length === (sai.match(/feature: SCHEDULE_AI_FEATURE/g) ?? []).length && /const SCHEDULE_AI_FEATURE = 'scheduleCopilot'/.test(sai));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
