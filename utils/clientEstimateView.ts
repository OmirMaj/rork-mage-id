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
  /** Client-facing price with markup baked in, rounded. Groups tie out to projectTotal. */
  total: number;
}

export interface ClientAllowance {
  name: string;
  /** Client-facing price with markup baked in, rounded. */
  amount: number;
}

export interface PaymentMilestone {
  label: string;
  detail: string;
  /** Dollar amount; omitted for schedule-only milestones (e.g. monthly progress). */
  amount?: number;
}

/**
 * A sensible default proposal payment schedule: 10% deposit on signing, monthly
 * progress billing, remainder on completion. Contractors can override later.
 */
export function defaultPaymentSchedule(total: number): PaymentMilestone[] {
  const deposit = Math.round(total * 0.1);
  return [
    { label: 'Deposit', detail: 'Due on signing · 10%', amount: deposit },
    { label: 'Progress billing', detail: 'Monthly, on work completed' },
    { label: 'Final payment', detail: 'On substantial completion', amount: total - deposit },
  ];
}

export interface ClientEstimateView {
  /** The fixed price the client pays (= estimate grand total, rounded). */
  projectTotal: number;
  /** Scope grouped by system; group totals sum EXACTLY to projectTotal. */
  scopeGroups: ClientScopeGroup[];
  /** Allowance line items (the "typical costs" the client chooses within). */
  allowances: ClientAllowance[];
  /** How many line items rolled up (count only — no per-line detail leaks). */
  itemCount: number;
}

/**
 * Project a contractor estimate into the client-safe view.
 *
 * Markup is distributed proportionally (grandTotal / baseTotal) so each group's
 * client price includes its share of markup and the groups sum to the grand
 * total the client actually pays. Any rounding remainder is folded into the
 * largest group so a fixed-price proposal ties out to the penny.
 */
export function toClientEstimateView(est: LinkedEstimate): ClientEstimateView {
  const projectTotal = Math.round(est.grandTotal);
  const factor = est.baseTotal > 0 ? est.grandTotal / est.baseTotal : 1;
  const clientAmount = (item: LinkedEstimateItem) => Math.round(item.lineTotal * factor);

  const scopeGroups: ClientScopeGroup[] = groupByCSIDivision(est.items)
    .map(g => {
      const key = g.division?.number ?? 'other';
      const label = g.division ? `${g.division.number} ${g.division.title}` : 'Other scope';
      const total = g.items.reduce((s, it) => s + clientAmount(it), 0);
      return { key, label, total };
    })
    .filter(g => g.total > 0);

  // Fold the rounding remainder into the largest group so the schedule of
  // values sums exactly to the contract price.
  const groupSum = scopeGroups.reduce((s, g) => s + g.total, 0);
  const drift = projectTotal - groupSum;
  if (drift !== 0 && scopeGroups.length > 0) {
    const largest = scopeGroups.reduce((a, b) => (b.total > a.total ? b : a));
    largest.total += drift;
  }

  const allowances: ClientAllowance[] = est.items
    .filter(it => it.isAllowance)
    .map(it => ({ name: it.name, amount: clientAmount(it) }));

  return { projectTotal, scopeGroups, allowances, itemCount: est.items.length };
}
