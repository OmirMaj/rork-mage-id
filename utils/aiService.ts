import { mageAI } from '@/utils/mageAI';
import { z } from 'zod';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { checkAILimit, recordAIUsage, type SubscriptionTierKey, type RequestTier } from '@/utils/aiRateLimiter';
import type { Project, ProjectSchedule, ScheduleTask, ChangeOrder, Invoice, Subcontractor, Equipment } from '@/types';

const AI_CACHE_PREFIX = 'mageid_ai_cache_';
const COPILOT_HISTORY_PREFIX = 'mageid_copilot_';
const COMPANY_PROFILE_KEY = 'mageid_company_ai_profile';
const AI_USAGE_KEY = 'mageid_ai_usage';

export interface AIUsage {
  date: string;
  copilotCount: number;
  builderCount: number;
}

export async function getAIUsage(): Promise<AIUsage> {
  try {
    const stored = await AsyncStorage.getItem(AI_USAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as AIUsage;
      const today = new Date().toISOString().split('T')[0];
      if (parsed.date === today) return parsed;
    }
  } catch { /* ignore */ }
  return { date: new Date().toISOString().split('T')[0], copilotCount: 0, builderCount: 0 };
}

export async function incrementAIUsage(feature: 'copilot' | 'builder'): Promise<AIUsage> {
  const usage = await getAIUsage();
  if (feature === 'copilot') usage.copilotCount++;
  else usage.builderCount++;
  usage.date = new Date().toISOString().split('T')[0];
  await AsyncStorage.setItem(AI_USAGE_KEY, JSON.stringify(usage));
  return usage;
}

export async function getCachedResult<T>(key: string, maxAgeMs: number): Promise<T | null> {
  try {
    const stored = await AsyncStorage.getItem(AI_CACHE_PREFIX + key);
    if (!stored) return null;
    const { data, timestamp } = JSON.parse(stored);
    if (Date.now() - timestamp > maxAgeMs) return null;
    return data as T;
  } catch { return null; }
}

export async function setCachedResult(key: string, data: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(AI_CACHE_PREFIX + key, JSON.stringify({ data, timestamp: Date.now() }));
  } catch { /* ignore */ }
}

export interface CompanyAIProfile {
  specialties: string[];
  trades: string[];
  preferredSize: string;
  location: string;
  certifications: string[];
}

