// validate-w4-context-money-portal-publish.ts — wave 4, lane context-money-portal.
//
// The portal half of the lane, run from the shipped source against stubs:
//
//   #12/#65 requestPortalPublish(projectId) — a republish for what the pass
//        reads only at publish time (the contract): drops the job's stored
//        signature (an unchanged one settled the mark without publishing),
//        marks it, schedules a pass.
//   #15  AIA pay applications: a tracked save, handed to the lite writer (so
//        the section is built fresh — a sent pay app appears, a recalled one
//        leaves), in the signature, and gated on the list's server read.
//   #17  a shared daily report / photo ANOTHER member of the job filed marks
//        the owner's portal job when server reads bring it in.
//   #21  a publish pass running when the phone comes back to the foreground
//        stops and settles nothing (before a job, after its publish, and
//        before the '*' mark is cleared) — and a pass folded in meanwhile is
//        still honoured with the fresh lists (review round 1: a `return`
//        dropped it).
//   #12  (review round 1) a requestPortalPublish made WHILE that job's
//        publish is out is not lost: the pass keeps no signature for a job
//        whose mark moved during its publish, so the next pass republishes.
//   #28  batchSendToClientPortal holds RFIs / submittals whose INSERT is queued.
//
// Run via: bun run scripts/validate-w4-context-money-portal-publish.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  portalLiteSignature, portalLiteOutcomeSettles, portalArrivalProjectIds, portalContentFingerprint,
  portalSideListFresh, notePortalListRead, beginPortalReadEpoch, EMPTY_PORTAL_SERVER_READS, portalSendHeldForNumber,
  PORTAL_FED_LISTS,
} from '../utils/projectContextPure';
import { extractCallback, runCallback } from './validate-context-money-portal-writes';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CTX = readFileSync(join(ROOT, 'contexts/ProjectContext.tsx'), 'utf8');

let passes = 0;
let failures = 0;
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { passes++; console.log('  ✓', label); }
  else { failures++; console.error('  ✗', label, detail ? `\n      ${detail}` : ''); }
}

type Row = Record<string, unknown>;

/** The effect body that keeps the pass's inputs current (a useEffect, not a useCallback). */
function readinessEffect(): string {
  const i = CTX.indexOf('if (!portalSyncReady || !portalAiaFresh) return;');
  const j = CTX.indexOf('schedulePortalPass();', i);
  return i >= 0 && j > i ? CTX.slice(i, j) : '';
}

