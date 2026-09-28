// fixture-io.ts: the REAL online-only writes (utils/offlineQueue.ts) and the
// REAL closeout-binder save (utils/closeoutBinderEngine.ts) against in-memory
// stubs. Run in its own bun process by scripts/moments-checks/step0.ts (its
// Bun.plugin stubs must not leak into the other check modules); prints one
// JSON line per case: {"name": …, "pass": …, "detail": …}.
//
//   bun run scripts/moments-checks/step0/fixture-io.ts

type VirtualModule = { exports: Record<string, unknown>; loader: 'object' };
type BunPluginBuilder = { module: (specifier: string, cb: () => VirtualModule) => void };
declare const Bun: { plugin: (p: { name: string; setup: (build: BunPluginBuilder) => void }) => void };

const results: { name: string; pass: boolean; detail?: string }[] = [];
function ok(name: string, pass: boolean, detail?: unknown) {
  results.push({ name, pass, ...(pass ? {} : { detail: typeof detail === 'string' ? detail : JSON.stringify(detail) }) });
}

// ── stubs ───────────────────────────────────────────────────────────────────
const store = new Map<string, string>();
type Call = { table: string; op: string; data: Record<string, unknown>; select?: string; onConflict?: string };
type Answer = { error: { message: string; code?: string } | null; status?: number; data?: unknown };
const calls: Call[] = [];
let script: (c: Call) => Promise<Answer> = async (c) => ({ error: null, status: 200, data: c.select ? [{ id: c.data.id ?? 'x' }] : null });
let offline = false;
const toasts: string[] = [];
let sessionUser = 'u1';
let authFeed: ((event: string, session: unknown) => void) | null = null;
function setSession(id: string) {
  sessionUser = id;
  authFeed?.('SIGNED_IN', { user: { id }, access_token: `tok-${id}` });
}
async function send(c: Call): Promise<Answer> {
  calls.push(c);
  const a = await script(c);
  return a;
}
/** A PostgREST-ish builder: awaited alone it sends; .select(cols) sends with the columns; .maybeSingle() unwraps. */
function builder(base: Call) {
  const b = {
    then(res: (a: Answer) => unknown, rej?: (e: unknown) => unknown) { return send(base).then(res, rej); },
    select(cols: string) {
      const withSel = { ...base, select: cols };
      return {
        then(res: (a: Answer) => unknown, rej?: (e: unknown) => unknown) { return send(withSel).then(res, rej); },
        maybeSingle: async () => {
          const a = await send(withSel);
          const d = Array.isArray(a.data) ? a.data[0] ?? null : a.data ?? null;
          return { ...a, data: d };
        },
      };
    },
  };
  return b;
}

Bun.plugin({
  name: 'moments-step0-io',
  setup(build) {
    build.module('react-native', () => ({ exports: { Platform: { OS: 'ios' } }, loader: 'object' }));
    for (const spec of ['expo-print', 'expo-sharing', 'expo-mail-composer']) {
      build.module(spec, () => ({ exports: {}, loader: 'object' }));
    }
    build.module('@react-native-async-storage/async-storage', () => ({
      exports: {
        default: {
          getItem: async (k: string) => store.get(k) ?? null,
          setItem: async (k: string, v: string) => { store.set(k, v); },
          removeItem: async (k: string) => { store.delete(k); },
        },
      },
      loader: 'object',
    }));
    build.module('expo-file-system/legacy', () => ({
      exports: {
        documentDirectory: null,
        getInfoAsync: async () => ({ exists: false }),
        makeDirectoryAsync: async () => undefined,
        copyAsync: async () => undefined,
        moveAsync: async () => undefined,
        deleteAsync: async () => undefined,
      },
      loader: 'object',
    }));
    build.module('@/utils/storage', () => ({ exports: { uploadProjectPhoto: async () => 'ok' }, loader: 'object' }));
    build.module('@/hooks/useOnline', () => ({ exports: { isOfflineNow: () => offline, useOffline: () => offline }, loader: 'object' }));
    build.module('@/lib/supabase', () => ({
      exports: {
        isSupabaseConfigured: true,
        supabase: {
          auth: {
            getSession: async () => ({ data: { session: { user: { id: sessionUser }, access_token: `tok-${sessionUser}` } } }),
            onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
              authFeed = cb;
              return { data: { subscription: { unsubscribe: () => undefined } } };
            },
          },
          rpc: (fn: string, args: Record<string, unknown>) => send({ table: `rpc:${fn}`, op: 'rpc', data: args }),
          from: (table: string) => ({
            insert: (data: Record<string, unknown>) => builder({ table, op: 'insert', data }),
            upsert: (data: Record<string, unknown>, o?: { onConflict?: string }) => builder({ table, op: 'upsert', data, ...(o?.onConflict ? { onConflict: o.onConflict } : {}) }),
            update: (data: Record<string, unknown>) => ({ eq: (_c: string, id: string) => builder({ table, op: 'update', data: { ...data, id } }) }),
            delete: () => ({ eq: (_c: string, id: string) => builder({ table, op: 'delete', data: { id } }) }),
            select: () => ({ eq: async (_c: string, id: string) => ({ data: [{ id }], error: null, status: 200 }) }),
          }),
        },
      },
      loader: 'object',
    }));
    build.module('@/components/animations/NailItToast', () => ({
      exports: { oops: (m: string) => { toasts.push(m); }, nailIt: () => undefined },
      loader: 'object',
    }));
    build.module('@sentry/react-native', () => ({
      exports: { captureMessage: () => undefined, captureException: () => undefined },
      loader: 'object',
    }));
  },
});

