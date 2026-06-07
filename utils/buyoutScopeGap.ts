// buyoutScopeGap.ts — what's in the estimate that nobody's buying out?
//
// The classic margin leak at buyout: the GC awards framing, drywall, MEP — and
// then nobody's covering the blocking, the backing, the firestopping, the
// hardware. Scope falls between two subs' bids and the GC eats it. Or the
// reverse — two packages both claim the same line and the GC pays twice.
//
// This audits coverage of the estimate against the bid packages and commitments
// that exist (both carry estimate-item links — BidPackage.linkedEstimateItemIds
// and Commitment.linkedEstimateItems). It answers, deterministically:
//   • Which estimate dollars are covered by a package or a signed commitment?
//   • Which are UNCOVERED — at risk of being missed at buyout?
//   • Which are covered by more than one package — at risk of double-buy?
//
// A second, optional layer (analyzeAdjacentScope) asks the model for the scope
// that isn't even a line item yet — the adjacent work each trade typically
// needs that estimators forget. That's the AI in "scope-gap AI."

import type { Project, BidPackage, Commitment, LinkedEstimateItem } from '@/types';
import { CSI_DIVISION_BY_NUMBER, classifyToCSIDivision } from '@/utils/csiMasterFormat';
import { mageAI } from '@/utils/mageAI';

const UNCATEGORIZED = '00';

export interface ScopeItemCoverage {
  materialId: string;
  name: string;
  csiDivision: string;
  budget: number;
  packageCount: number;
  commitmentCount: number;
}

export interface DivisionCoverage {
  division: string;
  title: string;
  totalBudget: number;
  uncoveredBudget: number;
  coveragePct: number;
  uncoveredItems: ScopeItemCoverage[];
}

export interface ScopeGapReport {
  totalBudget: number;
  coveredBudget: number;
  uncoveredBudget: number;
  /** 0–100 share of estimate budget covered by a package or commitment. */
  coveragePct: number;
  /** Items in no package and no commitment, by budget desc. */
  uncoveredItems: ScopeItemCoverage[];
  /** Items claimed by 2+ active packages — possible double-buy. */
  overlapItems: ScopeItemCoverage[];
  byDivision: DivisionCoverage[];
  packageCount: number;
  commitmentCount: number;
  /** False when no packages or commitments exist yet — run Generative Setup
   *  first rather than reading the whole estimate as a gap. */
  hasStructure: boolean;
}

function divisionFor(item: LinkedEstimateItem): string {
  const raw = item.csiDivision?.trim();
  if (raw && raw.length >= 2) return raw.slice(0, 2);
  return classifyToCSIDivision(`${item.name} ${item.category}`.trim()) ?? UNCATEGORIZED;
}

function divisionTitle(num: string): string {
  if (num === UNCATEGORIZED) return 'Uncategorized';
  return CSI_DIVISION_BY_NUMBER[num]?.title ?? `Division ${num}`;
}

/**
 * Build the coverage report. Pure — no side effects. Packages that are
 * cancelled and commitments still in draft don't count as coverage.
 */
