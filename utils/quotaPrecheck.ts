// quotaPrecheck — client-side guardrail that asks the user to confirm
// (or upgrade) when an upload would exceed their remaining takeoff
// pages quota for the month.
//
// The edge function enforces the same cap on the server side and is the
// authoritative gate; this helper is purely UX. Without it, a user on
// the Pro plan with 4 pages remaining would upload a 30-page PDF, wait
// 60 seconds for it to render, and then see a 429. With it, they pick
// the file and get an immediate "this won't fit, upgrade?" alert.
//
// Returns:
//   true  — user confirmed (or quota is fine), proceed with upload
//   false — user cancelled or chose to upgrade (don't proceed)

import { Alert, Platform } from 'react-native';
import type { Router } from 'expo-router';
import { supabase } from '@/lib/supabase';

interface UsageResponse {
  tier: string;
  features?: Record<string, { used: number; cap: number; remaining: number }>;
}

/**
 * Read takeoff_pages quota WITHOUT React Query — used from imperative
 * handlers (file pickers, upload buttons) where running a hook isn't
 * an option. Cheap (~80ms) and idempotent.
 */
async function fetchQuota(): Promise<{ used: number; cap: number; remaining: number } | null> {
  try {
    const { data, error } = await supabase.functions.invoke<UsageResponse>('usage-status', { method: 'POST' });
    if (error || !data?.features?.takeoff_pages) return null;
    return data.features.takeoff_pages;
  } catch (err) {
    console.log('[quotaPrecheck] fetch failed', err);
    return null;
  }
}

/**
 * Confirm a planned PDF upload fits within remaining quota. Three
 * outcomes:
 *
 *   1. Plenty of headroom (≥80% remaining after) → silently proceed.
 *   2. Tight headroom (<80% remaining after, but still fits) → silent
 *      proceed. We trust the user to see the inline quota badge.
 *   3. Won't fit → blocking Alert with two options:
 *        "Upgrade plan" → routes to /paywall, returns false
 *        "Cancel"       → returns false
 *      No "proceed anyway" option since the server will 429 it.
 *
 * Free-tier users (cap=0) get a separate "Upgrade to Pro" message so
 * the copy is correct.
 */
export async function confirmQuotaFits(pageCount: number, fileName: string, router: Router): Promise<boolean> {
  const quota = await fetchQuota();
  if (!quota) {
    // No quota data — can happen if the edge function is briefly down or
    // the user is offline. We don't block the upload; the server-side
    // check is the authoritative one. Worst case the user sees a 429
    // they wouldn't have seen otherwise.
    return true;
  }
  if (quota.cap === 0) {
    return new Promise<boolean>((resolve) => {
      Alert.alert(
        'Takeoffs are a Pro feature',
        `AI Takeoff isn't included on your current plan. Upgrade to Pro to start uploading plan PDFs.`,
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          {
            text: 'Upgrade',
            onPress: () => {
              router.push('/paywall' as never);
              resolve(false);
            },
          },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    });
  }
  if (pageCount > quota.remaining) {
    return new Promise<boolean>((resolve) => {
      Alert.alert(
        `${fileName} won't fit this month`,
        `That PDF is ${pageCount} pages but you have ${quota.remaining} of ${quota.cap} takeoff pages remaining this month.\n\nTrim the PDF to ${quota.remaining} pages or fewer, or upgrade your plan for more headroom.`,
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          {
            text: 'Upgrade plan',
            onPress: () => {
              router.push('/paywall' as never);
              resolve(false);
            },
          },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    });
  }
  // Note: we don't show a soft warning at >80% utilization here — the
  // inline TakeoffQuotaBadge on the upload screen already surfaces that
  // visually. Adding another modal would be friction without value.
  void Platform; // keep import in case we add platform-specific UX later
  return true;
}
