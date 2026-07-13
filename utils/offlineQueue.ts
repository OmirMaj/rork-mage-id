import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

const OFFLINE_QUEUE_KEY = 'mageid_offline_queue';
const MAX_RETRIES = 5;
const MAX_QUEUE = 1000;

export interface OfflineMutation {
  id: string;
  table: string;
  operation: 'insert' | 'upsert' | 'update' | 'delete';
  data: Record<string, unknown>;
  timestamp: number;
  retryCount: number;
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

export async function getOfflineQueue(): Promise<OfflineMutation[]> {
  try {
    const stored = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
    return stored ? JSON.parse(stored) as OfflineMutation[] : [];
  } catch {
    return [];
  }
}

export async function addToOfflineQueue(mutation: Omit<OfflineMutation, 'id' | 'timestamp' | 'retryCount'>): Promise<void> {
  return withQueueLock(async () => {
    try {
      const queue = await getOfflineQueue();
      const entry: OfflineMutation = {
        ...mutation,
        id: `oq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: Date.now(),
        retryCount: 0,
      };
      queue.push(entry);
      if (queue.length > MAX_QUEUE) {
        const droppedEntries = queue.splice(0, queue.length - MAX_QUEUE); // FIFO: drop oldest
        console.warn(`[OfflineQueue] cap ${MAX_QUEUE} exceeded — dropped ${droppedEntries.length} oldest mutation(s)`);
        notifyDroppedWrites(droppedEntries.length, droppedEntries.map(d => d.table), 'queue cap exceeded');
      }
      await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
      console.log('[OfflineQueue] Queued mutation:', mutation.table, mutation.operation);
    } catch (err) {
      console.log('[OfflineQueue] Failed to queue mutation:', err);
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
    m.includes('jwt') ||
    m.includes('unauthorized') ||
    m.includes('permission denied') ||
    m.includes('row-level security') ||
    (m.includes('violates') && !m.includes('foreign key')) ||
    m.includes('not authenticated')
  );
}

// A queued write was permanently discarded (terminal error, retry exhaustion,
// or queue-cap overflow). For an offline-first app, silent data loss is the
// worst failure mode — surface it on the toast host and forward to Sentry so
// the user can re-enter the data and we can see the pattern in prod. Lazy
// requires keep this module side-effect free at load (same pattern as
// supabaseWrite's AUD-001 handling below).
function notifyDroppedWrites(count: number, tables: string[], reason: string): void {
  const tableList = [...new Set(tables)].join(', ');
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { oops } = require('@/components/animations/NailItToast');
    oops(`${count} change(s) couldn't be synced (${tableList}). Please re-check that data.`);
  } catch {/* toast host not mounted — nothing actionable */}
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require('@sentry/react-native');
    Sentry.captureMessage(`[OfflineQueue] dropped ${count} write(s): ${tableList} (${reason})`, 'warning');
  } catch {/* ignore */}
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
let inFlight: Promise<{ processed: number; failed: number; remaining: number }> | null = null;

export function processOfflineQueue(): Promise<{ processed: number; failed: number; remaining: number }> {
  if (inFlight) return inFlight;
  inFlight = runOfflineQueue().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runOfflineQueue(): Promise<{ processed: number; failed: number; remaining: number }> {
  if (!isSupabaseConfigured) return { processed: 0, failed: 0, remaining: 0 };

  const queue = await getOfflineQueue();
  if (queue.length === 0) return { processed: 0, failed: 0, remaining: 0 };

  console.log('[OfflineQueue] Processing', queue.length, 'queued mutations');

  const sorted = [...queue].sort((a, b) => a.timestamp - b.timestamp);

  // Group by record key to allow bounded concurrency across records while
  // preserving strict ordering within each record (insert-before-update, etc.).
  // An insert with no data.id yet gets its own singleton group keyed by
  // mutation.id so it never races with mutations for other records.
  const groupMap = new Map<string, OfflineMutation[]>();
  for (const mutation of sorted) {
    const recordKey = `${mutation.table}:${String((mutation.data && mutation.data.id) ?? mutation.id)}`;
    let group = groupMap.get(recordKey);
    if (!group) {
      group = [];
      groupMap.set(recordKey, group);
    }
    group.push(mutation);
  }

  // Process one group serially; return its accounting totals.
  async function processGroup(group: OfflineMutation[]): Promise<{ processed: number; failed: number; remaining: OfflineMutation[]; dropped: OfflineMutation[] }> {
    let gProcessed = 0;
    let gFailed = 0;
    const gRemaining: OfflineMutation[] = [];
    const gDropped: OfflineMutation[] = [];

    for (const mutation of group) {
      try {
        let error: { message: string } | null = null;

        if (mutation.operation === 'insert') {
          // Plain insert — upsert here would silently overwrite a colliding
          // row that some other client already created, masking conflicts.
          const result = await supabase.from(mutation.table).insert(mutation.data);
          error = result.error;
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
        } else if (mutation.operation === 'delete') {
          const result = await supabase.from(mutation.table).delete().eq('id', mutation.data.id as string);
          error = result.error;
        }

        if (error) {
          throw new Error(error.message);
        }

        gProcessed++;
        console.log('[OfflineQueue] Processed:', mutation.table, mutation.operation);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (isNetworkError(err) || isSchemaCacheError(msg)) {
          // Offline / transient — re-queue UNCHANGED. Crucially do NOT bump
          // retryCount: a device that's merely offline (or hitting a not-yet-
          // migrated schema cache) must never burn through its retry budget and
          // permanently drop the write. It self-heals when connectivity returns
          // or the migration lands. retryCount is reserved for genuine
          // server-side (5xx / transient-but-terminal) failures below.
          console.log('[OfflineQueue] Transient error, keeping mutation queued:', mutation.table, mutation.operation);
          gRemaining.push(mutation);
          continue;
        }
        if (isTerminalError(msg)) {
          console.warn('[OfflineQueue] Terminal error, discarding mutation:', mutation.table, mutation.operation, msg);
          gFailed++;
          gDropped.push(mutation);
          continue;
        }
        mutation.retryCount++;
        if (mutation.retryCount >= MAX_RETRIES) {
          console.warn('[OfflineQueue] Discarding mutation after max retries:', mutation.table, mutation.operation, err);
          gFailed++;
          gDropped.push(mutation);
        } else {
          gRemaining.push(mutation);
        }
      }
    }

    return { processed: gProcessed, failed: gFailed, remaining: gRemaining, dropped: gDropped };
  }

  // Bounded-concurrency async pool: at most MAX_CONCURRENCY groups in flight.
  const MAX_CONCURRENCY = 5;
  const groups = [...groupMap.values()];
  const results: { processed: number; failed: number; remaining: OfflineMutation[]; dropped: OfflineMutation[] }[] = [];
  for (let i = 0; i < groups.length; i += MAX_CONCURRENCY) {
    const batch = groups.slice(i, i + MAX_CONCURRENCY);
    const batchResults = await Promise.all(batch.map(processGroup));
    results.push(...batchResults);
  }

  // Reduce all group results into final accounting.
  const remaining: OfflineMutation[] = [];
  const dropped: OfflineMutation[] = [];
  let processed = 0;
  let failed = 0;
  for (const r of results) {
    processed += r.processed;
    failed += r.failed;
    remaining.push(...r.remaining);
    dropped.push(...r.dropped);
  }
  // Permanent discards must be visible — silent loss is the one unforgivable
  // failure mode for an offline-first app.
  if (dropped.length > 0) {
    notifyDroppedWrites(dropped.length, dropped.map(d => d.table), 'terminal error or retry exhaustion');
  }

  // Atomic write-back under the queue lock. Instead of overwriting the whole
  // queue with `remaining` (which would clobber any mutation enqueued while
  // this flush was in its network phase), re-read the CURRENT persisted queue
  // and reconcile: for mutations that were part of this flush, drop the
  // resolved ones and keep the re-queued ones (network-failed unchanged, or
  // server-error with a bumped retryCount); any entry NOT in this flush's
  // snapshot was appended mid-flush and is preserved verbatim.
  const flushIds = new Set(sorted.map((m) => m.id));
  const keptById = new Map(remaining.map((m) => [m.id, m] as const));
  const remainingCount = await withQueueLock(async () => {
    const current = await getOfflineQueue();
    const next: OfflineMutation[] = [];
    for (const entry of current) {
      if (flushIds.has(entry.id)) {
        const kept = keptById.get(entry.id);
        if (kept) next.push(kept); // re-queue (unchanged or retry-bumped)
        // else: successfully processed / terminally failed / retry-exhausted → drop
      } else {
        next.push(entry); // enqueued mid-flush — preserve
      }
    }
    await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(next));
    return next.length;
  });

  console.log('[OfflineQueue] Done. Processed:', processed, 'Failed:', failed, 'Remaining:', remainingCount);
  return { processed, failed, remaining: remainingCount };
}

export async function supabaseWrite(
  table: string,
  operation: 'insert' | 'upsert' | 'update' | 'delete',
  data: Record<string, unknown>,
): Promise<boolean> {
  if (!isSupabaseConfigured) return false;

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
      throw new Error(error.message);
    }

    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Sync failed';
    if (isNetworkError(err) || isSchemaCacheError(msg)) {
      // Offline / transient (incl. a PostgREST schema-cache miss during a
      // migration-before-OTA race). Queue the write UNCHANGED so it drains once
      // connectivity returns or the migration lands — never drop it, and don't
      // scare the user with a toast for a self-healing condition.
      console.log('[OfflineQueue] Transient error, queuing mutation:', table, operation);
      await addToOfflineQueue({ table, operation, data });
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

    return false;
  }
}
