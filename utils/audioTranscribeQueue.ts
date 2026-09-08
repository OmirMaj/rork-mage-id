// utils/audioTranscribeQueue.ts — durable, offline-first queue for voice
// dictation that could not be transcribed when it was spoken.
//
// Read utils/audioTranscribeCore.ts first. Every decision this file makes
// (where the file lives, what an error means, the retry budget, dedupe, the
// cap, the write-back reconciliation, what the user is told) lives there as
// pure functions so bun can run them for real; this file is only the
// AsyncStorage + expo-file-system + transcribe-audio shell around them. Same
// split as utils/photoUploadCore.ts + utils/photoUploadQueue.ts.
//
// Contract with the UI, copied from the photo queue: enqueueing NEVER blocks
// and NEVER fails a user action, and nothing here is on the render path. It
// does report whether the recording was saved, because the modal has to tell
// the user the truth about that and "saved" is not something to guess at.
//
// Why the queue holds a PATH and not bytes: this is AsyncStorage, whose budget
// is measured in a few MB total (and on Android in a 2 MB per-row cursor). A
// single ninety-second WAV is ~2.9 MB. So an entry is a few hundred bytes of
// metadata and the audio is read off disk at upload time.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
// Legacy entrypoint: documentDirectory / getInfoAsync / makeDirectoryAsync /
// copyAsync / moveAsync / deleteAsync live on the old API and are not
// re-exported from the SDK 54 root. Same import utils/photoUploadQueue.ts and
// the other filesystem callsites in this repo already use.
import * as FileSystem from 'expo-file-system/legacy';
import { isSupabaseConfigured } from '@/lib/supabase';
import { transcribeAudio } from '@/utils/transcribeAudio';
// Who is signed in comes from the same auth-feed-backed value both other
// queues use — never a per-call getSession(), which is a NETWORK read when the
// access token has expired and would stall the enqueue on the captive-portal
// Wi-Fi this queue exists to survive.
import { currentSessionUserId, type RetainOptions, type RetainResult } from '@/utils/offlineQueue';
import {
  AUDIO_MAX_QUEUE,
  AUDIO_MAX_RETRIES,
  AUDIO_QUEUE_DIRNAME,
  AUDIO_QUEUE_KEY,
  applyTranscribeOutcome,
  audioExtFromUri,
  classifyTranscribeError,
  classifyTranscribeResult,
  enqueueAudioTranscription,
  giveUpMessage,
  parseAudioQueue,
  pendingForContext,
  pruneAudioQueue,
  readyForContext,
  reconcileAudioQueue,
  resolveTaskUri,
  serializeAudioQueue,
  sortAudioQueue,
  stagedFileName,
  takeReadyTranscript,
  type AudioTranscribeTask,
  type GiveUpReason,
} from '@/utils/audioTranscribeCore';

/**
 * Our own copy of every pending recording.
 *
 * expo-av writes a finished recording into the app's CACHE directory, which iOS
 * and Android are free to reclaim under storage pressure — so a dictation
 * queued on Monday with no signal could simply not exist on Wednesday, which is
 * the same data loss this queue was built to stop. documentDirectory is not
 * reclaimed. The copy is deleted the moment we have a transcript, or the moment
 * we give up on it.
 */
function queueDir(): string {
  return `${FileSystem.documentDirectory ?? ''}${AUDIO_QUEUE_DIRNAME}`;
}

// Same serialization discipline as the other two queues: every
// read-modify-write of the persisted queue runs one at a time, so a dictation
// recorded DURING a drain cannot be clobbered by the drain's write-back. The
// lock is never held across the (slow, network-bound) upload phase.
let queueLock: Promise<unknown> = Promise.resolve();
function withQueueLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = queueLock.then(fn, fn);
  queueLock = run.then(() => undefined, () => undefined);
  return run;
}

async function readQueueOrThrow(): Promise<AudioTranscribeTask[]> {
  return parseAudioQueue(await AsyncStorage.getItem(AUDIO_QUEUE_KEY));
}

