// validate-w4-integration-data-sync-r2.ts — wave 4 integration round 2, the
// data-sync lens. The executing half is __tests__/sync/offline-queue.test.ts
// ("integration round 2 — …" blocks drive the real queue); this file runs the
// pure cores and pins the wiring jest cannot reach (context, hooks, screens).
//
// What it holds:
//   A. A flush drop is in the queue OR the ledger at every instant: its line
//      is written (awaited) inside the group's record slot, before the
//      write-back takes it out of the queue; every loader reads the queue
//      before the ledger.
//   B. The writer (and madeAt) of a direct write are taken at the CALL, before
//      any slot wait; a write whose account is no longer signed in is not sent
//      under the new one.
//   C. One record key for the slot, the flush group, the guard and the ledger
//      (recordIdOf): a project_financials row parks and replays in order.
//   D. The invoice screen tells "held behind Not saved" from "refused", and
//      never offers a button that cannot record.
//   E. An unreadable queue does not fail every save; a Retry's resend never
//      adds a second line.
//   F. Leave counts and notes the job's Not-saved lines.
//   G. Time entries and safety keep their unsaved rows.
//   H. A CO's number stays confirmed when only an EDIT is unsaved.
//   I. Discard drops exactly the audit entries that rode the discarded write.
//   J. A queued payment append refused by a flush comes off the device copy.
//
// Run: bun run scripts/validate-w4-integration-data-sync-r2.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parkBehindUnsavedIn, unsavedCreateIdsIn, notesForUnsavedIn, parseFailures, labelForTable, unsavedIdsIn,
  type SyncFailure,
} from '../utils/syncLedger';
import {
  stripDroppedPayment, droppedAppendEntryId, coAuditDropsForDiscard, ledgerLineAsQueueEntry, countQueuedEntriesForProject,
  queuedEntryRevokedProject,
} from '../utils/projectContextPure';

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

const Q = read('utils', 'offlineQueue.ts');
const CTX = read('contexts', 'ProjectContext.tsx');
const A = 'user-a';

