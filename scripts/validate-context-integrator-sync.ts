// scripts/validate-context-integrator-sync.ts — wave 3, lane context-integrator.
//
// Pins, by EXECUTING the pure helpers and slicing the provider's real lines:
//   #55  RFI / submittal edits write only the changed columns (rowPatch over the
//        insert's own row builder) + updated_at, per rfi-core's CLIENT WRITE
//        CONTRACT (20260919080000); review cycles go through
//        submittal_append_review_cycle; rfis/submittals refetch on foreground.
//   #112 a queued edit keeps the LOCAL row over a refetch; a queued delete stays
//        gone; an empty successful read is authoritative (queued creates kept)
//        only when it was answered to this user's live bearer.
//   #56  NotificationContext re-reads rfis / submittals on their UPDATEs, and
//        the realtime publication migration adds both tables.
//   #74  plans re-read on foreground / after a plan flush, never over queued
//        plan writes, never re-painting the disk copy.
//   #18 / #16 / #111 / #60 / #144  the punch and submittal mapper carries.
// Run: bun run scripts/validate-context-integrator-sync.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mergeLocalOnly, mergeServerKeepingPending, pendingDeleteIdsForTable, pendingIdsForTable, emptyReadAuthoritative,
  rowPatch, RFI_FIELD_COLUMNS, SUBMITTAL_FIELD_COLUMNS, RFI_GUARDED_COLUMNS, SUBMITTAL_GUARDED_COLUMNS,
  submittalIntakeColumns, submittalIntakeFromRow, punchServerOwnedFromRow, combinePunchPending,
  planWritesQueued, unionServerFirst, keepPendingPinFields, bearerTokenForRead, BEARER_READ_RUNWAY_MS,
  planProDocEdit, serverStampAdoptable, idsWrittenDuringRead,
} from '../utils/projectContextPure';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const CTX = read('contexts/ProjectContext.tsx');
const NOTIF = read('contexts/NotificationContext.tsx');
const TYPES = read('types/index.ts');

let passed = 0; let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}
function slice(src: string, start: string, end: string): string {
  const i = src.indexOf(start);
  if (i < 0) return '';
  const j = src.indexOf(end, i + start.length);
  return j < 0 ? '' : src.slice(i, j + end.length);
}

