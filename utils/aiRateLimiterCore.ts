// aiRateLimiterCore — pure, react-native-free gating core
//
// This module holds the PURE parts of the AI rate limiter: types, config
// tables, and the `evaluateLimit` decision function. It imports NOTHING
// from react-native / AsyncStorage / supabase, so it can be imported from
// plain `bun` scripts (e.g. scripts/validate-activation-gating.ts) without
// pulling in the React Native runtime.
//
// The storage-backed wrappers (checkAILimit, recordAIUsage, etc.) live in
// `./aiRateLimiter`, which re-exports everything here for a stable public API.

/** All AI features in the app — catalogued so we can gate them per-tier. */
export type AIFeature =
  // Fast / cheap — counted toward the daily fast quota
  | 'voiceIntake'
  | 'leadScoring'
  | 'copilot'
  | 'homeBriefing'
  | 'invoicePrediction'
  | 'subEvaluation'
  | 'equipmentAdvice'
  | 'homeownerSummary'
  | 'changeOrderImpact'
  | 'dailyReport'
  | 'projectReport'
  | 'delayScan'
  // Smart / expensive
  | 'quickEstimate'      // free: 3 lifetime trials
  | 'scheduleBuilder'    // free: 3 lifetime trials
  | 'scheduleCopilot'    // free: 3 lifetime trials (NL what-if / edit copilot)
  | 'estimateValidation' // free: 3 lifetime trials
  | 'voiceCapture'       // free: 3 lifetime trials (marquee field feature)
  | 'aiEstimateWizard'   // free: 2 lifetime trials
  // Pro+ only — too expensive for free tier
  | 'aiTakeoff'          // pro-only: server hard-gates every step to Pro+
  | 'weeklyAnalysis'
  | 'bidLeveling'
  | 'photoAnalysis'
  | 'drawingAnalysis'
  | 'specBookExtract'
  | 'scanCredential';

export interface FeatureConfig {
  /** Cost class — affects daily quota bucket. */
  tier: RequestTier;
  /** If set, free users get this many TOTAL uses ever; then paywall. */
  freeLifetimeCap?: number;
  /** If true, feature is unavailable on free tier entirely. */
  proOnly?: boolean;
  /** Display name for paywall messages. */
  displayName?: string;
}

export const FEATURE_CONFIG: Record<AIFeature, FeatureConfig> = {
  // Fast features — unlimited within daily quota
  voiceIntake:        { tier: 'fast', displayName: 'Voice intake' },
  leadScoring:        { tier: 'fast', displayName: 'Lead scoring' },
  copilot:            { tier: 'fast', displayName: 'Construction AI' },
  homeBriefing:       { tier: 'fast', displayName: 'Daily briefing' },
  invoicePrediction:  { tier: 'fast', displayName: 'Invoice prediction' },
  subEvaluation:      { tier: 'fast', displayName: 'Sub evaluation' },
  equipmentAdvice:    { tier: 'fast', displayName: 'Equipment advice' },
  homeownerSummary:   { tier: 'fast', displayName: 'Homeowner digest' },
  changeOrderImpact:  { tier: 'fast', displayName: 'Change order impact' },
  dailyReport:        { tier: 'fast', displayName: 'Daily report' },
  projectReport:      { tier: 'fast', displayName: 'Project report' },
  delayScan:          { tier: 'fast', displayName: 'Delay scan' },

  // Smart features — free gets a few trials, then paywall
  quickEstimate:      { tier: 'smart', freeLifetimeCap: 3, displayName: 'Quick Estimate' },
  scheduleBuilder:    { tier: 'smart', freeLifetimeCap: 3, displayName: 'AI Schedule Builder' },
  scheduleCopilot:    { tier: 'smart', freeLifetimeCap: 3, displayName: 'Schedule Copilot' },
  estimateValidation: { tier: 'smart', freeLifetimeCap: 3, displayName: 'Estimate Validation' },
  voiceCapture:       { tier: 'fast',  freeLifetimeCap: 3, displayName: 'Voice Capture' },
  aiEstimateWizard:   { tier: 'smart', freeLifetimeCap: 2, displayName: 'AI Estimate' },

  // Pro+ only — high-value features that require subscription
  // aiTakeoff is Pro-only: every server step (convert-pdf-to-images,
  // analyze-takeoff) hard-gates on requireTier(['pro','business']), and the
  // paywall FEATURES table lists it as free:false. A freeLifetimeCap here
  // would have the client promise a trial the server rejects.
  aiTakeoff:          { tier: 'smart', proOnly: true, displayName: 'AI Takeoff' },
  weeklyAnalysis:     { tier: 'smart', proOnly: true, displayName: 'Weekly Full Analysis' },
  bidLeveling:        { tier: 'smart', proOnly: true, displayName: 'AI Bid Leveling' },
  photoAnalysis:      { tier: 'smart', proOnly: true, displayName: 'Photo Analysis' },
  drawingAnalysis:    { tier: 'smart', proOnly: true, displayName: 'Drawing Analysis' },
  specBookExtract:    { tier: 'smart', proOnly: true, displayName: 'Spec Book Extract' },
  scanCredential:     { tier: 'smart', proOnly: true, displayName: 'ID / Credential Scan' },
};

