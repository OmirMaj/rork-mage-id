// validate-w5-closeout-selections.ts — wave 5, lane closeout: Selections.
//
//   #48  A homeowner's portal pick never set selection_categories.status, so a
//        $620 pick on a $400 allowance read green "Chosen" with no overage and
//        no "Draft a Change Order" CTA. portal_choose_selection now sets it.
//   #137 The GC's choose was three client writes (clear, set, status): a
//        timeout between the first two wiped the homeowner's pick and saved
//        nothing. It is now ONE RPC (gc_choose_selection); category / option
//        writes have queue-aware variants; re-curating no longer demotes a
//        chosen category; an offline choose refuses with a reason.
//   #52  loadSelectionsChecked tells a failed read (either table) from empty.
//
// The engine is imported for real with Supabase, the AI relay and the offline
// queue stubbed; the migration is read as text (its behaviour is executed in
// PGlite by the lane's scratch test).
//
// Run: bun run scripts/validate-w5-closeout-selections.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, detail); }
}

type VirtualModule = { exports: Record<string, unknown>; loader: 'object' };
type BunPluginBuilder = { module: (specifier: string, cb: () => VirtualModule) => void };
declare const Bun: { plugin: (p: { name: string; setup: (build: BunPluginBuilder) => void }) => void } | undefined;
if (typeof Bun === 'undefined') {
  console.error('validate-w5-closeout-selections must run under bun (Bun.plugin stubs Supabase)');
  process.exit(1);
}

// ── a scriptable Supabase double ─────────────────────────────────────────────
type Resp = { data?: unknown; error?: { message: string; code?: string } | null };
type Call = { table?: string; rpc?: string; op: string; args: unknown[]; filters: [string, unknown[]][] };
const calls: Call[] = [];
const responders: { table: Record<string, () => Resp | Promise<Resp>>; rpc: Record<string, (args: unknown) => Resp | Promise<Resp>> } = { table: {}, rpc: {} };
let rpcThrows: Error | null = null;

function builder(table: string) {
  const call: Call = { table, op: 'select', args: [], filters: [] };
  calls.push(call);
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'update', 'insert', 'upsert', 'delete']) {
    b[m] = (...args: unknown[]) => { if (m !== 'select' || call.op === 'select') call.op = m; call.args = m === 'select' && call.args.length ? call.args : args; return b; };
  }
  for (const f of ['eq', 'neq', 'in', 'order', 'limit']) {
    b[f] = (...args: unknown[]) => { call.filters.push([f, args]); return b; };
  }
  const settle = async () => (responders.table[`${table}:${call.op}`] ?? (() => ({ data: null, error: null })))();
  b.maybeSingle = () => settle();
  b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => settle().then(res, rej);
  return b;
}
const fakeSupabase = {
  from: (t: string) => builder(t),
  rpc: async (name: string, args: unknown) => {
    calls.push({ rpc: name, op: 'rpc', args: [args], filters: [] });
    if (rpcThrows) throw rpcThrows;
    return (responders.rpc[name] ?? (() => ({ data: null, error: null })))(args);
  },
  auth: { getSession: async () => ({ data: { session: { user: { id: 'gc-1' } } } }) },
};
const queueCalls: { table: string; operation: string; data: Record<string, unknown> }[] = [];
Bun.plugin({
  name: 'w5-closeout-selections-stubs',
  setup(build) {
    build.module('@/lib/supabase', () => ({ exports: { supabase: fakeSupabase, isSupabaseConfigured: true }, loader: 'object' }));
    build.module('@/utils/mageAI', () => ({ exports: { mageAI: async () => { throw new Error('mageAI must not be called'); } }, loader: 'object' }));
    build.module('@/utils/offlineQueue', () => ({
      exports: {
        supabaseWriteDetailed: async (table: string, operation: string, data: Record<string, unknown>) => {
          queueCalls.push({ table, operation, data });
          return 'queued';
        },
      },
      loader: 'object',
    }));
  },
});

const eng = await import('../utils/selectionsEngine');
const reset = () => { calls.length = 0; queueCalls.length = 0; responders.table = {}; responders.rpc = {}; rpcThrows = null; };

