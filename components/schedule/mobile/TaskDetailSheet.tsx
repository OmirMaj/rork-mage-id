import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Layers } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import type { ScheduleTask, TaskStatus } from '@/types';
import { getPhaseColor, getStatusLabel, getStatusColor, createId } from '@/utils/scheduleEngine';
import { Tokens } from '@/constants/designTokens';
import { TaskChecklist } from './TaskChecklist';
import { FourDComingSoon } from './FourDComingSoon';

interface TaskDetailSheetProps {
  visible: boolean;
  task: ScheduleTask | null;
  allTasks: ScheduleTask[];
  startDate: string;
  onClose: () => void;
  onUpdateTask: (next: ScheduleTask) => void;
}

type DetailTab = 'overview' | 'resources' | 'docs' | 'activity';
const STATUSES: TaskStatus[] = ['not_started', 'in_progress', 'done'];
const MS_DAY = 24 * 60 * 60 * 1000;

function fmt(d: Date): string { return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }

export function TaskDetailSheet({ visible, task, allTasks, startDate, onClose, onUpdateTask }: TaskDetailSheetProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<DetailTab>('overview');

  const baseMs = useMemo(() => {
    const d = startDate ? new Date(startDate) : new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, [startDate]);

  if (!task) return null;

  const phaseColor = getPhaseColor(task.phase || 'Other');
  const start = new Date(baseMs + (task.startDay ?? 0) * MS_DAY);
  const end = new Date(baseMs + ((task.startDay ?? 0) + Math.max(1, task.durationDays || 1)) * MS_DAY);
  const predNames = (task.dependencyLinks ?? []).map((l) => allTasks.find((t) => t.id === l.taskId)?.title).filter(Boolean) as string[];
  const checklist = task.checklist ?? [];

  const toggleChecklist = (id: string) =>
    onUpdateTask({ ...task, checklist: checklist.map((c) => (c.id === id ? { ...c, done: !c.done } : c)) });
  const addChecklist = (label: string) =>
    onUpdateTask({ ...task, checklist: [...checklist, { id: createId('chk'), label, done: false }] });

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 12, maxHeight: '88%' }]} testID="mobile-task-sheet">
        <View style={styles.grab} />
        {/* header */}
        <View style={styles.hd}>
          <View style={[styles.iconTile, { backgroundColor: phaseColor + '22' }]}>
            <Layers size={18} color={phaseColor} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.title} numberOfLines={1}>{task.title}</Text>
            <Text style={styles.phase} numberOfLines={1}>{task.phase || 'Other'}</Text>
          </View>
          <View style={[styles.pct, { backgroundColor: phaseColor + '1A' }]}>
            <Text style={[styles.pctText, { color: phaseColor }]}>{task.progress ?? 0}%</Text>
          </View>
          <TouchableOpacity style={styles.close} onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <X size={18} color={colors.textMuted} />
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

        <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ padding: 16 }} showsVerticalScrollIndicator={false}>
          {tab === 'overview' && (
            <>
              <View style={styles.card}>
                <View style={styles.gridRow}>
                  <View style={styles.gridCell}><Text style={styles.gLbl}>Duration</Text><Text style={styles.gVal}>{fmt(start)} – {fmt(end)}</Text><Text style={styles.gSub}>{Math.max(1, task.durationDays || 1)} days</Text></View>
                  <View style={styles.gridCell}><Text style={styles.gLbl}>Status</Text>
                    <View style={styles.statusRow}>
                      {STATUSES.map((s) => (
                        <TouchableOpacity key={s} onPress={() => onUpdateTask({ ...task, status: s })}
                          style={[styles.statusChip, task.status === s ? { backgroundColor: getStatusColor(s) + '22', borderColor: getStatusColor(s) } : null]}>
                          <Text style={[styles.statusChipText, task.status === s ? { color: getStatusColor(s) } : null]}>{getStatusLabel(s)}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                </View>
                <View style={styles.gridRow}>
                  <View style={styles.gridCell}><Text style={styles.gLbl}>Depends on</Text><Text style={styles.gVal}>{predNames.length ? predNames.join(', ') : '—'}</Text></View>
                </View>
                <View style={{ marginTop: 10 }}>
                  <View style={styles.pctHeaderRow}><Text style={styles.gLbl}>% Complete</Text><Text style={styles.gVal}>{task.progress ?? 0}%</Text></View>
                  <View style={styles.pctTrack}><View style={[styles.pctFill, { width: `${Math.min(100, task.progress ?? 0)}%`, backgroundColor: phaseColor }]} /></View>
                </View>
              </View>
              <TaskChecklist items={checklist} onToggle={toggleChecklist} onAdd={addChecklist} />
              <View style={{ marginTop: 12 }}><FourDComingSoon compact /></View>
            </>
          )}
          {tab === 'resources' && (
            <View style={styles.card}>
              <Text style={styles.gLbl}>Crew</Text><Text style={styles.gVal}>{task.crew || task.assignedSubName || 'Unassigned'}</Text>
              {!!task.crewSize && (<><Text style={[styles.gLbl, { marginTop: 10 }]}>Crew size</Text><Text style={styles.gVal}>{task.crewSize}</Text></>)}
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
              <Text style={[styles.gVal, { lineHeight: 19 }]}>{task.notes?.trim() || 'No notes yet.'}</Text>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { backgroundColor: t.bg, borderTopLeftRadius: Tokens.radius.xl, borderTopRightRadius: Tokens.radius.xl, paddingTop: 8 },
  grab: { width: 40, height: 4, borderRadius: 2, backgroundColor: t.line, alignSelf: 'center' as const, marginBottom: 10 },
  hd: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 11, paddingHorizontal: 16, paddingBottom: 12 },
  iconTile: { width: 38, height: 38, borderRadius: 11, alignItems: 'center' as const, justifyContent: 'center' as const },
  title: { fontSize: 17, fontWeight: '800' as const, color: t.text, letterSpacing: -0.3 },
  phase: { fontSize: 12, fontWeight: '600' as const, color: t.textMuted, marginTop: 1 },
  pct: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 12 },
  pctText: { fontSize: 12, fontWeight: '800' as const },
  close: { width: 30, height: 30, borderRadius: 15, backgroundColor: t.surfaceAlt, alignItems: 'center' as const, justifyContent: 'center' as const },
  tabs: { flexDirection: 'row' as const, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: t.line },
  tab: { paddingVertical: 10, marginRight: 20 },
  tabText: { fontSize: 13.5, fontWeight: '700' as const, color: t.textMuted },
  tabBar: { height: 2, borderRadius: 1, marginTop: 8 },
  card: { backgroundColor: t.surface, borderRadius: Tokens.radius.lg, borderWidth: 1, borderColor: t.line, padding: 14 },
  gridRow: { flexDirection: 'row' as const, gap: 14, marginBottom: 12 },
  gridCell: { flex: 1 },
  gLbl: { fontSize: 11, fontWeight: '700' as const, color: t.textMuted, marginBottom: 4 },
  gVal: { fontSize: 14, fontWeight: '700' as const, color: t.text },
  gSub: { fontSize: 11, fontWeight: '600' as const, color: t.textMuted, marginTop: 1 },
  statusRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 6 },
  statusChip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: t.line },
  statusChipText: { fontSize: 11, fontWeight: '700' as const, color: t.textMuted },
  pctHeaderRow: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, marginBottom: 6 },
  pctTrack: { height: 8, backgroundColor: t.line, borderRadius: 4, overflow: 'hidden' as const },
  pctFill: { height: '100%' as const, borderRadius: 4 },
});
