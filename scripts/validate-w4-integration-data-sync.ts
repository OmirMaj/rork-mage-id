// validate-w4-integration-data-sync.ts — wave 4 integration round 1, the
// data-sync lens. The executing half lives in __tests__/sync/offline-queue.test.ts
// ("integration round 1 — …" blocks, which drive the real queue); this file runs
// the pure ledger core and pins the wiring jest cannot reach (screens, context).
//
// What it holds:
//   A. A write of a record with an unsaved (refused / dropped) write is PARKED
//      behind it in the ledger, never sent on its own — folded where the end
//      state is provably the same, appended (strictly after) where it is not.
//   B. The ledger names a payment append's amount, and counts unsaved records.
//   C. offlineQueue: ledger-first ordering guard, the writer's tag, the awaited
//      failure line, an enqueue that never rebuilds the queue from [], unknown
//      operations kept, swept writes recorded as notes.
//   D. Screens and context: the sign-out confirm counts unsaved records, the
//      invoice screen asks before a payment over an unsaved one, Discard drops
//      a change order's stashed audit entries and re-reads the table.
//
// Run: bun run scripts/validate-w4-integration-data-sync.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parkBehindUnsavedIn, hasUnsavedChainIn, unsavedRecordCountIn, labelForWrite, unsavedPaymentAppendsIn,
  unsavedBatchFor, type SyncFailure,
} from '../utils/syncLedger';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail !== undefined ? `\n      ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''); }
}
const slice = (src: string, start: string, end: string) => {
  const i = src.indexOf(start);
  if (i < 0) return '';
  const j = src.indexOf(end, i + start.length);
  return j < 0 ? '' : src.slice(i, j);
};

const A = 'user-a';
const refusedInsert: SyncFailure = {
  id: 'direct-1', kind: 'write', label: 'Daily report', reason: 'the server refused it', at: 100, userId: A,
  table: 'daily_reports', recordId: 'dr1', operation: 'insert', row: { id: 'dr1', project_id: 'p1', notes: 'morning draft', weather: 'sun' }, queuedAt: 100,
};
const incoming = (op: SyncFailure['operation'], row: Record<string, unknown> | undefined, extra: Partial<SyncFailure> = {}): SyncFailure => ({
  id: `parked-${op}`, kind: 'write', label: 'Daily report', reason: 'waiting behind an earlier change that was not saved', at: 100, userId: A,
  table: 'daily_reports', recordId: 'dr1', operation: op, ...(row ? { row } : {}), queuedAt: 100, ...extra,
});

console.log('\nA. later writes of an unsaved record are parked behind it:');
{
  const none = parkBehindUnsavedIn([], incoming('update', { id: 'dr1', notes: 'x' }));
  ok('no unsaved write of the record → not parked (the caller sends it)', !none.parked && none.next.length === 0);
  const otherUser = parkBehindUnsavedIn([{ ...refusedInsert, userId: 'user-b' }], incoming('update', { id: 'dr1', notes: 'x' }));
  ok("another user's unsaved write never holds this one", !otherUser.parked);
  const note = parkBehindUnsavedIn([{ id: 'n', kind: 'write', label: 'x', reason: 'y', at: 1, userId: A }], incoming('update', { id: 'dr1' }));
  ok('a NOTE (nothing to resend) never holds a write', !note.parked);

  const fold = parkBehindUnsavedIn([refusedInsert], incoming('update', { id: 'dr1', notes: 'final — crane delivery 2pm' }));
  ok('an UPDATE folds into the parked INSERT — one entry, the edit\'s columns win, the rest kept',
    fold.parked && fold.next.length === 1 && fold.next[0].id === 'direct-1' && fold.next[0].operation === 'insert'
      && JSON.stringify(fold.next[0].row) === JSON.stringify({ id: 'dr1', project_id: 'p1', notes: 'final — crane delivery 2pm', weather: 'sun' }),
    fold.next);
  const up = { ...refusedInsert, operation: 'upsert' as const };
  const upFold = parkBehindUnsavedIn([up], incoming('upsert', { id: 'dr1', notes: 'z' }));
  ok('an UPSERT folds into a parked UPSERT', upFold.parked && upFold.next.length === 1 && upFold.next[0].row?.notes === 'z');
  const upBehindInsert = parkBehindUnsavedIn([refusedInsert], incoming('upsert', { id: 'dr1', notes: 'z' }));
  ok('an UPSERT behind an INSERT is appended (not provably the same folded)', upBehindInsert.parked && upBehindInsert.next.length === 2);

  const del = parkBehindUnsavedIn([refusedInsert], incoming('delete', { id: 'dr1' }));
  const delEntry = del.next.find((f) => f.operation === 'delete');
  ok('a DELETE is appended, carrying the chain\'s FIRST reason (the line says why it is stuck)',
    del.parked && del.next.length === 2 && delEntry?.reason === 'the server refused it', del.next);
  ok('...strictly AFTER the refused write, even in the same millisecond — Retry replays insert then delete',
    unsavedBatchFor(del.next, refusedInsert).map((f) => f.operation).join() === 'insert,delete', del.next.map((f) => [f.operation, f.queuedAt]));

  const busy = parkBehindUnsavedIn([refusedInsert], incoming('update', { id: 'dr1', notes: 'late' }), new Set(['direct-1']));
  ok('never folds into an entry Retry is sending right now — appended instead',
    busy.parked && busy.next.length === 2 && busy.next.find((f) => f.id === 'direct-1')?.row?.notes === 'morning draft');

  const rpc = parkBehindUnsavedIn([refusedInsert], incoming('rpc', undefined, { rpc: { fn: 'f', args: {} } }));
  ok('an rpc behind it is appended as its own write', rpc.parked && rpc.next.length === 2);
  ok('hasUnsavedChainIn: only this user\'s resendable writes of that record',
    hasUnsavedChainIn([refusedInsert], A, 'daily_reports', 'dr1') && !hasUnsavedChainIn([refusedInsert], A, 'daily_reports', 'dr2')
      && !hasUnsavedChainIn([refusedInsert], 'user-b', 'daily_reports', 'dr1'));
}

console.log('\nB. the ledger names the money, and counts records:');
{
  const append = { fn: 'invoice_append_payment', args: { p_invoice_id: 'inv1', p_entry: { id: 'pay-A', amount: 5000 } } };
  ok("a payment append's line names its amount", labelForWrite('invoices', append) === 'Invoice payment of $5,000.00', labelForWrite('invoices', append));
  ok('...to the cent', labelForWrite('invoices', { fn: 'invoice_append_payment', args: { p_entry: { amount: 0.1 + 0.2 } } }) === 'Invoice payment of $0.30'
    && labelForWrite('invoices', { fn: 'invoice_append_payment', args: { p_entry: { amount: 1234567.891 } } }) === 'Invoice payment of $1,234,567.89');
  ok('any other write keeps the table label', labelForWrite('invoices') === 'Invoice' && labelForWrite('daily_reports') === 'Daily report');
  const ledger: SyncFailure[] = [
    { id: 'p1', kind: 'write', label: 'x', reason: 'r', at: 1, userId: A, table: 'invoices', recordId: 'inv1', operation: 'rpc', rpc: append },
    { id: 'p2', kind: 'write', label: 'x', reason: 'r', at: 2, userId: A, table: 'invoices', recordId: 'inv1', operation: 'update', row: { id: 'inv1' } },
    { id: 'p3', kind: 'write', label: 'x', reason: 'r', at: 3, userId: 'user-b', table: 'invoices', recordId: 'inv1', operation: 'rpc', rpc: append },
    refusedInsert,
    { id: 'n1', kind: 'photo', label: 'Photo', reason: 'r', at: 4, userId: A },
  ];
  ok("the invoice screen sees this user's unsaved appends on that invoice only", JSON.stringify(unsavedPaymentAppendsIn(ledger, A, 'inv1')) === '[5000]');
  ok('the sign-out count is distinct records with a resendable write (notes and other users excluded)', unsavedRecordCountIn(ledger, A) === 2, unsavedRecordCountIn(ledger, A));
}

console.log('\nC. offlineQueue wiring:');
{
  const Q = read('utils', 'offlineQueue.ts');
  const guard = slice(Q, 'async function queueBehindEarlierWrite(', '\nasync function enqueueOrFail(');
  ok('the ordering guard looks in the LEDGER before the queue, and parks there',
    guard.indexOf('ledger.parkBehindUnsavedWrite(') > 0 && guard.indexOf('ledger.parkBehindUnsavedWrite(') < guard.indexOf('readOfflineQueueOrThrow()'));
  // Integration round 3: the look is unsavedChainBlocks (hasUnsavedChain less
  // a profile write that provably commutes with the chain).
  ok('...a caller that owns its refusal only LOOKS (nothing is written for it)',
    /if \(ledger && opts\?\.callerOwnsRefusal\) \{[\s\S]{0,200}?if \(await ledger\.unsavedChainBlocks\(writerId, \{/.test(guard)
      && /return \{ outcome: 'failed', ownDepth: 0, parked: true \};/.test(guard));
  // Round 2: the record key is recordIdOf (id ?? project_id ?? …), not data.id.
  ok("...and Retry's own resend (ledgerRetry) skips it — it IS the ordered replay", /if \(!opts\?\.ledgerRetry && rid !== null\)/.test(guard));
  const append = slice(Q, 'async function appendEntryLocked(', '\nexport async function addToOfflineQueue(');
  ok('an append never rebuilds the queue from a swallowed read error', /const queue = await readOfflineQueueOrThrow\(\);/.test(append) && !/getOfflineQueue\(\)/.test(append));
  const direct = slice(Q, 'async function directWrite(', '\nasync function failDirectWrite(');
  ok('the refusal line is awaited before \'failed\' returns', /await failDirectWrite\(m, msg, code, err, writerId, madeAt, opts\);\s*return 'failed';/.test(direct));
  ok('every fall into the queue carries the writer', (direct.match(/enqueueOrFail\(m, writerId, dropNoticeFor\(opts\)\)/g) ?? []).length === 4 && !/enqueueOrFail\(m\)/.test(direct));
  const failFn = slice(Q, 'async function failDirectWrite(', '\n/** The toast for a write parked');
  ok("the refusal line is tagged for the writer, and a new session is not toasted about it",
    /\.\.\.\(writerId \? \{ userId: writerId \} : \{\}\)/.test(failFn) && /liveId = \(await currentSessionUser\(\)\)\?\.id \?\? null;/.test(failFn)
      && /const sameSession = !writerId \|\| liveId === undefined \|\| liveId === writerId;/.test(failFn)
      && !/const userId = \(await currentSessionUser\(\)\)\?\.id;/.test(failFn));
  ok('an unknown operation is kept for a build that knows it (rollback safety)',
    /\} else \{\s*\/\/ FORWARD COMPATIBILITY[\s\S]{0,700}gRemaining\.push\(\.\.\.group\.slice\(index\)\);\s*break;/.test(Q));
  ok('the flush parks a group whose record has an unsaved write (unless Retry is replaying it)',
    /!ledger\.isRecordRetrying\(group\[0\]\.table, headId\)\s*&& \(await ledger\.hasUnsavedChain\(flushUserId, group\[0\]\.table, headId\)\)/.test(Q));
  ok('writes swept for a job he left are recorded as notes',
    /notifyDroppedWrites\(entries, reason, \{ asNotes: true \}\)/.test(slice(Q, 'export async function discardQueuedWrites(', '\n}\n'))
      && /if \(asNote\) return \{ id: m\.id, kind: 'write', label, reason, at: Date\.now\(\), userId: m\.userId \};/.test(Q));
  const L = read('utils', 'syncLedger.ts');
  const replay = slice(L, 'async function replayRecord(', '\n// Discard listeners');
  ok('Retry removes a line only after its resend lands or queues', replay.indexOf("if (out === 'failed') return 'failed';") > 0
    && replay.indexOf("if (out === 'failed') return 'failed';") < replay.indexOf('await removeFailures([f.id]);'));
}

console.log('\nD. screens and context:');
{
  const SET = read('app', '(tabs)', 'settings', 'index.tsx');
  const so = slice(SET, 'const confirmSignOut = useCallback(', '}, [logout, router, signingOut]);');
  ok('the sign-out confirm counts unsaved records and says signing out deletes them',
    /countOwnUnsavedRecords\(\)/.test(so) && /Signing out deletes/.test(so) && /'Review Not saved', onPress: \(\) => requestSyncSheet\(\)/.test(so)
      && /unsaved > 0 \? 'Delete & Sign Out'/.test(so));
  const INV = read('app', 'invoice.tsx');
  const past = slice(INV, 'const commitPaymentPastUnsaved = useCallback(', 'const handleMarkPaid = useCallback(');
  ok('the invoice screen asks before a payment over an unsaved append on the same invoice',
    /unsavedPaymentAppends\(existingInvoice\.id\)/.test(past) && /would count it twice/.test(past) && /onPress: \(\) => openNotSavedFromPaymentSheet\(!sameMoney\)/.test(past));
  // Final fix round 3: both paths enter through recordUnderLock (the
  // one-payment-at-a-time lock), which runs commitPaymentPastUnsaved.
  ok('...and every record path goes through it', !/\bcommitPayment\(decision\.amount\)/.test(INV) && !/commitPaymentPastUnsaved\(decision\.amount\)/.test(INV)
    && (INV.match(/recordUnderLock\(decision\.amount\)/g) ?? []).length === 2 && /await commitPaymentPastUnsaved\(amt\);/.test(INV));
  const PILL = read('components', 'OfflineSyncPill.tsx');
  ok('only the app-wide pill answers a request for the sheet', /useEffect\(\(\) => \(floating \? onSyncSheetRequested\(presentSheet\) : undefined\), \[floating, presentSheet\]\);/.test(PILL));
  // Wave-4 final fix: a request always PRESENTS — marked open (an iOS Modal
  // refused behind another Modal) closes then reopens, never a no-op.
  ok('...and every request re-presents the sheet, even one already marked open',
    /const presentSheet = useCallback\(\(\) => \{\s*if \(!sheetOpenRef\.current\) \{ setSheetOpen\(true\); return; \}\s*setSheetOpen\(false\);\s*setTimeout\(\(\) => setSheetOpen\(true\), 0\);\s*\}, \[\]\);/.test(PILL)
      && /sheetOpenRef\.current = sheetOpen;/.test(PILL));
  const CTX = read('contexts', 'ProjectContext.tsx');
  // Integration round 3: the table re-read moved into rereadLedgerTables,
  // shared with the Retry listener (validate-w4-integration-data-sync-r3 C).
  const disc = slice(CTX, 'useEffect(() => onUnsavedDiscarded((discarded) => {', '}), [rereadLedgerTables, persistCoAuditPending]);');
  const reread = slice(CTX, 'const rereadLedgerTables = useCallback(', '}, [userId, queryClient, refetchInvoicesNow]);');
  // Round 2: by the ids that rode the discarded writes, not a time window.
  ok("Discard drops exactly the change order's audit entries that rode the discarded writes",
    /const coDrops = coAuditDropsForDiscard\(discarded\);/.test(disc) && /drop === 'all' \? \[\] : list\.filter\(\(e\) => !drop\.has\(e\.id\)\)/.test(disc)
      && !/from - 2000/.test(disc) && /await persistCoAuditPending\(\)/.test(disc));
  ok("a change-order edit made while its INSERT was being refused is parked behind it, not dropped as 'failed'",
    /const pendingInsert = changeOrderInsertsRef\.current\.get\(id\);\s*if \(pendingInsert\) await pendingInsert;/.test(CTX)
      && !/insertOutcome === 'failed'\) return 'failed'/.test(CTX));
  ok('...and re-reads the table, so the phone goes back to MAGE\'s copy',
    /rereadLedgerTables\(tables\);/.test(disc)
      && /change_orders: 'changeOrders'/.test(reread) && /queryClient\.invalidateQueries\(\{ queryKey: \[key, userId\] \}\)/.test(reread));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
