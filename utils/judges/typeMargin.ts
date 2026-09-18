// utils/judges/typeMargin.ts — "what do my <type> jobs actually earn?"
// Realized margin per closed project = (revenue - actual cost)/revenue, where
// revenue is the CONTRACT VALUE — the estimate plus every approved owner change
// order (getContractValue) — and actual cost is the estimate-actuals total
// (real actuals, else signed commitments as the cost proxy). Pure.
//
// WHY CHANGE ORDERS ARE REQUIRED (audit round 2, #3). Revenue used to be the
// bare linkedEstimate.grandTotal while cost already carried the sub money
// that bought the change-order scope (a commitment edited up, or paid-to-date
// past its original). So a kitchen bid at $80k that grew $15k of approved,
// paid scope and settled $76k of sub cost read (80−76)/80 = 5% instead of
// (95−76)/95 = 20%, and JUDGES told the GC who manages scope growth best to
// walk from his best job type. `changeOrders` is a required argument so no
// caller can quietly go back to the one-sided figure.
import type { Project, Commitment, ProjectType, ChangeOrder } from '@/types';
import { computeEstimateActuals } from '@/utils/estimateActuals';
import { getContractValue } from '@/utils/projectFinancials';
import type { TypeMarginSummary } from './types';

const isClosed = (p: Project) => p.status === 'completed' || p.status === 'closed';

/** The revenue side of realized margin: estimate + this project's approved
 *  owner change orders. Exported so /business can weight by the SAME base the
 *  margin was measured on (one revenue definition per number). */
export function realizedRevenue(project: Project, changeOrders: ChangeOrder[]): number {
  return getContractValue(project, changeOrders.filter(co => co.projectId === project.id));
}

export function realizedMarginPct(project: Project, commitments: Commitment[], changeOrders: ChangeOrder[]): number | null {
  const revenue = realizedRevenue(project, changeOrders);
  if (revenue <= 0) return null;
  const report = computeEstimateActuals(project, commitments);
  if (!report.hasEstimate) return null;
  // A signed commitment is the FLOOR of what that scope cost — partial
  // paid-to-date on a closed job must not read as a fat margin.
  const cost = Math.max(report.totalActual, report.totalCommitted);
  if (cost <= 0) return null;
  const margin = (revenue - cost) / revenue;
  // Clamp to a sane band so one bad record can't dominate an average.
  return Math.max(-1, Math.min(1, margin));
}

export function aggregateTypeMargin(
  closedProjects: Project[],
  type: ProjectType,
  commitments: Commitment[],
  changeOrders: ChangeOrder[],
): TypeMarginSummary {
  const margins: number[] = [];
  for (const p of closedProjects) {
    if (!isClosed(p) || p.type !== type) continue;
    const m = realizedMarginPct(p, commitments, changeOrders);
    if (m !== null) margins.push(m);
  }
  if (margins.length === 0) return { avgMarginPct: null, jobCount: 0 };
  const avg = margins.reduce((a, b) => a + b, 0) / margins.length;
  return { avgMarginPct: avg, jobCount: margins.length };
}
