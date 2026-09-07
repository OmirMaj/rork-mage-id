import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { supabaseWriteDetailed, onQueueFlushed, getOfflineQueue } from '@/utils/offlineQueue';
import { oops } from '@/components/animations/NailItToast';
import type { PortalBudgetProposal } from '@/types';

// Loads + manages portal_budget_proposals for a single project. RLS on the
// table restricts these reads to the GC who owns the project, so we don't
// have to filter by user_id ourselves.

interface ProposalRow {
  id: string;
  portal_id: string;
  project_id: string | null;
  invite_id: string | null;
  amount: number | string;
  note: string | null;
  proposer_name: string | null;
  proposer_email: string | null;
  status: 'pending' | 'accepted' | 'declined';
  created_at: string;
  responded_at: string | null;
}

function rowToProposal(r: ProposalRow): PortalBudgetProposal {
  return {
    id: r.id,
    portalId: r.portal_id,
    projectId: r.project_id ?? undefined,
    inviteId: r.invite_id ?? undefined,
    amount: typeof r.amount === 'string' ? parseFloat(r.amount) : r.amount,
    note: r.note ?? undefined,
    proposerName: r.proposer_name ?? undefined,
    proposerEmail: r.proposer_email ?? undefined,
    status: r.status,
    createdAt: r.created_at,
    respondedAt: r.responded_at ?? undefined,
  };
}

type ProposalResponse = { status: 'accepted' | 'declined'; respondedAt: string };

function isResponseStatus(v: unknown): v is ProposalResponse['status'] {
  return v === 'accepted' || v === 'declined';
}

// A8: responses the server has not seen yet, read from the PERSISTED offline
// queue so they survive an unmount. Until the flush lands, the server still
// says 'pending' — and this query refetches on focus and every minute, so
// without this overlay the optimistic accept/decline was overwritten by the
// stale row and the proposal popped back into the pending list.
async function queuedResponses(): Promise<Map<string, ProposalResponse>> {
  const out = new Map<string, ProposalResponse>();
  try {
    for (const m of await getOfflineQueue()) {
      if (m.table !== 'portal_budget_proposals' || m.operation !== 'update') continue;
      const d = m.data ?? {};
      if (typeof d.id !== 'string' || !isResponseStatus(d.status)) continue;
      out.set(d.id, {
        status: d.status,
        respondedAt: typeof d.responded_at === 'string' ? d.responded_at : new Date(m.timestamp).toISOString(),
      });
    }
  } catch { /* unreadable queue — show the server's view */ }
  return out;
}

function applyResponses(rows: PortalBudgetProposal[], overlay: Map<string, ProposalResponse>): PortalBudgetProposal[] {
  if (overlay.size === 0) return rows;
  return rows.map((p) => {
    const r = overlay.get(p.id);
    return r ? { ...p, status: r.status, respondedAt: r.respondedAt } : p;
  });
}

export function usePortalBudgetProposals(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ['portalBudgetProposals', projectId] as const;

  // Responses whose write is still IN FLIGHT (mutate → settled). The queue
  // overlay above only covers a write once it has been queued; a focus refetch
  // that lands in the few hundred ms before that would still revert the row.
  const inFlight = useRef(new Map<string, ProposalResponse>());

  const query = useQuery({
    queryKey,
    enabled: !!projectId && isSupabaseConfigured,
    queryFn: async (): Promise<PortalBudgetProposal[]> => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('portal_budget_proposals')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      if (error) {
        console.log('[usePortalBudgetProposals] fetch failed:', error.message);
        return [];
      }
      const rows = ((data ?? []) as ProposalRow[]).map(rowToProposal);
      // A8: a queued-but-unflushed (or still in-flight) response wins over the
      // server's stale 'pending' until the flush lands (onQueueFlushed below
      // refetches once it has).
      const overlay = await queuedResponses();
      for (const [id, r] of inFlight.current) overlay.set(id, r);
      return applyResponses(rows, overlay);
    },
    refetchInterval: 60_000,                  // poll every minute while screen is open
    refetchOnWindowFocus: true,
  });

  // SYNC-F8 (same class as the portal thread): accept/decline was a direct
  // update with no error path — offline, the tap did nothing and said nothing.
  // Now: optimistic status, the write through the offline queue, and on a lost
  // write the row reverts and the user is told.
  const respondMutation = useMutation({
    mutationFn: async (args: { id: string; status: 'accepted' | 'declined'; respondedAt: string }) => {
      const outcome = await supabaseWriteDetailed('portal_budget_proposals', 'update', {
        id: args.id,
        status: args.status,
        responded_at: args.respondedAt,
      });
      if (outcome === 'failed') throw new Error('Could not record the response');
      return { ...args, outcome };
    },
    onMutate: async (args) => {
      await queryClient.cancelQueries({ queryKey });
      inFlight.current.set(args.id, { status: args.status, respondedAt: args.respondedAt });
      const previous = queryClient.getQueryData<PortalBudgetProposal[]>(queryKey);
      if (previous) {
        queryClient.setQueryData<PortalBudgetProposal[]>(queryKey, previous.map((p) => (p.id === args.id
          ? { ...p, status: args.status, respondedAt: args.respondedAt }
          : p)));
      }
      return { previous };
    },
    onError: (_err, args, ctx) => {
      inFlight.current.delete(args.id);
      // A8: put back exactly what was there. When the cache held nothing
      // (`previous` undefined) there is nothing to restore INTO — reset the
      // query rather than materialise an empty list the server never sent.
      if (ctx?.previous) queryClient.setQueryData(queryKey, ctx.previous);
      else void queryClient.resetQueries({ queryKey, exact: true });
      oops(`Couldn't ${args.status === 'accepted' ? 'accept' : 'decline'} that proposal — check your connection and try again.`);
    },
    onSuccess: (res) => {
      // 'queued': the persisted queue now carries the response, so the overlay
      // in queryFn takes over from the in-flight map. 'synced': the server has
      // it — refetch.
      inFlight.current.delete(res.id);
      if (res.outcome === 'synced') {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });

  // A queued response just landed in a flush — pull the server's copy.
  useEffect(() => {
    if (!projectId || !isSupabaseConfigured) return;
    return onQueueFlushed((tables) => {
      if (tables.has('portal_budget_proposals')) {
        void queryClient.invalidateQueries({ queryKey: ['portalBudgetProposals', projectId] });
      }
    });
  }, [projectId, queryClient]);

  const accept = useCallback(
    (id: string) => respondMutation.mutate({ id, status: 'accepted', respondedAt: new Date().toISOString() }),
    [respondMutation],
  );
  const decline = useCallback(
    (id: string) => respondMutation.mutate({ id, status: 'declined', respondedAt: new Date().toISOString() }),
    [respondMutation],
  );

  useEffect(() => {
    if (!projectId || !isSupabaseConfigured) return;
    const channelName = `portal-budget-${projectId}`;
    const existing = supabase.getChannels().find(c => c.topic === `realtime:${channelName}`);
    if (existing) return;

    const channel = supabase.channel(channelName);
    channel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'portal_budget_proposals', filter: `project_id=eq.${projectId}` },
      () => { void queryClient.invalidateQueries({ queryKey: ['portalBudgetProposals', projectId] }); },
    );
    channel.subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [projectId, queryClient]);

  return {
    proposals: query.data ?? [],
    pending: (query.data ?? []).filter(p => p.status === 'pending'),
    isLoading: query.isLoading,
    refetch: query.refetch,
    accept,
    decline,
    isResponding: respondMutation.isPending,
  };
}
