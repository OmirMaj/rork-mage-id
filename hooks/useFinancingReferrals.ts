import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { generateUUID } from '@/utils/generateId';
import type { FinancingReferral, FinancingReferralSource } from '@/types';

interface ReferralRow {
  id: string;
  project_id: string | null;
  gc_user_id: string;
  partner_name: string;
  amount_cents: number;
  status: FinancingReferral['status'];
  source: FinancingReferralSource;
  created_at: string;
  updated_at: string;
}

function rowToReferral(r: ReferralRow): FinancingReferral {
  return {
    id: r.id,
    projectId: r.project_id ?? '',
    gcUserId: r.gc_user_id,
    partnerName: r.partner_name,
    amountCents: r.amount_cents,
    status: r.status,
    source: r.source,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function useFinancingReferrals(gcUserId: string | undefined) {
  const queryClient = useQueryClient();
  const enabled = !!gcUserId && isSupabaseConfigured;

  const referralsQ = useQuery({
    queryKey: ['financingReferrals', gcUserId],
    enabled,
    queryFn: async (): Promise<FinancingReferral[]> => {
      if (!gcUserId) return [];
      const { data, error } = await supabase
        .from('financing_referrals')
        .select('*')
        .eq('gc_user_id', gcUserId)
        .order('created_at', { ascending: false });
      if (error) {
        console.log('[useFinancingReferrals] fetch failed:', error.message);
        return [];
      }
      return ((data ?? []) as ReferralRow[]).map(rowToReferral);
    },
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const ensureReferral = useCallback(
    async (args: {
      projectId: string;
      gcUserId: string;
      source: FinancingReferralSource;
      amountCents: number;
      partnerName: string;
    }): Promise<string> => {
      const existing = (referralsQ.data ?? []).find(
        r => r.projectId === args.projectId && r.source === args.source,
      );
      if (existing) return existing.id;
      const token = `fin_${generateUUID().replace(/-/g, '')}`;
      const now = new Date().toISOString();
      const { error } = await supabase.from('financing_referrals').insert({
        id: token,
        project_id: args.projectId,
        gc_user_id: args.gcUserId,
        partner_name: args.partnerName,
        amount_cents: Math.max(0, Math.round(args.amountCents)),
        status: 'created',
        source: args.source,
        created_at: now,
        updated_at: now,
      });
      if (error) console.log('[useFinancingReferrals] create failed:', error.message);
      void queryClient.invalidateQueries({ queryKey: ['financingReferrals', args.gcUserId] });
      return token;
    },
    [referralsQ.data, queryClient],
  );

  useEffect(() => {
    if (!enabled || !gcUserId) return;
    const channelName = `financing-referrals-${gcUserId}`;
    const existing = supabase.getChannels().find(c => c.topic === `realtime:${channelName}`);
    if (existing) return;
    const channel = supabase.channel(channelName);
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'financing_referrals', filter: `gc_user_id=eq.${gcUserId}` },
      () => { void queryClient.invalidateQueries({ queryKey: ['financingReferrals', gcUserId] }); },
    );
    channel.subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [enabled, gcUserId, queryClient]);

  const referrals = referralsQ.data ?? [];
  return {
    referrals,
    counts: {
      created: referrals.length,
      clicked: referrals.filter(r => r.status !== 'created').length,
      funded: referrals.filter(r => r.status === 'funded').length,
    },
    ensureReferral,
    refetch: referralsQ.refetch,
  };
}
