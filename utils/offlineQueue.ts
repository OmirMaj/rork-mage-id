import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

const OFFLINE_QUEUE_KEY = 'mageid_offline_queue';
const MAX_RETRIES = 5;
const MAX_QUEUE = 1000;

export interface OfflineMutation {
  id: string;
  table: string;
  operation: 'insert' | 'update' | 'delete';
  data: Record<string, unknown>;
  timestamp: number;
  retryCount: number;
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
      const dropped = queue.length - MAX_QUEUE;
      queue.splice(0, dropped); // FIFO: drop oldest
      console.warn(`[OfflineQueue] cap ${MAX_QUEUE} exceeded — dropped ${dropped} oldest mutation(s)`);
    }
    await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
    console.log('[OfflineQueue] Queued mutation:', mutation.table, mutation.operation);
  } catch (err) {
    console.log('[OfflineQueue] Failed to queue mutation:', err);
  }
}

// Auth/permission errors are terminal — the queue can't recover by retrying,
// and a stuck 401 from a stale session would otherwise loop forever.
function isTerminalError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('jwt') ||
    m.includes('unauthorized') ||
    m.includes('permission denied') ||
    m.includes('row-level security') ||
    m.includes('violates') ||
    m.includes('not authenticated')
  );
}

export async function processOfflineQueue(): Promise<{ processed: number; failed: number }> {
  if (!isSupabaseConfigured) return { processed: 0, failed: 0 };

  const queue = await getOfflineQueue();
  if (queue.length === 0) return { processed: 0, failed: 0 };

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
  async function processGroup(group: OfflineMutation[]): Promise<{ processed: number; failed: number; remaining: OfflineMutation[] }> {
    let gProcessed = 0;
    let gFailed = 0;
    const gRemaining: OfflineMutation[] = [];

    for (const mutation of group) {
      try {
        let error: { message: string } | null = null;

        if (mutation.operation === 'insert') {
          // Plain insert — upsert here would silently overwrite a colliding
          // row that some other client already created, masking conflicts.
          const result = await supabase.from(mutation.table).insert(mutation.data);
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
        if (isTerminalError(msg)) {
          console.warn('[OfflineQueue] Terminal error, discarding mutation:', mutation.table, mutation.operation, msg);
          gFailed++;
          continue;
        }
        mutation.retryCount++;
        if (mutation.retryCount >= MAX_RETRIES) {
          console.warn('[OfflineQueue] Discarding mutation after max retries:', mutation.table, mutation.operation, err);
          gFailed++;
        } else {
          gRemaining.push(mutation);
        }
      }
    }

    return { processed: gProcessed, failed: gFailed, remaining: gRemaining };
  }

  // Bounded-concurrency async pool: at most MAX_CONCURRENCY groups in flight.
  const MAX_CONCURRENCY = 5;
  const groups = [...groupMap.values()];
  const results: { processed: number; failed: number; remaining: OfflineMutation[] }[] = [];
  for (let i = 0; i < groups.length; i += MAX_CONCURRENCY) {
    const batch = groups.slice(i, i + MAX_CONCURRENCY);
    const batchResults = await Promise.all(batch.map(processGroup));
    results.push(...batchResults);
  }

  // Reduce all group results into final accounting.
  const remaining: OfflineMutation[] = [];
  let processed = 0;
  let failed = 0;
  for (const r of results) {
    processed += r.processed;
    failed += r.failed;
    remaining.push(...r.remaining);
  }

  await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remaining));
  console.log('[OfflineQueue] Done. Processed:', processed, 'Failed:', failed, 'Remaining:', remaining.length);
  return { processed, failed };
}

export async function supabaseWrite(
  table: string,
  operation: 'insert' | 'update' | 'delete',
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
    const isNetworkError = err instanceof TypeError ||
      (err instanceof Error && (
        err.message.includes('Network request failed') ||
        err.message.includes('Failed to fetch') ||
        err.message.includes('network')
      ));

    if (isNetworkError) {
      console.log('[OfflineQueue] Network error, queuing mutation:', table, operation);
      await addToOfflineQueue({ table, operation, data });
    } else {
      // Non-network failure (RLS denial, validation, server 500, schema
      // mismatch). These won't be fixed by reconnecting — we need to tell
      // the user so they can retry / report / fix the input. Logging
      // alone (the previous behavior) silently lost the write from the
      // user's perspective. AUD-001.
      const msg = err instanceof Error ? err.message : 'Sync failed';
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
