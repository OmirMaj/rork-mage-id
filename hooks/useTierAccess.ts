import { useCallback, useMemo } from 'react';
import { useSubscription } from '@/contexts/SubscriptionContext';
import type { SubscriptionTier } from '@/types';

/**
 * Feature keys used across the app. When gating a screen or action,
 * always reference one of these keys so the tier-gating logic is centralized.
 */
export type FeatureKey =
  // Pro+ features
  | 'unlimited_projects'
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
  | 'budget_health_evm'
  | 'price_alerts'
  | 'change_orders_invoicing'
  | 'daily_field_reports'
  | 'schedule_scenarios'
  | 'job_costing'
  | 'prequal_coi'
  | 'plan_markup'
  // Business-only features
  | 'unlimited_bid_responses'
  | 'time_tracking'
  | 'quickbooks_sync'
  | 'plan_viewer'
  | 'subcontractor_management'
  | 'punch_list_closeout'
  | 'rfis_submittals'
  | 'full_budget_dashboard'
  // All tiers (with limits)
  | 'voice_commands'
  | 'post_homeowner_request'
  | 'post_community_bid';

/** The minimum tier required to unlock a feature. */
const REQUIRED_TIER: Record<FeatureKey, 'free' | 'pro' | 'business'> = {
  // Pro+
  unlimited_projects: 'pro',
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
  budget_health_evm: 'pro',
  price_alerts: 'pro',
  change_orders_invoicing: 'pro',
  daily_field_reports: 'pro',
  schedule_scenarios: 'pro',
  job_costing: 'pro',
  prequal_coi: 'pro',
  plan_markup: 'pro',
  // Business-only
  unlimited_bid_responses: 'business',
  time_tracking: 'business',
  quickbooks_sync: 'business',
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

/** Per-tier monthly quotas for features that have usage caps. */
export const FEATURE_LIMITS = {
  post_homeowner_request: { free: 2, pro: Infinity, business: Infinity },
  post_community_bid: { free: 2, pro: 8, business: 25 },
  ai_code_check_daily: { free: 3, pro: 20, business: Infinity },
} as const;

function tierMeetsRequirement(
  currentTier: SubscriptionTier,
  requiredTier: 'free' | 'pro' | 'business',
): boolean {
  if (requiredTier === 'free') return true;
  if (requiredTier === 'pro') return currentTier === 'pro' || currentTier === 'business';
  if (requiredTier === 'business') return currentTier === 'business';
  return false;
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
    (feature: FeatureKey): 'free' | 'pro' | 'business' => REQUIRED_TIER[feature],
    [],
  );

  const isProOrAbove = useMemo(() => tier === 'pro' || tier === 'business', [tier]);
  const isBusiness = useMemo(() => tier === 'business', [tier]);
  const isFree = useMemo(() => tier === 'free', [tier]);

  return useMemo(
    () => ({
      tier,
      isFree,
      isProOrAbove,
      isBusiness,
      canAccess,
      requiredTierFor,
    }),
    [tier, isFree, isProOrAbove, isBusiness, canAccess, requiredTierFor],
  );
}

export default useTierAccess;
