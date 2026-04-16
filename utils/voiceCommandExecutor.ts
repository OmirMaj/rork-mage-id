import type { ScheduleTask } from '@/types';
import type { ParsedVoiceCommand, ParsedBatchCommand } from './voiceCommandParser';
import AsyncStorage from '@react-native-async-storage/async-storage';

const VOICE_HISTORY_KEY = 'mage_voice_history';
const VOICE_ISSUES_KEY = 'mage_voice_issues';

export interface VoiceHistoryItem {
  id: string;
  spokenText: string;
  parsedAction: string;
  taskName?: string;
  success: boolean;
  timestamp: string;
  projectId: string;
}

export interface VoiceCommandResult {
  success: boolean;
  message: string;
  undoAction?: () => void;
  matchedTasks?: ScheduleTask[];
  needsClarification?: boolean;
  dailyReportData?: any;
}

export interface VoiceUpdateFunctions {
  handleProgressUpdate: (task: ScheduleTask, progress: number) => void;
  handleSaveTask?: (draft: any, editing: ScheduleTask | null) => void;
  onAddNote?: (task: ScheduleTask, note: string) => void;
}

export function findTaskByName(name: string | undefined, tasks: ScheduleTask[]): ScheduleTask | null {
  if (!name) return null;
  const lower = name.toLowerCase().trim();
  if (!lower) return null;

  let match = tasks.find(t => t.title.toLowerCase() === lower);
  if (match) return match;

  match = tasks.find(t => t.title.toLowerCase().includes(lower));
  if (match) return match;

  match = tasks.find(t => lower.includes(t.title.toLowerCase()));
  if (match) return match;

  match = tasks.find(t => t.phase.toLowerCase().includes(lower));
  if (match) return match;

  const words = lower.split(/\s+/);
  match = tasks.find(t => {
    const titleLower = t.title.toLowerCase();
    return words.filter(w => w.length > 3).some(w => titleLower.includes(w));
  });
  return match || null;
}

export function findAllMatchingTasks(name: string | undefined, tasks: ScheduleTask[]): ScheduleTask[] {
  if (!name) return [];
  const lower = name.toLowerCase().trim();
  if (!lower) return [];

  const exact = tasks.filter(t => t.title.toLowerCase() === lower);
  if (exact.length === 1) return exact;

  const contains = tasks.filter(t =>
    t.title.toLowerCase().includes(lower) || lower.includes(t.title.toLowerCase())
  );
  if (contains.length > 0) return contains;

  const phaseMatch = tasks.filter(t => t.phase.toLowerCase().includes(lower));
  if (phaseMatch.length > 0) return phaseMatch;

  const words = lower.split(/\s+/).filter(w => w.length > 3);
  return tasks.filter(t => {
    const titleLower = t.title.toLowerCase();
    return words.some(w => titleLower.includes(w));
  });
}

