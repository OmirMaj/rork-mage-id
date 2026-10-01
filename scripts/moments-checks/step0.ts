// step0.ts: moments Step 0 (lane MOMSTEP0), items 0.1-0.3, 0.5 and 0.6.
//
// Loaded by scripts/validate-moments.ts.
//
//   0.1  test:moments is registered and in ship-check.
//   0.2  hooks/useOnline.ts: useOffline() over react-query's onlineManager, isOfflineNow().
//   0.3  the REAL online-only writes (utils/offlineQueue supabaseWriteOnline /
//        supabaseRpcOnline) against stubs, in their own bun process
//        (step0/fixture-io.ts): synced / refused / unknown / offline / no_row,
//        never queued / ledgered / toasted, FIFO behind a queued or in-flight
//        write of the same record, the Not-saved park, rpc data. Mutation
//        proof: the offline refusal and the FIFO refusal planted away go red.
//   0.5  the honest data-layer calls, their SHIPPED text executed against a
//        scope (step0/harness.ts): approveChangeOrder (failed -> nothing
//        local; synced -> approved, the reflow exactly once; the idempotent
//        reflow marker respected on a second approve), closeProjectDetailed,
//        signFieldTicket, saveAIAPayAppOnline, clockOutDetailed /
//        closeTeamShiftDetailed (+ the extracted maths), lockPeriodDetailed,
//        contractStatusPatch / setContractStatusDetailed, and the binder
//        save (in the fixture). The old functions stay.
//   0.6  whole-sentence outcome copy in runCommit (and byte-identical English
//        fallbacks), offlineLegalReason(kind), onLateResult / onCommitStart /
//        onUncommit / above / isNeutral plumbing, the runner's discovery.
//        Mutation proof on scratch copies.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { MomentsCtx } from '../validate-moments';
import { runCallback, runFunction, type Scope } from './step0/harness';
import * as commitReal from '../../utils/moments/commitResult';
import { breakMinutesAt, computeShiftHours } from '../../utils/timeClockPayroll';
import {
  applyCoScheduleReflow, buildDeferredCoAuditEntry, buildUnanchoredCoAuditEntry, hasUnanchoredMarker, isCoScheduleReflowApplied, normalizeImpactDays,
} from '../../utils/coScheduleReflowCore';
import { newAuditEntries, withMarkedApproved } from '../../utils/projectContextPure';
import { insertStillQueued } from '../../utils/invoiceWrites';
import { sealedFieldTicketViolations } from '../../utils/fieldTicketCore';

declare const Bun: { spawnSync: (cmd: string[], opts?: { cwd?: string; env?: Record<string, string | undefined>; stdout?: 'pipe'; stderr?: 'pipe' }) => { stdout: Uint8Array; exitCode: number | null } };

type Fails = string[];
type CommitMod = typeof commitReal;
type Row = Record<string, unknown>;
const tick = () => new Promise((r) => setTimeout(r, 0));

// ─────────────────────────────────────────────────────────────────────────────
// 0.6 runCommit's whole-sentence copy
// ─────────────────────────────────────────────────────────────────────────────

async function checkCommitCopy(m: CommitMod): Promise<Fails> {
  const f: Fails = [];
  const copy = {
    refused: 'No aprobada. Algo falló de nuestro lado.',
    timeout: 'Todavía sin respuesta. Revisa la OC 4 antes de volver a intentar.',
    legalQueued: 'Not certified. Certifying needs a connection, so nothing was certified.',
    transport: 'Not recorded. The connection dropped, so nothing was saved.',
  };
  const base = { idempotent: false, subject: 'CO #4', verb: 'approved' };
  const J = (x: unknown) => JSON.stringify(x);
  let r = await m.runCommit(async () => ({ status: 'refused' } as never), { ...base, copy });
  if (r.status !== 'refused' || r.reason !== copy.refused) f.push(`copy.refused not used for a reason-less refusal: ${J(r)}`);
  r = await m.runCommit(async () => { throw new Error('new row violates check constraint'); }, { ...base, copy });
  if (r.status !== 'refused' || r.reason !== copy.refused) f.push(`copy.refused not used for a non-transport throw: ${J(r)}`);
  r = await m.runCommit(async () => ({ nonsense: true } as never), { ...base, copy });
  if (r.status !== 'refused' || r.reason !== copy.refused) f.push(`copy.refused not used for a malformed answer: ${J(r)}`);
  r = await m.runCommit(() => new Promise<never>(() => {}), { ...base, copy, timeoutMs: 15 });
  if (r.status !== 'timeout' || r.message !== copy.timeout) f.push(`copy.timeout not used on the timer: ${J(r)}`);
  r = await m.runCommit(async () => { throw new TypeError('Network request failed'); }, { ...base, copy });
  if (r.status !== 'timeout' || r.message !== copy.timeout) f.push(`copy.timeout not used on a non-idempotent transport drop: ${J(r)}`);
  r = await m.runCommit(async () => ({ status: 'timeout' } as never), { ...base, copy });
  if (r.status !== 'timeout' || r.message !== copy.timeout) f.push(`copy.timeout not used for a message-less timeout: ${J(r)}`);
  r = await m.runCommit(async () => ({ status: 'queued' }), { ...base, legal: true, copy });
  if (r.status !== 'refused' || r.reason !== copy.legalQueued) f.push(`copy.legalQueued not used: ${J(r)}`);
  r = await m.runCommit(async () => { throw new TypeError('Failed to fetch'); }, { ...base, idempotent: true, copy });
  if (r.status !== 'refused' || r.reason !== copy.transport) f.push(`copy.transport not used: ${J(r)}`);
  // The site's own reason always wins over copy.refused.
  r = await m.runCommit(async () => ({ status: 'refused', reason: 'Only shifts on your own projects can be closed here.' }), { ...base, copy });
  if (r.status !== 'refused' || r.reason !== 'Only shifts on your own projects can be closed here.') f.push(`a write's own reason was overridden: ${J(r)}`);
  // Byte-identical English fallbacks when copy is absent (or blank).
  for (const c of [undefined, { refused: '  ', timeout: '', legalQueued: ' ', transport: '' }]) {
    const o = { ...base, ...(c ? { copy: c } : {}) };
    r = await m.runCommit(async () => ({ status: 'refused' } as never), o);
    if (r.status !== 'refused' || r.reason !== 'Not approved. Something went wrong on our side.') f.push(`fallback refused drifted: ${J(r)}`);
    r = await m.runCommit(() => new Promise<never>(() => {}), { ...o, timeoutMs: 15 });
    if (r.status !== 'timeout' || r.message !== 'No answer yet. Check CO #4 before trying again.') f.push(`fallback timeout drifted: ${J(r)}`);
    r = await m.runCommit(async () => ({ status: 'queued' }), { ...o, legal: true, verb: 'signed' });
    if (r.status !== 'refused' || r.reason !== 'Not signed. Signing needs a connection, so nothing was signed.') f.push(`fallback legalQueued drifted: ${J(r)}`);
    r = await m.runCommit(async () => { throw new TypeError('Failed to fetch'); }, { ...o, idempotent: true, verb: 'recorded' });
    if (r.status !== 'refused' || r.reason !== 'Not recorded. The connection dropped, so nothing was saved.') f.push(`fallback transport drifted: ${J(r)}`);
  }
  // verb / subject are optional now: no "undefined" ever reaches a sentence.
  r = await m.runCommit(async () => ({ status: 'refused' } as never), { idempotent: false });
  if (r.status !== 'refused' || /undefined/.test(r.reason)) f.push(`no verb reads "undefined": ${J(r)}`);
  r = await m.runCommit(() => new Promise<never>(() => {}), { idempotent: false, timeoutMs: 15 });
  if (r.status !== 'timeout' || /undefined/.test(r.message)) f.push(`no subject reads "undefined": ${J(r)}`);
  // Offline reasons: whole sentences keyed by kind, default byte-identical.
  if (m.offlineLegalReason() !== "You're offline. Signing needs a connection.") f.push(`offlineLegalReason() drifted: ${m.offlineLegalReason()}`);
  if (m.offlineLegalReason('signing') !== "You're offline. Signing needs a connection.") f.push('offlineLegalReason(signing) drifted');
  if (m.offlineLegalReason('certifying') !== "You're offline. Certifying needs a connection.") f.push(`offlineLegalReason(certifying) = ${m.offlineLegalReason('certifying')}`);
  if (m.offlineReasonLine({ copy: { offline: 'Sin conexión. Firmar necesita conexión.' } }) !== 'Sin conexión. Firmar necesita conexión.') f.push('offlineReasonLine ignores copy.offline');
  if (m.offlineReasonLine({}) !== "You're offline. Signing needs a connection.") f.push('offlineReasonLine default drifted');
  if (m.legalQueuedLine({ idempotent: false, copy: { legalQueued: copy.legalQueued } }) !== copy.legalQueued) f.push('legalQueuedLine ignores copy.legalQueued');
  return f;
}

