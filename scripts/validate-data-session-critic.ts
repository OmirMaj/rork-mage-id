// scripts/validate-data-session-critic.ts — guards for the wave-3 integration
// critic "data-session" (round 1):
//
//   1. #23 portal publish only from SERVER lists. Every portal-fed loader falls
//      back to the device cache on a failed (or untrusted-empty) read and still
//      reports "loaded"; the provider-level publish then pushed the stale or
//      empty list to every homeowner portal (a missing item is "gone", #44).
//   2. Writes on the wire vs re-reads: punch / RFI / submittal / CO inserts and
//      punch whole-row updates are counted as in flight, and the punch loader
//      keeps rows written during its read.
//   3. Leaving a job records it as LEFT (forgetSharedProject), so the reload
//      does not also say "Its owner removed you".
//   4. The CO audit stash (mageid_co_audit_pending) survives a same-user
//      re-auth like the queue its UPDATE rides, and goes on a real sign-out.
//   5. Auth events are held from React while signup() / the web mount run the
//      tenant handoff, so the new account never hydrates over the previous
//      tenant's cache.
//
// Round 2 (the lens failed twice — the simplest provable rule, pinned here):
//   6. A publish may use a list only if it was read AFTER THE LATEST RETURN
//      TO THE FOREGROUND. The foreground pass starts a new read epoch before
//      any re-read, re-reads all nine portal-fed lists (warranties through a
//      reload counter), and a read that started in an older epoch never
//      counts. Executed against the real callbacks.
//   7. project-detail's own publish waits on the same gate.
//   8. The revocation alert names every way a job can leave (he may have left
//      it himself on another device) instead of guessing "its owner".
//
// Run: bun run scripts/validate-data-session-critic.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PORTAL_FED_LISTS, notePortalListRead, portalListsFromServer, idsWrittenDuringRead, mergeLocalOnly,
  EMPTY_PORTAL_SERVER_READS, beginPortalReadEpoch, deviceRowsWrittenDuringRead,
  type PortalServerReads, type PortalFedList,
} from '../utils/projectContextPure';
import { runCallback } from './validate-context-money-portal-writes';
import { OFFLINE_WRITE_QUEUE_KEYS, OWNER_STAMPED_PENDING_KEYS, selectTenantKeysToWipe } from '../utils/localCacheKeys';
import { createAuthEventHold, holdAuthEvents, offerAuthEvent, releaseAuthEvents } from '../utils/authEventHold';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const CTX = strip(read('contexts/ProjectContext.tsx'));
const AUTH = strip(read('contexts/AuthContext.tsx'));
const DETAIL = strip(read('app/project-detail.tsx'));

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}
/** The text of `const <name> = …` up to the next top-level provider declaration. */
function slice(src: string, startMarker: string, endMarker: string): string {
  const a = src.indexOf(startMarker);
  if (a < 0) return '';
  const b = src.indexOf(endMarker, a + startMarker.length);
  return src.slice(a, b < 0 ? undefined : b);
}