export async function getAudioTranscribeQueue(): Promise<AudioTranscribeTask[]> {
  try {
    return await readQueueOrThrow();
  } catch {
    return [];
  }
}

/** The dictation the CURRENT session may act on. The persisted queue can also
 *  hold another tenant's recordings (kept only until the tenant switch drops
 *  them); offering this user someone else's words would be both wrong and
 *  alarming. No session → nothing is anyone's. */
export async function getOwnAudioTranscribeQueue(): Promise<AudioTranscribeTask[]> {
  const userId = await currentSessionUserId();
  if (!userId) return [];
  return (await getAudioTranscribeQueue()).filter((t) => t.userId === userId);
}

async function writeQueue(queue: AudioTranscribeTask[]): Promise<void> {
  await AsyncStorage.setItem(AUDIO_QUEUE_KEY, serializeAudioQueue(queue));
}

/**
 * A dictation is gone for good. Say so, every time. A recording silently
 * discarded after N failures is the original bug in a slower form, and there is
 * no server-side copy of a dictation to recover it from. Lazy requires keep
 * this module side-effect free at load, the same way
 * photoUploadQueue.notifyDroppedPhotos does.
 */
function announceGiveUp(reason: GiveUpReason, task: AudioTranscribeTask): void {
  const message = giveUpMessage(reason, task);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { oops } = require('@/components/animations/NailItToast');
    oops(message);
  } catch {/* toast host not mounted — nothing actionable */}
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require('@sentry/react-native');
    Sentry.captureMessage(`[AudioQueue] gave up on a dictation (${reason}): ${task.contextLabel}`, 'warning');
  } catch {/* ignore */}
  console.warn('[AudioQueue]', reason, '—', message);
}

/** Best-effort removal of our copy once a task is finished with. */
async function discardRecording(task: AudioTranscribeTask): Promise<void> {
  if (!task.staged) return; // not ours — never delete the recorder's own file
  const uri = resolveTaskUri(task, queueDir());
  if (!uri) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {/* a leftover file is harmless */}
}

/**
 * Copy the recording out of the cache directory and into ours. Returns the
 * staged FILE NAME (resolved against the current documentDirectory at drain
 * time — see resolveTaskUri for the iOS container-uuid trap), or null when the
 * copy could not be made, in which case the caller queues the original URI:
 * a dictation that might survive is worth more than one certainly discarded.
 */
async function stageRecording(localUri: string, id: string): Promise<string | null> {
  if (Platform.OS === 'web' || !FileSystem.documentDirectory) return null;
  if (!localUri.startsWith('file://')) return null;
  try {
    const dir = queueDir();
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    const name = stagedFileName(id, audioExtFromUri(localUri));
    // Stage into a temp file and MOVE it into place. A drain running in this
    // window would otherwise be handed a target that momentarily does not
    // exist, classify the miss as terminal, and drop the dictation. A move
    // leaves the target as either absent or complete, never half-written.
    const staged = `${dir}${name}.part`;
    await FileSystem.copyAsync({ from: localUri, to: staged });
    await FileSystem.moveAsync({ from: staged, to: `${dir}${name}` });
    return name;
  } catch (err) {
    console.warn('[AudioQueue] Could not stage a durable copy; queueing the recorder’s own URI:', err);
    return null;
  }
}

export interface QueueAudioInput {
  /** URI expo-av handed back from getURI(). */
  localUri: string;
  contentType: string;
  /** Which surface asked for this dictation — utils/audioTranscribeCore.voiceContextKey. */
  contextKey: string;
  /** What to call it out loud: "Daily Report — Harbor View". */
  contextLabel: string;
  durationMs: number;
}

export interface QueueAudioResult {
  /** True when the recording is on disk and in the queue. The UI may only say
   *  "saved" when this is true — anything else is a promise we can't keep. */
  saved: boolean;
  task: AudioTranscribeTask | null;
  /** Why not, when saved is false. Shown to the user verbatim. */
  reason?: string;
}

