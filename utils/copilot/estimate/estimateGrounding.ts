// utils/copilot/estimate/estimateGrounding.ts — grounding for the estimate
// interview. THE moat: every price the interview proposes is cited from the
// contractor's OWN closed jobs — learned unit costs (costDatabase) and
// per-category bid calibration — not a generic template. Competitors price from
// national averages; we price from your history.
import type { CopilotContext, Grounding } from '../types';
import type { Project, Commitment, MaterialReceipt } from '@/types';
import { buildCostDatabase, type CostSample } from '@/utils/costDatabase';
import type { SeededRate } from '@/utils/costSeedCore';
import { computeCalibration } from '@/utils/estimateCalibration';

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export async function buildEstimateGrounding(c: CopilotContext): Promise<Grounding> {
  const project = c.project;
  const ctx = (c.ctx ?? {}) as { projects?: Project[]; commitments?: Commitment[]; receipts?: MaterialReceipt[]; laborSamples?: CostSample[]; seeds?: SeededRate[] };
  const projects: Project[] = Array.isArray(ctx.projects) ? ctx.projects : [];
  const commitments: Commitment[] = Array.isArray(ctx.commitments) ? ctx.commitments : [];
  const receipts: MaterialReceipt[] | undefined = Array.isArray(ctx.receipts) ? ctx.receipts : undefined;
  // Self-perform labor (D6): crew hours × the GC's configured loaded rates,
  // prebuilt by useLaborCostSamples in the ctx producer (app/copilot.tsx).
  const laborSamples: CostSample[] | undefined = Array.isArray(ctx.laborSamples) ? ctx.laborSamples : undefined;
  // Cold-start seeds (hooks/useCostSeeds) — same ctx-bag route as receipts and
  // labor. Without them the interview's cost book is EMPTY for a seeded
  // contractor and every price it proposes comes from generic LLM guessing,
  // which is precisely the cold start the seeding feature was built to close.
  const seeds: SeededRate[] | undefined = Array.isArray(ctx.seeds) ? ctx.seeds : undefined;

  const projectQuality = project?.quality;
  const projectSqft = project?.squareFootage && project.squareFootage > 0 ? project.squareFootage : undefined;
  const globalMarkup = project?.linkedEstimate?.globalMarkup;
  const defaultMarkupPct = typeof globalMarkup === 'number' && globalMarkup > 0 ? globalMarkup : undefined;

  const facts: string[] = [];
  if (projectQuality || projectSqft) {
    facts.push(`Project: ${projectSqft ? `${projectSqft} SF` : 'size unknown'}, ${projectQuality ?? 'standard'} quality${project?.type ? `, ${project.type}` : ''}.`);
  }

  // Learned unit costs + bid calibration — best-effort so a cost-book error
  // never blocks the interview.
  let costBookEntries = 0;
  try {
    const db = buildCostDatabase(projects, commitments, receipts, laborSamples, seeds);
    costBookEntries = db.entries.length;
    for (const e of db.entries.slice(0, 4)) {
      // A seeded-only entry is a rate the contractor STATED. Phrasing it as
      // "runs $X on your jobs (0 jobs)" would be both self-contradicting and
      // the exact conflation the seeding firewall exists to prevent, so the
      // model is told plainly which kind of number it is holding.
      if (e.provenance === 'seeded') {
        facts.push(`${cap(e.trade)}: $${e.suggestedRate.toFixed(2)}/${e.unit} is a rate the contractor SET THEMSELVES — self-reported, not measured on any job here. Price from it, but never call it their history or cite a job count for it.`);
      } else {
        facts.push(`${cap(e.trade)} runs $${e.suggestedRate.toFixed(2)}/${e.unit} on your jobs (${e.confidence} confidence, ${e.jobCount} job${e.jobCount === 1 ? '' : 's'}).`);
      }
    }
    const cal = computeCalibration({ projects, commitments });
    if (cal.hasData && cal.categories[0] && cal.categories[0].direction !== 'aligned') {
      facts.push(cal.categories[0].detail);
    }
  } catch {
    // ignore — grounding is additive, not required
  }

  if (project?.linkedEstimate?.items?.length) {
    facts.push(`This project already has a ${project.linkedEstimate.items.length}-line estimate — building fresh replaces it (the prior version is saved).`);
  }

  // Inline literal (not a named-interface variable) so it satisfies Grounding's
  // `Record<string, unknown>` data type; estimateGaps casts it back.
  return { facts, data: { projectQuality, projectSqft, defaultMarkupPct, costBookEntries } };
}
