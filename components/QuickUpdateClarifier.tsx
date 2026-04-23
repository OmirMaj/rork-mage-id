import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  X,
  Percent,
  CheckCircle2,
  Play,
  StickyNote,
  AlertTriangle,
  Search,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ScheduleTask } from '@/types';

/**
 * Clarifier opened from Quick Field Update when the parser couldn't
 * confidently resolve "which task?" + "what action?" + "what value?".
 * This is the recovery path — the fast text path stays primary, and this
 * sheet catches everything else so the user never hits a dead end.
 *
 * Seeded from whatever the parser DID extract so the user doesn't start
 * from zero: e.g. typing "80%" with no task name pre-selects Update% and
 * the value 80, leaving them to just pick the task. Typing "done floor 3"
 * pre-selects Mark Complete and filters the task list to matches of
 * "floor 3".
 */

export type ClarifierAction =
  | 'update_progress'
  | 'mark_complete'
  | 'start_task'
  | 'add_note'
  | 'log_issue';

export interface ClarifierResult {
  task: ScheduleTask;
  action: ClarifierAction;
  value?: number; // progress %
  text?: string;  // note / issue body
}

interface Props {
  visible: boolean;
  tasks: ScheduleTask[];
  projectName: string;
  /** Tasks pre-ranked as likely matches (fuzzy). Shown first. */
  candidateTaskIds?: string[];
  /** Seed from parser — best guesses we already have. */
  initialAction?: ClarifierAction;
  initialValue?: number;
  initialText?: string;
  initialQuery?: string;
  onClose: () => void;
  onSubmit: (result: ClarifierResult) => void;
}

const ACTION_CHIPS: { key: ClarifierAction; label: string; Icon: typeof Percent; color: string }[] = [
  { key: 'update_progress', label: 'Update %',     Icon: Percent,      color: Colors.primary },
  { key: 'mark_complete',   label: 'Mark complete',Icon: CheckCircle2, color: Colors.success },
  { key: 'start_task',      label: 'Start',        Icon: Play,         color: Colors.info },
  { key: 'add_note',        label: 'Note',         Icon: StickyNote,   color: Colors.textSecondary },
  { key: 'log_issue',       label: 'Issue',        Icon: AlertTriangle,color: Colors.warning },
];

