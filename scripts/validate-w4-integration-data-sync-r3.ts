// validate-w4-integration-data-sync-r3.ts — wave 4 integration round 3, the
// data-sync lens. The executing half is __tests__/sync/offline-queue.test.ts
// ("integration round 3 — …" blocks drive the real queue and ledger); this
// file runs the pure cores and pins the wiring jest cannot reach (the
// ProjectContext loaders and listeners, the Leave dialog).
//
// What it holds:
//   A. A record is keyed on ITS table's primary key (utils/syncRecordKey):
//      two id-less notices, or two sub portal pages, of one job are two
//      records — one refusal no longer parks, folds or discards the other.
//   B. A job under Not saved is kept whole by the projects load, and a
//      settings save under Not saved keeps the device settings — so the next
//      save cannot fold the server's stale values over his edit.
//   C. A Retry that takes lines off the sheet re-reads their tables, as a
//      Discard does (invoices through refetchInvoicesNow); a project_financials
//      line re-reads the projects list.
//   D. Leave names the Not-saved part and opens the sheet; "Sync first" only
//      for what a sync can send.
//   E. The profile row: a write that shares no column with a refused settings
//      save goes out (the push token); one that does still parks; the label.
//   F. A write of the previous account is never queued into another user's
//      live session.
//
// Run: bun run scripts/validate-w4-integration-data-sync-r3.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { recordIdOf, RECORD_KEY_BY_TABLE } from '../utils/syncRecordKey';
import {
  parkBehindUnsavedIn, writeIsIndependentOfChain, unsavedChainBlocksIn, labelForTable, type SyncFailure,
} from '../utils/syncLedger';
import { unsavedProjectIdsIn, retriedAppendEntry, optimisticPaymentAppend, stripDroppedPayment } from '../utils/projectContextPure';
import { leaveDialogCopy } from '../utils/projectRole';
import { settingsRowWritePending } from '../utils/settingsLoadGuard';
import { termsWritesPending } from '../utils/paymentTerms';
import { planProjectsLoad } from '../utils/projectsLoadGuard';

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
const flat = (s: string) => s.replace(/\s+/g, ' ');

const Q = read('utils', 'offlineQueue.ts');
const L = read('utils', 'syncLedger.ts');
const CTX = read('contexts', 'ProjectContext.tsx');
const PD = read('app', 'project-detail.tsx');
const A = 'user-a';

const line = (over: Partial<SyncFailure>): SyncFailure => ({
  id: 'l1', kind: 'write', label: 'x', reason: 'r', at: 1, userId: A, queuedAt: 1, ...over,
});

