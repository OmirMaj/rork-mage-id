import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { isTransportError } from '@/utils/networkErrors';
import { recordIdOf } from '@/utils/syncRecordKey';

const OFFLINE_QUEUE_KEY = 'mageid_offline_queue';
const MAX_RETRIES = 5;
const MAX_QUEUE = 1000;

// The device's last-signed-in user, written by contexts/AuthContext.tsx
// (LAST_USER_ID_KEY there — the literal is repeated here because AuthContext
// imports this module, so importing it back would be a cycle). Read ONLY to
// decide whether a queue entry that pre-dates per-entry tagging (B1 below) may
// be flushed under the current session.
const LAST_USER_ID_KEY = 'mageid_last_user_id';

export interface OfflineMutation {
  id: string;
  table: string;
  // 'rpc' (wave 4, CONTRACT 1): a SECURITY DEFINER function call that changes
  // ONE record (invoice_append_payment). `data.id` is that record's id, so the
  // ordering guard and the flush's per-record FIFO group treat it like any
  // other write of the record — an invoice UPDATE can never overtake a queued
  // payment append, nor the append a queued invoice INSERT.
  operation: 'insert' | 'upsert' | 'update' | 'delete' | 'rpc';
  data: Record<string, unknown>;
  /** operation 'rpc' only: the function and its arguments. */
  rpc?: { fn: string; args: Record<string, unknown> };
  timestamp: number;
  retryCount: number;
  // SYNC-F1: set once an RLS rejection on a projects-dependent INSERT has been
  // retried. A second rejection is then genuine (the parent never arrived).
  rlsRetried?: boolean;
  // B1 (review 2026-09-05): the user whose session was live when this was
  // enqueued. A flush dispatches ONLY entries tagged for the session it runs
  // under — never the previous tenant's writes under the next tenant's JWT. An
  // entry with no tag was queued before tagging shipped; it is eligible only
  // when the device's last-user marker names the session user, and is tagged
  // on its way through.
  userId?: string;
  /** Ids of device-side records that RIDE this write and mean nothing without
   *  it — a change order's owed audit entries (integration round 2). Carried
   *  onto its Not-saved line, so a Discard of that line drops exactly them;
   *  the time window it replaced guessed wrong whenever the write had waited
   *  on an earlier one before it was sent. */
  rides?: string[];
}

// ── Change listeners ────────────────────────────────────────────────────────
// Fired after an enqueue and after every per-group write-back with the new
// persisted depth, so a UI (the Settings sign-out dialog, a sync pill) can show
// how much has not reached the cloud without polling storage.
type ChangeListener = (depth: number) => void;
const changeListeners = new Set<ChangeListener>();

export function onQueueChanged(listener: ChangeListener): () => void {
  changeListeners.add(listener);
  return () => { changeListeners.delete(listener); };
}

function notifyQueueChanged(depth: number): void {
  for (const listener of changeListeners) {
    try { listener(depth); } catch { /* never let a listener break the queue */ }
  }
}

// ── Flush listeners ─────────────────────────────────────────────────────────
// A queued write lands on the server LATER, during a flush — not at supabaseWrite
// call time. Any read cache that was invalidated synchronously at call time (and
// then re-populated by a read before the flush landed) is stale until the flush
// completes and nothing tells it to drop that snapshot. Modules that cache reads
// of a table can register here and invalidate when that table's queued writes
// actually flush. Kept as a tiny registry so offlineQueue takes NO dependency on
// its consumers (predictionLedger etc.) — the dependency is inverted.
type FlushListener = (tables: Set<string>) => void;
const flushListeners = new Set<FlushListener>();

/** Register a callback invoked after a flush that SUCCESSFULLY processed at least
 *  one write, with the set of tables whose writes landed. Returns an unsubscribe.
 *  Listener errors are swallowed — telemetry/cache plumbing must never wedge the
 *  queue. */
export function onQueueFlushed(listener: FlushListener): () => void {
  flushListeners.add(listener);
  return () => { flushListeners.delete(listener); };
}

function notifyFlushed(tables: Set<string>): void {
  if (tables.size === 0 || flushListeners.size === 0) return;
  for (const listener of flushListeners) {
    try { listener(tables); } catch { /* never let a listener break the flush */ }
  }
}

// Serializes every read-modify-write of the persisted queue behind a single
// promise chain. Without this, a mutation enqueued DURING a flush races the
// flush's write-back: both read the queue, then the flush's wholesale
// overwrite clobbers the freshly-appended mutation. Each enqueue and the
// flush's write-back run their critical section through withQueueLock so
// they execute one-at-a-time. The lock is NOT held across the flush's
// (slow, network-bound) processing — only across storage read-modify-write —
// so offline optimism stays responsive.
let queueLock: Promise<unknown> = Promise.resolve();
function withQueueLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = queueLock.then(fn, fn);
  // Keep the chain alive and swallow errors so one failed section never
  // rejects the next waiter.
  queueLock = run.then(() => undefined, () => undefined);
  return run;
}

// ── Per-record write slots (wave 4: #23/#24/#102/#138/#139) ──────────────────
// ONE class of loss, five findings: a later write of a record overtaken by, or
// replayed under, an earlier write of the same record. A clock-out sent
// directly while the clock-in INSERT sat in the queue matched 0 rows, PostgREST
// called it success, and the queued insert then landed "on the clock"; an RFI
// closed online after an offline "answered" edit was re-opened when the older
// edit drained; a daily report re-saved after signal returned reverted to the
// morning draft. Per-table guards in ProjectContext covered change orders,
// invoices and punch pins and nothing else.
//
// Fixed once, here. Every write of a record — direct insert/upsert/update/
// delete/rpc AND the flush's send of that record's group — holds the record's
// slot while it runs. A later write of the same record waits for the slot and
// only THEN checks the queue (the earlier write may just have fallen into it
// on a network error), so writes of one record reach the server, or the
// queue, strictly in the order they were made. The flush registers its own
// group AFTER any direct write already in flight and never waits on a slot it
// holds, so the two cannot deadlock. In memory only: a slot is "on the wire
// right now", which does not survive a kill — the persisted queue is what
// orders writes across launches.
const recordSlots = new Map<string, Promise<void>>();
/** When a `projects` write last settled, by project id — see #4 below. A
 *  monotonic sequence, not Date.now(): "did the job land AFTER this child was
 *  sent?" must not be decided by two events sharing a millisecond (a job that
 *  settled, then a child sent in the same ms, read as a race and queued a
 *  genuinely refused child). */
const projectWriteSettledAt = new Map<string, number>();
let writeOrderSeq = 0;

function withRecordSlot<T>(keys: readonly string[], fn: () => Promise<T>): Promise<T> {
  const prevs: Promise<void>[] = [];
  for (const k of keys) {
    const p = recordSlots.get(k);
    if (p) prevs.push(p);
  }
  const run = prevs.length > 0 ? Promise.all(prevs).then(fn) : fn();
  const settled = run.then(() => undefined, () => undefined);
  for (const k of keys) recordSlots.set(k, settled);
  void settled.then(() => {
    const at = ++writeOrderSeq;
    for (const k of keys) {
      if (recordSlots.get(k) === settled) recordSlots.delete(k);
      if (k.startsWith('projects:')) projectWriteSettledAt.set(k.slice('projects:'.length), at);
    }
  });
  return run;
}

/** A record's slot key — the SAME rule the flush groups by (recordIdOf), so
 *  the live guard and the flush's per-record FIFO agree on what "the same
 *  record" is. null = no key (an insert with no id): nothing to order. */
function recordKeyOf(table: string, data: Record<string, unknown> | undefined): string | null {
  const id = recordIdOf(table, data);
  return id === null ? null : `${table}:${id}`;
}

// The record key rule (integration round 3: per table) lives in
// utils/syncRecordKey.ts — a leaf module, so the bun validators run it.
export { recordIdOf };

// #32: the server numbers RFIs and submittals per project IN ARRIVAL ORDER
// (a BEFORE INSERT trigger under an advisory lock). Creates of one project's
// RFIs therefore share a second slot, so a batch sent in creation order lands
// in creation order, and a create never overtakes an earlier create of the
// same project that is sitting in the queue.
const NUMBERED_TABLES = new Set(['rfis', 'submittals']);

function numberedKeyOf(table: string, operation: string, data: Record<string, unknown> | undefined): string | null {
  if (operation !== 'insert' || !NUMBERED_TABLES.has(table)) return null;
  const pid = data?.project_id;
  return typeof pid === 'string' && pid.length > 0 ? `${table}#numbered:${pid}` : null;
}

// ── Drain soon after a direct write (#138 (d)) ──────────────────────────────
// OfflineSyncManager drains on launch, foreground and a backoff that is armed
// only by a drain that LEFT work. So a queue that was waiting when signal came
// back sat for up to 5 minutes while the app stayed open — the whole window
// the overtake findings live in. A direct write that just landed is proof the
// network is up: if this session still has queued work, drain it in ~1 s.
// Single-flight; a drain already running is waited out first, because its
// snapshot predates whatever was just queued behind it.
let autoDrainDelayMs: number | null = 1000;
let autoDrainTimer: ReturnType<typeof setTimeout> | null = null;

/** Tests only: `null` turns the post-write drain off (a stray timer would
 *  flush the NEXT test's seeded queue); a number sets its delay. */
export function configureAutoDrain(delayMs: number | null): void {
  autoDrainDelayMs = delayMs;
  if (delayMs === null && autoDrainTimer) {
    clearTimeout(autoDrainTimer);
    autoDrainTimer = null;
  }
}

function scheduleQueueDrain(): void {
  if (autoDrainDelayMs === null || autoDrainTimer) return;
  autoDrainTimer = setTimeout(() => {
    autoDrainTimer = null;
    void (async () => {
      try { if (inFlight) await inFlight; } catch { /* the next drain decides */ }
      try { await processOfflineQueue(); } catch { /* OfflineSyncManager retries */ }
    })();
  }, autoDrainDelayMs);
}

// ── Session identity ────────────────────────────────────────────────────────
// B1: every enqueue records who was signed in, and a flush is bound to ONE
// session from start to finish. The sign-in paths in AuthContext already drop
// the previous tenant's queue on a tenant switch — but gotrue's SIGNED_IN
// callback flips `isAuthenticated` (and starts a drain) BEFORE
// signInWithPassword resolves, and a flush that outlives the 20 s sign-out
// ceiling keeps dispatching after the session it started under is gone. Each
// group resolves its bearer at send time, so both windows would send the old
// user's snapshot under the new user's JWT (or anonymously). The identity
// checks below are what closes them: no session → nothing is sent; a session
// that ends or changes hands mid-flush → dispatch stops and the rest stays
// queued, nothing dropped.
interface SessionUser { id: string }

// A4 (review 2026-09-05, round 3): `supabase.auth.getSession()` is not a
// local read. When the stored access token has expired it refreshes over the
// network FIRST — so an enqueue on a captive-portal Wi-Fi stalled behind that
// request, and a write made after an hour offline (token expired, refresh
// unreachable) was queued UNTAGGED, where the next tenant's marker could adopt
// it. The signed-in user is therefore kept here, fed by the auth client's own
// state feed (INITIAL_SESSION / SIGNED_IN / TOKEN_REFRESHED / SIGNED_OUT) and
// primed once from getSession(). Tagging and the mid-flush identity checks
// read the module value; getSession() is consulted only while it is unknown.
let knownSessionUser: SessionUser | null | undefined; // undefined = not learned yet
let sessionWatchStarted = false;
let sessionPrime: Promise<SessionUser | null> | null = null;

function sessionUserOf(session: { user?: { id?: unknown } | null } | null | undefined): SessionUser | null {
  const id = session?.user?.id;
  return typeof id === 'string' && id.length > 0 ? { id } : null;
}

function startSessionWatch(): void {
  if (sessionWatchStarted) return;
  sessionWatchStarted = true;
  try {
    supabase.auth.onAuthStateChange((_event, session) => {
      knownSessionUser = sessionUserOf(session);
    });
  } catch {
    // No feed (a stub client) — every read falls back to getSession() below.
  }
}

function primeSessionUser(): Promise<SessionUser | null> {
  if (sessionPrime) return sessionPrime;
  sessionPrime = (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      // A state change that arrived while getSession() was in flight is newer
      // than its answer — the older read must not overwrite it.
      if (knownSessionUser === undefined) knownSessionUser = sessionUserOf(data?.session);
      return knownSessionUser;
    } catch {
      return knownSessionUser ?? null; // still unknown: asked again next time
    } finally {
      sessionPrime = null;
    }
  })();
  return sessionPrime;
}

async function currentSessionUser(): Promise<SessionUser | null> {
  startSessionWatch();
  if (knownSessionUser !== undefined) return knownSessionUser;
  return primeSessionUser();
}

/** The signed-in user's id as the auth feed last reported it (null when signed
 *  out). Shared with utils/photoUploadQueue.ts so both queues agree on who is
 *  signed in without a network round trip. */
export async function currentSessionUserId(): Promise<string | null> {
  return (await currentSessionUser())?.id ?? null;
}

// The one thing the feed cannot tell: whether supabase-js can still put a
// bearer on a request RIGHT NOW. After the access token expires and the refresh
// fails, `getSession()` answers no session — and supabase-js then sends the
// ANON key, so PostgREST/Storage reject the write under RLS and the message
// reads as terminal. A rejection answered to a request that carried no user
// token is not a verdict on the write. Consulted only on the rejection path,
// never on the happy path (it may wait on gotrue's own refresh).
export async function bearerStillLive(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    return typeof token === 'string' && token.length > 0;
  } catch {
    return false;
  }
}

async function readLastUserMarker(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(LAST_USER_ID_KEY);
  } catch {
    return null;
  }
}