/**
 * Keep a dictation that could not be transcribed right now. Never throws.
 *
 * This is the fix: the recorded file's URI used to be read once inside
 * VoiceCaptureModal's try block and then dropped on the floor, so a failed
 * upload took the recording with it.
 */
export async function queueAudioTranscription(input: QueueAudioInput): Promise<QueueAudioResult> {
  // Held out here so the failure path below can take our own copy back off
  // disk. A refused save that leaves ~3 MB of orphaned WAV behind fills the
  // phone of the user we just told we could not help.
  let stagedName: string | null = null;
  try {
    if (!input.localUri) return { saved: false, task: null, reason: 'The recording produced no file.' };
    const userId = await currentSessionUserId();
    // Tagging is what keeps a dictation from following one contractor onto the
    // next on a shared site-office device. An untagged task could be adopted by
    // whoever signs in next, so we would rather refuse the save and say so.
    if (!userId) {
      return { saved: false, task: null, reason: 'Sign in again to save this recording.' };
    }

    const id = `aq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    stagedName = await stageRecording(input.localUri, id);
    const task: AudioTranscribeTask = {
      id,
      userId,
      fileRef: stagedName ?? input.localUri,
      staged: stagedName !== null,
      uploadName: `recording.${audioExtFromUri(input.localUri)}`,
      contentType: input.contentType,
      contextKey: input.contextKey,
      contextLabel: input.contextLabel,
      durationMs: input.durationMs,
      queuedAt: Date.now(),
      retryCount: 0,
      status: 'pending',
    };

    const merged = await withQueueLock(async () => {
      // The THROWING read, not the forgiving one. getAudioTranscribeQueue()
      // answers a storage refusal with an empty array, and writing this one
      // task on top of that would erase every other dictation still waiting for
      // signal — silently, and with no server-side copy to recover them from.
      // A corrupt blob is different and still costs only itself: parseAudioQueue
      // drops the entries it cannot read and returns the rest.
      const current = await readQueueOrThrow();
      const { queue, dropped, droppedReady } = enqueueAudioTranscription(current, task, AUDIO_MAX_QUEUE);
      await writeQueue(queue);
      return { dropped, droppedReady };
    });
    for (const d of merged.dropped) {
      announceGiveUp('queue-cap', d);
      void discardRecording(d);
    }
    // Shed transcripts are a different loss and get the sentence that fits:
    // the words were made, nobody collected them, and telling the user to
    // "re-record it" would be telling them to redo work that already happened.
    for (const d of merged.droppedReady) announceGiveUp('expired', d);

    // Raised only AFTER the task is on disk, so the flag can never mean
    // anything but "a recording exists that a running drain's snapshot cannot
    // see" — see scheduleOpportunisticDrain.
    queuedSinceSnapshot = true;
    scheduleOpportunisticDrain();
    return { saved: true, task };
  } catch (err) {
    console.warn('[AudioQueue] Failed to save the recording:', err);
    if (stagedName) {
      try {
        await FileSystem.deleteAsync(`${queueDir()}${stagedName}`, { idempotent: true });
      } catch {/* a leftover file is the lesser problem */}
    }
    return { saved: false, task: null, reason: 'This phone could not save the recording.' };
  }
}

// ── Draining ────────────────────────────────────────────────────────────────

let drainTimer: ReturnType<typeof setTimeout> | null = null;
let queuedSinceSnapshot = false;

/**
 * Try again shortly instead of waiting for the user to come back.
 *
 * Debounced so a burst of failures costs one drain, not one each. Offline the
 * attempt classifies as transient and costs nothing — there is no connectivity
 * API here, so trying is how we find out, exactly as supabaseWrite behaves.
 *
 * Re-arms only on positive evidence that another pass can achieve something:
 * either a recording was saved that the drain we coalesced onto could not see,
 * or the uplink is demonstrably alive (something transcribed) and work is still
 * left. Deliberately NOT a bare `remaining > 0`: offline, every drain ends with
 * remaining > 0 forever, which would turn this into a hot loop re-uploading
 * multi-MB WAVs on a jobsite with no signal.
 */
function scheduleOpportunisticDrain(): void {
  if (drainTimer) clearTimeout(drainTimer);
  drainTimer = setTimeout(() => {
    drainTimer = null;
    void processAudioTranscribeQueue()
      .then((res) => {
        if (queuedSinceSnapshot || (res.transcribed > 0 && res.remaining > 0)) scheduleOpportunisticDrain();
      })
      .catch(() => {/* the queue keeps the work */});
  }, 4000);
}

/** What a drain did. `remaining` counts THIS session's dictation still waiting;
 *  `foreign` the entries left untouched because someone else recorded them. */
export interface AudioFlushResult {
  transcribed: number;
  gaveUp: number;
  /** Still pending for this session (transcripts waiting to be collected are not "work"). */
  remaining: number;
  foreign: number;
}

const EMPTY_FLUSH: AudioFlushResult = { transcribed: 0, gaveUp: 0, remaining: 0, foreign: 0 };

// Re-entrancy guard, mirroring processOfflineQueue / processPhotoUploadQueue.
// A foreground wake, the opportunistic timer and the modal opening can all fire
// while a drain is still in its network phase; two overlapping drains would
// read the same snapshot and upload the same audio twice.
let inFlight: Promise<AudioFlushResult> | null = null;

export function processAudioTranscribeQueue(): Promise<AudioFlushResult> {
  if (inFlight) return inFlight;
  // Never rejects. Callers fire this and forget (OfflineSyncManager on
  // foreground, the opportunistic timer, the modal opening), and a rejected
  // promise nobody caught is an unhandled-rejection warning in place of a queue
  // that simply kept the work for the next pass.
  inFlight = runAudioTranscribeQueue()
    .catch((err) => {
      console.warn('[AudioQueue] Drain failed; everything stays queued:', err);
      return { ...EMPTY_FLUSH };
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}

async function runAudioTranscribeQueue(): Promise<AudioFlushResult> {
  // Lowered BEFORE the snapshot read below, never after. A recording saved in
  // the gap is then double-counted — it is in our snapshot AND re-raises the
  // flag — which costs one extra drain that finds nothing to do. Lowering it
  // after the read would instead SWALLOW that recording: outside the snapshot,
  // with no flag left to trigger a re-arm.
  queuedSinceSnapshot = false;

  if (!isSupabaseConfigured) return EMPTY_FLUSH;

  const queue = await getAudioTranscribeQueue();
  if (queue.length === 0) return EMPTY_FLUSH;

  // A signed-out device must not fire uploads that will all 401 and burn the
  // retry budget — leave everything queued until a session exists. And the
  // drain is bound to THAT session: another tenant's dictation is never sent
  // under this user's JWT, and the session is re-read before every upload, so
  // the moment it ends or changes hands the rest simply stays queued.
  const sessionUserId = await currentSessionUserId();
  if (!sessionUserId) return { ...EMPTY_FLUSH, foreign: queue.length };

  const splitOwn = (tasks: readonly AudioTranscribeTask[]): { remaining: number; foreign: number } => {
    let ownPending = 0;
    let foreign = 0;
    for (const t of tasks) {
      if (t.userId !== sessionUserId) foreign++;
      else if (t.status === 'pending') ownPending++;
    }
    return { remaining: ownPending, foreign };
  };

  // Expired transcripts nobody collected go first, and are said out loud —
  // otherwise text would vanish between two visits to the same screen. Like
  // every other loss below, it is announced only once the write-back has
  // landed: saying it before would repeat the whole speech on the next drain
  // if the write never happened.
  const { queue: live, expired } = pruneAudioQueue(queue);

  const pending = sortAudioQueue(live).filter((t) => t.userId === sessionUserId && t.status === 'pending');
  if (pending.length === 0 && expired.length === 0) return { transcribed: 0, gaveUp: 0, ...splitOwn(live) };

  const kept: AudioTranscribeTask[] = [];
  // Nothing below deletes audio or claims a transcription until the write-back
  // has actually landed. Unlinking a recording the instant the text came back
  // looks safe and is not: the transcript only exists in memory until the
  // reconcile writes it, and a drain can run for minutes across several
  // uploads. If the write throws, or iOS kills the backgrounded app in the
  // gap, the queue still says `pending` while the file is already gone — the
  // next drain reads ENOENT, calls it terminal, and the dictation AND the
  // transcript are both lost. Deferring costs one traversal; the alternative
  // costs the report.
  const unlinkAfterWrite: AudioTranscribeTask[] = [];
  const announceAfterWrite: { reason: GiveUpReason; task: AudioTranscribeTask }[] = [];
  const transcribedAfterWrite: AudioTranscribeTask[] = [];
  for (const t of expired) if (t.userId === sessionUserId) announceAfterWrite.push({ reason: 'expired', task: t });
  let transcribed = 0;
  let gaveUp = expired.length;
  const dir = queueDir();

  for (const task of pending) {
    if ((await currentSessionUserId()) !== sessionUserId) {
      // Session ended or changed hands mid-drain. Everything not yet attempted
      // is kept exactly as it is — unchanged objects, so the reconcile writes
      // them back verbatim — and nothing is dropped.
      console.warn('[AudioQueue] Session ended mid-drain — leaving the rest queued');
      kept.push(...pending.slice(pending.indexOf(task)));
      break;
    }

    const uri = resolveTaskUri(task, dir);
    let outcome = classifyTranscribeResult('');
    let transcript = '';
    try {
      if (!uri) throw new Error('The recording file no longer exists.');
      transcript = await transcribeAudio({ uri, name: task.uploadName, type: task.contentType });
      outcome = classifyTranscribeResult(transcript);
    } catch (err) {
      outcome = classifyTranscribeError(err);
      if (outcome === 'transient') {
        console.log('[AudioQueue] Still offline — keeping the dictation queued:', task.contextLabel);
      } else {
        console.warn('[AudioQueue] Transcription failed:', task.contextLabel, err);
      }
    }

    const decision = applyTranscribeOutcome(task, outcome, transcript, AUDIO_MAX_RETRIES);
    if (decision.keep) {
      kept.push(decision.task);
      if (decision.task.status === 'ready') {
        transcribed++;
        unlinkAfterWrite.push(task);
        transcribedAfterWrite.push(decision.task);
      }
      continue;
    }
    gaveUp++;
    if (decision.gaveUp) announceAfterWrite.push({ reason: decision.gaveUp, task: decision.task });
    unlinkAfterWrite.push(task);
  }

  // Atomic write-back under the lock, reconciled against whatever is persisted
  // NOW, so dictation recorded during this drain survives it.
  const flushIds = new Set([...pending, ...expired].map((t) => t.id));
  const keptById = new Map(kept.map((t) => [t.id, t] as const));
  const persisted = await withQueueLock(async () => {
    // The throwing read again. getAudioTranscribeQueue() answers a storage
    // refusal with an empty array, which here would mean "write nothing" — and
    // the deferred deletes below would then unlink audio that the queue on disk
    // still lists as pending, which is the loss this ordering exists to stop.
    // Letting it throw skips the deletes and the announcements together: the
    // drain simply achieved nothing, which is the truth.
    const current = await readQueueOrThrow();
    if (current.length === 0) return [] as AudioTranscribeTask[];
    const next = reconcileAudioQueue(current, flushIds, keptById);
    await writeQueue(next);
    return next;
  });

  // The queue on disk now agrees with what happened, so it is finally safe to
  // delete the audio and to tell the user their words arrived.
  for (const t of unlinkAfterWrite) void discardRecording(t);
  for (const a of announceAfterWrite) announceGiveUp(a.reason, a.task);
  for (const t of transcribedAfterWrite) notifyTranscribed(t);

  const { remaining, foreign } = splitOwn(persisted);
  console.log('[AudioQueue] Done. Transcribed:', transcribed, 'Gave up:', gaveUp, 'Remaining:', remaining);
  return { transcribed, gaveUp, remaining, foreign };
}

/**
 * A dictation the user recorded earlier is now text. Say so — the transcript is
 * waiting on the screen that asked for it, and nothing else would tell them it
 * arrived.
 */
function notifyTranscribed(task: AudioTranscribeTask): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { nailIt } = require('@/components/animations/NailItToast');
    nailIt(`Transcribed the dictation you saved${task.contextLabel ? ` for ${task.contextLabel}` : ''}.`);
  } catch {/* toast host not mounted */}
}

// ── What a surface can see and take ─────────────────────────────────────────

export interface ContextDictationState {
  /** Recordings for this surface still waiting for signal. */
  pending: AudioTranscribeTask[];
  /** Transcripts for this surface, transcribed and waiting to be used. */
  ready: AudioTranscribeTask[];
}

export async function getContextDictation(contextKey: string): Promise<ContextDictationState> {
  const userId = await currentSessionUserId();
  if (!userId) return { pending: [], ready: [] };
  const queue = await getAudioTranscribeQueue();
  return {
    pending: pendingForContext(queue, contextKey, userId),
    ready: readyForContext(queue, contextKey, userId),
  };
}

/**
 * Hand a finished transcript to the surface that asked for it, removing it in
 * the same locked step so re-opening the form cannot offer text the user has
 * already pasted into it twice.
 */
export async function takeTranscript(id: string): Promise<string | null> {
  return withQueueLock(async () => {
    const current = await getAudioTranscribeQueue();
    const { queue, taken } = takeReadyTranscript(current, id);
    if (!taken) return null;
    await writeQueue(queue);
    return taken.transcript ?? null;
  });
}

// ── Tenant boundary ─────────────────────────────────────────────────────────

/**
 * The only way to empty the queue. Under the same lock as the drain's
 * write-back, so a drain that outlives a sign-out cannot read the queue before
 * the wipe and write its snapshot back after it. The recordings go with their
 * tasks: on a tenant switch they are the previous contractor's words sitting in
 * this app's documents folder.
 */
export async function clearAudioTranscribeQueue(): Promise<void> {
  const cleared = await withQueueLock(async () => {
    const current = await getAudioTranscribeQueue();
    await AsyncStorage.removeItem(AUDIO_QUEUE_KEY);
    return current;
  });
  for (const t of cleared) void discardRecording(t);
}

/** Keep only `userId`'s dictation; drop and unlink the rest. Twin of
 *  retainOfflineQueueForUser / retainPhotoUploadQueueForUser so all three
 *  queues answer an arriving session with the same rule. */
export async function retainAudioTranscribeQueueForUser(
  userId: string,
  opts: RetainOptions = {},
): Promise<RetainResult> {
  const res = await withQueueLock(async () => {
    const dropUntagged = opts.dropUntagged ?? true;
    let current: AudioTranscribeTask[];
    try {
      current = await readQueueOrThrow();
    } catch (err) {
      // Storage refused. Nothing inspected, nothing written, no audio unlinked
      // — and the caller is told, so it does not read the zeroes below as
      // "there was nothing of anyone's here".
      console.warn('[AudioQueue] Could not read the queue to narrow it — leaving it untouched:', err);
      return { gone: [] as AudioTranscribeTask[], kept: 0, readFailed: true };
    }
    const own = current.filter((t) => t.userId === userId || (!t.userId && !dropUntagged));
    if (own.length === current.length) return { gone: [] as AudioTranscribeTask[], kept: own.length, readFailed: false };
    if (own.length === 0) await AsyncStorage.removeItem(AUDIO_QUEUE_KEY);
    else await writeQueue(own);
    const keptSet = new Set(own);
    return { gone: current.filter((t) => !keptSet.has(t)), kept: own.length, readFailed: false };
  });
  for (const t of res.gone) void discardRecording(t);
  return { kept: res.kept, dropped: res.gone.length, readFailed: res.readFailed };
}
