// hooks/useQboCostLines.ts — react-query read layer over qbo_cost_lines.
//
// F6 (Friday Close campaign). Reads don't queue (useBidResponsesPortfolio
// precedent): the staging table is RLS-scoped to the owner, and the
// reconciler cron is the only writer of new rows. Confirm/reject writes go
// through supabaseWrite in the screen (G3) — this hook only fetches and
// offers an optimistic local patch so the queue UI updates instantly.
//
// 5-min staleTime: the reconciler fires every 30 min; refetch-on-navigate
// beyond that window is plenty fresh.

import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { QboCostLineRow } from '@/utils/qbo/qboCostMap';

const QUERY_KEY_BASE = 'qbo-cost-lines';

/**
 * Standalone count of staged (unconfirmed) lines — the week-close bill leg's
 * "N QBO costs need review" input. Fails soft to 0 (the close never blanks
 * because a count query hiccuped; G4 spirit).
 */
export async function fetchQboPendingCount(): Promise<number> {
  try {
    const { count, error } = await supabase
      .from('qbo_cost_lines')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'staged');
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

export function useQboCostLines() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => [QUERY_KEY_BASE, user?.id ?? 'anon'] as const, [user?.id]);

  const { data: lines = [], isLoading, refetch } = useQuery({
    queryKey,
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<QboCostLineRow[]> => {
      // staged = the confirm queue; confirmed = the re-materialization sweep's
      // input (post-cache-wipe recovery). Rejected rows never resurface (G11).
      const { data, error } = await supabase
        .from('qbo_cost_lines')
        .select('*')
        .in('status', ['staged', 'confirmed'])
        .order('txn_date', { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as QboCostLineRow[];
    },
  });

  const stagedLines = useMemo(() => lines.filter(l => l.status === 'staged'), [lines]);
  const confirmedLines = useMemo(() => lines.filter(l => l.status === 'confirmed'), [lines]);

  /** Optimistic local patch after a confirm/reject supabaseWrite — keeps the
   *  queue snappy without waiting on the offline queue's round-trip. */
  const patchLine = useCallback((id: string, patch: Partial<QboCostLineRow>) => {
    queryClient.setQueryData<QboCostLineRow[]>(queryKey, prev =>
      (prev ?? []).map(l => (l.id === id ? { ...l, ...patch } : l)),
    );
  }, [queryClient, queryKey]);

  return {
    lines,
    stagedLines,
    confirmedLines,
    pendingCount: stagedLines.length,
    isLoading,
    refetch,
    patchLine,
  };
}
