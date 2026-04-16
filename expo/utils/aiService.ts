import { mageAI } from '@/utils/mageAI';
import { generateObject } from '@rork-ai/toolkit-sdk';
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
  answer: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
  actionItems: z.array(z.object({
    text: z.string(),
    priority: z.enum(['urgent', 'important', 'suggestion']),
  })).optional(),
  dataPoints: z.array(z.object({
    label: z.string(),
    value: z.string(),
  })).optional(),
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
    tier: 'fast',
  });
  if (!aiResult.success) {
    throw new Error(aiResult.error || 'AI unavailable');
  }
  console.log('[AI Copilot] Raw aiResult.data:', JSON.stringify(aiResult.data)?.substring(0, 200));
  console.log('[AI Copilot] Raw aiResult.raw:', typeof aiResult.raw, aiResult.raw?.substring?.(0, 200));

  const data = aiResult.data;

  if (typeof data === 'string') {
    console.log('[AI Copilot] Data is string, wrapping as answer');
    return {
      answer: data,
      confidence: 'medium',
      actionItems: [],
      dataPoints: [],
    };
  }

  if (data && typeof data === 'object') {
    const answer = data.answer ?? data.response ?? data.text ?? data.content ?? data.message;
    if (typeof answer === 'string') {
      console.log('[AI Copilot] Extracted answer from data object');
      return {
        answer,
        confidence: data.confidence ?? 'medium',
        actionItems: Array.isArray(data.actionItems) ? data.actionItems : [],
        dataPoints: Array.isArray(data.dataPoints) ? data.dataPoints : [],
      };
    }
    const stringified = JSON.stringify(data);
    console.log('[AI Copilot] No answer field found, keys:', Object.keys(data));
    return {
      answer: stringified.length < 2000 ? stringified : 'AI returned data in an unexpected format.',
      confidence: 'low',
      actionItems: [],
      dataPoints: [],
    };
  }

  if (typeof aiResult.raw === 'string' && aiResult.raw.length > 0) {
    console.log('[AI Copilot] Falling back to raw response');
    return {
      answer: aiResult.raw,
      confidence: 'low',
      actionItems: [],
      dataPoints: [],
    };
  }

  throw new Error('AI returned empty response');
}

export const scheduleRiskSchema = z.object({
  overallConfidence: z.number(),
  predictedEndDate: z.string(),
  predictedDelay: z.number(),
  risks: z.array(z.object({
    taskName: z.string(),
    severity: z.enum(['high', 'medium', 'low']),
    delayProbability: z.number(),
    delayDays: z.number(),
    reasons: z.array(z.string()),
    recommendation: z.string(),
  })),
  summary: z.string(),
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
    tier: 'smart',
  });
  if (!aiResult.success) {
    throw new Error(aiResult.error || 'Schedule risk analysis unavailable');
  }
  console.log('[AI Risk] Analysis complete');
  return aiResult.data;
}

export const bidScoreSchema = z.object({
  matchScore: z.number(),
  matchReasons: z.array(z.string()),
  concerns: z.array(z.string()),
  bidStrategy: z.string(),
  estimatedWinProbability: z.number(),
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
    tier: 'fast',
  });
  if (!aiResult.success) {
    throw new Error(aiResult.error || 'Bid scoring unavailable');
  }
  console.log('[AI Bid] Score:', aiResult.data.matchScore);
  return aiResult.data;
}

export const dailyReportSchema = z.object({
  summary: z.string(),
  workCompleted: z.array(z.string()),
  workInProgress: z.array(z.string()),
  issuesAndDelays: z.array(z.string()),
  tomorrowPlan: z.array(z.string()),
  weatherImpact: z.string(),
  crewsOnSite: z.array(z.object({
    trade: z.string(),
    count: z.number(),
    activity: z.string(),
  })),
  safetyNotes: z.string(),
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
    tier: 'fast',
  });
  if (!aiResult.success) {
    throw new Error(aiResult.error || 'Daily report generation unavailable');
  }
  console.log('[AI DFR] Report generated');
  return aiResult.data;
}

export const estimateValidationSchema = z.object({
  overallScore: z.number(),
  issues: z.array(z.object({
    type: z.enum(['warning', 'error', 'suggestion', 'ok']),
    title: z.string(),
    detail: z.string(),
    potentialImpact: z.string(),
  })),
  missingItems: z.array(z.string()),
  costPerSqFtAssessment: z.string(),
  materialLaborRatioAssessment: z.string(),
  contingencyRecommendation: z.string(),
  summary: z.string(),
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
    tier: 'smart',
  });
  if (!aiResult.success) {
    throw new Error(aiResult.error || 'Estimate validation unavailable');
  }
  console.log('[AI Estimate] Validation complete, score:', aiResult.data.overallScore);
  return aiResult.data;
}

