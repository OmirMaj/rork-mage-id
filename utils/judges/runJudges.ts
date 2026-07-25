// utils/judges/runJudges.ts — gathers inputs and runs the JUDGES engine.
// Mirrors utils/plans/askYourPlans.ts: pure engine + a thin async wrapper.
import type { Project, Commitment, ChangeOrder, Invoice, ProjectType, MaterialReceipt } from '@/types';
import { buildCostDatabase, type CostSample } from '@/utils/costDatabase';
import { computeCalibration } from '@/utils/estimateCalibration';
import { computeMarginRisk } from '@/utils/marginRiskScore';
import { mageAISmart } from '@/utils/mageAI';
import { buildEstimatePrompt, estimateSchema, scopeCacheKey, type WizardAnswers } from '@/utils/scopeQuestions';
import { computeBidVerdict } from './computeBidVerdict';
import { computeCapacityLoad } from './capacityLoad';
import { aggregateTypeMargin } from './typeMargin';
import { narrateVerdict } from './narrateVerdict';
import type { BidVerdict, JudgesLine } from './types';

export interface JudgesContext {
  projects: Project[];
  commitments: Commitment[];
  changeOrders?: ChangeOrder[];
  invoices?: Invoice[];
  receipts?: MaterialReceipt[];
  /** Self-perform labor samples (utils/laborSamples.ts) — crew hours priced
   *  at the GC's configured loaded rates. Optional; feeds the cost book. */
  laborSamples?: CostSample[];
}

export interface JudgesResult {
  verdict: BidVerdict;
  narration: string;
  scopeSummary?: string;
}

/** Turn a described scope into priced line inputs via the estimate-wizard AI. */
export async function draftLinesFromScope(answers: WizardAnswers): Promise<{ lines: JudgesLine[]; summary: string } | null> {
  const res = await mageAISmart(buildEstimatePrompt(answers), estimateSchema, scopeCacheKey(answers));
  if (!res.success || !res.data || !Array.isArray(res.data.lineItems)) return null;
  const lines: JudgesLine[] = res.data.lineItems.map((li: { category: string; unit: string; quantity: number; unitCost: number; total: number }) => ({
    category: li.category,
    unit: li.unit,
    quantity: li.quantity,
    // Lump-sum lines sometimes arrive as unitCost 0 with the money in `total`.
    bidUnit: li.unitCost > 0 ? li.unitCost : (li.total > 0 && li.quantity > 0 ? li.total / li.quantity : 0),
  }));
  return { lines, summary: typeof res.data.summary === 'string' ? res.data.summary : '' };
}

export async function runJudges(params: {
  lines: JudgesLine[];
  projectType: ProjectType;
  timelineWindow?: { startISO: string; endISO: string };
  targetMargin: number;
  project?: Project;      // when judging an existing project's estimate (enables marginRisk)
  ctx: JudgesContext;
  scopeSummary?: string;
}): Promise<JudgesResult> {
  const { projects, commitments, receipts, laborSamples } = params.ctx;
  const costDb = buildCostDatabase(projects, commitments, receipts, laborSamples);
  let calibration; try { calibration = computeCalibration({ projects, commitments }); } catch { /* additive */ }
  let capacity; if (params.timelineWindow) { try { capacity = computeCapacityLoad(projects, params.timelineWindow.startISO, params.timelineWindow.endISO); } catch { /* additive */ } }
  let typeMargin; try { typeMargin = aggregateTypeMargin(projects, params.projectType, commitments); } catch { /* additive */ }
  let marginRisk;
  if (params.project) {
    try { marginRisk = computeMarginRisk({ project: params.project, changeOrders: params.ctx.changeOrders ?? [], commitments, invoices: params.ctx.invoices ?? [] }); } catch { /* additive */ }
  }
  const verdict = computeBidVerdict({ lines: params.lines, costDb, targetMargin: params.targetMargin, calibration, marginRisk, capacity, typeMargin });
  const narration = await narrateVerdict(verdict);
  return { verdict, narration, scopeSummary: params.scopeSummary };
}
