// SubUpdatesPanel — GC-side view of every sub's daily updates against
// the master schedule. Sister to the SubDailyUpdateModal that the sub
// fills out from the shared URL. Reads from local AsyncStorage cache
// (via subScheduleUpdatesStorage); when the cloud sync layer lands,
// only that storage helper changes.
//
// Surfaces:
//   1. Header tile in schedule-pro that summarizes "N updates today, M
//      with blockers, X of Y subs reported in." Tap → opens detail.
//   2. Detail modal: chronological feed of updates with task name, sub,
//      progress, hours, blocker badge, photos. Tap a row → jumps to
//      the task in the inspector.

import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView, Image, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  Activity, X, AlertTriangle, Clock, Users, ChevronRight, MessageSquare,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { loadSubUpdates } from '@/utils/subScheduleUpdatesStorage';
import type { SubScheduleUpdate, ScheduleTask } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { todayCalendarDay } from '@/utils/calendarDate';

export interface SubUpdatesPanelProps {
  projectId: string;
  tasks: ScheduleTask[];
  /** Optional: tap a row → navigate to that task. */
  onJumpToTask?: (taskId: string) => void;
  /** Refresh trigger — pass any state value (e.g. updates count) to
   *  force a re-read of AsyncStorage when an update was just posted
   *  on the GC's device too. */
  refreshKey?: unknown;
}

