// utils/costXrayAccumulate.ts — the Cost X-Ray "what the walk priced" amounts
// (lane ADOPT2, AD15). PURE: no React, no react-native, bun-loadable.
//
// Each review card becomes one accumulate item in integer cents. A tell routed
// to 'price' carries its effective band's expected amount (the band is computed
// by the screen's own effectiveBand and passed in, so the allowance math lives
// in ONE place); a verify-only tell was not priced and counts 0. The total of
// these is what the walk PRICED on the contractor's costs — never what was
// added to the estimate (that is the accepted-contingency readout).

export type XrayAccumulateInput = {
  id: string;
  route: string;
  /** The tell's effective band, in dollars (as effectiveBand returns it). */
  band?: { expected: number } | null;
};

export type XrayAccumulateCents = { key: string; cents: number };

/** One { key, cents } per review, in the cards' order. Cents are integers. */
export function xrayAccumulateCents(reviews: readonly XrayAccumulateInput[]): XrayAccumulateCents[] {
  return reviews.map((r) => {
    const expected = r.route === 'price' ? r.band?.expected : undefined;
    const cents = typeof expected === 'number' && Number.isFinite(expected) ? Math.round(expected * 100) : 0;
    return { key: r.id, cents };
  });
}

/** The walk's priced total in cents: the sum of the cards' own cents. */
export function xrayAccumulateTotalCents(items: readonly XrayAccumulateCents[]): number {
  return items.reduce((s, i) => s + i.cents, 0);
}
