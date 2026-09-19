// project-memory-embed/planScope.ts — pure. WHOSE plan index a request reads
// and writes, and WHOSE plan pays for it (audit #161).
//
// Zero Deno / network imports so scripts can drive it under bun; the I/O half
// (owner lookup, owner tier) is planScopeIo.ts.
//
// THE BUG. memory_embeddings is keyed (user_id, doc_id), and search, embed and
// plan-extract all used the CALLER's id and the CALLER's tier. So the plan set
// the GC paid to index was invisible to his PM or super: their search ran over
// their own (empty) pool, or requireTier refused a free seat outright, and
// tapping Index spent their own plan_extract allowance (0 on Pro) and failed.
//
// THE RULE. For plan-sheet docs ONLY, the index belongs to the PROJECT: after
// confirming the caller may access the project (owner, or an accepted
// collaborator — can_access_project's arms), rows are read and written under
// the OWNER's user_id, and tier + monthly caps are checked against the OWNER's
// plan. The hourly rate limit stays on the caller (it bounds one person's
// loop, not the GC's bill). Only the owner or an editor may WRITE to the index
// (embed, prune, plan-extract through it): a viewer or field seat asks, it
// does not spend the owner's allowance or delete his rows.
//
// NOT widened: Project Memory rows (rfi-, dfr-, co-, sub-, punch-) stay under
// the caller's own id. They can carry figures a field seat is blinded from, so
// a collaborator must never read the owner's copy as a side effect of this.

export const PLAN_DOC_PREFIX = 'plan-sheet:';
export const PLAN_SOURCE = 'Plan Sheet';

export type Tier = 'free' | 'pro' | 'business' | 'enterprise';
export type ScopeRole = 'owner' | 'editor' | 'viewer' | 'field';

const RANK: Record<Tier, number> = { free: 0, pro: 1, business: 2, enterprise: 3 };

/** `tier` meets the minimum `min` (a higher tier always satisfies a lower). */
export function tierMeets(tier: Tier, min: Tier): boolean {
  return (RANK[tier] ?? 0) >= RANK[min];
}

/** Every id is a plan-sheet doc — the only shape owner scoping applies to. An
 *  empty list is NOT plan-scoped (nothing to scope). */
export function allPlanDocIds(ids: readonly string[]): boolean {
  return ids.length > 0 && ids.every(id => typeof id === 'string' && id.startsWith(PLAN_DOC_PREFIX));
}

/** A search restricted to plan sheets and nothing else. */
export function planOnlySources(sources: readonly string[]): boolean {
  return sources.length > 0 && sources.every(s => s === PLAN_SOURCE);
}

/** May this role write to (embed into, prune, extract for) the owner's index? */
export function mayWritePlanIndex(role: ScopeRole): boolean {
  return role === 'owner' || role === 'editor';
}

/** Where a plan-scoped request reads/writes and who is metered. */
export interface PlanScope {
  /** memory_embeddings.user_id for the plan rows: always the project owner. */
  indexUserId: string;
  /** Whose tier and monthly caps apply: the owner. */
  meterUserId: string;
  role: ScopeRole;
}

/**
 * The scope for a caller on a project, given what the database says. null =
 * the caller cannot reach the project (not the owner, no ACCEPTED collaborator
 * row) — the function answers a generic 403 and never says which.
 */
export function planScopeFor(
  callerId: string,
  project: { ownerId: string } | null,
  collaboratorRole: string | null,
): PlanScope | null {
  if (!callerId || !project || !project.ownerId) return null;
  if (project.ownerId === callerId) return { indexUserId: callerId, meterUserId: callerId, role: 'owner' };
  const role = collaboratorRole === 'editor' || collaboratorRole === 'viewer' || collaboratorRole === 'field'
    ? collaboratorRole
    : null;
  if (!role) return null;
  return { indexUserId: project.ownerId, meterUserId: project.ownerId, role };
}

/** The refusal a collaborator reads when the OWNER's plan does not cover the
 *  feature — about the owner's plan, never "upgrade" (upgrading his own
 *  account would not change it). */
export function ownerPlanRefusal(feature: string, min: Tier): string {
  return `${feature} on this job runs on the project owner's plan, which doesn't include it (needs ${min} or higher). Ask the project owner.`;
}
