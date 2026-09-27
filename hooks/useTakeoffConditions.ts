// hooks/useTakeoffConditions.ts — the desktop takeoff's conditions and
// measurements for one job: saved on THIS browser first, then synced to the
// account (public.takeoff_docs, one doc per job) when this seat may write it.
//
// Key `mageid_takeoff_conditions::<projectId>`: the mageid_ prefix means
// signOut → wipeLocalUserCache sweeps it, so another account on a shared
// machine never sees his takeoff. The account copy survives that.
//
// Writes are debounced (~300 ms) and flushed on unmount and on a job switch.
// Every storage call is guarded — on web it is localStorage, which can throw
// (private windows, quota). This hook makes exactly two of them (the doc's
// read and write); the sync's own keys (meta, conflict copy) live in
// utils/takeoffCloudSync.ts. Undo/redo is an in-memory stack of whole docs
// (50 deep), cleared on a job switch AND on a server merge (an undo must never
// put a pre-merge doc back over a merge).
//
// PUSH BOOKKEEPING IS NOT UNDOABLE. A push has already moved the estimate, so
// ⌘Z must never un-record it: `record(fn)` (or update(fn, { undoable: false }))
// changes the doc without an undo entry, and undo/redo always carry the
// CURRENT `pushed` / `lastPush` forward onto the restored doc.
//
// CLOUD SYNC (utils/takeoff/takeoffDocMerge.ts rules 1–5):
//   - the seat: effectivePlanRole(useProjectRoleState(projectId).role, project,
//     user) and seatCanWrite(role, 'editor') — the takeoff_docs RLS tier. A
//     field or viewer seat keeps its edits on this browser and is told so;
//     while the role is unknown nothing is fetched or pushed.
//   - after the local load: fetch, merge, apply without an undo entry;
//   - every edit stamps meta.localEditedAt and schedules a push 1.5 s later
//     (flushed on unmount / job switch). The push stamps past the last server
//     stamp seen (nextPushStamp), records it as meta.pendingStamp BEFORE the
//     write, and on 'synced' VERIFIES with a read-back (fetchServerStamp):
//     'synced' is never taken from the queue's word alone.
//   - ONE queued write per job: while this job's last push still sits in the
//     offline queue (its outcome was 'queued' and it has not left), a new push
//     is HELD, not enqueued behind it — the edit stays on this browser and the
//     line stays 'offline'. When the queue moves (onTakeoffQueueSignal) and the
//     write has left, it is verified (takeoffLandedAction) and ONE push of the
//     latest doc goes out; the next edit after it left does the same. The
//     queue replays a record's writes oldest-first, so the latest doc lands
//     last. A hold kicks one queue drain (kickTakeoffQueueDrain), so a
//     reconnect lands it in about a second, not at the end of a backoff.
//   - A TEARDOWN NEVER HOLDS. On unmount, on a job switch, before a sign-out
//     (registerPreSignOutFlush) and when the page or app goes away (web
//     `pagehide`, AppState background / inactive — which on web is the tab
//     going hidden; the SYNC-F7 signals app/_layout.tsx uses), an owed push
//     goes out FINAL: past the hold, into the queue behind the write it was
//     held behind (at most one extra copy per teardown, never per edit),
//     stamped past that write. Behind a still-queued write it skips the
//     network pre-check, so it is only local reads and the queue append —
//     nothing that has to outlive the page.
//   - AN OWED PUSH SURVIVES UNTIL IT IS CARRIED. entry.owed is the edit count
//     the account still lacks: set by every edit, by a hold and by a merge
//     that must push; cleared ONLY when a push carrying that count is queued
//     or verified synced (or refused — the Not-saved ledger then holds that
//     write for Retry), or when a merge finds nothing to push. A settle or a
//     merge whose read failed pushes nothing and leaves it set, so a teardown
//     still queues the latest doc (a failed read proves nothing about another
//     device), and after an OFFLINE read the next queue signal / reconnect /
//     return to the app re-arms one push (entry.retry, spent on use).
//   - RESIDUAL: a page killed with no `pagehide` at all (a hard crash) leaves
//     the held edits on this browser only (doc + meta, localEditedAt set);
//     they reach the account when this job's takeoff is next opened here, and
//     a sign-out before that erases them. Closing that needs an always-mounted
//     pre-sign-out flush outside this hook.
//   - `saveLine` says where the takeoff is (TAKEOFF_SAVE_LINES); 'Saved to
//     your account' only after that verification. The panel must render it.

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { EMPTY_TAKEOFF_DOC, parseTakeoffDoc, type TakeoffDoc } from '@/utils/takeoff/conditions';
import {
  mergeTakeoffDocs, EMPTY_TAKEOFF_SYNC_META, takeoffHeldEditedAt, takeoffLandedAction, takeoffPushGate, takeoffQueueSignal,
  type TakeoffQueuedPush, type TakeoffSyncMeta,
} from '@/utils/takeoff/takeoffDocMerge';
import {
  SEAT_UNKNOWN_LINE, TAKEOFF_BACKUP_SUFFIX, TAKEOFF_SAVE_LINES, canSyncTakeoff, clearConflictCopy, fetchServerStamp,
  fetchServerTakeoffDoc, onTakeoffQueueSignal, pushTakeoffDoc, readConflictCopy, readTakeoffSyncMeta, saveConflictCopy,
  kickTakeoffQueueDrain, takeoffSessionUserId, takeoffWriteQueued, writeTakeoffSyncMeta, type TakeoffSaveState, type TakeoffSyncVerdict,
} from '@/utils/takeoffCloudSync';
import { registerPreSignOutFlush } from '@/utils/preSignOutFlush';
import { nextPushStamp, seatCanWrite, seatReadStatus, stampMs } from '@/utils/syncSeat';
import { useAuth } from '@/contexts/AuthContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useProjectRoleState } from '@/hooks/useProjectRole';
import { effectivePlanRole } from '@/utils/plans/revisionActions';

