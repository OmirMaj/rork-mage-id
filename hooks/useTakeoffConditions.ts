// hooks/useTakeoffConditions.ts — the desktop takeoff's conditions and
// measurements, saved per job on THIS browser/device (wave 4, founder
// decision: browser first, no backend yet).
//
// Key `mageid_takeoff_conditions::<projectId>`: the mageid_ prefix means
// signOut → wipeLocalUserCache sweeps it, so another account on a shared
// machine never sees his takeoff. The UI must say "Saved on this browser".
//
// Writes are debounced (~300 ms) and flushed on unmount and on a job switch.
// Every AsyncStorage call is guarded — on web it is localStorage, which can
// throw (private windows, quota). Undo/redo is an in-memory stack of whole
// docs (50 deep), cleared on a job switch.
//
// PUSH BOOKKEEPING IS NOT UNDOABLE. A push has already moved the estimate, so
// ⌘Z must never un-record it: `record(fn)` (or update(fn, { undoable: false }))
// changes the doc without an undo entry, and undo/redo always carry the
// CURRENT `pushed` / `lastPush` forward onto the restored doc.

import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { EMPTY_TAKEOFF_DOC, parseTakeoffDoc, type TakeoffDoc } from '@/utils/takeoff/conditions';

export const TAKEOFF_DOC_KEY_PREFIX = 'mageid_takeoff_conditions::';
export const takeoffDocKey = (projectId: string): string => `${TAKEOFF_DOC_KEY_PREFIX}${projectId}`;

const UNDO_DEPTH = 50;
const WRITE_DEBOUNCE_MS = 300;

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
}

/** The restored doc with the CURRENT push bookkeeping carried forward. */
function keepPush(target: TakeoffDoc, cur: TakeoffDoc): TakeoffDoc {
  const out: TakeoffDoc = { ...target, pushed: cur.pushed };
  if (cur.lastPush) out.lastPush = cur.lastPush;
  else delete out.lastPush;
  return out;
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

  // Load on job change; flush the previous job's pending write first.
  useEffect(() => {
    flush();
    projectRef.current = projectId;
    past.current = [];
    future.current = [];
    docRef.current = EMPTY_TAKEOFF_DOC;
    setDoc(EMPTY_TAKEOFF_DOC);
    syncHist();
    if (!projectId) {
      loadedRef.current = true;
      setLoaded(true);
      return;
    }
    loadedRef.current = false;
    setLoaded(false);
    let cancelled = false;
    const finish = (raw: string | null) => {
      if (cancelled || projectRef.current !== projectId) return;
      const parsed = parseTakeoffDoc(raw);
      docRef.current = parsed;
      setDoc(parsed);
      loadedRef.current = true;
      setLoaded(true);
    };
    try {
      AsyncStorage.getItem(takeoffDocKey(projectId)).then(finish, () => finish(null));
    } catch {
      finish(null);
    }
    return () => { cancelled = true; };
  }, [projectId, flush, syncHist]);

  // Flush on unmount.
  useEffect(() => () => flush(), [flush]);

  const commit = useCallback((next: TakeoffDoc) => {
    docRef.current = next;
    setDoc(next);
    scheduleWrite(next);
  }, [scheduleWrite]);

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

  return {
    doc,
    loaded,
    update,
    record,
    undo,
    redo,
    canUndo: hist.canUndo,
    canRedo: hist.canRedo,
  };
}
