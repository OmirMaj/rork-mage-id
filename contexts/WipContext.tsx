import { useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import createContextHook from '@nkzw/create-context-hook';
import { generateUUID } from '@/utils/generateId';
import { useAuth } from '@/contexts/AuthContext';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { supabaseWrite } from '@/utils/offlineQueue';
import { assertPeriodEditable } from '@/utils/wip';
import type { WipPeriod, WipSnapshotRow, WipPortfolio } from '@/types';

const WIP_PERIODS_KEY = 'tertiary_wip_periods';

// Tenant-safe, namespaced storage key. A signed-in user's periods live under a
// per-user key so switching accounts on one device never bleeds one tenant's
// financial snapshots into another's view. Signed-out falls back to the bare key.
function periodsKey(userId: string | undefined): string {
  return userId ? `${WIP_PERIODS_KEY}_${userId}` : WIP_PERIODS_KEY;
}

async function loadLocal<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

// Maps a WipPeriod to the snake_case wip_periods row shape. rows/portfolio are
// stored as JSONB; supabase-js serializes the objects for the jsonb columns.
function toRow(p: WipPeriod, userId: string | undefined) {
  return {
    id: p.id,
    user_id: userId ?? null,
    company_id: p.companyId ?? null,
    period_end_date: p.periodEndDate,
    rows: p.rows,
    portfolio_totals: p.portfolioTotals,
    notes: p.notes ?? null,
    locked_at: p.lockedAt ?? null,
    created_by: p.createdBy ?? null,
    created_at: p.createdAt,
  };
}

// Inverse of toRow: a snake_case Supabase row → camelCase WipPeriod. Null
// columns hydrate as undefined (not null) to match the optional-field types.
function fromRow(r: Record<string, unknown>): WipPeriod {
  return {
    id: r.id as string,
    periodEndDate: r.period_end_date as string,
    createdAt: r.created_at as string,
    createdBy: (r.created_by as string | null) ?? undefined,
    companyId: (r.company_id as string | null) ?? undefined,
    rows: (r.rows as WipSnapshotRow[] | null) ?? [],
    portfolioTotals: r.portfolio_totals as WipPortfolio,
    notes: (r.notes as string | null) ?? undefined,
    lockedAt: (r.locked_at as string | null) ?? undefined,
  };
}

export const [WipProvider, useWip] = createContextHook(() => {
  const { user } = useAuth();
  const userId = user?.id;
  const [periods, setPeriods] = useState<WipPeriod[]>([]);
  const hydratedRef = useRef(false);

  // Hydrate whenever the tenant changes. Clear first so a prior account's
  // snapshots never linger, then read Supabase (snake→camel, RLS-scoped) with
  // an AsyncStorage fallback for offline / fresh-install / empty-cloud paths.
  useEffect(() => {
    let cancelled = false;
    hydratedRef.current = false;
    setPeriods([]); // tenant switch → drop the previous tenant's rows immediately
    (async () => {
      const key = periodsKey(userId);
      if (userId && isSupabaseConfigured) {
        try {
          const { data, error } = await supabase
            .from('wip_periods')
            .select('*')
            .order('created_at', { ascending: false });
          if (!cancelled && !error && data && data.length > 0) {
            const mapped = data
              .map((r) => fromRow(r as Record<string, unknown>))
              .filter((p) => typeof p.id === 'string');
            // Merge, don't overwrite: a period created offline may still be in
            // the queue and absent from this cloud result. Union the local
            // cache's local-only ids in so an unsynced snapshot isn't dropped
            // from the view (or clobbered in the cache) until the queue flushes.
            const cloudIds = new Set(mapped.map((p) => p.id));
            const localOnly = (await loadLocal<WipPeriod[]>(key, []))
              .filter((p) => p && typeof p.id === 'string' && !cloudIds.has(p.id));
            if (cancelled) return;
            const merged = [...localOnly, ...mapped];
            setPeriods(merged);
            try { await AsyncStorage.setItem(key, JSON.stringify(merged)); } catch { /* non-fatal cache write */ }
            hydratedRef.current = true;
            return;
          }
        } catch { /* fall through to local cache */ }
      }
      const stored = await loadLocal<WipPeriod[]>(key, []);
      if (cancelled) return;
      if (Array.isArray(stored)) {
        setPeriods(stored.filter((p) => p && typeof p.id === 'string'));
      }
      hydratedRef.current = true;
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const persist = useCallback(async (next: WipPeriod[]) => {
    setPeriods(next);
    try { await AsyncStorage.setItem(periodsKey(userId), JSON.stringify(next)); }
    catch { /* AsyncStorage failure is non-fatal for in-memory state */ }
  }, [userId]);

  const addPeriod = useCallback((input: {
    periodEndDate: string;
    rows: WipSnapshotRow[];
    portfolioTotals: WipPortfolio;
    notes?: string;
    companyId?: string;
  }): WipPeriod => {
    const now = new Date().toISOString();
    const period: WipPeriod = {
      id: generateUUID(),
      createdAt: now,
      createdBy: userId,
      periodEndDate: input.periodEndDate,
      rows: input.rows,
      portfolioTotals: input.portfolioTotals,
      notes: input.notes,
      companyId: input.companyId,
    };
    void persist([period, ...periods]);
    if (userId) void supabaseWrite('wip_periods', 'insert', toRow(period, userId));
    return period;
  }, [periods, persist, userId]);

  const lockPeriod = useCallback((id: string): boolean => {
    const target = periods.find((p) => p.id === id);
    if (!target || target.lockedAt) return false;
    const lockedAt = new Date().toISOString();
    void persist(periods.map((p) => (p.id === id ? { ...p, lockedAt } : p)));
    if (userId) void supabaseWrite('wip_periods', 'update', { id, locked_at: lockedAt });
    return true;
  }, [periods, persist, userId]);

  const updatePeriod = useCallback((
    id: string,
    updates: Partial<Pick<WipPeriod, 'rows' | 'portfolioTotals' | 'notes'>>,
  ): boolean => {
    const target = periods.find((p) => p.id === id);
    if (!target) return false;
    if (assertPeriodEditable(target).blocked) return false; // locked → immutable
    const merged: WipPeriod = { ...target, ...updates };
    void persist(periods.map((p) => (p.id === id ? merged : p)));
    if (userId) {
      void supabaseWrite('wip_periods', 'update', {
        id,
        rows: merged.rows,
        portfolio_totals: merged.portfolioTotals,
        notes: merged.notes ?? null,
      });
    }
    return true;
  }, [periods, persist, userId]);

  return { periods, addPeriod, lockPeriod, updatePeriod };
});
