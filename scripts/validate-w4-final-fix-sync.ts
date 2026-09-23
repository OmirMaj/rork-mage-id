#!/usr/bin/env bun
// scripts/validate-w4-final-fix-sync.ts
//
// Audit wave 4 · final fix (data-sync critic, round 4). Each guard runs the
// shipped code or pins the one line that wires it, and was mutation-tested
// against the real round-3 code.
//
//  A. A job named ONLY by a Not-saved line never owes a projects re-read (it
//     reloaded forever), and is not pinned whole either (round 8): the load
//     takes the SERVER row and lays the line's own row over it — a money-only
//     line's project_financials row over the server's fin row, a projects
//     line over the projects row. Round 7 pinned the device row whole and his
//     next edit sent that stale row back over a rename / close-out on the web;
//     round 4 read the money from the AsyncStorage cache, which a same-user
//     re-auth sweep empties. The overlay rule itself is pinned by
//     scripts/validate-w4-final-fix-r8.ts; mount-level proof:
//     __tests__/sync/ledger-no-reload-loop.test.tsx.
//  B. The same for a Not-saved settings save: device copy kept, no re-read owed.
//  C. The Leave dialog never offers more buttons than Android's Alert shows (3).
//  D. A refusal that lands after someone else signed in writes nothing into the
//     new user's ledger.
//  E. "Open Not saved" from the Record Payment sheet closes that Modal first
//     (iOS shows one at a time), and the pill always re-presents its sheet.
//
// Run: bun run scripts/validate-w4-final-fix-sync.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectsReloadOwedAfterLoad, unsavedProjectPinsIn, unsavedProjectIdsIn } from '../utils/projectContextPure';
import { settingsAfterRead } from '../utils/settingsLoadGuard';
import { leaveDialogCopy } from '../utils/projectRole';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const flat = (s: string) => s.replace(/\s+/g, ' ');

let passed = 0, failed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 400)}` : ''}`); }
}
function slice(src: string, from: string, to: string): string {
  const a = src.indexOf(from);
  const b = a > -1 ? src.indexOf(to, a + from.length) : -1;
  return a > -1 && b > a ? src.slice(a, b) : '';
}

const CTX = read('contexts/ProjectContext.tsx');