export function executeVoiceCommand(
  parsed: ParsedVoiceCommand,
  tasks: ScheduleTask[],
  updateFunctions: VoiceUpdateFunctions,
): VoiceCommandResult {
  console.log('[VoiceExec] Executing:', parsed.action, 'task:', parsed.taskName);

  switch (parsed.action) {
    case 'update_progress': {
      const matches = findAllMatchingTasks(parsed.taskName, tasks);
      if (matches.length === 0) {
        return { success: false, message: `Couldn't find task "${parsed.taskName}"` };
      }
      if (matches.length > 1) {
        return {
          success: false,
          message: `Found ${matches.length} matching tasks`,
          matchedTasks: matches,
          needsClarification: true,
        };
      }
      const task = matches[0];
      const prevProgress = task.progress;
      const newProgress = Math.max(0, Math.min(100, parsed.value ?? 0));
      updateFunctions.handleProgressUpdate(task, newProgress);
      return {
        success: true,
        message: `Updated "${task.title}" to ${newProgress}%`,
        undoAction: () => updateFunctions.handleProgressUpdate(task, prevProgress),
      };
    }

    case 'mark_complete': {
      const matches = findAllMatchingTasks(parsed.taskName, tasks);
      if (matches.length === 0) {
        return { success: false, message: `Couldn't find task "${parsed.taskName}"` };
      }
      if (matches.length > 1) {
        return {
          success: false,
          message: `Found ${matches.length} matching tasks`,
          matchedTasks: matches,
          needsClarification: true,
        };
      }
      const task = matches[0];
      const prevProgress = task.progress;
      updateFunctions.handleProgressUpdate(task, 100);
      return {
        success: true,
        message: `Marked "${task.title}" as complete ✅`,
        undoAction: () => updateFunctions.handleProgressUpdate(task, prevProgress),
      };
    }

    case 'start_task': {
      const matches = findAllMatchingTasks(parsed.taskName, tasks);
      if (matches.length === 0) {
        return { success: false, message: `Couldn't find task "${parsed.taskName}"` };
      }
      if (matches.length > 1) {
        return {
          success: false,
          message: `Found ${matches.length} matching tasks`,
          matchedTasks: matches,
          needsClarification: true,
        };
      }
      const task = matches[0];
      if (task.progress === 0) {
        updateFunctions.handleProgressUpdate(task, 5);
      }
      return {
        success: true,
        message: `Started "${task.title}"`,
        undoAction: () => updateFunctions.handleProgressUpdate(task, 0),
      };
    }

    case 'add_note': {
      const matches = findAllMatchingTasks(parsed.taskName, tasks);
      if (matches.length === 0) {
        return { success: false, message: `Couldn't find task "${parsed.taskName}"` };
      }
      if (matches.length > 1) {
        return {
          success: false,
          message: `Found ${matches.length} matching tasks`,
          matchedTasks: matches,
          needsClarification: true,
        };
      }
      const task = matches[0];
      if (updateFunctions.onAddNote) {
        updateFunctions.onAddNote(task, parsed.text ?? '');
      }
      return {
        success: true,
        message: `Note added to "${task.title}"`,
      };
    }

    case 'log_issue': {
      return {
        success: true,
        message: `Issue logged: "${parsed.text ?? 'No details'}"`,
      };
    }

    case 'ask_question':
    case 'status_update':
    case 'weather_check': {
      return {
        success: true,
        message: parsed.text || 'Processing your question...',
      };
    }

    case 'daily_report': {
      return {
        success: true,
        message: 'Generating daily report from your update...',
      };
    }

    case 'unknown':
    default:
      return {
        success: false,
        message: parsed.clarification || "I didn't understand that. Try again?",
      };
  }
}

export function executeBatchCommands(
  parsed: ParsedBatchCommand,
  tasks: ScheduleTask[],
  updateFunctions: VoiceUpdateFunctions,
): { results: VoiceCommandResult[]; allSuccess: boolean } {
  console.log('[VoiceExec] Executing batch:', parsed.commands.length, 'commands');
  const results: VoiceCommandResult[] = [];
  const undoActions: (() => void)[] = [];

  for (const cmd of parsed.commands) {
    const singleParsed: ParsedVoiceCommand = {
      action: cmd.action,
      taskName: cmd.taskName,
      value: cmd.value,
      text: cmd.text,
      confidence: parsed.confidence,
    };
    const result = executeVoiceCommand(singleParsed, tasks, updateFunctions);
    results.push(result);
    if (result.undoAction) undoActions.push(result.undoAction);
  }

  const allSuccess = results.every(r => r.success);

  if (undoActions.length > 0) {
    results[0].undoAction = () => {
      undoActions.forEach(fn => fn());
    };
  }

  return { results, allSuccess };
}

export async function saveVoiceHistory(item: VoiceHistoryItem): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(VOICE_HISTORY_KEY);
    const history: VoiceHistoryItem[] = stored ? JSON.parse(stored) : [];
    history.unshift(item);
    const trimmed = history.slice(0, 10);
    await AsyncStorage.setItem(VOICE_HISTORY_KEY, JSON.stringify(trimmed));
    console.log('[VoiceExec] History saved, total:', trimmed.length);
  } catch (err) {
    console.log('[VoiceExec] Failed to save history:', err);
  }
}

export async function getVoiceHistory(): Promise<VoiceHistoryItem[]> {
  try {
    const stored = await AsyncStorage.getItem(VOICE_HISTORY_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export async function saveVoiceIssue(projectId: string, issue: string): Promise<void> {
  try {
    const key = `${VOICE_ISSUES_KEY}_${projectId}`;
    const stored = await AsyncStorage.getItem(key);
    const issues: Array<{ text: string; timestamp: string }> = stored ? JSON.parse(stored) : [];
    issues.unshift({ text: issue, timestamp: new Date().toISOString() });
    await AsyncStorage.setItem(key, JSON.stringify(issues.slice(0, 50)));
  } catch (err) {
    console.log('[VoiceExec] Failed to save issue:', err);
  }
}