// ─────────────────────────────────────────────────────────────────────────────
// 0.5 the honest data-layer calls (the shipped text, executed)
// ─────────────────────────────────────────────────────────────────────────────

type CO = { id: string; number: number; projectId: string; status: string; auditTrail?: { id: string; action: string; actor: string; timestamp: string }[]; scheduleImpactDays?: number; scheduleImpactApplied?: boolean; [k: string]: unknown };

async function checkApprove(CTX: string): Promise<Fails> {
  const f: Fails = [];
  // (a) the approve alone, with updateChangeOrder recorded.
  const run = async (write: string, opts?: { createQueued?: boolean; canSync?: boolean; anchor?: string; frozen?: Row }) => {
    const events: string[] = [];
    const updates: unknown[][] = [];
    const queued: Row[] = [];
    const writes: { table: string; op: string; data: Row; opts?: Row }[] = [];
    const changeOrdersRef = { current: [{ id: 'c1', number: 4, projectId: 'p1', status: 'submitted' }] as CO[] };
    const before = JSON.stringify(changeOrdersRef.current);
    const scope: Scope = {
      changeOrdersRef, canSync: opts?.canSync ?? true,
      changeOrderInsertsRef: { current: new Map() },
      getOfflineQueue: async () => (opts?.createQueued ? [{ table: 'change_orders', operation: 'insert', data: { id: 'c1' } }] : []),
      insertStillQueued,
      addToOfflineQueue: async (e: Row) => { events.push('enqueue'); queued.push(e); },
      supabaseWriteDetailed: async (table: string, op: string, data: Row, o?: Row) => { events.push('write'); writes.push({ table, op, data, opts: o }); return write; },
      beginCoWrite: () => events.push('begin'), endCoWrite: () => events.push('end'),
      updateChangeOrder: async (...a: unknown[]) => { events.push('update'); updates.push(a); return 'synced'; },
      changeOrderToRow: (co: CO) => ({ id: co.id, status: co.status, number: co.number, ...('taxRatePct' in co ? { tax_rate_pct: (co as Row).taxRatePct } : {}) }),
    };
    const approve = runCallback<(id: string, o?: { anchorTaskId?: string; frozen?: Row }) => Promise<string>>(CTX, 'approveChangeOrder', scope);
    const o = { ...(opts?.anchor ? { anchorTaskId: opts.anchor } : {}), ...(opts?.frozen ? { frozen: opts.frozen } : {}) };
    const out = await approve('c1', Object.keys(o).length ? o : undefined);
    await tick();
    return { out, events, updates, queued, writes, unchanged: JSON.stringify(changeOrdersRef.current) === before };
  };
  const failed = await run('failed');
  if (failed.out !== 'failed' || failed.updates.length !== 0 || !failed.unchanged) f.push(`failed -> ${JSON.stringify({ out: failed.out, updates: failed.updates.length })} (nothing local may change)`);
  const w = failed.writes[0];
  if (!w || w.table !== 'change_orders' || w.op !== 'update' || w.data.status !== 'approved' || w.opts?.callerOwnsRefusal !== true) f.push(`the status write is not an approved update with callerOwnsRefusal: ${JSON.stringify(w)}`);
  const synced = await run('synced');
  if (synced.out !== 'synced' || synced.updates.length !== 1 || JSON.stringify(synced.updates[0].slice(0, 2)) !== JSON.stringify(['c1', { status: 'approved' }])) f.push(`synced -> ${JSON.stringify({ out: synced.out, updates: synced.updates })}`);
  if (synced.events.indexOf('write') < 0 || synced.events.indexOf('write') > synced.events.indexOf('update')) f.push(`the status write must go FIRST: ${synced.events.join(',')}`);
  const anchored = await run('synced', { anchor: 't7' });
  if (JSON.stringify(anchored.updates[0]?.[2]) !== JSON.stringify({ anchorTaskId: 't7' })) f.push(`the anchor does not reach the cascade: ${JSON.stringify(anchored.updates)}`);
  const q = await run('synced', { createQueued: true });
  if (q.out !== 'queued' || q.writes.length !== 0 || q.queued.length !== 1 || (q.queued[0].data as Row).status !== 'approved' || q.updates.length !== 1) f.push(`create still queued -> ${JSON.stringify({ out: q.out, writes: q.writes.length, queued: q.queued })} (queue behind it, then the cascade)`);
  const local = await run('synced', { canSync: false });
  if (local.writes.length !== 0 || local.updates.length !== 1) f.push(`no account -> ${JSON.stringify(local)} (this device only, through updateChangeOrder)`);
  // W2 integration (critic 2, issue 8): "Client approved without signing"
  // approves through this write with its #131 tax freeze. The freeze rides IN
  // the approval's own status write (never a second update), the local
  // update applies it with the status, and a refused write changes nothing.
  const frozen = { taxRatePct: 8.875, taxAmount: 372.75, totalWithTax: 4572.75 };
  const fz = await run('synced', { frozen });
  if (fz.writes.length !== 1 || fz.writes[0].data.status !== 'approved' || fz.writes[0].data.tax_rate_pct !== 8.875
    || JSON.stringify(fz.updates[0]?.slice(0, 2)) !== JSON.stringify(['c1', { ...frozen, status: 'approved' }])) {
    f.push(`frozen + synced -> ${JSON.stringify({ writes: fz.writes, updates: fz.updates })} (the freeze rides in the approval's own write and its local update)`);
  }
  const fzFailed = await run('failed', { frozen });
  if (fzFailed.out !== 'failed' || fzFailed.updates.length !== 0 || !fzFailed.unchanged) f.push('frozen + failed -> something local changed (a refused unsigned approve changes nothing)');
  const fzLocal = await run('synced', { frozen, canSync: false });
  if (JSON.stringify(fzLocal.updates[0]?.slice(0, 2)) !== JSON.stringify(['c1', { ...frozen, status: 'approved' }])) f.push(`frozen, no account -> ${JSON.stringify(fzLocal.updates)} (the freeze is applied with the status)`);

  // (b) chained with the REAL updateChangeOrder: approved, reflow exactly once, the marker respected.
  let reflows = 0;
  const changeOrdersRef = { current: [{ id: 'c1', number: 4, projectId: 'p1', status: 'submitted', scheduleImpactDays: 3, auditTrail: [] }] as CO[] };
  let state: CO[] = changeOrdersRef.current;
  const project = { id: 'p1', schedule: { tasks: [{ id: 't1' }] } };
  const serverRows: Row[] = [];
  const scope: Scope = {
    changeOrdersRef, canSync: true, userId: 'u1', user: { email: 'gc@x.com' },
    setChangeOrders: (l: CO[]) => { state = l; }, saveChangeOrdersMutation: { mutate: () => {} },
    isCoScheduleReflowApplied, hasUnanchoredMarker, normalizeImpactDays, buildDeferredCoAuditEntry, buildUnanchoredCoAuditEntry,
    applyCoScheduleReflow: (_s: unknown, co: CO) => {
      reflows += 1;
      return {
        plan: { status: 'ready', message: 'ok' },
        nextSchedule: { tasks: [{ id: 't1', durationDays: 13 }] },
        coPatch: { scheduleImpactApplied: true },
        auditEntry: { id: `a${reflows}`, action: 'schedule_reflow', actor: 'gc', timestamp: 'now', detail: co.id },
      };
    },
    projects: [project], projectsRef: { current: [project] },
    setProjects: () => {}, saveProjectsMutation: { mutate: () => {} }, syncProjectToSupabase: () => {},
    stampFieldEdits: (_live: unknown, next: unknown) => next,
    withMarkedApproved, newAuditEntries, generateUUID: () => 'm1',
    changeOrderToRow: (co: CO) => ({ id: co.id, status: co.status, schedule_impact_applied: co.scheduleImpactApplied ?? null }),
    changeOrderInsertsRef: { current: new Map() }, insertStillQueued, getOfflineQueue: async () => [],
    addToOfflineQueue: async () => {},
    supabaseWriteDetailed: async (_t: string, _op: string, data: Row) => { serverRows.push(data); return 'synced'; },
    beginCoWrite: () => {}, endCoWrite: () => {},
  };
  scope.updateChangeOrder = runCallback(CTX, 'updateChangeOrder', scope);
  const approve = runCallback<(id: string) => Promise<string>>(CTX, 'approveChangeOrder', scope);
  const o1 = await approve('c1');
  await tick(); await tick();
  const co = state.find((c) => c.id === 'c1');
  if (o1 !== 'synced' || co?.status !== 'approved') f.push(`chained synced -> ${o1}, status ${co?.status}`);
  if (reflows !== 1) f.push(`the reflow ran ${reflows} times (exactly once)`);
  if (co?.scheduleImpactApplied !== true) f.push('the reflow marker (scheduleImpactApplied) was not recorded');
  const o2 = await approve('c1');
  await tick(); await tick();
  if (o2 !== 'synced' || reflows !== 1) f.push(`a second approve re-ran the reflow (${reflows}): the idempotent marker must hold`);
  if (serverRows[0]?.status !== 'approved' || typeof serverRows[0]?.updated_at !== 'string' || serverRows[0]?.schedule_impact_applied !== null) f.push(`the first server write is not the status write (changeOrderToRow, status approved, before the reflow patch): ${JSON.stringify(serverRows[0])}`);
  // (c) failed then chained: nothing local.
  const refs = { current: [{ id: 'c2', number: 5, projectId: 'p1', status: 'submitted', scheduleImpactDays: 2 }] as CO[] };
  let state2: CO[] = refs.current;
  const reflowsBefore = reflows;
  const scope2: Scope = { ...scope, changeOrdersRef: refs, setChangeOrders: (l: CO[]) => { state2 = l; }, supabaseWriteDetailed: async () => 'failed' };
  scope2.updateChangeOrder = runCallback(CTX, 'updateChangeOrder', scope2);
  const approve2 = runCallback<(id: string) => Promise<string>>(CTX, 'approveChangeOrder', scope2);
  const o3 = await approve2('c2');
  await tick();
  if (o3 !== 'failed' || state2.find((c) => c.id === 'c2')?.status !== 'submitted' || reflows !== reflowsBefore) f.push(`chained failed -> ${o3}, status ${state2.find((c) => c.id === 'c2')?.status}, reflows ${reflows - reflowsBefore} (the local list must be unchanged)`);
  return f;
}

