// utils/copilot/schedule/scheduleGrounding.ts — grounding for the schedule interview.
//
// Compact, read-only snapshot of the project's own numbers that the interview
// cites. v1 grounds on the linked estimate's heavy categories + project traits.
//
// NOTE: `hasLeadSignal` is `false` for every heavy category in v1 — so the
// interview asks about long-lead procurement (the correct default when we have
// no signal). Wiring per-category lead-time evidence from project memory is a
// follow-up: projectMemory.retrieveRelevant(query, docs, topK) is synchronous
// and needs the caller to load MemoryDoc[] first, which the shell doesn't yet.
import type { CopilotContext, Grounding } from '../types';

interface EstimateLineLike { category?: string; lineTotal?: number }

export async function buildScheduleGrounding(c: CopilotContext): Promise<Grounding> {
  const project = c.project;
  const est = project?.linkedEstimate ?? null;
  const items = ((est as { items?: EstimateLineLike[] } | null)?.items ?? []) as EstimateLineLike[];

  // Heavy categories by $ — the ones worth a long-lead question.
  const byCat = new Map<string, number>();
  for (const it of items) {
    const cat = it.category ?? 'Other';
    byCat.set(cat, (byCat.get(cat) ?? 0) + (it.lineTotal ?? 0));
  }
  const heavyCategories = [...byCat.entries()]
    .map(([name, total]) => ({ name, total, hasLeadSignal: false }))
    .filter(x => x.total >= 15000)
    .sort((a, b) => b.total - a.total);

  const facts: string[] = [];
  if (project?.squareFootage) facts.push(`Project is ${project.squareFootage} SF, ${project.quality ?? 'standard'} quality.`);
  for (const cat of heavyCategories) facts.push(`${cat.name}: $${cat.total.toLocaleString()} (heavy category).`);

  return {
    facts,
    data: {
      heavyCategories,
      crewCapHistory: undefined,
      occupiedLikely: (project?.type ?? '').toLowerCase().includes('remodel'),
      weatherSensitive: heavyCategories.some(cat => /roof|site|concrete|excav/i.test(cat.name)),
    },
  };
}