export default function QuickUpdateClarifier({
  visible,
  tasks,
  projectName,
  candidateTaskIds,
  initialAction,
  initialValue,
  initialText,
  initialQuery,
  onClose,
  onSubmit,
}: Props) {
  const [action, setAction] = useState<ClarifierAction>(initialAction ?? 'update_progress');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [valueStr, setValueStr] = useState<string>(
    initialValue != null ? String(initialValue) : '',
  );
  const [noteText, setNoteText] = useState<string>(initialText ?? '');
  const [query, setQuery] = useState<string>(initialQuery ?? '');

  // Re-seed every time the sheet opens so a second invocation doesn't carry
  // stale selection from the previous attempt.
  useEffect(() => {
    if (!visible) return;
    setAction(initialAction ?? 'update_progress');
    setValueStr(initialValue != null ? String(initialValue) : '');
    setNoteText(initialText ?? '');
    setQuery(initialQuery ?? '');
    setSelectedTaskId(candidateTaskIds?.[0] ?? null);
  }, [visible, initialAction, initialValue, initialText, initialQuery, candidateTaskIds]);

  const rankedTasks = useMemo(() => {
    const q = query.trim().toLowerCase();
    // If the caller gave us candidates, float them to the top preserving order.
    const candidateSet = new Set(candidateTaskIds ?? []);
    const filtered = q
      ? tasks.filter(
          (t) =>
            t.title.toLowerCase().includes(q) ||
            (t.phase ?? '').toLowerCase().includes(q) ||
            (t.crew ?? '').toLowerCase().includes(q),
        )
      : tasks;
    return [...filtered].sort((a, b) => {
      const aIdx = candidateTaskIds?.indexOf(a.id) ?? -1;
      const bIdx = candidateTaskIds?.indexOf(b.id) ?? -1;
      const aCand = candidateSet.has(a.id);
      const bCand = candidateSet.has(b.id);
      if (aCand && bCand) return aIdx - bIdx;
      if (aCand) return -1;
      if (bCand) return 1;
      return a.startDay - b.startDay;
    });
  }, [tasks, query, candidateTaskIds]);

  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId],
  );

  const needsValue = action === 'update_progress';
  const needsText = action === 'add_note' || action === 'log_issue';

  const canSubmit = useMemo(() => {
    if (!selectedTask) return false;
    if (needsValue) {
      const n = Number(valueStr);
      if (!Number.isFinite(n) || n < 0 || n > 100) return false;
    }
    if (needsText && !noteText.trim()) return false;
    return true;
  }, [selectedTask, needsValue, valueStr, needsText, noteText]);

  const handleSubmit = () => {
    if (!selectedTask || !canSubmit) return;
    if (Platform.OS !== 'web') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    onSubmit({
      task: selectedTask,
      action,
      value: needsValue ? Math.max(0, Math.min(100, Number(valueStr))) : undefined,
      text: needsText ? noteText.trim() : undefined,
    });
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.root}
      >
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.sheet} testID="quick-update-clarifier">
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Clarify update</Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {projectName}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={onClose}
              testID="clarifier-close"
            >
              <X size={18} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Action chips */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionLabel}>Action</Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.actionChipsRow}
          >
            {ACTION_CHIPS.map(({ key, label, Icon, color }) => {
              const active = action === key;
              return (
                <TouchableOpacity
                  key={key}
                  style={[
                    styles.actionChip,
                    active && { backgroundColor: color + '15', borderColor: color },
                  ]}
                  onPress={() => setAction(key)}
                  activeOpacity={0.8}
                  testID={`clarifier-action-${key}`}
                >
                  <Icon size={14} color={active ? color : Colors.textSecondary} />
                  <Text
                    style={[
                      styles.actionChipLabel,
                      active && { color, fontWeight: '700' as const },
                    ]}
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Value inputs (conditional) */}
          {needsValue && (
            <View style={styles.valueRow}>
              <Text style={styles.valueLabel}>Progress</Text>
              <View style={styles.valueInputWrap}>
                <TextInput
                  style={styles.valueInput}
                  value={valueStr}
                  onChangeText={(v) => setValueStr(v.replace(/[^0-9]/g, '').slice(0, 3))}
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor={Colors.textMuted}
                  maxLength={3}
                  testID="clarifier-progress-input"
                />
                <Text style={styles.valueSuffix}>%</Text>
              </View>
            </View>
          )}

          {needsText && (
            <View style={styles.noteWrap}>
              <Text style={styles.valueLabel}>
                {action === 'log_issue' ? 'Issue details' : 'Note'}
              </Text>
              <TextInput
                style={styles.noteInput}
                value={noteText}
                onChangeText={setNoteText}
                placeholder={
                  action === 'log_issue'
                    ? 'Short description of the issue'
                    : 'What do you want to note?'
                }
                placeholderTextColor={Colors.textMuted}
                multiline
                testID="clarifier-note-input"
              />
            </View>
          )}

          {/* Task picker */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionLabel}>Task</Text>
            {selectedTask && (
              <Text style={styles.sectionHint} numberOfLines={1}>
                Selected: {selectedTask.title}
              </Text>
            )}
          </View>
          <View style={styles.searchRow}>
            <Search size={14} color={Colors.textMuted} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Filter tasks"
              placeholderTextColor={Colors.textMuted}
              testID="clarifier-task-filter"
            />
          </View>
          <ScrollView
            style={styles.taskList}
            contentContainerStyle={{ paddingVertical: 4 }}
            keyboardShouldPersistTaps="handled"
          >
            {rankedTasks.length === 0 ? (
              <Text style={styles.emptyTasks}>No tasks match that filter.</Text>
            ) : (
              rankedTasks.map((t) => {
                const active = t.id === selectedTaskId;
                const isCandidate = (candidateTaskIds ?? []).includes(t.id);
                return (
                  <TouchableOpacity
                    key={t.id}
                    style={[styles.taskRow, active && styles.taskRowActive]}
                    onPress={() => setSelectedTaskId(t.id)}
                    activeOpacity={0.75}
                    testID={`clarifier-task-${t.id}`}
                  >
                    <View style={{ flex: 1 }}>
                      <View style={styles.taskTitleRow}>
                        <Text
                          style={[styles.taskTitle, active && styles.taskTitleActive]}
                          numberOfLines={1}
                        >
                          {t.title}
                        </Text>
                        {isCandidate && !active && (
                          <View style={styles.didYouMeanBadge}>
                            <Text style={styles.didYouMeanText}>match</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.taskMeta} numberOfLines={1}>
                        {t.phase} · {t.crew || 'Unassigned'} · {t.progress}%
                      </Text>
                    </View>
                    {active && (
                      <View style={styles.tick}>
                        <CheckCircle2 size={16} color={Colors.primary} />
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>

          <TouchableOpacity
            style={[styles.applyBtn, !canSubmit && styles.applyBtnDisabled]}
            disabled={!canSubmit}
            onPress={handleSubmit}
            activeOpacity={0.85}
            testID="clarifier-apply"
          >
            <Text style={styles.applyBtnLabel}>Apply update</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.overlay,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 24,
    maxHeight: '88%',
  },
  handle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.borderLight,
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  subtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.fillTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 6,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: Colors.textSecondary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    flex: 1,
  },
  sectionHint: {
    fontSize: 11,
    color: Colors.primary,
    fontWeight: '600' as const,
    marginLeft: 8,
    maxWidth: 180,
  },
  actionChipsRow: {
    gap: 8,
    paddingVertical: 4,
    paddingRight: 4,
  },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  actionChipLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500' as const,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
  },
  valueLabel: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  valueInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 10,
    paddingHorizontal: 10,
    minWidth: 80,
  },
  valueInput: {
    flex: 1,
    minHeight: 40,
    fontSize: 16,
    color: Colors.text,
    fontWeight: '700' as const,
  },
  valueSuffix: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontWeight: '600' as const,
    marginLeft: 2,
  },
  noteWrap: {
    marginTop: 8,
    gap: 6,
  },
  noteInput: {
    minHeight: 60,
    maxHeight: 120,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 10,
    padding: 10,
    fontSize: 14,
    color: Colors.text,
    textAlignVertical: 'top',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 10,
    paddingHorizontal: 10,
    marginBottom: 6,
  },
  searchInput: {
    flex: 1,
    minHeight: 36,
    fontSize: 13,
    color: Colors.text,
  },
  taskList: {
    maxHeight: 240,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: Colors.surfaceAlt,
    marginBottom: 6,
  },
  taskRowActive: {
    backgroundColor: Colors.primary + '12',
    borderWidth: 1,
    borderColor: Colors.primary + '55',
  },
  taskTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  taskTitle: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
    flexShrink: 1,
  },
  taskTitleActive: {
    color: Colors.primary,
  },
  taskMeta: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  didYouMeanBadge: {
    backgroundColor: Colors.accent + '25',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  didYouMeanText: {
    fontSize: 9,
    fontWeight: '700' as const,
    color: Colors.accent,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  tick: {
    marginLeft: 8,
  },
  emptyTasks: {
    fontSize: 12,
    color: Colors.textMuted,
    paddingVertical: 14,
    textAlign: 'center',
  },
  applyBtn: {
    marginTop: 12,
    height: 48,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  applyBtnDisabled: {
    backgroundColor: Colors.textMuted + '60',
  },
  applyBtnLabel: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.textOnPrimary,
  },
});
