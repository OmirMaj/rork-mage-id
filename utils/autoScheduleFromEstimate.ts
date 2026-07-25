import { mageAI } from '@/utils/mageAI';
import { createId, buildScheduleFromTasks } from '@/utils/scheduleEngine';
import { autoScheduleSchema, normalizeGeneratedTask, SCHEDULE_PHASES } from '@/utils/scheduleGenSchema';
import { buildPaceFacts, paceFactsBlock } from '@/utils/copilot/scheduleBuilder/paceGrounding';
import type { Project, ScheduleTask, ProjectSchedule, DependencyLink, DependencyType, LinkedEstimate } from '@/types';

export interface AutoScheduleResult {
  schedule: ProjectSchedule;
  tasks: ScheduleTask[];
  linkedItemCount: number;
}

// Ephemeral handoff so the generator screen can pass a draft to the review
// screen without serializing large task arrays through navigation params.
let pendingDraft: AutoScheduleResult | null = null;
export function stashDraft(d: AutoScheduleResult) { pendingDraft = d; }
export function takeDraft(): AutoScheduleResult | null { const d = pendingDraft; pendingDraft = null; return d; }

function buildEstimateSummary(estimate: LinkedEstimate): { summary: string; categoryMap: Map<string, string[]> } {
  const byCategory: Record<string, { names: string[]; totalQty: number; totalCost: number; itemIds: string[] }> = {};
  estimate.items.forEach(item => {
    const cat = (item.category || 'general').toLowerCase();
    if (!byCategory[cat]) byCategory[cat] = { names: [], totalQty: 0, totalCost: 0, itemIds: [] };
    byCategory[cat].names.push(item.name);
    byCategory[cat].totalQty += item.quantity || 0;
    byCategory[cat].totalCost += item.lineTotal || 0;
    byCategory[cat].itemIds.push(item.materialId);
  });

  const categoryMap = new Map<string, string[]>();
  const lines: string[] = [];
  Object.entries(byCategory).forEach(([cat, info]) => {
    categoryMap.set(cat, info.itemIds);
    const sample = info.names.slice(0, 3).join(', ');
    lines.push(`- ${cat}: ${info.names.length} items (${sample}${info.names.length > 3 ? '...' : ''}), ~$${Math.round(info.totalCost).toLocaleString()}`);
  });

  return {
    summary: lines.join('\n'),
    categoryMap,
  };
}

