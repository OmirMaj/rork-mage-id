// utils/copilot/scheduleBuilder/generateScheduleFromAnswers.ts — the AI Schedule
// Builder generator: intake answers → a realistic ProjectSchedule (rationale +
// assumption per task). Mirrors generateScheduleFromEstimate but is grounded in
// the interview answers, not an estimate, so it needs no linked estimate.
// Produces the same AutoScheduleResult the review screen consumes.
import { mageAI } from '@/utils/mageAI';
import { createId, buildScheduleFromTasks } from '@/utils/scheduleEngine';
import { autoScheduleSchema, normalizeGeneratedTask, SCHEDULE_PHASES } from '@/utils/scheduleGenSchema';
import type { AutoScheduleResult } from '@/utils/autoScheduleFromEstimate';
import type { Project, ScheduleTask, ProjectSchedule, DependencyType, RFI, DailyFieldReport } from '@/types';
import type { ScheduleBuilderAnswers } from './questions';
import { buildAnswersPrompt } from './buildAnswersPrompt';
import { buildPaceFacts } from './paceGrounding';
import { computeRFILatency } from '@/utils/rfiLatency';
import { computeWeatherHistory, weatherHistoryFactLine } from '@/utils/weatherHistory';

const WEATHER_PHASES = ['Site Work', 'Demo', 'Foundation', 'Framing', 'Roofing', 'Landscaping'];

export async function generateScheduleFromAnswers(
  project: Project,
  answers: ScheduleBuilderAnswers,
  /** ALL projects — the pace book's evidence base. Optional (best-effort
   *  grounding): without it durations fall back to AI judgment. */
  allProjects?: Project[],
  /** THIS project's RFIs — grounds an "RFI LATENCY" fact so the model
   *  buffers approval-dependent tasks for slow design-team responders. */
  projectRFIs?: RFI[],
  /** THIS project's daily reports — grounds the WEATHER line in the
   *  contractor's real historical weather-lost days on this site. */
  projectReports?: DailyFieldReport[],
): Promise<AutoScheduleResult> {
  // Pace grounding is additive, never blocking — a book error must not stop
  // the builder (same contract as buildEstimateGrounding).
  let paceFacts: string[] = [];
  try {
    paceFacts = buildPaceFacts(allProjects ?? []).facts;
  } catch {
    // ignore — generate ungrounded
  }
  // RFI-latency + weather-history facts (E4): same additive contract.
  let rfiFactLine: string | null = null;
  try {
    if (projectRFIs?.length) rfiFactLine = computeRFILatency(projectRFIs).factLine;
  } catch {
    // ignore — generate ungrounded
  }
  let weatherFactLine: string | null = null;
  try {
    if (projectReports?.length) {
      const startMonth = answers.startDate ? new Date(answers.startDate).getMonth() : undefined;
      weatherFactLine = weatherHistoryFactLine(computeWeatherHistory(projectReports), startMonth);
    }
  } catch {
    // ignore — generate ungrounded
  }
  const prompt = buildAnswersPrompt(answers, project, SCHEDULE_PHASES as unknown as string[], paceFacts, rfiFactLine, weatherFactLine);

  const aiResult = await mageAI({
    prompt,
    schema: autoScheduleSchema,
    tier: 'smart',
    maxTokens: 4000,
    feature: 'scheduleCopilot',
  });
  if (!aiResult.success || !aiResult.data) {
    throw new Error(aiResult.error ?? 'Could not generate the schedule. Try again.');
  }

  let parsed: any = aiResult.data;
  if (typeof parsed === 'string') {
    let c = parsed.trim();
    if (c.startsWith('```json')) c = c.slice(7);
    if (c.startsWith('```')) c = c.slice(3);
    if (c.endsWith('```')) c = c.slice(0, -3);
    try { parsed = JSON.parse(c.trim()); } catch { throw new Error('AI returned invalid JSON'); }
  }
  const taskArray: any[] = Array.isArray(parsed) ? parsed : (parsed?.tasks ?? []);
  if (!taskArray || taskArray.length === 0) throw new Error('AI returned no tasks');

  const safeTasks = taskArray.map((t: any, idx: number) => normalizeGeneratedTask(t, idx));

  const tasks: ScheduleTask[] = safeTasks.map((t, idx) => ({
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
    isWeatherSensitive: answers.weather !== 'interior' && WEATHER_PHASES.includes(t.phase),
    linkedEstimateItems: [],
  }));

  // Resolve predecessors (AI ids → real ids), all FS.
  const idMap = new Map<string, string>();
  safeTasks.forEach((t, idx) => idMap.set(t.id, tasks[idx].id));
  for (let i = 0; i < tasks.length; i++) {
    const pids = (safeTasks[i].predecessorIds ?? []).filter((p: string) => idMap.has(p));
    tasks[i].dependencyLinks = pids.map((p: string) => ({ taskId: idMap.get(p)!, type: 'FS' as DependencyType, lagDays: 0 }));
    tasks[i].dependencies = tasks[i].dependencyLinks!.map((l) => l.taskId);
  }

  const schedule = buildScheduleFromTasks(`${project.name} Schedule`, project.id, tasks);
  const finalSchedule: ProjectSchedule = {
    ...schedule,
    projectId: project.id,
    // Honor the interview's calendar + start so CPM dates land correctly. NEVER
    // stamp a start the contractor didn't give (jump-bug guard).
    ...(answers.startDate ? { startDate: answers.startDate } : {}),
    ...(answers.workDaysPerWeek ? { workingDaysPerWeek: answers.workDaysPerWeek } : {}),
    updatedAt: new Date().toISOString(),
  };

  return { schedule: finalSchedule, tasks, linkedItemCount: 0 };
}