async function checkCloseProject(CTX: string): Promise<Fails> {
  const f: Fails = [];
  const run = async (write: string, canSync = true) => {
    const updates: unknown[][] = [];
    const writes: { table: string; op: string; data: Row; o?: Row }[] = [];
    const scope: Scope = {
      projectsRef: { current: [{ id: 'p1', status: 'active' }] }, canSync,
      updateProject: (...a: unknown[]) => { updates.push(a); },
      supabaseWriteDetailed: async (table: string, op: string, data: Row, o?: Row) => { writes.push({ table, op, data, o }); return write; },
    };
    const close = runCallback<(id: string) => Promise<string>>(CTX, 'closeProjectDetailed', scope);
    return { out: await close('p1'), updates, writes };
  };
  const failed = await run('failed');
  if (failed.out !== 'failed' || failed.updates.length !== 0) f.push(`failed -> local state changed (${failed.updates.length} updateProject calls)`);
  const w = failed.writes[0];
  if (!w || w.table !== 'projects' || w.op !== 'update' || w.data.status !== 'closed' || typeof w.data.closed_at !== 'string' || w.o?.callerOwnsRefusal !== true) f.push(`the close write: ${JSON.stringify(w)}`);
  for (const o of ['synced', 'queued']) {
    const r = await run(o);
    const u = r.updates[0] as [string, Row] | undefined;
    if (r.out !== o || !u || u[0] !== 'p1' || u[1].status !== 'closed' || u[1].closedAt !== r.writes[0].data.closed_at) f.push(`${o} -> ${JSON.stringify({ out: r.out, updates: r.updates })} (the same local close as the punch list's)`);
  }
  const local = await run('synced', false);
  if (local.out !== 'local' || local.writes.length !== 0 || local.updates.length !== 1) f.push(`no account -> ${JSON.stringify(local)}`);
  return f;
}

