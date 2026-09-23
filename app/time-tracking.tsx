import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated, Platform, Modal, TextInput, ActivityIndicator, RefreshControl} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
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
import type { Project, TimeEntry } from '@/types';
import {
  useTimeEntries, buildTimeEntriesCSV, computeShiftHours, timeEntryDay, mergeTimeEntriesMirror,
  costingTeamRows, teamLoggedByLabel, teamLoggedByName, type TeamTimeEntry,
} from '@/hooks/useTimeEntries';
import { rateDraftBatch, reseedUntouchedDrafts, seedRateDrafts, type RateDrafts } from '@/utils/laborRateDraft';
import { useLaborRates } from '@/hooks/useLaborRates';
import { deliverTextFile } from '@/utils/platformFile';
import {
  liveNetHours, formatHoursMinutes, breakMinutesAt, isMissedClockOut, defaultMissedOutMs, outTimeProblem,
  parseClockTime, outMsOnClockInDay, formatClockTime, isAdjustedEntry, punchedHours, payWeekRange,
  selectPayrollEntries, payrollFileName, payrollTitle, payrollBlockedReason, openShiftsNote, csvToTsv, isUuid,
  savedCrewLine, type PayrollRow,
} from '@/utils/timeClockPayroll';
import { computeLaborStats, normalizeTradeKey, normalizeOvertimeMultiplier, DEFAULT_OVERTIME_MULTIPLIER } from '@/utils/laborSamples';
import {
  computeOvertime, overtimeFor, describeOvertimeRule, weekdayShort, DAILY_OVERTIME_HOURS, type Weekday,
} from '@/utils/overtime';
import { useProjectAccess } from '@/hooks/useProjectAccess';
import { useProjectRoleState } from '@/hooks/useProjectRole';
import { resolveClockGate, type ClockGate } from '@/utils/collaboratorAccess';
import { looksLikeBareWage, burdenPercentLabel } from '@/utils/laborBurdenModel';
import { parseLenientNumber } from '@/utils/formatters';
import { formatCalendarDay, todayCalendarDay } from '@/utils/calendarDate';
import { useSafety } from '@/contexts/SafetyContext';
import { certFlagsForWorker, lapsedCertConfirmText, type CertFlag } from '@/utils/safety/crewCerts';
import { StatusPill } from '@/components/ui';
import { useProjects } from '@/contexts/ProjectContext';
import { useCrew, useProjectCrew, type ProjectCrewMember } from '@/contexts/CrewContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';
import { NATIVE_HEADER_TITLE_FACE } from '@/constants/navigation';

/** A shift on the Live list: his own clock-in, or (#63) one his foreman
 *  clocked on a job he OWNS — its one action the owner's close — or (#99) one
 *  someone else has on the clock on a job he holds a seat on: shown so he
 *  never clocks that worker in twice, with no action at all (readOnly).
 *  `loggedBy` is the tag ("Logged by …"); `loggedByName` the bare name for a
 *  sentence (#106). */
type LiveRow = { entry: TimeEntry; team: boolean; loggedBy?: string; loggedByName?: string; readOnly?: boolean };

/** "a teammate" → "A teammate" where the name starts a sentence (#106). An
 *  email stays as typed. */
function sentenceName(name: string): string {
  return name === 'a teammate' ? 'A teammate' : name;
}

function LiveTimeCard({
  entry,
  onAction,
  alertThresholdHours,
  missed,
  loggedBy,
  readOnly,
}: {
  entry: TimeEntry;
  onAction: (entry: TimeEntry, action: string) => void;
  alertThresholdHours: number;
  /** #66: an open shift from an earlier day, or past max(alert + 2, 14) h. */
  missed: boolean;
  /** #63: set on a team row — its only action is the owner's close. */
  loggedBy?: string;
  /** #99: someone else's shift on a job he does not own — shown, never acted on. */
  readOnly?: boolean;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const scaleAnim = useRef(new Animated.Value(1)).current;
  // Foregrounds theme WITH the soft fills below — the old static dark-green /
  // dark-orange read at ~2.8:1 on the dark-theme soft chips.
  const statusColor = missed ? themeColors.dangerLabel : entry.status === 'clocked_in' ? themeColors.success : entry.status === 'break' ? themeColors.warningLabel : themeColors.textMuted;
  const statusBg = missed ? themeColors.dangerSoft : entry.status === 'clocked_in' ? themeColors.successSoft : entry.status === 'break' ? themeColors.warningSoft : themeColors.surfaceAlt;
  const statusLabel = missed ? 'Missed clock-out' : entry.status === 'clocked_in' ? 'Working' : entry.status === 'break' ? 'On Break' : 'Clocked Out';
  // Tick every 30s so the threshold pill flips at most ~30s after the
  // worker actually crosses the line — and while on break too, since the
  // net timer holds still then while the clock runs (#152).
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (entry.status === 'clocked_out') return;
    const t = setInterval(() => forceTick(n => n + 1), 30_000);
    return () => clearInterval(t);
  }, [entry.status]);
  // NET hours (#152): finished breaks and the break in progress are off, so
  // the timer, the banner and the Clock Out confirm quote one number.
  const elapsedHrs = entry.status !== 'clocked_out'
    ? liveNetHours(entry, Date.now())
    : entry.totalHours;
  const overThreshold = !missed && elapsedHrs >= alertThresholdHours;
  // Yellow band 30 min before, red band once they hit / pass it.
  const approachingThreshold = !missed && !overThreshold && elapsedHrs >= alertThresholdHours - 0.5;

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
        {loggedBy ? <Text style={styles.loggedByTag} testID={`time-entry-logged-by-${entry.id}`}>{loggedBy}</Text> : null}
        {!isUuid(entry.projectId) ? (
          <Text style={styles.loggedByTag}>Not synced — clocked in with no job, so it stays on this phone.</Text>
        ) : null}

        {entry.status !== 'clocked_out' && (
          <View style={styles.liveCardTimer}>
            <Clock size={14} color={overThreshold || missed ? themeColors.dangerLabel : approachingThreshold ? themeColors.warningLabel : themeColors.accent} strokeWidth={1.75} />
            <Text style={[
              styles.liveCardTimerText,
              (overThreshold || missed) && { color: themeColors.dangerLabel },
              approachingThreshold && { color: themeColors.warningLabel },
            ]}>
              {missed
                ? `In ${formatClockTime(Date.parse(entry.clockIn))}, ${formatCalendarDay(timeEntryDay(entry), { weekday: 'short', month: 'short', day: 'numeric' })}`
                : formatHoursMinutes(elapsedHrs)}
            </Text>
            {entry.notes ? (
              <>
                <Text style={styles.liveCardDot}>·</Text>
                <Text style={styles.liveCardNote} numberOfLines={1}>{entry.notes}</Text>
              </>
            ) : null}
          </View>
        )}

        {missed ? (
          <View style={[styles.thresholdBanner, { backgroundColor: themeColors.dangerSoft, borderColor: themeColors.dangerLabel + '40' }]}>
            <AlertTriangle size={13} color={themeColors.dangerLabel} strokeWidth={1.75} />
            <Text style={[styles.thresholdBannerText, { color: themeColors.dangerLabel }]}>
              {readOnly
                ? 'Still on the clock from an earlier shift — whoever logged it has to enter when he left. Not counted On Site.'
                : 'Still on the clock from an earlier shift — enter the time he actually left. Not counted On Site.'}
            </Text>
          </View>
        ) : entry.status !== 'clocked_out' && (overThreshold || approachingThreshold) && (
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

        {entry.status !== 'clocked_out' && readOnly ? (
          // #99: not his record and not his job — only whoever logged it (or
          // the job's owner) can end it. Said, not a dead button.
          <Text style={styles.loggedByTag} testID={`time-entry-readonly-${entry.id}`}>
            On the clock on this job. Only the person who logged it, or the job&apos;s owner, can clock him out.
          </Text>
        ) : entry.status !== 'clocked_out' && (
          <View style={styles.liveCardActions}>
            {loggedBy || missed ? (
              // A team row (#63) has one action — the owner closing the shift,
              // through its own confirmed writer — and a missed clock-out (#66)
              // goes straight to "when did he leave?", not to Break.
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: themeColors.dangerSoft }]}
                onPress={() => onAction(entry, 'clock_out')}
                activeOpacity={0.7}
                accessibilityRole="button"
                testID={`time-entry-close-${entry.id}`}
              >
                <Square size={14} color={themeColors.dangerLabel} strokeWidth={1.75} />
                <Text style={[styles.actionBtnText, { color: themeColors.dangerLabel }]}>{missed ? 'Enter out time' : 'Clock out for him'}</Text>
              </TouchableOpacity>
            ) : entry.status === 'clocked_in' ? (
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
  const { projects, isLoading: projectsLoading } = useProjects();
  // Time Tracking is a Business-tier feature for the GC's own jobs — gated on
  // 'subcontractor_management', the key his crew payroll shares with the sub
  // book. An invited FIELD or EDITOR seat clocks the GC's crew in on the GC's
  // job on the GC's plan (#62, collaboratorAccess 'crew_time_tracking'), so
  // the Business wall only stands for someone with neither: no Business of
  // his own and no such seat on any job. The real per-job answer is decided
  // inside, against the selected project's role (clockGate).
  const ownTier = canAccess('subcontractor_management');
  const hasSeat = projects.some(p => p.myRole === 'field' || p.myRole === 'editor');
  // Until the projects load we cannot know whether he holds a seat — wait,
  // rather than flash the Business wall at a foreman who has one.
  if (!ownTier && !hasSeat && projectsLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: themeColors.bg }} testID="time-tracking-loading">
        <ActivityIndicator size="small" color={themeColors.accent} />
      </View>
    );
  }
  if (!ownTier && !hasSeat) {
    return (
      <Paywall
        visible={true}
        feature="Crew Time Tracking"
        requiredTier="business"
        onClose={() => router.back()}
      />
    );
  }
  return <TimeTrackingScreenInner ownTier={ownTier} />;
}

/** #155: why Clock In is off with no job — hours are always filed to one. */
const NO_JOB_REASON = 'Create a project first \u2014 hours are filed against a job.';

/** Can this viewer clock crew in on `p`, going by the role stamped on the
 *  project (the picker's fast answer — the selected job is then checked
 *  against the live role, clockGate). The reason is shown on a blocked row. */
function clockableReason(p: Project, ownTier: boolean): string | null {
  if (p.myRole === 'field' || p.myRole === 'editor') return null;
  if (p.myRole === 'viewer') return 'Clocking crew in on this job needs a field or editor seat. You have view access.';
  return ownTier ? null : 'Clocking crew in on your own jobs needs Business.';
}

