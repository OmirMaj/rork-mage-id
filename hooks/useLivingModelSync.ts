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
//   * send an EMPTY model over an account copy that has rooms. Start a New
//     Model, a model key that went missing, and a model he emptied all lead to
//     the account's copy being taken or put to him, never written over.
//   * send a scanned room for the first time before he has said yes to it.
//   * send anything after Keep on This Phone: a save still waiting in the
//     queue is taken back out, and a run that was in flight stops.
//   * take a teammate's save without first setting this device's model aside
//     (when the kept place is free), or take an account copy larger than the
//     app allows.
//   * delete the account's copy, except from his own confirmed tap.
//   * queue anything for a database that does not have the table.
//   * write over a saved model that could not be read (LoadState 'unreadable').
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { generateUUID } from '@/utils/generateId';
import { isSampleProject } from '@/utils/sampleGuard';
import { readSavedModel } from '@/utils/livingModel/modelCore';
import { saveJobModel } from '@/utils/livingModel/store';
import { mayWriteModel, type LoadState } from '@/utils/livingModel/storeCore';
import {
  accountMayHoldCopy, accountModelRefusal, accountValueTooLarge, deviceChanged, hasSyncHistory, isSyncableProjectId, isThisDevice,
  metaAfterKeepDevice, metaAfterMatch, metaAfterRemoval, metaAfterScanNo, metaAfterScanYes, metaAfterSend, modelFingerprint, modelHasContent,
  parseSyncMeta, reconcile, resetSyncBase, savedBySomeoneElse, scanGate, scanRoomIds, settleLandedPending, unaskedScanRoomIds,
  type ModelSyncMeta, type ReconcileAction, type ScanChoice, type ServerHead, type SyncStatus,
} from '@/utils/livingModel/syncCore';
import {
  accountQueueHolds, accountReachable, accountSessionUserId, cancelQueuedAccountSave, fetchAccountHead, fetchAccountModel, kickAccountQueueDrain,
  onAccountQueueSignal, pushAccountModel, recordScanUploadYes, removeAccountModel,
} from '@/utils/livingModel/syncIo';
import { readKeptModel, readSyncMeta, recoverKeptSwap, removeKeptModel, swapKeptModel, writeKeptModel, writeSyncMeta, type KeptModel } from '@/utils/livingModel/syncStore';
import type { JobModel } from '@/utils/livingModel/types';

/** How long after the last change a save is sent. */
export const SYNC_DEBOUNCE_MS = 1500;
/** How long after a read that did not get through the account is asked again. */
export const SYNC_RETRY_MS = 8000;
/** How many times one run may decide again before it stops and schedules a later try. */
export const SYNC_MAX_TURNS = 6;

export interface LivingModelSyncInput {
  projectId: string;
  userId: string | null;
  project: { name?: string | null } | null | undefined;
  /** The model on screen. null while the device is still being read. */
  model: JobModel | null;
  loadState: LoadState;
  /** False when nothing was stored under the model key when the screen opened (store.loadJobModel `found`). */
  modelFound: boolean;
  /** True when his seat on this job reads the model and may not change it (a viewer or a field seat). Nothing is sent. */
  viewOnly: boolean;
  /** The language the scan question is shown in, for the record of his yes. */
  lang: 'en' | 'es';
  /** The device's model was replaced (the account's was taken, or a kept one brought back): show this one. */
  onAdopt: (model: JobModel) => void;
}

export interface AccountConflict {
  /** The account's model, as read. Not on screen and not written anywhere until the person chooses. */
  account: JobModel;
  head: ServerHead;
  /** True when the model on this device has nothing in it (a new model, or one he emptied). */
  deviceEmpty: boolean;
}

export interface LastChange {
  byMe: boolean;
  userId: string | null;
  at: string;
}

/** What became of Remove It from My Account. */
export type RemoveState = 'idle' | 'removed' | 'failed';