async function checkSignFieldTicket(CTX: string): Promise<Fails> {
  const f: Fails = [];
  const draft = { id: 'ft1', projectId: 'p1', number: 12, status: 'draft', labor: [{ id: 'l1', hours: 8 }], materials: [], equipment: [], photos: [], auditTrail: [] };
  const run = async (input: unknown, answer: { status: string; code?: string; landedEarlier?: true }, opts?: { canSync?: boolean; existing?: Row[]; stored?: Row | null }) => {
    const writes: { table: string; op: string; data: Row }[] = [];
    const reads: string[] = [];
    const fieldTicketsRef = { current: (opts?.existing ?? []) as Row[] };
    let state: Row[] = fieldTicketsRef.current;
    let saved = 0;
    const scope: Scope = {
      canSync: opts?.canSync ?? true, fieldTicketsRef,
      setFieldTickets: (l: Row[]) => { state = l; }, saveFieldTicketsMutation: { mutate: () => { saved += 1; } },
      stageTicketPhotos: (t: Row) => t, touchedWrite: (_r: unknown, _id: string, send: () => Promise<unknown>) => send(), proDocWriteTouchRef: { current: new Map() },
      fieldTicketRow: (t: Row) => ({ id: t.id, user_id: 'u1', project_id: t.projectId, status: t.status, authorization: t.authorization ?? null }),
      sealedFieldTicketViolations,
      supabaseWriteOnlineDetailed: async (table: string, op: string, data: Row) => { writes.push({ table, op, data }); return answer; },
      // The stored row read back by id (W2 integration: a landedEarlier insert).
      readStoredFieldTicket: async (id: string) => { reads.push(id); return opts?.stored === undefined ? null : opts.stored; },
    };
    const sign = runCallback<(i: unknown) => Promise<{ status: string; code?: string; record?: Row }>>(CTX, 'signFieldTicket', scope);
    return { out: await sign(input), writes, reads, state: () => state, saved };
  };
  const signedNew = { ...draft, status: 'signed', authorization: { name: 'Pat', role: 'owner_rep', signedAt: 'now', signaturePaths: ['M1,1 L2,2'] } };
  let r = await run({ ticket: signedNew }, { status: 'synced' });
  if (r.out.status !== 'synced' || r.writes[0]?.op !== 'insert' || r.writes[0]?.table !== 'field_tickets' || !r.state().some((t) => t.id === 'ft1')) f.push(`new + synced -> ${JSON.stringify({ out: r.out, writes: r.writes })}`);
  for (const status of ['refused', 'unknown']) {
    r = await run({ ticket: signedNew }, { status, code: status === 'refused' ? 'earlier_change_pending' : undefined });
    if (r.out.status !== status || r.state().length !== 0 || r.saved !== 0) f.push(`new + ${status} -> local state changed (${r.state().length})`);
    if (status === 'refused' && r.out.code !== 'earlier_change_pending') f.push(`the refusal code is not passed through: ${JSON.stringify(r.out)}`);
  }
  // existing ticket, signed: an UPDATE without user_id
  r = await run({ id: 'ft1', updates: { status: 'signed', authorization: signedNew.authorization } }, { status: 'synced' }, { existing: [draft] });
  if (r.out.status !== 'synced' || r.writes[0]?.op !== 'update' || 'user_id' in (r.writes[0]?.data ?? {}) || r.state()[0]?.status !== 'signed') f.push(`existing + synced -> ${JSON.stringify({ out: r.out, writes: r.writes })}`);
  r = await run({ id: 'ft1', updates: { status: 'signed', authorization: signedNew.authorization } }, { status: 'refused' }, { existing: [draft] });
  if (r.out.status !== 'refused' || r.state()[0]?.status !== 'draft') f.push('existing + refused -> the local ticket changed');
  // a sealed ticket's content: refused 'sealed', nothing sent
  const sealed = { ...signedNew };
  r = await run({ id: 'ft1', updates: { labor: [{ id: 'l1', hours: 10 }] } }, { status: 'synced' }, { existing: [sealed] });
  if (r.out.status !== 'refused' || r.out.code !== 'sealed' || r.writes.length !== 0) f.push(`a sealed ticket's hours -> ${JSON.stringify(r.out)} with ${r.writes.length} writes (must be refused 'sealed', nothing sent)`);
  // { ticket } whose id this phone already holds (a draft saved earlier): an
  // UPDATE carrying the signed content, never an insert that could read
  // stored on the draft's own row while the server keeps the unsigned draft.
  r = await run({ ticket: signedNew }, { status: 'synced' }, { existing: [draft] });
  if (r.out.status !== 'synced' || r.writes.length !== 1 || r.writes[0]?.op !== 'update' || r.writes[0]?.data.status !== 'signed' || 'user_id' in (r.writes[0]?.data ?? {}) || r.state()[0]?.status !== 'signed' || r.state().length !== 1) f.push(`{ticket} over an existing draft -> ${JSON.stringify({ out: r.out, writes: r.writes })} (must be ONE update carrying status signed)`);
  r = await run({ ticket: signedNew }, { status: 'refused' }, { existing: [draft] });
  if (r.out.status !== 'refused' || r.state()[0]?.status !== 'draft') f.push('{ticket} over an existing draft + refused -> the local ticket changed');
  // ... and over an already SIGNED ticket with different hours: the seal applies, nothing sent
  r = await run({ ticket: { ...signedNew, labor: [{ id: 'l1', hours: 10 }] } }, { status: 'synced' }, { existing: [sealed] });
  if (r.out.status !== 'refused' || r.out.code !== 'sealed' || r.writes.length !== 0) f.push(`{ticket} over a signed ticket with new hours -> ${JSON.stringify(r.out)} with ${r.writes.length} writes (must be refused 'sealed', nothing sent)`);
  r = await run({ ticket: signedNew }, { status: 'synced' }, { canSync: false });
  if (r.out.status !== 'refused' || r.out.code !== 'no_account' || r.writes.length !== 0) f.push(`no account -> ${JSON.stringify(r.out)} (a signature is never kept on the phone only)`);
  // W2 integration (critic 2, issue 2): a retry after a landed-but-unanswered
  // insert meets its own row (landedEarlier). The server holds the FIRST
  // attempt's ticket (its signed-at, strokes, hours); that stored row is what
  // this phone keeps and what the result names, never the retry's copy.
  const firstAttempt = { ...signedNew, number: 12, labor: [{ id: 'l1', hours: 6 }], authorization: { ...signedNew.authorization, signedAt: 'first' } };
  r = await run({ ticket: { ...signedNew, number: 13, authorization: { ...signedNew.authorization, signedAt: 'retry' } } }, { status: 'synced', landedEarlier: true }, { stored: firstAttempt });
  const kept = r.state().find((t) => t.id === 'ft1') as Row | undefined;
  if (r.out.status !== 'synced' || r.reads[0] !== 'ft1' || (r.out.record as Row | undefined)?.number !== 12
    || ((r.out.record as Row | undefined)?.authorization as Row | undefined)?.signedAt !== 'first'
    || (kept?.authorization as Row | undefined)?.signedAt !== 'first' || (kept?.labor as Row[] | undefined)?.[0]?.hours !== 6 || r.state().length !== 1) {
    f.push(`a landed retry -> ${JSON.stringify({ out: r.out, kept })} (must keep and return the STORED first attempt: number 12, signed 'first', 6 hours)`);
  }
  r = await run({ ticket: signedNew }, { status: 'synced', landedEarlier: true }, { stored: null });
  if (r.out.status !== 'unknown' || r.state().length !== 0 || r.saved !== 0) f.push(`a landed retry whose stored row cannot be read -> ${JSON.stringify(r.out)} with ${r.state().length} kept (must be 'unknown', nothing kept)`);
  return f;
}

async function checkAiaOnline(CTX: string): Promise<Fails> {
  const f: Fails = [];
  const run = async (answer: string, existing: Row[] = []) => {
    const writes: { table: string; op: string; data: Row }[] = [];
    const queued: Row[] = [];
    const aiaPayAppsRef = { current: existing };
    let state: Row[] = existing;
    const scope: Scope = {
      canSync: true, userId: 'u1', aiaPayAppsRef,
      initialPortalState: () => ({ status: 'draft' }),
      touchedWrite: (_r: unknown, _id: string, send: () => Promise<unknown>) => send(), proDocWriteTouchRef: { current: new Map() },
      aiaPayAppToRow: (a: Row) => ({ id: a.id, project_id: a.projectId, certified_at: a.certifiedAt }),
      supabaseWriteOnlineDetailed: async (table: string, op: string, data: Row) => { writes.push({ table, op, data }); return { status: answer }; },
      supabaseWrite: async (table: string, op: string, data: Row) => { queued.push({ table, op, data }); return true; },
      setAiaPayApps: (l: Row[]) => { state = l; }, saveAiaPayAppsMutation: { mutate: () => {} },
    };
    const save = runCallback<(a: Row) => Promise<{ status: string }>>(CTX, 'saveAIAPayAppOnline', scope);
    const out = await save({ id: 'a2', projectId: 'p1', invoiceId: 'i1', applicationNumber: 6, certifiedAt: 'now' });
    return { out, writes, queued, state: () => state };
  };
  const ok1 = await run('synced', [{ id: 'a1', projectId: 'p1', applicationNumber: 6 }]);
  if (ok1.out.status !== 'synced' || ok1.writes[0]?.op !== 'upsert' || ok1.writes[0]?.table !== 'aia_pay_apps' || ok1.state()[0]?.id !== 'a2') f.push(`synced -> ${JSON.stringify(ok1)}`);
  for (const s of ['refused', 'unknown']) {
    const r = await run(s, [{ id: 'a0', projectId: 'p1', invoiceId: 'i1' }]);
    if (r.out.status !== s || r.state().length !== 1 || r.state()[0].id !== 'a0' || r.queued.length !== 0) f.push(`${s} -> local state or queue changed (${JSON.stringify(r.state())}, ${r.queued.length} queued)`);
  }
  return f;
}