export const LIMITS = {
  // Daily caps for text-AI calls. Locked-in to keep a 50%+ gross margin
  // even when a user maxes out every single day for a full month, given
  // the published Pro / Business / Enterprise prices ($29 / $79 / $150).
  // Worst-case Gemini cost per tier:
  //   Free:        $0.30/mo  (negligible)
  //   Pro:        $11.31/mo  (61% margin floor at $29)
  //   Business:   $33.57/mo  (58% margin floor at $79)
  //   Enterprise: $70.65/mo  (53% margin floor at $150)
  // Smart-tier features on free are individually gated by lifetime cap or
  // pro-only, so a generic smart-daily quota is redundant on free.
  free:       { daily: 5,   smart: 0  },
  pro:        { daily: 30,  smart: 6  },
  business:   { daily: 80,  smart: 18 },
  enterprise: { daily: 150, smart: 40 },
} as const;

export type SubscriptionTierKey = 'free' | 'pro' | 'business' | 'enterprise';
export type RequestTier = 'fast' | 'smart';

export interface LimitCheck {
  allowed: boolean;
  remaining: number;
  message?: string;
  /**
   * Why it was blocked, so UI can branch on it (paywall vs. limit reached
   * vs. resets-tomorrow). Set when `allowed === false`.
   */
  reason?: 'daily_cap' | 'lifetime_cap' | 'pro_only' | 'smart_cap';
  /**
   * Best-fit upgrade target — UI uses this to deep-link the paywall to the
   * right plan instead of showing "Upgrade" generically.
   */
  upgradeTo?: 'pro' | 'business' | 'enterprise';
}

/**
 * Returned when a storage read fails inside checkAILimit. Fail OPEN for a
 * signed-in user — a lost read should never cost a trial or block value.
 * recordAIUsage still only runs on success, so nothing is incremented here.
 */
export const FAIL_OPEN_RESULT: LimitCheck = { allowed: true, remaining: 0 };

/**
 * PURE gating decision — no storage, no await. checkAILimit reads storage
 * then delegates here; the validate script tests this directly.
 *
 * @param dailyCount       total AI calls used today (usage.count)
 * @param dailySmartCount  smart-tier calls used today (usage.tier.smart)
 * @param lifetimeUsed     lifetime uses of `feature` (0 if no feature / no cap)
 */
