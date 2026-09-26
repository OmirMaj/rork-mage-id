// utils/dashboardTables.ts — the money cells the desktop dashboard tables
// print (wave 6d, lane B1).
//
// Pure. Every cell is an ENGINE field or helper the phone card already prints;
// nothing is re-derived here (contract D8). An unknown value is `null`, which
// the table renders as '—', never $0. Footers are the engine's own totals, not
// a sum of the visible rows (scripts/validate-dashboard-tables.ts proves it).
//
// Scope: lane B1's job-costing tables. The WIP / Reports / Profit / Aging
// cells the spec also listed served lane B2, which was cut from wave 6d; they
// are not built (a helper nothing calls is dead code).

import type { JobCostLine, JobCostSummary } from './jobCostEngine';

export interface JobCostPhaseCells {
  budget: number;
  committed: number;
  actual: number;
  /** The engine's projected final (EAC) for the phase. */
  eac: number;
  /** projectedFinal − budget: positive = over (describeVariance owns words). */
  variance: number;
  /** actual / budget; null when the phase carries no budget (unbudgeted). */
  pctSpent: number | null;
}

export function jobCostPhaseCells(l: JobCostLine): JobCostPhaseCells {
  return {
    budget: l.budget,
    committed: l.committed,
    actual: l.actual,
    eac: l.projectedFinal,
    variance: l.variance,
    pctSpent: l.budget > 0 ? l.actual / l.budget : null,
  };
}

export interface JobCostFooterCells {
  budget: number;
  committed: number;
  actual: number;
  eac: number;
  variance: number;
  /** Σ phase overage the job headline absorbs into uncommitted budget. */
  absorbed: number;
}

/** The job's own totals — the KPI cards' figures, not Σ of the rows. */
export function jobCostFooter(s: JobCostSummary): JobCostFooterCells {
  return {
    budget: s.budget,
    committed: s.committed,
    actual: s.actual,
    eac: s.projectedFinal,
    variance: s.variance,
    absorbed: s.absorbedVariance,
  };
}

/** '% spent' cell text: a ratio → whole percent; unknown → '—'. */
export function pctSpentText(pct: number | null): string {
  return pct === null || !Number.isFinite(pct) ? '—' : `${Math.round(pct * 100)}%`;
}
