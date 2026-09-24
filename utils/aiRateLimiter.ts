// aiRateLimiter — feature-aware AI usage gating
//
// History:
//   v1: simple daily counts (10/75/200) — every feature was equal
//   v2 (this): tightened free tier + per-feature gating + lifetime caps
//
// The model now distinguishes three failure modes the user can hit:
//
//   1. Daily fast-call cap (5 free / 30 pro / 80 business / 150 enterprise —
//      see LIMITS in ./aiRateLimiterCore). The day is the SERVER's UTC day
//      (ai_daily_usage_* key on current_date; the local cache below keys on
//      toISOString()), so the allowance refills at 00:00 UTC — 8 PM in New
//      York — and the copy says so in the reader's clock via
//      nextAiResetLabel(), never "at midnight" (audit #123/#128).
//
//   2. Free-tier lifetime cap (e.g. 3 quick estimates EVER on free)
//      → "You've used your 3 free Quick Estimate trials. Pro includes 6
//         advanced AI runs a day." (the allowance is read from LIMITS — no
//         plan is uncapped, so the copy never promises one).
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
import {
  evaluateLimit,
  FAIL_OPEN_RESULT,
  FEATURE_CONFIG,
  LIMITS,
  nextAiResetLabel,
} from './aiRateLimiterCore';
import type {
  AIFeature,
  FeatureConfig,
  SubscriptionTierKey,
  RequestTier,
  LimitCheck,
} from './aiRateLimiterCore';

// Re-export the pure core so the public API of '@/utils/aiRateLimiter' is
// unchanged for existing importers.
export {
  evaluateLimit, FAIL_OPEN_RESULT, FEATURE_CONFIG, LIMITS,
  nextAiResetLabel, nextAiResetAt, timeUntilAiDailyReset, withLocalMonthlyReset,
} from './aiRateLimiterCore';
export type {
  AIFeature,
  FeatureConfig,
  SubscriptionTierKey,
  RequestTier,
  LimitCheck,
} from './aiRateLimiterCore';

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

async function getDailyUsage(): Promise<DailyUsage> {
  return (await readDailyUsage()).usage;
}

/**
 * getDailyUsage plus WHERE the number came from. `fromServer` is true only
 * when ai_daily_usage_get answered — the counter the relay-side gate trusts.
 * When it is false the count is this device's AsyncStorage cache alone, which
 * a reinstall zeroes, so the Settings meter must not print it as "today".
 */
