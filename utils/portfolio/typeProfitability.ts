// utils/portfolio/typeProfitability.ts — "what does each job type earn me?"
//
// Loops all 12 ProjectTypes, computes realized margin per closed project,
// and aggregates per type. Uses realizedMarginPct VERBATIM from
// utils/judges/typeMargin.ts — do NOT fork the math or it silently diverges
// from JUDGES verdicts (plan Portfolio grounding gap b).
//
// Pure. No React. No network. Never throws.

import type { Project, Commitment, ProjectType } from '@/types';
import { PROJECT_TYPES } from '@/types';
import { realizedMarginPct } from '@/utils/judges/typeMargin';
import { effectiveEstimateTotal } from '@/utils/estimateCommit';

export interface TypeProfitRow {
  type: ProjectType;
  label: string;
  jobCount: number;
  /** null when fewer than 2 jobs with a margin basis — gated: true */
  avgMarginPct: number | null;
  /** Revenue-weighted average margin across all jobs with a margin basis */
  revenueWeightedMarginPct: number | null;
  totalRevenue: number;
  /** true when jobCount < 2 — suppress the margin number in UI */
  gated: boolean;
}

export interface TypeProfitabilityCoverage {
  /** How many total projects exist across all types */
  totalProjects: number;
  /** How many closed projects with a margin basis */
  closedWithBasis: number;
  /** Total closed project count */
  closedTotal: number;
}

export interface TypeProfitabilityResult {
  rows: TypeProfitRow[];
  coverage: TypeProfitabilityCoverage;
  /** Plan-canonical definition note shown in UI — never removed or paraphrased */
  definitionNote: string;
}

const isClosed = (p: Project) => p.status === 'completed' || p.status === 'closed';

export function buildTypeProfitability(
  projects: Project[],
  commitments: Commitment[],
): TypeProfitabilityResult {
  // Per-type accumulator
  const typeMap = new Map<
    ProjectType,
    { margins: number[]; revenues: number[]; revenueWeighted: number[] }
  >();
  for (const ti of PROJECT_TYPES) {
    typeMap.set(ti.id, { margins: [], revenues: [], revenueWeighted: [] });
  }

  let closedTotal = 0;
  let closedWithBasis = 0;

  for (const p of projects) {
    if (!isClosed(p)) continue;
    closedTotal++;
    const acc = typeMap.get(p.type);
    if (!acc) continue; // unrecognized type — skip
    const m = realizedMarginPct(p, commitments);
    const rev = effectiveEstimateTotal(p);
    if (m !== null && rev > 0) {
      closedWithBasis++;
      acc.margins.push(m);
      acc.revenues.push(rev);
    }
  }

  const rows: TypeProfitRow[] = PROJECT_TYPES.map(ti => {
    const acc = typeMap.get(ti.id)!;
    const jobCount = acc.margins.length;
    const totalRevenue = acc.revenues.reduce((s, v) => s + v, 0);
    const gated = jobCount < 2;

    let avgMarginPct: number | null = null;
    let revenueWeightedMarginPct: number | null = null;

    if (!gated) {
      avgMarginPct = acc.margins.reduce((s, v) => s + v, 0) / jobCount;
      // Revenue-weighted: Σ(margin × revenue) / Σrevenue
      const weightedSum = acc.margins.reduce((s, m, i) => s + m * acc.revenues[i]!, 0);
      revenueWeightedMarginPct = totalRevenue > 0 ? weightedSum / totalRevenue : avgMarginPct;
    }

    return {
      type: ti.id,
      label: ti.label,
      jobCount,
      avgMarginPct,
      revenueWeightedMarginPct,
      totalRevenue,
      gated,
    };
  });

  return {
    rows,
    coverage: {
      totalProjects: projects.length,
      closedTotal,
      closedWithBasis,
    },
    definitionNote:
      'Margin = (contract − committed cost) ÷ contract. Excludes approved change orders from cost — same definition used in Bid Advisor.',
  };
}
