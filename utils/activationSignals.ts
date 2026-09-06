import type { CostDatabase } from '@/utils/costDatabase';
import type { GroundingCounts } from '@/utils/groundingChip';

/**
 * The three properties that make the activation funnel's "aha" step measurable.
 * Attached to `estimate_generated`; the PostHog "Activation" funnel's aha step
 * is `estimate_generated[used_learned_costs=true]`.
 *
 * `learned_rate_count` and `jobs_analyzed` describe the BOOK: how many
 * measured rates the contractor has, from how many closed jobs. A SEEDED rate
 * is a self-stated claim, not measured history, so it never counts there.
 *
 * `used_learned_costs` describes the RUN when the caller can say what the run
 * was — pass the counts of the grounding bundle that actually went into the
 * prompt (utils/groundingChip GroundingBundle.counts) and it is true ONLY when
 * that prompt carried at least one MEASURED rate. A seeded-only run reads
 * used_learned_costs:false, learned_rate_count:0, jobs_analyzed:0: the
 * contractor has not yet seen MAGE price from their history, so the aha must
 * not fire for them (re-review A3).
 *
 * Without run counts the legacy book-level reading stays: true when the book
 * has any entry at all. ProjectContext's emitters use that form, and their
 * book is built without seeds (closed-job history only), so it is measured-
 * only there by construction. Surfaces that SELECT grounding per run (the
 * wizard, Quick Estimate) must pass their run's counts.
 */
export interface EstimateGroundingProps {
  used_learned_costs: boolean;
  learned_rate_count: number;
  jobs_analyzed: number;
}

export function estimateGroundingProps(db: CostDatabase, run?: GroundingCounts): EstimateGroundingProps {
  const entries = db?.entries ?? [];
  const runMeasured = run ? (Number.isFinite(run.measured) ? run.measured : 0) : null;
  return {
    used_learned_costs: runMeasured === null ? entries.length > 0 : runMeasured > 0,
    learned_rate_count: entries.filter((e) => e.provenance !== 'seeded').length,
    jobs_analyzed: db?.jobsAnalyzed ?? 0,
  };
}