export const TAKEOFF_DOC_KEY_PREFIX = 'mageid_takeoff_conditions::';
export const takeoffDocKey = (projectId: string): string => `${TAKEOFF_DOC_KEY_PREFIX}${projectId}`;

const UNDO_DEPTH = 50;
const WRITE_DEBOUNCE_MS = 300;
const PUSH_DEBOUNCE_MS = 1500;

export interface TakeoffConflict {
  notice: string;
  hasBackup: boolean;
  restore: () => void;
  dismiss: () => void;
}

export interface UseTakeoffConditions {
  doc: TakeoffDoc;
  /** False until this job's saved doc has been read. Edits before then are ignored — keep tools disabled. */
  loaded: boolean;
  update: (fn: (d: TakeoffDoc) => TakeoffDoc, opts?: { undoable?: boolean }) => void;
  /** A non-undoable change (push bookkeeping: pushed / lastPush). */
  record: (fn: (d: TakeoffDoc) => TakeoffDoc) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Where the takeoff is saved (TAKEOFF_SAVE_LINES). The panel shows it. */
  saveLine: string;
  /** Set after a conflict merge (rule 5) until dismissed or the next edit. */
  conflict: TakeoffConflict | null;
}

/** The restored doc with the CURRENT push bookkeeping carried forward. */
function keepPush(target: TakeoffDoc, cur: TakeoffDoc): TakeoffDoc {
  const out: TakeoffDoc = { ...target, pushed: cur.pushed };
  if (cur.lastPush) out.lastPush = cur.lastPush;
  else delete out.lastPush;
  return out;
}

const hasContent = (d: TakeoffDoc): boolean =>
  d.conditions.length > 0 || d.measurements.length > 0 || Object.keys(d.pushed ?? {}).length > 0;

/** A takeoff kept on this browser from before the sync existed has no meta:
 *  its edits are unsynced, dated by its newest item. */
function legacyEditedAt(d: TakeoffDoc): string {
  let best = 0;
  for (const x of [...d.conditions, ...d.measurements]) {
    const ms = stampMs(x.createdAt);
    if (ms != null && ms > best) best = ms;
  }
  return new Date(best).toISOString();
}

