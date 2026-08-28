// collaboratorAccess.ts — an invited teammate can actually use the project.
//
// THE BUG THIS FIXES. Tier resolves ONLY from the individual's own RevenueCat
// entitlements and their own `subscriptions` row (SubscriptionContext keys on
// `.eq('user_id', userId)`), with one override for the founder's email. There
// is no notion of inheriting anything from the project you were invited to.
//
// So: a GC on Business invites a foreman. The foreman accepts, opens the punch
// list — app/punch-list.tsx gates on canAccess('punch_list_closeout'), which is
// a Business feature — and their OWN tier is free. Paywall. Same for RFIs
// (rfis_submittals), safety incidents (safety_management), punch walk and AI
// punch. The person you invited to do field work cannot do any field work.
//
// That quietly voided the whole collaboration feature, the 'field' role, and
// the per-seat pricing built on top of it: you could invite people, meter them,
// and hand them an app that paywalls on first tap.
//
// ── WHY GRANTING THIS IS SAFE ───────────────────────────────────────────────
// The tier gate here is MONETISATION, not security. What actually protects
// data is RLS, which already scopes every project child table to the project
// owner or an ACCEPTED collaborator (20260803140000_collaborator_rls_field_
// tables.sql). A collaborator who reaches these screens can only ever see rows
// for projects they were invited to.
//
// And the owner already paid: collaboration itself requires Pro+
// (schedule_collaboration), and seats are metered (utils/seatModel). Charging
// the invitee a second time for the privilege of doing the owner's work is
// double-dipping on a seat that has already been sold.
//
// ── WHAT IS *NOT* GRANTED ───────────────────────────────────────────────────
// Only PROJECT-SCOPED work. A collaborator does not inherit the GC's business:
// no cost database, no portfolio margin, no WIP, no estimate scorecard, no
// cash-flow forecaster. Those are the GC's own book across all their jobs, not
// the job this person was invited to.
//
// Financial blinding for the 'field' role is a SEPARATE axis and still applies
// on top of this (utils/roleBlinding) — this decides whether a screen opens at
// all; that decides whether money is visible on it.
//
// Pure — no React, no network. Pinned by test:collaborator-access.

import type { ProjectRole } from '@/utils/projectRole';

/**
 * Features an accepted collaborator may use ON A PROJECT THEY WERE INVITED TO,
 * regardless of their own subscription tier.
 *
 * The test: is this the work of executing THIS project? If yes it belongs here.
 * If it is the GC's cross-project business intelligence, it does not.
 */
export const COLLABORATOR_PROJECT_FEATURES: ReadonlySet<string> = new Set([
  // Field execution — the reason people get invited at all.
  'punch_list_closeout',
  'rfis_submittals',
  'safety_management',
  'photo_documentation',
  'plan_markup',
  'scan_anything',
  'crew_management',
  // Reading and running the job's schedule.
  'schedule_collaboration',
  'schedule_gantt_pdf',
  'schedule_scenarios',
  'schedule_import',
  // Project paperwork that field work produces or consumes.
  'change_orders_invoicing',
  'ask_your_plans',
  'construction_answer',
]);

/**
 * Features that stay tied to the viewer's OWN subscription even on a project
 * they collaborate on. Listed explicitly rather than inferred, so adding a new
 * feature key never silently widens what a collaborator inherits.
 *
 * These are the GC's book across every job — not this project's work.
 */
export const OWNER_ONLY_FEATURES: ReadonlySet<string> = new Set([
  'job_costing',
  'portfolio_margin',
  'full_budget_dashboard',
  'cash_flow_forecaster',
  'wip_reporting',
  'cost_xray',
  'aia_pay_app',
  'lien_waiver_manager',
  'brain_accuracy',
  'bid_scoring',
  'unlimited_bid_responses',
  'post_community_bid',
  'post_homeowner_request',
  'subcontractor_management',
  'prequal_coi',
  'client_portal',
  'equipment_rental',
  'ai_estimate_wizard',
  'ai_code_check',
]);

/** Roles that count as an accepted teammate on the project. */
function isCollaborator(role: ProjectRole): boolean {
  return role === 'editor' || role === 'viewer' || role === 'field';
}

/**
 * Should `feature` open for this collaborator on this project, irrespective of
 * their personal tier?
 *
 * Returns false for the project OWNER too — an owner is already covered by
 * their own tier, and routing them through this path would let a free GC
 * unlock paid features on their own project.
 */
export function collaboratorMayAccess(role: ProjectRole, feature: string): boolean {
  if (!isCollaborator(role)) return false;
  if (OWNER_ONLY_FEATURES.has(feature)) return false;
  return COLLABORATOR_PROJECT_FEATURES.has(feature);
}

/**
 * The effective answer for a project-scoped screen: the viewer's own tier
 * access OR the collaborator grant.
 *
 * `ownTierAllows` is whatever useTierAccess().canAccess(feature) returned, so
 * a paying collaborator is unaffected and an owner behaves exactly as before.
 */
export function resolveProjectAccess(
  ownTierAllows: boolean,
  role: ProjectRole,
  feature: string,
): boolean {
  return ownTierAllows || collaboratorMayAccess(role, feature);
}
