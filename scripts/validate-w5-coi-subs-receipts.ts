// validate-w5-coi-subs-receipts.ts — material receipts reach the account
// (audit #25, CONTRACT 16).
//
// Receipts lived only in AsyncStorage under `mageid_material_receipts`, which
// the sign-out sweep deletes; the web budget dashboard and job costing on
// another device never counted them. hooks/useMaterialReceipts now upserts
// every add / edit / delete into public.material_receipts through the offline
// queue and merges the account copy on read. This runs the REAL merge and row
// builder (the hook module is imported with its React Native / network edges
// stubbed), then pins by source that every write path pushes, deletes are
// tombstones, the return shape is unchanged, and the save confirmation says
// where the receipt landed.
//
// Run: bun run scripts/validate-w5-coi-subs-receipts.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MaterialReceipt } from '../types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

interface VirtualModuleBuilder { module(s: string, cb: () => { exports: Record<string, unknown>; loader: 'object' }): void }
const bun = (globalThis as unknown as { Bun?: { plugin(d: { name: string; setup: (b: VirtualModuleBuilder) => void }): void } }).Bun;
if (!bun) { console.error('must run under bun'); process.exit(1); }
bun.plugin({
  name: 'stub-material-receipts-edges',
  setup(build) {
    build.module('@react-native-async-storage/async-storage', () => ({ exports: { default: { getItem: async () => null, setItem: async () => undefined } }, loader: 'object' }));
    build.module('@/contexts/AuthContext', () => ({ exports: { useAuth: () => ({ user: null }) }, loader: 'object' }));
    build.module('@/lib/supabase', () => ({ exports: { supabase: {}, isSupabaseConfigured: true }, loader: 'object' }));
    build.module('@/utils/offlineQueue', () => ({ exports: { supabaseWriteDetailed: async () => 'synced', getOwnOfflineQueueDetailed: async () => ({ entries: [], readFailed: false }) }, loader: 'object' }));
  },
});

const hook = await import('../hooks/useMaterialReceipts');
const { mergeMaterialReceipts, materialReceiptToRow, receiptSavedMessage, MATERIAL_RECEIPTS_TABLE } = hook;

const rec = (id: string, updatedAt: string, over: Partial<MaterialReceipt> = {}): MaterialReceipt => ({
  id, projectId: 'p1', vendor: 'Lumber Co', lines: [], subtotal: 3412.57, total: 3412.57,
  status: 'reviewed', createdAt: updatedAt, updatedAt, ...over,
});
const row = (r: MaterialReceipt, deleted_at: string | null = null) => materialReceiptToRow(r, 'u1', deleted_at);
const none = new Set<string>();

console.log('\nrow builder:');
{
  const r = materialReceiptToRow(rec('r1', '2026-09-20T10:00:00.000Z', { commitmentId: 'c1' }), 'u1');
  ok('id / user_id / project_id / commitment_id / payload / updated_at', r.id === 'r1' && r.user_id === 'u1' && r.project_id === 'p1'
    && r.commitment_id === 'c1' && r.payload.total === 3412.57 && r.updated_at === '2026-09-20T10:00:00.000Z' && r.deleted_at === null);
  const t = materialReceiptToRow(rec('r1', '2026-09-20T10:00:00.000Z'), 'u1', '2026-09-21T09:00:00.000Z');
  ok('a delete is a tombstone (deleted_at set, updated_at = the delete)', t.deleted_at === '2026-09-21T09:00:00.000Z' && t.updated_at === t.deleted_at);
  ok('the table is material_receipts', MATERIAL_RECEIPTS_TABLE === 'material_receipts');
}

