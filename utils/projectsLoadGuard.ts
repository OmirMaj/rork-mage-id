// utils/projectsLoadGuard.ts — a projects load must not undo a write made
// while it was in flight (integration round 1, field).
//
// THE BUG. The projects loader is three sequential SELECTs — seconds on job-
// site LTE — and ProjectContext then replaced `projects` wholesale with what
// it read (and saved that over the device cache). The foreground refetch
// checked for pending writes only when it STARTED, so a drag made on Schedule
// Pro while the load was out was overwritten by the pre-drag row; the screen's
// rebase then copied that into the working copy, the drag vanished, and the
// next persist sent the reverted dates. useProjectsFocusRefetch opened that
// window on every return to the app after 30 s.
//
// THE FIX. Every local project write takes a sequence number
// (ProjectContext.noteProjectWrite). A load remembers the number it started
// at; when it lands, any project written since keeps the device copy — or
// stays deleted, or keeps a project created meanwhile that the read could not
// have seen. The next load, with nothing written in between, takes the
// server's. Pure; pinned by scripts/validate-schedule-concurrency.ts.

export interface ProjectWriteLog {
  /** The newest sequence number handed out. */
  seq: number;
  /** Per project, the sequence number of its latest local write. */
  byId: Map<string, number>;
}

export function newProjectWriteLog(): ProjectWriteLog {
  return { seq: 0, byId: new Map() };
}

/** Record a local write of `projectId`; returns its sequence number. */
export function noteProjectWrite(log: ProjectWriteLog, projectId: string): number {
  log.seq += 1;
  log.byId.set(projectId, log.seq);
  return log.seq;
}

/**
 * `loaded` as the device should hold it, given the load started at sequence
 * `since` and `local` is the device's current list. Untouched projects are the
 * server's; a project written after `since` is the local copy — or absent when
 * it was deleted locally meanwhile; one created locally meanwhile is added at
 * the front (new projects are listed first).
 */
export function keepProjectsWrittenSince<P extends { id: string }>(
  loaded: readonly P[],
  local: readonly P[],
  log: ProjectWriteLog,
  since: number,
): P[] {
  const written = new Set<string>();
  for (const [id, s] of log.byId) if (s > since) written.add(id);
  if (written.size === 0) return [...loaded];
  const localById = new Map(local.map(p => [p.id, p] as const));
  const loadedIds = new Set(loaded.map(p => p.id));
  const out: P[] = [];
  for (const p of local) {
    if (written.has(p.id) && !loadedIds.has(p.id)) out.push(p);
  }
  for (const p of loaded) {
    if (!written.has(p.id)) { out.push(p); continue; }
    const mine = localById.get(p.id);
    if (mine) out.push(mine);
  }
  return out;
}
