// useCustomAssemblies — offline-first CRUD for user-authored assembly presets.
//
// Storage flow mirrors useTimeEntries.ts exactly:
//  - Local source of truth: AsyncStorage `tertiary_custom_assemblies` keyed by
//    user. Reads are synchronous from React state, hydrated on mount.
//  - Server mirror: Supabase `assemblies` table (is_custom=true rows owned by
//    the current user) via `supabaseWrite()` from utils/offlineQueue.ts. Writes
//    are queued so offline edits don't drop on the floor.
//  - Read sync: when the user signs in, we pull every custom assembly from
//    Supabase and merge into the local store (server wins on conflict;
//    local-only rows that haven't flushed yet are preserved).
//
// System presets (ASSEMBLIES constant) are NOT touched here — this hook manages
// only the user's custom rows (is_custom === true). Do NOT add to ProjectContext.

import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { supabaseWrite } from '@/utils/offlineQueue';
import { generateUUID } from '@/utils/generateId';
import { safeJsonParse } from '@/utils/safeJson';
import type { AssemblyItem } from '@/constants/assemblies';
import { assemblyItemToRow, rowToAssemblyItem } from '@/utils/assemblyRows';
import type { AssemblyRow } from '@/utils/assemblyRows';

const STORAGE_KEY = 'tertiary_custom_assemblies';

export function useCustomAssemblies(): {
  customAssemblies: AssemblyItem[];
  isLoading: boolean;
  addCustomAssembly: (a: AssemblyItem) => Promise<void>;
  updateCustomAssembly: (a: AssemblyItem) => Promise<void>;
  deleteCustomAssembly: (id: string) => Promise<void>;
} {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [customAssemblies, setCustomAssemblies] = useState<AssemblyItem[]>([]);
  const [hydrated, setHydrated] = useState<boolean>(false);

  // ── Hydrate from AsyncStorage on mount ─────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!cancelled) {
          setCustomAssemblies(safeJsonParse<AssemblyItem[]>(raw, []));
        }
      } catch (err) {
        console.warn('[useCustomAssemblies] Failed to hydrate from storage:', err);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Reset on user transition ───────────────────────────────────────
  // When userId changes (sign out / sign in as different user), clear local
  // state so user A's assemblies don't leak into user B's session.
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
      setCustomAssemblies([]);
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
          .from('assemblies')
          .select('*')
          .eq('user_id', userId)
          .eq('is_custom', true);
        if (cancelled) return;
        if (error) {
          console.warn('[useCustomAssemblies] Server fetch failed:', error.message);
          return; // keep cache, no throw
        }
        const fromServer = (data as AssemblyRow[] | null ?? []).map(rowToAssemblyItem);
        // Server wins on conflict — rows that exist server-side override local
        // versions of the same id. Local-only rows (offline writes not yet
        // flushed) are preserved.
        setCustomAssemblies(prev => {
          const byId = new Map<string, AssemblyItem>();
          prev.forEach(a => byId.set(a.id, a));
          fromServer.forEach(a => byId.set(a.id, a));
          return Array.from(byId.values());
        });
      } catch (err) {
        console.warn('[useCustomAssemblies] Server fetch threw:', err);
        // keep cache, no throw
      }
    })();
    return () => { cancelled = true; };
  }, [hydrated, userId]);

  // ── Persist to AsyncStorage on every change ────────────────────────
  // Single writer: this effect handles writing on EVERY customAssemblies
  // change, including the server merge above. Keeps write ordering clean.
  useEffect(() => {
    if (!hydrated) return;
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(customAssemblies));
  }, [customAssemblies, hydrated]);

  // ── Mutators ──────────────────────────────────────────────────────

  const addCustomAssembly = useCallback(async (a: AssemblyItem): Promise<void> => {
    // Guarantee a stable id — callers may omit it.
    const item: AssemblyItem = a.id ? a : { ...a, id: generateUUID() };
    setCustomAssemblies(prev => [item, ...prev]);
    if (userId) {
      void supabaseWrite(
        'assemblies',
        'insert',
        assemblyItemToRow(item, userId) as unknown as Record<string, unknown>,
      );
    }
  }, [userId]);

  const updateCustomAssembly = useCallback(async (a: AssemblyItem): Promise<void> => {
    setCustomAssemblies(prev => prev.map(x => x.id === a.id ? a : x));
    if (userId) {
      // Don't resend created_at on update — it would reset the row's
      // original creation timestamp on every edit. updated_at is kept
      // (it should advance on edit) and is a real live column.
      const { created_at: _omitCreatedAt, ...updateRow } = assemblyItemToRow(a, userId);
      void supabaseWrite(
        'assemblies',
        'update',
        updateRow as unknown as Record<string, unknown>,
      );
    }
  }, [userId]);

  const deleteCustomAssembly = useCallback(async (id: string): Promise<void> => {
    setCustomAssemblies(prev => prev.filter(x => x.id !== id));
    if (userId) {
      void supabaseWrite('assemblies', 'delete', { id });
    }
  }, [userId]);

  return {
    customAssemblies,
    isLoading: !hydrated,
    addCustomAssembly,
    updateCustomAssembly,
    deleteCustomAssembly,
  };
}
