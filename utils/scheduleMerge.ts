// utils/scheduleMerge.ts
//
// Live-sync convergence for the collaborative schedule (Phase 2). Pure +
// unit-tested. A 3-way, per-task merge: given the last shared server state
// (`baseline`), a peer's newly-persisted state (`incoming`), and the local
// working copy (`local`):
//   - a task the PEER changed (incoming differs from baseline) → take the peer's
//   - a task the peer did NOT change → keep the local version (holds my edit)
//   - a task only I added locally (absent from baseline + incoming) → keep it
//   - a task the peer deleted (in baseline, gone from incoming) → dropped
// This preserves my in-flight edits while absorbing a peer's changes, WITHOUT
// needing to know which task I've selected. Same-task conflicts resolve
// peer-wins (presence keeps two people off the same task). True per-task CRDT is
// Phase 3, build-only-if-needed.

import type { ScheduleTask } from '@/types';

function sameTask(a: ScheduleTask, b: ScheduleTask): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function mergeScheduleTasks(
  baseline: ScheduleTask[],
  incoming: ScheduleTask[],
  local: ScheduleTask[],
): ScheduleTask[] {
  const baseById = new Map(baseline.map((t) => [t.id, t]));
  const localById = new Map(local.map((t) => [t.id, t]));

  const result = incoming.map((inc) => {
    const base = baseById.get(inc.id);
    // Peer changed this task (new to them, or differs from the shared baseline).
    if (!base || !sameTask(inc, base)) return inc;
    // Peer left it unchanged → keep my local version (may hold an in-flight edit).
    return localById.get(inc.id) ?? inc;
  });

  // Keep tasks I added locally that neither the baseline nor the peer knows about.
  for (const loc of local) {
    if (!baseById.has(loc.id) && !incoming.some((i) => i.id === loc.id)) result.push(loc);
  }
  return result;
}
