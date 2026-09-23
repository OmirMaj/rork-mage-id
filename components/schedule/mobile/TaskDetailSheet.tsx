import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView, TextInput, Switch, Platform, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Layers, Minus, Plus, Trash2, CheckCircle2, Circle } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import type { ScheduleTask, TaskStatus } from '@/types';
import { getPhaseColor, getStatusLabel, createId } from '@/utils/scheduleEngine';
// Not scheduleEngine's getStatusColor: that returns the raw iOS palette
// (#34C759 / #007AFF / #FF9500 / #8E8E93), which fails AA in both directions
// here — as the chip's own label on its wash (2.22 / 4.02 / 2.20 / 3.26:1 on
// white) and again for the white the chip used to invert to. These are the
// measured inks the Pro scheduler's inspector already paints, so the same task
// now reads the same colour on the phone and on the desktop.
import { taskStatusInk, CHIP_TINT_SUFFIX } from '@/components/ui/ink';
import { statusInkFor } from '@/utils/scheduleColors';
import { Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import { TaskChecklist } from './TaskChecklist';
import { PercentSlider } from './PercentSlider';
import { showAlert } from '@/utils/alert';
import { parseCalendarDay } from '@/utils/calendarDate';
import {
  heldByPredecessor, scheduledStartOrdinal, scheduledTaskRange, steppedStartDay, taskCalendarRange, type ScheduledPlacement,
} from '@/utils/scheduleOps';
import { taskSheetLocks, type ScheduleWritePath } from '@/utils/fieldScheduleUpdate';

interface TaskDetailSheetProps {
  visible: boolean;
  task: ScheduleTask | null;
  allTasks: ScheduleTask[];
  /** The schedule's anchor, or NULL when it has none — see MobileScheduleList.
   *  Undated: the Start stepper and the "Ends" hint read day numbers, so the
   *  ± control never edits a real task against a date invented from today. */
  startDate: string | null;
  /** Schedule calendar — see MobileScheduleList. */
  workingDaysPerWeek?: number;
  nonWorkingDates?: string[];
  onClose: () => void;
  onUpdateTask: (next: ScheduleTask) => void;
  onDeleteTask: (id: string) => void;
  /** The caller's write path (scheduleWritePathForRole). Omitted = 'row'. */
  writePath?: ScheduleWritePath;
  /** Where the ENGINE placed each task — the SAME map the list row and the
   *  timeline draw from (MobileScheduleScreen `placements`). The sheet prints
   *  and steps from placements.get(task.id), so it shows the dates of the row
   *  he just tapped (#88). Omitted → the stored pin, as before. */
  placements?: ReadonlyMap<string, ScheduledPlacement>;
}

type DetailTab = 'overview' | 'resources' | 'docs' | 'activity';
const STATUSES: TaskStatus[] = ['not_started', 'in_progress', 'done'];

function fmt(d: Date): string { return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); }

function haptic(kind: 'sel' | 'warn' = 'sel') {
  if (Platform.OS === 'web') return;
  if (kind === 'warn') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  else void Haptics.selectionAsync();
}