function TimeTrackingScreenInner({ ownTier }: { ownTier: boolean }) {
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
  // #104: the unpriced-labor banners (Job Costing, Living Estimate) also pass
  // openRates=1 and the trade missing a rate, so the sheet opens on it.
  const { projectId: routeProjectId, openRates: routeOpenRates, rateTrade: routeRateTrade } =
    useLocalSearchParams<{ projectId?: string; openRates?: string; rateTrade?: string }>();
  // Real backend hook (created May 2026 to replace MOCK_TIME_ENTRIES).
  // Data is persisted to AsyncStorage immediately and synced to Supabase
  // `time_entries` table via the offline queue. Cross-device sync works
  // via the user_id RLS scope on the table.
  const {
    entries, teamEntries, liveEntries, historyEntries,
    clockIn: doClockIn, startBreak, resumeFromBreak, clockOut: doClockOut, closeTeamShift,
    updateEntry, deleteEntry,
    shiftAlertHours, setShiftAlertHours, refresh: refreshEntries, pulling, pullFailed,
  } = useTimeEntries();
  // The entries live in one app-wide store now (contexts/TimeEntriesContext),
  // which pulls from Supabase once per sign-in. Opening this screen asks for a
  // fresh pull, as mounting the old per-screen hook did, so a shift clocked
  // out on another device shows here.
  useEffect(() => { void refreshEntries(); }, [refreshEntries]);
  // One screen clock (#152 / #66): Hours Today counts the live net hours of
  // open shifts and a shift turns "Missed clock-out" as time passes, neither of
  // which a memo over the entries alone would notice between writes.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const [showAlertPicker, setShowAlertPicker] = useState(false);
  // Labor rates — the GC's loaded $/hr per trade (wages + burden). The one
  // input that turns clocked hours into cost-book samples (flywheel#56):
  // hours are measured, but no pay rate exists anywhere in the data model,
  // so the GC states theirs once here. They live on his ACCOUNT now, with
  // this device as a cache (#61, hooks/useLaborRates), so the web app and a
  // re-signed-in phone price the same hours. The same sheet sets how he pays
  // overtime: the multiplier (#153) and the rule (#65).
  const {
    rates, setRates, overtimeMultiplier, overtimeRule, setOvertimeSettings, overtimeIsDefault, ratesFromAccount,
    isLoading: ratesLoading,
  } = useLaborRates();
  const [showRatesModal, setShowRatesModal] = useState(false);
  // The fields, and (#101) what each was opened — or last re-seeded — with.
  // Closing writes only what moved away from the baseline (utils/
  // laborRateDraft). One state, so a re-seed moves both in one update.
  const [rateSheet, setRateSheet] = useState<{ drafts: RateDrafts; baseline: RateDrafts }>({ drafts: {}, baseline: {} });
  const rateDrafts = rateSheet.drafts;
  const rateBaseline = rateSheet.baseline;
  const setRateDraft = useCallback((key: string, value: string) => {
    setRateSheet(prev => ({ ...prev, drafts: { ...prev.drafts, [key]: value } }));
  }, []);
  const [otMultiplierDraft, setOtMultiplierDraft] = useState('');
  const [otDailyDraft, setOtDailyDraft] = useState(false);
  const [otWeekStartDraft, setOtWeekStartDraft] = useState<Weekday>(overtimeRule.weekStartsOn);
  const { projects: allProjects } = useProjects();
  // The jobs this viewer may clock crew in on (#62): his own when he has
  // Business, and any job where he holds a FIELD or EDITOR seat. A viewer
  // seat, or his own job without Business, is listed but blocked with the
  // reason (clockableReason) — never silently missing.
  const projects = useMemo(
    () => allProjects.filter(p => clockableReason(p, ownTier) === null),
    [allProjects, ownTier],
  );
  const blockedProjects = useMemo(
    () => allProjects
      .map(p => ({ p, reason: clockableReason(p, ownTier) }))
      .filter((x): x is { p: Project; reason: string } => x.reason !== null),
    [allProjects, ownTier],
  );
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
  // #155: no job he can clock crew onto means no clock-in — say which case.
  const clockInDisabledReason: string | null = allProjects.length === 0
    ? NO_JOB_REASON
    : projects.length === 0
      ? `None of your jobs lets you clock crew in here. ${blockedProjects[0]?.reason ?? ''}`.trim()
      : null;

  // ── Per-job gate (#62) ────────────────────────────────────────────────
  // The picker's list goes by the role stamped on each project; the job he
  // actually clocks onto is checked against the LIVE role (GATING CONTRACT):
  // a spinner only while the role is loading, a retry on a failed read, and
  // a stated reason — never a spinner — when there is no role at all (a
  // removed collaborator's cached job).
  const gateProjectId = selectedProject?.id;
  const roleState = useProjectRoleState(gateProjectId);
  const { role, canAccessOwnTier } = useProjectAccess(gateProjectId);
  // Offline-first (review): the live role read is network-only, so while it
  // is loading or has failed, the seat stamped on the project at load stands
  // in for it — and his OWN job never waits on it at all (resolveClockGate).
  const stampedRole = selectedProject?.myRole;
  const roleUnresolved = roleState.isLoading || roleState.isError;
  const effectiveRole = roleUnresolved ? (stampedRole ?? null) : role;
  const isSeat = effectiveRole === 'field' || effectiveRole === 'editor';
  const clockGate: ClockGate = useMemo(() => resolveClockGate({
    hasProject: !!selectedProject,
    stampedRole,
    ownTierAllows: canAccessOwnTier('subcontractor_management'),
    live: { role, isLoading: roleState.isLoading, isError: roleState.isError },
  }), [selectedProject, stampedRole, roleState.isLoading, roleState.isError, role, canAccessOwnTier]);

  // On a job where he holds a seat, the roster is the GC's crew assigned to
  // THAT job (CrewContext useProjectCrew — read-only, never merged into his
  // own list), and the cert chips are the GC's certificates for them. On his
  // own job it is his own roster, as before.
  // #100: the job's crew is saved on this phone for a clock-in with no
  // signal; once his role on the job RESOLVES to none (removed from it), the
  // saved copy of the GC's crew is deleted.
  const crewAccessRevoked = !!gateProjectId && !roleState.isLoading && !roleState.isError && !roleState.isPaused && role === null;
  const projectCrew = useProjectCrew(gateProjectId, isSeat, { revoked: crewAccessRevoked });

  // Roster for the clock-in modal, sourced from real crew. Crew assigned to
  // the selected project surface first; the rest of the GC's roster follows.
  // Deduped by id. Each entry carries a display trade string (first trade, or
  // "Crew" when none is set) so the modal never invents a specialty.
  const roster = useMemo(() => {
    const source: ProjectCrewMember[] = isSeat
      ? projectCrew.crew
      : [...(selectedProject ? getCrewForProject(selectedProject.id) : []), ...crewMembers];
    const seen = new Set<string>();
    const ordered = source.filter(m => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return m.status !== 'inactive';
    });
    return ordered.map(m => ({
      id: m.id,
      name: m.fullName || 'Crew member',
      trade: m.trades?.[0] ?? 'Crew',
    }));
  }, [isSeat, projectCrew.crew, selectedProject, getCrewForProject, crewMembers]);

  // Certification flags per roster member (audit round 2, safety #2). The
  // join is exact — the roster id IS the CrewMember.id a Certification's
  // workerId points at — so an "Expired: SST (Sep 12)" chip here is a fact,
  // not a name match. `today` is the LOCAL calendar day: a UTC day would call
  // a card expired on the evening of its last valid day. A seat reads the
  // GC's certificates for the job crew (his own list holds none of them).
  const { certifications: ownCertifications } = useSafety();
  const certifications = isSeat ? projectCrew.certifications : ownCertifications;
  const certFlagsByMember = useMemo(() => {
    const today = todayCalendarDay();
    const out: Record<string, CertFlag[]> = {};
    for (const m of roster) out[m.id] = certFlagsForWorker(certifications, m.id, today);
    return out;
  }, [roster, certifications]);

  // ── Crew clocked by others on HIS jobs (#63) ─────────────────────────
  // A foreman's clock-ins on the GC's own jobs used to be counted in Job
  // Costing and nowhere here — not in Live, not in History, not in the payroll
  // export. They are listed now, tagged "Logged by …", scoped exactly as
  // costing scopes them (costingTeamRows: OWNED projects only — an editor or
  // viewer seat on another contractor's job must never reach his payroll).
  // They stay a separate list: `entries` is what clockOut / updateEntry /
  // deleteEntry act on, and team rows are closed only by closeTeamShift.
  const ownedTeam = useMemo(() => costingTeamRows(teamEntries), [teamEntries]);
  // Which job the lists (and the export's default) show. Opened from a job —
  // Job Costing's crew drill, project-detail — it starts on that job, so the
  // shifts he tapped are the ones on screen.
  const [viewProjectId, setViewProjectId] = useState<string | null>(routeProjectId ?? null);
  const onView = useCallback((e: TimeEntry) => !viewProjectId || e.projectId === viewProjectId, [viewProjectId]);
  const viewProjectName = useMemo(
    () => (viewProjectId ? allProjects.find(p => p.id === viewProjectId)?.name ?? null : null),
    [viewProjectId, allProjects],
  );

  // #99: shifts someone else has on the clock on a job he holds a SEAT on
  // (the GC's own clock-ins, another foreman's) — the phone already holds
  // them (the team read covers field / editor / viewer seats). They are shown
  // in Live and counted On Site, read-only, so he can see the worker is
  // already on the clock; they never reach costing, the export, History or
  // closeTeamShift, which stay on ownedTeam.
  const seatTeamOpen = useMemo(
    () => teamEntries.filter(e => e.onOwnedProject !== true && e.status !== 'clocked_out' && !e.clockOut),
    [teamEntries],
  );
  const liveRows: LiveRow[] = useMemo(() => [
    ...liveEntries.map(e => ({ entry: e, team: false })),
    ...ownedTeam.filter(e => e.status !== 'clocked_out').map(e => ({
      entry: e as TimeEntry, team: true, loggedBy: teamLoggedByLabel(e), loggedByName: teamLoggedByName(e),
    })),
    ...seatTeamOpen.map(e => ({
      entry: e as TimeEntry, team: true, loggedBy: teamLoggedByLabel(e), loggedByName: teamLoggedByName(e), readOnly: true,
    })),
  ].filter(r => onView(r.entry)), [liveEntries, ownedTeam, seatTeamOpen, onView]);
  // #66: a forgotten shift is flagged, leaves On Site, and stops blocking a
  // new clock-in for that worker today.
  const isMissed = useCallback(
    (e: TimeEntry) => isMissedClockOut(e, nowMs, shiftAlertHours),
    [nowMs, shiftAlertHours],
  );
  const activeLiveRows = useMemo(() => liveRows.filter(r => !isMissed(r.entry)), [liveRows, isMissed]);
  const missedLiveRows = useMemo(() => liveRows.filter(r => isMissed(r.entry)), [liveRows, isMissed]);

  type HistoryRow = { entry: TimeEntry; team: boolean; loggedBy?: string; loggedByName?: string };
  const historyRows: HistoryRow[] = useMemo(() => [
    ...historyEntries.map(e => ({ entry: e, team: false })),
    ...ownedTeam.filter(e => e.status === 'clocked_out').map(e => ({
      entry: e as TimeEntry, team: true, loggedBy: teamLoggedByLabel(e), loggedByName: teamLoggedByName(e),
    })),
  ]
    .filter(r => onView(r.entry))
    .sort((a, b) => timeEntryDay(b.entry).localeCompare(timeEntryDay(a.entry)) || b.entry.clockIn.localeCompare(a.entry.clockIn)),
  [historyEntries, ownedTeam, onView]);

  // #99: who is already on the clock — on ANY job this phone can see, logged
  // by ANYONE (his own clock-ins, his foreman's, the GC's on a job he holds a
  // seat on). It used to check only his own and his OWNED jobs' team rows, so
  // a foreman was offered a worker the GC had already clocked in, and the GC
  // then paid that man twice in Job Costing and the payroll CSV. A missed
  // clock-out (#66) still does not block a new shift.
  const openShiftByWorker = useMemo(() => {
    const out = new Map<string, { entry: TimeEntry; who: string | null }>();
    for (const e of liveEntries) {
      if (e.status !== 'clocked_out' && !isMissed(e) && !out.has(e.workerId)) out.set(e.workerId, { entry: e, who: null });
    }
    for (const e of teamEntries) {
      if (e.status !== 'clocked_out' && !e.clockOut && !isMissed(e) && !out.has(e.workerId)) {
        out.set(e.workerId, { entry: e, who: teamLoggedByName(e) });
      }
    }
    return out;
  }, [liveEntries, teamEntries, isMissed]);
  const availableRoster = useMemo(
    () => roster.filter(m => !openShiftByWorker.has(m.id)),
    [roster, openShiftByWorker],
  );
  // Shown under the available names, greyed, with the reason — a blocked
  // name says why, never silently missing. The pull behind it can be a few
  // minutes old (the GC may have just clocked him out); the sheet re-pulls on
  // open and says when that pull failed.
  const onClockRoster = useMemo(
    () => roster
      .filter(m => openShiftByWorker.has(m.id))
      .map(m => {
        const hit = openShiftByWorker.get(m.id)!;
        const where = hit.entry.projectId !== selectedProject?.id && hit.entry.projectName ? ` on ${hit.entry.projectName}` : '';
        return { ...m, reason: `On the clock${where} — ${hit.who ? `logged by ${hit.who}` : 'you clocked him in'}` };
      }),
    [roster, openShiftByWorker, selectedProject],
  );
  // #99: two devices offline (or two seats that can't see each other) can
  // still both clock the same man in. Every open, non-missed shift per worker
  // is counted here, and two or more is said out loud before costing and the
  // export pay him twice. No server unique index: a rejected insert from the
  // offline queue would be dropped without the foreman ever seeing it.
  const doubleClocked = useMemo(() => {
    const byWorker = new Map<string, TimeEntry[]>();
    for (const e of [...liveEntries, ...teamEntries] as TimeEntry[]) {
      if (!e.workerId || e.workerId === 'self' || e.status === 'clocked_out' || e.clockOut || isMissed(e)) continue;
      const list = byWorker.get(e.workerId) ?? [];
      if (!list.some(x => x.id === e.id)) list.push(e);
      byWorker.set(e.workerId, list);
    }
    return [...byWorker.values()].filter(list => list.length > 1);
  }, [liveEntries, teamEntries, isMissed]);

  // Overtime by the GC's rule (#65), worked out per worker across every
  // shift this device knows about for them — his own clock-ins AND the
  // team's (a crew member clocked in by the foreman in the morning and by the
  // GC in the afternoon is one person's day). Never the per-shift figure
  // stored on the row.
  const overtime = useMemo(
    () => computeOvertime(mergeTimeEntriesMirror(entries, teamEntries), overtimeRule),
    [entries, teamEntries, overtimeRule],
  );

  // The same allocation with the shifts still on the clock counted at their
  // hours so far — the OT tile is live, like Hours Today (#152).
  // #41: a missed clock-out is left out of the split — a forgotten Monday
  // shift used to count ~53 h "so far" by Wednesday and turn Tuesday's and
  // Wednesday's ordinary shifts into overtime on this tile.
  const liveOvertime = useMemo(
    () => computeOvertime(mergeTimeEntriesMirror(entries, teamEntries), overtimeRule, { liveNowMs: nowMs, missedAlertHours: shiftAlertHours }),
    [entries, teamEntries, overtimeRule, nowMs, shiftAlertHours],
  );

  const todayStats = useMemo(() => {
    // Local day on both sides (field-ops #9). The UTC today rolled over at
    // ~5 pm Pacific and every shift finished earlier that day dropped out of
    // Hours Today and the OT tile; timeEntryDay reads the clock-in instant, so
    // rows saved with the old UTC `date` land on the right day too.
    const today = todayCalendarDay(new Date(nowMs));
    const todayEntries = [...entries, ...ownedTeam].filter(e => timeEntryDay(e) === today && onView(e));
    const finished = todayEntries.filter(e => e.status === 'clocked_out');
    // #152: open shifts count at their NET hours so far (breaks off, the
    // running one too) — the tile read 0.0 at noon with six men on the clock.
    // A missed clock-out is not "today's" work and is left out.
    const open = todayEntries.filter(e => e.status !== 'clocked_out' && !isMissed(e));
    const totalWorkers = new Set(todayEntries.map(e => e.workerId)).size;
    const totalHours = finished.reduce((s, e) => s + e.totalHours, 0)
      + open.reduce((s, e) => s + liveNetHours(e, nowMs), 0);
    // Today is always in the open payroll week, so this is overtime SO FAR —
    // finished shifts by the allocation, open ones by the live allocation.
    const totalOT = finished.reduce((s, e) => s + overtimeFor(overtime, e.id), 0)
      + open.reduce((s, e) => s + overtimeFor(liveOvertime, e.id), 0);
    return { totalWorkers, totalHours, totalOT, liveCount: activeLiveRows.length };
  }, [entries, ownedTeam, onView, isMissed, nowMs, overtime, liveOvertime, activeLiveRows]);

  // Honesty surface: how many finished shifts are actually feeding the cost
  // book, and which trades are stuck waiting on a rate.
  // #104: over the same rows the cost book learns from — his own shifts plus
  // the team's on jobs he OWNS (ownedTeam; never a seat on another company's
  // job) — so "Feeding your labor rates" counts his foreman's clock-ins too.
  const laborStats = useMemo(
    () => computeLaborStats(mergeTimeEntriesMirror(entries, ownedTeam), rates),
    [entries, ownedTeam, rates],
  );

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
    // #104: his foreman's shifts on his own jobs — the rest of what Job
    // Costing prices (the costing mirror is exactly entries + ownedTeam), so
    // every trade its "No rate for:" banner names is listed here.
    ownedTeam.forEach(e => offer(e.trade));
    roster.forEach(m => offer(m.trade));
    Object.keys(rates).forEach(k => offer(k === 'general' ? undefined : k.charAt(0).toUpperCase() + k.slice(1)));
    // …and the trade the banner sent him here for, even if this phone's copy
    // of the hours has not caught up yet.
    if (routeRateTrade) offer(routeRateTrade === 'general' ? undefined : routeRateTrade.charAt(0).toUpperCase() + routeRateTrade.slice(1));
    return [...byKey.entries()]
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => (a.key === 'general' ? 1 : b.key === 'general' ? -1 : a.label.localeCompare(b.label)));
  }, [entries, ownedTeam, roster, rates, routeRateTrade]);
  const focusRateKey = routeRateTrade ? normalizeTradeKey(routeRateTrade) : null;

  const openRatesModal = useCallback(() => {
    // Seed drafts from stored rates so the inputs show what's on file, and
    // keep the seed as the baseline closing compares against (#101).
    const drafts = seedRateDrafts(rateTrades.map(t => t.key), rates);
    setRateSheet({ drafts, baseline: drafts });
    // Overtime: the stored multiplier, shown as a number he can see is his
    // (or the 1.5 default, labelled as the default in the sheet), and the rule.
    setOtMultiplierDraft(overtimeIsDefault ? '' : String(overtimeMultiplier));
    setOtDailyDraft(overtimeRule.dailyThreshold != null);
    setOtWeekStartDraft(overtimeRule.weekStartsOn);
    setShowRatesModal(true);
  }, [rateTrades, rates, overtimeIsDefault, overtimeMultiplier, overtimeRule]);

  // #101: the book can change under the open sheet — the account sync lands
  // a few seconds after a sign-in or on a phone with an older copy. A field he
  // has not touched follows it (draft and baseline both move), so it shows the
  // account's rate and closing can never write the stale one back; a field he
  // typed in stays his.
  useEffect(() => {
    if (!showRatesModal) return;
    const fresh = seedRateDrafts(rateTrades.map(t => t.key), rates);
    setRateSheet(prev => reseedUntouchedDrafts(prev.drafts, prev.baseline, fresh) ?? prev);
  }, [rates, rateTrades, showRatesModal]);

  // #104: arriving from an unpriced-labor banner opens the sheet on that
  // trade — once, after the device's rate book has loaded (a sheet seeded
  // from a book still loading would show blanks).
  const openedFromBannerRef = useRef(false);
  useEffect(() => {
    if (openedFromBannerRef.current || routeOpenRates !== '1' || !ownTier || ratesLoading) return;
    openedFromBannerRef.current = true;
    openRatesModal();
  }, [routeOpenRates, ownTier, ratesLoading, openRatesModal]);

  const commitRateDrafts = useCallback(() => {
    // Commit on close (iOS modals don't reliably blur inputs). Lenient parse
    // ("$34", "34.50") via the shared money-input helper; blank or
    // unparseable clears the rate — no silent garbage.
    // ONE batched setRates call, not a setRate-per-trade loop: per-key
    // mutations all read the same stale cache snapshot and race — only one
    // of a multi-trade edit would survive (lost-update bug).
    // #101: ONLY the trades he changed in the sheet. Sending every field let
    // an untouched, stale field clear or roll back a rate he had set on
    // another device, on every device (newest edit wins).
    setRates(rateDraftBatch(rateDrafts, rateBaseline));
    // #153 / #65: the overtime settings save on the SAME close as the rates.
    // A blank multiplier keeps whatever is stored (the default until he types
    // one); the hook writes only when something actually changed.
    const typed = otMultiplierDraft.trim() === '' ? null : parseLenientNumber(otMultiplierDraft);
    setOvertimeSettings({
      ...(typed !== null ? { overtimeMultiplier: typed } : {}),
      overtimeRule: {
        dailyThreshold: otDailyDraft ? DAILY_OVERTIME_HOURS : null,
        weekStartsOn: otWeekStartDraft,
      },
    });
    setShowRatesModal(false);
  }, [rateDrafts, rateBaseline, setRates, otMultiplierDraft, otDailyDraft, otWeekStartDraft, setOvertimeSettings]);

  /** Echo the clamped multiplier back into the field the moment he leaves it,
   *  so a typed "15" visibly becomes 3 instead of looking accepted (#153). */
  const echoClampedMultiplier = useCallback(() => {
    const n = otMultiplierDraft.trim() === '' ? null : parseLenientNumber(otMultiplierDraft);
    if (n === null) { setOtMultiplierDraft(''); return; }
    setOtMultiplierDraft(String(normalizeOvertimeMultiplier(n)));
  }, [otMultiplierDraft]);

  // The break-start timestamp is now persisted on the row (`breakStartedAt`
  // — see hooks/useTimeEntries.ts). Pre-fix this lived in a useRef on the
  // screen, so backgrounding / force-quitting during a break wiped it and
  // resume always added zero minutes.
  // ── The out-time sheet (#66 missed clock-out, #63 owner closing a team row)
  // A forgotten shift used to be clocked out at NOW — Fri 7 am to Mon 8 am
  // booked ~74 h. It now asks when he actually left: the default is clock-in
  // + the alert hours + his break, on the clock-in day; it can't be before the
  // clock-in or after now. The time is saved as the real clock-out stamp.
  const [outFor, setOutFor] = useState<{ entry: TimeEntry; team: boolean; loggedBy?: string; loggedByName?: string } | null>(null);
  const [outText, setOutText] = useState('');
  const [outNextDay, setOutNextDay] = useState(false);
  const openOutSheet = useCallback((entry: TimeEntry, team: boolean, loggedBy?: string, loggedByName?: string) => {
    const now = Date.now();
    const def = isMissedClockOut(entry, now, shiftAlertHours) ? defaultMissedOutMs(entry, shiftAlertHours, now) : now;
    const inDay = new Date(entry.clockIn);
    const defDay = new Date(def);
    setOutNextDay(defDay.toDateString() !== inDay.toDateString());
    setOutText(formatClockTime(def));
    setOutFor({ entry, team, loggedBy, loggedByName });
  }, [shiftAlertHours]);
  const setOutToNow = useCallback(() => {
    if (!outFor) return;
    const now = Date.now();
    setOutNextDay(new Date(now).toDateString() !== new Date(outFor.entry.clockIn).toDateString());
    setOutText(formatClockTime(now));
  }, [outFor]);
  const outPreview = useMemo(() => {
    if (!outFor) return null;
    const minutes = parseClockTime(outText);
    const outMs = minutes === null ? NaN : outMsOnClockInDay(outFor.entry.clockIn, minutes, outNextDay ? 1 : 0);
    const problem = outTimeProblem(outFor.entry, outMs, Date.now());
    if (problem) return { problem, outMs, hours: 0, breakMinutes: 0 };
    const breakMinutes = breakMinutesAt(outFor.entry, outMs);
    const { totalHours } = computeShiftHours(outFor.entry.clockIn, new Date(outMs).toISOString(), breakMinutes);
    return { problem: null, outMs, hours: totalHours, breakMinutes };
  }, [outFor, outText, outNextDay]);
  const handleSaveOutTime = useCallback(() => {
    if (!outFor || !outPreview) return;
    if (outPreview.problem) { showAlert('Check the out time', outPreview.problem); return; }
    const { entry, team, loggedByName } = outFor;
    const outIso = new Date(outPreview.outMs).toISOString();
    const summary = `${entry.workerName}: out at ${formatClockTime(outPreview.outMs)}${outNextDay ? ' (next day)' : ''} — records ${outPreview.hours.toFixed(2)} hours${outPreview.breakMinutes > 0 ? ` after a ${outPreview.breakMinutes}-min break` : ''}.`;
    if (!team) {
      if (!doClockOut(entry.id, outIso)) {
        showAlert('Already clocked out', `${entry.workerName}'s shift was already ended — nothing was changed. Correct it from History if the hours are wrong.`);
      } else if (Platform.OS !== 'web') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      setOutFor(null);
      return;
    }
    // A team row is the foreman's record: say so before changing it.
    showAlert(
      'Clock out a shift you didn\u2019t log?',
      // #106: the bare name — the label read "Logged by jose@… logged this shift".
      `${summary} ${sentenceName(loggedByName ?? 'a teammate')} logged this shift; it stays theirs, and their copy updates too.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clock out',
          style: 'destructive',
          onPress: () => {
            const done = closeTeamShift(entry.id, { clockOut: outIso, totalHours: outPreview.hours, breakMinutes: outPreview.breakMinutes });
            if (!done) showAlert('Couldn\u2019t clock out', 'Only shifts on your own jobs can be closed here.');
            setOutFor(null);
          },
        },
      ],
    );
  }, [outFor, outPreview, outNextDay, doClockOut, closeTeamShift]);

  const handleAction = useCallback((entry: TimeEntry, action: string) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // A team row (#63) or a missed clock-out (#66) ends through the out-time
    // sheet — never a one-tap "now".
    const teamRow = ownedTeam.find(t => t.id === entry.id);
    // #99: a shift that is neither his nor on a job he owns has no action here
    // (its card shows none; this is the belt to that).
    if (!teamRow && !entries.some(x => x.id === entry.id)) return;
    if (action === 'clock_out' && (teamRow || isMissedClockOut(entry, Date.now(), shiftAlertHours))) {
      openOutSheet(entry, !!teamRow, teamRow ? teamLoggedByLabel(teamRow) : undefined, teamRow ? teamLoggedByName(teamRow) : undefined);
      return;
    }
    if (teamRow) return;

    if (action === 'break') {
      startBreak(entry.id);
    } else if (action === 'resume') {
      // Hook reads breakStartedAt from the row to compute elapsed minutes.
      resumeFromBreak(entry.id);
    } else if (action === 'clock_out') {
      // Confirm BEFORE the write. This used to end the shift on the first tap
      // and announce it afterwards, from a button sitting in a two-up row
      // beside Break in the same styles.actionBtn — a foreman clocking in a
      // six-man crew with a gloved thumb could end someone's day at 9:40am.
      // Those hours feed the payroll CSV and the labor samples that seed the
      // cost book, so the error propagates into pay and into future bids.
      // Same shape as handleRemoveManpower in app/daily-report.tsx: name the
      // person and what is about to be recorded.
      // #152: quote the NET time and the exact hours the hook will save —
      // computeShiftHours with the break so far (the running one included).
      const now = Date.now();
      const breakSoFar = breakMinutesAt(entry, now);
      const grossHours = Math.max(0, (now - Date.parse(entry.clockIn)) / 3_600_000);
      const { totalHours: willRecord } = computeShiftHours(entry.clockIn, new Date(now).toISOString(), breakSoFar);
      showAlert(
        'Clock out?',
        breakSoFar > 0
          ? `${entry.workerName} has been on the clock ${formatHoursMinutes(grossHours)} (${formatHoursMinutes(willRecord)} after a ${breakSoFar}-min break). This ends the shift and records ${willRecord.toFixed(2)} hours.`
          : `${entry.workerName} has been on the clock ${formatHoursMinutes(willRecord)}. This ends the shift and records ${willRecord.toFixed(2)} hours.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Clock Out',
            style: 'destructive',
            onPress: () => {
              // The hook computes totalHours/overtimeHours and updates the row.
              doClockOut(entry.id);
            },
          },
        ],
      );
    }
  }, [startBreak, resumeFromBreak, doClockOut, ownedTeam, entries, shiftAlertHours, openOutSheet]);

  // ── Correcting a finished entry ───────────────────────────────────────
  // hooks/useTimeEntries has exported updateEntry and deleteEntry since it was
  // written and had ZERO consumers, so a mis-punched shift was permanently
  // uncorrectable in a product that had already built the correction
  // (app-experience audit 2026-09-07, field-ergonomics).
  //
  // The sheet edits HOURS and BREAK, not the clock stamps — on purpose: the
  // punch stamps are the audit record a GC needs in a wage dispute (#151).
  // When the corrected hours no longer match the stamps, the row says so —
  // "Adjusted" here and in the export's Adjusted column, with the punched
  // hours beside it (utils/timeClockPayroll.isAdjustedEntry). The real out
  // time of a FORGOTTEN clock-out is a different thing: that is entered on the
  // out-time sheet and saved as the stamp (#66). Hours are what the payroll
  // CSV and computeLaborStats' cost-book samples read.
  const [correcting, setCorrecting] = useState<TimeEntry | null>(null);
  // #63: a team row on his own job, corrected through closeTeamShift. The
  // bare name of whoever logged it (#106 — for the sentences), or null.
  const [correctingTeam, setCorrectingTeam] = useState<string | null>(null);
  const [correctHours, setCorrectHours] = useState('');
  const [correctBreak, setCorrectBreak] = useState('');
  const [correctNote, setCorrectNote] = useState('');

  const openCorrection = useCallback((entry: TimeEntry, loggedByName?: string) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setCorrecting(entry);
    setCorrectingTeam(loggedByName ?? null);
    setCorrectHours(entry.totalHours.toFixed(2).replace(/\.?0+$/, ''));
    setCorrectBreak(entry.breakMinutes > 0 ? String(entry.breakMinutes) : '');
    setCorrectNote(entry.notes ?? '');
  }, []);

  const handleSaveCorrection = useCallback(() => {
    if (!correcting) return;
    const hours = parseLenientNumber(correctHours);
    if (hours === null || hours < 0 || hours > 24) {
      showAlert('Check the hours', 'Enter hours worked as a number between 0 and 24 (e.g. 7.5).');
      return;
    }
    const breakRaw = correctBreak.trim() === '' ? 0 : parseLenientNumber(correctBreak);
    if (breakRaw === null || breakRaw < 0 || breakRaw >= 24 * 60) {
      showAlert('Check the break', 'Enter break time in whole minutes, or leave it blank for none.');
      return;
    }
    const breakMinutes = Math.round(breakRaw);
    // Derive the totals through the hook's OWN computeShiftHours rather than
    // re-implementing ">8h in a day is overtime" here — one definition of the
    // OT rule, whether the shift was clocked or corrected. Feeding it a
    // synthetic clock-out of clockIn + hours + break returns exactly `hours`
    // net of the break, with overtime split off the same way.
    const syntheticOut = new Date(
      new Date(correcting.clockIn).getTime() + hours * 3_600_000 + breakMinutes * 60_000,
    ).toISOString();
    const { totalHours, overtimeHours } = computeShiftHours(correcting.clockIn, syntheticOut, breakMinutes);
    if (correctingTeam) {
      // Someone else's record on his job (#63): confirmed, and written by the
      // team-row writer, which keeps the row theirs.
      const entry = correcting;
      showAlert(
        'Change a shift you didn\u2019t log?',
        `${entry.workerName}: ${totalHours.toFixed(2)} hours${breakMinutes > 0 ? `, ${breakMinutes}-min break` : ''}. ${sentenceName(correctingTeam)} logged this shift; it stays theirs, and their copy updates too.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Save',
            onPress: () => {
              if (!closeTeamShift(entry.id, { totalHours, breakMinutes })) {
                showAlert('Couldn\u2019t save', 'Only shifts on your own jobs can be corrected here.');
              }
              setCorrecting(null);
            },
          },
        ],
      );
      return;
    }
    // notes as '' rather than undefined: updateEntry skips any patch field that
    // is undefined, so clearing a note would never reach Supabase.
    updateEntry(correcting.id, { totalHours, overtimeHours, breakMinutes, notes: correctNote.trim() });
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCorrecting(null);
  }, [correcting, correctingTeam, correctHours, correctBreak, correctNote, updateEntry, closeTeamShift]);

  const handleDeleteCorrection = useCallback(() => {
    if (!correcting || correctingTeam) return;
    const entry = correcting;
    showAlert(
      'Delete this entry?',
      `${entry.workerName} · ${entry.totalHours.toFixed(1)}h on ${formatCalendarDay(timeEntryDay(entry))}. It comes out of the payroll export and out of the labor samples feeding your cost book. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteEntry(entry.id);
            setCorrecting(null);
          },
        },
      ],
    );
  }, [correcting, correctingTeam, deleteEntry]);

  const handleClockIn = useCallback((memberId: string) => {
    // The roster only renders when the gate is open; this is the belt to it.
    if (clockGate.kind !== 'ok') return;
    const member = roster.find(m => m.id === memberId);
    if (!member) return;
    // #155: hours are filed against a job. The old 'unassigned' fallback wrote
    // a row the server refuses (RLS can_access_project needs a real project),
    // so the shift never left the phone. No job, no clock-in — said, not silent.
    if (!selectedProject) {
      showAlert('Pick a job first', NO_JOB_REASON);
      return;
    }
    const project = selectedProject;

    const commit = () => {
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // The user-chosen project (defaults to projects[0] in the picker
      // effect above). There is no no-job fallback (#155).
      const made = doClockIn({
        projectId: project.id,
        projectName: project.name,
        workerId: member.id,
        workerName: member.name,
        trade: member.trade,
      });
      if (!made) {
        showAlert('Couldn\u2019t clock in', `${project.name} hasn\u2019t synced to your account yet, so hours can\u2019t be filed against it. Try again once it has.`);
        return;
      }

      setShowClockInModal(false);
    };

    // A lapsed card is a confirm, not a silent block and not a silent pass
    // (safety #2). Clock-in is the moment a person is put on the job; the
    // super may have a renewed card in hand that nobody has entered yet, so
    // he decides — but he decides having been told which card and when.
    const certCheck = () => {
      const warn = lapsedCertConfirmText(member.name, certFlagsByMember[member.id] ?? [], 'Clock them in');
      if (warn) {
        showAlert('Certification lapsed', warn, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Clock in anyway', style: 'destructive', onPress: commit },
        ]);
        return;
      }
      commit();
    };

    // #105: the list he tapped can be older than the moment he tapped it (the
    // pull that just landed may have put this man on the clock elsewhere). A
    // worker already on the clock is a confirm naming who has him — a second
    // open shift is paid twice in job cost and payroll.
    const already = openShiftByWorker.get(member.id);
    if (already) {
      const who = already.who ? `logged by ${already.who}` : 'you clocked him in';
      showAlert(
        'Already on the clock',
        `${member.name} is already on the clock${already.entry.projectName ? ` on ${already.entry.projectName}` : ''} (${who}, ${formatClockTime(Date.parse(already.entry.clockIn))}). Clocking him in again opens a second shift, and both are paid unless one is closed.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Clock in again', style: 'destructive', onPress: certCheck },
        ],
      );
      return;
    }
    certCheck();
  }, [clockGate.kind, doClockIn, selectedProject, roster, certFlagsByMember, openShiftByWorker]);

  // #105: pull-to-refresh waits for the real pulls (own + team) to settle.
  const [userPulling, setUserPulling] = useState(false);
  const onPullToRefresh = useCallback(async () => {
    setUserPulling(true);
    try {
      if (isSeat) projectCrew.refetch();
      await refreshEntries();
    } finally {
      setUserPulling(false);
    }
  }, [refreshEntries, isSeat, projectCrew]);
  const openClockInSheet = useCallback(() => {
    if (clockInDisabledReason) return;
    // #105: the sheet decides who is available from the team's live rows; a
    // screen left open since 7:00 never saw the foreman's 7:05 clock-ins.
    void refreshEntries();
    setShowClockInModal(true);
  }, [clockInDisabledReason, refreshEntries]);

  // ── Payroll export (#64, #68, #63, #151) ─────────────────────────────
  // One pay period at a time — this payroll week by default, last week one tap
  // away (payroll is usually run for the week just closed) — and the job the
  // screen is on, or all jobs. Only FINISHED shifts go out; crew still on the
  // clock are named and left out, never exported at 0.00 h. The export used to
  // dump every shift ever logged, so each week's CSV repaid all the earlier
  // weeks. Team shifts on his own jobs go in with a "Logged by" column (#63).
  // It is handed over as a real .csv FILE — the share sheet on a phone, a
  // browser download on the web — not message text or a clipboard paste.
  const [showExport, setShowExport] = useState(false);
  const [exportWeekOffset, setExportWeekOffset] = useState<0 | -1>(0);
  const [exportProjectId, setExportProjectId] = useState<string | null>(null);
  const openExport = useCallback(() => {
    setExportWeekOffset(0);
    setExportProjectId(viewProjectId);
    setShowExport(true);
  }, [viewProjectId]);
  const exportPeriod = useMemo(
    () => payWeekRange(todayCalendarDay(new Date(nowMs)), overtimeRule.weekStartsOn, exportWeekOffset),
    [nowMs, overtimeRule.weekStartsOn, exportWeekOffset],
  );
  const exportProjectName = useMemo(
    () => (exportProjectId ? allProjects.find(p => p.id === exportProjectId)?.name ?? null : null),
    [exportProjectId, allProjects],
  );
  const exportSelection = useMemo(() => {
    const labelled: PayrollRow[] = [
      ...entries,
      ...ownedTeam.map((e: TeamTimeEntry) => ({ ...e, loggedByLabel: e.loggedByName?.trim() || 'a teammate' })),
    ];
    return selectPayrollEntries(labelled, exportPeriod.start, exportPeriod.end, { projectId: exportProjectId });
  }, [entries, ownedTeam, exportPeriod, exportProjectId]);
  const exportBlocked = payrollBlockedReason(exportSelection, exportPeriod);
  const exportOpenNote = openShiftsNote(exportSelection.open);

  const handleExportCSV = useCallback(async () => {
    if (exportBlocked) { showAlert('Nothing to export', exportBlocked); return; }
    const rows = exportSelection.rows;
    // Overtime is allocated across every shift the device knows for each
    // worker (his and the team's, all jobs) under his rule — handoff from
    // labor-cost (#65).
    const csv = buildTimeEntriesCSV(rows, overtimeRule, mergeTimeEntriesMirror(entries, teamEntries));
    const fileName = payrollFileName(exportPeriod, exportProjectName);
    const title = payrollTitle(exportPeriod, exportProjectName);
    const counted = `${rows.length} finished shift${rows.length === 1 ? '' : 's'}`;
    const tail = exportOpenNote ? ` ${exportOpenNote}.` : '';
    try {
      if (Platform.OS === 'web') {
        // Called before any await, so the browser still counts the download
        // as part of the tap (deliverTextFile clicks a download link on web).
        await deliverTextFile(fileName, csv, 'text/csv;charset=utf-8');
        setShowExport(false);
        showAlert('Downloaded', `${fileName} — ${counted}.${tail}`);
        return;
      }
      const uri = await deliverTextFile(fileName, csv, 'text/csv;charset=utf-8');
      if (!uri || !(await Sharing.isAvailableAsync())) {
        // No share sheet: offer the rows TAB-separated, which splits into
        // columns when pasted into a spreadsheet.
        showAlert(
          'Can\u2019t share a file here',
          `This device couldn\u2019t open a share sheet for ${fileName}. Copy the ${counted} instead — they paste into a spreadsheet as columns.`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Copy rows',
              onPress: () => {
                Clipboard.setStringAsync(csvToTsv(csv))
                  .then(() => showAlert('Copied', `${counted} copied — paste into a spreadsheet.${tail}`))
                  .catch(() => showAlert('Couldn\u2019t copy', 'The clipboard refused the rows. Try again.'));
              },
            },
          ],
        );
        return;
      }
      // The share sheet itself is the report: iOS resolves the same way for a
      // send and a cancel, so nothing is claimed afterwards (a cancel stays
      // quiet). What was NOT included is said up front, in the sheet's title.
      // The export modal stays up until the sheet resolves: closing it in the
      // same tick makes iOS refuse the share sheet mid-dismiss ("presentation
      // in progress") with no file and no error. expo-sharing presents from
      // the top-most controller, which is this modal.
      await Sharing.shareAsync(uri, {
        mimeType: 'text/csv',
        dialogTitle: exportOpenNote ? `${title} (${exportOpenNote})` : title,
        UTI: 'public.comma-separated-values-text',
      });
      setShowExport(false);
    } catch (err) {
      showAlert('Export failed', `The payroll file couldn\u2019t be made: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [exportBlocked, exportSelection, overtimeRule, entries, teamEntries, exportPeriod, exportProjectName, exportOpenNote]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Time Tracking', headerStyle: { backgroundColor: themeColors.bg }, headerTintColor: themeColors.accent, headerTitleStyle: { ...NATIVE_HEADER_TITLE_FACE, color: themeColors.text } }} />
      <ScrollView
        {...fabScroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}
        showsVerticalScrollIndicator={false}
        // #105: pull down to see the clock-ins made on other phones since the
        // screen opened (the foreground re-pull is throttled to 5 minutes).
        refreshControl={<RefreshControl refreshing={userPulling} onRefresh={onPullToRefresh} tintColor={themeColors.accent} />}
      >
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
            {/* Finished shifts plus the net hours so far of shifts still on
                the clock (#152) — it read 0.0 at noon with a crew working. */}
            <Text style={styles.statLabel} accessibilityLabel="Hours today, including crew still on the clock">Hours Today</Text>
          </View>
          <View style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: todayStats.totalOT > 0 ? themeColors.warningSoft : themeColors.successSoft }]}>
              {todayStats.totalOT > 0 ? <AlertTriangle size={16} color={themeColors.warningLabel} strokeWidth={1.75} /> : <TrendingUp size={16} color={themeColors.success} strokeWidth={1.75} />}
            </View>
            <Text style={[styles.statValue, todayStats.totalOT > 0 && { color: themeColors.warningLabel }]}>{todayStats.totalOT.toFixed(1)}</Text>
            {/* So far: this week is still open, so more shifts can still
                push today's hours into overtime (#65). Live: shifts still on
                the clock count at their hours so far (#152). */}
            <Text style={styles.statLabel} accessibilityLabel={`Overtime hours today so far, ${describeOvertimeRule(overtimeRule)}`}>OT so far</Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: 10, marginHorizontal: 16, marginVertical: 12 }}>
          {/* #155: with no job to file hours against, Clock In is shown but
              disabled, with the reason under it — never a row the server
              refuses. */}
          <TouchableOpacity
            style={[styles.clockInButton, { flex: 1, marginHorizontal: 0, marginVertical: 0 }, clockInDisabledReason ? { opacity: 0.5 } : null]}
            onPress={openClockInSheet}
            disabled={!!clockInDisabledReason}
            accessibilityState={{ disabled: !!clockInDisabledReason }}
            accessibilityHint={clockInDisabledReason ?? undefined}
            activeOpacity={0.85}
            testID="time-tracking-clock-in"
          >
            <Play size={18} color="#fff" strokeWidth={1.75} />
            <Text style={styles.clockInButtonText}>Clock In Crew</Text>
          </TouchableOpacity>
          {/* Payroll CSV for one pay period — a real .csv file (#64, #68). */}
          <TouchableOpacity
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
              paddingVertical: 14, paddingHorizontal: 16,
              backgroundColor: Colors.card, borderWidth: 1, borderColor: themeColors.line,
              borderRadius: Tokens.radius.md,
            }}
            onPress={openExport}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Export payroll CSV for a pay period"
            testID="time-tracking-export"
          >
            <FileDown size={16} color={themeColors.text} strokeWidth={1.75} />
            <Text style={{ fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: themeColors.text }}>Export CSV</Text>
          </TouchableOpacity>
        </View>
        {clockInDisabledReason ? (
          <View style={styles.blockedRow} testID="time-tracking-clock-in-blocked">
            <Text style={styles.blockedText}>{clockInDisabledReason}</Text>
            {allProjects.length === 0 ? (
              <TouchableOpacity
                onPress={() => router.push({ pathname: '/' as never, params: { openCreate: '1' } as never })}
                style={styles.emptyCtaBtn}
                activeOpacity={0.85}
                accessibilityRole="button"
                testID="time-tracking-create-project"
              >
                <Text style={styles.emptyCtaText}>Create a project</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

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
              substitute market averages for your payroll). His OWN book: a
              seat clocking the GC's crew on the GC's plan has no rates here
              and sees no labor dollars (field seats are money-blinded). */}
          {ownTier ? (
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
          ) : null}
        </View>

        {/* Honesty line — what this data actually feeds. Only rendered when
            there is something true to say. */}
        {!ownTier ? null : laborStats.sampledEntries > 0 ? (
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

        {viewProjectId ? (
          // Opened from a job: the lists show that job. One tap shows all.
          <TouchableOpacity
            style={styles.jobFilterChip}
            onPress={() => setViewProjectId(null)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={`Showing ${viewProjectName ?? 'one job'} only. Tap to show all jobs.`}
            testID="time-tracking-job-filter"
          >
            <Briefcase size={14} color={themeColors.accent} strokeWidth={1.75} />
            <Text style={styles.jobFilterText} numberOfLines={1}>{viewProjectName ?? 'This job'} only</Text>
            <X size={14} color={themeColors.textMuted} strokeWidth={1.75} />
          </TouchableOpacity>
        ) : null}

        <View style={styles.tabRow}>
          <TouchableOpacity
            style={[styles.tab, selectedTab === 'live' && styles.tabActive]}
            onPress={() => setSelectedTab('live')}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabText, selectedTab === 'live' && styles.tabTextActive]}>
              Live ({liveRows.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, selectedTab === 'history' && styles.tabActive]}
            onPress={() => setSelectedTab('history')}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabText, selectedTab === 'history' && styles.tabTextActive]}>
              History ({historyRows.length})
            </Text>
          </TouchableOpacity>
        </View>

        {/* #99: one worker on the clock twice (two phones offline, or two
            seats that can't see each other's rows) is paid twice unless one
            shift is closed. Said here, before costing and the export count it. */}
        {doubleClocked.length > 0 ? (
          <View style={[styles.thresholdBanner, { marginHorizontal: 16, marginBottom: 8, backgroundColor: themeColors.warningSoft, borderColor: themeColors.warningLabel + '40' }]} testID="time-tracking-double-clocked">
            <AlertTriangle size={13} color={themeColors.warningLabel} strokeWidth={1.75} />
            <Text style={[styles.thresholdBannerText, { color: themeColors.warningLabel }]}>
              {doubleClocked.map(list => `${list[0].workerName} has ${list.length} open shifts`).join('; ')} — close the extra one so he isn&apos;t paid twice.
            </Text>
          </View>
        ) : null}

        {selectedTab === 'live' ? (
          liveRows.length === 0 ? (
            <View style={styles.emptyState}>
              <Clock size={32} color={themeColors.textMuted} strokeWidth={1.75} />
              <Text style={styles.emptyTitle}>No active time cards</Text>
              <Text style={styles.emptyDesc}>
                {clockInDisabledReason ?? 'Tap Clock In Crew above, pick a worker and project, and their hours start logging here in real time.'}
              </Text>
            </View>
          ) : (
            <View style={styles.listSection}>
              {missedLiveRows.length > 0 ? (
                <Text style={styles.listGroupTitle} testID="time-tracking-missed-group">
                  Missed clock-out ({missedLiveRows.length}) — enter when they left
                </Text>
              ) : null}
              {[...missedLiveRows, ...activeLiveRows].map(r => (
                <LiveTimeCard
                  key={r.entry.id}
                  entry={r.entry}
                  onAction={handleAction}
                  alertThresholdHours={shiftAlertHours}
                  missed={isMissed(r.entry)}
                  loggedBy={r.loggedBy}
                  readOnly={r.readOnly}
                />
              ))}
            </View>
          )
        ) : (
          <View style={styles.listSection}>
            {historyRows.map(({ entry, loggedBy, loggedByName }) => {
              // #151: corrected hours that no longer match the punch stamps.
              const adjusted = isAdjustedEntry(entry);
              const punched = adjusted ? punchedHours(entry) : null;
              return (
              <TouchableOpacity
                key={entry.id}
                style={styles.historyCard}
                onPress={() => openCorrection(entry, loggedByName)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={`${entry.workerName}, ${entry.totalHours.toFixed(1)} hours on ${formatCalendarDay(timeEntryDay(entry))}${loggedBy ? `, ${loggedBy}` : ''}${adjusted ? ', adjusted' : ''}. Tap to correct${loggedBy ? '' : ' or delete'}.`}
                testID={`time-entry-${entry.id}`}
              >
                <View style={styles.historyHeader}>
                  <Text style={styles.historyName}>{entry.workerName}</Text>
                  <Text style={styles.historyHours}>{entry.totalHours.toFixed(1)}h</Text>
                </View>
                <View style={styles.historyMeta}>
                  <Text style={styles.historyTrade}>{entry.trade}</Text>
                  <Text style={styles.historyDot}>·</Text>
                  <Text style={styles.historyProject} numberOfLines={1}>{entry.projectName}</Text>
                </View>
                {loggedBy ? <Text style={styles.loggedByTag} testID={`time-entry-logged-by-${entry.id}`}>{loggedBy}</Text> : null}
                {!isUuid(entry.projectId) ? (
                  <Text style={styles.loggedByTag}>Not synced — logged with no job, so it stays on this phone.</Text>
                ) : null}
                <View style={styles.historyFooter}>
                  <Text style={styles.historyDate}>
                    {/* The local day the shift was worked, from its clock-in
                        instant (field-ops #9): parsing the bare day with new Date read the
                        bare day as UTC midnight and named the day before. */}
                    {formatCalendarDay(timeEntryDay(entry), { weekday: 'short', month: 'short', day: 'numeric' })}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    {adjusted && punched !== null ? (
                      <View style={styles.adjustedBadge} testID={`time-entry-adjusted-${entry.id}`}>
                        <Text style={styles.adjustedBadgeText}>Adjusted · punched {punched.toFixed(2)}h</Text>
                      </View>
                    ) : null}
                    {/* Allocated by the GC's rule across the worker's week (#65);
                        "so far" while that week is still open. */}
                    {overtimeFor(overtime, entry.id) > 0 && (
                      <View style={styles.otBadge}>
                        <Text style={styles.otBadgeText}>
                          +{overtimeFor(overtime, entry.id).toFixed(1)}h OT{overtime.provisional.has(entry.id) ? ' so far' : ''}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              </TouchableOpacity>
              );
            })}
            {historyRows.length > 0 && (
              // The row is a plain card; nothing about it says it is editable,
              // and a foreman is not going to speculatively tap a payroll
              // record. Say so once, under the list.
              <Text style={styles.historyHint}>Tap an entry to correct its hours{historyRows.some(r => r.team) ? ' (delete is for your own clock-ins)' : ' or delete it'}.</Text>
            )}
            {historyRows.length === 0 ? (
              <Text style={styles.historyHint}>No finished shifts{viewProjectName ? ` on ${viewProjectName}` : ''} yet.</Text>
            ) : null}
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
                them pick another job before clocking the worker in. With no
                job there is no clock-in at all (#155): the button above is
                disabled with the reason. */}
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
                    {selectedProject?.name ?? 'Pick a job'}
                  </Text>
                </View>
                <ChevronDown
                  size={16}
                  color={themeColors.textMuted}
                  style={{ transform: [{ rotate: showProjectPicker ? '180deg' : '0deg' }] }} strokeWidth={1.75}
                />
              </TouchableOpacity>
            ) : null}

            {showProjectPicker && (projects.length > 0 || blockedProjects.length > 0) ? (
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
                  {/* Jobs he can see but not clock crew on — listed with the
                      reason rather than left out, so a missing job is never a
                      mystery (#62). */}
                  {blockedProjects.map(({ p, reason }) => (
                    <View
                      key={p.id}
                      style={[styles.projectListRow, { opacity: 0.6 }]}
                      accessibilityState={{ disabled: true }}
                      accessibilityLabel={`${p.name}. ${reason}`}
                      testID={`clock-in-project-blocked-${p.id}`}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.projectListRowText} numberOfLines={1}>{p.name}</Text>
                        <Text style={styles.memberTrade}>{reason}</Text>
                      </View>
                    </View>
                  ))}
                </ScrollView>
              </View>
            ) : null}

            {clockGate.kind === 'loading' ? (
              <View style={styles.rosterEmpty} testID="clock-in-gate-loading">
                <ActivityIndicator size="small" color={themeColors.accent} />
                <Text style={styles.rosterEmptyBody}>Checking your access on this job…</Text>
              </View>
            ) : clockGate.kind === 'error' ? (
              <View style={styles.rosterEmpty} testID="clock-in-gate-error">
                <AlertTriangle size={24} color={themeColors.warningLabel} strokeWidth={1.75} />
                <Text style={styles.rosterEmptyBody}>Couldn&apos;t check your access on this job. Check your connection and try again.</Text>
                <TouchableOpacity style={styles.rosterEmptyBtn} onPress={roleState.refetch} activeOpacity={0.85} testID="clock-in-gate-retry">
                  <Text style={styles.rosterEmptyBtnText}>Try again</Text>
                </TouchableOpacity>
              </View>
            ) : clockGate.kind === 'blocked' ? (
              <View style={styles.rosterEmpty} testID="clock-in-gate-blocked">
                <Users size={28} color={themeColors.textMuted} strokeWidth={1.75} />
                <Text style={styles.rosterEmptyBody}>{clockGate.reason}</Text>
              </View>
            ) : isSeat && projectCrew.isLoading ? (
              <View style={styles.rosterEmpty} testID="clock-in-crew-loading">
                <ActivityIndicator size="small" color={themeColors.accent} />
                <Text style={styles.rosterEmptyBody}>Loading the crew on this job…</Text>
              </View>
            ) : isSeat && projectCrew.crew.length === 0 && (projectCrew.isPaused || (projectCrew.isError && projectCrew.offline)) ? (
              // #100: offline with nothing saved yet. Never "No crew assigned"
              // — that would state as fact something this phone can't know.
              <View style={styles.rosterEmpty} testID="clock-in-crew-offline">
                <AlertTriangle size={24} color={themeColors.warningLabel} strokeWidth={1.75} />
                <Text style={styles.rosterEmptyBody}>You&apos;re offline, and this job&apos;s crew hasn&apos;t been loaded on this phone yet. Open Time Tracking on this job once you have signal and the crew list is saved for next time.</Text>
                <TouchableOpacity style={styles.rosterEmptyBtn} onPress={projectCrew.refetch} activeOpacity={0.85} accessibilityRole="button">
                  <Text style={styles.rosterEmptyBtnText}>Try again</Text>
                </TouchableOpacity>
              </View>
            ) : isSeat && projectCrew.isError ? (
              <View style={styles.rosterEmpty} testID="clock-in-crew-error">
                <AlertTriangle size={24} color={themeColors.warningLabel} strokeWidth={1.75} />
                <Text style={styles.rosterEmptyBody}>Couldn&apos;t load the crew your GC assigned to this job. Check your connection and try again.</Text>
                <TouchableOpacity style={styles.rosterEmptyBtn} onPress={projectCrew.refetch} activeOpacity={0.85} accessibilityRole="button">
                  <Text style={styles.rosterEmptyBtnText}>Try again</Text>
                </TouchableOpacity>
              </View>
            ) : (
            <ScrollView style={{ maxHeight: 400 }}>
              {/* #100: the saved copy is on screen — say from when. */}
              {isSeat && projectCrew.fromCache && projectCrew.fetchedAt ? (
                <Text style={styles.memberTrade} testID="clock-in-crew-saved">
                  {savedCrewLine(projectCrew.fetchedAt, projectCrew.offline || projectCrew.isPaused)}
                </Text>
              ) : null}
              {/* #105: who is on the clock comes from the team's pull. */}
              {pulling ? (
                <Text style={styles.memberTrade} testID="clock-in-pulling">Checking who is already on the clock…</Text>
              ) : pullFailed ? (
                <Text style={styles.memberTrade} testID="clock-in-pull-failed">Couldn&apos;t reach the server to check who your team has on the clock — the list may be out of date.</Text>
              ) : null}
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
                    {(certFlagsByMember[member.id] ?? []).length > 0 ? (
                      <View style={styles.memberCertFlags}>
                        {(certFlagsByMember[member.id] ?? []).map(f => (
                          <StatusPill
                            key={f.certId}
                            label={f.label}
                            tone={f.status === 'expired' ? 'error' : 'warning'}
                            size="compact"
                            testID={`clock-in-cert-${member.id}-${f.certId}`}
                          />
                        ))}
                      </View>
                    ) : null}
                  </View>
                  <Play size={16} color={themeColors.accent} strokeWidth={1.75} />
                </TouchableOpacity>
              ))}
              {/* Truthful empty states — no fabricated roster. When the GC has
                  no crew on file, point them to where crew is actually added
                  rather than inventing names + pay rates. */}
              {roster.length === 0 && isSeat ? (
                // A seat cannot add crew to the GC's roster — say whose move it is.
                <View style={styles.rosterEmpty} testID="clock-in-seat-no-crew">
                  <Users size={28} color={themeColors.textMuted} strokeWidth={1.75} />
                  <Text style={styles.rosterEmptyTitle}>No crew assigned to this job</Text>
                  <Text style={styles.rosterEmptyBody}>
                    Your GC assigns crew to a job in his Crew screen. Once he does, they appear here to clock in.
                  </Text>
                </View>
              ) : roster.length === 0 ? (
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
              {/* #99: already on the clock — greyed, with who has him, never
                  silently missing. */}
              {onClockRoster.map(member => (
                <View
                  key={member.id}
                  style={[styles.memberRow, { opacity: 0.55 }]}
                  accessibilityState={{ disabled: true }}
                  accessibilityLabel={`${member.name}. ${member.reason}.`}
                  testID={`clock-in-member-on-clock-${member.id}`}
                >
                  <View style={styles.memberAvatar}>
                    <Text style={styles.memberAvatarText}>{member.name.charAt(0)}</Text>
                  </View>
                  <View style={styles.memberInfo}>
                    <Text style={styles.memberName}>{member.name}</Text>
                    <Text style={styles.memberTrade}>{member.reason}</Text>
                  </View>
                  <Clock size={16} color={themeColors.textMuted} strokeWidth={1.75} />
                </View>
              ))}
            </ScrollView>
            )}
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
              {rateTrades.map(t => {
                const draftNum = parseLenientNumber(rateDrafts[t.key] ?? '');
                const bareWarn = looksLikeBareWage(t.key, draftNum ?? 0);
                return (
                  <View key={t.key}>
                    <View style={styles.rateRow}>
                      <Text style={styles.rateTradeLabel} numberOfLines={1}>{t.label}</Text>
                      <View style={styles.rateInputWrap}>
                        <Text style={styles.rateInputPrefix}>$</Text>
                        <TextInput
                          style={styles.rateInput}
                          value={rateDrafts[t.key] ?? ''}
                          onChangeText={(v) => setRateDraft(t.key, v)}
                          autoFocus={t.key === focusRateKey}
                          keyboardType="decimal-pad"
                          placeholder="—"
                          placeholderTextColor={themeColors.textMuted}
                          testID={`labor-rate-input-${t.key}`}
                        />
                        <Text style={styles.rateInputSuffix}>/hr</Text>
                      </View>
                    </View>
                    {bareWarn ? (
                      <Text style={styles.rateBurdenNudge} testID={`labor-rate-burden-nudge-${t.key}`}>
                        Looks like a bare wage. Loaded rates run ~{burdenPercentLabel(t.key)}% higher — add comp, taxes and small tools so your cost book prices labor from your real number. Leave overtime out: it is priced below.
                      </Text>
                    ) : null}
                  </View>
                );
              })}
              {rateTrades.length === 0 ? (
                <Text style={styles.allClockedIn}>Clock in crew (or add trades to your roster) and their trades appear here.</Text>
              ) : null}

              {/* How he pays overtime (#153, #65). Saved on the same close as
                  the rates. The multiplier echoes its clamped value on blur
                  (a typed 15 becomes 3), and until he sets one the field shows
                  the default AS the default, not as his setting. */}
              <Text style={styles.otSectionTitle}>Overtime</Text>
              <View style={styles.rateRow}>
                <Text style={styles.rateTradeLabel}>Overtime pays ×</Text>
                <View style={styles.rateInputWrap}>
                  <TextInput
                    style={styles.rateInput}
                    value={otMultiplierDraft}
                    onChangeText={setOtMultiplierDraft}
                    onBlur={echoClampedMultiplier}
                    keyboardType="decimal-pad"
                    placeholder={String(DEFAULT_OVERTIME_MULTIPLIER)}
                    placeholderTextColor={themeColors.textMuted}
                    accessibilityLabel="Overtime pay multiplier"
                    testID="labor-ot-multiplier-input"
                  />
                  <Text style={styles.rateInputSuffix}>×</Text>
                </View>
              </View>
              <Text style={styles.otHint} testID="labor-ot-multiplier-hint">
                {otMultiplierDraft.trim() === ''
                  ? `${DEFAULT_OVERTIME_MULTIPLIER}× — time-and-a-half, the default. Type your own (1 to 3) if you pay more, e.g. 2 for double time.`
                  : `Overtime hours are priced at your rate × ${otMultiplierDraft.trim()}. Allowed range 1 to 3.`}
              </Text>
              <TouchableOpacity
                style={styles.rateRow}
                onPress={() => setOtDailyDraft(v => !v)}
                activeOpacity={0.75}
                accessibilityRole="switch"
                accessibilityState={{ checked: otDailyDraft }}
                accessibilityLabel={`Also pay overtime after ${DAILY_OVERTIME_HOURS} hours in a day`}
                testID="labor-ot-daily-toggle"
              >
                <Text style={styles.rateTradeLabel}>Also after {DAILY_OVERTIME_HOURS}h in a day</Text>
                <View style={[styles.otCheck, otDailyDraft && styles.otCheckOn]}>
                  {otDailyDraft ? <Check size={14} color="#fff" strokeWidth={2} /> : null}
                </View>
              </TouchableOpacity>
              <Text style={styles.otHint}>Payroll week starts</Text>
              <View style={styles.otWeekRow}>
                {([0, 1, 2, 3, 4, 5, 6] as Weekday[]).map(d => (
                  <TouchableOpacity
                    key={d}
                    onPress={() => setOtWeekStartDraft(d)}
                    style={[styles.alertPickerChip, styles.otWeekChip, otWeekStartDraft === d && styles.alertPickerChipActive]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: otWeekStartDraft === d }}
                    testID={`labor-ot-week-${d}`}
                  >
                    <Text style={[styles.alertPickerChipText, otWeekStartDraft === d && styles.alertPickerChipTextActive]}>{weekdayShort(d)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.otHint}>
                Overtime is every hour past 40 in a worker&apos;s payroll week
                {otDailyDraft ? `, or past ${DAILY_OVERTIME_HOURS} in one day (never both for the same hour)` : ''}, across all
                your jobs. The job he worked the late hours on carries the premium. This week&apos;s overtime is so far.
              </Text>
              {!ratesFromAccount ? (
                <Text style={styles.otHint} testID="labor-rates-device-only">
                  Not synced to your account yet. These save on this device now and go up when you&apos;re back online.
                </Text>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Correct a finished entry. See the openCorrection block above for why
          this edits hours rather than the clock stamps. */}
      <Modal visible={correcting !== null} transparent animationType="slide" onRequestClose={() => setCorrecting(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Correct entry</Text>
              <TouchableOpacity onPress={() => setCorrecting(null)} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close">
                <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            {correcting ? (
              <>
                <Text style={styles.modalSubtitle}>
                  {/* formatCalendarDay, not new Date(): a bare 'YYYY-MM-DD'
                      read by new Date() is UTC midnight — west of Greenwich
                      the day before. timeEntryDay, not correcting.date: rows
                      written before field-ops #9 carry the UTC day, so an
                      evening shift would name tomorrow. Same day the history
                      row shows. */}
                  {correcting.workerName} · {correcting.trade || 'Crew'} · {formatCalendarDay(timeEntryDay(correcting), { weekday: 'short', month: 'short', day: 'numeric' })}
                </Text>

                <View style={styles.rateRow}>
                  <Text style={styles.rateTradeLabel}>Hours worked</Text>
                  <View style={styles.rateInputWrap}>
                    <TextInput
                      style={styles.rateInput}
                      value={correctHours}
                      onChangeText={setCorrectHours}
                      keyboardType="decimal-pad"
                      placeholder="0"
                      placeholderTextColor={themeColors.textMuted}
                      testID="correct-entry-hours"
                    />
                    <Text style={styles.rateInputSuffix}>h</Text>
                  </View>
                </View>

                <View style={styles.rateRow}>
                  <Text style={styles.rateTradeLabel}>Break</Text>
                  <View style={styles.rateInputWrap}>
                    <TextInput
                      style={styles.rateInput}
                      value={correctBreak}
                      onChangeText={setCorrectBreak}
                      keyboardType="number-pad"
                      placeholder="0"
                      placeholderTextColor={themeColors.textMuted}
                      testID="correct-entry-break"
                    />
                    <Text style={styles.rateInputSuffix}>min</Text>
                  </View>
                </View>

                {/* A teammate's shift: no note field. The team read never
                    downloads notes, so an empty box here would both hide his
                    note and overwrite it on save. */}
                {correctingTeam ? (
                  <Text style={styles.correctNoteHint} testID="correct-entry-note-blocked">
                    Notes belong to the person who logged the shift — {correctingTeam}&apos;s note stays as they wrote it.
                  </Text>
                ) : (
                  <TextInput
                    style={styles.correctNoteInput}
                    value={correctNote}
                    onChangeText={setCorrectNote}
                    placeholder="Note (why it changed)"
                    placeholderTextColor={themeColors.textMuted}
                    multiline
                    testID="correct-entry-note"
                  />
                )}

                {/* Honesty: name exactly what this does and does not change.
                    The punch stamps stay as recorded because the hook cannot
                    persist an edited one (see openCorrection). */}
                <Text style={styles.correctNoteHint}>
                  Clock-in and clock-out stay as they were punched — the record if pay is
                  ever disputed. When the hours no longer match them, the entry is marked
                  Adjusted here and in the payroll export. Hours are what payroll and your
                  cost book read — overtime is worked out from each worker&apos;s week under
                  your overtime rule ({describeOvertimeRule(overtimeRule)}).
                  {correctingTeam ? ` This shift was logged by ${correctingTeam}; it stays theirs, only its hours change.` : ''}
                </Text>

                <TouchableOpacity
                  style={styles.correctSaveBtn}
                  onPress={handleSaveCorrection}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  testID="correct-entry-save"
                >
                  <Check size={16} color="#fff" strokeWidth={2} />
                  <Text style={styles.correctSaveBtnText}>Save correction</Text>
                </TouchableOpacity>

                {correctingTeam ? (
                  // Someone else's record: correct its hours, don't erase it.
                  <Text style={styles.correctNoteHint} testID="correct-entry-delete-blocked">
                    Only the person who logged a shift can delete it. Correct the hours instead.
                  </Text>
                ) : (
                <TouchableOpacity
                  style={styles.correctDeleteBtn}
                  onPress={handleDeleteCorrection}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  testID="correct-entry-delete"
                >
                  <Text style={styles.correctDeleteBtnText}>Delete entry</Text>
                </TouchableOpacity>
                )}
              </>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* When did he actually leave? (#66 missed clock-out, #63 closing a
          shift the foreman logged). The time is on the clock-in day unless
          "next day" is on; it can't be before the clock-in or after now. */}
      <Modal visible={outFor !== null} transparent animationType="slide" onRequestClose={() => setOutFor(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Clock-out time</Text>
              <TouchableOpacity onPress={() => setOutFor(null)} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close">
                <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            {outFor ? (
              <>
                <Text style={styles.modalSubtitle}>
                  {outFor.entry.workerName} clocked in {formatClockTime(Date.parse(outFor.entry.clockIn))} on {formatCalendarDay(timeEntryDay(outFor.entry), { weekday: 'short', month: 'short', day: 'numeric' })}.
                  {outFor.loggedBy ? ` ${outFor.loggedBy}.` : ''} When did he leave?
                </Text>
                <View style={styles.rateRow}>
                  <Text style={styles.rateTradeLabel}>Out at</Text>
                  <View style={styles.rateInputWrap}>
                    <TextInput
                      style={styles.rateInput}
                      value={outText}
                      onChangeText={setOutText}
                      placeholder="3:30 pm"
                      placeholderTextColor={themeColors.textMuted}
                      autoCapitalize="none"
                      accessibilityLabel="Clock-out time"
                      testID="out-time-input"
                    />
                  </View>
                </View>
                <View style={styles.otWeekRow}>
                  <TouchableOpacity
                    onPress={() => setOutNextDay(v => !v)}
                    style={[styles.alertPickerChip, outNextDay && styles.alertPickerChipActive]}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: outNextDay }}
                    testID="out-time-next-day"
                  >
                    <Text style={[styles.alertPickerChipText, outNextDay && styles.alertPickerChipTextActive]}>Next day</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={setOutToNow} style={styles.alertPickerChip} accessibilityRole="button" testID="out-time-now">
                    <Text style={styles.alertPickerChipText}>Now</Text>
                  </TouchableOpacity>
                </View>
                <Text style={[styles.correctNoteHint, outPreview?.problem ? { color: themeColors.dangerLabel } : null]} testID="out-time-preview">
                  {outPreview?.problem
                    ?? `Records ${outPreview?.hours.toFixed(2) ?? '0.00'} hours${outPreview && outPreview.breakMinutes > 0 ? ` after a ${outPreview.breakMinutes}-min break` : ''}. The out time is saved as the clock-out.`}
                </Text>
                <TouchableOpacity
                  style={[styles.correctSaveBtn, outPreview?.problem ? { opacity: 0.5 } : null]}
                  onPress={handleSaveOutTime}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !!outPreview?.problem }}
                  testID="out-time-save"
                >
                  <Check size={16} color="#fff" strokeWidth={2} />
                  <Text style={styles.correctSaveBtnText}>Clock out</Text>
                </TouchableOpacity>
              </>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* Payroll export: one pay period, one job or all (#64). */}
      <Modal visible={showExport} transparent animationType="slide" onRequestClose={() => setShowExport(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Export payroll CSV</Text>
              <TouchableOpacity onPress={() => setShowExport(false)} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close">
                <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            <Text style={styles.otHint}>Pay period ({weekdayShort(overtimeRule.weekStartsOn)}–{weekdayShort(((overtimeRule.weekStartsOn + 6) % 7) as Weekday)})</Text>
            <View style={styles.otWeekRow}>
              {([0, -1] as const).map(off => (
                <TouchableOpacity
                  key={off}
                  onPress={() => setExportWeekOffset(off)}
                  style={[styles.alertPickerChip, exportWeekOffset === off && styles.alertPickerChipActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: exportWeekOffset === off }}
                  testID={`export-week-${off === 0 ? 'this' : 'last'}`}
                >
                  <Text style={[styles.alertPickerChipText, exportWeekOffset === off && styles.alertPickerChipTextActive]}>{off === 0 ? 'This week' : 'Last week'}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.otHint} testID="export-period">{formatCalendarDay(exportPeriod.start, { month: 'short', day: 'numeric' })} – {formatCalendarDay(exportPeriod.end, { month: 'short', day: 'numeric', year: 'numeric' })}</Text>
            {viewProjectId ? (
              <>
                <Text style={styles.otHint}>Job</Text>
                <View style={styles.otWeekRow}>
                  <TouchableOpacity
                    onPress={() => setExportProjectId(viewProjectId)}
                    style={[styles.alertPickerChip, exportProjectId === viewProjectId && styles.alertPickerChipActive]}
                    accessibilityRole="button"
                    testID="export-job-this"
                  >
                    <Text style={[styles.alertPickerChipText, exportProjectId === viewProjectId && styles.alertPickerChipTextActive]} numberOfLines={1}>{viewProjectName ?? 'This job'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setExportProjectId(null)}
                    style={[styles.alertPickerChip, exportProjectId === null && styles.alertPickerChipActive]}
                    accessibilityRole="button"
                    testID="export-job-all"
                  >
                    <Text style={[styles.alertPickerChipText, exportProjectId === null && styles.alertPickerChipTextActive]}>All jobs</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : null}
            <Text style={styles.correctNoteHint} testID="export-summary">
              {exportBlocked
                ?? `${exportSelection.rows.length} finished shift${exportSelection.rows.length === 1 ? '' : 's'}${exportProjectName ? ` on ${exportProjectName}` : ' across all jobs'}.${exportOpenNote ? ` ${exportOpenNote}.` : ''}${exportSelection.rows.some(r => r.loggedByLabel) ? ' Shifts your team clocked on your jobs are included, named in the Logged by column.' : ''}${exportSelection.rows.some(r => !isUuid(r.projectId)) ? ' Shifts filed under no job were never synced — they are marked \u201cNot synced\u201d in the Logged by column.' : ''} Overtime by your rule (${describeOvertimeRule(overtimeRule)}).`}
            </Text>
            <TouchableOpacity
              style={[styles.correctSaveBtn, exportBlocked ? { opacity: 0.5 } : null]}
              onPress={() => { void handleExportCSV(); }}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityState={{ disabled: !!exportBlocked }}
              testID="export-run"
            >
              <FileDown size={16} color="#fff" strokeWidth={2} />
              <Text style={styles.correctSaveBtnText}>{Platform.OS === 'web' ? 'Download .csv' : 'Share .csv'}</Text>
            </TouchableOpacity>
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
  // Guardrail nudge when an entered rate looks like a bare (unloaded) wage —
  // the cost book prices labor from these numbers, so under-loaded rates
  // quietly teach it to bid low. Nudge only; never blocks the entry.
  rateBurdenNudge: {
    fontSize: Type.caption1.fontSize,
    lineHeight: 16,
    color: t.warningLabel,
    paddingTop: 6,
    paddingBottom: 2,
    paddingRight: 8,
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
  loggedByTag: { fontSize: Type.caption2.fontSize, color: t.textSecondary, marginTop: 4 },
  listGroupTitle: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: t.dangerLabel, marginBottom: 8 },
  jobFilterChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    marginHorizontal: 16, marginBottom: 10, paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: t.line, backgroundColor: t.surface, maxWidth: '90%',
  },
  jobFilterText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: t.text, flexShrink: 1 },
  blockedRow: { marginHorizontal: 16, marginTop: -4, marginBottom: 12, alignItems: 'flex-start' },
  blockedText: { fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 17 },
  adjustedBadge: { backgroundColor: t.surfaceAlt, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.xs },
  adjustedBadgeText: { fontSize: Type.caption2.fontSize, fontWeight: '600' as const, color: t.textSecondary },
  otBadge: { backgroundColor: t.warningSoft, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.xs },
  otBadgeText: { fontSize: Type.caption2.fontSize, fontWeight: '600' as const, color: t.warningLabel },
  otSectionTitle: { marginTop: 16, marginBottom: 4, fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: t.textSecondary, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  otHint: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17, marginTop: 4, marginBottom: 6 },
  otCheck: { width: 22, height: 22, borderRadius: Tokens.radius.sm, borderWidth: 1.5, borderColor: t.line, alignItems: 'center' as const, justifyContent: 'center' as const },
  otCheckOn: { backgroundColor: t.accentFill, borderColor: t.accent },
  otWeekRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 6, marginBottom: 4 },
  otWeekChip: { paddingHorizontal: 10, paddingVertical: 6 },
  historyHint: { fontSize: Type.caption1.fontSize, color: t.textMuted, textAlign: 'center' as const, marginTop: 4, marginBottom: 8 },
  correctNoteInput: {
    marginTop: 12,
    minHeight: 64,
    borderRadius: Tokens.radius.md,
    backgroundColor: t.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.line,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: Type.subhead.fontSize,
    color: t.text,
    textAlignVertical: 'top' as const,
  },
  correctNoteHint: { marginTop: 10, fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 17 },
  // accentFill, not accent: white on the raw brand hue is 2.87:1 and fails AA.
  correctSaveBtn: {
    marginTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: Tokens.radius.md, backgroundColor: t.accentFill,
  },
  correctSaveBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: '#FFFFFF' },
  correctDeleteBtn: { marginTop: 10, paddingVertical: 12, alignItems: 'center' as const },
  correctDeleteBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: t.dangerLabel },
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
  memberCertFlags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
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