export function useTakeoffConditions(projectId: string | null): UseTakeoffConditions {
  const [doc, setDoc] = useState<TakeoffDoc>(EMPTY_TAKEOFF_DOC);
  const [loaded, setLoaded] = useState(false);
  const [hist, setHist] = useState({ canUndo: false, canRedo: false });
  const docRef = useRef<TakeoffDoc>(EMPTY_TAKEOFF_DOC);
  const loadedRef = useRef(false);
  const projectRef = useRef<string | null>(projectId);
  const past = useRef<TakeoffDoc[]>([]);
  const future = useRef<TakeoffDoc[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ key: string; json: string } | null>(null);
  const syncHist = useCallback(() => {
    setHist({ canUndo: past.current.length > 0, canRedo: future.current.length > 0 });
  }, []);

  // ── the seat ──────────────────────────────────────────────────────────────
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { getProject } = useProjects();
  const project = projectId ? getProject(projectId) : null;
  const roleState = useProjectRoleState(projectId ?? undefined);
  const role = effectivePlanRole(roleState.role, project, userId);
  // The verdict is keyed by job: a stale 'ok' from the last job never gates this one.
  const [verdictFor, setVerdictFor] = useState<{ pid: string | null; v: TakeoffSyncVerdict } | null>(null);
  const verdictRef = useRef<{ pid: string | null; v: TakeoffSyncVerdict } | null>(null);
  const verdictOk = (pid: string): boolean => verdictRef.current?.pid === pid && verdictRef.current.v === 'ok';
  const verdict: TakeoffSyncVerdict | null = verdictFor && verdictFor.pid === projectId ? verdictFor.v : null;
  const userIdRef = useRef<string | null>(userId);
  userIdRef.current = userId;
  const [syncState, setSyncState] = useState<TakeoffSaveState>('syncing');
  const [conflictInfo, setConflictInfo] = useState<{ notice: string; hasBackup: boolean } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Meta for the CURRENT job, plus the newest server stamp seen for it.
  // serverRead: the account copy was read (and merged) this session — a push
  // never goes out blind over a copy this browser has not seen.
  // queued: this job's push still in the offline queue (the hold);
  // signalPending: a queue check is already waiting on pushChain;
  // owed: the edit count the account still lacks (null: nothing owed);
  // retry: a read failed with a push owed — the next signal re-arms one push.
  const metaRef = useRef<{
    pid: string | null; meta: TakeoffSyncMeta; lastServerMs: number | null; serverRead: boolean; syncing: boolean; ready: Promise<void>;
    queued: TakeoffQueuedPush | null; signalPending: boolean; owed: number | null; retry: boolean;
  }>({
    pid: null, meta: { ...EMPTY_TAKEOFF_SYNC_META }, lastServerMs: null, serverRead: false, syncing: false, ready: Promise.resolve(),
    queued: null, signalPending: false, owed: null, retry: false,
  });
  const setStateFor = useCallback((pid: string, s: TakeoffSaveState) => {
    if (mounted.current && projectRef.current === pid) setSyncState(s);
  }, []);

  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const p = pending.current;
    pending.current = null;
    if (!p) return;
    try {
      void AsyncStorage.setItem(p.key, p.json).catch(() => { /* storage full / blocked: the in-memory doc still works */ });
    } catch { /* localStorage threw synchronously */ }
  }, []);

  const scheduleWrite = useCallback((next: TakeoffDoc) => {
    const pid = projectRef.current;
    if (!pid) return;
    let json: string;
    try { json = JSON.stringify(next); } catch { return; }
    pending.current = { key: takeoffDocKey(pid), json };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, WRITE_DEBOUNCE_MS);
  }, [flush]);

  // ── push + verify ─────────────────────────────────────────────────────────
  // Declared through a ref so the push and the merge can call each other.
  const serverSyncRef = useRef<(pid: string, again: boolean) => Promise<void>>(async () => {});
  type MetaEntry = typeof metaRef.current;
  const patchEntry = (entry: MetaEntry, patch: Partial<TakeoffSyncMeta>): void => {
    entry.meta = { ...entry.meta, ...patch };
    const pid = entry.pid;
    // Written once the stored meta has been read, so a patch never clobbers it.
    if (pid) void entry.ready.then(() => writeTakeoffSyncMeta(pid, entry.meta));
  };
  const noteEntryServer = (entry: MetaEntry, stamp: string | null): void => {
    const ms = stampMs(stamp);
    if (ms != null && (entry.lastServerMs == null || ms > entry.lastServerMs)) entry.lastServerMs = ms;
  };
  /** A push carrying edit count `seq` was queued / verified / refused: the obligation it covers is met. */
  const carried = (entry: MetaEntry, seq: number): void => {
    if (entry.owed != null && seq >= entry.owed) entry.owed = null;
  };
  const kickMerge = (entry: MetaEntry, pid: string): void => {
    if (metaRef.current === entry) void serverSyncRef.current(pid, true).catch(() => setStateFor(pid, 'failed'));
  };

  // Pushes run one at a time (a second push must not be mistaken, at the first
  // one's verify read, for another device's write). editSeq counts edits, so
  // "an edit happened while this push was out" never depends on the clock.
  const pushChain = useRef<Promise<void>>(Promise.resolve());
  const editSeq = useRef(0);
  const doPush = useCallback((pid: string, editUserId: string | null, again = false, final = false): Promise<void> => {
    // Captured synchronously: a flush on unmount / job switch still pushes THIS job's doc.
    const entry = metaRef.current;
    if (entry.pid !== pid || projectRef.current !== pid || !verdictOk(pid)) return Promise.resolve();
    const docAtPush = docRef.current;
    const seqAtPush = editSeq.current;
    const run = pushChain.current.then(() => pushNow(entry, pid, editUserId, docAtPush, seqAtPush, again, final));
    pushChain.current = run.catch(() => undefined);
    return run;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setStateFor]);

  const pushNow = async (
    entry: MetaEntry, pid: string, editUserId: string | null, docAtPush: TakeoffDoc, seqAtPush: number, again: boolean,
    final = false,
  ): Promise<void> => {
    await entry.ready;
    // 1. A sign-out / sign-in inside the window: the tenant wipe owns the doc now.
    const sessionUser = await takeoffSessionUserId();
    if (!editUserId || sessionUser !== editUserId) return;
    // Nothing owed (a push carrying the latest edit already went out): no copy.
    if (entry.owed == null) return;
    // One queued write per job: while the last push is still in the offline
    // queue, this one is held (not enqueued behind it) and goes out once that
    // write has left. If it already has, verify what landed first.
    // A FINAL push (a teardown: unmount, job switch, sign-out) never holds: it
    // goes into the queue behind that write, stamped past it (floorMs), so the
    // queue's oldest-first replay lands the latest doc last. Once the hook has
    // unmounted nothing can release a hold (the queue listener is gone), so
    // any push after that — a merge's included — is final too.
    const noHold = final || !mounted.current;
    const held = entry.queued;
    let floorMs: number | null = null;
    if (held) {
      const gate = takeoffPushGate(held, await takeoffWriteQueued(pid));
      if (gate === 'hold' && !noHold) {
        held.held = true;
        entry.owed = Math.max(entry.owed ?? seqAtPush, seqAtPush);
        patchEntry(entry, { localEditedAt: takeoffHeldEditedAt(Date.now(), held.stamp) });
        setStateFor(pid, 'offline');
        kickTakeoffQueueDrain();
        return;
      }
      if (gate === 'hold') {
        floorMs = stampMs(held.stamp);
      } else {
        if (entry.queued === held) entry.queued = null;
        const landed = gate === 'settle' ? await settleLanded(entry, pid, held) : 'push';
        if (landed === 'merge') return;
        if (landed === 'unread') {
          // The verify read failed: that proves nothing about another device.
          // Mounted, fetch + merge (it pushes what the account lacks); a
          // teardown still sends the latest doc, stamped past the write that left.
          if (!noHold) { kickMerge(entry, pid); return; }
          floorMs = stampMs(held.stamp);
        }
      }
    }
    // Never push over an account copy this browser has not merged: when the
    // open's read failed, or another device wrote since (a cheap stamp read),
    // fetch + merge first — the merge pushes the result.
    if (!entry.serverRead) {
      if (metaRef.current === entry) void serverSyncRef.current(pid, again).catch(() => setStateFor(pid, 'failed'));
      return;
    }
    // A teardown's push (floorMs set: behind a write still queued, or after an
    // unread settle) skips the pre-check: it cannot succeed offline, and the
    // append behind the queued write needs no network — so a push fired from
    // `pagehide` finishes on local reads alone.
    if (floorMs == null) {
      const pre = await fetchServerStamp(pid);
      const preMs = typeof pre === 'string' ? stampMs(pre) : null;
      if (preMs != null && preMs > (entry.lastServerMs ?? Number.NEGATIVE_INFINITY) && !again) {
        kickMerge(entry, pid);
        return;
      }
    }
    // 2. Stamp past the last server stamp seen — and past this browser's own
    // last write still unverified (meta.pendingStamp: a queued write, or one
    // that left the queue unread) — and record it BEFORE the write.
    const lastSeen = Math.max(
      entry.lastServerMs ?? Number.NEGATIVE_INFINITY, stampMs(entry.meta.lastSyncedAt) ?? Number.NEGATIVE_INFINITY, floorMs ?? Number.NEGATIVE_INFINITY,
      stampMs(entry.meta.pendingStamp) ?? Number.NEGATIVE_INFINITY,
    );
    const stamp = nextPushStamp(Date.now(), Number.isFinite(lastSeen) ? lastSeen : null);
    const sentAt = new Date().toISOString();
    patchEntry(entry, { pendingStamp: stamp });
    setStateFor(pid, 'syncing');
    const outcome = await pushTakeoffDoc(pid, editUserId, docAtPush, stamp);
    // 4. queued → offline (the next open's rule 3 recognises the write by
    // pendingStamp). Later pushes are held behind it until it leaves the
    // queue; one check now covers a flush that beat this line.
    if (outcome === 'queued') {
      entry.queued = { stamp, sentAt, seq: seqAtPush, held: false };
      carried(entry, seqAtPush);
      setStateFor(pid, 'offline');
      queueCheck(entry, pid);
      return;
    }
    // 5. refused → localEditedAt stays set; the next edit or open tries again.
    // The Not-saved ledger holds this write for Retry, so nothing is owed here
    // (pushing it again would only be refused, or parked, again).
    if (outcome === 'failed') { carried(entry, seqAtPush); setStateFor(pid, 'refused'); return; }
    // 3. 'synced' — never taken from the queue's word alone: VERIFY with a read-back.
    // Unverified, the push stays owed; the next signal re-arms one more.
    const v = await fetchServerStamp(pid);
    if (typeof v !== 'string') { if (v === 'offline') entry.retry = true; setStateFor(pid, 'offline'); return; }
    const vMs = stampMs(v);
    const sMs = stampMs(stamp);
    if (vMs != null && sMs != null && vMs === sMs) {
      noteEntryServer(entry, v);
      carried(entry, seqAtPush);
      const newerEdit = editSeq.current !== seqAtPush;
      patchEntry(entry, {
        localEditedAt: newerEdit ? entry.meta.localEditedAt : null,
        pendingStamp: null,
        lastSyncedAt: v,
        lastSyncedLocalAt: sentAt,
      });
      setStateFor(pid, newerEdit ? 'syncing' : 'synced');
      return;
    }
    if (vMs != null && sMs != null && vMs > sMs && !again) {
      // Keep-newest ignored us: another device wrote in between. Merge once more
      // (rule 5 fires: local is still dirty). Not awaited — its own push queues
      // behind this one on pushChain. The line stays 'syncing' until it settles.
      noteEntryServer(entry, v);
      void serverSyncRef.current(pid, true).catch(() => setStateFor(pid, 'failed'));
      return;
    }
    setStateFor(pid, 'offline');
  };

  // The held push's write left the queue: verify what landed. 'unread' — the
  // read failed, nothing is decided (the caller picks: merge, or a teardown's
  // push); 'merge' hands over to fetch + merge (it pushes what the account
  // lacks); otherwise the meta records the landed write (localEditedAt kept
  // when a push is owed). entry.owed is never cleared here.
  const settleLanded = async (entry: MetaEntry, pid: string, q: TakeoffQueuedPush): Promise<'synced' | 'push' | 'merge' | 'unread'> => {
    const v = await fetchServerStamp(pid);
    if (v === 'offline' || v === 'error') return 'unread';
    const dirty = q.held || editSeq.current !== q.seq;
    const act = takeoffLandedAction(q.stamp, v, dirty);
    if (act === 'merge' || typeof v !== 'string') {
      kickMerge(entry, pid);
      return 'merge';
    }
    noteEntryServer(entry, v);
    patchEntry(entry, {
      localEditedAt: dirty ? entry.meta.localEditedAt : null,
      pendingStamp: null,
      lastSyncedAt: v,
      lastSyncedLocalAt: q.sentAt,
    });
    setStateFor(pid, act === 'synced' ? 'synced' : 'syncing');
    return act;
  };

  // A queue signal: once the held write has left the queue, settle it and push
  // the latest doc if one is owed. Runs on pushChain (never beside a push);
  // one check waits at a time, and a signal that arrives while it runs queues
  // the next, so the last signal is never lost.
  const settleIfLeft = async (entry: MetaEntry, pid: string): Promise<void> => {
    entry.signalPending = false;
    const q = entry.queued;
    if (!q || metaRef.current !== entry) return;
    if (takeoffQueueSignal(q, await takeoffWriteQueued(pid)) !== 'settle' || entry.queued !== q) return;
    entry.queued = null;
    const landed = await settleLanded(entry, pid, q);
    if (landed === 'push') {
      void doPush(pid, userIdRef.current).catch(() => { /* the next edit or open tries again */ });
    } else if (landed === 'unread') {
      kickMerge(entry, pid);
    }
  };
  const queueCheck = (entry: MetaEntry, pid: string): void => {
    if (!entry.queued || entry.signalPending) return;
    entry.signalPending = true;
    const run = pushChain.current.then(() => settleIfLeft(entry, pid));
    pushChain.current = run.catch(() => { entry.signalPending = false; });
  };
  useEffect(() => onTakeoffQueueSignal(() => {
    const entry = metaRef.current;
    if (!entry.pid) return;
    if (entry.queued) queueCheck(entry, entry.pid);
    else rearmRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  // The debounced push. Its timer fires an ordinary push (it may hold); a
  // TEARDOWN (unmount, job switch, sign-out, pagehide / background) fires a
  // FINAL one, which never holds — and, with nothing pending, still sends the
  // latest doc while a push is owed (checked on pushChain, after any push
  // still in flight has had its turn to carry it). Captured synchronously: a
  // job switch resets the refs right after.
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushPending = useRef<{ pid: string; editUserId: string | null } | null>(null);
  const firePush = useCallback((final: boolean): Promise<void> => {
    if (pushTimer.current) { clearTimeout(pushTimer.current); pushTimer.current = null; }
    const p = pushPending.current;
    pushPending.current = null;
    const swallow = () => { /* the next edit or open tries again */ };
    if (p) return doPush(p.pid, p.editUserId, false, final).catch(swallow);
    if (!final) return Promise.resolve();
    const entry = metaRef.current;
    const pid = entry.pid;
    if (!pid || projectRef.current !== pid || !verdictOk(pid)) return Promise.resolve();
    const docAtPush = docRef.current;
    const seqAtPush = editSeq.current;
    const editUserId = userIdRef.current;
    const run = pushChain.current.then(() => (
      entry.owed != null || entry.queued?.held ? pushNow(entry, pid, editUserId, docAtPush, seqAtPush, false, true) : undefined
    ));
    pushChain.current = run.catch(() => undefined);
    return run.catch(swallow);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doPush]);
  const flushPush = useCallback(() => { void firePush(false); }, [firePush]);
  const flushPushFinal = useCallback((): Promise<void> => firePush(true), [firePush]);
  const schedulePush = useCallback((pid: string, editUserId: string | null) => {
    pushPending.current = { pid, editUserId };
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(flushPush, PUSH_DEBOUNCE_MS);
  }, [flushPush]);
  // Re-arm ONE push after a read failed with a push owed (entry.retry): on
  // the next queue signal, reconnect (`online`) or return to the app. The
  // flag is spent here, so a server that keeps disagreeing never loops.
  const rearmOwed = useCallback(() => {
    const entry = metaRef.current;
    const pid = entry.pid;
    if (!pid || !entry.retry || entry.owed == null || entry.queued || pushPending.current) return;
    if (projectRef.current !== pid || !verdictOk(pid)) return;
    entry.retry = false;
    schedulePush(pid, userIdRef.current);
  }, [schedulePush]);
  const rearmRef = useRef(rearmOwed);
  rearmRef.current = rearmOwed;

  // ── fetch + merge ─────────────────────────────────────────────────────────
  // One fetch + merge at a time per job: a second caller returns, and the
  // running one pushes what it merged (edits after that push their own).
  const runServerSync = useCallback(async (pid: string, again: boolean): Promise<void> => {
    const entry = metaRef.current;
    if (entry.pid !== pid || entry.syncing) return;
    entry.syncing = true;
    try {
      await mergeWithServer(entry, pid, again);
    } finally {
      entry.syncing = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doPush, scheduleWrite, setStateFor, syncHist]);

  const mergeWithServer = async (entry: MetaEntry, pid: string, again: boolean): Promise<void> => {
    await entry.ready;
    if (projectRef.current !== pid || metaRef.current !== entry || !verdictOk(pid)) return;
    setStateFor(pid, 'syncing');
    const res = await fetchServerTakeoffDoc(pid);
    if (projectRef.current !== pid || metaRef.current !== entry) return;
    if (res === 'error' || res === 'offline') {
      // Nothing pushed: a push still owed stays owed (a teardown sends it).
      // Offline, one retry is armed for the reconnect; an 'error' waits for
      // the next edit / open, as before (never a retry loop against a server
      // that keeps refusing the read).
      if (res === 'offline' && entry.owed != null) entry.retry = true;
      setStateFor(pid, res === 'error' ? 'failed' : 'offline');
      return;
    }
    if (res) noteEntryServer(entry, res.updatedAt);
    entry.serverRead = true;
    const before = docRef.current;
    const meta = entry.meta;
    const m = mergeTakeoffDocs({ local: before, meta, server: res });

    let changed = false;
    try { changed = JSON.stringify(m.doc) !== JSON.stringify(before); } catch { changed = true; }
    if (changed) {
      // Applied WITHOUT an undo entry, and the stacks are cleared: an undo must
      // never put a pre-merge doc back over a merge.
      docRef.current = m.doc;
      past.current = [];
      future.current = [];
      if (mounted.current) { setDoc(m.doc); syncHist(); }
      scheduleWrite(m.doc);
    }

    if (m.rule === 5) {
      const hasBackup = m.backupLocal ? await saveConflictCopy(pid, before) : false;
      if (mounted.current && projectRef.current === pid) {
        setConflictInfo({ notice: `${m.notice ?? ''}${hasBackup ? TAKEOFF_BACKUP_SUFFIX : ''}`, hasBackup });
      }
    }

    if (!m.push) {
      // The account copy IS this browser's copy (rules 2 / 3 kept, or both empty).
      entry.owed = null;
      patchEntry(entry, {
        localEditedAt: null,
        pendingStamp: null,
        lastSyncedAt: m.syncedAt ?? meta.lastSyncedAt,
        lastSyncedLocalAt: m.syncedAt ? new Date().toISOString() : meta.lastSyncedLocalAt,
      });
      setStateFor(pid, 'synced');
      return;
    }
    // This browser holds something the account lacks: mark it dirty (and
    // owed), push now.
    entry.owed = Math.max(entry.owed ?? editSeq.current, editSeq.current);
    if (!entry.meta.localEditedAt) patchEntry(entry, { localEditedAt: new Date().toISOString() });
    // Not awaited: the push queues on pushChain, and this merge must release
    // `syncing` first (its push may ask for one more merge).
    void doPush(pid, userIdRef.current, again).catch(() => { /* the next edit or open tries again */ });
  };
  serverSyncRef.current = runServerSync;

  // Load on job change; flush the previous job's pending write (and push —
  // FINAL, so nothing of the old job is left held) first.
  useEffect(() => {
    flush();
    void flushPushFinal();
    projectRef.current = projectId;
    past.current = [];
    future.current = [];
    docRef.current = EMPTY_TAKEOFF_DOC;
    setDoc(EMPTY_TAKEOFF_DOC);
    setConflictInfo(null);
    syncHist();
    if (!projectId) {
      metaRef.current = {
        pid: null, meta: { ...EMPTY_TAKEOFF_SYNC_META }, lastServerMs: null, serverRead: false, syncing: false, ready: Promise.resolve(),
        queued: null, signalPending: false, owed: null, retry: false,
      };
      loadedRef.current = true;
      setLoaded(true);
      return;
    }
    loadedRef.current = false;
    setLoaded(false);
    let cancelled = false;
    // The sync meta loads beside the doc; an edit made before it lands wins.
    let docLoaded: (d: TakeoffDoc) => void = () => {};
    const docPromise = new Promise<TakeoffDoc>((resolve) => { docLoaded = resolve; });
    const entry: MetaEntry = {
      pid: projectId as string | null, meta: { ...EMPTY_TAKEOFF_SYNC_META }, lastServerMs: null as number | null,
      serverRead: false, syncing: false, ready: Promise.resolve(), queued: null, signalPending: false, owed: null, retry: false,
    };
    entry.ready = Promise.all([readTakeoffSyncMeta(projectId), docPromise]).then(([{ meta, stored }, loadedDoc]) => {
      const edited = entry.meta.localEditedAt;
      entry.meta = { ...meta, localEditedAt: edited ?? meta.localEditedAt };
      if (!stored && !entry.meta.localEditedAt && hasContent(loadedDoc)) {
        entry.meta.localEditedAt = legacyEditedAt(loadedDoc);
      }
    });
    metaRef.current = entry;
    const finish = (raw: string | null) => {
      if (cancelled || projectRef.current !== projectId) { docLoaded(parseTakeoffDoc(raw)); return; }
      const parsed = parseTakeoffDoc(raw);
      docRef.current = parsed;
      setDoc(parsed);
      loadedRef.current = true;
      setLoaded(true);
      docLoaded(parsed);
    };
    try {
      AsyncStorage.getItem(takeoffDocKey(projectId)).then(finish, () => finish(null));
    } catch {
      finish(null);
    }
    return () => { cancelled = true; };
  }, [projectId, flush, flushPushFinal, syncHist]);

  // Flush on unmount (the local write, then the push — FINAL).
  useEffect(() => () => { flush(); void flushPushFinal(); }, [flush, flushPushFinal]);
  // Before a sign-out drains the queue and wipes this browser: the same FINAL
  // push, awaited, so a held edit is in the queue when the drain runs.
  useEffect(() => registerPreSignOutFlush(() => flushPushFinal()), [flushPushFinal]);
  // The page or app goes away with no React cleanup (a closed tab, a reload,
  // the browser quitting, iOS suspending the app): the same FINAL push, from
  // the SYNC-F7 signals — web `pagehide`, and AppState background / inactive
  // (react-native-web reports a hidden tab as 'background'). Coming back
  // ('active', `online`) re-arms an owed push whose read had failed.
  useEffect(() => {
    const away = () => { flush(); void flushPushFinal(); };
    let sub: { remove: () => void } | null = null;
    try {
      sub = AppState.addEventListener('change', (s) => {
        if (s === 'background' || s === 'inactive') away();
        else if (s === 'active') rearmOwed();
      });
    } catch { sub = null; }
    const w = typeof window !== 'undefined' ? window : undefined;
    const web = !!w && typeof w.addEventListener === 'function' && typeof w.removeEventListener === 'function';
    if (w && web) {
      w.addEventListener('pagehide', away);
      w.addEventListener('online', rearmOwed);
    }
    return () => {
      sub?.remove();
      if (w && web) {
        w.removeEventListener('pagehide', away);
        w.removeEventListener('online', rearmOwed);
      }
    };
  }, [flush, flushPushFinal, rearmOwed]);

  // The verdict: may this browser sync this job? (Re-asked when the job, its
  // name — a sample job syncs nothing — the seat or the account changes.)
  const projectRefObj = useRef(project);
  projectRefObj.current = project;
  const projectName = project?.name ?? null;
  const hasProject = !!project;
  useEffect(() => {
    let live = true;
    const pid = projectId;
    void canSyncTakeoff(pid, projectRefObj.current, role).then((v) => {
      if (!live) return;
      verdictRef.current = { pid, v };
      setVerdictFor({ pid, v });
    });
    return () => { live = false; };
  }, [projectId, projectName, hasProject, role, userId]);

  // The account merge: once per job per account, after the local load, once
  // the verdict is 'ok'. Nothing is fetched while the seat is unknown.
  const syncedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!projectId || !loaded || verdict !== 'ok') return;
    const key = `${projectId}:${userId ?? ''}`;
    if (syncedFor.current === key) return;
    syncedFor.current = key;
    void runServerSync(projectId, false).catch(() => setStateFor(projectId, 'failed'));
  }, [projectId, loaded, verdict, userId, runServerSync, setStateFor]);

  const commit = useCallback((next: TakeoffDoc) => {
    docRef.current = next;
    setDoc(next);
    scheduleWrite(next);
    const pid = projectRef.current;
    if (!pid) return;
    setConflictInfo(null);
    editSeq.current += 1;
    // While a push is held behind a queued write the line stays 'offline', and
    // the edit is dated past that write's stamp (takeoffHeldEditedAt: rule 3
    // must never call it older, even after a reload).
    const heldBehind = metaRef.current.pid === pid ? metaRef.current.queued : null;
    if (metaRef.current.pid === pid) {
      metaRef.current.owed = editSeq.current;
      patchEntry(metaRef.current, {
        localEditedAt: heldBehind ? takeoffHeldEditedAt(Date.now(), heldBehind.stamp) : new Date().toISOString(),
      });
    }
    if (verdictOk(pid) && !heldBehind) setSyncState('syncing');
    schedulePush(pid, userIdRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleWrite, schedulePush]);

  const update = useCallback((fn: (d: TakeoffDoc) => TakeoffDoc, opts?: { undoable?: boolean }) => {
    if (!loadedRef.current) return;
    const prev = docRef.current;
    const next = fn(prev);
    if (next === prev) return;
    if (opts?.undoable !== false) {
      past.current.push(prev);
      if (past.current.length > UNDO_DEPTH) past.current.shift();
      future.current = [];
      syncHist();
    }
    commit(next);
  }, [commit, syncHist]);

  const record = useCallback((fn: (d: TakeoffDoc) => TakeoffDoc) => update(fn, { undoable: false }), [update]);

  const undo = useCallback(() => {
    if (!loadedRef.current) return;
    const target = past.current.pop();
    if (!target) return;
    const cur = docRef.current;
    future.current.push(cur);
    syncHist();
    commit(keepPush(target, cur));
  }, [commit, syncHist]);

  const redo = useCallback(() => {
    if (!loadedRef.current) return;
    const target = future.current.pop();
    if (!target) return;
    const cur = docRef.current;
    past.current.push(cur);
    syncHist();
    commit(keepPush(target, cur));
  }, [commit, syncHist]);

  // ── the conflict banner's actions ─────────────────────────────────────────
  const restore = useCallback(() => {
    const pid = projectRef.current;
    if (!pid) return;
    void readConflictCopy(pid).then((backup) => {
      if (!backup || projectRef.current !== pid) return;
      // An undoable, newer local edit: it wins and pushes.
      update(() => backup);
      void clearConflictCopy(pid);
      if (mounted.current) setConflictInfo(null);
    });
  }, [update]);
  const dismiss = useCallback(() => {
    const pid = projectRef.current;
    if (pid) void clearConflictCopy(pid);
    setConflictInfo(null);
  }, []);

  // seatCanWrite(role, 'editor') is the gate canSyncTakeoff applies; the
  // line reads the verdict it produced.
  const seatBlocked = seatCanWrite(role, 'editor') === false;
  // #90: an unknown seat says WHY — 'syncing' only while the role read is in
  // flight; a failed read, a read paused offline, or a settled null (not on
  // this job: RLS would refuse) never sits on the syncing line.
  const unknownSeat: TakeoffSaveState = SEAT_UNKNOWN_LINE[seatReadStatus({
    isLoading: roleState.isLoading, isError: roleState.isError, isPaused: roleState.isPaused,
  })];
  const lineState: TakeoffSaveState =
    verdict === 'local' ? 'local'
      : verdict === 'seat' || (verdict === null && seatBlocked) ? 'seat'
        : verdict === 'ok' ? syncState
          : verdict === 'seat_unknown' && role === null ? unknownSeat
            : 'syncing';

  return {
    doc,
    loaded,
    update,
    record,
    undo,
    redo,
    canUndo: hist.canUndo,
    canRedo: hist.canRedo,
    saveLine: TAKEOFF_SAVE_LINES[lineState],
    conflict: conflictInfo ? { ...conflictInfo, restore, dismiss } : null,
  };
}
