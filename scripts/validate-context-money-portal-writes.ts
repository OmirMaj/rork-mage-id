// validate-context-money-portal-writes.ts — wave 3, lane context-money-portal.
//
// Runs the SHIPPED ProjectContext write paths (extracted from the source and
// executed against stubs) for the findings whose bug was a write one step
// behind, one column short, or one list stale:
//
//   #3/#46, #35, #45  a create followed by a send / edit in ONE handler read a
//        render-time list without the new record: "Item not found", or a stale
//        re-map that dropped it from his list. Every kind the portal send path
//        touches now reads (and moves) a latest-value ref.
//   #40  change_orders.audit_trail was written WHOLE from the device on every
//        edit, erasing the sealed e-signature entry the portal RPC appends on
//        the server. Edits now omit the column and APPEND through
//        co_append_audit (retried, never doubled); the realtime listener
//        re-reads on an audit-only change. The owed entries are on disk
//        before the UPDATE is queued and survive a kill; the loader keeps them
//        on screen and keeps the device copy of a CO written during a read.
//   #37  a portal approval (deferReflow) must not move the schedule: it writes
//        the "place these days" marker and says so in a notification.
//   #131 the frozen tax columns round-trip; a CO without them sends none.
//   #21  updateDailyReport wrote one column fewer than the insert — `date`.
//   #47  bill_to_email / bill_to_name round-trip.
//   #48  a re-read keeps the device copy of a row with a queued edit.
//   invoice-send-pay handoff: awaitInvoiceInsert.
//
// Run via: bun run scripts/validate-context-money-portal-writes.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  changeOrderTaxColumns, changeOrderTaxFromRow, chunkForAppend, coRealtimeShouldRefetch, dailyReportColumns,
  coAuditPendingFromStore, coIdsWrittenDuringRead, overlayPendingAudit,
  DAILY_REPORT_INSERT_ONLY, invoiceBillToColumns, invoiceBillToFromRow, mergeServerKeepingPending, newAuditEntries,
  CO_AUDIT_APPEND_MAX, classifyCoAuditError, coAuditRefusalIsFinal, withMarkedApproved, bearerTokenForRead,
} from '../utils/projectContextPure';
import {
  buildDeferredCoAuditEntry, buildUnanchoredCoAuditEntry, hasUnanchoredMarker, isCoScheduleReflowApplied, normalizeImpactDays,
} from '../utils/coScheduleReflowCore';
import { insertStillQueued } from '../utils/invoiceWrites';

declare const Bun: { Transpiler: new (opts: { loader: 'ts' }) => { transformSync: (code: string) => string } };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let passes = 0;
let failures = 0;
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { passes++; console.log('  ✓', label); }
  else { failures++; console.error('  ✗', label, detail ? `\n      ${detail}` : ''); }
}