// ─── #112 · the merge ─────────────────────────────────────────────────────
console.log('\n#112 — a refetch never undoes a queued edit or delete:');
{
  type Row = { id: string; status: string };
  const queue = [
    { table: 'punch_items', operation: 'update', data: { id: 'closed-offline', status: 'closed' } },
    { table: 'punch_items', operation: 'delete', data: { id: 'deleted-offline' } },
    { table: 'punch_items', operation: 'insert', data: { id: 'created-offline' } },
  ];
  const server: Row[] = [
    { id: 'closed-offline', status: 'open' }, { id: 'deleted-offline', status: 'open' }, { id: 'other', status: 'open' },
  ];
  const local: Row[] = [
    { id: 'closed-offline', status: 'closed' }, { id: 'created-offline', status: 'open' }, { id: 'other', status: 'closed-here-but-not-queued' },
  ];
  const pending = pendingIdsForTable(queue, 'punch_items');
  const deleted = pendingDeleteIdsForTable(queue, 'punch_items');
  const merged = mergeLocalOnly(server, local, pending, { deletedIds: deleted });
  ok('a queued update keeps the LOCAL row (closed stays closed)', merged.find(r => r.id === 'closed-offline')?.status === 'closed', JSON.stringify(merged));
  ok('a queued delete stays gone (the server copy is left out)', !merged.some(r => r.id === 'deleted-offline'));
  ok('a queued create is kept', merged.some(r => r.id === 'created-offline'));
  ok('a row with NO queued write takes the server copy', merged.find(r => r.id === 'other')?.status === 'open');
  ok('pendingDeleteIdsForTable reads only deletes of that table', deleted.size === 1 && deleted.has('deleted-offline')
    && pendingDeleteIdsForTable(queue, 'rfis').size === 0);
  const empty = mergeLocalOnly([] as Row[], local, pending, { deletedIds: deleted });
  ok('an EMPTY server list plus a queued create returns only the queued rows (the update and the create)',
    empty.map(r => r.id).sort().join() === 'closed-offline,created-offline', JSON.stringify(empty));
  ok('mergeServerKeepingPending agrees (same rule, same name kept for its callers)',
    JSON.stringify(mergeServerKeepingPending(server, local, pending, { deletedIds: deleted })) === JSON.stringify(merged));
  // Control — the shipped rule (server wins on both), executed inline.
  const shipped = [...server, ...local.filter(r => !server.some(s => s.id === r.id) && pending.has(r.id))];
  ok('control: the shipped server-wins merge showed the offline-closed item open and the deleted one back',
    shipped.find(r => r.id === 'closed-offline')?.status === 'open' && shipped.some(r => r.id === 'deleted-offline'));

  // Punch combiner: the device row wins, but the sub's note and another
  // phone's pin stay the server's (keepPendingPinFields restores THIS device's
  // pin only where its own pin write is out).
  type P = { id: string; status: string; subNote?: string; planSheetId?: string; pinX?: number; pinY?: number; createdByUserId?: string };
  const sp: P[] = [{ id: 'x', status: 'ready_for_review', subNote: 'fixed the trim', planSheetId: 's2', pinX: 0.3, pinY: 0.3, createdByUserId: 'gc' }];
  const lp: P[] = [{ id: 'x', status: 'closed' }];
  const m2 = mergeLocalOnly(sp, lp, new Set(['x']), { combine: combinePunchPending });
  ok('punch: his queued status wins, the sub\'s note and the other phone\'s pin are kept',
    m2[0].status === 'closed' && m2[0].subNote === 'fixed the trim' && m2[0].planSheetId === 's2' && m2[0].createdByUserId === 'gc', JSON.stringify(m2));
  const overlay = keepPendingPinFields(m2, [lp], new Set());
  ok('...and with no pin write of his own out, the pin overlay leaves the server pin', overlay[0].pinX === 0.3);

  // Every merge loader: deletes filtered, the empty read gate.
  const loaders: [string, RegExp][] = [
    ['change_orders', /keepDevice, \{ deletedIds: await queuedDeletesFor\('change_orders'\) \}\)/],
    ['invoices', /queuedIdsFor\('invoices'\), \{ deletedIds: await queuedDeletesFor\('invoices'\) \}\)/],
    ['commitments', /queuedIdsFor\('commitments'\), \{ deletedIds: await queuedDeletesFor\('commitments'\) \}\)/],
    // data-session critic round 2: daily reports, photos (and permits /
    // warranties) are re-read on every foreground, so they keep rows written
    // during the read too — and treat a touched id gone from the device as deleted.
    ['daily_reports', /queuedIdsFor\('daily_reports'\), \.\.\.touchedDr\.keep\]\), \{ deletedIds: new Set\(\[\.\.\.await queuedDeletesFor\('daily_reports'\), \.\.\.touchedDr\.gone\]\) \}\)/],
    // data-session critic: + rows written directly during the read (an INSERT
    // or whole-row UPDATE on the wire), as rfis / submittals already keep.
    ['punch_items', /queuedIdsFor\('punch_items'\), \.\.\.idsWrittenDuringRead\(proDocWriteTouchRef\.current, fetchStartedAt\)\]\), \{ deletedIds: await queuedDeletesFor\('punch_items'\), combine: combinePunchPending \}\)/],
    ['photos', /queuedIdsFor\('photos'\), \.\.\.touchedPh\.keep\]\), \{ deletedIds: new Set\(\[\.\.\.await queuedDeletesFor\('photos'\), \.\.\.touchedPh\.gone\]\) \}\)/],
    ['rfis', /const keepDevice = new Set\(\[\.\.\.await queuedIdsFor\('rfis'\), \.\.\.idsWrittenDuringRead\(proDocWriteTouchRef\.current, readStartedAt\)\]\);\s*const merged = mergeLocalOnly\(mapped, await loadLocal<RFI\[\]>\(RFIS_KEY, \[\]\), keepDevice, \{ deletedIds: await queuedDeletesFor\('rfis'\) \}\)/],
    ['submittals', /const keepDevice = new Set\(\[\.\.\.await queuedIdsFor\('submittals'\), \.\.\.idsWrittenDuringRead\(proDocWriteTouchRef\.current, readStartedAt\)\]\);\s*const merged = mergeLocalOnly\(mapped, await loadLocal<Submittal\[\]>\(SUBMITTALS_KEY, \[\]\), keepDevice, \{ deletedIds: await queuedDeletesFor\('submittals'\) \}\)/],
    ['aia_pay_apps', /queuedIdsFor\('aia_pay_apps'\), \{ deletedIds: await queuedDeletesFor\('aia_pay_apps'\) \}\)/],
  ];
  for (const [table, re] of loaders) {
    const from = CTX.indexOf(`supabase.from('${table}').select`);
    const win = from < 0 ? '' : CTX.slice(from, from + 9000);
    const gate = win.indexOf('if (!error && data && (data.length > 0 || await emptyReadTrusted(userId, bearerBefore))) {');
    // Review round 1: the bearer is read BEFORE the SELECT (the line above it).
    const before = from < 0 ? '' : CTX.slice(from - 160, from);
    ok(`${table}: an empty read counts only when trusted (bearer read before the SELECT), and a queued delete stays out`,
      gate >= 0 && gate < 2500 && re.test(win) && /const bearerBefore = await readBearer\(\);\s*(?:const (?:fetchStartedAt|readStartedAt) = Date\.now\(\);\s*)?const \{ data, error \} = await $/.test(before));
  }
}

