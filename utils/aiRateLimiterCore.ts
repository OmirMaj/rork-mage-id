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
  | 'profitLeak'
  | 'delayScan'
  // Smart / expensive
  | 'askMage'            // One Mind "Ask MAGE" — whole-business grounded Q&A
  | 'projectMemory'      // Ask-this-project's-history + RFI suggested answers
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
  profitLeak:         { tier: 'fast', displayName: 'Profit Leak scan' },
  delayScan:          { tier: 'fast', displayName: 'Delay scan' },

  // Smart features — free gets a few trials, then paywall
  // projectMemory covers BOTH surfaces that answer from a project's records:
  // the Project Memory chat (Pro+, canAccess job_costing) and the RFI
  // "MAGE suggests an answer" button (Business+, canAccess rfis_submittals).
  // Both screens are tier-walled before this meter is reachable, so no
  // freeLifetimeCap — it just counts against the daily smart quota.
  // askMage is the One Mind chat (app/ask.tsx). It was previously UNMETERED
  // client-side (the pre-One-Mind hole); it now counts against the smart
  // quota like projectMemory, with a small free demo allowance so the ask
  // surface keeps its no-tier-wall entry (G6: "Ask MAGE keeps its current
  // gate"). Server-side the relay applies only the baseline gate — 'askMage'
  // is deliberately NOT in FEATURE_MIN_RANK (G9: OTA-safe, no server change).
  askMage:            { tier: 'smart', freeLifetimeCap: 3, displayName: 'Ask MAGE' },
  projectMemory:      { tier: 'smart', displayName: 'Project Memory' },
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
 * What Pro actually gives you for this class of call, in a sentence.
 *
 * Read from LIMITS above rather than typed, so the upgrade pitch and the quota
 * table on app/paywall.tsx cannot drift apart. A smart-tier feature is bounded
 * by pro.smart (6/day); a fast one only by the daily total (30/day).
 */
function proAllowanceSentence(requestTier: RequestTier): string {
  return requestTier === 'smart'
    ? `Pro includes ${LIMITS.pro.smart} advanced AI runs a day.`
    : `Pro includes ${LIMITS.pro.daily} AI requests a day.`;
}

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
  /** The daily reset as the user should read it — pass nextAiResetLabel().daily.
   *  Trailing and optional so this stays pure (no clock read here) and every
   *  existing positional caller keeps compiling. Absent, the copy names the
   *  boundary in UTC rather than claiming a local midnight it isn't. */
  dailyResetLabel?: string,
): LimitCheck {
  const resetSentence = dailyResetLabel ?? 'Resets at midnight UTC';
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
        // Never "unlimited": Pro is 30 AI requests a day and 6 advanced ones,
        // and app/paywall.tsx renders that table two taps from this message.
        // Promising unlimited here is retracted by our own pricing screen at
        // the moment the contractor is deciding to spend $29.
        message: `${cfg.displayName ?? feature} is a Pro feature. ${proAllowanceSentence(cfg.tier)}`,
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
          message: `You've used your ${cfg.freeLifetimeCap} free ${cfg.displayName ?? 'AI'} trials. ${proAllowanceSentence(cfg.tier)}`,
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
      ? `You've reached today's AI limit. ${resetSentence}.`
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
        ? `You've used today's advanced AI. ${resetSentence} — quick AI features still work until then.`
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

// ─── When the AI allowance really resets ────────────────────────────────────
//
// Every counter behind these limits is dated by the SERVER's clock, which runs
// in UTC: ai_daily_usage_get/increment key on `current_date`, the code-check
// and roadmap counters (ai_usage_daily_*) on CURRENT_DATE, and the monthly caps
// (ai_usage_get/increment) on date_trunc('month', now()). The client's own
// daily cache (aiRateLimiter.ts) keys on toISOString() — also UTC. So the
// daily allowance refills at 00:00 UTC, which is 8:00 PM in New York in the
// summer and 5:00 PM in Los Angeles, and the monthly caps roll over on the
// evening of the last day of the month for anyone in the Americas.
//
// The copy used to say "Resets at midnight" / "Try again tomorrow" / "Resets
// the 1st", which told a GC in New York who ran out at 3 PM to wait nine hours
// for something five hours away (audit #123/#128). The interim, until the
// founder decides whether to move the counter to each user's local day (a
// server-side change — never a client-supplied date: the RPCs are SECURITY
// DEFINER, and a date the client picks would let anyone refill the cap), is to
// say the true reset in the reader's own clock.
//
// Formatting is by hand, not toLocaleTimeString: newer ICU builds put a narrow
// no-break space before "PM" and Hermes' Intl differs by platform, and a label
// that the settings footer, the limit alert and the validator all compare must
// read the same everywhere.

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The next daily and monthly reset instants (00:00 UTC boundaries). */
export function nextAiResetAt(now: Date = new Date()): { daily: Date; monthly: Date } {
  return {
    daily: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)),
    monthly: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

/** "8:00 PM" in the device's zone. */
function localClock(d: Date): string {
  const h24 = d.getHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${h12}:${mm} ${h24 < 12 ? 'AM' : 'PM'}`;
}

function isLocalMidnight(d: Date): boolean {
  return d.getHours() === 0 && d.getMinutes() === 0;
}

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * The real reset moments, written in the device's own clock.
 *
 *   daily   — 'Resets at 8:00 PM' (later today), 'Resets tomorrow at 8:00 PM'
 *             (already past today's boundary), or 'Resets at midnight' for a
 *             reader whose zone IS UTC-aligned right now.
 *   monthly — 'Resets Sep 30, 8:00 PM' (the evening before the 1st, west of
 *             Greenwich), or 'Resets Oct 1' when the boundary is local midnight.
 *
 * Sentences without a trailing period, so callers can append their own
 * punctuation or a countdown.
 */
export function nextAiResetLabel(now: Date = new Date()): { daily: string; monthly: string } {
  const { daily, monthly } = nextAiResetAt(now);
  let dailyLabel: string;
  if (isLocalMidnight(daily)) {
    dailyLabel = 'Resets at midnight';
  } else if (sameLocalDay(daily, now)) {
    dailyLabel = `Resets at ${localClock(daily)}`;
  } else {
    dailyLabel = `Resets tomorrow at ${localClock(daily)}`;
  }
  const monthDay = `${MONTHS_SHORT[monthly.getMonth()]} ${monthly.getDate()}`;
  const monthlyLabel = isLocalMidnight(monthly)
    ? `Resets ${monthDay}`
    : `Resets ${monthDay}, ${localClock(monthly)}`;
  return { daily: dailyLabel, monthly: monthlyLabel };
}

/** "5h", "4h 12m" or "12m" until the next daily reset. */
export function timeUntilAiDailyReset(now: Date = new Date()): string {
  const diffMs = nextAiResetAt(now).daily.getTime() - now.getTime();
  const totalMinutes = Math.max(1, Math.round(diffMs / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/**
 * Rewrite a server cap message's "Resets the 1st…" into the real local moment.
 *
 * The relays (ai, construction-answer, the vision functions) write "Resets the
 * 1st of next month." into their 429 bodies. Their counter rolls at 00:00 UTC,
 * so for a US reader that is the evening of the last day — the server can't
 * know the reader's zone, the client can. A message with no such sentence is
 * returned untouched (an hourly limit keeps its own honest wording).
 */
export function withLocalMonthlyReset(message: string, now: Date = new Date()): string {
  const label = nextAiResetLabel(now).monthly;
  return message.replace(/Resets (?:on )?the 1st(?: of (?:next|the) month)?(?: \(UTC\))?\.?/i, `${label}.`);
}
