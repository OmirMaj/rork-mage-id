/**
 * safety-cascade-delete — SafetyContext must prune a deleted project's own
 * project-scoped safety records (jhas / toolboxTalks / incidents / hazards /
 * inspections) immediately, and MUST NOT wipe every project's records when the
 * project list transiently empties (logout / tenant-switch / reload).
 *
 * The context reacts to an EXPLICIT deleted-id signal from ProjectContext
 * (deleteProject surfaces the exact id) and prunes that KNOWN projectId via
 * pruneCollection. The diff helpers (removedProjectIds / pruneCollectionMany)
 * are the guarded present-then-absent form used to reason about — and here to
 * TEST — the catastrophic false-prune-all case in the language of project-list
 * transitions.
 *
 * These are pure-function assertions on utils/safety/pruneDeletedProject.ts —
 * no React, no async — so the guards are provable in isolation. The break-test
 * for the false-prune-all guard is recorded in the branch's report.
 */

import {
  pruneCollection,
  removedProjectIds,
  pruneCollectionMany,
  type ProjectScoped,
} from '@/utils/safety/pruneDeletedProject';

type Rec = ProjectScoped;

// A tiny fixture: for each project id, one record of each safety collection.
function seed(projectIds: string[]): Rec[] {
  return projectIds.flatMap((pid) => [
    { id: `jha-${pid}`, projectId: pid },
    { id: `toolbox-${pid}`, projectId: pid },
    { id: `incident-${pid}`, projectId: pid },
    { id: `hazard-${pid}`, projectId: pid },
    { id: `inspection-${pid}`, projectId: pid },
  ]);
}

function projectIdsPresent(records: Rec[]): Set<string> {
  return new Set(records.map((r) => r.projectId).filter((p): p is string => !!p));
}

/**
 * Apply a project-list transition the way the guarded diff path would: compute
 * the removed set (with the false-prune-all guard) and prune. Returns the
 * surviving records.
 */
function applyTransition(records: Rec[], prev: string[], next: string[]): Rec[] {
  const removed = removedProjectIds(prev, next);
  return pruneCollectionMany(records, removed);
}

describe('safety cascade delete — guarded present-then-absent diff', () => {
  test('(a) empty -> [A,B,C] prunes NOTHING (additive hydration / load-race)', () => {
    // Records for A,B,C already in memory; the projects array goes empty->full
    // on initial hydrate. Nothing was present-then-absent, so prune nothing.
    const records = seed(['A', 'B', 'C']);
    const survivors = applyTransition(records, [], ['A', 'B', 'C']);
    expect(survivors).toHaveLength(records.length);
    expect(projectIdsPresent(survivors)).toEqual(new Set(['A', 'B', 'C']));
  });

  test('(b) [A,B,C] -> [A,C] prunes ONLY B, leaves A and C intact', () => {
    const records = seed(['A', 'B', 'C']);
    const survivors = applyTransition(records, ['A', 'B', 'C'], ['A', 'C']);

    // B's five records are gone.
    expect(survivors.some((r) => r.projectId === 'B')).toBe(false);
    // A and C untouched — all five of each remain.
    expect(survivors.filter((r) => r.projectId === 'A')).toHaveLength(5);
    expect(survivors.filter((r) => r.projectId === 'C')).toHaveLength(5);
    expect(survivors).toHaveLength(10);
    // Specifically the four named collections + inspections for B are gone.
    for (const kind of ['jha', 'toolbox', 'incident', 'hazard', 'inspection']) {
      expect(survivors.some((r) => r.id === `${kind}-B`)).toBe(false);
    }
  });

  test('(c) [A,B,C] -> [] prunes NOTHING (FALSE-PRUNE-ALL GUARD)', () => {
    // A full-clear (logout / tenant-switch / reload) is NOT "every project was
    // deleted". If this pruned, it would wipe ALL safety data — the wrong-data
    // catastrophe. The guard makes non-empty -> empty a no-op.
    const records = seed(['A', 'B', 'C']);
    const survivors = applyTransition(records, ['A', 'B', 'C'], []);
    expect(survivors).toHaveLength(records.length);
    expect(projectIdsPresent(survivors)).toEqual(new Set(['A', 'B', 'C']));
    // And the removed set itself is empty — the guard, directly.
    expect(removedProjectIds(['A', 'B', 'C'], []).size).toBe(0);
  });

  test('(d) idempotent — re-applying a delete of B is a no-op', () => {
    const records = seed(['A', 'B', 'C']);
    const once = applyTransition(records, ['A', 'B', 'C'], ['A', 'C']);
    // Second pass: B is already gone; prev/next both reflect [A,C].
    const twice = applyTransition(once, ['A', 'C'], ['A', 'C']);
    expect(twice).toBe(once); // same reference — no churn
    expect(twice).toHaveLength(10);
  });
});

describe('safety cascade delete — explicit deleted-id signal (production path)', () => {
  test('pruneCollection removes exactly the signalled projectId', () => {
    const records = seed(['A', 'B', 'C']);
    const survivors = pruneCollection(records, 'B');
    expect(survivors.some((r) => r.projectId === 'B')).toBe(false);
    expect(survivors).toHaveLength(10);
    expect(projectIdsPresent(survivors)).toEqual(new Set(['A', 'C']));
  });

  test('pruneCollection is idempotent — re-pruning B returns the same reference', () => {
    const records = seed(['A', 'B', 'C']);
    const once = pruneCollection(records, 'B');
    const twice = pruneCollection(once, 'B');
    expect(twice).toBe(once);
  });

  test('pruneCollection with null/empty id prunes NOTHING (never "delete all")', () => {
    const records = seed(['A', 'B', 'C']);
    expect(pruneCollection(records, null)).toBe(records);
    expect(pruneCollection(records, undefined)).toBe(records);
    expect(pruneCollection(records, '')).toBe(records);
  });

  test('company-scoped records (no projectId) are never pruned', () => {
    const projectScoped = seed(['A']);
    const companyScoped: Rec[] = [
      { id: 'cert-1' }, // certifications: no projectId
      { id: 'template-1' }, // templates: no projectId
    ];
    const all = [...projectScoped, ...companyScoped];
    const survivors = pruneCollection(all, 'A');
    expect(survivors).toEqual(companyScoped);
  });
});