// Small ±stepper used for start-day and duration (no native date picker — OTA-safe).
function Stepper({ value, onDec, onInc, disabled }: { value: string; onDec: () => void; onInc: () => void; disabled?: boolean }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const ink = disabled ? colors.textMuted : colors.text;
  return (
    <View style={[styles.stepper, disabled ? styles.lockedControl : null]}>
      <TouchableOpacity style={styles.stepBtn} onPress={onDec} disabled={disabled} accessibilityState={{ disabled: !!disabled }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Minus size={15} color={ink} strokeWidth={1.75} /></TouchableOpacity>
      <Text style={styles.stepVal} numberOfLines={1}>{value}</Text>
      <TouchableOpacity style={styles.stepBtn} onPress={onInc} disabled={disabled} accessibilityState={{ disabled: !!disabled }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Plus size={15} color={ink} strokeWidth={1.75} /></TouchableOpacity>
    </View>
  );
}

/** The checklist as a read-out, for access that cannot save a tick (#139). */
function ReadOnlyChecklist({ items }: { items: { id: string; label: string; done: boolean }[] }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const doneCount = items.filter((i) => i.done).length;
  return (
    <View style={[styles.card, { marginTop: 12 }]} testID="task-checklist-readonly">
      <View style={styles.pctHeaderRow}>
        <Text style={styles.gLbl}>TASK CHECKLIST</Text>
        <Text style={styles.gVal}>{doneCount}/{items.length}</Text>
      </View>
      {items.length === 0 ? <Text style={styles.gLbl}>No checklist items.</Text> : null}
      {items.map((it) => (
        <View key={it.id} style={styles.roRow}>
          {it.done ? <CheckCircle2 size={18} color={colors.success} strokeWidth={1.75} /> : <Circle size={18} color={colors.textMuted} strokeWidth={1.75} />}
          <Text style={[styles.roLabel, it.done ? styles.roLabelDone : null]} numberOfLines={2}>{it.label}</Text>
        </View>
      ))}
    </View>
  );
}

export function TaskDetailSheet({ visible, task, allTasks, startDate, workingDaysPerWeek, nonWorkingDates, onClose, onUpdateTask, onDeleteTask, writePath, placements }: TaskDetailSheetProps) {
  const { colors } = useTheme();
  // What this access can save here (#139) — see taskSheetLocks for why.
  const locks = taskSheetLocks(writePath);
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Resolved once per theme change rather than per chip: `colors` is memoised
  // by ThemeContext, and the status row rebuilds this on every render otherwise.
  const statusInks = useMemo(() => taskStatusInk(colors), [colors]);
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

  // A peer's (or the live schedule's) progress change on the SAME task used to
  // leave the slider on the old figure until the sheet was closed and reopened.
  // Follow task.progress while the slider is idle; never while his finger is on
  // it, or the incoming value would yank the thumb out from under him.
  const sliderActiveRef = useRef(false);
  const onSliderChange = (p: number) => { sliderActiveRef.current = true; setPctDraft(p); };
  useEffect(() => {
    if (!task || sliderActiveRef.current) return;
    setPctDraft(task.progress ?? 0);
  }, [task?.progress]); // eslint-disable-line react-hooks/exhaustive-deps

  // baseMs is LOCAL midnight of schedule day 1. It used to be
  // `new Date(startDate)` + setHours(0,0,0,0), and `startDate` is a bare
  // 'YYYY-MM-DD' (MobileScheduleScreen.tsx) — the spec parses that as UTC
  // MIDNIGHT, so at any negative UTC offset the floor landed on the PREVIOUS
  // local day. Because `fmt` below prints the WEEKDAY NAME, the error was loud
  // and pointed the wrong way: a startDay:1 task on a schedule anchored Monday
  // Mar 2 read "Sun, Mar 1" while the desktop grid read Mar 2 for the same
  // task. The ± stepper edits startDay against that mislabeled date, so a
  // foreman "correcting" it moved real scheduled work by a day.
  // parseCalendarDay (utils/calendarDate.ts) is the shared fix and also
  // tolerates the full ISO timestamp Supabase can hand back for this field.
  const base = useMemo(() => {
    const d = parseCalendarDay(startDate);
    if (!d) return null;
    d.setHours(0, 0, 0, 0);
    return d;
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
  // startDay is 1-indexed (day 1 = schedule start) and counts WORKING days,
  // matching the desktop + CPM engine, so dates are walked on the schedule's
  // working calendar — not `baseMs + offset * MS_DAY`, which printed the
  // Saturday for a startDay-6 task (B4 review A9 / item 2).
  //
  // THE ROW'S DATES, NOT THE PIN'S (#88). startDay is only the pin; the list
  // row and the timeline print where the ENGINE placed the task, and a
  // predecessor that grew on the web pushes it later without rewriting the
  // pin. The sheet printed the pin, so the row said Mar 10 and the sheet Mar 3
  // for the same task. Now both come from scheduledTaskRange over the same
  // placement (undated: the placement's working days, as scheduledWorkingDayLabel).
  const placement = placements?.get(task.id);
  const calendar = { scheduleStartDate: startDate ?? undefined, workingDaysPerWeek, nonWorkingDates };
  const range = base ? scheduledTaskRange(task, placement, base, workingDaysPerWeek, nonWorkingDates) : null;
  const pinDay = Math.max(1, task.startDay ?? 1);
  const startDayNumber = scheduledStartOrdinal(task, placement, calendar);
  const endDayNumber = placement && placement.scale === 'working'
    ? Math.max(startDayNumber, Math.round(placement.ef))
    : startDayNumber + dur - 1;
  const startLabel = range ? fmt(range.start) : `Day ${startDayNumber}`;
  // A 0-day milestone does not END anywhere — it lands. `dur` floors at 1 so
  // the duration stepper has something to step, and reading the hint off that
  // floor made the sheet say "Ends day 6" for the same task the list row calls
  // simply "Day 6" (taskWorkingDayLabel).
  const isPointMilestone = !!task.isMilestone && !(task.durationDays > 0);
  const endLabel = isPointMilestone
    ? (range ? `Lands ${fmt(range.start)}` : `Lands on day ${startDayNumber}`)
    : range
      ? `Ends ${fmt(range.end)}`
      : `Ends day ${endDayNumber}`;
  // Pushed past his pin by a predecessor: say so beside the stepper, with the
  // pin he set, so the real date and his date are read together (the same
  // story the snap-back notice tells after a tap).
  const heldBy = startDayNumber > pinDay ? heldByPredecessor(task, allTasks, placements, calendar) : null;
  const pinLabel = base ? fmt(taskCalendarRange(task, base, workingDaysPerWeek, nonWorkingDates).start) : `day ${pinDay}`;
  const heldLabel = startDayNumber > pinDay
    ? `Held to ${range ? fmt(range.start) : `day ${startDayNumber}`}${heldBy ? ` by ${heldBy}` : ' by its links'} (you set ${pinLabel})`
    : null;
  const predNames = (task.dependencyLinks ?? []).map((l) => allTasks.find((t) => t.id === l.taskId)?.title).filter(Boolean) as string[];
  const checklist = task.checklist ?? [];

  const setStatus = (s: TaskStatus) => {
    if (locks.progress) return;
    haptic();
    const progress = s === 'done' ? 100 : s === 'not_started' ? 0 : (task.progress ?? 0);
    setPctDraft(progress);
    onUpdateTask({ ...task, status: s, progress });
  };
  const commitProgress = (p: number) => {
    sliderActiveRef.current = false;
    if (locks.progress) return;
    const status: TaskStatus = p >= 100 ? 'done' : p <= 0 ? 'not_started' : 'in_progress';
    onUpdateTask({ ...task, progress: p, status });
  };
  // "+" steps from the SCHEDULED start (#88), so it moves the date he sees.
  // "−" steps from his pin when a predecessor holds the task later: it asks
  // for an earlier day than the one he set (the screen's snap-back notice
  // says why the bar stays), and never rewrites his earlier pin to a later one.
  const shiftStart = (delta: number) => { if (locks.plan) return; haptic(); onUpdateTask({ ...task, startDay: steppedStartDay(pinDay, startDayNumber, delta) }); };
  const shiftDuration = (delta: number) => { if (locks.plan) return; haptic(); onUpdateTask({ ...task, durationDays: Math.max(1, (task.durationDays || 1) + delta) }); };
  const toggleMilestone = (v: boolean) => { if (locks.plan) return; haptic(); onUpdateTask({ ...task, isMilestone: v }); };
  const commitTitle = () => { if (locks.plan) { setTitle(task.title); return; } const v = title.trim(); if (v && v !== task.title) onUpdateTask({ ...task, title: v }); else if (!v) setTitle(task.title); };
  const commitCrew = () => { if (locks.plan) return; const seed = (task.crew || task.assignedSubName || '').trim(); if (crew.trim() !== seed) onUpdateTask({ ...task, crew: crew.trim() }); };
  const commitNotes = () => { if (locks.progress) return; if (notes !== (task.notes || '')) onUpdateTask({ ...task, notes }); };

  const toggleChecklist = (id: string) =>
    onUpdateTask({ ...task, checklist: checklist.map((c) => (c.id === id ? { ...c, done: !c.done } : c)) });
  const addChecklist = (label: string) =>
    onUpdateTask({ ...task, checklist: [...checklist, { id: createId('chk'), label, done: false }] });

  const handleDelete = () => {
    if (locks.plan) return;
    showAlert('Delete task?', `"${task.title}" will be removed from the schedule.`, [
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
                editable={!locks.plan}
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
            {locks.reason ? (
              <Text style={styles.lockReason} testID="task-sheet-access-reason">{locks.reason}</Text>
            ) : null}
            {tab === 'overview' && (
              <>
                <View style={styles.card}>
                  <View style={styles.editRow}>
                    <Text style={styles.gLbl}>Start</Text>
                    <Stepper value={startLabel} onDec={() => shiftStart(-1)} onInc={() => shiftStart(1)} disabled={locks.plan} />
                  </View>
                  <View style={styles.editRow}>
                    <Text style={styles.gLbl}>Duration</Text>
                    <Stepper value={`${dur} day${dur === 1 ? '' : 's'}`} onDec={() => shiftDuration(-1)} onInc={() => shiftDuration(1)} disabled={locks.plan} />
                  </View>
                  <Text style={styles.endHint}>{endLabel}</Text>
                  {heldLabel ? <Text style={styles.endHint} testID="task-sheet-held-by">{heldLabel}</Text> : null}

                  <Text style={[styles.gLbl, { marginTop: 14 }]}>Status</Text>
                  <View style={styles.statusRow}>
                    {STATUSES.map((s) => {
                      const ink = statusInkFor(statusInks, s);
                      return (
                        <TouchableOpacity key={s} onPress={() => setStatus(s)} disabled={locks.progress} accessibilityState={{ disabled: locks.progress, selected: task.status === s }}
                          /* CHIP_TINT_SUFFIX, not the '22' this shipped with —
                             13% deepens the wash enough to drop the on_hold ink
                             to 4.32:1 under its own label. Same fix as
                             TaskInspector's chips, same constant. */
                          style={[styles.statusChip, task.status === s ? { backgroundColor: ink + CHIP_TINT_SUFFIX, borderColor: ink } : null]}>
                          <Text style={[styles.statusChipText, task.status === s ? { color: ink } : null]}>{getStatusLabel(s)}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <View style={[styles.pctHeaderRow, { marginTop: 14 }]}><Text style={styles.gLbl}>% Complete</Text><Text style={styles.gVal}>{pctDraft}%</Text></View>
                  {locks.progress ? null : (
                    <PercentSlider value={pctDraft} onChange={onSliderChange} onCommit={commitProgress} color={colors.accent} />
                  )}

                  <View style={styles.toggleRow}>
                    <Text style={styles.gLbl}>Milestone</Text>
                    <Switch value={!!task.isMilestone} onValueChange={toggleMilestone} disabled={locks.plan} trackColor={{ true: colors.accent, false: colors.line }} />
                  </View>

                  <View style={{ marginTop: 12 }}>
                    <Text style={styles.gLbl}>Depends on</Text>
                    <Text style={styles.gVal}>{predNames.length ? predNames.join(', ') : '—'}</Text>
                  </View>
                </View>

                {locks.plan
                  ? <ReadOnlyChecklist items={checklist} />
                  : <TaskChecklist items={checklist} onToggle={toggleChecklist} onAdd={addChecklist} />}

                <TouchableOpacity style={[styles.deleteBtn, locks.plan ? styles.lockedControl : null]} activeOpacity={0.8} onPress={handleDelete} disabled={locks.plan} accessibilityState={{ disabled: locks.plan }} testID="task-delete">
                  <Trash2 size={16} color={colors.danger} strokeWidth={1.75} />
                  <Text style={styles.deleteText}>Delete task</Text>
                </TouchableOpacity>
                {/* A "4D model — coming soon" card used to live here. It was
                    advertising a delivered capability as future work: the
                    Living Floor Plan renders in the "Living Plan" sub-tab of
                    MobileScheduleScreen, one tap away from this sheet. (That
                    sub-tab was itself labelled "4D Model" until MISS-08 —
                    there is no 3D model behind it, and no 3D dependency in the
                    app; it is a 2D plan whose zones tint by schedule status.)
                    We did NOT replace it with a scoped LivingFloorPlan:
                    that component owns a PanResponder timeline scrubber and
                    its own zone Modal, and this sheet is already a Modal
                    wrapping a ScrollView. Nesting them means a drag gesture
                    fighting the sheet's scroll and a modal-over-modal on iOS.
                    Zones are also per-plan-sheet, not per-task, so most tasks
                    would render an empty plan. Removing the false promise is
                    the honest outcome. */}
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
                  editable={!locks.plan}
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
                  editable={!locks.progress}
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
  lockedControl: { opacity: 0.45 },
  lockReason: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: t.textMuted, lineHeight: 17, marginBottom: 12 },
  roRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, paddingVertical: 7, borderTopWidth: 1, borderTopColor: t.line },
  roLabel: { flex: 1, fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: t.text },
  roLabelDone: { color: t.textMuted, textDecorationLine: 'line-through' as const },
});
