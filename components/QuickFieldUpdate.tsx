import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  Zap,
  Send,
  Check,
  AlertCircle,
  ChevronDown,
  HardHat,
  Sparkles,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import {
  parseVoiceCommand,
  type ParsedVoiceCommand,
} from '@/utils/voiceCommandParser';
import type { Project, ScheduleTask } from '@/types';
import QuickUpdateClarifier, {
  type ClarifierAction,
  type ClarifierResult,
} from '@/components/QuickUpdateClarifier';

/**
 * Home-screen quick field update widget.
 *
 * Field workers type natural language like "drywall done floor 3" or
 * "framing 80 percent" and we parse it with `parseVoiceCommand` (text
 * path — the parser doesn't care if input came from voice or keyboard)
 * then apply the resulting action to the currently-selected project's
 * schedule. The UX goal is: under 3 taps from home screen to a task
 * update persisted to Supabase via ProjectContext's offline queue.
 *
 * UX layers (in order of preference):
 *   1. Autocomplete as you type — suggest real task titles from the
 *      selected project so the input is always bound to an actual task.
 *   2. Fast parser path — if the text is unambiguous, apply immediately.
 *   3. Clarifier sheet — if the parser can't resolve task/action/value,
 *      open a bottom sheet seeded with whatever we DID extract and let
 *      the user fill the rest. This is the "ask a question or two"
 *      fallback so no input ever hits a dead-end error.
 */

// Shape returned from the parser step below — either "apply it" or
// "open the clarifier with this seed." Keeps the happy path branchless.
type ClarifierSeed = {
  action?: ClarifierAction;
  value?: number;
  text?: string;
  query?: string;
  candidateTaskIds?: string[];
};

type ParseOutcome =
  | { kind: 'applied'; message: string }
  | {
      kind: 'needs_clarification';
      reason: 'no_task_match' | 'unknown_action' | 'low_confidence';
      seed: ClarifierSeed;
    };

// Map the parser's action vocabulary to the clarifier's. Only the five
// action types the clarifier supports come through; everything else
// becomes `update_progress` as the pragmatic default.
function toClarifierAction(a: string | undefined): ClarifierAction {
  if (a === 'update_progress' || a === 'mark_complete' || a === 'start_task' || a === 'add_note' || a === 'log_issue') {
    return a;
  }
  return 'update_progress';
}

