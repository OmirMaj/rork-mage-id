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

import React, { memo, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView, Image, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  Activity, X, AlertTriangle, Clock, Users, ChevronRight, MessageSquare, CheckCircle2,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { loadSubUpdates, markSubUpdateApplied } from '@/utils/subScheduleUpdatesStorage';
import type { SubScheduleUpdate, ScheduleTask } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export interface SubUpdatesPanelProps {
  projectId: string;
  tasks: ScheduleTask[];
  /** Optional: tap a row → navigate to that task. */
  onJumpToTask?: (taskId: string) => void;
  /** Refresh trigger — pass any state value (e.g. updates count) to
   *  force a re-read of AsyncStorage when an update was just posted
   *  on the GC's device too. */
  refreshKey?: unknown;
  /**
   * Apply a sub's progress update to the underlying schedule task.
   * Pre-fix this didn't exist — the panel was advisory-only and the GC
   * had to dual-enter the percent on the master schedule. The parent
   * (schedule-pro) wires this to a `commit` that sets
   *   task.progress = update.progressPercent
   *   task.actualStartDay ??= dayNumberFor(update.forDate)
   * inside one undo-able batch.
   */
  onApplyUpdate?: (update: SubScheduleUpdate) => void;
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

function SubUpdatesPanelImpl({ projectId, tasks, onJumpToTask, refreshKey, onApplyUpdate }: SubUpdatesPanelProps) {
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
  const todayISO = new Date().toISOString().split('T')[0];
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
          <Activity size={14} color={Colors.primary} />
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
            <AlertTriangle size={11} color={Colors.error} />
            <Text style={styles.blockerBadgeText}>{blockerCount}</Text>
          </View>
        )}
        <ChevronRight size={14} color={Colors.textMuted} />
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
                <X size={18} color={Colors.text} />
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
                <Text style={[styles.statValue, blockerCount > 0 && { color: Colors.error }]}>
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
                    onApply={onApplyUpdate ? async () => {
                      // Optimistic: stamp local cache first so the row
                      // flips to "Applied" immediately, then call the
                      // parent's commit. If the parent throws / rolls
                      // back we'd need a finer signal — for now the
                      // commit is sync (zustand-style setState), so
                      // failures are unlikely.
                      onApplyUpdate(u);
                      const stampedAt = new Date().toISOString();
                      const next = await markSubUpdateApplied(projectId, u.id, stampedAt);
                      setUpdates(next);
                      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
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
  update, task, onJump, onApply,
}: {
  update: SubScheduleUpdate;
  task?: ScheduleTask;
  onJump?: () => void;
  onApply?: () => void;
}) {
  const hasBlocker = !!update.blocker && update.blocker.trim().length > 0;
  const isApplied = !!update.appliedAt;
  // Apply is offered when:
  //   - parent provided the handler (onApply)
  //   - the task still exists (taskById lookup succeeded)
  //   - the update isn't already applied
  //   - the sub's reported % is actually different from the task's
  //     current %  (otherwise applying is a no-op + confusing toast)
  const canApply = !!onApply && !!task && !isApplied && task.progress !== update.progressPercent;
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
            {isApplied ? ` · Applied ${timeAgo(update.appliedAt!)}` : ''}
          </Text>
        </View>
        <View style={[styles.progressPill, hasBlocker && { backgroundColor: Colors.error + '14' }]}>
          <Text style={[styles.progressPillText, hasBlocker && { color: Colors.error }]}>
            {update.progressPercent}%
          </Text>
        </View>
      </View>

      {/* Apply CTA — only visible when applying would actually change
          something on the underlying task. Already-applied updates show
          a static "Applied" chip instead. */}
      {(canApply || isApplied) && (
        <View style={styles.applyRow}>
          {isApplied ? (
            <View style={styles.appliedChip}>
              <CheckCircle2 size={12} color={Colors.success} />
              <Text style={styles.appliedChipText}>
                Applied · task at {update.progressPercent}%
              </Text>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.applyBtn}
              onPress={(e) => { e.stopPropagation(); onApply?.(); }}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`Apply ${update.progressPercent}% to task`}
              testID={`apply-sub-update-${update.id}`}
            >
              <CheckCircle2 size={12} color={Colors.textOnPrimary} />
              <Text style={styles.applyBtnText}>
                Apply {update.progressPercent}% to task
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <View style={styles.statRow}>
        {update.hoursWorked != null && (
          <View style={styles.statChip}>
            <Clock size={11} color={Colors.textMuted} />
            <Text style={styles.statChipText}>{update.hoursWorked} hr</Text>
          </View>
        )}
        {update.crewCount != null && (
          <View style={styles.statChip}>
            <Users size={11} color={Colors.textMuted} />
            <Text style={styles.statChipText}>{update.crewCount} crew</Text>
          </View>
        )}
        {update.photos && update.photos.length > 0 && (
          <View style={styles.statChip}>
            <Activity size={11} color={Colors.textMuted} />
            <Text style={styles.statChipText}>{update.photos.length} photo{update.photos.length === 1 ? '' : 's'}</Text>
          </View>
        )}
      </View>

      {hasBlocker && (
        <View style={styles.blockerCard}>
          <AlertTriangle size={12} color={Colors.error} />
          <Text style={styles.blockerCardText}>{update.blocker}</Text>
        </View>
      )}

      {update.notes && update.notes.trim().length > 0 && (
        <View style={styles.notesRow}>
          <MessageSquare size={11} color={Colors.textMuted} />
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

const styles = StyleSheet.create({
  tile: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: Tokens.spacing.sm, borderRadius: Tokens.radius.card,
    backgroundColor: Colors.card,
    borderWidth: 1, borderColor: Colors.border,
  },
  tileIcon: {
    width: 32, height: 32, borderRadius: 9,
    backgroundColor: Colors.primary + '14',
    alignItems: 'center', justifyContent: 'center',
  },
  tileLabel: { fontSize: Type.footnote.fontSize, fontWeight: '800', color: Colors.text, letterSpacing: -0.1 },
  tileSub: { fontSize: Type.caption2.fontSize, color: Colors.textMuted, marginTop: Tokens.spacing.hairline, lineHeight: 14 },
  blockerBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: Tokens.radius.full,
    backgroundColor: Colors.error + '14',
    borderWidth: 1, borderColor: Colors.error + '30',
  },
  blockerBadgeText: { fontSize: Type.caption2.fontSize, fontWeight: '800', color: Colors.error },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: {
    maxHeight: '92%' as const,
    backgroundColor: Colors.background,
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: Tokens.spacing.md, paddingTop: 10,
    gap: Tokens.spacing.sm,
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: Colors.border, alignSelf: 'center', marginBottom: Tokens.spacing.xxs,
  },
  modalHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  modalTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '800', color: Colors.text, letterSpacing: -0.2 },
  modalSub: { fontSize: Type.caption1.fontSize, color: Colors.textMuted, marginTop: Tokens.spacing.xxs, lineHeight: 17 },
  modalCloseBtn: {
    width: 32, height: 32, borderRadius: Tokens.radius.sm,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.card,
  },

  statsRow: {
    flexDirection: 'row', gap: Tokens.spacing.xs,
    paddingVertical: Tokens.spacing.xxs,
  },
  statCol: {
    flex: 1, padding: Tokens.spacing.sm, borderRadius: Tokens.radius.card,
    backgroundColor: Colors.card,
    borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center',
  },
  statValue: { fontSize: Type.title2.fontSize, fontWeight: '900', color: Colors.text, letterSpacing: -0.5 },
  statLabel: { fontSize: 10, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.5, marginTop: Tokens.spacing.hairline },

  row: {
    backgroundColor: Colors.card, borderRadius: Tokens.radius.card, padding: Tokens.spacing.sm,
    borderWidth: 1, borderColor: Colors.border,
    marginBottom: Tokens.spacing.xs, gap: Tokens.spacing.xs,
  },
  rowBlocker: { borderColor: Colors.error + '40', borderLeftWidth: 4 },
  rowHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  rowTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: Colors.text },
  rowMeta: { fontSize: Type.caption2.fontSize, color: Colors.textMuted, marginTop: Tokens.spacing.hairline },
  progressPill: {
    paddingHorizontal: 10, paddingVertical: Tokens.spacing.xxs, borderRadius: Tokens.radius.sm,
    backgroundColor: Colors.primary + '14',
  },
  progressPillText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '900', color: Colors.primary, letterSpacing: -0.2 },

  statRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  statChip: {
    flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xxs,
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: Tokens.radius.xs,
    backgroundColor: Colors.background,
    borderWidth: 1, borderColor: Colors.border,
  },
  statChipText: { fontSize: Type.caption2.fontSize, color: Colors.textMuted, fontWeight: '600' },

  blockerCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    padding: Tokens.spacing.xs, borderRadius: Tokens.radius.sm,
    backgroundColor: Colors.error + '08',
    borderWidth: 1, borderColor: Colors.error + '30',
  },
  blockerCardText: { flex: 1, fontSize: Type.caption1.fontSize, color: Colors.text, lineHeight: 16, fontWeight: '600' },

  notesRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  notesText: { flex: 1, fontSize: Type.caption1.fontSize, color: Colors.text, lineHeight: 16 },

  photoRow: { flexDirection: 'row', gap: 6 },
  photoThumb: { width: 56, height: 56, borderRadius: Tokens.radius.sm, backgroundColor: Colors.background },

  applyRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    marginTop: Tokens.spacing.xxs,
  },
  applyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Tokens.spacing.sm,
    paddingVertical: 7,
    borderRadius: Tokens.radius.sm,
    backgroundColor: Colors.primary,
  },
  applyBtnText: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '700',
    color: Colors.textOnPrimary,
  },
  appliedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Tokens.radius.sm,
    backgroundColor: Colors.success + '14',
    borderWidth: 1,
    borderColor: Colors.success + '30',
  },
  appliedChipText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700',
    color: Colors.success,
  },
});