console.log('\n1 · #23 portal publish waits for a SERVER read of every portal-fed list');
{
  const U = 'user-a';
  const stampAll = (r: PortalServerReads, u: string, epoch: number) =>
    PORTAL_FED_LISTS.reduce((acc, l) => notePortalListRead(acc, l, u, true, epoch), r);
  const all = stampAll(EMPTY_PORTAL_SERVER_READS, U, 0);
  ok('every list read from the server → publish allowed', portalListsFromServer(all, U));
  // The critic's case: the daily_reports read failed and fell back to cache.
  const failedDr = notePortalListRead(all, 'dailyReports', U, false, 0);
  ok('a failed daily_reports read → NO publish', !portalListsFromServer(failedDr, U));
  ok('…and a later successful read re-allows it', portalListsFromServer(notePortalListRead(failedDr, 'dailyReports', U, true, 0), U));
  const noInv: PortalServerReads = { ...all, stamps: { ...all.stamps, invoices: undefined } };
  ok('a list never read → no publish', !portalListsFromServer(noInv, U));
  ok('another account\'s stamps do not count', !portalListsFromServer(all, 'user-b'));
  ok('signed out never publishes', !portalListsFromServer(all, null));
  ok('a fallback for another account does not clear this account\'s stamp',
    notePortalListRead(all, 'photos', 'user-b', false, 0) === all);
  ok('an unchanged note returns the same object (setState no-op)', notePortalListRead(all, 'rfis', U, true, 0) === all);
  ok('the gated lists are exactly the nine the portal publish reads',
    [...PORTAL_FED_LISTS].sort().join(',') === ['projects', 'invoices', 'changeOrders', 'dailyReports', 'photos', 'punchItems', 'rfis', 'permits', 'warranties'].sort().join(','));

  const gate = slice(CTX, 'const portalSyncReady =', ';');
  ok('portalSyncReady requires portalListsFromServer(portalServerReads, userId)',
    /portalListsFromServer\(portalServerReads, userId\)/.test(gate), gate.slice(0, 400));
  const publish = slice(CTX, 'const publishOwnedPortals = useCallback(', '// A new account starts with nothing published');
  ok('publishOwnedPortals stops (settling nothing) when a list is the cache\'s at publish time',
    /if \(!portalListsServerRef\.current\) return;/.test(publish)
    && publish.indexOf('if (!portalListsServerRef.current) return;') < publish.indexOf('const marks = new Map('));
  for (const l of PORTAL_FED_LISTS) {
    ok(`${l}: stamped on the server branch AND cleared on the cache fallback (with the read's epoch)`,
      CTX.includes(`notePortalRead('${l}', userId, true, readEpoch)`) && CTX.includes(`notePortalRead('${l}', userId, false, readEpoch)`));
  }
  // Each fallback note sits right before that loader's cache return.
  const fallbacks: [string, string][] = [
    ['changeOrders', 'CHANGE_ORDERS_KEY'], ['invoices', 'INVOICES_KEY'], ['dailyReports', 'DAILY_REPORTS_KEY'],
    ['photos', 'PHOTOS_KEY'], ['punchItems', 'PUNCH_ITEMS_KEY'], ['rfis', 'RFIS_KEY'], ['permits', 'PERMITS_KEY'],
  ];
  for (const [l, key] of fallbacks) {
    ok(`${l}: the cache return is preceded by its false note`,
      new RegExp(`notePortalRead\\('${l}', userId, false, readEpoch\\);(?: *\\/\\/[^\\n]*)?\\s*return loadLocal<\\w+\\[\\]>\\(${key}, \\[\\]\\);`).test(CTX));
  }
  ok('permits: a trusted zero-row read is the server\'s answer (else it could never count as read)',
    /from\('permits'\)\.select\('\*'\)[\s\S]{0,200}data\.length > 0 \|\| await emptyReadTrusted\(userId, bearerBefore\)/.test(CTX));
  ok('warranties: likewise',
    /from\('warranties'\)\.select\('\*'\)[\s\S]{0,200}data\.length > 0 \|\| await emptyReadTrusted\(userId, bearerBefore\)/.test(CTX));
  ok('notePortalRead ignores a load for an account that is no longer signed in',
    /const notePortalRead = [\s\S]{0,200}liveUserIdRef\.current !== loadUserId\) return;/.test(CTX));
}

