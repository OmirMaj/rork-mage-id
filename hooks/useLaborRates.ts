// useLaborRates — the GC's loaded labor rates, per trade.
//
// The one missing piece between crew time tracking and the cost book: hours
// are measured, but no pay rate exists anywhere in the data model (verified
// 2026-07 — not on TimeEntry, not on CrewMember, not in the Supabase
// schema). The GC knows their loaded rate (wages + burden) — they write the
// paychecks — so this store captures it once per trade, locally.
//
// Storage: AsyncStorage `mageid_labor_rates` (registered in
// LOCAL_USER_CACHE_KEYS — contexts/AuthContext.tsx — so it never leaks
// across tenants on shared devices), shared across screens via the
// react-query cache. Same pattern as hooks/useMaterialReceipts.ts.
//
// Also exports useLaborCostSamples(): the read-side bridge that grounding
// screens (estimate wizard, quick estimate, judges, cost database) mount to
// fold self-perform labor into buildCostDatabase's 4th param. It reads the
// time-entry local mirror directly (no notification side effects — mounting
// hooks/useTimeEntries.ts elsewhere would re-schedule shift alerts).

import { useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { TimeEntry } from '@/types';
import type { CostSample } from '@/utils/costDatabase';
import { buildLaborSamples, type LaborRateMap } from '@/utils/laborSamples';
import { TIME_ENTRIES_STORAGE_KEY } from '@/hooks/useTimeEntries';

const RATES_KEY = 'mageid_labor_rates';
const RATES_QUERY = ['labor-rates'] as const;
const ENTRIES_MIRROR_QUERY = ['time-entries-mirror'] as const;

async function loadRates(): Promise<LaborRateMap> {
  try {
    const raw = await AsyncStorage.getItem(RATES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    // Keep only sane numeric rates — a corrupt value must never poison the book.
    const out: LaborRateMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

async function persistRates(rates: LaborRateMap): Promise<void> {
  try {
    await AsyncStorage.setItem(RATES_KEY, JSON.stringify(rates));
  } catch (err) {
    console.log('[laborRates] persist failed:', err);
  }
}

export function useLaborRates() {
  const queryClient = useQueryClient();

  const { data: rates = {}, isLoading } = useQuery({
    queryKey: RATES_QUERY,
    queryFn: loadRates,
  });

  const save = useMutation({
    mutationFn: async (next: LaborRateMap) => { await persistRates(next); return next; },
    onSuccess: (next) => { queryClient.setQueryData(RATES_QUERY, next); },
  });

  const current = useCallback(
    () => (queryClient.getQueryData<LaborRateMap>(RATES_QUERY) ?? rates),
    [queryClient, rates],
  );

  /** Set (rate > 0) or clear (rate null/0) the loaded $/hr for a normalized
   *  trade key (utils/laborSamples.ts normalizeTradeKey). */
  const setRate = useCallback((tradeKey: string, rate: number | null) => {
    const next = { ...current() };
    if (rate !== null && Number.isFinite(rate) && rate > 0) next[tradeKey] = rate;
    else delete next[tradeKey];
    save.mutate(next);
  }, [save, current]);

  return { rates, isLoading, setRate };
}

async function loadEntriesMirror(): Promise<TimeEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(TIME_ENTRIES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TimeEntry[]) : [];
  } catch {
    return [];
  }
}

/**
 * Self-perform labor cost samples for buildCostDatabase's 4th param.
 * Read-only over the time-entry local mirror (kept fresh by the Time
 * Tracking screen / offline sync); re-read on each mounting screen. On a
 * brand-new device the mirror is empty until Time Tracking first syncs —
 * grounding just has no labor facts yet, which is honest.
 */
export function useLaborCostSamples(): CostSample[] {
  const { rates } = useLaborRates();
  const { data: entries = [] } = useQuery({
    queryKey: ENTRIES_MIRROR_QUERY,
    queryFn: loadEntriesMirror,
    refetchOnMount: 'always',
  });
  return useMemo(() => buildLaborSamples(entries, rates), [entries, rates]);
}