export interface LivingModelSync {
  status: SyncStatus;
  /** The server's time of the account copy this device matches. */
  savedAt: string | null;
  /** Who saved the account's copy and when, when it was not this device. */
  lastChange: LastChange | null;
  conflict: AccountConflict | null;
  kept: KeptModel | null;
  scanChoice: ScanChoice;
  /** The scanned rooms the question is about: not in the account, and no yes on record for them. */
  scanAskRoomIds: string[];
  /** The scanned rooms known to be in the account's copy. */
  accountScanRoomIds: string[];
  /** True once any save was handed to the queue or the wire, or a revision was matched: a copy may be in the account. */
  accountMayHold: boolean;
  removeState: RemoveState;
  /** A choice is being carried out. */
  busy: boolean;
  /** The last choice could not be carried out because the device refused to keep the other model. Nothing was replaced. */
  choiceFailed: boolean;
  answerScan: (choice: 'account' | 'device') => void;
  keepThisDevice: () => void;
  takeAccountModel: () => void;
  bringBackKept: () => void;
  removeKept: () => void;
  /** Delete the account's copy. Called only from the confirm button. The device's model is not touched. */
  removeFromAccount: () => void;
  /** After the account copy was removed elsewhere: send this device's model again, from the start. */
  saveAgain: () => void;
}

