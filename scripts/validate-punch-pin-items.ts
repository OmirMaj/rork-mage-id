// scripts/validate-punch-pin-items.ts — pin every item on the plan, before or
// after the photo.
//
// WHY THIS EXISTS. The founder, 2026-09-18: "i want to be able to pin the
// location of each item before and after taking photos where is that
// ability?" His 63 real items came from the Photo walk, which never pins, and
// nothing could pin an existing item. This build adds Pin items (after the
// photo, app/punch-pin.tsx), Pin first (before the photo, Walk Mode with
// start=pin) and the edit sheet's Pin on plan / Move pin / Remove pin. Their
// failures are all silent:
//   • a queue numbered differently from the PDF sends him to #14 and the
//     owner reads #15;
//   • "pinned" judged more loosely than the export says "all 63 pinned" and
//     hands over a PDF with half of them missing from the plan pages;
//   • Remove pin sent as `undefined` is dropped by JSON — the server keeps the
//     pin and the next refetch brings it back;
//   • a refetch racing a queued pin write puts the old pin back on screen;
//   • a pin normalised against the wrong box lands a door-width away.
//
// HOW IT CHECKS.
//   A. The pure logic is EXECUTED: utils/punchPinQueue, utils/pinQueueHandoff,
//      the punchPlanPin additions, utils/projectContextPure's pin overlay, and
//      ProjectContext's own pure block (lifted and run, as validate-punch-batch
//      does) for the NULLs a removal sends.
//   B. Geometry parity is EXECUTED: a tap through PlanPinStep's math, drawn by
//      plan-viewer's formula, written by the export, lands on the same point.
//   C. Wiring is pinned on comment-stripped source.
//
// Run via: bun run scripts/validate-punch-pin-items.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { punchListTypeOf } from '../types';
import type { DrawingPin, PlanSheet, PunchItem } from '../types';
import { isDeviceLocalUri } from '../utils/photoUploadCore';
import { buildPunchExportModel, punchItemNumbers } from '../utils/punchExportCore';
import { pinStyle } from '../utils/punchExportHtml';
import {
  containImageRect, normalizeTapToImage, pinMarkerPosition, pinTipFromMarker, planViewerImageRatio, punchPinFields,
  pickInitialPinSheet, pinsOnSheet, shouldAutoOpenPinStep, shouldOpenCameraAfterPin, walkStartFromParam,
  type WalkPin,
} from '../utils/punchPlanPin';
import {
  CLEAR_PIN_PATCH, PIN_CANVAS_FLOOR, buildPinQueue, drawingPinMoveFor, drawingPinRemovalFor, drawingPinUndoFor,
  drawingPinSnapshotOf, initialPinQueueSession, isPinnedForExport, nextOpenIndex, parsePinQueueIds, pinCanvasHeight,
  pinPatchFor, pinQueueLayout, pinQueueProgress, pinRefOf, pinScopeStats, pinSeedFor, pinWriteBlockedReason, planPinStats, prevIndex,
  pinFieldsOf as pinFieldsOfItem, reducePinQueue, removePinConfirmCopy, sheetsByIdOf, undoPatchFor, walkPinOf,
  type PinQueueEnv, type PinQueueSession, type PinWrite,
} from '../utils/punchPinQueue';
import { peekPinQueueIds, stashPinQueueIds } from '../utils/pinQueueHandoff';
import { keepPendingPinFields, pendingPinIdsInQueue, pinOverlayIds } from '../utils/projectContextPure';

// Runs under bun, but tsc checks scripts against the app's lib set, which has
// no Bun global — declare the one API used (same as validate-punch-batch).
declare const Bun: {
  Transpiler: new (opts: { loader: 'ts' }) => { transformSync(code: string): string };
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; console.log('  ✗', label, detail ? `\n      ${detail}` : ''); }
}
function eq<T>(label: string, got: T, want: T) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  ok(label, g === w, g === w ? undefined : `got  ${g}\n      want ${w}`);
}
const read = (rel: string): string => { try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return ''; } };
function stripTsComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}
function between(src: string, start: string, end: string): string {
  const i = src.indexOf(start);
  if (i < 0) return '';
  const j = src.indexOf(end, i + start.length);
  return j < 0 ? '' : src.slice(i, j);
}
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

// ── fixtures ────────────────────────────────────────────────────────────────
const P = 'proj-1';
const T0 = Date.parse('2026-09-10T14:00:00.000Z');
const sheet = (id: string, w: number, h: number, extra: Partial<PlanSheet> = {}): PlanSheet => ({
  id, projectId: P, name: `Sheet ${id}`, imageUri: `https://x.test/${id}.png`, storagePath: `${P}/${id}.png`,
  width: w, height: h, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', ...extra,
});
const mk = (id: string, extra: Partial<PunchItem> = {}): PunchItem => ({
  id, projectId: P, description: `Item ${id}`, location: 'Hall 2', assignedSub: '', dueDate: '', priority: 'medium',
  status: 'open', listType: 'punch', createdAt: new Date(T0).toISOString(), updatedAt: new Date(T0).toISOString(), ...extra,
});
const S1 = sheet('s1', 3024, 4032);
const S2 = sheet('s2', 4032, 3024);
const SHEETS = [S1, S2];
const BY_ID = sheetsByIdOf(SHEETS);
const dpin = (id: string, extra: Partial<DrawingPin> = {}): DrawingPin => ({
  id, planSheetId: 's1', projectId: P, x: 0.3, y: 0.4, kind: 'punch', createdAt: '', updatedAt: '', ...extra,
});

