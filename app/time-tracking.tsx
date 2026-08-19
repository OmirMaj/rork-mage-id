import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated, Platform, Modal, Share, TextInput,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import * as Haptics from 'expo-haptics';
import {
  Clock, Play, Square, Users, ChevronDown,
  Coffee, X, TrendingUp, AlertTriangle, FileDown,
  Briefcase, Check, Bell, DollarSign,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import type { TimeEntry } from '@/types';
import { useTimeEntries, buildTimeEntriesCSV } from '@/hooks/useTimeEntries';
import { useLaborRates } from '@/hooks/useLaborRates';
import { computeLaborStats, normalizeTradeKey } from '@/utils/laborSamples';
import { parseLenientNumber } from '@/utils/formatters';
import { useProjects } from '@/contexts/ProjectContext';
import { useCrew } from '@/contexts/CrewContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';

function getElapsedHours(clockIn: string): string {
  const diff = Date.now() - new Date(clockIn).getTime();
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  return `${hours}h ${mins}m`;
}

/** Numeric elapsed hours (incl. fractional minutes) for threshold checks. */
function getElapsedHoursNum(clockIn: string, breakMinutes: number): number {
  const diffMs = Date.now() - new Date(clockIn).getTime() - breakMinutes * 60_000;
  return Math.max(0, diffMs / 3_600_000);
}

function LiveTimeCard({
  entry,
  onAction,
  alertThresholdHours,
}: {
  entry: TimeEntry;
  onAction: (entry: TimeEntry, action: string) => void;
  alertThresholdHours: number;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const scaleAnim = useRef(new Animated.Value(1)).current;
  // Foregrounds theme WITH the soft fills below — the old static dark-green /
  // dark-orange read at ~2.8:1 on the dark-theme soft chips.
  const statusColor = entry.status === 'clocked_in' ? themeColors.success : entry.status === 'break' ? themeColors.warningLabel : themeColors.textMuted;
  const statusBg = entry.status === 'clocked_in' ? themeColors.successSoft : entry.status === 'break' ? themeColors.warningSoft : themeColors.surfaceAlt;
  const statusLabel = entry.status === 'clocked_in' ? 'Working' : entry.status === 'break' ? 'On Break' : 'Clocked Out';
  // Tick every 30s so the threshold pill flips at most ~30s after the
  // worker actually crosses the line. Faster ticks just burn battery
  // without changing what the user sees.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (entry.status !== 'clocked_in') return;
    const t = setInterval(() => forceTick(n => n + 1), 30_000);
    return () => clearInterval(t);
  }, [entry.status]);
  const elapsedHrs = entry.status !== 'clocked_out'
    ? getElapsedHoursNum(entry.clockIn, entry.breakMinutes)
    : entry.totalHours;
  const overThreshold = elapsedHrs >= alertThresholdHours;
  // Yellow band 30 min before, red band once they hit / pass it.
  const approachingThreshold = !overThreshold && elapsedHrs >= alertThresholdHours - 0.5;

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
            <Clock size={14} color={overThreshold ? themeColors.dangerLabel : approachingThreshold ? themeColors.warningLabel : themeColors.accent} strokeWidth={1.75} />
            <Text style={[
              styles.liveCardTimerText,
              overThreshold && { color: themeColors.dangerLabel },
              approachingThreshold && { color: themeColors.warningLabel },
            ]}>
              {getElapsedHours(entry.clockIn)}
            </Text>
            {entry.notes ? (
              <>
                <Text style={styles.liveCardDot}>·</Text>
                <Text style={styles.liveCardNote} numberOfLines={1}>{entry.notes}</Text>
              </>
            ) : null}
          </View>
        )}

        {entry.status !== 'clocked_out' && (overThreshold || approachingThreshold) && (
          <View style={[
            styles.thresholdBanner,
            {
              backgroundColor: overThreshold ? themeColors.dangerSoft : themeColors.warningSoft,
              borderColor: overThreshold ? themeColors.dangerLabel + '40' : themeColors.warningLabel + '40',
            },
          ]}>
            <AlertTriangle size={13} color={overThreshold ? themeColors.dangerLabel : themeColors.warningLabel} strokeWidth={1.75} />
            <Text style={[styles.thresholdBannerText, { color: overThreshold ? themeColors.dangerLabel : themeColors.warningLabel }]}>
              {overThreshold
                ? `Past ${alertThresholdHours}h shift — consider clocking out`
                : `${(alertThresholdHours - elapsedHrs).toFixed(1)}h to ${alertThresholdHours}h shift`}
            </Text>
          </View>
        )}

        {entry.status !== 'clocked_out' && (
          <View style={styles.liveCardActions}>
            {entry.status === 'clocked_in' ? (
              <>
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: themeColors.warningSoft }]}
                  onPress={() => onAction(entry, 'break')}
                  activeOpacity={0.7}
                >
                  <Coffee size={14} color={themeColors.warningLabel} strokeWidth={1.75} />
                  <Text style={[styles.actionBtnText, { color: themeColors.warningLabel }]}>Break</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: themeColors.dangerSoft }]}
                  onPress={() => onAction(entry, 'clock_out')}
                  activeOpacity={0.7}
                >
                  <Square size={14} color={themeColors.dangerLabel} strokeWidth={1.75} />
                  <Text style={[styles.actionBtnText, { color: themeColors.dangerLabel }]}>Clock Out</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: themeColors.successSoft }]}
                onPress={() => onAction(entry, 'resume')}
                activeOpacity={0.7}
              >
                <Play size={14} color={themeColors.success} strokeWidth={1.75} />
                <Text style={[styles.actionBtnText, { color: themeColors.success }]}>Resume</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function TimeTrackingScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
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
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  // Deep-link param: project-detail links here with { projectId }. When it
  // matches a real project we default the clock-in picker to it so hours land
  // on the job the GC navigated from, not silently on projects[0].
  const { projectId: routeProjectId } = useLocalSearchParams<{ projectId?: string }>();
  // Real backend hook (created May 2026 to replace MOCK_TIME_ENTRIES).
  // Data is persisted to AsyncStorage immediately and synced to Supabase
  // `time_entries` table via the offline queue. Cross-device sync works
  // via the user_id RLS scope on the table.
  const {
    entries, liveEntries, historyEntries,
    clockIn: doClockIn, startBreak, resumeFromBreak, clockOut: doClockOut,
    shiftAlertHours, setShiftAlertHours,
  } = useTimeEntries();
  const [showAlertPicker, setShowAlertPicker] = useState(false);
  // Labor rates — the GC's loaded $/hr per trade (wages + burden). The one
  // input that turns clocked hours into cost-book samples (flywheel#56):
  // hours are measured, but no pay rate exists anywhere in the data model,
  // so the GC states theirs once here. Local-only, per-user
  // (mageid_labor_rates in LOCAL_USER_CACHE_KEYS).
  const { rates, setRates } = useLaborRates();
  const [showRatesModal, setShowRatesModal] = useState(false);
  const [rateDrafts, setRateDrafts] = useState<Record<string, string>>({});
  const { projects } = useProjects();
  // Real crew roster (contexts/CrewContext → AsyncStorage + Supabase
  // `crew_members`, RLS-scoped to the GC). Replaces the old CREW_MEMBERS
  // mock so clock-in only ever offers people the GC actually added.
  const { crewMembers, getCrewForProject } = useCrew();
  const [showClockInModal, setShowClockInModal] = useState(false);
  const [selectedTab, setSelectedTab] = useState<'live' | 'history'>('live');
  // Project selection for clock-in. Defaults to the first active project; the
  // GC can flip it via a picker before tapping a crew member. Pre-fix every
  // clock-in silently went to projects[0] regardless of where the worker
  // actually was, so the payroll CSV mis-allocated hours when the GC was
  // running multiple jobs.
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(routeProjectId ?? null);
  const [showProjectPicker, setShowProjectPicker] = useState(false);

  // Keep the selection consistent: when projects load, prefer the deep-linked
  // routeProjectId if it matches a real project, otherwise default to the
  // first one. If the user switches accounts (projects array changes identity)
  // and the previously-selected id is gone, fall back to the same order.
  useEffect(() => {
    if (projects.length === 0) {
      if (selectedProjectId !== null) setSelectedProjectId(null);
      return;
    }
    if (!selectedProjectId || !projects.some(p => p.id === selectedProjectId)) {
      const preferred = (routeProjectId && projects.some(p => p.id === routeProjectId))
        ? routeProjectId
        : projects[0].id;
      setSelectedProjectId(preferred);
    }
  }, [projects, selectedProjectId, routeProjectId]);

  const selectedProject = useMemo(
    () => projects.find(p => p.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

  // Roster for the clock-in modal, sourced from real crew. Crew assigned to
  // the selected project surface first; the rest of the GC's roster follows.
  // Deduped by id. Each entry carries a display trade string (first trade, or
  // "Crew" when none is set) so the modal never invents a specialty.
  const roster = useMemo(() => {
    const projectCrew = selectedProject ? getCrewForProject(selectedProject.id) : [];
    const seen = new Set<string>();
    const ordered = [...projectCrew, ...crewMembers].filter(m => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return m.status !== 'inactive';
    });
    return ordered.map(m => ({
      id: m.id,
      name: m.fullName || 'Crew member',
      trade: m.trades?.[0] ?? 'Crew',
    }));
  }, [selectedProject, getCrewForProject, crewMembers]);

  const availableRoster = useMemo(
    () => roster.filter(m => !liveEntries.some(e => e.workerId === m.id)),
    [roster, liveEntries],
  );

  const todayStats = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const todayEntries = entries.filter(e => e.date === today);
    const totalWorkers = new Set(todayEntries.map(e => e.workerId)).size;
    const totalHours = todayEntries.reduce((s, e) => s + e.totalHours, 0);
    const totalOT = todayEntries.reduce((s, e) => s + e.overtimeHours, 0);
    return { totalWorkers, totalHours, totalOT, liveCount: liveEntries.length };
  }, [entries, liveEntries]);

  // Honesty surface: how many finished shifts are actually feeding the cost
  // book, and which trades are stuck waiting on a rate.
  const laborStats = useMemo(() => computeLaborStats(entries, rates), [entries, rates]);

  // Trades the rates modal offers: everything seen in entries or on the
  // roster, plus anything already priced. Keyed by normalized trade; display
  // label keeps the first real casing encountered.
  const rateTrades = useMemo(() => {
    const byKey = new Map<string, string>();
    const offer = (raw: string | undefined) => {
      const key = normalizeTradeKey(raw);
      if (!byKey.has(key)) {
        byKey.set(key, key === 'general' ? 'General labor' : (raw ?? '').trim());
      }
    };
    entries.forEach(e => offer(e.trade));
    roster.forEach(m => offer(m.trade));
    Object.keys(rates).forEach(k => offer(k === 'general' ? undefined : k.charAt(0).toUpperCase() + k.slice(1)));
    return [...byKey.entries()]
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => (a.key === 'general' ? 1 : b.key === 'general' ? -1 : a.label.localeCompare(b.label)));
  }, [entries, roster, rates]);

  const openRatesModal = useCallback(() => {
    // Seed drafts from stored rates so the inputs show what's on file.
    const drafts: Record<string, string> = {};
    for (const t of rateTrades) {
      const r = rates[t.key];
      drafts[t.key] = Number.isFinite(r) && (r as number) > 0 ? String(r) : '';
    }
    setRateDrafts(drafts);
    setShowRatesModal(true);
  }, [rateTrades, rates]);

  const commitRateDrafts = useCallback(() => {
    // Persist every draft on close (iOS modals don't reliably blur inputs).
    // Lenient parse ("$34", "34.50") via the shared money-input helper;
    // blank or unparseable clears the rate — no silent garbage.
    // ONE batched setRates call, not a setRate-per-trade loop: per-key
    // mutations all read the same stale cache snapshot and race — only one
    // of a multi-trade edit would survive (lost-update bug).
    const batch: Record<string, number | null> = {};
    for (const [key, raw] of Object.entries(rateDrafts)) {
      const n = raw.trim() === '' ? null : parseLenientNumber(raw);
      batch[key] = n !== null && n > 0 ? n : null;
    }
    setRates(batch);
    setShowRatesModal(false);
  }, [rateDrafts, setRates]);

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
      showAlert('Clocked Out', `${entry.workerName} clocked out.`);
    }
  }, [startBreak, resumeFromBreak, doClockOut]);

  const handleClockIn = useCallback((memberId: string) => {
    const member = roster.find(m => m.id === memberId);
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
  }, [doClockIn, selectedProject, roster]);

  // Payroll CSV export. Drops everything in `entries` into the standard
  // QuickBooks/Sage-friendly column shape and shares via native Share
  // sheet on mobile / clipboard on web.
  const handleExportCSV = useCallback(async () => {
    if (entries.length === 0) {
      showAlert('No entries', 'Clock in some crew before exporting.');
      return;
    }
    const csv = buildTimeEntriesCSV(entries);
    if (Platform.OS === 'web') {
      try {
        // expo-clipboard is async on web (uses navigator.clipboard.writeText
        // under the hood) and avoids the deprecated react-native Clipboard
        // module that the previous implementation pulled in.
        await Clipboard.setStringAsync(csv);
        showAlert('Copied', `${entries.length} entries copied as CSV. Paste into Excel / QuickBooks / Sage.`);
      } catch {
        showAlert('Export failed', 'Could not copy CSV to clipboard.');
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
      <Stack.Screen options={{ title: 'Time Tracking', headerStyle: { backgroundColor: themeColors.bg }, headerTintColor: themeColors.accent, headerTitleStyle: { fontWeight: '700' as const, color: themeColors.text } }} />
      <ScrollView {...fabScroll} contentContainerStyle={{ paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }} showsVerticalScrollIndicator={false}>
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: themeColors.accent + '14' }]}>
              <Users size={16} color={themeColors.accent} strokeWidth={1.75} />
            </View>
            <Text style={styles.statValue}>{todayStats.liveCount}</Text>
            <Text style={styles.statLabel}>On Site</Text>
          </View>
          <View style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: themeColors.info + '14' }]}>
              <Clock size={16} color={themeColors.info} strokeWidth={1.75} />
            </View>
            <Text style={styles.statValue}>{todayStats.totalHours.toFixed(1)}</Text>
            <Text style={styles.statLabel}>Hours Today</Text>
          </View>
          <View style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: todayStats.totalOT > 0 ? themeColors.warningSoft : themeColors.successSoft }]}>
              {todayStats.totalOT > 0 ? <AlertTriangle size={16} color={themeColors.warningLabel} strokeWidth={1.75} /> : <TrendingUp size={16} color={themeColors.success} strokeWidth={1.75} />}
            </View>
            <Text style={[styles.statValue, todayStats.totalOT > 0 && { color: themeColors.warningLabel }]}>{todayStats.totalOT.toFixed(1)}</Text>
            <Text style={styles.statLabel}>OT Hours</Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: 10, marginHorizontal: 16, marginVertical: 12 }}>
          <TouchableOpacity
            style={[styles.clockInButton, { flex: 1, marginHorizontal: 0, marginVertical: 0 }]}
            onPress={() => setShowClockInModal(true)}
            activeOpacity={0.85}
          >
            <Play size={18} color="#fff" strokeWidth={1.75} />
            <Text style={styles.clockInButtonText}>Clock In Crew</Text>
          </TouchableOpacity>
          {/* Payroll-friendly CSV export — drop into QuickBooks / Sage /
              Foundation. Pre-audit (May 2026) the screen had no export
              path and the data was mock-only anyway. Real now. */}
          <TouchableOpacity
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
              paddingVertical: 14, paddingHorizontal: 16,
              backgroundColor: Colors.card, borderWidth: 1, borderColor: themeColors.line,
              borderRadius: Tokens.radius.md,
            }}
            onPress={handleExportCSV}
            activeOpacity={0.85}
            testID="time-tracking-export"
          >
            <FileDown size={16} color={themeColors.text} strokeWidth={1.75} />
            <Text style={{ fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: themeColors.text }}>Export CSV</Text>
          </TouchableOpacity>
        </View>

        {/* Shift-end alert setting. A local push notification fires on the
            device that clocked the crew member in once they cross this
            threshold. Default 8h; user-configurable. Active workers also
            get an inline yellow/red banner on their card as they approach
            and then pass it (see LiveTimeCard). */}
        <View style={styles.pillRow}>
          <TouchableOpacity
            style={styles.alertSettingRow}
            onPress={() => setShowAlertPicker(true)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Shift alert at ${shiftAlertHours} hours, tap to change`}
            testID="time-tracking-alert-setting"
          >
            <Bell size={14} color={themeColors.accent} strokeWidth={1.75} />
            <Text style={styles.alertSettingText}>
              Alert at <Text style={styles.alertSettingHours}>{shiftAlertHours}h</Text>
            </Text>
          </TouchableOpacity>
          {/* Loaded $/hr per trade — the input that turns these hours into
              cost-book samples. Without it the book gets nothing (we never
              substitute market averages for your payroll). */}
          <TouchableOpacity
            style={styles.alertSettingRow}
            onPress={openRatesModal}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Set labor rates"
            testID="time-tracking-labor-rates"
          >
            <DollarSign size={14} color={themeColors.accent} strokeWidth={1.75} />
            <Text style={styles.alertSettingText}>Labor rates</Text>
          </TouchableOpacity>
        </View>

        {/* Honesty line — what this data actually feeds. Only rendered when
            there is something true to say. */}
        {laborStats.sampledEntries > 0 ? (
          <Text style={styles.laborFeedLine} testID="labor-feed-line">
            Feeding your labor rates: {laborStats.sampledEntries} entr{laborStats.sampledEntries === 1 ? 'y' : 'ies'} → your cost book
            {laborStats.tradesMissingRates.length > 0
              ? ` · ${laborStats.tradesMissingRates.length} trade${laborStats.tradesMissingRates.length === 1 ? '' : 's'} still unpriced`
              : ''}
          </Text>
        ) : laborStats.eligibleEntries > 0 ? (
          <Text style={styles.laborFeedLine} testID="labor-feed-line">
            {laborStats.eligibleEntries} finished shift{laborStats.eligibleEntries === 1 ? '' : 's'} logged — set labor rates to feed your cost book
          </Text>
        ) : null}

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
              <Clock size={32} color={themeColors.textMuted} strokeWidth={1.75} />
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
                <LiveTimeCard key={entry.id} entry={entry} onAction={handleAction} alertThresholdHours={shiftAlertHours} />
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
                <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
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
                  <Briefcase size={16} color={themeColors.accent} strokeWidth={1.75} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.projectPickerLabel}>Project</Text>
                  <Text style={styles.projectPickerValue} numberOfLines={1}>
                    {selectedProject?.name ?? 'Unassigned'}
                  </Text>
                </View>
                <ChevronDown
                  size={16}
                  color={themeColors.textMuted}
                  style={{ transform: [{ rotate: showProjectPicker ? '180deg' : '0deg' }] }} strokeWidth={1.75}
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
                        {active ? <Check size={16} color={themeColors.accent} strokeWidth={1.75} /> : null}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            ) : null}

            <ScrollView style={{ maxHeight: 400 }}>
              {availableRoster.map(member => (
                <TouchableOpacity
                  key={member.id}
                  style={styles.memberRow}
                  onPress={() => handleClockIn(member.id)}
                  activeOpacity={0.7}
                  testID={`clock-in-member-${member.id}`}
                >
                  <View style={styles.memberAvatar}>
                    <Text style={styles.memberAvatarText}>{member.name.charAt(0)}</Text>
                  </View>
                  <View style={styles.memberInfo}>
                    <Text style={styles.memberName}>{member.name}</Text>
                    <Text style={styles.memberTrade}>{member.trade}</Text>
                  </View>
                  <Play size={16} color={themeColors.accent} strokeWidth={1.75} />
                </TouchableOpacity>
              ))}
              {/* Truthful empty states — no fabricated roster. When the GC has
                  no crew on file, point them to where crew is actually added
                  rather than inventing names + pay rates. */}
              {roster.length === 0 ? (
                <View style={styles.rosterEmpty}>
                  <Users size={28} color={themeColors.textMuted} strokeWidth={1.75} />
                  <Text style={styles.rosterEmptyTitle}>No crew added yet</Text>
                  <Text style={styles.rosterEmptyBody}>
                    Add your crew in the Crew screen — verify IDs, set trades — then clock them in here.
                  </Text>
                  <TouchableOpacity
                    style={styles.rosterEmptyBtn}
                    onPress={() => { setShowClockInModal(false); router.push('/crew'); }}
                    activeOpacity={0.85}
                    testID="clock-in-add-crew"
                  >
                    <Text style={styles.rosterEmptyBtnText}>Add crew</Text>
                  </TouchableOpacity>
                </View>
              ) : availableRoster.length === 0 ? (
                <Text style={styles.allClockedIn}>All crew members are currently clocked in</Text>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Shift-alert threshold picker. Bottom-sheet style, same chrome as
          the other modals on this screen. Preset chips cover the common
          shift lengths; we deliberately don't expose minute-level granularity
          (a 7h-15m alert is overkill — the daily decision is whole hours). */}
      <Modal visible={showAlertPicker} transparent animationType="slide" onRequestClose={() => setShowAlertPicker(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Shift alert</Text>
              <TouchableOpacity onPress={() => setShowAlertPicker(false)} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close">
                <X size={20} color={themeColors.text} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            <Text style={{ paddingTop: 6, fontSize: Type.footnote.fontSize, color: themeColors.textMuted, lineHeight: 18 }}>
              Push a notification to this device when an active crew member's elapsed time crosses this threshold. Break minutes are excluded.
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingVertical: 16 }}>
              {[4, 6, 8, 10, 12].map(h => {
                const isActive = h === shiftAlertHours;
                return (
                  <TouchableOpacity
                    key={h}
                    onPress={() => {
                      setShiftAlertHours(h);
                      if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
                      setShowAlertPicker(false);
                    }}
                    activeOpacity={0.8}
                    style={[
                      styles.alertPickerChip,
                      isActive && styles.alertPickerChipActive,
                    ]}
                    testID={`alert-hours-${h}`}
                  >
                    <Text style={[styles.alertPickerChipText, isActive && styles.alertPickerChipTextActive]}>{h}h</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>

      {/* Labor-rates editor. One loaded $/hr per trade — the GC's real
          payroll number (wages + burden), entered once. Blank = that
          trade's hours stay out of the cost book. */}
      <Modal visible={showRatesModal} transparent animationType="slide" onRequestClose={commitRateDrafts}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Labor rates</Text>
              <TouchableOpacity onPress={commitRateDrafts} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Save and close">
                <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            <Text style={{ paddingTop: 6, fontSize: Type.footnote.fontSize, color: themeColors.textMuted, lineHeight: 18 }}>
              Loaded cost per hour — wages plus burden — for each trade you self-perform.
              Clocked hours × these rates feed your cost book, so estimates price labor
              from your real numbers. Leave blank to keep a trade out.
            </Text>
            <ScrollView style={{ maxHeight: 380, marginTop: 12 }}>
              {rateTrades.map(t => (
                <View key={t.key} style={styles.rateRow}>
                  <Text style={styles.rateTradeLabel} numberOfLines={1}>{t.label}</Text>
                  <View style={styles.rateInputWrap}>
                    <Text style={styles.rateInputPrefix}>$</Text>
                    <TextInput
                      style={styles.rateInput}
                      value={rateDrafts[t.key] ?? ''}
                      onChangeText={(v) => setRateDrafts(prev => ({ ...prev, [t.key]: v }))}
                      keyboardType="decimal-pad"
                      placeholder="—"
                      placeholderTextColor={themeColors.textMuted}
                      testID={`labor-rate-input-${t.key}`}
                    />
                    <Text style={styles.rateInputSuffix}>/hr</Text>
                  </View>
                </View>
              ))}
              {rateTrades.length === 0 ? (
                <Text style={styles.allClockedIn}>Clock in crew (or add trades to your roster) and their trades appear here.</Text>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 10,
    paddingTop: 16,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: t.surface,
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
  statValue: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: t.text, letterSpacing: -0.3 },
  statLabel: { fontSize: Type.caption2.fontSize, color: t.textSecondary, marginTop: 2 },
  clockInButton: {
    marginHorizontal: 16,
    backgroundColor: t.accentFill,
    borderRadius: Tokens.radius.lg,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 20,
    shadowColor: t.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 4,
  },
  clockInButtonText: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: '#fff' },
  tabRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    backgroundColor: t.surfaceAlt,
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
  tabActive: { backgroundColor: t.surface },
  tabText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: t.textMuted },
  tabTextActive: { color: t.text },
  listSection: { paddingHorizontal: 16 },
  liveCard: {
    marginBottom: 10,
    borderRadius: Tokens.radius.lg,
    backgroundColor: t.surface,
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
  liveCardName: { fontSize: Type.callout.fontSize, fontWeight: '600' as const, color: t.text },
  liveStatusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Tokens.radius.sm },
  liveStatusText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const },
  liveCardMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveCardTrade: { fontSize: Type.footnote.fontSize, color: t.textSecondary, fontWeight: '500' as const },
  liveCardDot: { color: t.textMuted, fontSize: 10 },
  liveCardProject: { fontSize: Type.footnote.fontSize, color: t.textSecondary, flex: 1 },
  liveCardTimer: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveCardTimerText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: t.accent },
  liveCardNote: { fontSize: Type.caption1.fontSize, color: t.textMuted, flex: 1 },
  liveCardActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  // Inline yellow/red banner inside an active LiveTimeCard when the worker
  // is approaching or past the shift-alert threshold.
  thresholdBanner: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Tokens.radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 2,
  },
  thresholdBannerText: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '700' as const,
  },
  // Settings pills ("Alert at Xh", "Labor rates") between the Clock-In row
  // and the Live/History tabs.
  pillRow: {
    flexDirection: 'row' as const,
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  alertSettingRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: t.accent + '0E',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.accent + '24',
    borderRadius: Tokens.radius.md,
    alignSelf: 'flex-start' as const,
  },
  // Honesty line under the pills — what the logged hours actually feed.
  laborFeedLine: {
    marginHorizontal: 16,
    marginBottom: 12,
    fontSize: Type.caption1.fontSize,
    color: t.textMuted,
    lineHeight: 16,
  },
  // Labor-rates modal rows.
  rateRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: t.line,
    gap: 12,
  },
  rateTradeLabel: { flex: 1, fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: t.text },
  rateInputWrap: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 2,
    backgroundColor: t.surfaceAlt,
    borderRadius: Tokens.radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.line,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  rateInputPrefix: { fontSize: Type.bodyCompact.fontSize, color: t.textMuted, fontWeight: '600' as const },
  rateInput: {
    minWidth: 56,
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: t.text,
    paddingVertical: 0,
    textAlign: 'right' as const,
  },
  rateInputSuffix: { fontSize: Type.caption1.fontSize, color: t.textMuted, fontWeight: '600' as const },
  alertSettingText: { fontSize: Type.footnote.fontSize, color: t.text, fontWeight: '500' as const },
  alertSettingHours: { color: t.accent, fontWeight: '800' as const, letterSpacing: 0.1 },
  alertSettingMeta: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginLeft: 2 },
  // Threshold-picker chips inside the alert-picker modal.
  alertPickerChip: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: Tokens.radius.md,
    backgroundColor: t.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.line,
  },
  alertPickerChipActive: { backgroundColor: t.accentFill, borderColor: t.accent },
  alertPickerChipText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  alertPickerChipTextActive: { color: '#FFFFFF' },
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
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.lg,
    padding: 14,
    marginBottom: 8,
    gap: 4,
    borderWidth: 1,
    borderColor: t.line,
  },
  historyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  historyName: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: t.text },
  historyHours: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: t.text },
  historyMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  historyTrade: { fontSize: Type.footnote.fontSize, color: t.textSecondary },
  historyDot: { color: t.textMuted, fontSize: 10 },
  historyProject: { fontSize: Type.footnote.fontSize, color: t.textSecondary, flex: 1 },
  historyFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  historyDate: { fontSize: Type.caption1.fontSize, color: t.textMuted },
  otBadge: { backgroundColor: t.warningSoft, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.xs },
  otBadgeText: { fontSize: Type.caption2.fontSize, fontWeight: '600' as const, color: t.warningLabel },
  emptyState: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: 32, gap: 8 },
  emptyTitle: { fontSize: Type.body.fontSize, fontWeight: '600' as const, color: t.text },
  emptyDesc: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary, textAlign: 'center' as const, lineHeight: 20, maxWidth: 320 },
  emptyCtaBtn: { marginTop: 12, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: t.accentFill, borderRadius: Tokens.radius.md },
  emptyCtaText: { color: '#FFFFFF', fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const },
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: t.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  modalTitle: { fontSize: Type.title2.fontSize, fontWeight: '700' as const, color: t.text },
  closeBtn: { width: 32, height: 32, borderRadius: Tokens.radius.panel, backgroundColor: t.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  modalSubtitle: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary, marginBottom: 16 },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: t.line,
  },
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: t.accent + '18',
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarText: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: t.accent },
  memberInfo: { flex: 1, gap: 2 },
  memberName: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: t.text },
  memberTrade: { fontSize: Type.footnote.fontSize, color: t.textSecondary },
  allClockedIn: { textAlign: 'center' as const, color: t.textMuted, paddingVertical: 20, fontSize: Type.bodyCompact.fontSize },
  rosterEmpty: { alignItems: 'center' as const, paddingVertical: 28, paddingHorizontal: 16, gap: 8 },
  rosterEmptyTitle: { fontSize: Type.body.fontSize, fontWeight: '700' as const, color: t.text },
  rosterEmptyBody: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary, textAlign: 'center' as const, lineHeight: 20, maxWidth: 300 },
  rosterEmptyBtn: { marginTop: 8, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: t.accentFill, borderRadius: Tokens.radius.md },
  rosterEmptyBtnText: { color: '#FFFFFF', fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const },
  projectPickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: t.surfaceAlt,
    borderRadius: Tokens.radius.lg,
    marginBottom: 12,
  },
  projectPickerIcon: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.accent + '18',
  },
  projectPickerLabel: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '600' as const, letterSpacing: 0.4, textTransform: 'uppercase' as const },
  projectPickerValue: { fontSize: Type.subhead.fontSize, color: t.text, fontWeight: '600' as const, marginTop: 2 },
  projectListWrap: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.lg,
    borderWidth: 0.5,
    borderColor: t.line,
    marginBottom: 12,
  },
  projectListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: t.line,
  },
  projectListRowActive: { backgroundColor: t.accent + '10' },
  projectListRowText: { flex: 1, fontSize: Type.bodyCompact.fontSize, color: t.text },
  projectListRowTextActive: { color: t.accent, fontWeight: '600' as const },
});