// Transient network/connectivity failure — the write never reached the
// server but nothing is wrong with it. Such mutations must be re-queued
// UNCHANGED and must never consume the retry budget: a device that's merely
// offline would otherwise exhaust MAX_RETRIES and silently drop the user's
// data. ONE classifier for the live path and the flush.
//
// #2 (wave 4): this used to be three case-sensitive substrings. iOS aborts a
// request on a bars-but-no-throughput jobsite with TypeError('Network request
// timed out'), postgrest-js turns it into {message: 'TypeError: Network
// request timed out', code: ''} and the throw below re-wraps it as a plain
// Error — so it matched nothing, was toasted "Couldn't save", never queued,
// and the next list read deleted the record. utils/networkErrors owns the
// wording (CONTRACT 15; never a bare 'timeout' — Postgres 57014 is the server
// answering). The HTTP status is the sturdier signal and is carried onto both
// throws: postgrest answers status 0 when no response ever came back, and
// 502/503/504 are the gateway saying the database was not reached. A plain
// 500 is PostgREST reporting a real database error and stays on the retry
// budget — queueing those forever would trade loss for a queue that never
// drains.
const TRANSIENT_HTTP_STATUSES = new Set([0, 502, 503, 504]);

function isNetworkError(err: unknown): boolean {
  if (isTransportError(err)) return true;
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === 'number' && TRANSIENT_HTTP_STATUSES.has(status);
}

// A PostgREST schema-cache miss (PGRST204 — "Could not find the '<col>' column
// of '<table>' in the schema cache", or the table-level variant) surfaces when
// an OTA that writes a new column/table reaches devices before its migration is
// applied to prod — OR during the brief window while PostgREST reloads its
// schema cache right AFTER the migration lands. Either way it is TRANSIENT and
// self-heals the moment the schema catches up, so it must be treated exactly
// like a network error: re-queue the write UNCHANGED and retry WITHOUT burning
// the retry budget. Classifying it terminal (or letting it exhaust MAX_RETRIES)
// would silently DROP offline-created rows during a migration-before-OTA race —
// the punch-item sync regression this guards against.
function isSchemaCacheError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('pgrst204') ||
    m.includes('schema cache') ||
    (m.includes('could not find') && (m.includes('column') || m.includes('table')))
  );
}

/** The persisted queue, or a THROW if storage could not produce one.
 *
 *  A8 (review 2026-09-05, round 5): most callers can treat "unreadable" as
 *  "empty" — a flush with nothing to send is harmless, and the entries are
 *  still on disk for the next pass. ONE caller cannot: the retain path below
 *  runs immediately before AuthContext stamps the last-user marker, and a
 *  swallowed read error there reports `{kept: 0, dropped: 0}` — indistinguishable
 *  from "there was nothing to keep" — so the marker gets stamped over a queue
 *  nobody could read, and every untagged entry in it becomes adoptable by the
 *  session that just arrived. It has to be able to tell the two apart.
 */
async function readOfflineQueueOrThrow(): Promise<OfflineMutation[]> {
  const stored = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
  return stored ? JSON.parse(stored) as OfflineMutation[] : [];
}

export async function getOfflineQueue(): Promise<OfflineMutation[]> {
  try {
    return await readOfflineQueueOrThrow();
  } catch {
    return [];
  }
}

/** How a persisted queue splits for one session: `own` is what that session
 *  may dispatch (tagged for it, or untagged with the device's last-user marker
 *  naming it — tagged on the way through); `foreign` is everything else. */
export interface QueuePartition { own: OfflineMutation[]; foreign: OfflineMutation[] }

/**
 * THE ONE RULE for whether an UNTAGGED entry (queued before per-entry tagging
 * shipped) belongs to this session: the device's last-user marker names this
 * user. Returns the entry tagged, or unchanged.
 *
 * Extracted so the count the user is shown and the FAILURE RECORD the user is
 * shown cannot disagree. They did: the queue-cap drop path passed raw entries
 * to notifyDroppedWrites, so a legacy untagged write was recorded with no
 * userId — and ownFailures deliberately ignores untagged entries — while the
 * same entry WAS being counted as pending here. The pending number ticked down
 * and nothing turned red, which is the precise failure the ledger exists to
 * stop.
 */
export function adoptUntaggedForSession(
  m: OfflineMutation,
  sessionUserId: string,
  marker: string | null,
): OfflineMutation {
  if (!m.userId && marker === sessionUserId) return { ...m, userId: sessionUserId };
  return m;
}

export function partitionQueueForSession(
  queue: readonly OfflineMutation[],
  sessionUserId: string,
  marker: string | null,
): QueuePartition {
  const own: OfflineMutation[] = [];
  const foreign: OfflineMutation[] = [];
  for (const m of queue) {
    const tagged = adoptUntaggedForSession(m, sessionUserId, marker);
    if (tagged.userId === sessionUserId) own.push(tagged);
    else foreign.push(m);
  }
  return { own, foreign };
}

// A3 (review 2026-09-05, round 3): the entries the CURRENT session can still
// send — what a sync pill or a sign-out dialog should count. Another tenant's
// entries (left for the tenant switch to drop) are not this user's unsynced
// work and must not be shown as such. No session → nothing is anyone's.
export async function getOwnOfflineQueue(): Promise<OfflineMutation[]> {
  const user = await currentSessionUser();
  if (!user) return [];
  // A1 (review 2026-09-05, round 4): MARKER FIRST, QUEUE SECOND — see the same
  // ordering (and the reason for it) in runOfflineQueue below. Display-only
  // here, but a count that adopts the previous tenant's untagged entries is the
  // number the sign-out dialog puts in front of the user.
  const marker = await readLastUserMarker();
  const queue = await getOfflineQueue();
  return partitionQueueForSession(queue, user.id, marker).own;
}

/** What getOwnOfflineQueue cannot express: storage REFUSED the read, so the
 *  empty array it would have returned means "we could not look", not "there is
 *  nothing waiting". A flush is right to treat those the same; a status
 *  indicator is not — an unreadable queue rendered as a green all-clear is the
 *  exact lie hooks/useSyncStatus exists to stop. */
export interface OwnQueueRead { entries: OfflineMutation[]; readFailed: boolean }

export async function getOwnOfflineQueueDetailed(): Promise<OwnQueueRead> {
  const user = await currentSessionUser();
  if (!user) return { entries: [], readFailed: false };
  const marker = await readLastUserMarker();
  try {
    const queue = await readOfflineQueueOrThrow();
    return { entries: partitionQueueForSession(queue, user.id, marker).own, readFailed: false };
  } catch {
    return { entries: [], readFailed: true };
  }
}

// A2: the ONLY way to empty the queue. Runs under the same lock as every
// read-modify-write, so a flush that outlives the sign-out ceiling cannot read
// the queue before the wipe and write its snapshot back after it — which is
// how a removed key came back holding the previous tenant's entries.
// AuthContext.wipeLocalUserCache calls this instead of removing the key.
export async function clearOfflineQueue(): Promise<void> {
  await withQueueLock(async () => {
    await AsyncStorage.removeItem(OFFLINE_QUEUE_KEY);
  });
  notifyQueueChanged(0);
}

/** How much of a queue an arriving session is allowed to keep. */
export interface RetainOptions {
  /**
   * What to do with an entry that carries NO `userId` (queued before B1's
   * tagging shipped, or with no session at the time).
   *
   * `true` (the default, and what every existing caller gets) drops it: on an
   * install with no last-user marker it may be another tenant's, and the marker
   * AuthContext stamps next is exactly what would let a flush adopt it.
   *
   * `false` keeps it — for the callers that can PROVE the untagged entries are
   * the arriving user's. See the platform gate on AuthContext's mount-effect
   * backfill: only the web can hand a session to a different user before app
   * code runs.
   */
  dropUntagged?: boolean;
}

/** What a retain did. `readFailed` is the case a count cannot express: storage
 *  refused, so NOTHING was inspected and NOTHING was written — the queue is
 *  exactly as it was, and the caller must not act as though it were empty. */
export interface RetainResult { kept: number; dropped: number; readFailed: boolean }

// Same lock discipline for AuthContext's marker-less keep path: keep only the
// entries tagged for `userId`, drop the rest — untagged entries included by
// default, since on an install with no last-user marker they may be another
// tenant's, and the marker written next would let a flush adopt them.
// `dropUntagged: false` is the caller's assertion that they cannot be.
export async function retainOfflineQueueForUser(userId: string, opts: RetainOptions = {}): Promise<RetainResult> {
  const counts = await withQueueLock(async () => {
    const dropUntagged = opts.dropUntagged ?? true;
    let current: OfflineMutation[];
    try {
      current = await readOfflineQueueOrThrow();
    } catch (err) {
      // A8: NOT `{kept: 0, dropped: 0}`. Nothing was read, so nothing is
      // written and nothing is dropped; the caller decides (AuthContext leaves
      // the last-user marker unwritten, which keeps every untagged entry
      // un-adoptable).
      console.warn('[OfflineQueue] Could not read the queue to narrow it — leaving it untouched:', err);
      return { kept: 0, dropped: 0, readFailed: true };
    }
    const own = current.filter((m) => m.userId === userId || (!m.userId && !dropUntagged));
    if (own.length !== current.length) {
      if (own.length === 0) await AsyncStorage.removeItem(OFFLINE_QUEUE_KEY);
      else await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(own));
    }
    return { kept: own.length, dropped: current.length - own.length, readFailed: false };
  });
  if (counts.dropped > 0) notifyQueueChanged(counts.kept);
  return counts;
}

/**
 * #90 · Take queued writes OUT of the queue through the failure path, because
 * the app has learned they can never land — not because a send failed. The
 * one caller today: the projects load found a job he was removed from, and
 * every write still queued for it would be refused by RLS (terminal) on the
 * next flush anyway, reported only as "couldn't be synced (daily_reports)".
 * Here each entry is dropped with the caller's own sentence ("You no longer
 * have access to Henderson Remodel"), recorded in the sync ledger and toasted
 * like any other drop — never silently. `reasonFor` returns that sentence to
 * drop an entry, or null to keep it. Runs under the queue lock. Returns how
 * many were dropped.
 */
export async function discardQueuedWrites(reasonFor: (m: OfflineMutation) => string | null): Promise<number> {
  const dropped: { entry: OfflineMutation; reason: string }[] = [];
  let remaining = -1;
  await withQueueLock(async () => {
    let current: OfflineMutation[];
    try { current = await readOfflineQueueOrThrow(); } catch { return; }
    const keep: OfflineMutation[] = [];
    for (const m of current) {
      let reason: string | null = null;
      try { reason = reasonFor(m); } catch { reason = null; }
      if (reason) dropped.push({ entry: m, reason }); else keep.push(m);
    }
    if (dropped.length === 0) return;
    if (keep.length === 0) await AsyncStorage.removeItem(OFFLINE_QUEUE_KEY);
    else await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(keep));
    remaining = keep.length;
  });
  if (dropped.length === 0) return 0;
  const byReason = new Map<string, OfflineMutation[]>();
  for (const d of dropped) {
    const list = byReason.get(d.reason) ?? [];
    list.push(d.entry);
    byReason.set(d.reason, list);
  }
  // Recorded as NOTES (integration round 1): these writes are to a job he
  // left or was removed from and can never land, so the sheet must not offer
  // a Retry that re-toasts "you do not have permission" every tap — the same
  // way discardQueuedPhotoUploads records its photos.
  for (const [reason, entries] of byReason) await notifyDroppedWrites(entries, reason, { asNotes: true });
  if (remaining >= 0) notifyQueueChanged(remaining);
  return dropped.length;
}

type NewMutation = Omit<OfflineMutation, 'id' | 'timestamp' | 'retryCount' | 'userId'>;

