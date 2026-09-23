// ============================================================================
// utils/planFeatureCopy.ts — what each paid plan is SOLD as, derived from the
// gate table rather than typed next to it.
//
// WHY THIS EXISTS (audit wave 5, #125 / #171). components/Paywall.tsx's
// BUSINESS_BENEFITS listed 'Plan Viewer & markup tools' and 'RFIs, Submittals
// ...' as Business features, and the web plan tile in app/paywall.tsx read
// "Business: Everything in Pro + subs, RFIs, submittals, punch + closeout,
// plans" — while utils/featureTiers.ts unlocks plan_markup and rfis_submittals
// on PRO. A $29 buyer was steered to the $79 plan for work his plan already
// covered, and the Pro list meanwhile sold 'Daily Field Reports' and 'Price
// Alerts', which are open on Free. The comparison matrix on the same screen
// was already derived from REQUIRED_TIER and right; only the prose drifted.
//
// So each line names the FeatureKey(s) it describes, and the tier a line is
// shown under is READ from REQUIRED_TIER — a re-tier in featureTiers.ts moves
// the copy with it. A line may name several keys only if they share one tier
// (scripts/validate-w5-paywall-copy.ts fails a mixed line: "AI Photo Triage /
// Punch" spanning Pro and Business is exactly how a Pro buyer was promised
// punch items, #41).
//
// Pure: imports only the pure gate table.
// ============================================================================

import { REQUIRED_TIER } from '@/utils/featureTiers';
import type { FeatureKey } from '@/utils/featureTiers';

export interface PlanFeatureLine {
  /** The bullet as the upgrade modal prints it. */
  label: string;
  /** The gate(s) this line describes. All must share one REQUIRED_TIER. */
  keys: FeatureKey[];
  /** Short form for the one-line web plan tile; omitted = not in the tile. */
  short?: string;
}

/**
 * Display order is this array's order. Which plan a line appears under is not
 * written here — it is REQUIRED_TIER of its keys.
 */
export const PLAN_FEATURE_LINES: PlanFeatureLine[] = [
  { label: 'AI Cost Estimator', keys: ['ai_estimate_wizard'], short: 'AI estimates' },
  { label: 'Cash Flow Forecaster & Budget Health', keys: ['cash_flow_forecaster'], short: 'cash flow' },
  { label: 'Schedule Maker with Gantt & PDF export', keys: ['schedule_gantt_pdf'] },
  { label: 'Change Orders & Invoicing', keys: ['change_orders_invoicing'], short: 'change orders + invoicing' },
  { label: 'AIA-style G702/G703 pay apps', keys: ['aia_pay_app'], short: 'AIA-style G702/G703' },
  { label: 'Plan Viewer, sheet pins & markup', keys: ['plan_markup'], short: 'plan viewer' },
  { label: 'RFIs & Submittals', keys: ['rfis_submittals'], short: 'RFIs + submittals' },
  { label: 'Client Portal for your customers', keys: ['client_portal'] },
  { label: 'Photo documentation & AI Photo Triage', keys: ['photo_documentation'] },
  { label: 'Lien Waivers', keys: ['lien_waiver_manager'] },
  { label: 'Equipment tracking', keys: ['equipment_rental'] },
  // ── Business at the time of writing — but the tier is read, not assumed ──
  { label: 'Subcontractor management', keys: ['subcontractor_management'], short: 'subs' },
  { label: 'Punch List & Closeout packets', keys: ['punch_list_closeout'], short: 'punch + closeout' },
  { label: 'Safety management — JHAs, incidents, OSHA log', keys: ['safety_management'], short: 'safety' },
  { label: 'Crew profiles & certifications', keys: ['crew_management'], short: 'crews' },
  { label: 'WIP reporting & full Budget Dashboard', keys: ['wip_reporting', 'full_budget_dashboard'], short: 'WIP' },
  { label: 'Cost X-Ray', keys: ['cost_xray'], short: 'Cost X-Ray' },
  { label: 'Ask Your Plans', keys: ['ask_your_plans'], short: 'Ask Your Plans' },
  { label: 'Unlimited marketplace bid responses', keys: ['unlimited_bid_responses'] },
];

const RANK = { free: 0, pro: 1, business: 2 } as const;

/** The plan a line belongs to: the highest REQUIRED_TIER among its keys. */
export function lineTier(line: PlanFeatureLine): 'free' | 'pro' | 'business' {
  let best: 'free' | 'pro' | 'business' = 'free';
  for (const k of line.keys) {
    const t = REQUIRED_TIER[k];
    if (RANK[t] > RANK[best]) best = t;
  }
  return best;
}

/** Bullets for the plan that first unlocks them. Free-tier lines appear under no plan. */
export function planFeatureLines(tier: 'pro' | 'business'): string[] {
  return PLAN_FEATURE_LINES.filter((l) => lineTier(l) === tier).map((l) => l.label);
}

/** Comma-joined short forms for the web plan tile ("AI estimates, cash flow, …"). */
export function planFeatureBlurb(tier: 'pro' | 'business'): string {
  return PLAN_FEATURE_LINES
    .filter((l) => l.short && lineTier(l) === tier)
    .map((l) => l.short as string)
    .join(', ');
}