function timeAgo(iso: string): string {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return '—';
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 86400 * 7) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function SubUpdatesPanelImpl({ projectId, tasks, onJumpToTask, refreshKey }: SubUpdatesPanelProps) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [updates, setUpdates] = useState<SubScheduleUpdate[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await loadSubUpdates(projectId);
      if (!cancelled) setUpdates(data);
    })();
    return () => { cancelled = true; };
  }, [projectId, refreshKey]);

  const taskById = useMemo(
    () => new Map(tasks.map(t => [t.id, t])),
    [tasks],
  );

  // Stats for the header tile.
  // UX-F11: local day, so the "today" filter no longer flips at 5 pm PDT.
  const todayISO = todayCalendarDay();
  const todayUpdates = updates.filter(u => u.forDate === todayISO);
  const blockerCount = updates.filter(u => u.blocker && u.blocker.trim().length > 0).length;
  const uniqueSubsToday = new Set(todayUpdates.map(u => u.subName.toLowerCase())).size;

  if (updates.length === 0) return null;

  return (
    <>
      <TouchableOpacity
        style={styles.tile}
        onPress={() => {
          if (Platform.OS !== 'web') void Haptics.selectionAsync();
          setOpen(true);
        }}
        activeOpacity={0.85}
        testID="sub-updates-tile"
      >
        <View style={styles.tileIcon}>
          <Activity size={14} color={themeColors.accent} strokeWidth={1.75} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.tileLabel}>Sub updates</Text>
          <Text style={styles.tileSub}>
            {todayUpdates.length} today
            {uniqueSubsToday > 0 ? ` from ${uniqueSubsToday} sub${uniqueSubsToday === 1 ? '' : 's'}` : ''}
            {blockerCount > 0 ? ` · ${blockerCount} blocker${blockerCount === 1 ? '' : 's'}` : ''}
          </Text>
        </View>
        {blockerCount > 0 && (
          <View style={styles.blockerBadge}>
            <AlertTriangle size={11} color={themeColors.danger} strokeWidth={1.75} />
            <Text style={styles.blockerBadgeText}>{blockerCount}</Text>
          </View>
        )}
        <ChevronRight size={14} color={themeColors.textMuted} strokeWidth={1.75} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + 12 }]}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Sub Schedule Collab</Text>
                <Text style={styles.modalSub}>
                  Daily updates posted by subs from the shared schedule link.
                </Text>
              </View>
              <TouchableOpacity onPress={() => setOpen(false)} hitSlop={8} style={styles.modalCloseBtn} accessibilityRole="button" accessibilityLabel="Close">
                <X size={18} color={themeColors.text} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>

            {/* Stats strip */}
            <View style={styles.statsRow}>
              <View style={styles.statCol}>
                <Text style={styles.statValue}>{updates.length}</Text>
                <Text style={styles.statLabel}>Total updates</Text>
              </View>
              <View style={styles.statCol}>
                <Text style={styles.statValue}>{todayUpdates.length}</Text>
                <Text style={styles.statLabel}>Today</Text>
              </View>
              <View style={styles.statCol}>
                <Text style={[styles.statValue, blockerCount > 0 && { color: themeColors.danger }]}>
                  {blockerCount}
                </Text>
                <Text style={styles.statLabel}>Blockers</Text>
              </View>
            </View>

            <ScrollView style={{ maxHeight: 480 }} showsVerticalScrollIndicator={false}>
              {updates.map(u => {
                const task = taskById.get(u.taskId);
                return (
                  <UpdateRow
                    key={u.id}
                    update={u}
                    task={task}
                    onJump={onJumpToTask ? () => {
                      setOpen(false);
                      setTimeout(() => onJumpToTask(u.taskId), 80);
                    } : undefined}
                  />
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

export const SubUpdatesPanel = memo(SubUpdatesPanelImpl);

function UpdateRow({
  update, task, onJump,
}: {
  update: SubScheduleUpdate;
  task?: ScheduleTask;
  onJump?: () => void;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const hasBlocker = !!update.blocker && update.blocker.trim().length > 0;
  return (
    <TouchableOpacity
      style={[styles.row, hasBlocker && styles.rowBlocker]}
      onPress={onJump}
      activeOpacity={onJump ? 0.85 : 1}
      disabled={!onJump}
    >
      <View style={styles.rowHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>{task?.title ?? '(deleted task)'}</Text>
          <Text style={styles.rowMeta}>
            {update.subName} · {timeAgo(update.postedAt)}
          </Text>
        </View>
        <View style={[styles.progressPill, hasBlocker && { backgroundColor: themeColors.danger + '14' }]}>
          <Text style={[styles.progressPillText, hasBlocker && { color: themeColors.danger }]}>
            {update.progressPercent}%
          </Text>
        </View>
      </View>

      <View style={styles.statRow}>
        {update.hoursWorked != null && (
          <View style={styles.statChip}>
            <Clock size={11} color={themeColors.textMuted} strokeWidth={1.75} />
            <Text style={styles.statChipText}>{update.hoursWorked} hr</Text>
          </View>
        )}
        {update.crewCount != null && (
          <View style={styles.statChip}>
            <Users size={11} color={themeColors.textMuted} strokeWidth={1.75} />
            <Text style={styles.statChipText}>{update.crewCount} crew</Text>
          </View>
        )}
        {update.photos && update.photos.length > 0 && (
          <View style={styles.statChip}>
            <Activity size={11} color={themeColors.textMuted} strokeWidth={1.75} />
            <Text style={styles.statChipText}>{update.photos.length} photo{update.photos.length === 1 ? '' : 's'}</Text>
          </View>
        )}
      </View>

      {hasBlocker && (
        <View style={styles.blockerCard}>
          <AlertTriangle size={12} color={themeColors.danger} strokeWidth={1.75} />
          <Text style={styles.blockerCardText}>{update.blocker}</Text>
        </View>
      )}

      {update.notes && update.notes.trim().length > 0 && (
        <View style={styles.notesRow}>
          <MessageSquare size={11} color={themeColors.textMuted} strokeWidth={1.75} />
          <Text style={styles.notesText}>{update.notes}</Text>
        </View>
      )}

      {update.photos && update.photos.length > 0 && (
        <View style={styles.photoRow}>
          {update.photos.slice(0, 4).map((p, i) => (
            <Image key={`${p.uri}-${i}`} source={{ uri: p.uri }} style={styles.photoThumb} resizeMode="cover" />
          ))}
        </View>
      )}
    </TouchableOpacity>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  tile: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, borderRadius: Tokens.radius.card,
    backgroundColor: Colors.card,
    borderWidth: 1, borderColor: t.line,
  },
  tileIcon: {
    width: 32, height: 32, borderRadius: 9,
    backgroundColor: t.accent + '14',
    alignItems: 'center', justifyContent: 'center',
  },
  tileLabel: { fontSize: Type.footnote.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.1 },
  tileSub: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: 2, lineHeight: 14 },
  blockerBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: Tokens.radius.full,
    backgroundColor: t.danger + '14',
    borderWidth: 1, borderColor: t.danger + '30',
  },
  blockerBadgeText: { fontSize: Type.caption2.fontSize, fontWeight: '800', color: t.danger },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: {
    maxHeight: '92%' as const,
    backgroundColor: t.bg,
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: 16, paddingTop: 10,
    gap: 12,
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: t.line, alignSelf: 'center', marginBottom: 4,
  },
  modalHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  modalTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.2 },
  modalSub: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 4, lineHeight: 17 },
  modalCloseBtn: {
    width: 32, height: 32, borderRadius: Tokens.radius.sm,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.card,
  },

  statsRow: {
    flexDirection: 'row', gap: 8,
    paddingVertical: 4,
  },
  statCol: {
    flex: 1, padding: 12, borderRadius: Tokens.radius.card,
    backgroundColor: Colors.card,
    borderWidth: 1, borderColor: t.line,
    alignItems: 'center',
  },
  statValue: { fontSize: Type.title2.fontSize, fontWeight: '900', color: t.text, letterSpacing: -0.5 },
  statLabel: { fontSize: 10, fontWeight: '700', color: t.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.5, marginTop: 2 },

  row: {
    backgroundColor: Colors.card, borderRadius: Tokens.radius.card, padding: 12,
    borderWidth: 1, borderColor: t.line,
    marginBottom: 8, gap: 8,
  },
  rowBlocker: { borderColor: t.danger + '40', borderLeftWidth: 4 },
  rowHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  rowTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text },
  rowMeta: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: 2 },
  progressPill: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: Tokens.radius.sm,
    backgroundColor: t.accent + '14',
  },
  progressPillText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '900', color: t.accent, letterSpacing: -0.2 },

  statRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  statChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: Tokens.radius.xs,
    backgroundColor: t.bg,
    borderWidth: 1, borderColor: t.line,
  },
  statChipText: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '600' },

  blockerCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    padding: 8, borderRadius: Tokens.radius.sm,
    backgroundColor: t.danger + '08',
    borderWidth: 1, borderColor: t.danger + '30',
  },
  blockerCardText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.text, lineHeight: 16, fontWeight: '600' },

  notesRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  notesText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.text, lineHeight: 16 },

  photoRow: { flexDirection: 'row', gap: 6 },
  photoThumb: { width: 56, height: 56, borderRadius: Tokens.radius.sm, backgroundColor: t.bg },
});
