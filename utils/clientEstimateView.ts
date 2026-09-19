// utils/clientEstimateView.ts
//
// The client-facing projection of a contractor's estimate. This is a SAFETY
// boundary: a contractor shows a client a clean fixed-price proposal, never
// their internal cost buildup. The produced ClientEstimateView therefore
// carries ONLY client-appropriate numbers — the project total, scope rolled
// up by CSI division (markup baked in), and allowances — and deliberately
// omits base cost, markup, margin, unit prices, suppliers, and Brain flags.
//
// Pure (no react-native imports) so scripts/validate-client-estimate-view.ts
// can exercise it under Bun.

import type { LinkedEstimate, LinkedEstimateItem } from '@/types';
import { groupByCSIDivision } from './csiMasterFormat';

export interface ClientScopeGroup {
  /** CSI division number ('03') or 'other' for unassigned. */
  key: string;
  /** Human label, e.g. "03 Concrete" or "Other scope". */
  label: string;
  /** Client-facing price with markup baked in, to the cent. Groups tie out to projectTotal. */
  total: number;
}

export interface ClientAllowance {
  name: string;
  /** Client-facing price with markup baked in, to the cent. */
  amount: number;
}

// The shape of one printed payment line. There is deliberately NO schedule
// builder here any more: until 2026-09-17 this module exported one that
// invented a 10% deposit nobody chose, and every proposal printed it. A
// payment line now comes only from utils/paymentTerms.proposalPaymentLines,
// fed by the GC's own saved (or portal-stamped) split.
export interface PaymentMilestone {
  label: string;
  detail: string;
  /** Dollar amount; omitted for schedule-only milestones (e.g. monthly progress). */
  amount?: number;
}

export interface ClientEstimateView {
  /** The fixed price the client pays (= estimate grand total, to the cent). */
  projectTotal: number;
  /** Scope grouped by system; group totals sum EXACTLY to projectTotal. */
  scopeGroups: ClientScopeGroup[];
  /** Allowance line items (the "typical costs" the client chooses within). */
  allowances: ClientAllowance[];
  /** How many line items rolled up (count only — no per-line detail leaks). */
  itemCount: number;
}

/** Cents — the one grid every client-facing figure here sits on. */
const cents = (n: number): number => Math.round((Number.isFinite(n) ? n : 0) * 100);
const fromCents = (c: number): number => c / 100;

/**
 * Project a contractor estimate into the client-safe view.
 *
 * Markup is distributed proportionally so each group's client price includes
 * its share of markup and the groups sum to the grand total the client
 * actually pays. Any rounding remainder is folded into the largest group so a
 * fixed-price proposal ties out to the penny.
 *
 * TO THE CENT, NOT THE DOLLAR (audit 2026-09-18, #118). projectTotal was
 * `Math.round(grandTotal)`, and the portal proposal priced its payment lines
 * off that whole-dollar figure while the contract priced off grandTotal and
 * the PDF off its own total: $19,473 / $19,472.85 / $19,473.60 and three
 * different deposits for one job. The total is now grandTotal on the cent
 * grid, and the group rounding and drift fold run in integer cents.
 *
 * THE SCALE FACTOR IS grandTotal / Σ lineTotal, NOT grandTotal / baseTotal.
 * Two conventions for lineTotal live in this app. The canonical one
 * (utils/estimateMarkup, the estimator, the wizard) stores lineTotal ALREADY
 * marked up, with Σ lineTotal === grandTotal; the Review screen's live
 * projection stores lineTotal at cost with Σ lineTotal === baseTotal. Scaling
 * by grand/base multiplied an already-marked-up line by the markup a second
 * time — a $10,000 + $5,000 job at 20% rendered groups of $12,000 and $6,000,
 * and the drift fold then dumped −$3,000 into the largest group, so the
 * homeowner's scope said $9,000 / $6,000. Scaling by what the rows actually
 * sum to is right under both conventions: 1 for the first, grand/base for the
 * second.
 */
export function toClientEstimateView(est: LinkedEstimate): ClientEstimateView {
  const totalCents = cents(est.grandTotal);
  const projectTotal = fromCents(totalCents);
  const rowSum = est.items.reduce((s, it) => s + (Number.isFinite(it.lineTotal) ? it.lineTotal : 0), 0);
  const factor = rowSum > 0 ? est.grandTotal / rowSum : 1;
  const clientCents = (item: LinkedEstimateItem) => cents(item.lineTotal * factor);

  const groupCents = groupByCSIDivision(est.items)
    .map(g => {
      const key = g.division?.number ?? 'other';
      const label = g.division ? `${g.division.number} ${g.division.title}` : 'Other scope';
      const c = g.items.reduce((s, it) => s + clientCents(it), 0);
      return { key, label, c };
    })
    // Drop only groups that price to nothing. NOT `> 0`: an owner-supplied
    // credit sitting in its own division nets negative, and dropping it made
    // the drift fold below silently ADD its magnitude to the largest surviving
    // group — measured 2026-09-13, framing $10,000 in div 06 plus a −$1,000
    // credit in div 01 rendered (and, once the portal could take a signature,
    // SIGNED) as "06 Wood, Plastics, and Composites — 9,000". Total right,
    // scope line overstated by the credit, and the credit itself absent from
    // the document the homeowner accepts.
    .filter(g => g.c !== 0);

  // Fold the rounding remainder into the largest group so the schedule of
  // values sums exactly to the contract price. With the filter above this is
  // now genuinely a ROUNDING remainder (bounded by the item count, in cents),
  // not a dumping ground for a dropped line.
  const drift = totalCents - groupCents.reduce((s, g) => s + g.c, 0);
  if (drift !== 0 && groupCents.length > 0) {
    const largest = groupCents.reduce((a, b) => (b.c > a.c ? b : a));
    largest.c += drift;
  }
  const scopeGroups: ClientScopeGroup[] = groupCents.map(g => ({ key: g.key, label: g.label, total: fromCents(g.c) }));

  const allowances: ClientAllowance[] = est.items
    .filter(it => it.isAllowance)
    .map(it => ({ name: it.name, amount: fromCents(clientCents(it)) }));

  return { projectTotal, scopeGroups, allowances, itemCount: est.items.length };
}