async function main() {
  // ── #12/#65 · requestPortalPublish, EXECUTED ───────────────────────────────
  console.log('\n#12 #65 requestPortalPublish republishes past an unchanged signature (executed)');
  {
    const run = (hasLists: boolean) => {
      const sig = new Map([['p1', 'SIG'], ['p2', 'SIG2']]);
      const marks: string[] = [];
      let scheduled = 0;
      const fn = runCallback<(id: string) => void>(CTX, 'requestPortalPublish', {
        portalSyncSigRef: { current: sig },
        portalSyncLatestRef: { current: hasLists ? { userId: 'u1' } : null },
        markPortalDirty: (ids: Iterable<string>) => { marks.push(...ids); },
        schedulePortalPass: () => { scheduled++; },
      });
      fn('p1');
      return { sig, marks, scheduled };
    };
    const a = run(true);
    ok('drops THAT job\'s stored signature (only that one)', !a.sig.has('p1') && a.sig.get('p2') === 'SIG2');
    ok('marks the job and schedules a pass', a.marks.join() === 'p1' && a.scheduled === 1);
    const b = run(false);
    ok('no lists yet → the mark waits for the first pass (nothing scheduled from nothing)', b.marks.join() === 'p1' && b.scheduled === 0);
    const stable = CTX.slice(CTX.indexOf('const stableActions = useMemo<StableActionsValue>(() => ({'), CTX.indexOf('// Non-destructive import (app/data-import.tsx)'));
    ok('exposed on the stable actions (the real one, in the deps)',
      /\n\s*requestPortalPublish,\n/.test(stable) && /absorbServerSchedule, requestPortalPublish, refetchInvoicesNow,/.test(stable));
    ok('schedulePortalPass is refs-only (stable): its only dep is the stable pass',
      /\}, \[publishOwnedPortals\]\);/.test(CTX.slice(CTX.indexOf('const schedulePortalPass = useCallback('), CTX.indexOf('const schedulePortalPass = useCallback(') + 1200)));
  }

  // ── publishOwnedPortals, EXECUTED: #15 AIA, #21 epoch ──────────────────────
  console.log('\n#15 #21 the publish pass (executed)');
  {
    const projects = [
      { id: 'A', ownerUserId: 'u1', clientPortal: { enabled: true, showInvoices: true } },
      { id: 'B', ownerUserId: 'u1', clientPortal: { enabled: true, showInvoices: true } },
    ];
    const make = (o: { aia?: Row[]; epoch?: number } = {}) => ({
      userId: 'u1', settings: {}, settingsLoaded: true, projects,
      invoices: [], changeOrders: [], dailyReports: [], punchItems: [], photos: [], rfis: [], warranties: [], permits: [],
      aiaPayApps: o.aia ?? [], epoch: o.epoch ?? 3,
    });
    const harness = (o: { epochRef?: number; aiaFresh?: boolean; onSync?: (id: string) => void | Promise<void> } = {}) => {
      const calls: { id: string; aia: unknown }[] = [];
      const againRef = { current: false };
      const runningRef = { current: false };
      const latest = { current: make() as Row };
      const portalDirtyRef = { current: new Map<string, number>([['*', 1]]) };
      const sigRef = { current: new Map<string, string>() };
      const epochRef = { current: o.epochRef ?? 3 };
      const aiaFreshRef = { current: o.aiaFresh ?? true };
      const fn = runCallback<() => Promise<void>>(CTX, 'publishOwnedPortals', {
        portalSyncLatestRef: latest, portalSyncSigRef: sigRef,
        portalSyncRunningRef: runningRef, portalSyncAgainRef: againRef,
        liveUserIdRef: { current: 'u1' }, portalDirtyRef, portalListsServerRef: { current: true },
        portalReadEpochRef: epochRef, portalAiaFreshRef: aiaFreshRef,
        isPortalOwner: (p: { ownerUserId?: string }, uid: string) => p.ownerUserId === uid,
        portalLiteSignature, portalLiteOutcomeSettles,
        syncPortalSnapshotLite: async (id: string, input: { aiaPayApps?: unknown }) => {
          calls.push({ id, aia: input.aiaPayApps });
          await o.onSync?.(id);
          return 'published';
        },
      });
      return { fn, calls, latest, portalDirtyRef, sigRef, epochRef, aiaFreshRef, againRef, runningRef };
    };

    // #15
    const h = harness();
    const aia = [{ id: 'pa3', projectId: 'A', portalState: { status: 'draft' } }];
    h.latest.current = make({ aia });
    await h.fn();
    ok('#15 the AIA list is handed to the lite writer (so the section is built fresh, not carried)',
      h.calls.length === 2 && h.calls[0].aia === aia, JSON.stringify(h.calls.map(c => c.id)));
    // Send pay app #3: only its portal state moves; the job is marked.
    h.latest.current = make({ aia: [{ id: 'pa3', projectId: 'A', portalState: { status: 'sent' } }] });
    h.portalDirtyRef.current.set('A', 9);
    await h.fn();
    ok('#15 a pay app\'s portal state moving is a CHANGE (in the signature) → job A republished',
      h.calls.length === 3 && h.calls[2].id === 'A' && !h.portalDirtyRef.current.has('A'));
    const stale = harness({ aiaFresh: false });
    await stale.fn();
    ok('#15 the AIA list not read from the server this epoch → publish nothing, settle nothing',
      stale.calls.length === 0 && stale.portalDirtyRef.current.has('*'));

    // #21 (a): the phone came back since the lists were read.
    const moved = harness({ epochRef: 4 });
    await moved.fn();
    ok('#21 the epoch moved before the pass → publish nothing, the marks stay', moved.calls.length === 0 && moved.portalDirtyRef.current.get('*') === 1);
    // #21 (b): the foreground lands while job A's publish is out.
    let mid!: ReturnType<typeof harness>;
    mid = harness({ onSync: () => { mid.epochRef.current = 4; } });
    mid.sigRef.current.set('A', 'OLD-SIG');
    await mid.fn();
    ok('#21 a foreground during a job\'s publish: that job is NOT settled and its signature is dropped',
      mid.calls.map(c => c.id).join() === 'A' && !mid.sigRef.current.has('A'), JSON.stringify([...mid.sigRef.current]));
    ok('#21 …the next job is not published from the pre-lock lists, and the post-load mark is kept',
      !mid.calls.some(c => c.id === 'B') && mid.portalDirtyRef.current.get('*') === 1);
    // #21: a job whose signature is unchanged is not settled from an older
    // epoch's lists either (the pass stops before it looks).
    const again = harness();
    await again.fn();
    again.portalDirtyRef.current.set('A', 5);
    again.epochRef.current = 4;
    await again.fn();
    ok('#21 the epoch moved: even an unchanged-signature job keeps its mark (nothing settles from old lists)',
      again.portalDirtyRef.current.get('A') === 5 && again.calls.length === 2);
    // Same epoch: everything settles as before.
    const calm = harness();
    await calm.fn();
    ok('same epoch → both owned jobs published and the post-load mark answered', calm.calls.length === 2 && calm.portalDirtyRef.current.size === 0);
    // #21 (review round 1): a pass FOLDED IN while the stale pass awaits is
    // honoured with the fresh lists, not dropped with the stale pass.
    {
      let release!: () => void;
      const gate = new Promise<void>(r => { release = r; });
      let first = true;
      const fold = harness({ onSync: () => { if (first) { first = false; return gate; } } });
      const freshAia = [{ id: 'fresh', projectId: 'A' }];
      const running = fold.fn();
      await Promise.resolve();
      // The phone came back; the fresh lists answered and their pass fires
      // while the old one is still awaiting job A's publish.
      fold.epochRef.current = 4;
      fold.latest.current = make({ aia: freshAia, epoch: 4 });
      await fold.fn(); // folded: returns at once
      release();
      await running;
      ok('#21 a pass folded in during the stale publish runs with the FRESH lists (never dropped)',
        fold.calls.length === 3 && fold.calls[1].aia === freshAia && fold.calls[2].aia === freshAia,
        JSON.stringify(fold.calls.map(c => [c.id, (c.aia as Row[])[0]?.id ?? null])));
      ok('#21 …and the post-load mark is answered by it, nothing left running',
        fold.portalDirtyRef.current.size === 0 && !fold.runningRef.current && !fold.againRef.current, JSON.stringify([...fold.portalDirtyRef.current]));
    }
    // #12 (review round 1): Sign & send's requestPortalPublish lands while
    // job A's publish (built with the draft contract) is still out.
    {
      let contract = 'draft';
      const published: string[] = [];
      let seq = 10;
      let req!: (id: string) => void;
      let first = false; // armed only for the pass under test
      const mid12 = harness({
        onSync: (id) => {
          published.push(`${id}:contract=${contract}`);
          if (id === 'A' && first) { first = false; contract = 'sent'; req('A'); }
        },
      });
      await mid12.fn(); // the post-load pass: A and B published, signatures stored
      published.length = 0; mid12.calls.length = 0; first = true; contract = 'draft';
      mid12.portalDirtyRef.current.set('A', 2);
      mid12.sigRef.current.delete('A');
      req = runCallback<(id: string) => void>(CTX, 'requestPortalPublish', {
        portalSyncSigRef: mid12.sigRef,
        portalSyncLatestRef: mid12.latest,
        markPortalDirty: (ids: Iterable<string>) => { for (const id of ids) mid12.portalDirtyRef.current.set(id, ++seq); },
        schedulePortalPass: () => {}, // the debounced pass is run by hand below
      });
      await mid12.fn(); // publishes A with the draft contract; the request lands mid-publish
      await mid12.fn(); // the pass the request scheduled
      ok('#12 a request made mid-publish of the same job → the next pass publishes it AGAIN (with the sent contract)',
        published.join() === 'A:contract=draft,A:contract=sent', published.join());
      ok('#12 …and only then is the request\'s mark settled', !mid12.portalDirtyRef.current.has('A'));
      ok('#12 the signature is recorded only when the job\'s mark did not move during its publish',
        /if \(portalDirtyRef\.current\.get\(project\.id\) === marks\.get\(project\.id\)\) portalSyncSigRef\.current\.set\(project\.id, sig\);\s*else portalSyncSigRef\.current\.delete\(project\.id\);/.test(CTX));
    }
    ok('#21 a stop leaves ONE iteration (runPass), and the loop re-tests the fold flag after every iteration',
      /const runPass = async \(\): Promise<void> => \{/.test(extractCallback(CTX, 'publishOwnedPortals'))
        && /do \{\s*portalSyncAgainRef\.current = false;\s*await runPass\(\);\s*\} while \(portalSyncAgainRef\.current\);/.test(extractCallback(CTX, 'publishOwnedPortals')));
    ok('#21 the epoch the lists were read in is stored with them', /aiaPayApps, epoch: portalServerReads\.epoch,/.test(readinessEffect()));
  }

  // ── #15 · the AIA list is a tracked, gated list ────────────────────────────
  console.log('\n#15 the AIA list marks, is read-stamped, and gates');
  {
    ok('saveAiaPayAppsMutation is a tracked (marking) save',
      /const saveAiaPayAppsMutation = usePortalTrackedSave<SavedAIAPayApp\[\]>\(saveAiaPayAppsMutationRaw, useCallback\(\(next: SavedAIAPayApp\[\]\) => \{\s*markPortalDirty\(portalDirtyProjectIds\(queryClient\.getQueryData<SavedAIAPayApp\[\]>\(\['aiaPayApps', userId\]\), next\)\);/.test(CTX));
    ok('…and nothing saves the AIA list through the raw mutation', !/saveAiaPayAppsMutationRaw\.mutate\(/.test(CTX));
    const loader = CTX.slice(CTX.indexOf('const aiaPayAppsQuery = useQuery({'), CTX.indexOf('const saveAiaPayAppsMutationRaw'));
    ok('the AIA loader stamps its server read with the epoch it STARTED in, and clears it on the cache fallback',
      /const readEpoch = portalReadEpochRef\.current;/.test(loader)
        && /notePortalRead\('aiaPayApps', userId, true, readEpoch\);/.test(loader)
        && /notePortalRead\('aiaPayApps', userId, false, readEpoch\);/.test(loader));
    let r = notePortalListRead(EMPTY_PORTAL_SERVER_READS, 'aiaPayApps', 'u1', true, 0);
    ok('portalSideListFresh: read this epoch → fresh', portalSideListFresh(r, 'aiaPayApps', 'u1'));
    r = beginPortalReadEpoch(r, 1);
    ok('…a return to the foreground makes it stale until re-read', !portalSideListFresh(r, 'aiaPayApps', 'u1'));
    ok('…another account\'s stamp never counts', !portalSideListFresh(notePortalListRead(r, 'aiaPayApps', 'u2', true, 1), 'aiaPayApps', 'u1'));
    ok('the nine-list gate every other publisher reads is unchanged', PORTAL_FED_LISTS.length === 9 && !(PORTAL_FED_LISTS as readonly string[]).includes('aiaPayApps'));
    ok('the pass waits for the AIA read (readiness effect and pass both check it)',
      readinessEffect().length > 0 && /if \(!portalAiaFreshRef\.current\) return;/.test(extractCallback(CTX, 'publishOwnedPortals')));
  }

  // ── #17 · another member's shared record marks the owner's job ─────────────
  console.log('\n#17 a foreman\'s shared report or photo reaches the homeowner');
  {
    const owned = new Set(['A']);
    const opts = { viewerId: 'gc', ownedPortalProjectIds: owned, authorOf: (r: Row) => r.author as string | undefined, fingerprint: portalContentFingerprint };
    const dfr = (id: string, author: string | undefined, status: string | undefined, pid = 'A', extra: Row = {}) =>
      ({ id, projectId: pid, author, portalState: status ? { status } : undefined, workPerformed: 'framing', ...extra });
    const prev = [dfr('d0', 'gc', 'sent')];
    ok('an editor-seat foreman\'s SHARED report arrives → his GC\'s owned portal job is marked',
      [...portalArrivalProjectIds(prev, [...prev, dfr('d1', 'foreman', 'sent')], opts)].join() === 'A');
    ok('the GC\'s own report never marks here (his tracked save did)', portalArrivalProjectIds(prev, [...prev, dfr('d2', 'gc', 'sent')], opts).size === 0);
    ok('#59 interim: a field / viewer seat\'s report arrives as DRAFT → nothing until the GC sends it',
      portalArrivalProjectIds(prev, [...prev, dfr('d3', 'foreman', 'draft')], opts).size === 0);
    ok('a job he does not own, or with the portal off → nothing',
      portalArrivalProjectIds(prev, [...prev, dfr('d4', 'foreman', 'sent', 'Z')], opts).size === 0);
    ok('no author on record → nothing (never a guess)', portalArrivalProjectIds(prev, [...prev, dfr('d5', undefined, 'sent')], opts).size === 0);
    const withPhoto = (uri: string) => dfr('d1', 'foreman', 'sent', 'A', { photos: [{ id: 'ph1', uri, storagePath: 'x/A/ph1.jpg' }] });
    ok('a re-signed photo URL alone is NOT a change', portalArrivalProjectIds([withPhoto('https://a?t=1')], [withPhoto('https://a?t=2')], opts).size === 0);
    ok('an edit to his shared report IS', [...portalArrivalProjectIds([dfr('d1', 'foreman', 'sent')], [dfr('d1', 'foreman', 'sent', 'A', { workPerformed: 'framing + sheathing' })], opts)].join() === 'A');
    ok('his shared report gone (or no longer shared) → marked, so the portal drops it',
      [...portalArrivalProjectIds([dfr('d1', 'foreman', 'sent')], [], opts)].join() === 'A'
        && [...portalArrivalProjectIds([dfr('d1', 'foreman', 'sent')], [dfr('d1', 'foreman', 'recalled')], opts)].join() === 'A');
    ok('an unchanged list marks nothing', portalArrivalProjectIds([dfr('d1', 'foreman', 'sent')], [dfr('d1', 'foreman', 'sent')], opts).size === 0);
    const eff = readinessEffect();
    ok('the readiness effect diffs BOTH lists against what the last pass saw, with their authors, owned portal jobs only',
      /markPortalDirty\(portalArrivalProjectIds\(prevInp\.dailyReports, dailyReports, \{[\s\S]*?authorOf: r => r\.filedByUserId/.test(eff)
        && /markPortalDirty\(portalArrivalProjectIds\(prevInp\.photos, projectPhotos, \{[\s\S]*?authorOf: r => r\.userId/.test(eff)
        && /p\.clientPortal\?\.enabled && isPortalOwner\(p, userId\)/.test(eff)
        && /prevInp\.userId === userId/.test(eff));
    ok('…only once every list is the server\'s (the effect returns first otherwise)', eff.startsWith('if (!portalSyncReady || !portalAiaFresh) return;'));
    const drLoader = CTX.slice(CTX.indexOf("const dailyReportsQuery = useQuery({"), CTX.indexOf('const fieldTicketsQuery = useQuery({'));
    const phLoader = CTX.slice(CTX.indexOf("const photosQuery = useQuery({"), CTX.indexOf('const priceAlertsQuery = useQuery({'));
    ok('the loaders read the author back (daily_reports.user_id, photos.user_id)',
      /filedByUserId: \(r\.user_id as string \| null\) \?\? undefined,/.test(drLoader) && /userId: \(r\.user_id as string \| null\) \?\? undefined,/.test(phLoader));
    ok('no comment still claims a refetch never marks', !/never a refetch|refetch alone never|A refetch is never/.test(CTX));
  }

  // ── #28 · the batch send holds an unnumbered RFI / submittal, EXECUTED ─────
  console.log('\n#28 Send all holds an RFI / submittal the server has not numbered (executed)');
  {
    const run = async (queue: Row[] | 'unreadable') => {
      const messages: string[] = [];
      const writes: string[] = [];
      const applied: string[] = [];
      const items: Record<string, Row> = {
        r1: { id: 'r1', number: 7 }, r2: { id: 'r2', number: 6 }, s1: { id: 's1', number: 3 }, c1: { id: 'c1', number: 2 },
      };
      const fn = runCallback<(a: { items: { kind: string; itemId: string }[]; projectId: string }) => Promise<{ sent: number; held: number }>>(
        CTX, 'batchSendToClientPortal', {
          canSync: true, userId: 'u1',
          projects: [{ id: 'p1', ownerUserId: 'u1', clientPortal: { portalId: 'port1' } }],
          portalWriteRefusalFor: async () => null,
          getOfflineQueue: async () => { if (queue === 'unreadable') throw new Error('corrupt'); return queue; },
          portalSendHeldForNumber,
          findItemByKindAndId: (_k: string, id: string) => items[id],
          sharedDraftIssuePatch: () => null,
          captureSnapshot: (_k: string, it: Row) => ({ ...it }),
          updateInvoice: () => {},
          updateBehindQueuedInsert: (_t: string, p: { id: string }) => { writes.push(p.id); return Promise.resolve(true); },
          applyPortalStates: (u: { itemId: string }[]) => { applied.push(...u.map(x => x.itemId)); },
          portalMessageAllowed: () => true,
          writePortalMessage: async (row: { body: string }) => { messages.push(row.body); return 'synced'; },
          itemTypeLabel: { rfi: 'RFI', submittal: 'Submittal', change_order: 'Change Order' },
          tableForKind: { rfi: 'rfis', submittal: 'submittals', change_order: 'change_orders' },
          queryClient: { invalidateQueries: async () => {} },
        });
      const res = await fn({ projectId: 'p1', items: [
        { kind: 'rfi', itemId: 'r1' }, { kind: 'rfi', itemId: 'r2' }, { kind: 'submittal', itemId: 's1' }, { kind: 'change_order', itemId: 'c1' },
      ] });
      return { res, messages, writes, applied };
    };
    const a = await run([{ table: 'rfis', operation: 'insert', data: { id: 'r1' } }, { table: 'rfis', operation: 'update', data: { id: 'r2' } }]);
    ok('an RFI whose INSERT is queued is HELD — not frozen, not written, not counted as sent',
      !a.applied.includes('r1') && !a.writes.includes('r1') && a.res.held === 1 && a.res.sent === 3, JSON.stringify(a.res));
    ok('…an RFI with only a queued EDIT is numbered already and goes out', a.applied.includes('r2'));
    ok('…and the homeowner\'s summary counts only what was sent', a.messages.length === 1 && a.messages[0].startsWith('3 new updates'), a.messages.join());
    const b = await run('unreadable');
    ok('a queue that cannot be read holds every RFI / submittal (holding is never wrong), the rest go',
      b.res.held === 3 && b.res.sent === 1 && b.applied.join() === 'c1', JSON.stringify(b.res));
    ok('portalSendHeldForNumber: only a queued INSERT of an RFI / submittal holds',
      portalSendHeldForNumber('submittal', 's1', [{ table: 'submittals', operation: 'insert', data: { id: 's1' } }])
        && !portalSendHeldForNumber('change_order', 'c1', [{ table: 'change_orders', operation: 'insert', data: { id: 'c1' } }])
        && !portalSendHeldForNumber('rfi', 'r1', [{ table: 'rfis', operation: 'insert', data: { id: 'other' } }]));
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
