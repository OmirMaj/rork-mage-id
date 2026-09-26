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
//   - `saveLine` says where the takeoff is (TAKEOFF_SAVE_LINES); 'Saved to
//     your account' only after that verification. The panel must render it.

import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { EMPTY_TAKEOFF_DOC, parseTakeoffDoc, type TakeoffDoc } from '@/utils/takeoff/conditions';
import { mergeTakeoffDocs, EMPTY_TAKEOFF_SYNC_META, type TakeoffSyncMeta } from '@/utils/takeoff/takeoffDocMerge';
import {
  SEAT_UNKNOWN_LINE, TAKEOFF_BACKUP_SUFFIX, TAKEOFF_SAVE_LINES, canSyncTakeoff, clearConflictCopy, fetchServerStamp,
  fetchServerTakeoffDoc, pushTakeoffDoc, readConflictCopy, readTakeoffSyncMeta, saveConflictCopy,
  takeoffSessionUserId, writeTakeoffSyncMeta, type TakeoffSaveState, type TakeoffSyncVerdict,
} from '@/utils/takeoffCloudSync';
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
  const metaRef = useRef<{ pid: string | null; meta: TakeoffSyncMeta; lastServerMs: number | null; serverRead: boolean; syncing: boolean; ready: Promise<void> }>({
    pid: null, meta: { ...EMPTY_TAKEOFF_SYNC_META }, lastServerMs: null, serverRead: false, syncing: false, ready: Promise.resolve(),
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

  // Pushes run one at a time (a second push must not be mistaken, at the first
  // one's verify read, for another device's write). editSeq counts edits, so
  // "an edit happened while this push was out" never depends on the clock.
  const pushChain = useRef<Promise<void>>(Promise.resolve());
  const editSeq = useRef(0);
  const doPush = useCallback((pid: string, editUserId: string | null, again = false): Promise<void> => {
    // Captured synchronously: a flush on unmount / job switch still pushes THIS job's doc.
    const entry = metaRef.current;
    if (entry.pid !== pid || projectRef.current !== pid || !verdictOk(pid)) return Promise.resolve();
    const docAtPush = docRef.current;
    const seqAtPush = editSeq.current;
    const run = pushChain.current.then(() => pushNow(entry, pid, editUserId, docAtPush, seqAtPush, again));
    pushChain.current = run.catch(() => undefined);
    return run;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setStateFor]);

  const pushNow = async (
    entry: MetaEntry, pid: string, editUserId: string | null, docAtPush: TakeoffDoc, seqAtPush: number, again: boolean,
  ): Promise<void> => {
    await entry.ready;
    // 1. A sign-out / sign-in inside the window: the tenant wipe owns the doc now.
    const sessionUser = await takeoffSessionUserId();
    if (!editUserId || sessionUser !== editUserId) return;
    // Never push over an account copy this browser has not merged: when the
    // open's read failed, or another device wrote since (a cheap stamp read),
    // fetch + merge first — the merge pushes the result.
    if (!entry.serverRead) {
      if (metaRef.current === entry) void serverSyncRef.current(pid, again).catch(() => setStateFor(pid, 'failed'));
      return;
    }
    const pre = await fetchServerStamp(pid);
    const preMs = typeof pre === 'string' ? stampMs(pre) : null;
    if (preMs != null && preMs > (entry.lastServerMs ?? Number.NEGATIVE_INFINITY) && !again) {
      if (metaRef.current === entry) void serverSyncRef.current(pid, true).catch(() => setStateFor(pid, 'failed'));
      return;
    }
    // 2. Stamp past the last server stamp seen; record it BEFORE the write.
    const lastSeen = Math.max(entry.lastServerMs ?? Number.NEGATIVE_INFINITY, stampMs(entry.meta.lastSyncedAt) ?? Number.NEGATIVE_INFINITY);
    const stamp = nextPushStamp(Date.now(), Number.isFinite(lastSeen) ? lastSeen : null);
    const sentAt = new Date().toISOString();
    patchEntry(entry, { pendingStamp: stamp });
    setStateFor(pid, 'syncing');
    const outcome = await pushTakeoffDoc(pid, editUserId, docAtPush, stamp);
    // 4. queued → offline (the next open's rule 3 recognises the write by pendingStamp).
    if (outcome === 'queued') { setStateFor(pid, 'offline'); return; }
    // 5. refused → localEditedAt stays set; the next edit or open tries again.
    if (outcome === 'failed') { setStateFor(pid, 'refused'); return; }
    // 3. 'synced' — never taken from the queue's word alone: VERIFY with a read-back.
    const v = await fetchServerStamp(pid);
    if (typeof v !== 'string') { setStateFor(pid, 'offline'); return; }
    const vMs = stampMs(v);
    const sMs = stampMs(stamp);
    if (vMs != null && sMs != null && vMs === sMs) {
      noteEntryServer(entry, v);
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

  // The debounced push, flushed on unmount and on a job switch.
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushPending = useRef<{ pid: string; editUserId: string | null } | null>(null);
  const flushPush = useCallback(() => {
    if (pushTimer.current) { clearTimeout(pushTimer.current); pushTimer.current = null; }
    const p = pushPending.current;
    pushPending.current = null;
    if (p) void doPush(p.pid, p.editUserId).catch(() => { /* the next edit or open tries again */ });
  }, [doPush]);
  const schedulePush = useCallback((pid: string, editUserId: string | null) => {
    pushPending.current = { pid, editUserId };
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(flushPush, PUSH_DEBOUNCE_MS);
  }, [flushPush]);

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
    if (res === 'error') { setStateFor(pid, 'failed'); return; }
    if (res === 'offline') { setStateFor(pid, 'offline'); return; }
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
      patchEntry(entry, {
        localEditedAt: null,
        pendingStamp: null,
        lastSyncedAt: m.syncedAt ?? meta.lastSyncedAt,
        lastSyncedLocalAt: m.syncedAt ? new Date().toISOString() : meta.lastSyncedLocalAt,
      });
      setStateFor(pid, 'synced');
      return;
    }
    // This browser holds something the account lacks: mark it dirty, push now.
    if (!entry.meta.localEditedAt) patchEntry(entry, { localEditedAt: new Date().toISOString() });
    // Not awaited: the push queues on pushChain, and this merge must release
    // `syncing` first (its push may ask for one more merge).
    void doPush(pid, userIdRef.current, again).catch(() => { /* the next edit or open tries again */ });
  };
  serverSyncRef.current = runServerSync;

  // Load on job change; flush the previous job's pending write (and push) first.
  useEffect(() => {
    flush();
    flushPush();
    projectRef.current = projectId;
    past.current = [];
    future.current = [];
    docRef.current = EMPTY_TAKEOFF_DOC;
    setDoc(EMPTY_TAKEOFF_DOC);
    setConflictInfo(null);
    syncHist();
    if (!projectId) {
      metaRef.current = { pid: null, meta: { ...EMPTY_TAKEOFF_SYNC_META }, lastServerMs: null, serverRead: false, syncing: false, ready: Promise.resolve() };
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
    const entry = {
      pid: projectId as string | null, meta: { ...EMPTY_TAKEOFF_SYNC_META }, lastServerMs: null as number | null,
      serverRead: false, syncing: false, ready: Promise.resolve(),
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
  }, [projectId, flush, flushPush, syncHist]);

  // Flush on unmount (the local write, then the push).
  useEffect(() => () => { flush(); flushPush(); }, [flush, flushPush]);

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
    if (metaRef.current.pid === pid) patchEntry(metaRef.current, { localEditedAt: new Date().toISOString() });
    if (verdictOk(pid)) setSyncState('syncing');
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
