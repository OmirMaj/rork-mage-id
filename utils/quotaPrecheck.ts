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
//
// Also here, because they are the same "what the plan allows" conversation:
//   confirmDrawingAnalysesLeft — the analyze_drawings bucket a takeoff or a
//     spec-book import spends AFTER the pages are rendered (audit #39);
//   showAiRefusal — the screen half of CONTRACT 26: a cap / plan / hourly
//     refusal from an AI edge function shown as the server's own sentence,
//     with the upgrade path and no "try again" (audit #124).

import { Platform } from 'react-native';
import type { Router } from 'expo-router';
import { supabase } from '@/lib/supabase';
// showAlert, never Alert.alert: react-native-web's Alert is a no-op stub, and
// these two dialogs' button callbacks are the ONLY resolvers of the Promise
// this function returns. On web the raw Alert meant the awaited Promise never
// settled — the upload simply hung with no dialog and no error.
import { showAlert } from '@/utils/alert';
import { aiRefusalKind, edgeErrorCode } from '@/utils/edgeError';
import { nextAiResetLabel } from '@/utils/aiRateLimiterCore';

interface UsageResponse {
  tier: string;
  features?: Record<string, { used: number; cap: number; remaining: number }>;
}

export interface QuotaBucket { used: number; cap: number; remaining: number }

function asBucket(v: unknown): QuotaBucket | null {
  const b = v as Partial<QuotaBucket> | null | undefined;
  if (!b || typeof b.cap !== 'number' || typeof b.remaining !== 'number' || typeof b.used !== 'number') return null;
  if (!Number.isFinite(b.cap) || !Number.isFinite(b.remaining) || !Number.isFinite(b.used)) return null;
  return { used: b.used, cap: b.cap, remaining: b.remaining };
}

/**
 * Read the monthly buckets WITHOUT React Query — used from imperative
 * handlers (file pickers, upload buttons) where running a hook isn't
 * an option. Cheap (~80ms) and idempotent.
 *
 * Two buckets, because a takeoff spends from both (audit #39): the render
 * charges `takeoff_pages` per page, then analyze-takeoff (and the spec-book,
 * Compare Drawings and drawing-analyzer functions) charges one
 * `analyze_drawings` per run. Checking only the pages let the 16th takeoff of a
 * Pro month upload, render and burn 10 of his 30 pages before a hidden 429.
 */
async function fetchQuota(): Promise<{ takeoffPages: QuotaBucket | null; analyzeDrawings: QuotaBucket | null } | null> {
  try {
    const { data, error } = await supabase.functions.invoke<UsageResponse>('usage-status', { method: 'POST' });
    if (error || !data?.features) return null;
    return {
      takeoffPages: asBucket(data.features.takeoff_pages),
      analyzeDrawings: asBucket(data.features.analyze_drawings),
    };
  } catch (err) {
    console.log('[quotaPrecheck] fetch failed', err);
    return null;
  }
}

/**
 * The refusal for a spent (or absent) drawing-analysis allowance, or null
 * when one is left. Pure — the sentence names every tool that shares the
 * bucket, because nothing else on screen says a takeoff and a spec-book
 * import draw from the same 15, and the real reset moment in his own clock
 * (the counter rolls at 00:00 UTC — "the 1st" is the evening before for a US
 * reader; audit #123, nextAiResetLabel).
 */
export function drawingAnalysesRefusal(
  bucket: QuotaBucket | null,
  resetLabel: string,
): { title: string; body: string } | null {
  if (!bucket || bucket.remaining > 0) return null;
  if (bucket.cap <= 0) {
    return {
      title: 'Drawing analysis isn’t on your plan',
      body: 'AI takeoffs, spec-book imports, Compare Drawings and the drawing analyzer are part of Pro. Upgrade to run one.',
    };
  }
  return {
    title: 'No drawing analyses left this month',
    body: `You’ve used all ${bucket.cap} drawing analyses this month — takeoffs, spec-book imports, Compare Drawings and the drawing analyzer share them. ${resetLabel}.\n\nNothing was uploaded, and no takeoff pages were used.`,
  };
}

/**
 * Block BEFORE the file picker when the month's drawing analyses are spent
 * (audit #39). The render would otherwise upload his PDF and charge his
 * takeoff pages for an analysis the server is certain to refuse. Upgrade /
 * Cancel, never "proceed anyway". Resolves true when he may go on — including
 * when the usage read fails: the server stays the authoritative gate, and a
 * precheck that blocks on its own outage would be worse than the 429.
 */
export async function confirmDrawingAnalysesLeft(router: Router): Promise<boolean> {
  const quota = await fetchQuota();
  const refusal = drawingAnalysesRefusal(quota?.analyzeDrawings ?? null, nextAiResetLabel().monthly);
  if (!refusal) return true;
  return new Promise<boolean>((resolve) => {
    showAlert(
      refusal.title,
      refusal.body,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        {
          text: 'See plans',
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

/**
 * The server's own sentence with its "Resets on the 1st." made true in his
 * clock (the monthly counters roll at 00:00 UTC). A message with no such
 * sentence — the hourly limit, a plan refusal — is returned untouched.
 */
export function withRealMonthlyReset(message: string, monthlyLabel: string): string {
  return message.replace(/Resets (?:on )?the 1st(?: of (?:next|the) month)?(?: \(UTC\))?\.?/i, `${monthlyLabel}.`);
}

/**
 * CONTRACT 26, the screen half: when an AI edge call was refused for a
 * reason running it again cannot fix, say so and stop.
 *   'plan'   (monthly_cap_reached / tier_required) → a dialog with the
 *             server's sentence and See plans; no "try again".
 *   'hourly' (hourly_limit) → no dialog: the server's sentence, as-is (it
 *             says when), is what the screen shows.
 * Returns the sentence the screen should keep on its error line (so the
 * reason survives the dialog), or null when this was not such a refusal and
 * the screen's own handling applies.
 */
export function showAiRefusal(err: unknown, router: Router): string | null {
  const kind = aiRefusalKind(err);
  if (!kind) return null;
  const raw = String((err as Error | null)?.message ?? '').trim();
  const message = withRealMonthlyReset(raw, nextAiResetLabel().monthly)
    || (kind === 'hourly' ? 'Hourly limit reached. Try again in an hour.' : 'Your plan’s allowance for this is used up.');
  // The hourly sentence already says when; it goes on the screen's error
  // line, with no dialog and no retry button to tap in the meantime.
  if (kind === 'hourly') return message;
  showAlert(
    edgeErrorCode(err) === 'tier_required' ? 'Not included in your plan' : 'You’ve hit this month’s limit',
    message,
    [
      { text: 'Not now', style: 'cancel' },
      { text: 'See plans', onPress: () => router.push('/paywall' as never) },
    ],
  );
  return message;
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
  const quota = (await fetchQuota())?.takeoffPages ?? null;
  if (!quota) {
    // No quota data — can happen if the edge function is briefly down or
    // the user is offline. We don't block the upload; the server-side
    // check is the authoritative one. Worst case the user sees a 429
    // they wouldn't have seen otherwise.
    return true;
  }
  if (quota.cap === 0) {
    return new Promise<boolean>((resolve) => {
      showAlert(
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
      showAlert(
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
