// aiRateLimiter — feature-aware AI usage gating
//
// History:
//   v1: simple daily counts (10/75/200) — every feature was equal
//   v2 (this): tightened free tier + per-feature gating + lifetime caps
//
// The model now distinguishes three failure modes the user can hit:
//
//   1. Daily fast-call cap (5 free / 75 pro / 200 business)
//      → "You've used today's quick AI. Resets at midnight."
//
//   2. Free-tier lifetime cap (e.g. 3 quick estimates EVER on free)
//      → "You've used your 3 free Quick Estimates. Upgrade to Pro for
//         unlimited estimates."
//      Designed so a free user can DEMO the magic features once or twice,
//      then must convert to keep using them. Avoids the all-you-can-eat
//      trap that bleeds money on free riders.
//
//   3. Pro-only feature gate (Bid Leveling, Photo Analysis, Weekly Full
//      Analysis, Drawing Analysis are too expensive to give away free)
//      → "Unlock with Pro — see how AI levels your bids in seconds."
//
// All counters live in AsyncStorage for now (per-device). Server-side
// counters are coming when we ship the credit system, but this is the
// foundation: it teaches users which features are upgrade-worthy.

import AsyncStorage from '@react-native-async-storage/async-storage';

const RATE_KEY = 'mage_ai_usage';
const LIFETIME_KEY = 'mage_ai_lifetime';

interface DailyUsage {
  date: string;
  count: number;
  tier: { fast: number; smart: number };
}

interface LifetimeUsage {
  // Map of featureName → lifetime count. Only used for free-tier features
  // that have a lifetime cap (e.g. `quickEstimate: 2` means they've used
  // it twice ever; one trial left).
  [feature: string]: number;
}

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
  // Smart / expensive
  | 'quickEstimate'      // free: 3 lifetime trials
  | 'scheduleBuilder'    // free: 3 lifetime trials
  | 'estimateValidation' // free: 3 lifetime trials
  // Pro+ only — too expensive for free tier
  | 'weeklyAnalysis'
  | 'bidLeveling'
  | 'photoAnalysis'
  | 'drawingAnalysis';

interface FeatureConfig {
  /** Cost class — affects daily quota bucket. */
  tier: RequestTier;
  /** If set, free users get this many TOTAL uses ever; then paywall. */
  freeLifetimeCap?: number;
  /** If true, feature is unavailable on free tier entirely. */
  proOnly?: boolean;
  /** Display name for paywall messages. */
  displayName?: string;
}

const FEATURE_CONFIG: Record<AIFeature, FeatureConfig> = {
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

  // Smart features — free gets a few trials, then paywall
  quickEstimate:      { tier: 'smart', freeLifetimeCap: 3, displayName: 'Quick Estimate' },
  scheduleBuilder:    { tier: 'smart', freeLifetimeCap: 3, displayName: 'AI Schedule Builder' },
  estimateValidation: { tier: 'smart', freeLifetimeCap: 3, displayName: 'Estimate Validation' },

  // Pro+ only — high-value features that require subscription
  weeklyAnalysis:     { tier: 'smart', proOnly: true, displayName: 'Weekly Full Analysis' },
  bidLeveling:        { tier: 'smart', proOnly: true, displayName: 'AI Bid Leveling' },
  photoAnalysis:      { tier: 'smart', proOnly: true, displayName: 'Photo Analysis' },
  drawingAnalysis:    { tier: 'smart', proOnly: true, displayName: 'Drawing Analysis' },
};

const LIMITS = {
  // Free tier tightened from 10/3 → 5 fast only.
  // Smart-tier features are individually gated by lifetime cap or pro-only,
  // so a generic smart-daily quota would be redundant on free.
  free:     { daily: 5,   smart: 0 },
  pro:      { daily: 75,  smart: 25 },
  business: { daily: 200, smart: 75 },
} as const;

export type SubscriptionTierKey = 'free' | 'pro' | 'business';
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
  upgradeTo?: 'pro' | 'business';
}

async function getDailyUsage(): Promise<DailyUsage> {
  const today = new Date().toISOString().split('T')[0];
  const raw = await AsyncStorage.getItem(RATE_KEY);
  let usage: DailyUsage = raw
    ? JSON.parse(raw)
    : { date: today, count: 0, tier: { fast: 0, smart: 0 } };
  if (usage.date !== today) {
    usage = { date: today, count: 0, tier: { fast: 0, smart: 0 } };
  }
  return usage;
}

async function getLifetimeUsage(): Promise<LifetimeUsage> {
  const raw = await AsyncStorage.getItem(LIFETIME_KEY);
  return raw ? JSON.parse(raw) : {};
}

/**
 * Check whether the user can run the given AI feature. Pass `feature` for
 * per-feature gating (preferred). Pass just `requestTier` for the legacy
 * generic check (still works for existing callsites).
 */
