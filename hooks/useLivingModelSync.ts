// hooks/useLivingModelSync.ts — runs the saving of one job model to the
// person's account (lane LIVINGSYNC). The rules are utils/livingModel/syncCore
// (pure); the server is utils/livingModel/syncIo (through the offline queue);
// the device is utils/livingModel/syncStore and store.
//
// WHEN IT RUNS: when the screen opens (which is also every sign-in, because the
// screen is keyed on the person), a moment after each change, when the offline
// queue moves, and when the app comes back to the front. Each run reads the
// account's row and asks syncCore.reconcile what to do.
//
// WHAT IT NEVER DOES:
//   * choose between two changed models. `conflict` stops here and waits for
//     the person's tap; the model he does not keep is written under the kept
//     key FIRST, and if that write fails the choice is not carried out.
//   * send a scanned room for the first time before he has said yes.
//   * queue anything for a database that does not have the table.
//   * write over a saved model that could not be read (LoadState 'unreadable').
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { generateUUID } from '@/utils/generateId';
import { isSampleProject } from '@/utils/sampleGuard';
import { readSavedModel } from '@/utils/livingModel/modelCore';
import { saveJobModel } from '@/utils/livingModel/store';
import { mayWriteModel, type LoadState } from '@/utils/livingModel/storeCore';
import {
  deviceChanged, isSyncableProjectId, isThisDevice, metaAfterMatch, metaAfterSend, modelFingerprint, modelHasContent,
  parseSyncMeta, reconcile, scanGate, scanRoomIds,
  type ModelSyncMeta, type ReconcileAction, type ScanChoice, type ServerHead, type SyncStatus,
} from '@/utils/livingModel/syncCore';
import {
  accountQueueHolds, accountReachable, accountSessionUserId, fetchAccountHead, fetchAccountModel, kickAccountQueueDrain,
  onAccountQueueSignal, pushAccountModel,
} from '@/utils/livingModel/syncIo';
import { readKeptModel, readSyncMeta, removeKeptModel, writeKeptModel, writeSyncMeta, type KeptModel } from '@/utils/livingModel/syncStore';
import type { JobModel } from '@/utils/livingModel/types';

/** How long after the last change a save is sent. */
export const SYNC_DEBOUNCE_MS = 1500;

export interface LivingModelSyncInput {
  projectId: string;
  userId: string | null;
  project: { name?: string | null } | null | undefined;
  /** The model on screen. null while the device is still being read. */
  model: JobModel | null;
  loadState: LoadState;
  /** The device's model was replaced (the account's was taken, or a kept one brought back): show this one. */
  onAdopt: (model: JobModel) => void;
}

export interface AccountConflict {
  /** The account's model, as read. Not on screen and not written anywhere until the person chooses. */
  account: JobModel;
  head: ServerHead;
}

export interface LastChange {
  byMe: boolean;
  userId: string | null;
  at: string;
}

export interface LivingModelSync {
  status: SyncStatus;
  /** The server's time of the account copy this device matches. */
  savedAt: string | null;
  /** Who saved the account's copy and when, when it was not this device. */
  lastChange: LastChange | null;
  conflict: AccountConflict | null;
  kept: KeptModel | null;
  scanChoice: ScanChoice;
  /** A choice is being carried out. */
  busy: boolean;
  /** The last choice could not be carried out because the device refused to keep the other model. Nothing was replaced. */
  choiceFailed: boolean;
  answerScan: (choice: 'account' | 'device') => void;
  keepThisDevice: () => void;
  takeAccountModel: () => void;
  bringBackKept: () => void;
  removeKept: () => void;
}

