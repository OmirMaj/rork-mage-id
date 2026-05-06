import { useCallback, useMemo } from 'react';
import { useSubscription } from '@/contexts/SubscriptionContext';
import type { SubscriptionTier } from '@/types';

/**
 * Feature keys used across the app. When gating a screen or action,
 * always reference one of these keys so the tier-gating logic is centralized.
 */
export type FeatureKey =
  // Pro+ features
  | 'cash_flow_forecaster'
  | 'schedule_gantt_pdf'
  | 'ai_code_check'
  | 'client_portal'
  | 'lien_waiver_manager'
  | 'proposal_templates'
  | 'equipment_rental'
  | 'custom_templates'
  | 'voice_to_report'
  | 'pdf_export'
  | 'photo_documentation'
  | 'change_orders_invoicing'
  | 'aia_pay_app'
  | 'ai_estimate_wizard'
  | 'daily_field_reports'
  | 'schedule_scenarios'
  | 'job_costing'
  | 'prequal_coi'
  | 'plan_markup'
  // Business-only features
  | 'unlimited_bid_responses'
  | 'plan_viewer'
  | 'subcontractor_management'
  | 'punch_list_closeout'
  | 'rfis_submittals'
  | 'full_budget_dashboard'
  // All tiers (with limits)
  | 'voice_commands'
  | 'post_homeowner_request'
  | 'post_community_bid';

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

/** The minimum tier required to unlock a feature. */
const REQUIRED_TIER: Record<FeatureKey, 'free' | 'pro' | 'business'> = {
  // Pro+
  cash_flow_forecaster: 'pro',
  schedule_gantt_pdf: 'pro',
  ai_code_check: 'pro',
  client_portal: 'pro',
  lien_waiver_manager: 'pro',
  proposal_templates: 'pro',
  equipment_rental: 'pro',
  custom_templates: 'pro',
  voice_to_report: 'pro',
  pdf_export: 'pro',
  photo_documentation: 'pro',
  change_orders_invoicing: 'pro',
  aia_pay_app: 'pro',
  ai_estimate_wizard: 'pro',
  daily_field_reports: 'pro',
  schedule_scenarios: 'pro',
  job_costing: 'pro',
  prequal_coi: 'pro',
  plan_markup: 'pro',
  // Business-only
  unlimited_bid_responses: 'business',
  plan_viewer: 'business',
  subcontractor_management: 'business',
  punch_list_closeout: 'business',
  rfis_submittals: 'business',
  full_budget_dashboard: 'business',
  // Available to all
  voice_commands: 'free',
  post_homeowner_request: 'free',
  post_community_bid: 'free',
};

/** Per-tier monthly quotas for features that have usage caps. Enterprise
 *  values match Business unless explicitly higher — added so callsites
 *  that iterate FEATURE_LIMITS by tier see all four tiers. */
export const FEATURE_LIMITS = {
  post_homeowner_request: { free: 2, pro: Infinity, business: Infinity, enterprise: Infinity },
  post_community_bid:     { free: 2, pro: 8,        business: 25,       enterprise: 50 },
  ai_code_check_daily:    { free: 3, pro: 15,       business: 50,       enterprise: Infinity },
} as const;

function tierMeetsRequirement(
  currentTier: SubscriptionTier,
  requiredTier: 'free' | 'pro' | 'business' | 'enterprise',
): boolean {
  // Numeric rank — higher current tier always satisfies a lower requirement.
  // Enterprise (3) ≥ Business (2) ≥ Pro (1) ≥ Free (0).
  const rank: Record<SubscriptionTier, number> = { free: 0, pro: 1, business: 2, enterprise: 3 };
  return rank[currentTier] >= rank[requiredTier];
}

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
    }),
    [tier, isFree, isProOrAbove, isBusiness, isBusinessOrAbove, isEnterprise, canAccess, requiredTierFor],
  );
}

export default useTierAccess;