console.log('\nA. a Not-saved job never loops the projects load');
{
  const line = (table: string, recordId: string, operation = 'upsert') => ({ kind: 'write', table, recordId, operation });
  const pins = unsavedProjectPinsIn([line('project_financials', 'p1'), line('projects', 'p2', 'update'), line('project_financials', 'p2')], new Set());
  ok('a money-only line is money-only (the loader lays its fin row over the server\'s, never pins the row)', pins.moneyOnly.has('p1') && !pins.whole.has('p1'), pins);
  ok('a projects line is a whole-row line (money line too or not) — laid over the server row', pins.whole.has('p2') && !pins.moneyOnly.has('p2'), pins);
  ok('unsavedProjectIdsIn is still their union (contract terms keep both)',
    [...unsavedProjectIdsIn([line('project_financials', 'p1'), line('projects', 'p2', 'update')], new Set())].sort().join() === 'p1,p2');
  const rpcOnly = unsavedProjectPinsIn([line('projects', 'p3', 'rpc')], new Set());
  ok('a projects id named only for a refused rpc pins nothing', rpcOnly.whole.size === 0 && rpcOnly.moneyOnly.size === 0);
  ok('kept whole ONLY for a ledger line: no re-read owed', projectsReloadOwedAfterLoad(new Set(['p2']), new Set(['p2'])) === false);
  ok('kept whole for a queued / unconfirmed write: owed', projectsReloadOwedAfterLoad(new Set(['p2', 'p4']), new Set(['p2'])) === true);
  ok('nothing kept: nothing owed', projectsReloadOwedAfterLoad(new Set(), new Set(['p2'])) === false);
  const load = slice(CTX, "console.log('[ProjectContext] Loading projects');", 'const bearerBefore = await readBearer();');
  ok('the loader snapshots the queue pins BEFORE adding the ledger ones, and records the ledger-only ids',
    load.indexOf('const queuePinned = new Set(pendingAtStart);') > load.indexOf('await ownQueuedProjectIds(userId)')
      && load.indexOf('const unsavedPins = await unsavedProjectPins(userId);') > load.indexOf('const queuePinned = new Set(pendingAtStart);')
      && /const ledgerOnlyPins = new Set\(\[\.\.\.unsavedProjects\]\.filter\(\(id\) => !queuePinned\.has\(id\)\)\);/.test(load));
  ok('no Not-saved job is pinned whole before the SELECT (round 7 pinned every one — the stale-row overwrite)',
    /const unsavedProjects = new Set\(\[\.\.\.unsavedPins\.whole, \.\.\.unsavedPins\.moneyOnly\]\);/.test(load)
      && !/for \(const id of unsavedProjects\) pendingAtStart\.add\(id\);/.test(CTX));
  ok('...hands them to the hydration pass with the pending set',
    /projectsLoadPendingRef\.current = pendingAtStart;\s*projectsLoadLedgerOnlyRef\.current = ledgerOnlyPins;/.test(CTX));
  ok('the hydration pass owes a re-read only for a queue-pinned row (was keptWhole.size > 0)',
    /projectsReloadOwedRef\.current = projectsReloadOwedAfterLoad\(plan\.keptWhole, projectsLoadLedgerOnlyRef\.current\);/.test(CTX)
      && !/projectsReloadOwedRef\.current = plan\.keptWhole\.size > 0;/.test(CTX));
  ok('no money is read back from the AsyncStorage cache over the server\'s (the line\'s fin row is laid over it)',
    !/keepDeviceMoney/.test(CTX)
      && /const pick = \(key: string, legacy: unknown, cachedValue: unknown\) =>\s*financialPickAfterLoad\(f, key, legacy, owned, finReadOk, cachedValue, displayRole\);/.test(CTX));
  ok('the account switch clears the ledger-only ids', /projectsLoadPendingRef\.current = new Set\(\);\s*projectsLoadLedgerOnlyRef\.current = new Set\(\);/.test(CTX));
}

console.log('\nB. a Not-saved settings save never loops the profile read');
{
  const S = (tax: number) => ({ taxRate: tax } as never);
  const base = { current: S(8.25), fromRow: S(7.5), currentLoaded: true, writeSeqAtStart: 3, writeSeqNow: 3, rowWritesInFlightAtStart: 0, rowWritesInFlightNow: 0 };
  const unsaved = settingsAfterRead({ ...base, rowWriteQueued: false, rowWriteUnsaved: true });
  ok('a Not-saved save: the device copy, not saved over, NO re-read owed',
    unsaved.kept === 'device' && (unsaved.settings as { taxRate: number }).taxRate === 8.25 && !unsaved.persist && !unsaved.rereadOwed, unsaved);
  const queued = settingsAfterRead({ ...base, rowWriteQueued: true, rowWriteUnsaved: true });
  ok('a queued save (with or without a line): the device copy AND a re-read owed', queued.kept === 'device' && queued.rereadOwed, queued);
  const clean = settingsAfterRead({ ...base, rowWriteQueued: false, rowWriteUnsaved: false });
  ok('nothing pending: the row', clean.kept === 'row' && clean.persist && !clean.rereadOwed, clean);
  const first = settingsAfterRead({ ...base, currentLoaded: false, rowWriteQueued: false, rowWriteUnsaved: true });
  ok('before his settings loaded, the row still wins (the device holds DEFAULT)', first.kept === 'row', first);
}

