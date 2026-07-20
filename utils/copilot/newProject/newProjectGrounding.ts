// utils/copilot/newProject/newProjectGrounding.ts — grounds new-project setup
// in what this contractor actually builds. Reads their existing projects (via
// ctx.ctx = ProjectContext) and derives the modal type / finish / region, so
// the interview's defaults are theirs rather than a generic guess. No project
// exists yet — that's the whole point of this capability — so grounding leans
// entirely on the account's history.
import type { CopilotContext, Grounding } from '../types';

interface ProjectLike { type?: string; quality?: string; location?: string }

/** Most-frequent non-empty string in a list, or null. Deterministic on ties
 *  (first-seen wins) so grounding is stable across sessions. */
function modal(values: (string | undefined | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) {
    const s = (v ?? '').trim();
    if (!s) continue;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [k, n] of counts) {
    if (n > bestN) { best = k; bestN = n; }
  }
  return best;
}

export async function buildNewProjectGrounding(c: CopilotContext): Promise<Grounding> {
  const projects = (c.ctx?.projects ?? []) as ProjectLike[];
  const usualType = modal(projects.map((p) => p.type));
  const usualQuality = modal(projects.map((p) => p.quality));
  const usualLocation = modal(projects.map((p) => p.location).filter((l) => l && l !== 'United States'));

  const facts: string[] = [];
  if (projects.length) facts.push(`You've run ${projects.length} project${projects.length === 1 ? '' : 's'} in MAGE.`);
  if (usualType) facts.push(`Most of your jobs are ${usualType.replace(/_/g, ' ')}.`);
  if (usualLocation) facts.push(`Usually around ${usualLocation}.`);

  return {
    facts,
    data: { usualType, usualQuality, usualLocation, count: projects.length },
  };
}