export async function getCompanyProfile(): Promise<CompanyAIProfile | null> {
  try {
    const stored = await AsyncStorage.getItem(COMPANY_PROFILE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch { return null; }
}

export async function saveCompanyProfile(profile: CompanyAIProfile): Promise<void> {
  await AsyncStorage.setItem(COMPANY_PROFILE_KEY, JSON.stringify(profile));
}

export interface CopilotMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  actionItems?: Array<{ text: string; priority: 'urgent' | 'important' | 'suggestion' }>;
  dataPoints?: Array<{ label: string; value: string }>;
  timestamp: string;
}

export async function getCopilotHistory(projectId: string): Promise<CopilotMessage[]> {
  try {
    const stored = await AsyncStorage.getItem(COPILOT_HISTORY_PREFIX + projectId);
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
}

export async function saveCopilotHistory(projectId: string, messages: CopilotMessage[]): Promise<void> {
  const trimmed = messages.slice(-20);
  await AsyncStorage.setItem(COPILOT_HISTORY_PREFIX + projectId, JSON.stringify(trimmed));
}

const copilotResponseSchema = z.object({
  answer: z.string().default(''),
  confidence: z.enum(['high', 'medium', 'low']).default('medium'),
  actionItems: z.array(z.object({
    text: z.string(),
    priority: z.enum(['urgent', 'important', 'suggestion']),
  })).default([]),
  dataPoints: z.array(z.object({
    label: z.string(),
    value: z.string(),
  })).default([]),
});

export type CopilotResponse = z.infer<typeof copilotResponseSchema>;

export function buildProjectContext(project: Project | null, schedule: ProjectSchedule | null): string {
  if (!project) return 'No project selected.';
  const estimate = project.linkedEstimate ?? project.estimate;
  const tasks = schedule?.tasks ?? [];
  const done = tasks.filter(t => t.status === 'done').length;
  const inProgress = tasks.filter(t => t.status === 'in_progress').length;
  const overdue = tasks.filter(t => t.status !== 'done' && t.progress < 100).length;

  return `Project: ${project.name}
Status: ${project.status}
Type: ${project.type}
Location: ${project.location}
Square Footage: ${project.squareFootage || 'N/A'}

Schedule:
- Total tasks: ${tasks.length}
- Completed: ${done}
- In progress: ${inProgress}
- Overdue: ${overdue}
- Health score: ${schedule?.healthScore ?? 'N/A'}
- Total duration: ${schedule?.totalDurationDays ?? 0} days
- Critical path: ${schedule?.criticalPathDays ?? 0} days

Estimate:
- Grand total: $${estimate && 'grandTotal' in estimate ? estimate.grandTotal : 0}
- Items: ${estimate && 'items' in estimate ? (estimate as any).items?.length ?? 0 : 0}

Risk items: ${schedule?.riskItems?.map(r => r.title).join('; ') || 'None'}

Tasks (top 25):
${tasks.slice(0, 25).map(t =>
    `- ${t.title} (${t.phase}): ${t.progress}% | ${t.status} | Day ${t.startDay}-${t.startDay + t.durationDays}${t.crew ? ` | Crew: ${t.crew}` : ''}`
  ).join('\n') || 'No tasks'}`;
}

export async function askCopilot(userMessage: string, projectContext: string): Promise<CopilotResponse> {
  console.log('[AI Copilot] Sending message:', userMessage.substring(0, 50));
  const aiResult = await mageAI({
    prompt: `You are MAGE AI, a senior construction project management advisor built into the MAGE ID app. You have access to the user's project data below. Answer their question with specific, actionable advice based on their actual data. Be concise (2-4 sentences max for the main answer). If there are action items, list them. Use construction industry terminology.

PROJECT DATA:
${projectContext}

USER QUESTION: ${userMessage}

Respond with a helpful, specific answer based on the project data above. Include relevant numbers and task names from the data. If you identify risks or issues, flag them clearly.`,
    schema: copilotResponseSchema,
    tier: 'fast',
  });
  if (!aiResult.success) {
    throw new Error(aiResult.error || 'AI unavailable');
  }
  console.log('[AI Copilot] Response received');
  return aiResult.data;
}

export const scheduleRiskSchema = z.object({
  overallConfidence: z.number().default(0),
  predictedEndDate: z.string().default(''),
  predictedDelay: z.number().default(0),
  risks: z.array(z.object({
    taskName: z.string().default(''),
    severity: z.enum(['high', 'medium', 'low']).default('low'),
    delayProbability: z.number().default(0),
    delayDays: z.number().default(0),
    reasons: z.array(z.string()).default([]),
    recommendation: z.string().default(''),
  })).default([]),
  summary: z.string().default(''),
});

export type ScheduleRiskResult = z.infer<typeof scheduleRiskSchema>;

export async function analyzeScheduleRisk(schedule: ProjectSchedule, weatherData?: string): Promise<ScheduleRiskResult> {
  console.log('[AI Risk] Analyzing schedule risk...');
  const taskData = schedule.tasks.map(t => ({
    name: t.title,
    phase: t.phase,
    progress: t.progress,
    status: t.status,
    duration: t.durationDays,
    startDay: t.startDay,
    isCritical: t.isCriticalPath,
    isWeatherSensitive: t.isWeatherSensitive,
    crew: t.crew,
    crewSize: t.crewSize,
    depCount: t.dependencies?.length ?? 0,
  }));

  const aiResult = await mageAI({
    prompt: `You are an AI construction schedule analyst. Analyze this schedule and predict which tasks are at risk of delay. Consider: task dependencies, progress rates, critical path, weather sensitivity, and crew constraints.

SCHEDULE DATA:
Total tasks: ${schedule.tasks.length}
Total duration: ${schedule.totalDurationDays} days
Health score: ${schedule.healthScore}/100
Working days/week: ${schedule.workingDaysPerWeek}

TASKS:
${JSON.stringify(taskData, null, 2)}

WEATHER (next 7 days):
${weatherData || 'No weather data available'}

Analyze and predict risks. For each at-risk task, explain WHY based on the data and give ONE specific actionable recommendation. Rate overall project completion confidence 0-100.`,
    schema: scheduleRiskSchema,
    tier: 'smart',
    maxTokens: 3000,
  });
  if (!aiResult.success) {
    throw new Error(aiResult.error || 'Schedule risk analysis unavailable');
  }
  console.log('[AI Risk] Analysis complete');
  return aiResult.data;
}

export const bidScoreSchema = z.object({
  matchScore: z.number().default(0),
  matchReasons: z.array(z.string()).default([]),
  concerns: z.array(z.string()).default([]),
  bidStrategy: z.string().default(''),
  estimatedWinProbability: z.number().default(0),
});

export type BidScoreResult = z.infer<typeof bidScoreSchema>;

export async function scoreBid(bid: {
  title: string;
  department: string;
  estimated_value: number;
  naics_code?: string;
  set_aside?: string | null;
  state?: string;
  description?: string;
}, profile: CompanyAIProfile): Promise<BidScoreResult> {
  console.log('[AI Bid] Scoring bid:', bid.title?.substring(0, 40));
  const aiResult = await mageAI({
    prompt: `You are an AI bid analyst for construction contractors. Score how well this bid matches the contractor's profile. Consider: trade alignment, project size fit, location, set-aside eligibility, and certification requirements.

BID:
Title: ${bid.title}
Agency: ${bid.department}
Value: $${bid.estimated_value}
NAICS: ${bid.naics_code || 'N/A'}
Set-aside: ${bid.set_aside || 'None'}
State: ${bid.state || 'Unknown'}
Description: ${bid.description?.substring(0, 500) || 'No description'}

COMPANY PROFILE:
Specialties: ${profile.specialties.join(', ')}
Trades: ${profile.trades.join(', ')}
Preferred size: ${profile.preferredSize}
Location: ${profile.location}
Certifications: ${profile.certifications.join(', ') || 'None'}

Score 0-100 match. Give 2-3 reasons why it matches or doesn't. Give one sentence of bid strategy advice. Estimate win probability.`,
    schema: bidScoreSchema,
    tier: 'fast',
    maxTokens: 2000,
  });
  if (!aiResult.success) {
    throw new Error(aiResult.error || 'Bid scoring unavailable');
  }
  console.log('[AI Bid] Score:', aiResult.data.matchScore);
  return aiResult.data;
}

export const dailyReportSchema = z.object({
  summary: z.string().default(''),
  workCompleted: z.array(z.string()).default([]),
  workInProgress: z.array(z.string()).default([]),
  issuesAndDelays: z.array(z.string()).default([]),
  tomorrowPlan: z.array(z.string()).default([]),
  weatherImpact: z.string().default(''),
  crewsOnSite: z.array(z.object({
    trade: z.string().default(''),
    count: z.number().default(0),
    activity: z.string().default(''),
  })).default([]),
  safetyNotes: z.string().default(''),
});

export type DailyReportGenResult = z.infer<typeof dailyReportSchema>;

export async function generateDailyReport(
  projectName: string,
  tasks: ScheduleTask[],
  weatherStr: string,
): Promise<DailyReportGenResult> {
  console.log('[AI DFR] Generating daily report...');
  const activeTasks = tasks.filter(t => t.status === 'in_progress' || t.status === 'done');
  const aiResult = await mageAI({
    prompt: `You are a construction superintendent writing a professional daily field report. Based on the project schedule data below, generate a complete daily report for today. Write in professional but concise construction industry language.

PROJECT: ${projectName}
DATE: ${new Date().toLocaleDateString()}
WEATHER: ${weatherStr}

TODAY'S TASKS:
${activeTasks.map(t => `- ${t.title} (${t.phase}): ${t.progress}% complete, Status: ${t.status}, Crew: ${t.crew || 'TBD'} (${t.crewSize || 0} workers)`).join('\n') || 'No active tasks'}

COMPLETED TODAY:
${activeTasks.filter(t => t.status === 'done').map(t => t.title).join(', ') || 'None completed today'}

Generate a professional daily report. Be specific based on the task data.`,
    schema: dailyReportSchema,
    tier: 'fast',
  });
  if (!aiResult.success) {
    throw new Error(aiResult.error || 'Daily report generation unavailable');
  }
  console.log('[AI DFR] Report generated');
  return aiResult.data;
}

export const estimateValidationSchema = z.object({
  overallScore: z.number().default(5),
  issues: z.array(z.object({
    type: z.enum(['warning', 'error', 'suggestion', 'ok']).default('suggestion'),
    title: z.string().default(''),
    detail: z.string().default(''),
    potentialImpact: z.string().default(''),
  })).default([]),
  missingItems: z.array(z.string()).default([]),
  costPerSqFtAssessment: z.string().default(''),
  materialLaborRatioAssessment: z.string().default(''),
  contingencyRecommendation: z.string().default(''),
  summary: z.string().default(''),
});

export type EstimateValidationResult = z.infer<typeof estimateValidationSchema>;

export async function validateEstimate(
  projectType: string,
  squareFootage: number,
  totalCost: number,
  materialCost: number,
  laborCost: number,
  itemCount: number,
  hasContingency: boolean,
  location: string,
): Promise<EstimateValidationResult> {
  console.log('[AI Estimate] Validating estimate...');
  const costPerSF = squareFootage > 0 ? (totalCost / squareFootage).toFixed(2) : 'N/A';
  const matLabRatio = laborCost > 0 ? (materialCost / laborCost).toFixed(1) : 'N/A';

  const aiResult = await mageAI({
    prompt: `You are an AI construction estimator reviewer. Validate this estimate against industry standards and flag potential issues.

PROJECT TYPE: ${projectType}
SQUARE FOOTAGE: ${squareFootage} SF
LOCATION: ${location}
TOTAL COST: $${totalCost.toFixed(2)}
MATERIAL COST: $${materialCost.toFixed(2)}
LABOR COST: $${laborCost.toFixed(2)}
ITEM COUNT: ${itemCount}
COST PER SF: $${costPerSF}
MAT:LAB RATIO: ${matLabRatio}:1
HAS CONTINGENCY: ${hasContingency ? 'Yes' : 'No'}

Review this estimate. Flag issues like: unusual mat:lab ratio, missing contingency, cost/SF out of range for project type, missing common items. Score overall estimate health 1-10.`,
    schema: estimateValidationSchema,
    tier: 'smart',
    maxTokens: 5000,
  });
  if (!aiResult.success) {
    throw new Error(aiResult.error || 'Estimate validation unavailable');
  }
  console.log('[AI Estimate] Validation complete, score:', aiResult.data.overallScore);
  return aiResult.data;
}

export const aiScheduleSchema = z.object({
  projectName: z.string().default(''),
  estimatedDuration: z.number().default(30),
  tasks: z.array(z.object({
    title: z.string().default(''),
    phase: z.string().default('General'),
    durationDays: z.number().default(5),
    crew: z.string().default('General crew'),
    crewSize: z.number().default(2),
    isMilestone: z.boolean().default(false),
    isCriticalPath: z.boolean().default(false),
    isWeatherSensitive: z.boolean().default(false),
    predecessorIndex: z.number().optional(),
    dependencyType: z.enum(['FS', 'SS', 'FF', 'SF']).optional(),
    lagDays: z.number().optional(),
    notes: z.string().optional(),
  })).default([]),
  assumptions: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
});

export type AIScheduleResult = z.infer<typeof aiScheduleSchema>;

export async function buildScheduleFromDescription(description: string): Promise<AIScheduleResult> {
  console.log('[AI Schedule] Building from description...');
  const aiResult = await mageAI({
    prompt: `You are a senior construction scheduler with 20 years of experience. Create a detailed, realistic construction schedule based on this project description.

PROJECT DESCRIPTION:
${description}

Create a complete schedule with:
1. All major construction phases in proper sequence
2. Realistic durations
3. Appropriate crew types and sizes
4. Dependencies (predecessorIndex = 0-indexed position in array)
5. Flag milestones (inspections, substantial completion)
6. Flag critical path tasks
7. Flag weather-sensitive tasks (concrete, roofing, exterior)
8. Notes for tasks with special considerations

Use phases: Site Work, Demo, Foundation, Framing, Roofing, MEP, Plumbing, Electrical, HVAC, Insulation, Drywall, Interior, Finishes, Landscaping, Inspections, General

Be specific with task names. Include inspections and mobilization/demobilization.`,
    schema: aiScheduleSchema,
    tier: 'smart',
    maxTokens: 8000,
  });
  if (!aiResult.success) {
    throw new Error(aiResult.error || 'AI schedule builder unavailable');
  }

  let parsed: any = aiResult.data;

  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      let cleaned = parsed.trim();
      if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
      if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
      if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
      try {
        parsed = JSON.parse(cleaned.trim());
      } catch {
        throw new Error('Could not parse AI schedule response. Please try again.');
      }
    }
  }

  parsed.projectName = parsed.projectName || description.substring(0, 60);
  parsed.estimatedDuration = typeof parsed.estimatedDuration === 'number' ? parsed.estimatedDuration : 30;
  parsed.tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
  parsed.assumptions = Array.isArray(parsed.assumptions) ? parsed.assumptions : [];
  parsed.warnings = Array.isArray(parsed.warnings) ? parsed.warnings : [];

  parsed.tasks = parsed.tasks.map((t: any) => ({
    title: t.title || t.name || 'Task',
    phase: t.phase || 'General',
    durationDays: typeof t.durationDays === 'number' ? t.durationDays : (typeof t.duration === 'number' ? t.duration : 5),
    crew: t.crew || 'General crew',
    crewSize: typeof t.crewSize === 'number' ? t.crewSize : 2,
    isMilestone: !!t.isMilestone,
    isCriticalPath: !!t.isCriticalPath,
    isWeatherSensitive: !!t.isWeatherSensitive,
    predecessorIndex: typeof t.predecessorIndex === 'number' ? t.predecessorIndex : undefined,
    dependencyType: t.dependencyType || undefined,
    lagDays: typeof t.lagDays === 'number' ? t.lagDays : undefined,
    notes: t.notes || undefined,
  }));

  console.log('[AI Schedule] Generated', parsed.tasks.length, 'tasks');
  return parsed;
}

