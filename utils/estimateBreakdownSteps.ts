// estimateBreakdownSteps.ts — the estimate summary's "Cost distribution" card
// as whole cents, for the "Line items" counter (lane MOTIONADOPT-B, row B2).
//
// Pure, no imports (bun-loadable by scripts/validate-motion-adopt-b.ts).
//
// Each category's subtotal is a sum of line totals that are already cent-exact
// (app/estimate-wizard.tsx rounds every line to the cent before it lands), but
// a float sum of cents can still drift by a hair (0.1 + 0.2). Rounding each
// row to integer cents HERE, once, means the counter's steps (the running sums
// of these cents) and its last figure are exact integers: the total it lands
// on is the sum of the rows printed above it, to the cent.

export type BreakdownRow = { cat: string; subtotal: number };

export type BreakdownSteps = {
  /** One entry per row, in the rows' order (biggest first, as the card sorts them). */
  items: { key: string; cents: number }[];
  /** Σ items[].cents — an integer. */
  totalCents: number;
};

/** A dollar amount as integer cents (non-finite → 0). */
export function toWholeCents(dollars: number): number {
  return Number.isFinite(dollars) ? Math.round(dollars * 100) : 0;
}

export function breakdownSteps(rows: readonly BreakdownRow[]): BreakdownSteps {
  const items = rows.map((r) => ({ key: r.cat, cents: toWholeCents(r.subtotal) }));
  let totalCents = 0;
  for (const it of items) totalCents += it.cents;
  return { items, totalCents };
}
