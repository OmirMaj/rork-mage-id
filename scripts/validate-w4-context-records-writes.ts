// validate-w4-context-records-writes.ts — wave 4, lane context-records.
//
// Record writes in contexts/ProjectContext.tsx, run from the SHIPPED source
// (pure helpers imported; provider callbacks extracted and executed against
// stubs; the punch-batch pure block lifted and executed):
//
//   #30  a new RFI / submittal carries its reply-link token from birth —
//        minted on the device by expo-crypto's CSPRNG (never generateUUID,
//        whose Math.random fallback would make the bearer credential
//        guessable), sent on the INSERT only, never nulled by an update; a
//        kept device row takes the server's token when it has none.
//   #40  co_append_audit's co_denied / 42501 drops the owed entries only for a
//        live bearer and a CO known to be on the server; an insert on the wire
//        waits; retryPendingCoAudit skips it.
//   #46/#53/#140  punch UPDATEs are patch-scoped: a due-date edit, a reassign,
//        a sub rename from a stale copy can no longer write status over the
//        sub's "Mark fixed" (server replay).
//   #27  submittal_append_review_cycle's 'already_closed' reverts, re-reads,
//        and says the reviewer already returned the cycle.
//   #29  only a queued INSERT (or a queued cycle patch) routes a cycle through
//        the queue; a queued title edit does not.
//   #63  daily reports carry their author (filedByUserId) locally from birth.
//   #118 plan_sheets.user_id → PlanSheet.userId, stamped on local imports;
//        deleting the latest revision un-supersedes its predecessor.
//   co-workflow handoffs: #79 marked_approved, #73 revises_change_order_id,
//        #77/#141 server CO numbers remembered + re-pulled.
//
// Run via: bun run scripts/validate-w4-context-records-writes.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { punchListTypeOf } from '../types';
import type { PunchItem } from '../types';
import { isDeviceLocalUri } from '../utils/photoUploadCore';
import {
  mintedShareToken, withServerShareToken, classifyCoAuditError, coAuditRefusalIsFinal, submittalCycleQueueHold,
  closeCycleHoldReason, alreadyClosedCycleReason, withMarkedApproved, planSheetsAfterDelete, bearerTokenForRead,
  chunkForAppend, newAuditEntries, rowPatch, SUBMITTAL_FIELD_COLUMNS, submittalIntakeColumns, dailyReportColumns,
} from '../utils/projectContextPure';
import { runCallback } from './validate-context-money-portal-writes';

declare const Bun: { Transpiler: new (opts: { loader: 'ts' }) => { transformSync: (code: string) => string } };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CTX = readFileSync(join(ROOT, 'contexts/ProjectContext.tsx'), 'utf8');

let passes = 0;
let failures = 0;
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { passes++; console.log('  ✓', label); }
  else { failures++; console.error('  ✗', label, detail ? `\n      ${detail}` : ''); }
}
function between(src: string, start: string, end: string): string {
  const i = src.indexOf(start);
  if (i < 0) return '';
  const j = src.indexOf(end, i + start.length);
  return j < 0 ? '' : src.slice(i, j);
}
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const CODE = stripComments(CTX);
const tick = () => new Promise(r => setTimeout(r, 5));
type Row = Record<string, unknown>;
type Scope = Record<string, unknown>;

