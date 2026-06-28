// TaskInspector — right-side slide-in panel showing one task's full detail.
//
// MAGE's equivalent of MSP's "Task Details" form, but tuned for the split
// grid+gantt view: when a user clicks a bar (or grid row), the inspector
// docks on the right with the full field set so they can tweak notes,
// resources, anchors, and status without losing the timeline context.
//
// Intentionally read-heavy first, edit-light: deep edits still go through
// the grid (which owns cell validation, undo, bulk ops). The inspector
// exposes the handful of one-off fields that the grid doesn't surface
// cleanly — notably notes, status, dependency list, and the raw CPM
// numbers for a "why is this task where it is" moment.
//
// Not a modal — this stays visible while the user still interacts with
// everything else. Slides in from the right on web; on native the width
// matches a phone's portrait so it acts like a full-screen drawer.

import React, { useMemo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform, TextInput, Alert, Modal, Pressable } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { X, Anchor, Flag, Users, CalendarClock, Info, Camera, Bell, Plus, Trash2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import type { ScheduleTask } from '@/types';
import type { CpmResult } from '@/utils/cpm';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { TRADE_KEYS, tradeKeyForTask, tradeLabel, type TradeKey } from '@/utils/scheduleColors';

interface TaskInspectorProps {
  task: ScheduleTask | null;
  allTasks: ScheduleTask[];
  cpm: CpmResult;
  projectStartDate: Date;
  onClose: () => void;
  onEdit: (taskId: string, patch: Partial<ScheduleTask>) => void;
}

function dayToDate(startDate: Date, day: number): string {
  if (!Number.isFinite(day)) return '—';
  const d = new Date(startDate);
  d.setDate(d.getDate() + day - 1);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const STATUS_OPTIONS: { value: NonNullable<ScheduleTask['status']>; label: string; color: string }[] = [
  { value: 'not_started', label: 'Not started', color: "#9AA3AD" },
  { value: 'in_progress', label: 'In progress', color: "#FF6A1A" },
  { value: 'on_hold', label: 'On hold', color: Colors.warning },
  { value: 'done', label: 'Done', color: "#2E7D44" },
];

export default function TaskInspector({
  task, allTasks, cpm, projectStartDate, onClose, onEdit,
}: TaskInspectorProps) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [subscriberDraft, setSubscriberDraft] = useState('');
  const [tradeDropdownOpen, setTradeDropdownOpen] = useState(false);

  // Photo capture — camera + library, both fall through to handleEdit
  // appending to the photos array. iOS handles HEIC→JPEG natively at the
  // ImagePicker layer.
  const handleAddPhoto = useCallback(async (source: 'camera' | 'library') => {
    if (!task) return;
    if (Platform.OS === 'web' && source === 'camera') {
      Alert.alert('Camera unavailable on web', 'Use the library picker instead.');
      return;
    }
    try {
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) return;
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) return;
      }
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7, exif: false })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7, exif: false, allowsMultipleSelection: false });
      if (result.canceled || !result.assets?.[0]) return;
      const next = [...(task.photos ?? []), {
        uri: result.assets[0].uri,
        timestamp: new Date().toISOString(),
      }];
      onEdit(task.id, { photos: next });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      console.warn('[TaskInspector] photo failed', e);
    }
  }, [task, onEdit]);

  const handleRemovePhoto = useCallback((idx: number) => {
    if (!task) return;
    const photos = task.photos ?? [];
    const next = photos.filter((_, i) => i !== idx);
    onEdit(task.id, { photos: next });
  }, [task, onEdit]);

  // Subscribers — opt-in identifiers (sub name / email / phone). On task
  // shift, only these get notified. Empty array = silent.
  const handleAddSubscriber = useCallback(() => {
    if (!task) return;
    const trimmed = subscriberDraft.trim();
    if (!trimmed) return;
    const existing = task.subscribers ?? [];
    if (existing.some(s => s.toLowerCase() === trimmed.toLowerCase())) {
      setSubscriberDraft('');
      return;
    }
    onEdit(task.id, { subscribers: [...existing, trimmed] });
    setSubscriberDraft('');
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [task, subscriberDraft, onEdit]);

  const handleRemoveSubscriber = useCallback((subscriber: string) => {
    if (!task) return;
    const next = (task.subscribers ?? []).filter(s => s !== subscriber);
    onEdit(task.id, { subscribers: next });
  }, [task, onEdit]);
  // Look up dependencies by id so we can show a readable list. Use the
  // typed link array if present; fall back to the legacy string ids.
  const depRows = useMemo(() => {
    if (!task) return [] as { id: string; title: string; type: string; lag: number }[];
    const byId = new Map(allTasks.map(t => [t.id, t]));
    const out: { id: string; title: string; type: string; lag: number }[] = [];
    if (task.dependencyLinks && task.dependencyLinks.length > 0) {
      for (const link of task.dependencyLinks) {
        const pred = byId.get(link.taskId);
        if (!pred) continue;
        out.push({
          id: pred.id,
          title: pred.title || 'Untitled',
          type: link.type || 'FS',
          lag: link.lagDays ?? 0,
        });
      }
    } else if (task.dependencies) {
      for (const did of task.dependencies) {
        const pred = byId.get(did);
        if (!pred) continue;
        out.push({ id: pred.id, title: pred.title || 'Untitled', type: 'FS', lag: 0 });
      }
    }
    return out;
  }, [task, allTasks]);

  if (!task) return null;

  const cpmRow = cpm.perTask.get(task.id);
  const anchorPretty = task.anchorType && task.anchorType !== 'none'
    ? task.anchorType.replace(/-/g, ' ')
    : null;

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Info size={16} color={"#FF6A1A"} strokeWidth={1.75} />
        <Text style={styles.headerTitle} numberOfLines={1}>{task.title || 'Untitled task'}</Text>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close"><X size={18} color={"#9AA3AD"} strokeWidth={1.75} /></TouchableOpacity>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 32 }}>
        {/* Schedule block — raw CPM numbers. Makes the "why" of the bar
            position legible without the user having to open settings. */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Schedule</Text>
          <Row label="Early start"  value={cpmRow ? dayToDate(projectStartDate, cpmRow.es) : '—'} />
          <Row label="Early finish" value={cpmRow ? dayToDate(projectStartDate, cpmRow.ef) : '—'} />
          <Row label="Late start"   value={cpmRow ? dayToDate(projectStartDate, cpmRow.ls) : '—'} />
          <Row label="Late finish"  value={cpmRow ? dayToDate(projectStartDate, cpmRow.lf) : '—'} />
          <Row label="Total float"  value={cpmRow ? `${cpmRow.totalFloat}d` : '—'}
            valueColor={cpmRow?.isCritical ? "#C84038" : themeColors.text} />
          <Row label="Free float"   value={cpmRow ? `${cpmRow.freeFloat}d` : '—'} />
          <Row label="Duration"     value={`${task.durationDays ?? 0}d`} />
        </View>

        {/* Status picker — quick single-tap update without opening the grid. */}
        <View style={styles.section}>
          <View style={styles.sectionHeadRow}>
            <Flag size={12} color={"#9AA3AD"} strokeWidth={1.75} />
            <Text style={styles.sectionTitle}>Status</Text>
          </View>
          <View style={styles.statusRow}>
            {STATUS_OPTIONS.map(opt => {
              const active = (task.status ?? 'not_started') === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.statusChip, active && { backgroundColor: opt.color + '22', borderColor: opt.color }]}
                  onPress={() => onEdit(task.id, { status: opt.value })}
                  activeOpacity={0.7}
                >
                  <View style={[styles.statusDot, { backgroundColor: opt.color }]} />
                  <Text style={[styles.statusChipText, active && { color: opt.color, fontWeight: '700' }]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {/* Progress (%) as a segmented 0/25/50/75/100 chooser — covers the
              90% case without a slider widget. Fine-tuning still happens in
              the grid's Progress column. */}
          <Text style={[styles.subLabel, { marginTop: 10 }]}>Progress</Text>
          <View style={styles.progressRow}>
            {[0, 25, 50, 75, 100].map(p => {
              const active = (task.progress ?? 0) === p;
              return (
                <TouchableOpacity
                  key={p}
                  onPress={() => onEdit(task.id, { progress: p })}
                  style={[styles.progressChip, active && styles.progressChipActive]}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.progressChipText, active && styles.progressChipTextActive]}>{p}%</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Trade picker — lets users override the regex-inferred trade colour. */}
        <View style={styles.section}>
          <View style={styles.sectionHeadRow}>
            <Text style={styles.sectionTitle}>Trade</Text>
          </View>
          <TouchableOpacity
            style={styles.dropdownButton}
            onPress={() => setTradeDropdownOpen(true)}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Select trade"
          >
            <View style={[styles.dropdownDot, { backgroundColor: Colors.tradeColors[tradeKeyForTask(task)] }]} />
            <Text style={styles.dropdownText}>{tradeLabel(tradeKeyForTask(task))}</Text>
            <Text style={styles.dropdownChev}>{'▾'}</Text>
          </TouchableOpacity>
        </View>

        {/* Anchor summary — read-only here; the grid owns anchor editing. */}
        <View style={styles.section}>
          <View style={styles.sectionHeadRow}>
            <Anchor size={12} color={"#9AA3AD"} strokeWidth={1.75} />
            <Text style={styles.sectionTitle}>Anchor</Text>
          </View>
          {anchorPretty ? (
            <>
              <Row label="Type" value={anchorPretty} />
              <Row label="Date" value={task.anchorDate || '—'} />
            </>
          ) : (
            <Text style={styles.emptyText}>No anchor. CPM decides this task&apos;s dates.</Text>
          )}
        </View>

        {/* Dependencies list */}
        <View style={styles.section}>
          <View style={styles.sectionHeadRow}>
            <CalendarClock size={12} color={"#9AA3AD"} strokeWidth={1.75} />
            <Text style={styles.sectionTitle}>Predecessors</Text>
          </View>
          {depRows.length === 0 ? (
            <Text style={styles.emptyText}>No predecessors.</Text>
          ) : (
            depRows.map(d => (
              <View key={d.id} style={styles.depRow}>
                <Text style={styles.depTitle} numberOfLines={1}>{d.title}</Text>
                <Text style={styles.depMeta}>
                  {d.type}{d.lag !== 0 ? ` ${d.lag > 0 ? '+' : ''}${d.lag}d` : ''}
                </Text>
              </View>
            ))
          )}
        </View>

        {/* Crew / resources */}
        {(task.crew || (task.resourceIds && task.resourceIds.length > 0)) && (
          <View style={styles.section}>
            <View style={styles.sectionHeadRow}>
              <Users size={12} color={"#9AA3AD"} strokeWidth={1.75} />
              <Text style={styles.sectionTitle}>Crew</Text>
            </View>
            {task.crew && <Row label="Crew" value={task.crew} />}
          </View>
        )}

        {/* Notes */}
        {task.notes ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Notes</Text>
            <Text style={styles.notesText}>{task.notes}</Text>
          </View>
        ) : null}

        {/* Photos — camera + library, no upload (local URI). */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Camera size={12} color={"#9AA3AD"} strokeWidth={1.75} />
            <Text style={styles.sectionTitle}>Photos {task.photos && task.photos.length > 0 ? `(${task.photos.length})` : ''}</Text>
          </View>
          <View style={styles.photoGrid}>
            {(task.photos ?? []).map((p, i) => (
              <View key={`${p.uri}-${i}`} style={styles.photoTile}>
                <Image source={{ uri: p.uri }} style={styles.photoImg} contentFit="cover" />
                <TouchableOpacity
                  style={styles.photoRemove}
                  onPress={() => handleRemovePhoto(i)}
                  hitSlop={6} accessibilityRole="button" accessibilityLabel="Delete">
                  <Trash2 size={11} color="#FFF" strokeWidth={1.75} />
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity
              style={[styles.photoTile, styles.photoAdd]}
              onPress={() => handleAddPhoto(Platform.OS === 'web' ? 'library' : 'camera')}
              activeOpacity={0.85}
              testID="task-add-photo"
            >
              <Camera size={18} color={"#FF6A1A"} strokeWidth={1.75} />
              <Text style={styles.photoAddLabel}>{Platform.OS === 'web' ? 'Pick' : 'Snap'}</Text>
            </TouchableOpacity>
            {Platform.OS !== 'web' && (
              <TouchableOpacity
                style={[styles.photoTile, styles.photoAdd]}
                onPress={() => handleAddPhoto('library')}
                activeOpacity={0.85}
              >
                <Plus size={18} color={"#FF6A1A"} strokeWidth={1.75} />
                <Text style={styles.photoAddLabel}>Library</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Subscribers — opt-in per-task notifications. Silent by default
            (opposite of Buildertrend's email-everyone posture). */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Bell size={12} color={"#9AA3AD"} strokeWidth={1.75} />
            <Text style={styles.sectionTitle}>Notification list {task.subscribers && task.subscribers.length > 0 ? `(${task.subscribers.length})` : ''}</Text>
          </View>
          <Text style={styles.notesText}>
            Only people on this list get pinged when this task shifts. Add a sub by name, email, or phone — login not required.
          </Text>
          <View style={styles.subRow}>
            <TextInput
              value={subscriberDraft}
              onChangeText={setSubscriberDraft}
              placeholder="e.g. Volt Bros, joe@example.com"
              placeholderTextColor={"#9AA3AD"}
              style={styles.subInput}
              onSubmitEditing={handleAddSubscriber}
              returnKeyType="done"
            />
            <TouchableOpacity
              style={[styles.subAddBtn, !subscriberDraft.trim() && styles.subAddBtnDisabled]}
              onPress={handleAddSubscriber}
              disabled={!subscriberDraft.trim()}
              activeOpacity={0.85} accessibilityRole="button" accessibilityLabel="Add"><Plus size={14} color="#FFF" strokeWidth={1.75} /></TouchableOpacity>
          </View>
          {(task.subscribers ?? []).length > 0 && (
            <View style={styles.subList}>
              {(task.subscribers ?? []).map(s => (
                <View key={s} style={styles.subChip}>
                  <Text style={styles.subChipText} numberOfLines={1}>{s}</Text>
                  <TouchableOpacity
                    onPress={() => handleRemoveSubscriber(s)}
                    hitSlop={4} accessibilityRole="button" accessibilityLabel="Close">
                    <X size={11} color={"#9AA3AD"} strokeWidth={1.75} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Trade-picker modal sheet */}
      <Modal
        visible={tradeDropdownOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setTradeDropdownOpen(false)}
      >
        <View style={styles.dropdownOverlay}>
          <Pressable style={styles.dropdownBackdrop} onPress={() => setTradeDropdownOpen(false)} />
          <View style={styles.dropdownSheet}>
            <Text style={styles.dropdownSheetTitle}>Trade</Text>
            {TRADE_KEYS.map((k: TradeKey) => (
              <TouchableOpacity
                key={k}
                style={styles.tradeOpt}
                activeOpacity={0.7}
                onPress={() => {
                  onEdit(task.id, { tradeKey: k });
                  setTradeDropdownOpen(false);
                  if (Platform.OS !== 'web') void Haptics.selectionAsync();
                }}
              >
                <View style={[styles.tradeOptDot, { backgroundColor: Colors.tradeColors[k] }]} />
                <Text style={styles.tradeOptLabel}>{tradeLabel(k)}</Text>
                {tradeKeyForTask(task) === k && (
                  <Text style={styles.tradeOptCheck}>{'✓'}</Text>
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Row({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, valueColor ? { color: valueColor } : null]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  panel: {
    width: 340,
    backgroundColor: t.surface,
    borderLeftWidth: 1,
    borderLeftColor: t.line,
    ...(Platform.OS === 'web' ? ({
      boxShadow: '-4px 0 12px rgba(0,0,0,0.06)',
    } as any) : {
      shadowColor: '#000',
      shadowOpacity: 0.08,
      shadowRadius: 12,
      shadowOffset: { width: -2, height: 0 },
    }),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: t.line,
  },
  headerTitle: { flex: 1, fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text },
  closeBtn: { padding: 4 },
  body: { flex: 1 },
  section: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: t.line,
  },
  sectionHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700',
    color: t.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 3,
    gap: 10,
  },
  rowLabel: { fontSize: Type.caption1.fontSize, color: t.textSecondary, flex: 1 },
  rowValue: { fontSize: Type.caption1.fontSize, fontWeight: '600', color: t.text, maxWidth: 180, textAlign: 'right' },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Tokens.radius.xs,
    borderWidth: 1,
    borderColor: t.line,
    backgroundColor: t.surfaceAlt,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusChipText: { fontSize: Type.caption2.fontSize, fontWeight: '600', color: t.textSecondary },
  subLabel: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700',
    color: t.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  progressRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  progressChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Tokens.radius.xs,
    backgroundColor: t.surfaceAlt,
  },
  progressChipActive: { backgroundColor: t.accent },
  progressChipText: { fontSize: Type.caption2.fontSize, fontWeight: '600', color: t.textSecondary },
  progressChipTextActive: { color: '#fff' },
  emptyText: { fontSize: Type.caption1.fontSize, color: t.textMuted, fontStyle: 'italic' },
  depRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
    gap: 10,
  },
  depTitle: { fontSize: Type.caption1.fontSize, color: t.text, flex: 1 },
  depMeta: { fontSize: Type.caption2.fontSize, color: t.textSecondary, fontWeight: '600' },
  notesText: { fontSize: Type.caption1.fontSize, color: t.text, lineHeight: 18 },

  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },

  // Photo grid
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  photoTile: {
    width: 72, height: 72, borderRadius: Tokens.radius.md,
    overflow: 'hidden',
    backgroundColor: t.bg,
    borderWidth: 1, borderColor: t.line,
    position: 'relative',
  },
  photoImg: { width: '100%', height: '100%' },
  photoRemove: {
    position: 'absolute', top: 4, right: 4,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },
  photoAdd: {
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.accent + '0D',
    borderColor: t.accent + '30', borderStyle: 'dashed',
    gap: 4,
  },
  photoAddLabel: { fontSize: 10, fontWeight: '700', color: t.accent },

  // Subscribers
  subRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  subInput: {
    flex: 1,
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: Tokens.radius.sm,
    borderWidth: 1, borderColor: t.line,
    backgroundColor: t.bg,
    fontSize: Type.caption1.fontSize, color: t.text,
  },
  subAddBtn: {
    width: 36, height: 36, borderRadius: Tokens.radius.sm,
    backgroundColor: t.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  subAddBtnDisabled: { opacity: 0.4 },
  subList: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  subChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingLeft: 10, paddingRight: 6, paddingVertical: 5, borderRadius: Tokens.radius.full,
    backgroundColor: Colors.fillSecondary,
    borderWidth: 1, borderColor: t.line,
    maxWidth: 220,
  },
  subChipText: { fontSize: Type.caption2.fontSize, fontWeight: '600', color: t.text },

  // Trade picker
  dropdownButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  dropdownDot: { width: 10, height: 10, borderRadius: 5 },
  dropdownText: { flex: 1, color: Colors.text, fontSize: 13, fontWeight: '500' },
  dropdownChev: { color: Colors.textSecondary, fontSize: 14 },
  dropdownOverlay: { flex: 1, justifyContent: 'flex-end' },
  dropdownBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  dropdownSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    padding: 14,
    paddingBottom: 28,
    gap: 4,
  },
  dropdownSheetTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
  },
  tradeOpt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: 6,
  },
  tradeOptDot: { width: 12, height: 12, borderRadius: 6 },
  tradeOptLabel: { flex: 1, color: Colors.text, fontSize: 13 },
  tradeOptCheck: { color: Colors.primary, fontSize: 16, fontWeight: '700' },
});
