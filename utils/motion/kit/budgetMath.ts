// budgetMath.ts — the per-screen motion budget, pure (imports ./kitSpec only).
//
// At most 24 kit-animated nodes move at once, app-wide. An arm that is granted
// fewer than it asked for renders the rest at their END state at once: no
// motion, no cost. A grant is a LEASE that expires when the motion would have
// finished, so a node that unmounts mid-flight (or a StrictMode double render)
// can never leak budget for longer than one entrance.

import { KIT_CAPS } from './kitSpec';

export type Lease = { until: number; n: number };

/** Leases still running at `now`. */
export function liveLeases(leases: readonly Lease[], now: number): Lease[] {
  return leases.filter((l) => l.until > now && l.n > 0);
}

/** How many nodes are animating at `now`. */
export function inFlight(leases: readonly Lease[], now: number): number {
  return liveLeases(leases, now).reduce((s, l) => s + l.n, 0);
}

/**
 * Ask for `n` nodes for `ms`: granted = min(n, cap − in flight), never below
 * 0. Returns the grant and the new lease list (expired leases dropped).
 */
export function grant(leases: readonly Lease[], now: number, n: number, ms: number, cap: number = KIT_CAPS.screenNodes): { granted: number; leases: Lease[] } {
  const live = liveLeases(leases, now);
  const used = live.reduce((s, l) => s + l.n, 0);
  const want = Math.max(0, Math.floor(Number.isFinite(n) ? n : 0));
  const granted = Math.max(0, Math.min(want, cap - used));
  const next = granted > 0 ? live.concat({ until: now + Math.max(1, ms), n: granted }) : live;
  return { granted, leases: next };
}
