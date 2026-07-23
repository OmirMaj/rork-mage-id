// utils/profitLeak/subBidCheck.ts — Sub-Bid Reality Check. PURE MATH, no AI.
// Basis A (preferred): the estimate lines the commitment says it covers.
// Basis B: csiDivision/description → matching estimate items priced at the
//   learned rate where history exists, else at the GC's own budgeted lineTotal.
// No basis → 'unknown' (silent — no noise). Never throws, never blocks a save.
import type { Commitment, LinkedEstimateItem, Project } from '@/types';
import { lookupRate, type CostDatabase } from '@/utils/costDatabase';
import { classifyToCSIDivision } from '@/utils/csiMasterFormat';

export type SubBidBand = 'low' | 'high' | 'fair' | 'unknown';

export interface SubBidVerdict {
  verdict: SubBidBand;
  basis: 'linked_items' | 'trade_match' | null;
  expected: number | null;
  /** amount − expected. Negative = the bid is under the expectation. */
  gap: number | null;
  /** amount / expected − 1. */
  variancePct: number | null;
  /** Ready-to-show sentence ('' when unknown). */
  detail: string;
}

export const LOW_BAND = 0.85;
export const HIGH_BAND = 1.30;

const UNKNOWN: SubBidVerdict = { verdict: 'unknown', basis: null, expected: null, gap: null, variancePct: null, detail: '' };

const fmtUSD = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`;

function matchByTrade(commitment: Commitment, items: LinkedEstimateItem[]): LinkedEstimateItem[] {
  const div = commitment.csiDivision
    || classifyToCSIDivision(`${commitment.description} ${commitment.phase ?? ''}`);
  if (div) {
    const matched = items.filter(it =>
      (it.csiDivision ?? classifyToCSIDivision(`${it.category} ${it.name}`)) === div);
    if (matched.length > 0) return matched;
  }
  const hay = `${commitment.description} ${commitment.phase ?? ''}`.toLowerCase();
  return items.filter(it => {
    const cat = (it.category ?? '').trim().toLowerCase();
    return cat.length >= 3 && hay.includes(cat);
  });
}

export function checkSubBid(commitment: Commitment, project: Project, costDb: CostDatabase): SubBidVerdict {
  try {
    const amount = commitment?.amount;
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return UNKNOWN;
    const items = project?.linkedEstimate?.items ?? [];
    if (items.length === 0) return UNKNOWN;

    let basis: 'linked_items' | 'trade_match' | null = null;
    let expected = 0;

    const links = (commitment.linkedEstimateItems ?? []).filter(Boolean);
    if (links.length > 0) {
      const byId = new Map(items.map(it => [it.materialId, it]));
      const linked = links.map(id => byId.get(id)).filter((it): it is LinkedEstimateItem => !!it);
      if (linked.length > 0) {
        basis = 'linked_items';
        expected = linked.reduce((sum, it) => sum + (it.lineTotal || 0), 0);
      }
    }

    if (!basis) {
      const matched = matchByTrade(commitment, items);
      if (matched.length > 0) {
        basis = 'trade_match';
        expected = matched.reduce((sum, it) => {
          const hit = lookupRate(costDb, it.category, it.unit);
          const learned = hit && hit.suggestedRate > 0 ? hit.suggestedRate * (it.quantity || 0) : 0;
          return sum + (learned > 0 ? learned : (it.lineTotal || 0));
        }, 0);
      }
    }

    if (!basis || expected <= 0) return UNKNOWN;

    const variancePct = amount / expected - 1;
    const gap = amount - expected;
    const pct = Math.abs(Math.round(variancePct * 100));
    const who = commitment.vendorName?.trim() || commitment.description.trim();
    const basisNoun = basis === 'linked_items' ? 'the estimate lines it covers' : 'the matching estimate scope';

    if (amount < LOW_BAND * expected) {
      return {
        verdict: 'low', basis, expected, gap, variancePct,
        detail: `${who}: ${fmtUSD(amount)} — ${basisNoun} totals ${fmtUSD(expected)} (${pct}% under). Confirm the full scope is included before counting the savings.`,
      };
    }
    if (amount > HIGH_BAND * expected) {
      return {
        verdict: 'high', basis, expected, gap, variancePct,
        detail: `${who}: ${fmtUSD(amount)} is ${pct}% above the ${fmtUSD(expected)} carried in ${basisNoun}. Worth a second look before signing.`,
      };
    }
    return {
      verdict: 'fair', basis, expected, gap, variancePct,
      detail: `${who}: ${fmtUSD(amount)} is in line with the ${fmtUSD(expected)} carried in ${basisNoun}.`,
    };
  } catch {
    return UNKNOWN;
  }
}
