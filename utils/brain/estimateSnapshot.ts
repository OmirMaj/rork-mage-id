// utils/brain/estimateSnapshot.ts — pure builder for estimate_confidence_snapshot payload.
// Reuses computeEstimateConfidence to attach per-line confidence bands.
// No React imports. No side effects. G4: callers wrap in try/catch.

import type { Project } from '@/types';
import { computeEstimateConfidence, type EstimateConfidenceReport } from '@/utils/estimateConfidence';
import { buildCostDatabase } from '@/utils/costDatabase';
import type { Commitment } from '@/types';
import type { MaterialReceipt } from '@/types';
import type { CostSample } from '@/utils/costDatabase';

export interface EstimateSnapshotPayload {
  estimateId: string;
  grandTotal: number;
  /** Per-line record, capped at 40 lines. */
  lines: Array<{ id: string; category: string; total: number; confidenceBand: string }>;
  /** Fraction 0..1 of estimate $ backed by aligned proven costs. */
  coveragePct: number;
}

/**
 * Build the payload for a 'estimate_confidence_snapshot' prediction row.
 * Returns null when the project has no linked estimate (nothing to snapshot).
 */
export function buildEstimateSnapshotPayload(
  project: Project,
  allProjects: Project[],
  commitments: Commitment[],
  receipts: MaterialReceipt[] = [],
  laborSamples: CostSample[] = [],
): EstimateSnapshotPayload | null {
  const estimate = project.linkedEstimate;
  if (!estimate) return null;

  // Build the cost DB so we can get per-line confidence bands from history.
  const costDb = buildCostDatabase(allProjects, commitments, receipts, laborSamples);
  const report: EstimateConfidenceReport = computeEstimateConfidence(project, costDb);

  // Build a map from materialId → confidence so we can annotate each line.
  const confByMaterialId = new Map<string, string>();
  for (const lc of report.lines) {
    confByMaterialId.set(lc.materialId, lc.confidence);
  }

  const lines = estimate.items.slice(0, 40).map(item => ({
    id: item.materialId,
    category: item.category,
    total: item.lineTotal,
    confidenceBand: confByMaterialId.get(item.materialId) ?? 'no_history',
  }));

  return {
    estimateId: estimate.id,
    grandTotal: estimate.grandTotal,
    lines,
    coveragePct: report.backedPct,
  };
}
