// validate-context-money-portal-access.ts — wave 3, lane context-money-portal.
//
// The ProjectContext decisions about WHO may act and WHEN the app re-reads or
// re-publishes, run from the shipped source against stubs:
//
//   #92  deleteProject refuses a project he does not own, before the local
//        cascade (RLS matches 0 rows for a collaborator; the queue calls that
//        done while his phone had already dropped every child record).
//   #116 FOUNDER interim — only the owner or an accepted editor sends to /
//        recalls from the client portal; a field or viewer seat is refused
//        with the reason, and no portal_messages insert is ever queued.
//        An accepted editor may send, but the portal_messages notice (RLS:
//        owner only) is written only by the owner — no write that can never land.
//   #23  the homeowner portal is re-published from the provider for every
//        OWNED portal-enabled project THIS DEVICE CHANGED (never because a
//        refetch moved a list — the other lists may be the stale ones), plus
//        once after load — debounced, never dropped, retried until an outcome
//        settles it, and not before every list has loaded.
//   #48  the invoices / pay apps are re-read when the app returns to the
//        foreground (a client's Stripe payment), never over a write still out.
//   #121 the settings are re-read on foreground too (guarded like the owed
//        re-read); the terms question re-reads a stale profile before it is
//        answered, "first time" counts the fresh copy, and "…now all say X"
//        is only chosen when every owned portal stamp is X.
//
// Run via: bun run scripts/validate-context-money-portal-access.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deleteProjectRefusal, DELETE_NOT_OWNER_REASON, portalWriteRefusal, PORTAL_OWNER_DECIDES_REASON, PORTAL_ACCESS_UNKNOWN_REASON,
  portalLiteSignature, portalLiteOutcomeSettles, portalsDisagreeingWithSplit,
  portalDirtyProjectIds, portalDirtyProjects, portalMessageAllowed,
} from '../utils/projectContextPure';
import { termsWritesPending } from '../utils/paymentTerms';
import { owedSettingsRereadReady, settingsRowWritePending } from '../utils/settingsLoadGuard';
import { extractCallback, runCallback } from './validate-context-money-portal-writes';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const CTX = read('contexts/ProjectContext.tsx');
const GATE = read('hooks/useClientDocumentGate.ts');

let passes = 0;
let failures = 0;
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { passes++; console.log('  ✓', label); }
  else { failures++; console.error('  ✗', label, detail ? `\n      ${detail}` : ''); }
}

type Row = Record<string, unknown>;

