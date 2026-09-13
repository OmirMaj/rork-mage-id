// utils/audioTranscribeCore.ts — pure, RN-free decision logic for the offline
// voice-dictation queue.
//
// THE BUG THIS EXISTS FOR: a super stands in a basement with no signal and
// dictates ninety seconds of a daily report. utils/transcribeAudio.ts throws on
// any fetch failure, VoiceCaptureModal caught that, showed an error, and mapped
// the next tap to a BRAND-NEW recording — and the recorded file's URI was never
// retained by anything. The ninety seconds were gone, and re-dictating failed
// identically, because he was still in the basement. Meanwhile onboarding
// promises the app "Works offline."
//
// So a failed transcription now keeps the recording and transcribes it when
// signal returns. This file holds every decision that makes that safe (where
// the file lives, what an error means, how many times we retry, when we give
// up, how the queue is persisted and read back) as pure functions, so bun can
// run them for real in scripts/validate-voice-offline.ts. The
// AsyncStorage / expo-file-system / fetch shell is utils/audioTranscribeQueue.ts.
//
// Same split, and for the same reason, as utils/photoUploadCore.ts +
// utils/photoUploadQueue.ts: bun cannot parse `react-native`, so anything that
// imports it is untestable. This module has NO imports at all, deliberately.
//
// WHERE AUDIO DIFFERS FROM PHOTOS, and why this is not a copy of the photo queue:
//
//  1. expo-av writes a recording into the app's CACHE directory, which iOS and
//     Android reclaim under storage pressure. A recording queued on Monday with
//     no signal would simply not exist on Wednesday. The shell copies it into
//     documentDirectory; a task therefore stores a file NAME inside our own
//     queue folder, not an absolute path — see resolveTaskUri, and the iOS
//     container-uuid trap it documents.
//  2. A photo's destination is a bucket path that exists whether or not the app
//     is on screen. A transcript's destination is a FORM — the one the user was
//     filling in when they hit record. So a task carries the surface that asked
//     for it (contextKey) and, once transcribed, the queue HOLDS the text until
//     that surface takes it. A transcript nobody can reach is the same data loss
//     in a slower form.
//  3. Giving up is louder here. There is no server-side copy of a dictation and
//     no way to re-derive it; when the budget runs out the user has to be told,
//     by name, which dictation went.

/**
 * AsyncStorage key for the persisted dictation queue.
 *
 * `mageid_` is one of APP_STORAGE_PREFIXES in utils/localCacheKeys.ts, which is
 * what puts it inside the tenant wipe: on a shared site-office device the next
 * contractor to sign in must not inherit the previous one's dictation. A key
 * under a brand-new prefix would be invisible to that sweep, and
 * `bun run test:storage-hygiene` fails the build for exactly that.
 */
export const AUDIO_QUEUE_KEY = 'mageid_audio_transcribe_queue';

/** Folder name (under documentDirectory) holding the staged recordings. */
export const AUDIO_QUEUE_DIRNAME = 'mageid-audio-queue/';

/**
 * Retry budget for a failure that is the SERVER's fault (5xx, an unexpected
 * shape, a rejected token). Being offline does not spend it — see
 * classifyTranscribeError — because a week on a no-signal jobsite would
 * otherwise burn through the budget and delete the recording, which is the
 * original bug wearing a different hat.
 *
 * Wider than the photo queue's 5 because a photo can be re-taken and a
 * dictation cannot: the moment is gone, and the super has moved on to the next
 * unit.
 */
export const AUDIO_MAX_RETRIES = 6;

/**
 * FIFO cap. Far smaller than the photo queue's 500 because each entry pins a
 * recording on disk: VoiceCaptureModal records 16 kHz / 16-bit mono WAV at
 * 32 KB/s, so ninety seconds is ~2.9 MB and twenty entries is ~58 MB worst
 * case. Reaching this at all means twenty dictations failed without the phone
 * ever regaining signal; past that we shed oldest-first and say so, rather than
 * quietly filling the user's phone.
 *
 * Counted over PENDING entries only — see enqueueAudioTranscription. A `ready`
 * entry holds a few KB of already-transcribed text and no audio, so shedding
 * one to make room for a recording would throw away words that already exist.
 */
export const AUDIO_MAX_QUEUE = 20;