async function checkShifts(HOOK: string): Promise<Fails> {
  const f: Fails = [];
  const planClockOut = runFunction<(e: Row | undefined, out: string | undefined, now: number) => { kind: string; row?: Row; totalHours?: number; breakMinutes?: number }>(HOOK, 'planClockOut', { breakMinutesAt, computeShiftHours });
  const planTeamShiftClose = runFunction<(t: Row | undefined, p: Row) => { kind: string; row?: Row; next?: Row }>(HOOK, 'planTeamShiftClose', {});
  const now = Date.parse('2026-09-28T17:00:00.000Z');
  const open = { id: 'e1', clockIn: '2026-09-28T08:00:00.000Z', status: 'clocked_in', breakMinutes: 30 };
  // clockOutDetailed reads the real clock: a shift that started 8 hours ago.
  const liveOpen = { ...open, clockIn: new Date(Date.now() - 8 * 3_600_000).toISOString() };
  const p = planClockOut(open, undefined, now);
  if (p.kind !== 'ok' || p.totalHours !== 8.5 || JSON.stringify(Object.keys(p.row ?? {})) !== JSON.stringify(['id', 'status', 'clock_out', 'break_minutes', 'break_started_at', 'total_hours', 'overtime_hours'])) f.push(`planClockOut ok -> ${JSON.stringify(p)}`);
  if (planClockOut({ ...open, status: 'clocked_out', clockOut: 'x' }, undefined, now).kind !== 'already') f.push('planClockOut: an ended shift is not "already"');
  if (planClockOut(open, '2026-09-28T07:00:00.000Z', now).kind !== 'invalid') f.push('planClockOut: out before in is not "invalid"');
  if (planClockOut(open, '2026-09-28T18:00:00.000Z', now).kind !== 'invalid') f.push('planClockOut: an out time in the future is not "invalid"');
  const onBreak = planClockOut({ ...open, status: 'break', breakStartedAt: '2026-09-28T16:00:00.000Z' }, undefined, now);
  if (onBreak.kind !== 'ok' || onBreak.breakMinutes !== 90) f.push(`planClockOut: a running break is not taken off (#152): ${JSON.stringify(onBreak)}`);
  if (planTeamShiftClose({ id: 't', onOwnedProject: false, clockIn: 'x' }, { totalHours: 8, breakMinutes: 0, clockOut: 'y' }).kind !== 'not_own') f.push('planTeamShiftClose: a job he does not own is not "not_own"');
  const tp = planTeamShiftClose({ id: 't', onOwnedProject: true, clockIn: 'x' }, { totalHours: 9.25, breakMinutes: 15, clockOut: 'y' });
  if (tp.kind !== 'ok' || tp.row?.overtime_hours !== 1.25 || tp.next?.status !== 'clocked_out') f.push(`planTeamShiftClose ok -> ${JSON.stringify(tp)}`);

  // clockOutDetailed, executed
  const runOut = async (answer: string, opts?: { entry?: Row; userId?: string | null }) => {
    const entry = opts?.entry ?? liveOpen;
    const entriesRef = { current: [entry] };
    let state: Row[] = [entry];
    const cancelled: string[] = [];
    const writes: { table: string; op: string; data: Row; o?: Row }[] = [];
    const scope: Scope = {
      entriesRef, userId: opts?.userId === undefined ? 'u1' : opts.userId, isSupabaseConfigured: true, planClockOut,
      setEntries: (fn: (p: Row[]) => Row[]) => { state = fn(state); },
      cancelShiftAlert: (id: string) => cancelled.push(id),
      offlineQueueWrites: { supabaseWriteDetailed: async (table: string, op: string, data: Row, o?: Row) => { writes.push({ table, op, data, o }); return answer; } },
    };
    const fn = runCallback<(id: string, outAt?: string) => Promise<string>>(HOOK, 'clockOutDetailed', scope);
    const out = await fn('e1');
    return { out, state, cancelled, writes };
  };
  const failed = await runOut('failed');
  if (failed.out !== 'failed' || failed.state[0].status !== 'clocked_in' || failed.state[0].clockOut !== undefined || failed.cancelled.length !== 0) f.push(`clockOutDetailed failed -> ${JSON.stringify(failed)} (the shift must be back on the clock)`);
  if (failed.writes[0]?.o?.callerOwnsRefusal !== true || failed.writes[0]?.data.status !== 'clocked_out') f.push(`clockOutDetailed write: ${JSON.stringify(failed.writes[0])}`);
  for (const o of ['synced', 'queued']) {
    const r = await runOut(o);
    if (r.out !== o || r.state[0].status !== 'clocked_out' || r.cancelled.length !== 1) f.push(`clockOutDetailed ${o} -> ${JSON.stringify(r)}`);
  }
  const already = await runOut('synced', { entry: { ...liveOpen, status: 'clocked_out', clockOut: new Date(Date.now() - 3_600_000).toISOString() } });
  if (already.out !== 'already' || already.writes.length !== 0) f.push(`clockOutDetailed already -> ${JSON.stringify(already)}`);
  const local = await runOut('synced', { userId: null });
  if (local.out !== 'local' || local.writes.length !== 0) f.push(`clockOutDetailed signed out -> ${JSON.stringify(local)}`);

  // closeTeamShiftDetailed, executed
  const runTeam = async (answer: string, own = true) => {
    const t = { id: 'e2', clockIn: liveOpen.clockIn, status: 'clocked_in', onOwnedProject: own, breakMinutes: 0, totalHours: 0 };
    const teamEntriesRef = { current: [t] };
    let state: Row[] = [t];
    const writes: Row[] = [];
    const scope: Scope = {
      teamEntriesRef, userId: 'u1', isSupabaseConfigured: true, planTeamShiftClose,
      setTeamEntries: (fn: (p: Row[]) => Row[]) => { state = fn(state); },
      offlineQueueWrites: { supabaseWriteDetailed: async (_t: string, _op: string, data: Row) => { writes.push(data); return answer; } },
    };
    const fn = runCallback<(id: string, p: Row) => Promise<string>>(HOOK, 'closeTeamShiftDetailed', scope);
    const out = await fn('e2', { clockOut: '2026-09-28T16:00:00.000Z', totalHours: 8, breakMinutes: 0 });
    return { out, state, writes };
  };
  const tf = await runTeam('failed');
  if (tf.out !== 'failed' || tf.state[0].status !== 'clocked_in') f.push(`closeTeamShiftDetailed failed -> ${JSON.stringify(tf)} (the row must be put back)`);
  const ts = await runTeam('synced');
  if (ts.out !== 'synced' || ts.state[0].status !== 'clocked_out') f.push(`closeTeamShiftDetailed synced -> ${JSON.stringify(ts)}`);
  const tn = await runTeam('synced', false);
  if (tn.out !== 'not_own' || tn.writes.length !== 0) f.push(`closeTeamShiftDetailed not own -> ${JSON.stringify(tn)}`);
  return f;
}