export const aiScheduleSchema = z.object({
  projectName: z.string(),
  estimatedDuration: z.number(),
  tasks: z.array(z.object({
    title: z.string(),
    phase: z.string(),
    durationDays: z.number(),
    crew: z.string(),
    crewSize: z.number(),
    isMilestone: z.boolean(),
    isCriticalPath: z.boolean(),
    isWeatherSensitive: z.boolean(),
    predecessorIndex: z.number().optional(),
    dependencyType: z.enum(['FS', 'SS', 'FF', 'SF']).optional(),
    lagDays: z.number().optional(),
    notes: z.string().optional(),
  })),
  assumptions: z.array(z.string()),
  warnings: z.array(z.string()),
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
    tier: 'smart',
    maxTokens: 2000,
  });
  if (!aiResult.success) {
    throw new Error(aiResult.error || 'AI schedule builder unavailable');
  }
  console.log('[AI Schedule] Generated', aiResult.data.tasks.length, 'tasks');
  return aiResult.data;
}

export const changeOrderImpactSchema = z.object({
  scheduleDays: z.number(),
  costImpact: z.object({
    materials: z.number(),
    labor: z.number(),
    equipment: z.number(),
    total: z.number(),
  }),
  affectedTasks: z.array(z.object({
    taskName: z.string(),
    currentEnd: z.string(),
    newEnd: z.string(),
    daysAdded: z.number(),
  })),
  newProjectEndDate: z.string(),
  downstreamEffects: z.array(z.string()),
  recommendation: z.string(),
  compressionOptions: z.array(z.object({
    description: z.string(),
    costPremium: z.number(),
    daysSaved: z.number(),
  })),
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
    tier: 'smart',
    maxTokens: 2000,
  });
  if (!aiResult.success) {
    throw new Error(aiResult.error || 'Change order analysis unavailable');
  }
  console.log('[AI CO] Impact analysis complete');
  return aiResult.data;
}

export const weeklySummarySchema = z.object({
  weekRange: z.string(),
  portfolioSummary: z.object({
    totalProjects: z.number(),
    onTrack: z.number(),
    atRisk: z.number(),
    behind: z.number(),
    combinedValue: z.number(),
    tasksCompletedThisWeek: z.number(),
  }),
  projects: z.array(z.object({
    name: z.string(),
    status: z.enum(['on_track', 'at_risk', 'behind', 'ahead']),
    progressStart: z.number(),
    progressEnd: z.number(),
    keyAccomplishment: z.string(),
    primaryRisk: z.string(),
    recommendation: z.string(),
  })),
  overallRecommendation: z.string(),
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
    const aiResult = await mageAI({ prompt, tier: 'fast' });
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
    const done = tasks.filter(t => t.status === 'done').length;
    const est = p.linkedEstimate ?? p.estimate;
    return {
      name: p.name,
      type: p.type,
      status: p.status,
      totalTasks: tasks.length,
      completedTasks: done,
      overallProgress: totalProgress,
      healthScore: schedule?.healthScore ?? 0,
      totalValue: est && 'grandTotal' in est ? est.grandTotal : 0,
      riskItems: schedule?.riskItems?.map(r => r.title) ?? [],
    };
  });

  const aiResult = await mageAI({
    prompt: `You are a construction portfolio manager writing a weekly executive summary. Analyze these projects and generate a professional report.

PROJECTS:
${JSON.stringify(projectData, null, 2)}

CURRENT DATE: ${new Date().toLocaleDateString()}

Generate a comprehensive weekly executive summary. For each project, assess status, highlight key accomplishments, identify primary risks, and give recommendations. Provide an overall portfolio recommendation.`,
    tier: 'fast',
  });
  if (!aiResult.success) {
    throw new Error(aiResult.error || 'Weekly summary unavailable');
  }
  console.log('[AI Weekly] Summary generated');
  return aiResult.data;
}

export const homeBriefingSchema = z.object({
  briefing: z.string(),
  projects: z.array(z.object({
    name: z.string(),
    status: z.enum(['on_track', 'at_risk', 'behind']),
    keyInsight: z.string(),
    actionItem: z.string(),
  })),
  urgentItems: z.array(z.string()),
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
    tier: 'fast',
  });
  if (!aiResult.success) {
    throw new Error(aiResult.error || 'Home briefing unavailable');
  }
  console.log('[AI Briefing] Generated');
  return aiResult.data;
}

export const invoicePredictionSchema = z.object({
  predictedPaymentDate: z.string(),
  confidenceLevel: z.enum(['high', 'medium', 'low']),
  daysFromDue: z.number(),
  reasoning: z.string(),
  tip: z.string(),
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
    tier: 'fast',
  });
  if (!aiResult.success) {
    throw new Error(aiResult.error || 'Invoice prediction unavailable');
  }
  console.log('[AI Invoice] Prediction complete');
  return aiResult.data;
}

export const subEvaluationSchema = z.object({
  questionsToAsk: z.array(z.string()),
  typicalRates: z.object({
    journeyman: z.string(),
    master: z.string(),
    apprentice: z.string(),
  }),
  redFlags: z.array(z.string()),
  recommendation: z.string(),
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
    tier: 'fast',
  });
  if (!aiResult.success) {
    throw new Error(aiResult.error || 'Subcontractor evaluation unavailable');
  }
  console.log('[AI Sub] Evaluation complete');
  return aiResult.data;
}

