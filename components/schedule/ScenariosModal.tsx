import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView, TextInput, Platform,
} from 'react-native';
import { useSheetFrame, useSheetDialogScope, useSheetPrimaryHotkey } from '@/components/ui/Sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft,
  GitBranch,
  Plus,
  Trash2,
  Check,
  Lock,
  RotateCcw,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import type { ProjectSchedule, ScheduleScenario, ScheduleTask } from '@/types';
import { useProjectAccess } from '@/hooks/useProjectAccess';
import Paywall from '@/components/Paywall';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';

/**
 * Saved plans — frozen snapshots of the schedule (stored as `scenarios`).
 *
 * Lets the user save a named copy of the current schedule, look at it, and
 * restore it. Stored on `ProjectSchedule.scenarios`; the live `tasks` array is
 * never mutated by viewing one — the consumer chooses which tasks to render
 * based on `activeScenarioId`.
 *
 * NAMED FOR WHAT IT DOES (#53). This shipped as "What-If Scenarios" and the
 * Pro paywall sold it as "try the what-if", but nothing can edit a snapshot:
 * every edit is refused while one is on screen (whatIfEditRefusal in the
 * Schedule tab), so no scenario could ever differ from the plan it copied.
 * The create card even promised "changes you make while a scenario is active
 * only affect that scenario". Until real scenario editing is built (a
 * founder decision: edits into scenario.tasks, CPM on the copy, a finish
 * delta against live), it is called what it is: a saved plan you can view and
 * restore.
 *
 * Gated behind `schedule_scenarios` (Pro+) — own tier OR the collaborator
 * grant on this project (#91). Free users see a paywall CTA.
 */
interface ScenariosModalProps {
  visible: boolean;
  onClose: () => void;
  schedule: ProjectSchedule;
  onScheduleChange: (patch: Partial<ProjectSchedule>) => void;
}

