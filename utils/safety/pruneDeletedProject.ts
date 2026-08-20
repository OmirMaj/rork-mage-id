// pruneDeletedProject — the pure, testable core of SafetyContext's cascade
// delete. When a project is deleted, ProjectContext cascades ITS own
// collections and the server FK-cascades the DB; SafetyContext owns a separate
// set of project-scoped collections (jhas / toolboxTalks / incidents / hazards)
// that nothing else prunes, so they orphan until the next rehydrate. These
// helpers do the pruning, kept out of the context so the guards can be unit
// tested in isolation.
//
// TWO trigger shapes feed the SAME primitive:
//   • pruneCollection(list, id)        — production path. ProjectContext hands
//     SafetyContext the EXACT deleted id (an explicit signal), so we prune a
//     KNOWN projectId. No inference, no diff.
//   • removedProjectIds(prev, next)    — the guarded diff, used to reason about
//     and TEST the catastrophic false-prune-all case. It refuses to treat a
//     full-clear as a set of deletes.
//
// The context uses pruneCollection with the explicit id in production; the diff
// helper exists so the false-prune-all guard is a nameable, breakable thing.

/** A safety record is project-scoped iff it carries a projectId. */
export type ProjectScoped = { id: string; projectId?: string | null };

/**
 * Remove every record scoped to `deletedProjectId`. Returns the SAME array
 * reference when nothing matched, so a re-prune of an already-pruned project is
 * a genuine no-op (idempotent) and never churns React state or AsyncStorage.
 *
 * A null/empty id prunes NOTHING — it can never be interpreted as "delete all".
 */
export function pruneCollection<T extends ProjectScoped>(
  list: T[],
  deletedProjectId: string | null | undefined,
): T[] {
  if (!deletedProjectId) return list;
  const next = list.filter(r => r.projectId !== deletedProjectId);
  return next.length === list.length ? list : next;
}

/**
 * The set of project ids that were present BEFORE and are absent NOW — i.e. a
 * real single/partial delete that left the rest of the workspace intact.
 *
 * ── FALSE-PRUNE-ALL GUARD (the catastrophic case) ──────────────────────────
 * If `next` is EMPTY while `prev` was non-empty, that is a full-clear
 * (logout / tenant-switch / reload), NOT "every project was deleted". Treating
 * it as N deletes would wipe EVERY project's safety records — the wrong-data
 * catastrophe. So on a full-clear we return an EMPTY set: prune nothing. The
 * full-clear is owned by wipeLocalUserCache + SafetyContext's own userId-keyed
 * rehydrate, not by this diff.
 *
 * ── LOAD-RACE GATE ─────────────────────────────────────────────────────────
 * If `prev` is empty (initial empty→full hydration), there is nothing that was
 * present-then-absent, so the removed set is empty. Additive hydration prunes
 * nothing. (The context adds a second gate on hydratedRef so we never even call
 * this before both sides have hydrated.)
 */
export function removedProjectIds(
  prevProjectIds: readonly string[],
  nextProjectIds: readonly string[],
): Set<string> {
  // FALSE-PRUNE-ALL GUARD: non-empty -> empty is a full-clear, never a delete.
  if (prevProjectIds.length > 0 && nextProjectIds.length === 0) {
    return new Set();
  }
  const present = new Set(nextProjectIds);
  const removed = new Set<string>();
  for (const id of prevProjectIds) {
    if (!present.has(id)) removed.add(id);
  }
  return removed;
}

/** Prune every record whose projectId is in `removed`. Same-reference on no-op. */
export function pruneCollectionMany<T extends ProjectScoped>(
  list: T[],
  removed: Set<string>,
): T[] {
  if (removed.size === 0) return list;
  const next = list.filter(r => !(r.projectId && removed.has(r.projectId)));
  return next.length === list.length ? list : next;
}