export const changeOrderImpactSchema = z.object({
  scheduleDays: z.number().default(0),
  costImpact: z.object({
    materials: z.number().default(0),
    labor: z.number().default(0),
    equipment: z.number().default(0),
    total: z.number().default(0),
  }).default({ materials: 0, labor: 0, equipment: 0, total: 0 }),
  affectedTasks: z.array(z.object({
    taskName: z.string().default(''),
    currentEnd: z.string().default(''),
    newEnd: z.string().default(''),
    daysAdded: z.number().default(0),
  })).default([]),
  newProjectEndDate: z.string().default(''),
  downstreamEffects: z.array(z.string()).default([]),
  // The model sometimes returns `recommendation` as a list of suggestions
  // instead of a single string — coerce so the UI always gets a displayable
  // paragraph instead of crashing Zod validation and showing a partial banner.
  recommendation: z.preprocess(
    v => Array.isArray(v) ? v.filter(x => typeof x === 'string').join('\n\n')
      : typeof v === 'string' ? v
      : v != null ? String(v) : '',
    z.string().default(''),
  ),
  compressionOptions: z.array(z.object({
    description: z.string().default(''),
    costPremium: z.number().default(0),
    daysSaved: z.number().default(0),
  })).default([]),
});

export type ChangeOrderImpactResult = z.infer<typeof changeOrderImpactSchema>;