export async function checkAILimit(
  subscriptionTier: SubscriptionTierKey,
  requestTier: RequestTier,
  feature?: AIFeature,
): Promise<LimitCheck> {
  const limits = LIMITS[subscriptionTier];
  const usage = await getDailyUsage();
  const dailyRemaining = limits.daily - usage.count;

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

  // 2. Free-tier lifetime cap (e.g. 3 Quick Estimates ever)
  if (feature && subscriptionTier === 'free') {
    const cfg = FEATURE_CONFIG[feature];
    if (cfg?.freeLifetimeCap !== undefined) {
      const lifetime = await getLifetimeUsage();
      const used = lifetime[feature] ?? 0;
      if (used >= cfg.freeLifetimeCap) {
        return {
          allowed: false,
          remaining: 0,
          reason: 'lifetime_cap',
          upgradeTo: 'pro',
          message: `You've used your ${cfg.freeLifetimeCap} free ${cfg.displayName ?? 'AI'} trials. Upgrade to Pro for unlimited use.`,
        };
      }
    }
  }

  // 3. Daily total cap
  if (usage.count >= limits.daily) {
    return {
      allowed: false,
      remaining: 0,
      reason: 'daily_cap',
      upgradeTo: subscriptionTier === 'free' ? 'pro' : subscriptionTier === 'pro' ? 'business' : undefined,
      message:
        subscriptionTier === 'free'
          ? `You've used today's ${limits.daily} AI requests. Upgrade to Pro for 75/day.`
          : subscriptionTier === 'pro'
            ? `You've used today's ${limits.daily} AI requests. Upgrade to Business for 200/day.`
            : `You've reached today's AI limit. Resets at midnight.`,
    };
  }

  // 4. Smart-tier daily cap (Pro/Business only — free has 0 smart by design)
  if (requestTier === 'smart' && usage.tier.smart >= limits.smart) {
    return {
      allowed: false,
      remaining: dailyRemaining,
      reason: 'smart_cap',
      upgradeTo: subscriptionTier === 'free' ? 'pro' : 'business',
      message:
        subscriptionTier === 'free'
          ? `Advanced AI requires Pro. Upgrade to unlock Quick Estimate, Schedule Builder, and more.`
          : `You've used today's advanced AI. Try again tomorrow or use quick AI features instead.`,
    };
  }

  return { allowed: true, remaining: dailyRemaining - 1 };
}

/**
 * Record a successful AI call. Increments both daily and lifetime counters.
 * Pass the same `feature` you passed to checkAILimit for accurate lifetime
 * tracking — otherwise lifetime caps won't fire.
 */
export async function recordAIUsage(
  requestTier: RequestTier,
  feature?: AIFeature,
): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const raw = await AsyncStorage.getItem(RATE_KEY);
  let usage: DailyUsage = raw
    ? JSON.parse(raw)
    : { date: today, count: 0, tier: { fast: 0, smart: 0 } };
  if (usage.date !== today) {
    usage = { date: today, count: 0, tier: { fast: 0, smart: 0 } };
  }
  usage.count += 1;
  usage.tier[requestTier] += 1;
  await AsyncStorage.setItem(RATE_KEY, JSON.stringify(usage));

  // Lifetime tracking: only for features with a lifetime cap (Quick Estimate,
  // Schedule Builder, Estimate Validation). Other features are bounded by the
  // daily quota alone.
  if (feature && FEATURE_CONFIG[feature]?.freeLifetimeCap !== undefined) {
    const lifetime = await getLifetimeUsage();
    lifetime[feature] = (lifetime[feature] ?? 0) + 1;
    await AsyncStorage.setItem(LIFETIME_KEY, JSON.stringify(lifetime));
  }
}

export async function getAIUsageStats(
  subscriptionTier: SubscriptionTierKey,
): Promise<{
  used: number;
  limit: number;
  smartUsed: number;
  smartLimit: number;
  /** Per-feature lifetime usage — useful for showing "2/3 free trials used" */
  lifetime: LifetimeUsage;
}> {
  const usage = await getDailyUsage();
  const lifetime = await getLifetimeUsage();
  return {
    used: usage.count,
    limit: LIMITS[subscriptionTier].daily,
    smartUsed: usage.tier.smart,
    smartLimit: LIMITS[subscriptionTier].smart,
    lifetime,
  };
}

/** Get the config for a feature — used by paywall UIs to show the right copy. */
export function getFeatureConfig(feature: AIFeature): FeatureConfig {
  return FEATURE_CONFIG[feature];
}

/**
 * Get how many free trials remain for a given feature. Returns null if the
 * feature has no lifetime cap (i.e. paid tier or unlimited fast feature).
 * UIs can use this to show a "2 free trials left" badge on the button.
 */
export async function getFreeTrialsRemaining(feature: AIFeature): Promise<number | null> {
  const cfg = FEATURE_CONFIG[feature];
  if (cfg?.freeLifetimeCap === undefined) return null;
  const lifetime = await getLifetimeUsage();
  const used = lifetime[feature] ?? 0;
  return Math.max(0, cfg.freeLifetimeCap - used);
}
