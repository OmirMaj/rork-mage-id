// hooks/useBidResponsesPortfolio.ts — fetch the GC's own bid_responses rows
//
// Used by:
//   - Wave 3 portfolio pipeline engine (pass to buildPipelineHorizon)
//   - Wave 2 grading (useBrainGrading → gradeInstantBid — the gap from Wave 2)
//
// Selects all columns needed for: pipeline (estimateAmount, status),
// gradeInstantBid (id, status), and bidHistoryFacts (bid_amount, status).
//
// 5-minute stale time (plan spec). Engines stay pure; this hook feeds them.

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { HomeownerBidResponse } from '@/types';

export function useBidResponsesPortfolio(): {
  bidResponses: HomeownerBidResponse[];
  isLoading: boolean;
} {
  const { user } = useAuth();

  const { data, isLoading } = useQuery<HomeownerBidResponse[]>({
    queryKey: ['bid-responses-portfolio', user?.id],
    enabled: !!user?.id && isSupabaseConfigured,
    staleTime: 5 * 60 * 1000, // 5 minutes
    queryFn: async () => {
      if (!user?.id) return [];
      // Column names on the bid_responses table (verified from submit-bid-response.tsx):
      // user_id, bid_id, proposer_company_id, company_name, proposer_email,
      // proposer_phone, bid_amount, estimate_summary, scope_description,
      // view_site_requested, status
      // Note: 'estimate_amount' maps to 'bid_amount' on the table.
      const { data, error } = await supabase
        .from('bid_responses')
        .select('id,bid_id,user_id,proposer_company_id,company_name,proposer_email,proposer_phone,bid_amount,estimate_summary,scope_description,view_site_requested,status,created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (error) {
        console.warn('[BidResponsesPortfolio] fetch failed:', error.message);
        return [];
      }
      // Map to HomeownerBidResponse shape (camelCase)
      const rows = (data ?? []) as Record<string, unknown>[];
      return rows.map(r => ({
        id: r.id as string,
        bidId: r.bid_id as string,
        proposerUserId: r.user_id as string,
        proposerCompanyId: (r.proposer_company_id as string | null) ?? undefined,
        proposerName: (r.company_name as string | null) ?? '',
        proposerEmail: (r.proposer_email as string | null) ?? undefined,
        proposerPhone: (r.proposer_phone as string | null) ?? undefined,
        // Table uses bid_amount; map to estimateAmount for HomeownerBidResponse
        estimateAmount: (r.bid_amount as number | null) ?? 0,
        estimateSummary: (r.estimate_summary as string | null) ?? undefined,
        message: (r.scope_description as string | null) ?? undefined,
        viewSiteRequested: (r.view_site_requested as boolean | null) ?? false,
        status: r.status as HomeownerBidResponse['status'],
        submittedAt: (r.created_at as string) ?? new Date().toISOString(),
        respondedAt: undefined,
        awardedProjectId: undefined,
      })) as HomeownerBidResponse[];
    },
  });

  return { bidResponses: data ?? [], isLoading };
}