console.log('\n6 · #23 round 2 · a publish uses only lists read since the latest foreground');
{
  const U = 'user-a';
  // 07:00: launch reads everything (epoch 0).
  let r = PORTAL_FED_LISTS.reduce((acc, l) => notePortalListRead(acc, l, U, true, 0), EMPTY_PORTAL_SERVER_READS);
  ok('07:00 launch: all nine read → publish allowed', portalListsFromServer(r, U));
  // 19:00: back to the foreground → epoch 1. The 07:00 copies stop counting.
  r = beginPortalReadEpoch(r, 1);
  ok('19:00 foreground: the 07:00 lists no longer allow a publish (the critic\'s repro)', !portalListsFromServer(r, U));
  const eight = PORTAL_FED_LISTS.filter(l => l !== 'dailyReports');
  r = eight.reduce((acc, l) => notePortalListRead(acc, l, U, true, 1), r);
  ok('eight of nine re-read → still no publish (daily reports is the 07:00 copy)', !portalListsFromServer(r, U));
  // A read that STARTED before the foreground and lands after it.
  const stale = notePortalListRead(r, 'dailyReports', U, true, 0);
  ok('a daily_reports read that started before the foreground does not count', stale === r && !portalListsFromServer(stale, U));
  r = notePortalListRead(r, 'dailyReports', U, true, 1);
  ok('…the re-read the foreground started does → publish allowed', portalListsFromServer(r, U));
  ok('a pre-foreground read FAILING late does not clear the new epoch\'s stamp', notePortalListRead(r, 'photos', U, false, 0) === r);
  ok('a same-epoch failure does', !portalListsFromServer(notePortalListRead(r, 'photos', U, false, 1), U));
  ok('beginPortalReadEpoch is a no-op for the same epoch', beginPortalReadEpoch(r, 1) === r);

  // deviceRowsWrittenDuringRead: the loaders re-read on every foreground keep
  // what this device wrote while the read was out.
  const touches = new Map([['ins', { inFlight: 1, settledAt: 0 }], ['del', { inFlight: 1, settledAt: 0 }], ['old', { inFlight: 0, settledAt: 5 }]]);
  const t = deviceRowsWrittenDuringRead(touches, 100, [{ id: 'ins' }, { id: 'old' }]);
  ok('an insert on the wire is kept; a delete on the wire is gone; an old write neither',
    t.keep.has('ins') && !t.gone.has('ins') && t.gone.has('del') && !t.keep.has('old'));
  const merged = mergeLocalOnly([{ id: 'del', v: 0 }, { id: 'srv', v: 0 }], [{ id: 'ins', v: 1 }], t.keep, { deletedIds: t.gone });
  ok('…merged: the just-created row stays, the just-deleted row does not come back',
    merged.map(x => x.id).sort().join() === 'ins,srv');

  // EXECUTED: the real foreground pass. Every portal-fed list is re-read, and
  // the epoch starts BEFORE the first re-read.
  const events: string[] = [];
  const epochRef = { current: 0 };
  const serverRef = { current: true };
  const qc = { invalidateQueries: async (q: { queryKey?: unknown[] }) => { events.push(`read:${String(q.queryKey?.[0])}`); } };
  const common = { userId: 'u1', queryClient: qc, liveUserIdRef: { current: 'u1' } };
  const projectsPart = runCallback<() => Promise<void>>(CTX, 'refetchProjectsOnForeground', {
    ...common, flushPendingProjectSyncs: async () => {}, syncDebounceMap: { current: new Map() },
    inFlightProjectSyncsRef: { current: new Map() }, unconfirmedProjectSyncIds: () => new Set(),
    ownQueuedProjectIds: async () => new Set(), projectsReloadOwedRef: { current: false },
  });
  const moneyPart = runCallback<() => Promise<void>>(CTX, 'refetchMoneyAndProfileOnForeground', {
    ...common, invoiceInsertsRef: { current: new Map() }, invoiceWritesInFlightRef: { current: 0 },
    invoicesReloadOwedRef: { current: false },
    settingsRowWritesInFlightRef: { current: 0 }, termsWritesInFlightRef: { current: 0 },
    getOfflineQueue: async () => [], termsWritesPending: () => ({ split: false, warranty: false }),
    owedSettingsRereadReady: () => true, settingsRowWritePending: () => false,
  });
  const proDocsPart = runCallback<() => Promise<void>>(CTX, 'refetchProDocsOnForeground', { ...common });
  const portalPart = runCallback<() => Promise<void>>(CTX, 'refetchPortalListsOnForeground', {
    ...common, setWarrantiesReload: () => { events.push('read:warranties'); },
  });
  const allPass = runCallback<() => Promise<void>>(CTX, 'refetchAllOnForeground', {
    userId: 'u1', portalReadEpochRef: epochRef, portalListsServerRef: serverRef,
    setPortalServerReads: (fn: (p: PortalServerReads) => PortalServerReads) => {
      const next = fn(EMPTY_PORTAL_SERVER_READS);
      events.push(`epoch:${next.epoch}:server=${serverRef.current}`);
    },
    beginPortalReadEpoch,
    refetchProjectsOnForeground: projectsPart, refetchMoneyAndProfileOnForeground: moneyPart,
    refetchProDocsOnForeground: proDocsPart, refetchPortalListsOnForeground: portalPart,
  });
  await allPass();
  const keyOf: Record<PortalFedList, string> = {
    projects: 'projects', invoices: 'invoices', changeOrders: 'changeOrders', dailyReports: 'dailyReports',
    photos: 'projectPhotos', punchItems: 'punchItems', rfis: 'rfis', permits: 'permits', warranties: 'warranties',
  };
  const missing = PORTAL_FED_LISTS.filter(l => !events.includes(`read:${keyOf[l]}`));
  ok('EXECUTED: one foreground pass re-reads EVERY portal-fed list', missing.length === 0, `not re-read: ${missing.join()} · ${events.join(' ')}`);
  ok('EXECUTED: the epoch starts (and the publish-time flag drops) before the first re-read',
    events[0] === 'epoch:1:server=false' && epochRef.current === 1, events.join(' '));
  ok('one binding runs the whole pass', /useProjectsFocusRefetch\(canSync, refetchAllOnForeground\);/.test(CTX)
    && !/useProjectsFocusRefetch\(canSync, refetch(?:Projects|MoneyAndProfile|ProDocs|PortalLists)OnForeground\)/.test(CTX));

  // Every loader captures the epoch its read STARTS in, before any await.
  const loaders: [string, string][] = [
    ['projects', "queryKey: ['projects', userId]"], ['changeOrders', "queryKey: ['changeOrders', userId]"],
    ['invoices', "queryKey: ['invoices', userId]"], ['dailyReports', "queryKey: ['dailyReports', userId]"],
    ['punchItems', "queryKey: ['punchItems', userId]"], ['photos', "queryKey: ['projectPhotos', userId]"],
    ['rfis', "queryKey: ['rfis', userId]"], ['permits', "queryKey: ['permits', userId]"],
  ];
  for (const [l, marker] of loaders) {
    const a = CTX.indexOf(marker);
    const win = a < 0 ? '' : CTX.slice(a, a + 1500);
    ok(`${l}: the loader captures readEpoch before its first await`,
      /queryFn: async \(\) => \{\s*const readEpoch = portalReadEpochRef\.current;/.test(win));
  }
  ok('warranties: captures readEpoch before its read, and reloads on warrantiesReload',
    /let cancelled = false;\s*const readEpoch = portalReadEpochRef\.current;(?: *\/\/[^\n]*)?\s*\(async \(\) => \{\s*if \(canSync\) \{\s*try \{\s*const bearerBefore = await readBearer\(\);\s*const readStartedAt = Date\.now\(\);\s*const \{ data, error \} = await supabase\.from\('warranties'\)/.test(CTX)
      && CTX.includes('}, [canSync, userId, warrantiesReload]);'));
  ok('retryRemoteReads reloads warranties too (the minor: a failed launch read never came back)',
    /setWarrantiesReload\(n => n \+ 1\);/.test(slice(CTX, 'const retryRemoteReads = useCallback(', '}, [queryClient, userId]);')));
  const publish = slice(CTX, 'const publishOwnedPortals = useCallback(', '// A new account starts with nothing published');
  ok('publishOwnedPortals re-checks the gate before EACH project\'s write (a foreground mid-pass stops it)',
    /if \(!portalListsServerRef\.current\) return;\s*const outcome = await syncPortalSnapshotLite\(/.test(publish));
  // Lists now re-read with edits out keep this device's in-flight rows.
  for (const [table, tag] of [['daily_reports', 'Dr'], ['photos', 'Ph'], ['permits', 'Pm'], ['warranties', 'Wr']] as const) {
    ok(`${table}: every direct write is tracked, and the loader keeps rows written during its read`,
      !new RegExp(`void supabaseWrite\\('${table}'`).test(CTX)
        && new RegExp(`touched${tag} = deviceRowsWrittenDuringRead\\(proDocWriteTouchRef\\.current, readStartedAt,`).test(CTX)
        && new RegExp(`queuedIdsFor\\('${table}'\\), \\.\\.\\.touched${tag}\\.keep\\]\\)`).test(CTX));
  }
}

console.log('\n7 · project-detail publishes only behind the same gate');
{
  const eff = slice(DETAIL, 'if (!project || !portalListsServerRead) return;', 'const estimate = useMemo(');
  ok('the effect returns early until portalListsServerRead', /^if \(!project \|\| !portalListsServerRead\) return;\s*const t = setTimeout\(\(\) => \{\s*void syncPortalSnapshotLite\(/.test(eff));
  ok('…and re-runs when it turns true (a dependency)', /\}, \[project, portalListsServerRead,/.test(eff));
  ok('the context exposes portalListsServerRead from the same function the provider gates on',
    /const portalListsServerRead = portalListsFromServer\(portalServerReads, userId\);/.test(CTX)
      && /retryRemoteReads,\s*portalListsServerRead,/.test(CTX));
}

console.log('\n8 · the revocation alert does not guess who ended it');
{
  const cleanup = slice(CTX, 'if (!revokedCleanup || revokedCleanup.size === 0) return;', '}, [revokedCleanup]);');
  ok('names every possibility: he left, the owner removed him, or it was deleted',
    /you left it, its owner removed you, or it was deleted/.test(cleanup));
  ok('the old guess ("Its owner removed you from the job or deleted it") is gone',
    !/Its owner removed you from the job or deleted it/.test(CTX) && !/'Removed from a job'/.test(CTX));
}

console.log('\n2 · writes on the wire survive a concurrent re-read');
{
  // The pure rule the loaders now apply to inserts too.
  const touches = new Map([['p-new', { inFlight: 1, settledAt: 0 }], ['p-old', { inFlight: 0, settledAt: 100 }]]);
  const keep = idsWrittenDuringRead(touches, 500);
  ok('an INSERT still on the wire is kept', keep.has('p-new'));
  ok('a write settled before the read began is not', !keep.has('p-old'));
  const merged = mergeLocalOnly([{ id: 'srv', v: 1 }], [{ id: 'p-new', v: 2 }], keep);
  ok('the merge keeps the just-created row the SELECT did not see', merged.some(r => r.id === 'p-new'));

  const add = slice(CTX, 'const addPunchItem = useCallback(', '}, [savePunchItemsMutation');
  ok('addPunchItem sends its INSERT through touchedWrite', /touchedWrite\(proDocWriteTouchRef, item\.id, \(\) => supabaseWrite\('punch_items', 'insert'/.test(add));
  const addMany = slice(CTX, 'const addPunchItems = useCallback(', '}, [savePunchItemsMutation');
  ok('addPunchItems likewise', /touchedWrite\(proDocWriteTouchRef, item\.id, \(\) => supabaseWrite\('punch_items', 'insert'/.test(addMany));
  const upd = slice(CTX, 'const updatePunchItems = useCallback(', 'updatePunchItemsRef.current = updatePunchItems;');
  ok('updatePunchItems\' whole-row UPDATE is tracked', /touchedWrite\(proDocWriteTouchRef, pi\.id, \(\) => supabaseWrite\('punch_items', 'update'/.test(upd));
  ok('no untracked RFI / submittal / punch insert remains',
    !/void supabaseWrite\('(rfis|submittals|punch_items)', 'insert'/.test(CTX));
  const punchLoader = slice(CTX, "queryKey: ['punchItems', userId]", "queryKey: ['projectPhotos', userId]");
  ok('the punch loader keeps rows written during its read',
    /idsWrittenDuringRead\(proDocWriteTouchRef\.current, fetchStartedAt\)/.test(punchLoader));
  const addCos = slice(CTX, 'const addChangeOrders = useCallback(', 'const addChangeOrder = useCallback(');
  ok('addChangeOrders counts each INSERT as a CO write on the wire',
    /beginCoWrite\(finalCo\.id\)/.test(addCos) && /endCoWrite\(finalCo\.id\)/.test(addCos));
  ok('touchedWrite settles the touch in a finally', /async function touchedWrite<T>[\s\S]{0,500}finally \{[\s\S]{0,200}settledAt: Date\.now\(\)/.test(CTX));
}

console.log('\n3 · leaving a job is recorded as leaving');
{
  const leave = slice(DETAIL, 'const handleLeave = useCallback(', '// --- Estimate-dependent hooks');
  const forgetAt = leave.indexOf('forgetSharedProject(id)');
  const invalidateAt = leave.indexOf("queryKey: ['projects']");
  ok('handleLeave calls forgetSharedProject(id) after the server confirms', forgetAt > 0 && leave.indexOf('if (failure)') < forgetAt);
  ok('…before the projects list is re-read', forgetAt > 0 && invalidateAt > forgetAt);
}

console.log('\n4 · CO audit stash follows the queue it belongs to');
{
  ok('mageid_co_audit_pending is an owner-stamped pending key', OWNER_STAMPED_PENDING_KEYS.includes('mageid_co_audit_pending'));
  ok('the ProjectContext key is that same literal', /const CO_AUDIT_PENDING_KEY = 'mageid_co_audit_pending'/.test(CTX));
  ok('it survives a same-user re-auth sweep', selectTenantKeysToWipe(['mageid_co_audit_pending'], { dropOfflineQueue: false }).length === 0);
  ok('it is swept when the queue is dropped', selectTenantKeysToWipe(['mageid_co_audit_pending']).length === 1);
  ok('it is not smuggled into the lock-checked write-queue list', !OFFLINE_WRITE_QUEUE_KEYS.includes('mageid_co_audit_pending'));
  const wipe = slice(AUTH, 'async function wipeLocalUserCache(', 'try {\n    await AsyncStorage.multiRemove(LOCAL_USER_CACHE_KEYS');
  ok('a deliberate sign-out (dropOfflineQueue) removes it explicitly',
    /if \(dropOfflineQueue\) \{[\s\S]*multiRemove\(\[\.\.\.OWNER_STAMPED_PENDING_KEYS\]\)/.test(wipe));
}

console.log('\n5 · auth events held while the tenant handoff runs');
{
  const applied: (string | null)[] = [];
  const apply = (s: string | null) => { applied.push(s); };
  const h = createAuthEventHold<string>();
  offerAuthEvent(h, 'a', apply);
  ok('no hold → delivered at once', applied.join() === 'a');
  holdAuthEvents(h);
  offerAuthEvent(h, 'b', apply);
  offerAuthEvent(h, 'c', apply);
  ok('held → nothing delivered (SIGNED_IN inside signUp)', applied.join() === 'a');
  holdAuthEvents(h);
  releaseAuthEvents(h, apply);
  ok('an inner release does not deliver', applied.join() === 'a');
  releaseAuthEvents(h, apply);
  ok('the last release delivers the NEWEST held event once', applied.join() === 'a,c');
  releaseAuthEvents(h, apply);
  ok('an extra release delivers nothing more', applied.join() === 'a,c');

  const signup = slice(AUTH, 'const signup = useCallback(', 'const loginWithBiometrics');
  const holdAt = signup.indexOf('holdAuthEvents(authHoldRef.current)');
  ok('signup holds auth events BEFORE supabase.auth.signUp', holdAt > 0 && holdAt < signup.indexOf('supabase.auth.signUp('));
  ok('…releases them in a finally AFTER the handoff (wipe + completeSignIn)',
    /await completeSignIn\(data\.user, handoff\);[\s\S]*\} finally \{\s*releaseAuthEvents\(authHoldRef\.current, applyAuthSessionRef\.current\);/.test(signup));
  ok('the listener offers every event through the hold', /onAuthStateChange\(\(_event, newSession\) => \{[\s\S]{0,160}offerAuthEvent\(authHoldRef\.current, newSession, applyAuthSession\)/.test(AUTH));
  ok('the mount holds events until its marker check is done',
    /holdAuthEvents\(mountHold\);[\s\S]*\.finally\(\(\) => \{\s*releaseAuthEvents\(mountHold, applyAuthSession\);/.test(AUTH));
  ok('web mount: a session that is not the marker\'s user runs the tenant handoff first',
    /Platform\.OS === 'web' && currentSession\?\.user[\s\S]{0,200}last && last\.id !== currentSession\.user\.id[\s\S]{0,300}await onNewSessionRef\.current\?\.\(\)/.test(AUTH));
  ok('onNewSessionRef is wired to onNewSessionEstablished', /onNewSessionRef\.current = \(\) => onNewSessionEstablished\(\);/.test(AUTH));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
