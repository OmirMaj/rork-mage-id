// ============================================================================
// utils/featureTiers.ts
//
// Pure tier-gating table — no React, no React Native. Extracted from
// hooks/useTierAccess.ts so that pure modules (utils/featureRegistry.ts) and
// the bun validators (scripts/validate-feature-search.ts) can answer
// "what tier unlocks feature X?" without dragging the Subscription context
// (and therefore React) into their import graph.
//
// hooks/useTierAccess.ts re-exports `FeatureKey` for backward compatibility —
// every existing `import type { FeatureKey } from '@/hooks/useTierAccess'`
// keeps working. The hook consumes REQUIRED_TIER / tierMeetsRequirement from
// here, so there is exactly ONE tier table in the app.
// ============================================================================

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
  | 'equipment_rental'
  | 'photo_documentation'
  | 'change_orders_invoicing'
  | 'aia_pay_app'
  | 'ai_estimate_wizard'
  | 'schedule_scenarios'
  | 'job_costing'
  | 'prequal_coi'
  | 'plan_markup'
  | 'schedule_import'
  // Business-only features
  | 'unlimited_bid_responses'
  | 'plan_viewer'
  | 'subcontractor_management'
  | 'punch_list_closeout'
  | 'rfis_submittals'
  | 'full_budget_dashboard'
  | 'wip_reporting'
  | 'safety_management'
  | 'crew_management'
  | 'scan_anything'
  | 'cost_xray'
  | 'bid_scoring'
  | 'ask_your_plans'
  | 'brain_accuracy'
  // All tiers (with limits)
  | 'post_homeowner_request'
  | 'post_community_bid';

/** The minimum tier required to unlock a feature. */
export const REQUIRED_TIER: Record<FeatureKey, 'free' | 'pro' | 'business'> = {
  // Pro+
  cash_flow_forecaster: 'pro',
  schedule_gantt_pdf: 'pro',
  ai_code_check: 'pro',
  client_portal: 'pro',
  lien_waiver_manager: 'pro',
  equipment_rental: 'pro',
  photo_documentation: 'pro',
  change_orders_invoicing: 'pro',
  aia_pay_app: 'pro',
  ai_estimate_wizard: 'pro',
  schedule_scenarios: 'pro',
  job_costing: 'pro',
  prequal_coi: 'pro',
  plan_markup: 'pro',
  schedule_import: 'pro',
  // Business-only
  unlimited_bid_responses: 'business',
  plan_viewer: 'business',
  subcontractor_management: 'business',
  punch_list_closeout: 'business',
  rfis_submittals: 'business',
  full_budget_dashboard: 'business',
  wip_reporting: 'business',
  safety_management: 'business',
  crew_management: 'business',
  scan_anything: 'business',
  cost_xray: 'business',
  bid_scoring: 'business',
  ask_your_plans: 'business',
  brain_accuracy: 'business',
  // Available to all
  post_homeowner_request: 'free',
  post_community_bid: 'free',
};

export function tierMeetsRequirement(
  currentTier: SubscriptionTier,
  requiredTier: 'free' | 'pro' | 'business' | 'enterprise',
): boolean {
  // Numeric rank — higher current tier always satisfies a lower requirement.
  // Enterprise (3) ≥ Business (2) ≥ Pro (1) ≥ Free (0).
  const rank: Record<SubscriptionTier, number> = { free: 0, pro: 1, business: 2, enterprise: 3 };
  return rank[currentTier] >= rank[requiredTier];
}