export async function analyzeChangeOrderImpact(
  changeDescription: string,
  lineItems: Array<{ name: string; quantity: number; unitPrice: number; total: number }>,
  schedule: ProjectSchedule | null,
): Promise<ChangeOrderImpactResult> {
  console.log('[AI CO] Analyzing change order impact...');
  const taskSummary = schedule?.tasks?.slice(0, 20).map(t =>
    `${t.title} (${t.phase}): Day ${t.startDay}-${t.startDay + t.durationDays}, ${t.progress}%`
  ).join('\n') || 'No schedule';

  const aiResult = await mageAI({
    prompt: `You are a construction change order analyst. Analyze the schedule and cost impact of this change order.

CHANGE ORDER:
Description: ${changeDescription}
Line Items:
${lineItems.map(i => `- ${i.name}: ${i.quantity} × $${i.unitPrice} = $${i.total}`).join('\n') || 'No line items yet'}
Total Change Amount: $${lineItems.reduce((s, i) => s + i.total, 0)}

CURRENT SCHEDULE:
Total duration: ${schedule?.totalDurationDays ?? 0} days
Tasks:
${taskSummary}

Predict schedule delay, cost impact, affected downstream tasks, and give a recommendation. Include compression options to reduce delay.`,
    schema: changeOrderImpactSchema,
    tier: 'smart',
    maxTokens: 3500,
  });
  if (!aiResult.success) {
    throw new Error(aiResult.error || 'Change order analysis unavailable');
  }
  console.log('[AI CO] Impact analysis complete');
  return aiResult.data;
}

export const weeklySummarySchema = z.object({
  weekRange: z.string().default(''),
  portfolioSummary: z.object({
    totalProjects: z.number().default(0),
    onTrack: z.number().default(0),
    atRisk: z.number().default(0),
    behind: z.number().default(0),
    combinedValue: z.number().default(0),
    tasksCompletedThisWeek: z.number().default(0),
  }).default({ totalProjects: 0, onTrack: 0, atRisk: 0, behind: 0, combinedValue: 0, tasksCompletedThisWeek: 0 }),
  projects: z.array(z.object({
    name: z.string().default(''),
    // `.catch()` lets us accept any value the model invents (e.g. "delayed",
    // "starting") and fall back to on_track rather than rejecting the whole row.
    status: z.enum(['on_track', 'at_risk', 'behind', 'ahead']).catch('on_track').default('on_track'),
    progressStart: z.number().default(0),
    progressEnd: z.number().default(0),
    keyAccomplishment: z.string().default(''),
    primaryRisk: z.string().default(''),
    recommendation: z.string().default(''),
  })).default([]),
  // Issues breakdown — the GC's main reason for opening Full Analysis.
  // Each row is one concrete problem with a cause, downstream impact,
  // and a specific fix. Sorted by severity in the UI.
  criticalIssues: z.array(z.object({
    projectName: z.string().default(''),
    severity:    z.enum(['critical', 'high', 'medium', 'low']).catch('medium').default('medium'),
    issue:       z.string().default(''),  // what's wrong (1 sentence)
    cause:       z.string().default(''),  // root cause / why it's happening
    impact:      z.string().default(''),  // what it's blocking / financial or schedule effect
    fix:         z.string().default(''),  // concrete next step the GC should take
  })).default([]),
  overallRecommendation: z.string().default(''),
});