const catRow = (id: string, status = 'browsing') => ({
  id, project_id: 'p1', user_id: 'gc-1', category: 'Kitchen faucet', style_brief: '', budget: 400,
  due_date: null, status, notes: '', display_order: 0, created_at: 'x', updated_at: 'x',
});
const optRow = (id: string, category_id: string, total: number, is_chosen = false) => ({
  id, category_id, source: 'ai_generated', product_name: id, brand: '', sku: '', description: '',
  image_url: null, product_url: null, unit_price: total, unit: 'ea', quantity: 1, total,
  lead_time_days: null, supplier: null, highlights: [], is_chosen, chosen_at: null, chosen_by_role: null, created_at: 'x',
});

// ── #52 loadSelectionsChecked ────────────────────────────────────────────────
console.log('\n#52 loadSelectionsChecked tells failure from empty:');
reset();
responders.table['selection_categories:select'] = () => ({ data: null, error: { message: 'Network request failed' } });
let r = await eng.loadSelectionsChecked('p1');
ok('a failed categories read → ok:false (not [])', r.ok === false, JSON.stringify(r));
ok('…while the old fetcher reads it as "no categories"', (await eng.fetchSelectionsForProject('p1')).length === 0);
reset();
responders.table['selection_categories:select'] = () => ({ data: [catRow('c1')], error: null });
responders.table['selection_options:select'] = () => ({ data: null, error: { message: 'timeout' } });
r = await eng.loadSelectionsChecked('p1');
ok('a failed OPTIONS read → ok:false (not categories with no options)', r.ok === false, JSON.stringify(r));
ok('…while the old fetcher hands back the category with 0 options',
  (await eng.fetchSelectionsForProject('p1'))[0]?.options?.length === 0);
reset();
responders.table['selection_categories:select'] = () => ({ data: [catRow('c1')], error: null });
responders.table['selection_options:select'] = () => ({ data: [optRow('o1', 'c1', 620, true)], error: null });
r = await eng.loadSelectionsChecked('p1');
ok('both reads ok → categories with their options', r.ok === true && r.value[0].options?.[0]?.isChosen === true, JSON.stringify(r));
reset();
responders.table['selection_categories:select'] = () => ({ data: [], error: null });
r = await eng.loadSelectionsChecked('p1');
ok('zero categories is a real empty answer', r.ok === true && r.value.length === 0);
reset();
responders.table['selection_categories:select'] = () => { throw new TypeError('Network request failed'); };
r = await eng.loadSelectionsChecked('p1');
ok('a rejected read (dropped connection) → ok:false, no throw', r.ok === false);

// ── #137 the choose is one RPC ───────────────────────────────────────────────
console.log('\n#137 the GC\'s choose is one server transaction:');
reset();
responders.rpc.gc_choose_selection = () => ({ data: { ok: true, status: 'exceeded', over: 220 }, error: null });
let c = await eng.chooseSelectionOptionDetailed('c1', 'o3');
ok('calls gc_choose_selection with the category and option', calls.some(k => k.rpc === 'gc_choose_selection'
  && JSON.stringify(k.args[0]) === JSON.stringify({ p_category_id: 'c1', p_option_id: 'o3' })), JSON.stringify(calls));
ok('makes NO client write to selection_options / selection_categories',
  !calls.some(k => k.table && k.op !== 'select'), JSON.stringify(calls.filter(k => k.table)));
ok('returns { ok, status: exceeded, over: 220 }', c.ok === true && c.status === 'exceeded' && c.over === 220, JSON.stringify(c));
reset();
responders.rpc.gc_choose_selection = () => ({ data: null, error: { message: 'TypeError: Network request failed' } });
c = await eng.chooseSelectionOptionDetailed('c1', 'o3');
ok('offline → refuses with the reason, nothing queued',
  c.ok === false && c.reason === 'offline' && c.message === eng.CHOOSE_OFFLINE_MESSAGE && queueCalls.length === 0, JSON.stringify(c));
