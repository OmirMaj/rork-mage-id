// useWorkers — real backing store for the GC's crew roster, replacing
// `mocks/timeTracking.ts:CREW_MEMBERS`.
//
// Pre-fix the clock-in modal in `app/time-tracking.tsx` showed the same
// six fake names ("Carlos Mendez / James Williams / Mike Thompson / …")
// to every customer of the app — the single most demo-screaming
// artifact in the codebase. Now: workers are real Supabase rows with
// offline-first AsyncStorage caching and queue-backed writes, exactly
// like `useTimeEntries`.
//
// Storage flow:
//   - Source of truth: AsyncStorage `tertiary_workers` keyed by user.
//     Reads are synchronous from React state, hydrated on mount.
//   - Server mirror: Supabase `workers` table via `supabaseWrite()`
//     from `utils/offlineQueue.ts`. Writes survive airplane mode.
//   - Read sync: when the user signs in, pull every worker from
//     Supabase and merge — server wins on conflict.
//
// First-run experience: when the user has zero workers (fresh install
// post-migration, or a brand-new GC), the hook seeds nothing — the
// time-tracking screen handles the empty state by showing a "Add your
// first crew member" CTA. The legacy CREW_MEMBERS mock list is removed
// entirely; the hook never bootstraps fake data.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { supabaseWrite } from '@/utils/offlineQueue';
import { generateUUID } from '@/utils/generateId';
import type { Worker } from '@/types';

const STORAGE_KEY = 'tertiary_workers';

interface DBRow {
  id: string;
  user_id: string;
  name: string;
  trade: string | null;
  hourly_rate: number | null;
  phone: string | null;
  email: string | null;
  active: boolean;
  subcontractor_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function fromDB(r: DBRow): Worker {
  return {
    id: r.id,
    name: r.name,
    trade: r.trade ?? undefined,
    hourlyRate: r.hourly_rate != null ? Number(r.hourly_rate) : undefined,
    phone: r.phone ?? undefined,
    email: r.email ?? undefined,
    active: !!r.active,
    subcontractorId: r.subcontractor_id ?? undefined,
    notes: r.notes ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface UseWorkersResult {
  workers: Worker[];
  /** Active workers only — what the clock-in picker should display. */
  activeWorkers: Worker[];
  loading: boolean;
  addWorker: (input: Omit<Worker, 'id' | 'createdAt' | 'updatedAt' | 'active'> & { id?: string; active?: boolean }) => Worker;
  updateWorker: (id: string, patch: Partial<Worker>) => void;
  deleteWorker: (id: string) => void;
  /** Toggle the `active` flag — preferred over delete because
   *  historical TimeEntry rows reference workerId. */
  archiveWorker: (id: string) => void;
}

export function useWorkers(): UseWorkersResult {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const hydratedRef = useRef(false);

  // 1. Hydrate from AsyncStorage on mount (instant) — server pull
  //    happens after, replacing the in-memory list when it lands.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!cancelled && raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setWorkers(parsed as Worker[]);
        }
      } catch (err) {
        console.log('[useWorkers] local load failed', err);
      } finally {
        if (!cancelled) {
          setLoading(false);
          hydratedRef.current = true;
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 2. Server pull when authenticated — merge into local store.
  useEffect(() => {
    if (!userId || !isSupabaseConfigured) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('workers')
          .select('*')
          .eq('user_id', userId)
          .order('name', { ascending: true });
        if (cancelled) return;
        if (error) {
          console.log('[useWorkers] server pull failed', error.message);
          return;
        }
        const list = (data as DBRow[] | null)?.map(fromDB) ?? [];
        setWorkers(list);
        try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch { /* ok */ }
      } catch (err) {
        console.log('[useWorkers] server pull error', err);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // Persist + return next list. Used by every mutator.
  const persist = useCallback((next: Worker[]) => {
    setWorkers(next);
    void (async () => {
      try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ok */ }
    })();
  }, []);

  const addWorker = useCallback<UseWorkersResult['addWorker']>((input) => {
    const now = new Date().toISOString();
    const w: Worker = {
      id: input.id ?? generateUUID(),
      name: input.name,
      trade: input.trade,
      hourlyRate: input.hourlyRate,
      phone: input.phone,
      email: input.email,
      active: input.active ?? true,
      subcontractorId: input.subcontractorId,
      notes: input.notes,
      createdAt: now,
      updatedAt: now,
    };
    const next = [w, ...workers].sort((a, b) => a.name.localeCompare(b.name));
    persist(next);
    if (userId && isSupabaseConfigured) {
      void supabaseWrite('workers', 'insert', {
        id: w.id,
        user_id: userId,
        name: w.name,
        trade: w.trade ?? null,
        hourly_rate: w.hourlyRate ?? null,
        phone: w.phone ?? null,
        email: w.email ?? null,
        active: w.active,
        subcontractor_id: w.subcontractorId ?? null,
        notes: w.notes ?? null,
        created_at: w.createdAt,
        updated_at: w.updatedAt,
      });
    }
    return w;
  }, [workers, persist, userId]);

  const updateWorker = useCallback<UseWorkersResult['updateWorker']>((id, patch) => {
    const now = new Date().toISOString();
    const next = workers.map(w => w.id === id ? { ...w, ...patch, updatedAt: now } : w);
    persist(next);
    if (userId && isSupabaseConfigured) {
      const w = next.find(x => x.id === id);
      if (w) {
        void supabaseWrite('workers', 'update', {
          id,
          name: w.name,
          trade: w.trade ?? null,
          hourly_rate: w.hourlyRate ?? null,
          phone: w.phone ?? null,
          email: w.email ?? null,
          active: w.active,
          subcontractor_id: w.subcontractorId ?? null,
          notes: w.notes ?? null,
          updated_at: now,
        });
      }
    }
  }, [workers, persist, userId]);

  const deleteWorker = useCallback<UseWorkersResult['deleteWorker']>((id) => {
    const next = workers.filter(w => w.id !== id);
    persist(next);
    if (userId && isSupabaseConfigured) {
      void supabaseWrite('workers', 'delete', { id });
    }
  }, [workers, persist, userId]);

  const archiveWorker = useCallback<UseWorkersResult['archiveWorker']>((id) => {
    updateWorker(id, { active: false });
  }, [updateWorker]);

  const activeWorkers = useMemo(
    () => workers.filter(w => w.active).sort((a, b) => a.name.localeCompare(b.name)),
    [workers],
  );

  return useMemo(() => ({
    workers, activeWorkers, loading,
    addWorker, updateWorker, deleteWorker, archiveWorker,
  }), [workers, activeWorkers, loading, addWorker, updateWorker, deleteWorker, archiveWorker]);
}