console.log('\nC. the Leave dialog fits Android\'s three buttons');
{
  const count = (c: ReturnType<typeof leaveDialogCopy>) => 1 + (c.offerSyncFirst ? 1 : 0) + (c.offerOpenNotSaved ? 1 : 0) + 1; // Cancel … Leave
  const android = leaveDialogCopy('Henderson', 3, 1, 3);
  ok('queued + Not saved on Android: 3 buttons — Open Not saved and Leave anyway kept, Sync first dropped',
    count(android) === 3 && android.offerOpenNotSaved && !android.offerSyncFirst && android.leaveLabel === 'Leave anyway', android);
  const ios = leaveDialogCopy('Henderson', 3, 1, 4);
  ok('...iOS / web keep all four', count(ios) === 4 && ios.offerSyncFirst && ios.offerOpenNotSaved);
  const qOnly = leaveDialogCopy('Henderson', 3, 0, 3);
  ok('queued only on Android: Sync first stays (3 buttons)', count(qOnly) === 3 && qOnly.offerSyncFirst);
  for (const [p, u] of [[0, 0], [1, 0], [1, 1], [5, 2], [5, 5]] as const) {
    const c = leaveDialogCopy('Henderson', p, u, 3);
    ok(`pending ${p}, unsaved ${u}: never more than 3 on Android`, count(c) <= 3, c);
  }
  const PD = read('app/project-detail.tsx');
  const leave = slice(PD, 'const handleLeave = useCallback(() => {', 'const handleLeaveRef = useRef(handleLeave);');
  ok('project-detail passes the platform\'s room', /const copy = leaveDialogCopy\(name, pending, unsaved, Platform\.OS === 'android' \? 3 : 4\);/.test(leave));
}