async function readDailyUsage(): Promise<{ usage: DailyUsage; fromServer: boolean }> {
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
    return { usage: local, fromServer: false };
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
  return { usage: merged, fromServer: true };
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
  try {
    const usage = await getDailyUsage();
    const lifetime = feature ? await getLifetimeUsage() : {};
    const lifetimeUsed = feature ? (lifetime[feature] ?? 0) : 0;
    const check = evaluateLimit(
      subscriptionTier,
      requestTier,
      feature,
      usage.count,
      usage.tier.smart,
      lifetimeUsed,
      // The true reset in the reader's clock (00:00 UTC), read here so the
      // core stays pure.
      nextAiResetLabel().daily,
    );
    // Every inline caller (Ask, RFI suggest, Project Memory, the briefing
    // cards, UpgradeSheet…) prints limit.message as-is, and evaluateLimit only
    // names the reset for Enterprise — so a Pro GC read "Upgrade to Business"
    // with no word on when today's allowance comes back. Say it once, here.
    return withDailyResetSentence(check, subscriptionTier, nextAiResetLabel().daily);
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

/** Where getAIUsageStats' `used` numbers came from — see readDailyUsage. */
export type AIUsageSource = 'server' | 'device';

export async function getAIUsageStats(
  subscriptionTier: SubscriptionTierKey,
): Promise<{
  used: number;
  limit: number;
  smartUsed: number;
  smartLimit: number;
  /** Per-feature lifetime usage — useful for showing "2/3 free trials used" */
  lifetime: LifetimeUsage;
  /** 'server' when ai_daily_usage_get answered; 'device' = local cache only. */
  source: AIUsageSource;
}> {
  const { usage, fromServer } = await readDailyUsage();
  const lifetime = await getLifetimeUsage();
  return {
    used: usage.count,
    limit: LIMITS[subscriptionTier].daily,
    smartUsed: usage.tier.smart,
    smartLimit: LIMITS[subscriptionTier].smart,
    lifetime,
    source: fromServer ? 'server' : 'device',
  };
}

// ─── Display helpers (pure) ─────────────────────────────────────────────────
//
// Settings > AI USAGE used to open on `useState(10)` / `useState(3)` — the v1
// free cap and a number no plan has ever had — and print them as real
// ("Today: 0 of 10 requests") until the usage read resolved. When the read
// threw, `.catch(() => {})` left them up for good, which is where the
// founder's "I see you have 10 attempts" came from (2026-09-24). A tier that
// changed mid-read could also let the older answer land last.
//
// The rule now: the meter shows numbers only when they are REAL — the caps
// from LIMITS (the table the server's MONTHLY_CAPS.ai_text is 30x of) for the
// tier being shown, and today's count from the server's own counter. Anything
// else is a loading line or a visible "couldn't load" with a retry, never a
// placeholder dressed as a measurement.

export const AI_USAGE_LOADING_COPY = 'Loading today\u2019s AI usage\u2026';
export const AI_USAGE_FAILED_COPY = 'Couldn\u2019t load today\u2019s AI usage.';

/** "Your plan: 80 AI requests a day, 18 of them advanced." — read from LIMITS. */
export function aiPlanAllowanceSentence(tier: SubscriptionTierKey): string {
  const caps = LIMITS[tier] ?? LIMITS.free;
  return caps.smart > 0
    ? `Your plan: ${caps.daily} AI requests a day, ${caps.smart} of them advanced.`
    : `Your plan: ${caps.daily} AI requests a day.`;
}

export type AIUsageCardView =
  | { kind: 'loading'; message: string }
  | { kind: 'unavailable'; message: string; allowance: string }
  | { kind: 'ready'; used: number; limit: number; smartUsed: number; smartLimit: number };

/**
 * What the Settings AI USAGE block may show.
 *
 * @param tier    the tier the screen is showing right now
 * @param loaded  the last usage read and the tier it was read FOR (null while
 *                a read is in flight)
 * @param failed  the last read threw
 */
export function describeAIUsageCard(input: {
  tier: SubscriptionTierKey;
  loaded: { tier: SubscriptionTierKey; stats: { used: number; smartUsed: number; source: AIUsageSource } } | null;
  failed: boolean;
}): AIUsageCardView {
  const caps = LIMITS[input.tier] ?? LIMITS.free;
  const unavailable: AIUsageCardView = {
    kind: 'unavailable',
    message: AI_USAGE_FAILED_COPY,
    allowance: aiPlanAllowanceSentence(input.tier),
  };
  if (input.failed) return unavailable;
  // No answer yet, or an answer for a tier the screen has since left.
  if (!input.loaded || input.loaded.tier !== input.tier) {
    return { kind: 'loading', message: AI_USAGE_LOADING_COPY };
  }
  // The server counter did not answer: the only number on hand is this
  // device's cache, which a reinstall zeroes. Not "today's usage".
  if (input.loaded.stats.source !== 'server') return unavailable;
  return {
    kind: 'ready',
    used: input.loaded.stats.used,
    limit: caps.daily,
    smartUsed: input.loaded.stats.smartUsed,
    smartLimit: caps.smart,
  };
}

/**
 * At a daily cap, the message says when the allowance comes back, in the
 * reader's clock (`dailyResetLabel` = nextAiResetLabel().daily). The cap copy
 * itself is untouched; the reset is appended.
 *
 * Only where waiting actually helps: daily_cap on any tier, smart_cap on a
 * tier that HAS an advanced allowance. Not pro_only or lifetime_cap (those
 * never reset), not Free's smart_cap (its advanced allowance is 0 — tomorrow
 * brings nothing), and not a message that already names the reset
 * (Enterprise's).
 */
export function withDailyResetSentence(
  check: LimitCheck,
  subscriptionTier: SubscriptionTierKey,
  dailyResetLabel: string,
): LimitCheck {
  if (check.allowed || !check.message) return check;
  const waitingHelps = check.reason === 'daily_cap'
    || (check.reason === 'smart_cap' && (LIMITS[subscriptionTier]?.smart ?? 0) > 0);
  if (!waitingHelps || /\bResets\b/i.test(check.message)) return check;
  return { ...check, message: `${check.message} ${dailyResetLabel}.` };
}

/** Get the config for a feature — used by paywall UIs to show the right copy. */
export function getFeatureConfig(feature: AIFeature): FeatureConfig {
  return FEATURE_CONFIG[feature];
}

/**
 * Get how many free trials remain for a given feature. Returns null if the
 * feature has no lifetime cap (it is bounded by the daily quota instead).
 * UIs can use this to show a "2 free trials left" badge on the button.
 */
export async function getFreeTrialsRemaining(feature: AIFeature): Promise<number | null> {
  const cfg = FEATURE_CONFIG[feature];
  if (cfg?.freeLifetimeCap === undefined) return null;
  const lifetime = await getLifetimeUsage();
  const used = lifetime[feature] ?? 0;
  return Math.max(0, cfg.freeLifetimeCap - used);
}
