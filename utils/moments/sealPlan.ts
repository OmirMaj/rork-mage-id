// sealPlan.ts — which arcs of the two-arc seal ring are drawn, and what sits in
// the seal's centre, for a confirmed signature.
//
// The ring is two half arcs: the TOP arc is the contractor's, the BOTTOM arc is
// the homeowner's. A two-party contract is binding only when BOTH have signed,
// so the ring only closes (and the centre only shows a check) for the closing
// signer. The GC signing first sees "1 of 2" and half a ring. A single-party
// record (a field ticket, a certification) draws the whole ring at once.
//
// Only parties 2 / signedBefore 1 is ever binding. Everything else throws.
//
// Pure TypeScript: no react-native import (bun loads it).

export interface SealPlanInput {
  parties: 1 | 2;
  signedBefore: 0 | 1;
}

export interface SealPlan {
  /** Arcs already on the ring when the seal appears (mounted at 180deg). */
  arcsBefore: { top: boolean; bottom: boolean };
  /** Arcs this signer draws (rotate 0 -> 180deg). */
  arcsDraw: { top: boolean; bottom: boolean };
  centre: 'check' | 'count';
  countText?: string;
  /** True only when this signature makes the contract binding. */
  binding: boolean;
  /** When the check's short leg starts (ms after the write confirmed); null = no check. */
  checkAt: number | null;
}

export function sealPlan(input: SealPlanInput): SealPlan {
  const { parties, signedBefore } = input;
  if (parties === 1 && signedBefore === 0) {
    return {
      arcsBefore: { top: false, bottom: false },
      arcsDraw: { top: true, bottom: true },
      centre: 'check',
      binding: false,
      checkAt: 160,
    };
  }
  if (parties === 2 && signedBefore === 0) {
    return {
      arcsBefore: { top: false, bottom: false },
      arcsDraw: { top: true, bottom: false },
      centre: 'count',
      countText: '1 of 2',
      binding: false,
      checkAt: null,
    };
  }
  if (parties === 2 && signedBefore === 1) {
    return {
      arcsBefore: { top: true, bottom: false },
      arcsDraw: { top: false, bottom: true },
      centre: 'check',
      binding: true,
      checkAt: 640,
    };
  }
  throw new Error(`No seal plan for parties ${String(parties)} and signedBefore ${String(signedBefore)}`);
}
