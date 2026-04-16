import { mageAI } from '@/utils/mageAI';
import { z } from 'zod';
import type { ScheduleTask } from '@/types';

const voiceCommandSchema = z.object({
  action: z.enum([
    'update_progress',
    'mark_complete',
    'add_note',
    'log_issue',
    'ask_question',
    'create_task',
    'reschedule_task',
    'assign_crew',
    'start_task',
    'weather_check',
    'status_update',
    'daily_report',
    'unknown',
  ]),
  taskName: z.string().optional(),
  value: z.number().optional(),
  text: z.string().optional(),
  crewName: z.string().optional(),
  date: z.string().optional(),
  confidence: z.number(),
  clarification: z.string().optional(),
});

const batchCommandSchema = z.object({
  commands: z.array(z.object({
    action: z.enum(['update_progress', 'mark_complete', 'add_note', 'log_issue', 'start_task']),
    taskName: z.string(),
    value: z.number().optional(),
    text: z.string().optional(),
  })),
  confidence: z.number(),
});

const dailyReportVoiceSchema = z.object({
  workCompleted: z.array(z.string()),
  workInProgress: z.array(z.string()),
  issues: z.array(z.string()),
  weather: z.string(),
  safetyIncidents: z.string(),
  crewCount: z.number().optional(),
  visitors: z.string().optional(),
  materialsReceived: z.array(z.string()).optional(),
  tomorrowPlan: z.array(z.string()).optional(),
});

export type VoiceAction = z.infer<typeof voiceCommandSchema>['action'];

export interface ParsedVoiceCommand {
  action: VoiceAction;
  taskName?: string;
  value?: number;
  text?: string;
  crewName?: string;
  date?: string;
  confidence: number;
  clarification?: string;
}

export interface ParsedBatchCommand {
  commands: Array<{
    action: 'update_progress' | 'mark_complete' | 'add_note' | 'log_issue' | 'start_task';
    taskName: string;
    value?: number;
    text?: string;
  }>;
  confidence: number;
}

export interface ParsedDailyReport {
  workCompleted: string[];
  workInProgress: string[];
  issues: string[];
  weather: string;
  safetyIncidents: string;
  crewCount?: number;
  visitors?: string;
  materialsReceived?: string[];
  tomorrowPlan?: string[];
}

function buildTaskContext(tasks: Array<{ title: string; phase: string; progress: number; status: string; crew: string }>): string {
  return tasks.map(t => `- "${t.title}" (${t.phase}) — ${t.progress}% complete, status: ${t.status}, crew: ${t.crew}`).join('\n');
}

function isBatchCommand(text: string): boolean {
  const lowerText = text.toLowerCase();
  const multiActionIndicators = [' and ', ' also ', ', then ', ', set ', ', mark ', ', update '];
  const actionWords = ['update', 'mark', 'set', 'complete', 'finish', 'start'];
  let actionCount = 0;
  for (const word of actionWords) {
    const matches = lowerText.split(word).length - 1;
    actionCount += matches;
  }
  if (actionCount >= 2) return true;
  return multiActionIndicators.some(ind => lowerText.includes(ind)) && actionCount >= 1;
}

function isDailyReport(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes('end of day report') ||
    lower.includes('daily report') ||
    lower.includes('day report') ||
    lower.includes('eod report') ||
    lower.includes('field report');
}