async function buildEntry(mutation: NewMutation, writer?: { userId: string | undefined }): Promise<OfflineMutation> {
  // B1: tag the entry with the signed-in user BEFORE taking the storage lock
  // (a session read is not a queue read-modify-write). No session → no tag;
  // the flush then treats it like a pre-tagging entry (marker must match).
  // Integration round 1: a direct write that falls into the queue passes the
  // WRITER it captured when it started (see directWrite) — a request that was
  // in flight across a sign-out and someone else's sign-in must not be queued
  // under the account that happened to be signed in when it timed out.
  const userId = writer ? writer.userId : (await currentSessionUser())?.id;
  return {
    ...mutation,
    id: `oq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    retryCount: 0,
    ...(userId ? { userId } : {}),
  };
}

/** The append itself. MUST run inside withQueueLock — split out so the
 *  ordering guard in supabaseWriteDetailed can read the queue and append
 *  behind an earlier write of the same record in ONE critical section. */
async function appendEntryLocked(entry: OfflineMutation, onFail?: DropNoticeOpts): Promise<void> {
  const userId = entry.userId;
  try {
    // Integration round 1: the THROWING read. getOfflineQueue answers [] on a
    // storage error, and pushing onto that [] then wrote the whole stored queue
    // back as this one entry — every other queued write gone (e.g. an Android
    // value past the 2 MB CursorWindow). An unreadable queue fails the enqueue
    // instead: the catch below records the entry, the caller hears 'failed'.
    const queue = await readOfflineQueueOrThrow();
    queue.push(entry);
    if (queue.length > MAX_QUEUE) {
      const droppedEntries = queue.splice(0, queue.length - MAX_QUEUE); // FIFO: drop oldest
      console.warn(`[OfflineQueue] cap ${MAX_QUEUE} exceeded — dropped ${droppedEntries.length} oldest mutation(s)`);
      // Tag the drops the SAME way the pending count tags them, or the two
      // disagree about legacy untagged entries: they are counted as this
      // user's while queued (adoptUntaggedForSession, via
      // partitionQueueForSession) but would be recorded as nobody's once
      // dropped, so the pending number would tick down with nothing turning
      // red. The marker read is deferred into this branch because the cap is
      // rare and the enqueue path is hot.
      const marker = userId ? await readLastUserMarker() : null;
      // Awaited, and BEFORE the write below removes them (round 2): the
      // ledger holds them before the queue lets go.
      await notifyDroppedWrites(
        userId ? droppedEntries.map((m) => adoptUntaggedForSession(m, userId, marker)) : droppedEntries,
        'queue cap exceeded',
      );
    }
    await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
    console.log('[OfflineQueue] Queued mutation:', entry.table, entry.operation);
    notifyQueueChanged(queue.length);
  } catch (err) {
    // HEALTH-F10: the enqueue itself failed (storage full / unavailable). The
    // optimistic local state stands and NOTHING is queued — that is a dropped
    // write, so report it like one and rethrow so supabaseWrite can surface
    // it to its caller instead of pretending the write is safe.
    console.warn('[OfflineQueue] Failed to queue mutation:', entry.table, entry.operation, err);
    // Awaited (round 2): the caller hears 'failed' only once the line exists,
    // so an edit made right after it is parked behind it. `onFail` narrows the
    // report — a Retry's resend already has its line (a second one per tap
    // was how an unreadable queue grew the sheet), a caller that owns its
    // refusal records nothing, and a write the signed-out account made is
    // not toasted to the new one.
    await notifyDroppedWrites([entry], `enqueue failed: ${err instanceof Error ? err.message : String(err)}`, onFail);
    throw err;
  }
}

export async function addToOfflineQueue(mutation: NewMutation): Promise<void> {
  const entry = await buildEntry(mutation);
  return withQueueLock(() => appendEntryLocked(entry));
}

// Wave 5 (CONTRACT 21 / 22): the two `projects` refusals the app knows by name
// — the free plan's one-project cap on a new job (23514) and a delete of a job
// with safety records (23001). Neither message says "violates", so
// isTerminalError below missed them and the cap refusal burned all five
// retries. The classifier lives in utils/syncLedger (pure), required lazily
// like every other ledger use here; a failed require classifies nothing.
type KnownRefusalKind = import('@/utils/syncLedger').KnownRefusal;
function knownRefusal(table: string, operation: string, message: string, code?: string): KnownRefusalKind | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ledger = require('@/utils/syncLedger') as typeof import('@/utils/syncLedger');
    return ledger.knownRefusalOf(table, operation, message, code);
  } catch {
    return null;
  }
}
function knownRefusalReason(kind: KnownRefusalKind): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ledger = require('@/utils/syncLedger') as typeof import('@/utils/syncLedger');
    return ledger.KNOWN_REFUSAL_REASON[kind];
  } catch {
    return kind === 'free_plan_project_cap'
      ? 'Free plan allows 1 project — upgrade, or delete a job first'
      : 'This job has safety records — it was not deleted';
  }
}

// #61 (CONTRACT 22): a projects DELETE the server refused for safety records.
// The job was removed from the phone before the write was sent (and, when the
// delete sat in the queue, maybe days before); the server still has it and
// every record under it. ProjectContext listens and re-reads, which puts the
// job and its lists back — the refusal is recorded as a NOTE, never as a
// delete line (a delete line would keep the job hidden until Discard).
type DeleteRefusedListener = (projectId: string, reason: string) => void;
const deleteRefusedListeners = new Set<DeleteRefusedListener>();
export function onProjectDeleteRefused(listener: DeleteRefusedListener): () => void {
  deleteRefusedListeners.add(listener);
  return () => { deleteRefusedListeners.delete(listener); };
}
// Fix round 1 · The job's safety lists. The local delete fired ProjectContext's
// projectDeletion signal, and SafetyContext pruned this job's incidents, JHAs,
// toolbox talks, hazards and inspections from memory and its cache — the very
// OSHA records that blocked the delete. ProjectContext's re-read cannot reach
// them (SafetyProvider sits BELOW it and owns its own lists), so the refusal
// also announces these tables on the flush channel: SafetyContext already
// re-reads a table named there (onQueueFlushed → rereadTables), and the server
// still holds every row. An extra re-read for any other listener is harmless.
const PROJECT_SAFETY_TABLES = ['safety_incidents', 'jhas', 'toolbox_talks', 'hazards', 'safety_inspections'] as const;
function notifyProjectDeleteRefused(projectId: unknown, reason: string): void {
  if (typeof projectId !== 'string' || projectId.length === 0) return;
  for (const listener of deleteRefusedListeners) {
    try { listener(projectId, reason); } catch { /* never let a listener break the queue */ }
  }
  notifyFlushed(new Set<string>(PROJECT_SAFETY_TABLES));
}

// Auth/permission errors are terminal — the queue can't recover by retrying,
// and a stuck 401 from a stale session would otherwise loop forever.
//
// Foreign-key violations are deliberately NOT terminal: when a parent and its
// children are created in the same offline session, the flush processes
// record-groups concurrently, so a child insert can reach the server before
// its parent. That heals on a later pass once the parent lands — classifying
// it terminal would permanently discard the child. FK failures fall through
// to the retryCount path below (bounded by MAX_RETRIES, so a child whose
// parent GENUINELY never arrives still gets dropped rather than looping).
function isTerminalError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('unauthorized') ||
    m.includes('permission denied') ||
    m.includes('row-level security') ||
    (m.includes('violates') && !m.includes('foreign key')) ||
    m.includes('not authenticated')
  );
}

// Audit appendix (05-offline-sync): `m.includes('jwt')` used to make ANY
// JWT-expiry message during a long flush terminal, so the write was DROPPED
// when the token merely needed a refresh. PGRST301 ("JWT expired", a bad
// signature) and GoTrue's bad_jwt are transient: on a rejected token
// lib/supabase.ts refreshes the session once — it does NOT retry the original
// request, so THIS write still fails — and the next flush lands it under the
// fresh token. Treat exactly like a network error — keep unchanged, never
// spend the retry budget. A permanently dead session is handled by the
// sign-in paths (the queue is kept for the same user, dropped for another).
function isAuthTransientError(message: string, code?: string): boolean {
  if (code === 'PGRST301') return true;
  const m = message.toLowerCase();
  return (
    m.includes('jwt') ||
    m.includes('jws') ||
    m.includes('bad_jwt') ||
    m.includes('invalid claim') ||
    (m.includes('token') && m.includes('expired'))
  );
}

// SYNC-F1: Postgres evaluates a table's RLS WITH CHECK before its FK trigger,
// so a child inserted before its parent project fails with an RLS rejection —
// not the FK violation the retry path was written for. On a table whose insert
// policy depends on the project existing (any payload carrying project_id) the
// rejection is therefore retryable once; a second one is genuine.
function isRlsRejection(message: string): boolean {
  return message.toLowerCase().includes('row-level security');
}

function dependsOnProjectRow(mutation: OfflineMutation): boolean {
  return (
    (mutation.operation === 'insert' || mutation.operation === 'upsert') &&
    typeof mutation.data?.project_id === 'string'
  );
}

// SYNC-F4: a kill or crash mid-flush re-sends inserts that already landed. The
// re-sent row collides on its PRIMARY KEY (client-generated ids), and that
// collision means "already on the server" — success, so the record's queued
// dependent updates still apply instead of being dropped as orphans. Scoped to
// `_pkey` on purpose: a duplicate on any OTHER unique constraint (a document
// number, a per-project natural key) is a genuine conflict and stays terminal.
// Every primary key in supabase/schema.sql is named `<table>_pkey`.
function isAlreadyLandedInsert(error: { message: string; code?: string }): boolean {
  const m = error.message.toLowerCase();
  const duplicate = error.code === '23505' || m.includes('duplicate key value violates unique constraint');
  if (!duplicate) return false;
  const constraint = /constraint "([^"]+)"/.exec(error.message)?.[1];
  return !constraint || constraint.endsWith('_pkey');
}

/**
 * #122 carry (wave 4): a primary-key duplicate proves the id EXISTS, not that
 * the caller's insert is what put it there. Under own-row SELECT policies (the
 * safety tables, and any table whose ids are derived — a DFR's injury case is
 * `safetyIncidentIdForReport(reportId)`) the row can be SOMEONE ELSE'S: the
 * foreman's case update collides with the GC's case, and "already landed"
 * reported his change as saved when it had reached nothing. So re-read the id
 * as the caller. Seen → it really is on the server (a re-send after a killed
 * flush or a timed-out insert). Not seen → a conflict with a row he cannot
 * see: dropped as NOT_VISIBLE_CONFLICT and shown, never counted as success.
 * The read itself failing on the network → 'unknown': keep the write queued.
 */
/**
 * The tables the #122 re-check runs on — and ONLY these. Read from production
 * pg_policy (2026-09-19): each lets a field collaborator INSERT
 * (`auth.uid() = user_id AND can_access_project(project_id,'field')`) but
 * SELECT only his own rows or the project owner's, and each carries ids a
 * second author can derive (the DFR's injury case is
 * safetyIncidentIdForReport(reportId)). That is the one shape where a _pkey
 * duplicate means "someone else's row".
 *
 * Everywhere else the old rule stands (a _pkey duplicate = his own re-send
 * landed), because a re-read there proves nothing: a table whose INSERT check
 * admits rows its SELECT does not show back to the author would read a real
 * landing as 'hidden' and report a saved record as a conflict. The ones
 * production has today — change_order_approvals (insert by portalId, select
 * needs project_id), portal_messages (client-authored rows, same), messages
 * (select via conversation membership), project_financials (insert as editor,
 * select needs financials access) — are exactly why this is an allow-list and
 * not a deny-list: a new policy of that shape must not silently start
 * producing false "not saved" rows. A table joins this set only when its
 * SELECT is author/owner-scoped AND its ids can be derived by two people.
 */
export const OWN_ROW_CONFLICT_TABLES: ReadonlySet<string> = new Set([
  'safety_incidents',
  'jhas',
  'toolbox_talks',
  'hazards',
  'safety_inspections',
]);

async function duplicateRowVisibility(table: string, data: Record<string, unknown>): Promise<'visible' | 'hidden' | 'unknown'> {
  // Outside the own-row-conflict tables a re-read cannot tell his landing
  // from someone else's row — keep the old "already landed" rule.
  if (!OWN_ROW_CONFLICT_TABLES.has(table)) return 'visible';
  const id = data?.id;
  if (typeof id !== 'string' || id.length === 0) return 'visible'; // nothing to re-read: the old rule
  try {
    const res = await supabase.from(table).select('id').eq('id', id);
    if (res.error) {
      const err = Object.assign(new Error(res.error.message), { code: res.error.code, status: res.status });
      if (isNetworkError(err)) return 'unknown';
      return isAccessRejection(res.error.message) || res.error.code === '42501' ? 'hidden' : 'visible';
    }
    return Array.isArray(res.data) && res.data.length > 0 ? 'visible' : 'hidden';
  } catch {
    return 'unknown';
  }
}

const NOT_VISIBLE_CONFLICT = 'not_visible_conflict';

/** Is an INSERT/UPSERT of this rpc's record still in storage, outside the
 *  group being sent? (A direct insert on the wire cannot be: the flush's
 *  group waited for every direct write of the record before it started —
 *  see withRecordSlot.) Unreadable storage counts as "still pending": keeping
 *  a write is never wrong, dropping one is. */
async function insertStillPendingFor(mutation: OfflineMutation, excludeIds: Set<string>): Promise<boolean> {
  const id = mutation.data?.id;
  if (typeof id !== 'string' || id.length === 0) return false;
  try {
    const queue = await readOfflineQueueOrThrow();
    return queue.some((m) => !excludeIds.has(m.id) && m.table === mutation.table && m.data?.id === id
      && (m.operation === 'insert' || m.operation === 'upsert'));
  } catch {
    return true;
  }
}

/** A record-scoped rpc answering "that record does not exist (yet)" —
 *  invoice_append_payment's invoice_not_found (P0002). */
function isRecordNotFound(message: string, code?: string): boolean {
  return code === 'P0002' || /_not_found\b/i.test(message);
}

// The project a child group belongs to, for the parent-first gating below. Any
// mutation in the group may carry it — an insert always does, a later update
// for the same record may not.
function childProjectId(group: OfflineMutation[]): string | undefined {
  for (const m of group) {
    const pid = m.data?.project_id;
    if (typeof pid === 'string' && pid.length > 0) return pid;
  }
  return undefined;
}

// ── Drop listeners (A6) ─────────────────────────────────────────────────────
// The generic toast below can only name a TABLE ("1 change couldn't be synced
// (portal_messages)"). A screen that owns the record can do better — say what
// was lost in the user's own words and refresh itself — so it registers here.
// A listener returns the entries it reported itself, so the generic toast does
// not repeat them; Sentry always hears about every drop. Listener errors are
// swallowed — telemetry must never wedge the queue.
export type DroppedListener = (dropped: readonly OfflineMutation[], reason: string) => readonly OfflineMutation[] | void;
const droppedListeners = new Set<DroppedListener>();

export function onQueueDropped(listener: DroppedListener): () => void {
  droppedListeners.add(listener);
  return () => { droppedListeners.delete(listener); };
}

/** The ledger line for a write that will not be sent on its own: who, what,
 *  why, and everything Retry needs to send it again. */
function ledgerEntryFor(
  ledger: typeof import('@/utils/syncLedger'),
  m: OfflineMutation,
  reason: string,
  asNote = false,
): import('@/utils/syncLedger').SyncFailure {
  const rid = recordIdOf(m.table, m.data);
  const label = ledger.labelForWrite(m.table, m.operation === 'rpc' ? m.rpc : undefined);
  // A NOTE carries no table, record id or payload: nothing to resend, and the
  // record is not kept on the phone because of it (unsavedIdsIn reads table +
  // recordId). For writes that can never land — see discardQueuedWrites.
  if (asNote) return { id: m.id, kind: 'write', label, reason, at: Date.now(), userId: m.userId };
  return {
    id: m.id,
    kind: 'write',
    label,
    reason,
    at: Date.now(),
    userId: m.userId,
    table: m.table,
    ...(rid !== null ? { recordId: rid } : {}),
    operation: m.operation,
    ...(m.operation === 'rpc' ? (m.rpc ? { rpc: m.rpc } : {}) : { row: m.data }),
    ...(m.rides && m.rides.length > 0 ? { rides: m.rides } : {}),
    queuedAt: m.timestamp,
  };
}

// A queued write was permanently discarded (terminal error, retry exhaustion,
// or queue-cap overflow). For an offline-first app, silent data loss is the
// worst failure mode — surface it on the toast host and forward to Sentry so
// the user can re-enter the data and we can see the pattern in prod. Lazy
// requires keep this module side-effect free at load (same pattern as
// supabaseWrite's AUD-001 handling below).
/**
 * The durable half of a drop, AWAITED (integration round 2). A flush drop used
 * to leave the queue at its group's write-back while its ledger line was
 * written only after every tier had finished — and even then without waiting.
 * For the rest of the flush the record was in neither the queue nor the
 * ledger, so an edit made meanwhile went out as a 0-row UPDATE ("synced") and
 * a list read deleted the device row. The flush now calls this INSIDE the
 * group's record slot, before its write-back removes the entries: at every
 * instant a dropped write is in the queue, the ledger, or both.
 */
async function recordDropsInLedger(entries: readonly OfflineMutation[], reason: string, asNotes = false): Promise<void> {
  if (entries.length === 0) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ledger = require('@/utils/syncLedger') as typeof import('@/utils/syncLedger');
    // #1: with the payload, so the row stays on the phone (unsavedWriteIds)
    // and the pill can offer a real Retry instead of "re-enter it".
    await ledger.recordSyncFailures(entries.map((m) => ledgerEntryFor(ledger, m, reason, asNotes)));
  } catch {/* a ledger write must never wedge the queue */}
}

/** Entries bucketed by the reason `reasons` names for each (insertion order). */
function groupByReason(entries: readonly OfflineMutation[], reasons: ReadonlyMap<string, string>): Map<string, OfflineMutation[]> {
  const out = new Map<string, OfflineMutation[]>();
  for (const m of entries) {
    const why = reasons.get(m.id);
    if (!why) continue;
    const list = out.get(why) ?? [];
    list.push(m);
    out.set(why, list);
  }
  return out;
}

interface DropNoticeOpts {
  /** Record as notes (no payload, no Retry) — see discardQueuedWrites. */
  asNotes?: boolean;
  /** The flush already wrote the lines (recordDropsInLedger, inside the
   *  group's slot). Writing them again here could resurrect a line he
   *  retried or discarded while the rest of the flush was still running. */
  alreadyRecorded?: boolean;
  /** No ledger line at all: a Retry's own resend (its line already exists),
   *  or a caller that owns its refusal (callerOwnsRefusal). */
  noLedger?: boolean;
  /** No toast: the write is not the live session's (it was made by the
   *  account that signed out) — the new user never touched it. */
  noToast?: boolean;
}

async function notifyDroppedWrites(entries: readonly OfflineMutation[], reason: string, opts?: DropNoticeOpts): Promise<void> {
  if (entries.length === 0) return;
  if (!opts?.alreadyRecorded && !opts?.noLedger) await recordDropsInLedger(entries, reason, opts?.asNotes === true);
  notifyDropListeners(entries, reason, opts?.noToast === true);
}

function notifyDropListeners(entries: readonly OfflineMutation[], reason: string, noToast: boolean): void {
  // DURABLE FIRST (recordDropsInLedger, above). Everything below this block is a NOTIFICATION — a toast that
  // is a no-op when the host is unmounted (which is the normal case: drops
  // happen during a background flush on the wake after signal returns) and a
  // Sentry warning the user cannot read. Meanwhile the queue depth has just
  // gone DOWN, so without a written record the sync pill gets QUIETER as work
  // is lost. utils/syncLedger.ts is that record; hooks/useSyncStatus reads it
  // and the pill says "2 didn't sync" instead of showing nothing.
  //
  // Recorded for EVERY dropped entry, including ones a listener claims below —
  // claiming only suppresses the generic toast (usePortalThread renders its own
  // in-thread), and the device-level "what did I lose today" answer must still
  // be complete. Lazy require keeps this module side-effect free at load, the
  // same as the Sentry and toast requires.
  const claimed = new Set<string>();
  // A write the signed-out account made is not this session's to react to:
  // no screen listener (it would revert or re-read the new user's copy of a
  // record he never touched) and no toast.
  for (const listener of noToast ? [] : droppedListeners) {
    try {
      for (const m of listener(entries, reason) ?? []) claimed.add(m.id);
    } catch { /* never let a listener break the queue */ }
  }
  const unclaimed = entries.filter((m) => !claimed.has(m.id));
  if (unclaimed.length > 0 && !noToast) {
    const tableList = [...new Set(unclaimed.map((m) => m.table))].join(', ');
    // Wave 5: a known refusal says what happened and what to do, not "re-check".
    let known: string | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      known = (require('@/utils/syncLedger') as typeof import('@/utils/syncLedger')).knownRefusalToast(reason);
    } catch { known = null; }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { oops } = require('@/components/animations/NailItToast');
      oops(known ?? `${unclaimed.length} change(s) couldn't be synced (${tableList}). Please re-check that data.`);
    } catch {/* toast host not mounted — nothing actionable */}
  }
  try {
    const allTables = [...new Set(entries.map((m) => m.table))].join(', ');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require('@sentry/react-native');
    Sentry.captureMessage(`[OfflineQueue] dropped ${entries.length} write(s): ${allTables} (${reason})`, 'warning');
  } catch {/* ignore */}
}

