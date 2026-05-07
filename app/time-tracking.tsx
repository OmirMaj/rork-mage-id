import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated,
  Platform, Alert, Modal, Share,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Stack, useRouter } from 'expo-router';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  Clock, Play, Square, Users, ChevronDown,
  Coffee, X, TrendingUp, AlertTriangle, FileDown,
  Briefcase, Check,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { CREW_MEMBERS } from '@/mocks/timeTracking';
import type { TimeEntry } from '@/types';
import { useTimeEntries, buildTimeEntriesCSV } from '@/hooks/useTimeEntries';
import { useProjects } from '@/contexts/ProjectContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

function getElapsedHours(clockIn: string): string {
  const diff = Date.now() - new Date(clockIn).getTime();
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  return `${hours}h ${mins}m`;
}

function LiveTimeCard({ entry, onAction }: { entry: TimeEntry; onAction: (entry: TimeEntry, action: string) => void }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const statusColor = entry.status === 'clocked_in' ? '#2E7D32' : entry.status === 'break' ? '#E65100' : Colors.textMuted;
  const statusBg = entry.status === 'clocked_in' ? '#E8F5E9' : entry.status === 'break' ? '#FFF3E0' : '#F5F5F5';
  const statusLabel = entry.status === 'clocked_in' ? 'Working' : entry.status === 'break' ? 'On Break' : 'Clocked Out';

  return (
    <Animated.View style={[styles.liveCard, { transform: [{ scale: scaleAnim }] }]}>
      <TouchableOpacity
        onPressIn={() => Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start()}
        onPressOut={() => Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 50 }).start()}
        activeOpacity={1}
        style={styles.liveCardInner}
      >
        <View style={styles.liveCardHeader}>
          <View style={styles.liveCardNameRow}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={styles.liveCardName}>{entry.workerName}</Text>
          </View>
          <View style={[styles.liveStatusBadge, { backgroundColor: statusBg }]}>
            <Text style={[styles.liveStatusText, { color: statusColor }]}>{statusLabel}</Text>
          </View>
        </View>

        <View style={styles.liveCardMeta}>
          <Text style={styles.liveCardTrade}>{entry.trade}</Text>
          <Text style={styles.liveCardDot}>·</Text>
          <Text style={styles.liveCardProject} numberOfLines={1}>{entry.projectName}</Text>
        </View>

        {entry.status !== 'clocked_out' && (
          <View style={styles.liveCardTimer}>
            <Clock size={14} color={Colors.primary} />
            <Text style={styles.liveCardTimerText}>{getElapsedHours(entry.clockIn)}</Text>
            {entry.notes ? (
              <>
                <Text style={styles.liveCardDot}>·</Text>
                <Text style={styles.liveCardNote} numberOfLines={1}>{entry.notes}</Text>
              </>
            ) : null}
          </View>
        )}

        {entry.status !== 'clocked_out' && (
          <View style={styles.liveCardActions}>
            {entry.status === 'clocked_in' ? (
              <>
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: Colors.warningLight }]}
                  onPress={() => onAction(entry, 'break')}
                  activeOpacity={0.7}
                >
                  <Coffee size={14} color={Colors.warningDark} />
                  <Text style={[styles.actionBtnText, { color: Colors.warningDark }]}>Break</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: Colors.errorLight }]}
                  onPress={() => onAction(entry, 'clock_out')}
                  activeOpacity={0.7}
                >
                  <Square size={14} color={Colors.errorDark} />
                  <Text style={[styles.actionBtnText, { color: Colors.errorDark }]}>Clock Out</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: Colors.successLight }]}
                onPress={() => onAction(entry, 'resume')}
                activeOpacity={0.7}
              >
                <Play size={14} color={Colors.successDark} />
                <Text style={[styles.actionBtnText, { color: Colors.successDark }]}>Resume</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function TimeTrackingScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  // Time Tracking is a Business-tier feature. We gate via the
  // 'subcontractor_management' FeatureKey since the same crew payroll
  // data is the foundation for both. (Earlier audit cleanup deleted the
  // standalone 'time_tracking' key; if we want a tighter, separate
  // FeatureKey for time tracking specifically, add it back here.)
  if (!canAccess('subcontractor_management')) {
    return (
      <Paywall
        visible={true}
        feature="Crew Time Tracking"
        requiredTier="business"
        onClose={() => router.back()}
      />
    );
  }
  return <TimeTrackingScreenInner />;
}

