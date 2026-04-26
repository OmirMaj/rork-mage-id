import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
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

export function usePortalBudgetProposals(projectId: string | undefined) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['portalBudgetProposals', projectId],
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
      return ((data ?? []) as ProposalRow[]).map(rowToProposal);
    },
    refetchInterval: 60_000,                  // poll every minute while screen is open
    refetchOnWindowFocus: true,
  });

  const respondMutation = useMutation({
    mutationFn: async (args: { id: string; status: 'accepted' | 'declined' }) => {
      const { error } = await supabase
        .from('portal_budget_proposals')
        .update({
          status: args.status,
          responded_at: new Date().toISOString(),
        })
        .eq('id', args.id);
      if (error) throw error;
      return args;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['portalBudgetProposals', projectId] });
    },
  });

  const accept = useCallback(
    (id: string) => respondMutation.mutate({ id, status: 'accepted' }),
    [respondMutation],
  );
  const decline = useCallback(
    (id: string) => respondMutation.mutate({ id, status: 'declined' }),
    [respondMutation],
  );

  useEffect(() => {
    if (!projectId || !isSupabaseConfigured) return;
    const channel = supabase
      .channel(`portal-budget-${projectId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'portal_budget_proposals', filter: `project_id=eq.${projectId}` },
        () => { void queryClient.invalidateQueries({ queryKey: ['portalBudgetProposals', projectId] }); },
      )
      .subscribe();
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
