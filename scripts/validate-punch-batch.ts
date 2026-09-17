// scripts/validate-punch-batch.ts — a bulk punch action is ONE write, not N.
//
// WHY THIS EXISTS. Selecting 100 punch items and closing / moving / deleting
// them used to call the single-item context action once per item. Each call is
// a React state update, a full-collection AsyncStorage save and a queued
// Supabase write, so a 100-item close was 100 saves and 100 re-renders, and
// the app being killed at item 50 left half the selection changed. Nothing on
// screen shows that — it just gets slow, and occasionally half-done.
//
// ProjectContext now has updatePunchItems / deletePunchItems: the whole next
// array computed once (ONE state update, ONE local save) and still one queued
// write per row, so utils/offlineQueue replays each item independently.
//
// HOW IT CHECKS.
//   1. The pure batch reducers live between the `punch-batch pure` markers in
//      contexts/ProjectContext.tsx. The context cannot load under bun, so this
//      script lifts that block out, transpiles it, and EXECUTES it.
//   2. The hook wiring and the screens are source pins on comment-stripped
//      text: the batch hooks save once and write per row, the single-item
//      actions delegate to the batch, and no bulk path loops the single call.
//
// Run via: bun run test:punch-batch

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { punchListTypeOf } from '../types';
import type { PunchItem } from '../types';
import { isDeviceLocalUri } from '../utils/photoUploadCore';

// Runs under bun, but tsc checks scripts against the app's lib set, which has
// no Bun global — declare the one API used (same as validate-ai-failure-copy).
declare const Bun: {
  Transpiler: new (opts: { loader: 'ts' }) => { transformSync(code: string): string };
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; console.log('  ✗', label, detail ? `\n      ${detail}` : ''); }
}
function eq<T>(label: string, got: T, want: T, why?: string) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  ok(label, g === w, g === w ? undefined : `got  ${g}\n      want ${w}${why ? `\n      ${why}` : ''}`);
}
const read = (rel: string): string => { try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return ''; } };

/** Strip // and /* *\/ comments. `(^|[^:])` keeps `https://` inside strings
 *  intact; a mis-strip can only REMOVE text, so it errs red, never green. */
function stripTsComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}
function between(src: string, start: string, end: string): string {
  const i = src.indexOf(start);
  if (i < 0) return '';
  const j = src.indexOf(end, i + start.length);
  return j < 0 ? '' : src.slice(i, j);
}

const RAW_CTX = read('contexts/ProjectContext.tsx');
ok('contexts/ProjectContext.tsx is readable', RAW_CTX.length > 0);

// ───────────────────────────────────────────────────────────────────────────
console.log('\nlifting the pure batch block out of ProjectContext');
// ───────────────────────────────────────────────────────────────────────────
type PunchBatchUpdates = Partial<PunchItem> | ((item: PunchItem) => Partial<PunchItem>);
type Pure = {
  applyPunchBatchUpdate: (
    items: PunchItem[], ids: readonly string[], updates: PunchBatchUpdates, now: string,
    finish?: (item: PunchItem) => PunchItem,
  ) => { next: PunchItem[]; changed: PunchItem[] };
  applyPunchBatchDelete: (items: PunchItem[], ids: readonly string[]) => { next: PunchItem[]; removed: PunchItem[] };
  punchItemToUpdateRow: (pi: PunchItem, now: string) => Record<string, unknown>;
};

const block = between(RAW_CTX, '// ── punch-batch pure (begin)', '// ── punch-batch pure (end)');
const durableFn = between(RAW_CTX, 'function durablePhotoValue(', '\n}');
ok('the punch-batch pure block was located', block.length > 0,
  'markers `punch-batch pure (begin)` / `(end)` are gone — restore them, do not delete this check');
ok('durablePhotoValue was located', durableFn.length > 0);

let pure: Pure | null = null;
try {
  const ts = `${durableFn}\n}\n${block}\n`;
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(ts);
  // Only these two names may be free in the block: a hook or new import turns
  // this into a ReferenceError, which is the point.
  pure = new Function('isDeviceLocalUri', 'punchListTypeOf',
    `${js}\nreturn { applyPunchBatchUpdate, applyPunchBatchDelete, punchItemToUpdateRow };`,
  )(isDeviceLocalUri, punchListTypeOf) as Pure;
} catch (e) {
  ok('the pure block transpiles and evaluates standalone', false, String(e));
}

