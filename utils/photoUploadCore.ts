// utils/photoUploadCore.ts — pure, RN-free decision logic for the photo-upload queue.
//
// THE BUG THIS EXISTS FOR: `uploadProjectPhoto` was written but never called.
// Every jobsite photo wrote its raw local `file://` path straight into the
// `photos` table, so the `project-photos` bucket had 0 objects, ever. A
// `file://` URI is meaningless on any other device, after a reinstall, on web,
// and in the client portal — so every photo was silent data loss. Photos are
// legal documentation in construction; that is the worst possible thing to
// lose.
//
// The fix cannot be "upload synchronously before saving" — a jobsite has no
// signal. Photos must appear INSTANTLY from their local URI and the bytes must
// be uploaded whenever the network next allows. That is a queue, and this file
// is its brain.
//
// WHY A SEPARATE QUEUE FROM utils/offlineQueue.ts: that queue is
// AsyncStorage-backed and holds JSON mutations. Multi-MB base64 images would
// blow the AsyncStorage budget (and Android's 2MB-per-row SQLite cursor limit)
// almost immediately. So a photo task stores ONLY the local file path plus
// metadata — a few hundred bytes — and the bytes are read off disk at upload
// time.
//
// NO react-native / expo / supabase imports here, deliberately: bun cannot
// parse `react-native`, so anything importing it is untestable. Same split as
// utils/alertCore.ts, utils/base64Bytes.ts and utils/brain/predictionLedgerCore.ts.
// The RN-bound shell lives in utils/photoUploadQueue.ts.
//
// Pinned by scripts/validate-photo-upload.ts.

/** Bucket holding jobsite photos. PRIVATE — RLS requires folder[1] = auth.uid(). */
export const PHOTO_BUCKET = 'project-photos';

/** AsyncStorage key for the persisted photo-upload queue. */
export const PHOTO_QUEUE_KEY = 'mageid_photo_upload_queue';

/**
 * Genuine server-side failures get a bounded retry budget, exactly like
 * offlineQueue's MAX_RETRIES. Network errors do NOT consume it (see
 * classifyPhotoUploadError) — a device that is merely offline must never burn
 * through its budget and drop the user's photos.
 */
export const PHOTO_MAX_RETRIES = 5;

/**
 * FIFO cap. Smaller than offlineQueue's 1000 because every queued photo task
 * also PINS A FILE ON DISK (we keep our own copy so an OS cache purge can't
 * destroy an un-uploaded photo). 500 entries at a few MB each is already a
 * generous worst case; beyond that we shed oldest-first and say so loudly
 * rather than filling the user's storage silently.
 */
export const PHOTO_MAX_QUEUE = 500;

/** A pending photo upload. Holds a PATH, never bytes. */
export interface PhotoUploadTask {
  /** Queue-entry id (distinct from photoId so requeues stay identifiable). */
  id: string;
  /** `photos.id` of the row this image belongs to. */
  photoId: string;
  /** Owning user — also folder[1] of the storage path, which RLS enforces. */
  userId: string;
  projectId: string;
  /** Local URI to read bytes from at upload time (file:// / blob: / data:). */
  localUri: string;
  /** Deterministic destination in the bucket. Also the value stored in `photos.uri`. */
  storagePath: string;
  contentType: string;
  queuedAt: number;
  retryCount: number;
}

/**
 * How an upload attempt ended.
 *
 * - `success`          — bytes are in the bucket.
 * - `already-uploaded` — the object already exists at this path. Because the
 *                        path is DETERMINISTIC (derived from the photo id), a
 *                        retry after an upload that succeeded but whose ack was
 *                        lost hits this. It is a SUCCESS, not a failure —
 *                        treating it as an error would retry forever.
 * - `transient`        — offline / connectivity. Re-queue UNCHANGED, do NOT
 *                        burn the retry budget.
 * - `terminal`         — auth/RLS denial, or the local file is gone. Retrying
 *                        cannot fix it; drop and tell the user.
 * - `retryable`        — anything else (5xx, unknown). Bounded by PHOTO_MAX_RETRIES.
 */
export type PhotoUploadOutcome =
  | 'success'
  | 'already-uploaded'
  | 'transient'
  | 'terminal'
  | 'retryable';

// ─── URI classification ─────────────────────────────────────────────────────

/**
 * True for a URI that only means something on THIS device (or this browser
 * session). These must never be written to the database — that was the bug.
 */
export function isDeviceLocalUri(uri: string | undefined | null): boolean {
  if (!uri) return false;
  return /^(file:|blob:|data:|ph:|assets-library:|content:)/i.test(uri.trim());
}

/** True for an already-resolvable remote URL. */
export function isHttpUrl(uri: string | undefined | null): boolean {
  if (!uri) return false;
  return /^https?:\/\//i.test(uri.trim());
}

/**
 * True when a stored `photos.uri` value looks like a bucket path
 * (`<userId>/<projectId>/<file>`) rather than a URL. Read-time resolution mints
 * a short-lived signed URL for these.
 */