async function checkLock(WIP: string): Promise<Fails> {
  const f: Fails = [];
  const run = async (answer: string, lockedAt?: string, userId: string | null = 'u1') => {
    const periodsRef = { current: [{ id: 'w1', lockedAt }] as Row[] };
    const persisted: Row[][] = [];
    const scope: Scope = {
      periodsRef, userId,
      persist: async (l: Row[]) => { persisted.push(l); },
      offlineQueueWrites: { supabaseWriteDetailed: async (_t: string, _op: string, data: Row, o?: Row) => { persisted.push([{ write: data, o }]); return answer; } },
    };
    const fn = runCallback<(id: string) => Promise<string>>(WIP, 'lockPeriodDetailed', scope);
    const out = await fn('w1');
    return { out, periodsRef, persisted };
  };
  const failed = await run('failed');
  if (failed.out !== 'failed' || failed.periodsRef.current[0].lockedAt !== undefined) f.push(`lockPeriodDetailed failed -> ${JSON.stringify(failed)} (unlocked again)`);
  const write = failed.persisted.find((x) => (x[0] as Row)?.write)?.[0] as { write: Row; o: Row } | undefined;
  if (!write || typeof write.write.locked_at !== 'string' || write.o?.callerOwnsRefusal !== true) f.push(`lockPeriodDetailed write: ${JSON.stringify(write)}`);
  const synced = await run('synced');
  if (synced.out !== 'synced' || typeof synced.periodsRef.current[0].lockedAt !== 'string') f.push(`lockPeriodDetailed synced -> ${JSON.stringify(synced)}`);
  const already = await run('synced', '2026-09-01T00:00:00.000Z');
  if (already.out !== 'already' || already.persisted.length !== 0) f.push(`lockPeriodDetailed already -> ${JSON.stringify(already)}`);
  const local = await run('synced', undefined, null);
  if (local.out !== 'local') f.push(`lockPeriodDetailed signed out -> ${local.out}`);
  return f;
}

