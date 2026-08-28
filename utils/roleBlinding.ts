// roleBlinding.ts — who on a project is allowed to see the money.
//
// THE GAP. Until now every collaborator role (owner/editor/viewer) saw the same
// thing: your costs, margins, markups, budgets, and the learned cost book. So a
// GC couldn't put a foreman or a sub on the job's schedule and daily reports
// without also handing them the exact margin on the work — the one number a
// contractor guards hardest. That missing "field" role is why crews stay off
// the platform, which starves the very data (labor hours, field notes) the moat
// needs.
//
// THE ROLE. 'field' gets the operational surface — schedule, tasks, daily
// reports, photos, RFIs, punch list — and NOTHING financial. This module is the
// single, pure source of truth for that line so every surface blinds the same
// way (no screen inventing its own rule and leaking).
//
// SCOPE. Client-side blinding is defense-in-depth and a trust signal — it hides
// the numbers in the UI. It is NOT the security boundary: a determined field
// user with the API could still read rows the client hid. Row-level enforcement
// (the field-role RLS migration) is what actually withholds the data, and is
// tracked separately as a founder decision. Keep both in sync: anything blinded
// here should also be denied there.

import type { ProjectRole } from '@/utils/projectRole';

/** The one role that is blinded from financials today. */
export const FINANCIAL_BLIND_ROLES: ReadonlyArray<NonNullable<ProjectRole>> = ['field'];

/**
 * May a user in this role see money on the project — costs, margins, markups,
 * budgets, job-costing, the cost book, bid/win pricing?
 *
 * `null` (loading / signed-out) returns false: fail CLOSED, never flash a
 * margin before the role resolves.
 */
export function canViewFinancials(role: ProjectRole): boolean {
  if (!role) return false;
  return !FINANCIAL_BLIND_ROLES.includes(role);
}

/** Convenience inverse — true when the current role must have financials hidden. */
export function isFinancialsBlinded(role: ProjectRole): boolean {
  return role != null && FINANCIAL_BLIND_ROLES.includes(role);
}

/** Human labels for the invite/role UI. */
export const ROLE_LABELS: Record<NonNullable<ProjectRole>, string> = {
  owner: 'Owner',
  editor: 'Editor',
  viewer: 'Viewer',
  field: 'Field',
};

/** One-line descriptions for the role picker. */
export const ROLE_DESCRIPTIONS: Record<NonNullable<ProjectRole>, string> = {
  owner: 'Full access',
  editor: 'Can edit everything',
  viewer: 'Read-only, sees financials',
  field: 'Schedule & field work — no costs or margins',
};