// ───────────────────────────────────────────────────────────────────────────
console.log('\nA1. "pinned" is the export\'s verdict');
// ───────────────────────────────────────────────────────────────────────────
function exportModel(items: PunchItem[], sheets: PlanSheet[] = SHEETS) {
  return buildPunchExportModel({
    scopeInput: {
      allItems: items, filteredItems: items, selectedIds: [], activeList: 'punch',
      filters: { status: 'all', sub: '', priority: 'all', locationKey: '', locationLabel: '' },
    },
    scope: 'all', includeCrew: true, target: 'web', project: { id: P, name: 'Job' }, sheets,
    markupByItemId: new Map(), now: new Date(T0 + 86_400_000),
  });
}
{
  const cases: [string, PunchItem][] = [
    ['none', mk('a')],
    ['pinned', mk('b', { planSheetId: 's1', pinX: 0.2, pinY: 0.7 })],
    ['no-position', mk('c', { planSheetId: 's1' })],
    ['sheet-missing', mk('d', { planSheetId: 'gone', pinX: 0.2, pinY: 0.2 })],
    ['superseded sheet still pinned', mk('e', { planSheetId: 's3', pinX: 0.5, pinY: 0.5 })],
    ['out-of-range', mk('f', { planSheetId: 's1', pinX: 1.4, pinY: 0.5 })],
  ];
  const sheets = [...SHEETS, sheet('s3', 1000, 1000, { superseded: true })];
  const byId = sheetsByIdOf(sheets);
  const m = exportModel(cases.map(c => c[1]), sheets);
  for (const [label, item] of cases) {
    const row = m.rows.find(r => r.id === item.id);
    eq(`${label}: pinRefOf state === export row plan state`, pinRefOf(item, byId).state, row?.plan.state);
  }
  eq('planPinStats counts only export-pinned', planPinStats(cases.map(c => c[1]), byId), { total: 6, pinned: 2, unpinned: 4 });
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\nA2. queue numbers are the PDF numbers (63-item photo walk)');
// ───────────────────────────────────────────────────────────────────────────
{
  const walk: PunchItem[] = [];
  for (let i = 0; i < 63; i++) {
    walk.push(mk(`w${String(i).padStart(2, '0')}x${(i * 7919) % 97}`, {
      createdAt: new Date(T0 + i).toISOString(),
      listType: i === 5 ? 'crew' : 'punch',
      status: i === 9 ? 'closed' : 'open',
      ...(i === 20 ? { planSheetId: 's1', pinX: 0.4, pinY: 0.4 } : {}),
    }));
  }
  // Shuffle deterministically — context order is not capture order.
  const shuffled = [...walk].sort((a, b) => (a.id.charCodeAt(4) * 31 + a.id.length) % 13 - (b.id.charCodeAt(4) * 31 + b.id.length) % 13 || (a.id < b.id ? 1 : -1));
  const q = buildPinQueue({ allItems: shuffled, sheets: SHEETS, list: 'punch' });
  const m = exportModel(shuffled);
  const pdfNo = new Map(m.rows.map(r => [r.id, r.number]));
  let mismatches = 0;
  for (const e of q) if (pdfNo.get(e.id) !== e.number) mismatches++;
  eq('every queue number === its PDF row number', mismatches, 0);
  eq('the punch queue holds 61 (63 − 1 crew − 1 pinned)', q.length, 61);
  ok('the pinned item is left out', !q.some(e => e.id === walk[20].id));
  ok('the closed item is kept (it still prints on the plan page)', q.some(e => e.id === walk[9].id));
  ok('the crew item is not on the punch queue', !q.some(e => e.id === walk[5].id));
  eq('order is capture order', q.map(e => e.id), walk.filter((_, i) => i !== 5 && i !== 20).map(w => w.id));
  const crew = buildPinQueue({ allItems: shuffled, sheets: SHEETS, list: 'crew' });
  eq('a crew queue still carries whole-list numbers', crew.map(e => e.number), [6]);
  const scoped = buildPinQueue({ allItems: shuffled, sheets: SHEETS, list: 'punch', ids: [walk[5].id, walk[3].id, walk[20].id, 'nope'] });
  eq('ids scope any list, skip pinned and unknown ids, sorted by number', scoped.map(e => e.id), [walk[3].id, walk[5].id]);
  eq('numbers helper agrees', punchItemNumbers(shuffled).get(walk[0].id), 1);
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\nA3. queue helpers and the batch hand-off');
// ───────────────────────────────────────────────────────────────────────────
{
  eq('parsePinQueueIds drops junk and dupes', parsePinQueueIds(' a1, b-2 ,,a1, x y, <s>,c_3'), ['a1', 'b-2', 'c_3']);
  eq('parsePinQueueIds on nothing', parsePinQueueIds(undefined), []);
  eq('parsePinQueueIds caps at 200', parsePinQueueIds(Array.from({ length: 250 }, (_, i) => `i${i}`).join(',')).length, 200);
  eq('parsePinQueueIds accepts an array param', parsePinQueueIds(['a,b', 'c']), ['a', 'b', 'c']);
  const ids = ['a', 'b', 'c', 'd'];
  eq('nextOpenIndex skips closed ones', nextOpenIndex(ids, 0, id => id === 'c'), 2);
  eq('nextOpenIndex → length when none', nextOpenIndex(ids, 2, () => false), 4);
  eq('prevIndex finds the last existing before', prevIndex(ids, 3, id => id !== 'c'), 1);
  eq('prevIndex from past the end', prevIndex(ids, 9, () => true), 3);
  eq('prevIndex → -1 when none', prevIndex(ids, 0, () => true), -1);

  const t = stashPinQueueIds(['x', 'y', 'x']);
  ok('token shape', /^[a-z0-9]{4,16}$/.test(t), t);
  eq('round trip, deduped', peekPinQueueIds(t), ['x', 'y']);
  eq('peek is non-destructive', peekPinQueueIds(t), ['x', 'y']);
  eq('unknown token → null', peekPinQueueIds('zzzzzz'), null);
  eq('invalid token → null', peekPinQueueIds('../etc'), null);
  eq('missing token → null', peekPinQueueIds(undefined), null);
  const big = stashPinQueueIds(Array.from({ length: 250 }, (_, i) => `id${i}`));
  eq('250 ids capped to 200', peekPinQueueIds(big)?.length, 200);
  const more = [1, 2, 3, 4].map(n => stashPinQueueIds([`n${n}`]));
  eq('the 6th stash evicts the oldest', peekPinQueueIds(t), null);
  eq('…the newest 5 survive', [big, ...more].map(k => peekPinQueueIds(k) !== null), [true, true, true, true, true]);
}

{
  // The header's count: the whole list (resume: 20 of 63, never 0 of 43).
  const items = [
    ...Array.from({ length: 20 }, (_, k) => mk(`p${k}`, { planSheetId: 's1', pinX: 0.1, pinY: 0.1 })),
    ...Array.from({ length: 43 }, (_, k) => mk(`u${k}`)),
    mk('c1', { listType: 'crew' }),
  ];
  const st = pinScopeStats({ allItems: items, sheetsById: BY_ID, list: 'punch' });
  eq('pinScopeStats: the whole punch list after a resume', st, { total: 63, pinned: 20, unpinned: 43, missing: 0 });
  eq('pinScopeStats: a batch counts its own items, and the ones this phone lacks',
    pinScopeStats({ allItems: items, sheetsById: BY_ID, list: 'punch', ids: ['p1', 'u1', 'gone-1', 'gone-2'] }),
    { total: 2, pinned: 1, unpinned: 1, missing: 2 });
  eq('pinScopeStats: a batch of ids none of which are here', pinScopeStats({ allItems: items, sheetsById: BY_ID, list: 'punch', ids: ['gone'] }),
    { total: 0, pinned: 0, unpinned: 0, missing: 1 });
  eq('pinScopeStats: a pin on a sheet not loaded yet is NOT pinned (why the screen waits for planSheetsLoaded)',
    pinScopeStats({ allItems: items, sheetsById: new Map(), list: 'punch' }).pinned, 0);
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\nA4. the Pin items cursor');
// ───────────────────────────────────────────────────────────────────────────
{
  const env = (exists: string[], pinned: string[] = []): PinQueueEnv => ({ exists: new Set(exists), pinned: new Set(pinned) });
  const all = ['a', 'b', 'c', 'd'];
  const w = (itemId: string, after: WalkPin | null = { sheetId: 's1', x: 0.5, y: 0.5 }, before = {}): PinWrite => ({ itemId, before, after });
  let s: PinQueueSession = initialPinQueueSession(['a', 'b']);
  s = reducePinQueue(s, { type: 'live', ids: all });
  eq('before the first action the list follows hydration', s.ids, all);
  s = reducePinQueue(s, { type: 'saved', itemId: 'a', write: w('a'), env: env(all, ['c']) });
  eq('saved → next open item, skipping one pinned elsewhere', s.index, 1);
  ok('…frozen', s.frozen);
  eq('…remembers the sheet', s.lastSheetId, 's1');
  const frozen = reducePinQueue(s, { type: 'live', ids: ['z'] });
  ok('live is ignored once frozen', frozen === s);
  ok('a stale saved for a non-current item returns the SAME session',
    reducePinQueue(s, { type: 'saved', itemId: 'a', write: w('a'), env: env(all) }) === s);
  ok('a stale skip returns the SAME session', reducePinQueue(s, { type: 'skip', itemId: 'a', env: env(all) }) === s);
  ok('a stale kept returns the SAME session', reducePinQueue(s, { type: 'kept', itemId: 'd', sheetId: 's1', env: env(all) }) === s);
  eq('progress counts this session\'s pin even while env shows it unpinned', pinQueueProgress(s, env(all)).pinned, 1);
  s = reducePinQueue(s, { type: 'skip', itemId: 'b', env: env(all, ['c']) });
  eq('skip → next open (d)', s.index, 3);
  eq('…skipped recorded', s.skipped, ['b']);
  s = reducePinQueue(s, { type: 'back', env: env(all, ['c']) });
  eq('back reaches a pinned item', s.ids[s.index], 'c');
  s = reducePinQueue(s, { type: 'back', env: env(all) });
  s = reducePinQueue(s, { type: 'back', env: env(all) });
  eq('back to the first', s.index, 0);
  eq('back at the first stays put', reducePinQueue(s, { type: 'back', env: env(all) }).index, 0);
  s = { ...s, index: 3 };
  s = reducePinQueue(s, { type: 'undo', env: env(all) });
  eq('undo returns the cursor to the undone item', s.ids[s.index], 'a');
  eq('…pops history', s.history.length, 0);
  eq('…and drops it from this session\'s pins (it had none before)', s.pinnedThisSession, []);
  s = reducePinQueue(s, { type: 'saved', itemId: 'a', write: w('a'), env: env(all) });
  s = reducePinQueue(s, { type: 'saved', itemId: 'b', write: w('b'), env: env(all) });
  eq('cursor on c', s.ids[s.index], 'c');
  s = reducePinQueue(s, { type: 'current-gone', env: env(['a', 'b', 'd']) });
  eq('current-gone advances past the deleted item', s.ids[s.index], 'd');
  s = reducePinQueue(s, { type: 'kept', itemId: 'd', sheetId: 's2', env: env(all) });
  ok('kept advances without history (done)', s.index >= s.ids.length && s.history.length === 2 && s.lastSheetId === 's2');
  let r: PinQueueSession = initialPinQueueSession(all);
  r = reducePinQueue(r, { type: 'skip', itemId: 'a', env: env(all) });
  r = reducePinQueue(r, { type: 'saved', itemId: 'b', write: w('b'), env: env(all) });
  r = reducePinQueue(r, { type: 'skip', itemId: 'c', env: env(all) });
  r = reducePinQueue(r, { type: 'restart-skipped', env: env(all, ['d']) });
  eq('restart-skipped rebuilds from what is still open', { ids: r.ids, index: r.index, skipped: r.skipped }, { ids: ['a', 'c'], index: 0, skipped: [] });
  const prog = pinQueueProgress({ ...initialPinQueueSession(all), pinnedThisSession: ['a'] }, env(['a', 'b', 'c'], ['b']));
  eq('progress: total counts existing ids; pinned = env ∪ session', { total: prog.total, pinned: prog.pinned }, { total: 3, pinned: 2 });
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\nA5. seeds, patches and undo');
// ───────────────────────────────────────────────────────────────────────────
{
  const pinned = mk('p', { planSheetId: 's2', pinX: 0.1, pinY: 0.9 });
  eq('seed: own pin', pinSeedFor(pinned, BY_ID, []), { initialPin: { sheetId: 's2', x: 0.1, y: 0.9 }, initialSheetId: 's2', source: 'item' });
  eq('seed: linked plan-viewer marker', pinSeedFor(mk('q'), BY_ID, [dpin('d1', { linkedPunchItemId: 'q' })]),
    { initialPin: { sheetId: 's1', x: 0.3, y: 0.4 }, initialSheetId: 's1', source: 'drawing-pin' });
  eq('seed: a marker on a deleted sheet is ignored', pinSeedFor(mk('q'), BY_ID, [dpin('d1', { linkedPunchItemId: 'q', planSheetId: 'gone' })]).source, 'none');
  eq('seed: filed to a sheet with no spot', pinSeedFor(mk('r', { planSheetId: 's1' }), BY_ID, []), { initialPin: null, initialSheetId: 's1', source: 'sheet-only' });
  eq('seed: nothing', pinSeedFor(mk('t'), BY_ID, []), { initialPin: null, initialSheetId: null, source: 'none' });

  eq('patch: unchanged → nothing to write', pinPatchFor({ planSheetId: 's1', pinX: 0.2, pinY: 0.3 }, { sheetId: 's1', x: 0.2, y: 0.3 }), {});
  eq('patch: a new pin → the three fields', pinPatchFor({}, { sheetId: 's1', x: 0.2, y: 0.3 }), { planSheetId: 's1', pinX: 0.2, pinY: 0.3 });
  eq('patch: clamped like the walk', pinPatchFor({}, { sheetId: 's1', x: 1.2, y: -0.1 }), { planSheetId: 's1', pinX: 1, pinY: 0 });
  const clear = pinPatchFor({ planSheetId: 's1', pinX: 0.2, pinY: 0.3 }, null);
  ok('patch: removal → CLEAR with three OWN keys', own(clear, 'planSheetId') && own(clear, 'pinX') && own(clear, 'pinY')
    && clear.planSheetId === undefined && clear.pinX === undefined && clear.pinY === undefined);
  ok('CLEAR_PIN_PATCH has three own undefined keys', Object.keys(CLEAR_PIN_PATCH).length === 3 && CLEAR_PIN_PATCH.pinX === undefined);
  eq('patch: removal of nothing → nothing', pinPatchFor({}, null), {});
  eq('patch: NaN → nothing', pinPatchFor({}, { sheetId: 's1', x: Number.NaN, y: 0.2 }), {});
  eq('walkPinOf needs a sheet and finite x/y', [walkPinOf({ planSheetId: 's1' }), walkPinOf({ planSheetId: 's1', pinX: 0.1, pinY: 0.2 })],
    [null, { sheetId: 's1', x: 0.1, y: 0.2 }]);

  // Undo round trips: apply the patch, then undoPatchFor, and the three fields are back exactly.
  const apply = (item: PunchItem, patch: Partial<PunchItem>) => ({ ...item, ...patch });
  const fields = (i: PunchItem) => ({ planSheetId: i.planSheetId, pinX: i.pinX, pinY: i.pinY });
  const trips: [string, PunchItem, WalkPin | null][] = [
    ['none → pin', mk('u1'), { sheetId: 's1', x: 0.4, y: 0.6 }],
    ['pin → pin\'', mk('u2', { planSheetId: 's1', pinX: 0.1, pinY: 0.1 }), { sheetId: 's2', x: 0.8, y: 0.2 }],
    ['pin → none', mk('u3', { planSheetId: 's1', pinX: 0.1, pinY: 0.1 }), null],
    ['no-position → pin', mk('u4', { planSheetId: 's1' }), { sheetId: 's1', x: 0.5, y: 0.5 }],
  ];
  for (const [label, item, after] of trips) {
    const before = { planSheetId: item.planSheetId, pinX: item.pinX, pinY: item.pinY };
    const moved = apply(item, pinPatchFor(before, after));
    const undo = undoPatchFor({ itemId: item.id, before, after });
    ok(`undo patch has three own keys (${label})`, own(undo, 'planSheetId') && own(undo, 'pinX') && own(undo, 'pinY'));
    eq(`undo restores exact fields (${label})`, fields(apply(moved, undo)), fields(item));
  }
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\nA6. linked plan-viewer markers');
// ───────────────────────────────────────────────────────────────────────────
{
  const d = dpin('d1', { linkedPunchItemId: 'i1' });
  eq('move on the same sheet → x/y only', drawingPinMoveFor(d, { sheetId: 's1', x: 0.6, y: 0.7 }), { x: 0.6, y: 0.7 });
  eq('move to another sheet → planSheetId too', drawingPinMoveFor(d, { sheetId: 's2', x: 0.6, y: 0.7 }), { planSheetId: 's2', x: 0.6, y: 0.7 });
  eq('removal: no marker', drawingPinRemovalFor(undefined, 'owner'), { action: 'none' });
  eq('removal: punch-only marker + owner → delete', drawingPinRemovalFor(d, 'owner'), { action: 'delete' });
  for (const role of ['field', 'editor', null] as const) {
    eq(`removal: punch-only marker + ${role} → unlink as a note`, drawingPinRemovalFor(d, role), { action: 'unlink', keptAs: 'note', why: 'not-owner' });
  }
  eq('removal: marker with a photo → unlink as a photo pin', drawingPinRemovalFor({ ...d, linkedPhotoId: 'ph' }, 'owner'), { action: 'unlink', keptAs: 'photo', why: 'photo' });
  eq('removal: marker with an RFI → unlink as an RFI pin', drawingPinRemovalFor({ ...d, linkedRfiId: 'r' }, 'owner'), { action: 'unlink', keptAs: 'rfi', why: 'rfi' });
  eq('removal: marker with its own label → unlink as a note', drawingPinRemovalFor({ ...d, label: 'Door 4' }, 'owner'), { action: 'unlink', keptAs: 'note', why: 'label' });
  const cDel = removePinConfirmCopy({ action: 'delete' }, 14);
  eq('confirm title', cDel.title, 'Remove the pin from #14?');
  ok('delete copy says the marker is deleted', /is deleted/.test(cDel.body));
  ok('unlink copy says what stays (photo pin)', /stays where it is, as a photo pin/.test(removePinConfirmCopy({ action: 'unlink', keptAs: 'photo', why: 'photo' }, 2).body));
  ok('unlink copy says what stays (RFI pin)', /as an RFI pin/.test(removePinConfirmCopy({ action: 'unlink', keptAs: 'rfi', why: 'rfi' }, 2).body));
  ok('unlink copy says what stays (note), no guessed reason', /as a note/.test(removePinConfirmCopy({ action: 'unlink', keptAs: 'note', why: 'not-owner' }, 2).body)
    && !/owner|placed|author/i.test(removePinConfirmCopy({ action: 'unlink', keptAs: 'note', why: 'not-owner' }, 2).body));
  ok('none copy mentions no marker', !/marker/.test(removePinConfirmCopy({ action: 'none' }, 2).body));
  const snap = drawingPinSnapshotOf(d);
  eq('undo of a move puts the marker back', drawingPinUndoFor({ itemId: 'i1', before: {}, after: null, drawingPin: { op: 'move', id: 'd1', before: snap } }),
    { kind: 'update', id: 'd1', patch: { planSheetId: 's1', x: 0.3, y: 0.4 } });
  const un = drawingPinUndoFor({ itemId: 'i1', before: {}, after: null, drawingPin: { op: 'unlink', id: 'd1', before: snap } });
  ok('undo of an unlink relinks (own linkedPunchItemId key) and restores the kind',
    !!un && un.kind === 'update' && own(un.patch, 'linkedPunchItemId') && un.patch.linkedPunchItemId === 'i1' && un.patch.kind === 'punch');
  const add = drawingPinUndoFor({ itemId: 'i1', before: {}, after: null, drawingPin: { op: 'delete', id: 'd1', before: snap } });
  ok('undo of a delete re-adds the full snapshot', !!add && add.kind === 'add' && add.pin.linkedPunchItemId === 'i1' && add.pin.planSheetId === 's1' && add.pin.x === 0.3);
  eq('no marker → no marker undo', drawingPinUndoFor({ itemId: 'i1', before: {}, after: null }), null);
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\nA7. walk helpers and roles');
// ───────────────────────────────────────────────────────────────────────────
{
  eq('auto-open: durable plan, undecided → open', shouldAutoOpenPinStep({ pinnableSheetCount: 1, dismissedNoPlanThisWalk: false }), true);
  eq('auto-open: no plan, not dismissed → open', shouldAutoOpenPinStep({ pinnableSheetCount: 0, dismissedNoPlanThisWalk: false }), true);
  eq('auto-open: no plan, dismissed → closed', shouldAutoOpenPinStep({ pinnableSheetCount: 0, dismissedNoPlanThisWalk: true }), false);
  eq('auto-open: decided (Skip pin with a plan) → closed', shouldAutoOpenPinStep({ pinnableSheetCount: 2, dismissedNoPlanThisWalk: false, pinDecided: true }), false);
  eq('auto-open: decided with no plan and a stale undismissed closure → closed', shouldAutoOpenPinStep({ pinnableSheetCount: 0, dismissedNoPlanThisWalk: false, pinDecided: true }), false);
  eq('walkStartFromParam', [walkStartFromParam('pin'), walkStartFromParam(['pin']), walkStartFromParam('photo'), walkStartFromParam(undefined), walkStartFromParam('PIN')],
    ['pin', 'pin', 'photo', 'photo', 'photo']);
  eq('camera after pin only in pin-first with no photo', [
    shouldOpenCameraAfterPin({ pinFirst: true, draftHasPhoto: false }),
    shouldOpenCameraAfterPin({ pinFirst: true, draftHasPhoto: true }),
    shouldOpenCameraAfterPin({ pinFirst: false, draftHasPhoto: false }),
  ], [true, false, false]);
  const items = [mk('i1', { planSheetId: 's2', pinX: 0.2, pinY: 0.2 })];
  eq('initial sheet: the item\'s pin first', pickInitialPinSheet({ sheets: SHEETS, projectId: P, initialPin: { sheetId: 's1', x: 0, y: 0 }, initialSheetId: 's2', sessionSheetId: 's2', punchItems: items }), 's1');
  eq('initial sheet: then initialSheetId', pickInitialPinSheet({ sheets: SHEETS, projectId: P, initialSheetId: 's2', sessionSheetId: 's1' }), 's2');
  eq('initial sheet: an unlisted pin falls through to the session sheet', pickInitialPinSheet({ sheets: SHEETS, projectId: P, initialPin: { sheetId: 'gone', x: 0, y: 0 }, sessionSheetId: 's2' }), 's2');
  eq('initial sheet: then choosePinSheet (last pinned)', pickInitialPinSheet({ sheets: SHEETS, projectId: P, punchItems: items }), 's2');
  eq('initial sheet: no sheets → null', pickInitialPinSheet({ sheets: [], projectId: P }), null);
  const onS1 = [mk('a', { planSheetId: 's1', pinX: 0.1, pinY: 0.1 }), mk('b', { planSheetId: 's1', pinX: 0.2, pinY: 0.2 })];
  eq('pinsOnSheet hides the item being moved', pinsOnSheet(onS1, P, 's1', [], ['a']).map(p => p.id), ['b']);
  eq('pinsOnSheet without hideIds is unchanged', pinsOnSheet(onS1, P, 's1').map(p => p.id), ['a', 'b']);
  eq('roles: only a viewer is blocked', ['viewer', 'field', 'editor', 'owner', null].map(r => pinWriteBlockedReason(r as 'viewer') !== null), [true, false, false, false, false]);
  // #90: a SETTLED null role (removed from the job) is blocked with a reason;
  // a null that is still loading is not decided; a failed read says so.
  ok('a settled null role (removed from the job) is blocked',
    /no longer on this job/.test(pinWriteBlockedReason(null, { isLoading: false, isError: false }) ?? ''));
  ok('…with the hook\'s offline reason when it has one',
    pinWriteBlockedReason(null, { isLoading: false, isError: false, reason: 'Can’t be checked offline' }) === 'Can’t be checked offline');
  eq('a null role still loading is not blocked', pinWriteBlockedReason(null, { isLoading: true, isError: false }), null);
  ok('a failed read blocks with its own reason', /couldn’t be checked/.test(pinWriteBlockedReason(null, { isLoading: false, isError: true }) ?? ''));
  eq('an owner with a settled state is not blocked', pinWriteBlockedReason('owner', { isLoading: false, isError: false }), null);
  ok('the screen hands the whole role state to it', /pinWriteBlockedReason\(roleState\.role, roleState\)/.test(readFileSync(join(ROOT, 'app', 'punch-pin.tsx'), 'utf8')));
  ok('the viewer reason says why and what to do', /view-only/.test(pinWriteBlockedReason('viewer') ?? '') && /Ask the project owner/.test(pinWriteBlockedReason('viewer') ?? ''));
  ok('isPinnedForExport agrees with planRefFor', isPinnedForExport(items[0], BY_ID) && !isPinnedForExport(mk('z', { planSheetId: 's1' }), BY_ID));
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\nA8. a refetch keeps pins whose writes are pending');
// ───────────────────────────────────────────────────────────────────────────
{
  const server = [
    mk('inflight'),                                                         // server has not seen the pin yet
    mk('settled-before', { planSheetId: 's1', pinX: 0.9, pinY: 0.9 }),      // write landed before the SELECT
    mk('queued-values'),
    mk('queued-nulls', { planSheetId: 's1', pinX: 0.5, pinY: 0.5 }),        // removal still queued
    mk('other-phone', { planSheetId: 's2', pinX: 0.3, pinY: 0.3 }),         // pinned elsewhere; his status edit is queued
    mk('refused', { planSheetId: 's1', pinX: 0.1, pinY: 0.1 }),            // his write was refused before the SELECT
  ];
  const memory = [
    mk('inflight', { planSheetId: 's1', pinX: 0.4, pinY: 0.4 }),
    mk('settled-before', { planSheetId: 's1', pinX: 0.2, pinY: 0.2 }),
    mk('queued-values', { planSheetId: 's2', pinX: 0.6, pinY: 0.6 }),
    mk('queued-nulls'),
    mk('other-phone', { status: 'closed' }),
    mk('refused', { planSheetId: 's1', pinX: 0.7, pinY: 0.7 }),
  ];
  const queue = [
    { table: 'punch_items', operation: 'update', data: JSON.parse(JSON.stringify({ id: 'queued-values', plan_sheet_id: 's2', pin_x: 0.6, pin_y: 0.6 })) },
    { table: 'punch_items', operation: 'update', data: JSON.parse(JSON.stringify({ id: 'queued-nulls', plan_sheet_id: null, pin_x: null, pin_y: null })) },
    // An unpinned copy's status edit: undefined pin fields vanish in JSON.
    { table: 'punch_items', operation: 'update', data: JSON.parse(JSON.stringify({ id: 'other-phone', status: 'closed', plan_sheet_id: undefined })) },
    { table: 'photos', operation: 'update', data: { id: 'inflight', pin_x: 1 } },
    { table: 'punch_items', operation: 'delete', data: { id: 'refused', pin_x: 1 } },
  ];
  const queued = pendingPinIdsInQueue(queue);
  eq('queued pin writes: values and explicit NULLs only', [...queued].sort(), ['queued-nulls', 'queued-values']);
  const START = 1_000;
  const tracker = new Map([
    ['inflight', { inFlight: 1, settledAt: 0 }],
    ['settled-before', { inFlight: 0, settledAt: START - 5 }],
    ['refused', { inFlight: 0, settledAt: START - 1 }],
  ]);
  const ids = pinOverlayIds({ queued, tracker, fetchStartedAt: START });
  eq('overlay ids', [...ids].sort(), ['inflight', 'queued-nulls', 'queued-values']);
  eq('settled at/after the SELECT start counts', pinOverlayIds({ queued: new Set(), tracker: new Map([['x', { inFlight: 0, settledAt: START }]]), fetchStartedAt: START }).has('x'), true);
  const merged = keepPendingPinFields(server, [memory], ids);
  const pinOf = (id: string) => { const r = merged.find(m => m.id === id) as PunchItem; return [r.planSheetId ?? null, r.pinX ?? null, r.pinY ?? null]; };
  eq('in flight past the SELECT start: the device pin stays', pinOf('inflight'), ['s1', 0.4, 0.4]);
  eq('settled before the SELECT: server wins', pinOf('settled-before'), ['s1', 0.9, 0.9]);
  eq('queued with values: the device pin stays', pinOf('queued-values'), ['s2', 0.6, 0.6]);
  eq('queued removal: stays removed', pinOf('queued-nulls'), [null, null, null]);
  eq('another phone\'s pin under his queued status edit is NOT hidden', pinOf('other-phone'), ['s2', 0.3, 0.3]);
  eq('a refused write does not stick', pinOf('refused'), ['s1', 0.1, 0.1]);
  eq('…and only the pin fields are taken from the device', (merged.find(m => m.id === 'inflight') as PunchItem).status, 'open');
  ok('nothing pending → the SAME array', keepPendingPinFields(server, [memory], new Set()) === server);
  ok('pending but equal → the SAME array', keepPendingPinFields(server, [server], new Set(['settled-before'])) === server);
  const disk = [mk('inflight', { planSheetId: 's2', pinX: 0.8, pinY: 0.8 })];
  eq('memory beats disk', (keepPendingPinFields(server, [memory, disk], new Set(['inflight'])).find(m => m.id === 'inflight') as PunchItem).pinX, 0.4);
  eq('disk when memory lacks the row', (keepPendingPinFields(server, [[], disk], new Set(['inflight'])).find(m => m.id === 'inflight') as PunchItem).pinX, 0.8);
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\nA9. the phone height budget');
// ───────────────────────────────────────────────────────────────────────────
{
  eq('strip on a 375pt phone', pinQueueLayout({ windowHeight: 667, rootWidth: 375, isWeb: false, photoCollapsed: false }), { mode: 'strip', photoSize: 104, paneWidth: null });
  eq('strip on a taller phone', pinQueueLayout({ windowHeight: 844, rootWidth: 390, isWeb: false, photoCollapsed: false }).photoSize, 128);
  eq('strip collapsed', pinQueueLayout({ windowHeight: 844, rootWidth: 390, isWeb: false, photoCollapsed: true }).photoSize, 56);
  eq('strip on web below 900', pinQueueLayout({ windowHeight: 900, rootWidth: 899, isWeb: true, photoCollapsed: false }).mode, 'strip');
  eq('pane on web at 900 (clamped to 320)', pinQueueLayout({ windowHeight: 900, rootWidth: 900, isWeb: true, photoCollapsed: false }), { mode: 'pane', photoSize: 292, paneWidth: 324 });
  eq('pane width clamped to 480', pinQueueLayout({ windowHeight: 900, rootWidth: 2000, isWeb: true, photoCollapsed: false }).paneWidth, 480);
  eq('pane width floor 320', pinQueueLayout({ windowHeight: 900, rootWidth: 880, isWeb: true, photoCollapsed: false }).mode, 'strip');
  eq('a wide native root is still a strip', pinQueueLayout({ windowHeight: 900, rootWidth: 1200, isWeb: false, photoCollapsed: false }).mode, 'strip');
  const se = { windowHeight: 667, insetTop: 20, insetBottom: 0 };
  const worst = pinCanvasHeight({ ...se, photoSize: 104, multiSheet: true, hint: true });
  const one = pinCanvasHeight({ ...se, photoSize: 104, multiSheet: false, hint: false });
  const collapsedWorst = pinCanvasHeight({ ...se, photoSize: 56, multiSheet: true, hint: true });
  ok(`iPhone SE worst state (chips + first hint) keeps the plan ≥ ${PIN_CANVAS_FLOOR}pt (${worst})`, worst >= PIN_CANVAS_FLOOR);
  ok(`iPhone SE one sheet ≥ 380pt (${one})`, one >= 380);
  ok(`iPhone SE collapsed worst ≥ 360pt (${collapsedWorst})`, collapsedWorst >= 360);
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\nA10. the removal write (ProjectContext pure block, executed)');
// ───────────────────────────────────────────────────────────────────────────
type PinColumn = 'plan_sheet_id' | 'pin_x' | 'pin_y';
type Pure = {
  applyPunchBatchUpdate: (items: PunchItem[], ids: readonly string[], updates: Partial<PunchItem>, now: string) =>
    { next: PunchItem[]; changed: PunchItem[]; cleared: Record<string, PinColumn[]> };
  punchItemToUpdateRow: (pi: PunchItem, now: string, clears?: readonly PinColumn[]) => Record<string, unknown>;
  punchPinScopedRow: (id: string, patch: Partial<PunchItem>, now: string) => Record<string, unknown>;
  pinScopedPatchOf: (patch: Partial<PunchItem>) => Partial<PunchItem>;
  pinScopedPatchCarriesPin: (patch: Partial<PunchItem>) => boolean;
  pinColumnsClearedBy: (before: PunchItem, after: PunchItem) => PinColumn[];
  rowCarriesPin: (pi: PunchItem, clears?: readonly PinColumn[]) => boolean;
};
const RAW_CTX = read('contexts/ProjectContext.tsx');
{
  const block = between(RAW_CTX, '// ── punch-batch pure (begin)', '// ── punch-batch pure (end)');
  const durableFn = between(RAW_CTX, 'function durablePhotoValue(', '\n}');
  ok('the ProjectContext pure block was located', block.length > 0 && durableFn.length > 0);
  let pure: Pure | null = null;
  try {
    const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(`${durableFn}\n}\n${block}\n`);
    pure = new Function('isDeviceLocalUri', 'punchListTypeOf',
      `${js}\nreturn { applyPunchBatchUpdate, punchItemToUpdateRow, pinColumnsClearedBy, rowCarriesPin, punchPinScopedRow, pinScopedPatchOf, pinScopedPatchCarriesPin };`,
    )(isDeviceLocalUri, punchListTypeOf) as Pure;
  } catch (e) {
    ok('the pure block evaluates standalone', false, String(e));
  }
  if (pure) {
    const NOW = '2026-09-18T12:00:00.000Z';
    const pinnedItem = mk('p1', { planSheetId: 's1', pinX: 0.25, pinY: 0.75 });
    const write = (items: PunchItem[], id: string, patch: Partial<PunchItem>) => {
      const r = pure!.applyPunchBatchUpdate(items, [id], patch, NOW);
      const pi = r.changed[0];
      return { json: JSON.stringify(pure!.punchItemToUpdateRow(pi, NOW, r.cleared[id])), carries: pure!.rowCarriesPin(pi, r.cleared[id] ?? []), cleared: r.cleared };
    };
    const rm = write([pinnedItem], 'p1', { ...CLEAR_PIN_PATCH });
    ok('Remove pin sends explicit NULLs', rm.json.includes('"plan_sheet_id":null,"pin_x":null,"pin_y":null'), rm.json);
    ok('…and is tracked', rm.carries);
    const stale = write([mk('u1')], 'u1', { status: 'closed' });
    ok('a status edit on an UNPINNED copy has NO plan_sheet_id key', !stale.json.includes('plan_sheet_id') && !stale.json.includes('pin_x'), stale.json);
    ok('…and is not tracked', !stale.carries);
    eq('…and clears nothing', stale.cleared, {});
    const status = write([pinnedItem], 'p1', { status: 'closed' });
    ok('a status edit on a pinned item sends its sheet id', status.json.includes('"plan_sheet_id":"s1"') && status.carries);
    const noPos = { ...mk('p1', { planSheetId: 's2', pinX: 0.1, pinY: 0.1 }) };
    const undo = write([noPos], 'p1', undoPatchFor({ itemId: 'p1', before: { planSheetId: 's1' }, after: null }));
    ok('undo to no-position: sheet s1, pin_x/pin_y NULL', undo.json.includes('"plan_sheet_id":"s1","pin_x":null,"pin_y":null'), undo.json);
    const move = write([pinnedItem], 'p1', pinPatchFor({ planSheetId: 's1', pinX: 0.25, pinY: 0.75 }, { sheetId: 's2', x: 0.5, y: 0.6 }));
    ok('a move sends the new values and no NULLs', move.json.includes('"plan_sheet_id":"s2","pin_x":0.5,"pin_y":0.6') && !move.json.includes('null,"pin'), move.json);
    const ctrl = JSON.stringify(pure.punchItemToUpdateRow({ ...pinnedItem, planSheetId: undefined }, NOW));
    ok('control: the two-arg builder still omits an undefined pin (no NULLs)', !ctrl.includes('plan_sheet_id') && ctrl.includes('"pin_x":0.25'), ctrl);
    eq('pinColumnsClearedBy only names what was taken away', pure.pinColumnsClearedBy(pinnedItem, { ...pinnedItem, pinX: undefined }), ['pin_x']);

    // ── A11. pin writes are PIN-SCOPED (executed replay) ──────────────────
    console.log('\nA11. a pin write never undoes another device\'s edit (executed replay)');
    // The server, as PostgREST applies `update(rest).eq('id', id)`: only the
    // keys present in the payload change. The payload goes through JSON (the
    // wire, and the offline queue's disk copy) — undefined keys vanish there.
    type Row = Record<string, unknown>;
    const server = new Map<string, Row>();
    const applyUpdate = (payload: Row) => {
      const wire = JSON.parse(JSON.stringify(payload)) as Row;
      const { id, ...rest } = wire;
      const cur = server.get(id as string);
      if (cur) server.set(id as string, { ...cur, ...rest });
    };
    const keys = (r: Row) => Object.keys(r).sort();
    // The row both phones loaded this morning.
    const base = mk('r1', { description: 'Paint touch-up', assignedSub: 'Acme', assignedSubId: 'sub-a', status: 'open' });
    const resetServer = () => {
      server.clear();
      server.set('r1', JSON.parse(JSON.stringify(pure!.punchItemToUpdateRow(base, NOW))) as Row);
    };
    // Device B (the office) closes it, rewrites the description, reassigns it.
    const deviceB = () => {
      const b = pure!.applyPunchBatchUpdate([base], ['r1'], { status: 'closed', description: 'Paint touch-up — done by Bolt', assignedSub: 'Bolt', assignedSubId: 'sub-b', closedAt: NOW }, NOW);
      applyUpdate(pure!.punchItemToUpdateRow(b.changed[0], NOW, b.cleared.r1));
    };
    // Device A still holds `base` (stale) and pins it: the SAME steps
    // updatePunchItemPin runs — scope the patch, merge locally, build the row.
    const pinOnA = (copy: PunchItem, patch: Partial<PunchItem>) => {
      const scoped = pure!.pinScopedPatchOf(patch);
      const local = pure!.applyPunchBatchUpdate([copy], [copy.id], scoped, NOW).changed[0];
      const payload = pure!.punchPinScopedRow(copy.id, scoped, NOW);
      applyUpdate(payload);
      return { local, payload };
    };

    resetServer(); deviceB();
    const pinA = pinOnA(base, pinPatchFor(pinFieldsOfItem(base), { sheetId: 's1', x: 0.42, y: 0.58 }));
    const after = server.get('r1')!;
    ok('Pin items: the server keeps B\'s status (closed)', after.status === 'closed', JSON.stringify(after));
    ok('…B\'s description', after.description === 'Paint touch-up — done by Bolt');
    ok('…B\'s sub and sub id', after.assigned_sub === 'Bolt' && after.assigned_sub_id === 'sub-b');
    ok('…B\'s closed_at', after.closed_at === NOW);
    ok('…and A\'s pin', after.plan_sheet_id === 's1' && after.pin_x === 0.42 && after.pin_y === 0.58, JSON.stringify(after));
    eq('the pin payload is exactly id + the three pin columns + updated_at', keys(pinA.payload), ['id', 'pin_x', 'pin_y', 'plan_sheet_id', 'updated_at']);
    ok('the phone shows the pin at once (local merge)', pinA.local.planSheetId === 's1' && pinA.local.pinX === 0.42);
    ok('a pin write is tracked for the refetch overlay', pure.pinScopedPatchCarriesPin(pinPatchFor(pinFieldsOfItem(base), { sheetId: 's1', x: 0.42, y: 0.58 })));

    // Control: the old path (updatePunchItem → punchItemToUpdateRow from A's
    // stale merged copy) DOES revert B — so the replay above can fail.
    resetServer(); deviceB();
    {
      const old = pure.applyPunchBatchUpdate([base], ['r1'], { planSheetId: 's1', pinX: 0.42, pinY: 0.58 }, NOW);
      applyUpdate(pure.punchItemToUpdateRow(old.changed[0], NOW, old.cleared.r1));
      const bad = server.get('r1')!;
      ok('control: the whole-row write puts status back to open (the bug this closes)', bad.status === 'open' && bad.assigned_sub === 'Acme', JSON.stringify(bad));
    }

    // Undo (A's pin → nothing), after B's edit: NULLs reach the server, B stays.
    resetServer(); deviceB();
    {
      const pinned = pinOnA(base, { planSheetId: 's1', pinX: 0.42, pinY: 0.58 });
      const w: PinWrite = { itemId: 'r1', before: pinFieldsOfItem(base), after: { sheetId: 's1', x: 0.42, y: 0.58 } };
      const undo = pinOnA(pinned.local, undoPatchFor(w));
      const row = server.get('r1')!;
      ok('Undo: the pin columns go out as NULL', undo.payload.plan_sheet_id === null && undo.payload.pin_x === null && undo.payload.pin_y === null, JSON.stringify(undo.payload));
      ok('…and the server has no pin', row.plan_sheet_id === null && row.pin_x === null && row.pin_y === null, JSON.stringify(row));
      ok('…and still B\'s status and description', row.status === 'closed' && row.description === 'Paint touch-up — done by Bolt');
      ok('…and the phone shows no pin', undo.local.planSheetId === undefined && undo.local.pinX === undefined);
    }

    // Edit sheet: Move pin (s1 → s2) and Remove pin, on a stale pinned copy.
    resetServer(); deviceB();
    {
      const stalePinned = { ...base, planSheetId: 's1', pinX: 0.1, pinY: 0.2 };
      server.set('r1', { ...server.get('r1')!, plan_sheet_id: 's1', pin_x: 0.1, pin_y: 0.2 });
      const mv = pinOnA(stalePinned, pinPatchFor(pinFieldsOfItem(stalePinned), { sheetId: 's2', x: 0.7, y: 0.3 }));
      let row = server.get('r1')!;
      ok('Move pin: new sheet and spot on the server, B\'s status kept', row.plan_sheet_id === 's2' && row.pin_x === 0.7 && row.status === 'closed', JSON.stringify(row));
      eq('…payload keys', keys(mv.payload), ['id', 'pin_x', 'pin_y', 'plan_sheet_id', 'updated_at']);
      const rmv = pinOnA(mv.local, pinPatchFor(pinFieldsOfItem(mv.local), null));
      row = server.get('r1')!;
      ok('Remove pin: explicit NULLs reach the server', row.plan_sheet_id === null && row.pin_x === null && row.pin_y === null, JSON.stringify(rmv.payload));
      ok('…B\'s sub and description kept', row.assigned_sub === 'Bolt' && row.description === 'Paint touch-up — done by Bolt');
      eq('Remove pin payload keys', keys(rmv.payload), ['id', 'pin_x', 'pin_y', 'plan_sheet_id', 'updated_at']);
      eq('CLEAR_PIN_PATCH → three NULLs', pure.punchPinScopedRow('r1', { ...CLEAR_PIN_PATCH }, NOW), { id: 'r1', plan_sheet_id: null, pin_x: null, pin_y: null, updated_at: NOW });
    }

    // Pin first: the late GPS stamp touches the GPS columns only.
    resetServer(); deviceB();
    {
      const gps = pinOnA(base, { photoLatitude: 40.1, photoLongitude: -74.2, photoLocationAccuracyMeters: 8, photoLocationLabel: '12 Main St' });
      eq('late GPS stamp payload keys', keys(gps.payload),
        ['id', 'photo_accuracy_meters', 'photo_latitude', 'photo_location_label', 'photo_longitude', 'updated_at']);
      const row = server.get('r1')!;
      ok('…lands, and B\'s status and description stay', row.photo_latitude === 40.1 && row.status === 'closed' && row.description === 'Paint touch-up — done by Bolt');
      ok('…and is NOT tracked as a pin write', !pure.pinScopedPatchCarriesPin({ photoLatitude: 40.1 }));
    }

    // A caller that smuggles other fields in gets them dropped, locally too.
    {
      const smuggled = pure.pinScopedPatchOf({ planSheetId: 's1', pinX: 0.5, pinY: 0.5, status: 'closed', description: 'x' } as Partial<PunchItem>);
      eq('status / description are dropped from a pin write', Object.keys(smuggled).sort(), ['pinX', 'pinY', 'planSheetId']);
      eq('a patch naming nothing pin-scoped sends only id + updated_at', keys(pure.punchPinScopedRow('r1', { status: 'closed' } as Partial<PunchItem>, NOW)), ['id', 'updated_at']);
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\nB. geometry parity: step tap → plan-viewer marker → export marker');
// ───────────────────────────────────────────────────────────────────────────
{
  const shapes: [string, number, number][] = [['3024×4032', 3024, 4032], ['4032×3024', 4032, 3024], ['5184×3456', 5184, 3456], ['1114×1349', 1114, 1349]];
  const canvases: [string, { w: number; h: number }][] = [['390×520 phone', { w: 390, h: 520 }], ['375×316 worst phone box', { w: 375, h: 316 }], ['1200×700 web', { w: 1200, h: 700 }]];
  const taps: [number, number][] = [[0.1, 0.2], [0.5, 0.5], [0.93, 0.81]];
  let worstViewer = 0, worstExport = 0, worstCss = 0, n = 0, badDp = 0;
  for (const [, w, h] of shapes) {
    const sh = sheet(`g${w}x${h}`, w, h);
    for (const [, canvas] of canvases) {
      for (const [fx, fy] of taps) {
        n++;
        // PlanPinStep: ratio from the sheet before load (loaded == stored here), tap inside the image box.
        const rect = containImageRect(canvas, w / h);
        const pin = normalizeTapToImage(fx * (rect?.w ?? 0), fy * (rect?.h ?? 0), rect);
        const fields = punchPinFields(pin ? { sheetId: sh.id, ...pin } : null);
        // plan-viewer: its own box on its own canvas.
        const box = containImageRect(canvas, planViewerImageRatio(null, sh)) ?? { ...canvas, left: 0, top: 0 };
        const m = pinMarkerPosition({ x: fields.pinX as number, y: fields.pinY as number }, box);
        const tip = pinTipFromMarker(m.left, m.top, box);
        worstViewer = Math.max(worstViewer, Math.abs((tip?.x ?? 9) - fx), Math.abs((tip?.y ?? 9) - fy));
        // The linked marker follows with the same numbers.
        const mv = drawingPinMoveFor(dpin('d', { planSheetId: sh.id }), { sheetId: sh.id, ...(pin as { x: number; y: number }) });
        if (mv.x !== fields.pinX || mv.y !== fields.pinY) badDp++;
        // The export: the marker it writes, and the CSS position it prints.
        const model = exportModel([mk('gx', fields)], [sh]);
        const mk0 = model.sheetPages[0]?.markers[0];
        worstExport = Math.max(worstExport, Math.abs((mk0?.x ?? 9) - (fields.pinX as number)), Math.abs((mk0?.y ?? 9) - (fields.pinY as number)));
        const css = pinStyle(mk0?.x ?? NaN, mk0?.y ?? NaN) ?? '';
        const lm = /left:([\d.]+)%;top:([\d.]+)%/.exec(css);
        worstCss = Math.max(worstCss, lm ? Math.max(Math.abs(Number(lm[1]) / 100 - fx), Math.abs(Number(lm[2]) / 100 - fy)) : 9);
      }
    }
  }
  ok(`plan-viewer marker tip === the tap on ${n} tap/sheet/canvas cases (max error ${worstViewer})`, worstViewer <= 1e-9);
  ok(`the export's marker === the stored pin exactly (max error ${worstExport})`, worstExport === 0);
  ok(`the export's CSS position === the tap within 1e-5 (max error ${worstCss})`, worstCss <= 1e-5);
  eq('the linked marker moves with the same numbers', badDp, 0);
  // Sanity: the check can fail — a container-normalised tap on a letterboxed shape is visibly off.
  const canvas = { w: 390, h: 520 };
  const rect = containImageRect(canvas, 4032 / 3024) as { w: number; h: number; left: number; top: number };
  const wrong = normalizeTapToImage(rect.left + 0.1 * rect.w, rect.top + 0.1 * rect.h, canvas) as { x: number; y: number };
  ok('sanity: normalising against the container would be > 5% off', Math.abs(wrong.y - 0.1) > 0.05, JSON.stringify(wrong));

  const html = read('utils/punchExportHtml.ts');
  ok('.pe-pin draws tip-anchored (translate(-50%,-100%))', /\.pe-pin \{[^}]*transform: translate\(-50%,-100%\)/.test(html));
  ok('.pe-plan-natural is the image box (relative, inline-block, line-height 0)',
    /\.pe-plan-natural \{ position: relative; display: inline-block; line-height: 0;/.test(html));
  const viewer = stripTsComments(read('app/plan-viewer.tsx'));
  ok('plan-viewer still draws markers at x*w-14 / y*h-28',
    /left: pin\.x \* imgLayout\.w - 14/.test(viewer) && /top: pin\.y \* imgLayout\.h - 28/.test(viewer)
      && /left: \(p\.pinX \?\? 0\) \* imgLayout\.w - 14/.test(viewer) && /top: \(p\.pinY \?\? 0\) \* imgLayout\.h - 28/.test(viewer));
  for (const rel of ['app/punch-pin.tsx', 'components/punch/PinQueueCard.tsx', 'hooks/usePunchPinWriter.ts']) {
    const src = stripTsComments(read(rel));
    ok(`${rel} does no geometry of its own (PlanPinStep is the one place)`, src.length > 0
      && !/locationX|locationY|pageX|pageY|containImageRect|normalizeTapToImage|pinMarkerPosition/.test(src));
  }
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\nC. wiring (comment-stripped source)');
// ───────────────────────────────────────────────────────────────────────────
{
  const layoutSrc = stripTsComments(read('app/_layout.tsx'));
  ok('_layout declares the punch-pin screen', /name="punch-pin"/.test(layoutSrc));
  ok('routeTitle names /punch-pin', /'\/punch-pin'\s*:/.test(read('utils/routeTitle.ts')));

  // ── app/punch-list.tsx ──
  const list = stripTsComments(read('app/punch-list.tsx'));
  ok('punch list pushes /punch-pin with the list showing', /pathname: '\/punch-pin'[\s\S]{0,120}list: activeList/.test(list));
  ok('punch list pushes /punch-walk with start: \'pin\'', /pathname: '\/punch-walk'[\s\S]{0,140}start: 'pin'/.test(list));
  ok('"voice capture" is gone; Walk Mode says photo → pin → describe', !/voice capture/i.test(list) && /photo → pin → describe/.test(list));
  ok('the count comes from planPinStats (the export\'s verdict)', /planPinStats\(/.test(list));
  ok('no pinned count until the plan sheets are in too', /const pinCountsReady = punchItemsLoaded && planSheetsLoaded;/.test(list)
    && /!pinCountsReady\s*\? 'Checking the plan sheets…'/.test(list) && /pinCountsReady && pinStats\.unpinned > 0 && \(/.test(list));
  ok('the row\'s "On plan" chip is the export\'s verdict, not planSheetId', /onPlan: pinRefOf\(item, sheetsById\)\.state === 'pinned'/.test(list)
    && /\{onPlan \? \(\s*<TouchableOpacity\s*style=\{styles\.onPlanChip\}/.test(list) && !/\{item\.planSheetId \? \(/.test(list));
  ok('the site pin buttons are 48pt (md), not 36', /testID="punch-form-pin-move"/.test(list)
    && !/size="sm"[^>]*testID="punch-(form-pin-move|form-pin-remove|form-pin-open|pin-items|pin-first)"/.test(list.replace(/\n\s*/g, ' ')));
  ok('the "On the plan" card waits for punchItemsLoaded', /punchItemsLoaded && items\.length > 0 &&[\s\S]{0,200}testID="punch-plan-card"/.test(list));
  {
    const at = list.indexOf('<Modal visible={showForm}');
    const close = at >= 0 ? list.indexOf('</Modal>', at) : -1;
    const step = at >= 0 ? list.indexOf('<PlanPinStep', at) : -1;
    ok('the edit sheet\'s PlanPinStep is nested INSIDE the form Modal', at >= 0 && step > at && step < close);
  }
  ok('a new item carries its pin into the created literal', /\.\.\.punchPinFields\(formPin/.test(between(list, 'const handleSave = useCallback', 'const startPhotoWalk')));
  ok('the update branch of handleSave never sends pin keys', !/planSheetId|pinX|pinY|punchPinFields/.test(between(list, 'updatePunchItem(editingItem.id, {', '});')));
  {
    const rm = between(list, 'const handleFormPinRemove = useCallback', '}, [');
    const alertAt = rm.indexOf('showAlert(');
    const copyAt = rm.indexOf('removePinConfirmCopy(');
    const writeAt = rm.indexOf('writePin(item, null)');
    ok('Remove pin confirms with removePinConfirmCopy via showAlert before it writes', copyAt >= 0 && alertAt > copyAt && writeAt > alertAt);
  }
  {
    const file = between(list, 'const fileWalkShots = useCallback', 'useEffect(() => { filingWalkRef.current = false');
    const stash = file.indexOf('stashPinQueueIds(');
    const close = file.indexOf('setShowWalk(false)', stash);
    const push = file.indexOf("pathname: '/punch-pin'", close);
    ok('"Add N and pin them" stashes the batch, closes the walk sheet, then pushes /punch-pin with batch',
      stash > 0 && close > stash && push > close && /batch\s*\}/.test(file.slice(push)));
    ok('the batch is the ids that were just filed', /stashPinQueueIds\(filedItems\.map\(i => i\.id\)\)/.test(file) && /addPunchItems\(filedItems\)/.test(file));
  }
  ok('the file button does not hand the press event to fileWalkShots', /onPress=\{\(\) => fileWalkShots\(\)\}/.test(list) && /fileWalkShots\(\{ thenPin: true \}\)/.test(list));
  ok('punch list moves plan-viewer markers only through the hook', !/updateDrawingPin\(|deleteDrawingPin\(/.test(list));
  ok('Photo walk says it does not pin', /No pins — pin them after with Pin items/.test(list));
  ok('the edit sheet names the export\'s verdict', /the export lists it as not pinned/.test(list) && /· saved/.test(list));

  // ── app/punch-pin.tsx ──
  const pin = stripTsComments(read('app/punch-pin.tsx'));
  ok('punch-pin is gated like the punch list', /canAccess\('punch_list_closeout'\)/.test(pin) && /<Paywall/.test(pin));
  ok('punch-pin offers the project picker with the stale notice', /<ToolProjectPicker/.test(pin) && /staleProjectId/.test(pin));
  ok('punch-pin makes no claim before the punch list AND the plan sheets hydrate', /if \(!punchItemsLoaded \|\| !planSheetsLoaded\)/.test(pin));
  ok('the header counts the whole list / batch (pinScopeStats), not the session queue',
    /subtitlePrefix=\{`\$\{scopeStats\.pinned\} of \$\{scopeStats\.total\} pinned`\}/.test(pin) && /max: scopeStats\.total/.test(pin));
  ok('a batch this phone cannot see is said so, never "all pinned"', /scopeIds && scopeStats\.missing > 0/.test(pin)
    && pin.indexOf('scopeStats.missing > 0') < pin.indexOf("'Every item in this batch is pinned'"));
  ok('web keys are off while another screen covers Pin items', /useFocusEffect\(/.test(pin) && /webShortcuts=\{viewer \|\| !focused \? null :/.test(pin));
  ok('punch-pin builds its queue with buildPinQueue and walks it with reducePinQueue', /buildPinQueue\(/.test(pin) && /useReducer\(reducePinQueue/.test(pin));
  ok('the step is inline and keyed by itemKey, never remounted per item',
    /presentation="screen"/.test(pin) && /itemKey=\{current\.id\}/.test(pin) && !/<PlanPinStep[^>]*key=\{current\.id\}/.test(pin));
  ok('the item being moved is hidden from the faint pins', /hideItemIds=/.test(pin));
  ok('the photo-walk batch is peeked, not consumed', /peekPinQueueIds\(/.test(pin));
  ok('layout comes from pinQueueLayout', /pinQueueLayout\(/.test(pin));
  ok('web keys are wired', /webShortcuts=/.test(pin));
  ok('punch-pin writes only through usePunchPinWriter', /usePunchPinWriter\(/.test(pin) && !/updatePunchItem\(|addPunchItem\(|supabase/.test(pin));
  ok('the Brain button is off the canvas and lifted over the footer', /useHideBrainFab\(\)/.test(pin) && /useBrainFabLift\(/.test(pin));
  ok('a viewer is told why before placing a pin', /pinWriteBlockedReason\(/.test(pin));
  {
    const dispatches = pin.match(/type: '(saved|kept|skip)'[^}]*\}/g) ?? [];
    ok('every saved / kept / skip dispatch names the item on screen', dispatches.length >= 3 && dispatches.every(d => /itemId: current\.id/.test(d)), dispatches.join(' | '));
  }
  {
    const undo = between(pin, 'const undoLast = useCallback', '}, [');
    ok('Undo takes its write from the synchronously-popped history ref, then reverses it before the cursor moves back',
      /const h = historyRef\.current;/.test(undo) && /historyRef\.current = h\.slice\(0, -1\);\s*undoPin\(w\);\s*dispatch\(\{ type: 'undo'/.test(undo)
        && !/lastWrite/.test(undo));
  }

  // ── app/punch-walk.tsx ──
  const walk = stripTsComments(read('app/punch-walk.tsx'));
  const camera = between(walk, 'const handleCamera = useCallback', 'const handlePinNext = useCallback');
  const next = between(walk, 'const handlePinNext = useCallback', 'const handlePinSkip = useCallback');
  const skip = between(walk, 'const handlePinSkip = useCallback', 'const handleRemovePin = useCallback');
  const save = between(walk, 'const handleSave = useCallback', 'const handleUndo = useCallback');
  const runAfter = between(walk, 'const runAfterPinStep = useCallback', 'const handlePinStepDismissed');
  ok('start=pin is read with walkStartFromParam', /walkStartFromParam\(/.test(walk));
  ok('the step reports its dismissal to the walk', /onDismissed=\{handlePinStepDismissed\}/.test(walk));
  ok('handleCamera reads the decided ref after its await', /shouldAutoOpenPinStep\(\{[^}]*pinDecided: pinDecidedRef\.current/.test(camera)
    && camera.indexOf('pinDecidedRef.current') > camera.indexOf('await ImagePicker'));
  ok('the latest camera handler is kept in a ref', /handleCameraRef\.current = handleCamera;/.test(walk));
  ok('Next marks the item decided', /pinDecidedRef\.current = true/.test(next));
  ok('Skip marks the item decided BEFORE the camera chain', /pinDecidedRef\.current = true/.test(skip)
    && skip.indexOf('pinDecidedRef.current = true') < skip.indexOf('runAfterPinStep('));
  ok('Save clears the decision for the next item', /pinDecidedRef\.current = false/.test(save));
  ok('Next and Skip open the camera only via shouldOpenCameraAfterPin', /shouldOpenCameraAfterPin\(/.test(next) && /shouldOpenCameraAfterPin\(/.test(skip));
  ok('the parked camera call is the ref, never a captured function', /runAfterPinStep\(\(\) => \{ void handleCameraRef\.current\(\); \}\)/.test(next)
    && /handleCameraRef\.current\(/.test(skip));
  ok('web runs the camera synchronously inside the click', /if \(Platform\.OS === 'web'\) \{ fn\(\); return; \}/.test(runAfter));
  ok('the iOS fallback only fires while the step is still closed', /!pinStepOpenRef\.current/.test(runAfter));
  ok('the project picker carries start', /params: \{ projectId: p, list: initialList, start: initialStart \}/.test(walk));
  ok('start=pin opens the step on mount — on iOS after the push transition (or its fallback)',
    /if \(initialStart !== 'pin'\) return;/.test(walk) && /if \(Platform\.OS !== 'ios'\) \{ openPinStep\(\); return; \}/.test(walk)
      && /addListener\('transitionEnd', open\)/.test(walk) && /setTimeout\(open, PIN_FIRST_MOUNT_FALLBACK_MS\)/.test(walk));
  ok('the late GPS stamp is a pin-scoped write (GPS columns only)', /updatePunchItemPin\(id, \{\s*photoLatitude/.test(save) && !/updatePunchItem\(/.test(walk));
  ok('web never promises a camera in pin-first', /Platform\.OS === 'web' \? 'Next: add the photo' : 'Next: take the photo'/.test(walk));
  ok('Save reopens the plan in pin-first mode', /if \(pinFirst && shouldAutoOpenPinStep\(/.test(save) && /openPinStep\(\)/.test(save.slice(save.lastIndexOf('setDraft('))));
  ok('the pin-first toggle is a switch', /testID="walk-pin-first-toggle"/.test(walk) && /accessibilityRole="switch"/.test(walk));

  // ── components/punch/PlanPinStep.tsx ──
  const step = stripTsComments(read('components/punch/PlanPinStep.tsx'));
  const screenBranch = between(step, "if (presentation === 'screen')", '\n');
  ok('the screen presentation has no Modal', screenBranch.length > 0 && !/<Modal/.test(screenBranch));
  ok('onDismiss reports onDismissed', /onDismiss=\{handleDismiss\}/.test(step) && /onDismissed\?\.\(\)/.test(between(step, 'const handleDismiss = useCallback', '}, [')));
  ok('the modal body is keyed by the open sequence and inert while closing',
    /pointerEvents=\{visible \? 'auto' : 'none'\}/.test(step) && /<PlanPinStepBody key=\{openSeq\}/.test(step));
  ok('itemKey resets the pin during render', /if \(itemKey !== seenItemKey\) \{[\s\S]{0,600}setPin\(/.test(step));
  ok('pickInitialPinSheet decides the sheet at init, latch and item reset', (step.match(/pickInitialPinSheet\(/g) ?? []).length >= 3);
  ok('the PDF import is only offered when a host passes onImportPdf', /onImportPdf &&[\s\S]{0,400}testID="walk-pin-add-pdf"/.test(step));
  ok('web keys are added and removed, web only',
    /addEventListener\('keydown'/.test(step) && /removeEventListener\('keydown'/.test(step) && /Platform\.OS !== 'web'/.test(between(step, 'useEffect(() => {\n    if (!shortcutsOn', '}, [shortcutsOn]')));
  ok('held keys never repeat a save / skip / undo', /if \(e\.defaultPrevented \|\| e\.isComposing \|\| e\.repeat\) return;/.test(step));
  ok('the no-plan and missing panels scroll (iPhone SE under the photo strip)',
    /<ScrollView style=\{styles\.panelWrap\} contentContainerStyle=\{styles\.panel\} testID="walk-pin-no-plan">/.test(step)
      && /<ScrollView style=\{styles\.panelWrap\} contentContainerStyle=\{styles\.panel\} testID="walk-pin-sheet-missing">/.test(step));
  ok('the missing panel points at the other sheets he can pin on', /testID="walk-pin-other-sheets"/.test(step));
  ok('capture guidance under "Photograph the plan"', /Stand over the sheet with the phone flat, fill the frame, keep glare off it\./.test(step));
  ok('defaults are the walk\'s own words', /title = 'Where is this\?'/.test(step) && /nextLabel = 'Next'/.test(step)
    && /skipLabel = 'Skip'/.test(step) && /skipHint = 'Skip to save without a pin'/.test(step));

  // ── contexts/ProjectContext.tsx ──
  const ctx = stripTsComments(RAW_CTX);
  ok('punchItemsLoaded follows the records-open-before-load shape',
    /const punchItemsLoaded = !authLoading && punchItemsLoadedFor === \(userId \?\? ''\)/.test(ctx)
      && /setPunchItemsLoadedFor\(userId \?\? ''\)/.test(ctx));
  ok('punchItemsLoaded is on the value after getPunchItemsForProject, and the markup-join literal is intact',
    /getPunchItemsForProject, punchItemsLoaded,/.test(ctx) && /punchItems: punchItemsView, addPunchItem,/.test(ctx));
  {
    const pinFn = between(ctx, 'const updatePunchItemPin = useCallback', 'const updatePunchItems = useCallback');
    ok('updatePunchItemPin sends ONLY punchPinScopedRow — never the whole row',
      pinFn.length > 0 && /const row = punchPinScopedRow\(id, scoped, now\);/.test(pinFn) && !/punchItemToUpdateRow|punchItemToRow/.test(pinFn));
    ok('…through the offline queue (direct write that queues on failure, or straight into the queue)',
      /supabaseWriteDetailed\('punch_items', 'update', row\)/.test(pinFn) && /addToOfflineQueue\(\{ table: 'punch_items', operation: 'update', data: row \}\)/.test(pinFn));
    ok('…updates local state at once (ref, setState, save)',
      /punchItemsRef\.current = next;\s*setPunchItems\(next\);\s*savePunchItemsMutation\.mutate\(next\);/.test(pinFn));
    ok('…is chained per item behind its previous write and anything still queued for the row',
      /const prev = chains\.get\(id\);/.test(pinFn) && /prevOutcome === 'queued'/.test(pinFn) && /queuedIdsFor\('punch_items'\)\)\.has\(id\)/.test(pinFn));
    ok('…and tracked for the refetch overlay', /trackPinWrite\(id, pinScopedPatchCarriesPin\(scoped\), p\)/.test(pinFn));
    ok('updatePunchItemPin is on the context value', /updatePunchItems, updatePunchItemPin, deletePunchItem,/.test(ctx));
    const hook = stripTsComments(read('hooks/usePunchPinWriter.ts'));
    ok('usePunchPinWriter writes the pin and its Undo through updatePunchItemPin only',
      /updatePunchItemPin\(item\.id, patch\)/.test(hook) && /updatePunchItemPin\(w\.itemId, undoPatchFor\(w\)\)/.test(hook) && !/updatePunchItem\(/.test(hook));
    ok('the loader also reads queued pin writes BEFORE the SELECT',
      /queuedPinsBefore = pendingPinIdsInQueue\(await getOfflineQueue\(\)\)/.test(ctx) && /new Set\(\[\.\.\.queuedPinsBefore, \.\.\.pendingPinIdsInQueue\(await getOfflineQueue\(\)\)\]\)/.test(ctx)
        && ctx.indexOf('queuedPinsBefore = pendingPinIdsInQueue') < ctx.indexOf("const { data, error } = await supabase.from('punch_items').select("));
    ok('planSheetsLoaded is keyed by account and on the value',
      /const planSheetsLoaded = !authLoading && planSheetsLoadedFor === \(userId \?\? ''\)/.test(ctx) && /planSheets, planSheetsLoaded, addPlanSheet,/.test(ctx));
  }
  ok('updatePunchItems takes the cleared pin columns', /const \{ next, changed, cleared \} = applyPunchBatchUpdate\(/.test(ctx));
  ok('each row write is tracked for the refetch overlay', /changed\.forEach\(pi => \{ trackPinWrite\(/.test(ctx));
  ok('the loader stamps the SELECT start', /const fetchStartedAt = Date\.now\(\);\s*const \{ data, error \} = await supabase\.from\('punch_items'\)\.select\(/.test(ctx));
  ok('the loader keeps pending pins around mergeLocalOnly', /keepPendingPinFields\(\s*mergeLocalOnly\(mapped, priorPunch/.test(ctx));
  ok('a new account starts with an empty pin tracker', /pinWriteTrackerRef\.current = new Map\(\)/.test(ctx));
  ok('drawing-pin updates and deletes read the latest list', /drawingPinsRef\.current\.map\(/.test(ctx) && /drawingPinsRef\.current\.filter\(/.test(ctx));
  ok('updateDrawingPin forwards a sheet move', /if \(updates\.planSheetId !== undefined\) patch\.plan_sheet_id = updates\.planSheetId;/.test(ctx));
  ok('updateDrawingPin sends an unlink as NULL', /if \('linkedPunchItemId' in updates\) patch\.linked_punch_item_id = updates\.linkedPunchItemId \?\? null;/.test(ctx));

  // ── package.json ──
  const pkg = JSON.parse(read('package.json') || '{}') as { scripts?: Record<string, string> };
  ok('test:punch-pin-items is registered', pkg.scripts?.['test:punch-pin-items'] === 'bun run scripts/validate-punch-pin-items.ts');
  ok('ship-check runs it right after test:punch-plan-pin', /bun run test:punch-plan-pin && bun run test:punch-pin-items/.test(pkg.scripts?.['ship-check'] ?? ''));
}

console.log('');
if (fail > 0) {
  console.error(`✗ validate-punch-pin-items: ${fail} failure(s), ${pass} passed.\n`);
  process.exit(1);
}
console.log(`✓ validate-punch-pin-items: ${pass} checks — every item can be pinned before or after its photo, and the pin lands where the plan viewer and the PDF draw it.\n`);