console.log('\nmerge:');
{
  const a = mergeMaterialReceipts({ local: [], serverRows: [row(rec('r1', '2026-09-20T10:00:00Z'))], pendingIds: none, pendingDeleteIds: none, cacheIsThisUsers: true });
  ok('a receipt snapped on the phone shows on the web (server-only → shown)', a.merged.length === 1 && a.merged[0].total === 3412.57);

  const b = mergeMaterialReceipts({ local: [rec('r2', '2026-09-19T08:00:00Z')], serverRows: [], pendingIds: none, pendingDeleteIds: none, cacheIsThisUsers: true });
  ok('a device-only receipt (snapped before sync) is kept AND pushed up', b.merged.length === 1 && b.toBackfill.map(r => r.id).join() === 'r2');

  const c = mergeMaterialReceipts({ local: [rec('r2', '2026-09-19T08:00:00Z')], serverRows: [], pendingIds: none, pendingDeleteIds: none, cacheIsThisUsers: false });
  ok("another account's cache is never pushed up under this one", c.merged.length === 0 && c.toBackfill.length === 0);

  const d = mergeMaterialReceipts({
    local: [rec('r1', '2026-09-22T08:00:00Z', { total: 100 })],
    serverRows: [row(rec('r1', '2026-09-20T10:00:00Z', { total: 3412.57 }))], pendingIds: none, pendingDeleteIds: none, cacheIsThisUsers: true,
  });
  ok('newest updatedAt wins (local newer → local, and re-pushed)', d.merged[0].total === 100 && d.toBackfill.length === 1);
  const e = mergeMaterialReceipts({
    local: [rec('r1', '2026-09-19T08:00:00Z', { total: 100 })],
    serverRows: [row(rec('r1', '2026-09-20T10:00:00Z', { total: 3412.57 }))], pendingIds: none, pendingDeleteIds: none, cacheIsThisUsers: true,
  });
  ok('…server newer → server, nothing pushed', e.merged[0].total === 3412.57 && e.toBackfill.length === 0);

  const f = mergeMaterialReceipts({
    local: [rec('r1', '2026-09-19T08:00:00Z', { total: 100 })],
    serverRows: [row(rec('r1', '2026-09-20T10:00:00Z'))], pendingIds: new Set(['r1']), pendingDeleteIds: none, cacheIsThisUsers: true,
  });
  ok('an edit still waiting in the offline queue keeps its local copy', f.merged[0].total === 100 && f.toBackfill.length === 0);

  const g = mergeMaterialReceipts({
    local: [rec('r1', '2026-09-19T08:00:00Z')],
    serverRows: [row(rec('r1', '2026-09-19T08:00:00Z'), '2026-09-21T00:00:00Z')], pendingIds: none, pendingDeleteIds: none, cacheIsThisUsers: true,
  });
  ok('a tombstone from another device removes the receipt here (not re-uploaded)', g.merged.length === 0 && g.toBackfill.length === 0);

  const h = mergeMaterialReceipts({
    local: [], serverRows: [row(rec('r1', '2026-09-20T10:00:00Z'))], pendingIds: none, pendingDeleteIds: new Set(['r1']), cacheIsThisUsers: true,
  });
  ok('a delete made offline (queued tombstone) keeps the server copy off the screen', h.merged.length === 0);

  const i = mergeMaterialReceipts({
    local: [rec('old', '2026-09-01T00:00:00Z')], serverRows: [row(rec('new', '2026-09-20T00:00:00Z'))], pendingIds: none, pendingDeleteIds: none, cacheIsThisUsers: true,
  });
  ok('newest-created first', i.merged.map(r => r.id).join() === 'new,old');
  const j = mergeMaterialReceipts({ local: [], serverRows: [{ id: 'bad', payload: undefined, deleted_at: null }], pendingIds: none, pendingDeleteIds: none, cacheIsThisUsers: true });
  ok('a row without a payload is skipped, not rendered as an empty receipt', j.merged.length === 0);
}

console.log('\nsave confirmation:');
{
  ok("'synced' → saved to the account", /Saved to your account/.test(receiptSavedMessage('synced')));
  ok("'queued' → on this phone, uploads when back online", /uploads to your account when you're back online/.test(receiptSavedMessage('queued')));
  ok("'failed' → on this phone only, not on the web, signing out removes it",
    /on this phone only/.test(receiptSavedMessage('failed')) && /signing out removes it/.test(receiptSavedMessage('failed')));
  ok('only a synced save claims the account', !/account/.test(receiptSavedMessage('failed')));
}

console.log('\nthe hook and the screen:');
{
  const h = src('hooks/useMaterialReceipts.ts').replace(/^\s*\/\/.*$/gm, '');
  const body = (name: string) => h.slice(h.indexOf(`const ${name} = useCallback`), h.indexOf('}, [', h.indexOf(`const ${name} = useCallback`)));
  ok('addReceipt pushes to the account and returns the outcome', /return push\(r\);/.test(body('addReceipt')));
  ok('addReceipts pushes each fresh receipt', /for \(const r of fresh\) void push\(r\);/.test(body('addReceipts')));
  ok('updateReceipt pushes the edited receipt', /if \(changed\) void push\(changed\);/.test(body('updateReceipt')));
  ok('deleteReceipt pushes a tombstone (not a hard delete)', /void push\(gone, new Date\(\)\.toISOString\(\)\)/.test(body('deleteReceipt')) && !/'delete'/.test(h));
  ok('writes go through the offline queue as upserts', /supabaseWriteDetailed\(MATERIAL_RECEIPTS_TABLE, 'upsert'/.test(h));
  ok('the read merges the account copy (mergeMaterialReceipts) and backfills', /mergeMaterialReceipts\(\{/.test(h) && /for \(const r of toBackfill\) void writeRow/.test(h));
  ok('an unreadable queue keeps every local copy', /queue\.readFailed \? new Set\(local\.map\(r => r\.id\)\)/.test(h));
  ok('the return shape is unchanged',
    /return \{ receipts, isLoading, addReceipt, addReceipts, updateReceipt, deleteReceipt, getReceiptsForProject \};/.test(h));
  ok('every AsyncStorage call is inside try/catch', (h.match(/AsyncStorage\.\w+\(/g) ?? []).length === 4
    && !/^\s*await AsyncStorage[^\n]*\n(?![\s\S]*catch)/.test(h));
  const screen = src('app/material-receipt.tsx');
  ok('the screen renders receiptSavedMessage(saved), not a bare "Saved."',
    /\{receiptSavedMessage\(saved\)\}/.test(screen) && !/>Saved\. The prices fed your Cost Database/.test(screen));
  ok('…from the outcome addReceipt resolves to', /void addReceipt\(toSave\)\.then\(\s*outcome => setSaved\(outcome\)/.test(screen));
  ok('…with the success tint only when it reached the account', /saved === 'synced'\s*\n?\s*\? <Check/.test(screen));
}

console.log(`\nvalidate-w5-coi-subs-receipts: ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