ok('the refusal says why: the homeowner may be picking right now', /homeowner may be picking in the portal right now/.test(eng.CHOOSE_OFFLINE_MESSAGE));
reset();
rpcThrows = new TypeError('Failed to fetch');
c = await eng.chooseSelectionOptionDetailed('c1', 'o3');
ok('a thrown fetch failure is offline too', c.ok === false && c.reason === 'offline');
reset();
responders.rpc.gc_choose_selection = () => ({ data: null, error: { message: 'selection_denied', code: '42501' } });
c = await eng.chooseSelectionOptionDetailed('c1', 'o3');
ok('a refused choose (not the owner) → denied', c.ok === false && c.reason === 'denied');
ok('the boolean form reports the failure', (await eng.chooseSelectionOption('c1', 'o3', 'gc')) === false);
reset();
responders.rpc.gc_choose_selection = () => ({ data: { ok: true, status: 'chosen', over: 0 }, error: null });
ok('the boolean form reports success', (await eng.chooseSelectionOption('c1', 'o3', 'gc')) === true);

// ── #137 saveCuratedOptions only moves 'pending' to 'browsing' ────────────────
console.log('\n#137 re-curating cannot demote a chosen category:');
reset();
await eng.saveCuratedOptions('c1', [{ productName: 'A', brand: '', description: '', unitPrice: 1, unit: 'ea', quantity: 1, total: 1, highlights: [], productUrl: '' }]);
const statusWrite = calls.find(k => k.table === 'selection_categories' && k.op === 'update');
ok('the status write is filtered to status = pending',
  !!statusWrite && statusWrite.filters.some(([f, a]) => f === 'eq' && a[0] === 'status' && a[1] === 'pending'), JSON.stringify(statusWrite));

// ── #137 queue-aware writes ──────────────────────────────────────────────────
console.log('\n#137 category / option writes go through the offline queue:');
reset();
const newCat = await eng.saveSelectionCategoryDetailed({ projectId: 'p1', category: 'Tile', budget: 900 });
const ins = queueCalls[0];
ok('a new category is a queued INSERT with a client uuid', ins?.table === 'selection_categories' && ins.operation === 'insert'
  && typeof ins.data.id === 'string' && /^[0-9a-f-]{36}$/.test(String(ins.data.id)), JSON.stringify(ins));
ok('…returns the outcome and the optimistic card with the same id',
  newCat.outcome === 'queued' && newCat.category?.id === ins?.data.id && newCat.category?.status === 'pending');
reset();
await eng.saveSelectionCategoryDetailed({ id: 'c1', projectId: 'p1', category: 'Tile', budget: 950 });
ok('an existing category is an UPDATE that never sends status unless asked',
  queueCalls[0]?.operation === 'update' && !('status' in queueCalls[0].data), JSON.stringify(queueCalls[0]));
reset();
ok('delete goes through the queue', (await eng.deleteSelectionCategoryDetailed('c1')) === 'queued'
  && queueCalls[0]?.operation === 'delete' && queueCalls[0].data.id === 'c1');
reset();
await eng.saveSelectionOptionDetailed({ id: 'o1', categoryId: 'c1', productName: 'A', imageUrl: 'https://x/y.jpg' });
const optUpd = queueCalls[0];
ok('a photo edit on an existing option does not touch the pick or the total',
  optUpd?.operation === 'update' && !('is_chosen' in optUpd.data) && !('chosen_by_role' in optUpd.data)
  && !('total' in optUpd.data) && !('quantity' in optUpd.data) && optUpd.data.image_url === 'https://x/y.jpg', JSON.stringify(optUpd));
reset();
const priceOnly = await eng.saveSelectionOptionDetailed({ id: 'o1', categoryId: 'c1', productName: 'A', unitPrice: 14 });
ok('a price-only edit on an existing option is refused with a reason — never a success that dropped the price',
  priceOnly.outcome === 'failed' && priceOnly.message === eng.OPTION_PRICE_NEEDS_QUANTITY && queueCalls.length === 0, JSON.stringify({ priceOnly, queueCalls }));
