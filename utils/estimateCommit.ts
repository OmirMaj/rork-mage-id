import type {
  Project,
  LinkedEstimate,
  EstimateRevision,
  EstimateChangeReason,
} from '@/types';

const MAX_REVISIONS = 30;
const KEEP_REASONS: EstimateChangeReason[] = [
  'manual', 'sent_to_client', 'converted_to_contract', 'restore',
];

function genId(): string {
  return `rev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Stable equality of two estimates, ignoring the volatile id/createdAt
 *  on the estimate object itself (compare items + totals + globalMarkup). */
export function estimatesEqual(
  a: LinkedEstimate | null | undefined,
  b: LinkedEstimate | null | undefined,
): boolean {
  if (!a || !b) return a === b;
  const norm = (e: LinkedEstimate) => JSON.stringify({
    items: e.items, globalMarkup: e.globalMarkup,
    baseTotal: e.baseTotal, markupTotal: e.markupTotal, grandTotal: e.grandTotal,
  });
  return norm(a) === norm(b);
}

function nextRevNumber(versions: EstimateRevision[]): number {
  return versions.reduce((m, v) => Math.max(m, v.revNumber), 0) + 1;
}

/** Cap: never drop manual/sent_to_client/converted_to_contract/restore;
 *  drop oldest pre_overwrite first until length <= MAX_REVISIONS. */
function applyCap(versions: EstimateRevision[]): EstimateRevision[] {
  if (versions.length <= MAX_REVISIONS) return versions;
  const result = [...versions];
  for (let i = 0; i < result.length && result.length > MAX_REVISIONS; ) {
    if (KEEP_REASONS.includes(result[i].reason)) { i++; continue; }
    result.splice(i, 1);
  }
  return result;
}

function makeRevision(
  est: LinkedEstimate,
  versions: EstimateRevision[],
  reason: EstimateChangeReason,
  note?: string,
  createdBy?: string,
): EstimateRevision {
  return {
    id: genId(),
    revNumber: nextRevNumber(versions),
    snapshot: est,
    grandTotal: est.grandTotal ?? 0,
    reason,
    note,
    createdAt: new Date().toISOString(),
    createdBy,
  };
}

/** Patch that sets `next` as the current estimate, first snapshotting the
 *  project's CURRENT estimate (if any & not a dup of the latest revision). */
export function commitEstimatePatch(
  project: Project | null | undefined,
  next: LinkedEstimate,
  opts: { reason?: EstimateChangeReason; note?: string; createdBy?: string } = {},
): Partial<Project> {
  const versions = project?.estimateVersions ?? [];
  const current = project?.linkedEstimate;
  const latest = versions[versions.length - 1];
  const isDup = current != null && latest != null && estimatesEqual(current, latest.snapshot);
  if (!current || isDup) {
    return { linkedEstimate: next, estimateVersions: versions };
  }
  const rev = makeRevision(current, versions, opts.reason ?? 'pre_overwrite', opts.note, opts.createdBy);
  return {
    linkedEstimate: next,
    estimateVersions: applyCap([...versions, rev]),
  };
}

/** Patch that snapshots the CURRENT estimate without changing it.
 *  Returns {} (no-op) when there is nothing to snapshot or it dups latest. */
export function snapshotPatch(
  project: Project | null | undefined,
  reason: EstimateChangeReason,
  note?: string,
  createdBy?: string,
): Partial<Project> {
  const versions = project?.estimateVersions ?? [];
  const current = project?.linkedEstimate;
  if (!current) return {};
  const latest = versions[versions.length - 1];
  if (latest && estimatesEqual(current, latest.snapshot)) return {};
  const rev = makeRevision(current, versions, reason, note, createdBy);
  return { estimateVersions: applyCap([...versions, rev]) };
}

/** Patch that restores a prior revision as the current estimate, first
 *  snapshotting the outgoing current as a 'restore' revision (undoable). */
export function restorePatch(
  project: Project | null | undefined,
  revisionId: string,
): Partial<Project> {
  const versions = project?.estimateVersions ?? [];
  const target = versions.find(v => v.id === revisionId);
  if (!target) return {};
  const current = project?.linkedEstimate;
  let nextVersions = versions;
  if (current) {
    const rev = makeRevision(current, versions, 'restore');
    nextVersions = applyCap([...versions, rev]);
  }
  return { linkedEstimate: target.snapshot, estimateVersions: nextVersions };
}

export interface EstimateDiff {
  categories: { key: string; label: string; delta: number }[];
  netDelta: number;
}

/** Per-CSI-category (fallback `category`, then 'Uncategorized') delta b - a. */
export function diffEstimates(a: LinkedEstimate, b: LinkedEstimate): EstimateDiff {
  const sum = (e: LinkedEstimate) => {
    const m = new Map<string, number>();
    for (const it of e.items) {
      const key = (it.csiDivision || it.category || 'Uncategorized').toString();
      m.set(key, (m.get(key) ?? 0) + (it.lineTotal ?? 0));
    }
    return m;
  };
  const ma = sum(a); const mb = sum(b);
  const keys = new Set<string>([...ma.keys(), ...mb.keys()]);
  const categories = [...keys]
    .map(k => ({ key: k, label: k, delta: (mb.get(k) ?? 0) - (ma.get(k) ?? 0) }))
    .filter(c => Math.abs(c.delta) > 0.0001)
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  const netDelta = (b.grandTotal ?? 0) - (a.grandTotal ?? 0);
  return { categories, netDelta };
}

/** F0: single source of truth for a project's estimate base total. */
export function effectiveEstimateTotal(project: Project | null | undefined): number {
  return project?.linkedEstimate?.grandTotal ?? project?.estimate?.grandTotal ?? 0;
}
