// scripts/validate-code-thread.ts — the Code Thread: job-aware, adaptive,
// saved code checks.
//
// Proves:
//   1. the store: key under mageid_ (swept on sign-out), cap 50, upsert by id
//      keeping actions, idempotent actions, a corrupt blob reads { ok:false }
//      (never "no checks"), an unreadable blob is never overwritten;
//   2. the job context: category map, scenario lengths, the block carries the
//      estimate quantity + unit + category, a guessed zoning district is never
//      sent and a confirmed one is; `sent` names what the block holds;
//   3. follow-ups: the 3-question budget, answered ids dropped, 1-option
//      questions rejected, the instruction switches at 3, the cache key moves
//      with every answer;
//   4. the follow-up schema hint reaches the relay as an ARRAY OF OBJECTS;
//   5. the drafts: an RFI is unsent (dateSubmitted '', ball with the GC), a
//      permit's jurisdiction is the authority (never an address) and says
//      'Not filed yet';
//   6. the Code Check screen: still exactly two schema calls, the follow-up
//      re-run waits out the iOS modal dismissal, the params effect is keyed,
//      the actions close the sheet before navigating, saved checks say
//      'until you sign out'.
//
// Pure: node:fs plus the pure utils (AsyncStorage runs on an in-memory
// window.localStorage, which is what its web build reads).
// Run via: bun scripts/validate-code-thread.ts

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Project } from '../types';
import type { CodeCheckRecord, CodeThreadActionRecord, CodeThreadAnswer } from '../utils/codeThread/types';
import { isAppStorageKey } from '../utils/localCacheKeys';
import { categoryForProject, codeThreadContextBlock, scenarioForSource } from '../utils/codeThread/context';
import {
  MAX_FOLLOW_UPS, answeredFactsBlock, answersCacheFragment, coerceFollowUps, followUpInstruction, followUpsZod,
} from '../utils/codeThread/followUps';
import {
  codeCheckRoute, permitDraftFromCodeItem, permitTypeForCodeItem, punchDraftFromCodeItem, rfiDraftFromCodeItem,
} from '../utils/codeThread/actions';
import { zoningAddressKey } from '../utils/automation/jurisdiction';
import { inferSchema } from '../supabase/functions/_shared/inferSchema';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const read = (rel: string): string => {
  try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return ''; }
};

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, extra ? `\n     ${extra}` : ''); }
}

// In-memory storage for AsyncStorage's web build (a window.localStorage passthrough).
const mem = new Map<string, string>();
const g = globalThis as unknown as { window?: Record<string, unknown> };
g.window = g.window ?? {};
g.window.localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
};

