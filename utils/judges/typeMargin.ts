// utils/judges/typeMargin.ts — "what do my <type> jobs actually earn?"
// Realized margin per closed project = (revenue - actual cost)/revenue, where
// revenue is the linked estimate grandTotal and actual cost is the estimate-
// actuals total (real actuals, else signed commitments as the cost proxy). Pure.
import type { Project, Commitment, ProjectType } from '@/types';
import { computeEstimateActuals } from '@/utils/estimateActuals';
import type { TypeMarginSummary } from './types';

const isClosed = (p: Project) => p.status === 'completed' || p.status === 'closed';

export function realizedMarginPct(project: Project, commitments: Commitment[]): number | null {
  const revenue = project.linkedEstimate?.grandTotal ?? 0;
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

export function aggregateTypeMargin(closedProjects: Project[], type: ProjectType, commitments: Commitment[]): TypeMarginSummary {
  const margins: number[] = [];
  for (const p of closedProjects) {
    if (!isClosed(p) || p.type !== type) continue;
    const m = realizedMarginPct(p, commitments);
    if (m !== null) margins.push(m);
  }
  if (margins.length === 0) return { avgMarginPct: null, jobCount: 0 };
  const avg = margins.reduce((a, b) => a + b, 0) / margins.length;
  return { avgMarginPct: avg, jobCount: margins.length };
}