export async function generateScheduleFromEstimate(
  project: Project,
  estimate: LinkedEstimate,
  /** ALL projects — the pace book's evidence base (utils/pace/paceBook.ts).
   *  Optional so legacy call sites keep working; when present, durations are
   *  grounded in the contractor's measured per-trade pace. */
  allProjects?: Project[],
): Promise<AutoScheduleResult> {
  if (!estimate || !estimate.items || estimate.items.length === 0) {
    throw new Error('Estimate has no line items to generate a schedule from.');
  }

  const { summary, categoryMap } = buildEstimateSummary(estimate);

  // Best-effort pace grounding — a book error must never block generation.
  let paceBlock = '';
  try {
    paceBlock = paceFactsBlock(buildPaceFacts(allProjects ?? []).facts);
  } catch {
    // ignore — generate ungrounded
  }

  const prompt = `You are a senior construction scheduler. Build a realistic construction schedule for this project based on its estimate line items. Group tasks into logical phases with dependencies.

PROJECT:
Name: ${project.name}
Type: ${project.type}
Square Footage: ${project.squareFootage || 'unspecified'}
Quality Tier: ${project.quality}
Location: ${project.location}

ESTIMATE LINE-ITEM SUMMARY (by material category):
${summary}
Estimate grand total: $${Math.round(estimate.grandTotal).toLocaleString()}
${paceBlock ? `\n${paceBlock}\n` : ''}
INSTRUCTIONS:
1. Return a JSON object with a "tasks" array.
2. Each task must have: id (string like "t1","t2"), name, phase (one of: ${SCHEDULE_PHASES.join(', ')}), duration (working days, integer), predecessorIds (array of other task ids — FS dependencies), isMilestone (bool), isCriticalPath (bool), crewSize (integer 1-8), wbs (like "1.1","2.3"), rationale (ONE sentence explaining WHY this task is sequenced here and how its duration was derived, e.g. "Framing precedes drywall; 5 days scaled from 1,800 SF at a 4-person crew"), assumption (bool — true if you GUESSED the duration/sequence rather than deriving it from the estimate quantities), linkedCategories (array of estimate category names this task draws from).
3. Include a "Project Start" milestone (duration 0) and "Project Complete" milestone (duration 0).
4. Generate 15-35 tasks based on scope. Use realistic durations scaled to sqft and grand total.
5. Use category totals to weight durations — heavier categories (concrete/framing/MEP) get more days.
6. Mark tasks on the longest chain as isCriticalPath: true.
7. Link every task to the relevant estimate categories via linkedCategories so we can tie spend to schedule.
8. If the estimate has almost no site-work materials but large finishes, skew the schedule toward interior work.
9. Every task MUST include a non-empty rationale. Set assumption:true when the estimate lacks the quantities to size the task and you fell back to a rule of thumb.

Output JSON only. No prose.`;

  const aiResult = await mageAI({
    prompt,
    schema: autoScheduleSchema,
    tier: 'smart',
    maxTokens: 2500,
  });

  if (!aiResult.success) {
    throw new Error(aiResult.error || 'AI schedule generation failed');
  }

  let parsed: any = aiResult.data;
  if (typeof parsed === 'string') {
    let cleaned = parsed.trim();
    if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
    if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
    if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
    try {
      parsed = JSON.parse(cleaned.trim());
    } catch {
      throw new Error('AI returned invalid JSON');
    }
  }

  const taskArray: any[] = Array.isArray(parsed) ? parsed : (parsed?.tasks ?? []);
  if (!taskArray || taskArray.length === 0) {
    throw new Error('AI returned no tasks');
  }

  // Normalize (shared, testable — utils/scheduleGenSchema.ts)
  const safeTasks = taskArray.map((t: any, idx: number) => normalizeGeneratedTask(t, idx));

  // Build real ScheduleTask objects
  const tasks: ScheduleTask[] = safeTasks.map((t, idx) => {
    const linkedItemIds: string[] = (t.linkedCategories || []).flatMap((cat: string) => categoryMap.get(cat) ?? []);
    const uniqueLinkedIds: string[] = Array.from(new Set(linkedItemIds));
    return {
      id: createId('task'),
      title: t.name,
      phase: t.phase,
      durationDays: Math.max(t.isMilestone ? 0 : 1, t.duration),
      startDay: 1,
      progress: 0,
      crew: `Crew ${idx + 1}`,
      crewSize: t.crewSize,
      dependencies: [],
      dependencyLinks: [],
      notes: '',
      rationale: t.rationale,
      assumption: t.assumption,
      status: 'not_started' as const,
      isMilestone: t.isMilestone,
      wbsCode: t.wbs,
      isCriticalPath: t.isCriticalPath,
      isWeatherSensitive: ['Site Work', 'Demo', 'Foundation', 'Framing', 'Roofing', 'Landscaping'].includes(t.phase),
      linkedEstimateItems: uniqueLinkedIds,
    };
  });

  // Resolve predecessors
  const idMap = new Map<string, string>();
  safeTasks.forEach((t, idx) => idMap.set(t.id, tasks[idx].id));
  for (let i = 0; i < tasks.length; i++) {
    const pid = safeTasks[i].predecessorIds ?? [];
    tasks[i].dependencyLinks = pid
      .filter((p: string) => idMap.has(p))
      .map((p: string) => ({
        taskId: idMap.get(p)!,
        type: 'FS' as DependencyType,
        lagDays: 0,
      }));
    tasks[i].dependencies = tasks[i].dependencyLinks!.map((l: DependencyLink) => l.taskId);
  }

  const scheduleName = `${project.name} Schedule (from Estimate)`;
  const schedule = buildScheduleFromTasks(scheduleName, project.id, tasks);
  const finalSchedule: ProjectSchedule = {
    ...schedule,
    projectId: project.id,
    updatedAt: new Date().toISOString(),
  };

  const linkedItemCount = tasks.reduce((sum, t) => sum + (t.linkedEstimateItems?.length ?? 0), 0);

  return {
    schedule: finalSchedule,
    tasks,
    linkedItemCount,
  };
}