export const equipmentAdviceSchema = z.object({
  recommendation: z.enum(['rent', 'buy', 'lease']),
  annualRentalCost: z.number(),
  purchasePrice: z.string(),
  breakEvenProjects: z.number(),
  reasoning: z.string(),
  reconsiderWhen: z.string(),
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
    tier: 'fast',
  });
  if (!aiResult.success) {
    throw new Error(aiResult.error || 'Equipment analysis unavailable');
  }
  console.log('[AI Equipment] Analysis complete');
  return aiResult.data;
}

export const projectReportSchema = z.object({
  executiveSummary: z.string(),
  scheduleStatus: z.string(),
  budgetStatus: z.string(),
  keyAccomplishments: z.array(z.string()),
  issuesAndRisks: z.array(z.string()),
  nextMilestones: z.array(z.string()),
  recommendations: z.array(z.string()),
});

export type ProjectReportResult = z.infer<typeof projectReportSchema>;

export const aiQuickEstimateSchema = z.object({
  projectSummary: z.string(),
  materials: z.array(z.object({
    name: z.string(),
    category: z.string(),
    unit: z.string(),
    quantity: z.number(),
    unitPrice: z.number(),
    supplier: z.string(),
    notes: z.string().optional(),
  })),
  labor: z.array(z.object({
    trade: z.string(),
    hourlyRate: z.number(),
    hours: z.number(),
    crew: z.string(),
    notes: z.string().optional(),
  })),
  assemblies: z.array(z.object({
    name: z.string(),
    category: z.string(),
    quantity: z.number(),
    unit: z.string(),
    notes: z.string().optional(),
  })),
  additionalCosts: z.object({
    permits: z.number(),
    dumpsterRental: z.number(),
    equipmentRental: z.number(),
    cleanup: z.number(),
    contingencyPercent: z.number(),
    overheadPercent: z.number(),
  }),
  estimatedDuration: z.string(),
  costPerSqFt: z.number(),
  confidenceScore: z.number(),
  warnings: z.array(z.string()),
  savingsTips: z.array(z.string()),
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

  try {
    const parsed = await generateObject({
      messages: [
        {
          role: 'user',
          content: `You are an expert construction estimator with 25+ years of experience and access to current 2025-2026 material pricing from Home Depot, Lowe's, and wholesale suppliers. Generate a COMPLETE, detailed construction estimate.

PROJECT DESCRIPTION:
${description}

PROJECT DETAILS:
- Type: ${projectType || 'General Construction'}
- Square Footage: ${squareFootage || 'Not specified'}
- Quality Tier: ${qualityTier || 'standard'}
- Location: ${location || 'US National Average'}

REQUIREMENTS:
1. Generate 10-25 material line items with REALISTIC quantities for this project scope
2. Use CURRENT market prices — reference Home Depot, Lowe's, Ferguson, ABC Supply pricing
3. Match materials to these categories: lumber, concrete, roofing, insulation, siding, windows, flooring, plumbing, electrical, hvac, drywall, paint, decking, fencing, steel, hardware, landscape
4. Include 3-8 labor trades with realistic hourly rates and hours needed
5. Match labor trades to: Carpenter, Electrician, Plumber, HVAC Technician, Painter, Roofer, Mason / Bricklayer, Concrete Finisher, Drywall Installer, Flooring Installer, Equipment Operator, General Laborer, Insulation Worker, Demolition Worker, Landscaper
6. Suggest relevant assemblies from: Frame Interior Wall, Frame Exterior Wall, Drywall Hang & Finish, Electrical Outlet, Electrical Circuit, Recessed Light, Kitchen Plumbing, Bathroom Plumbing, Tile Floor, LVP Floor, Interior Paint, Exterior Paint, Composite Deck, Wood Deck, Shingle Roof, Concrete Slab, Batt Insulation, Privacy Fence, Vinyl Siding, HVAC Mini-Split, Kitchen Cabinet Base, Interior Demo
7. Include permits, dumpster rental, equipment rental, cleanup costs
8. Set contingency 5-15% based on project complexity
9. Overhead typically 10-15%
10. Calculate realistic cost per square foot
11. Rate your confidence 1-100 in this estimate's accuracy
12. Include 2-4 warnings about potential issues
13. Include 2-4 money-saving tips specific to this project
14. estimatedDuration as readable string like "4-6 weeks"

Be thorough and realistic. This estimate should be professional-grade and ready for a client proposal. Use the ${qualityTier || 'standard'} quality tier to inform material selections and pricing.`,
        },
      ],
      schema: aiQuickEstimateSchema,
    });

    console.log('[AI Quick Estimate] Generated:', parsed.materials.length, 'materials,', parsed.labor.length, 'labor');
    return parsed;
  } catch (err: any) {
    console.log('[AI Quick Estimate] generateObject error:', err?.message || err);
    throw new Error(err?.message || 'Quick estimate generation failed. Please try again.');
  }
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
    tier: 'fast',
  });
  if (!aiResult.success) {
    throw new Error(aiResult.error || 'Project report generation unavailable');
  }
  console.log('[AI Report] Generated');
  return aiResult.data;
}