console.log('\nA. a record is keyed on its own table\'s primary key:');
{
  const notice = { portal_id: 'portal-1', project_id: 'p1', author_type: 'gc', body: 'x' };
  ok('an id-less portal notice is no record (round 2: keyed on its JOB, p1)', recordIdOf('portal_messages', notice) === null, recordIdOf('portal_messages', notice));
  ok('a portal notice with an id is that id', recordIdOf('portal_messages', { ...notice, id: 'm1' }) === 'm1');
  ok('a sub portal page is its sub_portal_id, never the job it carries',
    recordIdOf('sub_portal_snapshots', { sub_portal_id: 'sub-e', project_id: 'p1' }) === 'sub-e');
  ok('a portal snapshot is its portal_id', recordIdOf('portal_snapshots', { portal_id: 'por1', project_id: 'p1' }) === 'por1');
  ok('project_financials / building_access_rules / wip_cost_overrides are their project_id',
    recordIdOf('project_financials', { project_id: 'p1' }) === 'p1'
      && recordIdOf('building_access_rules', { project_id: 'p1' }) === 'p1'
      && recordIdOf('wip_cost_overrides', { project_id: 'p1', user_id: A }) === 'p1');
  ok('cash_flow_settings is its user_id', recordIdOf('cash_flow_settings', { user_id: A }) === A);
  ok('an id-keyed table never falls back to project_id (an id-less daily report is no record)',
    recordIdOf('daily_reports', { project_id: 'p1' }) === null && recordIdOf('change_orders', { project_id: 'p1', portal_id: 'x' }) === null);
  ok('id wins everywhere', recordIdOf('project_financials', { id: 'x', project_id: 'p1' }) === 'x');
  ok('only non-id-keyed tables are in the map', Object.keys(RECORD_KEY_BY_TABLE).sort().join(',')
    === 'building_access_rules,cash_flow_settings,portal_snapshots,project_financials,sub_portal_snapshots,wip_cost_overrides');
  ok('offlineQueue imports the rule; every key site passes the table',
    /import \{ recordIdOf \} from '@\/utils\/syncRecordKey';/.test(Q)
      && !/recordIdOf\((m\.data|data|group\[0\]\.data)\)/.test(Q)
      && !/d\.id \?\? d\.project_id/.test(Q));
  ok('the flush groups by it (mutation.id when there is no key)',
    /const recordKey = `\$\{mutation\.table\}:\$\{recordIdOf\(mutation\.table, mutation\.data\) \?\? mutation\.id\}`;/.test(Q));
  // The ledger side of the two critic replays: a refused electrician page and
  // the plumber's page are not one chain, so nothing parks or folds.
  const elec = line({ table: 'sub_portal_snapshots', recordId: recordIdOf('sub_portal_snapshots', { sub_portal_id: 'sub-e', project_id: 'p1' })!, operation: 'upsert', row: { sub_portal_id: 'sub-e', project_id: 'p1' } });
  const plumb = line({ id: 'l2', at: 2, queuedAt: 2, table: 'sub_portal_snapshots', recordId: recordIdOf('sub_portal_snapshots', { sub_portal_id: 'sub-p', project_id: 'p1' })!, operation: 'upsert', row: { sub_portal_id: 'sub-p', project_id: 'p1' } });
  ok('the plumber\'s page is not parked behind (or folded into) the electrician\'s refused one',
    !parkBehindUnsavedIn([elec], plumb).parked);
}

console.log('\nB. a job / a settings save under Not saved is kept on the phone:');
{
  const fin = line({ table: 'project_financials', recordId: 'p1', operation: 'upsert', row: { project_id: 'p1', target_budget: 150000 } });
  const ids = unsavedProjectIdsIn([fin], new Set());
  ok('an unsaved project_financials write names its job', ids.has('p1'));
  const plan = planProjectsLoad([{ id: 'p1', targetBudget: 100000 }], [{ id: 'p1', targetBudget: 150000 }], { seq: 0, byId: new Map() } as never, 0, { pending: ids });
  ok('...so the load keeps the device\'s 150k over the server\'s stale 100k', plan.projects[0].targetBudget === 150000, plan.projects);
  ok('an unsaved projects row write names its job', unsavedProjectIdsIn([line({ table: 'projects', recordId: 'p3', operation: 'update', row: { id: 'p3' } })], new Set()).has('p3'));
  const rpcOnly = [line({ table: 'projects', recordId: 'p2', operation: 'rpc', rpc: { fn: 'f', args: {} } })];
  ok('a projects id named only for a refused rpc does not pin the row — unless a write of it is queued',
    !unsavedProjectIdsIn(rpcOnly, new Set()).has('p2') && unsavedProjectIdsIn(rpcOnly, new Set(['p2'])).has('p2'));
  const load = slice(CTX, "console.log('[ProjectContext] Loading projects');", 'const bearerBefore = await readBearer();');
  // Wave-4 final fix: every Not-saved job is kept whole (money-only too — see
  // the mount-level __tests__/sync/ledger-no-reload-loop.test.tsx R1 case);
  // still read after the queue.
  // Round 8: no longer pinned whole — the server row with the line laid over
  // it (validate-w4-final-fix-r8); only a job with no server row to lay over
  // (or a refused delete) keeps the device pin, added after the SELECT.
  ok('the projects load reads the Not-saved jobs AFTER the queue read, and pins only those with no server row to lay over',
    load.indexOf('await ownQueuedProjectIds(userId)') > 0
      && load.indexOf('const unsavedPins = await unsavedProjectPins(userId);') > load.indexOf('await ownQueuedProjectIds(userId)')
      && /for \(const id of ledgerOnlyPins\) if \(!overlaidIds\.has\(id\) \|\| !remoteIds\.has\(id\)\) pendingAtStart\.add\(id\);/.test(CTX)
      && /const unsavedProjects = new Set\(\[\.\.\.unsavedPins\.whole, \.\.\.unsavedPins\.moneyOnly\]\);/.test(load));
  ok('...and the contract-terms pending set keeps the queue-pinned ones',
    /const pendingProjectIds = new Set\(\[\.\.\.await queuedIdsFor\('projects'\), \.\.\.\[\.\.\.unsavedProjects\]\.filter\(\(id\) => queuePinned\.has\(id\)\)\]\);/.test(CTX));
  const helper = slice(CTX, 'async function unsavedProjectPins(', '\n}\n');
  ok('unsavedProjectPins reads the queue, then this account\'s ledger, through the pure core',
    helper.indexOf("await queuedIdsFor('projects')") > 0
      && helper.indexOf('readSyncFailuresOrThrow()') > helper.indexOf("await queuedIdsFor('projects')")
      && /unsavedProjectPinsIn\(ownFailures\(await readSyncFailuresOrThrow\(\), userId\), queued\)/.test(helper));
  const settingsLine = { table: 'profiles', operation: 'update', data: { id: A, tax_rate: 8.25, location: 'TX' } };
  ok('a Not-saved settings line keeps the device settings (settingsRowWritePending)', settingsRowWritePending([settingsLine], A));
  ok('...a Not-saved push-token line does not', !settingsRowWritePending([{ table: 'profiles', operation: 'update', data: { id: A, push_token: 't' } }], A));
  ok('a Not-saved terms line keeps the device terms', termsWritesPending([{ table: 'profiles', operation: 'update', data: { id: A, deposit_pct: 10 } }], A).split);
  // Wave-4 final fix: the row guard keeps the queue and the ledger APART —
  // a queued save owes a re-read, a Not-saved one does not (it looped).
  ok('the settings load adds this session\'s Not-saved profile lines to BOTH guards, queue first',
    /const termsQueue = await getOfflineQueue\(\);\s*const termsPending = pendingWithInFlight\(termsWritesPending\(\[\.\.\.termsQueue, \.\.\.await unsavedAsQueueEntries\('profiles'\)\], userId\), termsInFlight\);/.test(CTX)
      && /const rowQueue = await getOfflineQueue\(\);\s*const rowQueued = settingsRowWritePending\(rowQueue, userId\);\s*const rowUnsaved = settingsRowWritePending\(await unsavedAsQueueEntries\('profiles'\), userId\);/.test(CTX)
      && /rowWriteQueued: rowQueued,\s*rowWriteUnsaved: rowUnsaved,/.test(CTX));
}

