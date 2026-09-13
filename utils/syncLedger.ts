// utils/syncLedger.ts — the durable record of work that will NOT be sent.
//
// ── The hole this closes ────────────────────────────────────────────────────
// utils/offlineQueue.ts drops a mutation when it hits a terminal error, when it
// exhausts MAX_RETRIES, or when the queue cap overflows. Before this file the
// only user-facing trace was `notifyDroppedWrites`, which fires a toast and a
// Sentry warning AT THE MOMENT OF THE DROP. That is the one moment the field
// user is least likely to be looking: the drop happens during a background
// flush, on the wake after the phone came back into signal, often with the app
// backgrounded and the toast host unmounted. The toast is a no-op then, and the
// queue depth has just gone DOWN — so the sync pill got QUIETER as the user's
// work was lost.
//
// The ledger is the same event, written down. It survives the app being killed,
// it is readable whenever the user next looks, and it is the only reason the
// pill is allowed to say "2 didn't sync" instead of pretending they are pending.
//
// ── Boundaries ──────────────────────────────────────────────────────────────
// • Key `mageid_sync_failures` is listed in OFFLINE_WRITE_QUEUE_KEYS
//   (utils/localCacheKeys.ts), which means AuthContext's prefix sweep never
//   removes it and `clearSyncFailures()` below does — the same route the three
//   write queues take, and for the same reason. It was left OUT of that list
//   once, on the reasoning that a failure note is not pending work; the sweep
//   then destroyed the red "2 didn't sync" notice on exactly the event (the
//   magic link a super taps to get back in) that the queues beside it are
//   preserved for, silently, with the user never told the warning had existed.
//   A deliberate sign-out still empties it, and `retainSyncFailuresForUser`
//   narrows it for a session that arrives with no marker.
//   Cross-tenant safety does not rest on the wipe in any case: `ownFailures`
//   below shows only entries tagged for the live session and has no
//   last-user-marker fallback, so another contractor's note is unreadable even
//   in the window before it is cleared.
// • Entries are tagged with the owning user and read back filtered, the same
//   discipline as getOwnOfflineQueue — a record with no tag is nobody's.
// • Bounded at MAX_SYNC_FAILURES, newest kept. An unbounded ledger of failures
//   is itself a storage leak, and a list of 400 is not more actionable than a
//   list of 40.
//
// This module is required LAZILY by offlineQueue (same pattern as its Sentry
// and toast requires), so importing offlineQueue never pulls AsyncStorage in at
// module load.
//
// ── Why there is a lock in here ─────────────────────────────────────────────
// Every write below is a read-modify-write of ONE key, and the writer is the
// queue's drop path — which runs during a background flush, i.e. exactly during
// the window AuthContext is emptying local storage in. Unlocked, the A2 race
// the write queues already learned applies verbatim: the wipe removes the key,
// a drop that was mid-flight writes its merged array back, and the previous
// tenant's failure notes reappear seconds after being cleared. Same discipline,
// same shape, same function name as the three queue modules.

import AsyncStorage from '@react-native-async-storage/async-storage';

export const SYNC_FAILURE_KEY = 'mageid_sync_failures';

/** Serialises every read-modify-write of SYNC_FAILURE_KEY. Same name and same
 *  shape as the queue modules' own locks — see the header. */
let ledgerLock: Promise<unknown> = Promise.resolve();
function withQueueLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = ledgerLock.then(fn, fn);
  ledgerLock = run.then(() => undefined, () => undefined);
  return run;
}

/** Newest N kept. See "Boundaries" above. */
export const MAX_SYNC_FAILURES = 40;

export type SyncFailureKind = 'write' | 'photo' | 'dictation';

export interface SyncFailure {
  /** The dropped item's own id, so the same drop cannot be recorded twice. */
  id: string;
  kind: SyncFailureKind;
  /** What the user would call it: "Daily report", "Change order". */
  label: string;
  /** Why it stopped, in the words we are willing to show: "retried 5 times". */
  reason: string;
  at: number;
  /** Owning user. Untagged entries are unreadable by anyone — see readOwn. */
  userId?: string;
}

// ── Pure core (the validator drives these directly) ─────────────────────────

/**
 * Merge new failures into the ledger: newest first, deduped by id, capped.
 *
 * Dedupe by id matters because a flush can report the same group twice across
 * a retry of the flush itself; two lines for one lost report would inflate the
 * count the user is asked to act on.
 */
export function mergeFailures(
  existing: readonly SyncFailure[],
  incoming: readonly SyncFailure[],
  cap: number = MAX_SYNC_FAILURES,
): SyncFailure[] {
  const seen = new Set<string>();
  const out: SyncFailure[] = [];
  for (const f of [...incoming, ...existing]) {
    if (!f || typeof f.id !== 'string' || f.id.length === 0) continue;
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    out.push(f);
  }
  out.sort((a, b) => b.at - a.at);
  return out.slice(0, Math.max(0, cap));
}

/** Tolerant parse. A malformed ledger reads as empty rather than throwing —
 *  but see readSyncFailures: a storage failure is NOT the same as empty. */
export function parseFailures(raw: string | null | undefined): SyncFailure[] {
  if (!raw) return [];
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(value)) return [];
  const out: SyncFailure[] = [];
  for (const v of value) {
    if (!v || typeof v !== 'object') continue;
    const r = v as Record<string, unknown>;
    if (typeof r.id !== 'string' || r.id.length === 0) continue;
    if (r.kind !== 'write' && r.kind !== 'photo' && r.kind !== 'dictation') continue;
    if (typeof r.at !== 'number' || !Number.isFinite(r.at)) continue;
    out.push({
      id: r.id,
      kind: r.kind,
      label: typeof r.label === 'string' ? r.label : 'Unsaved change',
      reason: typeof r.reason === 'string' ? r.reason : 'could not be sent',
      at: r.at,
      userId: typeof r.userId === 'string' ? r.userId : undefined,
    });
  }
  return out;
}