// A5 (review 2026-09-05, round 3): when is a dropped `projects` write proof
// that its queued children can never land? Every child INSERT policy is
// can_access_project(project_id), so a child needs the row to exist AND be
// reachable for this user:
//   • a dropped INSERT — the row has never been on the server (a re-sent
//     insert that had landed reads as 23505 = success, never as a drop);
//   • an UPSERT refused for ACCESS (RLS / permission / auth) — whatever row is
//     there is not this user's to touch, and can_access_project says the same
//     for every child.
// An upsert dropped for its PAYLOAD (a check violation, retry exhaustion) is
// often an EDIT of a project that already exists on the server, whose queued
// DFRs and photos can still land — those children keep the B2 hold instead.
function isAccessRejection(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes('row-level security') || m.includes('permission denied')
    || m.includes('unauthorized') || m.includes('not authenticated');
}

function dropDoomsChildren(mutation: OfflineMutation, message: string): boolean {
  if (mutation.table !== 'projects') return false;
  if (mutation.operation === 'insert') return true;
  return mutation.operation === 'upsert' && isAccessRejection(message);
}

// ── A7 (review 2026-09-05, round 4): the doom reaches the PHOTO queue too ───
// The tier gating below drops a doomed project's queued OFFLINE-QUEUE children
// with it. Its queued PHOTOS live in utils/photoUploadQueue.ts, which this
// module must not import (that queue imports this one). Without a channel they
// were dispatched anyway: every one of them burned all PHOTO_RLS_MAX_RETRIES
// against a `projects` row that will never exist, then raised its own separate
// "couldn't be uploaded" toast a day after the parent's.
//
// So a flush records the doomed project ids here and the photo drain — which
// OfflineSyncManager and flushQueuesBeforeSignOut always run immediately after
// the text flush — consumes them with takeDoomedProjectIds(), drops those
// photos without a dispatch, and names them in that flush's ONE report. Read
// once and cleared, in memory only: a verdict, not state.
//
// A8 (review 2026-09-05, round 5): AND IT EXPIRES. takeDoomedProjectIds() is
// reached only by a drain that has photos of its own to settle, so a verdict
// recorded while the photo queue was EMPTY — much the commonest case, since a
// project whose insert was just refused usually has no photos yet — used to sit
// here for the life of the process. Two costs: the set never shrinks, and a
// photo taken MINUTES later for that same project id (the row can be re-created
// or re-sent under the same id) is dropped on sight, told to "re-take them",
// against a verdict from a flush the user has long since dealt with.
//
// So each verdict carries the sequence number of the flush that recorded it,
// every photo drain takes a watermark before it starts, and whatever it did not
// consume by the time it finishes is expired (expireDoomedProjectIds). The
// watermark — rather than a blanket clear — is what keeps a verdict recorded
// WHILE a drain was in its network phase alive for the drain that follows it.
const doomedProjectIds = new Map<string, number>();
let doomSeq = 0;

/** Record: the projects whose queued write this flush dropped for good. */
function recordDoomedProjects(ids: Iterable<string>): void {
  for (const pid of ids) doomedProjectIds.set(pid, ++doomSeq);
}

/** Take (and clear) the projects whose queued write was dropped for a reason
 *  that dooms everything hanging off them. Called by the photo drain. */
export function takeDoomedProjectIds(): Set<string> {
  if (doomedProjectIds.size === 0) return new Set();
  const taken = new Set(doomedProjectIds.keys());
  doomedProjectIds.clear();
  return taken;
}

/** The verdict counter as it stands now. A photo drain reads this BEFORE it
 *  starts and hands it back to expireDoomedProjectIds() when it finishes. */
export function doomWatermark(): number {
  return doomSeq;
}

/** Spend every verdict recorded at or before `mark` that nothing consumed: the
 *  drain that could have acted on it has now run. Anything recorded after the
 *  mark (a text flush that landed while the drain was in the air) survives for
 *  the next drain. Returns what it dropped, for the log. */
export function expireDoomedProjectIds(mark: number): string[] {
  const spent: string[] = [];
  for (const [pid, seq] of doomedProjectIds) {
    if (seq <= mark) {
      doomedProjectIds.delete(pid);
      spent.push(pid);
    }
  }
  return spent;
}

// Re-entrancy guard. Startup, AppState-foreground, AND the self-rescheduling
// backoff drain (OfflineSyncManager) can all invoke processOfflineQueue while
// a previous flush is still in its network phase. Two overlapping flushes each
// snapshot the SAME persisted queue and re-send the same mutations via plain
// .insert — producing DUPLICATE server rows (daily reports / invoices / change
// orders). To prevent that, all callers coalesce onto a single shared in-flight
// promise: while a flush runs, every additional call returns that same promise
// instead of starting a concurrent flush. The handle is cleared in a `finally`
// so a thrown/failed flush never wedges the guard permanently.
/** What a flush did. `remaining` counts only THIS session's entries still
 *  queued; `foreign` counts entries the flush left untouched because they are
 *  not this session's to send (tagged for another user, untagged without the
 *  marker's vouching — or, with no session at all, every entry). A3: the sync
 *  manager backs off on `remaining` alone — another tenant's leftovers are the
 *  tenant switch's to drop, not a reason to retry forever. */
export interface FlushResult { processed: number; failed: number; remaining: number; foreign: number }

let inFlight: Promise<FlushResult> | null = null;

