// useUsageStatus — query the user's monthly AI quota usage.
//
// Backed by the `usage-status` Supabase edge function. Returns the
// tier-aware quota state for every metered feature so the upload UI can
// render a "X of Y pages remaining this month" indicator BEFORE the
// user picks a file.
//
// Refetches on:
//   - Mount (with a 60s stale-time so a screen revisit doesn't hammer
//     the function unnecessarily)
//   - On manual `refresh()` call — used after a successful takeoff so
//     the next upload sees the updated remaining count without a screen
//     remount.
//
// Why a dedicated hook instead of a one-off fetch in each screen:
//   1. Both Plans and Takeoff upload surfaces need the same data.
//   2. React Query gives us free dedup + cache invalidation.
//   3. Settings → AI Usage panel can subscribe to the same key.

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useSubscription } from '@/contexts/SubscriptionContext';

export type Tier = 'free' | 'pro' | 'business' | 'enterprise';

/**
 * Client-side fallback for the monthly takeoff-page cap, mirroring
 * `MONTHLY_CAPS.*.takeoff_pages` in `supabase/functions/_shared/auth.ts`.
 * Keep these IN SYNC with the server table.
 *
 * Used when the server `usage-status` fetch is unavailable (no session,
 * offline, or the function errors). Without this, a paying customer would
 * see "0 of 0 pages" — falsely implying they have no takeoff allowance —
 * because the server-only cap defaults to 0. The daily AI counter already
 * derives its cap client-side from tier; this brings takeoff in line.
 */
export const TAKEOFF_PAGES_CAP_BY_TIER: Record<Tier, number> = {
  free: 0,
  pro: 30,
  business: 100,
  enterprise: 300,
};

export interface FeatureUsage {
  used: number;
  cap: number;
  remaining: number;
}

export interface UsageStatus {
  tier: Tier;
  features: Record<string, FeatureUsage>;
}

const QUERY_KEY = ['ai-usage-status'] as const;

async function fetchUsageStatus(): Promise<UsageStatus | null> {
  if (!isSupabaseConfigured) return null;
  const { data: session } = await supabase.auth.getSession();
  if (!session.session) return null;
  const { data, error } = await supabase.functions.invoke<UsageStatus>('usage-status', {
    method: 'POST',
  });
  if (error || !data) {
    console.log('[useUsageStatus] fetch failed:', error?.message);
    return null;
  }
  return data;
}

export function useUsageStatus() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchUsageStatus,
    // 60s stale — quota doesn't change often enough to warrant aggressive
    // refetch, and we manually invalidate after a takeoff success below.
    staleTime: 60_000,
    // Background refetch on focus so a long-idle tab gets a fresh number
    // when the user comes back. React Query's default does this; we keep
    // it explicit for documentation.
    refetchOnWindowFocus: true,
  });

  /** Force refetch — call this after a takeoff/render succeeds so the
   *  next upload screen sees the freshly-charged usage. */
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  }, [queryClient]);

  return {
    status: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    refresh,
  };
}

/**
 * Convenience hook for the takeoff pages quota specifically — the most
 * common consumer. Encapsulates the lookup so screens don't duplicate
 * the `status?.features?.takeoff_pages ?? null` boilerplate.
 */
export function useTakeoffPagesQuota(): {
  used: number;
  cap: number;
  remaining: number;
  tier: Tier | null;
  isLoading: boolean;
  refresh: () => void;
} {
  const { status, isLoading, refresh } = useUsageStatus();
  const { tier: clientTier } = useSubscription();
  const tp = status?.features?.takeoff_pages;

  // Prefer authoritative server numbers when available. Otherwise fall back
  // to the tier-derived cap so a paying customer never sees a misleading
  // "0 of 0 pages" when the usage-status fetch is unavailable.
  const fallbackTier: Tier | null =
    clientTier && clientTier in TAKEOFF_PAGES_CAP_BY_TIER ? (clientTier as Tier) : null;
  const fallbackCap = fallbackTier ? TAKEOFF_PAGES_CAP_BY_TIER[fallbackTier] : 0;

  const cap = tp?.cap ?? fallbackCap;
  const used = tp?.used ?? 0;
  return {
    used,
    cap,
    remaining: tp?.remaining ?? Math.max(cap - used, 0),
    tier: status?.tier ?? fallbackTier,
    isLoading,
    refresh,
  };
}