console.log('\n#112 / #90 — an empty read is authoritative only for this user\'s bearer, checked BEFORE and after the read:');
{
  const base = { loadUserId: 'u1', liveUserId: 'u1', sessionUserId: 'u1', bearerBefore: 'tok-A', bearerAfter: 'tok-A' };
  ok('his bearer before and after (same token) → trusted', emptyReadAuthoritative(base));
  ok('REVIEW CASE: no usable bearer BEFORE the read (it went out as anon) but live after → NOT trusted',
    !emptyReadAuthoritative({ ...base, bearerBefore: null, bearerAfter: 'tok-A' }));
  ok('refreshed during the read (a different token after) → NOT trusted', !emptyReadAuthoritative({ ...base, bearerAfter: 'tok-B' }));
  ok('no bearer after (signed out / refresh failed) → NOT trusted', !emptyReadAuthoritative({ ...base, bearerAfter: null }));
  ok('signed out mid-read → NOT trusted', !emptyReadAuthoritative({ ...base, sessionUserId: null }));
  ok('another account took over → NOT trusted', !emptyReadAuthoritative({ ...base, liveUserId: 'u2', sessionUserId: 'u2' }));
  ok('no load user → NOT trusted', !emptyReadAuthoritative({ ...base, loadUserId: null }));
  const now = 1_000_000_000;
  ok('bearerTokenForRead: a token with runway is the one the read will carry',
    bearerTokenForRead({ access_token: 't', expires_at: (now + BEARER_READ_RUNWAY_MS + 5_000) / 1000 }, now) === 't');
  ok('...a token inside auth-js\'s refresh margin (+ slack) is NOT (the read may refresh, fail, and send anon)',
    bearerTokenForRead({ access_token: 't', expires_at: (now + 60_000) / 1000 }, now) === null
      && bearerTokenForRead({ access_token: 't', expires_at: (now - 1) / 1000 }, now) === null);
  ok('...no session → null; no expiry → sent as is (auth-js never refreshes it)',
    bearerTokenForRead(null, now) === null && bearerTokenForRead({ access_token: '' }, now) === null && bearerTokenForRead({ access_token: 't' }, now) === 't');
  ok('...the runway covers auth-js\'s 90 s EXPIRY_MARGIN_MS', BEARER_READ_RUNWAY_MS > 90_000);
  const helper = slice(CTX, 'const emptyReadTrusted = async (loadUserId: string | null, bearerBefore: string | null): Promise<boolean> => {', '\n  };');
  ok('the provider requires a pre-read bearer, checks the live account first, asks the auth feed and compares the token after',
    /if \(!loadUserId \|\| liveUserIdRef\.current !== loadUserId \|\| !bearerBefore\) return false;/.test(helper) && /currentSessionUserId\(\)/.test(helper)
      && /currentBearer\(\)/.test(helper)
      && /emptyReadAuthoritative\(\{ loadUserId, liveUserId: liveUserIdRef\.current, sessionUserId, bearerBefore, bearerAfter \}\)/.test(helper));
  const rb = slice(CTX, 'const readBearer = async (): Promise<string | null> => {', '\n  };');
  ok('readBearer answers only a token with runway', /return bearerTokenForRead\(data\?\.session, Date\.now\(\)\);/.test(rb));
}

