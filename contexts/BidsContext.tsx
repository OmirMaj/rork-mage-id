import { useState, useEffect, useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import createContextHook from '@nkzw/create-context-hook';
import type { PublicBid, CertificationType, BidType, BidCategory } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { supabaseWrite } from '@/utils/offlineQueue';

const BIDS_KEY = 'mageid_public_bids';

export const [BidsProvider, useBids] = createContextHook(() => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const isGuest = user?.isGuest ?? true;
  const canSync = !isGuest && !!userId && isSupabaseConfigured;
  const [bids, setBids] = useState<PublicBid[]>([]);

  const bidsQuery = useQuery({
    queryKey: ['public_bids'],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase
            .from('public_bids')
            .select('*')
            .order('fetched_at', { ascending: false });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, title: r.title as string,
              issuingAgency: (r.issuing_agency as string) ?? '', city: (r.city as string) ?? '',
              state: (r.state as string) ?? '', category: (r.category as BidCategory) ?? 'construction',
              bidType: (r.bid_type as BidType) ?? 'state', estimatedValue: Number(r.estimated_value) || 0,
              bondRequired: Number(r.bond_required) || 0, deadline: r.deadline as string,
              description: (r.description as string) ?? '', postedBy: (r.posted_by as string) ?? '',
              postedDate: r.posted_date as string, status: (r.status as PublicBid['status']) ?? 'open',
              requiredCertifications: (r.required_certifications as CertificationType[]) ?? [],
              contactEmail: (r.contact_email as string) ?? '', applyUrl: r.apply_url as string | undefined,
              sourceUrl: r.source_url as string | undefined, sourceName: r.source_name as string | undefined,
            })) as PublicBid[];
            await AsyncStorage.setItem(BIDS_KEY, JSON.stringify(mapped));
            return mapped;
          }
          if (error) console.log('[BidsContext] Supabase query error:', error.message);
        } catch (err) {
          console.log('[BidsContext] Supabase fetch failed (network):', err);
        }
      }
      const stored = await AsyncStorage.getItem(BIDS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as PublicBid[];
        if (parsed.length > 0) return parsed;
      }
      return [];
    },
  });

  useEffect(() => { if (bidsQuery.data) setBids(bidsQuery.data); }, [bidsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async (updated: PublicBid[]) => { await AsyncStorage.setItem(BIDS_KEY, JSON.stringify(updated)); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['public_bids'], data); },
  });

  const addBid = useCallback((bid: PublicBid) => {
    const updated = [bid, ...bids];
    setBids(updated);
    saveMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('public_bids', 'insert', {
        id: bid.id, user_id: userId, title: bid.title, issuing_agency: bid.issuingAgency,
        city: bid.city, state: bid.state, category: bid.category, bid_type: bid.bidType,
        estimated_value: bid.estimatedValue, bond_required: bid.bondRequired, deadline: bid.deadline,
        description: bid.description, posted_by: bid.postedBy, posted_date: bid.postedDate,
        status: bid.status, required_certifications: bid.requiredCertifications,
        contact_email: bid.contactEmail, apply_url: bid.applyUrl,
        source_url: bid.sourceUrl, source_name: bid.sourceName,
      });
    }
  }, [bids, saveMutation, canSync, userId]);

  const updateBid = useCallback((id: string, changes: Partial<PublicBid>) => {
    const updated = bids.map(b => b.id === id ? { ...b, ...changes } : b);
    setBids(updated);
    saveMutation.mutate(updated);
  }, [bids, saveMutation]);

  const deleteBid = useCallback((id: string) => {
    const updated = bids.filter(b => b.id !== id);
    setBids(updated);
    saveMutation.mutate(updated);
    if (canSync) void supabaseWrite('public_bids', 'delete', { id });
  }, [bids, saveMutation, canSync]);

  return useMemo(() => ({
    bids, addBid, updateBid, deleteBid, isLoading: bidsQuery.isLoading,
  }), [bids, addBid, updateBid, deleteBid, bidsQuery.isLoading]);
});

export function useFilteredBids(filters: {
  search?: string; state?: string; category?: BidCategory; bidType?: BidType; certification?: CertificationType;
}) {
  const { bids } = useBids();
  return useMemo(() => {
    let filtered = [...bids];
    if (filters.search) {
      const q = filters.search.toLowerCase();
      filtered = filtered.filter(b => b.title.toLowerCase().includes(q) || b.city.toLowerCase().includes(q) || b.issuingAgency.toLowerCase().includes(q));
    }
    if (filters.state) filtered = filtered.filter(b => b.state === filters.state);
    if (filters.category) filtered = filtered.filter(b => b.category === filters.category);
    if (filters.bidType) filtered = filtered.filter(b => b.bidType === filters.bidType);
    if (filters.certification) filtered = filtered.filter(b => b.requiredCertifications.includes(filters.certification!));
    return filtered;
  }, [bids, filters.search, filters.state, filters.category, filters.bidType, filters.certification]);
}
