// useAccountSeats — how many paid seats this account occupies, across ALL
// projects.
//
// Seats are per ACCOUNT, not per project (utils/seatModel): one person invited
// to six jobs is one seat. So this deliberately does NOT reuse
// useProjectCollaborators, which is scoped to a single project — summing that
// per project would bill a GC six times for one PM.
//
// SCOPING IS EXPLICIT HERE, NOT RLS. The comment that used to sit in this spot
// claimed the opposite — that `pc_owner_all` was the only policy on
// project_collaborators, so an unfiltered select already returned exactly this
// account's rows. That was false. The table also carries `pc_invitee_read`
// (`user_id = auth.uid() OR lower(invited_email) = lower(auth.jwt()->>'email')`),
// and PERMISSIVE policies OR together, so an unfiltered select ALSO returned
// every invite anyone else had ever sent to the caller's own email address.
// countSeats only drops 'revoked' and 'owner', so a foreign editor/viewer row
// was counted as a billable admin seat under the caller's own address: a fresh
// Pro account that had been invited to somebody else's job opened the team
// screen reading "1/2 team seats used" and could be told the next invite bills
// $15/mo before it had invited anyone — a charge the server would never apply.
// Constraining on the caller's own project ids mirrors seatCheck() in
// supabase/functions/project-invite/index.ts, so client and server compute the
// same number. Pinned by scripts/validate-account-seats-scoping.ts.
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
      if (!userId) return [];

      // Seats are billed to the project OWNER, so the caller's own projects are
      // the entire scope. Fetched first, and applied as an explicit filter
      // below, because RLS cannot supply this scope — see the header.
      const { data: owned, error: ownedError } = await supabase
        .from('projects')
        .select('id')
        .eq('user_id', userId);
      if (ownedError) {
        console.log('[useAccountSeats] owned-project fetch failed:', ownedError.message);
        return [];
      }
      const ownedIds = ((owned ?? []) as { id: string }[]).map(p => p.id);
      // Own no projects, own no collaborators. Returning early also avoids
      // sending `project_id=in.()`, an empty IN list.
      if (ownedIds.length === 0) return [];

      const { data, error } = await supabase
        .from('project_collaborators')
        .select('invited_email, role, status')
        .in('project_id', ownedIds);
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
