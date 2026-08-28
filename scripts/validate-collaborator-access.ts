// validate-collaborator-access.ts — an invited teammate can do the work.
//
// THE BUG. Tier resolves only from the individual's own subscription. A GC on
// Business invites a foreman; the foreman's own tier is free; every field
// screen (punch list, punch walk, AI punch, RFIs, safety incidents) gates on a
// Business feature and paywalls. The person invited to do field work could not
// do any field work — which voided collaboration, the 'field' role, and the
// per-seat pricing built on top of it.
//
// Pins INTENDED semantics:
//   • an accepted collaborator (editor/viewer/field) may open PROJECT-SCOPED
//     work on that project regardless of their personal tier
//   • they do NOT inherit the GC's cross-project business (cost book, portfolio
//     margin, WIP, cash flow, bidding) — that is the owner's book, not this job
//   • a non-collaborator (null role) is never granted anything
//   • the OWNER is never routed through the grant — otherwise a free GC would
//     unlock paid features on their own project
//   • a paying collaborator is unaffected: own-tier access always wins
//   • the two feature lists never overlap — an overlap would make the grant
//     order-dependent and unauditable
//
// Run via: bun run test:collaborator-access

import {
  collaboratorMayAccess,
  resolveProjectAccess,
  COLLABORATOR_PROJECT_FEATURES,
  OWNER_ONLY_FEATURES,
} from '../utils/collaboratorAccess';

let failures = 0;
function check(label: string, cond: boolean) {
  if (!cond) { console.error(`  FAIL: ${label}`); failures++; }
}

// ── the bug, directly ───────────────────────────────────────────────────────
// Every screen the foreman needs, at the tier they actually have (free).
for (const feature of ['punch_list_closeout', 'rfis_submittals', 'safety_management']) {
  check(`field collaborator may open ${feature}`,
    resolveProjectAccess(false, 'field', feature) === true);
  check(`editor collaborator may open ${feature}`,
    resolveProjectAccess(false, 'editor', feature) === true);
  check(`viewer collaborator may open ${feature}`,
    resolveProjectAccess(false, 'viewer', feature) === true);
}

// ── they do NOT inherit the GC's business ───────────────────────────────────
for (const feature of ['job_costing', 'portfolio_margin', 'wip_reporting', 'cash_flow_forecaster', 'cost_xray']) {
  check(`collaborator does NOT inherit ${feature}`,
    resolveProjectAccess(false, 'field', feature) === false);
  check(`…not even an editor: ${feature}`,
    resolveProjectAccess(false, 'editor', feature) === false);
}

// ── non-collaborators get nothing ───────────────────────────────────────────
check('null role (loading / not invited) is granted nothing',
  resolveProjectAccess(false, null, 'punch_list_closeout') === false);
check('…and cannot reach owner-only either',
  resolveProjectAccess(false, null, 'job_costing') === false);

// ── the OWNER is never routed through the grant ─────────────────────────────
// Otherwise a free GC unlocks paid features on their own project — the grant
// would become a way to avoid paying at all.
check('owner is not granted by the collaborator path',
  collaboratorMayAccess('owner', 'punch_list_closeout') === false);
check('a FREE owner still cannot open a paid feature',
  resolveProjectAccess(false, 'owner', 'punch_list_closeout') === false);
check('…but a paying owner is unaffected',
  resolveProjectAccess(true, 'owner', 'punch_list_closeout') === true);

// ── own-tier access always wins ─────────────────────────────────────────────
check('a paying collaborator keeps access to owner-only features',
  resolveProjectAccess(true, 'field', 'job_costing') === true);
check('own tier wins for project features too',
  resolveProjectAccess(true, 'viewer', 'punch_list_closeout') === true);

// ── the lists are disjoint ──────────────────────────────────────────────────
{
  const overlap = [...COLLABORATOR_PROJECT_FEATURES].filter(f => OWNER_ONLY_FEATURES.has(f));
  check(`no feature is in both lists (found: ${overlap.join(', ') || 'none'})`, overlap.length === 0);
}

// ── an unknown feature key is denied, not defaulted open ────────────────────
check('unlisted feature is NOT granted',
  resolveProjectAccess(false, 'field', 'some_future_feature') === false);

// ── the field role is still blinded from money by the OTHER axis ────────────
// collaboratorAccess decides whether a screen OPENS; roleBlinding decides
// whether money shows on it. Both must hold for the field role to be safe.
check('collaborator grant does not include job_costing (money screen)',
  !COLLABORATOR_PROJECT_FEATURES.has('job_costing'));

if (failures > 0) {
  console.error(`\n✗ validate-collaborator-access: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('✓ validate-collaborator-access: all checks passed');