export function evaluateLimit(
  subscriptionTier: SubscriptionTierKey,
  requestTier: RequestTier,
  feature: AIFeature | undefined,
  dailyCount: number,
  dailySmartCount: number,
  lifetimeUsed: number,
): LimitCheck {
  const limits = LIMITS[subscriptionTier];
  const dailyRemaining = limits.daily - dailyCount;

  // 1. Pro-only feature gate (free users can't use it at all)
  if (feature && subscriptionTier === 'free') {
    const cfg = FEATURE_CONFIG[feature];
    if (cfg?.proOnly) {
      return {
        allowed: false,
        remaining: 0,
        reason: 'pro_only',
        upgradeTo: 'pro',
        message: `${cfg.displayName ?? feature} is a Pro feature. Upgrade to unlock unlimited use.`,
      };
    }
  }

  // 2. Free-tier lifetime cap (e.g. 3 Voice Captures ever). When trials
  //    remain, this feature's free allowance is governed by the lifetime
  //    cap, NOT the daily/smart quotas — so allow immediately. Without this
  //    early return, the free smart-daily cap of 0 would block metered
  //    features before the user could ever spend a trial.
  if (feature && subscriptionTier === 'free') {
    const cfg = FEATURE_CONFIG[feature];
    if (cfg?.freeLifetimeCap !== undefined) {
      if (lifetimeUsed >= cfg.freeLifetimeCap) {
        return {
          allowed: false,
          remaining: 0,
          reason: 'lifetime_cap',
          upgradeTo: 'pro',
          message: `You've used your ${cfg.freeLifetimeCap} free ${cfg.displayName ?? 'AI'} trials. Upgrade to Pro for unlimited use.`,
        };
      }
      return { allowed: true, remaining: cfg.freeLifetimeCap - lifetimeUsed - 1 };
    }
  }

  // 3. Daily total cap.
  if (dailyCount >= limits.daily) {
    const nextTier = subscriptionTier === 'free' ? 'pro'
      : subscriptionTier === 'pro' ? 'business'
      : subscriptionTier === 'business' ? 'enterprise'
      : undefined;
    const nextDailyCap = nextTier === 'pro' ? 30
      : nextTier === 'business' ? 80
      : nextTier === 'enterprise' ? 150
      : null;
    const message = subscriptionTier === 'enterprise'
      ? "You've reached today's AI limit. Resets at midnight."
      : `You've used today's ${limits.daily} AI requests. Upgrade to ${nextTier?.[0].toUpperCase()}${nextTier?.slice(1)} for ${nextDailyCap}/day.`;
    return {
      allowed: false,
      remaining: 0,
      reason: 'daily_cap',
      upgradeTo: nextTier as 'pro' | 'business' | 'enterprise' | undefined,
      message,
    };
  }

  // 4. Smart-tier daily cap (Pro/Business only — free has 0 smart by design)
  if (requestTier === 'smart' && dailySmartCount >= limits.smart) {
    const nextTier = subscriptionTier === 'free' ? 'pro'
      : subscriptionTier === 'pro' ? 'business'
      : subscriptionTier === 'business' ? 'enterprise'
      : undefined;
    const nextSmartCap = nextTier === 'pro' ? 6
      : nextTier === 'business' ? 18
      : nextTier === 'enterprise' ? 40
      : null;
    const message = subscriptionTier === 'free'
      ? `Advanced AI requires Pro. Upgrade to unlock Quick Estimate, Schedule Builder, and more.`
      : subscriptionTier === 'enterprise'
        ? `You've used today's advanced AI. Try again tomorrow or use quick AI features instead.`
        : `You've used today's ${limits.smart} advanced AI calls. Upgrade to ${nextTier?.[0].toUpperCase()}${nextTier?.slice(1)} for ${nextSmartCap}/day.`;
    return {
      allowed: false,
      remaining: dailyRemaining,
      reason: 'smart_cap',
      upgradeTo: nextTier as 'pro' | 'business' | 'enterprise' | undefined,
      message,
    };
  }

  return { allowed: true, remaining: dailyRemaining - 1 };
}