export function looksLikeStoragePath(value: string | undefined | null): boolean {
  if (!value) return false;
  const v = value.trim();
  if (v.length === 0) return false;
  if (isDeviceLocalUri(v) || isHttpUrl(v)) return false;
  if (v.includes('://')) return false;
  if (v.startsWith('/')) return false;
  // At least user/project/file.
  return v.split('/').filter(Boolean).length >= 3;
}

// ─── Path construction ──────────────────────────────────────────────────────

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/webp': 'webp',
};

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  heic: 'image/heic',
  heif: 'image/heif',
  webp: 'image/webp',
};

/**
 * Best-effort extension for a picked image. Falls back to `jpg` — every camera
 * path in the app produces JPEG, and a wrong-but-consistent extension still
 * uploads and renders correctly (Storage serves by contentType, not suffix).
 */
export function photoExtFromUri(uri: string): string {
  const dataMatch = /^data:([^;,]+)[;,]/i.exec(uri.trim());
  if (dataMatch) {
    const ext = EXT_BY_CONTENT_TYPE[dataMatch[1].toLowerCase()];
    if (ext) return ext;
  }
  // Strip query/fragment before looking at the suffix — ImagePicker on Android
  // hands back URIs like `.../IMG_0001.jpg?w=1024`.
  const clean = uri.split('?')[0].split('#')[0];
  const m = /\.([a-zA-Z0-9]{2,5})$/.exec(clean);
  const ext = m ? m[1].toLowerCase() : '';
  return CONTENT_TYPE_BY_EXT[ext] ? ext : 'jpg';
}

/** MIME type for an extension produced by photoExtFromUri. */
export function contentTypeForExt(ext: string): string {
  return CONTENT_TYPE_BY_EXT[ext.toLowerCase()] ?? 'image/jpeg';
}

/**
 * Destination path for a photo. DETERMINISTIC — derived from the photo's row id
 * rather than Date.now() — so it can be computed at insert time (before the
 * bytes are anywhere near the network), written into `photos.uri` in the same
 * optimistic write, and recomputed identically on every retry. A timestamped
 * path would produce a different object per retry and orphan the earlier ones.
 *
 * folder[1] MUST be the user id: the `project_photos_*` RLS policies in
 * supabase/schema.sql check `(storage.foldername(name))[1] = auth.uid()::TEXT`.
 */