// ─── harness: run one useCallback of the provider against a scope ────────────
// The callback's own text (arrow + deps) is transpiled and evaluated inside
// `with (scope)`: names the scope provides are used; any other non-global name
// resolves to a recording stub, so an unexpected dependency cannot crash the
// run — the assertions decide what matters.
type Scope = Record<string, unknown>;
export function extractCallback(src: string, name: string): string {
  const decl = `const ${name} = useCallback(`;
  const i = src.indexOf(decl);
  if (i < 0) throw new Error(`not found: ${decl}`);
  const open = i + decl.length;
  const rest = src.slice(open);
  // The callback closes with `}, [deps]);` (deps on one line or several) or,
  // for the 4-space style, `\n  );` — whichever comes FIRST is its end.
  const ends = [
    /\n {2}\}, \[[^\n]*\]\);/.exec(rest),
    /\n {2}\}, \[\n[\s\S]*?\n {2}\]\);/.exec(rest),
    /\n {2}\);/.exec(rest),
  ].filter((m): m is RegExpExecArray => !!m).sort((x, y) => x.index - y.index);
  if (!ends.length) throw new Error(`no end for ${name}`);
  const m = ends[0];
  // `}, [deps]);` keeps everything but the closing `);`; `\n  );` keeps nothing of it.
  return m[0].startsWith('\n  }') ? rest.slice(0, m.index + m[0].length - 2) : rest.slice(0, m.index);
}
export function runCallback<T>(src: string, name: string, scope: Scope, stubCalls: string[] = []): T {
  const text = extractCallback(src, name);
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(`var __r = __cb(${text});`);
  const full: Scope = { __cb: (fn: unknown) => fn, ...scope };
  const proxy = new Proxy(full, {
    has: (_t, k) => typeof k === 'string' && (k in full || !(k in globalThis)),
    get: (_t, k) => {
      if (typeof k !== 'string') return undefined;
      if (k in full) return full[k];
      return (..._args: unknown[]) => { stubCalls.push(k); return undefined; };
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function('__scope', `with (__scope) { ${js}\n return __r; }`)(proxy) as T;
}

const CTX = read('contexts/ProjectContext.tsx');
const NCTX = read('contexts/NotificationContext.tsx');

type Row = Record<string, unknown>;
type CO = {
  id: string; number: number; projectId: string; status: string; auditTrail?: { id: string; action: string; actor: string; timestamp: string; detail?: string }[];
  scheduleImpactDays?: number; scheduleImpactApplied?: boolean; updatedAt?: string; createdAt?: string;
  taxRatePct?: number; taxAmount?: number; totalWithTax?: number; priorApprovedChangesTotal?: number; [k: string]: unknown;
};

async function main() {
  // ── #35/#45: every kind the portal send path reads is its LATEST list ──────
  console.log('\n#35 #45 the portal send path reads and writes latest-value lists');
  {
    const kinds: [string, string, string][] = [
      ['change_order', 'changeOrdersRef', 'changeOrders'], ['invoice', 'invoicesRef', 'invoices'],
      ['aia_pay_app', 'aiaPayAppsRef', 'aiaPayApps'], ['rfi', 'rfisRef', 'rfis'], ['submittal', 'submittalsRef', 'submittals'],
      ['daily_report', 'dailyReportsRef', 'dailyReports'], ['photo', 'projectPhotosRef', 'projectPhotos'], ['warranty', 'warrantiesRef', 'warranties'],
    ];
    const scope: Scope = {};
    for (const [kind, ref, list] of kinds) {
      scope[ref] = { current: [{ id: `${kind}-old` }, { id: `${kind}-new` }] };
      scope[list] = [{ id: `${kind}-old` }]; // the render's list: the new item is not in it
    }
    const find = runCallback<(k: string, id: string) => unknown>(CTX, 'findItemByKindAndId', scope);
    const missed = kinds.filter(([kind]) => !find(kind, `${kind}-new`)).map(([k]) => k);
    ok('findItemByKindAndId finds an item created in the same handler, for every kind', missed.length === 0, `missed: ${missed.join(', ')}`);

    const committed: Record<string, { id: string; portalState?: unknown }[]> = {};
    const setter = (k: string) => (l: { id: string }[]) => { committed[k] = l; };
    const apply = runCallback<(e: { kind: string; itemId: string; next: unknown }[]) => void>(CTX, 'applyPortalStates', {
      ...scope,
      setChangeOrders: setter('change_order'), setInvoices: setter('invoice'), setAiaPayApps: setter('aia_pay_app'),
      setRfis: setter('rfi'), setSubmittals: setter('submittal'), setDailyReports: setter('daily_report'),
      setProjectPhotos: setter('photo'), persistWarranties: setter('warranty'),
      saveChangeOrdersMutation: { mutate: () => {} }, saveInvoicesMutation: { mutate: () => {} }, saveAiaPayAppsMutation: { mutate: () => {} },
      saveRfisMutation: { mutate: () => {} }, saveSubmittalsMutation: { mutate: () => {} }, saveDailyReportsMutation: { mutate: () => {} },
      savePhotosMutation: { mutate: () => {} },
    });
    apply(kinds.map(([kind]) => ({ kind, itemId: `${kind}-old`, next: { status: 'sent' } })));
    const dropped = kinds.filter(([kind]) => !(committed[kind] ?? []).some(i => i.id === `${kind}-new`)).map(([k]) => k);
    ok('applyPortalStates never drops an item added since the render (no stale re-map)', dropped.length === 0, `dropped: ${dropped.join(', ')}`);
    const stamped = kinds.filter(([kind]) => (committed[kind] ?? []).find(i => i.id === `${kind}-old`)?.portalState != null).length;
    ok('…and it stamps the item it was asked to', stamped === kinds.length);
    const refMoved = kinds.filter(([kind, ref]) => !((scope[ref] as { current: { id: string; portalState?: unknown }[] }).current.find(i => i.id === `${kind}-old`)?.portalState)).map(([k]) => k);
    ok('…and moves each ref in the same breath (a second send in the handler sees it)', refMoved.length === 0, `not moved: ${refMoved.join(', ')}`);
  }

  // A CO created and then edited / sent in one handler (Send & Save on a new CO).
  {
    const changeOrdersRef = { current: [] as CO[] };
    let state: CO[] = [];
    const scope: Scope = {
      changeOrdersRef, changeOrders: [] as CO[], // the render's list, stale on purpose
      setChangeOrders: (l: CO[]) => { state = l; }, saveChangeOrdersMutation: { mutate: () => {} },
      canSync: false, userId: 'u1', initialPortalState: () => ({ status: 'draft' }),
      isCoScheduleReflowApplied, hasUnanchoredMarker, normalizeImpactDays, buildDeferredCoAuditEntry, buildUnanchoredCoAuditEntry,
      projects: [], projectsRef: { current: [] }, user: { email: 'gc@x.com' },
    };
    const add = runCallback<(cos: CO[]) => Promise<string>>(CTX, 'addChangeOrders', scope);
    const upd = runCallback<(id: string, u: Partial<CO>) => Promise<string>>(CTX, 'updateChangeOrder', scope);
    await add([{ id: 'co-new', number: 3, projectId: 'p1', status: 'draft' }]);
    await upd('co-new', { status: 'submitted' });
    ok('a CO added then edited in one handler stays on his list, with the edit', state.length === 1 && state[0].status === 'submitted', JSON.stringify(state));
  }

  // ── #40: audit_trail is appended, never written whole ──────────────────────
  console.log('\n#40 the CO audit trail is append-only from the device');
  {
    const a = { id: 'a', action: 'created', actor: 'gc', timestamp: 't1' };
    const seal = { id: 'seal', action: 'client_signed_via_portal', actor: 'client', timestamp: 't2' };
    const b = { id: 'b', action: 'status_approved', actor: 'gc', timestamp: 't3' };
    ok('newAuditEntries: only entries the old trail did not hold', JSON.stringify(newAuditEntries([a], [a, b]).map(e => e.id)) === '["b"]');
    ok('newAuditEntries: an id-less or repeated entry is never sent', newAuditEntries([], [a, { ...a }, { action: 'x' } as unknown as typeof a]).length === 1);
    ok('chunkForAppend: batches of at most the RPC\'s cap, order kept',
      chunkForAppend(Array.from({ length: 120 }, (_, i) => i)).map(c => c.length).join() === `${CO_AUDIT_APPEND_MAX},${CO_AUDIT_APPEND_MAX},20`);
    ok('realtime: an audit-only server append re-reads the list', coRealtimeShouldRefetch({ id: 'c', status: 'sent', audit_trail: [a, seal] }, { id: 'c', status: 'sent', audit_trail: [a] }));
    ok('realtime: default replica identity (old = key only) re-reads', coRealtimeShouldRefetch({ id: 'c', status: 'sent', updated_at: 'x' }, { id: 'c' }));
    ok('realtime: an identical row does not', !coRealtimeShouldRefetch({ id: 'c', status: 'sent', updated_at: 'x', audit_trail: [a] }, { id: 'c', status: 'sent', updated_at: 'x', audit_trail: [a] }));
    ok('NotificationContext re-reads change orders through coRealtimeShouldRefetch (not a status-only test)',
      /if \(coRealtimeShouldRefetch\(r, oldR\)\) \{[\s\S]{0,400}invalidateQueries\(\{ queryKey: \['changeOrders'\] \}\)/.test(NCTX)
        && !/table: 'change_orders' \},\s*\(payload\) => \{[^}]*if \(r\.status !== oldR\.status\) \{/.test(NCTX));

    const row = runCallback<(co: CO) => Row>(CTX, 'changeOrderToRow', {})({ id: 'c1', number: 1, projectId: 'p1', status: 'sent', auditTrail: [a], taxRatePct: 8.25, taxAmount: 412.5, totalWithTax: 5412.5 });
    ok('changeOrderToRow (the UPDATE row) carries no audit_trail', !('audit_trail' in row), Object.keys(row).join());

    // The whole updateChangeOrder, online, against a server that already holds
    // the client's seal (appended by the portal RPC after this session loaded).
    const server = new Map<string, Row>([['c1', { id: 'c1', audit_trail: [a, seal], status: 'sent' }]]);
    const rpcCalls: { id: string; entries: { id: string }[] }[] = [];
    let rpcMode: 'ok' | 'network' | 'denied' = 'ok';
    const supabase = {
      rpc: async (fn: string, args: { p_co_id: string; p_entries: { id: string }[] }) => {
        if (fn !== 'co_append_audit') throw new Error(`unexpected rpc ${fn}`);
        rpcCalls.push({ id: args.p_co_id, entries: args.p_entries });
        if (rpcMode === 'network') throw new Error('Network request failed');
        if (rpcMode === 'denied') return { data: null, error: { message: 'co_denied', code: '42501' } };
        const r = server.get(args.p_co_id)!;
        const trail = (r.audit_trail as { id: string }[]);
        const have = new Set(trail.map(e => e.id));
        server.set(args.p_co_id, { ...r, audit_trail: [...trail, ...args.p_entries.filter(e => !have.has(e.id))] });
        return { data: { ok: true }, error: null };
      },
    };
    const writes: { table: string; op: string; data: Row }[] = [];
    const changeOrdersRef = { current: [{ id: 'c1', number: 1, projectId: 'p1', status: 'sent', auditTrail: [a] }] as CO[] };
    const pendingCoAuditRef = { current: new Map<string, { id: string }[]>() };
    // wave 4 #40: a refusal is final only for a live bearer and a CO known to
    // be on the server — this harness is that signed-in session, so the
    // "not his CO" case below still exercises the final path.
    const liveSession = { access_token: 'tok', expires_at: Math.floor(Date.now() / 1000) + 3600 };
    Object.assign(supabase, { auth: { getSession: async () => ({ data: { session: liveSession } }) } });
    let markSeq = 0;
    const scope: Scope = {
      supabase, changeOrdersRef, pendingCoAuditRef, newAuditEntries, chunkForAppend,
      classifyCoAuditError, coAuditRefusalIsFinal, withMarkedApproved, bearerTokenForRead,
      bearerStillLive: async () => true, queuedIdsFor: async () => new Set<string>(), unsavedWriteIds: async () => new Set<string>(), generateUUID: () => `mark${++markSeq}`,
      setChangeOrders: () => {}, saveChangeOrdersMutation: { mutate: () => {} },
      isCoScheduleReflowApplied, hasUnanchoredMarker, normalizeImpactDays, buildDeferredCoAuditEntry, buildUnanchoredCoAuditEntry,
      applyCoScheduleReflow: () => ({ plan: { status: 'no_impact', message: '' } }),
      projects: [], projectsRef: { current: [] }, user: { email: 'gc@x.com' }, canSync: true, userId: 'u1',
      changeOrderInsertsRef: { current: new Map() }, insertStillQueued, getOfflineQueue: async () => [],
      addToOfflineQueue: async () => {},
      supabaseWriteDetailed: async (table: string, op: string, data: Row) => {
        writes.push({ table, op, data });
        const r = server.get(data.id as string);
        if (r && op === 'update') server.set(data.id as string, { ...r, ...data });
        return 'synced';
      },
    };
    scope.changeOrderToRow = runCallback(CTX, 'changeOrderToRow', scope);
    scope.stashCoAudit = runCallback(CTX, 'stashCoAudit', scope);
    scope.appendCoAudit = runCallback(CTX, 'appendCoAudit', scope);
    const upd = runCallback<(id: string, u: Partial<CO>, r?: unknown) => Promise<string>>(CTX, 'updateChangeOrder', scope);
    await upd('c1', { status: 'approved', auditTrail: [a, b] });
    await new Promise(r => setTimeout(r, 5));
    const fullTrail = server.get('c1')!.audit_trail as { id: string; action: string; actor: string }[];
    // wave 4 #79: the GC's own approval also appends a 'marked_approved' entry
    // (checked on its own below); the seal/own-entry checks ignore it.
    const trail = fullTrail.filter(e => e.action !== 'marked_approved').map(e => e.id);
    ok('an edit from a session loaded before the signature keeps the server\'s seal entry', trail.includes('seal'), trail.join());
    ok('…and its own new entry is appended', trail.join() === 'a,seal,b', trail.join());
    ok('…the UPDATE payload never carries audit_trail', writes.every(w => !('audit_trail' in w.data)));
    ok('…and only the NEW entries went to co_append_audit (its own + the approval mark)',
      rpcCalls.length === 1 && rpcCalls[0].entries.map(e => e.id).join() === 'b,mark1', JSON.stringify(rpcCalls));
    const mark = fullTrail.find(e => e.action === 'marked_approved');
    ok('#79 a non-portal approval appends marked_approved with the GC as actor', !!mark && mark.actor === 'gc@x.com', JSON.stringify(mark));

    // An append that could not go out waits, and goes with the next attempt.
    rpcMode = 'network';
    changeOrdersRef.current = [{ ...changeOrdersRef.current[0], auditTrail: [a, b] }];
    const c = { id: 'c', action: 'note', actor: 'gc', timestamp: 't4' };
    await upd('c1', { auditTrail: [a, b, c] });
    await new Promise(r => setTimeout(r, 5));
    ok('a failed append is kept pending (not lost)', pendingCoAuditRef.current.get('c1')?.map(e => e.id).join() === 'c');
    rpcMode = 'ok';
    await (scope.appendCoAudit as (id: string, e: unknown[]) => Promise<void>)('c1', []);
    ok('…and the retry lands it exactly once', (server.get('c1')!.audit_trail as { id: string }[]).map(e => e.id).join() === 'a,seal,b,mark1,c' && !pendingCoAuditRef.current.has('c1'));
    rpcMode = 'denied';
    await (scope.appendCoAudit as (id: string, e: unknown[]) => Promise<void>)('c1', [{ id: 'd', action: 'x', actor: 'y', timestamp: 'z' }]);
    ok('a refusal (not his CO) is final — nothing retries forever', !pendingCoAuditRef.current.has('c1'));
    ok('the change_orders flush retries pending appends', /onQueueFlushed\(\(tables\) => \{\s*if \(!tables\.has\('change_orders'\)\) return;\s*void retryPendingCoAudit\(\);/.test(CTX));

    // ── #40 review round: the owed entries survive the app being killed ──────
    // Offline edit → UPDATE queued → app killed → relaunch → queue flushes →
    // the entries must still reach co_append_audit.
    {
      const disk = new Map<string, string>();
      const order: string[] = [];
      const saveLocal = async (k: string, v: unknown) => { order.push(`disk:${k}`); disk.set(k, JSON.stringify(v)); };
      const loadLocal = async (k: string, fb: unknown) => (disk.has(k) ? JSON.parse(disk.get(k)!) : fb);
      const rpc: { id: string; entries: { id: string }[] }[] = [];
      const serverTrail = new Map<string, { id: string }[]>([['c7', [a]]]);
      const supabase2 = {
        rpc: async (_fn: string, args: { p_co_id: string; p_entries: { id: string }[] }) => {
          rpc.push({ id: args.p_co_id, entries: args.p_entries });
          const t = serverTrail.get(args.p_co_id)!;
          const have = new Set(t.map(e => e.id));
          serverTrail.set(args.p_co_id, [...t, ...args.p_entries.filter(e => !have.has(e.id))]);
          return { data: { ok: true }, error: null };
        },
      };
      let queue: { table: string; operation: string; data: Row }[] = [];
      const mkProvider = () => {
        const sc: Scope = {
          supabase: supabase2, newAuditEntries, chunkForAppend, saveLocal, loadLocal, CO_AUDIT_PENDING_KEY: 'mageid_co_audit_pending',
          pendingCoAuditRef: { current: new Map() }, coAuditLoadRef: { current: Promise.resolve() }, coAuditOwnerRef: { current: 'u1' },
          coAuditPersistChainRef: { current: Promise.resolve() }, coWriteTouchRef: { current: new Map() },
          changeOrdersRef: { current: [{ id: 'c7', number: 7, projectId: 'p1', status: 'sent', auditTrail: [a] }] as CO[] },
          setChangeOrders: () => {}, saveChangeOrdersMutation: { mutate: () => {} },
          isCoScheduleReflowApplied, hasUnanchoredMarker, normalizeImpactDays, buildDeferredCoAuditEntry, buildUnanchoredCoAuditEntry,
          applyCoScheduleReflow: () => ({ plan: { status: 'no_impact', message: '' } }),
          projects: [], projectsRef: { current: [] }, user: { email: 'gc@x.com' }, canSync: true, userId: 'u1',
          changeOrderInsertsRef: { current: new Map() }, getOfflineQueue: async () => queue,
          classifyCoAuditError, coAuditRefusalIsFinal, withMarkedApproved, bearerTokenForRead,
          bearerStillLive: async () => true, generateUUID: () => 'mark7',
          // The CO's INSERT is still queued (made offline), so the edit's UPDATE queues behind it.
          insertStillQueued: () => true,
          addToOfflineQueue: async (e: { table: string; operation: string; data: Row }) => { order.push('queue:update'); queue.push(e); },
          supabaseWriteDetailed: async () => 'synced',
          queuedIdsFor: async (t: string) => new Set(queue.filter(e => e.table === t).map(e => e.data.id as string)),
          unsavedWriteIds: async () => new Set<string>(),
        };
        sc.changeOrderToRow = runCallback(CTX, 'changeOrderToRow', sc);
        sc.beginCoWrite = runCallback(CTX, 'beginCoWrite', sc);
        sc.endCoWrite = runCallback(CTX, 'endCoWrite', sc);
        sc.persistCoAuditPending = runCallback(CTX, 'persistCoAuditPending', sc);
        sc.stashCoAudit = runCallback(CTX, 'stashCoAudit', sc);
        sc.appendCoAudit = runCallback(CTX, 'appendCoAudit', sc);
        sc.retryPendingCoAudit = runCallback(CTX, 'retryPendingCoAudit', sc);
        return sc;
      };
      const sig = { id: 'sig', action: 'client_signed_via_portal', actor: 'client', timestamp: 't9', detail: 'in person' };
      const p1 = mkProvider();
      const upd7 = runCallback<(id: string, u: Partial<CO>) => Promise<string>>(CTX, 'updateChangeOrder', p1);
      const out = await upd7('c7', { status: 'approved', auditTrail: [a, sig] });
      ok('offline edit: the UPDATE is queued', out === 'queued' && queue.length === 1);
      ok('…and the owed entry is on DISK before the UPDATE is queued',
        order.indexOf('disk:mageid_co_audit_pending') >= 0 && order.indexOf('disk:mageid_co_audit_pending') < order.indexOf('queue:update'), order.join());
      ok('…and no append went out ahead of the queued insert', rpc.length === 0);
      // KILL. A new provider starts from disk only.
      const p2 = mkProvider();
      const restored = coAuditPendingFromStore<{ id: string }>(await loadLocal('mageid_co_audit_pending', null), 'u1');
      ok('relaunch: the owed entry is read back for this account', restored.get('c7')?.map(e => e.id).join() === 'sig,mark7');
      ok('…and never for another account', coAuditPendingFromStore(await loadLocal('mageid_co_audit_pending', null), 'u2').size === 0);
      (p2.pendingCoAuditRef as { current: Map<string, unknown> }).current = restored;
      await (p2.retryPendingCoAudit as () => Promise<void>)();
      await new Promise(r => setTimeout(r, 5));
      ok('while the CO\'s writes are still queued, nothing is appended (a missing row is a final co_denied)', rpc.length === 0);
      queue = []; // the flush lands the insert and the update
      await (p2.retryPendingCoAudit as () => Promise<void>)();
      await new Promise(r => setTimeout(r, 5));
      // (+ wave 4 #79's 'marked_approved' — the GC recorded the in-person signature himself)
      ok('after the flush the signature entry reaches co_append_audit', rpc.length === 1 && rpc[0].entries.map(e => e.id).join() === 'sig,mark7'
        && serverTrail.get('c7')!.map(e => e.id).join() === 'a,sig,mark7', JSON.stringify(rpc));
      ok('…and the disk copy is cleared once it landed', coAuditPendingFromStore(await loadLocal('mageid_co_audit_pending', null), 'u1').size === 0);
      ok('the account effect reads the store back through coAuditPendingFromStore and retries it',
        /coAuditPendingFromStore<COAuditEntry>\(await loadLocal<unknown>\(CO_AUDIT_PENDING_KEY, null\), owner\)/.test(CTX)
          && /void coAuditLoadRef\.current\.then\(\(\) => retryPendingCoAuditRef\.current\(\)\);\n  \}, \[userId\]\);/.test(CTX));
      ok('the key carries an app prefix (the tenant sweep reaches it)', /const CO_AUDIT_PENDING_KEY = 'mageid_co_audit_pending';/.test(CTX));

      // The loader keeps the owed entries on screen, and the device copy of a CO
      // this device wrote while the read was out.
      const shown = overlayPendingAudit([{ id: 'c7', auditTrail: [a] }, { id: 'c8', auditTrail: [a] }], new Map([['c7', [sig, a]]]));
      ok('overlayPendingAudit: owed entries laid back on, server order first, never doubled',
        shown[0].auditTrail!.map(e => e.id).join() === 'a,sig' && shown[1].auditTrail!.map(e => e.id).join() === 'a');
      const touches = new Map([['w', { inFlight: 1, settledAt: 0 }], ['late', { inFlight: 0, settledAt: 200 }], ['early', { inFlight: 0, settledAt: 50 }]]);
      ok('coIdsWrittenDuringRead: on the wire, or settled after the read went out — not before',
        [...coIdsWrittenDuringRead(touches, 100)].sort().join() === 'late,w');
      ok('the change_orders loader keeps those device copies and overlays the owed entries',
        /const keepDevice = new Set\(\[\.\.\.await queuedIdsFor\('change_orders'\), \.\.\.await unsavedWriteIds\('change_orders'\), \.\.\.coIdsWrittenDuringRead\(coWriteTouchRef\.current, coReadStartedAt\)\]\);/.test(CTX)
          && /const kept = mergeServerKeepingPending\(mapped, await loadLocal<ChangeOrder\[\]>\(CHANGE_ORDERS_KEY, \[\]\), keepDevice(, \{ deletedIds: await queuedDeletesFor\('change_orders'\) \})?\);/.test(CTX)
          && /const merged = overlayPendingAudit\(kept, pendingCoAuditRef\.current\);/.test(CTX)
          && CTX.indexOf('const coReadStartedAt = Date.now();') < CTX.indexOf("await supabase.from('change_orders').select('*')"));
      ok('updateChangeOrder counts its write as in flight until it settles',
        /beginCoWrite\(id\);\s*const outcome = await \(async/.test(extractCallback(CTX, 'updateChangeOrder'))
          && /\}\)\(\)\.finally\(\(\) => endCoWrite\(id\)\);/.test(extractCallback(CTX, 'updateChangeOrder')));
    }
    const addBody = extractCallback(CTX, 'addChangeOrders');
    ok('the INSERT still writes the CO\'s first entries (its only whole write of the trail)', /audit_trail: finalCo\.auditTrail,/.test(addBody));
  }

  // ── #37: a portal approval never moves the schedule behind his back ───────
  console.log('\n#37 deferReflow places a marker and tells him; nothing moves');
  {
    let state: CO[] = [];
    const calls: string[] = [];
    const notes: unknown[][] = [];
    const scope: Scope = {
      changeOrdersRef: { current: [{ id: 'c1', number: 4, projectId: 'p1', status: 'sent', scheduleImpactDays: 5, auditTrail: [] }] as CO[] },
      setChangeOrders: (l: CO[]) => { state = l; }, saveChangeOrdersMutation: { mutate: () => {} },
      isCoScheduleReflowApplied, hasUnanchoredMarker, normalizeImpactDays, buildDeferredCoAuditEntry, buildUnanchoredCoAuditEntry,
      applyCoScheduleReflow: () => { calls.push('reflow'); return { plan: { status: 'ready' } }; },
      sendLocalNotification: async (...a: unknown[]) => { notes.push(a); },
      projects: [{ id: 'p1', schedule: { tasks: [] } }], projectsRef: { current: [] }, user: { email: 'gc@x.com' }, canSync: false,
    };
    const upd = runCallback<(id: string, u: Partial<CO>, r?: unknown) => Promise<string>>(CTX, 'updateChangeOrder', scope);
    await upd('c1', { status: 'approved' }, { deferReflow: true });
    ok('the reflow is not run', !calls.includes('reflow'));
    ok('the "place these days" marker is written once', hasUnanchoredMarker(state[0] as never) && (state[0].auditTrail ?? []).length === 1);
    ok('scheduleImpactApplied stays false (the CO screen\'s apply path places them)', !state[0].scheduleImpactApplied);
    ok('…and he is told, with a tap that opens the CO', notes.length === 1 && JSON.stringify(notes[0][2]) === JSON.stringify({ changeOrderId: 'c1', projectId: 'p1' }));
    await upd('c1', { status: 'approved' }, { deferReflow: true });
    ok('a second pass adds no second marker and no second notification', (state[0].auditTrail ?? []).length === 1 && notes.length === 1);
    // CONTROL: the same approval without deferReflow does reach the reflow.
    scope.changeOrdersRef = { current: [{ id: 'c2', number: 5, projectId: 'p1', status: 'sent', scheduleImpactDays: 5, auditTrail: [] }] };
    const upd2 = runCallback<(id: string, u: Partial<CO>, r?: unknown) => Promise<string>>(CTX, 'updateChangeOrder', scope);
    await upd2('c2', { status: 'approved' });
    ok('control: the GC\'s own approve still runs the reflow', calls.includes('reflow'));
  }

  // ── #131: frozen tax round-trips ───────────────────────────────────────────
  console.log('\n#131 the frozen CO tax columns');
  {
    const cols = changeOrderTaxColumns({ taxRatePct: 8.25, taxAmount: 412.5, totalWithTax: 5412.5, priorApprovedChangesTotal: 1200 });
    ok('all four columns written when held', JSON.stringify(cols) === JSON.stringify({ tax_rate_pct: 8.25, tax_amount: 412.5, total_with_tax: 5412.5, prior_approved_changes_total: 1200 }));
    ok('a CO without them sends none (an older row is never blanked)', Object.keys(changeOrderTaxColumns({})).length === 0);
    ok('null clears', changeOrderTaxColumns({ taxRatePct: null }).tax_rate_pct === null);
    const back = changeOrderTaxFromRow({ tax_rate_pct: '8.25', tax_amount: '412.50', total_with_tax: '5412.50', prior_approved_changes_total: null });
    ok('read back from PostgREST strings; a null column stays absent (never $0.00)',
      back.taxRatePct === 8.25 && back.taxAmount === 412.5 && back.totalWithTax === 5412.5 && !('priorApprovedChangesTotal' in back));
    ok('the loader maps them and changeOrderToRow writes them', /\.\.\.changeOrderTaxFromRow\(r\),/.test(CTX) && /\.\.\.changeOrderTaxColumns\(co\),/.test(extractCallback(CTX, 'changeOrderToRow')));
  }

  // ── #21: an edit writes every column a create does ────────────────────────
  console.log('\n#21 updateDailyReport writes the columns the insert writes');
  {
    const inserts: Row[] = []; const updates: Row[] = [];
    const dailyReportsRef = { current: [] as Row[] };
    const scope: Scope = {
      dailyReportsRef, dailyReportColumns, dfrPhotoRows: (p: unknown) => p ?? [],
      stageDfrPhotos: (r: unknown) => r, initialPortalState: () => ({ status: 'draft' }),
      setDailyReports: () => {}, saveDailyReportsMutation: { mutate: () => {} }, propagateProgressFromDFR: () => {},
      canSync: true, userId: 'u1',
      supabaseWrite: async (_t: string, op: string, d: Row) => { (op === 'insert' ? inserts : updates).push(d); return true; },
      // data-session critic round 2: DFR writes are tracked (a foreground
      // re-read keeps a report still on the wire) — the tracker just sends.
      proDocWriteTouchRef: { current: new Map() },
      touchedWrite: (_ref: unknown, _id: string, send: () => Promise<unknown>) => send(),
    };
    const add = runCallback<(r: Row) => void>(CTX, 'addDailyReport', scope);
    const upd = runCallback<(id: string, u: Row) => void>(CTX, 'updateDailyReport', scope);
    add({ id: 'd1', projectId: 'p1', date: '2026-09-14', weather: {}, manpower: [], workPerformed: 'x', materialsDelivered: [], issuesAndDelays: '', photos: [], status: 'draft', createdAt: 'c', updatedAt: 'u' });
    upd('d1', { date: '2026-09-18' });
    const insertKeys = Object.keys(inserts[0] ?? {}).filter(k => !(DAILY_REPORT_INSERT_ONLY as readonly string[]).includes(k));
    const missing = insertKeys.filter(k => !(k in (updates[0] ?? {})));
    ok('every insert column except the create-only ones is in the update', missing.length === 0, `missing: ${missing.join(', ')}`);
    ok('…including the re-dated day, in the insert\'s own form', updates[0]?.date === '2026-09-18', String(updates[0]?.date));
    ok('portal_state stays the send / recall path\'s (not echoed by an edit)', !('portal_state' in (updates[0] ?? {})));
  }

  // ── #47: bill-to ───────────────────────────────────────────────────────────
  console.log('\n#47 the invoice billing recipient');
  {
    ok('insert: present only when named', JSON.stringify(invoiceBillToColumns({ billToEmail: ' ap@owner.com ', billToName: '' }, null)) === JSON.stringify({ bill_to_email: 'ap@owner.com' })
      && Object.keys(invoiceBillToColumns({}, null)).length === 0);
    ok('update: only the keys the edit named; a blank clears to null',
      JSON.stringify(invoiceBillToColumns({ billToEmail: 'a@b.co' }, { billToEmail: 'a@b.co' })) === JSON.stringify({ bill_to_email: 'a@b.co' })
        && invoiceBillToColumns({ billToEmail: '  ' }, { billToEmail: '  ' }).bill_to_email === null
        && Object.keys(invoiceBillToColumns({ billToEmail: 'a@b.co' }, { notes: 'x' } as never)).length === 0);
    ok('read back', JSON.stringify(invoiceBillToFromRow({ bill_to_email: 'ap@owner.com', bill_to_name: 'AP desk' })) === JSON.stringify({ billToEmail: 'ap@owner.com', billToName: 'AP desk' })
      && Object.keys(invoiceBillToFromRow({ bill_to_email: null })).length === 0);
    const upd = extractCallback(CTX, 'updateInvoice');
    const addI = extractCallback(CTX, 'addInvoice');
    ok('updateInvoice, addInvoice and the loader all carry them',
      /Object\.assign\(payload, invoiceBillToColumns\(inv, updates\)\);/.test(upd) && /\.\.\.invoiceBillToColumns\(finalInvoice, null\),/.test(addI) && /\.\.\.invoiceBillToFromRow\(r\),/.test(CTX));
  }

  // ── #48: a re-read never beats a queued edit ───────────────────────────────
  console.log('\n#48 re-reading keeps the device copy of a row with a queued edit');
  {
    const server = [{ id: 'i1', amountPaid: 0 }, { id: 'i2', amountPaid: 100 }];
    const local = [{ id: 'i1', amountPaid: 5000 }, { id: 'i2', amountPaid: 0 }, { id: 'i3', amountPaid: 0 }];
    const merged = mergeServerKeepingPending(server, local, new Set(['i1', 'i3']));
    ok('queued edit → device copy; no queued write → server (a Stripe payment arrives)', merged.find(r => r.id === 'i1')?.amountPaid === 5000 && merged.find(r => r.id === 'i2')?.amountPaid === 100);
    ok('a queued create the server lacks is kept', merged.some(r => r.id === 'i3') && merged.length === 3);
    // Wave 4 #5: the device copy is read once into prior* (it also feeds the
    // written-during-read keep set).
    ok('the invoices and pay-app loaders use it',
      /const priorInvoices = await loadLocal<Invoice\[\]>\(INVOICES_KEY, \[\]\);[\s\S]{0,600}mergeServerKeepingPending\(mapped, priorInvoices,/.test(CTX)
      && /const priorAia = await loadLocal<SavedAIAPayApp\[\]>\(AIA_PAY_APPS_KEY, \[\]\);[\s\S]{0,300}mergeServerKeepingPending\(mapped, priorAia,/.test(CTX));
  }

  // ── awaitInvoiceInsert ─────────────────────────────────────────────────────
  console.log('\ninvoice-send-pay handoff: awaitInvoiceInsert');
  {
    let resolve!: (o: string) => void;
    const p = new Promise<string>(r => { resolve = r; });
    const invoiceInsertsRef = { current: new Map([['i1', p]]) };
    const invoiceInsertOutcomesRef = { current: new Map([['i0', 'failed']]) };
    const fn = runCallback<(id: string) => Promise<string | undefined>>(CTX, 'awaitInvoiceInsert', { invoiceInsertsRef, invoiceInsertOutcomesRef });
    const waiting = fn('i1');
    resolve('queued');
    ok('waits for an insert still out', (await waiting) === 'queued');
    ok('answers from the recorded outcome after it reported', (await fn('i0')) === 'failed');
    ok('undefined for an invoice this session never inserted', (await fn('zz')) === undefined);
    ok('addInvoice records each outcome', /invoiceInsertOutcomesRef\.current\.set\(finalInvoice\.id, o\)/.test(extractCallback(CTX, 'addInvoice')));
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

// Run only as a script: validate-context-money-portal-access.ts imports the
// harness above.
if ((import.meta as unknown as { main?: boolean }).main) void main().catch((e) => { console.error(e); process.exit(1); });
