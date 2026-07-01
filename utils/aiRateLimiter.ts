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
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

const RATE_KEY = 'mage_ai_usage';
const LIFETIME_KEY = 'mage_ai_lifetime';

// Cached server snapshot from the last successful Supabase fetch. Keeps
// the local counter monotonic across reinstalls: when the user reopens
// the app and we sync from server, the local cache catches up to the
// server number (never goes backward to the AsyncStorage value).
let serverDailyCache: { date: string; count: number; smart: number } | null = null;

async function fetchServerDailyUsage(): Promise<{ count: number; smart: number } | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return null;
    const { data, error } = await supabase.rpc('ai_daily_usage_get', { p_user_id: user.id });
    if (error || !data) return null;
    // RPC returns an array of rows (single row in this case).
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return { count: 0, smart: 0 };
    return {
      count: Number(row.count ?? 0),
      smart: Number(row.smart_count ?? 0),
    };
  } catch {
    return null;
  }
}

async function bumpServerDailyUsage(tier: 'fast' | 'smart'): Promise<{ count: number; smart: number } | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return null;
    const { data, error } = await supabase.rpc('ai_daily_usage_increment', {
      p_user_id: user.id,
      p_tier: tier,
    });
    if (error || !data) return null;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    return {
      count: Number(row.count ?? 0),
      smart: Number(row.smart_count ?? 0),
    };
  } catch {
    return null;
  }
}

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
  | 'voiceCapture'       // free: 3 lifetime trials (marquee field feature)
  | 'aiEstimateWizard'   // free: 2 lifetime trials
  | 'aiTakeoff'          // free: 1 lifetime trial
  // Pro+ only — too expensive for free tier
  | 'weeklyAnalysis'
  | 'bidLeveling'
  | 'photoAnalysis'
  | 'drawingAnalysis'
  | 'specBookExtract';

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
  voiceCapture:       { tier: 'fast',  freeLifetimeCap: 3, displayName: 'Voice Capture' },
  aiEstimateWizard:   { tier: 'smart', freeLifetimeCap: 2, displayName: 'AI Estimate' },
  aiTakeoff:          { tier: 'smart', freeLifetimeCap: 1, displayName: 'AI Takeoff' },

  // Pro+ only — high-value features that require subscription
  weeklyAnalysis:     { tier: 'smart', proOnly: true, displayName: 'Weekly Full Analysis' },
  bidLeveling:        { tier: 'smart', proOnly: true, displayName: 'AI Bid Leveling' },
  photoAnalysis:      { tier: 'smart', proOnly: true, displayName: 'Photo Analysis' },
  drawingAnalysis:    { tier: 'smart', proOnly: true, displayName: 'Drawing Analysis' },
  specBookExtract:    { tier: 'smart', proOnly: true, displayName: 'Spec Book Extract' },
};

const LIMITS = {
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

async function getDailyUsage(): Promise<DailyUsage> {
  const today = new Date().toISOString().split('T')[0];

  // Local AsyncStorage cache. Used as the offline fallback and as a
  // monotonic floor — server count, if present, can only INCREASE the
  // displayed number, never erase a known-true local consumption.
  const raw = await AsyncStorage.getItem(RATE_KEY);
  let local: DailyUsage = raw
    ? JSON.parse(raw)
    : { date: today, count: 0, tier: { fast: 0, smart: 0 } };
  if (local.date !== today) {
    local = { date: today, count: 0, tier: { fast: 0, smart: 0 } };
  }

  // Server snapshot. If the user reinstalled the app or wiped data, the
  // local cache is 0 but the server still has the real number — this
  // closes the abuse vector. Server unreachable → fall back to local.
  const server = await fetchServerDailyUsage();
  if (!server) {
    return local;
  }

  // Server wins on both fast (total count) and smart counters. We
  // overwrite the local cache so subsequent reads (and the daily reset
  // check) line up.
  const merged: DailyUsage = {
    date: today,
    count: Math.max(local.count, server.count),
    tier: {
      fast: Math.max(local.tier.fast, server.count - server.smart),
      smart: Math.max(local.tier.smart, server.smart),
    },
  };
  serverDailyCache = { date: today, count: server.count, smart: server.smart };
  // Best-effort cache write so a subsequent offline read still reflects
  // the server-known total.
  void AsyncStorage.setItem(RATE_KEY, JSON.stringify(merged));
  return merged;
}

async function getLifetimeUsage(): Promise<LifetimeUsage> {
  const raw = await AsyncStorage.getItem(LIFETIME_KEY);
  return raw ? JSON.parse(raw) : {};
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
  try {
    const usage = await getDailyUsage();
    const lifetime = feature ? await getLifetimeUsage() : {};
    const lifetimeUsed = feature ? (lifetime[feature] ?? 0) : 0;
    return evaluateLimit(
      subscriptionTier,
      requestTier,
      feature,
      usage.count,
      usage.tier.smart,
      lifetimeUsed,
    );
  } catch (err) {
    console.warn('[aiRateLimiter] checkAILimit read failed — failing open', err);
    return FAIL_OPEN_RESULT;
  }
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

  // Server increment first. We want the canonical number to come from
  // Postgres so reinstalls / device wipes can't reset the counter. If
  // it succeeds, we use the returned (count, smart) as the source of
  // truth for the local cache below.
  const server = await bumpServerDailyUsage(requestTier);

  const raw = await AsyncStorage.getItem(RATE_KEY);
  let usage: DailyUsage = raw
    ? JSON.parse(raw)
    : { date: today, count: 0, tier: { fast: 0, smart: 0 } };
  if (usage.date !== today) {
    usage = { date: today, count: 0, tier: { fast: 0, smart: 0 } };
  }

  if (server) {
    usage = {
      date: today,
      count: server.count,
      tier: {
        fast: server.count - server.smart,
        smart: server.smart,
      },
    };
    serverDailyCache = { date: today, count: server.count, smart: server.smart };
  } else {
    // Offline / unauth path: increment the local cache and let the next
    // server sync re-anchor it. We still write the local bump so the
    // user can see "X used" within the session even without network.
    usage.count += 1;
    usage.tier[requestTier] += 1;
  }
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