export function useLivingModelSync({ projectId, userId, project, model, loadState, onAdopt }: LivingModelSyncInput): LivingModelSync {
  const [status, setStatus] = useState<SyncStatus>('device');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [lastChange, setLastChange] = useState<LastChange | null>(null);
  const [conflict, setConflict] = useState<AccountConflict | null>(null);
  const [kept, setKept] = useState<KeptModel | null>(null);
  const [scanChoice, setScanChoice] = useState<ScanChoice>('unasked');
  const [busy, setBusy] = useState(false);
  const [choiceFailed, setChoiceFailed] = useState(false);
  /** The fingerprint of the model the account is known to hold (the notes' baseFingerprint, as state). */
  const [matched, setMatched] = useState<string | null>(null);

  const gen = useRef(0);
  const metaRef = useRef<ModelSyncMeta | null>(null);
  const modelRef = useRef<JobModel | null>(model);
  const loadStateRef = useRef<LoadState>(loadState);
  const conflictRef = useRef<AccountConflict | null>(null);
  const keptRef = useRef<KeptModel | null>(null);
  const running = useRef(false);
  const again = useRef(false);
  /** The fingerprint the account refused, so the same model is not sent in a loop. A change or a reopen clears it. */
  const refused = useRef<string | null>(null);
  const onAdoptRef = useRef(onAdopt);
  const propRef = useRef<JobModel | null>(model);
  const adopted = useRef<{ model: JobModel; from: JobModel | null } | null>(null);
  const sample = !!project && isSampleProject(project as Parameters<typeof isSampleProject>[0]);
  const eligibleRef = useRef(false);
  /** The run that follows the first read of the device is not delayed. */
  const opened = useRef(-1);
  // After the hook replaces the device's model, the very next run must read THAT model, not the one the screen
  // has not redrawn yet (a run on the old one would send it over the account). The override ends the moment the
  // screen hands down a different model, whatever it is.
  if (adopted.current && model !== adopted.current.from) adopted.current = null;
  modelRef.current = adopted.current ? adopted.current.model : model;
  propRef.current = model;
  loadStateRef.current = loadState;
  onAdoptRef.current = onAdopt;
  const eligible = !!userId && !!project && !sample && isSyncableProjectId(projectId);
  eligibleRef.current = eligible;

  /** The device's model is now `m`: every later run reads it, and the screen is told to show it. */
  const adopt = useCallback((m: JobModel) => {
    adopted.current = { model: m, from: propRef.current };
    modelRef.current = m;
    onAdoptRef.current(m);
  }, []);

  const commit = useCallback(async (meta: ModelSyncMeta) => {
    metaRef.current = meta;
    setScanChoice(meta.scanChoice);
    setSavedAt(meta.savedAt);
    setMatched(meta.baseFingerprint);
    await writeSyncMeta(userId, projectId, meta);
  }, [userId, projectId]);

  /** Hand one save to the offline queue, after the scan question and the queue checks. */
  const send = useCallback(async (my: number, m: JobModel, meta: ModelSyncMeta, fingerprint: string, base: number, holds: Awaited<ReturnType<typeof accountQueueHolds>>) => {
    const live = () => gen.current === my;
    const gate = scanGate(m, meta);
    if (gate === 'ask') { setStatus('scan_ask'); return; }
    if (gate === 'device') { setStatus('kept_on_device'); return; }
    if (holds === null || holds.modelSave || holds.projectInsert) { setStatus('waiting'); kickAccountQueueDrain(); return; }
    if (refused.current === fingerprint) { setStatus('failed'); return; }
    const writeId = generateUUID();
    const sending = metaAfterSend(meta, { writeId, base, fingerprint, scanRoomIds: scanRoomIds(m) });
    await commit(sending);
    if (!live()) return;
    const outcome = await pushAccountModel(projectId, m, base, writeId);
    if (!live()) return;
    if (outcome === 'queued') { setStatus('waiting'); return; }
    if (outcome === 'failed') {
      refused.current = fingerprint;
      await commit({ ...sending, pending: null });
      if (live()) setStatus('failed');
      return;
    }
    // The function answered. Read the row back: only the row says whether THIS save is the one that stands.
    const back = await fetchAccountHead(projectId);
    if (!live()) return;
    if (back.kind === 'row' && back.head.writeId === writeId) {
      await commit(metaAfterMatch(sending, back.head, fingerprint, scanRoomIds(m)));
      if (!live()) return;
      setLastChange(null);
      if (modelFingerprint(modelRef.current ?? m) !== fingerprint) again.current = true;
      else setStatus('saved');
      return;
    }
    if (back.kind === 'offline' || back.kind === 'error' || back.kind === 'missing') { setStatus('checking'); return; }
    const revisionNow = back.kind === 'row' ? back.head.revision : 0;
    await commit({ ...sending, pending: null });
    if (!live()) return;
    if (revisionNow !== base) { again.current = true; return; }
    // Same revision and not this save: the account answered and did not take it (too large, or a newer build's model).
    refused.current = fingerprint;
    setStatus('failed');
  }, [projectId, commit]);

  const pass = useCallback(async (my: number) => {
    const live = () => gen.current === my;
    const m = modelRef.current;
    let meta = metaRef.current;
    if (!m || !meta) return;
    if (!eligibleRef.current || !accountReachable() || !mayWriteModel(loadStateRef.current)) { setStatus('device'); return; }
    if (meta.scanChoice === 'device') { setStatus('kept_on_device'); return; }
    if (conflictRef.current) { setStatus('conflict'); return; }
    const session = await accountSessionUserId();
    if (!live()) return;
    if (!session || session !== userId) { setStatus('device'); return; }

    const local = { hasContent: modelHasContent(m), fingerprint: modelFingerprint(m) };
    const holds = await accountQueueHolds(projectId);
    const first = await fetchAccountHead(projectId);
    if (!live()) return;
    if (first.kind === 'missing') { setStatus('device'); return; }
    const pendingQueued = holds === null ? !!meta.pending : holds.modelSave;

    if (first.kind === 'offline' || first.kind === 'error') {
      if (!meta.accountSeen) { setStatus('device'); return; }
      if (meta.pending && pendingQueued) { setStatus('waiting'); return; }
      if (!deviceChanged(meta, local)) { setStatus(meta.baseRevision > 0 ? 'saved' : 'empty'); return; }
      if (first.kind === 'error') { setStatus('failed'); return; }
      // Offline with something to send, and the table is known to exist: hand the save to the queue, based on the revision this device last matched.
      await send(my, m, meta, local.fingerprint, meta.baseRevision, holds);
      return;
    }

    if (!meta.accountSeen) { meta = { ...meta, accountSeen: true }; await commit(meta); if (!live()) return; }
    let head: ServerHead | null = first.kind === 'row' ? first.head : null;
    let accountModel: JobModel | null = null;
    let fingerprint: string | null | undefined;
    let action: ReconcileAction = reconcile({ local, meta, server: head ? { revision: head.revision, writeId: head.writeId, schemaVersion: head.schemaVersion } : null, pendingQueued });
    if (action.kind === 'need_model' || action.kind === 'take_server') {
      const full = await fetchAccountModel(projectId);
      if (!live()) return;
      if (full.kind === 'missing') { setStatus('device'); return; }
      if (full.kind === 'offline' || full.kind === 'error') { setStatus(deviceChanged(meta, local) ? (full.kind === 'offline' ? 'waiting' : 'failed') : 'checking'); return; }
      if (full.kind === 'none') { again.current = true; return; }
      head = full.head;
      const read = readSavedModel(JSON.stringify(full.value ?? null), projectId);
      accountModel = read.state === 'ok' ? read.model : null;
      fingerprint = accountModel ? modelFingerprint(accountModel) : null;
      action = reconcile({ local, meta, server: { revision: head.revision, writeId: head.writeId, schemaVersion: head.schemaVersion, fingerprint }, pendingQueued });
    }
    setLastChange(head && !isThisDevice(meta, head) ? { byMe: head.updatedBy === userId, userId: head.updatedBy, at: head.updatedAt } : null);

    switch (action.kind) {
      case 'nothing':
        setStatus('empty');
        return;
      case 'wait':
        setStatus('waiting');
        kickAccountQueueDrain();
        return;
      case 'landed': {
        if (!head || !meta.pending) return;
        const sent = meta.pending;
        await commit(metaAfterMatch(meta, head, sent.fingerprint, sent.scanRoomIds));
        if (!live()) return;
        setLastChange(null);
        if (modelFingerprint(modelRef.current ?? m) !== sent.fingerprint) again.current = true;
        else setStatus('saved');
        return;
      }
      case 'in_sync':
        if (!head) return;
        if (meta.baseRevision !== head.revision || meta.baseFingerprint !== local.fingerprint || meta.pending) {
          await commit(metaAfterMatch(meta, head, local.fingerprint, scanRoomIds(m)));
          if (!live()) return;
        } else if (meta.savedAt !== head.updatedAt) {
          await commit({ ...meta, savedAt: head.updatedAt });
          if (!live()) return;
        }
        setStatus('saved');
        return;
      case 'push':
        await send(my, m, meta, local.fingerprint, action.base, holds);
        return;
      case 'take_server': {
        if (!head || !accountModel || fingerprint == null) { setStatus('account_newer'); return; }
        // He changed something while the account was being read: decide again with the model as it is now.
        if (modelFingerprint(modelRef.current ?? m) !== local.fingerprint) { again.current = true; return; }
        const ok = await saveJobModel(userId, accountModel, new Date().toISOString(), loadStateRef.current);
        if (!live()) return;
        if (!ok) { setStatus('failed'); return; }
        // A change made in the instant the account's model was being written is his and stands: put it back and decide again.
        const now = modelRef.current ?? m;
        if (modelFingerprint(now) !== local.fingerprint) {
          await saveJobModel(userId, now, new Date().toISOString(), loadStateRef.current);
          again.current = true;
          return;
        }
        await commit(metaAfterMatch(meta, head, fingerprint, scanRoomIds(accountModel)));
        if (!live()) return;
        adopt(accountModel);
        setStatus('saved');
        return;
      }
      case 'conflict': {
        if (!head || !accountModel) { setStatus('account_newer'); return; }
        const c: AccountConflict = { account: accountModel, head };
        conflictRef.current = c;
        setConflict(c);
        setStatus('conflict');
        return;
      }
      case 'account_unreadable':
        setStatus('account_newer');
        return;
      case 'need_model':
        again.current = true;
        return;
    }
  }, [projectId, userId, commit, send, adopt]);

  const run = useCallback(() => {
    const my = gen.current;
    if (running.current) { again.current = true; return; }
    running.current = true;
    void (async () => {
      try {
        let turns = 0;
        do {
          again.current = false;
          await pass(my);
          turns += 1;
        } while (again.current && gen.current === my && turns < 6);
      } catch {
        if (gen.current === my) setStatus('failed');
      } finally {
        running.current = false;
      }
    })();
  }, [pass]);

  // Open (and sign-in: the person is part of the key).
  useEffect(() => {
    gen.current += 1;
    const my = gen.current;
    metaRef.current = null;
    conflictRef.current = null;
    keptRef.current = null;
    refused.current = null;
    adopted.current = null;
    setConflict(null);
    setKept(null);
    setLastChange(null);
    setSavedAt(null);
    setScanChoice('unasked');
    setMatched(null);
    setChoiceFailed(false);
    setStatus(eligibleRef.current && accountReachable() ? 'checking' : 'device');
    void (async () => {
      const [meta, k] = await Promise.all([
        readSyncMeta(userId, projectId).catch(() => parseSyncMeta(null)),
        readKeptModel(userId, projectId).catch(() => null),
      ]);
      if (gen.current !== my) return;
      metaRef.current = meta;
      keptRef.current = k;
      setKept(k);
      setScanChoice(meta.scanChoice);
      setSavedAt(meta.savedAt);
      setMatched(meta.baseFingerprint);
      run();
    })();
    return () => { gen.current += 1; };
  }, [userId, projectId, run]);

  // A moment after each change (and once when the device's model has been read).
  const fingerprintNow = model ? modelFingerprint(model) : null;
  useEffect(() => {
    if (fingerprintNow === null) return;
    if (refused.current !== fingerprintNow) refused.current = null;
    const first = opened.current !== gen.current;
    opened.current = gen.current;
    const t = setTimeout(run, first ? 0 : SYNC_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [fingerprintNow, loadState, eligible, run]);

  // The queue moved, or the app came back to the front.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const later = () => { if (t) clearTimeout(t); t = setTimeout(run, 400); };
    const off = onAccountQueueSignal(later);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') later(); });
    return () => { off(); sub.remove(); if (t) clearTimeout(t); };
  }, [run]);

  const answerScan = useCallback((choice: 'account' | 'device') => {
    const meta = metaRef.current;
    if (!meta) return;
    refused.current = null;
    void commit({ ...meta, scanChoice: choice }).then(run);
  }, [commit, run]);

  /** Carry out one choice. `work` returns false when the other model could not be kept first. */
  const choose = useCallback((work: () => Promise<boolean>) => {
    const my = gen.current;
    setBusy(true);
    setChoiceFailed(false);
    void work().then((ok) => {
      if (gen.current !== my) return;
      if (!ok) setChoiceFailed(true);
    }).catch(() => { if (gen.current === my) setChoiceFailed(true); }).finally(() => {
      if (gen.current !== my) return;
      setBusy(false);
      run();
    });
  }, [run]);

  const keepThisDevice = useCallback(() => choose(async () => {
    const c = conflictRef.current;
    const meta = metaRef.current;
    if (!c || !meta || keptRef.current) return false;
    const k: KeptModel = { from: 'account', model: c.account, keptAt: new Date().toISOString() };
    if (!(await writeKeptModel(userId, projectId, k))) return false;
    keptRef.current = k;
    setKept(k);
    // This device's model now stands on the account's revision: the next run sends it, based on that revision.
    await commit({ ...metaAfterMatch(meta, c.head, modelFingerprint(c.account), scanRoomIds(c.account)), savedAt: meta.savedAt });
    conflictRef.current = null;
    setConflict(null);
    return true;
  }), [choose, commit, userId, projectId]);

  const takeAccountModel = useCallback(() => choose(async () => {
    const c = conflictRef.current;
    const meta = metaRef.current;
    const mine = modelRef.current;
    if (!c || !meta || !mine || keptRef.current) return false;
    const k: KeptModel = { from: 'device', model: mine, keptAt: new Date().toISOString() };
    if (!(await writeKeptModel(userId, projectId, k))) return false;
    keptRef.current = k;
    setKept(k);
    if (!(await saveJobModel(userId, c.account, new Date().toISOString(), loadStateRef.current))) return false;
    await commit(metaAfterMatch(meta, c.head, modelFingerprint(c.account), scanRoomIds(c.account)));
    conflictRef.current = null;
    setConflict(null);
    adopt(c.account);
    return true;
  }), [choose, commit, adopt, userId, projectId]);

  const bringBackKept = useCallback(() => choose(async () => {
    const k = keptRef.current;
    const mine = modelRef.current;
    if (!k || !mine || conflictRef.current) return false;
    // Swap: the model on screen is set aside before the kept one takes its place.
    const swapped: KeptModel = { from: 'device', model: mine, keptAt: new Date().toISOString() };
    if (!(await writeKeptModel(userId, projectId, swapped))) return false;
    if (!(await saveJobModel(userId, k.model, new Date().toISOString(), loadStateRef.current))) {
      await writeKeptModel(userId, projectId, k);
      return false;
    }
    keptRef.current = swapped;
    setKept(swapped);
    adopt(k.model);
    return true;
  }), [choose, adopt, userId, projectId]);

  const removeKept = useCallback(() => choose(async () => {
    if (!keptRef.current) return true;
    if (!(await removeKeptModel(userId, projectId))) return false;
    keptRef.current = null;
    setKept(null);
    return true;
  }), [choose, userId, projectId]);

  // "Saved to your account." is true of the model the account holds. The moment the model on screen is a different
  // one (a change that has not been sent yet) the line is the waiting one, until the next save is read back.
  const shown: SyncStatus = status === 'saved' && fingerprintNow !== null && fingerprintNow !== matched ? 'waiting' : status;
  return { status: shown, savedAt, lastChange, conflict, kept, scanChoice, busy, choiceFailed, answerScan, keepThisDevice, takeAccountModel, bringBackKept, removeKept };
}