export function processOfflineQueue(): Promise<FlushResult> {
  if (inFlight) return inFlight;
  inFlight = runOfflineQueue().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runOfflineQueue(): Promise<FlushResult> {
  if (!isSupabaseConfigured) return { processed: 0, failed: 0, remaining: 0, foreign: 0 };

  // A1 (review 2026-09-05, round 4): READ THE MARKER BEFORE THE QUEUE, always.
  //
  // Every path that hands the device to another user empties the queue FIRST and
  // writes the marker AFTER (AuthContext.completeSignIn / onNewSessionEstablished
  // / the mount-effect backfill: clearOfflineQueue or retainOfflineQueueForUser,
  // then writeLastUser). Reading in the opposite order can therefore pair a
  // PRE-clear queue snapshot with a POST-clear marker, and every untagged entry
  // in that stale snapshot is then adopted as the new session's own and
  // dispatched under their JWT — the exact leak the tagging exists to stop.
  //
  // Marker-then-queue is monotonically safe: if the marker read lands before the
  // stamp it cannot name this session (so nothing untagged is adopted), and if it
  // lands after, the queue read that FOLLOWS it is necessarily after the clear
  // that preceded the stamp, so there is nothing stale left to adopt.
  const marker = await readLastUserMarker();

  const queue = await getOfflineQueue();
  if (queue.length === 0) return { processed: 0, failed: 0, remaining: 0, foreign: 0 };

  // B1 (b): no session, nothing sent. Every entry stays exactly as it is —
  // the next signed-in flush decides what belongs to whom.
  const flushUser = await currentSessionUser();
  if (!flushUser) {
    console.log('[OfflineQueue] No session — leaving', queue.length, 'queued mutation(s) untouched');
    return { processed: 0, failed: 0, remaining: 0, foreign: queue.length };
  }
  const flushUserId = flushUser.id;

  // B1 (d): only this session's entries are dispatched. An entry tagged for
  // someone else stays queued untouched (AuthContext drops it on the tenant
  // switch that is usually already under way); an untagged, pre-tagging entry
  // is adopted only when the device's last-user marker names the session user.
  const { own: eligible, foreign: foreignEntries } = partitionQueueForSession(queue, flushUserId, marker);
  if (foreignEntries.length > 0) {
    console.log('[OfflineQueue] Skipping', foreignEntries.length, 'queued mutation(s) that belong to another session');
  }
  // A3: what is still ours, and what never was, as persisted NOW.
  const tally = async (): Promise<{ remaining: number; foreign: number }> => {
    const now = partitionQueueForSession(await getOfflineQueue(), flushUserId, marker);
    return { remaining: now.own.length, foreign: now.foreign.length };
  };
  if (eligible.length === 0) return { processed: 0, failed: 0, ...(await tally()) };

  console.log('[OfflineQueue] Processing', eligible.length, 'queued mutations');

  const sorted = [...eligible].sort((a, b) => a.timestamp - b.timestamp);

  // B1 (c): re-read the session before every batch AND before every single
  // dispatch. The moment it is gone or belongs to someone else, stop — leave
  // everything not yet sent exactly where it is. Sticky: once the flush has
  // lost its session it never resumes, even if the same user signs back in
  // before it winds down (that sign-in starts its own drain).
  let stopped = false;
  // Wave 5 (CONTRACT 22): projects whose delete the server refused this flush,
  // announced once the flush has written everything back — a re-read started
  // earlier would still find the delete queued and keep the job hidden.
  const refusedDeletes: { id: unknown; reason: string }[] = [];
  async function sessionStillOurs(): Promise<boolean> {
    if (stopped) return false;
    const live = await currentSessionUser();
    if (live && live.id === flushUserId) return true;
    stopped = true;
    console.warn('[OfflineQueue] Session', live ? 'changed hands' : 'ended', 'mid-flush — leaving the rest queued');
    return false;
  }

  // Group by record key to allow bounded concurrency across records while
  // preserving strict ordering within each record (insert-before-update, etc.).
  // An insert with no data.id yet gets its own singleton group keyed by
  // mutation.id so it never races with mutations for other records.
  //
  // SYNC-F6 (medium-sweep #24, never landed): rows keyed by something other
  // than `id` — project_financials / building_access_rules (PK project_id),
  // portal snapshots (portal_id / sub_portal_id) — fall back to THAT key, so two
  // queued upserts for one project serialize oldest-first instead of racing in
  // the same batch where the older could win.
  const groupMap = new Map<string, OfflineMutation[]>();
  for (const mutation of sorted) {
    // recordIdOf — the ledger's and the slot's rule (integration round 3: per
    // table, so two id-less notices of one job are two groups).
    const recordKey = `${mutation.table}:${recordIdOf(mutation.table, mutation.data) ?? mutation.id}`;
    let group = groupMap.get(recordKey);
    if (!group) {
      group = [];
      groupMap.set(recordKey, group);
    }
    group.push(mutation);
  }

  // Process one group serially; return its accounting totals. `conflicts` is
  // the subset of `dropped` that collided with a row the user cannot see
  // (#122) — reported under its own reason, not as a generic failure.
  async function processGroup(group: OfflineMutation[]): Promise<{ processed: number; failed: number; remaining: OfflineMutation[]; dropped: OfflineMutation[]; processedTables: Set<string>; doomsChildren: boolean; conflicts?: OfflineMutation[]; reasons?: Map<string, string>; notes?: Set<string> }> {
    const gConflicts: OfflineMutation[] = [];
    // Wave 5 (CONTRACT 21 / 22): a drop with its own sentence (the known
    // refusals) — recorded under it instead of DROP_REASON — and the drops
    // recorded as NOTES (no payload, no Retry: the safety refusal).
    const gReasons = new Map<string, string>();
    const gNotes = new Set<string>();
    let gProcessed = 0;
    let gFailed = 0;
    const gRemaining: OfflineMutation[] = [];
    const gDropped: OfflineMutation[] = [];
    const gProcessedTables = new Set<string>();
    // A5: set when a dropped `projects` write proves its children can never
    // land (see dropDoomsChildren) — the tier gating drops them with it.
    let gDoomsChildren = false;

    // Integration round 1: a record whose earlier write sits in the sync
    // ledger (refused, or dropped by an earlier flush) is not sent at all —
    // the same rule the direct path keeps (queueBehindEarlierWrite). Its queued
    // writes are parked in the ledger behind the unsaved ones and go out, in
    // order, only through Retry: sent now, an UPDATE matches 0 rows against the
    // never-landed INSERT and reports success, and Retry then resends the
    // INSERT as it was. Left alone while Retry is replaying the record — it may
    // just have queued the oldest write itself.
    // The ledger's record key (recordIdOf — id, else the table's own primary
    // key), not data.id alone: a project_financials group has no id
    // and was never parked (integration round 2).
    const headId = recordIdOf(group[0].table, group[0].data);
    if (headId !== null) {
      let ledger: typeof import('@/utils/syncLedger') | null = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        ledger = require('@/utils/syncLedger') as typeof import('@/utils/syncLedger');
      } catch { ledger = null; }
      if (ledger && !ledger.isRecordRetrying(group[0].table, headId)
          && (await ledger.hasUnsavedChain(flushUserId, group[0].table, headId))) {
        // Integration round 3: a write that provably commutes with the chain
        // (syncLedger.writeIsIndependentOfChain — a profile column the refused
        // lines never touch) is SENT, in order, instead of parked. Each write
        // is judged against the chain as it stands after the ones before it
        // were parked, so a later write touching a just-parked column parks.
        const independent: OfflineMutation[] = [];
        for (const [index, mutation] of group.entries()) {
          const answer = await ledger.parkOrPassBehindUnsavedWrite(ledgerEntryFor(
            ledger, { ...mutation, userId: flushUserId }, 'waiting behind an earlier change that was not saved',
          ));
          if (answer === 'independent') {
            independent.push(mutation);
          } else if (answer === 'no_chain') {
            // The unsaved writes went (Retry landed them, or Discard) between
            // the look and the park: this and the rest are sent next flush.
            gRemaining.push(...group.slice(index));
            break;
          } else {
            gFailed++;
          }
        }
        if (gFailed > 0) console.log('[OfflineQueue] Parked', gFailed, 'queued write(s) behind an unsaved earlier write of the same record');
        if (independent.length === 0) {
          return { processed: 0, failed: gFailed, remaining: gRemaining, dropped: [], processedTables: gProcessedTables, doomsChildren: false, conflicts: [] };
        }
        // Only the independent writes go on to the send loop below; the
        // parked ones are in the ledger and the rest stay queued (gRemaining).
        group = independent;
      }
    }

    // ABORT THE GROUP ON THE FIRST FAILURE.
    //
    // Grouping exists to preserve intra-record ordering (see the comment where
    // groupMap is built). The loop used to `continue` past a failed mutation to
    // the next one for the SAME record, which defeats that entirely and loses
    // the user's work silently:
    //
    //   A contractor working offline — the normal jobsite state — creates a
    //   change order and then approves it up to $7,500 in the same session.
    //   On the next flush the INSERT fails (FK: the parent project row has not
    //   synced yet). The loop continues to the queued UPDATE, which runs
    //   `update(rest).eq('id', id)` against a row that does not exist. That
    //   matches ZERO rows and PostgREST returns NO ERROR — so gProcessed++
    //   fires, the mutation is discarded at write-back, and the insert
    //   succeeds on a later flush carrying its ORIGINAL $5,000 payload.
    //
    // The $7,500 approval is gone from the server, from every other device, and
    // from the homeowner's portal. changeOrdersQuery is server-first and calls
    // saveLocal, so the device that made the edit reverts to match on next
    // launch. Create-then-delete resurrects the deleted row permanently.
    //
    // `index` lets the failure branches re-queue the untouched remainder.
    for (const [index, mutation] of group.entries()) {
      // B1 (c): the bearer is resolved by supabase-js at send time, so check
      // right before each send that it is still the session this flush
      // started under. Not ours any more → this and everything after it in
      // the group stay queued, unchanged.
      if (!(await sessionStillOurs())) {
        gRemaining.push(...group.slice(index));
        break;
      }
      try {
        let error: { message: string; code?: string } | null = null;
        // #2: carried onto the throw so status 0 / 502-504 read as transient.
        let status: number | undefined;
        let notVisible = false;

        if (mutation.operation === 'insert') {
          // Plain insert — upsert here would silently overwrite a colliding
          // row that some other client already created, masking conflicts.
          const result = await supabase.from(mutation.table).insert(mutation.data);
          error = result.error;
          status = result.status;
          // SYNC-F4: a primary-key duplicate means this insert already landed
          // in a flush that was killed before its write-back — IF the caller
          // can see that row (#122: re-read it, see duplicateRowVisibility).
          if (error && isAlreadyLandedInsert(error)) {
            const seen = await duplicateRowVisibility(mutation.table, mutation.data);
            if (seen === 'visible') {
              error = null;
              console.log('[OfflineQueue] Insert already on server, treating as success:', mutation.table);
            } else if (seen === 'hidden') {
              notVisible = true;
            } else {
              throw Object.assign(new Error('Network request failed while confirming a duplicate insert'), { status: 0 });
            }
          }
        } else if (mutation.operation === 'upsert') {
          // Explicit create-or-replace for single-owner rows the app is the
          // source of truth for (e.g. the user's own project row). Callers
          // opt in — 'insert' stays plain so real conflicts still surface.
          const result = await supabase.from(mutation.table).upsert(mutation.data);
          error = result.error;
          status = result.status;
        } else if (mutation.operation === 'update') {
          const { id, ...rest } = mutation.data;
          const result = await supabase.from(mutation.table).update(rest).eq('id', id as string);
          error = result.error;
          status = result.status;
          // NOT CHANGED DELIBERATELY: this does not assert a non-zero row match.
          //
          // The audit suggested `{ count: 'exact' }` here and treating a 0-row
          // update as a failure. That closes one hole and opens a worse one: a
          // row legitimately deleted on another device makes every queued edit
          // for it fail forever, and a mutation that can never succeed and is
          // never dropped is an immortal queue entry — the exact bug already
          // fixed for revoked blob: photo uploads (utils/fileBytes.ts).
          //
          // The group abort above removes the reachable cause: a 0-row update
          // happened because an EARLIER mutation for the same record failed and
          // the loop carried on regardless. With the group aborted, an update
          // only runs after its own insert succeeded. Distinguishing "parent
          // not synced yet" from "row deleted elsewhere" needs a tombstone the
          // schema does not have; adding retry semantics without it would trade
          // silent loss for silent immortality.
        } else if (mutation.operation === 'delete') {
          const result = await supabase.from(mutation.table).delete().eq('id', mutation.data.id as string);
          error = result.error;
          status = result.status;
        } else if (mutation.operation === 'rpc') {
          // CONTRACT 1: a record-scoped function call, grouped with the
          // record's other writes by data.id so it replays in the order made.
          if (!mutation.rpc || typeof mutation.rpc.fn !== 'string') {
            error = { message: 'violates queue contract: rpc entry without a function' };
          } else {
            const result = await supabase.rpc(mutation.rpc.fn, mutation.rpc.args ?? {});
            error = result.error;
            status = result.status;
          }
        } else {
          // FORWARD COMPATIBILITY (integration round 1). An operation this build
          // does not know — written by a newer OTA, then rolled back — used to
          // fall through with error null, count as processed and be DROPPED at
          // write-back with no report (the ab5bab13 flush did exactly that to
          // 'rpc' payment appends). Keep it, unchanged, with the rest of its
          // record, for the build that can send it.
          console.warn('[OfflineQueue] Unknown operation — keeping it queued for a build that knows it:', mutation.table, String(mutation.operation));
          gRemaining.push(...group.slice(index));
          break;
        }

        if (notVisible) {
          // #122: the id belongs to a row this user cannot see. Not a
          // success, not a retry — dropped under its own reason, and the rest
          // of the record's writes (which would be 0-row no-ops against a row
          // he does not own) go with it and are reported, never hidden.
          console.warn('[OfflineQueue] Insert collides with a row this user cannot see — dropping as a conflict:', mutation.table);
          const lost = group.slice(index);
          gFailed += lost.length;
          gDropped.push(...lost);
          gConflicts.push(...lost);
          if (dropDoomsChildren(mutation, 'row-level security')) gDoomsChildren = true;
          break;
        }

        if (error) {
          // Carry the PostgREST/Postgres code so classification below can key
          // on it (PGRST301, 23505) and not only on message text — and the
          // HTTP status (#2) so a request that never got an answer is transient.
          throw Object.assign(new Error(error.message), { code: error.code, status });
        }

        gProcessed++;
        gProcessedTables.add(mutation.table);
        console.log('[OfflineQueue] Processed:', mutation.table, mutation.operation);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const code = (err as { code?: string } | null)?.code;
        if (isNetworkError(err) || isSchemaCacheError(msg) || isAuthTransientError(msg, code)) {
          // Offline / transient — re-queue UNCHANGED. Crucially do NOT bump
          // retryCount: a device that's merely offline (or hitting a not-yet-
          // migrated schema cache) must never burn through its retry budget and
          // permanently drop the write. It self-heals when connectivity returns
          // or the migration lands. retryCount is reserved for genuine
          // server-side (5xx / transient-but-terminal) failures below.
          console.log('[OfflineQueue] Transient error, keeping mutation queued:', mutation.table, mutation.operation);
          gRemaining.push(mutation);
          // Everything after this belongs to the SAME record and must not be
          // attempted against a row this mutation has not created/updated yet.
          gRemaining.push(...group.slice(index + 1));
          break;
        }
        // CONTRACT 1: an rpc on a record whose INSERT is still waiting (queued
        // under another entry, or on the wire as a direct write) is early, not
        // wrong — keep it, unchanged, no retry spent.
        if (mutation.operation === 'rpc' && isRecordNotFound(msg, code)
            && (await insertStillPendingFor(mutation, new Set(group.map((m) => m.id))))) {
          console.log('[OfflineQueue] rpc ran before its record landed — keeping it queued:', mutation.table, mutation.rpc?.fn);
          gRemaining.push(...group.slice(index));
          break;
        }
        // Wave 5 (CONTRACT 21 / 22): a known refusal is a verdict on the FIRST
        // answer — no bearer check (both triggers run only after RLS let a
        // signed-in caller through), no retry budget. The cap refusal keeps
        // its row for Retry and, like any refused create, dooms the job's
        // queued children (they are recorded with their rows too). The safety
        // refusal is recorded as a note and ProjectContext puts the job back.
        const known = knownRefusal(mutation.table, mutation.operation, msg, code);
        if (known) {
          const reason = knownRefusalReason(known);
          console.warn('[OfflineQueue] Refused by the server, not retried:', mutation.table, mutation.operation, known);
          const lost = group.slice(index);
          gFailed += lost.length;
          gDropped.push(...lost);
          for (const m of lost) gReasons.set(m.id, reason);
          if (known === 'project_has_safety_records') {
            for (const m of lost) gNotes.add(m.id);
            refusedDeletes.push({ id: mutation.data?.id, reason });
          } else if (mutation.table === 'projects') {
            gDoomsChildren = true;
          }
          break;
        }
        if (isTerminalError(msg) || code === '42501') {
          // A4: a rejection answered to a request that carried NO user token
          // (the access token expired and gotrue could not refresh it, so
          // supabase-js fell back to the anon key) says nothing about the
          // write. Keep the whole group unchanged and stop the flush; the
          // next drain runs under a live bearer or not at all.
          if (!(await bearerStillLive())) {
            stopped = true;
            console.warn('[OfflineQueue] Rejected with no live bearer — not a verdict, leaving the rest queued:', mutation.table, mutation.operation);
            gRemaining.push(...group.slice(index));
            break;
          }
          // SYNC-F1: an RLS rejection on a projects-dependent INSERT is what a
          // child looks like when its parent row is not on the server yet
          // (WITH CHECK runs before the FK). Retry it ONCE — bump the retry
          // budget, keep the whole group in order — so it lands on the next
          // flush once the parent has. A second rejection is genuine.
          if (isRlsRejection(msg) && dependsOnProjectRow(mutation) && !mutation.rlsRetried) {
            console.log('[OfflineQueue] RLS rejection on child insert, retrying once:', mutation.table);
            mutation.rlsRetried = true;
            mutation.retryCount++;
            gRemaining.push(mutation);
            gRemaining.push(...group.slice(index + 1));
            break;
          }
          console.warn('[OfflineQueue] Terminal error, discarding mutation:', mutation.table, mutation.operation, msg);
          gFailed++;
          gDropped.push(mutation);
          if (dropDoomsChildren(mutation, msg)) gDoomsChildren = true;
          // The rest of the group dies WITH it, and is REPORTED as dropped
          // rather than silently discarded. If an insert is permanently
          // rejected (RLS, auth), its dependent edits can never apply — but
          // letting them run would make them 0-row no-ops that report SUCCESS,
          // which is how the data loss above happens. Counting them as failed
          // is what surfaces the loss to the user instead of hiding it.
          const orphaned = group.slice(index + 1);
          if (orphaned.length > 0) {
            console.warn('[OfflineQueue] Dropping', orphaned.length, 'dependent mutation(s) for the same record');
            gFailed += orphaned.length;
            gDropped.push(...orphaned);
          }
          break;
        }
        mutation.retryCount++;
        if (mutation.retryCount >= MAX_RETRIES) {
          console.warn('[OfflineQueue] Discarding mutation after max retries:', mutation.table, mutation.operation, err);
          gFailed++;
          gDropped.push(mutation);
          if (dropDoomsChildren(mutation, msg)) gDoomsChildren = true;
          // Same reasoning as the terminal branch — the dependents are dead and
          // must be reported, not silently turned into 0-row successes.
          const orphaned = group.slice(index + 1);
          if (orphaned.length > 0) {
            gFailed += orphaned.length;
            gDropped.push(...orphaned);
          }
        } else {
          gRemaining.push(mutation);
          gRemaining.push(...group.slice(index + 1));
        }
        break;
      }
    }

    return { processed: gProcessed, failed: gFailed, remaining: gRemaining, dropped: gDropped, processedTables: gProcessedTables, doomsChildren: gDoomsChildren, conflicts: gConflicts, reasons: gReasons, notes: gNotes };
  }

  type GroupResult = Awaited<ReturnType<typeof processGroup>>;

  const DROP_REASON = 'terminal error or retry exhaustion';
  async function recordGroupDrops(group: GroupResult): Promise<void> {
    if (group.dropped.length === 0) return;
    // Wave 5: a drop with its own sentence (a known refusal) is recorded
    // under it below; `result` is every other drop, recorded as before.
    const reasons = group.reasons ?? new Map<string, string>();
    const notes = group.notes ?? new Set<string>();
    const result = { ...group, dropped: group.dropped.filter((m) => !reasons.has(m.id)) };
    const conflictIds = new Set((result.conflicts ?? []).map((m) => m.id));
    await recordDropsInLedger(result.dropped.filter((m) => !conflictIds.has(m.id)), DROP_REASON);
    await recordDropsInLedger(result.dropped.filter((m) => conflictIds.has(m.id)), NOT_VISIBLE_CONFLICT);
    // Each known refusal under its own sentence; the safety refusal as a
    // note (see notifyProjectDeleteRefused).
    for (const [reason, entries] of groupByReason(group.dropped.filter((m) => reasons.has(m.id)), reasons)) {
      await recordDropsInLedger(entries.filter((m) => !notes.has(m.id)), reason);
      await recordDropsInLedger(entries.filter((m) => notes.has(m.id)), reason, true);
    }
  }

  // SYNC-F4: write back PER GROUP, under the queue lock, the moment the group
  // finishes — not once after every batch. A kill mid-flush then loses at most
  // the one group in flight (whose inserts are idempotent via the 23505 rule
  // above), instead of re-sending every group the flush had already landed.
  // Same reconcile rule as before: only THIS group's ids are touched — a
  // resolved entry is dropped, a kept one is replaced by its retry-bumped copy,
  // and every other entry (other groups, anything enqueued mid-flush) is
  // preserved verbatim.
  async function writeBackGroup(group: OfflineMutation[], result: GroupResult): Promise<void> {
    const groupIds = new Set(group.map((m) => m.id));
    const keptById = new Map(result.remaining.map((m) => [m.id, m] as const));
    const depth = await withQueueLock(async () => {
      const current = await getOfflineQueue();
      // A2: the queue was emptied under this lock while the group was in
      // flight (clearOfflineQueue — a wipe on sign-out / tenant switch). There
      // is nothing to reconcile INTO; writing anything back would resurrect it.
      if (current.length === 0) return 0;
      const next: OfflineMutation[] = [];
      for (const entry of current) {
        if (!groupIds.has(entry.id)) { next.push(entry); continue; }
        const kept = keptById.get(entry.id);
        if (kept) next.push(kept); // re-queue (unchanged or retry-bumped)
        // else: processed / terminally failed / retry-exhausted → drop
      }
      await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(next));
      return next.length;
    });
    notifyQueueChanged(depth);
  }

  // The group holds its record's slot (see withRecordSlot) from before the
  // first send until its write-back is stored: a direct write of the same
  // record made meanwhile waits, then finds the queue as this group left it.
  function slotKeysFor(group: OfflineMutation[]): string[] {
    const head = group[0];
    const keys: string[] = [];
    const rk = recordKeyOf(head.table, head.data);
    if (rk) keys.push(rk);
    const nk = numberedKeyOf(head.table, head.operation, head.data);
    if (nk) keys.push(nk);
    return keys;
  }

  async function runGroup(group: OfflineMutation[]): Promise<GroupResult> {
    return withRecordSlot(slotKeysFor(group), async () => {
      const result = await processGroup(group);
      // Integration round 2: the group's drops go into the ledger HERE —
      // awaited, still holding the record's slot, BEFORE the write-back takes
      // them out of the queue. They used to be recorded only after every tier
      // had finished (and not awaited), and for that whole stretch the record
      // was in neither place: an edit made meanwhile passed both guards and
      // went out as a 0-row UPDATE that said 'synced' (Retry then landed the
      // pre-edit INSERT), and a list read deleted the device row. The toast
      // stays one per flush (notifyDroppedWrites below, alreadyRecorded).
      await recordGroupDrops(result);
      try {
        await writeBackGroup(group, result);
      } catch (err) {
        // Storage hiccup: the entries stay queued and are re-sent next flush,
        // which the 23505 rule makes safe. Never let it wedge the flush.
        console.warn('[OfflineQueue] Write-back failed, group stays queued:', err);
      }
      return result;
    });
  }

  // Bounded-concurrency async pool: at most MAX_CONCURRENCY groups in flight.
  // Returns each group paired with its outcome so the tier gating below can
  // tell which parents actually landed.
  const MAX_CONCURRENCY = 5;
  const results: GroupResult[] = [];
  async function runTier(tier: OfflineMutation[][]): Promise<{ group: OfflineMutation[]; result: GroupResult }[]> {
    const outcomes: { group: OfflineMutation[]; result: GroupResult }[] = [];
    for (let i = 0; i < tier.length; i += MAX_CONCURRENCY) {
      // B1 (c): a batch is only dispatched under the session it was queued for.
      if (!(await sessionStillOurs())) break;
      const batch = tier.slice(i, i + MAX_CONCURRENCY);
      const batchResults = await Promise.all(batch.map(runGroup));
      results.push(...batchResults);
      batch.forEach((group, j) => outcomes.push({ group, result: batchResults[j] }));
    }
    return outcomes;
  }

  // #32: RFI / submittal CREATES go one at a time, oldest first — the server
  // numbers them in arrival order, and the 5-wide pool let a batch land as a
  // permutation of the order he made them in. Once one create of a project
  // stays queued, that project's later creates wait with it (sending them
  // would hand them the lower numbers).
  async function runSerial(groups: OfflineMutation[][]): Promise<void> {
    const heldNumbered = new Set<string>();
    for (const group of groups) {
      if (!(await sessionStillOurs())) break;
      const nk = numberedKeyOf(group[0].table, group[0].operation, group[0].data) ?? group[0].table;
      if (heldNumbered.has(nk)) continue;
      const result = await runGroup(group);
      results.push(result);
      if (result.remaining.length > 0) heldNumbered.add(nk);
    }
  }

  // SYNC-F1: parents before children. Every child table's INSERT policy is
  // `can_access_project(project_id)`, which needs the project row to EXIST —
  // and Postgres evaluates it before the FK. Dispatching the project upsert in
  // the same batch as its DFR/photos/punch items let the small child rows reach
  // the server first and be rejected. So: every `projects` group runs to
  // completion (write-back included) first, then `project_financials` (its own
  // policy depends on projects), then everything else.
  const tiers: OfflineMutation[][][] = [[], [], []];
  for (const group of groupMap.values()) {
    const table = group[0].table;
    tiers[table === 'projects' ? 0 : table === 'project_financials' ? 1 : 2].push(group);
  }
  const parentOutcomes = await runTier(tiers[0]);

  // B2 (review 2026-09-05): a child whose parent did NOT land in this flush is
  // not dispatched at all. It used to be: the child reached the server, was
  // rejected by RLS, and spent its one `rlsRetried` — so a slow uplink where
  // the big `projects` upsert timed out twice while the small child insert got
  // through dropped the child as terminal on the second pass. `parentPending`
  // holds the projects whose group stayed queued or was dropped this flush;
  // their children are left in storage untouched (no dispatch, no retry
  // budget, no `rlsRetried`) and wait for the flush in which the parent lands.
  //
  // A7: a project DELETED in this flush takes its queued children with it —
  // they would only RLS-fail against a row that is gone and toast the user
  // about work they deliberately discarded. Removed from storage without a
  // dispatch and without a "couldn't be synced" report; the deletion was the
  // user's own action.
  //
  // A5 (round 3): a project whose insert/upsert was dropped for a reason that
  // dooms its children (dropDoomsChildren) takes them with it — out of storage
  // now, counted as failed, reported in the SAME toast as the parent — instead
  // of holding them one flush and then spending their RLS retry on a second.
  const parentPending = new Set<string>();
  const parentDeleted = new Set<string>();
  const parentDoomed = new Set<string>();
  for (const { group, result } of parentOutcomes) {
    const pid = group.map((m) => m.data?.id).find((id): id is string => typeof id === 'string' && id.length > 0);
    if (!pid) continue;
    // `failed` too: a projects group parked behind its unsaved writes (see
    // processGroup) did not land, so its children wait with it.
    const landed = result.remaining.length === 0 && result.dropped.length === 0 && result.failed === 0;
    if (result.doomsChildren) parentDoomed.add(pid);
    else if (!landed) parentPending.add(pid);
    else if (group[group.length - 1].operation === 'delete') parentDeleted.add(pid);
  }
  // A7: hand the same verdict to the photo queue, which cannot see this flush.
  recordDoomedProjects(parentDoomed);

  let heldForParent = 0;
  let mootForDeletedParent = 0;
  const doomedChildren: OfflineMutation[] = [];
  for (const tier of [tiers[1], tiers[2]]) {
    if (stopped) break; // B1 (c): the session is gone — nothing else happens this flush
    const runnable: OfflineMutation[][] = [];
    const serialNumbered: OfflineMutation[][] = [];
    for (const group of tier) {
      const pid = childProjectId(group);
      if (pid && parentDeleted.has(pid)) {
        mootForDeletedParent += group.length;
        try {
          await writeBackGroup(group, { processed: 0, failed: 0, remaining: [], dropped: [], processedTables: new Set(), doomsChildren: false });
        } catch (err) {
          console.warn('[OfflineQueue] Could not discard writes for a deleted project, leaving them queued:', err);
        }
        continue;
      }
      if (pid && parentDoomed.has(pid)) {
        try {
          const doomed: GroupResult = { processed: 0, failed: group.length, remaining: [], dropped: group, processedTables: new Set(), doomsChildren: false };
          // Round 2: ledger first, under the record's slot, then out of the
          // queue — the same order runGroup keeps.
          await withRecordSlot(slotKeysFor(group), async () => {
            await recordGroupDrops(doomed);
            await writeBackGroup(group, doomed);
          });
          doomedChildren.push(...group);
        } catch (err) {
          console.warn('[OfflineQueue] Could not discard the children of a rejected project, leaving them queued:', err);
        }
        continue;
      }
      if (pid && parentPending.has(pid)) {
        heldForParent += group.length;
        continue;
      }
      if (numberedKeyOf(group[0].table, group[0].operation, group[0].data)) serialNumbered.push(group);
      else runnable.push(group);
    }
    await runTier(runnable);
    await runSerial(serialNumbered);
  }
  if (heldForParent > 0) {
    console.log('[OfflineQueue] Holding', heldForParent, 'child write(s) until their project lands');
  }
  if (mootForDeletedParent > 0) {
    console.log('[OfflineQueue] Discarded', mootForDeletedParent, 'queued write(s) for a project deleted in this flush');
  }
  if (doomedChildren.length > 0) {
    console.warn('[OfflineQueue] Dropped', doomedChildren.length, 'child write(s) with their rejected project');
  }

  // Reduce all group results into final accounting.
  const dropped: OfflineMutation[] = [];
  const processedTables = new Set<string>();
  let processed = 0;
  let failed = 0;
  const conflicts: OfflineMutation[] = [];
  // Wave 5: drops with their own sentence (the known refusals), reported
  // under it — the toast then says why ("Free plan allows 1 project…").
  const namedReasons = new Map<string, string>();
  const named: OfflineMutation[] = [];
  for (const r of results) {
    processed += r.processed;
    failed += r.failed;
    const conflictIds = new Set((r.conflicts ?? []).map((m) => m.id));
    for (const m of r.dropped) {
      const why = r.reasons?.get(m.id);
      if (conflictIds.has(m.id)) conflicts.push(m);
      else if (why) { named.push(m); namedReasons.set(m.id, why); }
      else dropped.push(m);
    }
    for (const table of r.processedTables) processedTables.add(table);
  }
  failed += doomedChildren.length;
  dropped.push(...doomedChildren);
  // Permanent discards must be visible — silent loss is the one unforgivable
  // failure mode for an offline-first app. One report for the whole flush, so
  // a rejected project and the children dropped with it are one toast.
  // Their ledger lines were written group by group (recordGroupDrops), before
  // each left the queue; this is only the toast, the listeners and Sentry.
  if (dropped.length > 0) {
    await notifyDroppedWrites(dropped, DROP_REASON, { alreadyRecorded: true });
  }
  // #122: a write that met a row the user cannot see is its own report — the
  // ledger line says so, instead of "the server refused it".
  if (conflicts.length > 0) {
    await notifyDroppedWrites(conflicts, NOT_VISIBLE_CONFLICT, { alreadyRecorded: true });
  }
  for (const [reason, entries] of groupByReason(named, namedReasons)) {
    await notifyDroppedWrites(entries, reason, { alreadyRecorded: true });
  }

  // Each group already reconciled itself into storage (writeBackGroup); the
  // depth reported here is whatever is persisted now — kept entries plus
  // anything enqueued mid-flush — split into ours and not ours (A3).
  const { remaining: remainingCount, foreign: foreignCount } = await tally();

  // A queued write for a cached table just landed on the server — tell any read
  // cache to drop its snapshot so the next read re-queries the now-current row.
  notifyFlushed(processedTables);
  for (const r of refusedDeletes) notifyProjectDeleteRefused(r.id, r.reason);

  console.log('[OfflineQueue] Done. Processed:', processed, 'Failed:', failed, 'Remaining:', remainingCount, 'Foreign:', foreignCount);
  return { processed, failed, remaining: remainingCount, foreign: foreignCount };
}