function checkContract(ENGINE: string): Fails {
  const f: Fails = [];
  const patchOf = runFunction<(s: string, e?: Row, now?: string) => Row>(ENGINE, 'contractStatusPatch', {});
  const sent = patchOf('sent', { gcSignature: { name: 'G' } }, 'T');
  if (JSON.stringify(sent) !== JSON.stringify({ status: 'sent', sent_at: 'T', gc_signature: { name: 'G' } })) f.push(`contractStatusPatch sent -> ${JSON.stringify(sent)}`);
  const signed = patchOf('signed', { signedAt: 'S', homeownerSignature: { name: 'H' } }, 'T');
  if (JSON.stringify(signed) !== JSON.stringify({ status: 'signed', signed_at: 'S', homeowner_signature: { name: 'H' } })) f.push(`contractStatusPatch signed -> ${JSON.stringify(signed)}`);
  const body = (name: string) => { const i = ENGINE.indexOf(`export async function ${name}(`); return i < 0 ? '' : ENGINE.slice(i, ENGINE.indexOf('\n}\n', i)); };
  const legacy = body('setContractStatus');
  const detailed = body('setContractStatusDetailed');
  if (!/contractStatusPatch\(status, extras\)/.test(legacy) || !/Promise<boolean>/.test(legacy)) f.push('setContractStatus no longer builds its patch with contractStatusPatch (or no longer answers a boolean)');
  if (!/supabaseWriteOnline\('project_contracts', 'update', \{ id, \.\.\.contractStatusPatch\(status, extras\) \}\)/.test(detailed)) f.push('setContractStatusDetailed is not the online-only update of contractStatusPatch');
  if (/supabaseWrite\(|supabaseWriteDetailed\(|addToOfflineQueue\(/.test(detailed)) f.push('setContractStatusDetailed calls a queue-backed write');
  return f;
}

// ─────────────────────────────────────────────────────────────────────────────

function runFixture(root: string, env: Record<string, string> = {}): { name: string; pass: boolean; detail?: string }[] {
  const res = Bun.spawnSync(['bun', 'run', join(root, 'scripts/moments-checks/step0/fixture-io.ts')], {
    cwd: root, env: { ...process.env, ...env }, stdout: 'pipe', stderr: 'pipe',
  });
  const out = new TextDecoder().decode(res.stdout);
  const lines = out.split('\n').filter((l) => l.startsWith('{"name"'));
  return lines.map((l) => JSON.parse(l) as { name: string; pass: boolean; detail?: string });
}

export default async function run(ctx: MomentsCtx): Promise<void> {
  const { ok, read, root } = ctx;

  // 0.1
  const pkg = read('package.json');
  const shipCheck = /"ship-check":\s*"([^"]*)"/.exec(pkg)?.[1] ?? '';
  ok('0.1 test:moments is registered and runs in ship-check', /"test:moments":\s*"bun run scripts\/validate-moments\.ts"/.test(pkg) && /bun run test:moments\b/.test(shipCheck));

  // 0.2
  const online = read('hooks/useOnline.ts');
  ok('0.2 useOffline() = useSyncExternalStore over onlineManager (server snapshot online); isOfflineNow() for non-React callers',
    /export function useOffline\(\): boolean/.test(online) && /useSyncExternalStore\(subscribe, offlineSnapshot, offlineServerSnapshot\)/.test(online)
      && /const offlineSnapshot = \(\) => !onlineManager\.isOnline\(\)/.test(online) && /const offlineServerSnapshot = \(\) => false/.test(online)
      && /export function isOfflineNow\(\): boolean/.test(online) && /from '@tanstack\/react-query'/.test(online));

  // 0.3 (+ the binder save of 0.5), the real module in its own process
  const fx = runFixture(root);
  ok(`0.3 the online-only write fixture ran (${fx.length} cases)`, fx.length >= 20, fx.length ? undefined : 'no output from step0/fixture-io.ts');
  for (const c of fx) ok(`0.3 ${c.name}`, c.pass, c.detail);
  const Q = read('utils/offlineQueue.ts');
  const block = Q.slice(Q.indexOf('// ── Online-only writes'));
  ok('0.3 the online-only block never enqueues, ledgers or toasts (no addToOfflineQueue / enqueueOrFail / appendEntryLocked / failDirectWrite / recordSyncFailures / parkBehindUnsavedWrite / oops)',
    block.length > 1000 && !/\b(addToOfflineQueue|enqueueOrFail|appendEntryLocked|failDirectWrite|recordSyncFailures|parkBehindUnsavedWrite|toastParked|oops)\s*\(/.test(block));
  ok('0.3 the earlier-change sentences are exported for the copy files (utils/moments/copy, re-exported by offlineQueue)',
    /export \{ EARLIER_CHANGE_PENDING_REASON, EARLIER_CHANGE_UNSAVED_REASON \};/.test(block));

  // 0.3 mutation proof: plant the offline refusal and the FIFO refusal away; the fixture must go red.
  {
    const dir = mkdtempSync(join(tmpdir(), 'moments-step0-mut-'));
    const results: [string, boolean][] = [];
    try {
      // Only the modules the fixture does NOT stub are rewritten to absolute paths.
      const abs = (spec: string) => JSON.stringify(join(root, spec.replace(/^@\//, '')));
      const src = Q
        .replace("from '@/utils/networkErrors'", `from ${abs('@/utils/networkErrors')}`)
        .replace("from '@/utils/syncRecordKey'", `from ${abs('@/utils/syncRecordKey')}`)
        .replace("from '@/utils/moments/copy'", `from ${abs('@/utils/moments/copy')}`)
        .replace("import type { OnlineOutcome, OnlineRefusalCode } from '@/utils/moments/commitAdapters';", `import type { OnlineOutcome, OnlineRefusalCode } from ${abs('@/utils/moments/commitAdapters')};`)
        .split("require('@/utils/syncLedger')").join(`require(${abs('@/utils/syncLedger')})`);
      const plant = (from: string, to: string, label: string) => {
        const out = src.replace(from, to);
        if (out === src) throw new Error(`mutant ${label}: anchor not found`);
        return out;
      };
      const mutants: [string, string][] = [
        ['offline at the call is sent anyway', plant("  if (offlineAtCall()) return { status: 'refused', code: 'offline' };\n", '', 'offline')],
        ['the FIFO refusal removed (overtakes a queued write)', plant("    if (after.holds) return { status: 'refused', code: 'earlier_change_pending', message: EARLIER_CHANGE_PENDING_REASON };\n", '', 'fifo')],
        ['a transport drop reads as synced', plant("    if (isNetworkError(err)) return { status: 'unknown', error: msg };", "    if (isNetworkError(err)) return { status: 'synced' };", 'transport')],
      ];
      mutants.forEach(([, code], i) => writeFileSync(join(dir, `offlineQueue-m${i}.ts`), code));
      mutants.forEach(([label], i) => {
        const r = runFixture(root, { MOMENTS_QUEUE_MODULE: pathToFileURL(join(dir, `offlineQueue-m${i}.ts`)).href });
        results.push([label, r.length > 0 && r.some((c) => !c.pass)]);
      });
    } catch (e) {
      results.push([`mutants built (${String(e)})`, false]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    for (const [name, red] of results) ok(`0.3 red on mutant: ${name}`, red, 'The fixture stayed green on a planted defect: it does not bite.');
  }

  // 0.5 the honest calls, executed
  const CTX = read('contexts/ProjectContext.tsx');
  const HOOK = read('hooks/useTimeEntries.ts');
  const WIP = read('contexts/WipContext.tsx');
  const ENGINE = read('utils/contractEngine.ts');
  const cases: [string, () => Promise<Fails> | Fails][] = [
    ['0.5 approveChangeOrder: status write first; failed -> nothing local; synced/queued -> approved with the reflow exactly once; a second approve respects the reflow marker', () => checkApprove(CTX)],
    ['0.5 closeProjectDetailed: the close written first; failed -> nothing local; synced/queued -> the punch list\'s own close', () => checkCloseProject(CTX)],
    ['0.5 signFieldTicket: online-only; local state only on synced; a sealed ticket refused with nothing sent; no account refused', () => checkSignFieldTicket(CTX)],
    ['0.5 saveAIAPayAppOnline: online-only upsert; local state only on synced; nothing queued on refused/unknown', () => checkAiaOnline(CTX)],
    ['0.5 useTimeEntries: planClockOut / planTeamShiftClose maths; clockOutDetailed / closeTeamShiftDetailed revert on failed, already / not_own / local', () => checkShifts(HOOK)],
    ['0.5 WipContext.lockPeriodDetailed: already / failed (unlocked again) / synced / local', () => checkLock(WIP)],
    ['0.5 contractStatusPatch is shared; setContractStatusDetailed is the online-only update', () => checkContract(ENGINE)],
  ];
  for (const [name, fn] of cases) {
    let fails: Fails;
    try { fails = await fn(); } catch (e) { fails = [`threw: ${String((e as Error)?.stack ?? e)}`]; }
    ok(name, fails.length === 0, fails.join('\n'));
  }
  // The old functions stay for their other callers.
  const kept: [string, RegExp][] = [
    ['ProjectContext.updateChangeOrder', /const updateChangeOrder = useCallback\(/],
    ['ProjectContext.updateProject', /const updateProject = useCallback\(/],
    ['ProjectContext.addFieldTicket', /const addFieldTicket = useCallback\(/],
    ['ProjectContext.updateFieldTicket', /const updateFieldTicket = useCallback\(/],
    ['ProjectContext.addAIAPayApp', /const addAIAPayApp = useCallback\(/],
  ];
  const keptHook: [string, RegExp][] = [['useTimeEntries.clockOut', /const clockOut = useCallback\(/], ['useTimeEntries.closeTeamShift', /const closeTeamShift = useCallback\(/]];
  const missing = [
    ...kept.filter(([, re]) => !re.test(CTX)).map(([n]) => n),
    ...keptHook.filter(([, re]) => !re.test(HOOK)).map(([n]) => n),
    ...(/const lockPeriod = useCallback\(/.test(WIP) ? [] : ['WipContext.lockPeriod']),
    ...(/export async function setContractStatus\(/.test(ENGINE) ? [] : ['contractEngine.setContractStatus']),
    ...(/export async function saveCloseoutBinder\(/.test(read('utils/closeoutBinderEngine.ts')) ? [] : ['closeoutBinderEngine.saveCloseoutBinder']),
  ];
  ok('0.5 additive: every old function stays for its other callers', missing.length === 0, missing.join(', '));
  ok('0.5 the new calls are on the provider values (crossDomain, the time-entries store, the WIP context)',
    /approveChangeOrder, closeProjectDetailed, signFieldTicket, saveAIAPayAppOnline,\n\s*\}\), \[/.test(CTX)
      && /clockOutDetailed,\n[\s\S]{0,200}closeTeamShiftDetailed,/.test(HOOK) && /return \{ periods, addPeriod, lockPeriod, lockPeriodDetailed, updatePeriod \};/.test(WIP));

  // 0.6 whole-sentence copy (the real module) + mutation proof
  const cc = await checkCommitCopy(commitReal);
  ok('0.6 runCommit uses writeOptions.copy (refused / timeout / legalQueued / transport) as whole sentences; the English frames are a byte-identical fallback; offlineLegalReason(kind)', cc.length === 0, cc.join('\n'));
  {
    const dir = mkdtempSync(join(tmpdir(), 'moments-copy-mut-'));
    const results: [string, boolean][] = [];
    try {
      const nwAbs = join(root, 'utils', 'networkErrors.ts');
      const src = readFileSync(join(root, 'utils/moments/commitResult.ts'), 'utf8').replace("from '@/utils/networkErrors'", `from ${JSON.stringify(nwAbs)}`);
      const plant = (from: string, to: string, label: string) => {
        const out = src.replace(from, to);
        if (out === src) throw new Error(`mutant ${label}: anchor not found`);
        return out;
      };
      const mutants: [string, string][] = [
        ['copy.refused ignored', plant('return given(opts.copy?.refused) ?? genericRefusedCopy', 'return genericRefusedCopy', 'refused')],
        ['copy.timeout ignored', plant('return given(opts.copy?.timeout) ?? timeoutCopy', 'return timeoutCopy', 'timeout')],
        ['the certifying offline sentence built from a noun', plant(`certifying: "You're offline. Certifying needs a connection.",`, `certifying: "You're offline. " + 'certifying' + ' needs a connection.',`, 'offline')],
      ];
      mutants.forEach(([, code], i) => writeFileSync(join(dir, `commitResult-m${i}.ts`), code));
      for (let i = 0; i < mutants.length; i++) {
        const mod = (await import(pathToFileURL(join(dir, `commitResult-m${i}.ts`)).href)) as CommitMod;
        results.push([mutants[i][0], (await checkCommitCopy(mod)).length > 0]);
      }
    } catch (e) {
      results.push([`mutants built (${String(e)})`, false]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    for (const [name, red] of results) ok(`0.6 red on mutant: ${name}`, red, 'The check stayed green on a planted defect: it does not bite.');
  }
  // 0.5 mutation proof on the executed context text
  {
    const results: [string, boolean][] = [];
    const plant = (src: string, from: string, to: string) => { const o = src.replace(from, to); return o === src ? null : o; };
    const m1 = plant(CTX, "    if (outcome === 'failed') return 'failed';\n    // Stored (or safely queued behind its create)", '    // Stored (or safely queued behind its create)');
    results.push(['approveChangeOrder applies the cascade on failed', !!m1 && (await checkApprove(m1)).length > 0]);
    const m2 = plant(HOOK, "      return 'failed';\n    }\n    cancelShiftAlert(entryId);\n    return outcome;", "    }\n    cancelShiftAlert(entryId);\n    return outcome;");
    results.push(['clockOutDetailed keeps the clock-out on failed', !!m2 && (await checkShifts(m2.replace(/setEntries\(prev => prev\.map\(x => x\.id === entryId\n\s*\? \{\n\s*\.\.\.x,\n\s*status: prior\.status,[\s\S]*?: x\)\);\n/, ''))).length > 0]);
    const m3 = plant(CTX, "      if (res.status !== 'synced') return { status: res.status, ...(res.code ? { code: res.code } : {}), ...(res.message ? { message: res.message } : {}) };\n      if (res.landedEarlier) {", '      if (res.landedEarlier) {');
    results.push(['signFieldTicket commits a refused new ticket', !!m3 && (await checkSignFieldTicket(m3)).length > 0]);
    const m4 = plant(WIP, "    if (target.lockedAt) return 'already';\n", '');
    results.push(['lockPeriodDetailed re-locks a locked period', !!m4 && (await checkLock(m4)).length > 0]);
    for (const [name, red] of results) ok(`0.5 red on mutant: ${name}`, red, 'The check stayed green on a planted defect (or the anchor moved): it does not bite.');
  }

  // 0.6 plumbing (source pins; the components import react-native)
  const slide = read('components/moments/SlideToConfirm.tsx');
  const hook = read('components/moments/core/useCommitCapsule.ts');
  const cer = read('components/moments/signing/SigningCeremony.tsx');
  const contract = read('components/moments/core/contract.ts');
  const pc = cer.indexOf('const playConfirmed = async');
  const pcHead = pc >= 0 ? cer.slice(pc, cer.indexOf('\n    // Hand-off: the seal appears', pc)) : '';
  const neutralBranch = pcHead.slice(pcHead.indexOf('if (isNeutral) {'), pcHead.indexOf("return 'neutral';", pcHead.indexOf('if (isNeutral) {')));
  const pins: [string, boolean][] = [
    // The host's late handler runs first, then the slide says the answer in the toast (sayCommitResult).
    ['SlideToConfirm: onLateResult passthrough (the host first, then the toast)', /onLateResult\?: \(r: CommitResult\) => void;/.test(slide) && /onLateResult: \(r: CommitResult\) => \{\s*try \{ props\.onLateResult\?\.\(r\); \} finally \{ if \(say\) sayCommitResult\(r\); \}/.test(slide)],
    ['SlideToConfirm: onDone and onResultAfterUnmount run the host first, then say the result (onDone quietly: the capsule already buzzed)',
      /onDone: \(r: CommitResult\) => \{\s*try \{ props\.onDone\?\.\(r\); \} finally \{ if \(say\) sayCommitResult\(r, \{ quiet: true \}\); \}/.test(slide)
      && /onResultAfterUnmount: \(r: CommitResult\) => \{\s*try \{ props\.onResultAfterUnmount\?\.\(r\); \} finally \{ if \(say\) sayCommitResult\(r\); \}/.test(slide)
      && /const say = props\.say !== false;/.test(slide)],
    ['sayCommitResult: the green check (nailIt) only for confirmed; queued and timeout are neutral (notice), refused is oops',
      (() => {
        const say = read('utils/moments/sayResult.ts');
        const arm = (st: string) => { const at = say.indexOf(`case '${st}':`); return at < 0 ? '' : say.slice(at, say.indexOf('return;', at)); };
        return (say.match(/\bnailIt\(/g) ?? []).length === 1 && /nailIt\(r\.title, toast\)/.test(arm('confirmed'))
          && /notice\(r\.title \?\? momentCopy\(\)\.queued, \{ \.\.\.toast, icon: 'clock' \}\)/.test(arm('queued'))
          && /oops\(r\.reason, toast\)/.test(arm('refused'))
          && /notice\(r\.message, \{ \.\.\.toast, icon: 'alert' \}\)/.test(arm('timeout'));
      })()],
    ['SlideToConfirm: the offline reason is the site sentence (offlineReasonLine)', /legal && props\.offline \? offlineReasonLine\(props\.writeOptions\)/.test(slide)],
    ['useCommitCapsule: runCommit gets onLateResult (latest listener)', /runCommit\(opts\.write, \{\s*\.\.\.opts\.writeOptions,[\s\S]{0,200}onLateResult: \(late\) => \{ try \{ optsRef\.current\.onLateResult\?\.\(late\);/.test(hook)],
    ['useCommitCapsule: the uncommit legalQueued line is the site sentence', /legalQueuedLine\(optsRef\.current\.writeOptions\)/.test(hook) && !/legalQueuedCopy\(/.test(hook)],
    ['SigningCeremony: onLateResult / onCommitStart / onUncommit passthrough', /onLateResult: props\.onLateResult,/.test(cer) && /propsRef\.current\.onCommitStart\?\.\(\)/.test(cer) && /propsRef\.current\.onUncommit\?\.\(r\)/.test(cer)],
    ['SigningCeremony: `above` renders above the card, dimmed with the fields and locked from commit to un-commit (and once stored)', /\{props\.above != null && !folded \? \(\s*<Animated\.View\s*style=\{\[st\.above, \{ opacity: fieldsO \}\]\}\s*pointerEvents=\{locked \|\| done \? 'none' : 'auto'\}/.test(cer)],
    ['SigningCeremony: isNeutral resolves before any seal, with no success haptic and a plain record line', !!neutralBranch && /setNeutral\(r\.title\)/.test(neutralBranch) && !/momentHaptic\('success'\)|setSeal\(|drawArcs|checkShort|checkLong/.test(neutralBranch)],
    ['useCommitCapsule: a skin\'s neutral resolve leaves the capsule display in the cap role, never success', /const how = await play\(ctx\);/.test(hook) && /role: how === 'neutral' \? 'cap' : 'success'/.test(hook) && /playConfirmed\?: \(ctx: ConfirmedContext\) => Promise<void \| 'neutral'>;/.test(hook)],
    ['SigningCeremony: the offline reason in readiness is the site sentence', /offlineReason: offlineReasonLine\(props\.writeOptions\)/.test(cer)],
    ['contract.ts re-exports the Step 0 names (adapters, copy constants, sentence resolvers)', ['fromWriteOutcome', 'fromOnlineOutcome', 'offlineReasonLine', 'legalQueuedLine', 'LOCAL_ONLY_TITLE', 'LOCAL_ONLY_NEXT', 'EARLIER_CHANGE_PENDING_REASON', 'CommitOutcomeCopy', 'OnlineRefusalCode'].every((n) => contract.includes(n))],
    ['validate-moments discovers every module and requires capsule, signline, adapters, step0, rules, portal', /const REQUIRED = \['capsule', 'signline', 'adapters', 'step0', 'rules', 'portal'\];/.test(read('scripts/validate-moments.ts')) && /readdirSync\(dir\)\.filter\(\(f\) => f\.endsWith\('\.ts'\)\)/.test(read('scripts/validate-moments.ts'))],
  ];
  for (const [name, pass] of pins) ok(`0.6 ${name}`, pass);
}
