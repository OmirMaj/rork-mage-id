import { useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import createContextHook from '@nkzw/create-context-hook';
import { generateUUID } from '@/utils/generateId';
import { useAuth } from '@/contexts/AuthContext';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { supabaseWrite } from '@/utils/offlineQueue';
import type { ScanRecord, ScanDocType, ScanRecordKind } from '@/types';

const SCAN_RECORDS_KEY = 'tertiary_scan_records';

// Tenant-safe, namespaced storage key. A signed-in user's scan audit log lives
// under a per-user key so switching accounts on one device never bleeds one
// tenant's captured documents into another's view. Signed-out falls back to the
// bare key.
function recordsKey(userId: string | undefined): string {
  return userId ? `${SCAN_RECORDS_KEY}_${userId}` : SCAN_RECORDS_KEY;
}

async function loadLocal<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

// Maps a ScanRecord to the snake_case scan_records row shape. fields is stored as
// JSONB; supabase-js serializes the object for the jsonb column.
function toRow(r: ScanRecord) {
  return {
    id: r.id,
    user_id: r.userId,
    project_id: r.projectId,
    doc_type: r.docType,
    title: r.title,
    fields: r.fields,
    file_path: r.filePath,
    record_kind: r.recordKind,
    linked_record_id: r.linkedRecordId ?? null,
    created_at: r.createdAt,
  };
}

// Inverse of toRow: a snake_case Supabase row → camelCase ScanRecord. Null
// columns hydrate as undefined (not null) to match the optional-field types.
function fromRow(r: Record<string, unknown>): ScanRecord {
  return {
    id: r.id as string,
    userId: r.user_id as string,
    projectId: r.project_id as string,
    docType: r.doc_type as ScanDocType,
    title: (r.title as string | null) ?? '',
    fields: (r.fields as Record<string, unknown> | null) ?? {},
    filePath: (r.file_path as string | null) ?? '',
    recordKind: (r.record_kind as ScanRecordKind | null) ?? 'file_only',
    linkedRecordId: (r.linked_record_id as string | null) ?? undefined,
    createdAt: r.created_at as string,
  };
}

export const [ScanProvider, useScans] = createContextHook(() => {
  const { user } = useAuth();
  const userId = user?.id;
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const hydratedRef = useRef(false);

  const hydrate = useCallback(async (cancelledRef?: { current: boolean }) => {
    const isCancelled = () => cancelledRef?.current ?? false;
    const key = recordsKey(userId);
    if (userId && isSupabaseConfigured) {
      try {
        const { data, error } = await supabase
          .from('scan_records')
          .select('*')
          .order('created_at', { ascending: false });
        if (!isCancelled() && !error && data && data.length > 0) {
          const mapped = data
            .map((r) => fromRow(r as Record<string, unknown>))
            .filter((s) => typeof s.id === 'string');
          // Merge, don't overwrite: a scan captured offline may still be in the
          // queue and absent from this cloud result. Union the local cache's
          // local-only ids in so an unsynced record isn't dropped from the view
          // (or clobbered in the cache) until the queue flushes.
          const cloudIds = new Set(mapped.map((s) => s.id));
          const localOnly = (await loadLocal<ScanRecord[]>(key, []))
            .filter((s) => s && typeof s.id === 'string' && !cloudIds.has(s.id));
          if (isCancelled()) return;
          const merged = [...localOnly, ...mapped];
          setScans(merged);
          try { await AsyncStorage.setItem(key, JSON.stringify(merged)); } catch { /* non-fatal cache write */ }
          hydratedRef.current = true;
          return;
        }
      } catch { /* fall through to local cache */ }
    }
    const stored = await loadLocal<ScanRecord[]>(key, []);
    if (isCancelled()) return;
    if (Array.isArray(stored)) {
      setScans(stored.filter((s) => s && typeof s.id === 'string'));
    }
    hydratedRef.current = true;
  }, [userId]);

  // Hydrate whenever the tenant changes. Clear first so a prior account's scans
  // never linger, then read Supabase (snake→camel, RLS-scoped) with an
  // AsyncStorage fallback for offline / fresh-install / empty-cloud paths.
  useEffect(() => {
    const cancelledRef = { current: false };
    hydratedRef.current = false;
    setScans([]); // tenant switch → drop the previous tenant's rows immediately
    void hydrate(cancelledRef);
    return () => { cancelledRef.current = true; };
  }, [hydrate]);

  const persist = useCallback(async (next: ScanRecord[]) => {
    setScans(next);
    try { await AsyncStorage.setItem(recordsKey(userId), JSON.stringify(next)); }
    catch { /* AsyncStorage failure is non-fatal for in-memory state */ }
  }, [userId]);

  const addScan = useCallback((input: {
    projectId: string;
    docType: ScanDocType;
    title: string;
    fields: Record<string, unknown>;
    filePath: string;
    recordKind: ScanRecordKind;
    linkedRecordId?: string;
  }): ScanRecord => {
    const record: ScanRecord = {
      id: generateUUID(),
      userId: userId ?? '',
      projectId: input.projectId,
      docType: input.docType,
      title: input.title,
      fields: input.fields,
      filePath: input.filePath,
      recordKind: input.recordKind,
      linkedRecordId: input.linkedRecordId,
      createdAt: new Date().toISOString(),
    };
    void persist([record, ...scans]);
    if (userId) void supabaseWrite('scan_records', 'insert', toRow(record));
    return record;
  }, [scans, persist, userId]);

  const refresh = useCallback(async () => {
    await hydrate();
  }, [hydrate]);

  return { scans, addScan, refresh };
});
