import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

const OFFLINE_QUEUE_KEY = 'mageid_offline_queue';
const MAX_RETRIES = 5;
// Hard cap on the queue size. Engineer audit flagged that
// `addToOfflineQueue` only pushes — a phone offline for a week with
// 5000 queued mutations will eventually OOM AsyncStorage on parse
// (~6MB Android default). 1000 is plenty for any realistic offline
// span (a week of heavy field work generates < 200 writes), and gives
// us breathing room before we hit the storage ceiling.
const MAX_QUEUE_SIZE = 1000;

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

    // Cap-and-FIFO. When we exceed the soft cap, drop the OLDEST
    // entries first. Pre-fix the queue grew unbounded — a phone
    // offline for a long stretch could OOM AsyncStorage on parse.
    // We log the drop so the user can see something happened (and
    // we surface a counter on the OfflineSyncPill in a follow-up
    // commit). The dropped writes are gone — that's the trade-off
    // for not crashing on cold start.
    if (queue.length > MAX_QUEUE_SIZE) {
      const dropped = queue.length - MAX_QUEUE_SIZE;
      queue.splice(0, dropped);
      console.warn(`[OfflineQueue] Capped at ${MAX_QUEUE_SIZE}, dropped ${dropped} oldest entries`);
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
  const remaining: OfflineMutation[] = [];
  let processed = 0;
  let failed = 0;

  for (const mutation of sorted) {
    try {
      let error: { message: string } | null = null;

      if (mutation.operation === 'insert') {
        // Use upsert with onConflict on the row's id. The pre-fix
        // plain insert hit a real silent-data-divergence bug:
        // when a user signed in on two devices, one device's queued
        // insert collided with the other's already-landed row, and
        // the queued mutation silently failed-then-discarded. The
        // local optimistic state was now divergent from server with
        // no reconciliation. Upsert with id-conflict gives us a
        // last-write-wins reconcile — the fresher row wins, and the
        // local state stays consistent. Same row id semantics, only
        // the conflict behavior changes.
        const result = await supabase
          .from(mutation.table)
          .upsert(mutation.data, { onConflict: 'id', ignoreDuplicates: false });
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

      processed++;
      console.log('[OfflineQueue] Processed:', mutation.table, mutation.operation);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isTerminalError(msg)) {
        console.warn('[OfflineQueue] Terminal error, discarding mutation:', mutation.table, mutation.operation, msg);
        failed++;
        continue;
      }
      mutation.retryCount++;
      if (mutation.retryCount >= MAX_RETRIES) {
        console.warn('[OfflineQueue] Discarding mutation after max retries:', mutation.table, mutation.operation, err);
        failed++;
      } else {
        remaining.push(mutation);
      }
    }
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
      console.log('[OfflineQueue] Non-network Supabase error:', err);
    }

    return false;
  }
}
