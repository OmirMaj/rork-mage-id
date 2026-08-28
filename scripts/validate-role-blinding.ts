// validate-role-blinding.ts — pins who can see the money.
//
// WHY THIS EXISTS. The 'field' collaborator role exists so a GC can put a
// foreman or sub on a project's schedule and daily reports WITHOUT handing them
// the job's costs and margins. utils/roleBlinding is the single source of truth
// for that line; if it drifts, a financial surface leaks. The one rule that
// must never regress: canViewFinancials fails CLOSED — a null (still-loading or
// signed-out) role is treated as blinded, so a margin never flashes before the
// role resolves.
//
// Pins INTENDED semantics:
//   • owner / editor / viewer CAN see financials
//   • field CANNOT
//   • null (loading / signed-out) CANNOT — fail closed
//   • isFinancialsBlinded is the strict inverse for a RESOLVED role, and is
//     false for null (fail OPEN) — the two helpers have deliberately different
//     null behavior, so their callers must pick the right one
//   • every role has a label and a description for the invite UI
//
// Run via: bun run test:role-blinding

import {
  canViewFinancials,
  isFinancialsBlinded,
  FINANCIAL_BLIND_ROLES,
  ROLE_LABELS,
  ROLE_DESCRIPTIONS,
} from '../utils/roleBlinding';

let failures = 0;
function check(label: string, cond: boolean) {
  if (!cond) {
    console.error(`  FAIL: ${label}`);
    failures++;
  }
}

// --- canViewFinancials: owner/editor/viewer yes, field/null no --------------
check('owner can view financials', canViewFinancials('owner') === true);
check('editor can view financials', canViewFinancials('editor') === true);
check('viewer can view financials', canViewFinancials('viewer') === true);
check('field CANNOT view financials', canViewFinancials('field') === false);
check('null fails CLOSED (cannot view)', canViewFinancials(null) === false);

// --- isFinancialsBlinded: strict inverse for resolved roles -----------------
check('field is blinded', isFinancialsBlinded('field') === true);
check('owner is not blinded', isFinancialsBlinded('owner') === false);
check('viewer is not blinded', isFinancialsBlinded('viewer') === false);
// deliberate asymmetry: this one is fail-OPEN on null (callers that need
// fail-closed must use canViewFinancials instead)
check('null is not "blinded" by isFinancialsBlinded (fail open)', isFinancialsBlinded(null) === false);

// --- the two helpers agree for every RESOLVED role --------------------------
for (const r of ['owner', 'editor', 'viewer', 'field'] as const) {
  check(`resolved role ${r}: helpers are consistent`, canViewFinancials(r) === !isFinancialsBlinded(r));
}

// --- config sanity ----------------------------------------------------------
check('field is the (only) blinded role today',
  FINANCIAL_BLIND_ROLES.length === 1 && FINANCIAL_BLIND_ROLES[0] === 'field');
check('every role has a label',
  ['owner', 'editor', 'viewer', 'field'].every(r => typeof ROLE_LABELS[r as 'field'] === 'string'));
check('every role has a description',
  ['owner', 'editor', 'viewer', 'field'].every(r => typeof ROLE_DESCRIPTIONS[r as 'field'] === 'string'));
check('field description mentions no costs/margins',
  /no costs|margin/i.test(ROLE_DESCRIPTIONS.field));

if (failures > 0) {
  console.error(`\n✗ validate-role-blinding: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('✓ validate-role-blinding: all checks passed');