export type WeeklySummaryResult = z.infer<typeof weeklySummarySchema>;

export async function rateLimitedGenerate<T extends z.ZodType>(
  subscriptionTier: SubscriptionTierKey,
  requestTier: RequestTier,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  schema: T,
): Promise<{ success: true; data: z.infer<T> } | { success: false; data: null; error: string }> {
  try {
    const limit = await checkAILimit(subscriptionTier, requestTier);
    if (!limit.allowed) {
      return { success: false, data: null, error: limit.message ?? 'Rate limit reached.' };
    }
    const prompt = messages.map(m => `${m.role}: ${m.content}`).join('\n\n');
    const aiResult = await mageAI({ prompt, schema, tier: 'fast' });
    if (!aiResult.success) {
      return { success: false, data: null, error: aiResult.error || 'AI analysis unavailable right now. Please try again.' };
    }
    await recordAIUsage(requestTier);
    return { success: true, data: aiResult.data };
  } catch (err) {
    console.error('[AI] Generation failed:', err);
    return { success: false, data: null, error: 'AI analysis unavailable right now. Please try again.' };
  }
}

export async function generateWeeklySummary(projects: Project[]): Promise<WeeklySummaryResult> {
  console.log('[AI Weekly] Generating summary for', projects.length, 'projects');
  const projectData = projects.map(p => {
    const schedule = p.schedule;
    const tasks = schedule?.tasks ?? [];
    const totalProgress = tasks.length > 0
      ? Math.round(tasks.reduce((s, t) => s + t.progress, 0) / tasks.length)
      : 0;
    const done       = tasks.filter(t => t.status === 'done').length;
    const inProgress = tasks.filter(t => t.status === 'in_progress').length;
    const onHold     = tasks.filter(t => t.status === 'on_hold').length;
    // A heuristic "stalled" signal — task is in progress but 0% progress
    // and no crew assigned. Often indicates a real-world block.
    const stalled = tasks.filter(t => t.status === 'in_progress' && t.progress === 0 && (t.crewSize ?? 0) === 0).length;
    const criticalPathStalled = tasks.filter(t => t.isCriticalPath && (t.status === 'on_hold' || (t.status === 'in_progress' && t.progress < 10))).map(t => t.title).slice(0, 5);
    const est = p.linkedEstimate ?? p.estimate;
    return {
      name: p.name,
      type: p.type,
      status: p.status,
      totalTasks: tasks.length,
      completedTasks: done,
      inProgressTasks: inProgress,
      onHoldTasks: onHold,
      stalledTasks: stalled,
      criticalPathStalled,
      overallProgress: totalProgress,
      healthScore: schedule?.healthScore ?? 0,
      totalValue: est && 'grandTotal' in est ? est.grandTotal : 0,
      riskItems: schedule?.riskItems?.map(r => r.title) ?? [],
      criticalPathLength: tasks.filter(t => t.isCriticalPath).length,
    };
  });

  const aiResult = await mageAI({
    prompt: `You are a senior construction project manager doing a deep diagnostic on a GC's portfolio. The GC just clicked "Full Analysis" because they want to know WHAT IS WRONG with each project, WHY it's happening, and WHAT TO DO about it.

PROJECTS:
${JSON.stringify(projectData, null, 2)}

CURRENT DATE: ${new Date().toLocaleDateString()}

Your job has two parts.

PART 1 — Per-project status snapshots (existing format): name, status, progress trend, key accomplishment, primary risk, one recommendation. Keep it terse.

PART 2 — CRITICAL ISSUES BREAKDOWN. THIS IS THE MAIN VALUE. Identify every concrete problem you can spot in the data: blocked tasks, overdue critical-path items, low health scores, missing risk mitigation, schedule slippage, scope concerns, cash-flow signals from tasks-vs-budget mismatches. For EACH issue produce four short fields:

  • issue   — what's wrong, in one sentence the GC can read in 2 seconds.
  • cause   — the ROOT CAUSE. Don't restate the issue. Trace upstream:
              "Drywall is delayed because rough-in inspection failed,
              which itself was caused by an electrical change order that
              wasn't sequenced." Be specific to THIS project's data.
  • impact  — the downstream effect: schedule days lost, $ exposure,
              other tasks blocked, contract risk, client-facing risk.
              Quantify when the data lets you.
  • fix     — ONE concrete action the GC should take TOMORROW. Not
              generic advice. Name a person to call, an item to order,
              a meeting to schedule, a decision to make.

Sort by severity: critical (will hit contract/payment), high (blocks 3+ tasks or 1+ wk delay), medium (slows progress), low (worth noting). Aim for 3-8 issues across the portfolio. If a project is genuinely fine, don't fabricate issues for it — say so in the recommendation instead.

Return ONLY JSON matching the schema. Be specific with project names so the GC knows which project each issue is about.`,
    schema: weeklySummarySchema,
    tier: 'smart',
    maxTokens: 4500,
  });
  if (!aiResult.success) {
    throw new Error(aiResult.error || 'Weekly summary unavailable');
  }
  console.log('[AI Weekly] Summary generated, issues:', (aiResult.data as WeeklySummaryResult).criticalIssues?.length ?? 0);
  return aiResult.data;
}

export const homeBriefingSchema = z.object({
  briefing: z.string().default(''),
  projects: z.array(z.object({
    name: z.string().default(''),
    // Accept 'ahead' too — Gemini often uses it. Any other value falls to on_track.
    status: z.enum(['on_track', 'at_risk', 'behind', 'ahead']).catch('on_track').default('on_track'),
    keyInsight: z.string().default(''),
    actionItem: z.string().default(''),
  })).default([]),
  urgentItems: z.array(z.string()).default([]),
});

export type HomeBriefingResult = z.infer<typeof homeBriefingSchema>;

