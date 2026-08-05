import type { CostDatabase } from '@/utils/costDatabase';

/**
 * The three properties that make the activation funnel's "aha" step measurable.
 * Attached to `estimate_generated`. A SEEDED rate is a self-stated claim, not
 * measured history, so it counts toward engagement (`used_learned_costs`) but
 * NOT toward `learned_rate_count` — a seeded-only user reads as
 * used_learned_costs:true, learned_rate_count:0, jobs_analyzed:0.
 */
export interface EstimateGroundingProps {
  used_learned_costs: boolean;
  learned_rate_count: number;
  jobs_analyzed: number;
}

export function estimateGroundingProps(db: CostDatabase): EstimateGroundingProps {
  const entries = db?.entries ?? [];
  return {
    used_learned_costs: entries.length > 0,
    learned_rate_count: entries.filter((e) => e.provenance !== 'seeded').length,
    jobs_analyzed: db?.jobsAnalyzed ?? 0,
  };
}