reset();
const qtyOnly = await eng.saveSelectionOptionDetailed({ id: 'o1', categoryId: 'c1', productName: 'A', quantity: 40 });
ok('a quantity-only edit is refused the same way (total needs both)',
  qtyOnly.outcome === 'failed' && qtyOnly.message === eng.OPTION_PRICE_NEEDS_QUANTITY && queueCalls.length === 0, JSON.stringify({ qtyOnly, queueCalls }));
reset();
const pair = await eng.saveSelectionOptionDetailed({ id: 'o1', categoryId: 'c1', productName: 'A', unitPrice: 14.15, quantity: 60 });
ok('a price + quantity edit sends unit_price, quantity and the total to the cent',
  pair.outcome === 'queued' && queueCalls[0]?.operation === 'update' && queueCalls[0].data.unit_price === 14.15
  && queueCalls[0].data.quantity === 60 && queueCalls[0].data.total === 849 && !('is_chosen' in queueCalls[0].data), JSON.stringify(queueCalls[0]));
reset();
await eng.saveSelectionOptionDetailed({ categoryId: 'c1', productName: 'B', unitPrice: 3.34, quantity: 3 });
ok('a new option is a queued insert, total to the cent, not chosen',
  queueCalls[0]?.operation === 'insert' && queueCalls[0].data.total === 10.02 && queueCalls[0].data.is_chosen === false, JSON.stringify(queueCalls[0]));

// ── the migration ────────────────────────────────────────────────────────────
console.log('\nsupabase/migrations/20260923140000_selections_choose_status.sql:');
const mig = read('supabase/migrations/20260923140000_selections_choose_status.sql').replace(/^\s*--.*$/gm, '');
const portalFn = mig.slice(mig.indexOf('function public.portal_choose_selection('), mig.indexOf('function public.gc_choose_selection('));
const gcFn = mig.slice(mig.indexOf('function public.gc_choose_selection('));
ok('#48 portal_choose_selection keeps its signature, SECURITY DEFINER and search_path',
  /portal_choose_selection\(p_portal_id text, p_category_id uuid, p_option_id uuid, p_access_token text DEFAULT NULL::text\)/.test(mig)
  && /security definer\s+set search_path to 'public'/.test(portalFn));
ok('#48 …keeps the token check through portal_project_for_token', /portal_project_for_token\(p_portal_id, p_access_token\)/.test(portalFn));
ok('#48 …and writes selection_categories.status with the engine rule (exceeded only over a real budget)',
  /update public\.selection_categories c\s+set status = v_status/.test(portalFn)
  && /case when v_budget > 0 and v_total > v_budget then 'exceeded' else 'chosen' end/.test(portalFn));
ok('#48 …after the two option updates', portalFn.indexOf("chosen_by_role = 'homeowner'") < portalFn.indexOf('set status = v_status'));
ok('#48 …the overage goes in the audit detail and the response',
  /'status', v_status, 'over', v_over/.test(portalFn) && /jsonb_build_object\('ok', true, 'status', v_status, 'over', v_over\)/.test(portalFn));
ok('#48 grants re-issued for (text,uuid,uuid,text)', /grant\s+execute on function public\.portal_choose_selection\(text, uuid, uuid, text\) to anon, authenticated, service_role/.test(mig));
ok('#137 gc_choose_selection(uuid, uuid) is SECURITY DEFINER with the RLS owner rule',
  /security definer\s+set search_path to 'public'/.test(gcFn) && /c\.user_id = v_uid/.test(gcFn) && /for update/.test(gcFn));
ok("#137 …records the pick as 'gc' and sets the status in the same function",
  /chosen_by_role = 'gc'/.test(gcFn) && /set status = v_status/.test(gcFn));
ok('#137 …anon cannot run it', /revoke execute on function public\.gc_choose_selection\(uuid, uuid\) from public, anon/.test(mig));
ok('the backfill only touches rows whose status disagrees (idempotent)', /c\.status is distinct from/.test(mig));
ok('no fire_notify from an RPC body (CONTRACT 8)', !/fire_notify/.test(mig));

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `\nALL PASS (${pass})`);
if (fail) process.exit(1);