/** The entries belonging to this session. An UNTAGGED entry is deliberately
 *  excluded: unlike the write queues there is no marker fallback here, because
 *  showing the wrong contractor a lost-paperwork warning is worse than showing
 *  nobody one. */
export function ownFailures(all: readonly SyncFailure[], userId: string | null): SyncFailure[] {
  if (!userId) return [];
  return all.filter((f) => f.userId === userId);
}

/**
 * The distinct human labels, newest first — what the dialog lists.
 * Deduped so five failed photos read as one line, with the count folded in.
 */
export function failureLabels(failures: readonly SyncFailure[]): string[] {
  const counts = new Map<string, number>();
  for (const f of failures) {
    const key = `${f.label} — ${f.reason}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([key, n]) => (n > 1 ? `${key} (×${n})` : key));
}

/** Human table name. Deliberately small and explicit rather than a
 *  prettifier — a wrong guess here is shown to the user as the name of the
 *  thing they lost. Unknown tables fall back to the raw name, which is at
 *  least true. */
const TABLE_LABELS: Record<string, string> = {
  projects: 'Project',
  daily_reports: 'Daily report',
  field_tickets: 'Field ticket',
  punch_items: 'Punch item',
  change_orders: 'Change order',
  invoices: 'Invoice',
  photos: 'Photo record',
  rfis: 'RFI',
  submittals: 'Submittal',
  time_entries: 'Time entry',
  portal_messages: 'Client message',
  delay_events: 'Delay record',
  safety_incidents: 'Safety incident',
  toolbox_talks: 'Toolbox talk',
  deliveries: 'Delivery',
};

export function labelForTable(table: string): string {
  return TABLE_LABELS[table] ?? table;
}

// ── Storage (thin; the pure core above is what the validator exercises) ─────

/** Everything on disk. Throws if storage refuses, so a caller can tell
 *  "couldn't look" from "nothing there" — the distinction utils/syncStatusCore
 *  carries as `readFailed`. */
export async function readSyncFailuresOrThrow(): Promise<SyncFailure[]> {
  return parseFailures(await AsyncStorage.getItem(SYNC_FAILURE_KEY));
}

/**
 * Append failures. Best-effort by design: this runs inside the queue's drop
 * path, and a storage error here must never wedge a flush — the toast and the
 * Sentry warning still fire either way.
 */
export async function recordSyncFailures(incoming: readonly SyncFailure[]): Promise<void> {
  if (incoming.length === 0) return;
  return withQueueLock(async () => {
    try {
      const existing = await readSyncFailuresOrThrow();
      const merged = mergeFailures(existing, incoming);
      await AsyncStorage.setItem(SYNC_FAILURE_KEY, JSON.stringify(merged));
    } catch (err) {
      console.warn('[SyncLedger] could not record dropped writes:', (err as Error)?.message);
    }
  });
}

/**
 * Empty the ledger on a deliberate sign-out / tenant switch.
 *
 * The counterpart to this key's exemption in OFFLINE_WRITE_QUEUE_KEYS: the
 * prefix sweep deliberately no longer touches it (so a same-user re-auth keeps
 * the red "didn't sync" notice), which means the sign-out path has to. Under
 * the lock, for the reason in the header — the drop path can be mid-write.
 */
export async function clearSyncFailures(): Promise<void> {
  await withQueueLock(async () => {
    try {
      await AsyncStorage.removeItem(SYNC_FAILURE_KEY);
    } catch (err) {
      console.warn('[SyncLedger] could not clear the failure ledger:', (err as Error)?.message);
    }
  });
}

/**
 * Keep only `userId`'s notes; drop the rest. Twin of the queues'
 * retain*ForUser, for the session that arrives with no last-user marker.
 *
 * Untagged rows go: unlike a queue entry there is no marker fallback here
 * (see ownFailures), so an untagged note is unreadable by anyone and keeping
 * it only leaves the previous tenant's paperwork on the disk.
 */
export async function retainSyncFailuresForUser(userId: string): Promise<void> {
  await withQueueLock(async () => {
    try {
      const kept = (await readSyncFailuresOrThrow()).filter((f) => f.userId === userId);
      if (kept.length === 0) await AsyncStorage.removeItem(SYNC_FAILURE_KEY);
      else await AsyncStorage.setItem(SYNC_FAILURE_KEY, JSON.stringify(kept));
    } catch (err) {
      console.warn('[SyncLedger] could not narrow the failure ledger:', (err as Error)?.message);
    }
  });
}

/**
 * Forget the listed failures (or all of them).
 *
 * This is an ACKNOWLEDGEMENT, not a recovery, and every call site must say so
 * in its copy. Nothing here re-queues anything: the data is gone from the
 * queue and the user has to re-enter it.
 */
export async function acknowledgeSyncFailures(ids?: readonly string[]): Promise<void> {
  return withQueueLock(async () => {
  try {
    if (!ids) {
      await AsyncStorage.removeItem(SYNC_FAILURE_KEY);
      return;
    }
    const drop = new Set(ids);
    const kept = (await readSyncFailuresOrThrow()).filter((f) => !drop.has(f.id));
    if (kept.length === 0) await AsyncStorage.removeItem(SYNC_FAILURE_KEY);
    else await AsyncStorage.setItem(SYNC_FAILURE_KEY, JSON.stringify(kept));
  } catch (err) {
    console.warn('[SyncLedger] could not clear dropped-write records:', (err as Error)?.message);
  }
  });
}