async function main() {
  // ── #30 · the reply-link token ─────────────────────────────────────────────
  console.log('\n#30 a new RFI / submittal has its reply-link token from birth');
  {
    const u = randomUUID();
    ok('mintedShareToken takes a CSPRNG uuid', mintedShareToken(() => u.toUpperCase()) === u);
    ok('…a minter that throws gives undefined (the column default then mints)', mintedShareToken(() => { throw new Error('no native module'); }) === undefined);
    ok('…and a non-uuid is refused, never sent as a credential', mintedShareToken(() => 'abc') === undefined && mintedShareToken(() => '') === undefined);
    ok('the provider mints with expo-crypto',
      /import \* as Crypto from 'expo-crypto';/.test(CTX)
        && /const mintShareToken = \(\): string \| undefined => mintedShareToken\(\(\) => Crypto\.randomUUID\(\)\);/.test(CODE));
    ok('generateUUID never feeds a shareToken / share_token (Math.random fallback on Hermes)',
      !/(shareToken|share_token)\s*[:=][^,\n;]*generateUUID/.test(CODE) && !/generateUUID[^\n]*(shareToken|share_token)/.test(CODE));
    const addRfi = between(CODE, 'const addRFI = useCallback(', '\n  }, [');
    const addRfis = between(CODE, 'const addRFIs = useCallback(', '\n  }, [');
    const buildSub = between(CODE, 'const buildSubmittal = useCallback(', '\n  }, [');
    ok('addRFI, addRFIs and buildSubmittal (addSubmittal/s) each mint a fresh token',
      [addRfi, addRfis, buildSub].every(b => /shareToken: mintShareToken\(\),/.test(b)));

    // Execute the row builders.
    const rfiMutableRow = runCallback<(r: Row) => Row>(CTX, 'rfiMutableRow', {});
    const rfiToRow = runCallback<(r: Row) => Row>(CTX, 'rfiToRow', { userId: 'u1', rfiMutableRow });
    const rfi = { id: 'r1', projectId: 'p1', number: 3, subject: 's', question: 'q', attachments: [], createdAt: 't', updatedAt: 't', shareToken: u };
    ok('rfiToRow (INSERT) sends share_token', rfiToRow(rfi).share_token === u);
    ok('…and leaves it out when the mint fell back (the column default applies)', !('share_token' in rfiToRow({ ...rfi, shareToken: undefined })));
    ok('rfiMutableRow (every UPDATE) never names share_token — no edit can null it', !('share_token' in rfiMutableRow(rfi)));
    const submittalMutableRow = runCallback<(s: Row) => Row>(CTX, 'submittalMutableRow', { submittalIntakeColumns });
    ok('submittalMutableRow never names share_token either', !('share_token' in submittalMutableRow({ id: 's1', reviewCycles: [] })));
    const buildSubmittal = runCallback<(s: Row, base: Row[]) => { newSub: Row; row: Row }>(CTX, 'buildSubmittal', {
      userId: 'u1', submittalMutableRow, generateUUID: () => 's-new', initialPortalState: () => 'draft',
      mintShareToken: () => mintedShareToken(randomUUID),
    });
    const built = buildSubmittal({ projectId: 'p1', title: 'Steel', reviewCycles: [] }, []);
    ok('a built submittal carries the token and its INSERT sends the same one',
      typeof built.newSub.shareToken === 'string' && built.row.share_token === built.newSub.shareToken);

    // addRFI end to end: the device copy has the token the INSERT carries.
    const writes: { table: string; op: string; data: Row }[] = [];
    const rfisRef = { current: [] as Row[] };
    const addRFI = runCallback<(r: Row) => Row>(CTX, 'addRFI', {
      rfisRef, setRfis: () => {}, saveRfisMutation: { mutate: () => {} }, canSync: true, initialPortalState: () => 'draft',
      nextRfiNumber: () => 1, rfiToRow, generateUUID: () => 'r-new', proDocWriteTouchRef: { current: new Map() },
      touchedWrite: (_ref: unknown, _id: string, fn: () => unknown) => fn(),
      supabaseWrite: async (table: string, op: string, data: Row) => { writes.push({ table, op, data }); },
      mintShareToken: () => mintedShareToken(randomUUID),
    });
    const made = addRFI({ projectId: 'p1', subject: 'Header height', question: '?', attachments: [] });
    ok('addRFI: the device copy has a token at once (Send to Architect has its reply link offline)', typeof made.shareToken === 'string' && made.shareToken.length === 36);
    ok('…and the queued INSERT carries that same token', writes.length === 1 && writes[0].data.share_token === made.shareToken, JSON.stringify(writes[0]?.data));

    // The loaders' combine.
    const local = { id: 'r1', subject: 'edited on the phone', shareToken: undefined as string | undefined, createdAt: '' };
    const server = { id: 'r1', subject: 'server', shareToken: u, createdAt: '2026-09-20T10:00:00Z' };
    const c = withServerShareToken(local, server);
    ok('withServerShareToken: a kept device row takes the server token / created_at it lacks', c.shareToken === u && c.createdAt === server.createdAt && c.subject === 'edited on the phone');
    const own = { ...local, shareToken: 'mine', createdAt: 'x' };
    ok('…and keeps its own when it has one (same object)', withServerShareToken(own, server) === own);
    const rfisLoader = between(CODE, "const rfisQuery = useQuery({", "const submittalsQuery = useQuery({");
    const subsLoader = between(CODE, "const submittalsQuery = useQuery({", "const oacMeetingsQuery = useQuery({");
    ok('the rfis and submittals loaders merge with combine: withServerShareToken',
      /combine: withServerShareToken/.test(rfisLoader) && /combine: withServerShareToken/.test(subsLoader));
  }

  // ── #40 · co_append_audit refusals ─────────────────────────────────────────
  console.log('\n#40 a transient co_denied / 42501 never drops CO audit entries');
  {
    ok('classify: co_denied → row_or_session', classifyCoAuditError({ message: 'co_denied' }) === 'row_or_session');
    ok('classify: 42501 with no message → row_or_session', classifyCoAuditError({ code: '42501' }) === 'row_or_session');
    ok('classify: co_audit_bad_entries / too_many → payload (final)', classifyCoAuditError({ message: 'co_audit_bad_entries' }) === 'payload' && classifyCoAuditError({ message: 'co_audit_too_many', code: '42501' }) === 'payload');
    ok('classify: anything else → transient', classifyCoAuditError({ message: 'canceling statement due to statement timeout', code: '57014' }) === 'transient');
    const live = { bearerBefore: true, bearerAfter: true, insertInFlight: false, queued: false };
    ok('final only for a live bearer and a CO known to be on the server', coAuditRefusalIsFinal(live));
    ok('…not when the request went out without a bearer', !coAuditRefusalIsFinal({ ...live, bearerBefore: false }));
    ok('…not when the session is gone now', !coAuditRefusalIsFinal({ ...live, bearerAfter: false }));
    ok('…not while its INSERT is on the wire', !coAuditRefusalIsFinal({ ...live, insertInFlight: true }));
    ok('…not while a write of it is queued', !coAuditRefusalIsFinal({ ...live, queued: true }));

    const entry = { id: 'sig', action: 'client_signed_via_portal', actor: 'client', timestamp: 't', detail: 'in person' };
    const run = async (o: { session: boolean; queued: boolean; inFlight: boolean; unsaved?: boolean; message?: string; code?: string }) => {
      const rpc: string[] = [];
      const pendingCoAuditRef = { current: new Map<string, unknown[]>() };
      const inserts = new Map<string, Promise<string>>();
      if (o.inFlight) inserts.set('c7', new Promise(() => {}));
      const sc: Scope = {
        supabase: {
          auth: { getSession: async () => ({ data: { session: o.session ? { access_token: 'tok', expires_at: Math.floor(Date.now() / 1000) + 3600 } : null } }) },
          rpc: async (_fn: string, args: { p_co_id: string }) => { rpc.push(args.p_co_id); return { data: null, error: { message: o.message ?? 'co_denied', code: o.code ?? '42501' } }; },
        },
        bearerTokenForRead, bearerStillLive: async () => o.session, classifyCoAuditError, coAuditRefusalIsFinal,
        queuedIdsFor: async () => new Set(o.queued ? ['c7'] : []), unsavedWriteIds: async () => new Set(o.unsaved ? ['c7'] : []), changeOrderInsertsRef: { current: inserts },
        pendingCoAuditRef, coAuditLoadRef: { current: Promise.resolve() }, coAuditOwnerRef: { current: 'u1' },
        coAuditPersistChainRef: { current: Promise.resolve() }, coWriteTouchRef: { current: new Map() },
        saveLocal: async () => {}, CO_AUDIT_PENDING_KEY: 'mageid_co_audit_pending', newAuditEntries, chunkForAppend,
        canSync: true,
      };
      sc.beginCoWrite = runCallback(CTX, 'beginCoWrite', sc);
      sc.endCoWrite = runCallback(CTX, 'endCoWrite', sc);
      sc.persistCoAuditPending = runCallback(CTX, 'persistCoAuditPending', sc);
      sc.stashCoAudit = runCallback(CTX, 'stashCoAudit', sc);
      sc.appendCoAudit = runCallback(CTX, 'appendCoAudit', sc);
      sc.retryPendingCoAudit = runCallback(CTX, 'retryPendingCoAudit', sc);
      await (sc.appendCoAudit as (id: string, e: unknown[]) => Promise<void>)('c7', [entry]);
      await tick();
      return { rpc, pending: pendingCoAuditRef.current.has('c7'), sc };
    };
    const inflight = await run({ session: true, queued: false, inFlight: true });
    ok('Trigger A: the CO\'s INSERT is on the wire → no RPC, the signature stays owed', inflight.rpc.length === 0 && inflight.pending);
    const anon = await run({ session: false, queued: false, inFlight: false });
    ok('Trigger B: 42501 answered with no bearer (anon fallback) → the entries stay owed', anon.rpc.length === 1 && anon.pending);
    const queued = await run({ session: true, queued: true, inFlight: false });
    ok('co_denied while a write of the CO is queued → the entries stay owed', queued.pending);
    // context-join (#40 review): a write of the CO refused and parked in the
    // sync ledger — its INSERT is resent from the badge with the creation-time
    // audit_trail, so co_denied now must not drop the owed entries.
    const unsaved = await run({ session: true, queued: false, inFlight: false, unsaved: true });
    ok('co_denied while a write of the CO sits in the sync ledger → the entries stay owed', unsaved.rpc.length === 1 && unsaved.pending);
    const denied = await run({ session: true, queued: false, inFlight: false });
    ok('a genuine refusal (live bearer, CO on the server — not his CO) is still final', !denied.pending);
    const bad = await run({ session: false, queued: false, inFlight: false, message: 'co_audit_bad_entries', code: '22023' });
    ok('a payload refusal is final even without a bearer (resending cannot help)', !bad.pending);
    // retryPendingCoAudit skips an in-flight insert.
    {
      const rpc: string[] = [];
      const pendingCoAuditRef = { current: new Map<string, unknown[]>([['c1', [entry]], ['c2', [entry]]]) };
      const sc: Scope = {
        coAuditLoadRef: { current: Promise.resolve() }, canSync: true, pendingCoAuditRef,
        queuedIdsFor: async () => new Set<string>(), unsavedWriteIds: async () => new Set(['c3']), changeOrderInsertsRef: { current: new Map([['c2', new Promise(() => {})]]) },
        appendCoAudit: async (id: string) => { rpc.push(id); },
      };
      pendingCoAuditRef.current.set('c3', [entry]);
      const retry = runCallback<() => Promise<void>>(CTX, 'retryPendingCoAudit', sc);
      await retry();
      ok('retryPendingCoAudit skips a CO whose INSERT is on the wire or parked in the ledger (and retries the rest)', rpc.join() === 'c1', rpc.join());
    }
  }

  // ── #46/#53/#140 · patch-scoped punch updates ──────────────────────────────
  console.log('\n#46 #53 #140 a punch edit sends only what it changed (executed server replay)');
  {
    const block = between(CTX, '// ── punch-batch pure (begin)', '// ── punch-batch pure (end)');
    const durableFn = between(CTX, 'function durablePhotoValue(', '\n}');
    type Pure = {
      applyPunchBatchUpdate: (items: PunchItem[], ids: readonly string[], u: Partial<PunchItem>, now: string, finish?: (p: PunchItem) => PunchItem) =>
        { changed: PunchItem[]; cleared: Record<string, ('plan_sheet_id' | 'pin_x' | 'pin_y')[]>; touched: Record<string, (keyof PunchItem)[]> };
      punchItemToUpdateRow: (pi: PunchItem, now: string, clears?: readonly string[], scope?: readonly (keyof PunchItem)[]) => Row;
    };
    let pure: Pure | null = null;
    try {
      const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(`${durableFn}\n}\n${block}\n`);
      pure = new Function('isDeviceLocalUri', 'punchListTypeOf', `${js}\nreturn { applyPunchBatchUpdate, punchItemToUpdateRow };`)(isDeviceLocalUri, punchListTypeOf) as Pure;
    } catch (e) { ok('the punch-batch pure block evaluates standalone', false, String(e)); }
    if (pure) {
      const P = pure;
      const NOW = '2026-09-22T12:00:00.000Z';
      const mk = (extra: Partial<PunchItem> = {}): PunchItem => ({
        id: 'i1', projectId: 'p1', description: 'Outlet cover missing', location: 'Hall bath', assignedSub: 'Rivera Drywall', assignedSubId: 'sub-r',
        dueDate: '2026-09-25', priority: 'medium', status: 'open', createdAt: 't0', updatedAt: 't0', ...extra,
      } as PunchItem);
      const edit = (copy: PunchItem, patch: Partial<PunchItem>, finish?: (p: PunchItem) => PunchItem) => {
        const r = P.applyPunchBatchUpdate([copy], [copy.id], patch, NOW, finish);
        return P.punchItemToUpdateRow(r.changed[0], NOW, r.cleared[copy.id], r.touched[copy.id] ?? []);
      };
      const keys = (r: Row) => Object.keys(JSON.parse(JSON.stringify(r))).sort().join();
      // The server: the sub marked it fixed after the GC's copy loaded.
      const serverRow = (): Row => ({ id: 'i1', status: 'ready_for_review', sub_note: 'swapped the cover', due_date: '2026-09-25', priority: 'medium', assigned_sub: 'Rivera Drywall', assigned_sub_id: 'sub-r', list_type: 'punch' });
      const apply = (srv: Row, payload: Row): Row => ({ ...srv, ...(JSON.parse(JSON.stringify(payload)) as Row), id: srv.id });
      const stale = mk();

      const due = edit(stale, { dueDate: '2026-09-30' });
      ok('a due-date edit sends id, due_date, list_type, updated_at — nothing else', keys(due) === 'due_date,id,list_type,updated_at', keys(due));
      const after = apply(serverRow(), due);
      ok('…so the sub\'s ready_for_review and note survive the stale copy', after.status === 'ready_for_review' && after.sub_note === 'swapped the cover' && after.due_date === '2026-09-30');
      const prio = apply(serverRow(), edit(stale, { priority: 'high' }));
      ok('a priority edit leaves status alone too', prio.status === 'ready_for_review' && prio.priority === 'high');
      const rename = edit(stale, { assignedSub: 'Rivera Drywall LLC', assignedSubId: 'sub-r' });
      ok('the sub-rename patch sends only assigned_sub + assigned_sub_id (+ id, list_type, updated_at)',
        keys(rename) === 'assigned_sub,assigned_sub_id,id,list_type,updated_at', keys(rename));
      const reassign = edit(stale, { assignedSub: 'Typed name', assignedSubId: undefined });
      ok('a reassign to a typed name clears the id with an explicit NULL', reassign.assigned_sub_id === null && reassign.assigned_sub === 'Typed name');
      const close = edit(stale, { status: 'closed', closedAt: NOW });
      ok('a close names status: status + closed_at go', close.status === 'closed' && close.closed_at === NOW && !('rejection_note' in close));
      const reopen = edit(mk({ status: 'closed', closedAt: 't1' }), { status: 'open', closedAt: undefined });
      ok('a reopen clears closed_at with NULL (the old stamp does not linger)', reopen.status === 'open' && reopen.closed_at === null, JSON.stringify(reopen));
      const reject = edit(mk({ status: 'ready_for_review' }), { status: 'open', rejectionNote: 'Cover is cracked', rejectedAt: NOW });
      ok('a reject (names rejectedAt) sends status, rejection_note and rejected_at (CONTRACT 12)',
        reject.status === 'open' && reject.rejection_note === 'Cover is cracked' && reject.rejected_at === NOW);
      const noteOnly = edit(stale, { rejectionNote: 'typed but not a reject' });
      ok('a rejectionNote without rejectedAt is not a reject — neither column goes', !('rejection_note' in noteOnly) && !('rejected_at' in noteOnly));
      const all = [due, rename, reassign, close, reopen, reject, noteOnly];
      ok('no scoped payload ever carries sub_note', all.every(r => !('sub_note' in r)));
      ok('every scoped payload carries list_type explicitly', all.every(r => r.list_type === 'punch'));
      const staged = edit(stale, { photoUri: 'file:///var/mobile/p.jpg' }, (p) => ({ ...p, photoStoragePath: 'u1/p1/i1.jpg' }));
      ok('a photo attached later sends photo_uri as the staged storage path', staged.photo_uri === 'u1/p1/i1.jpg' && !('status' in staged), JSON.stringify(staged));
      const pinned = mk({ planSheetId: 's1', pinX: 0.2, pinY: 0.3 });
      const unpin = edit(pinned, { planSheetId: undefined, pinX: undefined, pinY: undefined });
      ok('Remove pin still reaches the server as NULLs', unpin.plan_sheet_id === null && unpin.pin_x === null && unpin.pin_y === null && !('status' in unpin));
      const statusOnPinned = edit(pinned, { priority: 'low' });
      ok('an edit of a pinned item does not resend its pin', !('plan_sheet_id' in statusOnPinned));
      const whole = P.punchItemToUpdateRow(stale, NOW);
      ok('control: the whole-row default (no scope) still sends status — the bug the scope closes', whole.status === 'open' && apply(serverRow(), whole).status === 'open');
      const upd = between(CODE, 'const updatePunchItems = useCallback(', '\n  }, [');
      ok('updatePunchItems passes each row\'s touched keys to punchItemToUpdateRow',
        /const \{ next, changed, cleared, touched \} = applyPunchBatchUpdate\(/.test(upd)
          && /supabaseWrite\('punch_items', 'update', punchItemToUpdateRow\(pi, now, cleared\[pi\.id\], touched\[pi\.id\] \?\? \[\]\)\)/.test(upd));
      ok('the punch loader reads rejected_at back', /rejectedAt: \(r\.rejected_at as string \| null\) \?\? undefined,/.test(CODE));
      ok('the sub rename still goes through the batch with only the two sub keys',
        /updatePunchItemsRef\.current\?\.\(follow, \{ assignedSub: newName, assignedSubId: id \}\)/.test(CODE));
    }
  }

  // ── #27 / #29 · review cycles ──────────────────────────────────────────────
  console.log('\n#27 #29 review cycles: the true reason, and no double round');
  {
    const q = (op: string, data: Row) => ({ table: 'submittals', operation: op, data: { id: 's1', ...data } });
    ok('hold: a queued INSERT → insert', submittalCycleQueueHold([q('insert', {})], 's1') === 'insert');
    ok('hold: a queued title-only UPDATE → none (the RPC goes direct)', submittalCycleQueueHold([q('update', { title: 'x', updated_at: 't' })], 's1') === null);
    ok('hold: a queued UPDATE carrying review_cycles → cycle_patch', submittalCycleQueueHold([q('update', { review_cycles: [] })], 's1') === 'cycle_patch');
    ok('hold: …or current_status → cycle_patch', submittalCycleQueueHold([q('update', { current_status: 'approved' })], 's1') === 'cycle_patch');
    ok('hold: another submittal\'s entries are ignored', submittalCycleQueueHold([{ table: 'submittals', operation: 'insert', data: { id: 's2' } }], 's1') === null);
    ok('the hold reasons differ, and only the network one blames the connection',
      /hasn't reached the server/.test(closeCycleHoldReason('insert', 2)) && /still syncing/.test(closeCycleHoldReason('cycle_patch', 2))
        && /needs a connection/.test(closeCycleHoldReason('network', 2)) && !/connection|signal/.test(closeCycleHoldReason('cycle_patch', 2)));
    const why = alreadyClosedCycleReason({ cycle_number: 2, status: 'approved_as_noted' }, 9);
    ok('already_closed names the cycle and the reviewer\'s stamp', /Cycle 2 \(Approved as noted\)/.test(why) && /nothing was added/.test(why), why);

    const runCycle = async (o: { queue: Row[]; rpc?: Row; closes?: boolean }) => {
      const calls: string[] = [];
      const alerts: string[] = [];
      const invalidated: unknown[] = [];
      const open = { cycleNumber: 2, sentDate: '2026-09-10', reviewer: 'Arch', status: 'in_review' };
      const submittalsRef = { current: [{ id: 's1', projectId: 'p1', number: 3, reviewCycles: [{ cycleNumber: 1, sentDate: '2026-09-01', returnDate: '2026-09-05', reviewer: 'Arch', status: 'revise_resubmit' }, open], currentStatus: 'in_review' }] as Row[] };
      const sc: Scope = {
        submittalsRef, setSubmittals: () => {}, saveSubmittalsMutation: { mutate: () => {} }, canSync: true, userId: 'u1',
        submittalMutableRow: runCallback(CTX, 'submittalMutableRow', { submittalIntakeColumns }), rowPatch, SUBMITTAL_FIELD_COLUMNS,
        queryClient: { invalidateQueries: (k: unknown) => { invalidated.push(k); return Promise.resolve(); } },
        showAlert: (_t: string, m: string) => { alerts.push(m); },
        getOfflineQueue: async () => o.queue, submittalCycleQueueHold, closeCycleHoldReason, alreadyClosedCycleReason,
        looksLikeNetworkFailure: (m: string) => /network/i.test(m ?? ''),
        supabase: { rpc: async (fn: string) => { calls.push(`rpc:${fn}`); return { data: o.rpc ?? { success: true, cycle_number: 3 }, error: null }; } },
        addToOfflineQueue: async () => { calls.push('enqueue'); }, proDocWriteTouchRef: { current: new Map() },
        touchedWrite: (_r: unknown, _id: string, fn: () => unknown) => fn(), supabaseWrite: async () => { calls.push('write'); },
      };
      const add = runCallback<(id: string, c: Row) => Promise<{ ok: boolean; reason?: string; queued?: boolean }>>(CTX, 'addReviewCycle', sc);
      const res = await add('s1', { sentDate: '2026-09-10', returnDate: '2026-09-18', reviewer: 'Arch', status: 'approved', closesOpenCycle: o.closes ?? false });
      await tick();
      return { res, calls, alerts, invalidated, sub: submittalsRef.current[0] };
    };
    const titleQueued = await runCycle({ queue: [q('update', { title: 'typo fixed', updated_at: 't' })], closes: true });
    ok('#29 a queued title edit does not block Close Cycle: the RPC goes out', titleQueued.calls.join() === 'rpc:submittal_append_review_cycle' && titleQueued.res.ok, titleQueued.calls.join());
    const cyclePatch = await runCycle({ queue: [q('update', { review_cycles: [], current_status: 'in_review' })], closes: true });
    ok('#29 a queued cycle patch: Close is refused with "still syncing", not "needs a connection"',
      !cyclePatch.res.ok && /still syncing/.test(cyclePatch.res.reason ?? '') && cyclePatch.calls.length === 0, JSON.stringify(cyclePatch.res));
    const insertQueued = await runCycle({ queue: [q('insert', {})] });
    ok('#29 a queued INSERT: a new cycle rides the queue behind it', insertQueued.res.ok && insertQueued.res.queued === true && insertQueued.calls.join() === 'enqueue', insertQueued.calls.join());
    const closed = await runCycle({ queue: [], closes: true, rpc: { success: false, error: 'already_closed', cycle_number: 2, status: 'approved_as_noted' } });
    ok('#27 already_closed: not ok, and the reason says the reviewer returned Cycle 2', !closed.res.ok && /reviewer already returned Cycle 2/.test(closed.res.reason ?? ''), JSON.stringify(closed.res));
    ok('…the provisional close is taken back off the device copy', (closed.sub.reviewCycles as Row[])[1].status === 'in_review');
    ok('…and the submittals list is re-read so the reviewer\'s stamp shows', JSON.stringify(closed.invalidated).includes('"submittals","u1"'), JSON.stringify(closed.invalidated));
  }

  // ── co-workflow handoffs ───────────────────────────────────────────────────
  console.log('\n#79 #73 #77/#141 change-order handoffs');
  {
    const e = (id: string, action: string) => ({ id, action, actor: 'x', timestamp: 't' });
    const next = withMarkedApproved([e('a', 'created')], [e('a', 'created')], { id: 'm', actor: 'gc@x.com', timestamp: 'now' });
    ok('withMarkedApproved appends one entry with the GC as actor', next.length === 2 && next[1].action === 'marked_approved' && next[1].actor === 'gc@x.com');
    ok('…and never a second when this edit already carries one', withMarkedApproved([e('a', 'created')], [e('a', 'created'), e('m0', 'marked_approved')], { id: 'm', actor: 'g', timestamp: 'n' }).length === 2);
    ok('…but a prior approval\'s mark does not suppress a new one', withMarkedApproved([e('m0', 'marked_approved')], [e('m0', 'marked_approved')], { id: 'm', actor: 'g', timestamp: 'n' }).length === 2);
    const updCo = between(CODE, 'const updateChangeOrder = useCallback(', '\n  }, [');
    ok('updateChangeOrder marks a non-portal approval (never the reconciler\'s deferReflow)',
      /if \(becameApproved && !reflow\?\.deferReflow\) \{[\s\S]{0,300}withMarkedApproved\(prior\?\.auditTrail, c\.auditTrail,/.test(updCo));
    ok('…before the audit append is computed (so the mark reaches co_append_audit)',
      updCo.indexOf('withMarkedApproved(') > 0 && updCo.indexOf('withMarkedApproved(') < updCo.indexOf('const auditToAppend = newAuditEntries('));
    const toRow = runCallback<(co: Row) => Row>(CTX, 'changeOrderToRow', { changeOrderTaxColumns: () => ({}) });
    ok('#73 changeOrderToRow writes revises_change_order_id when set', toRow({ id: 'c2', revisesChangeOrderId: 'c1' }).revises_change_order_id === 'c1');
    ok('…and names no such column otherwise (a server without it keeps syncing)', !('revises_change_order_id' in toRow({ id: 'c2' })));
    const coLoader = between(CODE, "const changeOrdersQuery = useQuery({", 'const kept = mergeServerKeepingPending(');
    ok('#73 the change_orders read maps revises_change_order_id back', /revisesChangeOrderId: \(r\.revises_change_order_id as string \| null\) \?\? undefined,/.test(coLoader));
    ok('#77/#141 the read seeds the confirmed CO numbers from the MAPPED SERVER rows, before the device merge',
      /rememberServerChangeOrderNumbers\(mapped\.map\(c => \(\{ id: c\.id, number: c\.number \}\)\)\);/.test(coLoader));
    const addCos = between(CODE, 'const addChangeOrders = useCallback(', '\n  }, [');
    ok('#77/#141 a direct INSERT that synced re-pulls the change orders (a renumber reaches every surface)',
      /insert\.then\(\(o\) => \{ if \(o === 'synced'\) void queryClient\.invalidateQueries\(\{ queryKey: \['changeOrders', userId\] \}\); \}\)/.test(addCos));
  }

  // ── #63 · the report's author ──────────────────────────────────────────────
  console.log('\n#63 a daily report knows who filed it');
  {
    ok('the loader maps user_id → filedByUserId', /filedByUserId: \(r\.user_id as string \| null\) \?\? undefined,/.test(CODE));
    const addDr = between(CODE, 'const addDailyReport = useCallback(', '\n  }, [');
    ok('addDailyReport stamps the author on the device copy', /filedByUserId: report\.filedByUserId \?\? userId \?\? undefined,/.test(addDr));
    const cols = dailyReportColumns({ date: 'd', weather: {}, manpower: [], workPerformed: '', materialsDelivered: [], issuesAndDelays: '', status: 'draft', filedByUserId: 'u2' } as never, { photos: [] });
    ok('…and no edit payload names user_id (the author is insert-only)', !('user_id' in cols) && !('filed_by_user_id' in cols));
  }

  // ── #118 · plan sheets ─────────────────────────────────────────────────────
  console.log('\n#118 plan sheets: the uploader, and a deleted revision gives back the current sheet');
  {
    const s = (id: string, extra: Row = {}) => ({ id, previousSheetId: undefined as string | undefined, superseded: false, ...extra });
    const chain = [s('a1', { superseded: true }), s('a2', { previousSheetId: 'a1' })];
    const r = planSheetsAfterDelete(chain, 'a2', 'now');
    ok('deleting the latest revision un-supersedes the one it replaced', r.restoredId === 'a1' && r.list.length === 1 && r.list[0].superseded === false);
    const r2 = planSheetsAfterDelete([s('a1', { superseded: true }), s('a2', { previousSheetId: 'a1', superseded: true }), s('a3', { previousSheetId: 'a2' })], 'a2', 'now');
    ok('deleting an OLD (superseded) revision restores nothing', r2.restoredId === null && r2.list.length === 2);
    const r3 = planSheetsAfterDelete([s('a1', { superseded: true }), s('a2', { previousSheetId: 'a1' }), s('a2b', { previousSheetId: 'a1' })], 'a2', 'now');
    ok('…nor when another live sheet still replaces the predecessor', r3.restoredId === null);
    ok('a sheet with no chain just goes', planSheetsAfterDelete([s('x')], 'x', 'now').restoredId === null);

    const writes: { op: string; data: Row }[] = [];
    let persisted: Row[] = [];
    const planSheetsRef = { current: chain as Row[] };
    const del = runCallback<(id: string) => void>(CTX, 'deletePlanSheet', {
      planSheetsRef, persistPlanSheets: (l: Row[]) => { persisted = l; }, planSheetsAfterDelete,
      drawingPins: [], planMarkups: [], planCalibrations: [], persistDrawingPins: () => {}, persistPlanMarkups: () => {}, persistPlanCalibrations: () => {},
      canSync: true, planWriteTouchRef: { current: new Map() },
      trackedWrite: (_r: unknown, _t: string, op: string, data: Row) => { writes.push({ op, data }); return Promise.resolve('synced'); },
    });
    del('a2');
    ok('deletePlanSheet: the device list keeps a1, now current', persisted.length === 1 && persisted[0].id === 'a1' && persisted[0].superseded === false);
    ok('…and the server gets the delete and the un-supersede', writes.map(w => `${w.op}:${w.data.id}`).join() === 'delete:a2,update:a1' && writes[1].data.superseded === false, JSON.stringify(writes));
    ok('the plan_sheets read maps user_id → userId', /userId: \(r\.user_id as string \| null\) \?\? undefined,\n\s*\}\)\) as PlanSheet\[\];/.test(CODE));
    ok('commitPlanSheets stamps the uploader on local imports',
      /const sheets = incoming\.map\(sh => \(sh\.userId \? sh : \{ \.\.\.sh, userId: userId \?\? undefined \}\)\);\s*const fold = foldPlanSheets\(planSheetsRef\.current, sheets, \{/.test(CODE));
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

void main().catch((e) => { console.error(e); process.exit(1); });
