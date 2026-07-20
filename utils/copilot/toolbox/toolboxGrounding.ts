// utils/copilot/toolbox/toolboxGrounding.ts — grounds the Toolbox Talk topic
// picker in THIS job's own safety history: recent incidents and open hazards
// become suggested topics, so the morning talk speaks to what actually
// happened here rather than a generic checklist. Reads SafetyContext via
// ctx.safety (injected by the copilot host).
import type { CopilotContext, Grounding } from '../types';
import type { SuggestedTopic } from './toolboxGaps';

interface IncidentLike { type?: string; description?: string }
interface HazardLike { description?: string; status?: string }

export async function buildToolboxGrounding(c: CopilotContext): Promise<Grounding> {
  const facts: string[] = [];
  const suggested: SuggestedTopic[] = [];
  if (c.project?.name) facts.push(`Toolbox talk on ${c.project.name}.`);

  const incidents = (c.safety?.getIncidentsForProject?.(c.projectId) ?? []) as IncidentLike[];
  for (const inc of incidents.slice(0, 2)) {
    const kind = (inc.type ?? 'incident').replace(/_/g, ' ');
    const desc = (inc.description ?? '').trim();
    suggested.push({
      label: `Lessons from our recent ${kind}`,
      value: `Reviewing our recent ${kind} on site and how the crew prevents it happening again`,
      basis: desc ? `you logged: ${desc.slice(0, 60)}` : 'turn a real incident into a lesson',
      source: 'incident',
    });
    if (desc) facts.push(`Recent ${kind}: ${desc.slice(0, 80)}.`);
  }

  const hazards = (c.safety?.getHazardsForProject?.(c.projectId) ?? []) as HazardLike[];
  const open = hazards.filter((h) => h.status !== 'resolved' && h.status !== 'closed');
  for (const h of open.slice(0, 2)) {
    const desc = (h.description ?? '').trim();
    if (!desc) continue;
    suggested.push({
      label: `Open hazard: ${desc.slice(0, 36)}`,
      value: `Controlling the open hazard on site: ${desc.slice(0, 70)}`,
      basis: 'an unresolved hazard on this job',
      source: 'hazard',
    });
  }

  return { facts, data: { suggestedTopics: suggested } };
}
