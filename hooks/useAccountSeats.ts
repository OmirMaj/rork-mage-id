// useAccountSeats — how many paid seats this account occupies, across ALL
// projects.
//
// Seats are per ACCOUNT, not per project (utils/seatModel): one person invited
// to six jobs is one seat. So this deliberately does NOT reuse
// useProjectCollaborators, which is scoped to a single project — summing that
// per project would bill a GC six times for one PM.
//
// RLS does the scoping: `pc_owner_all` on project_collaborators exposes only
// rows for projects the caller owns, so an unfiltered select returns exactly
// this account's collaborators.
//
// Field collaborators are counted for display but never billed — see the
// seatModel header for why that is load-bearing rather than generous.

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import {
  countSeats, seatStatus, previewSeat,
  type SeatOccupant, type SeatTier,
} from '@/utils/seatModel';

interface Row {
  invited_email: string;
  role: string;
  status: string;
}

export function useAccountSeats() {
  const { user } = useAuth();
  const { tier } = useSubscription();
  const userId = user?.id;

  const enabled = isSupabaseConfigured && !!userId;

  const query = useQuery({
    queryKey: ['accountSeats', userId ?? null],
    enabled,
    queryFn: async (): Promise<SeatOccupant[]> => {
      const { data, error } = await supabase
        .from('project_collaborators')
        .select('invited_email, role, status');
      if (error) {
        console.log('[useAccountSeats] fetch failed:', error.message);
        return [];
      }
      return ((data ?? []) as Row[]).map(r => ({
        email: r.invited_email,
        role: r.role,
        status: r.status,
      }));
    },
    staleTime: 60_000,
  });

  const rows = useMemo(() => query.data ?? [], [query.data]);
  const counts = useMemo(() => countSeats(rows), [rows]);
  const status = useMemo(() => seatStatus(tier as SeatTier, counts), [tier, counts]);

  /** What inviting `role` (optionally `email`) would cost — call before sending
   *  so the GC is never surprised by a charge. */
  const preview = useMemo(
    () => (role: string, email?: string) => previewSeat(tier as SeatTier, counts, role, email),
    [tier, counts],
  );

  return {
    counts,
    status,
    preview,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
