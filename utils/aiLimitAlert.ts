// aiLimitAlert — single helper that every AI feature uses when
// `checkAILimit` returns blocked. Centralizes the message + CTA logic so:
//
//   1. Every limit-reached interaction looks the same (same wording, same
//      countdown to reset, same upgrade buttons).
//   2. The tier-aware upgrade ladder lives in one place — free → pro →
//      business → enterprise. Enterprise users see no upgrade CTA, just
//      a reset countdown in their own clock ("Resets at 8:00 PM (in 5h)" or
//      "Resets Sep 30, 8:00 PM"). The counters are dated in UTC on the
//      server, so "midnight" / "the 1st" were wrong by hours for every US
//      user (audit #123/#128) — see nextAiResetLabel in aiRateLimiterCore.
//   3. Adding a new tier or changing prices is a one-file change.
//
// Pre-fix every component called `showAlert('AI Limit Reached', ...)`
// inline with custom titles, sometimes routing to `/paywall`, sometimes
// not. Drift was real — the limit message in AISubEvaluator was different
// from the one in AIQuickEstimate even though the underlying state was
// identical.

import { Platform } from 'react-native';
// showAlert, never Alert.alert. react-native-web's Alert is literally an empty
// stub, and this function is the single AI-cap handler behind ~18 call sites —
// so on web a user who hit their limit tapped Generate and got NOTHING: no
// dialog, no error, no spinner. The router.push('/paywall') upsell lives only
// inside these buttons, which made the paywall unreachable from the web app.
import { showAlert } from '@/utils/alert';
import type { Router } from 'expo-router';
import type { LimitCheck } from '@/utils/aiRateLimiter';
import { LIMITS, nextAiResetLabel, timeUntilAiDailyReset } from '@/utils/aiRateLimiterCore';

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

// Reset copy comes from the pure core: nextAiResetLabel() names the next
// 00:00 UTC boundary (the moment the server's counters actually roll) in the
// device's clock, and timeUntilAiDailyReset() counts down to that same instant.
// The old timeUntilMidnight() counted to LOCAL midnight — nine hours for a New
// Yorker at 3 PM whose allowance came back at 8 PM.

interface ShowAILimitOpts {
  /** Result from checkAILimit. */
  limit: LimitCheck;
  /** Router to deep-link the upgrade CTA into the paywall. */
  router: Router;
  /** When true, the limit applies to a monthly-cap feature (vision/PDF)
   *  and the modal shows the monthly reset ("Resets Sep 30, 8:00 PM"). */
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
    showAlert(
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
    showAlert(
      'Free trials used',
      // Never "unlimited": no plan is uncapped (Pro is LIMITS.pro — 30 a day,
      // 6 advanced), and the paywall prints that table two taps away.
      message ?? `You've used your free AI trials. Pro includes ${LIMITS.pro.daily} AI requests a day, ${LIMITS.pro.smart} of them advanced.`,
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Upgrade to Pro', onPress: () => router.push('/paywall' as never) },
      ],
    );
    return;
  }

  // Daily / smart cap path — show the real reset + upgrade CTA.
  const labels = nextAiResetLabel();
  const resetText = monthly
    ? `${labels.monthly}.`
    : `${labels.daily} (in ${timeUntilAiDailyReset()}).`;
  const title = monthly ? "You've hit this month's AI limit" : "You've hit today's AI limit";
  // evaluateLimit already names the reset in some messages (Enterprise has no
  // upgrade to offer, so the reset IS the message) — don't say it twice.
  const said = !!message && /\bResets\b/.test(message);
  const tail = said
    ? (monthly ? '' : `\n\nThat's in ${timeUntilAiDailyReset()}.`)
    : `\n\n${resetText}`;

  // Enterprise users have no upgrade — just the reset.
  if (!upgradeTo) {
    showAlert(
      title,
      `${message ?? (monthly ? 'Monthly limit reached.' : 'Daily limit reached.')}${tail}`,
      [{ text: 'OK', style: 'default' }],
    );
    return;
  }

  const upgradeLabel = TIER_LABEL[upgradeTo] ?? upgradeTo;
  const upgradePrice = TIER_PRICE[upgradeTo] ?? '';
  const buttonLabel = upgradePrice
    ? `Upgrade to ${upgradeLabel} (${upgradePrice})`
    : `Upgrade to ${upgradeLabel}`;
  const body = `${message ?? (monthly ? `You've used this month's allowance.` : `You've used today's allowance.`)}${tail}`;

  showAlert(title, body, [
    // Not "Wait until tomorrow": the reset is often later TODAY (8 PM in New York).
    { text: 'Wait for the reset', style: 'cancel' },
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