async function main() {
  const store = await import('../utils/codeThread/store');
  const {
    CODE_CHECKS_KEY, MAX_CHECKS_PER_PROJECT, appendAction, upsertCheck, parseCodeChecksBlob, remapActions,
    loadCodeChecks, saveCodeCheck, recordCodeThreadAction, subscribeCodeChecks,
  } = store;

  // ── 1. Store and keys ──────────────────────────────────────────────────
  console.log('\n1. Store and keys');
  ok('CODE_CHECKS_KEY is mageid_code_checks', CODE_CHECKS_KEY === 'mageid_code_checks');
  ok('the key starts with mageid_ and isAppStorageKey accepts it (the sign-out sweep covers it)',
    CODE_CHECKS_KEY.startsWith('mageid_') && isAppStorageKey(CODE_CHECKS_KEY));
  ok('MAX_CHECKS_PER_PROJECT is 50', MAX_CHECKS_PER_PROJECT === 50);

  const rec = (id: string, over: Partial<CodeCheckRecord> = {}): CodeCheckRecord => ({
    id, projectId: 'p1', createdAt: `2026-09-01T00:00:${id.padStart(2, '0').slice(-2)}Z`, updatedAt: '2026-09-01T00:00:00Z',
    source: { kind: 'project' }, category: 'residential', categoryLabel: 'Residential', scenario: 'Deck guard check here',
    address: 'Brooklyn, NY', answers: [], followUps: [],
    grounding: {
      authority: null, codes: '', checkedOn: null, grounded: false, chipLabel: '', buildingRecordKind: 'none',
      buildingRecordHeadline: null, departmentName: null, jobDataSent: [],
    },
    result: { summary: '', applicableCodes: [], permitsRequired: [], inspections: [], commonViolations: [] },
    disclaimer: '', recallNote: '', actions: [], ...over,
  });
  const act = (kind: CodeThreadActionRecord['kind'], index: number, section: CodeThreadActionRecord['section'] = 'permits'): CodeThreadActionRecord =>
    ({ kind, section, index, createdId: `${kind}-${index}`, at: '2026-09-02T00:00:00Z' });

  let list: CodeCheckRecord[] = [];
  for (let i = 0; i < 55; i++) list = upsertCheck(list, rec(String(i)));
  ok('the store caps at 50 per job', list.length === 50, `got ${list.length}`);
  ok('newest first; the oldest dropped', list[0].id === '54' && list[49].id === '5' && !list.some((r) => r.id === '0'));
  const res = (over: Partial<CodeCheckRecord['result']> = {}): CodeCheckRecord['result'] =>
    ({ summary: '', applicableCodes: [], permitsRequired: [], inspections: [], commonViolations: [], ...over });
  const permits20 = res({ permitsRequired: ['Building alteration permit'] });
  const withAct = list.map((r) => (r.id === '20' ? { ...r, result: permits20, actions: [act('permit', 0)] } : r));
  const reRun = upsertCheck(withAct, rec('20', { scenario: 'Re-run with an answer', result: permits20 }));
  const r20 = reRun.find((r) => r.id === '20');
  ok('upsert by id: one record, not two', reRun.filter((r) => r.id === '20').length === 1 && reRun.length === 50);
  ok('upsert moves the re-run to the front', reRun[0].id === '20' && r20?.scenario === 'Re-run with an answer');
  ok('upsert keeps the actions already taken', !!r20 && r20.actions.length === 1 && r20.actions[0].kind === 'permit');

  // Actions follow the item's TEXT across a re-run, never its position (the
  // IC4 [R] case: Electrical permit added, then a follow-up reorders the list).
  const run1 = res({
    permitsRequired: ['Electrical permit for the new basement circuits', 'Building alteration permit'],
    applicableCodes: [
      { code: 'NYC BC', section: '1', requirement: 'Guards at the stair' },
      { code: 'NYC BC', section: '2', requirement: 'Egress window in the bedroom' },
    ],
  });
  const run2 = res({
    permitsRequired: ['Building alteration permit', 'Plumbing permit for the wet bar'],
    applicableCodes: [
      { code: 'NYC BC', section: '9', requirement: 'Egress window in the bedroom' },
      { code: 'NYC BC', section: '1', requirement: '  Guards at the stair ' },
    ],
  });
  const gone = remapActions(run1, [act('permit', 0)], run2);
  ok('remap: an action whose item is gone is dropped (never lands on another item)', gone.length === 0, JSON.stringify(gone));
  const moved = remapActions(run1, [act('permit', 1)], run2);
  ok('remap: an action whose item moved keeps it at the new index',
    moved.length === 1 && moved[0].index === 0 && moved[0].createdId === 'permit-1', JSON.stringify(moved));
  const codesMoved = remapActions(run1, [act('rfi', 0, 'codes'), act('punch', 0, 'codes'), act('rfi', 1, 'codes')], run2);
  ok('remap: codes match on the trimmed requirement; two kinds on one item both follow it',
    codesMoved.length === 3
    && codesMoved.filter((a) => a.index === 1).length === 2
    && codesMoved.some((a) => a.kind === 'rfi' && a.index === 0 && a.createdId === 'rfi-1'), JSON.stringify(codesMoved));
  const dupes = remapActions(res({ inspections: ['Final', 'Final'] }), [act('rfi', 1, 'inspections')], res({ inspections: ['Final'] }));
  ok('remap: duplicate texts are claimed in order (the second copy, now gone, drops)', dupes.length === 0, JSON.stringify(dupes));
  ok('remap: an identical result keeps every action as-is',
    JSON.stringify(remapActions(run1, [act('permit', 1), act('rfi', 0, 'codes')], run1))
      === JSON.stringify([act('permit', 1), act('rfi', 0, 'codes')]));
  ok('remap: a section never matches another section',
    remapActions(res({ permitsRequired: ['X'] }), [act('permit', 0)], res({ inspections: ['X'] })).length === 0);
  const ic4 = upsertCheck([rec('R', { result: run1, actions: [act('permit', 0)] })], rec('R', { result: run2, actions: [] }));
  ok('upsert remaps stored actions to the re-run: "Building alteration permit" is NOT marked Added',
    ic4[0].actions.length === 0, JSON.stringify(ic4[0].actions));
  const ic4b = upsertCheck([rec('R', { result: run1, actions: [act('permit', 1)] })], rec('R', { result: run2, actions: [] }));
  ok('upsert: the moved permit keeps its Added mark at its new index',
    ic4b[0].actions.length === 1 && ic4b[0].actions[0].index === 0 && run2.permitsRequired[0] === run1.permitsRequired[1]);
  const a1 = appendAction([], act('rfi', 2, 'codes'));
  const a2 = appendAction(a1, { ...act('rfi', 2, 'codes'), createdId: 'other', at: 'later' });
  ok('appendAction is idempotent on kind + section + index', a2.length === 1 && a2[0].createdId === 'rfi-2');
  ok('appendAction keeps a different index / section / kind',
    appendAction(a1, act('rfi', 3, 'codes')).length === 2
    && appendAction(a1, act('rfi', 2, 'permits')).length === 2
    && appendAction(a1, act('punch', 2, 'codes')).length === 2);

  ok('a corrupt blob parses to null', parseCodeChecksBlob('{not json') === null && parseCodeChecksBlob('[1,2]') === null
    && parseCodeChecksBlob('{"p1": 3}') === null);
  ok('a missing blob is an empty store', JSON.stringify(parseCodeChecksBlob(null)) === '{}');

  let heard = 0;
  const unsub = subscribeCodeChecks(() => { heard++; });
  mem.set(CODE_CHECKS_KEY, '{corrupt');
  const bad = await loadCodeChecks('p1');
  ok('a corrupt stored blob → { ok:false } (never "no checks")', bad.ok === false);
  ok('saving over an unreadable blob refuses (it would erase every check)',
    (await saveCodeCheck(rec('x'))) === false && mem.get(CODE_CHECKS_KEY) === '{corrupt');
  mem.delete(CODE_CHECKS_KEY);
  const empty = await loadCodeChecks('p1');
  ok('no blob → { ok:true, checks: [] }', empty.ok === true && empty.checks.length === 0);
  const viol = res({ commonViolations: ['Missing guard', 'Open junction box'] });
  const saved = await saveCodeCheck(rec('s1', { result: viol }));
  const after = await loadCodeChecks('p1');
  ok('save then load round-trips', saved && after.ok && after.checks.length === 1 && after.checks[0].id === 's1');
  ok('a write notifies subscribers', heard === 1, `heard ${heard}`);
  await recordCodeThreadAction('p1', 's1', act('punch', 1, 'violations'));
  await recordCodeThreadAction('p1', 's1', act('punch', 1, 'violations'));
  const afterAct = await loadCodeChecks('p1');
  ok('recordCodeThreadAction appends once', afterAct.ok && afterAct.checks[0].actions.length === 1);
  await saveCodeCheck(rec('s1', { scenario: 'again', result: viol }));
  const afterResave = await loadCodeChecks('p1');
  ok('saveCodeCheck preserves actions on the same id', afterResave.ok && afterResave.checks[0].actions.length === 1
    && afterResave.checks[0].scenario === 'again');
  ok('recording on a missing record is false', (await recordCodeThreadAction('p1', 'nope', act('rfi', 0))) === false);
  unsub();

  // ── 2. Context ─────────────────────────────────────────────────────────
  console.log('\n2. Job context');
  const cat = (type: string) => categoryForProject({ type } as Pick<Project, 'type'>);
  ok('categoryForProject map', cat('electrical') === 'electrical' && cat('plumbing') === 'plumbing'
    && cat('commercial') === 'commercial' && cat('concrete') === 'structural' && cat('renovation') === 'residential'
    && cat('other') === 'residential' && cat('new_build') === 'residential' && cat('roofing') === 'residential');

  const base = {
    id: 'p1', name: 'Park Slope Reno', type: 'renovation', location: '124 Park Pl, Brooklyn, NY 11217',
    structuredAddress: { street: '124 Park Pl', city: 'Brooklyn', state: 'NY', zip: '11217' },
    squareFootage: 1850, quality: 'standard', description: 'Gut reno of the parlor floor',
    createdAt: '', updatedAt: '', estimate: null, status: 'in_progress',
    linkedEstimate: {
      id: 'e1', globalMarkup: 0, baseTotal: 0, markupTotal: 0, grandTotal: 0, createdAt: '',
      items: [
        { materialId: 'm1', name: 'Deck guard rail', category: 'carpentry', unit: 'lf', quantity: 42, unitPrice: 0, bulkPrice: 0, markup: 0, usesBulk: false, lineTotal: 0, supplier: '' },
        { materialId: 'm2', name: 'Smoke alarm', category: 'electrical', unit: 'ea', quantity: 6, unitPrice: 0, bulkPrice: 0, markup: 0, usesBulk: false, lineTotal: 0, supplier: '' },
      ],
    },
    schedule: { tasks: [{ phase: 'Demo' }, { phase: 'Framing' }, { phase: 'Demo' }] },
  } as unknown as Project;
  const addrKey = zoningAddressKey(base);
  const guessed = { ...base, structuredAddress: { ...base.structuredAddress!, zoningDistrict: 'R6B', zoningSource: 'guess' } } as Project;
  const confirmed = {
    ...base,
    structuredAddress: {
      ...base.structuredAddress!, zoningDistrict: 'R6B', zoningSource: 'confirmed',
      zoningConfirmedAt: '2026-08-20T12:00:00.000Z', zoningConfirmedFor: addrKey ?? undefined,
    },
  } as Project;

  const sProject = scenarioForSource({ kind: 'project', project: base });
  const sPunch = scenarioForSource({ kind: 'punch', project: base, punch: { description: 'Missing guard at stair', location: 'Rear deck' } });
  const sPunchBare = scenarioForSource({ kind: 'punch', project: base, punch: { description: '', location: '' } });
  const sSheet = scenarioForSource({ kind: 'plan_sheet', project: base, sheet: { sheetNumber: 'A-101', name: 'Floor Plan' } });
  const sSheetBare = scenarioForSource({ kind: 'plan_sheet', project: base, sheet: { sheetNumber: undefined, name: '' } });
  const sNoType = scenarioForSource({ kind: 'project', project: { ...base, type: '' as never, squareFootage: 0 } });
  ok('every scenario is longer than 10 characters (the Run gate)',
    [sProject, sPunch, sPunchBare, sSheet, sSheetBare, sNoType].every((s) => s.length > 10),
    [sProject, sPunch, sPunchBare, sSheet, sSheetBare, sNoType].join(' | '));
  ok('project scenario names the type and size', sProject.includes('Renovation') && sProject.includes('1,850 sf'), sProject);
  ok('punch scenario quotes the item and location', sPunch.startsWith('Punch item: "Missing guard at stair" at Rear deck.'), sPunch);
  ok('plan-sheet scenario names the sheet', sSheet.startsWith('Plan sheet A-101 Floor Plan:'), sSheet);

  const ctx = codeThreadContextBlock(base);
  ok('the block opens with the contractor\'s own records', ctx.block.startsWith('PROJECT CONTEXT (from "Park Slope Reno", the contractor\'s own records):'));
  ok('the block has the estimate quantity + unit + category', ctx.block.includes('  - Deck guard rail — 42 lf, carpentry'), ctx.block);
  ok('the block has the size and distinct schedule phases',
    ctx.block.includes('- Size: 1,850 sf') && ctx.block.includes('- Schedule phases: Demo, Framing'));
  ok('the block has the scope notes', ctx.block.includes('- Scope notes: Gut reno of the parlor floor'));
  ok('sent names exactly what the block holds',
    JSON.stringify(ctx.sent) === JSON.stringify(['type', '1,850 sf', 'scope notes', '2 estimate lines', '2 schedule phases']),
    JSON.stringify(ctx.sent));
  const ctxGuess = codeThreadContextBlock(guessed);
  ok('an unconfirmed (guess) zoning district is NOT sent',
    !ctxGuess.block.includes('R6B') && !ctxGuess.block.includes('Zoning') && !ctxGuess.sent.includes('confirmed zoning'));
  const ctxConf = codeThreadContextBlock(confirmed);
  ok('the confirmed-zoning fixture resolves to an address key', !!addrKey);
  ok('a confirmed zoning district IS sent, labelled as his',
    ctxConf.block.includes('- Zoning district: R6B (confirmed by the contractor)') && ctxConf.sent.includes('confirmed zoning'),
    ctxConf.block);
  ok('the context cache fragment moves with the block', ctx.cacheFragment !== ctxConf.cacheFragment);
  const many = { ...base, linkedEstimate: { ...base.linkedEstimate!, items: Array.from({ length: 45 }, (_, i) => ({ ...base.linkedEstimate!.items[0], name: `Line ${i}` })) } } as Project;
  const ctxMany = codeThreadContextBlock(many);
  ok('at most 40 estimate lines, and sent says "40 of 45"',
    ctxMany.block.includes('Line 39') && !ctxMany.block.includes('Line 40 ') && ctxMany.sent.includes('40 of 45 estimate lines'),
    JSON.stringify(ctxMany.sent));

  // ── 3. Follow-ups ──────────────────────────────────────────────────────
  console.log('\n3. Follow-ups');
  const ans = (n: number): CodeThreadAnswer[] =>
    Array.from({ length: n }, (_, i) => ({ questionId: `q${i}`, question: `Question ${i}?`, answer: 'Yes' }));
  const rawFu = [
    { id: 'q0', question: 'Already answered?', options: ['Yes', 'No'] },
    { id: 'sleep', question: 'Is the room used for sleeping?', options: ['Yes', 'No'] },
    { id: 'one', question: 'Only one option?', options: ['Yes'] },
    { id: 'win', question: 'New or existing window?', options: ['New', 'Existing', 'new'] },
    { id: '', question: 'Is the deck more than 30 inches above grade?', options: ['Yes', 'No', 'Not sure'] },
    { id: 'five', question: 'Five options?', options: ['a', 'b', 'c', 'd', 'e'] },
    { id: 'more', question: 'A fourth good one?', options: ['Yes', 'No'] },
  ];
  const fu0 = coerceFollowUps(rawFu, []);
  ok('caps at 3 with nothing answered', fu0.length === MAX_FOLLOW_UPS && MAX_FOLLOW_UPS === 3, JSON.stringify(fu0.map((f) => f.id)));
  ok('rejects a 1-option question', !fu0.some((f) => f.id === 'one'));
  ok('dedupes options case-insensitively', fu0.find((f) => f.id === 'win')?.options.length === 2);
  const fuNoId = coerceFollowUps([{ id: '', question: 'Is the deck more than 30 inches above grade?', options: ['Yes', 'No', 'Not sure'] }], []);
  ok('generates an id from the question when missing', fuNoId.length === 1 && fuNoId[0].id === 'is-the-deck-more-than-30-inches-above-grade',
    JSON.stringify(fuNoId));
  const fu1 = coerceFollowUps(rawFu, ans(1));
  ok('caps at 3 − answered, and drops ids already answered',
    fu1.length === 2 && !fu1.some((f) => f.id === 'q0'), JSON.stringify(fu1.map((f) => f.id)));
  ok('no follow-ups once 3 are answered', coerceFollowUps(rawFu, ans(3)).length === 0);
  ok('rejects an over-long option', coerceFollowUps([{ id: 'x', question: 'Long?', options: ['y'.repeat(61), 'No'] }], []).length === 0);
  ok('a non-array is []', coerceFollowUps('nope', []).length === 0 && coerceFollowUps(null, []).length === 0);
  ok('followUpInstruction asks below 3', followUpInstruction(ans(2)).startsWith('- followUps: up to 3 questions ONLY where the answer would change'));
  ok('followUpInstruction stops at 3', followUpInstruction(ans(3)) === 'Do not ask any more follow-up questions; return followUps as [].');
  ok('answeredFactsBlock is empty with no answers', answeredFactsBlock([]) === '');
  ok('answeredFactsBlock lists each answer as his fact',
    answeredFactsBlock(ans(2)) === "ANSWERED FACTS (the contractor's own answers; treat them as true for this job):\n- Q: Question 0? A: Yes\n- Q: Question 1? A: Yes");
  ok('the cache fragment changes when an answer is added',
    answersCacheFragment(ans(0)) !== answersCacheFragment(ans(1)) && answersCacheFragment(ans(1)) !== answersCacheFragment(ans(2)));
  ok('the cache fragment changes when an answer differs',
    answersCacheFragment(ans(1)) !== answersCacheFragment([{ ...ans(1)[0], answer: 'No' }]));

  // ── 4. The follow-up hint reaches the relay as an array of objects ──────
  console.log('\n4. Follow-up schema hint');
  // THIS MIRRORS utils/mageAI.ts deriveHintFromZod (its default / catch /
  // array / object / string branches, copied exactly). ZodCatch is NOT
  // unwrapped there, so it falls through to null here too.
  function mirrorHint(schema: any, depth = 0): unknown {
    if (!schema || depth > 5) return null;
    const def = schema._def;
    if (!def) return null;
    const t = def.typeName ?? def.type;
    if (t === 'ZodOptional' || t === 'optional' || t === 'ZodNullable' || t === 'nullable' || t === 'ZodReadonly' || t === 'readonly') {
      return mirrorHint(def.innerType ?? def.type, depth + 1);
    }
    if (t === 'ZodDefault' || t === 'default') {
      let dv: unknown;
      if (typeof def.defaultValue === 'function') {
        try { dv = def.defaultValue(); } catch { dv = undefined; }
      } else {
        dv = def.defaultValue;
      }
      const isEmptyContainer =
        (Array.isArray(dv) && dv.length === 0) ||
        (dv != null && typeof dv === 'object' && !Array.isArray(dv) && Object.keys(dv as object).length === 0);
      if (dv !== undefined && !isEmptyContainer) return dv;
      return mirrorHint(def.innerType, depth + 1);
    }
    if (t === 'ZodString' || t === 'string') return '';
    if (t === 'ZodArray' || t === 'array') {
      const inner = mirrorHint(def.element ?? def.type, depth + 1);
      return inner == null ? [] : [inner];
    }
    if (t === 'ZodObject' || t === 'object') {
      const out: Record<string, unknown> = {};
      const shape = typeof def.shape === 'function' ? def.shape() : def.shape;
      if (!shape) return {};
      for (const k of Object.keys(shape)) out[k] = mirrorHint(shape[k], depth + 1);
      return out;
    }
    return null;
  }
  const mageAISrc = read('utils/mageAI.ts');
  ok('the mirror still matches mageAI: ZodCatch is not an unwrapped branch there',
    mageAISrc.includes('function deriveHintFromZod(') && !/t === 'ZodCatch'|t === 'catch'/.test(mageAISrc));
  const hint = mirrorHint(followUpsZod);
  const sch = inferSchema(hint) as { type: string; items?: { type: string; properties?: Record<string, { type: string; items?: { type: string } }> } };
  ok('followUpsZod hint is [{id:"",question:"",options:[""]}]', JSON.stringify(hint) === '[{"id":"","question":"","options":[""]}]', JSON.stringify(hint));
  ok('inferSchema: type array', sch.type === 'array', JSON.stringify(sch));
  ok('inferSchema: items are objects', sch.items?.type === 'object');
  ok('inferSchema: items.properties.options is an array', sch.items?.properties?.options?.type === 'array');
  const fuSrc = read('utils/codeThread/followUps.ts');
  const zodDecl = fuSrc.slice(fuSrc.indexOf('export const followUpsZod'), fuSrc.indexOf('})).default([]);', fuSrc.indexOf('export const followUpsZod')) + 16);
  ok('followUps.ts: no .catch( on the outer array', zodDecl.length > 20 && /\}\)\)\.default\(\[\]\);$/.test(zodDecl) && !/\)\)\.catch\(/.test(zodDecl), zodDecl);
  ok('followUps.ts: no .catch( on options', /options: z\.array\(z\.string\(\)\)\.default\(\[\]\),/.test(zodDecl) && !/options:[^\n]*\.catch\(/.test(zodDecl));

  // ── 5. Drafts ──────────────────────────────────────────────────────────
  console.log('\n5. Drafts');
  const rfi = rfiDraftFromCodeItem({ projectId: 'p1', text: 'Guards required at 30 in above grade', authority: 'NYC Department of Buildings', codes: 'NYC BC 2022', submittedBy: 'Omir', nowISO: '2026-09-26T00:00:00Z' });
  ok('RFI draft is unsent: dateSubmitted \'\' and ballInCourt \'gc\'', rfi.dateSubmitted === '' && rfi.ballInCourt === 'gc' && rfi.status === 'open');
  ok('RFI draft cites codes and authority', rfi.question.startsWith('Our code check (NYC BC 2022; NYC Department of Buildings) flagged:'));
  ok('RFI draft without an authority says so', rfiDraftFromCodeItem({ projectId: 'p1', text: 'x', authority: null, codes: 'IRC 2021', submittedBy: '', nowISO: '' }).question.includes('jurisdiction not on file'));
  const permit = permitDraftFromCodeItem({ project: { id: 'p1', name: 'Park Slope Reno' }, text: 'Electrical permit for the new circuits', authority: 'NYC Department of Buildings', checkedOnLabel: 'Sep 26, 2026', today: '2026-09-26' });
  ok('permit jurisdiction is the authority', permit.jurisdiction === 'NYC Department of Buildings');
  ok('permit jurisdiction never looks like a street address',
    !/^\d+\s/.test(permit.jurisdiction) && !permit.jurisdiction.includes('Park Pl'));
  ok('permit with no authority is blank, not the address',
    permitDraftFromCodeItem({ project: { id: 'p1', name: 'x' }, text: 'Building permit', authority: null, checkedOnLabel: 'x', today: 'x' }).jurisdiction === '');
  ok('permit note says \'Not filed yet\'', !!permit.notes && permit.notes.includes('Not filed yet') && permit.notes.includes('From a code check on Sep 26, 2026.'));
  ok('permit type map', permit.type === 'electrical' && permitTypeForCodeItem('Plumbing permit') === 'plumbing'
    && permitTypeForCodeItem('HVAC duct work') === 'mechanical' && permitTypeForCodeItem('Demolition permit') === 'demolition'
    && permitTypeForCodeItem('Sprinkler alteration') === 'fire' && permitTypeForCodeItem('Certificate of occupancy') === 'occupancy'
    && permitTypeForCodeItem('Alteration permit') === 'building');
  const punch = punchDraftFromCodeItem({ projectId: 'p1', text: 'x'.repeat(400), recordDateLabel: 'Sep 26', authority: null, nowISO: '2026-09-26T00:00:00Z', id: 'pi1' });
  ok('punch draft: capped description, open, punch list', punch.description.length <= 240 && punch.description.startsWith('Code check: ')
    && punch.status === 'open' && punch.listType === 'punch' && punch.location === '' && punch.assignedSub === '');
  const route = codeCheckRoute({ projectId: 'p1', source: 'punch', sourceId: 'pi1' });
  ok('codeCheckRoute carries only the defined keys', route.pathname === '/(tabs)/construction-ai'
    && JSON.stringify(route.params) === '{"projectId":"p1","source":"punch","sourceId":"pi1"}');

  // ── 6. The Code Check screen ───────────────────────────────────────────
  console.log('\n6. Code Check screen (source)');
  const index = read('app/(tabs)/construction-ai/index.tsx');
  ok('index.tsx is readable', index.length > 0);
  // Same regex as scripts/validate-code-check-honesty.ts section 3.
  const checkCalls = [...index.matchAll(/mageAISmart\(([^;]*?(?:codeCheckSchema|codeDetailSchema)[^;]*?)\)/g)].map((m) => m[1]);
  ok('exactly two schema mageAISmart calls (a follow-up re-runs the same call)', checkCalls.length === 2, `found ${checkCalls.length}`);
  ok('codeCheckSchema carries followUps: followUpsZod', /const codeCheckSchema = z\.object\(\{[\s\S]*?followUps: followUpsZod,[\s\S]*?\}\);/.test(index));
  const onAnswerAt = index.indexOf('const onAnswerFollowUp = useCallback(');
  const onAnswer = onAnswerAt >= 0 ? index.slice(onAnswerAt, index.indexOf('}, [', onAnswerAt)) : '';
  ok('the follow-up tap closes the result sheet first', /setResultOpen\(false\);/.test(onAnswer), onAnswer.slice(0, 200));
  ok('then re-runs the check after the iOS dismissal delay',
    /setTimeout\(\(\) => \{ void runCheck\(next\); \}, Platform\.OS === 'ios' \? 450 : 80\);/.test(onAnswer));
  ok('the follow-up tap stops at 3 answers', /answers\.length >= MAX_FOLLOW_UPS/.test(onAnswer));
  ok('a repeat tap on an answered question, or a double tap, starts no second paid re-run',
    /answers\.some\(\(a\) => a\.questionId === fu\.id\)\) return;/.test(onAnswer) && /Date\.now\(\) - lastFollowUpTapAt\.current < 1500\) return;/.test(onAnswer));
  ok('runCheck takes an answered override', /const runCheck = useCallback\(async \(answeredOverride\?: CodeThreadAnswer\[\]\) =>/.test(index)
    && index.includes('onPress={() => runCheck()}'));
  ok('CodeThreadActions is imported from L4\'s component',
    /import CodeThreadActions from '@\/components\/codeThread\/CodeThreadActions';/.test(index));
  const actionMounts = [...index.matchAll(/<CodeThreadActions[\s\S]*?\/>/g)].map((m) => m[0]);
  ok('every CodeThreadActions mount passes onBeforeNavigate={onClose}',
    actionMounts.length >= 4 && actionMounts.every((m) => m.includes('onBeforeNavigate={onClose}')), `mounts ${actionMounts.length}`);
  ok('DepartmentCard renders with testID codethread-department', /<DepartmentCard project=\{project\} testID="codethread-department" \/>/.test(index));
  const effAt = index.indexOf('const handledParamsKey = useRef<string | null>(null);');
  const eff = effAt >= 0 ? index.slice(effAt, index.indexOf('}, [', effAt)) : '';
  ok('the params effect is keyed by handledParamsKey', eff.includes('handledParamsKey.current === key') && eff.includes('handledParamsKey.current = key;'));
  ok('the params effect is guarded on params.projectId resolving to a project',
    /const pid = params\.projectId;/.test(eff) && /if \(!pid\) return;/.test(eff) && /projects\.find\(\(p\) => p\.id === pid\)/.test(eff) && /if \(!project\) return;/.test(eff));
  ok('the params entry links through selectCodeCheckProject (never setCodeCheckProjectId)',
    eff.includes('const linkProject = selectCodeCheckProject;') && eff.includes('linkProject(pid);') && !eff.includes('setCodeCheckProjectId('));
  ok('the key covers all four params',
    eff.includes("`${params.projectId ?? ''}|${params.source ?? ''}|${params.sourceId ?? ''}|${params.mode ?? ''}`"));
  ok('the params effect has no boolean one-shot ref', !/useRef\((false|true)\)/.test(eff) && !/useRef<boolean>/.test(eff));
  ok('the key is marked only after the project resolves',
    eff.indexOf('if (!project) return;') >= 0 && eff.indexOf('if (!project) return;') < eff.indexOf('handledParamsKey.current = key;'));
  ok('subscribeCodeChecks keeps the saved record fresh', index.includes('subscribeCodeChecks('));
  ok('a re-run carries actions by item text (remapActions), never by position alone',
    index.includes('actions: reused ? remapActions(reused.result, reused.actions, resultSnapshot) : []')
    && !index.includes('actions: reused ? reused.actions : []'));
  ok('result-sheet actions remount per item text (no local "Added" outlives its item)',
    (index.match(/<CodeThreadActions key=\{`(codes|permits|inspections|violations)-\$\{i\}-/g) ?? []).length === 4);
  const savedSheet = read('components/codeThread/SavedCodeCheckSheet.tsx');
  ok('saved-sheet actions carry the bare requirement, not the recalled section number',
    savedSheet.includes('actionTexts: codes.map((c) => c.requirement') && savedSheet.includes('text={s.actionTexts[i] ?? text}'));
  ok("saved checks say 'until you sign out'", index.includes('until you sign out'));
  ok('the saved line carries its testID', index.includes('testID="codethread-saved"'));
  ok('the sent chip carries its testID and says what was sent',
    index.includes('testID="codethread-sent"') && index.includes('Sent from this job: ${'));
  ok('the follow-up caption says each answer uses one of today\'s checks',
    index.includes("Each answer re-runs the check (uses 1 of today's ${dailyCap})."));
  ok('a NYC job whose record was not read says not checked, never no violations',
    index.includes('DOB record not checked (building not confirmed or not loaded)'));
  ok('the building record goes into the prompt only when ready',
    /codeBuilding\.phase === 'ready' && codeBuilding\.summary\.promptBlock/.test(index));
  ok('the cache key carries context, building record and answers',
    /::\$\{ctx\?\.cacheFragment \?\? 'noctx'\}::\$\{codeBuilding\.phase === 'ready' \? codeBuilding\.summary\.cacheKey : 'nobr'\}::\$\{answersCacheFragment\(answered\)\}/.test(index));
  ok('the old 120-char scenario slice is gone from the cache key', !index.includes('scenario.trim().toLowerCase().slice(0, 120)'));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