/** Outcome of a write attempt: landed now, queued for a later flush, or lost. */
export type WriteOutcome = 'synced' | 'queued' | 'failed';

type DirectOperation = 'insert' | 'upsert' | 'update' | 'delete';

interface DirectWriteOpts {
  /** Plain words for a non-network refusal the caller understands better
   *  than the raw Postgres text (e.g. the portal's RLS lock while a new
   *  portal id is still saving). Return undefined to keep the default toast. */
  describeFailure?: (message: string, code?: string) => string | undefined;
  /** The caller owns a refusal end to end: it takes its optimistic change back
   *  and tells him "nothing was recorded". Then the refusal is NOT written to
   *  the Not-saved ledger and NOT toasted — a ledger line would offer Retry for
   *  something the screen said to redo, and doing both counts a payment twice
   *  (integration round 1). Sentry still hears of it. Queued writes that are
   *  refused later, at the flush, are ledgered as usual. */
  callerOwnsRefusal?: boolean;
  /** Set by syncLedger.retryUnsavedWrite only: this send IS the ordered replay
   *  of the record's unsaved writes, so it is not parked behind them, and a
   *  refusal leaves the existing line in place instead of adding a second. */
  ledgerRetry?: boolean;
  /** See OfflineMutation.rides. */
  rides?: string[];
}

