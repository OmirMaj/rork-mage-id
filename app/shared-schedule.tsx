// /shared-schedule?t=<token>&asSub=<name>
//
// Read-only viewer for a schedule snapshot shared via URL. The token is the
// base64-encoded payload — we decode it, run CPM for critical-path coloring,
// and render the InteractiveGantt in a locked mode (all edit handlers
// no-op). No backend needed.
//
// Sub-confirm mode (`?asSub=Foo+Plumbing`):
//   When that query param is present + the payload includes GC contact
//   info (v2 payload), we show a "Confirming as: Foo Plumbing" banner
//   plus per-task Confirm / Reschedule buttons. Tapping either opens a
//   pre-filled mailto/sms with a structured response — no login, no
//   account, no MAGE install required for the sub.
//
// This is the wedge: Buildertrend's sub portal forces a sub to register
// + log in to confirm a date. Subs ghost. Our path is one tap from a
// text message to a sent email.

import React, { useMemo, useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, useWindowDimensions, ScrollView,
  Linking, Platform, Modal, TextInput, Alert,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  Lock, ChevronLeft, CheckCircle2, CalendarClock, X, Mail, MessageSquare, AlertCircle,
  Activity,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import InteractiveGantt from '@/components/schedule/InteractiveGantt';
import { runCpm } from '@/utils/cpm';
import {
  decodeShareToken, tasksFromSharePayload,
  composeSubReply, buildMailtoUrl, buildSmsUrl,
  type SubConfirmAction,
  type SharedSchedulePayload,
} from '@/utils/scheduleOps';
import { addWorkingDays, formatShortDate } from '@/utils/scheduleEngine';
import { SubDailyUpdateModal } from '@/components/SubDailyUpdateModal';
import { appendSubUpdate, loadSubUpdates, rollupLatest } from '@/utils/subScheduleUpdatesStorage';
import { supabase } from '@/lib/supabase';
import type { ScheduleTask, SubScheduleUpdate } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export default function SharedScheduleScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // v2.4 (audit Item 6) — Accept either `t=` (inline base64, v2.3 P1
  // path) or `s=` (snapshot row-id, new fallback for oversize schedules).
  const { t, s, asSub } = useLocalSearchParams<{ t?: string; s?: string; asSub?: string }>();
  const { width } = useWindowDimensions();

  // Inline payload (synchronous decode) — null if t= is absent or invalid.
  const inlinePayload = useMemo(() => (t ? decodeShareToken(String(t)) : null), [t]);

  // Snapshot payload (async fetch via SECURITY DEFINER RPC) — fires on
  // mount when s= is present; sets snapshotPayload on success or
  // snapshotError on failure.
  const [snapshotPayload, setSnapshotPayload] = useState<SharedSchedulePayload | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  useEffect(() => {
    if (!s || inlinePayload) return; // inline wins when both are present
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.rpc('fetch_shared_schedule', {
        snapshot_id: String(s),
      });
      if (cancelled) return;
      if (error) { setSnapshotError(error.message); return; }
      if (!data) { setSnapshotError('Snapshot expired or not found'); return; }
      setSnapshotPayload(data as SharedSchedulePayload);
    })();
    return () => { cancelled = true; };
  }, [s, inlinePayload]);

  const payload = inlinePayload ?? snapshotPayload;
  const tasks = useMemo(() => payload ? tasksFromSharePayload(payload) : [], [payload]);
  const cpm = useMemo(() => runCpm(tasks), [tasks]);
  const projectStartDate = useMemo(
    () => payload ? new Date(payload.projectStartISO) : new Date(),
    [payload],
  );

  const subName = typeof asSub === 'string' && asSub.trim().length > 0
    ? asSub.trim() : null;

  const isSubMode = !!subName;
  const subTasks = useMemo(() => {
    if (!isSubMode) return [];
    const lower = subName!.toLowerCase();
    return tasks.filter(task =>
      (task.assignedSubName ?? '').toLowerCase() === lower
      || (task.crew ?? '').toLowerCase().includes(lower),
    );
  }, [tasks, subName, isSubMode]);

  // Reschedule modal state — sub taps "Need to reschedule" → opens a
  // small textarea so they can type a reason before the mailto opens.
  const [rescheduleTask, setRescheduleTask] = useState<ScheduleTask | null>(null);
  const [rescheduleReason, setRescheduleReason] = useState('');
  // Once a sub taps Confirm on a task we mark it locally so the UI
  // shows the "Sent" affordance — purely cosmetic, lives in memory.
  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(new Set());

  // Sub Schedule Collab — daily-update modal state. The sub picks a task
  // they're assigned to, taps "Log today's update", fills in progress +
  // hours + crew + notes + photos, we persist locally and open a mailto
  // to the GC. Latest update per task surfaces inline as a green chip.
  const [updateForTask, setUpdateForTask] = useState<ScheduleTask | null>(null);
  const [subUpdates, setSubUpdates] = useState<SubScheduleUpdate[]>([]);
  // Load any previously-cached updates for this project so the sub can
  // see "you logged 60% yesterday" inline. Only loads when v3+ payload
  // (has projectId) — older shares can't cross-reference.
  useEffect(() => {
    if (!payload?.projectId) return;
    let cancelled = false;
    (async () => {
      const data = await loadSubUpdates(payload.projectId!);
      if (!cancelled) setSubUpdates(data);
    })();
    return () => { cancelled = true; };
  }, [payload?.projectId]);
  const latestUpdates = useMemo(() => rollupLatest(subUpdates), [subUpdates]);

  // All hooks below must run unconditionally — placed BEFORE any
  // early return so React's render order stays stable across renders.
  // The if-payload-missing branch is the entire JSX leaf; we can't
  // early-return out of the hook list.

  const taskDateRange = useCallback((task: ScheduleTask): string => {
    const start = addWorkingDays(projectStartDate, task.startDay - 1, 5);
    const end = addWorkingDays(projectStartDate, task.startDay + task.durationDays - 2, 5);
    return `${formatShortDate(start)} → ${formatShortDate(end)}`;
  }, [projectStartDate]);

  const sendReply = useCallback(async (
    task: ScheduleTask,
    action: SubConfirmAction,
    reason?: string,
  ) => {
    if (!payload || !subName) return;
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const args = {
      action,
      projectName: payload.name,
      taskTitle: task.title,
      taskDateRange: taskDateRange(task),
      subName,
      gcName: payload.gc?.name,
      reason,
    };
    const mailto = buildMailtoUrl({ ...args, gcEmail: payload.gc?.email });
    const sms = buildSmsUrl({ ...args, gcPhone: payload.gc?.phone });

    // Prefer email when GC has one (longer body fits). Fall back to SMS.
    const url = payload.gc?.email ? mailto : (payload.gc?.phone ? sms : mailto);
    try {
      const can = await Linking.canOpenURL(url);
      if (can) {
        await Linking.openURL(url);
        if (action === 'confirm') {
          setConfirmedIds(prev => {
            const next = new Set(prev);
            next.add(task.id);
            return next;
          });
        }
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        // Composer not available — show the body the user can paste.
        const { subject, body } = composeSubReply(args);
        Alert.alert(
          'Couldn\'t open mail / SMS',
          `Copy this text into your messaging app:\n\nTo: ${payload.gc?.email ?? payload.gc?.phone ?? '(GC contact)'}\n\nSubject: ${subject}\n\n${body}`,
        );
      }
    } catch {
      const { subject, body } = composeSubReply(args);
      Alert.alert('Reply', `${subject}\n\n${body}`);
    }
  }, [payload, subName, taskDateRange]);

  const handleReschedule = useCallback((task: ScheduleTask) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setRescheduleTask(task);
    setRescheduleReason('');
  }, []);

  const submitReschedule = useCallback(() => {
    if (!rescheduleTask) return;
    void sendReply(rescheduleTask, 'reschedule', rescheduleReason || undefined);
    setRescheduleTask(null);
    setRescheduleReason('');
  }, [rescheduleTask, rescheduleReason, sendReply]);

  // Sub daily-update submit — persists locally and refreshes the inline
  // chip on the next render. The modal also opens a mailto/sms to the GC.
  const handleUpdateSubmit = useCallback(async (update: SubScheduleUpdate) => {
    if (!payload?.projectId) return;
    const next = await appendSubUpdate(payload.projectId, update);
    setSubUpdates(next);
  }, [payload?.projectId]);

  if (!payload) {
    // v2.4 (audit Item 6) — Distinguish "snapshot still loading" from
    // "snapshot failed / expired" so the user gets useful feedback.
    const stillLoading = !!s && !inlinePayload && !snapshotPayload && !snapshotError;
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top + 24 }]}>
        <Stack.Screen options={{ title: 'Schedule' }} />
        <Lock size={28} color={themeColors.textMuted} strokeWidth={1.75} />
        <Text style={styles.title}>
          {stillLoading ? 'Loading schedule…' : 'Invalid or expired link'}
        </Text>
        <Text style={styles.body}>
          {stillLoading
            ? 'Fetching the schedule snapshot from the server.'
            : (snapshotError ?? 'This schedule link could not be opened. Ask the sender for a fresh link.')}
        </Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={() => router.replace('/' as never)} activeOpacity={0.85}>
          <Text style={styles.primaryBtnText}>Home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const narrow = width < 900;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={6}>
          <ChevronLeft size={18} color={themeColors.accent} strokeWidth={1.75} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <View style={styles.titleWrap}>
          <Text style={styles.title} numberOfLines={1}>{payload.name}</Text>
          <Text style={styles.sub}>
            {isSubMode
              ? `${subTasks.length} task${subTasks.length === 1 ? '' : 's'} for you`
              : `Read-only · ${tasks.length} tasks · finish day ${cpm.projectFinish}`}
          </Text>
        </View>
        <View style={styles.lockBadge}>
          <Lock size={12} color={themeColors.textSecondary} strokeWidth={1.75} />
          <Text style={styles.lockBadgeText}>{isSubMode ? 'Sub' : 'Shared'}</Text>
        </View>
      </View>

      {/* Sub-mode banner — green, prominent, with confirm-everything CTA. */}
      {isSubMode && (
        <View style={styles.subBanner}>
          <View style={styles.subBannerIcon}>
            <CheckCircle2 size={16} color={themeColors.success} strokeWidth={1.75} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.subBannerTitle}>Confirming as: {subName}</Text>
            <Text style={styles.subBannerBody}>
              Tap a task to confirm or request a reschedule. The reply opens in your email or messaging app — no account needed.
            </Text>
          </View>
        </View>
      )}

      {/* Sub-mode list — tasks with confirm / reschedule buttons. */}
      {isSubMode ? (
        subTasks.length === 0 ? (
          <View style={[styles.body, styles.centered]}>
            <AlertCircle size={28} color={Colors.warning} strokeWidth={1.75} />
            <Text style={styles.title}>No tasks assigned to {subName}</Text>
            <Text style={styles.body}>
              The schedule was shared with you but no tasks are tagged for {subName}. Reach out to the GC if you think this is wrong.
            </Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.subList}>
            {subTasks.map((task, i) => {
              const range = taskDateRange(task);
              const confirmed = confirmedIds.has(task.id);
              return (
                <View key={task.id} style={styles.subRow}>
                  <View style={styles.subRowHead}>
                    <Text style={styles.subRowIdx}>{i + 1}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.subRowTitle}>{task.title}</Text>
                      <Text style={styles.subRowMeta}>
                        {task.phase} · {task.durationDays} day{task.durationDays === 1 ? '' : 's'}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.subRowDates}>
                    <CalendarClock size={14} color={themeColors.accent} strokeWidth={1.75} />
                    <Text style={styles.subRowDateText}>{range}</Text>
                  </View>
                  <View style={styles.subRowActions}>
                    {confirmed ? (
                      <View style={[styles.subBtn, styles.subBtnDone]}>
                        <CheckCircle2 size={14} color={themeColors.success} strokeWidth={1.75} />
                        <Text style={[styles.subBtnText, { color: themeColors.success }]}>Confirmation sent</Text>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={[styles.subBtn, styles.subBtnConfirm]}
                        onPress={() => sendReply(task, 'confirm')}
                        activeOpacity={0.85}
                        testID={`sub-confirm-${task.id}`}
                      >
                        <CheckCircle2 size={14} color="#FFF" strokeWidth={1.75} />
                        <Text style={[styles.subBtnText, { color: '#FFF' }]}>Confirm</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={[styles.subBtn, styles.subBtnReschedule]}
                      onPress={() => handleReschedule(task)}
                      activeOpacity={0.85}
                      testID={`sub-reschedule-${task.id}`}
                    >
                      <CalendarClock size={14} color={Colors.warning} strokeWidth={1.75} />
                      <Text style={[styles.subBtnText, { color: Colors.warning }]}>Reschedule</Text>
                    </TouchableOpacity>
                  </View>

                  {/* Sub Schedule Collab — daily-update affordance. Only
                      surfaces when the share payload includes projectId
                      (v3+) so older shares stay backwards-compatible. */}
                  {payload.projectId && (() => {
                    const last = latestUpdates.get(`${task.id}::${subName!.toLowerCase()}`);
                    return (
                      <View style={styles.subUpdateRow}>
                        {last && (
                          <View style={styles.subUpdateChip}>
                            <Activity size={11} color={themeColors.success} strokeWidth={1.75} />
                            <Text style={styles.subUpdateChipText}>
                              {last.progressPercent}% on {new Date(last.forDate).toLocaleDateString()}
                            </Text>
                          </View>
                        )}
                        <TouchableOpacity
                          style={[styles.subBtn, styles.subBtnUpdate, { flex: 1 }]}
                          onPress={() => setUpdateForTask(task)}
                          activeOpacity={0.85}
                          testID={`sub-log-${task.id}`}
                        >
                          <Activity size={14} color={themeColors.accent} strokeWidth={1.75} />
                          <Text style={[styles.subBtnText, { color: themeColors.accent }]}>
                            {last ? 'Update today\'s progress' : 'Log today\'s update'}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })()}
                </View>
              );
            })}

            <View style={styles.subFooter}>
              <Text style={styles.subFooterText}>
                Replies open in your default {payload.gc?.email ? 'mail' : 'messaging'} app, pre-filled to {payload.gc?.email ?? payload.gc?.phone ?? 'the GC'}. Edit before sending.
              </Text>
            </View>
          </ScrollView>
        )
      ) : narrow ? (
        // Default narrow view (non-sub mode) — list fallback for phones.
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.narrowIntro}>
            Open this link on a laptop or iPad to see the full Gantt chart.
          </Text>
          {tasks.map((task, i) => (
            <View key={task.id} style={styles.narrowRow}>
              <Text style={styles.narrowIdx}>{i + 1}.</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.narrowTitle}>{task.title}</Text>
                <Text style={styles.narrowMeta}>
                  {task.phase} · {task.durationDays}d · {taskDateRange(task)}
                </Text>
              </View>
            </View>
          ))}
        </ScrollView>
      ) : (
        <View style={styles.body}>
          <InteractiveGantt
            tasks={tasks}
            cpm={cpm}
            projectStartDate={projectStartDate}
            onEdit={() => { /* locked */ }}
          />
        </View>
      )}

      {/* Sub Schedule Collab — daily progress update modal */}
      {payload.projectId && subName && (
        <SubDailyUpdateModal
          visible={updateForTask != null}
          onClose={() => setUpdateForTask(null)}
          task={updateForTask}
          subName={subName}
          projectId={payload.projectId}
          projectName={payload.name}
          gcEmail={payload.gc?.email}
          gcPhone={payload.gc?.phone}
          gcName={payload.gc?.name}
          previousUpdate={updateForTask
            ? latestUpdates.get(`${updateForTask.id}::${subName.toLowerCase()}`)
            : undefined}
          onSubmit={handleUpdateSubmit}
        />
      )}

      {/* Reschedule reason modal — small, focused, single textarea. */}
      <Modal
        visible={!!rescheduleTask}
        transparent
        animationType="slide"
        onRequestClose={() => setRescheduleTask(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Why do you need to reschedule?</Text>
                <Text style={styles.modalSub}>
                  {rescheduleTask?.title} · {rescheduleTask ? taskDateRange(rescheduleTask) : ''}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setRescheduleTask(null)} hitSlop={8} style={styles.modalCloseBtn} accessibilityRole="button" accessibilityLabel="Close">
                <X size={18} color={themeColors.text} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            <TextInput
              value={rescheduleReason}
              onChangeText={setRescheduleReason}
              placeholder="Optional — material delay, crew conflict, weather…"
              placeholderTextColor={themeColors.textMuted}
              style={styles.modalInput}
              multiline
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnSecondary]}
                onPress={() => setRescheduleTask(null)}
              >
                <Text style={styles.modalBtnSecondaryText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnPrimary]}
                onPress={submitReschedule}
                activeOpacity={0.85}
              >
                {payload.gc?.email
                  ? <Mail size={14} color="#FFF" strokeWidth={1.75} />
                  : <MessageSquare size={14} color="#FFF" strokeWidth={1.75} />}
                <Text style={styles.modalBtnPrimaryText}>
                  Open {payload.gc?.email ? 'email' : 'message'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  centered: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: t.line,
    backgroundColor: t.surface,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  backText: { color: t.accent, fontSize: Type.bodyCompact.fontSize, fontWeight: '600' },
  titleWrap: { flex: 1, marginHorizontal: 8 },
  title: { fontSize: Type.subhead.fontSize, fontWeight: '700', color: t.text },
  sub: { fontSize: Type.caption2.fontSize, color: t.textSecondary, marginTop: 2 },
  lockBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: Tokens.radius.md,
    backgroundColor: Colors.fillSecondary,
  },
  lockBadgeText: { fontSize: 10, fontWeight: '700', color: t.textSecondary },
  body: { flex: 1, padding: 12 },
  primaryBtn: {
    backgroundColor: t.accent,
    paddingHorizontal: 20, paddingVertical: 12, borderRadius: Tokens.radius.md, marginTop: 12,
  },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
  narrowIntro: { fontSize: Type.footnote.fontSize, color: t.textSecondary, marginBottom: 16, fontStyle: 'italic' },
  narrowRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.line },
  narrowIdx: { fontSize: Type.caption1.fontSize, color: t.textMuted, width: 24, paddingTop: 2 },
  narrowTitle: { fontSize: Type.footnote.fontSize, fontWeight: '600', color: t.text },
  narrowMeta: { fontSize: Type.caption2.fontSize, color: t.textSecondary, marginTop: 2 },

  // Sub-mode banner
  subBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    margin: 12, padding: 14, borderRadius: Tokens.radius.lg,
    backgroundColor: t.success + '14',
    borderWidth: 1, borderColor: t.success + '30',
  },
  subBannerIcon: {
    width: 36, height: 36, borderRadius: Tokens.radius.md,
    backgroundColor: t.success + '20',
    alignItems: 'center', justifyContent: 'center',
  },
  subBannerTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.1 },
  subBannerBody: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 2, lineHeight: 16 },

  // Sub-mode task list
  subList: { padding: 12, gap: 10 },
  subRow: {
    backgroundColor: Colors.card, borderRadius: Tokens.radius.lg, padding: 14,
    borderWidth: 1, borderColor: t.line,
    gap: 10,
  },
  subRowHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  subRowIdx: {
    fontSize: Type.caption2.fontSize, fontWeight: '800', color: t.textMuted,
    width: 22, textAlign: 'center', paddingTop: 2,
    backgroundColor: Colors.fillSecondary, borderRadius: Tokens.radius.xs, height: 22,
    lineHeight: 22,
  },
  subRowTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text, lineHeight: 19 },
  subRowMeta: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: 2, letterSpacing: 0.3, textTransform: 'uppercase' as const, fontWeight: '700' },
  subRowDates: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: Tokens.radius.sm,
    backgroundColor: t.accent + '0D',
  },
  subRowDateText: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: t.accent },
  subRowActions: { flexDirection: 'row', gap: 8 },
  subBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 11, borderRadius: Tokens.radius.md,
    backgroundColor: t.bg,
    borderWidth: 1, borderColor: t.line,
  },
  subBtnConfirm: {
    backgroundColor: t.success,
    borderColor: t.success,
  },
  subBtnReschedule: {
    backgroundColor: Colors.warning + '14',
    borderColor: Colors.warning + '40',
  },
  subBtnDone: {
    backgroundColor: t.success + '14',
    borderColor: t.success + '40',
  },
  subBtnUpdate: {
    backgroundColor: t.accent + '0D',
    borderColor: t.accent + '40',
  },
  subBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700' },

  subUpdateRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4,
  },
  subUpdateChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 5, borderRadius: Tokens.radius.full,
    backgroundColor: t.success + '14',
    borderWidth: 1, borderColor: t.success + '30',
  },
  subUpdateChipText: { fontSize: Type.caption2.fontSize, color: t.success, fontWeight: '700' },

  subFooter: { padding: 14, alignItems: 'center' },
  subFooterText: { fontSize: Type.caption2.fontSize, color: t.textMuted, textAlign: 'center', lineHeight: 16, fontStyle: 'italic' },

  // Modal
  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: t.bg,
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    padding: 16, gap: 12,
  },
  modalHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  modalTitle: { fontSize: Type.callout.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.2 },
  modalSub: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 2 },
  modalCloseBtn: {
    width: 32, height: 32, borderRadius: Tokens.radius.sm,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.card,
  },
  modalInput: {
    minHeight: 80,
    padding: 12, borderRadius: Tokens.radius.md,
    backgroundColor: Colors.card,
    borderWidth: 1, borderColor: t.line,
    color: t.text, fontSize: Type.bodyCompact.fontSize, lineHeight: 20,
    textAlignVertical: 'top' as const,
  },
  modalActions: { flexDirection: 'row', gap: 10 },
  modalBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: Tokens.radius.md,
  },
  modalBtnSecondary: { backgroundColor: Colors.card, borderWidth: 1, borderColor: t.line },
  modalBtnSecondaryText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text },
  modalBtnPrimary: { backgroundColor: t.accent },
  modalBtnPrimaryText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: '#FFF' },
});