console.log('\nD. a refusal after an account switch stays out of the new user\'s ledger');
{
  const Q = read('utils/offlineQueue.ts');
  const fail = flat(slice(Q, 'async function failDirectWrite(', '// Forward to Sentry so we can see'));
  ok('someone ELSE signed in = foreign (no one signed in stays the writer\'s)',
    /const foreignSession = !!writerId && typeof liveId === 'string' && liveId !== writerId;/.test(fail));
  ok('the ledger line is skipped for a foreign session', /if \(ledger && !opts\?\.callerOwnsRefusal && !opts\?\.ledgerRetry && !foreignSession\) \{/.test(fail));
  ok('...with a Sentry note instead', /if \(foreignSession\) \{ try \{[^}]*Sentry\.captureMessage\(/.test(fail));
  ok('the session is read BEFORE the line would be written', fail.indexOf('liveId = (await currentSessionUser())?.id ?? null;') > -1
    && fail.indexOf('liveId = (await currentSessionUser())?.id ?? null;') < fail.indexOf('await ledger.recordSyncFailures('));
}

console.log('\nE. "Open Not saved" from the Record Payment sheet actually opens the sheet on iPhone');
{
  // iOS presents one Modal at a time. The Not-saved sheet is the app-wide
  // pill's Modal; asked for while the payment sheet (a Modal) was up, it never
  // appeared and wedged the pill. Every request on this screen must close the
  // payment sheet first and wait for its dismissal.
  const INV = read('app/invoice.tsx');
  const helper = flat(slice(INV, 'const openNotSavedFromPaymentSheet = useCallback((resume: boolean = true) => {', '}, []);'));
  ok('the helper closes the payment sheet BEFORE it asks for the Not-saved sheet',
    helper.indexOf('setShowPaymentModal(false);') > -1
      && helper.indexOf('setShowPaymentModal(false);') < helper.indexOf('requestSyncSheet'), helper);
  ok('...and asks only after the iOS dismissal (a timer, 450 ms on iOS)',
    /setTimeout\(requestSyncSheet, Platform\.OS === 'ios' \? 450 : 0\);/.test(helper), helper);
  const bare = [...INV.matchAll(/requestSyncSheet/g)].map((m) => m.index ?? 0)
    .filter((i) => !INV.slice(Math.max(0, i - 200), i).includes('const openNotSavedFromPaymentSheet'))
    .filter((i) => !/^import /m.test(INV.slice(INV.lastIndexOf('\n', i) + 1, i)));
  ok('no other requestSyncSheet on the invoice screen (none can run while showPaymentModal is true)', bare.length === 0, bare);
  const opens = INV.match(/text: 'Open Not saved', onPress: [^}]*\}/g) ?? [];
  ok('every "Open Not saved" button on the screen goes through the helper (3 dialogs, 2 button specs)',
    opens.length === 2 && opens.every((o) => /onPress: \(\) => openNotSavedFromPaymentSheet\(/.test(o)), opens);
  const PILL = read('components/OfflineSyncPill.tsx');
  ok('the pill re-presents a request even when its sheet is already marked open (a swallowed Modal never wedges it)',
    /if \(!sheetOpenRef\.current\) \{ setSheetOpen\(true\); return; \}\s*setSheetOpen\(false\);\s*setTimeout\(\(\) => setSheetOpen\(true\), 0\);/.test(PILL)
      && /onSyncSheetRequested\(presentSheet\)/.test(PILL) && /if \(tone === 'failed'\) \{\s*presentSheet\(\);/.test(PILL));
}

console.log('\nF. Record Payment records one payment per tap-burst, and a resumed sheet keeps what he typed');
{
  // invoice_append_payment de-duplicates by entry id only and every tap mints
  // a new id: a second tap while the append was on the wire recorded the same
  // check twice (critic round 6, jest replay). The mount-level proof is
  // __tests__/smoke/record-payment-once.test.tsx; these pin the shape.
  const INV = read('app/invoice.tsx');
  const mark = flat(slice(INV, 'const handleMarkPaid = useCallback(() => {', '// Stripe payment link'));
  ok('a synchronous ref lock is checked and taken before any dialog',
    /if \(!existingInvoice\) return; .{0,200}if \(recordingPaymentRef\.current\) return; recordingPaymentRef\.current = true; setRecordingPayment\(true\);/.test(mark)
      && mark.indexOf('recordingPaymentRef.current = true') < mark.indexOf('recordPaymentDecision('), mark.slice(0, 400));
  ok('a refusal and the overpayment Cancel / dismissal free it',
    /if \(decision\.kind === 'refuse'\) \{ release\(\);/.test(mark)
      && /\{ text: 'Cancel', style: 'cancel', onPress: release \}/.test(mark) && /\{ onDismiss: release \}/.test(mark), mark);
  const lock = flat(slice(INV, 'const recordUnderLock = useCallback(', '}, [commitPaymentPastUnsaved]);'));
  ok('the whole chain is awaited and the lock freed in a finally',
    /try \{ await commitPaymentPastUnsaved\(amt\); \} finally \{ recordingPaymentRef\.current = false; setRecordingPayment\(false\); \}/.test(lock), lock);
  const past = flat(slice(INV, 'const commitPaymentPastUnsaved = useCallback(', 'const recordUnderLock = useCallback('));
  ok('...all the way into the append (awaited, not fire-and-forget)', /if \(!held\) \{ await commitPayment\(amt\); return; \}/.test(past) && !/void commitPayment\(/.test(INV));
  const btn = flat(slice(INV, 'testID="record-payment-submit"', '</TouchableOpacity>'));
  const btnOpen = flat(INV.slice(INV.lastIndexOf('<TouchableOpacity', INV.indexOf('testID="record-payment-submit"')), INV.indexOf('testID="record-payment-submit"')));
  ok('the sheet button is disabled while recording and says so',
    /disabled=\{recordingPayment\}/.test(btnOpen) && /\{recordingPayment \? 'Recording…' : 'Record Payment'\}/.test(btn), btnOpen + btn);
  const helper = flat(slice(INV, 'const openNotSavedFromPaymentSheet = useCallback((resume: boolean = true) => {', '}, []);'));
  ok('"Open Not saved" marks the sheet for resume (or not — round 8, same money) before closing it',
    helper.indexOf('resumePaymentSheetRef.current = resume;') > -1 && helper.indexOf('resumePaymentSheetRef.current = resume;') < helper.indexOf('setShowPaymentModal(false);'), helper);
  const open = flat(slice(INV, 'const openRecordPayment = () => {', '\n  };'));
  ok('the next open keeps the typed amount / day / check # once, then resets as before',
    /if \(resumePaymentSheetRef\.current\) \{ .{0,120}resumePaymentSheetRef\.current = false; setShowPaymentModal\(true\); return; \} setPaymentAmount\(balanceDue\.toFixed\(2\)\);/.test(open), open);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
