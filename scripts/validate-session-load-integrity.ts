// validate-session-load-integrity.ts — the projects load guard, held to the
// account and to writes that have not landed (post-ship hotfix, 2026-09-18).
//
//   #6  (security) after A signs out, B on the same phone/browser saw the
//       projects A had edited — and a new account kept them for good. The
//       guard's write log, `since`, the server-id/schedule refs and the list
//       itself outlived the account; nothing remounts ProjectProvider.
//   #7  a launch whose projects SELECT failed treated every project as one the
//       server might not hold, so a status change / portal toggle / terms stamp
//       re-sent the cached schedule over another device's work.
//   #8  a load that started while an edit was still waiting to sync (800 ms
//       window, on the wire, queued offline) put the older server row back.
//   #96 a load that kept the device row for a project edited meanwhile threw
//       away the foreman's progress it had read, until the next foreground.
//
// Executed against the real pure functions, plus the provider's own reset
// block transpiled and run with stub refs, plus source pins for the wiring.
//
// Run: bun run scripts/validate-session-load-integrity.ts

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import type { ScheduleTask } from '../types';
import { absorbServerScheduleTasks, projectSyncSendsSchedule } from '../utils/fieldScheduleUpdate';
import {
  foldServerSchedule, keepProjectsWrittenSince, newProjectWriteLog, noteProjectWrite, ownerUpsertCarriesSchedule,
  parseServerConfirmedIds, pendingProjectIdsInQueue, planProjectsLoad, resetProjectWriteLog, serializeServerConfirmedIds,
  unconfirmedProjectSyncIds, withDeviceCopies, type ProjectWriteLog,
} from '../utils/projectsLoadGuard';
import { isAppStorageKey } from '../utils/localCacheKeys';
import { revokedCachedProjectIds, revocationConfirmed } from '../utils/projectContextPure';
import { openScheduleSyncGate, resetScheduleSyncGatesForTest, takeStoreScheduleCopy } from '../utils/scheduleMerge';