export function buildPhotoStoragePath(
  userId: string,
  projectId: string,
  photoId: string,
  ext: string = 'jpg',
): string {
  const safe = (s: string) => String(s).replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${safe(userId)}/${safe(projectId)}/${safe(photoId)}.${safe(ext)}`;
}

// ─── Error classification ───────────────────────────────────────────────────

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message ?? '');
  }
  return String(err ?? '');
}

/**
 * Transient connectivity failure — the bytes never reached the server but
 * nothing is wrong with them. Mirrors offlineQueue.isNetworkError so both
 * queues agree on what "offline" looks like.
 */
function isTransient(err: unknown, msg: string): boolean {
  if (err instanceof TypeError) return true;
  const m = msg.toLowerCase();
  return (
    m.includes('network request failed') ||
    m.includes('failed to fetch') ||
    m.includes('network') ||
    m.includes('timeout') ||
    m.includes('timed out') ||
    m.includes('econnreset') ||
    m.includes('socket hang up')
  );
}

/**
 * The object is already there. Supabase Storage returns this when uploading to
 * an existing key with `upsert: false`. With a deterministic path that means a
 * previous attempt actually landed — success, not failure.
 */
function isAlreadyUploaded(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes('already exists') ||
    m.includes('resource already exists') ||
    m.includes('duplicate') ||
    m.includes('409')
  );
}

/**
 * Unrecoverable. Two families:
 *  - auth/RLS: retrying with the same (bad) session or path can never succeed.
 *  - missing local file: the source bytes are gone (OS purged the picker's
 *    cache entry, user deleted it). No amount of network fixes that, and
 *    looping forever would keep a dead task at the head of the queue.
 */
function isTerminal(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes('jwt') ||
    m.includes('unauthorized') ||
    m.includes('permission denied') ||
    m.includes('row-level security') ||
    m.includes('not authenticated') ||
    m.includes('invalid signature') ||
    m.includes('bucket not found') ||
    m.includes('payload too large') ||
    m.includes('enoent') ||
    m.includes('no such file') ||
    // Revoked blob:/data: URL — see utils/fileBytes.readFileBytes. The
    // browser released the image on page reload; no retry can undo that.
    m.includes('photo source expired') ||
    m.includes('file does not exist') ||
    m.includes("could not be read") ||
    m.includes('is not readable') ||
    m.includes('does not exist') ||
    m.includes('empty file')
  );
}

/**
 * Decide what an upload failure means. Order matters: "already exists" is
 * checked before terminal so a 409 is never mistaken for a hard failure, and
 * transient is checked before retryable so an offline device never spends its
 * retry budget.
 */
export function classifyPhotoUploadError(err: unknown): PhotoUploadOutcome {
  const msg = messageOf(err);
  if (isAlreadyUploaded(msg)) return 'already-uploaded';
  if (isTransient(err, msg)) return 'transient';
  if (isTerminal(msg)) return 'terminal';
  return 'retryable';
}

/** True when the outcome means the bytes are safely in the bucket. */
export function isUploadSettled(outcome: PhotoUploadOutcome): boolean {
  return outcome === 'success' || outcome === 'already-uploaded';
}

// ─── Queue operations ───────────────────────────────────────────────────────

export interface EnqueueResult {
  queue: PhotoUploadTask[];
  /** Oldest tasks shed because the cap was exceeded. Their files are orphaned. */
  dropped: PhotoUploadTask[];
  /** True when an existing task for the same storagePath was replaced. */
  deduped: boolean;
}

/**
 * Append a task, de-duplicating by storagePath and enforcing the FIFO cap.
 *
 * Dedupe matters because the path is deterministic per photo: a re-save, a
 * double-tap, or a re-mount that replays `addProjectPhoto` would otherwise
 * queue the same upload N times and upload the same bytes N times. The NEWEST
 * task wins (its localUri is the one that's actually on disk) but it keeps the
 * ORIGINAL queuedAt so a repeatedly-retried photo can't starve newer ones by
 * jumping to the back of the line forever.
 */
export function enqueuePhotoUpload(
  queue: PhotoUploadTask[],
  task: PhotoUploadTask,
  cap: number = PHOTO_MAX_QUEUE,
): EnqueueResult {
  const existingIdx = queue.findIndex((t) => t.storagePath === task.storagePath);
  let next: PhotoUploadTask[];
  let deduped = false;
  if (existingIdx >= 0) {
    deduped = true;
    const existing = queue[existingIdx];
    next = [...queue];
    next[existingIdx] = { ...task, queuedAt: existing.queuedAt, retryCount: existing.retryCount };
  } else {
    next = [...queue, task];
  }

  const dropped: PhotoUploadTask[] = [];
  if (next.length > cap) {
    dropped.push(...next.splice(0, next.length - cap)); // FIFO: shed oldest
  }
  return { queue: next, dropped, deduped };
}

/** Oldest-first drain order. Photos sync in the order they were taken. */
export function sortPhotoQueue(queue: PhotoUploadTask[]): PhotoUploadTask[] {
  return [...queue].sort((a, b) => a.queuedAt - b.queuedAt || a.id.localeCompare(b.id));
}

export interface OutcomeDecision {
  /** True → the task stays queued for a later flush. */
  keep: boolean;
  /** The task as it should be persisted when kept (retryCount may be bumped). */
  task: PhotoUploadTask;
  /** True → permanently discarded; the user must be told. */
  dropped: boolean;
}

/**
 * Turn an outcome into a keep/drop decision.
 *
 * The `transient` branch is the offline-first guarantee: re-queue UNCHANGED,
 * retryCount untouched. A device in a basement for a week must still have its
 * photos when it surfaces.
 */
export function applyPhotoUploadOutcome(
  task: PhotoUploadTask,
  outcome: PhotoUploadOutcome,
  maxRetries: number = PHOTO_MAX_RETRIES,
): OutcomeDecision {
  if (isUploadSettled(outcome)) {
    return { keep: false, task, dropped: false };
  }
  if (outcome === 'transient') {
    return { keep: true, task, dropped: false };
  }
  if (outcome === 'terminal') {
    return { keep: false, task, dropped: true };
  }
  const bumped = { ...task, retryCount: task.retryCount + 1 };
  if (bumped.retryCount >= maxRetries) {
    return { keep: false, task: bumped, dropped: true };
  }
  return { keep: true, task: bumped, dropped: false };
}

/**
 * Merge a finished flush back into whatever is persisted NOW.
 *
 * Copied in spirit from offlineQueue's write-back: overwriting the queue with
 * the flush's `remaining` list would clobber any task enqueued while the flush
 * was in its (slow, network-bound) phase — i.e. every photo the user took
 * during the sync. Instead, entries that were part of the flush are replaced by
 * their kept version (or removed if settled/dropped), and entries that were NOT
 * in the flush snapshot are preserved verbatim.
 */
export function reconcilePhotoQueue(
  current: PhotoUploadTask[],
  flushIds: Set<string>,
  keptById: Map<string, PhotoUploadTask>,
): PhotoUploadTask[] {
  const next: PhotoUploadTask[] = [];
  for (const entry of current) {
    if (flushIds.has(entry.id)) {
      const kept = keptById.get(entry.id);
      if (kept) next.push(kept);
      // else: uploaded / terminally failed / retry-exhausted → drop
    } else {
      next.push(entry); // enqueued mid-flush — preserve
    }
  }
  return next;
}
