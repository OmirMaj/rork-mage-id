import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView, TextInput, Switch, Alert, Platform, KeyboardAvoidingView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Layers, Minus, Plus, Trash2 } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import type { ScheduleTask, TaskStatus } from '@/types';
import { getPhaseColor, getStatusLabel, getStatusColor, createId } from '@/utils/scheduleEngine';
import { Tokens } from '@/constants/designTokens';
import { TaskChecklist } from './TaskChecklist';
import { FourDComingSoon } from './FourDComingSoon';
import { PercentSlider } from './PercentSlider';

interface TaskDetailSheetProps {
  visible: boolean;
  task: ScheduleTask | null;
  allTasks: ScheduleTask[];
  startDate: string;
  onClose: () => void;
  onUpdateTask: (next: ScheduleTask) => void;
  onDeleteTask: (id: string) => void;
}

type DetailTab = 'overview' | 'resources' | 'docs' | 'activity';
const STATUSES: TaskStatus[] = ['not_started', 'in_progress', 'done'];
const MS_DAY = 24 * 60 * 60 * 1000;

function fmt(d: Date): string { return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); }

function haptic(kind: 'sel' | 'warn' = 'sel') {
  if (Platform.OS === 'web') return;
  if (kind === 'warn') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  else void Haptics.selectionAsync();
}

// Small ±stepper used for start-day and duration (no native date picker — OTA-safe).
function Stepper({ value, onDec, onInc }: { value: string; onDec: () => void; onInc: () => void }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.stepper}>
      <TouchableOpacity style={styles.stepBtn} onPress={onDec} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Minus size={15} color={colors.text} strokeWidth={1.75} /></TouchableOpacity>
      <Text style={styles.stepVal} numberOfLines={1}>{value}</Text>
      <TouchableOpacity style={styles.stepBtn} onPress={onInc} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Plus size={15} color={colors.text} strokeWidth={1.75} /></TouchableOpacity>
    </View>
  );
}