// MOMENTS_QUEUE_MODULE: step0.ts's mutation proof points this at a planted copy.
const Q = (await import(process.env.MOMENTS_QUEUE_MODULE ?? '../../../utils/offlineQueue')) as typeof import('../../../utils/offlineQueue');
const L = await import('../../../utils/syncLedger');
const B = await import('../../../utils/closeoutBinderEngine');
const copy = await import('../../../utils/moments/copy');
Q.configureAutoDrain(null);
const QKEY = 'mageid_offline_queue';
const queue = (): { table: string; operation: string; data: Record<string, unknown> }[] => JSON.parse(store.get(QKEY) ?? '[]');

function reset() {
  store.clear();
  calls.length = 0;
  toasts.length = 0;
  offline = false;
  script = async (c) => ({ error: null, status: 200, data: c.select ? [{ id: c.data.id ?? 'x' }] : null });
  setSession('u1');
  store.set('mageid_last_user_id', 'u1');
}
const ledgerLines = async () => (await L.readSyncFailuresOrThrow()).length;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // S3a synced
  reset();
  let r = await Q.supabaseWriteOnlineDetailed('field_tickets', 'update', { id: 't1', status: 'signed' });
  ok('S3 synced: the server answered with the row', r.status === 'synced' && calls.length === 1 && calls[0].select === 'id', { r, calls });
  ok('S3 synced: nothing queued, nothing ledgered, no toast', queue().length === 0 && (await ledgerLines()) === 0 && toasts.length === 0, { q: queue(), toasts });

  // S3b refused (server error with a body)
  reset();
  script = async () => ({ error: { message: 'new row violates row-level security policy', code: '42501' }, status: 403 });
  r = await Q.supabaseWriteOnlineDetailed('field_tickets', 'update', { id: 't1', status: 'signed' });
  ok('S3 refused: a server error is refused (code server)', r.status === 'refused' && r.code === 'server', r);
  ok('S3 refused: never enqueued, never ledgered, never toasted', queue().length === 0 && (await ledgerLines()) === 0 && toasts.length === 0, { q: queue(), toasts });

  // S3c unknown (transport after the request may have left)
  reset();
  script = async () => { throw new TypeError('Network request failed'); };
  r = await Q.supabaseWriteOnlineDetailed('field_tickets', 'update', { id: 't1', status: 'signed' });
  ok('S3 unknown: a transport error is unknown, and is NOT queued', r.status === 'unknown' && queue().length === 0 && toasts.length === 0, { r, q: queue() });
  reset();
  script = async () => ({ error: { message: 'Bad gateway' }, status: 503 });
  r = await Q.supabaseWriteOnlineDetailed('aia_pay_apps', 'upsert', { id: 'a1' });
  ok('S3 unknown: a 503 gateway answer is unknown (it may have landed)', r.status === 'unknown' && queue().length === 0, r);

  // S3d offline at the call
  reset();
  offline = true;
  r = await Q.supabaseWriteOnlineDetailed('field_tickets', 'insert', { id: 't2', project_id: 'p1' });
  ok('S3 offline at the call: refused (code offline) and nothing is sent', r.status === 'refused' && r.code === 'offline' && calls.length === 0, { r, calls });

  // S3e an update that matched no row
  reset();
  script = async (c) => ({ error: null, status: 200, data: c.select ? [] : null });
  r = await Q.supabaseWriteOnlineDetailed('project_contracts', 'update', { id: 'c1', status: 'sent' });
  ok('S3 an update that matched 0 rows is refused (code no_row), never synced', r.status === 'refused' && r.code === 'no_row', r);

  // S3f FIFO: a queued write of the same record that CANNOT be flushed -> refused, earlier change pending, not sent
  reset();
  store.set(QKEY, JSON.stringify([{ id: 'q1', table: 'field_tickets', operation: 'insert', data: { id: 't9', project_id: 'p1' }, timestamp: 1, retryCount: 0, userId: 'u1' }]));
  script = async (c) => (c.table === 'field_tickets' && c.op === 'insert'
    ? Promise.reject(new TypeError('Network request failed'))
    : { error: null, status: 200, data: c.select ? [{ id: c.data.id }] : null });
  r = await Q.supabaseWriteOnlineDetailed('field_tickets', 'update', { id: 't9', status: 'signed' });
  ok('S3 FIFO: a queued earlier write that will not flush -> refused earlier_change_pending with the constant sentence',
    r.status === 'refused' && r.code === 'earlier_change_pending' && r.message === copy.EARLIER_CHANGE_PENDING_REASON, r);
  ok('S3 FIFO: the flush was tried first, and the online write was never sent', calls.some((c) => c.op === 'insert') && !calls.some((c) => c.op === 'update'), calls);
  ok('S3 FIFO: the earlier queued write is still in the queue, untouched', queue().length === 1 && queue()[0].operation === 'insert', queue());

  // S3g FIFO: a queued write of the same record that DOES flush -> it goes first, then the online write
  reset();
  store.set(QKEY, JSON.stringify([{ id: 'q1', table: 'field_tickets', operation: 'insert', data: { id: 't9', project_id: 'p1' }, timestamp: 1, retryCount: 0, userId: 'u1' }]));
  r = await Q.supabaseWriteOnlineDetailed('field_tickets', 'update', { id: 't9', status: 'signed' });
  const order = calls.map((c) => c.op).join(',');
  ok('S3 FIFO: the queued create flushes first, then the online update lands', r.status === 'synced' && order === 'insert,update' && queue().length === 0, { r, order, q: queue() });

  // S3h FIFO: an in-flight direct write of the same record is waited for
  reset();
  let release!: () => void;
  const gate = new Promise<void>((res) => { release = res; });
  script = async (c) => {
    if (c.op === 'update' && c.data.note === 'first') await gate;
    return { error: null, status: 200, data: c.select ? [{ id: c.data.id }] : null };
  };
  const first = Q.supabaseWriteDetailed('field_tickets', 'update', { id: 't3', note: 'first' });
  const second = Q.supabaseWriteOnlineDetailed('field_tickets', 'update', { id: 't3', status: 'signed' });
  await sleep(20);
  const sentBeforeRelease = calls.filter((c) => c.data.status === 'signed').length;
  release();
  await first;
  const r2 = await second;
  const seq = calls.map((c) => (c.data.note ? 'direct' : 'online')).join(',');
  ok('S3 FIFO: an online write waits behind an in-flight direct write of the same record', sentBeforeRelease === 0 && seq === 'direct,online' && r2.status === 'synced', { sentBeforeRelease, seq, r2 });

  // S3i the Not-saved ledger: a refused earlier write of the record parks the online write
  reset();
  script = async (c) => (c.data.note === 'bad'
    ? { error: { message: 'value too long for type character varying(10)', code: '22001' }, status: 400 }
    : { error: null, status: 200, data: c.select ? [{ id: c.data.id }] : null });
  const refusedFirst = await Q.supabaseWriteDetailed('field_tickets', 'update', { id: 't4', note: 'bad' });
  const linesBefore = await ledgerLines();
  calls.length = 0;
  r = await Q.supabaseWriteOnlineDetailed('field_tickets', 'update', { id: 't4', status: 'signed' });
  ok('S3 an earlier write under Not saved -> refused earlier_change_unsaved, nothing sent',
    refusedFirst === 'failed' && linesBefore === 1 && r.status === 'refused' && r.code === 'earlier_change_unsaved' && r.message === copy.EARLIER_CHANGE_UNSAVED_REASON && calls.length === 0, { refusedFirst, linesBefore, r, calls });
  ok('S3 …and the online refusal adds no second Not-saved line', (await ledgerLines()) === 1, await ledgerLines());

  // S3j rpc returns its data
  reset();
  script = async (c) => (c.op === 'rpc' ? { error: null, status: 200, data: { recorded: true } } : { error: null, status: 200 });
  const rp = await Q.supabaseRpcOnline<{ recorded: boolean }>('portal_sign_contract', { p_token: 'x' });
  ok('S3 supabaseRpcOnline returns the rpc data on synced', rp.status === 'synced' && rp.data?.recorded === true, rp);
  reset();
  script = async () => ({ error: { message: 'contract_not_sent', code: 'P0001' }, status: 400 });
  const rp2 = await Q.supabaseRpcOnline('portal_sign_contract', { p_token: 'x' }, { record: { table: 'project_contracts', id: 'c1' } });
  ok('S3 supabaseRpcOnline: a refusal is refused with the server words, never queued', rp2.status === 'refused' && rp2.error === 'contract_not_sent' && queue().length === 0, rp2);

  // S3k a re-sent insert that meets its own row (the first attempt got no answer) is synced
  reset();
  script = async () => ({ error: { message: 'duplicate key value violates unique constraint "field_tickets_pkey"', code: '23505' }, status: 409 });
  r = await Q.supabaseWriteOnlineDetailed('field_tickets', 'insert', { id: 't5', project_id: 'p1' });
  ok('S3 a re-sent insert that meets its own row is synced (#122 rule)', r.status === 'synced', r);

  // S3l the plain string variant
  reset();
  const plain = await Q.supabaseWriteOnline('wip_periods', 'update', { id: 'w1', locked_at: 'now' });
  ok("S3 supabaseWriteOnline answers the bare status ('synced' | 'refused' | 'unknown')", plain === 'synced', plain);

  // S5 closeout binder
  reset();
  script = async (c) => ({ error: null, status: 201, data: [{ id: 'b1', project_id: 'p1', user_id: 'u1', status: c.data.status, maintenance_schedule: [], notes: '', created_at: 'x', updated_at: 'x', finalized_at: c.data.finalized_at }] });
  let b = await B.saveCloseoutBinderDetailed({ id: 'b1', projectId: 'p1', status: 'finalized', finalizedAt: '2026-09-28T12:00:00.000Z' });
  ok('S5 saveCloseoutBinderDetailed: stored -> { synced, row }', b.status === 'synced' && b.row.status === 'finalized' && calls[0]?.onConflict === 'id' && calls[0]?.select === '*', { b, calls });
  reset();
  script = async () => ({ error: { message: 'permission denied for table closeout_binders', code: '42501' }, status: 403 });
  b = await B.saveCloseoutBinderDetailed({ id: 'b1', projectId: 'p1', status: 'finalized' });
  ok('S5 saveCloseoutBinderDetailed: a server refusal -> { refused, error }', b.status === 'refused' && b.error.includes('permission denied'), b);
  reset();
  script = async () => { throw new TypeError('Network request failed'); };
  b = await B.saveCloseoutBinderDetailed({ id: 'b1', projectId: 'p1', status: 'finalized' });
  ok('S5 saveCloseoutBinderDetailed: a transport error -> { unknown }', b.status === 'unknown', b);
  reset();
  script = async () => ({ error: { message: 'upstream', code: '' }, status: 504 });
  b = await B.saveCloseoutBinderDetailed({ id: 'b1', projectId: 'p1', status: 'finalized' });
  ok('S5 saveCloseoutBinderDetailed: a 504 -> { unknown }', b.status === 'unknown', b);
  reset();
  offline = true;
  b = await B.saveCloseoutBinderDetailed({ id: 'b1', projectId: 'p1', status: 'finalized' });
  ok('S5 saveCloseoutBinderDetailed: offline at the call -> refused, nothing sent', b.status === 'refused' && calls.length === 0, { b, calls });
  reset();
  script = async () => ({ error: null, status: 201, data: [] });
  b = await B.saveCloseoutBinderDetailed({ id: 'b1', projectId: 'p1', status: 'finalized' });
  ok('S5 saveCloseoutBinderDetailed: no row back -> refused (never synced without the row)', b.status === 'refused', b);

  for (const x of results) console.log(JSON.stringify(x));
  process.exit(0);
}

main().catch((e) => { console.log(JSON.stringify({ name: 'fixture-io ran without throwing', pass: false, detail: String((e as Error)?.stack ?? e) })); process.exit(0); });