export default function ScenariosModal({
  visible,
  onClose,
  schedule,
  onScheduleChange,
}: ScenariosModalProps) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { canAccess } = useProjectAccess(schedule.projectId ?? undefined);
  const hasAccess = canAccess('schedule_scenarios');

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newNote, setNewNote] = useState('');

  const scenarios: ScheduleScenario[] = useMemo(
    () => schedule.scenarios ?? [],
    [schedule.scenarios],
  );
  const activeId = schedule.activeScenarioId ?? null;

  const handleCreate = useCallback(() => {
    const name = newName.trim();
    if (!name) {
      showAlert('Missing Name', 'Saved plans need a name so you can tell them apart.');
      return;
    }
    const scenario: ScheduleScenario = {
      id: `scn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      note: newNote.trim() || undefined,
      createdAt: new Date().toISOString(),
      tasks: schedule.tasks.map((t) => ({ ...t })) as ScheduleTask[],
    };
    // Saved, NOT switched to: the copy is identical to the live plan, and
    // showing it would only make every row read-only (#54).
    onScheduleChange({
      scenarios: [...scenarios, scenario],
    });
    if (Platform.OS !== 'web') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    setNewName('');
    setNewNote('');
    setShowCreate(false);
  }, [newName, newNote, schedule.tasks, scenarios, onScheduleChange]);

  const handleSwitch = useCallback(
    (scenarioId: string | null) => {
      if (Platform.OS !== 'web') {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      onScheduleChange({ activeScenarioId: scenarioId });
    },
    [onScheduleChange],
  );

  const handleRestore = useCallback(
    (scenario: ScheduleScenario) => {
      showAlert(
        'Restore this plan?',
        `This replaces the current ${schedule.tasks.length} task(s) with the ${scenario.tasks.length} task(s) saved in "${scenario.name}". Your current plan is snapshotted first, so you can undo.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Restore',
            style: 'destructive',
            onPress: () => {
              // Snapshot the current plan before overwriting, so a restore is
              // itself reversible.
              const backup: ScheduleScenario = {
                id: `scn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                name: `Before restore — ${new Date().toLocaleDateString()}`,
                note: 'Auto-saved before restoring a saved plan.',
                createdAt: new Date().toISOString(),
                tasks: schedule.tasks.map((t) => ({ ...t })) as ScheduleTask[],
              };
              onScheduleChange({
                tasks: scenario.tasks.map((t) => ({ ...t })) as ScheduleTask[],
                scenarios: [...scenarios, backup],
                activeScenarioId: null,
              });
              if (Platform.OS !== 'web') {
                void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              }
            },
          },
        ],
      );
    },
    [schedule.tasks, scenarios, onScheduleChange],
  );

  const handleDelete = useCallback(
    (scenarioId: string) => {
      showAlert(
        'Delete saved plan?',
        'The live plan is unaffected. This only removes the saved copy.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              const next = scenarios.filter((s) => s.id !== scenarioId);
              onScheduleChange({
                scenarios: next,
                activeScenarioId:
                  activeId === scenarioId ? null : activeId,
              });
            },
          },
        ],
      );
    },
    [scenarios, activeId, onScheduleChange],
  );

  // Desktop (wave 6c). The two full-screen pageSheets (locked, and the list)
  // are opaque: each only claims the shortcut registry's dialog scope while it
  // is up. The "Save this plan" dialog is a centred 440 card; Cmd/Ctrl+Enter
  // or Cmd/Ctrl+S saves it. All no-ops on a phone.
  useSheetDialogScope(visible && !hasAccess);
  useSheetDialogScope(visible && hasAccess);
  const createFrame = useSheetFrame('dialog', { visible: showCreate, animationType: 'fade' });
  useSheetPrimaryHotkey(visible && showCreate, handleCreate);

  if (!hasAccess) {
    return (
      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
        onRequestClose={onClose}
      >
        <View style={[styles.container, { paddingTop: Platform.OS === 'ios' ? 12 : insets.top + 8 }]}>
          <View style={styles.header}>
            <TouchableOpacity style={styles.backBtn} onPress={onClose}>
              <ChevronLeft size={22} color={themeColors.text} strokeWidth={1.75} />
              <Text style={styles.backText}>Back</Text>
            </TouchableOpacity>
            <Text style={styles.title}>Saved plans</Text>
            <View style={{ width: 56 }} />
          </View>
          <View style={styles.paywallWrap}>
            <View style={styles.lockBadge}>
              <Lock size={18} color={themeColors.accent} strokeWidth={1.75} />
            </View>
            <Paywall visible={true} requiredTier="pro" feature="schedule_scenarios" onClose={onClose} />
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
      onRequestClose={onClose}
    >
      <View style={[styles.container, { paddingTop: Platform.OS === 'ios' ? 12 : insets.top + 8 }]}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={onClose} testID="scenarios-back">
            <ChevronLeft size={22} color={themeColors.text} strokeWidth={1.75} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Saved plans</Text>
          <TouchableOpacity
            style={styles.newBtn}
            onPress={() => setShowCreate(true)}
            activeOpacity={0.85}
            testID="scenarios-new-btn" accessibilityRole="button" accessibilityLabel="Add">
            <Plus size={16} color={'#FFFFFF'} strokeWidth={2.5} />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: insets.bottom + 40 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.helpCard}>
            <GitBranch size={16} color={themeColors.accent} strokeWidth={1.75} />
            <Text style={styles.helpText}>
              Save a frozen copy of the plan — before a big change, a re-sequence or
              an import — so you can look back at it or restore it later. A saved
              plan can{"'"}t be edited: every change goes to the live plan.
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.row, activeId === null && styles.rowActive]}
            onPress={() => handleSwitch(null)}
            activeOpacity={0.8}
            testID="scenarios-baseline-row"
          >
            <View style={styles.rowHeader}>
              <Text style={[styles.rowName, activeId === null && styles.rowNameActive]}>
                Live plan
              </Text>
              {activeId === null && <Check size={16} color={themeColors.accent} strokeWidth={1.75} />}
            </View>
            <Text style={styles.rowMeta}>
              {schedule.tasks.length} tasks · {schedule.totalDurationDays} days
            </Text>
          </TouchableOpacity>

          {scenarios.map((s) => {
            const isActive = s.id === activeId;
            return (
              <View
                key={s.id}
                style={[styles.row, isActive && styles.rowActive]}
                testID={`scenarios-row-${s.id}`}
              >
                <TouchableOpacity
                  style={styles.rowMain}
                  onPress={() => handleSwitch(s.id)}
                  activeOpacity={0.8}
                >
                  <View style={styles.rowHeader}>
                    <Text
                      style={[styles.rowName, isActive && styles.rowNameActive]}
                      numberOfLines={1}
                    >
                      {s.name}
                    </Text>
                    {isActive && <Check size={16} color={themeColors.accent} strokeWidth={1.75} />}
                  </View>
                  {!!s.note && (
                    <Text style={styles.rowNote} numberOfLines={2}>
                      {s.note}
                    </Text>
                  )}
                  <Text style={styles.rowMeta}>
                    {s.tasks.length} tasks · created{' '}
                    {new Date(s.createdAt).toLocaleDateString()}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.restoreBtn}
                  onPress={() => handleRestore(s)}
                  activeOpacity={0.7}
                  testID={`scenarios-restore-${s.id}`} accessibilityRole="button" accessibilityLabel="Restore this plan">
                  <RotateCcw size={14} color={themeColors.accent} strokeWidth={1.75} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.deleteBtn}
                  onPress={() => handleDelete(s.id)}
                  activeOpacity={0.7}
                  testID={`scenarios-delete-${s.id}`} accessibilityRole="button" accessibilityLabel="Delete">
                  <Trash2 size={14} color={themeColors.danger} strokeWidth={1.75} />
                </TouchableOpacity>
              </View>
            );
          })}

          {scenarios.length === 0 && (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                No saved plans yet. Tap + to save a copy of the current plan.
              </Text>
            </View>
          )}
        </ScrollView>

        <Modal
          visible={showCreate}
          transparent
          animationType={createFrame.animationType}
          onRequestClose={() => setShowCreate(false)}
        >
          <View style={[styles.createOverlay, createFrame.overlay]}>
            <View style={[styles.createCard, createFrame.card]}>
              <Text style={styles.createTitle}>Save this plan</Text>
              <Text style={styles.createHint}>
                Saves a frozen copy of the schedule as it is now. The copy can{"'"}t
                be edited — keep working in the live plan, and restore this copy
                any time.
              </Text>

              <Text style={styles.fieldLabel}>Name</Text>
              <TextInput
                style={styles.input}
                value={newName}
                onChangeText={setNewName}
                placeholder="e.g. Before re-sequencing framing"
                placeholderTextColor={themeColors.textMuted}
                autoFocus
                testID="scenarios-new-name"
              />

              <Text style={styles.fieldLabel}>Note (optional)</Text>
              <TextInput
                style={[styles.input, styles.inputMulti]}
                value={newNote}
                onChangeText={setNewNote}
                placeholder="Why you saved it..."
                placeholderTextColor={themeColors.textMuted}
                multiline
                textAlignVertical="top"
                testID="scenarios-new-note"
              />

              <View style={styles.createActions}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => {
                    setShowCreate(false);
                    setNewName('');
                    setNewNote('');
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.saveBtn}
                  onPress={handleCreate}
                  activeOpacity={0.85}
                  testID="scenarios-save-btn"
                >
                  <Text style={styles.saveBtnText}>Create</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </Modal>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: t.line,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 8, paddingRight: 12 },
  backText: { fontSize: Type.subhead.fontSize, color: t.accent, fontWeight: '500' as const },
  title: { fontSize: Type.body.fontSize, fontWeight: '700' as const, color: t.text },
  newBtn: {
    width: 32,
    height: 32,
    borderRadius: Tokens.radius.panel,
    backgroundColor: t.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { padding: 16, gap: 10 },
  helpCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    backgroundColor: t.accent + '10',
    borderRadius: Tokens.radius.card,
    marginBottom: 6,
  },
  helpText: {
    flex: 1,
    fontSize: Type.caption1.fontSize,
    color: t.textSecondary,
    lineHeight: 17,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: t.line,
    gap: 10,
  },
  rowMain: { flex: 1, gap: 4 },
  rowActive: {
    borderColor: t.accent,
    backgroundColor: t.accent + '08',
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  rowName: {
    flex: 1,
    fontSize: Type.subhead.fontSize,
    fontWeight: '600' as const,
    color: t.text,
  },
  rowNameActive: { color: t.accent, fontWeight: '700' as const },
  rowNote: { fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 17 },
  rowMeta: { fontSize: Type.caption2.fontSize, color: t.textMuted },
  restoreBtn: {
    width: 32,
    height: 32,
    borderRadius: Tokens.radius.panel,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.accent + '12',
  },
  deleteBtn: {
    width: 32,
    height: 32,
    borderRadius: Tokens.radius.panel,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.danger + '10',
  },
  empty: { padding: 24, alignItems: 'center' },
  emptyText: {
    fontSize: Type.footnote.fontSize,
    color: t.textMuted,
    textAlign: 'center',
    lineHeight: 19,
  },
  paywallWrap: { flex: 1 },
  lockBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: t.accent + '15',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginTop: 20,
  },
  createOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'center',
    padding: 24,
  },
  createCard: {
    backgroundColor: t.surface,
    borderRadius: 20,
    padding: 20,
    gap: 6,
  },
  createTitle: {
    fontSize: Type.subheadline.fontSize,
    fontWeight: '700' as const,
    color: t.text,
  },
  createHint: {
    fontSize: Type.caption1.fontSize,
    color: t.textSecondary,
    marginBottom: 8,
    lineHeight: 17,
  },
  fieldLabel: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '600' as const,
    color: t.textSecondary,
    marginTop: 10,
    marginBottom: 4,
  },
  input: {
    minHeight: 42,
    borderRadius: Tokens.radius.md,
    backgroundColor: Colors.surfaceAlt,
    paddingHorizontal: 12,
    fontSize: Type.bodyCompact.fontSize,
    color: t.text,
  },
  inputMulti: { minHeight: 70, paddingTop: 10, textAlignVertical: 'top' as const },
  createActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  cancelBtn: {
    flex: 1,
    height: 44,
    borderRadius: Tokens.radius.card,
    backgroundColor: t.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '600' as const,
    color: t.textSecondary,
  },
  saveBtn: {
    flex: 1,
    height: 44,
    borderRadius: Tokens.radius.card,
    backgroundColor: t.accentFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
});