/**
 * How long a finished transcript waits for its surface to collect it. The audio
 * is deleted the moment we have text, so this holds a few KB of strings — but
 * it is still the user's words, and it still leaves with the tenant wipe. Two
 * weeks covers "I dictated that in the crawlspace last Tuesday".
 */
export const READY_TRANSCRIPT_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * A dictation the user believes is captured.
 *
 * `status` is the whole life cycle: `pending` means we hold AUDIO and no text,
 * `ready` means we hold TEXT and the audio has been deleted. A task never holds
 * neither, which is what makes "saved" an honest thing to tell the user.
 */
export interface AudioTranscribeTask {
  id: string;
  /** Owning user. A dictation must not follow one tenant onto the next. */
  userId: string;
  /**
   * Where the audio is. When `staged` is true this is a file NAME inside
   * AUDIO_QUEUE_DIRNAME and must be resolved through resolveTaskUri; when it is
   * false the copy failed and this is the absolute URI we were handed, which is
   * still better than dropping the recording. Empty once status is 'ready'.
   */
  fileRef: string;
  staged: boolean;
  /** Filename sent in the multipart body — the extension is how STT picks a decoder. */
  uploadName: string;
  contentType: string;
  /** Which surface asked for this dictation, so the transcript can go home. */
  contextKey: string;
  /** What to call it when we have to talk about it: "Daily Report — Harbor View". */
  contextLabel: string;
  /** Length of the recording, so the UI can say "1:32 saved" and mean it. */
  durationMs: number;
  queuedAt: number;
  retryCount: number;
  status: 'pending' | 'ready';
  transcript?: string;
  transcribedAt?: number;
}

/**
 * How one transcription attempt ended.
 *
 * - `success`   — we have text.
 * - `no-speech` — the server answered with an empty transcript. It HEARD the
 *                 upload and found no words; retrying the same bytes gets the
 *                 same answer forever, so this settles, and the user is told
 *                 (silence they think is a report is worse than an error).
 * - `transient` — offline, or a rate limit that time alone clears. Re-queue
 *                 UNCHANGED; never spend the budget.
 * - `terminal`  — the file is gone, or the server refused the body itself.
 *                 No amount of signal fixes it.
 * - `retryable` — anything else. Bounded by AUDIO_MAX_RETRIES.
 */
export type TranscribeOutcome = 'success' | 'no-speech' | 'transient' | 'terminal' | 'retryable';

/** Why a dictation was permanently discarded. Every value gets said out loud. */
export type GiveUpReason = 'no-speech' | 'terminal' | 'retries-exhausted' | 'queue-cap' | 'expired';

// ── Where the file lives ────────────────────────────────────────────────────

/**
 * Absolute URI of a task's audio.
 *
 * Staged tasks store only the file name ON PURPOSE. An iOS app's container is
 * a UUID path (`/var/mobile/Containers/Data/Application/<UUID>/Documents/…`)
 * and that UUID is NOT stable — it changes on reinstall and can change across
 * OS updates. An absolute `file://` persisted on Monday can therefore point at
 * nothing on Wednesday even though the bytes are still on the phone, and the
 * drain would classify the miss as terminal and drop a recording it was still
 * holding. Re-joining the CURRENT documentDirectory each time is what survives
 * that.
 */
export function resolveTaskUri(task: AudioTranscribeTask, queueDir: string): string {
  if (!task.staged) return task.fileRef;
  if (!task.fileRef) return '';
  return `${queueDir}${task.fileRef}`;
}