export function computeScopeGaps(
  project: Project,
  bidPackages: BidPackage[],
  commitments: Commitment[],
): ScopeGapReport {
  const estimate = project.linkedEstimate;
  const activePackages = bidPackages.filter(
    p => p.projectId === project.id && p.status !== 'cancelled',
  );
  const realCommitments = commitments.filter(
    c => c.projectId === project.id && c.status !== 'draft',
  );
  const hasStructure = activePackages.length > 0 || realCommitments.length > 0;

  if (!estimate || estimate.items.length === 0) {
    return {
      totalBudget: 0, coveredBudget: 0, uncoveredBudget: 0, coveragePct: 100,
      uncoveredItems: [], overlapItems: [], byDivision: [],
      packageCount: activePackages.length, commitmentCount: realCommitments.length,
      hasStructure,
    };
  }

  // Index coverage counts per estimate item.
  const pkgCount = new Map<string, number>();
  for (const p of activePackages) {
    for (const id of p.linkedEstimateItemIds ?? []) {
      pkgCount.set(id, (pkgCount.get(id) ?? 0) + 1);
    }
  }
  const commCount = new Map<string, number>();
  for (const c of realCommitments) {
    for (const id of c.linkedEstimateItems ?? []) {
      commCount.set(id, (commCount.get(id) ?? 0) + 1);
    }
  }

  const coverages: ScopeItemCoverage[] = estimate.items.map(it => ({
    materialId: it.materialId,
    name: it.name,
    csiDivision: divisionFor(it),
    budget: it.lineTotal ?? 0,
    packageCount: pkgCount.get(it.materialId) ?? 0,
    commitmentCount: commCount.get(it.materialId) ?? 0,
  }));

  const totalBudget = coverages.reduce((s, c) => s + c.budget, 0);
  const uncovered = coverages.filter(c => c.packageCount === 0 && c.commitmentCount === 0);
  const uncoveredBudget = uncovered.reduce((s, c) => s + c.budget, 0);
  const coveredBudget = totalBudget - uncoveredBudget;
  const overlapItems = coverages
    .filter(c => c.packageCount >= 2)
    .sort((a, b) => b.budget - a.budget);

  // Group uncovered into divisions for a readable punch list.
  const divMap = new Map<string, DivisionCoverage>();
  for (const c of coverages) {
    const key = c.csiDivision;
    const d = divMap.get(key) ?? {
      division: key, title: divisionTitle(key),
      totalBudget: 0, uncoveredBudget: 0, coveragePct: 0, uncoveredItems: [],
    };
    d.totalBudget += c.budget;
    if (c.packageCount === 0 && c.commitmentCount === 0) {
      d.uncoveredBudget += c.budget;
      d.uncoveredItems.push(c);
    }
    divMap.set(key, d);
  }
  const byDivision = [...divMap.values()]
    .map(d => ({
      ...d,
      coveragePct: d.totalBudget > 0 ? Math.round(((d.totalBudget - d.uncoveredBudget) / d.totalBudget) * 100) : 100,
      uncoveredItems: d.uncoveredItems.sort((a, b) => b.budget - a.budget),
    }))
    .filter(d => d.uncoveredBudget > 0)
    .sort((a, b) => b.uncoveredBudget - a.uncoveredBudget);

  return {
    totalBudget,
    coveredBudget,
    uncoveredBudget,
    coveragePct: totalBudget > 0 ? Math.round((coveredBudget / totalBudget) * 100) : 100,
    uncoveredItems: uncovered.sort((a, b) => b.budget - a.budget),
    overlapItems,
    byDivision,
    packageCount: activePackages.length,
    commitmentCount: realCommitments.length,
    hasStructure,
  };
}

// ── AI adjacency layer ─────────────────────────────────────────────────────

export interface AdjacentScopeItem {
  trade: string;
  item: string;
  why: string;
}

export interface AdjacentScopeResult {
  success: boolean;
  items: AdjacentScopeItem[];
  cached?: boolean;
  error?: string;
}

const ADJACENT_SCHEMA_HINT = {
  items: [{ trade: 'Framing', item: 'Fire blocking & draft stops', why: 'Required by code, rarely line-itemed; framer assumes it\'s excluded.' }],
};

/**
 * Ask the model for the adjacent scope each present trade typically needs but
 * that estimators forget — the work that isn't a line item yet. Seeds the
 * prompt with the divisions actually in the estimate so suggestions are
 * relevant, not generic. Cached per project + division set.
 */
export async function analyzeAdjacentScope(project: Project): Promise<AdjacentScopeResult> {
  const estimate = project.linkedEstimate;
  if (!estimate || estimate.items.length === 0) {
    return { success: false, items: [], error: 'No estimate to analyze.' };
  }

  const divisions = [...new Set(estimate.items.map(divisionFor))]
    .filter(d => d !== UNCATEGORIZED)
    .map(d => `${d} ${divisionTitle(d)}`);
  const tradeList = divisions.length > 0 ? divisions.join(', ') : 'general construction';

  const prompt = `You are a veteran general contractor reviewing a residential/commercial buyout for scope gaps.
The estimate covers these CSI divisions: ${tradeList}.
List the scope items that are COMMONLY MISSED at buyout for these trades — adjacent work that falls between subcontractors and the GC ends up eating. Focus on items a sub will assume are excluded unless explicitly called out (blocking/backing, fire-stopping, flashing, transitions, terminations, patching, temporary protection, hoisting, cleanup, permits/inspections specific to a trade).
Return 6-12 specific items. For each: the trade, the item, and a one-sentence why. Do not include items obviously already in scope. Be specific to the divisions listed.`;

  const res = await mageAI({
    prompt,
    schemaHint: ADJACENT_SCHEMA_HINT,
    tier: 'smart',
    maxTokens: 1400,
    cacheKey: `scopegap_${project.id}_${divisions.join('|')}`,
    cacheHours: 24,
  });

  if (!res.success || !res.data) {
    return { success: false, items: [], error: res.error || 'AI unavailable', cached: res.cached };
  }
  const rawItems = Array.isArray(res.data?.items) ? res.data.items : [];
  const items: AdjacentScopeItem[] = rawItems
    .map((it: any) => ({
      trade: String(it?.trade ?? '').trim(),
      item: String(it?.item ?? '').trim(),
      why: String(it?.why ?? '').trim(),
    }))
    .filter((it: AdjacentScopeItem) => it.item.length > 0);

  return { success: true, items, cached: res.cached };
}
