import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft,
  GitBranch,
  Plus,
  Trash2,
  Check,
  Lock,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ProjectSchedule, ScheduleScenario, ScheduleTask } from '@/types';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';

/**
 * What-If Scenarios manager.
 *
 * Lets the user snapshot the current schedule into a named scenario, then
 * switch between the baseline plan and any scenario on-the-fly. Stored on
 * `ProjectSchedule.scenarios` — the baseline `tasks` array is never mutated
 * by scenario switches; the consumer chooses which tasks to render based
 * on `activeScenarioId`.
 *
 * Gated behind `schedule_scenarios` (Pro+). Free users see a paywall CTA.
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
  const insets = useSafeAreaInsets();
  const { canAccess } = useTierAccess();
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
      Alert.alert('Missing Name', 'Scenarios need a name so you can tell them apart.');
      return;
    }
    const scenario: ScheduleScenario = {
      id: `scn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      note: newNote.trim() || undefined,
      createdAt: new Date().toISOString(),
      tasks: schedule.tasks.map((t) => ({ ...t })) as ScheduleTask[],
    };
    onScheduleChange({
      scenarios: [...scenarios, scenario],
      activeScenarioId: scenario.id,
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

  const handleDelete = useCallback(
    (scenarioId: string) => {
      Alert.alert(
        'Delete Scenario?',
        'The baseline plan is unaffected. This only removes the saved scenario.',
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
              <ChevronLeft size={22} color={Colors.text} />
              <Text style={styles.backText}>Back</Text>
            </TouchableOpacity>
            <Text style={styles.title}>What-If Scenarios</Text>
            <View style={{ width: 56 }} />
          </View>
          <View style={styles.paywallWrap}>
            <View style={styles.lockBadge}>
              <Lock size={18} color={Colors.primary} />
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
            <ChevronLeft size={22} color={Colors.text} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>What-If Scenarios</Text>
          <TouchableOpacity
            style={styles.newBtn}
            onPress={() => setShowCreate(true)}
            activeOpacity={0.85}
            testID="scenarios-new-btn"
          >
            <Plus size={16} color={Colors.textOnPrimary} strokeWidth={2.5} />
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
            <GitBranch size={16} color={Colors.primary} />
            <Text style={styles.helpText}>
              Snapshot the schedule into a named alternate, like {'"'}Overtime push{'"'} or
              {' "'}Rain delay,{'"'} then toggle between the baseline plan and any
              scenario. The baseline is never overwritten.
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
                Baseline Plan
              </Text>
              {activeId === null && <Check size={16} color={Colors.primary} />}
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
                    {isActive && <Check size={16} color={Colors.primary} />}
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
                  style={styles.deleteBtn}
                  onPress={() => handleDelete(s.id)}
                  activeOpacity={0.7}
                  testID={`scenarios-delete-${s.id}`}
                >
                  <Trash2 size={14} color={Colors.error} />
                </TouchableOpacity>
              </View>
            );
          })}

          {scenarios.length === 0 && (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                No scenarios yet. Tap + to snapshot the current plan as
                {' "'}Scenario A{'"'} and start branching.
              </Text>
            </View>
          )}
        </ScrollView>

        <Modal
          visible={showCreate}
          transparent
          animationType="fade"
          onRequestClose={() => setShowCreate(false)}
        >
          <View style={styles.createOverlay}>
            <View style={styles.createCard}>
              <Text style={styles.createTitle}>New Scenario</Text>
              <Text style={styles.createHint}>
                This snapshots the current schedule. Changes you make while a
                scenario is active only affect that scenario.
              </Text>

              <Text style={styles.fieldLabel}>Name</Text>
              <TextInput
                style={styles.input}
                value={newName}
                onChangeText={setNewName}
                placeholder="e.g. Overtime push"
                placeholderTextColor={Colors.textMuted}
                autoFocus
                testID="scenarios-new-name"
              />

              <Text style={styles.fieldLabel}>Note (optional)</Text>
              <TextInput
                style={[styles.input, styles.inputMulti]}
                value={newNote}
                onChangeText={setNewNote}
                placeholder="Why this scenario exists..."
                placeholderTextColor={Colors.textMuted}
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 8, paddingRight: 12 },
  backText: { fontSize: 15, color: Colors.primary, fontWeight: '500' as const },
  title: { fontSize: 17, fontWeight: '700' as const, color: Colors.text },
  newBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { padding: 16, gap: 10 },
  helpCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    backgroundColor: Colors.primary + '10',
    borderRadius: 12,
    marginBottom: 6,
  },
  helpText: {
    flex: 1,
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 17,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    gap: 10,
  },
  rowMain: { flex: 1, gap: 4 },
  rowActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '08',
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  rowName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  rowNameActive: { color: Colors.primary, fontWeight: '700' as const },
  rowNote: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17 },
  rowMeta: { fontSize: 11, color: Colors.textMuted },
  deleteBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.error + '10',
  },
  empty: { padding: 24, alignItems: 'center' },
  emptyText: {
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 19,
  },
  paywallWrap: { flex: 1 },
  lockBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primary + '15',
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
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 20,
    gap: 6,
  },
  createTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  createHint: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginBottom: 8,
    lineHeight: 17,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    marginTop: 10,
    marginBottom: 4,
  },
  input: {
    minHeight: 42,
    borderRadius: 10,
    backgroundColor: Colors.surfaceAlt,
    paddingHorizontal: 12,
    fontSize: 14,
    color: Colors.text,
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
    borderRadius: 12,
    backgroundColor: Colors.fillTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  saveBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.textOnPrimary,
  },
});