export async function generateHomeBriefing(
  projects: Project[],
  invoices: Invoice[],
): Promise<HomeBriefingResult> {
  console.log('[AI Briefing] Generating for', projects.length, 'projects');
  const projectSummaries = projects.map(p => {
    const schedule = p.schedule;
    const tasks = schedule?.tasks ?? [];
    const done = tasks.filter(t => t.status === 'done').length;
    const overdue = tasks.filter(t => t.status !== 'done' && t.progress < 100 && t.startDay + t.durationDays < (schedule?.totalDurationDays ?? 999)).length;
    const est = p.linkedEstimate ?? p.estimate;
    const projectInvoices = invoices.filter(inv => inv.projectId === p.id);
    const pendingInvoices = projectInvoices.filter(inv => inv.status !== 'paid' && inv.status !== 'draft');
    return `Project: ${p.name}
  Type: ${p.type} | Status: ${p.status}
  Schedule health: ${schedule?.healthScore ?? 'N/A'}/100
  Tasks: ${tasks.length} total, ${done} done, ${overdue} potentially overdue
  Estimate: ${est && 'grandTotal' in est ? est.grandTotal.toLocaleString() : '0'}
  Pending invoices: ${pendingInvoices.length} totaling ${pendingInvoices.reduce((s, i) => s + (i.totalDue - i.amountPaid), 0).toLocaleString()}`;
  }).join('\n---\n');

  const aiResult = await mageAI({
    prompt: `You are analyzing a contractor's project portfolio. Give a brief daily briefing — 2-3 sentences per project highlighting the single most important thing they should know or act on TODAY. Flag any overdue invoices, schedule delays, or upcoming deadlines. Be specific with names and numbers.

PROJECTS:
${projectSummaries}

DATE: ${new Date().toLocaleDateString()}`,
    schema: homeBriefingSchema,
    schemaHint: {
      briefing: "2-3 sentence portfolio overview highlighting what needs attention today",
      projects: [{ name: "Project Name", status: "on_track", keyInsight: "Key insight for today", actionItem: "Specific action to take" }],
      urgentItems: ["Overdue invoice for Project X"],
    },
    tier: 'fast',
  });
  if (!aiResult.success) {
    throw new Error(aiResult.error || 'Home briefing unavailable');
  }
  console.log('[AI Briefing] Generated');
  return aiResult.data;
}

export const invoicePredictionSchema = z.object({
  predictedPaymentDate: z.string().default(''),
  confidenceLevel: z.enum(['high', 'medium', 'low']).default('medium'),
  daysFromDue: z.number().default(0),
  reasoning: z.string().default(''),
  tip: z.string().default(''),
});

export type InvoicePredictionResult = z.infer<typeof invoicePredictionSchema>;

export async function predictInvoicePayment(
  invoice: Invoice,
  projectName: string,
  clientHistory: { avgDaysLate: number; totalInvoices: number },
): Promise<InvoicePredictionResult> {
  console.log('[AI Invoice] Predicting payment for invoice #', invoice.number);
  const aiResult = await mageAI({
    prompt: `You are a construction payment analyst. Predict when this invoice will actually be paid based on the payment terms and client history.

INVOICE:
Number: #${invoice.number}
Amount: ${invoice.totalDue.toLocaleString()}
Issue date: ${invoice.issueDate}
Due date: ${invoice.dueDate}
Payment terms: ${invoice.paymentTerms}
Status: ${invoice.status}
Amount paid so far: ${invoice.amountPaid.toLocaleString()}
Project: ${projectName}

CLIENT HISTORY:
Avg days late: ${clientHistory.avgDaysLate}
Total past invoices: ${clientHistory.totalInvoices}

Predict the actual payment date, confidence level, and give a tip for getting paid faster.`,
    schema: invoicePredictionSchema,
    tier: 'fast',
  });
  if (!aiResult.success) {
    throw new Error(aiResult.error || 'Invoice prediction unavailable');
  }
  console.log('[AI Invoice] Prediction complete');
  return aiResult.data;
}

export const subEvaluationSchema = z.object({
  questionsToAsk: z.array(z.string()).default([]),
  typicalRates: z.object({
    journeyman: z.string().default(''),
    master: z.string().default(''),
    apprentice: z.string().default(''),
  }).default({ journeyman: '', master: '', apprentice: '' }),
  redFlags: z.array(z.string()).default([]),
  recommendation: z.string().default(''),
  trackRecord: z.string().optional(),
});

export type SubEvaluationResult = z.infer<typeof subEvaluationSchema>;

export async function evaluateSubcontractor(
  sub: Subcontractor,
  projectContext: string,
): Promise<SubEvaluationResult> {
  console.log('[AI Sub] Evaluating:', sub.companyName);
  const aiResult = await mageAI({
    prompt: `You are a construction subcontractor evaluator. Evaluate this subcontractor and provide hiring advice.

SUBCONTRACTOR:
Company: ${sub.companyName}
Contact: ${sub.contactName}
Trade: ${sub.trade}
License #: ${sub.licenseNumber || 'N/A'}
License expiry: ${sub.licenseExpiry || 'N/A'}
COI expiry: ${sub.coiExpiry || 'N/A'}
W9 on file: ${sub.w9OnFile ? 'Yes' : 'No'}
Bid history: ${sub.bidHistory.length} bids (${sub.bidHistory.filter(b => b.outcome === 'won').length} won)
Assigned projects: ${sub.assignedProjects.length}
Notes: ${sub.notes || 'None'}

CONTEXT:
${projectContext}

Provide: questions to ask before hiring, typical rates for their trade, red flags to watch for, and overall recommendation. If they have bid history, summarize their track record.`,
    schema: subEvaluationSchema,
    tier: 'fast',
  });
  if (!aiResult.success) {
    throw new Error(aiResult.error || 'Subcontractor evaluation unavailable');
  }
  console.log('[AI Sub] Evaluation complete');
  return aiResult.data;
}