console.log('\nC. a Retry that lands re-reads what it wrote:');
{
  ok('syncLedger exports onUnsavedRetried', /export function onUnsavedRetried\(listener: RetryListener\): \(\) => void/.test(L));
  const replay = slice(L, 'async function replayRecord(target: SyncFailure)', '\nasync function replayRecordLines(');
  ok('the replay tells every retry listener the lines it took off the sheet — in a finally, only when one went',
    /finally \{/.test(replay) && /if \(sent\.length > 0\) \{/.test(replay) && /l\(sent, out\)/.test(replay));
  const lines = slice(L, 'async function replayRecordLines(', '\n}\n');
  ok('a line is counted as sent only after its resend reported and it left the ledger',
    lines.indexOf("if (out === 'failed') return 'failed';") > 0
      && lines.indexOf('await removeFailures([f.id]);') > lines.indexOf("if (out === 'failed') return 'failed';")
      && lines.indexOf('sent.push(f);') > lines.indexOf('await removeFailures([f.id]);'));
  const reread = slice(CTX, 'const rereadLedgerTables = useCallback(', '}, [userId, queryClient, refetchInvoicesNow]);');
  ok('the shared re-read: invoices through refetchInvoicesNow (never a raw invalidate)',
    /if \(table === 'invoices'\) \{ void refetchInvoicesNow\(\)\.catch\(\(\) => \{\}\); continue; \}/.test(reread)
      && !/invoices: 'invoices'/.test(reread));
  ok('...project_financials re-reads the projects list; profiles the settings',
    /project_financials: 'projects'/.test(reread) && /profiles: 'settings'/.test(reread));
  // The critic's replay, on the pure cores: queued append → refused at the
  // flush → stripped → Retry takes the line off → the entry goes back on.
  const entry = { id: 'e1', amount: 5000 };
  const inv0 = { id: 'inv1', status: 'sent', totalDue: 5000, amountPaid: 0, payments: [] as { id: string; amount: number }[] };
  const paid = { ...inv0, ...optimisticPaymentAppend(inv0, entry)! };
  const stripped = { ...paid, ...stripDroppedPayment(paid, 'e1')! };
  const appendLine = line({ table: 'invoices', recordId: 'inv1', operation: 'rpc', rpc: { fn: 'invoice_append_payment', args: { p_invoice_id: 'inv1', p_entry: entry } } });
  const hit = retriedAppendEntry<{ id: string; amount: number }>(appendLine);
  const back = hit ? { ...stripped, ...optimisticPaymentAppend(stripped, hit.entry)! } : stripped;
  ok('a retried append names its invoice and entry, and puts the payment back (status paid, $5,000.00 once)',
    stripped.status === 'sent' && !!hit && hit.invoiceId === 'inv1' && back.status === 'paid' && back.amountPaid === 5000
      && optimisticPaymentAppend(back, entry) === null, { stripped: stripped.status, back });
  ok('...and nothing else is an append', retriedAppendEntry(line({ table: 'invoices', recordId: 'inv1', operation: 'update', row: { id: 'inv1' } })) === null);
  const retried = slice(CTX, 'useEffect(() => onUnsavedRetried((sent) => {', '}), [userId, rereadLedgerTables, saveInvoicesMutation]);');
  ok('the Retry listener re-applies the appends it sent (this account\'s lines only), then re-reads',
    /if \(f\.userId !== userId\) continue;/.test(retried) && /retriedAppendEntry<InvoicePayment>\(f\)/.test(retried)
      && /optimisticPaymentAppend\(cur, hit\.entry\)/.test(retried) && /saveInvoicesMutation\.mutate\(next\);/.test(retried)
      && retried.indexOf('rereadLedgerTables(tables);') > retried.indexOf('saveInvoicesMutation.mutate(next);'));
  ok('Discard and Retry both use it',
    /useEffect\(\(\) => onUnsavedDiscarded\(\(discarded\) => \{[\s\S]*?rereadLedgerTables\(tables\);\s*\}\), \[rereadLedgerTables, persistCoAuditPending\]\);/.test(CTX)
      && /useEffect\(\(\) => onUnsavedRetried\(\(sent\) => \{[\s\S]*?rereadLedgerTables\(tables\);\s*\}\), \[userId, rereadLedgerTables, saveInvoicesMutation\]\);/.test(CTX));
}

console.log('\nD. Leave names what a sync cannot send:');
{
  const onlyUnsaved = leaveDialogCopy('Henderson', 2, 2);
  ok('only Not-saved lines: no "Sync first" (it looped), "Open Not saved" instead, named in the copy',
    !onlyUnsaved.offerSyncFirst && onlyUnsaved.offerOpenNotSaved && /under Not saved/.test(onlyUnsaved.message)
      && onlyUnsaved.leaveLabel === 'Leave anyway', onlyUnsaved);
  const mixed = leaveDialogCopy('Henderson', 3, 1);
  ok('mixed: both buttons; says 1 of the 3 is under Not saved',
    mixed.offerSyncFirst && mixed.offerOpenNotSaved && /1 of them is under Not saved/.test(mixed.message), mixed.message);
  const queuedOnly = leaveDialogCopy('Henderson', 3);
  ok('queued only: the round-2 dialog, no Not-saved button', queuedOnly.offerSyncFirst && !queuedOnly.offerOpenNotSaved
    && queuedOnly.message.startsWith("3 changes on this job haven't reached the cloud yet. Leaving now discards them."));
  const leave = slice(PD, 'const handleLeave = useCallback(() => {', 'const handleLeaveRef = useRef(handleLeave);');
  ok('the screen counts the Not-saved part and builds the dialog from both',
    /const unsaved = pending > 0 \? await countUnsavedForProject\(id\)\.catch\(\(\) => 0\) : 0;/.test(leave)
      && /const copy = leaveDialogCopy\(name, pending, unsaved, Platform\.OS === 'android' \? 3 : 4\);/.test(leave));
  ok('"Open Not saved" opens the sheet', /copy\.offerOpenNotSaved \? \[\{ text: 'Open Not saved', onPress: \(\) => \{ requestSyncSheet\(\); \} \}\]/.test(flat(leave)));
  ok('a plain Leave re-opens only for MORE than the dialog said (not merely > 0 — that looped on Not-saved lines)',
    /if \(now > pending\) \{ handleLeaveRef\.current\(\); return; \}/.test(flat(leave)));
  ok('ProjectContext exposes countUnsavedForProject on the stable actions, by the Leave matcher',
    /countUnsavedForProject: \(projectId: string\) => Promise<number>;/.test(CTX)
      && /\n\s*countUnsavedForProject,\n/.test(CTX)
      && /countQueuedEntriesForProject\(unsavedEntries, projectId, childProject\);/.test(slice(CTX, 'const countUnsavedForProject = useCallback(', '\n  }, []);')));
}

console.log('\nE. the profile row:');
{
  ok('profiles has a sheet label', labelForTable('profiles') === 'Profile & settings');
  const settings = line({ table: 'profiles', recordId: A, operation: 'update', row: { id: A, tax_rate: 8.25, location: 'TX' } });
  const token = { id: 'l2', kind: 'write' as const, label: 'x', reason: 'w', at: 2, userId: A, table: 'profiles', recordId: A, operation: 'update' as const, row: { id: A, push_token: 't' }, queuedAt: 2 };
  ok('a push token shares no column with the refused settings save → independent, not parked',
    writeIsIndependentOfChain([settings], token) && parkBehindUnsavedIn([settings], token).independent === true
      && !parkBehindUnsavedIn([settings], token).parked && !unsavedChainBlocksIn([settings], A, token));
  const overlap = { ...token, row: { id: A, tax_rate: 9 } };
  ok('a settings write sharing a column parks, folded (Retry lands the newest)',
    !writeIsIndependentOfChain([settings], overlap) && parkBehindUnsavedIn([settings], overlap).parked
      && parkBehindUnsavedIn([settings], overlap).next[0].row?.tax_rate === 9);
  ok('never independent behind a create, a delete or an rpc of the record',
    !writeIsIndependentOfChain([{ ...settings, operation: 'upsert' }], token)
      && !writeIsIndependentOfChain([{ ...settings, operation: 'rpc', row: undefined, rpc: { fn: 'f', args: {} } }], token));
  const co = line({ table: 'change_orders', recordId: 'co1', operation: 'update', row: { id: 'co1', status: 'approved' } });
  ok('only profiles: a disjoint column of a change order still parks',
    parkBehindUnsavedIn([co], { ...token, table: 'change_orders', recordId: 'co1', row: { id: 'co1', description: 'x' } }).parked);
  const group = slice(Q, 'const headId = recordIdOf(group[0].table, group[0].data);', '// ABORT THE GROUP ON THE FIRST FAILURE.');
  ok('the flush sends the independent writes of a parked group and parks the rest',
    /const answer = await ledger\.parkOrPassBehindUnsavedWrite\(/.test(group)
      && /if \(answer === 'independent'\) \{\s*independent\.push\(mutation\);\s*\} else if \(answer === 'no_chain'\) \{[^}]*gRemaining\.push\(\.\.\.group\.slice\(index\)\);\s*break;\s*\} else \{\s*gFailed\+\+;\s*\}/.test(group)
      && /group = independent;/.test(group));
  ok('the caller-owns-refusal path asks the same question (unsavedChainBlocks)',
    /if \(await ledger\.unsavedChainBlocks\(writerId, \{/.test(Q));
}

console.log('\nF. never queued into another user\'s live session:');
{
  const enq = slice(Q, 'async function enqueueOrFail(', '\n}\n');
  ok('enqueueOrFail drops (Sentry note) a write whose writer is not the live user, and only when someone IS live',
    /if \(live && live\.id !== writerId\) \{/.test(enq) && /Sentry\.captureMessage\(/.test(enq)
      && enq.indexOf('if (live && live.id !== writerId)') < enq.indexOf('const entry = await buildEntry('));
  const hand = slice(Q, 'async function handOffToWriter(', '\n}\n');
  ok('the hand-off goes through it', /return enqueueOrFail\(m, writerId, \{ \.\.\.dropNoticeFor\(opts\), noToast: true \}\);/.test(hand));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