if (pure) {
  const { applyPunchBatchUpdate, applyPunchBatchDelete, punchItemToUpdateRow } = pure;
  const NOW = '2026-09-17T12:00:00.000Z';
  const mk = (id: string, extra: Partial<PunchItem> = {}): PunchItem => ({
    id, projectId: 'p1', description: `item ${id}`, location: 'Unit 4B', assignedSub: 'Ace', assignedSubId: 'sub-1',
    dueDate: '2026-09-20', priority: 'medium', status: 'open',
    createdAt: '2026-09-15T08:00:00.000Z', updatedAt: '2026-09-15T08:00:00.000Z', ...extra,
  } as PunchItem);
  const items = [mk('a'), mk('b', { listType: 'crew' }), mk('c'), mk('d')];
  const frozen = JSON.stringify(items);

  // ─────────────────────────────────────────────────────────────────────────
  console.log('\napplyPunchBatchUpdate');
  // ─────────────────────────────────────────────────────────────────────────
  const r1 = applyPunchBatchUpdate(items, ['a', 'c'], { status: 'closed', closedAt: NOW }, NOW);
  eq('changes exactly the selected rows', r1.changed.map(i => i.id), ['a', 'c']);
  eq('every selected row carries the patch', r1.next.filter(i => i.status === 'closed').map(i => i.id), ['a', 'c']);
  eq('unselected rows are untouched (same objects)', [r1.next[1] === items[1], r1.next[3] === items[3]], [true, true]);
  eq('order is preserved', r1.next.map(i => i.id), ['a', 'b', 'c', 'd']);
  eq('updatedAt is stamped once for the batch', r1.changed.map(i => i.updatedAt), [NOW, NOW]);
  ok('the input array is not mutated', JSON.stringify(items) === frozen);

  const r2 = applyPunchBatchUpdate(items, ['b', 'd'], (pi) => ({ listType: punchListTypeOf(pi) === 'crew' ? 'punch' : 'crew' }), NOW);
  eq('a per-row patch function sees each row', r2.changed.map(i => [i.id, i.listType]), [['b', 'punch'], ['d', 'crew']]);

  const r3 = applyPunchBatchUpdate(items, ['a'], { id: 'hijack', description: 'x' } as Partial<PunchItem>, NOW);
  eq('a patch cannot re-key a row', r3.next[0].id, 'a',
    'the queued write would target the old id while local state moved to a new one');

  const r4 = applyPunchBatchUpdate(items, ['zzz'], { status: 'closed' }, NOW);
  ok('no matching id hands back the SAME array (caller skips save + render)', r4.next === items && r4.changed.length === 0);
  const r5 = applyPunchBatchUpdate(items, [], { status: 'closed' }, NOW);
  ok('an empty selection is a no-op', r5.next === items && r5.changed.length === 0);
  const r6 = applyPunchBatchUpdate(items, ['a', 'a', 'a'], { status: 'closed' }, NOW);
  eq('a duplicated id changes (and writes) its row once', r6.changed.map(i => i.id), ['a']);

  let finished = 0;
  applyPunchBatchUpdate(items, ['a', 'c'], { status: 'closed' }, NOW, (i) => { finished++; return i; });
  eq('finish (photo staging) runs once per changed row', finished, 2);

  // ─────────────────────────────────────────────────────────────────────────
  console.log('\napplyPunchBatchDelete');
  // ─────────────────────────────────────────────────────────────────────────
  const d1 = applyPunchBatchDelete(items, ['b', 'd']);
  eq('removes exactly the selected rows', d1.next.map(i => i.id), ['a', 'c']);
  eq('reports the removed rows (one queued delete each)', d1.removed.map(i => i.id), ['b', 'd']);
  ok('the input array is not mutated', JSON.stringify(items) === frozen);
  const d2 = applyPunchBatchDelete(items, ['nope']);
  ok('no matching id hands back the SAME array', d2.next === items && d2.removed.length === 0);

  // ─────────────────────────────────────────────────────────────────────────
  console.log('\npunchItemToUpdateRow — the per-row payload');
  // ─────────────────────────────────────────────────────────────────────────
  const rowCrew = punchItemToUpdateRow(mk('b', { listType: 'crew' }), NOW);
  eq('a crew item syncs list_type crew', rowCrew.list_type, 'crew',
    'a bulk move to the crew list would revert on refetch and republish to the client');
  eq('a legacy item (no listType) syncs list_type punch explicitly', punchItemToUpdateRow(mk('a'), NOW).list_type, 'punch');
  eq('the row targets the item id', rowCrew.id, 'b');
  eq('updated_at is the batch timestamp', rowCrew.updated_at, NOW);
  eq('a device-local photo URI never reaches the server',
    punchItemToUpdateRow(mk('a', { photoUri: 'file:///var/mobile/x.jpg' }), NOW).photo_uri, null);
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\nProjectContext hooks — one save, one write per row');
// ───────────────────────────────────────────────────────────────────────────
const ctx = stripTsComments(RAW_CTX);
const updHook = between(ctx, 'const updatePunchItems = useCallback', 'const updatePunchItem = useCallback');
const singleUpd = between(ctx, 'const updatePunchItem = useCallback', 'const deletePunchItems = useCallback');
const delHook = between(ctx, 'const deletePunchItems = useCallback', 'const deletePunchItem = useCallback');
const singleDel = between(ctx, 'const deletePunchItem = useCallback', 'const getPunchItemsForProject');
ok('updatePunchItems / updatePunchItem / deletePunchItems / deletePunchItem were located',
  [updHook, singleUpd, delHook, singleDel].every(s => s.length > 0));

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
ok('updatePunchItems uses the pure reducer', /applyPunchBatchUpdate\(\s*punchItemsRef\.current/.test(updHook),
  'reading the `punchItems` closure loses an edit made earlier in the same tick');
eq('updatePunchItems sets state once', count(updHook, /setPunchItems\(/g), 1);
eq('updatePunchItems saves locally once', count(updHook, /savePunchItemsMutation\.mutate\(/g), 1);
{
  // The one save must come before the per-row write loop opens — a save inside
  // that loop is the 100-saves regression with the reducer still in place.
  const saveAt = updHook.indexOf('savePunchItemsMutation.mutate(');
  const loopAt = updHook.search(/\.forEach\(|\bfor\s*\(/);
  ok('updatePunchItems saves BEFORE (outside) the per-row write loop', saveAt >= 0 && loopAt > saveAt,
    `save at ${saveAt}, first loop at ${loopAt}`);
}
ok('updatePunchItems queues one update per changed row via punchItemToUpdateRow',
  /changed\.forEach\([\s\S]*?supabaseWrite\(\s*'punch_items'\s*,\s*'update'\s*,\s*punchItemToUpdateRow\(/.test(updHook));
ok('updatePunchItems bails when nothing changed', /if\s*\(\s*changed\.length\s*===\s*0\s*\)\s*return/.test(updHook));
ok('updatePunchItem is the batch of one', /updatePunchItems\(\s*\[\s*id\s*\]/.test(singleUpd) && !/supabaseWrite|setPunchItems/.test(singleUpd));

ok('deletePunchItems uses the pure reducer', /applyPunchBatchDelete\(\s*punchItemsRef\.current/.test(delHook));
eq('deletePunchItems sets state once', count(delHook, /setPunchItems\(/g), 1);
eq('deletePunchItems saves locally once', count(delHook, /savePunchItemsMutation\.mutate\(/g), 1);
ok('deletePunchItems queues one delete per removed row',
  /removed\.forEach\([\s\S]*?supabaseWrite\(\s*'punch_items'\s*,\s*'delete'/.test(delHook));
ok('deletePunchItem is the batch of one', /deletePunchItems\(\s*\[\s*id\s*\]/.test(singleDel) && !/supabaseWrite|setPunchItems/.test(singleDel));
ok('both batch actions are exposed on the context value',
  /updatePunchItems\s*:\s*\(/.test(ctx) && /deletePunchItems\s*:\s*\(/.test(ctx));

// ───────────────────────────────────────────────────────────────────────────
console.log('\nscreens — no bulk path loops the single-item call');
// ───────────────────────────────────────────────────────────────────────────
// A single-item call inside any iteration (forEach / map / for / for…of /
// reduce) over a selection is exactly the regression. Scanned per file across
// every screen that touches punch items, not just the two known ones.
const LOOP_SINGLE = /(?:\.(?:forEach|map|filter|reduce|some|every)\s*\(|\bfor\s*\()[^;]{0,200}?\b(?:updatePunchItem|deletePunchItem)\s*\(/;
for (const rel of ['app/punch-list.tsx', 'app/punch-walk.tsx']) {
  const src = stripTsComments(read(rel));
  ok(`${rel} is readable`, src.length > 0);
  const m = LOOP_SINGLE.exec(src);
  ok(`${rel}: no loop over updatePunchItem / deletePunchItem`, !m,
    m ? `found: ${m[0].replace(/\s+/g, ' ').slice(0, 160)}` : undefined);
}
const list = stripTsComments(read('app/punch-list.tsx'));
const runBulk = between(list, 'const runBulkUpdate = useCallback', '}, [');
ok('punch-list runBulkUpdate calls updatePunchItems once', /updatePunchItems\(\s*ids\s*,/.test(runBulk) && !/updatePunchItem\(/.test(runBulk));
const bulkMove = between(list, 'const bulkMove = useCallback', 'const moveItem = useCallback');
ok('punch-list bulkMove goes through runBulkUpdate with listType (no per-item update)',
  /runBulkUpdate\([\s\S]*?listType\s*:\s*target/.test(bulkMove) && !/updatePunchItem\(/.test(bulkMove));
const bulkDelete = between(list, 'const bulkDelete = useCallback', '}, [selectedIdList');
ok('punch-list bulkDelete calls deletePunchItems once', /deletePunchItems\(\s*ids\s*\)/.test(bulkDelete) && !/deletePunchItem\(/.test(bulkDelete));
const bulkStatus = between(list, 'const bulkSetStatus = useCallback', '}, [');
ok('punch-list bulkSetStatus goes through runBulkUpdate', /runBulkUpdate\(/.test(bulkStatus) && !/updatePunchItem\(/.test(bulkStatus));
const bulkAssign = between(list, 'const bulkAssignTo = useCallback', '}, [');
ok('punch-list bulkAssignTo goes through runBulkUpdate', /runBulkUpdate\(/.test(bulkAssign) && !/updatePunchItem\(/.test(bulkAssign));

console.log('');
if (fail > 0) {
  console.error(`✗ validate-punch-batch: ${fail} failure(s), ${pass} passed.\n`);
  process.exit(1);
}
console.log(`✓ validate-punch-batch: ${pass} checks — a bulk punch action is one save and one write per row.\n`);