export const equipmentAdviceSchema = z.object({
  // Model sometimes returns verbose strings ("it depends") — fall back to 'rent'
  // instead of letting the whole schema reject.
  recommendation: z.enum(['rent', 'buy', 'lease']).catch('rent').default('rent'),
  annualRentalCost: z.number().catch(0).default(0),
  purchasePrice: z.string().catch('').default(''),
  breakEvenProjects: z.number().catch(0).default(0),
  // Model occasionally returns an array of bullet points instead of a string —
  // coerce by joining.
  reasoning: z.preprocess(
    v => Array.isArray(v) ? v.join(' ') : v,
    z.string().catch('').default(''),
  ),
  reconsiderWhen: z.preprocess(
    v => Array.isArray(v) ? v.join(' ') : v,
    z.string().catch('').default(''),
  ),
});

export type EquipmentAdviceResult = z.infer<typeof equipmentAdviceSchema>;

export async function analyzeEquipmentRentVsBuy(
  equip: Equipment,
  projectsPerYear: number,
  avgDaysPerProject: number,
): Promise<EquipmentAdviceResult> {
  console.log('[AI Equipment] Analyzing rent vs buy:', equip.name);
  const aiResult = await mageAI({
    prompt: `You are a construction equipment financial advisor. Analyze whether this contractor should rent or buy this equipment.

EQUIPMENT:
Name: ${equip.name}
Type: ${equip.type}
Category: ${equip.category}
Make: ${equip.make}
Model: ${equip.model}
Daily rate: ${equip.dailyRate}
Current status: ${equip.status}
Utilization entries: ${equip.utilizationLog.length}

USAGE PATTERN:
Projects per year: ${projectsPerYear}
Avg days per project: ${avgDaysPerProject}
Estimated annual rental cost: ${(equip.dailyRate * avgDaysPerProject * projectsPerYear).toLocaleString()}

Analyze rent vs buy. Include annual rental cost estimate, typical purchase price range, break-even point, and when they should reconsider.`,
    schema: equipmentAdviceSchema,
    tier: 'fast',
  });
  if (!aiResult.success) {
    throw new Error(aiResult.error || 'Equipment analysis unavailable');
  }
  console.log('[AI Equipment] Analysis complete');
  return aiResult.data;
}

export const projectReportSchema = z.object({
  executiveSummary: z.string().default(''),
  scheduleStatus: z.string().default(''),
  budgetStatus: z.string().default(''),
  keyAccomplishments: z.array(z.string()).default([]),
  issuesAndRisks: z.array(z.string()).default([]),
  nextMilestones: z.array(z.string()).default([]),
  recommendations: z.array(z.string()).default([]),
});

export type ProjectReportResult = z.infer<typeof projectReportSchema>;

export const aiQuickEstimateSchema = z.object({
  projectSummary: z.string().default(''),
  materials: z.array(z.object({
    name: z.string().default('Item'),
    category: z.string().default('hardware'),
    unit: z.string().default('ea'),
    // The model sometimes omits quantity/unitPrice — default to 0 so the row
    // still renders (user can edit) instead of throwing away the whole estimate.
    quantity: z.number().default(0),
    unitPrice: z.number().default(0),
    supplier: z.string().default('Home Depot'),
    notes: z.string().optional(),
  })).default([]),
  labor: z.array(z.object({
    trade: z.string().default('Labor'),
    hourlyRate: z.number().default(0),
    hours: z.number().default(0),
    crew: z.string().default('General crew'),
    notes: z.string().optional(),
  })).default([]),
  assemblies: z.array(z.object({
    name: z.string().default('Assembly'),
    category: z.string().default('general'),
    quantity: z.number().default(1),
    unit: z.string().default('ea'),
    notes: z.string().optional(),
  })).default([]),
  additionalCosts: z.object({
    permits: z.number().default(0),
    dumpsterRental: z.number().default(0),
    equipmentRental: z.number().default(0),
    cleanup: z.number().default(0),
    contingencyPercent: z.number().default(10),
    overheadPercent: z.number().default(12),
  }).default({
    permits: 0,
    dumpsterRental: 0,
    equipmentRental: 0,
    cleanup: 0,
    contingencyPercent: 10,
    overheadPercent: 12,
  }),
  estimatedDuration: z.string().default('TBD'),
  costPerSqFt: z.number().default(0),
  confidenceScore: z.number().default(70),
  // Model sometimes returns warnings/tips as an object of { warning1: "...", warning2: "..." }
  // or a single string. Coerce any shape to string[].
  warnings: z.preprocess(
    v => Array.isArray(v) ? v
      : typeof v === 'string' ? [v]
      : v && typeof v === 'object' ? Object.values(v).map(x => String(x))
      : [],
    z.array(z.string()).default([]),
  ),
  savingsTips: z.preprocess(
    v => Array.isArray(v) ? v
      : typeof v === 'string' ? [v]
      : v && typeof v === 'object' ? Object.values(v).map(x => String(x))
      : [],
    z.array(z.string()).default([]),
  ),
});

export type AIQuickEstimateResult = z.infer<typeof aiQuickEstimateSchema>;