export function useLivingModelSync({ projectId, userId, project, model, loadState, modelFound, viewOnly, lang, onAdopt }: LivingModelSyncInput): LivingModelSync {
  const [status, setStatus] = useState<SyncStatus>('device');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [lastChange, setLastChange] = useState<LastChange | null>(null);
  const [conflict, setConflict] = useState<AccountConflict | null>(null);
  const [kept, setKept] = useState<KeptModel | null>(null);
  const [scanChoice, setScanChoice] = useState<ScanChoice>('unasked');
  const [busy, setBusy] = useState(false);
  const [choiceFailed, setChoiceFailed] = useState(false);
  const [removeState, setRemoveState] = useState<RemoveState>('idle');
  /** The fingerprint of the model the account is known to hold (the notes' baseFingerprint, as state). */
  const [matched, setMatched] = useState<string | null>(null);
  /** The notes as last committed, for what the screen reads from them. */
  const [notes, setNotes] = useState<ModelSyncMeta | null>(null);

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
  const viewOnlyRef = useRef(viewOnly);
  const modelFoundRef = useRef(modelFound);
  const langRef = useRef(lang);
  /** The run that follows the first read of the device is not delayed. */
  const opened = useRef(-1);
  /** Once per opening: the notes were set against a model key that is missing, and against Start a New Model. */
  const lostChecked = useRef(-1);
  const startedNewDone = useRef(-1);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // After the hook replaces the device's model, the very next run must read THAT model, not the one the screen
  // has not redrawn yet (a run on the old one would send it over the account). The override ends the moment the
  // screen hands down a different model, whatever it is.
  if (adopted.current && model !== adopted.current.from) adopted.current = null;
  modelRef.current = adopted.current ? adopted.current.model : model;
  propRef.current = model;
  loadStateRef.current = loadState;
  onAdoptRef.current = onAdopt;
  viewOnlyRef.current = viewOnly;
  modelFoundRef.current = modelFound;
  langRef.current = lang;
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
    setNotes(meta);
    await writeSyncMeta(userId, projectId, meta);
  }, [userId, projectId]);

  const runRef = useRef<() => void>(() => {});
  /** Look at the account again in a while (a read did not get through, or a run stopped at its turn limit). */
  const scheduleRetry = useCallback(() => {
    const my = gen.current;
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = setTimeout(() => { retryTimer.current = null; if (gen.current === my) runRef.current(); }, SYNC_RETRY_MS);
  }, []);

  /** Hand one save to the offline queue, after the seat, the scan question and the queue checks. */
  const send = useCallback(async (my: number, m: JobModel, meta: ModelSyncMeta, fingerprint: string, base: number, holds: Awaited<ReturnType<typeof accountQueueHolds>>) => {
    const live = () => gen.current === my;
    if (viewOnlyRef.current) { setStatus('view_only'); return; }
    const gate = scanGate(m, meta);
    if (gate === 'ask') { setStatus('scan_ask'); return; }
    if (gate === 'device') { setStatus('kept_on_device'); return; }
    if (holds === null || holds.modelSave || holds.projectInsert) { setStatus('waiting'); kickAccountQueueDrain(); return; }
    if (refused.current === fingerprint) { setStatus('failed'); return; }
    const writeId = generateUUID();
    const sending = metaAfterSend(meta, { writeId, base, fingerprint, scanRoomIds: scanRoomIds(m) });
    await commit(sending);
    if (!live()) return;
    // He answered a question while the notes were being written (Keep on This Phone): this save is not sent.
    if (metaRef.current !== sending) { again.current = true; return; }
    const outcome = await pushAccountModel(projectId, m, base, writeId);
    if (!live()) return;
    // He tapped Keep on This Phone (or anything else that changed the notes) while the save was on the wire: stop here, decide again.
    if (metaRef.current !== sending) { again.current = true; return; }
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
    if (metaRef.current !== sending) { again.current = true; return; }
    if (back.kind === 'row' && back.head.writeId === writeId) {
      await commit(metaAfterMatch(sending, back.head, fingerprint, scanRoomIds(m)));
      if (!live()) return;
      setLastChange(null);
      if (modelFingerprint(modelRef.current ?? m) !== fingerprint) again.current = true;
      else setStatus('saved');
      return;
    }
    // The save went out and the row could not be read back. The save is still in the notes: say so, and look again soon.
    if (back.kind === 'offline' || back.kind === 'error' || back.kind === 'missing') { setStatus('retrying'); scheduleRetry(); return; }
    // The row is someone else's by now. If it remembers this save, this save landed and the account is ahead.
    if (back.kind === 'row' && settleLandedPending(sending, back.head) !== sending) { again.current = true; return; }
    const revisionNow = back.kind === 'row' ? back.head.revision : 0;
    await commit({ ...sending, pending: null });
    if (!live()) return;
    if (revisionNow !== base) { again.current = true; return; }
    // Same revision and not this save: the account answered and did not take it (too large, or a newer build's model).
    refused.current = fingerprint;
    setStatus('failed');
  }, [projectId, commit, scheduleRetry]);

  const pass = useCallback(async (my: number) => {
    const live = () => gen.current === my;
    const m = modelRef.current;
    let meta = metaRef.current;
    if (!m || !meta) return;
    if (!eligibleRef.current || !accountReachable() || !mayWriteModel(loadStateRef.current)) { setStatus('device'); return; }
    // The notes say "matched the account" and the model they speak of is not on this device (the key was lost),
    // or he tapped Start a New Model: forget the match, so the account's copy is looked at first and never written over.
    if (lostChecked.current !== my) {
      lostChecked.current = my;
      if (!modelFoundRef.current && meta.baseRevision > 0 && hasSyncHistory(meta)) { meta = resetSyncBase(meta, { startedNew: false }); await commit(meta); if (!live()) return; }
    }
    if (loadStateRef.current === 'started_new' && startedNewDone.current !== my) {
      startedNewDone.current = my;
      meta = resetSyncBase(meta, { startedNew: true });
      await commit(meta);
      if (!live()) return;
    }
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
    // A tap changed the notes while the account was being read (Keep on This Phone, a scan answer): decide again from them.
    if (metaRef.current !== meta) { again.current = true; return; }
    const pendingQueued = holds === null ? !!meta.pending : holds.modelSave;

    if (first.kind === 'offline' || first.kind === 'error') {
      if (!meta.accountSeen) { setStatus('device'); return; }
      if (meta.pending && pendingQueued) { setStatus('waiting'); return; }
      if (!deviceChanged(meta, local)) { setStatus(meta.baseRevision > 0 ? 'saved' : 'empty'); return; }
      if (first.kind === 'error') { setStatus('failed'); return; }
      // An empty model is never queued blind: whether the account holds something is not known from here.
      if (!local.hasContent) { setStatus('waiting'); return; }
      // Offline with something to send, and the table is known to exist: hand the save to the queue, based on the revision this device last matched.
      await send(my, m, meta, local.fingerprint, meta.baseRevision, holds);
      return;
    }

    if (!meta.accountSeen) { meta = { ...meta, accountSeen: true }; await commit(meta); if (!live()) return; }
    let head: ServerHead | null = first.kind === 'row' ? first.head : null;
    // A save of this device's that landed and was then saved over by someone else: the notes stand on it from here.
    if (head && !pendingQueued) {
      const settled = settleLandedPending(meta, head);
      if (settled !== meta) { meta = settled; await commit(meta); if (!live()) return; }
    }
    let accountModel: JobModel | null = null;
    let fingerprint: string | null | undefined;
    const serverOf = (h: ServerHead) => ({ revision: h.revision, writeId: h.writeId, schemaVersion: h.schemaVersion, recentWrites: h.recentWrites });
    let action: ReconcileAction = reconcile({ local, meta, server: head ? serverOf(head) : null, pendingQueued });
    if (action.kind === 'need_model' || action.kind === 'take_server') {
      const full = await fetchAccountModel(projectId);
      if (!live()) return;
      if (metaRef.current !== meta) { again.current = true; return; }
      if (full.kind === 'missing') { setStatus('device'); return; }
      if (full.kind === 'offline' || full.kind === 'error') {
        if (deviceChanged(meta, local)) { setStatus(full.kind === 'offline' ? 'waiting' : 'failed'); return; }
        setStatus('retrying');
        scheduleRetry();
        return;
      }
      if (full.kind === 'none') { again.current = true; return; }
      head = full.head;
      // Counted before it is read: an account copy larger than the app allows is not walked, not opened and not written over.
      const tooLarge = accountValueTooLarge(full.value);
      const read = tooLarge ? null : readSavedModel(JSON.stringify(full.value ?? null), projectId);
      accountModel = read && read.state === 'ok' ? read.model : null;
      fingerprint = tooLarge ? undefined : accountModel ? modelFingerprint(accountModel) : null;
      const outOfBounds = tooLarge || (accountModel !== null && accountModelRefusal(accountModel) !== null);
      action = reconcile({ local, meta, server: { ...serverOf(head), fingerprint, hasContent: accountModel ? modelHasContent(accountModel) : undefined, outOfBounds }, pendingQueued });
    }
    setLastChange(head && !isThisDevice(meta, head) ? { byMe: head.updatedBy === userId, userId: head.updatedBy, at: head.updatedAt } : null);

    switch (action.kind) {
      case 'nothing':
        // Nothing here and nothing there. Notes that still speak of an account copy are cleared: there is none.
        if (hasSyncHistory(meta) && !meta.pending) { await commit(metaAfterRemoval(meta)); if (!live()) return; }
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
        // A TEAMMATE's save is about to take this device's place: this device's model is set aside first, when the
        // kept place is free. If the device refuses to keep it, nothing is replaced.
        let aside: KeptModel | null = null;
        if (savedBySomeoneElse(head, userId) && local.hasContent && !keptRef.current) {
          aside = { from: 'device', model: m, keptAt: new Date().toISOString(), why: 'teammate' };
          if (!(await writeKeptModel(userId, projectId, aside))) { setChoiceFailed(true); setStatus('retrying'); scheduleRetry(); return; }
          keptRef.current = aside;
          setKept(aside);
          if (!live()) return;
        }
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
        const c: AccountConflict = { account: accountModel, head, deviceEmpty: !local.hasContent };
        conflictRef.current = c;
        setConflict(c);
        setStatus('conflict');
        return;
      }
      case 'account_unreadable':
        setStatus('account_newer');
        return;
      case 'account_refused':
        setStatus('account_too_large');
        return;
      case 'account_gone':
        // The account copy this device matched is not there any more. Nothing is sent until he asks.
        setStatus('account_removed');
        return;
      case 'need_model':
        again.current = true;
        return;
    }
  }, [projectId, userId, commit, send, adopt, scheduleRetry]);

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
        } while (again.current && gen.current === my && turns < SYNC_MAX_TURNS);
        // The turn limit: this run did not reach an answer. Say what is true (it is on this device, the account
        // is not settled yet) and try again in a while. The line is never left on "Checking your account".
        if (again.current && gen.current === my) { setStatus('retrying'); scheduleRetry(); }
      } catch {
        if (gen.current === my) setStatus('failed');
      } finally {
        running.current = false;
      }
    })();
  }, [pass, scheduleRetry]);
  runRef.current = run;

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
    setNotes(null);
    setChoiceFailed(false);
    setRemoveState('idle');
    setStatus(eligibleRef.current && accountReachable() ? 'checking' : 'device');
    void (async () => {
      // A trade of the kept model that a kill cut short is finished before either model is read.
      await recoverKeptSwap(userId, projectId, new Date().toISOString());
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
      setNotes(meta);
      run();
    })();
    return () => {
      gen.current += 1;
      if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }
    };
  }, [userId, projectId, run]);

  // A moment after each change (and once when the device's model has been read). The fingerprint is worked out
  // when the model changes, not at every draw.
  const fingerprintNow = useMemo(() => (model ? modelFingerprint(model) : null), [model]);
  useEffect(() => {
    if (fingerprintNow === null) return;
    if (refused.current !== fingerprintNow) refused.current = null;
    const first = opened.current !== gen.current;
    opened.current = gen.current;
    const t = setTimeout(run, first ? 0 : SYNC_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [fingerprintNow, loadState, eligible, viewOnly, run]);

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
    const m = modelRef.current;
    if (!meta) return;
    refused.current = null;
    setRemoveState('idle');
    if (choice === 'account') {
      if (!m) return;
      // His yes covers the scanned rooms in the model at this moment, by id. The record of it is sent to the account, best effort.
      const asked = unaskedScanRoomIds(m, meta).length > 0;
      void commit(metaAfterScanYes(meta, m)).then(() => { if (asked) recordScanUploadYes(userId, langRef.current); }).then(run, run);
      return;
    }
    // Keep on This Phone. The notes are written FIRST (no run sends after this), then this job's waiting save is
    // taken back out of the queue. A request already on the wire cannot be recalled: the screen says a copy may be there.
    void commit(metaAfterScanNo(meta)).then(() => cancelQueuedAccountSave(projectId, userId)).then(run, run);
  }, [commit, run, projectId, userId]);

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
    // This device's model now stands on the account's revision, by his choice over THAT revision: the next run sends it.
    await commit(metaAfterKeepDevice(meta, c.head, modelFingerprint(c.account), scanRoomIds(c.account)));
    conflictRef.current = null;
    setConflict(null);
    return true;
  }), [choose, commit, userId, projectId]);

  const takeAccountModel = useCallback(() => choose(async () => {
    const c = conflictRef.current;
    const meta = metaRef.current;
    const mine = modelRef.current;
    if (!c || !meta || !mine || keptRef.current) return false;
    // An empty model is not worth setting aside (and would take the one kept place).
    if (modelHasContent(mine)) {
      const k: KeptModel = { from: 'device', model: mine, keptAt: new Date().toISOString() };
      if (!(await writeKeptModel(userId, projectId, k))) return false;
      keptRef.current = k;
      setKept(k);
    }
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
    // The trade: the kept model is copied under a third key first, so a kill between the two writes loses neither.
    const swapped = await swapKeptModel(userId, projectId, mine, k, new Date().toISOString(), loadStateRef.current);
    if (!swapped) return false;
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

  const removeFromAccount = useCallback(() => {
    const my = gen.current;
    const meta = metaRef.current;
    // Only after Keep on This Phone, and only from the confirm button: the model on this device is not touched.
    if (!meta || meta.scanChoice !== 'device') return;
    setBusy(true);
    setRemoveState('idle');
    void (async () => {
      await cancelQueuedAccountSave(projectId, userId);
      const out = await removeAccountModel(projectId, userId);
      if (gen.current !== my) return;
      if (out === 'removed' && metaRef.current) await commit(metaAfterRemoval(metaRef.current));
      if (gen.current !== my) return;
      setRemoveState(out === 'removed' ? 'removed' : 'failed');
    })().catch(() => { if (gen.current === my) setRemoveState('failed'); }).finally(() => { if (gen.current === my) setBusy(false); });
  }, [commit, projectId, userId]);

  const saveAgain = useCallback(() => {
    const meta = metaRef.current;
    if (!meta) return;
    refused.current = null;
    // From the start: nothing is matched, and a scanned room is asked about again before it is sent.
    void commit({ ...metaAfterRemoval(meta), scanChoice: 'unasked' }).then(run, run);
  }, [commit, run]);

  // "Saved to your account." is true of the model the account holds. The moment the model on screen is a different
  // one (a change that has not been sent yet) the line is the waiting one, until the next save is read back. A seat
  // that may not change the model is told so instead: nothing of his is waiting to be sent.
  const unsent = status === 'saved' && fingerprintNow !== null && fingerprintNow !== matched;
  const shown: SyncStatus = unsent ? (viewOnly ? 'view_only' : 'waiting') : status;
  const scanAskRoomIds = useMemo(() => (model && notes ? unaskedScanRoomIds(model, notes) : []), [model, notes]);
  const accountScanRoomIds = useMemo(() => notes?.accountScanRoomIds ?? [], [notes]);
  const accountMayHold = notes ? accountMayHoldCopy(notes) : false;
  return {
    status: shown, savedAt, lastChange, conflict, kept, scanChoice, scanAskRoomIds, accountScanRoomIds, accountMayHold, removeState, busy, choiceFailed,
    answerScan, keepThisDevice, takeAccountModel, bringBackKept, removeKept, removeFromAccount, saveAgain,
  };
}