export function TaskDetailSheet({ visible, task, allTasks, startDate, onClose, onUpdateTask, onDeleteTask }: TaskDetailSheetProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<DetailTab>('overview');
  const [title, setTitle] = useState('');
  const [crew, setCrew] = useState('');
  const [notes, setNotes] = useState('');
  const [pctDraft, setPctDraft] = useState(0);

  // Sync editable fields whenever a different task opens.
  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setCrew(task.crew || task.assignedSubName || '');
      setNotes(task.notes || '');
      setPctDraft(task.progress ?? 0);
    }
  }, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const baseMs = useMemo(() => {
    const d = startDate ? new Date(startDate) : new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, [startDate]);

  if (!task) return null;

  // Phase color marks CATEGORY (the small icon tile). Controls — the %
  // pill and the progress slider — use the app accent: they're single-value
  // UI, not phase-comparison data-viz. Pre-fix everything here wore the
  // phase color, which for the default 'General' phase meant an indigo
  // slider thumb + indigo pills that read as a foreign accent system
  // (sim-audit slop #5).
  const phaseColor = getPhaseColor(task.phase || 'Other');
  const dur = Math.max(1, task.durationDays || 1);
  // startDay is 1-indexed (day 1 = schedule start), matching the desktop + CPM
  // engine; shift by -1 to a 0-indexed day-offset from baseMs for the date math.
  const startOffset = (task.startDay ?? 1) - 1;
  const start = new Date(baseMs + startOffset * MS_DAY);
  const end = new Date(baseMs + (startOffset + dur - 1) * MS_DAY);
  const predNames = (task.dependencyLinks ?? []).map((l) => allTasks.find((t) => t.id === l.taskId)?.title).filter(Boolean) as string[];
  const checklist = task.checklist ?? [];

  const setStatus = (s: TaskStatus) => {
    haptic();
    const progress = s === 'done' ? 100 : s === 'not_started' ? 0 : (task.progress ?? 0);
    setPctDraft(progress);
    onUpdateTask({ ...task, status: s, progress });
  };
  const commitProgress = (p: number) => {
    const status: TaskStatus = p >= 100 ? 'done' : p <= 0 ? 'not_started' : 'in_progress';
    onUpdateTask({ ...task, progress: p, status });
  };
  const shiftStart = (delta: number) => { haptic(); onUpdateTask({ ...task, startDay: Math.max(1, (task.startDay ?? 1) + delta) }); };
  const shiftDuration = (delta: number) => { haptic(); onUpdateTask({ ...task, durationDays: Math.max(1, (task.durationDays || 1) + delta) }); };
  const toggleMilestone = (v: boolean) => { haptic(); onUpdateTask({ ...task, isMilestone: v }); };
  const commitTitle = () => { const v = title.trim(); if (v && v !== task.title) onUpdateTask({ ...task, title: v }); else if (!v) setTitle(task.title); };
  const commitCrew = () => { const seed = (task.crew || task.assignedSubName || '').trim(); if (crew.trim() !== seed) onUpdateTask({ ...task, crew: crew.trim() }); };
  const commitNotes = () => { if (notes !== (task.notes || '')) onUpdateTask({ ...task, notes }); };

  const toggleChecklist = (id: string) =>
    onUpdateTask({ ...task, checklist: checklist.map((c) => (c.id === id ? { ...c, done: !c.done } : c)) });
  const addChecklist = (label: string) =>
    onUpdateTask({ ...task, checklist: [...checklist, { id: createId('chk'), label, done: false }] });

  const handleDelete = () => {
    Alert.alert('Delete task?', `"${task.title}" will be removed from the schedule.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { haptic('warn'); onDeleteTask(task.id); } },
    ]);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 12, maxHeight: '90%' }]} testID="mobile-task-sheet">
          <View style={styles.grab} />
          {/* header */}
          <View style={styles.hd}>
            <View style={[styles.iconTile, { backgroundColor: phaseColor + '22' }]}>
              <Layers size={18} color={phaseColor} strokeWidth={1.75} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <TextInput
                value={title}
                onChangeText={setTitle}
                onEndEditing={commitTitle}
                onBlur={commitTitle}
                style={styles.titleInput}
                placeholder="Task title"
                placeholderTextColor={colors.textMuted}
                returnKeyType="done"
                testID="task-title-input"
              />
              <Text style={styles.phase} numberOfLines={1}>{task.phase || 'Other'}</Text>
            </View>
            <View style={[styles.pct, { backgroundColor: colors.accentSoft }]}>
              <Text style={[styles.pctText, { color: colors.accentLabel }]}>{pctDraft}%</Text>
            </View>
            <TouchableOpacity style={styles.close} onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <X size={18} color={colors.textMuted} strokeWidth={1.75} />
            </TouchableOpacity>
          </View>

          {/* tabs */}
          <View style={styles.tabs}>
            {(['overview', 'resources', 'docs', 'activity'] as DetailTab[]).map((tk) => (
              <TouchableOpacity key={tk} style={styles.tab} onPress={() => setTab(tk)}>
                <Text style={[styles.tabText, tab === tk ? { color: colors.accent } : null]}>
                  {tk === 'overview' ? 'Overview' : tk === 'resources' ? 'Resources' : tk === 'docs' ? 'Docs' : 'Activity'}
                </Text>
                {tab === tk && <View style={[styles.tabBar, { backgroundColor: colors.accent }]} />}
              </TouchableOpacity>
            ))}
          </View>

          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ padding: 16 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {tab === 'overview' && (
              <>
                <View style={styles.card}>
                  <View style={styles.editRow}>
                    <Text style={styles.gLbl}>Start</Text>
                    <Stepper value={fmt(start)} onDec={() => shiftStart(-1)} onInc={() => shiftStart(1)} />
                  </View>
                  <View style={styles.editRow}>
                    <Text style={styles.gLbl}>Duration</Text>
                    <Stepper value={`${dur} day${dur === 1 ? '' : 's'}`} onDec={() => shiftDuration(-1)} onInc={() => shiftDuration(1)} />
                  </View>
                  <Text style={styles.endHint}>Ends {fmt(end)}</Text>

                  <Text style={[styles.gLbl, { marginTop: 14 }]}>Status</Text>
                  <View style={styles.statusRow}>
                    {STATUSES.map((s) => (
                      <TouchableOpacity key={s} onPress={() => setStatus(s)}
                        style={[styles.statusChip, task.status === s ? { backgroundColor: getStatusColor(s) + '22', borderColor: getStatusColor(s) } : null]}>
                        <Text style={[styles.statusChipText, task.status === s ? { color: getStatusColor(s) } : null]}>{getStatusLabel(s)}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <View style={[styles.pctHeaderRow, { marginTop: 14 }]}><Text style={styles.gLbl}>% Complete</Text><Text style={styles.gVal}>{pctDraft}%</Text></View>
                  <PercentSlider value={pctDraft} onChange={setPctDraft} onCommit={commitProgress} color={colors.accent} />

                  <View style={styles.toggleRow}>
                    <Text style={styles.gLbl}>Milestone</Text>
                    <Switch value={!!task.isMilestone} onValueChange={toggleMilestone} trackColor={{ true: colors.accent, false: colors.line }} />
                  </View>

                  <View style={{ marginTop: 12 }}>
                    <Text style={styles.gLbl}>Depends on</Text>
                    <Text style={styles.gVal}>{predNames.length ? predNames.join(', ') : '—'}</Text>
                  </View>
                </View>

                <TaskChecklist items={checklist} onToggle={toggleChecklist} onAdd={addChecklist} />

                <TouchableOpacity style={styles.deleteBtn} activeOpacity={0.8} onPress={handleDelete} testID="task-delete">
                  <Trash2 size={16} color={colors.danger} strokeWidth={1.75} />
                  <Text style={styles.deleteText}>Delete task</Text>
                </TouchableOpacity>

                <View style={{ marginTop: 12 }}><FourDComingSoon compact /></View>
              </>
            )}
            {tab === 'resources' && (
              <View style={styles.card}>
                <Text style={styles.gLbl}>Crew / Sub</Text>
                <TextInput
                  value={crew}
                  onChangeText={setCrew}
                  onEndEditing={commitCrew}
                  onBlur={commitCrew}
                  placeholder="Unassigned"
                  placeholderTextColor={colors.textMuted}
                  style={styles.input}
                  testID="task-crew-input"
                />
                {!!task.crewSize && (<><Text style={[styles.gLbl, { marginTop: 12 }]}>Crew size</Text><Text style={styles.gVal}>{task.crewSize}</Text></>)}
              </View>
            )}
            {tab === 'docs' && (
              <View style={styles.card}>
                <Text style={styles.gLbl}>Linked estimate items</Text>
                <Text style={styles.gVal}>{task.linkedEstimateItems?.length ? `${task.linkedEstimateItems.length} linked` : 'None linked'}</Text>
              </View>
            )}
            {tab === 'activity' && (
              <View style={styles.card}>
                <Text style={styles.gLbl}>Notes</Text>
                <TextInput
                  value={notes}
                  onChangeText={setNotes}
                  onEndEditing={commitNotes}
                  onBlur={commitNotes}
                  placeholder="Add notes…"
                  placeholderTextColor={colors.textMuted}
                  style={[styles.input, styles.notesInput]}
                  multiline
                  testID="task-notes-input"
                />
              </View>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { backgroundColor: t.bg, borderTopLeftRadius: Tokens.radius.xl, borderTopRightRadius: Tokens.radius.xl, paddingTop: 8 },
  grab: { width: 40, height: 4, borderRadius: 2, backgroundColor: t.line, alignSelf: 'center' as const, marginBottom: 10 },
  hd: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 11, paddingHorizontal: 16, paddingBottom: 12 },
  iconTile: { width: 38, height: 38, borderRadius: 11, alignItems: 'center' as const, justifyContent: 'center' as const },
  titleInput: { fontSize: 17, fontWeight: '800' as const, color: t.text, letterSpacing: -0.3, padding: 0 },
  phase: { fontSize: 12, fontWeight: '600' as const, color: t.textMuted, marginTop: 1 },
  pct: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 12 },
  pctText: { fontSize: 12, fontWeight: '800' as const },
  close: { width: 30, height: 30, borderRadius: 15, backgroundColor: t.surfaceAlt, alignItems: 'center' as const, justifyContent: 'center' as const },
  tabs: { flexDirection: 'row' as const, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: t.line },
  tab: { paddingVertical: 10, marginRight: 20 },
  tabText: { fontSize: 13.5, fontWeight: '700' as const, color: t.textMuted },
  tabBar: { height: 2, borderRadius: 1, marginTop: 8 },
  card: { backgroundColor: t.surface, borderRadius: Tokens.radius.lg, borderWidth: 1, borderColor: t.line, padding: 14 },
  editRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: 10 },
  endHint: { fontSize: 11, fontWeight: '600' as const, color: t.textMuted, textAlign: 'right' as const },
  gLbl: { fontSize: 11, fontWeight: '700' as const, color: t.textMuted, marginBottom: 4 },
  gVal: { fontSize: 14, fontWeight: '700' as const, color: t.text },
  stepper: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, backgroundColor: t.surfaceAlt, borderRadius: 9, padding: 3 },
  stepBtn: { width: 30, height: 30, borderRadius: 7, backgroundColor: t.surface, alignItems: 'center' as const, justifyContent: 'center' as const, borderWidth: 1, borderColor: t.line },
  stepVal: { minWidth: 96, textAlign: 'center' as const, fontSize: 13, fontWeight: '700' as const, color: t.text },
  statusRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 6 },
  statusChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: t.line },
  statusChipText: { fontSize: 12, fontWeight: '700' as const, color: t.textMuted },
  pctHeaderRow: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, marginBottom: 2 },
  toggleRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginTop: 12 },
  input: { backgroundColor: t.surfaceAlt, borderRadius: 8, borderWidth: 1, borderColor: t.line, paddingHorizontal: 12, paddingVertical: 10, color: t.text, fontSize: 14, fontWeight: '600' as const },
  notesInput: { minHeight: 90, textAlignVertical: 'top' as const, marginTop: 2 },
  deleteBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8, marginTop: 14, paddingVertical: 12, borderRadius: Tokens.radius.lg, borderWidth: 1, borderColor: t.danger + '55', backgroundColor: t.danger + '12' },
  deleteText: { fontSize: 14, fontWeight: '800' as const, color: t.danger },
});