// Cheap fuzzy score. We're not trying to be clever — whole-word match
// beats substring beats "shares a meaningful token". The parser already
// does heavy lifting; this only runs when the parser missed.
function rankTasksForQuery(tasks: ScheduleTask[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const tokens = q.split(/\s+/).filter((t) => t.length >= 3);
  const scored: { id: string; score: number }[] = tasks.map((t) => {
    const title = t.title.toLowerCase();
    let score = 0;
    if (title === q) score += 100;
    if (title.includes(q)) score += 40;
    for (const tok of tokens) {
      if (title.includes(tok)) score += 15;
      if ((t.phase ?? '').toLowerCase().includes(tok)) score += 5;
      if ((t.crew ?? '').toLowerCase().includes(tok)) score += 3;
    }
    return { id: t.id, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((s) => s.id);
}

export default function QuickFieldUpdate() {
  const { projects, updateProject } = useProjects();
  const [text, setText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [feedback, setFeedback] = useState<
    | { kind: 'success'; message: string }
    | { kind: 'error'; message: string }
    | null
  >(null);
  const [showPicker, setShowPicker] = useState(false);
  const [manualProjectId, setManualProjectId] = useState<string | null>(null);

  // Clarifier state — populated right before we open it.
  const [clarifierOpen, setClarifierOpen] = useState(false);
  const [clarifierSeed, setClarifierSeed] = useState<ClarifierSeed>({});

  const projectsWithSchedule = useMemo(() => {
    return projects
      .filter((p) => p.schedule && p.schedule.tasks.length > 0)
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
  }, [projects]);

  const selectedProject: Project | null = useMemo(() => {
    if (manualProjectId) {
      return projectsWithSchedule.find((p) => p.id === manualProjectId) ?? null;
    }
    return projectsWithSchedule[0] ?? null;
  }, [manualProjectId, projectsWithSchedule]);

  // Inline autocomplete suggestions — show real task titles so taps bind
  // the user to an exact task rather than relying on fuzzy matching.
  const suggestions = useMemo(() => {
    if (!selectedProject?.schedule) return [] as ScheduleTask[];
    const q = text.trim().toLowerCase();
    if (q.length < 2) return [];
    const allTasks = selectedProject.schedule.tasks;
    // Only show suggestions where any significant part of the input
    // overlaps a title. Tiny words like "do" or "at" shouldn't fire it.
    const ranked = rankTasksForQuery(allTasks, q);
    return ranked
      .map((id) => allTasks.find((t) => t.id === id))
      .filter((t): t is ScheduleTask => Boolean(t))
      .slice(0, 4);
  }, [selectedProject, text]);

  /**
   * Core mutator — applies a concrete (task, action, value) tuple to the
   * project's schedule via ProjectContext. Shared by both the fast parser
   * path and the clarifier submission path so the write behavior stays
   * identical. Returns a short confirmation message for the feedback row.
   */
  const applyUpdate = useCallback(
    (
      project: Project,
      task: ScheduleTask,
      action: ClarifierAction,
      value?: number,
      noteText?: string,
    ): string => {
      const schedule = project.schedule!;
      const tasks = schedule.tasks;
      const patch: Partial<ScheduleTask> = {};

      switch (action) {
        case 'update_progress': {
          const v = Math.max(0, Math.min(100, value ?? 0));
          patch.progress = v;
          patch.status = v >= 100 ? 'done' : v > 0 ? 'in_progress' : task.status;
          break;
        }
        case 'mark_complete': {
          patch.progress = 100;
          patch.status = 'done';
          patch.actualEndDate = new Date().toISOString();
          break;
        }
        case 'start_task': {
          patch.status = 'in_progress';
          patch.actualStartDate = task.actualStartDate ?? new Date().toISOString();
          break;
        }
        case 'add_note': {
          const stamp = new Date().toLocaleDateString();
          const combined = task.notes
            ? `${task.notes}\n[${stamp}] ${noteText ?? ''}`
            : `[${stamp}] ${noteText ?? ''}`;
          patch.notes = combined;
          break;
        }
        case 'log_issue': {
          const stamp = new Date().toLocaleDateString();
          const body = `⚠️ ${noteText ?? 'Issue logged'}`;
          const combined = task.notes
            ? `${task.notes}\n[${stamp}] ${body}`
            : `[${stamp}] ${body}`;
          patch.notes = combined;
          patch.status = 'on_hold';
          break;
        }
      }

      const updatedTasks = tasks.map((t) => (t.id === task.id ? { ...t, ...patch } : t));
      updateProject(project.id, {
        schedule: { ...schedule, tasks: updatedTasks, updatedAt: new Date().toISOString() },
      });

      switch (action) {
        case 'update_progress':
          return `${task.title} → ${patch.progress}%`;
        case 'mark_complete':
          return `${task.title} marked complete`;
        case 'start_task':
          return `${task.title} → in progress`;
        case 'add_note':
          return `Note added to ${task.title}`;
        case 'log_issue':
          return `Issue logged on ${task.title}`;
      }
    },
    [updateProject],
  );

  /**
   * Decides between applying immediately vs opening the clarifier. The
   * parser result comes in with wildly varying confidence; this function
   * is the gatekeeper that says "we're sure enough, just do it" vs
   * "seed the clarifier."
   */
  const evaluateParse = useCallback(
    (parsed: ParsedVoiceCommand, project: Project): ParseOutcome => {
      const schedule = project.schedule;
      if (!schedule) return { kind: 'applied', message: 'No schedule on this project.' };
      const tasks = schedule.tasks;

      // Fuzzy-find a task by the parser's reported taskName.
      const findTask = (name?: string): ScheduleTask | null => {
        if (!name) return null;
        const lower = name.toLowerCase();
        return (
          tasks.find((t) => t.title.toLowerCase() === lower) ??
          tasks.find((t) => t.title.toLowerCase().includes(lower)) ??
          tasks.find((t) => lower.includes(t.title.toLowerCase())) ??
          null
        );
      };

      // Unknown action AND no taskName — send to clarifier blank.
      if (parsed.action === 'unknown') {
        return {
          kind: 'needs_clarification',
          reason: 'unknown_action',
          seed: {
            action: undefined,
            value: parsed.value,
            text: parsed.text,
            query: parsed.taskName ?? text.trim(),
            candidateTaskIds: rankTasksForQuery(tasks, parsed.taskName ?? text.trim()),
          },
        };
      }

      // Known action — try to bind to a task.
      const clarifierAction = toClarifierAction(parsed.action);
      const task = findTask(parsed.taskName);
      if (!task) {
        return {
          kind: 'needs_clarification',
          reason: 'no_task_match',
          seed: {
            action: clarifierAction,
            value: parsed.value,
            text: parsed.text,
            query: parsed.taskName ?? '',
            candidateTaskIds: rankTasksForQuery(tasks, parsed.taskName ?? text.trim()),
          },
        };
      }

      // Below a 50% confidence cut, even a bound task is worth confirming.
      // We seed the clarifier with the candidate so the user just taps Apply.
      if ((parsed.confidence ?? 0) < 50) {
        return {
          kind: 'needs_clarification',
          reason: 'low_confidence',
          seed: {
            action: clarifierAction,
            value: parsed.value,
            text: parsed.text,
            query: parsed.taskName,
            candidateTaskIds: [task.id, ...rankTasksForQuery(tasks, parsed.taskName ?? '').filter((id) => id !== task.id)],
          },
        };
      }

      // Update_progress with no numeric value is not actionable.
      if (clarifierAction === 'update_progress' && parsed.value == null) {
        return {
          kind: 'needs_clarification',
          reason: 'low_confidence',
          seed: {
            action: 'update_progress',
            text: parsed.text,
            query: parsed.taskName,
            candidateTaskIds: [task.id],
          },
        };
      }

      // Add_note / log_issue with no body — same deal.
      if ((clarifierAction === 'add_note' || clarifierAction === 'log_issue') && !parsed.text?.trim()) {
        return {
          kind: 'needs_clarification',
          reason: 'low_confidence',
          seed: {
            action: clarifierAction,
            text: '',
            query: parsed.taskName,
            candidateTaskIds: [task.id],
          },
        };
      }

      // All green — apply immediately.
      const message = applyUpdate(project, task, clarifierAction, parsed.value, parsed.text);
      return { kind: 'applied', message };
    },
    [applyUpdate, text],
  );

  const openClarifier = useCallback((seed: ClarifierSeed) => {
    setClarifierSeed(seed);
    setClarifierOpen(true);
  }, []);

  const handleSubmit = useCallback(async () => {
    const input = text.trim();
    if (!input) return;
    if (!selectedProject || !selectedProject.schedule) {
      setFeedback({ kind: 'error', message: 'Pick a project with a schedule first.' });
      return;
    }
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setParsing(true);
    setFeedback(null);
    try {
      const taskContext = selectedProject.schedule.tasks.map((t) => ({
        title: t.title,
        phase: t.phase,
        progress: t.progress,
        status: t.status,
        crew: t.crew,
      }));
      const parsed = await parseVoiceCommand(input, taskContext, selectedProject.name);
      const outcome = evaluateParse(parsed, selectedProject);
      if (outcome.kind === 'applied') {
        setFeedback({ kind: 'success', message: outcome.message });
        setText('');
        if (Platform.OS !== 'web') {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      } else {
        // Non-fatal — send to clarifier instead of erroring out.
        openClarifier(outcome.seed);
        if (Platform.OS !== 'web') {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }
      }
    } catch (err) {
      console.log('[QuickFieldUpdate] parse failed', err);
      // Even on hard failure, give them the clarifier — better than a dead end.
      const tasks = selectedProject.schedule.tasks;
      openClarifier({
        action: undefined,
        query: input,
        candidateTaskIds: rankTasksForQuery(tasks, input),
      });
    } finally {
      setParsing(false);
    }
  }, [text, selectedProject, evaluateParse, openClarifier]);

  const handleClarifierSubmit = useCallback(
    (result: ClarifierResult) => {
      if (!selectedProject) return;
      const msg = applyUpdate(
        selectedProject,
        result.task,
        result.action,
        result.value,
        result.text,
      );
      setFeedback({ kind: 'success', message: msg });
      setText('');
      setClarifierOpen(false);
    },
    [selectedProject, applyUpdate],
  );

  // Tap an autocomplete suggestion → replace input with the exact task
  // title, preserving any verb/value tokens we can salvage from the
  // current input. Cheapest implementation: prepend the title and drop
  // any substring of the old input that overlaps the title. If nothing
  // salvageable remains, leave a trailing space so the user can type
  // "80%" or "done" right away.
  const handleSuggestionTap = useCallback(
    (task: ScheduleTask) => {
      if (Platform.OS !== 'web') void Haptics.selectionAsync();
      const title = task.title;
      const lowerTitle = title.toLowerCase();
      const tokens = text
        .trim()
        .split(/\s+/)
        .filter((tok) => {
          const lt = tok.toLowerCase();
          if (!lt) return false;
          // Keep verbs and numeric tokens; drop words that already appear in the title.
          return !lowerTitle.includes(lt);
        });
      const tail = tokens.join(' ').trim();
      setText(tail ? `${title} ${tail}` : `${title} `);
      if (feedback) setFeedback(null);
    },
    [text, feedback],
  );

  if (projectsWithSchedule.length === 0) {
    return null; // Nothing to update against.
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.titleRow}>
        <View style={styles.titleIconWrap}>
          <Zap size={14} color={Colors.primary} />
        </View>
        <Text style={styles.title}>Quick Field Update</Text>
      </View>

      <TouchableOpacity
        style={styles.projectChip}
        onPress={() => {
          if (projectsWithSchedule.length > 1) setShowPicker(true);
        }}
        activeOpacity={projectsWithSchedule.length > 1 ? 0.7 : 1}
        testID="qfu-project-chip"
      >
        <HardHat size={12} color={Colors.textSecondary} />
        <Text style={styles.projectChipText} numberOfLines={1}>
          {selectedProject?.name ?? '—'}
        </Text>
        {projectsWithSchedule.length > 1 && (
          <ChevronDown size={12} color={Colors.textMuted} />
        )}
      </TouchableOpacity>

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={(v) => {
            setText(v);
            if (feedback) setFeedback(null);
          }}
          placeholder='e.g. "drywall done floor 3" or "framing 80%"'
          placeholderTextColor={Colors.textMuted}
          editable={!parsing}
          returnKeyType="send"
          onSubmitEditing={handleSubmit}
          testID="qfu-text-input"
        />
        <TouchableOpacity
          style={[
            styles.sendBtn,
            (!text.trim() || parsing) && styles.sendBtnDisabled,
          ]}
          onPress={handleSubmit}
          activeOpacity={0.85}
          disabled={!text.trim() || parsing}
          testID="qfu-send-btn"
        >
          {parsing ? (
            <ActivityIndicator size="small" color={Colors.textOnPrimary} />
          ) : (
            <Send size={14} color={Colors.textOnPrimary} strokeWidth={2.5} />
          )}
        </TouchableOpacity>
      </View>

      {/* Inline autocomplete suggestions — bind the user to a real task. */}
      {suggestions.length > 0 && !parsing && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.suggestRow}
          keyboardShouldPersistTaps="handled"
          testID="qfu-suggestions"
        >
          {suggestions.map((t) => (
            <TouchableOpacity
              key={t.id}
              style={styles.suggestChip}
              onPress={() => handleSuggestionTap(t)}
              activeOpacity={0.75}
              testID={`qfu-suggestion-${t.id}`}
            >
              <Sparkles size={10} color={Colors.primary} />
              <Text style={styles.suggestLabel} numberOfLines={1}>
                {t.title}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {feedback && (
        <View
          style={[
            styles.feedback,
            feedback.kind === 'success'
              ? styles.feedbackSuccess
              : styles.feedbackError,
          ]}
        >
          {feedback.kind === 'success' ? (
            <Check size={12} color={Colors.success} />
          ) : (
            <AlertCircle size={12} color={Colors.warning} />
          )}
          <Text
            style={[
              styles.feedbackText,
              {
                color:
                  feedback.kind === 'success' ? Colors.success : Colors.warning,
              },
            ]}
          >
            {feedback.message}
          </Text>
        </View>
      )}

      <Modal
        visible={showPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPicker(false)}
      >
        <Pressable style={styles.pickerOverlay} onPress={() => setShowPicker(false)}>
          <Pressable style={styles.pickerCard} onPress={() => undefined}>
            <Text style={styles.pickerTitle}>Target Project</Text>
            {projectsWithSchedule.map((p) => {
              const isSelected = p.id === (selectedProject?.id ?? '');
              return (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.pickerRow, isSelected && styles.pickerRowActive]}
                  onPress={() => {
                    setManualProjectId(p.id);
                    setShowPicker(false);
                  }}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.pickerRowText,
                      isSelected && styles.pickerRowTextActive,
                    ]}
                    numberOfLines={1}
                  >
                    {p.name}
                  </Text>
                  <Text style={styles.pickerRowMeta}>
                    {p.schedule?.tasks.length ?? 0} tasks
                  </Text>
                </TouchableOpacity>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>

      {selectedProject?.schedule && (
        <QuickUpdateClarifier
          visible={clarifierOpen}
          tasks={selectedProject.schedule.tasks}
          projectName={selectedProject.name}
          candidateTaskIds={clarifierSeed.candidateTaskIds}
          initialAction={clarifierSeed.action}
          initialValue={clarifierSeed.value}
          initialText={clarifierSeed.text}
          initialQuery={clarifierSeed.query}
          onClose={() => setClarifierOpen(false)}
          onSubmit={handleClarifierSubmit}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: 20,
    marginBottom: 20,
    padding: 14,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    gap: 10,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  titleIconWrap: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.text,
    letterSpacing: -0.1,
  },
  projectChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: Colors.fillTertiary,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  projectChipText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    maxWidth: 220,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  input: {
    flex: 1,
    minHeight: 42,
    borderRadius: 10,
    backgroundColor: Colors.surfaceAlt,
    paddingHorizontal: 12,
    fontSize: 14,
    color: Colors.text,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: Colors.textMuted + '60',
  },
  suggestRow: {
    gap: 6,
    paddingVertical: 2,
    paddingRight: 4,
  },
  suggestChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: Colors.primary + '10',
    borderWidth: 1,
    borderColor: Colors.primary + '30',
    maxWidth: 220,
  },
  suggestLabel: {
    fontSize: 12,
    color: Colors.primary,
    fontWeight: '600' as const,
    flexShrink: 1,
  },
  feedback: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  feedbackSuccess: {
    backgroundColor: Colors.success + '15',
  },
  feedbackError: {
    backgroundColor: Colors.warning + '15',
  },
  feedbackText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '500' as const,
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'center',
    padding: 24,
  },
  pickerCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    gap: 6,
  },
  pickerTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 8,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: Colors.surfaceAlt,
    gap: 12,
  },
  pickerRowActive: {
    backgroundColor: Colors.primary + '15',
  },
  pickerRowText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.text,
  },
  pickerRowTextActive: {
    color: Colors.primary,
    fontWeight: '700' as const,
  },
  pickerRowMeta: {
    fontSize: 11,
    color: Colors.textMuted,
  },
});
