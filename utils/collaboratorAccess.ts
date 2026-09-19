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
// data is RLS, which scopes the project child tables to the project owner or
// an ACCEPTED collaborator (20260803140000_collaborator_rls_field_tables.sql).
// A collaborator who reaches these screens can only ever see rows for
// projects they were invited to.
//
// SAFETY (#82, 20260919130000_safety_project_rls.sql — apply BEFORE the OTA).
// 'safety_management' opens incidents AND toolbox talks, JHAs, hazards and
// inspections. Under that migration a record a field/editor collaborator files
// reaches the PROJECT OWNER (project-scoped RLS via can_access_project); the
// collaborator sees only the rows he wrote himself; only the owner deletes;
// viewers cannot file. Before it is applied the five tables were owner-row-
// only, so a collaborator's filing stayed his own and never reached the GC.
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
  // Clocking the GC's crew in and out on THIS job (#62). Its own key, NOT
  // 'subcontractor_management': that one also gates the GC's cross-job sub
  // book, which stays OWNER_ONLY below. Field and editor seats only — see
  // FEATURE_ROLES (a viewer cannot clock anyone in; RLS on time_entries needs
  // can_access_project(…, 'field') to insert, so it would fail anyway).
  // FOUNDER DECISION PENDING (seat pricing, #62): this is the interim — the
  // GC's Business plan covers his invited foreman clocking HIS crew on HIS
  // jobs. If seats should be paid instead, this key comes out.
  'crew_time_tracking',
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

/**
 * Features a collaborator gets only in SOME roles. A key absent from this map
 * is open to every collaborator role (editor, viewer, field) once it is in
 * COLLABORATOR_PROJECT_FEATURES.
 */
export const FEATURE_ROLES: Readonly<Record<string, readonly NonNullable<ProjectRole>[]>> = {
  crew_time_tracking: ['editor', 'field'],
};

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
  if (!COLLABORATOR_PROJECT_FEATURES.has(feature)) return false;
  const roles = FEATURE_ROLES[feature];
  return !roles || (role !== null && roles.includes(role));
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

export type ClockGate =
  | { kind: 'ok' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'blocked'; reason: string };

/**
 * May this user clock crew in on the selected job (Time Tracking, #62)?
 *
 * `stampedRole` is the seat ProjectContext stamped on the project when it
 * loaded (Project.myRole) — undefined on the user's OWN job. `live` is
 * useProjectRoleState for that job, a network-only read.
 *
 * OFFLINE IS THE JOBSITE. Time Tracking is offline-first: the GC clocks his
 * crew in with no signal, and the live role read on a cold start with no
 * signal sits loading (the query is paused) and then errors. So:
 *   • his OWN job never waits on the collaborator read — his tier decides;
 *   • a job stamped field/editor falls back to that stamp while the live read
 *     is loading or has failed (the server's RLS still decides whether the
 *     queued time_entries write lands);
 *   • only a job stamped viewer (or unstamped-and-unknown) shows the spinner /
 *     retry, and a RESOLVED null role (a removed collaborator's cached job)
 *     states why, never spins — the GATING CONTRACT.
 */
export function resolveClockGate(args: {
  hasProject: boolean;
  stampedRole: ProjectRole | undefined;
  ownTierAllows: boolean;
  live: { role: ProjectRole; isLoading: boolean; isError: boolean };
}): ClockGate {
  const { hasProject, stampedRole, ownTierAllows, live } = args;
  if (!hasProject) return { kind: 'ok' };
  const business: ClockGate = { kind: 'blocked', reason: 'Clocking crew in on your own jobs needs Business.' };
  const viewer: ClockGate = { kind: 'blocked', reason: 'Clocking crew in on this job needs a field or editor seat. You have view access.' };
  if (stampedRole == null || stampedRole === 'owner') return ownTierAllows ? { kind: 'ok' } : business;
  if (live.isLoading || live.isError) {
    if (stampedRole === 'field' || stampedRole === 'editor') return { kind: 'ok' };
    return live.isLoading ? { kind: 'loading' } : { kind: 'error' };
  }
  if (live.role === null) return { kind: 'blocked', reason: 'You no longer have access to this job, so you cannot clock crew in on it.' };
  if (resolveProjectAccess(ownTierAllows, live.role, 'crew_time_tracking')) return { kind: 'ok' };
  return live.role === 'viewer' ? viewer : business;
}