// ─── #55 · patch-only edits ───────────────────────────────────────────────
console.log('\n#55 — an edit writes only what changed, from the insert\'s own builder:');
{
  const full = {
    id: 'r1', subject: 'Header', question: 'q', submitted_by: 'me', assigned_to: 'arch', assigned_sub_id: null,
    ball_in_court: 'architect', handoffs: [{ at: 'x' }], date_submitted: 'd', date_required: '2026-09-30',
    date_responded: null, response: null, status: 'open', priority: 'normal', linked_drawing: null,
    linked_task_id: 't9', attachments: [], updated_at: 'local-stamp',
  };
  const p = rowPatch(full, ['linkedTaskId'], RFI_FIELD_COLUMNS, '2026-09-18T07:00:00.123456+00:00');
  ok('linking a task from the 7am copy sends id, linked_task_id and updated_at — NOT response/status/date_responded',
    JSON.stringify(Object.keys(p).sort()) === JSON.stringify(['id', 'linked_task_id', 'updated_at']) && p.linked_task_id === 't9', JSON.stringify(p));
  ok('updated_at is the COPY\'s own (the guard steps aside only if it is still the server\'s)', p.updated_at === '2026-09-18T07:00:00.123456+00:00');
  const clear = rowPatch({ ...full, linked_task_id: null }, ['linkedTaskId'], RFI_FIELD_COLUMNS, 'x');
  ok('a cleared field (key present, value undefined) is sent as NULL', Object.prototype.hasOwnProperty.call(clear, 'linked_task_id') && clear.linked_task_id === null);
  const unmapped = rowPatch(full, ['portalState', 'number', 'updatedAt'], RFI_FIELD_COLUMNS, 'x');
  ok('portal_state / number / updatedAt are never sent by an edit', Object.keys(unmapped).sort().join() === 'id,updated_at');
  const guarded = rowPatch(full, ['status', 'response'], RFI_FIELD_COLUMNS, 'x');
  ok('a write naming a guarded column always names updated_at (contract §1)',
    RFI_GUARDED_COLUMNS.every(c => !(c in guarded) || 'updated_at' in guarded) && 'status' in guarded && 'updated_at' in guarded);
  ok('every RFI column the builder writes is mapped from a field', ['subject', 'question', 'submitted_by', 'assigned_to', 'assigned_sub_id', 'ball_in_court',
    'handoffs', 'date_submitted', 'date_required', 'date_responded', 'response', 'status', 'priority', 'linked_drawing', 'linked_task_id', 'attachments', 'source_photo_id']
    .every(c => Object.values(RFI_FIELD_COLUMNS).includes(c)));
  ok('submittal guarded columns are mapped', SUBMITTAL_GUARDED_COLUMNS.every(c => Object.values(SUBMITTAL_FIELD_COLUMNS).includes(c)));

  const upd = slice(CTX, 'const updateRFI = useCallback((id: string, updates: Partial<RFI>) => {', '}, [saveRfisMutation, canSync, rfiMutableRow, sendProDocPatch]);');
  ok('updateRFI builds from the ref, decides through planProDocEdit, sends rowPatch(rfiMutableRow(next), changedKeys, …, plan.stamp), never the whole row',
    /const base = rfisRef\.current;/.test(upd)
      && /const plan = planProDocEdit\(\{ kind: 'rfi', before, updates, nowIso: new Date\(\)\.toISOString\(\), sending: canSync \}\);/.test(upd)
      && /if \(!plan\.ok\) \{ showAlert\(plan\.title, plan\.reason\); return; \}/.test(upd)
      && /const patch = rowPatch\(rfiMutableRow\(plan\.next\), plan\.changedKeys, RFI_FIELD_COLUMNS, plan\.stamp\);/.test(upd)
      && /sendProDocPatch\('rfis', id, patch\)/.test(upd) && !/\.\.\.rfiMutableRow\(/.test(upd), upd.slice(0, 200));
  const updS = slice(CTX, 'const updateSubmittal = useCallback((id: string, updates: Partial<Submittal>) => {', '}, [saveSubmittalsMutation, canSync, submittalMutableRow, sendProDocPatch]);');
  ok('updateSubmittal does the same', /const base = submittalsRef\.current;/.test(updS)
    && /const plan = planProDocEdit\(\{ kind: 'submittal', before, updates, nowIso: new Date\(\)\.toISOString\(\), sending: canSync \}\);/.test(updS)
    && /if \(!plan\.ok\) \{ showAlert\(plan\.title, plan\.reason\); return; \}/.test(updS)
    && /const patch = rowPatch\(submittalMutableRow\(plan\.next\), plan\.changedKeys, SUBMITTAL_FIELD_COLUMNS, plan\.stamp\);/.test(updS)
    && !/\.\.\.submittalMutableRow\(/.test(updS));
  const sendP = slice(CTX, 'const sendProDocPatch = useCallback(', '}, [adoptProDocStamp]);');
  ok('a sent edit is tracked on the wire and, once it lands directly, the server\'s stamp is read back for THAT edit only',
    /proDocEditSeqRef\.current\.set\(key, seq\);/.test(sendP) && /trackedWrite\(proDocWriteTouchRef, table, 'update', patch\)/.test(sendP)
      && /if \(outcome === 'synced'\) void adoptProDocStamp\(table, id, seq\);/.test(sendP));
  const adopt = slice(CTX, 'const adoptProDocStamp = useCallback(async (', '}, [userId, queryClient, saveRfisMutation, saveSubmittalsMutation]);');
  ok('...the read-back adopts only when no later edit went out and the guarded columns match; otherwise it re-reads the list',
    /if \(proDocEditSeqRef\.current\.get\(key\) !== seq \|\| liveUserIdRef\.current !== owner\) return;/.test(adopt)
      && /serverStampAdoptable\(rfiMutableRow\(local\), row, cols\)/.test(adopt) && /serverStampAdoptable\(submittalMutableRow\(local\), row, cols\)/.test(adopt)
      && (adopt.match(/reread\(\); return;/g) ?? []).length >= 3 && /serverUpdatedAt: row\.updated_at as string/.test(adopt));
  ok('the loaders read the server\'s stamp into serverUpdatedAt (rfis and submittals)',
    (CTX.match(/serverUpdatedAt: \(r\.updated_at as string \| null\) \?\? undefined,/g) ?? []).length === 2);
  ok('a portal send / recall / batch send clears the stamp and re-reads the list once its write settles',
    /case 'rfi': {10}\{ const n = setNext\(rfisRef\.current, m\)\.map\(r => \(m\.has\(r\.id\) \? \{ \.\.\.r, serverUpdatedAt: undefined \} : r\)\);/.test(CTX)
      && (CTX.match(/void Promise\.resolve\(portalWrite\)\.then\(\(\) => \{ void queryClient\.invalidateQueries\(\{ queryKey: \[listKey, userId\] \}\); \}, \(\) => \{\}\);/g) ?? []).length === 3);
  const arc = slice(CTX, 'const addReviewCycle = useCallback(async (', '}, [canSync, saveSubmittalsMutation, submittalMutableRow, queryClient, userId]);');
  ok('addReviewCycle appends through the RPC with the contract\'s argument names',
    /supabase\.rpc\('submittal_append_review_cycle', \{\s*p_submittal_id: submittalId,\s*p_cycle:/.test(arc));
  ok('...offline it rides the queue as a guarded review_cycles patch (the server appends and renumbers), a close-in-place is refused with why',
    /rowPatch\(submittalMutableRow\(current\), \['reviewCycles', 'currentStatus'\], SUBMITTAL_FIELD_COLUMNS, now\)/.test(arc)
      && /if \(closesInPlace\) \{\s*return revert\(/.test(arc));
  ok('...a server refusal takes the provisional cycle back off and says why', /const revert = \(reason: string\)/.test(arc) && /showAlert\('Review cycle not saved', reason\)/.test(arc));
  ok('...and the server\'s number replaces the provisional one, then the list is re-read',
    /cycleNumber: serverNo/.test(arc) && /invalidateQueries\(\{ queryKey: \['submittals', userId\] \}\)/.test(arc));
  ok('...and it no longer rewrites review_cycles through updateSubmittal', !/updateSubmittal\(/.test(arc));
  // Round 2 of the data-session critic: one foreground binding (refetchAllOnForeground) runs this part.
  const fg = slice(CTX, 'const refetchProDocsOnForeground = useCallback(', 'const refetchPortalListsOnForeground = useCallback(');
  ok('rfis, submittals (and punch, for the sub\'s Mark fixed) re-read on return to the foreground, behind the 30 s gate',
    /queryKey: \['rfis', userId\]/.test(fg) && /queryKey: \['submittals', userId\]/.test(fg) && /queryKey: \['punchItems', userId\]/.test(fg));
  ok('an insert flush re-pulls rfis / submittals (the server\'s #148 number reaches the list)',
    /rfis: 'rfis',/.test(read('utils/projectContextPure.ts')) && /submittals: 'submittals',/.test(read('utils/projectContextPure.ts')));
}

// ─── #55 review round · the edit SEQUENCE, executed ─────────────────────────
// A model of the server's answer guard (20260919080000 §1, the RFI half):
// the write's updated_at equal to the row's → as sent; otherwise a reopen is
// coerced back. Then the real planProDocEdit drives load → edit → edit.
console.log('\n#55 review round — load, edit, then reopen (executed):');
{
  type R = { id: string; status: string; response?: string; updatedAt: string; serverUpdatedAt?: string; subject: string };
  let serverClock = 100;
  const server = { id: 'r1', status: 'answered', response: 'Use W8x10', subject: 'Beam', updated_at: 'S1' };
  const applyGuard = (patch: Record<string, unknown>) => {
    const deliberate = patch.updated_at === server.updated_at;
    const next = { ...server, ...patch } as typeof server & Record<string, unknown>;
    if (!deliberate && (server.status === 'answered' || server.status === 'closed') && next.status === 'open') next.status = server.status;
    next.updated_at = `S${++serverClock}`; // update_updated_at stamps now()
    Object.assign(server, next);
  };
  const cols: Record<string, string> = { status: 'status', response: 'response', subject: 'subject' };
  const toPatch = (row: R, keys: string[], stamp: string) => {
    const out: Record<string, unknown> = { id: row.id };
    for (const k of keys) if (cols[k]) out[cols[k]] = (row as Record<string, unknown>)[k] ?? null;
    out.updated_at = stamp;
    return out;
  };
  // Load: the server read gives BOTH stamps.
  let local: R = { id: 'r1', status: 'answered', response: 'Use W8x10', subject: 'Beam', updatedAt: 'S1', serverUpdatedAt: 'S1' };
  // 1. He fixes the response text (online, direct write).
  const e1 = planProDocEdit<R>({ kind: 'rfi', before: local, updates: { response: 'Use W8x10 galvanized' }, nowIso: 'D1', sending: true });
  ok('edit 1 goes out with the SERVER stamp and clears it on the local copy',
    e1.ok && e1.stamp === 'S1' && e1.deliberate && e1.next.serverUpdatedAt === undefined && e1.next.updatedAt === 'D1');
  if (!e1.ok) throw new Error('unreachable');
  applyGuard(toPatch(e1.next, e1.changedKeys, e1.stamp));
  local = e1.next;
  // 2. Before the read-back lands, he taps Reopen.
  const e2 = planProDocEdit<R>({ kind: 'rfi', before: local, updates: { status: 'open' }, nowIso: 'D2', sending: true });
  ok('REVIEW CASE: reopen right after his own edit (stamp unknown) is REFUSED with why — not sent to be silently undone',
    !e2.ok && /server's latest copy/.test(e2.ok ? '' : e2.reason) && /answered/.test(e2.ok ? '' : e2.reason));
  // Control — the first cut sent before.updatedAt (the device's D1): executed
  // against the guard, the screen says open while the server keeps answered.
  const controlPatch = toPatch({ ...local, status: 'open' }, ['status'], local.updatedAt);
  const snapshot = { ...server };
  applyGuard(controlPatch);
  ok('control: the first cut\'s device stamp was coerced — server still answered while the screen said open', server.status === 'answered');
  Object.assign(server, snapshot);
  // 3. The read-back adopts the server's new stamp (guarded columns match).
  const deviceCols = { response: local.response, status: local.status, date_responded: null, ball_in_court: null, handoffs: null };
  ok('the read-back adopts the new stamp when the guarded columns are what he wrote',
    serverStampAdoptable(deviceCols, { ...server, date_responded: null, ball_in_court: null, handoffs: null }, ['response', 'status', 'date_responded', 'ball_in_court', 'handoffs']));
  ok('...but NOT when someone else wrote in between (the architect re-answered): the list is re-read instead',
    !serverStampAdoptable(deviceCols, { ...server, response: 'Revised: W10x12', date_responded: null, ball_in_court: null, handoffs: null },
      ['response', 'status', 'date_responded', 'ball_in_court', 'handoffs']));
  ok('...jsonb key order does not defeat the match', serverStampAdoptable({ handoffs: [{ to: 'gc', at: 'x' }] }, { updated_at: 'S9', handoffs: [{ at: 'x', to: 'gc' }] }, ['handoffs']));
  local = { ...local, serverUpdatedAt: server.updated_at };
  // 4. Reopen again: sent with the adopted stamp, and it LANDS.
  const e3 = planProDocEdit<R>({ kind: 'rfi', before: local, updates: { status: 'open' }, nowIso: 'D3', sending: true });
  ok('after the read-back, the reopen goes out with the server\'s current stamp', e3.ok && e3.stamp === server.updated_at && e3.deliberate);
  if (e3.ok) applyGuard(toPatch(e3.next, e3.changedKeys, e3.stamp));
  ok('...and the server really reopens it (screen and server agree)', server.status === 'open' && e3.ok && e3.next.status === 'open');
  // Non-regressions never need the stamp.
  const e4 = planProDocEdit<R>({ kind: 'rfi', before: { ...local, serverUpdatedAt: undefined }, updates: { subject: 'Beam B2' }, nowIso: 'D4', sending: true });
  ok('a plain edit with no known stamp goes out on the device clock (the guard protects the answer)', e4.ok && e4.stamp === 'D4' && !e4.deliberate);
  const e5 = planProDocEdit<R>({ kind: 'rfi', before: { ...local, serverUpdatedAt: 'S1' }, updates: { subject: 'x', serverUpdatedAt: 'S999', updatedAt: 'zzz' } as Partial<R>, nowIso: 'D5', sending: true });
  ok('a screen passing serverUpdatedAt / updatedAt back cannot choose the stamp (the provider owns both)',
    e5.ok && e5.stamp === 'S1' && e5.changedKeys.join() === 'subject' && e5.next.updatedAt === 'D5');
  const e6 = planProDocEdit<R>({ kind: 'rfi', before: { ...local, status: 'answered', serverUpdatedAt: undefined }, updates: { status: 'open' }, nowIso: 'D6', sending: false });
  ok('signed out (nothing sent): a local reopen is allowed and keeps the stamp', e6.ok && e6.next.status === 'open');
  const clear = planProDocEdit<R>({ kind: 'rfi', before: { ...local, response: 'x', serverUpdatedAt: undefined }, updates: { response: '' }, nowIso: 'D7', sending: true });
  ok('clearing an answer with no known stamp is refused too', !clear.ok);
  // Submittals.
  type S = { id: string; updatedAt: string; serverUpdatedAt?: string; currentStatus: string; reviewCycles: { cycleNumber: number; status: string; sentDate: string }[] };
  const sb: S = { id: 's1', updatedAt: 'D', currentStatus: 'approved_as_noted', reviewCycles: [{ cycleNumber: 1, status: 'approved_as_noted', sentDate: '2026-09-01' }] };
  const sAppend = planProDocEdit<S>({ kind: 'submittal', before: sb, updates: { reviewCycles: [...sb.reviewCycles, { cycleNumber: 2, status: 'in_review', sentDate: '2026-09-10' }], currentStatus: 'in_review' }, nowIso: 'D', sending: true });
  ok('submittal: appending a cycle (and its status) needs no stamp — the guard appends it', sAppend.ok);
  const sStatus = planProDocEdit<S>({ kind: 'submittal', before: sb, updates: { currentStatus: 'rejected' }, nowIso: 'D', sending: true });
  ok('submittal: moving the status without a new cycle, stamp unknown → refused with why', !sStatus.ok && /status/.test(sStatus.ok ? '' : sStatus.reason));
  const sRewrite = planProDocEdit<S>({ kind: 'submittal', before: sb, updates: { reviewCycles: [{ ...sb.reviewCycles[0], status: 'rejected' }] }, nowIso: 'D', sending: true });
  ok('submittal: rewriting the architect\'s cycle, stamp unknown → refused', !sRewrite.ok);
  const sKnown = planProDocEdit<S>({ kind: 'submittal', before: { ...sb, serverUpdatedAt: 'S5' }, updates: { currentStatus: 'rejected' }, nowIso: 'D', sending: true });
  ok('...with the server\'s stamp known it goes out deliberately', sKnown.ok && sKnown.stamp === 'S5');
  const sSame = planProDocEdit<S>({ kind: 'submittal', before: sb, updates: { currentStatus: 'approved_as_noted', reviewCycles: JSON.parse(JSON.stringify(sb.reviewCycles)) }, nowIso: 'D', sending: true });
  ok('a form save that repeats the unchanged status and cycles is not a regression', sSame.ok);
  const arc2 = slice(CTX, 'const withCycle = (s: Submittal, c: SubmittalReviewCycle): Submittal => ({', '});');
  ok('addReviewCycle clears the stamp (the append moves the server\'s updated_at)', /serverUpdatedAt: undefined,/.test(arc2));
  ok('idsWrittenDuringRead: an edit on the wire or settled after the read started keeps the device row',
    [...idsWrittenDuringRead(new Map([['wire', { inFlight: 1, settledAt: 0 }], ['late', { inFlight: 0, settledAt: 200 }], ['old', { inFlight: 0, settledAt: 50 }]]), 100)].sort().join() === 'late,wire');
}

// ─── #56 · realtime ───────────────────────────────────────────────────────
console.log('\n#56 — the architect\'s answer reaches an open phone:');
{
  ok('NotificationContext listens for rfis UPDATEs on HIS rows and invalidates [\'rfis\']',
    /table: 'rfis', filter: `user_id=eq\.\$\{user\.id\}` \},\s*\(\) => \{ void queryClient\.invalidateQueries\(\{ queryKey: \['rfis'\] \}\); \}/.test(NOTIF));
  ok('...and submittals', /table: 'submittals', filter: `user_id=eq\.\$\{user\.id\}` \},\s*\(\) => \{ void queryClient\.invalidateQueries\(\{ queryKey: \['submittals'\] \}\); \}/.test(NOTIF));
  const mig = read('supabase/migrations/20260919210000_realtime_rfis_submittals.sql');
  ok('the publication migration adds both tables, each only when missing',
    /alter publication supabase_realtime add table public\.rfis/.test(mig) && /alter publication supabase_realtime add table public\.submittals/.test(mig)
      && (mig.match(/if not exists \(\s*select 1 from pg_publication_tables/g) ?? []).length === 2);
}

// ─── #74 · plans ──────────────────────────────────────────────────────────
console.log('\n#74 — the plans re-read:');
{
  ok('queued plan writes (any of the four tables, any operation) block the re-read',
    planWritesQueued([{ table: 'drawing_pins', operation: 'delete', data: { id: 'p' } }])
      && planWritesQueued([{ table: 'plan_calibrations', operation: 'upsert', data: {} }])
      && !planWritesQueued([{ table: 'rfis', operation: 'update', data: { id: 'r' } }]));
  const u = unionServerFirst([{ id: 'a', v: 'server' }], [{ id: 'a', v: 'local' }, { id: 'fresh-import', v: 'local' }]);
  ok('a re-read: the server row wins by id, a device row the server lacks is kept',
    u.length === 2 && u[0].v === 'server' && u[1].id === 'fresh-import');
  const k = unionServerFirst([{ id: 'a', v: 'server-old' }, { id: 'gone', v: 'server' }, { id: 'b', v: 'server' }],
    [{ id: 'a', v: 'device-moved' }, { id: 'b', v: 'device' }], new Set(['a', 'gone']));
  ok('review round: a plan row written DIRECTLY during the read keeps the device copy; a delete in flight is not resurrected',
    k.find(r => r.id === 'a')?.v === 'device-moved' && !k.some(r => r.id === 'gone') && k.find(r => r.id === 'b')?.v === 'server', JSON.stringify(k));
  const pullSrc = slice(CTX, 'const pullPlansFromServer = useCallback(async (opts: {', '}, []);');
  ok('...the re-read passes the ids written during it to all four merges, and every plan write is tracked',
    /const readStartedAt = Date\.now\(\);/.test(pullSrc)
      && /refetch \? idsWrittenDuringRead\(planWriteTouchRef\.current, readStartedAt\)/.test(pullSrc)
      && (pullSrc.match(/writtenDuringRead\(\)\)/g) ?? []).length === 4
      && !/supabaseWrite\('(plan_sheets|drawing_pins|plan_markups|plan_calibrations)'/.test(CTX)
      && (CTX.match(/trackedWrite\(planWriteTouchRef, '(plan_sheets|drawing_pins|plan_markups|plan_calibrations)'/g) ?? []).length === 11);
  const rf = slice(CTX, 'const refetchPlansFromServer = useCallback(async (): Promise<void> => {', '}, [canSync, userId, pullPlansFromServer]);');
  ok('refetchPlansFromServer skips while plan writes are queued and never re-paints the disk copy',
    /if \(planWritesQueued\(await getOfflineQueue\(\)\)\) return;/.test(rf) && /pullPlansFromServer\(\{ refetch: true,/.test(rf)
      && !/setPlanSheets\(lSheets\)/.test(rf));
  ok('...runs on return to the foreground (the 30 s gate) and is exposed on the context',
    /useProjectsFocusRefetch\(canSync, refetchPlansFromServer\);/.test(CTX) && /refetchPlansFromServer: \(\) => Promise<void>;/.test(CTX)
      && /updatePlanSheet, refetchPlansFromServer, deletePlanSheet/.test(CTX));
  ok('...and after a plan write flushes or is discarded',
    (CTX.match(/PLAN_SYNC_TABLES\.includes\(t\)\)\) void refetchPlansRef\.current\(\);/g) ?? []).length === 2);
  const pull = slice(CTX, 'const pullPlansFromServer = useCallback(async (opts: {', '}, []);');
  ok('the re-read merges (union) instead of replacing the four lists; the launch read still replaces',
    /const merged = refetch \? unionServerFirst\(carried, planSheetsRef\.current, writtenDuringRead\(\)\) : carried;/.test(pull)
      && /const next = refetch \? unionServerFirst\(mapped, drawingPinsRef\.current, writtenDuringRead\(\)\) : mapped;/.test(pull)
      && /setPlanMarkups\(prev => \{ const next = unionServerFirst\(mapped, prev, writtenDuringRead\(\)\)/.test(pull)
      && /setPlanCalibrations\(prev => \{ const next = unionServerFirst\(mapped, prev, writtenDuringRead\(\)\)/.test(pull));
  const hyd = slice(CTX, 'const hydratePlansFromServer = useCallback(async () => {', '}, [canSync, userId, pullPlansFromServer]);');
  ok('the launch hydration keeps its local-first paint and calls the shared server half',
    /setPlanSheets\(lSheets\);/.test(hyd) && /await pullPlansFromServer\(\{ refetch: false, lSheets, stillMine, markSheetsLoaded \}\);/.test(hyd));
}

// ─── Mapper carries ───────────────────────────────────────────────────────
console.log('\nMapper carries (#18, #16, #111, #60/#144, #50):');
{
  ok('#18 punchItemToUpdateRow sends assigned_sub_id: pi.assignedSubId ?? null (a cleared sub reaches the server)',
    /assigned_sub_id: pi\.assignedSubId \?\? null,/.test(slice(CTX, 'function punchItemToUpdateRow(', '\n}')));
  // punch round trip
  const po = punchServerOwnedFromRow({ user_id: 'u-foreman', sub_note: 'done, see photo' });
  ok('#111/#16 punch read: user_id → createdByUserId, sub_note → subNote', po.createdByUserId === 'u-foreman' && po.subNote === 'done, see photo');
  const pn = punchServerOwnedFromRow({ user_id: null, sub_note: null });
  ok('...NULL reads as unset', pn.createdByUserId === undefined && pn.subNote === undefined);
  ok('...and the punch loader spreads it', /\.\.\.punchServerOwnedFromRow\(r\),/.test(CTX));
  const upd = slice(CTX, 'function punchItemToUpdateRow(', '\n}');
  const ins = slice(CTX, 'const punchItemToRow = useCallback((item: PunchItem) => ({', '}), [userId]);');
  ok('...sub_note is NEVER written by the app (the sub owns it through the RPC)', !/sub_note/.test(upd) && !/sub_note/.test(ins));
  ok('...the creator is stamped on the local copy by both add paths',
    /const item = stagePunchPhoto\(stampPunchCreator\(rawItem\)\);/.test(CTX) && /rawItems\.map\(pi => stagePunchPhoto\(stampPunchCreator\(pi\)\)\)/.test(CTX));
  // submittal round trip
  const sub = { linkedTaskId: 'task-7', submittalType: 'Shop drawing', trade: 'Steel', sourcePages: [12, 13], leadDays: 21, requiredDateSource: 'schedule' as const };
  const row = submittalIntakeColumns(sub);
  ok('#60/#144 submittal write names exactly the six migration columns',
    Object.keys(row).sort().join() === 'lead_days,linked_task_id,required_date_source,source_pages,submittal_type,trade', Object.keys(row).join());
  const back = submittalIntakeFromRow(JSON.parse(JSON.stringify(row)));
  ok('...and reads them back unchanged (round trip through JSON, as PostgREST returns them)', JSON.stringify(back) === JSON.stringify(sub), JSON.stringify(back));
  const cleared = submittalIntakeColumns({});
  ok('...a cleared link / unset field is sent as NULL, never omitted', Object.values(cleared).every(v => v === null) && Object.keys(cleared).length === 6);
  ok('...a bad required_date_source is not sent (the CHECK would refuse the whole write)', submittalIntakeColumns({ requiredDateSource: 'guess' as never }).required_date_source === null);
  ok('...the mutable row builder and the loader use them', /\.\.\.submittalIntakeColumns\(s\),/.test(CTX) && /\.\.\.submittalIntakeFromRow\(r\),/.test(CTX));
  const mig = read('supabase/migrations/20260919090000_submittal_intake_columns.sql');
  ok('...and every column is one 20260919090000 adds', Object.keys(row).every(c => new RegExp(`add column if not exists ${c}\\b`).test(mig)));
  ok('#50 types: actual*Day documented as CALENDAR indices', /actualStartDay: CALENDAR index of the day the task actually started/.test(TYPES)
    && /actualEndDay: {3}CALENDAR index of the day the task actually finished/.test(TYPES));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