async function main() {
  // ── #92 ────────────────────────────────────────────────────────────────────
  console.log('\n#92 only the owner deletes a project');
  {
    ok('owner → allowed', deleteProjectRefusal({ ownerUserId: 'u1', myRole: 'owner' }, 'u1') === null);
    ok('editor (another owner\'s job) → refused with the reason', deleteProjectRefusal({ ownerUserId: 'gc', myRole: 'editor' }, 'u1') === DELETE_NOT_OWNER_REASON);
    ok('field → refused', deleteProjectRefusal({ ownerUserId: 'gc', myRole: 'field' }, 'u1') === DELETE_NOT_OWNER_REASON);
    ok('a pre-field cache with no role is his own (A-1) → allowed', deleteProjectRefusal({}, 'u1') === null);
    ok('a pre-field cache carrying a collaborator role → refused', deleteProjectRefusal({ myRole: 'viewer' }, 'u1') === DELETE_NOT_OWNER_REASON);
    ok('signed out (local-only) → allowed', deleteProjectRefusal({ ownerUserId: 'u1' }, null) === null);

    const calls: string[] = [];
    const del = runCallback<(id: string) => { ok: boolean; reason?: string }>(CTX, 'deleteProject', {
      projects: [{ id: 'p1', ownerUserId: 'gc', myRole: 'field' }], userId: 'u1', deleteProjectRefusal,
      setProjects: () => { calls.push('setProjects'); }, saveProjectsMutation: { mutate: () => { calls.push('save'); } },
      syncProjectToSupabase: () => { calls.push('sync'); },
    }, calls);
    const res = del('p1');
    ok('deleteProject on a shared job returns the refusal and touches NOTHING (no local cascade, no server delete)',
      res.ok === false && res.reason === DELETE_NOT_OWNER_REASON && calls.length === 0, calls.join());
  }

  // ── #116 ───────────────────────────────────────────────────────────────────
  console.log('\n#116 the owner decides what the homeowner sees');
  {
    const accepted = (role: string, status = 'accepted') => [{ userId: 'u1', role, status }] as never;
    ok('owner → allowed with no read', portalWriteRefusal({ project: { ownerUserId: 'u1' }, userId: 'u1', collaborators: null }) === null);
    ok('accepted editor → allowed', portalWriteRefusal({ project: { ownerUserId: 'gc', myRole: 'editor' }, userId: 'u1', collaborators: accepted('editor') }) === null);
    ok('field seat → refused with the reason', portalWriteRefusal({ project: { ownerUserId: 'gc', myRole: 'field' }, userId: 'u1', collaborators: accepted('field') }) === PORTAL_OWNER_DECIDES_REASON);
    ok('viewer → refused', portalWriteRefusal({ project: { ownerUserId: 'gc' }, userId: 'u1', collaborators: accepted('viewer') }) === PORTAL_OWNER_DECIDES_REASON);
    ok('an editor row still PENDING → refused', portalWriteRefusal({ project: { ownerUserId: 'gc' }, userId: 'u1', collaborators: accepted('editor', 'pending') }) === PORTAL_OWNER_DECIDES_REASON);
    ok('a cached "editor" role the fresh rows no longer back → refused', portalWriteRefusal({ project: { ownerUserId: 'gc', myRole: 'editor' }, userId: 'u1', collaborators: accepted('field') }) === PORTAL_OWNER_DECIDES_REASON);
    ok('the rows could not be read → refused, saying so (never guessed)', portalWriteRefusal({ project: { ownerUserId: 'gc' }, userId: 'u1', collaborators: 'error' }) === PORTAL_ACCESS_UNKNOWN_REASON);

    // The shipped check, with the react-query cache stubbed.
    const fetched: unknown[] = [];
    const make = (rows: unknown, project: Row) => runCallback<(pid: string) => Promise<string | null>>(CTX, 'portalWriteRefusalFor', {
      canSync: true, userId: 'u1', portalWriteRefusal, projectsRef: { current: [{ id: 'p1', ...project }] },
      queryClient: { fetchQuery: async (o: { queryKey: unknown[]; staleTime: number }) => { fetched.push(o.queryKey); if (rows === 'throw') throw new Error('offline'); return rows; } },
    });
    ok('owner: allowed without a network read', (await make([], { ownerUserId: 'u1' })('p1')) === null && fetched.length === 0);
    ok('field seat: refused, read through the collaborators cache entry',
      (await make(accepted('field'), { ownerUserId: 'gc', myRole: 'field' })('p1')) === PORTAL_OWNER_DECIDES_REASON
        && JSON.stringify(fetched[0]) === JSON.stringify(['project_collaborators', 'p1']));
    ok('editor: allowed', (await make(accepted('editor'), { ownerUserId: 'gc', myRole: 'editor' })('p1')) === null);
    ok('read failed: refused with the reason', (await make('throw', { ownerUserId: 'gc', myRole: 'editor' })('p1')) === PORTAL_ACCESS_UNKNOWN_REASON);

    // sendToClientPortal / recall for a refused seat: throws the reason, writes nothing.
    for (const name of ['sendToClientPortal', 'recallFromClientPortal', 'batchSendToClientPortal']) {
      const writes: string[] = [];
      const fn = runCallback<(a: Row) => Promise<unknown>>(CTX, name, {
        portalWriteRefusalFor: async () => PORTAL_OWNER_DECIDES_REASON,
        findItemByKindAndId: () => ({ id: 'd1' }), canSync: true, userId: 'u1', projects: [{ id: 'p1', clientPortal: { portalId: 'x' } }],
        writePortalMessage: async () => { writes.push('portal_messages'); },
        updateBehindQueuedInsert: async () => { writes.push('portal_state'); },
        updateItemPortalState: () => { writes.push('local'); }, applyPortalStates: () => { writes.push('local'); },
      });
      let err = '';
      try { await fn({ kind: 'daily_report', itemId: 'd1', projectId: 'p1', items: [{ kind: 'daily_report', itemId: 'd1' }] }); } catch (e) { err = (e as Error).message; }
      ok(`${name}: a field seat is refused with the reason and nothing is written or queued`, err === PORTAL_OWNER_DECIDES_REASON && writes.length === 0, `${err} | ${writes.join()}`);
    }

    // An ACCEPTED editor may send / recall — but the notice row is the owner's
    // (RLS 'gc inserts own portal messages'), so none is queued for him.
    ok('portalMessageAllowed: owner yes; editor, field, signed-out no; a pre-field cache with no role is his (A-1)',
      portalMessageAllowed({ ownerUserId: 'u1' }, 'u1') && !portalMessageAllowed({ ownerUserId: 'gc', myRole: 'editor' }, 'u1')
        && !portalMessageAllowed({ ownerUserId: 'gc', myRole: 'field' }, 'u1') && !portalMessageAllowed({ ownerUserId: 'u1' }, null)
        && portalMessageAllowed({}, 'u1') && !portalMessageAllowed({ myRole: 'editor' }, 'u1'));
    for (const [who, project] of [['editor', { ownerUserId: 'gc', myRole: 'editor' }], ['owner', { ownerUserId: 'u1' }]] as const) {
      for (const name of ['sendToClientPortal', 'recallFromClientPortal', 'batchSendToClientPortal']) {
        const writes: string[] = [];
        const fn = runCallback<(a: Row) => Promise<unknown>>(CTX, name, {
          portalWriteRefusalFor: async () => null, portalMessageAllowed,
          findItemByKindAndId: () => ({ id: 'd1' }), captureSnapshot: () => '{}', canSync: true, userId: 'u1',
          projects: [{ id: 'p1', ...project, clientPortal: { portalId: 'x' } }],
          writePortalMessage: async () => { writes.push('portal_messages'); },
          updateBehindQueuedInsert: async () => { writes.push('portal_state'); },
          updateItemPortalState: () => {}, applyPortalStates: () => {}, updateInvoice: () => {},
          itemTypeLabel: { daily_report: 'daily report' }, tableForKind: { daily_report: 'daily_reports' },
        });
        await fn({ kind: 'daily_report', itemId: 'd1', projectId: 'p1', items: [{ kind: 'daily_report', itemId: 'd1' }] });
        const wrote = writes.includes('portal_messages');
        ok(`${name}: ${who} → portal_state written${who === 'owner' ? ' and the notice' : ', NO notice queued (RLS would refuse it forever)'}`,
          writes.includes('portal_state') && wrote === (who === 'owner'), writes.join());
      }
    }
  }

  // ── #23 ────────────────────────────────────────────────────────────────────
  console.log('\n#23 the provider re-publishes the owned portals THIS device changed');
  {
    const calls: { id: string; dfrs: number }[] = [];
    let outcome = 'published';
    let gate: Promise<void> | null = null;
    const latest: { current: Row | null } = { current: null };
    const base = (dfrs: Row[], invoices: Row[] = []) => ({
      userId: 'u1', settings: { branding: { companyName: 'Acme' } }, settingsLoaded: true,
      projects: [
        { id: 'A', ownerUserId: 'u1', clientPortal: { enabled: true } },
        { id: 'B', ownerUserId: 'u1', clientPortal: { enabled: false } },
        { id: 'C', ownerUserId: 'gc', myRole: 'field', clientPortal: { enabled: true } },
      ],
      invoices, changeOrders: [], dailyReports: dfrs, punchItems: [], photos: [], rfis: [], warranties: [], permits: [],
    });
    const portalDirtyRef = { current: new Map<string, number>([['*', 1]]) };
    const portalListsServerRef = { current: true };
    let seq = 1;
    const mark = (...ids: string[]) => { for (const id of ids) portalDirtyRef.current.set(id, ++seq); };
    const scope = {
      portalSyncLatestRef: latest, portalSyncSigRef: { current: new Map<string, string>() },
      portalSyncRunningRef: { current: false }, portalSyncAgainRef: { current: false },
      liveUserIdRef: { current: 'u1' }, portalDirtyRef,
      // data-session critic: every portal-fed list's last load was the server's.
      portalListsServerRef,
      isPortalOwner: (p: { ownerUserId?: string; myRole?: string }, uid: string) => (p.ownerUserId ? p.ownerUserId === uid : !p.myRole),
      portalLiteSignature, portalLiteOutcomeSettles,
      syncPortalSnapshotLite: async (id: string, input: { dailyReports: unknown[] }) => {
        calls.push({ id, dfrs: input.dailyReports.length });
        if (gate) await gate;
        return outcome;
      },
    };
    const publish = runCallback<() => Promise<void>>(CTX, 'publishOwnedPortals', scope);
    // data-session critic: a list whose read failed fell back to the device
    // cache — the post-load pass publishes NOTHING and keeps its mark.
    portalListsServerRef.current = false;
    latest.current = base([]);
    await publish();
    ok('a list that is the cache\'s (failed read) → no publish, the post-load mark kept',
      calls.length === 0 && portalDirtyRef.current.has('*'), calls.map(c => c.id).join());
    portalListsServerRef.current = true;
    await publish();
    ok('once after load: only the OWNED, portal-enabled project is published', calls.map(c => c.id).join() === 'A', calls.map(c => c.id).join());
    ok('…and the post-load mark is answered', portalDirtyRef.current.size === 0, [...portalDirtyRef.current.keys()].join());
    await publish();
    ok('nothing marked → no second publish', calls.length === 1);
    // REVIEW CASE: the phone is back from the pocket. Its DFR list is stale (the
    // web added one it never re-read) and a Stripe payment re-read moved the
    // invoices. Nothing on THIS device changed job A → no publish from stale lists.
    latest.current = base([], [{ id: 'i1', projectId: 'A', amountPaid: 500 }]);
    await publish();
    ok('a refetch that moved a list (stale DFRs + fresh invoice) publishes NOTHING', calls.length === 1, calls.map(c => c.id).join());
    latest.current = base([{ id: 'd1', projectId: 'A' }], [{ id: 'i1', projectId: 'A', amountPaid: 500 }]);
    mark('A');
    await publish();
    ok('a report he filed here (Home, the Create menu) → published', calls.length === 2 && calls[1].dfrs === 1);
    mark('Z');
    latest.current = base([{ id: 'd1', projectId: 'A' }, { id: 'd9', projectId: 'Z' }]);
    await publish();
    ok('a change on another job does not re-publish this one', calls.length === 2);
    outcome = 'read_failed';
    latest.current = base([{ id: 'd1', projectId: 'A' }, { id: 'd2', projectId: 'A' }]);
    mark('A');
    await publish();
    ok('a publish that did not settle keeps its mark', portalDirtyRef.current.has('A'));
    outcome = 'published';
    await publish();
    ok('…and is retried on the next pass (never dropped)', calls.length === 4 && calls[3].dfrs === 2 && !portalDirtyRef.current.has('A'));
    // A change while a publish is running: the running pass re-runs with the LATEST inputs.
    let release!: () => void;
    gate = new Promise<void>(r => { release = r; });
    latest.current = base([{ id: 'd1', projectId: 'A' }, { id: 'd2', projectId: 'A' }, { id: 'd3', projectId: 'A' }]);
    mark('A');
    const first = publish();
    await new Promise(r => setTimeout(r, 1));
    latest.current = base([{ id: 'd1', projectId: 'A' }, { id: 'd2', projectId: 'A' }, { id: 'd3', projectId: 'A' }, { id: 'd4', projectId: 'A' }]);
    mark('A'); // made while the first publish is out
    await publish(); // arrives while the first is running
    gate = null;
    release();
    await first;
    ok('a change during a running publish is published after it — the LAST change wins', calls[calls.length - 1].dfrs === 4 && !portalDirtyRef.current.has('A'), calls.map(c => c.dfrs).join());
    mark('*');
    latest.current = { ...base([{ id: 'd1', projectId: 'A' }]), settings: { branding: { companyName: 'Acme Builders' } } };
    const before = calls.length;
    await publish();
    ok('a profile change (\'*\') re-publishes every owned portal', calls.length === before + 1 && calls[calls.length - 1].id === 'A' && portalDirtyRef.current.size === 0);
    ok('settling outcomes are exactly the ones that leave the portal right',
      ['published', 'unchanged', 'portal_off', 'not_owner'].every(portalLiteOutcomeSettles)
        && !['read_failed', 'write_failed', 'coalesced', 'settings_not_loaded'].some(portalLiteOutcomeSettles));

    // The marks come from LOCAL writes only.
    const prevDfrs = [{ id: 'd1', projectId: 'A', notes: 'x' }, { id: 'd2', projectId: 'B', notes: 'y' }];
    ok('portalDirtyProjectIds: an edit marks its project, an untouched one does not',
      [...portalDirtyProjectIds(prevDfrs, [{ ...prevDfrs[0], notes: 'z' }, prevDfrs[1]])].join() === 'A');
    ok('portalDirtyProjectIds: an add and a delete mark theirs; a moved item marks both',
      [...portalDirtyProjectIds(prevDfrs, [prevDfrs[0], { id: 'd3', projectId: 'C' }])].sort().join() === 'B,C'
        && [...portalDirtyProjectIds(prevDfrs, [{ ...prevDfrs[0], projectId: 'D' }, prevDfrs[1]])].sort().join() === 'A,D');
    ok('portalDirtyProjectIds: an equal copy (a re-save of the same content) marks nothing',
      portalDirtyProjectIds(prevDfrs, prevDfrs.map(r => ({ ...r }))).size === 0);
    ok('portalDirtyProjects: the project whose row changed', [...portalDirtyProjects([{ id: 'A', n: 1 }, { id: 'B', n: 1 }] as never, [{ id: 'A', n: 2 }, { id: 'B', n: 1 }] as never)].join() === 'A');
    const tracked = ['savePermitsMutation', 'saveProjectsMutation', 'saveChangeOrdersMutation', 'saveInvoicesMutation', 'saveDailyReportsMutation', 'savePunchItemsMutation', 'savePhotosMutation', 'saveRfisMutation'];
    const untracked = tracked.filter(n => !new RegExp(`const ${n} = usePortalTrackedSave<[^>]+>\\(${n}Raw, useCallback\\(\\(next: [^)]+\\) => \\{\\s*markPortalDirty\\(portalDirty`).test(CTX));
    ok('every save of a list the portal reads is a tracked (marking) save', untracked.length === 0, untracked.join());
    ok('…nothing else persists those lists through a raw save but the server-origin absorb',
      (CTX.match(/save(?:Permits|Projects|ChangeOrders|Invoices|DailyReports|PunchItems|Photos|Rfis)MutationRaw\.mutate\(/g) ?? []).length === 1
        && /saveProjectsMutationRaw\.mutate\(updated\);/.test(CTX.slice(CTX.indexOf('const absorbServerSchedule = useCallback('), CTX.indexOf('const saveChangeOrdersMutationRaw'))));
    ok('warranties and the profile writers mark too',
      /markPortalDirty\(portalDirtyProjectIds\(portalWarrantyBaseRef\.current, list\)\);/.test(extractCallback(CTX, 'persistWarranties'))
        && /markPortalDirty\(\['\*'\]\)/.test(extractCallback(CTX, 'updateSettings'))
        && /markPortalDirty\(\['\*'\]\)/.test(extractCallback(CTX, 'savePaymentTerms')));
    ok('a new account owes every owned portal one publish',
      /portalDirtyRef\.current = new Map\(\[\['\*', portalDirtySeqRef\.current\]\]\);/.test(CTX));
    ok('not before every list the snapshot reads has loaded',
      /const portalSyncReady = canSync && projectsLoaded && settingsLoaded\s*&& changeOrdersLoaded && dailyReportsLoaded && photosLoaded\s*&& invoicesQuery\.isFetched && punchItemsQuery\.isFetched && rfisQuery\.isFetched && permitsQuery\.isFetched\s*&& warrantiesLoadedFor === \(userId \?\? ''\)[\s\S]{0,900}?&& portalListsFromServer\(portalServerReads, userId\);/.test(CTX));
    ok('debounced with a max wait, the timer restarted by every change (the last change is the one published)',
      /const delay = Math\.max\(0, Math\.min\(PORTAL_SYNC_DEBOUNCE_MS, PORTAL_SYNC_MAX_WAIT_MS - waited\)\);/.test(CTX)
        && /if \(portalSyncTimerRef\.current\) clearTimeout\(portalSyncTimerRef\.current\);\s*portalSyncTimerRef\.current = setTimeout\(/.test(CTX));
    ok('the change keys include permits (client-portal round 2) and settings',
      /\}, \[portalSyncReady, userId, settings, settingsLoaded, projects, invoices, changeOrders, dailyReports, punchItems, projectPhotos, rfis, warranties, permits, publishOwnedPortals\]\);/.test(CTX));
  }

  // ── #48 / #121 foreground re-read ──────────────────────────────────────────
  console.log('\n#48 #121 the foreground re-reads money and the profile, never over a write still out');
  {
    const run = async (o: { insertOut?: boolean; updatesOut?: number; termsInFlight?: number; queue?: Row[] }) => {
      const inv: string[] = [];
      const fn = runCallback<() => Promise<void>>(CTX, 'refetchMoneyAndProfileOnForeground', {
        userId: 'u1', liveUserIdRef: { current: 'u1' },
        invoiceInsertsRef: { current: new Map(o.insertOut ? [['i1', Promise.resolve('synced')]] : []) },
        invoiceWritesInFlightRef: { current: o.updatesOut ?? 0 },
        settingsRowWritesInFlightRef: { current: 0 }, termsWritesInFlightRef: { current: o.termsInFlight ?? 0 },
        getOfflineQueue: async () => o.queue ?? [], termsWritesPending, owedSettingsRereadReady, settingsRowWritePending,
        queryClient: { invalidateQueries: async (q: { queryKey: unknown[] }) => { inv.push(String(q.queryKey[0])); } },
      });
      await fn();
      return inv.sort().join();
    };
    ok('idle → invoices, pay apps and settings re-read', (await run({})) === 'aiaPayApps,invoices,settings');
    ok('an invoice insert on the wire → no invoices re-read over it', !(await run({ insertOut: true })).includes('invoices'));
    ok('an invoice update on the wire → no invoices re-read over it', !(await run({ updatesOut: 1 })).includes('invoices'));
    ok('a terms write in flight → no settings re-read (the old answer would win)', !(await run({ termsInFlight: 1 })).includes('settings'));
    ok('a terms write queued → no settings re-read',
      !(await run({ queue: [{ table: 'profiles', operation: 'update', data: { id: 'u1', deposit_pct: 25 } }] })).includes('settings'));
    // data-session critic round 2: ONE foreground binding runs every part
    // (one gap decision; the portal read epoch starts first) — this part
    // still runs on its own guards, not waiting on another part's.
    const all = extractCallback(CTX, 'refetchAllOnForeground');
    ok('run on every foreground by the single binding, beside the other parts',
      /useProjectsFocusRefetch\(canSync, refetchAllOnForeground\);/.test(CTX)
        && /refetchProjectsOnForeground, refetchMoneyAndProfileOnForeground,\s*refetchProDocsOnForeground, refetchPortalListsOnForeground,/.test(all)
        && /Promise\.all\(parts\.map\(run => run\(\)\.catch\(/.test(all));
    ok('an invoices re-read skipped for a write still out is OWED (the portal epoch waits on it)',
      /\} else \{\s*invoicesReloadOwedRef\.current = true;/.test(extractCallback(CTX, 'refetchMoneyAndProfileOnForeground')));
  }

  // ── #121 the terms question ────────────────────────────────────────────────
  console.log('\n#121 the terms question on a second device');
  {
    const split = { depositPct: 30, progressPct: 60, finalPct: 10 };
    const stamp = (s: typeof split) => ({ ...s, confirmedAt: '2026-09-18T12:00:00Z' });
    const portal = (id: string, s?: typeof split) => ({ id, ownerUserId: 'u1', clientPortal: { enabled: true, proposalApprovalEnabled: true, proposalPaymentTerms: s ? stamp(s) : undefined } });
    const projects = [portal('web-stamped', { depositPct: 25, progressPct: 65, finalPct: 10 }), portal('same', split), portal('none')];
    ok('a portal stamped with DIFFERENT terms is counted against "all say"', portalsDisagreeingWithSplit(projects as never, 'u1', split).join() === 'web-stamped');
    ok('none disagree → empty', portalsDisagreeingWithSplit([portal('same', split)] as never, 'u1', split).length === 0);
    const submit = extractCallback(GATE, 'submit');
    ok('"…now all say X" counts the disagreeing portals too',
      /unconfirmedPortalCount = needing\.length \+ portalsDisagreeingWithSplit\(projects, userId, res\.answers\.split\)\.length;/.test(submit));
    ok('"first time" also counts the profile the re-read found (no first stamp over the web\'s)',
      /const hadSplit = isValidSplit\(settings\.paymentSplit\) \|\| \(!!fresh && isValidSplit\(fresh\.paymentSplit\)\);/.test(submit));
    const refresh = extractCallback(GATE, 'refreshForAsk');
    ok('a terms / warranty question re-reads a profile older than a few seconds',
      /queryClient\.fetchQuery<AppSettings>\(\{ queryKey: \['settings', userId\], staleTime: ASK_SETTINGS_FRESH_MS \}\)/.test(refresh)
        && /questions\.some\(q => q === 'terms' \|\| q === 'warranty'\)/.test(refresh));
    ok('…and shows the saved answer, pre-filled, with where it came from', /setHint\(line\);/.test(refresh) && /answeredElsewhereHint\(q, fresh\)/.test(refresh));
    const run = extractCallback(GATE, 'run');
    ok('the sheet still opens in the same press (the re-read never delays `then`)',
      /setAsk\(\{ mode: 'run', questions, stepIndex: 0, needs, purpose: needs\.purpose \}\);\s*refreshForAsk\(questions\);\s*return 'asked';/.test(run)
        && /then\(answersFrom\(needs, \{\}\) as AnswersFor<N>\);/.test(run));
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

void main().catch((e) => { console.error(e); process.exit(1); });