/** Filesystem-safe name for a staged recording. */
export function stagedFileName(id: string, ext: string): string {
  const safe = (s: string) => String(s).replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${safe(id)}.${safe(ext || 'wav')}`;
}

/** Extension of a recorded file, defaulting to wav — what iOS capture produces. */
export function audioExtFromUri(uri: string): string {
  const clean = String(uri).split('?')[0].split('#')[0];
  const m = /\.([a-zA-Z0-9]{2,5})$/.exec(clean);
  return m ? m[1].toLowerCase() : 'wav';
}

/**
 * 32-bit FNV-1a over the whole input, base36. Not a security hash — it exists
 * so voiceContextKey below can stay readable AND stay total. No imports, by
 * the rule at the top of this file.
 */
function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/**
 * Stable key for the surface that asked for a dictation. Derived from the
 * modal's own title and context line, so every existing caller gets one without
 * being edited — and so the daily report for Harbor View and the daily report
 * for Union Street do not collect each other's words.
 *
 * The readable slug is TRUNCATED, and truncation alone was a collision: real
 * project names are long and often differ only at the end, so
 * "Riverside Commons Multifamily Redevelopment — Building 3 Podium Level Unit A"
 * and "…Unit B" both slugged to the same 80 characters, and Unit A's daily
 * report would have offered Unit B's dictation for pasting. The hash of the
 * FULL string is what makes the key total; the slug is only there so a key in
 * a debug log still says which screen it came from.
 */
export function voiceContextKey(title: string, contextLine?: string): string {
  const raw = `${title}|${contextLine ?? ''}`;
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '') || 'voice';
  return `${slug}-${shortHash(raw)}`;
}

/** "1:32" — how long the recording was, for UI that has to be believable. */
export function formatClipLength(ms: number): string {
  const total = Math.max(0, Math.round((Number.isFinite(ms) ? ms : 0) / 1000));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

// ── Error classification ────────────────────────────────────────────────────

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message ?? '');
  }
  return String(err ?? '');
}

/**
 * HTTP status behind a failure. utils/transcribeAudio.ts throws a STRING
 * ("Transcription server returned 429. …"), so the status has to be read back
 * out of the message; the object form covers a caller that hands over a raw
 * response-shaped error instead.
 */
export function transcribeStatusOf(err: unknown): number | null {
  if (err && typeof err === 'object') {
    const o = err as { status?: unknown; statusCode?: unknown };
    for (const raw of [o.status, o.statusCode]) {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
      if (Number.isFinite(n)) return n;
    }
  }
  // Anchored on both sides: without the trailing guard, "returned 4299" reads
  // as a 429 and a hard failure would be classified as the rate limit that
  // clears on its own, so the entry would never spend its budget.
  const m = /returned\s+(\d{3})(?!\d)/.exec(messageOf(err));
  return m ? Number(m[1]) : null;
}

/**
 * Decide what a failed transcription means.
 *
 * The order below is the whole safety argument:
 *
 *  • The missing-file check runs FIRST. "no such file" reaching the network
 *    branch would be retried six times against a file that does not exist,
 *    keeping a dead task at the head of the queue for a week.
 *  • Connectivity is transient and costs nothing. This is the basement.
 *  • 429 is transient too, not retryable: the proxy allows 60 uploads an hour
 *    (supabase/functions/transcribe-audio), and a super who dictates a unit at
 *    a time can legitimately hit it. Spending six retries inside one minute on
 *    a limit that clears on its own would delete the recordings the limit was
 *    protecting.
 *  • 401/403 is deliberately RETRYABLE, not terminal. transcribeAudio falls
 *    back to the anon key when the session is briefly unavailable, and the
 *    function answers that with 401 — so an expired-but-refreshable token looks
 *    exactly like a revoked one. Bounded retries mean the refreshable case
 *    survives and the genuinely revoked one still ends, visibly, instead of
 *    looping forever.
 *  • 4xx about the BODY (400 bad multipart, 413 too large, 415 unsupported) is
 *    terminal: the same bytes will be refused every time.
 */
export function classifyTranscribeError(err: unknown): TranscribeOutcome {
  const msg = messageOf(err).toLowerCase();

  if (
    msg.includes('enoent') ||
    msg.includes('no such file') ||
    msg.includes('does not exist') ||
    msg.includes('no longer exists') ||
    msg.includes('file not found') ||
    msg.includes('could not be read') ||
    msg.includes('produced no file')
  ) {
    return 'terminal';
  }

  const status = transcribeStatusOf(err);
  if (status === 429) return 'transient';
  if (status === 401 || status === 403) return 'retryable';
  if (status !== null && status >= 400 && status < 500) return 'terminal';

  if (err instanceof TypeError) return 'transient';
  if (
    msg.includes('service unreachable') ||
    msg.includes('network request failed') ||
    msg.includes('failed to fetch') ||
    msg.includes('network') ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('econnreset') ||
    msg.includes('socket hang up') ||
    msg.includes('offline')
  ) {
    return 'transient';
  }

  return 'retryable';
}

/**
 * What a SUCCESSFUL round trip means. The proxy relays the upstream JSON
 * verbatim and the upstream answers `{"text":""}` for audio it could not turn
 * into words — a 200 that contains nothing. Treating that as success would hand
 * the form an empty string and look like the dictation simply vanished.
 */
export function classifyTranscribeResult(transcript: string | null | undefined): TranscribeOutcome {
  return String(transcript ?? '').trim().length > 0 ? 'success' : 'no-speech';
}

// ── Queue operations ────────────────────────────────────────────────────────

export interface EnqueueAudioResult {
  queue: AudioTranscribeTask[];
  /** Oldest RECORDINGS shed because the cap was hit. The user must be told. */
  dropped: AudioTranscribeTask[];
  /** Oldest uncollected TRANSCRIPTS shed. A different loss, and a different
   *  sentence: the words exist, nobody came back for them, and re-recording is
   *  not what the user needs to be told to do. */
  droppedReady: AudioTranscribeTask[];
  /** True when an entry for the same file was replaced rather than duplicated. */
  deduped: boolean;
}

/**
 * Append a dictation, de-duplicating by file and enforcing the FIFO cap.
 *
 * Dedupe matters because the "transcribe now" button and the automatic drain
 * can both fail on the same recording seconds apart; without it the same audio
 * would sit in the queue twice and be uploaded twice. The newest task wins but
 * keeps the ORIGINAL queuedAt and retryCount, so a repeatedly-retried dictation
 * cannot reset its own budget or jump ahead of older ones by being re-saved.
 * It is scoped to one user: on a shared site-office phone two tenants can hold
 * the same unstaged cache URI, and merging across that line would hand one
 * contractor's queue entry to the other.
 *
 * The cap is counted over PENDING entries only. A `ready` entry is a few KB of
 * the user's own words with no audio behind it — the whole reason for a cap of
 * twenty is that each PENDING entry pins ~2.9 MB of WAV on disk. Shedding a
 * finished transcript to make room for a recording would throw away text that
 * already exists and tell the user to "re-record it", which is both a loss and
 * a lie. Uncollected transcripts are bounded by READY_TRANSCRIPT_TTL_MS, and by
 * their own cap below so a phone that never opens the form again cannot grow
 * the row forever.
 */
export function enqueueAudioTranscription(
  queue: AudioTranscribeTask[],
  task: AudioTranscribeTask,
  cap: number = AUDIO_MAX_QUEUE,
): EnqueueAudioResult {
  const idx = queue.findIndex(
    (t) =>
      t.status === 'pending' &&
      t.userId === task.userId &&
      t.staged === task.staged &&
      t.fileRef === task.fileRef,
  );
  let next: AudioTranscribeTask[];
  let deduped = false;
  if (idx >= 0) {
    deduped = true;
    const existing = queue[idx];
    next = [...queue];
    next[idx] = { ...task, queuedAt: existing.queuedAt, retryCount: existing.retryCount };
  } else {
    next = [...queue, task];
  }

  const pending = next.filter((t) => t.status === 'pending');
  const ready = next.filter((t) => t.status !== 'pending');
  const dropped = pending.length > cap ? pending.splice(0, pending.length - cap) : [];
  const droppedReady = ready.length > cap ? ready.splice(0, ready.length - cap) : [];
  // Removed by identity against the surviving list, so insertion order is kept
  // and a `ready` entry cannot be shed by a count it does not belong to.
  const shed = new Set<AudioTranscribeTask>([...dropped, ...droppedReady]);
  return { queue: next.filter((t) => !shed.has(t)), dropped, droppedReady, deduped };
}

/** Oldest-first drain order — dictation transcribes in the order it was spoken. */
export function sortAudioQueue(queue: AudioTranscribeTask[]): AudioTranscribeTask[] {
  return [...queue].sort((a, b) => a.queuedAt - b.queuedAt || a.id.localeCompare(b.id));
}

export interface AudioOutcomeDecision {
  /** True → stays queued for a later drain. */
  keep: boolean;
  /** The task as it should be persisted when kept, or the finished one when not. */
  task: AudioTranscribeTask;
  /** True → gone for good. Never silently: `gaveUp` says what to tell the user. */
  dropped: boolean;
  /** Set exactly when `dropped` is true. */
  gaveUp: GiveUpReason | null;
}

/**
 * Turn an attempt into a keep/drop decision.
 *
 * `success` is the one that differs from the photo queue: the task is NOT
 * discarded, it flips to `ready` and holds the transcript until the surface
 * that asked for it collects it. The audio reference is cleared in the same
 * step so a later drain can never try to re-upload a file the shell is about
 * to delete.
 *
 * `transient` re-queues UNCHANGED. That is the offline-first guarantee: a phone
 * in a basement for a week still has the dictation when it surfaces.
 */
export function applyTranscribeOutcome(
  task: AudioTranscribeTask,
  outcome: TranscribeOutcome,
  transcript: string | null | undefined,
  maxRetries: number = AUDIO_MAX_RETRIES,
  now: number = Date.now(),
): AudioOutcomeDecision {
  const text = String(transcript ?? '').trim();
  // A caller that says `success` with nothing to show for it is describing
  // no-speech, and must be handled as one: a `ready` task with an empty
  // transcript fails isAudioTranscribeTask, so it would be silently swept away
  // by the next parse — a dictation that disappears with nothing said about it,
  // which is the bug this module exists to end.
  const settled: TranscribeOutcome = outcome === 'success' && text.length === 0 ? 'no-speech' : outcome;

  if (settled === 'success') {
    return {
      keep: true,
      task: {
        ...task,
        status: 'ready',
        transcript: text,
        transcribedAt: now,
        fileRef: '',
        staged: false,
      },
      dropped: false,
      gaveUp: null,
    };
  }
  if (settled === 'transient') return { keep: true, task, dropped: false, gaveUp: null };
  if (settled === 'no-speech') return { keep: false, task, dropped: true, gaveUp: 'no-speech' };
  if (settled === 'terminal') return { keep: false, task, dropped: true, gaveUp: 'terminal' };

  // Counted from a floor of zero. A hand-edited or half-written entry can carry
  // a negative retryCount off disk, and `-1e9 + 1 >= 6` is false forever — the
  // budget would never terminate for exactly the entry most likely to be junk.
  const spent = Math.max(0, Math.floor(Number.isFinite(task.retryCount) ? task.retryCount : 0));
  const bumped = { ...task, retryCount: spent + 1 };
  if (bumped.retryCount >= maxRetries) {
    return { keep: false, task: bumped, dropped: true, gaveUp: 'retries-exhausted' };
  }
  return { keep: true, task: bumped, dropped: false, gaveUp: null };
}

/**
 * Drop finished transcripts nobody collected, and any `ready` entry that
 * somehow lost its text. Without the TTL the queue would grow for the life of
 * the install; without saying so, a transcript would disappear between two
 * visits to the same screen with no explanation.
 */
export function pruneAudioQueue(
  queue: AudioTranscribeTask[],
  now: number = Date.now(),
  ttl: number = READY_TRANSCRIPT_TTL_MS,
): { queue: AudioTranscribeTask[]; expired: AudioTranscribeTask[] } {
  const kept: AudioTranscribeTask[] = [];
  const expired: AudioTranscribeTask[] = [];
  for (const t of queue) {
    if (t.status !== 'ready') { kept.push(t); continue; }
    const at = t.transcribedAt ?? t.queuedAt;
    if (!t.transcript || now - at >= ttl) expired.push(t);
    else kept.push(t);
  }
  return { queue: kept, expired };
}

/**
 * Merge a finished drain back into whatever is persisted NOW.
 *
 * Straight from utils/photoUploadCore.reconcilePhotoQueue, and for the same
 * reason: overwriting the queue with the drain's own list would clobber a
 * dictation recorded WHILE the drain was in its slow network phase — which is
 * precisely the user who is having connectivity trouble.
 */
export function reconcileAudioQueue(
  current: AudioTranscribeTask[],
  flushIds: Set<string>,
  keptById: Map<string, AudioTranscribeTask>,
): AudioTranscribeTask[] {
  const next: AudioTranscribeTask[] = [];
  for (const entry of current) {
    if (flushIds.has(entry.id)) {
      const kept = keptById.get(entry.id);
      if (kept) next.push(kept);
      // else: transcribed-and-collected, or given up on → gone
    } else {
      next.push(entry); // recorded mid-drain — preserve
    }
  }
  return next;
}

// ── What a surface can see and take ─────────────────────────────────────────

/** Dictation for `contextKey` that is still waiting for signal. */
export function pendingForContext(
  queue: readonly AudioTranscribeTask[],
  contextKey: string,
  userId: string,
): AudioTranscribeTask[] {
  return sortAudioQueue(
    queue.filter((t) => t.status === 'pending' && t.contextKey === contextKey && t.userId === userId),
  );
}

/** Transcripts for `contextKey` that are transcribed and waiting to be used. */
export function readyForContext(
  queue: readonly AudioTranscribeTask[],
  contextKey: string,
  userId: string,
): AudioTranscribeTask[] {
  return sortAudioQueue(
    queue.filter((t) => t.status === 'ready' && !!t.transcript && t.contextKey === contextKey && t.userId === userId),
  );
}

/**
 * Hand a finished transcript to the surface that asked for it and remove it in
 * the same step, so re-opening the form does not re-offer text the user already
 * pasted into it.
 */
export function takeReadyTranscript(
  queue: readonly AudioTranscribeTask[],
  id: string,
): { queue: AudioTranscribeTask[]; taken: AudioTranscribeTask | null } {
  const found = queue.find((t) => t.id === id && t.status === 'ready' && !!t.transcript) ?? null;
  if (!found) return { queue: [...queue], taken: null };
  return { queue: queue.filter((t) => t.id !== id), taken: found };
}

// ── Persistence codec ───────────────────────────────────────────────────────

/**
 * Is this JSON a task we can act on? A half-written or hand-edited entry that
 * survives parsing is worse than one that does not: a task with no fileRef and
 * status 'pending' would be dispatched forever against nothing.
 */
export function isAudioTranscribeTask(value: unknown): value is AudioTranscribeTask {
  if (!value || typeof value !== 'object') return false;
  const t = value as Partial<AudioTranscribeTask>;
  if (typeof t.id !== 'string' || t.id.length === 0) return false;
  if (typeof t.userId !== 'string' || t.userId.length === 0) return false;
  if (typeof t.contextKey !== 'string') return false;
  if (typeof t.queuedAt !== 'number' || !Number.isFinite(t.queuedAt)) return false;
  if (typeof t.retryCount !== 'number' || !Number.isFinite(t.retryCount)) return false;
  if (t.status === 'pending') return typeof t.fileRef === 'string' && t.fileRef.length > 0;
  if (t.status === 'ready') return typeof t.transcript === 'string' && t.transcript.length > 0;
  return false;
}

export function serializeAudioQueue(queue: readonly AudioTranscribeTask[]): string {
  return JSON.stringify(queue);
}

/**
 * Read the queue back after a restart. Tolerant on purpose: a corrupt blob must
 * cost the entries it corrupted, never throw on a code path that runs while the
 * app is booting. Anything that is not a usable task is dropped rather than
 * carried forward as a task-shaped hole.
 */
export function parseAudioQueue(raw: string | null | undefined): AudioTranscribeTask[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isAudioTranscribeTask);
}

// ── What the user is told ───────────────────────────────────────────────────

/**
 * The sentence shown the moment a transcription fails and the recording is
 * kept. It must promise saving and NOT promise transcription — a super who
 * reads "got it" and walks away has lost the report just as surely as before,
 * only later and with more confidence.
 */
export function savedOfflineMessage(task: AudioTranscribeTask): string {
  return `Saved on this phone — ${formatClipLength(task.durationMs)} of dictation. It will transcribe as soon as you have signal.`;
}

/** Line for a surface that is holding dictation the user recorded earlier. */
export function pendingNoticeMessage(count: number): string {
  if (count <= 0) return '';
  const each = count === 1 ? 'dictation is' : 'dictations are';
  return `${count} saved ${each} waiting for signal. Nothing is lost — tap “Transcribe now” once you have a bar.`;
}

/**
 * Why a dictation is gone. Said out loud, every time: a recording silently
 * discarded after N failures is the bug this whole module exists to fix, only
 * slower and harder to notice.
 */
export function giveUpMessage(reason: GiveUpReason, task: AudioTranscribeTask): string {
  const what = `${formatClipLength(task.durationMs)} of dictation${task.contextLabel ? ` for ${task.contextLabel}` : ''}`;
  switch (reason) {
    case 'no-speech':
      return `No speech was found in ${what}. It has been discarded — please re-record closer to the mic.`;
    case 'terminal':
      return `${what} can no longer be transcribed (the recording is unreadable). Please re-record it.`;
    case 'retries-exhausted':
      return `${what} failed to transcribe ${AUDIO_MAX_RETRIES} times and has been discarded. Please re-record it.`;
    case 'queue-cap':
      return `${what} was discarded — more than ${AUDIO_MAX_QUEUE} dictations were waiting for signal. Please re-record it.`;
    case 'expired':
      return `A transcript of ${what} was never used and has expired.`;
  }
}