declare const Bun: { Transpiler: new (o: { loader: 'ts' }) => { transformSync(code: string): string } };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CTX = readFileSync(resolve(ROOT, process.env.PROJECT_CONTEXT_PATH ?? 'contexts/ProjectContext.tsx'), 'utf8');

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean, detail = ''): void {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`); }
}
function slice(src: string, start: string, end: string): string {
  const i = src.indexOf(start);
  if (i < 0) return '';
  const j = src.indexOf(end, i + start.length);
  return j < 0 ? '' : src.slice(i, j + end.length);
}
const t = (o: Partial<ScheduleTask> & { id: string }): ScheduleTask => ({ name: o.id, startDay: 1, durationDays: 1, progress: 0, ...o } as unknown as ScheduleTask);
type P = { id: string; name: string; estimate?: number; schedule: { tasks: ScheduleTask[] } | null };
const proj = (id: string, name: string, tasks: ScheduleTask[] = [], estimate?: number): P => ({ id, name, estimate, schedule: { tasks } });

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n#6 — a sign-out and a different sign-in leave nothing of the first account:');
{
  // Account A: a load (since = 0 → seq after), then two edits after it.
  const logA = newProjectWriteLog();
  const sinceA = logA.seq;
  const aList = [proj('a1', 'A-one'), proj('a2', 'A-two'), proj('a3', 'A-three')];
  noteProjectWrite(logA, 'a1');
  noteProjectWrite(logA, 'a2');
  // CONTROL — the shipped bug, executed: without a reset the signed-out empty
  // load and B's zero-row load both keep A's edited projects.
  const leaked = keepProjectsWrittenSince<P>([], aList, logA, sinceA);
  ok('control: without the reset, hydrate([]) after A still shows a1,a2', leaked.map(p => p.id).join() === 'a1,a2', leaked.map(p => p.id).join());

  // The provider's own reset block, run with stub refs.
  const block = slice(CTX, 'if (projectsOwner !== userId) {', 'setProjectsLoaded(false);\n    }\n  }');
  ok('ProjectProviderInner has a render-phase reset keyed on the account', block.length > 0);
  type Ref<T> = { current: T };
  const refs = {
    projectWriteLogRef: { current: logA } as Ref<ProjectWriteLog>,
    projectsLoadSinceRef: { current: sinceA } as Ref<number>,
    projectsLoadPendingRef: { current: new Set(['a1']) } as Ref<ReadonlySet<string>>,
    projectsLoadBaseRef: { current: new Map([['a1', [t({ id: 'x' })]]]) } as Ref<Map<string, ScheduleTask[]>>,
    projectsLoadTasksRef: { current: new Map([['a1', [t({ id: 'x' })]]]) } as Ref<Map<string, ScheduleTask[]>>,
    projectsReloadOwedRef: { current: true } as Ref<boolean>,
    serverScheduleTasksRef: { current: new Map([['a1', [t({ id: 'x' })]]]) } as Ref<Map<string, ScheduleTask[]>>,
    serverProjectIdsRef: { current: new Set(['a1', 'a2', 'a3']) } as Ref<Set<string>>,
    serverIdsSeededRef: { current: true } as Ref<boolean>,
    syncDebounceMap: { current: new Map([['a1', { timer: null, inFlight: false }]]) } as Ref<Map<string, unknown>>,
    inFlightProjectSyncsRef: { current: new Map([[{}, 'a2']]) } as Ref<Map<unknown, string>>,
    projectsRef: { current: aList } as Ref<P[]>,
    liveUserIdRef: { current: 'userA' } as Ref<string | null>,
    signedOutCacheOwnerRef: { current: undefined } as Ref<string | null | undefined>,
    projectsHydratedForRef: { current: 'userA' } as Ref<string | null | undefined>,
    projectsLoadLandedRef: { current: true } as Ref<boolean>,
    // Every other per-account list's mirror ref (hotfix item 4).
    invoicesRef: { current: [{ id: 'inv-A' }] } as Ref<unknown[]>,
    invoiceInsertsRef: { current: new Map([['inv-A', Promise.resolve('synced')]]) } as Ref<Map<string, unknown>>,
    // data-session critic round 2: A's owed foreground invoices re-read.
    invoicesReloadOwedRef: { current: true } as Ref<boolean>,
    changeOrderInsertsRef: { current: new Map([['co-A', Promise.resolve('synced')]]) } as Ref<Map<string, unknown>>,
    punchItemsRef: { current: [{ id: 'punch-A' }] } as Ref<unknown[]>,
    projectPhotosRef: { current: [{ id: 'photo-A' }] } as Ref<unknown[]>,
    rfisRef: { current: [{ id: 'rfi-A' }] } as Ref<unknown[]>,
    submittalsRef: { current: [{ id: 'sub-A' }] } as Ref<unknown[]>,
    // Wave 3 (context-money-portal): the portal send path's latest-value
    // mirrors and the invoice-insert outcomes.
    invoiceInsertOutcomesRef: { current: new Map([['inv-A', 'synced']]) } as Ref<Map<string, unknown>>,
    changeOrdersRef: { current: [{ id: 'co-A' }] } as Ref<unknown[]>,
    dailyReportsRef: { current: [{ id: 'dfr-A' }] } as Ref<unknown[]>,
    aiaPayAppsRef: { current: [{ id: 'aia-A' }] } as Ref<unknown[]>,
    warrantiesRef: { current: [{ id: 'war-A' }] } as Ref<unknown[]>,
    // Integration round 1: the lists declared below the reset key on this.
    accountEpochRef: { current: 0 } as Ref<number>,
    // Wave 3 (context-integrator, #90): the removed-from verdicts of A's last
    // load and the cleanup it owed must not reach B.
    projectsLoadRevokedRef: { current: new Set(['a3']) } as Ref<ReadonlySet<string>>,
    revokedCleanupOwedRef: { current: { userId: 'userA', names: new Map([['a3', 'A-three']]) } } as Ref<unknown>,
    // Review round 1: A's swept-job list (late-hydrating lists are re-swept
    // against it) must not sweep B's jobs.
    revokedSweepRef: { current: new Map([['a3', 'A-three']]) } as Ref<Map<string, string>>,
  };
  // Every OTHER setter the block calls (the per-account collections), recorded
  // by name: which lists the reset put back to empty.
  const handled = new Set(['setProjectsOwner', 'setProjects', 'setProjectsLoaded']);
  const collectionSetters = [...new Set([...block.matchAll(/\b(set[A-Z]\w*)\(/g)].map(m => m[1]))].filter(n => !handled.has(n));
  const collectionCalls = new Map<string, unknown>();
  let owner: string | null = 'userA';
  let projectsState: P[] = aList;
  let loadedState = true as boolean;
  const runBlock = (from: string | null, to: string | null, list: P[]) => {
    const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(`const __run = () => { ${block} };`);
    const names = Object.keys(refs);
    const run = new Function(...names, ...collectionSetters, 'projectsOwner', 'userId', 'projects', 'setProjectsOwner', 'setProjects', 'setProjectsLoaded', 'resetProjectWriteLog', 'clearTimeout',
      `${js}\nreturn __run;`)(
      ...names.map(n => (refs as Record<string, unknown>)[n]),
      ...collectionSetters.map(n => (v: unknown) => { collectionCalls.set(n, v); }),
      from, to, list,
      (v: string | null) => { owner = v; }, (v: P[]) => { projectsState = v; }, (v: boolean) => { loadedState = v; },
      resetProjectWriteLog, () => undefined,
    ) as () => void;
    run();
  };
  try { runBlock(owner, 'userB', aList); } catch (e) { ok('the reset block transpiles and runs', false, String(e)); }
  ok('...the owner marker moves to B', owner === 'userB');
  ok('...the list is emptied (state and ref) and the loaded flag drops (a spinner, not A\'s list)',
    projectsState.length === 0 && refs.projectsRef.current.length === 0 && loadedState === false);
  ok('...A\'s write log ids are gone, the seq carried forward, since = seq',
    refs.projectWriteLogRef.current.byId.size === 0 && refs.projectWriteLogRef.current.seq === logA.seq
      && refs.projectsLoadSinceRef.current === logA.seq);
  ok('...server ids, schedule base, pending set, load snapshot and owed flag reset',
    refs.serverProjectIdsRef.current.size === 0 && refs.serverScheduleTasksRef.current.size === 0
      && refs.projectsLoadPendingRef.current.size === 0 && refs.projectsLoadBaseRef.current.size === 0
      && refs.projectsLoadTasksRef.current.size === 0 && refs.projectsReloadOwedRef.current === false
      && refs.serverIdsSeededRef.current === false && refs.projectsLoadLandedRef.current === false
      && refs.projectsHydratedForRef.current === undefined);
  ok('...and A\'s "removed from" verdicts and owed cleanup (#90) do not carry into B',
    refs.projectsLoadRevokedRef.current.size === 0 && refs.revokedCleanupOwedRef.current === null && refs.revokedSweepRef.current.size === 0);
  ok('...A\'s waiting debounced syncs are dropped (they must not fire under B\'s session), and A\'s in-flight ones no longer count as B\'s pending',
    refs.syncDebounceMap.current.size === 0 && refs.inFlightProjectSyncsRef.current.size === 0);
  ok('...and the live-user ref follows (a load still out for A sees it is stale)', refs.liveUserIdRef.current === 'userB');
  ok('...and the account epoch moves (the plan / portal-message lists declared below reset on it)', refs.accountEpochRef.current === 1);
  // Hotfix item 4: EVERY per-account list leaves with A, not only projects —
  // B's screens must not show A's change orders / invoices / punch items / RFIs
  // / DFRs while B's loads are out, and a batch add must not start from A's
  // rows in a mirror ref.
  {
    const mustReset = ['setChangeOrders', 'setInvoices', 'setCommitments', 'setDailyReports', 'setPunchItems', 'setProjectPhotos',
      'setRfis', 'setSubmittals', 'setContacts', 'setLeads', 'setSubcontractors', 'setWarranties', 'setPermits', 'setAiaPayApps',
      'setFieldTickets', 'setDelayEvents', 'setBidPackages', 'setBidPackageBids', 'setPrequalPackets', 'setCommEvents'];
    const notEmptied = mustReset.filter(n => !(Array.isArray(collectionCalls.get(n)) && (collectionCalls.get(n) as unknown[]).length === 0));
    ok('...every per-account collection is emptied for B (not only projects)', notEmptied.length === 0, `not reset: ${notEmptied.join(', ')}`);
    ok('...and their mirror refs too (a batch add under B cannot start from A\'s rows)',
      refs.invoicesRef.current.length === 0 && refs.invoiceInsertsRef.current.size === 0 && refs.changeOrderInsertsRef.current.size === 0 && refs.punchItemsRef.current.length === 0
        && refs.projectPhotosRef.current.length === 0 && refs.rfisRef.current.length === 0 && refs.submittalsRef.current.length === 0
        // round 2: A's owed invoices re-read is not paid under B
        && refs.invoicesReloadOwedRef.current === false);
    ok('...and the portal send path\'s mirrors and A\'s insert outcomes (a send under B cannot find A\'s CO / DFR / pay app / warranty)',
      refs.invoiceInsertOutcomesRef.current.size === 0 && refs.changeOrdersRef.current.length === 0 && refs.dailyReportsRef.current.length === 0
        && refs.aiaPayAppsRef.current.length === 0 && refs.warrantiesRef.current.length === 0);
    collectionCalls.clear();
  }

  // A cold launch (signed out → A) keeps the device copy the signed-out pass
  // showed — when that pass read A's cache; with nothing on screen, the flag
  // drops to "loading".
  {
    const coldList = [proj('c1', 'cached')];
    const savedRefs = refs.projectsRef.current;
    refs.projectsRef.current = coldList;
    projectsState = coldList; loadedState = true;
    refs.signedOutCacheOwnerRef.current = 'userA';
    try { runBlock(null, 'userA', coldList); } catch (e) { ok('the reset block runs for a cold launch', false, String(e)); }
    ok('signed out → A (cold launch, A\'s own cache) does not blank the device copy', projectsState === coldList && refs.projectsRef.current === coldList && (loadedState as boolean) === true);
    ok('...nor any other list the signed-out pass showed', collectionCalls.size === 0, [...collectionCalls.keys()].join(', '));
    ok('...and the cache-owner note is used once', refs.signedOutCacheOwnerRef.current === undefined);
    ok('...and the list on screen counts as A\'s hydrated list', refs.projectsHydratedForRef.current === 'userA');
    loadedState = true;
    try { runBlock(null, 'userA', []); } catch { /* reported above */ }
    ok('...and with nothing to show, reads as loading — and nothing counts as hydrated yet', (loadedState as boolean) === false && refs.projectsHydratedForRef.current === undefined);

    // Review round 1: A's session EXPIRED (no wipe), so the signed-out pass
    // put A's cache on screen; then B signs in — signed out → B.
    refs.projectsRef.current = aList; projectsState = aList; loadedState = true;
    refs.syncDebounceMap.current = new Map([['a1', { timer: null, inFlight: false }]]);
    refs.signedOutCacheOwnerRef.current = 'userA';
    try { runBlock(null, 'userB', aList); } catch (e) { ok('the reset block runs for signed out → B', false, String(e)); }
    ok('executed: A\'s session expired, the signed-out pass showed A\'s cache, B signs in → [] and loading (a spinner, not A\'s list)',
      projectsState.length === 0 && refs.projectsRef.current.length === 0 && (loadedState as boolean) === false && refs.syncDebounceMap.current.size === 0);
    // A cold launch whose stored session was dropped: no marker is known → reset.
    refs.projectsRef.current = aList; projectsState = aList; loadedState = true;
    refs.signedOutCacheOwnerRef.current = null;
    try { runBlock(null, 'userB', aList); } catch { /* reported above */ }
    ok('executed: a device copy of unknown ownership is not shown to the next sign-in', projectsState.length === 0 && (loadedState as boolean) === false);
    // B's first load after it: A's queued write on a1 is still in the queue
    // (the pre-session wipe keeps it); B's load reads [b1].
    const queue = [{ table: 'projects', userId: 'userA', data: { id: 'a1' } }, { table: 'projects', data: { id: 'a2' } }];
    const bPending = pendingProjectIdsInQueue(queue, { userId: 'userB', marker: 'userA' });
    const bFirst = planProjectsLoad<P>([proj('b1', 'B-one')], refs.projectsRef.current, refs.projectWriteLogRef.current, refs.projectsLoadSinceRef.current, { pending: bPending });
    ok('executed: ...and B\'s load of [b1] yields exactly [b1] (A\'s queued a1 is not B\'s pending write)', bFirst.projects.map(p => p.id).join() === 'b1', bFirst.projects.map(p => p.id).join());
    const leak = planProjectsLoad<P>([proj('b1', 'B-one')], aList, refs.projectWriteLogRef.current, refs.projectsLoadSinceRef.current, { pending: pendingProjectIdsInQueue(queue) });
    ok('control: the whole queue plus A\'s list on screen saved a1 into B\'s list', leak.projects.some(p => p.id === 'a1'));
    ok('the queue counts only this session\'s entries (tagged for it, or untagged under its own marker)',
      [...pendingProjectIdsInQueue(queue, { userId: 'userA', marker: 'userA' })].sort().join() === 'a1,a2'
        && [...pendingProjectIdsInQueue(queue, { userId: 'userA', marker: 'userB' })].join() === 'a1'
        && bPending.size === 0);
    // Integration round 1: A's session expired with NO projects, and the
    // signed-out pass showed A's cached leads / contacts / subs. B signs in.
    refs.projectsRef.current = []; projectsState = []; loadedState = true;
    refs.signedOutCacheOwnerRef.current = 'userA';
    collectionCalls.clear();
    const oldRule = (projectsOwner: string | null, list: unknown[], cacheOwner: string | null | undefined, to: string) =>
      projectsOwner !== null || (list.length > 0 && cacheOwner !== to);
    ok('control: the old rule kept A\'s other lists on B\'s screens when A had no projects', oldRule(null, [], 'userA', 'userB') === false);
    try { runBlock(null, 'userB', []); } catch (e) { ok('the reset block runs for signed out → B with no projects', false, String(e)); }
    ok('executed: signed out → B with no projects still resets every other list the signed-out pass showed',
      Array.isArray(collectionCalls.get('setLeads')) && (collectionCalls.get('setLeads') as unknown[]).length === 0
        && Array.isArray(collectionCalls.get('setContacts')) && (collectionCalls.get('setContacts') as unknown[]).length === 0);
    collectionCalls.clear();
    refs.projectsRef.current = savedRefs;
    projectsState = []; loadedState = false; owner = 'userB';
  }

  // Integration round 1: the lists declared BELOW the reset (plan sheets, pins,
  // zones, reviews, markups, calibrations, permit roadmaps, portal messages)
  // reset in their own render-phase block on the epoch — A → B through a
  // magic link or a password-reset session keeps canSync true, so no loader
  // keyed on it re-ran, and B's Universal Search listed A's sheets and pins.
  {
    const plansBlock = slice(CTX, 'if (plansAccountEpoch !== accountEpochRef.current) {', '\n  }\n');
    ok('the plan / portal-message lists have an epoch-keyed render-phase reset', plansBlock.length > 0);
    const calls = new Map<string, unknown>();
    const setters = [...new Set([...plansBlock.matchAll(/\b(set[A-Z]\w*)\(/g)].map(m => m[1]))];
    const planSheetsRef = { current: [{ id: 'sheet-A' }] as unknown[] };
    let epochState = 0;
    const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(`const __run = () => { ${plansBlock} };`);
    try {
      new Function('plansAccountEpoch', 'accountEpochRef', 'planSheetsRef', ...setters, `${js}\nreturn __run;`)(
        0, { current: 1 }, planSheetsRef,
        ...setters.map(n => (v: unknown) => { if (n === 'setPlansAccountEpoch') epochState = v as number; else calls.set(n, v); }),
      )();
    } catch (e) { ok('the plans reset block runs', false, String(e)); }
    const must = ['setPlanSheets', 'setDrawingPins', 'setPlanZones', 'setPlanReviews', 'setPlanMarkups', 'setPlanCalibrations', 'setPermitRoadmaps', 'setPortalMessages'];
    const missed = must.filter(n => !(Array.isArray(calls.get(n)) && (calls.get(n) as unknown[]).length === 0));
    ok('executed: all eight lists (and the sheets ref) are emptied for B, once per epoch',
      missed.length === 0 && planSheetsRef.current.length === 0 && epochState === 1, `not reset: ${missed.join(', ')}`);
    ok('...and it sits after their declarations (their setters exist when it runs)',
      CTX.indexOf('if (plansAccountEpoch !== accountEpochRef.current) {') > CTX.indexOf('const [permitRoadmaps, setPermitRoadmaps] = useState<PermitRoadmap[]>([]);')
        && CTX.indexOf('const [portalMessages, setPortalMessages] = useState<PortalMessage[]>([]);') < CTX.indexOf('if (plansAccountEpoch !== accountEpochRef.current) {'));
    ok('their loaders re-run per account and drop a read whose account left',
      // Wave 3 (#74): the server half is shared with the re-read (pullPlansFromServer).
      /\}, \[canSync, userId, pullPlansFromServer\]\);\s*useEffect\(\(\) => \{ void hydratePlansFromServer\(\); \}, \[hydratePlansFromServer\]\);/.test(CTX)
        && /const refetchPlansFromServer = useCallback\(async \(\): Promise<void> => \{\s*if \(!canSync \|\| !userId\) return;\s*const owner = userId;\s*const stillMine = \(\) => liveUserIdRef\.current === owner;/.test(CTX)
        && /const stillMine = \(\) => liveUserIdRef\.current === owner;/.test(CTX)
        && /loadLocal<PortalMessage\[\]>\(PORTAL_MESSAGES_KEY, \[\]\)\.then\(\(list\) => \{\s*if \(liveUserIdRef\.current === owner\) setPortalMessages\(list\);\s*\}\);\s*\}, \[userId\]\);/.test(CTX)
        && /loadLocal<PermitRoadmap\[\]>\(PLAN_ROADMAPS_KEY, \[\]\)\.then\(mine\(setPermitRoadmaps\)\);\s*\}, \[userId\]\);/.test(CTX));
  }

  // After the reset: the signed-out load and B's zero-row / failed load.
  const afterSignOut = keepProjectsWrittenSince<P>([], refs.projectsRef.current, refs.projectWriteLogRef.current, refs.projectsLoadSinceRef.current);
  ok('executed: hydrate([]) after the switch → []', afterSignOut.length === 0, afterSignOut.map(p => p.id).join());
  const bLoad = keepProjectsWrittenSince<P>([proj('b1', 'B-one')], [], refs.projectWriteLogRef.current, refs.projectsLoadSinceRef.current);
  ok('executed: B\'s first load is exactly B\'s rows', bLoad.map(p => p.id).join() === 'b1');
  // A load A started BEFORE the switch has since = an A seq ≤ the carried seq;
  // B's write after the switch still counts as newer than it.
  const logB = refs.projectWriteLogRef.current;
  noteProjectWrite(logB, 'b1');
  const staleSince = sinceA;
  ok('executed: B\'s write after the switch still outranks a load begun before it (seq never rewinds)',
    keepProjectsWrittenSince<P>([proj('b1', 'server')], [proj('b1', 'mine')], logB, staleSince)[0].name === 'mine');

  // Wiring pins.
  const qf = slice(CTX, "queryKey: ['projects', userId],", 'const settingsQuery = useQuery({');
  // Integration round 1: it THROWS (no data, never retried) — resolved as []
  // the key held an empty "loaded" list a same-account sign-in within
  // staleTime showed as "no projects".
  const STALE = 'if (liveUserIdRef.current !== userId) throw new StaleAccountLoadError();';
  ok('the loader yields nothing (and caches nothing) for an account no longer signed in — it throws',
    qf.includes(STALE) && /throw new StaleAccountLoadError\(\);[\s\S]*await saveLocal\(PROJECTS_KEY, merged\);/.test(qf)
      && qf.indexOf(STALE) < qf.indexOf('serverProjectIdsRef.current = new Set(remoteIds);')
      && /catch \(err\) \{\s*if \(err instanceof StaleAccountLoadError\) throw err;/.test(qf)
      && !/liveUserIdRef\.current !== userId\) return \[\];/.test(qf));
  ok('...nor its device-cache fallback', /const cached = await loadLocal<Project\[\]>\(PROJECTS_KEY, \[\]\);\s*\/\/[^\n]*\n\s*if \(liveUserIdRef\.current !== userId\) throw new StaleAccountLoadError\(\);\s*if \(!userId\) signedOutCacheOwnerRef\.current = cacheOwner;\s*return cached;/.test(qf));
  ok('...the stale load is never retried, and a deep-equal load still reaches the hydration pass (no structural sharing)',
    /structuralSharing: false,/.test(qf.slice(0, qf.indexOf('queryFn:'))) && /if \(error instanceof StaleAccountLoadError\) return false;/.test(qf));
  ok('the signed-out pass records whose cache it read (the last-user marker, read before the cache)',
    /if \(!userId\) \{\s*try \{ cacheOwner = await AsyncStorage\.getItem\(LAST_USER_MARKER_KEY\); \}/.test(qf)
      && CTX.includes("const LAST_USER_MARKER_KEY = 'mageid_last_user_id';"));
  ok('signed out → X resets unless the list on screen is known to be X\'s',
    /const accountLeft = projectsOwner !== null \|\| signedOutCacheOwnerRef\.current !== userId;/.test(CTX)
      && /if \(accountLeft\) \{/.test(CTX));
  ok('the reset runs before the projects query is declared (so before its fetch and the hydrate effect)',
    CTX.indexOf('if (projectsOwner !== userId) {') > 0 && CTX.indexOf('if (projectsOwner !== userId) {') < CTX.indexOf("queryKey: ['projects', userId],"));
  ok('projectsLoaded is re-raised per account', /if \(!projectsQuery\.isLoading\) setProjectsLoaded\(true\);\s*\}, \[projectsQuery\.isLoading, userId\]\);/.test(CTX));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n#7 — a cache-fallback launch does not re-send the schedule with a status change:');
{
  const raw = serializeServerConfirmedIds('u1', ['x', 'y']);
  ok('the persisted set round-trips for its account', [...parseServerConfirmedIds(raw, 'u1')].join() === 'x,y');
  ok('...and is ignored for another account, garbage, or no account',
    parseServerConfirmedIds(raw, 'u2').size === 0 && parseServerConfirmedIds('{nope', 'u1').size === 0 && parseServerConfirmedIds(raw, null).size === 0);
  ok('the key is swept on a tenant switch (app prefix)', isAppStorageKey('mageid_projects_server_ids') && CTX.includes("const SERVER_PROJECT_IDS_KEY = 'mageid_projects_server_ids';"));
  // Executed: the SELECT failed; the in-memory set is empty; the persisted set
  // is seeded. updateProject(status) → changedKeys ['status'].
  const seeded = new Set<string>();
  for (const id of parseServerConfirmedIds(raw, 'u1')) seeded.add(id);
  const statusSends = projectSyncSendsSchedule(['status']);
  ok('executed: a server-confirmed project\'s status change carries no schedule', !ownerUpsertCarriesSchedule(statusSends, false, seeded.has('x')));
  ok('executed: a local-only (never confirmed) project\'s first upsert still carries it — it is the INSERT', ownerUpsertCarriesSchedule(statusSends, false, seeded.has('offline-new')));
  ok('control: the old rule (empty in-memory set) sent it for the confirmed one too', ownerUpsertCarriesSchedule(statusSends, false, new Set<string>().has('x')));
  ok('a schedule edit always carries it; a shared PATCH never needs it for creation',
    ownerUpsertCarriesSchedule(projectSyncSendsSchedule(['schedule']), false, true) && !ownerUpsertCarriesSchedule(false, true, false));

  const sync = slice(CTX, 'const syncProjectToSupabase = useCallback(', 'const flushPendingProjectSyncs = useCallback(');
  ok('...but never awaits on addProject\'s immediate sync (its write must go out synchronously, FIFO ahead of its children)',
    /if \(!shared && !opts\?\.immediate && !serverProjectIdsRef\.current\.has\(project\.id\)\) await seedServerProjectIds\(\);/.test(sync));
  ok('the persisted set is seeded at mount for a syncing account', /useEffect\(\(\) => \{ if \(canSync\) void seedServerProjectIds\(\); \}, \[canSync, seedServerProjectIds\]\);/.test(CTX));
  ok('the sync seeds the persisted set before deciding',
    sync.indexOf('await seedServerProjectIds();') > 0 && sync.indexOf('await seedServerProjectIds();') < sync.indexOf('const includeSchedule = ownerUpsertCarriesSchedule('));
  ok('...any landed owner upsert marks the row confirmed and persists it',
    /if \(landed && !shared && liveUserIdRef\.current === userId && !serverProjectIdsRef\.current\.has\(project\.id\)\) \{\s*serverProjectIdsRef\.current\.add\(project\.id\);\s*void persistServerProjectIds\(\);/.test(sync)
      && !/landed && !shared && includeSchedule/.test(sync));
  const qf = slice(CTX, "queryKey: ['projects', userId],", 'const settingsQuery = useQuery({');
  ok('a successful load persists what the server returned', /serverProjectIdsRef\.current = new Set\(remoteIds\);\s*serverIdsSeededRef\.current = true;\s*void persistServerProjectIds\(\);/.test(qf));
  ok('...and the fallback path seeds from it', /await seedServerProjectIds\(\);\s*\}[\s\S]{0,700}?const cached = await loadLocal/.test(qf));
  ok('the persisted copy is written only once seeded (never an empty set over a good one)',
    /if \(!userId \|\| !serverIdsSeededRef\.current \|\| liveUserIdRef\.current !== userId\) return;/.test(CTX));
  ok('the allowance lockdown sync names its money keys (no device schedule riding along)',
    /syncProjectToSupabase\(updatedProject, 'upsert', \{ changedKeys: allowanceLockdownKeys \}\);/.test(CTX)
      && /allowanceLockdownKeys = \[\.\.\.Object\.keys\(preBuyoutPatch\), 'linkedEstimate', 'updatedAt'\];/.test(CTX));
  ok('updateProject (status, portal toggle, terms stamp) still passes its own keys',
    CTX.includes("syncProjectToSupabase(proj, 'upsert', { changedKeys: Object.keys(rawUpdates) });"));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n#8 — a load that starts while an edit is still unconfirmed keeps the edit:');
{
  const pre = [t({ id: 'A', startDay: 1 }), t({ id: 'B', startDay: 10 })];
  const moved = [t({ id: 'A', startDay: 3 }), t({ id: 'B', startDay: 10 })];
  // The edit was made BEFORE the load started (its seq ≤ since) — the old
  // guard's blind spot — and is still queued / in flight.
  const log = newProjectWriteLog();
  noteProjectWrite(log, 'p1');
  const since = log.seq;
  const server = [{ ...proj('p1', 'server', pre, 100) }, proj('p2', 'other-server')];
  const local = [{ ...proj('p1', 'mine', moved, 250) }, proj('p2', 'other-local')];
  const control = keepProjectsWrittenSince<P>(server, local, log, since);
  ok('control: without the pending set the queued move snaps back', control[0].schedule!.tasks[0].startDay === 1);
  const queued = pendingProjectIdsInQueue([{ table: 'projects', data: { id: 'p1' } }]);
  const out = planProjectsLoad<P>(server, local, log, since, { pending: queued });
  ok('executed: a queued write made before the load → the whole device row (dates AND money)',
    out.projects[0].schedule!.tasks[0].startDay === 3 && out.projects[0].estimate === 250 && out.projects[0].name === 'mine');
  ok('...an untouched project still takes the server\'s', out.projects[1].name === 'other-server');
  ok('...and the load owes a re-read for it', out.keptWhole.has('p1') && !out.keptWhole.has('p2'));
  const inFlight = planProjectsLoad<P>(server, local, log, since, { pending: new Set(['p1']) });
  ok('executed: an in-flight debounce entry made before the load → the device row', inFlight.projects[0].schedule!.tasks[0].startDay === 3);
  const fin = pendingProjectIdsInQueue([{ table: 'project_financials', data: { project_id: 'p1', estimate: 250 } }, { table: 'invoices', data: { id: 'zz' } }]);
  ok('executed: a money leg still queued after the projects leg returned counts (keyed by project_id)', fin.has('p1') && !fin.has('zz'));
  ok('...and keeps the device\'s estimate', planProjectsLoad<P>(server, local, log, since, { pending: fin }).projects[0].estimate === 250);
  ok('a queued projects DELETE keeps the device\'s absence',
    planProjectsLoad<P>(server, [proj('p2', 'x')], log, since, { pending: pendingProjectIdsInQueue([{ table: 'projects', data: { id: 'p1' } }]) }).projects.every(p => p.id !== 'p1'));
  // Schedule Pro: persisted [A3,B10], the load read [A1,B10], working [A3,B10].
  const guarded = out.projects[0].schedule!.tasks;
  // The screen takes a load that reaches it from outside WHOLE once quiet
  // (utils/scheduleMerge.ts), so what the guard hands it is what it shows.
  const screenTakes = (incoming: ScheduleTask[]) => {
    resetScheduleSyncGatesForTest();
    const copy = takeStoreScheduleCopy(openScheduleSyncGate('sli', 'LOADED'), { tasks: incoming, stamp: 'REFETCH' }, false, true);
    return copy ? copy.tasks : moved;
  };
  ok('executed: Schedule Pro, taking the guarded load, keeps A3 while the project is pending', screenTakes(guarded)[0].startDay === 3);
  ok('control: fed the raw load, the screen took A1', screenTakes(pre)[0].startDay === 1);

  const qf = slice(CTX, "queryKey: ['projects', userId],", 'const settingsQuery = useQuery({');
  const SNAP = 'const pendingAtStart = unconfirmedProjectSyncIds(syncDebounceMap.current, inFlightProjectSyncsRef.current);';
  const iSnap = qf.indexOf(SNAP);
  const iQueue = qf.indexOf('for (const id of await ownQueuedProjectIds(userId)) pendingAtStart.add(id);');
  ok('the loader snapshots the debounce map, the in-flight set and this session\'s queue BEFORE the first SELECT',
    iSnap > 0 && iQueue > iSnap && iQueue < qf.indexOf(".from('projects')"));
  ok('ownQueuedProjectIds partitions the queue by session (marker first, queue second)',
    /let marker: string \| null = null;\s*try \{ marker = await AsyncStorage\.getItem\(LAST_USER_MARKER_KEY\); \}[^\n]*\n\s*return pendingProjectIdsInQueue\(await getOfflineQueue\(\), \{ userId: sessionUserId, marker \}\);/.test(CTX));

  // Review round 1 — a sync fired by flushPendingProjectSyncs (iOS going
  // inactive inside the 800 ms window) is on the wire when the foreground
  // refetch starts. Executed with the REAL flush body, the REAL run prologue
  // and finally, the loader's REAL snapshot line and the REAL
  // refetchProjectsOnForeground.
  {
    const syncSrc = slice(CTX, 'const syncProjectToSupabase = useCallback(', 'const flushPendingProjectSyncs = useCallback(');
    const prologue = slice(syncSrc, 'entry.inFlight = true;', 'entry.timer = null;');
    const fin = slice(syncSrc, '} finally {', 'void settleOwedProjectsReload();');
    const flushSrc = slice(CTX, 'const flushPendingProjectSyncs = useCallback(', '\n  }, []);');
    const refetchSrc = slice(CTX, 'const refetchProjectsOnForeground = useCallback(', '}, [flushPendingProjectSyncs');
    ok('the flush, the run prologue/finally and the refetch are all found', !!prologue && !!fin && !!flushSrc && !!refetchSrc);
    const tr = (code: string) => new Bun.Transpiler({ loader: 'ts' }).transformSync(code);
    const syncDebounceMap = { current: new Map<string, { timer: unknown; inFlight: boolean; sendsSchedule: boolean; run: () => Promise<void> }>() };
    const inFlightProjectSyncsRef = { current: new Map<unknown, string>() };
    let release: () => void = () => undefined;
    let settled = 0;
    const makeEntry = (id: string, gate: Promise<void>) => {
      const entry = { timer: 1 as unknown, inFlight: false, sendsSchedule: false, run: async (): Promise<void> => undefined };
      entry.run = new Function('entry', 'project', 'syncDebounceMap', 'inFlightProjectSyncsRef', 'settleOwedProjectsReload', 'gate',
        tr(`const __r = async () => { ${prologue}\n try { await gate;\n ${fin}\n } };`) + '\nreturn __r;')(
        entry, { id }, syncDebounceMap, inFlightProjectSyncsRef, () => { settled++; }, gate) as () => Promise<void>;
      return entry;
    };
    try {
      const gate = new Promise<void>((r) => { release = r; });
      syncDebounceMap.current.set('p1', makeEntry('p1', gate));
      const flush = new Function('syncDebounceMap', 'clearTimeout',
        tr(`const __f = ${flushSrc.replace('const flushPendingProjectSyncs = useCallback(', '').replace(/, \[\]\);$/, '')};`) + '\nreturn __f;')(
        syncDebounceMap, () => undefined) as () => Promise<void>;
      const flushing = flush();
      const snap = new Function('syncDebounceMap', 'inFlightProjectSyncsRef', 'unconfirmedProjectSyncIds', `${SNAP}\nreturn pendingAtStart;`)(
        syncDebounceMap, inFlightProjectSyncsRef, unconfirmedProjectSyncIds) as Set<string>;
      ok('executed: a flushed sync on the wire is in the loader\'s pending snapshot', snap.has('p1'), [...snap].join());
      ok('executed: ...and keeps its map slot until it reports (the flush fires it as its timer would, it does not take it out)',
        syncDebounceMap.current.has('p1') && syncDebounceMap.current.get('p1')!.inFlight);
      const calls: string[] = [];
      const refetch = new Function('flushPendingProjectSyncs', 'syncDebounceMap', 'inFlightProjectSyncsRef', 'unconfirmedProjectSyncIds', 'ownQueuedProjectIds', 'queryClient', 'userId', 'projectsReloadOwedRef',
        tr(`const __g = ${refetchSrc.replace('const refetchProjectsOnForeground = useCallback(', '').replace(/, \[flushPendingProjectSyncs$/, '')};`) + '\nreturn __g;')(
        flush, syncDebounceMap, inFlightProjectSyncsRef, unconfirmedProjectSyncIds, async () => new Set<string>(),
        { invalidateQueries: async () => { calls.push('invalidate'); } }, 'u1', { current: false }) as () => Promise<void>;
      await refetch();
      ok('executed: ...and the foreground refetch does not invalidate over it', !calls.includes('invalidate'), calls.join());
      // A newer edit replaces the in-flight entry in the map and its own write
      // reports first: the older write is still out.
      const gate2 = new Promise<void>(() => undefined);
      const older = makeEntry('p2', gate2);
      syncDebounceMap.current.set('p2', older);
      void older.run();
      const newer = makeEntry('p2', Promise.resolve());
      syncDebounceMap.current.set('p2', newer);
      await newer.run();
      const snap2 = unconfirmedProjectSyncIds(syncDebounceMap.current, inFlightProjectSyncsRef.current);
      ok('executed: a replaced write still on the wire counts after its replacement reported', snap2.has('p2') && !syncDebounceMap.current.has('p2'));
      release();
      await flushing;
      ok('executed: once the flushed write reports, its slot and in-flight mark are gone and the settle runs',
        !syncDebounceMap.current.has('p1') && ![...inFlightProjectSyncsRef.current.values()].includes('p1') && settled >= 1);
      // Only the replaced p2 write is still out now, and the map is empty.
      const calls2: string[] = [];
      const refetch2 = new Function('flushPendingProjectSyncs', 'syncDebounceMap', 'inFlightProjectSyncsRef', 'unconfirmedProjectSyncIds', 'ownQueuedProjectIds', 'queryClient', 'userId', 'projectsReloadOwedRef',
        tr(`const __g = ${refetchSrc.replace('const refetchProjectsOnForeground = useCallback(', '').replace(/, \[flushPendingProjectSyncs$/, '')};`) + '\nreturn __g;')(
        flush, syncDebounceMap, inFlightProjectSyncsRef, unconfirmedProjectSyncIds, async () => new Set<string>(),
        { invalidateQueries: async () => { calls2.push('invalidate'); } }, 'u1', { current: false }) as () => Promise<void>;
      await refetch2();
      ok('executed: the foreground refetch also holds for a write on the wire with no map slot', syncDebounceMap.current.size === 0 && !calls2.includes('invalidate'), calls2.join());
      // CONTROL: the old flush, which took the entry out of the map before
      // firing it, with the old map-only snapshot.
      const oldMap = new Map([['p9', { inFlight: false }]]);
      for (const [id, p] of oldMap) { if (p.inFlight) continue; oldMap.delete(id); }
      ok('control: the old flush + map-only snapshot saw nothing pending', new Set(oldMap.keys()).size === 0);
    } catch (e) { ok('the flush replay runs', false, String(e)); }
  }
  ok('...and hands the same set to the hydration pass',
    /projectsLoadPendingRef\.current = pendingAtStart;/.test(qf) && /pending: projectsLoadPendingRef\.current,/.test(CTX));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n#96 — an edit during the load does not hide what the load read:');
{
  // The foreman set Framing to 60 on the server; the GC, during the load,
  // marked Drywall done on the same project.
  const base = [t({ id: 'framing', progress: 0 }), t({ id: 'drywall', progress: 0 })];
  const serverTasks = [t({ id: 'framing', progress: 60 }), t({ id: 'drywall', progress: 0 })];
  const gcTasks = [t({ id: 'framing', progress: 0 }), t({ id: 'drywall', progress: 100 })];
  const log = newProjectWriteLog();
  const since = log.seq;
  noteProjectWrite(log, 'p1'); // his edit, during the load
  const loaded = [proj('p1', 'server', serverTasks)];
  const local = [proj('p1', 'mine', gcTasks)];
  const control = keepProjectsWrittenSince<P>(loaded, local, log, since);
  ok('control: the old rule dropped the foreman\'s 60', control[0].schedule!.tasks.find(x => x.id === 'framing')!.progress === 0);
  const baseMap = new Map([['p1', base]]);
  const plan = planProjectsLoad<P>(loaded, local, log, since, { fold: foldServerSchedule<P>(baseMap) });
  const tasks = plan.projects[0].schedule!.tasks;
  ok('executed: the foreman\'s 60 is in, and the GC\'s in-flight edit stays',
    tasks.find(x => x.id === 'framing')!.progress === 60 && tasks.find(x => x.id === 'drywall')!.progress === 100, JSON.stringify(tasks.map(x => [x.id, x.progress])));
  ok('...folded, not kept whole (no re-read owed)', plan.folded.has('p1') && !plan.keptWhole.has('p1'));
  const noBase = planProjectsLoad<P>(loaded, local, log, since, { fold: foldServerSchedule<P>(new Map()) });
  ok('executed: with no base (first load of the launch) the device row is kept whole — a 3-way merge would take the server over his edit',
    noBase.projects[0].schedule!.tasks.find(x => x.id === 'drywall')!.progress === 100 && noBase.keptWhole.has('p1'));
  const pendingToo = planProjectsLoad<P>(loaded, local, log, since, { pending: new Set(['p1']), fold: foldServerSchedule<P>(baseMap) });
  ok('a project pending when the load began is never folded (the read may predate his write)', pendingToo.keptWhole.has('p1') && !pendingToo.folded.has('p1'));
  // The hydration pass folds against the tasks the load READ, not the row.
  const hyd = keepProjectsWrittenSince<P>([proj('p1', 'cache-row', gcTasks)], local, log, since, { fold: foldServerSchedule<P>(baseMap, new Map([['p1', serverTasks]])) });
  ok('executed: the hydration pass folds the loaded tasks even when the row is a cache write', hyd[0].schedule!.tasks.find(x => x.id === 'framing')!.progress === 60);
  const consumed = keepProjectsWrittenSince<P>([proj('p1', 'cache-row', gcTasks)], local, log, since, { fold: foldServerSchedule<P>(baseMap, new Map()) });
  ok('...and once consumed, a later cache write keeps the device copy', consumed[0].schedule!.tasks.find(x => x.id === 'framing')!.progress === 0);

  const qf = slice(CTX, "queryKey: ['projects', userId],", 'const settingsQuery = useQuery({');
  ok('the base is snapshotted before the reads', qf.indexOf('const baseAtStart = new Map(serverScheduleTasksRef.current);') > 0
    && qf.indexOf('const baseAtStart = new Map(serverScheduleTasksRef.current);') < qf.indexOf(".from('projects')"));
  ok('the base does not advance for a row kept whole — where a base exists',
    /for \(const p of mapped\) \{\s*if \(plan\.keptWhole\.has\(p\.id\) && serverScheduleTasksRef\.current\.has\(p\.id\)\) continue;\s*serverScheduleTasksRef\.current\.set\(p\.id, p\.schedule\?\.tasks \?\? \[\]\);/.test(qf)
      && !/for \(const p of mapped\) serverScheduleTasksRef\.current\.set/.test(qf));
  // Review round 1, executed with the loader's REAL base loop: the launch's
  // first load (no base) kept P whole because the GC moved task A 1 → 3
  // during it; a realtime event then carries the server's A = 1 and the
  // foreman's Framing 60.
  {
    const loop = slice(qf, 'const loadedTasks = new Map<string, ScheduleTask[]>();', 'projectsLoadSinceRef.current = writeSeqAtStart;');
    const runLoop = (baseRef: Map<string, ScheduleTask[]>, mapped: P[], keptWhole: Set<string>) => new Function('serverScheduleTasksRef', 'mapped', 'plan', 'pendingAtStart',
      new Bun.Transpiler({ loader: 'ts' }).transformSync(loop.replace('projectsLoadSinceRef.current = writeSeqAtStart;', '')))(
      { current: baseRef }, mapped, { keptWhole }, new Set<string>());
    const serverP = proj('P', 'server', [t({ id: 'A', startDay: 1 }), t({ id: 'framing', progress: 0 })]);
    const mineTasks = [t({ id: 'A', startDay: 3 }), t({ id: 'framing', progress: 0 })];
    const event = [t({ id: 'A', startDay: 1 }), t({ id: 'framing', progress: 60 })];
    const empty = new Map<string, ScheduleTask[]>();
    try {
      runLoop(empty, [serverP], new Set(['P']));
      ok('executed: a kept-whole row with no base gets the SELECT as its base', empty.has('P'));
      const after = absorbServerScheduleTasks(empty.get('P'), event, mineTasks);
      ok('executed: ...so the next realtime absorb keeps his unconfirmed move (A = 3) and takes the foreman\'s 60',
        after.find(x => x.id === 'A')!.startDay === 3 && after.find(x => x.id === 'framing')!.progress === 60,
        JSON.stringify(after.map(x => [x.id, x.startDay, x.progress])));
      const control = absorbServerScheduleTasks(undefined, event, mineTasks);
      ok('control: with no base (the unconditional skip) the absorb reverted A to 1', control.find(x => x.id === 'A')!.startDay === 1);
      const existing = new Map([['P', [t({ id: 'A', startDay: 1 })]]]);
      const before = existing.get('P');
      runLoop(existing, [proj('P', 'server', [t({ id: 'A', startDay: 1 }), t({ id: 'framing', progress: 60 })])], new Set(['P']));
      ok('executed: a kept-whole row WITH a base keeps that base (the foreman\'s unseen 60 is not recorded as absorbed)', existing.get('P') === before);
    } catch (e) { ok('the base loop runs', false, String(e)); }
  }
  ok('only the newest load started marks that it landed (the hydration pass decides the owed flag)',
    /const loadSeq = \+\+projectsLoadSeqRef\.current;/.test(qf) && /if \(loadSeq === projectsLoadSeqRef\.current\) projectsLoadLandedRef\.current = true;/.test(qf)
      && !/projectsReloadOwedRef\.current = true/.test(qf));
  const settle = slice(CTX, 'const settleOwedProjectsReload = useCallback(', '}, [queryClient, userId]);');
  ok('the owed re-read waits for the debounce map, the in-flight set AND this session\'s queue, then invalidates once',
    /const syncsOut = \(\) => unconfirmedProjectSyncIds\(syncDebounceMap\.current, inFlightProjectSyncsRef\.current\)\.size > 0;/.test(settle)
      && /queued = await ownQueuedProjectIds\(userId\);/.test(settle)
      && /projectsReloadOwedRef\.current = false;\s*await queryClient\.invalidateQueries\(\{ queryKey: \['projects', userId\] \}\);/.test(settle));
  const sync = slice(CTX, 'const syncProjectToSupabase = useCallback(', 'const flushPendingProjectSyncs = useCallback(');
  ok('...fired when a direct sync reports (it never reaches the post-flush listener)',
    /finally \{\s*if \(syncDebounceMap\.current\.get\(project\.id\) === entry\) syncDebounceMap\.current\.delete\(project\.id\);\s*inFlightProjectSyncsRef\.current\.delete\(entry\);\s*\/\/[^\n]*\n\s*void settleOwedProjectsReload\(\);/.test(sync));
  ok('...and after each hydration', /projectsReloadOwedRef\.current = plan\.keptWhole\.size > 0;\s*\}\s*void settleOwedProjectsReload\(\);/.test(CTX));
  ok('the hydration consumes the loaded tasks (one fold per load)', /const loadedTasks = projectsLoadTasksRef\.current;\s*projectsLoadTasksRef\.current = new Map\(\);/.test(CTX));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\nReview round 2 — a cold launch, a skipped foreground refetch, a clean re-read:');
{
  const tr = (code: string) => new Bun.Transpiler({ loader: 'ts' }).transformSync(code);
  type Ref<T> = { current: T };
  const qf = slice(CTX, "queryKey: ['projects', userId],", 'const settingsQuery = useQuery({');
  // Wave 3 (#90): the plan now ends with the removed-job filter.
  const loaderPlan = slice(qf, 'const planLocal = ', 'projectsLoadRevokedRef.current = revoked;');
  const hydSrc = slice(CTX, 'if (projectsQuery.data) {\n      const loadedTasks', 'void settleOwedProjectsReload();\n    }');
  const settleSrc = slice(CTX, 'const settleOwedProjectsReload = useCallback(', '}, [queryClient, userId]);');
  const refetchSrc = slice(CTX, 'const refetchProjectsOnForeground = useCallback(', '}, [flushPendingProjectSyncs');
  ok('the loader\'s plan, the hydration pass, the settle and the refetch are all found', !!loaderPlan && !!hydSrc && !!settleSrc && !!refetchSrc);

  // The loader's REAL plan lines.
  // Review round 1 (#90): the loader now confirms a ZERO-row read with a
  // second read before revoking (revocationConfirmed / confirmNoProjects), so
  // the plan is async and takes the read's `data` and that confirmation.
  const runLoader = async (env: { hydratedFor: string | null | undefined; userId: string; projectsRef: P[]; localForMerge: P[]; mapped: P[];
    log: ProjectWriteLog; since: number; pending: Set<string>; confirmEmpty?: boolean }) => (new Function('projectsHydratedForRef', 'userId', 'projectsRef', 'withDeviceCopies',
    'localForMerge', 'projectWriteLogRef', 'writeSeqAtStart', 'planProjectsLoad', 'mapped', 'remoteIds', 'pendingAtStart', 'foldServerSchedule', 'baseAtStart',
    'revokedCachedProjectIds', 'projectsLoadRevokedRef', 'data', 'revocationConfirmed', 'confirmNoProjects', 'revokedSweepRef',
    tr(`const __l = async () => { ${loaderPlan}\n return { merged, plan, revoked }; };`) + '\nreturn __l;')(
    { current: env.hydratedFor }, env.userId, { current: env.projectsRef }, withDeviceCopies, env.localForMerge, { current: env.log }, env.since,
    planProjectsLoad, env.mapped, new Set(env.mapped.map(p => p.id)), env.pending, foldServerSchedule, new Map(), revokedCachedProjectIds, { current: new Set() },
    env.mapped, revocationConfirmed, async () => env.confirmEmpty === true, { current: new Map() },
  )() as Promise<{ merged: P[]; plan: { keptWhole: Set<string> }; revoked: Set<string> }>);
  // The hydration pass's REAL body.
  const runHydration = (env: { data: P[]; hydratedFor: Ref<string | null | undefined>; userId: string; projectsRef: P[]; log: ProjectWriteLog;
    since: number; pending: Set<string>; landed: Ref<boolean>; owed: Ref<boolean>; settle: () => void; revoked?: Set<string> }) => {
    let set: P[] | null = null;
    new Function('projectsQuery', 'projectsLoadTasksRef', 'projectsHydratedForRef', 'userId', 'projectsRef', 'withDeviceCopies', 'projectWriteLogRef',
      'projectsLoadSinceRef', 'planProjectsLoad', 'projectsLoadPendingRef', 'foldServerSchedule', 'projectsLoadBaseRef', 'setProjects',
      'projectsLoadLandedRef', 'projectsReloadOwedRef', 'settleOwedProjectsReload',
      'projectsLoadRevokedRef', 'revokedCleanupOwedRef', 'setRevokedCleanup', tr(`const __h = () => { ${hydSrc} };`) + '\nreturn __h;')(
      { data: env.data }, { current: new Map() }, env.hydratedFor, env.userId, { current: env.projectsRef }, withDeviceCopies, { current: env.log },
      { current: env.since }, planProjectsLoad, { current: env.pending }, foldServerSchedule, { current: new Map() }, (v: P[]) => { set = v; },
      env.landed, env.owed, env.settle,
      { current: env.revoked ?? new Set() }, { current: null }, () => undefined,
    )();
    return set as P[] | null;
  };

  // 1. iOS cold launch: the session restored before the signed-out pass's
  // cache read landed, so `projects` is still [] when A's first load plans.
  // p1 is on the server with his offline date move queued (the cache has the
  // move and his zoning-confirmed structuredAddress); p3 was created offline
  // (queued, not on the server yet).
  try {
    const moved = [t({ id: 'A', startDay: 3 })];
    const p1Cache = { ...proj('p1', 'mine', moved), structuredAddress: 'confirmed' } as P;
    const p3Cache = proj('p3', 'offline-new');
    const log = newProjectWriteLog();
    const env = { hydratedFor: undefined, userId: 'userA', projectsRef: [] as P[], localForMerge: [p1Cache, proj('p2', 'two'), p3Cache],
      mapped: [proj('p1', 'server', [t({ id: 'A', startDay: 1 })]), proj('p2', 'two-server')], log, since: log.seq,
      pending: pendingProjectIdsInQueue([{ table: 'projects', userId: 'userA', data: { id: 'p1' } }, { table: 'projects', userId: 'userA', data: { id: 'p3' } }], { userId: 'userA', marker: 'userA' }) };
    const { merged } = await runLoader(env);
    const ids = merged.map(p => p.id).sort().join();
    ok('executed: cold launch, empty list — the load lists p1 (the device copy), p2 and the offline-created p3, and caches all three',
      ids === 'p1,p2,p3' && merged.find(p => p.id === 'p1')!.schedule!.tasks[0].startDay === 3
        && (merged.find(p => p.id === 'p1') as P & { structuredAddress?: string }).structuredAddress === 'confirmed', ids);
    const hydratedFor: Ref<string | null | undefined> = { current: undefined };
    const shown = runHydration({ data: merged, hydratedFor, userId: 'userA', projectsRef: [], log, since: env.since, pending: env.pending,
      landed: { current: false }, owed: { current: false }, settle: () => undefined });
    ok('executed: ...and Home shows all three after the hydration pass', (shown ?? []).map(p => p.id).sort().join() === 'p1,p2,p3', (shown ?? []).map(p => p.id).join());
    // #90 (wave 3): the GC removed him from gc-job. The server stops returning
    // it; his phone still caches it (owner stamp = the GC) with a queued DFR
    // edit on the project row. It must leave the list AND the cache — while
    // his own offline create p3 (no owner stamp) stays.
    const gcJob = { ...proj('gc-job', 'Henderson'), ownerUserId: 'gc', myRole: 'field' } as P;
    const env90 = { ...env, localForMerge: [...env.localForMerge, gcJob], projectsRef: [gcJob],
      pending: new Set([...env.pending, 'gc-job']) };
    const r90 = await runLoader(env90);
    ok('#90 executed: a removed job with a queued write leaves the loaded list; his own offline create stays',
      !r90.merged.some(p => p.id === 'gc-job') && r90.merged.some(p => p.id === 'p3') && r90.revoked.has('gc-job') && r90.revoked.size === 1,
      r90.merged.map(p => p.id).join());
    const shown90 = runHydration({ data: r90.merged, hydratedFor: { current: 'userA' }, userId: 'userA', projectsRef: [gcJob, ...r90.merged], log,
      since: env.since, pending: env90.pending, landed: { current: false }, owed: { current: false }, settle: () => undefined, revoked: r90.revoked });
    ok('#90 executed: ...and the hydration pass does not put it back from memory (its pending write would have)',
      !(shown90 ?? []).some(p => p.id === 'gc-job'), (shown90 ?? []).map(p => p.id).join());
    const control90 = runHydration({ data: r90.merged, hydratedFor: { current: 'userA' }, userId: 'userA', projectsRef: [gcJob, ...r90.merged], log,
      since: env.since, pending: env90.pending, landed: { current: false }, owed: { current: false }, settle: () => undefined, revoked: new Set() });
    // Review round 1: a ZERO-row read alone never revokes (an anon-key answer
    // looks exactly like it); a second trusted zero-row read must agree.
    const env0 = { ...env90, mapped: [] as P[] };
    const zeroUnconfirmed = await runLoader({ ...env0, confirmEmpty: false });
    ok('#90 executed: a zero-row read NOT confirmed by a second read revokes nothing (the job and its queued write stay)',
      zeroUnconfirmed.revoked.size === 0 && zeroUnconfirmed.merged.some(p => p.id === 'gc-job'), zeroUnconfirmed.merged.map(p => p.id).join());
    const zeroConfirmed = await runLoader({ ...env0, confirmEmpty: true });
    ok('#90 executed: ...confirmed by the second read, the removed job leaves (his offline create p3 stays)',
      zeroConfirmed.revoked.has('gc-job') && !zeroConfirmed.merged.some(p => p.id === 'gc-job') && zeroConfirmed.merged.some(p => p.id === 'p3'),
      zeroConfirmed.merged.map(p => p.id).join());
    ok('#90 control: without the verdict the planner re-adds the pending removed job from memory',
      (control90 ?? []).some(p => p.id === 'gc-job'));
    ok('...which marks the list as this account\'s', hydratedFor.current === 'userA');
    const control = planProjectsLoad<P>([...env.mapped, p3Cache], [], log, env.since, { pending: env.pending });
    ok('control: planned against the empty in-memory list, p1 and p3 vanished', control.projects.map(p => p.id).join() === 'p2', control.projects.map(p => p.id).join());
    // A queued delete: gone from the list AND the cache → stays gone.
    const del = await runLoader({ ...env, localForMerge: [proj('p2', 'two')], pending: new Set(['p1']) });
    ok('executed: a queued delete, absent from both the list and the cache, stays absent', del.merged.every(p => p.id !== 'p1'));
    // Once hydrated, the list is the truth: a project deleted from it stays deleted even if the cache still has it.
    const hydr = await runLoader({ ...env, hydratedFor: 'userA', projectsRef: [proj('p2', 'two')] });
    ok('executed: once the list has hydrated, absence from it is a delete (the cache is not consulted)', hydr.merged.every(p => p.id !== 'p1' && p.id !== 'p3'));
    // A project deleted meanwhile (written after the load began) is not revived from the cache.
    const log2 = newProjectWriteLog();
    const since2 = log2.seq;
    noteProjectWrite(log2, 'p3');
    const revived = await runLoader({ ...env, log: log2, since: since2 });
    ok('executed: before hydration, a project written since the load began and gone from the list is not revived from the cache', revived.merged.every(p => p.id !== 'p3'));
  } catch (e) { ok('the cold-launch replay runs', false, String(e)); }

  // 2 + 3. The owed flag: the settle and the refetch, REAL bodies.
  try {
    const syncDebounceMap = { current: new Map<string, unknown>() };
    const inFlightProjectSyncsRef = { current: new Map<unknown, string>() };
    const owed: Ref<boolean> = { current: false };
    const calls: string[] = [];
    const queryClient = { invalidateQueries: async () => { calls.push('invalidate'); } };
    const settleBody = settleSrc.replace('const settleOwedProjectsReload = useCallback(', '').replace(/, \[queryClient, userId\]\);$/, '');
    const settle = new Function('projectsReloadOwedRef', 'syncDebounceMap', 'inFlightProjectSyncsRef', 'unconfirmedProjectSyncIds', 'ownQueuedProjectIds',
      'liveUserIdRef', 'userId', 'queryClient', tr(`const __s = ${settleBody};`) + '\nreturn __s;')(
      owed, syncDebounceMap, inFlightProjectSyncsRef, unconfirmedProjectSyncIds, async () => new Set<string>(), { current: 'u1' }, 'u1', queryClient,
    ) as () => Promise<void>;
    const refetch = new Function('flushPendingProjectSyncs', 'syncDebounceMap', 'inFlightProjectSyncsRef', 'unconfirmedProjectSyncIds', 'ownQueuedProjectIds',
      'queryClient', 'userId', 'projectsReloadOwedRef',
      tr(`const __g = ${refetchSrc.replace('const refetchProjectsOnForeground = useCallback(', '').replace(/, \[flushPendingProjectSyncs$/, '')};`) + '\nreturn __g;')(
      async () => undefined, syncDebounceMap, inFlightProjectSyncsRef, unconfirmedProjectSyncIds, async () => new Set<string>(), queryClient, 'u1', owed,
    ) as () => Promise<void>;
    // The layout's background flush sent p1's write; he returns while it is on the wire.
    const entry = {};
    inFlightProjectSyncsRef.current.set(entry, 'p1');
    await refetch();
    ok('executed: the foreground refetch skips while a write is on the wire — and owes the re-read', calls.length === 0 && owed.current === true);
    // The write reports: the run's finally releases the mark and calls the settle.
    inFlightProjectSyncsRef.current.delete(entry);
    await settle();
    ok('executed: ...the write reports → exactly one re-read', calls.length === 1 && owed.current === false, calls.join());
    await settle();
    ok('executed: ...and no second one', calls.length === 1);

    // 3. A load kept p1 whole (owed); the re-read lands clean.
    const log = newProjectWriteLog();
    const landed: Ref<boolean> = { current: true };
    owed.current = true;
    const hydratedFor: Ref<string | null | undefined> = { current: 'u1' };
    const settleSpy = () => { void settle(); };
    runHydration({ data: [proj('p1', 'server')], hydratedFor, userId: 'u1', projectsRef: [proj('p1', 'mine')], log, since: log.seq,
      pending: new Set(), landed, owed, settle: settleSpy });
    await Promise.resolve(); await Promise.resolve();
    ok('executed: a clean re-read clears the owed flag — no second full reload', (owed.current as boolean) === false && calls.length === 1 && (landed.current as boolean) === false, `${owed.current} ${calls.join()}`);
    // A load that kept a row whole sets it.
    landed.current = true;
    runHydration({ data: [proj('p1', 'mine')], hydratedFor, userId: 'u1', projectsRef: [proj('p1', 'mine')], log, since: log.seq,
      pending: new Set(['p1']), landed, owed, settle: () => undefined });
    ok('executed: a load that kept a device row whole owes the re-read', owed.current === true);
    // A cache write re-running the hydration is not a load: the flag stays.
    owed.current = false;
    runHydration({ data: [proj('p1', 'mine')], hydratedFor, userId: 'u1', projectsRef: [proj('p1', 'mine')], log, since: log.seq,
      pending: new Set(['p1']), landed, owed, settle: () => undefined });
    ok('executed: a cache write re-running the hydration leaves the flag alone', owed.current === false);
    // Only the newest load started marks that it landed.
    const landLine = 'if (loadSeq === projectsLoadSeqRef.current) projectsLoadLandedRef.current = true;';
    const seqRef = { current: 0 };
    const landedRef = { current: false };
    const loadSeq = ++seqRef.current;
    ++seqRef.current; // a newer fetch started (cancelRefetch): this one is superseded
    new Function('loadSeq', 'projectsLoadSeqRef', 'projectsLoadLandedRef', landLine)(loadSeq, seqRef, landedRef);
    ok('executed: a superseded load does not mark the landing', qf.includes(landLine) && landedRef.current === false);
  } catch (e) { ok('the owed-flag replay runs', false, String(e)); }
}

// Handoff #3: a debounced project edit (not in the queue yet) goes out before
// Sign Out drains the queue — executed, then pinned at both ends.
{
  const { registerPreSignOutFlush, runPreSignOutFlushes } = await import('../utils/preSignOutFlush');
  const order: string[] = [];
  const un = registerPreSignOutFlush(async () => { order.push('project-sync'); });
  const unBad = registerPreSignOutFlush(async () => { throw new Error('boom'); });
  await runPreSignOutFlushes();
  un(); unBad();
  await runPreSignOutFlushes();
  ok('pre-sign-out flushes run, a throwing one does not stop the others, unregister works',
    order.length === 1 && order[0] === 'project-sync', order.join(','));
  const auth = readFileSync(resolve(ROOT, 'contexts/AuthContext.tsx'), 'utf8');
  const fq = auth.slice(auth.indexOf('async function flushQueuesBeforeSignOut'), auth.indexOf('async function flushQueuesBeforeSignOut') + 1400);
  ok('AuthContext runs the pending-sync flushes BEFORE draining the offline queue',
    fq.indexOf('await runPreSignOutFlushes();') > 0 && fq.indexOf('await runPreSignOutFlushes();') < fq.indexOf('await processOfflineQueue();'));
  ok('ProjectContext registers flushPendingProjectSyncs',
    /useEffect\(\(\) => registerPreSignOutFlush\(flushPendingProjectSyncs\), \[flushPendingProjectSyncs\]\);/.test(CTX));
}

// #8, the data-loss half (integration round 1): an edit made offline sits in
// the queue as a whole-row upsert; a new edit after signal returns must not
// land FIRST and then be overwritten when the queue drains. Executed with a
// fake server row and a FIFO queue; the control is the old direct write.
console.log('\n#8 — a new edit waits behind a queued one (it used to overtake it and be replayed over):');
{
  const { orderedProjectWriter } = await import('../utils/projectsLoadGuard');
  type Mut = { table: string; operation: string; data: Record<string, unknown> };
  const replay = async (behindQueueFor: (q: Mut[]) => boolean) => {
    const server = new Map<string, Record<string, unknown>>([['p1', { id: 'p1', name: 'Original', status: 'active' }]]);
    const queue: Mut[] = [{ table: 'projects', operation: 'upsert', data: { id: 'p1', name: 'Offline rename', status: 'active' } }];
    const send = async (table: string, _op: string, data: Record<string, unknown>) => { if (table === 'projects') server.set(data.id as string, data); return true; };
    const enqueue = async (m: Mut) => { queue.push(m); };
    // Signal is back; the drain has not run yet (it waits for foreground / backoff).
    const write = orderedProjectWriter(behindQueueFor(queue), send, enqueue);
    const landedNow = await write('projects', 'upsert', { id: 'p1', name: 'Offline rename', status: 'closed' });
    for (const m of queue.splice(0)) await send(m.table, m.operation, m.data); // the drain, FIFO
    return { status: server.get('p1')?.status, landedNow };
  };
  const pendingFor = (q: Mut[]) => pendingProjectIdsInQueue(q).has('p1');
  const control = await replay(() => false);
  ok('control — sent straight to the server, the new status is replayed over by the queued older row', control.status === 'active', JSON.stringify(control));
  const fixed = await replay(pendingFor);
  ok('executed: behind the queue, the drain lands the old row then the new one — the server keeps "closed"', fixed.status === 'closed' && fixed.landedNow === false, JSON.stringify(fixed));
  const nothingQueued = await (async () => {
    const calls: string[] = [];
    const w = orderedProjectWriter(false, async () => { calls.push('sent'); return true; }, async () => { calls.push('queued'); });
    return { landed: await w('projects', 'update', { id: 'p2' }), calls };
  })();
  ok('...and with nothing queued it is the same direct write as before', nothingQueued.landed === true && nothingQueued.calls.join() === 'sent');
  const run = slice(CTX, 'const run = async () => {', 'entry.run = run;');
  ok('ProjectContext decides it from this session\'s queued project ids, before any project write, except for a new project',
    /if \(!opts\?\.immediate\) \{\s*try \{ behindQueue = \(await ownQueuedProjectIds\(userId\)\)\.has\(project\.id\); \} catch \{ behindQueue = false; \}\s*\}/.test(run)
      && /const supabaseWrite = orderedProjectWriter\(behindQueue, sendProjectWriteNow, addToOfflineQueue\);/.test(run)
      && /const sendProjectWriteNow = supabaseWrite;/.test(CTX));
  const afterWriter = run.slice(run.indexOf('const supabaseWrite = orderedProjectWriter('));
  ok('...and every projects / project_financials write of the sync comes after it (in its scope)',
    (afterWriter.match(/await supabaseWrite\('projects', '(?:delete|update|upsert)'/g) ?? []).length === 3
      && /await supabaseWrite\('project_financials', 'upsert'/.test(afterWriter)
      && !/await supabaseWrite\('project/.test(run.slice(0, run.indexOf('const supabaseWrite = orderedProjectWriter('))));

  // Integration round 2: the ordered writer QUEUES, and nothing used to drain
  // that queue until the next foreground/background change (the backoff is
  // armed only by a drain that left items). OfflineSyncManager's queue
  // listener, executed with stubs.
  const LAYOUT = readFileSync(join(ROOT, 'app/_layout.tsx'), 'utf8');
  const lStart = LAYOUT.indexOf('const unsubscribeQueue = onQueueChanged(');
  const lEnd = lStart < 0 ? -1 : LAYOUT.indexOf('\n    });', lStart);
  const listenerSrc = lStart < 0 || lEnd < 0 ? '' : LAYOUT.slice(lStart, lEnd + '\n    });'.length);
  ok('OfflineSyncManager listens for queue growth (and unsubscribes on cleanup)', listenerSrc.length > 0 && /unsubscribeQueue\(\);/.test(LAYOUT)
    && /draining\.current = true;/.test(LAYOUT) && (LAYOUT.match(/draining\.current = false;/g) ?? []).length >= 2);
  if (listenerSrc) {
    const sim = (state: { cancelled: boolean; draining: boolean; timerArmed: boolean }) => {
      let listener: ((d: number) => void) | null = null;
      const drains: string[] = [];
      const timers: (() => void)[] = [];
      const retryTimer = { current: state.timerArmed ? 1 as unknown : null };
      const draining = { current: state.draining };
      const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(`const __run = () => { ${listenerSrc}\n return unsubscribeQueue; };`);
      new Function('onQueueChanged', 'cancelled', 'draining', 'retryTimer', 'setTimeout', 'drain', 'BASE_DELAY', `${js}\nreturn __run;`)(
        (l: (d: number) => void) => { listener = l; return () => { listener = null; }; },
        state.cancelled, draining, retryTimer,
        (f: () => void) => { timers.push(f); return timers.length; },
        (reset: boolean) => { drains.push(`drain(${reset})`); }, 5000,
      )();
      return { fire: (d: number) => listener?.(d), drains, timers, retryTimer };
    };
    {
      const h = sim({ cancelled: false, draining: false, timerArmed: false });
      h.fire(1);
      ok('...a write queued while online with nothing draining arms one drain', h.timers.length === 1 && h.drains.length === 0);
      h.fire(2);
      ok('...a second write before it fires does not stack another', h.timers.length === 1);
      h.timers[0]();
      ok('...and it fires as a normal (non-reset) drain, clearing its own timer', h.drains.join() === 'drain(false)' && h.retryTimer.current === null);
    }
    {
      const busy = sim({ cancelled: false, draining: true, timerArmed: false }); busy.fire(3);
      const armed = sim({ cancelled: false, draining: false, timerArmed: true }); armed.fire(3);
      const empty = sim({ cancelled: false, draining: false, timerArmed: false }); empty.fire(0);
      ok('...not while a drain runs (its own write-back cannot loop), nor over an armed backoff, nor for an emptied queue',
        busy.timers.length === 0 && armed.timers.length === 0 && empty.timers.length === 0);
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