function TimeTrackingScreenInner() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // Real backend hook (created May 2026 to replace MOCK_TIME_ENTRIES).
  // Data is persisted to AsyncStorage immediately and synced to Supabase
  // `time_entries` table via the offline queue. Cross-device sync works
  // via the user_id RLS scope on the table.
  const {
    entries, liveEntries, historyEntries,
    clockIn: doClockIn, startBreak, resumeFromBreak, clockOut: doClockOut,
  } = useTimeEntries();
  const { projects } = useProjects();
  const [showClockInModal, setShowClockInModal] = useState(false);
  const [selectedTab, setSelectedTab] = useState<'live' | 'history'>('live');
  // Project selection for clock-in. Defaults to the first active project; the
  // GC can flip it via a picker before tapping a crew member. Pre-fix every
  // clock-in silently went to projects[0] regardless of where the worker
  // actually was, so the payroll CSV mis-allocated hours when the GC was
  // running multiple jobs.
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [showProjectPicker, setShowProjectPicker] = useState(false);

  // Keep the selection consistent: when projects load, default to the first
  // one. If the user switches accounts (projects array changes identity) and
  // the previously-selected id is gone, fall back to the new first.
  useEffect(() => {
    if (projects.length === 0) {
      if (selectedProjectId !== null) setSelectedProjectId(null);
      return;
    }
    if (!selectedProjectId || !projects.some(p => p.id === selectedProjectId)) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  const selectedProject = useMemo(
    () => projects.find(p => p.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

  const todayStats = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const todayEntries = entries.filter(e => e.date === today);
    const totalWorkers = new Set(todayEntries.map(e => e.workerId)).size;
    const totalHours = todayEntries.reduce((s, e) => s + e.totalHours, 0);
    const totalOT = todayEntries.reduce((s, e) => s + e.overtimeHours, 0);
    return { totalWorkers, totalHours, totalOT, liveCount: liveEntries.length };
  }, [entries, liveEntries]);

  // The break-start timestamp is now persisted on the row (`breakStartedAt`
  // — see hooks/useTimeEntries.ts). Pre-fix this lived in a useRef on the
  // screen, so backgrounding / force-quitting during a break wiped it and
  // resume always added zero minutes.
  const handleAction = useCallback((entry: TimeEntry, action: string) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (action === 'break') {
      startBreak(entry.id);
    } else if (action === 'resume') {
      // Hook reads breakStartedAt from the row to compute elapsed minutes.
      resumeFromBreak(entry.id);
    } else if (action === 'clock_out') {
      doClockOut(entry.id);
      // Brief confirmation. The hook computes totalHours/overtimeHours
      // server-side-compatible and updates the row.
      Alert.alert('Clocked Out', `${entry.workerName} clocked out.`);
    }
  }, [startBreak, resumeFromBreak, doClockOut]);

  const handleClockIn = useCallback((memberId: string) => {
    const member = CREW_MEMBERS.find(m => m.id === memberId);
    if (!member) return;

    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // Use the user-chosen project (defaults to projects[0] in the picker
    // effect above). Falls back to 'unassigned' only when no projects exist.
    doClockIn({
      projectId: selectedProject?.id ?? 'unassigned',
      projectName: selectedProject?.name ?? 'Unassigned',
      workerId: member.id,
      workerName: member.name,
      trade: member.trade,
    });

    setShowClockInModal(false);
  }, [doClockIn, selectedProject]);

  // Payroll CSV export. Drops everything in `entries` into the standard
  // QuickBooks/Sage-friendly column shape and shares via native Share
  // sheet on mobile / clipboard on web.
  const handleExportCSV = useCallback(async () => {
    if (entries.length === 0) {
      Alert.alert('No entries', 'Clock in some crew before exporting.');
      return;
    }
    const csv = buildTimeEntriesCSV(entries);
    if (Platform.OS === 'web') {
      try {
        // expo-clipboard is async on web (uses navigator.clipboard.writeText
        // under the hood) and avoids the deprecated react-native Clipboard
        // module that the previous implementation pulled in.
        await Clipboard.setStringAsync(csv);
        Alert.alert('Copied', `${entries.length} entries copied as CSV. Paste into Excel / QuickBooks / Sage.`);
      } catch {
        Alert.alert('Export failed', 'Could not copy CSV to clipboard.');
      }
      return;
    }
    try {
      await Share.share({
        title: `Time entries — ${new Date().toLocaleDateString()}`,
        message: csv,
      });
    } catch (err) {
      console.warn('[time-tracking] CSV share failed:', err);
    }
  }, [entries]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Time Tracking', headerStyle: { backgroundColor: Colors.background }, headerTintColor: Colors.primary, headerTitleStyle: { fontWeight: '700' as const, color: Colors.text } }} />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 30 }} showsVerticalScrollIndicator={false}>
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: Colors.primary + '14' }]}>
              <Users size={16} color={Colors.primary} />
            </View>
            <Text style={styles.statValue}>{todayStats.liveCount}</Text>
            <Text style={styles.statLabel}>On Site</Text>
          </View>
          <View style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: Colors.info + '14' }]}>
              <Clock size={16} color={Colors.info} />
            </View>
            <Text style={styles.statValue}>{todayStats.totalHours.toFixed(1)}</Text>
            <Text style={styles.statLabel}>Hours Today</Text>
          </View>
          <View style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: todayStats.totalOT > 0 ? '#FFF3E0' : Colors.success + '14' }]}>
              {todayStats.totalOT > 0 ? <AlertTriangle size={16} color={Colors.warningDark} /> : <TrendingUp size={16} color={Colors.success} />}
            </View>
            <Text style={[styles.statValue, todayStats.totalOT > 0 && { color: Colors.warningDark }]}>{todayStats.totalOT.toFixed(1)}</Text>
            <Text style={styles.statLabel}>OT Hours</Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: 10, marginHorizontal: 16, marginVertical: 12 }}>
          <TouchableOpacity
            style={[styles.clockInButton, { flex: 1, marginHorizontal: 0, marginVertical: 0 }]}
            onPress={() => setShowClockInModal(true)}
            activeOpacity={0.85}
          >
            <Play size={18} color="#fff" />
            <Text style={styles.clockInButtonText}>Clock In Crew</Text>
          </TouchableOpacity>
          {/* Payroll-friendly CSV export — drop into QuickBooks / Sage /
              Foundation. Pre-audit (May 2026) the screen had no export
              path and the data was mock-only anyway. Real now. */}
          <TouchableOpacity
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
              paddingVertical: 14, paddingHorizontal: 16,
              backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
              borderRadius: Tokens.radius.md,
            }}
            onPress={handleExportCSV}
            activeOpacity={0.85}
            testID="time-tracking-export"
          >
            <FileDown size={16} color={Colors.text} />
            <Text style={{ fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: Colors.text }}>Export CSV</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.tabRow}>
          <TouchableOpacity
            style={[styles.tab, selectedTab === 'live' && styles.tabActive]}
            onPress={() => setSelectedTab('live')}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabText, selectedTab === 'live' && styles.tabTextActive]}>
              Live ({liveEntries.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, selectedTab === 'history' && styles.tabActive]}
            onPress={() => setSelectedTab('history')}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabText, selectedTab === 'history' && styles.tabTextActive]}>
              History ({historyEntries.length})
            </Text>
          </TouchableOpacity>
        </View>

        {selectedTab === 'live' ? (
          liveEntries.length === 0 ? (
            <View style={styles.emptyState}>
              <Clock size={32} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>No active time cards</Text>
              <Text style={styles.emptyDesc}>
                Tap Clock In Crew above, pick a worker and project, and their hours start logging here in real time.
              </Text>
              {projects.length === 0 && (
                <TouchableOpacity
                  onPress={() => router.push('/(tabs)/(home)' as any)}
                  style={styles.emptyCtaBtn}
                  activeOpacity={0.85}
                >
                  <Text style={styles.emptyCtaText}>Open Projects</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <View style={styles.listSection}>
              {liveEntries.map(entry => (
                <LiveTimeCard key={entry.id} entry={entry} onAction={handleAction} />
              ))}
            </View>
          )
        ) : (
          <View style={styles.listSection}>
            {historyEntries.map(entry => (
              <View key={entry.id} style={styles.historyCard}>
                <View style={styles.historyHeader}>
                  <Text style={styles.historyName}>{entry.workerName}</Text>
                  <Text style={styles.historyHours}>{entry.totalHours.toFixed(1)}h</Text>
                </View>
                <View style={styles.historyMeta}>
                  <Text style={styles.historyTrade}>{entry.trade}</Text>
                  <Text style={styles.historyDot}>·</Text>
                  <Text style={styles.historyProject} numberOfLines={1}>{entry.projectName}</Text>
                </View>
                <View style={styles.historyFooter}>
                  <Text style={styles.historyDate}>
                    {new Date(entry.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                  </Text>
                  {entry.overtimeHours > 0 && (
                    <View style={styles.otBadge}>
                      <Text style={styles.otBadgeText}>+{entry.overtimeHours.toFixed(1)}h OT</Text>
                    </View>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <Modal visible={showClockInModal} transparent animationType="slide" onRequestClose={() => setShowClockInModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Clock In</Text>
              <TouchableOpacity onPress={() => setShowClockInModal(false)} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close">
                <X size={20} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>Select a crew member to clock in</Text>

            {/* Project picker — defaults to the GC's first project but lets
                them pick another job before clocking the worker in. Hidden
                when no projects exist (the worker gets bucketed to
                "Unassigned" — better than blocking clock-in entirely). */}
            {projects.length > 0 ? (
              <TouchableOpacity
                style={styles.projectPickerRow}
                onPress={() => setShowProjectPicker(v => !v)}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel="Choose project"
              >
                <View style={styles.projectPickerIcon}>
                  <Briefcase size={16} color={Colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.projectPickerLabel}>Project</Text>
                  <Text style={styles.projectPickerValue} numberOfLines={1}>
                    {selectedProject?.name ?? 'Unassigned'}
                  </Text>
                </View>
                <ChevronDown
                  size={16}
                  color={Colors.textMuted}
                  style={{ transform: [{ rotate: showProjectPicker ? '180deg' : '0deg' }] }}
                />
              </TouchableOpacity>
            ) : null}

            {showProjectPicker && projects.length > 0 ? (
              <View style={styles.projectListWrap}>
                <ScrollView style={{ maxHeight: 180 }}>
                  {projects.map(p => {
                    const active = p.id === selectedProjectId;
                    return (
                      <TouchableOpacity
                        key={p.id}
                        style={[styles.projectListRow, active && styles.projectListRowActive]}
                        onPress={() => {
                          setSelectedProjectId(p.id);
                          setShowProjectPicker(false);
                        }}
                        activeOpacity={0.75}
                      >
                        <Text style={[styles.projectListRowText, active && styles.projectListRowTextActive]} numberOfLines={1}>
                          {p.name}
                        </Text>
                        {active ? <Check size={16} color={Colors.primary} /> : null}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            ) : null}

            <ScrollView style={{ maxHeight: 400 }}>
              {CREW_MEMBERS.filter(m => !liveEntries.some(e => e.workerId === m.id)).map(member => (
                <TouchableOpacity
                  key={member.id}
                  style={styles.memberRow}
                  onPress={() => handleClockIn(member.id)}
                  activeOpacity={0.7}
                >
                  <View style={styles.memberAvatar}>
                    <Text style={styles.memberAvatarText}>{member.name.charAt(0)}</Text>
                  </View>
                  <View style={styles.memberInfo}>
                    <Text style={styles.memberName}>{member.name}</Text>
                    <Text style={styles.memberTrade}>{member.trade} · ${member.rate}/hr</Text>
                  </View>
                  <Play size={16} color={Colors.primary} />
                </TouchableOpacity>
              ))}
              {CREW_MEMBERS.filter(m => !liveEntries.some(e => e.workerId === m.id)).length === 0 && (
                <Text style={styles.allClockedIn}>All crew members are currently clocked in</Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 10,
    paddingTop: 16,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.lg,
    padding: 14,
    alignItems: 'flex-start',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  statIconWrap: { width: 32, height: 32, borderRadius: Tokens.radius.sm, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  statValue: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: Colors.text, letterSpacing: -0.3 },
  statLabel: { fontSize: Type.caption2.fontSize, color: Colors.textSecondary, marginTop: 2 },
  clockInButton: {
    marginHorizontal: 16,
    backgroundColor: Colors.primary,
    borderRadius: Tokens.radius.lg,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 20,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 4,
  },
  clockInButtonText: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: '#fff' },
  tabRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    backgroundColor: Colors.fillTertiary,
    borderRadius: Tokens.radius.card,
    padding: 3,
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: Tokens.radius.md,
  },
  tabActive: { backgroundColor: Colors.surface },
  tabText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: Colors.textMuted },
  tabTextActive: { color: Colors.text },
  listSection: { paddingHorizontal: 16 },
  liveCard: {
    marginBottom: 10,
    borderRadius: Tokens.radius.lg,
    backgroundColor: Colors.surface,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  liveCardInner: { padding: 14, gap: 8 },
  liveCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  liveCardNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  liveCardName: { fontSize: Type.callout.fontSize, fontWeight: '600' as const, color: Colors.text },
  liveStatusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Tokens.radius.sm },
  liveStatusText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const },
  liveCardMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveCardTrade: { fontSize: Type.footnote.fontSize, color: Colors.textSecondary, fontWeight: '500' as const },
  liveCardDot: { color: Colors.textMuted, fontSize: 10 },
  liveCardProject: { fontSize: Type.footnote.fontSize, color: Colors.textSecondary, flex: 1 },
  liveCardTimer: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveCardTimerText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: Colors.primary },
  liveCardNote: { fontSize: Type.caption1.fontSize, color: Colors.textMuted, flex: 1 },
  liveCardActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: Tokens.radius.md,
  },
  actionBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const },
  historyCard: {
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.lg,
    padding: 14,
    marginBottom: 8,
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  historyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  historyName: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: Colors.text },
  historyHours: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: Colors.text },
  historyMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  historyTrade: { fontSize: Type.footnote.fontSize, color: Colors.textSecondary },
  historyDot: { color: Colors.textMuted, fontSize: 10 },
  historyProject: { fontSize: Type.footnote.fontSize, color: Colors.textSecondary, flex: 1 },
  historyFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  historyDate: { fontSize: Type.caption1.fontSize, color: Colors.textMuted },
  otBadge: { backgroundColor: Colors.warningLight, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.xs },
  otBadgeText: { fontSize: Type.caption2.fontSize, fontWeight: '600' as const, color: Colors.warningDark },
  emptyState: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: 32, gap: 8 },
  emptyTitle: { fontSize: Type.body.fontSize, fontWeight: '600' as const, color: Colors.text },
  emptyDesc: { fontSize: Type.bodyCompact.fontSize, color: Colors.textSecondary, textAlign: 'center' as const, lineHeight: 20, maxWidth: 320 },
  emptyCtaBtn: { marginTop: 12, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: Colors.primary, borderRadius: Tokens.radius.md },
  emptyCtaText: { color: Colors.textOnPrimary, fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const },
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  modalTitle: { fontSize: Type.title2.fontSize, fontWeight: '700' as const, color: Colors.text },
  closeBtn: { width: 32, height: 32, borderRadius: Tokens.radius.panel, backgroundColor: Colors.fillTertiary, alignItems: 'center', justifyContent: 'center' },
  modalSubtitle: { fontSize: Type.bodyCompact.fontSize, color: Colors.textSecondary, marginBottom: 16 },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
  },
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primary + '18',
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarText: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: Colors.primary },
  memberInfo: { flex: 1, gap: 2 },
  memberName: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: Colors.text },
  memberTrade: { fontSize: Type.footnote.fontSize, color: Colors.textSecondary },
  allClockedIn: { textAlign: 'center' as const, color: Colors.textMuted, paddingVertical: 20, fontSize: Type.bodyCompact.fontSize },
  projectPickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: Colors.fillTertiary,
    borderRadius: Tokens.radius.lg,
    marginBottom: 12,
  },
  projectPickerIcon: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.primary + '18',
  },
  projectPickerLabel: { fontSize: Type.caption2.fontSize, color: Colors.textMuted, fontWeight: '600' as const, letterSpacing: 0.4, textTransform: 'uppercase' as const },
  projectPickerValue: { fontSize: Type.subhead.fontSize, color: Colors.text, fontWeight: '600' as const, marginTop: 2 },
  projectListWrap: {
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.lg,
    borderWidth: 0.5,
    borderColor: Colors.borderLight,
    marginBottom: 12,
  },
  projectListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
  },
  projectListRowActive: { backgroundColor: Colors.primary + '10' },
  projectListRowText: { flex: 1, fontSize: Type.bodyCompact.fontSize, color: Colors.text },
  projectListRowTextActive: { color: Colors.primary, fontWeight: '600' as const },
});
