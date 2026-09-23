import { useState, useEffect, useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import createContextHook from '@nkzw/create-context-hook';
import type { PublicBid, CertificationType, BidType, BidCategory } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { supabaseWrite } from '@/utils/offlineQueue';
import { RFP_BROWSE_ENABLED } from '@/constants/featureFlags';

const BIDS_KEY = 'mageid_public_bids';
/** Set once the pre-wave-5 cache (which could hold homeowner RFPs with their
 *  email and street address) has been purged on this device. */
const BIDS_CACHE_PURGED_KEY = 'mageid_public_bids_w5_purged';

// ── What the bid feed may read (audit wave 5, #13/#86) ───────────────────────
// Every column other accounts are allowed to see. NEVER select('*'): since
// 20260923101000 address_line, latitude, longitude, contact_email and
// posted_by are revoked from the client roles, and Postgres refuses a whole
// query that names one of them — the feed would go blank. The Posted by /
// Email of a non-homeowner post comes from get_bid_contacts (20260923100000),
// which never hands out a homeowner's.
export const PUBLIC_BID_FEED_COLUMNS =
  'id,user_id,title,issuing_agency,city,state,category,bid_type,estimated_value,bond_required,deadline,description,posted_date,status,required_certifications,apply_url,source_url,source_name,created_at,is_homeowner_rfp,budget_min,budget_max';

/** Homeowner RFPs stay out of this feed while contractors can't browse them
 *  (RFP_BROWSE_ENABLED, App Store 1.2): the homeowner is told only alerted
 *  contractors see her post, and this feed backs Pre-priced Bids, bid-detail
 *  and company-detail. The column defaults to false but older rows can be
 *  NULL, so the PostgREST filter is null-OR-false, never a bare eq(false). */
export const NON_HOMEOWNER_FILTER = 'is_homeowner_rfp.is.null,is_homeowner_rfp.eq.false';

/** True when a feed row may be shown on this build. Applied to the server
 *  rows AND the device cache, so a regressed query filter or a cache written
 *  by an older build can't put a homeowner's post back on screen. */
export function feedRowAllowed(b: Pick<PublicBid, 'isHomeownerRfp'>, browseEnabled: boolean = RFP_BROWSE_ENABLED): boolean {
  return browseEnabled || b.isHomeownerRfp !== true;
}

/** public_bids row → PublicBid. Contact fields are filled separately (and
 *  only for rows get_bid_contacts returns). */
export function mapPublicBidRow(
  r: Record<string, unknown>,
  contact?: { postedBy: string; contactEmail: string },
): PublicBid {
  const num = (v: unknown) => (v === null || v === undefined || v === '' ? undefined : Number(v));
  return {
    id: r.id as string, title: r.title as string,
    issuingAgency: (r.issuing_agency as string) ?? '', city: (r.city as string) ?? '',
    state: (r.state as string) ?? '', category: (r.category as BidCategory) ?? 'construction',
    bidType: (r.bid_type as BidType) ?? 'state', estimatedValue: Number(r.estimated_value) || 0,
    bondRequired: Number(r.bond_required) || 0, deadline: r.deadline as string,
    description: (r.description as string) ?? '',
    postedBy: contact?.postedBy ?? '',
    userId: (r.user_id as string | null) ?? undefined,
    postedDate: r.posted_date as string, status: (r.status as PublicBid['status']) ?? 'open',
    requiredCertifications: (r.required_certifications as CertificationType[]) ?? [],
    contactEmail: contact?.contactEmail ?? '',
    applyUrl: (r.apply_url as string | null) ?? undefined,
    sourceUrl: (r.source_url as string | null) ?? undefined, sourceName: (r.source_name as string | null) ?? undefined,
    isHomeownerRfp: r.is_homeowner_rfp === true,
    budgetMin: Number.isFinite(num(r.budget_min)) ? num(r.budget_min) : undefined,
    budgetMax: Number.isFinite(num(r.budget_max)) ? num(r.budget_max) : undefined,
  };
}

/** Exported for scripts/validate-w5-rfp-marketplace-feed.ts. */
export async function readCachedBids(): Promise<PublicBid[]> {
  try {
    // One-time purge: a cache written before wave 5 may hold homeowner RFPs
    // (email, street address) from the old select('*').
    if ((await AsyncStorage.getItem(BIDS_CACHE_PURGED_KEY)) !== '1') {
      await AsyncStorage.removeItem(BIDS_KEY);
      await AsyncStorage.setItem(BIDS_CACHE_PURGED_KEY, '1');
      return [];
    }
    const stored = await AsyncStorage.getItem(BIDS_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as PublicBid[];
    return Array.isArray(parsed) ? parsed.filter(b => feedRowAllowed(b)) : [];
  } catch {
    return [];
  }
}

async function writeCachedBids(bids: PublicBid[]): Promise<void> {
  try {
    await AsyncStorage.setItem(BIDS_KEY, JSON.stringify(bids.filter(b => feedRowAllowed(b))));
    // What is on disk now was written by this build: nothing left to purge.
    await AsyncStorage.setItem(BIDS_CACHE_PURGED_KEY, '1');
  } catch (err) {
    console.log('[BidsContext] cache write failed:', err);
  }
}

export const [BidsProvider, useBids] = createContextHook(() => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const canSync = !!userId && isSupabaseConfigured;
  const [bids, setBids] = useState<PublicBid[]>([]);

  const bidsQuery = useQuery({
    queryKey: ['public_bids'],
    queryFn: async () => {
      if (canSync) {
        try {
          let q = supabase
            .from('public_bids')
            .select(PUBLIC_BID_FEED_COLUMNS);
          if (!RFP_BROWSE_ENABLED) q = q.or(NON_HOMEOWNER_FILTER);
          const { data, error } = await q
            // `fetched_at` DOES NOT EXIST on public_bids (verified against
            // production: the table has created_at, posted_date and awarded_at).
            // PostgREST answers an unknown order column with 42703/400, so
            // `data` was null on EVERY server read, the `data.length > 0` guard
            // below skipped the mapper and the AsyncStorage write, and the query
            // fell through to a local cache that a fresh install has never
            // populated. The marketplace feed was permanently empty, and the
            // only trace was a console.log.
            .order('created_at', { ascending: false });
          if (!error && data && data.length > 0) {
            const rows = (data as unknown as Record<string, unknown>[])
              .filter(r => feedRowAllowed({ isHomeownerRfp: r.is_homeowner_rfp === true }));
            // Posted by / Email for the rows that may be contacted. A failure
            // here leaves them blank rather than failing the feed.
            const contacts = new Map<string, { postedBy: string; contactEmail: string }>();
            if (rows.length > 0) {
              const { data: cData, error: cErr } = await supabase.rpc('get_bid_contacts', {
                p_bid_ids: rows.map(r => r.id as string),
              });
              if (cErr) console.log('[BidsContext] contact read failed:', cErr.message);
              for (const c of ((cData ?? []) as { id: string; posted_by: string | null; contact_email: string | null }[])) {
                contacts.set(c.id, { postedBy: c.posted_by ?? '', contactEmail: c.contact_email ?? '' });
              }
            }
            const mapped = rows.map(r => mapPublicBidRow(r, contacts.get(r.id as string)));
            await writeCachedBids(mapped);
            return mapped;
          }
          if (error) console.log('[BidsContext] Supabase query error:', error.message);
        } catch (err) {
          console.log('[BidsContext] Supabase fetch failed (network):', err);
        }
      }
      return readCachedBids();
    },
  });

  useEffect(() => { if (bidsQuery.data) setBids(bidsQuery.data); }, [bidsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async (updated: PublicBid[]) => { await writeCachedBids(updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['public_bids'], data); },
  });

  const addBid = useCallback((bid: PublicBid) => {
    // Stamp the poster's real auth id on the local object so quota counting
    // ("my posts this month") attributes on user_id — never on a display
    // string like the old 'You' literal, which every app-posted row in the
    // SHARED feed carried.
    const stamped: PublicBid = bid.userId ? bid : { ...bid, userId: userId ?? undefined };
    // This feed never carries a homeowner RFP while browsing is off (#13):
    // homeowner posts go through post-rfp, not here.
    if (!feedRowAllowed(stamped)) return;
    const updated = [stamped, ...bids];
    setBids(updated);
    saveMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('public_bids', 'insert', {
        id: stamped.id, user_id: stamped.userId ?? userId, title: stamped.title, issuing_agency: stamped.issuingAgency,
        city: stamped.city, state: stamped.state, category: stamped.category, bid_type: stamped.bidType,
        estimated_value: stamped.estimatedValue, bond_required: stamped.bondRequired, deadline: stamped.deadline,
        description: stamped.description, posted_by: stamped.postedBy, posted_date: stamped.postedDate,
        status: stamped.status, required_certifications: stamped.requiredCertifications,
        contact_email: stamped.contactEmail, apply_url: stamped.applyUrl,
        source_url: stamped.sourceUrl, source_name: stamped.sourceName,
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