console.log('\nA. a flush drop is never in neither place:');
{
  const runGroup = slice(Q, 'async function runGroup(group: OfflineMutation[]): Promise<GroupResult> {', '\n  // Bounded-concurrency');
  ok('runGroup writes the group\'s drops to the ledger (awaited) BEFORE its write-back',
    runGroup.indexOf('await recordGroupDrops(result);') > 0
      && runGroup.indexOf('await recordGroupDrops(result);') < runGroup.indexOf('await writeBackGroup(group, result);'));
  const rgd = slice(Q, 'async function recordGroupDrops(', '\n  }\n');
  ok('...conflicts under not_visible_conflict, the rest under the flush reason',
    /await recordDropsInLedger\(result\.dropped\.filter\(\(m\) => !conflictIds\.has\(m\.id\)\), DROP_REASON\);/.test(rgd)
      && /await recordDropsInLedger\(result\.dropped\.filter\(\(m\) => conflictIds\.has\(m\.id\)\), NOT_VISIBLE_CONFLICT\);/.test(rgd));
  ok('the children of a doomed job are ledgered under their slot before they leave the queue',
    /await withRecordSlot\(slotKeysFor\(group\), async \(\) => \{\s*await recordGroupDrops\(doomed\);\s*await writeBackGroup\(group, doomed\);/.test(Q));
  ok('the end-of-flush report is toast-only (alreadyRecorded) — one toast, no line resurrected',
    /await notifyDroppedWrites\(dropped, DROP_REASON, \{ alreadyRecorded: true \}\);/.test(Q)
      && /await notifyDroppedWrites\(conflicts, NOT_VISIBLE_CONFLICT, \{ alreadyRecorded: true \}\);/.test(Q));
  const rdl = slice(Q, 'async function recordDropsInLedger(', '\n}\n');
  ok('the ledger write is awaited, never `void`', /await ledger\.recordSyncFailures\(/.test(rdl) && !/void ledger\.recordSyncFailures/.test(Q));
  const append = slice(Q, 'async function appendEntryLocked(', '\nexport async function addToOfflineQueue(');
  ok('the cap drop and the enqueue failure are awaited too',
    /await notifyDroppedWrites\(\s*userId \?/.test(append) && /await notifyDroppedWrites\(\[entry\], `enqueue failed:/.test(append));
  ok('every ProjectContext loader reads the QUEUE before the ledger',
    !/\.\.\.await unsavedWriteIds\('\w+'\), \.\.\.await queuedIdsFor\(/.test(CTX)
      && (CTX.match(/\.\.\.await queuedIdsFor\('(\w+)'\), \.\.\.await unsavedWriteIds\('\1'\)/g) ?? []).length >= 11);
}

console.log('\nB. the writer is taken at the call:');
{
  const run = slice(Q, 'function runDirectWrite(m: NewMutation, opts?: DirectWriteOpts): Promise<WriteOutcome> {', '\n}\n');
  ok('writer and madeAt are read BEFORE the record slot is waited on',
    run.indexOf('const writer = currentSessionUser();') > 0 && run.indexOf('const madeAt = Date.now();') > 0
      && run.indexOf('const writer = currentSessionUser();') < run.indexOf('withRecordSlot(')
      && /withRecordSlot\(keys, \(\) => directWrite\(m, keys, writer, madeAt, opts\)\)/.test(run));
  const direct = slice(Q, 'async function directWrite(', '\nasync function failDirectWrite(');
  ok('directWrite no longer stamps madeAt after its waits', !/const madeAt = Date\.now\(\);/.test(direct));
  const firstCheck = direct.indexOf('if (!(await sessionIsWriter(writerId))) return handOffToWriter(m, writerId, opts);');
  ok('after the waits, a changed session is handed to the writer — before the guard AND again before the send',
    firstCheck > direct.indexOf('if (parent) await parent;')
      && firstCheck < direct.indexOf('const guard = await queueBehindEarlierWrite(m, keys, writer, opts);')
      && direct.lastIndexOf('if (!(await sessionIsWriter(writerId))) return handOffToWriter(m, writerId, opts);') > direct.indexOf('const guard = await queueBehindEarlierWrite(')
      && direct.lastIndexOf('if (!(await sessionIsWriter(writerId))) return handOffToWriter(m, writerId, opts);') < direct.indexOf('const sentAt = ++writeOrderSeq;'));
  const hand = slice(Q, 'async function handOffToWriter(', '\n}\n');
  ok('the hand-off queues TAGGED FOR THE WRITER, silently (no toast, no screen listener)',
    /return enqueueOrFail\(m, writerId, \{ \.\.\.dropNoticeFor\(opts\), noToast: true \}\);/.test(hand) && /if \(!writerId\) return 'failed';/.test(hand));
  const guard = slice(Q, 'async function queueBehindEarlierWrite(', '\nasync function enqueueOrFail(');
  ok('the guard takes the writer, never the live session', /writer: SessionUser \| null,/.test(guard) && !/await currentSessionUser\(\)/.test(guard));
  ok('a parked toast only for the live session', /if \(guard\.parked && !opts\?\.callerOwnsRefusal && \(await sessionIsWriter\(writerId\)\)\) toastParked\(m\.table\);/.test(direct));
  ok('drop listeners and the toast are skipped for a write that is not the live session\'s',
    /for \(const listener of noToast \? \[\] : droppedListeners\)/.test(Q) && /if \(unclaimed\.length > 0 && !noToast\)/.test(Q));
}

console.log('\nC. one record key everywhere:');
{
  // Integration round 3: the key is per TABLE (id, else that table's own
  // primary key — see validate-w4-integration-data-sync-r3), no longer one
  // id ?? project_id ?? … chain for every table.
  ok('recordKeyOf is built on recordIdOf(table, data) — id, else the table\'s own key',
    /const k = d\.id \?\? \(keyCol \? d\[keyCol\] : undefined\);/.test(slice(read('utils', 'syncRecordKey.ts'), 'export function recordIdOf(', '\n}\n'))
      && /import \{ recordIdOf \} from '@\/utils\/syncRecordKey';/.test(Q)
      && /const id = recordIdOf\(table, data\);/.test(slice(Q, 'function recordKeyOf(', '\n}\n')));
  ok('the ledger line (flush), the direct refusal line and the direct park all use it',
    /const rid = recordIdOf\(m\.table, m\.data\);\s*const label/.test(Q)
      && /const rid = recordIdOf\(m\.table, m\.data\);\s*\/\/ Tagged for the WRITER/.test(Q)
      && /const rid = recordIdOf\(m\.table, m\.data\);\s*if \(!opts\?\.ledgerRetry && rid !== null\)/.test(Q));
  ok("the flush's park check uses it", /const headId = recordIdOf\(group\[0\]\.table, group\[0\]\.data\);\s*if \(headId !== null\)/.test(Q));
  ok('project_financials / building_access_rules / sub_portal_snapshots have sheet labels',
    labelForTable('project_financials') === 'Project budget & terms' && labelForTable('building_access_rules') !== 'building_access_rules'
      && labelForTable('sub_portal_snapshots') !== 'sub_portal_snapshots');
  const fin: SyncFailure = { id: 'd1', kind: 'write', label: 'x', reason: 'r', at: 1, userId: A, table: 'project_financials', recordId: 'p1', operation: 'upsert', row: { project_id: 'p1', target_budget: 100000 }, queuedAt: 1 };
  const plan = parkBehindUnsavedIn([fin], { id: 'd2', kind: 'write', label: 'x', reason: 'w', at: 2, userId: A, table: 'project_financials', recordId: 'p1', operation: 'upsert', row: { project_id: 'p1', target_budget: 150000 }, queuedAt: 2 });
  ok('a later project_financials upsert folds into the parked one — Retry sends the NEWEST budget',
    plan.parked && plan.next.length === 1 && plan.next[0].row?.target_budget === 150000, plan.next);
}

console.log('\nD. the invoice screen:');
{
  const INV = read('app', 'invoice.tsx');
  const past = slice(INV, 'const commitPaymentPastUnsaved = useCallback(', 'const handleMarkPaid = useCallback(');
  ok('no "Record a new payment" button (it could never record)', !/Record a new payment/.test(INV));
  ok('a payment over ANY unsaved change of the invoice is held with the instruction, not attempted',
    /held = await hasUnsavedChainForSession\('invoices', existingInvoice\.id\)/.test(past) && /if \(!held\) \{ await commitPayment\(amt\); return; \}/.test(past)
      && /retried or discarded/.test(past));
  const commit = slice(INV, 'const commitPayment = useCallback(', 'const commitPaymentPastUnsaved = useCallback(');
  ok("a 'failed' that was HELD says Not sent, never \"the server did not accept\"",
    /held = await hasUnsavedChainForSession\('invoices', existingInvoice\.id\)/.test(commit)
      && commit.indexOf("'Payment not sent'") > 0 && commit.indexOf("'Payment not sent'") < commit.indexOf("'Payment not recorded'"));
}

console.log('\nE. an unreadable queue:');
{
  const guard = slice(Q, 'async function queueBehindEarlierWrite(', '\nasync function enqueueOrFail(');
  ok('read twice; still unreadable → sent directly (nothing in it can be flushed)',
    /\} catch \(first\) \{[\s\S]{0,1600}try \{\s*queue = await readOfflineQueueOrThrow\(\);\s*\} catch \{[\s\S]{0,200}return \{ ownDepth: 0 \};/.test(guard)
      && !/appendEntryLocked\(entry\); return \{ outcome: 'queued' as const, ownDepth: 1/.test(guard));
  ok("a Retry's (or a caller-owned) enqueue failure adds no line", /return opts\?\.ledgerRetry \|\| opts\?\.callerOwnsRefusal \? \{ noLedger: true \} : \{\};/.test(Q)
    && /await notifyDroppedWrites\(\[entry\], `enqueue failed: \$\{err instanceof Error \? err\.message : String\(err\)\}`, onFail\);/.test(Q));
}

console.log('\nF. leaving a job:');
{
  const rowLine: SyncFailure = { id: 'l1', kind: 'write', label: 'x', reason: 'r', at: 1, userId: A, table: 'daily_reports', recordId: 'dr1', operation: 'insert', row: { id: 'dr1', project_id: 'p-left' }, queuedAt: 1 };
  const editLine: SyncFailure = { id: 'l2', kind: 'write', label: 'x', reason: 'r', at: 2, userId: A, table: 'punch_items', recordId: 'pi1', operation: 'update', row: { id: 'pi1', status: 'done' }, queuedAt: 2 };
  const rpcLine: SyncFailure = { id: 'l3', kind: 'write', label: 'x', reason: 'r', at: 3, userId: A, table: 'invoices', recordId: 'inv1', operation: 'rpc', rpc: { fn: 'invoice_append_payment', args: {} }, queuedAt: 3 };
  const other: SyncFailure = { ...rowLine, id: 'l4', recordId: 'dr9', row: { id: 'dr9', project_id: 'p-other' } };
  const map = new Map([['pi1', 'p-left'], ['inv1', 'p-left']]);
  const entries = [rowLine, editLine, rpcLine, other].map(ledgerLineAsQueueEntry).filter((e): e is NonNullable<typeof e> => e !== null);
  ok('a ledger line matches its job by row project_id, or by the record → job map (edits, rpc)',
    countQueuedEntriesForProject(entries, 'p-left', map) === 3, countQueuedEntriesForProject(entries, 'p-left', map));
  const noted = notesForUnsavedIn([rowLine, editLine, other], A, (f) => {
    const e = ledgerLineAsQueueEntry(f);
    return e && queuedEntryRevokedProject(e, new Set(['p-left']), map) ? 'You left Henderson' : null;
  });
  ok('the sweep turns the job\'s lines into NOTES (no row, no record id) and leaves other jobs alone',
    noted.noted === 2 && !noted.next[0].row && !noted.next[0].recordId && noted.next[0].reason === 'You left Henderson' && !!noted.next[2].row
      && [...unsavedIdsIn(noted.next, 'daily_reports')].join() === 'dr9', noted.next);
  ok("another user's lines are never touched", notesForUnsavedIn([{ ...rowLine, userId: 'user-b' }], A, () => 'x').noted === 0);
  const count = slice(CTX, 'const countQueuedForProject = useCallback(', '\n  }, []);');
  ok('countQueuedForProject adds the job\'s Not-saved lines', /ownUnsavedWrites\(\)\.catch\(\(\) => \[\]\)/.test(count)
    && /countQueuedEntriesForProject\(unsavedEntries, projectId, childProject\)/.test(count));
  const sweep = slice(CTX, 'const sweepRevokedJobs = (', '\n  };\n');
  ok('the leave / revocation sweep notes them with the same sentence, and counts them',
    /unsaved = await noteUnsavedWrites\(\(f\) => \{/.test(sweep) && /return writes \+ unsaved \+ photos;/.test(sweep));
}

console.log('\nG. time entries and safety keep their unsaved rows:');
{
  const TE = read('hooks', 'useTimeEntries.ts');
  const rq = slice(TE, 'async function readTimeEntryQueue(', '\n}\n');
  ok('the time-entries pull keeps unsaved shifts — queue read first, then the ledger',
    rq.indexOf('await getOfflineQueue()') > 0 && rq.indexOf("await unsavedWriteIds('time_entries')") > rq.indexOf('await getOfflineQueue()'));
  // Field-lens round 2 moved the re-pull inside an async block that first takes
  // a discarded never-saved create off the phone (dropDiscardedTimeEntryCreates);
  // the re-pull itself is still pinned here.
  const disc = slice(TE, 'useEffect(() => onUnsavedDiscarded(discarded => {', '\n  }), []);');
  ok('...and re-pulls on a Discard', /if \(!discarded\.some\(f => f\.table === 'time_entries'\)\) return;/.test(disc) && /setPullNonce\(n => n \+ 1\);/.test(disc));
  const SC = read('contexts', 'SafetyContext.tsx');
  ok('the safety merge keeps unsaved rows — queue read first, then the ledger',
    SC.indexOf('const unsaved = await unsavedWriteIds(table)') > SC.indexOf('const queue = await getOfflineQueue().catch(() => []);')
      && /new Set\(\[\.\.\.pendingIdsForTable\(queue, table\), \.\.\.unsaved\]\)/.test(SC));
  ok('...and re-reads a table on a Discard', /return onUnsavedDiscarded\(\(discarded\) => \{[\s\S]{0,200}void rereadTables\(tables\);/.test(SC));
}

console.log('\nH. a CO number with an unsaved edit:');
{
  const own: SyncFailure[] = [
    { id: 'a', kind: 'write', label: 'x', reason: 'r', at: 1, userId: A, table: 'change_orders', recordId: 'co1', operation: 'update', row: { id: 'co1' } },
    { id: 'b', kind: 'write', label: 'x', reason: 'r', at: 1, userId: A, table: 'change_orders', recordId: 'co2', operation: 'insert', row: { id: 'co2' } },
  ];
  ok('only a CREATE line makes the number "unsaved"', [...unsavedCreateIdsIn(own, 'change_orders')].join() === 'co2');
  const HOOK = read('hooks', 'useServerChangeOrderNumber.ts');
  ok('the hook reads creates for `unsaved` and any line for `editUnsaved`',
    /unsaved = \(await unsavedCreateIds\('change_orders'\)\)\.has\(id\)/.test(HOOK) && /editUnsaved = \(await unsavedWriteIds\('change_orders'\)\)\.has\(id\)/.test(HOOK));
  ok('the CO screen keeps the confirmed number while the edit waits',
    /serverNumber\.state === 'confirmed' \|\| serverNumber\.state === 'edit_unsaved'/.test(read('app', 'change-order.tsx')));
}

console.log('\nI. Discard drops exactly the audit entries that rode the write:');
{
  const drops = coAuditDropsForDiscard([
    { table: 'change_orders', recordId: 'co1', operation: 'update', rides: ['e1', 'e2'] },
    { table: 'change_orders', recordId: 'co1', operation: 'update', rides: ['e3'] },
    { table: 'change_orders', recordId: 'co2', operation: 'insert' },
    { table: 'change_orders', recordId: 'co3', operation: 'update' },
    { table: 'rfis', recordId: 'r1', operation: 'update', rides: ['x'] },
  ]);
  const co1 = drops.get('co1');
  ok('an edit\'s riders, unioned across its lines', co1 instanceof Set && [...co1].sort().join() === 'e1,e2,e3');
  ok('a discarded CREATE takes every owed entry of the CO', drops.get('co2') === 'all');
  ok('a line with no riders takes nothing (those entries belong to edits that landed)', !drops.has('co3') && !drops.has('r1'));
  const tail: SyncFailure = { id: 't', kind: 'write', label: 'x', reason: 'r', at: 1, userId: A, table: 'change_orders', recordId: 'co1', operation: 'update', row: { id: 'co1', a: 1 }, rides: ['e1'], queuedAt: 1 };
  const folded = parkBehindUnsavedIn([tail], { id: 'n', kind: 'write', label: 'x', reason: 'w', at: 2, userId: A, table: 'change_orders', recordId: 'co1', operation: 'update', row: { id: 'co1', a: 2 }, rides: ['e2'], queuedAt: 2 });
  ok('a folded edit carries both edits\' riders', folded.next.length === 1 && (folded.next[0].rides ?? []).join() === 'e1,e2', folded.next);
  ok('riders survive a parse round trip', (parseFailures(JSON.stringify([tail]))[0].rides ?? []).join() === 'e1');
  const upd = slice(CTX, 'const updateChangeOrder = useCallback(', '\n  const getChangeOrdersForProject');
  ok('updateChangeOrder hangs this edit\'s audit ids on its write (queued or direct)',
    /const rides = auditToAppend\.map\(e => e\.id\);/.test(upd) && /addToOfflineQueue\(\{ table: 'change_orders', operation: 'update', data: coPayload, \.\.\.\(rides\.length > 0 \? \{ rides \} : \{\}\) \}\)/.test(upd)
      && /supabaseWriteDetailed\('change_orders', 'update', coPayload, rides\.length > 0 \? \{ rides \} : undefined\)/.test(upd));
  const L = read('utils', 'syncLedger.ts');
  ok("Retry's resend carries the line's riders", /\{ ledgerRetry: true, \.\.\.\(f\.rides \? \{ rides: f\.rides \} : \{\}\) \}/.test(L));
}

console.log('\nJ. a queued payment append the flush refused:');
{
  const inv = { status: 'paid', totalDue: 1000, amountPaid: 1000, payments: [{ id: 'p1', amount: 400 }, { id: 'p2', amount: 600 }] };
  const s1 = stripDroppedPayment(inv, 'p2');
  ok('the refused entry leaves, amount_paid drops by it, status recomputed', !!s1 && s1.payments.length === 1 && s1.amountPaid === 400 && s1.status === 'partially_paid', s1);
  const s2 = stripDroppedPayment({ status: 'paid', totalDue: 500, amountPaid: 500, payments: [{ id: 'only', amount: 500 }] }, 'only');
  ok('nothing left paid → back to sent', !!s2 && s2.amountPaid === 0 && s2.status === 'sent', s2);
  ok('an entry not on the row → null (nothing to take back)', stripDroppedPayment(inv, 'nope') === null);
  ok('only invoice_append_payment rpc entries are recognised',
    droppedAppendEntryId({ table: 'invoices', operation: 'rpc', rpc: { fn: 'invoice_append_payment', args: { p_entry: { id: 'pay-1' } } } }) === 'pay-1'
      && droppedAppendEntryId({ table: 'invoices', operation: 'update', rpc: { fn: 'invoice_append_payment', args: { p_entry: { id: 'x' } } } }) === null);
  const lis = slice(CTX, 'useEffect(() => onQueueDropped((dropped, reason) => {', '}), [userId, saveInvoicesMutation, refetchInvoicesNow]);');
  ok('ProjectContext strips it from the device copy and re-reads — not for the direct call\'s own enqueue failure',
    /if \(!userId \|\| reason\.startsWith\('enqueue failed'\)\) return;/.test(lis) && /stripDroppedPayment<InvoicePayment>\(cur, entryId\)/.test(lis)
      && /void refetchInvoicesNow\(\)/.test(lis) && /if \(m\.userId !== userId\) continue;/.test(lis));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