export async function supabaseWrite(
  table: string,
  operation: DirectOperation,
  data: Record<string, unknown>,
): Promise<boolean> {
  return (await supabaseWriteDetailed(table, operation, data)) === 'synced';
}

// Same write path, richer answer. A composer that must decide between "sent",
// "will send when you're back online" and "keep the draft, it didn't go" needs
// to tell a queued write from a lost one (SYNC-F8) — the boolean can't.
export async function supabaseWriteDetailed(
  table: string,
  operation: DirectOperation,
  data: Record<string, unknown>,
  opts?: DirectWriteOpts,
): Promise<WriteOutcome> {
  if (!isSupabaseConfigured) return 'failed';
  return runDirectWrite({ table, operation, data, ...(opts?.rides && opts.rides.length > 0 ? { rides: opts.rides } : {}) }, opts);
}

/**
 * CONTRACT 1: a record-scoped SECURITY DEFINER call (invoice_append_payment)
 * through the same guarantees as a table write — it waits behind any earlier
 * write of `table`/`recordId` (queued or on the wire), falls into the queue on
 * a transient failure (the flush calls supabase.rpc), and a refusal is toasted
 * and recorded for Retry. `data.id` on the queued entry is `recordId`, so the
 * flush replays it inside the record's FIFO group.
 */
export async function supabaseRpcDetailed(
  table: string,
  recordId: string,
  fn: string,
  args: Record<string, unknown>,
  opts?: { callerOwnsRefusal?: boolean; ledgerRetry?: boolean },
): Promise<WriteOutcome> {
  if (!isSupabaseConfigured) return 'failed';
  return runDirectWrite({ table, operation: 'rpc', data: { id: recordId }, rpc: { fn, args } }, {
    ...(opts?.callerOwnsRefusal ? { callerOwnsRefusal: true } : {}),
    ...(opts?.ledgerRetry ? { ledgerRetry: true } : {}),
  });
}

function runDirectWrite(m: NewMutation, opts?: DirectWriteOpts): Promise<WriteOutcome> {
  const keys: string[] = [];
  const rk = recordKeyOf(m.table, m.data);
  if (rk) keys.push(rk);
  const nk = numberedKeyOf(m.table, m.operation, m.data);
  if (nk) keys.push(nk);
  // Integration round 2: WHO made this write, and WHEN, are taken here — at
  // the call, before the record slot and the job's slot are waited on. They
  // used to be read after both waits: a second edit of a record whose first
  // edit was still on the wire (iOS holds a request up to 60 s) was captured
  // as whoever had signed in by then, and was sent under their JWT, queued
  // under their tag, or written into their Not-saved ledger with the first
  // account's row. currentSessionUser() settles synchronously from the auth
  // feed's value once it is known; before that its getSession() read starts
  // now. madeAt orders a refusal's ledger line (Retry replays oldest-first) —
  // the instant he saved, not the instant the slot came free.
  const writer = currentSessionUser();
  const madeAt = Date.now();
  // Taken synchronously, at the call — a write made in the same tick right
  // after this one already finds the slot held.
  return withRecordSlot(keys, () => directWrite(m, keys, writer, madeAt, opts));
}

/** Is the live session still the one this write was made under? */
async function sessionIsWriter(writerId: string | undefined): Promise<boolean> {
  let live: SessionUser | null;
  try { live = await currentSessionUser(); } catch { live = null; }
  return (live?.id ?? undefined) === writerId;
}

/**
 * A write whose account signed out (and maybe someone else signed in) while
 * it waited for its slot. Nothing is sent: the bearer on the wire now is not
 * the writer's. With a writer it goes to enqueueOrFail — queued TAGGED FOR THE
 * WRITER while no one is signed in, dropped if someone else already is (see
 * there). No toast, no screen listener: the live user never touched it. A
 * write made while signed out has no one to be kept for: it is refused,
 * recorded nowhere.
 */
async function handOffToWriter(m: NewMutation, writerId: string | undefined, opts?: DirectWriteOpts): Promise<WriteOutcome> {
  console.warn('[OfflineQueue] The session changed while this write waited for its record — not sending it under the new one:', m.table, m.operation);
  if (!writerId) return 'failed';
  return enqueueOrFail(m, writerId, { ...dropNoticeFor(opts), noToast: true });
}

/** How an enqueue failure of this write is reported (see appendEntryLocked). */
function dropNoticeFor(opts?: DirectWriteOpts): DropNoticeOpts {
  return opts?.ledgerRetry || opts?.callerOwnsRefusal ? { noLedger: true } : {};
}

/**
 * THE ORDERING GUARD. Inside the queue lock, so the look and the append are
 * one step against the flush's write-back: if this session's queue holds ANY
 * write of the same record (or, for an RFI/submittal create, an earlier create
 * of the same project), this one is appended behind it and nothing is sent —
 * the flush replays the record's writes oldest-first. A queue that cannot be
 * read counts as holding one: queuing is never wrong, a 0-row "success" is.
 *
 * Integration round 1 — the LEDGER first. A write of the record that the
 * server refused (or a flush dropped) sits in utils/syncLedger with its
 * payload, waiting for Retry. The guard used to look only at the queue, so the
 * next edit went out as an UPDATE that matched 0 rows and said 'synced', and a
 * later Retry resent the refused INSERT as it was — the edit gone for good.
 * Now a write of a record with unsaved writes is parked in the ledger behind
 * them (parkBehindUnsavedWrite) and never sent on its own; the answer is
 * 'failed' with `parked` set, because it is exactly where a refusal is — under
 * Not saved, kept on the phone, waiting for Retry. A caller that owns its
 * refusal (callerOwnsRefusal) gets 'failed' and nothing is written. Checked
 * BEFORE the queue: if Retry has already queued the record's oldest write, a
 * new write must still wait behind the lines Retry has not reached yet.
 *
 * Returns the outcome when it queued/parked (or the append failed), otherwise
 * how many of this session's entries are waiting (for the post-write drain).
 * Always returns the WRITER — the session this write started under — so a
 * write that later falls into the queue or the ledger is tagged for it.
 */
async function queueBehindEarlierWrite(
  m: NewMutation,
  keys: readonly string[],
  writer: SessionUser | null,
  opts?: DirectWriteOpts,
): Promise<{ outcome?: WriteOutcome; ownDepth: number; parked?: boolean }> {
  // No session: nothing on the device is anyone's to order behind.
  if (!writer) return { ownDepth: 0 };
  const writerId = writer.id;
  // The ledger's record key — the same chain as the slot and the flush's
  // group (recordIdOf), so a project_financials row parks like any other.
  const rid = recordIdOf(m.table, m.data);
  if (!opts?.ledgerRetry && rid !== null) {
    let ledger: typeof import('@/utils/syncLedger') | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      ledger = require('@/utils/syncLedger') as typeof import('@/utils/syncLedger');
    } catch { ledger = null; }
    if (ledger && opts?.callerOwnsRefusal) {
      // unsavedChainBlocks: hasUnsavedChain, less a write that provably
      // commutes with the chain (see syncLedger.writeIsIndependentOfChain).
      if (await ledger.unsavedChainBlocks(writerId, {
        table: m.table, recordId: rid, operation: m.operation,
        ...(m.operation === 'rpc' ? {} : { row: m.data }),
      })) {
        return { outcome: 'failed', ownDepth: 0, parked: true };
      }
    } else if (ledger) {
      const now = Date.now();
      const parked = await ledger.parkBehindUnsavedWrite({
        id: `parked-${now}-${Math.random().toString(36).slice(2, 8)}`,
        kind: 'write',
        label: ledger.labelForWrite(m.table, m.operation === 'rpc' ? m.rpc : undefined),
        reason: 'waiting behind an earlier change that was not saved',
        at: now,
        userId: writerId,
        table: m.table,
        recordId: rid,
        operation: m.operation,
        ...(m.operation === 'rpc' ? (m.rpc ? { rpc: m.rpc } : {}) : { row: m.data }),
        ...(m.rides && m.rides.length > 0 ? { rides: m.rides } : {}),
        queuedAt: now,
      });
      if (parked) {
        console.log('[OfflineQueue] An earlier write of this record is unsaved — parked behind it:', m.table, m.operation);
        return { outcome: 'failed', ownDepth: 0, parked: true };
      }
    }
  }
  // Marker before queue — the A1 ordering, same reason as the flush.
  const marker = await readLastUserMarker();
  const entry = await buildEntry(m, { userId: writerId });
  const nk = numberedKeyOf(m.table, m.operation, m.data);
  return withQueueLock(async () => {
    let queue: OfflineMutation[];
    try {
      queue = await readOfflineQueueOrThrow();
    } catch (first) {
      // Integration round 2: an UNREADABLE queue is not a queue holding an
      // earlier write. Round 1 queued behind it (appending, which reads the
      // same storage and fails) — so with the stored value corrupt, or past
      // Android's 2 MB CursorWindow, every keyed save on the device answered
      // 'failed' with perfect signal, and each Retry tap added another line.
      // Nothing in a queue no one can read can be flushed, so there is nothing
      // a direct send could overtake: read once more (a one-off storage
      // hiccup reads fine the second time, and then the rule above applies),
      // and if it still cannot be read, send. What it gives up: if that
      // storage ever becomes readable again, a write inside it could land
      // after this one — against every save on the phone failing meanwhile.
      try {
        queue = await readOfflineQueueOrThrow();
      } catch {
        console.warn('[OfflineQueue] The sync queue on this device cannot be read — sending directly (nothing in it can be flushed):', m.table, m.operation, first);
        return { ownDepth: 0 };
      }
    }
    const own = partitionQueueForSession(queue, writerId, marker).own;
    const behind = keys.length > 0 && own.some((q) => {
      const qk = recordKeyOf(q.table, q.data);
      if (qk && keys.includes(qk)) return true;
      return !!nk && numberedKeyOf(q.table, q.operation, q.data) === nk;
    });
    if (!behind) return { ownDepth: own.length };
    console.log('[OfflineQueue] An earlier write of this record is queued — queuing behind it:', m.table, m.operation);
    try {
      await appendEntryLocked(entry, dropNoticeFor(opts));
      return { outcome: 'queued' as const, ownDepth: own.length + 1 };
    } catch {
      // HEALTH-F10: appendEntryLocked already reported the dropped write.
      return { outcome: 'failed' as const, ownDepth: own.length };
    }
  });
}