export async function parseVoiceCommand(
  spokenText: string,
  currentTasks: Array<{ title: string; phase: string; progress: number; status: string; crew: string }>,
  projectName: string
): Promise<ParsedVoiceCommand> {
  console.log('[VoiceCmd] Parsing command:', spokenText.substring(0, 80));

  try {
    const aiResult = await mageAI({
      prompt: `You are a voice command parser for a construction project management app. Parse the user's spoken command and determine what action they want to take.

CURRENT PROJECT: ${projectName}

AVAILABLE TASKS:
${buildTaskContext(currentTasks)}

USER SAID: "${spokenText}"

Parse this into an action. Match task names FUZZY — the user might say "framing" to mean "Frame 2nd Floor" or "electrical" to mean "Rough Electrical Wiring". Pick the closest match from the available tasks.

For progress updates, extract the percentage. "80 percent" = 80, "halfway" = 50, "almost done" = 90, "done" or "finished" or "complete" = 100.

For notes and issues, extract the text content after identifying the action.

If the command is ambiguous or you can't match a task, set action to 'unknown' and provide a clarification question.

Set confidence 0-100. Below 60 means you should include a clarification.`,
      tier: 'fast',
    });

    if (!aiResult.success) {
      console.log('[VoiceCmd] AI failed:', aiResult.error);
      return {
        action: 'unknown',
        confidence: 0,
        clarification: 'Voice processing unavailable. Try typing your update instead.',
      };
    }

    const result = aiResult.data;
    console.log('[VoiceCmd] Parsed result:', result.action, 'confidence:', result.confidence);
    return result;
  } catch (err) {
    console.log('[VoiceCmd] Parse failed:', err);
    return {
      action: 'unknown',
      confidence: 0,
      clarification: 'Voice processing unavailable. Try typing your update instead.',
    };
  }
}

export async function parseBatchVoiceCommand(
  spokenText: string,
  currentTasks: Array<{ title: string; phase: string; progress: number; status: string; crew: string }>,
  projectName: string
): Promise<ParsedBatchCommand> {
  console.log('[VoiceCmd] Parsing batch command:', spokenText.substring(0, 80));

  try {
    const aiResult = await mageAI({
      prompt: `You are a voice command parser for a construction project management app. The user is giving MULTIPLE commands at once. Parse each one separately.

CURRENT PROJECT: ${projectName}

AVAILABLE TASKS:
${buildTaskContext(currentTasks)}

USER SAID: "${spokenText}"

Parse each command separately. Match task names FUZZY. For progress, "80 percent" = 80, "halfway" = 50, "almost done" = 90, "done"/"finished"/"complete" = 100.

Return all commands found. Set confidence 0-100 for the overall batch.`,
      tier: 'fast',
    });

    if (!aiResult.success) {
      console.log('[VoiceCmd] Batch AI failed:', aiResult.error);
      return { commands: [], confidence: 0 };
    }

    const result = aiResult.data;
    console.log('[VoiceCmd] Batch parsed:', result.commands.length, 'commands');
    return result;
  } catch (err) {
    console.log('[VoiceCmd] Batch parse failed:', err);
    return { commands: [], confidence: 0 };
  }
}

export async function parseDailyReportVoice(
  spokenText: string,
  projectName: string
): Promise<ParsedDailyReport> {
  console.log('[VoiceCmd] Parsing daily report voice input');

  try {
    const aiResult = await mageAI({
      prompt: `You are a construction superintendent writing a daily field report. Parse this spoken end-of-day summary into structured report fields.

PROJECT: ${projectName}

SPOKEN INPUT: "${spokenText}"

Extract: work completed today, work still in progress, issues/delays, weather conditions, safety incidents (or "None" if not mentioned), crew count if mentioned, visitors if mentioned, materials received if mentioned, and tomorrow's plan if mentioned.

Be thorough but only extract what was actually said. If something wasn't mentioned, leave it empty or use reasonable defaults.`,
      tier: 'fast',
    });

    if (!aiResult.success) {
      console.log('[VoiceCmd] Daily report AI failed:', aiResult.error);
      return {
        workCompleted: [],
        workInProgress: [],
        issues: [],
        weather: 'Not mentioned',
        safetyIncidents: 'None reported',
      };
    }

    const result = aiResult.data;
    console.log('[VoiceCmd] Daily report parsed successfully');
    return result;
  } catch (err) {
    console.log('[VoiceCmd] Daily report parse failed:', err);
    return {
      workCompleted: [],
      workInProgress: [],
      issues: [],
      weather: 'Not mentioned',
      safetyIncidents: 'None reported',
    };
  }
}

export { isBatchCommand, isDailyReport };
