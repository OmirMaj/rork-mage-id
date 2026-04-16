import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

const OFFLINE_QUEUE_KEY = 'mageid_offline_queue';
const MAX_RETRIES = 5;

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
    await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
    console.log('[OfflineQueue] Queued mutation:', mutation.table, mutation.operation);
  } catch (err) {
    console.log('[OfflineQueue] Failed to queue mutation:', err);
  }
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

      processed++;
      console.log('[OfflineQueue] Processed:', mutation.table, mutation.operation);
    } catch (err) {
      mutation.retryCount++;
      if (mutation.retryCount >= MAX_RETRIES) {
        console.warn('[OfflineQueue] Discarding mutation after max retries:', mutation.table, mutation.operation, err);
        failed++;
      } else {
        remaining.push(mutation);
        failed++;
      }
    }
  }

  await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remaining));
  console.log('[OfflineQueue] Done. Processed:', processed, 'Remaining:', remaining.length);
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
