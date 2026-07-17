// useRateOverrides — offline-first CRUD for the GC's rate-override cost-book.
//
// Storage flow mirrors useCustomAssemblies.ts exactly:
//  - Local source of truth: AsyncStorage `mageid_rate_overrides` keyed by
//    user. Reads are synchronous from React state, hydrated on mount.
//  - Server mirror: Supabase `rate_overrides` table (rows owned by the current
//    user) via `supabaseWrite()` from utils/offlineQueue.ts. Writes are queued
//    so offline edits don't drop on the floor.
//  - Read sync: when the user signs in, we pull every rate override from
//    Supabase and merge into the local store (server wins on conflict;
//    local-only rows that haven't flushed yet are preserved).
//
// Do NOT add to ProjectContext.

import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { supabaseWrite } from '@/utils/offlineQueue';
import { generateUUID } from '@/utils/generateId';
import { safeJsonParse } from '@/utils/safeJson';
import {
  type RateOverride,
  type RateOverrideRow,
  rateOverrideToRow,
  rowToRateOverride,
} from '@/utils/rateOverrides';

const STORAGE_KEY = 'mageid_rate_overrides';

export function useRateOverrides(): {
  overrides: RateOverride[];
  isLoading: boolean;
  laborRate: (trade: string) => number | undefined;
  materialPrice: (materialId: string) => number | undefined;
  addOverride: (o: RateOverride) => Promise<void>;
  updateOverride: (o: RateOverride) => Promise<void>;
  deleteOverride: (id: string) => Promise<void>;
} {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [overrides, setOverrides] = useState<RateOverride[]>([]);
  const [hydrated, setHydrated] = useState<boolean>(false);

  // ── Hydrate from AsyncStorage on mount ─────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!cancelled) {
          setOverrides(safeJsonParse<RateOverride[]>(raw, []));
        }
      } catch (err) {
        console.warn('[useRateOverrides] Failed to hydrate from storage:', err);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Reset on user transition ───────────────────────────────────────
  // When userId changes (sign out / sign in as different user), clear local
  // state so user A's overrides don't leak into user B's session.
  // Tracked via a ref so we only react to actual transitions, not initial mount.
  const lastUserIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const last = lastUserIdRef.current;
    // First run: just record. No clearing on initial mount.
    if (last === undefined) {
      lastUserIdRef.current = userId;
      return;
    }
    // Transition detected (last user ≠ current user, including null↔value)
    if (last !== userId) {
      lastUserIdRef.current = userId;
      setOverrides([]);
      void AsyncStorage.removeItem(STORAGE_KEY);
    }
  }, [userId]);

  // ── Pull from Supabase once we have a session ──────────────────────
  useEffect(() => {
    if (!hydrated || !userId || !isSupabaseConfigured) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('rate_overrides')
          .select('*');
        if (cancelled) return;
        if (error) {
          console.warn('[useRateOverrides] Server fetch failed:', error.message);
          return; // keep cache, no throw
        }
        const fromServer = (data as RateOverrideRow[] | null ?? []).map(rowToRateOverride);
        // Server wins on conflict — rows that exist server-side override local
        // versions of the same id. Local-only rows (offline writes not yet
        // flushed) are preserved.
        setOverrides(prev => {
          const byId = new Map<string, RateOverride>();
          prev.forEach(o => byId.set(o.id, o));
          fromServer.forEach(o => byId.set(o.id, o));
          return Array.from(byId.values());
        });
      } catch (err) {
        console.warn('[useRateOverrides] Server fetch threw:', err);
        // keep cache, no throw
      }
    })();
    return () => { cancelled = true; };
  }, [hydrated, userId]);

  // ── Persist to AsyncStorage on every change ────────────────────────
  // Single writer: this effect handles writing on EVERY overrides change,
  // including the server merge above. Keeps write ordering clean.
  useEffect(() => {
    if (!hydrated) return;
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  }, [overrides, hydrated]);

  // ── Convenience lookups ───────────────────────────────────────────

  const laborRate = useCallback(
    (trade: string): number | undefined =>
      overrides.find(o => o.kind === 'labor' && o.key === trade)?.value,
    [overrides],
  );

  const materialPrice = useCallback(
    (materialId: string): number | undefined =>
      overrides.find(o => o.kind === 'material' && o.key === materialId)?.value,
    [overrides],
  );

  // ── Mutators ──────────────────────────────────────────────────────

  const addOverride = useCallback(async (o: RateOverride): Promise<void> => {
    // Guarantee a stable id — callers may omit it.
    const item: RateOverride = o.id ? o : { ...o, id: generateUUID() };
    setOverrides(prev => [item, ...prev]);
    if (userId) {
      void supabaseWrite(
        'rate_overrides',
        'insert',
        rateOverrideToRow(item, userId) as unknown as Record<string, unknown>,
      );
    }
  }, [userId]);

  const updateOverride = useCallback(async (o: RateOverride): Promise<void> => {
    setOverrides(prev => prev.map(x => x.id === o.id ? o : x));
    if (userId) {
      // Don't resend created_at on update — it would reset the row's
      // original creation timestamp on every edit. updated_at is kept
      // (it should advance on edit) and is a real live column.
      const { created_at: _omitCreatedAt, ...updateRow } = rateOverrideToRow(o, userId);
      void supabaseWrite(
        'rate_overrides',
        'update',
        updateRow as unknown as Record<string, unknown>,
      );
    }
  }, [userId]);

  const deleteOverride = useCallback(async (id: string): Promise<void> => {
    setOverrides(prev => prev.filter(x => x.id !== id));
    if (userId) {
      void supabaseWrite('rate_overrides', 'delete', { id });
    }
  }, [userId]);

  return {
    overrides,
    isLoading: !hydrated,
    laborRate,
    materialPrice,
    addOverride,
    updateOverride,
    deleteOverride,
  };
}
