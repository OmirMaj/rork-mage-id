import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

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
  operation: 'insert' | 'upsert' | 'update' | 'delete';
  data: Record<string, unknown>;
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
// data. Mirrors the classification supabaseWrite uses on the live path.
function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError ||
    (err instanceof Error && (
      err.message.includes('Network request failed') ||
      err.message.includes('Failed to fetch') ||
      err.message.includes('network')
    ));
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

export function partitionQueueForSession(
  queue: readonly OfflineMutation[],
  sessionUserId: string,
  marker: string | null,
): QueuePartition {
  const own: OfflineMutation[] = [];
  const foreign: OfflineMutation[] = [];
  for (const m of queue) {
    if (m.userId === sessionUserId) own.push(m);
    else if (!m.userId && marker === sessionUserId) own.push({ ...m, userId: sessionUserId });
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

export async function addToOfflineQueue(mutation: Omit<OfflineMutation, 'id' | 'timestamp' | 'retryCount' | 'userId'>): Promise<void> {
  // B1: tag the entry with the signed-in user BEFORE taking the storage lock
  // (a session read is not a queue read-modify-write). No session → no tag;
  // the flush then treats it like a pre-tagging entry (marker must match).
  const userId = (await currentSessionUser())?.id;
  const entry: OfflineMutation = {
    ...mutation,
    id: `oq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    retryCount: 0,
    ...(userId ? { userId } : {}),
  };
  return withQueueLock(async () => {
    try {
      const queue = await getOfflineQueue();
      queue.push(entry);
      if (queue.length > MAX_QUEUE) {
        const droppedEntries = queue.splice(0, queue.length - MAX_QUEUE); // FIFO: drop oldest
        console.warn(`[OfflineQueue] cap ${MAX_QUEUE} exceeded — dropped ${droppedEntries.length} oldest mutation(s)`);
        notifyDroppedWrites(droppedEntries, 'queue cap exceeded');
      }
      await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
      console.log('[OfflineQueue] Queued mutation:', mutation.table, mutation.operation);
      notifyQueueChanged(queue.length);
    } catch (err) {
      // HEALTH-F10: the enqueue itself failed (storage full / unavailable). The
      // optimistic local state stands and NOTHING is queued — that is a dropped
      // write, so report it like one and rethrow so supabaseWrite can surface
      // it to its caller instead of pretending the write is safe.
      console.warn('[OfflineQueue] Failed to queue mutation:', mutation.table, mutation.operation, err);
      notifyDroppedWrites([entry], `enqueue failed: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  });
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

// A queued write was permanently discarded (terminal error, retry exhaustion,
// or queue-cap overflow). For an offline-first app, silent data loss is the
// worst failure mode — surface it on the toast host and forward to Sentry so
// the user can re-enter the data and we can see the pattern in prod. Lazy
// requires keep this module side-effect free at load (same pattern as
// supabaseWrite's AUD-001 handling below).
function notifyDroppedWrites(entries: readonly OfflineMutation[], reason: string): void {
  if (entries.length === 0) return;
  const claimed = new Set<string>();
  for (const listener of droppedListeners) {
    try {
      for (const m of listener(entries, reason) ?? []) claimed.add(m.id);
    } catch { /* never let a listener break the queue */ }
  }
  const unclaimed = entries.filter((m) => !claimed.has(m.id));
  if (unclaimed.length > 0) {
    const tableList = [...new Set(unclaimed.map((m) => m.table))].join(', ');
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { oops } = require('@/components/animations/NailItToast');
      oops(`${unclaimed.length} change(s) couldn't be synced (${tableList}). Please re-check that data.`);
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
    const d = mutation.data ?? {};
    const recordKey = `${mutation.table}:${String(d.id ?? d.project_id ?? d.portal_id ?? d.sub_portal_id ?? mutation.id)}`;
    let group = groupMap.get(recordKey);
    if (!group) {
      group = [];
      groupMap.set(recordKey, group);
    }
    group.push(mutation);
  }

  // Process one group serially; return its accounting totals.
  async function processGroup(group: OfflineMutation[]): Promise<{ processed: number; failed: number; remaining: OfflineMutation[]; dropped: OfflineMutation[]; processedTables: Set<string>; doomsChildren: boolean }> {
    let gProcessed = 0;
    let gFailed = 0;
    const gRemaining: OfflineMutation[] = [];
    const gDropped: OfflineMutation[] = [];
    const gProcessedTables = new Set<string>();
    // A5: set when a dropped `projects` write proves its children can never
    // land (see dropDoomsChildren) — the tier gating drops them with it.
    let gDoomsChildren = false;

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

        if (mutation.operation === 'insert') {
          // Plain insert — upsert here would silently overwrite a colliding
          // row that some other client already created, masking conflicts.
          const result = await supabase.from(mutation.table).insert(mutation.data);
          error = result.error;
          // SYNC-F4: a primary-key duplicate means this insert already landed
          // in a flush that was killed before its write-back. Success.
          if (error && isAlreadyLandedInsert(error)) {
            console.log('[OfflineQueue] Insert already on server, treating as success:', mutation.table);
            error = null;
          }
        } else if (mutation.operation === 'upsert') {
          // Explicit create-or-replace for single-owner rows the app is the
          // source of truth for (e.g. the user's own project row). Callers
          // opt in — 'insert' stays plain so real conflicts still surface.
          const result = await supabase.from(mutation.table).upsert(mutation.data);
          error = result.error;
        } else if (mutation.operation === 'update') {
          const { id, ...rest } = mutation.data;
          const result = await supabase.from(mutation.table).update(rest).eq('id', id as string);
          error = result.error;
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
        }

        if (error) {
          // Carry the PostgREST/Postgres code so classification below can key
          // on it (PGRST301, 23505) and not only on message text.
          throw Object.assign(new Error(error.message), { code: error.code });
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
        if (isTerminalError(msg)) {
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

    return { processed: gProcessed, failed: gFailed, remaining: gRemaining, dropped: gDropped, processedTables: gProcessedTables, doomsChildren: gDoomsChildren };
  }

  type GroupResult = Awaited<ReturnType<typeof processGroup>>;

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

  async function runGroup(group: OfflineMutation[]): Promise<GroupResult> {
    const result = await processGroup(group);
    try {
      await writeBackGroup(group, result);
    } catch (err) {
      // Storage hiccup: the entries stay queued and are re-sent next flush,
      // which the 23505 rule makes safe. Never let it wedge the flush.
      console.warn('[OfflineQueue] Write-back failed, group stays queued:', err);
    }
    return result;
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
    const landed = result.remaining.length === 0 && result.dropped.length === 0;
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
          await writeBackGroup(group, { processed: 0, failed: group.length, remaining: [], dropped: group, processedTables: new Set(), doomsChildren: false });
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
      runnable.push(group);
    }
    await runTier(runnable);
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
  for (const r of results) {
    processed += r.processed;
    failed += r.failed;
    dropped.push(...r.dropped);
    for (const table of r.processedTables) processedTables.add(table);
  }
  failed += doomedChildren.length;
  dropped.push(...doomedChildren);
  // Permanent discards must be visible — silent loss is the one unforgivable
  // failure mode for an offline-first app. One report for the whole flush, so
  // a rejected project and the children dropped with it are one toast.
  if (dropped.length > 0) {
    notifyDroppedWrites(dropped, 'terminal error or retry exhaustion');
  }

  // Each group already reconciled itself into storage (writeBackGroup); the
  // depth reported here is whatever is persisted now — kept entries plus
  // anything enqueued mid-flush — split into ours and not ours (A3).
  const { remaining: remainingCount, foreign: foreignCount } = await tally();

  // A queued write for a cached table just landed on the server — tell any read
  // cache to drop its snapshot so the next read re-queries the now-current row.
  notifyFlushed(processedTables);

  console.log('[OfflineQueue] Done. Processed:', processed, 'Failed:', failed, 'Remaining:', remainingCount, 'Foreign:', foreignCount);
  return { processed, failed, remaining: remainingCount, foreign: foreignCount };
}

/** Outcome of a write attempt: landed now, queued for a later flush, or lost. */
export type WriteOutcome = 'synced' | 'queued' | 'failed';

export async function supabaseWrite(
  table: string,
  operation: 'insert' | 'upsert' | 'update' | 'delete',
  data: Record<string, unknown>,
): Promise<boolean> {
  return (await supabaseWriteDetailed(table, operation, data)) === 'synced';
}

// Same write path, richer answer. A composer that must decide between "sent",
// "will send when you're back online" and "keep the draft, it didn't go" needs
// to tell a queued write from a lost one (SYNC-F8) — the boolean can't.
export async function supabaseWriteDetailed(
  table: string,
  operation: 'insert' | 'upsert' | 'update' | 'delete',
  data: Record<string, unknown>,
): Promise<WriteOutcome> {
  if (!isSupabaseConfigured) return 'failed';

  try {
    let error: { message: string } | null = null;

    if (operation === 'insert') {
      // Plain insert (not upsert) — matches processOfflineQueue's semantic
      // at :100. An upsert here would silently overwrite a colliding row
      // some other client (or this client on another device) had already
      // created, masking real conflicts. If the unique constraint is hit,
      // the catch below decides retry vs terminal-discard.
      const result = await supabase.from(table).insert(data);
      error = result.error;
    } else if (operation === 'upsert') {
      // Create-or-replace for single-owner rows (e.g. the caller's own
      // project). Edits to an existing row MUST NOT use 'insert' — a plain
      // insert on an existing PK fails with a duplicate-key violation, which
      // is classified terminal, so the edit would silently never reach the
      // server (and the server-first load would then revert it locally).
      const result = await supabase.from(table).upsert(data);
      error = result.error;
    } else if (operation === 'update') {
      const { id, ...rest } = data;
      const result = await supabase.from(table).update(rest).eq('id', id as string);
      error = result.error;
    } else if (operation === 'delete') {
      const result = await supabase.from(table).delete().eq('id', data.id as string);
      error = result.error;
    }

    if (error) {
      throw Object.assign(new Error(error.message), { code: (error as { code?: string }).code });
    }

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
      try {
        await addToOfflineQueue({ table, operation, data });
        return 'queued';
      } catch {
        // HEALTH-F10: the enqueue failed — addToOfflineQueue already reported
        // the dropped write; the caller learns it did not land.
        return 'failed';
      }
    } else {
      // Non-network failure (RLS denial, validation, server 500). These won't
      // be fixed by reconnecting — we need to tell the user so they can retry /
      // report / fix the input. Logging alone (the previous behavior) silently
      // lost the write from the user's perspective. AUD-001.
      console.log('[OfflineQueue] Non-network Supabase error:', table, operation, msg);
      // Best-effort lazy require — keeping offlineQueue side-effect free
      // at module load. If the toast host isn't mounted yet, the call
      // is a no-op (intentional — pre-mount errors aren't actionable).
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { oops } = require('@/components/animations/NailItToast');
        oops(`Couldn't save (${table}). ${msg.slice(0, 80)}`);
      } catch {/* ignore */}
      // Forward to Sentry so we can see what's failing in prod.
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Sentry = require('@sentry/react-native');
        Sentry.captureException(err instanceof Error ? err : new Error(msg), {
          tags: { source: 'offlineQueue', table, operation },
        });
      } catch {/* ignore */}
    }

    return 'failed';
  }
}
