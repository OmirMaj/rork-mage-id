// financials.ts — read/write a project's linked_estimate across the
// project_financials split.
//
// WHY. 20260826140000_project_financials_split.sql moved the financial jsonb
// (estimate, linked_estimate, estimate_versions, target_budget) off the
// projects row into project_financials, because Postgres RLS is ROW-level and
// cannot blind columns — a 'field' collaborator needs projects.schedule, and
// would otherwise read the margin along with it.
//
// The QBO mapping code is one of the server-side consumers that still spoke to
// the legacy columns. It is centralised here so the two call sites
// (invoice.ts reads, item.ts reads AND writes) cannot drift apart.
//
// TRANSITION-SAFE. Reads prefer project_financials and fall back to the legacy
// projects column; writes go to BOTH while the legacy columns still exist.
// That keeps this correct in all four states — table present or not, legacy
// columns present or not — so it can be deployed before or after either
// migration.
//
// The dual-WRITE matters especially here: item.ts stamps qboItemId back onto
// linked_estimate. Writing only the legacy column would let
// project_financials.linked_estimate go stale, and the phase-2 drop migration
// would then discard those QBO item ids.

// deno-lint-ignore no-explicit-any
type Client = any;

export interface LinkedEstimateItem { materialId: string; name: string; qboItemId?: string }
export interface LinkedEstimate { items?: LinkedEstimateItem[]; [k: string]: unknown }

/**
 * A project's linked_estimate, or null when there is none / it is not visible.
 * Never throws on a missing table or dropped column — both are expected states
 * mid-migration.
 */
export async function readLinkedEstimate(
  s: Client,
  projectId: string,
  userId: string,
): Promise<LinkedEstimate | null> {
  try {
    const { data, error } = await s
      .from('project_financials')
      .select('linked_estimate')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!error && data?.linked_estimate) return data.linked_estimate as LinkedEstimate;
  } catch {
    // table not created yet — fall through to the legacy column
  }
  try {
    const { data } = await s
      .from('projects')
      .select('linked_estimate')
      .eq('id', projectId)
      .eq('user_id', userId)
      .maybeSingle();
    return (data?.linked_estimate as LinkedEstimate | undefined) ?? null;
  } catch {
    // column dropped (phase 2) and nothing in the new table
    return null;
  }
}

/** Convenience: just the items array, defaulted to []. */
export async function readLinkedEstimateItems(
  s: Client,
  projectId: string,
  userId: string,
): Promise<LinkedEstimateItem[]> {
  const le = await readLinkedEstimate(s, projectId, userId);
  return le?.items ?? [];
}

/**
 * Persist a new linked_estimate. Writes project_financials (upsert — the row
 * may not exist yet for a project that had no money when the backfill ran) AND
 * the legacy column while it still exists.
 *
 * Throws only if BOTH writes fail: mid-migration, exactly one of them is
 * expected to fail, and failing the whole QBO sync for that would be wrong.
 */
export async function writeLinkedEstimate(
  s: Client,
  projectId: string,
  userId: string,
  next: LinkedEstimate,
): Promise<void> {
  let wroteSomething = false;
  let lastErr = '';

  try {
    const { error } = await s
      .from('project_financials')
      .upsert(
        { project_id: projectId, user_id: userId, linked_estimate: next, updated_at: new Date().toISOString() },
        { onConflict: 'project_id' },
      );
    if (error) lastErr = error.message;
    else wroteSomething = true;
  } catch (e) {
    lastErr = String(e);
  }

  try {
    const { error } = await s
      .from('projects')
      .update({ linked_estimate: next })
      .eq('id', projectId)
      .eq('user_id', userId);
    if (error) lastErr = error.message;
    else wroteSomething = true;
  } catch (e) {
    lastErr = String(e);
  }

  if (!wroteSomething) throw new Error(`project update: ${lastErr || 'both financial writes failed'}`);
}
