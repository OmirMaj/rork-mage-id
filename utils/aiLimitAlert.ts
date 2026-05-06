// aiLimitAlert — single helper that every AI feature uses when
// `checkAILimit` returns blocked. Centralizes the message + CTA logic so:
//
//   1. Every limit-reached interaction looks the same (same wording, same
//      countdown to reset, same upgrade buttons).
//   2. The tier-aware upgrade ladder lives in one place — free → pro →
//      business → enterprise. Enterprise users see no upgrade CTA, just
//      a reset countdown ("Resets at midnight" or "Resets {Month} 1").
//   3. Adding a new tier or changing prices is a one-file change.
//
// Pre-fix every component called `Alert.alert('AI Limit Reached', ...)`
// inline with custom titles, sometimes routing to `/paywall`, sometimes
// not. Drift was real — the limit message in AISubEvaluator was different
// from the one in AIQuickEstimate even though the underlying state was
// identical.

import { Alert, Platform } from 'react-native';
import type { Router } from 'expo-router';
import type { LimitCheck } from '@/utils/aiRateLimiter';

const TIER_LABEL: Record<string, string> = {
  pro: 'Pro',
  business: 'Business',
  enterprise: 'Enterprise',
};

const TIER_PRICE: Record<string, string> = {
  pro: '$29/mo',
  business: '$79/mo',
  enterprise: '$150/mo',
};

/**
 * Time until midnight local — used for daily-cap reset countdowns.
 * Returns a human-friendly string like "7h 23m" or "12m" for short waits.
 */
function timeUntilMidnight(): string {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0); // next midnight
  const diffMs = midnight.getTime() - now.getTime();
  const totalMinutes = Math.max(1, Math.round(diffMs / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/**
 * Time until first of next month — used for monthly-cap reset countdowns
 * (vision features). Returns "Resets {Month} 1" for clarity since the
 * remaining duration is usually too long for "Xh Ym" to feel useful.
 */
function nextMonthLabel(): string {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return next.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}

interface ShowAILimitOpts {
  /** Result from checkAILimit. */
  limit: LimitCheck;
  /** Router to deep-link the upgrade CTA into the paywall. */
  router: Router;
  /** When true, the limit applies to a monthly-cap feature (vision/PDF)
   *  and the modal shows "Resets {Month} 1" instead of midnight. */
  monthly?: boolean;
}

/**
 * Show a tier-aware limit-reached alert. Primary button: upgrade to next
 * tier (or "See plans" for free; nothing for enterprise). Secondary: OK.
 *
 * Free users blocked by `pro_only` get a "Pro Feature" alert directly.
 * Free users blocked by `lifetime_cap` get a "Free Trials Used" alert.
 */
export function showAILimitAlert({ limit, router, monthly = false }: ShowAILimitOpts): void {
  const { reason, upgradeTo, message } = limit;

  // Free-tier-only paths — no countdown, just a paywall nudge.
  if (reason === 'pro_only') {
    Alert.alert(
      'Pro feature',
      message ?? 'This AI feature is part of Pro. Upgrade to unlock.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'See Pro plans', onPress: () => router.push('/paywall' as never) },
      ],
    );
    return;
  }
  if (reason === 'lifetime_cap') {
    Alert.alert(
      'Free trials used',
      message ?? "You've used your free AI trials. Upgrade to Pro for unlimited use.",
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Upgrade to Pro', onPress: () => router.push('/paywall' as never) },
      ],
    );
    return;
  }

  // Daily / smart cap path — show countdown + upgrade CTA.
  const resetText = monthly
    ? `Resets ${nextMonthLabel()}.`
    : `Resets at midnight (in ${timeUntilMidnight()}).`;

  // Enterprise users have no upgrade — just the countdown.
  if (!upgradeTo || upgradeTo === undefined) {
    Alert.alert(
      "You've hit today's AI limit",
      `${message ?? "Daily limit reached."}\n\n${resetText}`,
      [{ text: 'OK', style: 'default' }],
    );
    return;
  }

  const upgradeLabel = TIER_LABEL[upgradeTo] ?? upgradeTo;
  const upgradePrice = TIER_PRICE[upgradeTo] ?? '';
  const buttonLabel = upgradePrice
    ? `Upgrade to ${upgradeLabel} (${upgradePrice})`
    : `Upgrade to ${upgradeLabel}`;
  const title = "You've hit today's AI limit";
  const body = `${message ?? `You've used today's allowance.`}\n\n${resetText}`;

  Alert.alert(title, body, [
    { text: 'Wait until tomorrow', style: 'cancel' },
    { text: buttonLabel, onPress: () => router.push('/paywall' as never) },
  ]);
  // Lightweight haptic so the user feels the limit kick rather than just
  // seeing the dialog flash.
  if (Platform.OS !== 'web') {
    // Lazy require to avoid pulling Haptics into web bundle when unused.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    try { const Haptics = require('expo-haptics'); void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); } catch { /* fine */ }
  }
}
