// useCostSeeds — local-first store for the contractor's SEEDED rates.
//
// A seed is a rate the contractor stated (pasted from a spreadsheet or typed
// on app/cost-seed) before they had closed-job history inside MAGE. It flows
// into utils/costDatabase as a quantity-1, `seed:`-prefixed CostSample so the
// estimate wizard has something real to price from on day one — see
// utils/costSeedCore for why that keeps "you told me" separate from
// "I watched this happen".
//
// Storage mirrors hooks/useMaterialReceipts exactly: AsyncStorage under the
// `mageid_cost_seeds` key (registered in LOCAL_USER_CACHE_KEYS in
// contexts/AuthContext.tsx, so it wipes on tenant switch), shared across
// screens via the react-query cache. Deliberately local-only for now — there
// is no `cost_seeds` table in Supabase, and queueing writes at a table that
// doesn't exist would silently rot in the offline queue. Cloud mirror is a
// follow-up (same shape as hooks/useRateOverrides).

import { useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  mergeSeeds,
  type SeededRate,
  type SeedMergeResult,
} from '@/utils/costSeedCore';

const SEEDS_KEY = 'mageid_cost_seeds';
const QUERY_KEY = ['cost-seeds'] as const;

async function load(): Promise<SeededRate[]> {
  try {
    const raw = await AsyncStorage.getItem(SEEDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive: a hand-edited / half-written cache must not poison the book
    // with NaN rates. Anything without a usable trade+unit+rate is dropped.
    return (parsed as SeededRate[]).filter(
      s => s && typeof s.trade === 'string' && typeof s.unit === 'string' &&
        Number.isFinite(s.rate) && s.rate > 0,
    );
  } catch {
    return [];
  }
}

async function persist(seeds: SeededRate[]): Promise<void> {
  try {
    await AsyncStorage.setItem(SEEDS_KEY, JSON.stringify(seeds));
  } catch (err) {
    console.log('[costSeeds] persist failed:', err);
  }
}

export function useCostSeeds() {
  const queryClient = useQueryClient();

  const { data: seeds = [], isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: load,
    staleTime: Infinity,
  });

  const save = useMutation({
    mutationFn: async (next: SeededRate[]) => { await persist(next); return next; },
    onSuccess: (next) => { queryClient.setQueryData(QUERY_KEY, next); },
  });

  // Read through the cache, not the render-time snapshot — looping mutations
  // otherwise clobber each other (same reason useMaterialReceipts does it).
  const current = useCallback(
    () => (queryClient.getQueryData<SeededRate[]>(QUERY_KEY) ?? seeds),
    [queryClient, seeds],
  );

  /** Commit a parsed batch. Same trade+unit merges into one row (incoming
   *  wins), so re-importing an updated spreadsheet corrects rather than
   *  duplicates. Returns the merge counts for the confirmation copy. */
  const addSeeds = useCallback((incoming: SeededRate[]): SeedMergeResult => {
    const result = mergeSeeds(current(), incoming);
    if (incoming.length > 0) save.mutate(result.merged);
    return result;
  }, [save, current]);

  const deleteSeed = useCallback((id: string) => {
    save.mutate(current().filter(s => s.id !== id));
  }, [save, current]);

  // Edits go through addSeeds: seed ids are deterministic from trade+unit, so
  // re-adding an edited row merges over the old one. A trade/unit RENAME moves
  // the id, which is why app/cost-seed deletes the old row on that path.
  return { seeds, isLoading, addSeeds, deleteSeed };
}

export default useCostSeeds;
