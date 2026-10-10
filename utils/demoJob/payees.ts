// utils/demoJob/payees.ts — keeps the Demo Job's made-up subs out of tax and audit outputs (pure).
//
// Subcontractors are account-level records, so the demo's seventeen made-up
// companies sit in the same directory as the contractor's real ones while the
// demo exists. Anything that reports on who was paid (the 1099 export, the
// insurance audit pack) drops them, and the demo's subcontracts, here.
//
// A demo sub is known by its id, which is worked out from the demo project's
// id (utils/demoJob/ids), so nothing has to be stored to recognise one.
import { childIds } from './ids';
import { demoProjectIdSet, withoutDemoRows } from './marker';
import { SUBS } from './world';

/** The ids of the subcontractor records the demo projects in `projects` created. */
export function demoSubcontractorIds(projects: readonly { id: string; name?: string | null; leadSource?: string | null }[]): Set<string> {
  const out = new Set<string>();
  for (const pid of demoProjectIdSet(projects)) {
    const id = childIds(pid);
    for (const s of SUBS) out.add(id(`sub:${s.key}`));
  }
  return out;
}

/** `subcontractors` and `commitments` without the Demo Job's. Receipts tied to a dropped commitment drop with it. */
export function withoutDemoPayees<S extends { id: string }, C extends { projectId?: string | null }>(
  projects: readonly { id: string; name?: string | null; leadSource?: string | null }[],
  subcontractors: readonly S[],
  commitments: readonly C[],
): { subcontractors: S[]; commitments: C[] } {
  const demoIds = demoProjectIdSet(projects);
  if (demoIds.size === 0) return { subcontractors: subcontractors as S[], commitments: commitments as C[] };
  const subIds = demoSubcontractorIds(projects);
  return {
    subcontractors: subcontractors.filter((s) => !subIds.has(s.id)),
    commitments: withoutDemoRows(commitments, demoIds),
  };
}