export async function generateQuickEstimate(
  description: string,
  projectType: string,
  squareFootage: number,
  qualityTier: string,
  location: string,
): Promise<AIQuickEstimateResult> {
  console.log('[AI Quick Estimate] Generating for:', description.substring(0, 60));

  const aiResult = await mageAI({
    prompt: `You are an expert construction estimator with current 2025-2026 pricing knowledge. Generate a detailed, realistic construction estimate for this project.

PROJECT: ${description}
Type: ${projectType || 'General Construction'} | SqFt: ${squareFootage || 'unspecified'} | Quality: ${qualityTier || 'standard'} | Location: ${location || 'US'}

Generate 8-15 material line items with real quantities and 2025 market pricing (reference Home Depot, Lowe's, ABC Supply). Include 3-6 labor trades with realistic hourly rates and hours. Add 2-4 relevant assemblies. Set contingency 8-12% and overhead 10-14%. Include 2-3 warnings and 2-3 money-saving tips.`,
    schema: aiQuickEstimateSchema,
    schemaHint: {
      projectSummary: "Brief project overview",
      materials: [{ name: "Lumber 2x4x8", category: "lumber", unit: "ea", quantity: 120, unitPrice: 8.50, supplier: "Home Depot", notes: "framing" }],
      labor: [{ trade: "Carpenter", hourlyRate: 75, hours: 40, crew: "Framing crew", notes: "framing and rough carpentry" }],
      assemblies: [{ name: "Frame Interior Wall", category: "framing", quantity: 4, unit: "lf" }],
      additionalCosts: { permits: 800, dumpsterRental: 450, equipmentRental: 600, cleanup: 300, contingencyPercent: 10, overheadPercent: 12 },
      estimatedDuration: "6-8 weeks",
      costPerSqFt: 85,
      confidenceScore: 78,
      warnings: ["Permit timeline may add 2-3 weeks"],
      savingsTips: ["Buy lumber in bulk for 15% savings"],
    },
    tier: 'smart',
    maxTokens: 8000,
  });
  if (!aiResult.success) {
    console.warn('[AI Quick Estimate] AI failed, returning stub:', aiResult.error);
    // Return a starter estimate the user can edit rather than crashing
    return {
      projectSummary: `Estimate for ${projectType || 'construction'} project — ${description.substring(0, 80)}`,
      materials: [
        { name: 'General Materials', category: 'hardware', unit: 'lot', quantity: 1, unitPrice: 5000, supplier: 'TBD' },
        { name: 'Lumber', category: 'lumber', unit: 'bf', quantity: 500, unitPrice: 1.20, supplier: 'Home Depot' },
        { name: 'Concrete', category: 'concrete', unit: 'cy', quantity: 10, unitPrice: 140, supplier: 'Local Supplier' },
      ],
      labor: [
        { trade: 'General Laborer', hourlyRate: 45, hours: 80, crew: 'General crew' },
        { trade: 'Carpenter', hourlyRate: 75, hours: 40, crew: 'Framing crew' },
      ],
      assemblies: [],
      additionalCosts: { permits: 500, dumpsterRental: 400, equipmentRental: 300, cleanup: 200, contingencyPercent: 10, overheadPercent: 12 },
      estimatedDuration: 'To be determined',
      costPerSqFt: squareFootage > 0 ? Math.round(8000 / squareFootage) : 0,
      confidenceScore: 30,
      warnings: ['AI estimate unavailable — this is a placeholder. Please edit with actual quantities and pricing.'],
      savingsTips: ['Get at least 3 contractor bids', 'Buy materials in bulk where possible'],
    };
  }
  const result = aiResult.data;
  console.log('[AI Quick Estimate] Generated:', result.materials.length, 'materials,', result.labor.length, 'labor,', result.assemblies.length, 'assemblies');
  return result;
}

export async function generateProjectReport(
  project: Project,
  invoices: Invoice[],
  changeOrders: ChangeOrder[],
): Promise<ProjectReportResult> {
  console.log('[AI Report] Generating for:', project.name);
  const schedule = project.schedule;
  const tasks = schedule?.tasks ?? [];
  const est = project.linkedEstimate ?? project.estimate;
  const projInvoices = invoices.filter(i => i.projectId === project.id);
  const projCOs = changeOrders.filter(co => co.projectId === project.id);
  const totalInvoiced = projInvoices.reduce((s, i) => s + i.totalDue, 0);
  const totalPaid = projInvoices.reduce((s, i) => s + i.amountPaid, 0);
  const coTotal = projCOs.reduce((s, co) => s + co.changeAmount, 0);

  const aiResult = await mageAI({
    prompt: `You are a senior construction project manager writing a professional project status report for stakeholders.

PROJECT: ${project.name}
Type: ${project.type} | Status: ${project.status}
Location: ${project.location}
Square footage: ${project.squareFootage || 'N/A'}

SCHEDULE:
Total tasks: ${tasks.length}
Completed: ${tasks.filter(t => t.status === 'done').length}
In progress: ${tasks.filter(t => t.status === 'in_progress').length}
Health score: ${schedule?.healthScore ?? 'N/A'}/100
Duration: ${schedule?.totalDurationDays ?? 0} days

BUDGET:
Estimate: ${est && 'grandTotal' in est ? est.grandTotal.toLocaleString() : '0'}
Total invoiced: ${totalInvoiced.toLocaleString()}
Total paid: ${totalPaid.toLocaleString()}
Change orders: ${projCOs.length} totaling ${coTotal.toLocaleString()}

TASKS (active):
${tasks.filter(t => t.status === 'in_progress').slice(0, 15).map(t => `- ${t.title}: ${t.progress}%`).join('\n') || 'None'}

Generate a professional project status report suitable for sharing with clients.`,
    schema: projectReportSchema,
    schemaHint: {
      executiveSummary: '2-3 sentence project overview',
      scheduleStatus: 'Are we on track? Why or why not? 2-3 sentences.',
      budgetStatus: 'Money in, money out, where it stands. 2-3 sentences.',
      keyAccomplishments: ['concrete item completed', 'another accomplishment'],
      issuesAndRisks: ['issue or risk worth flagging', 'another risk'],
      nextMilestones: ['next major deadline + what it means', 'second milestone'],
      recommendations: ['concrete next-step recommendation', 'another action'],
    },
    tier: 'fast',
    maxTokens: 2200,
  });
  if (!aiResult.success) {
    throw new Error(aiResult.error || 'Project report generation unavailable');
  }
  console.log('[AI Report] Generated');
  return aiResult.data;
}
