// utils/copilot/turnMeter.ts — how a Copilot interview is charged against the
// AI allowance. Pure (the check / record functions are injected) so a
// validator can run whole interviews through the real evaluateLimit.
//
// WHY THIS EXISTS (#35). Every turn used to call checkAILimit(tier, 'smart',
// feature) and recordAIUsage('smart', feature):
//   - a free daily report / CO / billing hit the free smart cap of 0 on turn 1
//     ("Advanced AI requires Pro") though those features are 'fast' and free;
//   - a voice RFI or punch item spent all 3 free Voice Capture trials in one
//     interview, and a 4-question warranty died before its last question;
//   - a Pro GC spent his 6/day advanced quota in about two items, which also
//     locked Ask MAGE.
// Now: the feature's REAL cost class (FEATURE_CONFIG[feature].tier), and ONE
// charge per interview — checked before the first turn, recorded on the first
// successful turn, never again until the interview restarts.
import { FEATURE_CONFIG, type AIFeature, type LimitCheck, type RequestTier } from '@/utils/aiRateLimiterCore';

export interface MeterPlan { feature: AIFeature; tier: RequestTier }

/** The meter an interview's turns draw on. */
export function interviewMeterPlan(cap: { aiFeature: AIFeature; turnMeterFeature?: AIFeature }): MeterPlan {
  const feature = cap.turnMeterFeature ?? cap.aiFeature;
  return { feature, tier: FEATURE_CONFIG[feature]?.tier ?? 'fast' };
}

export interface InterviewMeter {
  /** Before a turn's model call. Only the first metered turn asks the limiter;
   *  later turns of the same interview are already paid for. */
  gate(): Promise<LimitCheck>;
  /** After a turn's model call. The first SUCCESSFUL turn records one unit; a
   *  failed call records nothing (so a dropped signal never costs a trial). */
  settle(success: boolean): void;
  /** START / cancel: the next interview is charged again. */
  reset(): void;
  readonly metered: boolean;
}

export function createInterviewMeter(deps: {
  check: (tier: RequestTier, feature: AIFeature) => Promise<LimitCheck>;
  record: (tier: RequestTier, feature: AIFeature) => unknown;
  plan: () => MeterPlan;
}): InterviewMeter {
  let metered = false;
  return {
    async gate() {
      if (metered) return { allowed: true, remaining: 0 };
      const { tier, feature } = deps.plan();
      return deps.check(tier, feature);
    },
    settle(success: boolean) {
      if (!success || metered) return;
      metered = true;
      const { tier, feature } = deps.plan();
      void deps.record(tier, feature);
    },
    reset() { metered = false; },
    get metered() { return metered; },
  };
}

/** Limit reasons the error screen answers with 'See plans' → /paywall. The
 *  server's monthly cap (mageAI errorKind 'monthly_cap') is one of them. */
export const LIMIT_ERROR_KINDS: ReadonlySet<string> = new Set([
  'lifetime_cap', 'smart_cap', 'pro_only', 'daily_cap', 'monthly_cap',
]);

export function isLimitErrorKind(kind: string | undefined): boolean {
  return !!kind && LIMIT_ERROR_KINDS.has(kind);
}

/** True when the draft holds anything he actually said — a value that is not
 *  null / undefined / '' / an empty array. A cap hit after that point goes to
 *  review ("built from what you said so far"), not to an error: RFI, punch,
 *  warranty and daily-report apply() need no AI. */
export function draftHasContent(draft: unknown): boolean {
  if (!draft || typeof draft !== 'object') return false;
  return Object.values(draft as Record<string, unknown>).some((v) => {
    if (v == null) return false;
    if (typeof v === 'string') return v.trim().length > 0;
    if (Array.isArray(v)) return v.length > 0;
    return true;
  });
}

export const LIMIT_REACHED_NOTE = 'AI limit reached — built from what you said so far.';

/** What a limit hit does to the interview. */
export function onLimitHit(draft: unknown): 'review' | 'error' {
  return draftHasContent(draft) ? 'review' : 'error';
}
