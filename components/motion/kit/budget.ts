// budget.ts — the app-wide motion budget (E4): at most 24 kit nodes move at once.
//
// A module-level lease list over utils/motion/kit/budgetMath.ts. acquire(n, ms)
// answers how many of n may animate now; the rest render their END state at
// once (no motion, no cost). A lease expires on its own when the motion would
// have ended, so a node that unmounts mid-flight never leaks budget; release()
// hands a lease back early.

import { grant, inFlight, type Lease } from '@/utils/motion/kit/budgetMath';

let leases: Lease[] = [];

/** How many of `n` nodes may animate for `ms` from now. */
export function acquire(n: number, ms: number): number {
  const r = grant(leases, Date.now(), n, ms);
  leases = r.leases;
  return r.granted;
}

/** Hand back `n` nodes early (the motion finished before its lease ran out). */
export function release(n: number): void {
  let left = Math.max(0, n);
  const now = Date.now();
  leases = leases
    .filter((l) => l.until > now)
    .map((l) => {
      if (left <= 0) return l;
      const take = Math.min(l.n, left);
      left -= take;
      return { ...l, n: l.n - take };
    })
    .filter((l) => l.n > 0);
}

/** Tests / diagnostics: nodes in flight right now. */
export function budgetInFlight(): number {
  return inFlight(leases, Date.now());
}

/** Tests only: forget every lease. */
export function resetBudget(): void {
  leases = [];
}
