import { useCallback, useMemo } from 'react';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { REQUIRED_TIER, tierMeetsRequirement } from '@/utils/featureTiers';
import type { FeatureKey } from '@/utils/featureTiers';

// The FeatureKey union + REQUIRED_TIER table now live in utils/featureTiers.ts
// (pure, React-free) so the feature-search registry and bun validators can
// import them. Re-exported here so existing
// `import type { FeatureKey } from '@/hooks/useTierAccess'` callsites keep
// working unchanged.
export type { FeatureKey } from '@/utils/featureTiers';

// Removed in May 2026 audit (no callsites, no honest claim):
//   - 'unlimited_projects'   — no project-count limiter exists; row pulled
//                              from paywall since "unlimited" is the truth
//                              for every tier including free.
//   - 'budget_health_evm'    — redundant with 'full_budget_dashboard'.
//   - 'price_alerts'         — paywall claim was unenforced; the price-alert
//                              CRUD in ProjectContext is open. Either restore
//                              with a callsite or the row is honest as
//                              "available in all tiers."
//   - 'time_tracking'        — feature ships as MOCK_TIME_ENTRIES with no
//                              persistence. Paywall claim removed in audit
//                              cleanup #5; restore the key when real
//                              persistence is built.
//   - 'quickbooks_sync'      — no real OAuth flow. Removed from paywall as
//                              part of audit cleanup #5.
//
// Removed in Jul 2026 audit (wave 1.1, A6 — dead key cleanup):
//   - 'voice_commands'    — zero callsites outside useTierAccess.ts itself
//                          (grep-verified 2026-07-24). No UI ever checked this
//                          key; removing it keeps the FeatureKey union honest.
//   - 'proposal_templates' — smart-proposal.tsx gates on 'job_costing' at line 44,
//                            not proposal_templates. Dead since the screen was built.
//   - 'custom_templates'   — zero callsites anywhere (grep-verified 2026-07-24).
//
// Removed in May 2026 re-audit (Tier 2):
//   - 'pdf_export'           — every PDF export across the app uses
//                              expo-print + Share natively, no callsite ever
//                              gated on this key. Paywall row pulled.
//   - 'voice_to_report'      — daily-report voice capture only ships on iOS
//                              native; no FeatureKey check exists. The mic
//                              icon is hidden on web/Android by Platform.OS,
//                              not by tier.
//   - 'daily_field_reports'  — the Daily Reports screen is open to all tiers.
//                              No gating callsite was ever wired up.

/** Per-tier monthly quotas for features that have usage caps. Enterprise
 *  values match Business unless explicitly higher — added so callsites
 *  that iterate FEATURE_LIMITS by tier see all four tiers. */
export const FEATURE_LIMITS = {
  post_homeowner_request: { free: 2, pro: Infinity, business: Infinity, enterprise: Infinity },
  post_community_bid:     { free: 2, pro: 8,        business: 25,       enterprise: 50 },
  ai_code_check_daily:    { free: 3, pro: 15,       business: 50,       enterprise: Infinity },
  ai_permit_roadmap_daily: { free: 2, pro: 15,       business: 50,       enterprise: Infinity },
  // Plan review is metered PER MONTH, not per day — the server is the
  // authority (analyze-plan-code reads MONTHLY_CAPS[tier].plan_code_review
  // and returns a 429 `monthly_cap_reached`). These numbers MUST match that
  // table. The client pre-check must read the MONTHLY counter
  // (ai_usage_get 'plan_code_review'), never a daily counter — otherwise a
  // Pro user burns all 10 in one day, sees a fresh "daily" budget tomorrow,
  // and hits an opaque server 429 on the first attempt.
  ai_plan_review_monthly:  { free: 0, pro: 10,       business: 30,       enterprise: 60 },
  // Free tier: 1 real project (the "1 free project + client portal" promise).
  // Sample/demo projects are excluded by the caller before comparing.
  maxProjects:             { free: 1, pro: Infinity, business: Infinity, enterprise: Infinity },
} as const;

/**
 * Central access-control hook. Returns the current tier and a `canAccess`
 * helper that answers: "Can this user use <featureKey>?"
 *
 * @example
 * const { tier, canAccess, requiredTierFor } = useTierAccess();
 * if (!canAccess('cash_flow_forecaster')) { showPaywall(); return; }
 */
export function useTierAccess() {
  const { tier } = useSubscription();

  const canAccess = useCallback(
    (feature: FeatureKey): boolean => {
      const required = REQUIRED_TIER[feature];
      return tierMeetsRequirement(tier, required);
    },
    [tier],
  );

  const requiredTierFor = useCallback(
    (feature: FeatureKey): 'free' | 'pro' | 'business' | 'enterprise' => REQUIRED_TIER[feature],
    [],
  );

  const canCreateProject = useCallback(
    (realProjectCount: number): boolean => realProjectCount < FEATURE_LIMITS.maxProjects[tier],
    [tier],
  );

  // Tier-bucket helpers. Each "OrAbove" includes higher tiers — Enterprise
  // satisfies any Business/Pro check.
  const isProOrAbove = useMemo(() => tier === 'pro' || tier === 'business' || tier === 'enterprise', [tier]);
  const isBusinessOrAbove = useMemo(() => tier === 'business' || tier === 'enterprise', [tier]);
  const isEnterprise = useMemo(() => tier === 'enterprise', [tier]);
  const isFree = useMemo(() => tier === 'free', [tier]);
  // Backward-compat alias — pre-existing call sites use isBusiness to mean
  // "≥ business," which now includes enterprise.
  const isBusiness = isBusinessOrAbove;

  return useMemo(
    () => ({
      tier,
      isFree,
      isProOrAbove,
      isBusiness,
      isBusinessOrAbove,
      isEnterprise,
      canAccess,
      requiredTierFor,
      canCreateProject,
    }),
    [tier, isFree, isProOrAbove, isBusiness, isBusinessOrAbove, isEnterprise, canAccess, requiredTierFor, canCreateProject],
  );
}

export default useTierAccess;