async function enqueueOrFail(m: NewMutation, writerId: string | undefined, onFail?: DropNoticeOpts): Promise<WriteOutcome> {
  // Integration round 3: SOMEONE ELSE is signed in now — the writer's write
  // (it waited on its record's slot, or was on the wire, across the switch)
  // is DROPPED with a Sentry note, as the switch already dropped the
  // writer's other queued entries. Queued here, after that sweep, it sat in
  // the queue for the new user's whole session (on web, readable
  // localStorage in a shared browser), and the list loaders' queued-id reads
  // — every entry, not only the live user's — let the old account's queued
  // DELETE or edit of a record on a job both share hide or pin that row in
  // the new user's lists. What it gives up: that one edit, made in the
  // instant of the switch, is not kept for the writer's next sign-in.
  // No one signed in: kept for the writer, as before (their next session
  // sends it; a different next sign-in drops it with the rest).
  if (writerId) {
    let live: SessionUser | null;
    try { live = await currentSessionUser(); } catch { live = null; }
    if (live && live.id !== writerId) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Sentry = require('@sentry/react-native');
        Sentry.captureMessage(`[OfflineQueue] dropped 1 write of the previous account after an account switch: ${m.table} ${m.operation}`, 'warning');
      } catch {/* ignore */}
      return 'failed';
    }
  }
  try {
    // Tagged for the WRITER captured when the write started, not whoever is
    // signed in now (integration round 1 — see buildEntry). If that is no
    // longer the live session (signed out) the entry is foreign: never
    // flushed under another account's token, and dropped by the
    // tenant-switch path.
    const entry = await buildEntry(m, { userId: writerId });
    await withQueueLock(() => appendEntryLocked(entry, onFail));
    return 'queued';
  } catch {
    // HEALTH-F10: the enqueue failed — addToOfflineQueue already reported
    // the dropped write; the caller learns it did not land.
    return 'failed';
  }
}

/** #4: a refusal that is what a child looks like when its job is not on the
 *  server yet — RLS WITH CHECK on can_access_project (42501) or the FK
 *  (23503, the invoices path). */
function isParentMissingRefusal(message: string, code?: string): boolean {
  const m = message.toLowerCase();
  return code === '42501' || code === '23503' || isRlsRejection(message) || m.includes('foreign key');
}

/** Is this project's own write still unsettled — queued for this session, on
 *  the wire, or landed only after the child was sent? */
async function projectWriteUnsettled(projectId: string, childSentAt: number): Promise<boolean> {
  if (recordSlots.has(`projects:${projectId}`)) return true;
  if ((projectWriteSettledAt.get(projectId) ?? 0) > childSentAt) return true;
  return (await getOwnOfflineQueue()).some((q) => q.table === 'projects' && q.data?.id === projectId);
}

async function directWrite(
  m: NewMutation, keys: readonly string[], writerAtCall: Promise<SessionUser | null>, madeAt: number, opts?: DirectWriteOpts,
): Promise<WriteOutcome> {
  const { table, operation, data } = m;
  // The session this write was made under (see runDirectWrite). Everything
  // below — the park, the queue tag, the ledger line, the bearer it is sent
  // with — is the WRITER's, never whoever is signed in after the waits.
  let writer: SessionUser | null;
  try { writer = await writerAtCall; } catch { writer = null; }
  const writerId = writer?.id;

  // #4: a record created in the same instant as its job used to race the
  // job's own write and be refused by RLS/FK. When the job's write is on the
  // wire right now, wait for it — the child then goes out after the job row
  // has committed (or finds it queued and follows it into the queue, below).
  const parentId = table !== 'projects' && (operation === 'insert' || operation === 'upsert')
    ? data?.project_id : undefined;
  if (typeof parentId === 'string' && parentId.length > 0) {
    const parent = recordSlots.get(`projects:${parentId}`);
    if (parent) await parent;
  }

  // The waits are over: if the account that made this write is no longer the
  // one signed in, it is not sent under the new one (round 2).
  if (!(await sessionIsWriter(writerId))) return handOffToWriter(m, writerId, opts);

  const guard = await queueBehindEarlierWrite(m, keys, writer, opts);
  if (guard.outcome) {
    if (guard.outcome === 'queued') scheduleQueueDrain();
    if (guard.parked && !opts?.callerOwnsRefusal && (await sessionIsWriter(writerId))) toastParked(m.table);
    return guard.outcome;
  }
  // …and once more at the send: the guard's storage reads are awaits too.
  if (!(await sessionIsWriter(writerId))) return handOffToWriter(m, writerId, opts);

  const sentAt = ++writeOrderSeq; // position in writeOrderSeq, not a clock
  try {
    let error: { message: string; code?: string } | null = null;
    let status: number | undefined;

    if (operation === 'insert') {
      // Plain insert (not upsert) — matches processOfflineQueue's semantic.
      // An upsert here would silently overwrite a colliding row some other
      // client (or this client on another device) had already created,
      // masking real conflicts. If the unique constraint is hit, the catch
      // below decides retry vs terminal-discard.
      const result = await supabase.from(table).insert(data);
      error = result.error;
      status = result.status;
      // A re-send of an insert whose first attempt timed out (#2 queues
      // those now) meets its own row: that is success — but only if this
      // user can SEE the row (#122). A row someone else owns is a conflict.
      if (error && typeof data?.id === 'string' && isAlreadyLandedInsert(error)) {
        const seen = await duplicateRowVisibility(table, data);
        if (seen === 'visible') error = null;
        else if (seen === 'hidden') error = { message: NOT_VISIBLE_CONFLICT, code: '23505' };
        else throw Object.assign(new Error('Network request failed while confirming a duplicate insert'), { status: 0 });
      }
    } else if (operation === 'upsert') {
      // Create-or-replace for single-owner rows (e.g. the caller's own
      // project). Edits to an existing row MUST NOT use 'insert' — a plain
      // insert on an existing PK fails with a duplicate-key violation, which
      // is classified terminal, so the edit would silently never reach the
      // server (and the server-first load would then revert it locally).
      const result = await supabase.from(table).upsert(data);
      error = result.error;
      status = result.status;
    } else if (operation === 'update') {
      const { id, ...rest } = data;
      const result = await supabase.from(table).update(rest).eq('id', id as string);
      error = result.error;
      status = result.status;
    } else if (operation === 'delete') {
      const result = await supabase.from(table).delete().eq('id', data.id as string);
      error = result.error;
      status = result.status;
    } else if (operation === 'rpc' && m.rpc) {
      const result = await supabase.rpc(m.rpc.fn, m.rpc.args);
      error = result.error;
      status = result.status;
    }

    if (error) {
      throw Object.assign(new Error(error.message), { code: (error as { code?: string }).code, status });
    }

    // The network is demonstrably up: whatever this session still has queued
    // (a clock-in from the basement, the offline draft this edit follows)
    // goes now, not at the end of a five-minute backoff.
    if (guard.ownDepth > 0) scheduleQueueDrain();
    return 'synced';
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Sync failed';
    const code = (err as { code?: string } | null)?.code;
    if (isNetworkError(err) || isSchemaCacheError(msg) || isAuthTransientError(msg, code)) {
      // Offline / transient (incl. a PostgREST schema-cache miss during a
      // migration-before-OTA race, or a token that needs a refresh). Queue the
      // write UNCHANGED so it drains once connectivity returns or the migration
      // lands — never drop it, and don't scare the user with a toast for a
      // self-healing condition.
      console.log('[OfflineQueue] Transient error, queuing mutation:', table, operation);
      return enqueueOrFail(m, writerId, dropNoticeFor(opts));
    }
    // A4's twin on the live path: an access refusal answered to a request
    // that carried no user token (expired, refresh unreachable → supabase-js
    // sent the anon key) is not a verdict on the write.
    if ((code === '42501' || isAccessRejection(msg)) && !(await bearerStillLive())) {
      console.log('[OfflineQueue] Refused with no live bearer — queuing, not a verdict:', table, operation);
      return enqueueOrFail(m, writerId, dropNoticeFor(opts));
    }
    // #4 backstop: a child refused because its job is not on the server YET
    // (the job's own write is queued, on the wire, or landed just after this
    // child was sent) goes into the queue, where the flush sends projects
    // first and holds children until their job lands (B2). rlsRetried starts
    // false, so a genuinely forbidden child still ends as terminal.
    if (typeof parentId === 'string' && parentId.length > 0 && isParentMissingRefusal(msg, code)
        && (await projectWriteUnsettled(parentId, sentAt))) {
      console.log('[OfflineQueue] Child refused while its job is still saving — queuing behind it:', table);
      return enqueueOrFail(m, writerId, dropNoticeFor(opts));
    }
    // CONTRACT 1: the record's INSERT is still queued — this call is early.
    if (operation === 'rpc' && isRecordNotFound(msg, code)
        && (await insertStillPendingFor({ ...m, id: '', timestamp: 0, retryCount: 0 }, new Set()))) {
      return enqueueOrFail(m, writerId, dropNoticeFor(opts));
    }
    // Awaited (integration round 1): 'failed' used to return before the
    // ledger line existed, so an edit made right after it slipped past the
    // park check above and a list read could drop the device row.
    await failDirectWrite(m, msg, code, err, writerId, madeAt, opts);
    return 'failed';
  }
}

/**
 * Non-network failure (RLS denial, validation, a server 500). These won't be
 * fixed by reconnecting — tell the user (AUD-001), tell Sentry, and (#1, wave
 * 4) WRITE IT DOWN with its payload. A refusal used to be a toast and nothing
 * else: no queue entry, no ledger line — so the next trusted list read found
 * the row neither on the server nor pending and deleted the only copy of it.
 * Recorded, the row is kept on the phone (the loaders keep unsavedWriteIds)
 * and the sync badge offers Retry and Discard. Never resent automatically.
 */
async function failDirectWrite(
  m: NewMutation, msg: string, code: string | undefined, err: unknown,
  writerId: string | undefined, madeAt: number, opts?: DirectWriteOpts,
): Promise<void> {
  const { table, operation } = m;
  console.log('[OfflineQueue] Non-network Supabase error:', table, operation, msg);
  let ledger: typeof import('@/utils/syncLedger') | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ledger = require('@/utils/syncLedger') as typeof import('@/utils/syncLedger');
  } catch { ledger = null; }
  const why = ledger ? ledger.humanWriteReason(msg, code) : msg.slice(0, 80);
  // Wave 5 (CONTRACT 22): a delete refused for safety records is written down
  // as a NOTE — no row, no Retry: the same delete is refused again, and a
  // delete line would keep the job hidden on this phone while the server still
  // holds it. ProjectContext re-reads and the job comes back.
  const known = knownRefusal(table, operation, msg, code);
  const asNote = known === 'project_has_safety_records';
  // Who is signed in NOW. undefined = the session could not be read (treated
  // as the writer's, as before).
  let liveId: string | null | undefined;
  if (writerId) {
    try { liveId = (await currentSessionUser())?.id ?? null; } catch { liveId = undefined; }
  }
  // Wave-4 final fix: SOMEONE ELSE is signed in now — the refusal of the
  // previous account's write (on the wire across the switch) is not written
  // down. The line carried that account's whole row (a daily report's text)
  // into the new user's session storage until the next sign-out — on web,
  // localStorage in a shared browser. Same rule as enqueueOrFail's transient
  // path: a Sentry note, no row. No one signed in: kept for the writer.
  const foreignSession = !!writerId && typeof liveId === 'string' && liveId !== writerId;
  if (foreignSession) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Sentry = require('@sentry/react-native');
      Sentry.captureMessage(`[OfflineQueue] dropped the refusal of 1 write of the previous account after an account switch: ${table} ${operation}`, 'warning');
    } catch {/* ignore */}
  }
  // A Retry's resend (ledgerRetry) already has its line — the replay leaves it
  // in place on a refusal instead of adding a second one.
  if (ledger && !opts?.callerOwnsRefusal && !opts?.ledgerRetry && !foreignSession) {
    try {
      const now = Date.now();
      const rid = recordIdOf(m.table, m.data);
      // Tagged for the WRITER (integration round 1): a refusal that lands after
      // a sign-out (no one signed in yet) is that account's line, for its next
      // session — unreadable by any other session, never its Retry button.
      const lineId = `direct-${now}-${Math.random().toString(36).slice(2, 8)}`;
      const label = ledger.labelForWrite(table, operation === 'rpc' ? m.rpc : undefined);
      await ledger.recordSyncFailures([asNote
        ? { id: lineId, kind: 'write', label, reason: why, at: now, ...(writerId ? { userId: writerId } : {}) }
        : {
          id: lineId,
          kind: 'write',
          label,
          reason: why,
          at: now,
          ...(writerId ? { userId: writerId } : {}),
          table,
          ...(rid !== null ? { recordId: rid } : {}),
          operation,
          ...(operation === 'rpc' ? (m.rpc ? { rpc: m.rpc } : {}) : { row: m.data }),
          ...(m.rides && m.rides.length > 0 ? { rides: m.rides } : {}),
          queuedAt: madeAt,
        }]);
    } catch { /* a ledger write must never break the caller */ }
  }
  // …and the job goes back on the phone (not for another account's write).
  if (asNote && !foreignSession) notifyProjectDeleteRefused(m.data?.id, why);
  // Not the live session's write any more: its toast would tell the new user
  // about a record he never touched.
  const sameSession = !writerId || liveId === undefined || liveId === writerId;
  // Best-effort lazy require — keeping offlineQueue side-effect free
  // at module load. If the toast host isn't mounted yet, the call
  // is a no-op (intentional — pre-mount errors aren't actionable).
  if (!opts?.callerOwnsRefusal && sameSession) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { oops } = require('@/components/animations/NailItToast');
      let plain: string | undefined;
      try { plain = opts?.describeFailure?.(msg, code); } catch { plain = undefined; }
      const knownToast = known && ledger ? ledger.knownRefusalToast(why) : null;
      oops(plain ?? knownToast ?? `Couldn't save (${ledger ? ledger.labelForTable(table) : table}): ${why}. Tap the sync badge to retry.`);
    } catch {/* ignore */}
  }
  // Forward to Sentry so we can see what's failing in prod.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require('@sentry/react-native');
    Sentry.captureException(err instanceof Error ? err : new Error(msg), {
      tags: { source: 'offlineQueue', table, operation },
    });
  } catch {/* ignore */}
}

/** The toast for a write parked behind its record's unsaved writes. */
function toastParked(table: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ledger = require('@/utils/syncLedger') as typeof import('@/utils/syncLedger');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { oops } = require('@/components/animations/NailItToast');
    oops(`Not sent yet (${ledger.labelForTable(table)}): an earlier change to it is under Not saved. Tap the sync badge and Retry — they go in order.`);
  } catch {/* toast host not mounted — the ledger line says it */}
}
