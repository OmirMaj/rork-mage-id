import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, Platform, KeyboardAvoidingView, Modal, Image, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import {
  Plus, Trash2, X, Send, Cloud, Wind, Thermometer, Camera, Users,
  HardHat, Package, AlertTriangle, Image as ImageIcon, BookUser, User,
  Home as HomeIcon, RefreshCw, Copy, CheckCircle2,
  CalendarDays, ChevronLeft, Tractor, Wrench, ChartBar, BarChart3, ClipboardList,
  ScanSearch,
  CalendarClock, ChevronDown, Link2, Minus,
} from 'lucide-react-native';
import { MageAIMark, MageDailyReport } from '@/components/icons';
import EmptyState from '@/components/EmptyState';
import DatePickerModal from '@/components/DatePickerModal';
import { Colors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { Button } from '@/components/ui/Button';
import { useProjects } from '@/contexts/ProjectContext';
import { useMaterialReceipts } from '@/hooks/useMaterialReceipts';
import ContactPickerModal from '@/components/ContactPickerModal';
import { saveDailyReportToProjectFiles } from '@/utils/projectDocuments';
import { FolderOpen } from 'lucide-react-native';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { sendEmail, buildDailyReportEmailHtml } from '@/utils/emailService';
import { useTierAccess } from '@/hooks/useTierAccess';
import VoiceRecorder from '@/components/VoiceRecorder';
import { parseDFRFromTranscript } from '@/utils/voiceDFRParser';
import AIDailyReportGen from '@/components/AIDailyReportGen';
import AIDFRFromPhotos from '@/components/AIDFRFromPhotos';
import type { ManpowerEntry, DFRPhoto, DailyFieldReport, DFRWeather, IncidentReport, IncidentSeverity, DFRWorkProgress, LeakScanRecord, ScheduleTask } from '@/types';
import { PHASE_COLORS, buildScheduleFromTasks } from '@/utils/scheduleEngine';
import { stampPhotoLocation } from '@/utils/photoGeoStamp';
import type { DailyReportGenResult } from '@/utils/aiService';
import { generateHomeownerSummary } from '@/utils/aiService';
import { nailIt } from '@/components/animations/NailItToast';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { generateUUID } from '@/utils/generateId';
import { PortalStatusPill } from '@/components/PortalStatusPill';
import { SendToClientButton } from '@/components/SendToClientButton';
import { checkAILimit, recordAIUsage, type LimitCheck } from '@/utils/aiRateLimiter';
import UpgradeSheet from '@/components/UpgradeSheet';
import { buildCostDatabase } from '@/utils/costDatabase';
import { buildScopeSummary } from '@/utils/profitLeak/scopeSummary';
import { buildLeakPrompt, coerceLeakResult, hashLeakText, LEAK_SCHEMA_HINT } from '@/utils/profitLeak/leakPrompt';
import { priceLeakItems } from '@/utils/profitLeak/priceLeakItems';
import ScheduleDiffView from '@/components/copilot/ScheduleDiffView';
import type { CopilotContext } from '@/utils/copilot/types';
import type { EditOp } from '@/utils/copilot/scheduleEdit/editOps';
import { interpretScheduleOps, applyEditEffects } from '@/utils/copilot/scheduleEdit/interpretOps';
import { applyToProjectSchedule } from '@/utils/copilot/scheduleEdit/applyToProjectSchedule';
import { runCpm } from '@/utils/cpm';
import { buildDelayPrompt, coerceDelayResult, hashDelayText, DELAY_SCHEMA_HINT, MAX_DELTA_DAYS } from '@/utils/delayScan/delayPrompt';
import { matchTaskByTitle } from '@/utils/delayScan/matchTask';
import { DELAY_APPLIED_STORE_KEY, parseAppliedDelayMap, withAppliedDelay } from '@/utils/delayScan/appliedDelays';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { mageAI } from '@/utils/mageAI';
import { recordPrediction } from '@/utils/brain/predictionLedger';
import { recordDidForYou } from '@/utils/brain/didForYou';

function createId(_prefix: string): string {
  return generateUUID();
}

/** One confirm row of the delay scan: the AI's quote + proposal, the user's
 *  confirmed task + days. taskId null = unmatched, user must pick. */
type DelayRow = { quote: string; deltaDays: number; taskId: string | null };

export default function DailyReportScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { isDesktop } = useResponsiveLayout();
  const hsStyles = useThemedStyles(makeHsStyles);
  const voiceStyles = useThemedStyles(makeVoiceStyles);
  const leakStyles = useThemedStyles(makeLeakStyles);
  const dcStyles = useThemedStyles(makeDcStyles);
  const { projectId, reportId } = useLocalSearchParams<{ projectId: string; reportId?: string }>();
  const {
    getProject, getDailyReportsForProject, addDailyReport, updateDailyReport, contacts, settings, addProjectPhoto,
    getPhotosForProject, projects, commitments, getChangeOrdersForProject, updateProject,
  } = useProjects();
  const { receipts } = useMaterialReceipts();
  const { tier } = useSubscription();
  const { isFree } = useTierAccess();
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [showVoiceBanner, setShowVoiceBanner] = useState(false);
  const [voiceLimit, setVoiceLimit] = useState<LimitCheck | null>(null);
  const [upgradeLimit, setUpgradeLimit] = useState<LimitCheck | null>(null);
  const [gateRefresh, setGateRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void checkAILimit(tier, 'fast', 'voiceCapture').then(l => { if (!cancelled) setVoiceLimit(l); });
    return () => { cancelled = true; };
  }, [tier, gateRefresh]);

  const voiceBlocked = voiceLimit ? !voiceLimit.allowed : false;
  const openVoiceUpgrade = useCallback(() => { setUpgradeLimit(voiceLimit); }, [voiceLimit]);
  // Tracks which fields the AI populated in the most recent voice
  // pass. We use this to render a "here's what I heard" preview card
  // so the GC can verify before saving — no more silent auto-fill.
  const [voiceParsed, setVoiceParsed] = useState<{
    weather?: { temperature?: string; conditions?: string };
    crewSummary?: string;          // "4 framers, 2 electricians"
    workPerformed?: string;
    materialsDelivered?: string[];
    issuesAndDelays?: string;
  } | null>(null);

  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);
  const existingReports = useMemo(() => getDailyReportsForProject(projectId ?? ''), [projectId, getDailyReportsForProject]);

  // Photos taken on the same calendar day this DFR is for (or today if new).
  // These feed both the voice parser (as additional context) and the
  // dedicated "Generate from photos" component.
  const todaysProjectPhotos = useMemo(() => {
    const all = getPhotosForProject(projectId ?? '');
    const ref = existingReports.find(r => r.id === reportId)?.date ?? new Date().toISOString();
    const refDay = new Date(ref).toDateString();
    return all.filter(p => p.timestamp && new Date(p.timestamp).toDateString() === refDay);
  }, [projectId, reportId, existingReports, getPhotosForProject]);
  const existingReport = useMemo(() => reportId ? existingReports.find(r => r.id === reportId) : null, [reportId, existingReports]);

  const [weather, setWeather] = useState<DFRWeather>(
    existingReport?.weather ?? { temperature: '', conditions: '', wind: '', isManual: true }
  );
  const [manpower, setManpower] = useState<ManpowerEntry[]>(existingReport?.manpower ?? []);
  const [workPerformed, setWorkPerformed] = useState(existingReport?.workPerformed ?? '');
  // Structured per-task progress chips. Each entry pins a task from the
  // project schedule + a percent-complete the GC observed today.
  const [workProgress, setWorkProgress] = useState<DFRWorkProgress[]>(existingReport?.workProgress ?? []);
  const [showTaskPicker, setShowTaskPicker] = useState(false);
  const [materialsDelivered, setMaterialsDelivered] = useState<string[]>(
    existingReport?.materialsDelivered ?? []
  );
  const [newMaterial, setNewMaterial] = useState('');
  const [issuesAndDelays, setIssuesAndDelays] = useState(existingReport?.issuesAndDelays ?? '');
  // Homeowner-friendly summary — AI-generated from the technical fields,
  // GC reviews / edits, then publishes to the portal as the "Latest update".
  const [homeownerSummary, setHomeownerSummary] = useState<string>(existingReport?.homeownerSummary ?? '');
  const [hsHighlights, setHsHighlights] = useState<string[]>([]);
  const [hsLookingAhead, setHsLookingAhead] = useState<string>('');
  const [hsPublished, setHsPublished] = useState<boolean>(existingReport?.homeownerSummaryPublished ?? false);
  const [hsGenerating, setHsGenerating] = useState<boolean>(false);
  const [hsGeneratedAt, setHsGeneratedAt] = useState<string | undefined>(existingReport?.homeownerSummaryGeneratedAt);
  const [leakScan, setLeakScan] = useState<LeakScanRecord | null>(existingReport?.leakScan ?? null);
  const [leakScanning, setLeakScanning] = useState<boolean>(false);
  // ─── Delay cascade (Schedule impact) ───
  const [delayRows, setDelayRows] = useState<DelayRow[] | null>(null); // null = not scanned yet
  const [delayScanning, setDelayScanning] = useState<boolean>(false);
  const [delayPreviewOps, setDelayPreviewOps] = useState<EditOp[] | null>(null);
  const [delayTaskPickerIdx, setDelayTaskPickerIdx] = useState<number | null>(null);
  const [delayApplied, setDelayApplied] = useState<boolean>(false);
  // Hash of the issues text at scan time — the rows are only valid for THIS
  // text; when the live text diverges the preview is disabled (stale guard).
  const [delayScannedHash, setDelayScannedHash] = useState<string | null>(null);
  // Persisted applied-marker for this report (mageid_delay_applied store):
  // hash of the issues text the last APPLIED ripple was scanned from. Guards
  // against re-applying the same relative move ops across sessions.
  const [appliedDelayHash, setAppliedDelayHash] = useState<string | null>(null);
  // Explicit user override: "yes, apply this same delay text again".
  const [delayReArmed, setDelayReArmed] = useState<boolean>(false);
  // Synchronous re-entry guard — state alone can't stop a double tap during
  // the checkAILimit network round-trip (two paid scans for one action).
  const delayScanBusyRef = useRef<boolean>(false);
  const [photos, setPhotos] = useState<DFRPhoto[]>(existingReport?.photos ?? []);
  const [incident, setIncident] = useState<IncidentReport>(existingReport?.incident ?? {
    hasIncident: false,
    severity: undefined,
    description: '',
    peopleInvolved: '',
    injuriesReported: false,
    medicalTreatment: false,
    oshaRecordable: false,
    correctiveAction: '',
    reportedBy: '',
  });
  const [showManpowerModal, setShowManpowerModal] = useState(false);
  const [mpTrade, setMpTrade] = useState('');
  const [mpCompany, setMpCompany] = useState('');
  const [mpHeadcount, setMpHeadcount] = useState('');
  const [mpHours, setMpHours] = useState('8');
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [showSendRecipient, setShowSendRecipient] = useState(false);
  const [sendRecipientName, setSendRecipientName] = useState('');
  const [sendRecipientEmail, setSendRecipientEmail] = useState('');
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [contactPicked, setContactPicked] = useState(false);
  // Date selection — Procore-style. The DFR's `date` field already
  // exists on the persisted record but the UI used to hardcode "now"
  // every render, making it impossible to log a report for yesterday
  // (the most common GC backfill case after a long Saturday). Tap
  // the date in the top bar to open DatePickerModal.
  const [reportDate, setReportDate] = useState<string>(() => new Date().toISOString());
  const [showDatePicker, setShowDatePicker] = useState(false);
  // When loading an existing draft, hydrate reportDate from the persisted
  // record. We use a layout-effect pattern via useEffect on the existing
  // report so re-opening yesterday's draft surfaces yesterday's date.
  // Key on existingReport?.id (not the full object) so this only runs once per
  // loaded report, not on every field update (e.g. a mid-edit leakScan write
  // creates a new object identity, which would silently revert an unsaved date).
  useEffect(() => {
    if (existingReport?.date) setReportDate(existingReport.date);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingReport?.id]);
  // Stable report id — used both for saving the DFR record and for
  // naming the PDF in the `project-documents` bucket. We derive it
  // once per existingReport identity so the same report always lands
  // at the same bucket path (overwrites in place rather than
  // littering the bucket with copies).
  const stableReportId = useMemo(
    () => existingReport?.id ?? generateUUID(),
    [existingReport?.id],
  );
  // "Save copy to project files" toggle in the Send modal — when on,
  // the rendered HTML report is uploaded as a PDF to the project's
  // documents bucket so it shows up in the shared-drive view.
  const [saveToProjectFiles, setSaveToProjectFiles] = useState(true);

  // The hero card date must reflect the report being viewed/edited — i.e.
  // the user-picked `reportDate` (which hydrates from an existing draft and
  // is editable via the date picker), NOT an unconditional "today". Pre-fix
  // this was hardcoded to `new Date()`, so opening a backfilled report
  // showed the correct date in the top bar but "today" in the hero card —
  // two different dates on the same screen. Bound to `reportDate` now so
  // both stay in sync.
  const reportDateStr = useMemo(() => {
    return new Date(reportDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }, [reportDate]);

  // "Day 35 of 103" — the project's calendar day relative to the schedule's
  // start date and total planned duration. Surfacing this on every DFR
  // hero card builds confidence that the app understands the project's
  // calendar, and gives the GC a constant pacing signal.
  const projectDayInfo = useMemo(() => {
    const start = project?.schedule?.startDate;
    const total = project?.schedule?.totalDurationDays;
    if (!start || !total || total <= 0) return null;
    const startMs = Date.parse(start);
    if (!Number.isFinite(startMs)) return null;
    const elapsedMs = Date.now() - startMs;
    const ONE_DAY = 86_400_000;
    // 1-indexed: the start day itself is "Day 1", not "Day 0".
    const day = Math.max(1, Math.min(total, Math.floor(elapsedMs / ONE_DAY) + 1));
    return { day, total };
  }, [project?.schedule?.startDate, project?.schedule?.totalDurationDays]);

  // The most recent saved report, excluding the one being edited (if any).
  // Drives the "Copy from yesterday" carry-forward affordance — the single
  // most-requested feature in DFR app reviews. Most reports repeat 80% of
  // yesterday's content (same subs, similar work areas, same crew sizes);
  // making the user re-type all of it every day is the #1 friction point
  // contractors cite in Raken / Procore reviews.
  const lastReport = useMemo(() => {
    const others = reportId ? existingReports.filter(r => r.id !== reportId) : existingReports;
    return [...others].sort((a, b) => Date.parse(b.date) - Date.parse(a.date))[0];
  }, [existingReports, reportId]);

  const [carryFormFromId, setCarryFormFromId] = useState<string | null>(null);

  const handleCarryForward = useCallback(() => {
    if (!lastReport) return;
    // Copy the fields most likely to repeat day-to-day. We DON'T copy
    // weather (auto-fetched today is more accurate) or photos (different
    // photos today) or the incident block (must be re-attested per day).
    setManpower(lastReport.manpower ?? []);
    if (lastReport.workPerformed) setWorkPerformed(lastReport.workPerformed);
    setMaterialsDelivered(lastReport.materialsDelivered ?? []);
    if (lastReport.issuesAndDelays) setIssuesAndDelays(lastReport.issuesAndDelays);
    setCarryFormFromId(lastReport.id);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    const dateLabel = new Date(lastReport.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    nailIt(`Copied from ${dateLabel}. Edit anything that's different.`);
  }, [lastReport]);

  const lastReportLabel = useMemo(() => {
    if (!lastReport) return '';
    const d = new Date(lastReport.date);
    const today = new Date();
    const diffDays = Math.round((today.getTime() - d.getTime()) / 86400000);
    if (diffDays === 1) return 'yesterday';
    if (diffDays === 0) return 'earlier today';
    if (diffDays < 7) return `${diffDays} days ago`;
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }, [lastReport]);

  // Progress meter — "X of 5 sections filled". Five tracked items because
  // five is what a contractor can hold in their head: weather, crew, work
  // performed, materials, photos. Issues + incident don't count toward
  // completion (they're "fill if relevant"). Drives a pill at the top so
  // the GC knows at a glance how close they are to a sendable report.
  const progressMeta = useMemo(() => {
    const filled = [
      (weather.temperature?.length ?? 0) > 0 || (weather.conditions?.length ?? 0) > 0,
      manpower.length > 0,
      workPerformed.trim().length > 0,
      materialsDelivered.length > 0,
      photos.length > 0,
    ];
    const done = filled.filter(Boolean).length;
    const total = filled.length;
    return { done, total, isReady: done >= 3 };
  }, [weather, manpower, workPerformed, materialsDelivered, photos]);

  const fetchWeather = useCallback(async () => {
    if (!project?.location) return;
    setWeatherLoading(true);
    try {
      const location = encodeURIComponent(project.location);
      const response = await fetch(
        `https://wttr.in/${location}?format=j1`
      );
      if (response.ok) {
        const data = await response.json();
        const current = data?.current_condition?.[0];
        if (current) {
          setWeather({
            temperature: `${current.temp_F}°F / ${current.temp_C}°C`,
            conditions: current.weatherDesc?.[0]?.value ?? 'Unknown',
            wind: `${current.windspeedMiles} mph ${current.winddir16Point}`,
            isManual: false,
          });
          console.log('[DFR] Weather fetched successfully');
        }
      }
    } catch (err) {
      console.log('[DFR] Weather fetch failed:', err);
      Alert.alert('Weather Unavailable', 'Could not fetch weather data. Please enter manually.');
    } finally {
      setWeatherLoading(false);
    }
  }, [project?.location]);

  useEffect(() => {
    if (!existingReport && project?.location) {
      void fetchWeather();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pre-fill manpower from today's scheduled tasks. The schedule already
  // tracks who's assigned (`assignedSubName` or free-text `crew`) per task
  // and roughly how many people (`crewSize`). Pre-fix this opened blank,
  // so the GC retyped the same crew that was already on screen in the
  // schedule view five minutes earlier. Idempotent — only runs once when
  // editing a fresh DFR with an empty manpower roster.
  useEffect(() => {
    if (existingReport) return;
    if (!project?.schedule || !project.schedule.tasks?.length) return;
    if (manpower.length > 0) return;

    const baseIso = project.schedule.startDate || project.createdAt;
    const baseMs = Date.parse(baseIso);
    if (!Number.isFinite(baseMs)) return;
    const dayMs = 24 * 60 * 60 * 1000;
    const todayDay = Math.floor((Date.now() - baseMs) / dayMs);

    // Gather today's live tasks — started but not finished, not done.
    const liveTasks = project.schedule.tasks.filter(t => {
      if (t.status === 'done') return false;
      if (t.isMilestone) return false; // milestones aren't crew assignments
      if (t.isLevelOfEffort || t.isSummary) return false;
      const start = t.startDay ?? 0;
      const dur = t.durationDays ?? 0;
      return start <= todayDay && start + dur > todayDay;
    });
    if (liveTasks.length === 0) return;

    // Group by trade/crew label. Headcount = sum of task.crewSize (or 1
    // when missing). The GC can edit / add / remove from the manpower
    // modal — this is a starting point, not a contract.
    const groups = new Map<string, { trade: string; company: string; headcount: number }>();
    for (const t of liveTasks) {
      const trade = (t.crew || t.assignedSubName || 'Crew').trim() || 'Crew';
      const company = (t.assignedSubName || '').trim();
      const key = `${trade.toLowerCase()}|${company.toLowerCase()}`;
      const headcount = Math.max(1, t.crewSize ?? 1);
      const prev = groups.get(key);
      if (prev) prev.headcount += headcount;
      else groups.set(key, { trade, company, headcount });
    }

    if (groups.size === 0) return;
    const seeded: ManpowerEntry[] = Array.from(groups.values()).map((g, i) => ({
      id: `seed-${Date.now()}-${i}`,
      trade: g.trade,
      company: g.company,
      headcount: g.headcount,
      hoursWorked: 8,
    }));
    setManpower(seeded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAddManpower = useCallback(() => {
    const trade = mpTrade.trim();
    if (!trade) {
      Alert.alert('Missing Trade', 'Please enter a trade name.');
      return;
    }
    const entry: ManpowerEntry = {
      id: createId('mp'),
      trade,
      company: mpCompany.trim(),
      headcount: parseInt(mpHeadcount) || 1,
      hoursWorked: parseFloat(mpHours) || 8,
    };
    setManpower(prev => [...prev, entry]);
    setMpTrade('');
    setMpCompany('');
    setMpHeadcount('');
    setMpHours('8');
    setShowManpowerModal(false);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [mpTrade, mpCompany, mpHeadcount, mpHours]);

  const handleRemoveManpower = useCallback((id: string) => {
    const entry = manpower.find(m => m.id === id);
    const label = entry ? `${entry.headcount} ${entry.trade}${entry.company ? ' · ' + entry.company : ''}` : 'this entry';
    Alert.alert(
      'Remove crew entry?',
      `Remove ${label} from today's report?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => {
          setManpower(prev => prev.filter(m => m.id !== id));
          if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
        } },
      ],
    );
  }, [manpower]);

  const handleAddMaterial = useCallback(() => {
    const mat = newMaterial.trim();
    if (!mat) return;
    setMaterialsDelivered(prev => [...prev, mat]);
    setNewMaterial('');
  }, [newMaterial]);

  const handleRemoveMaterial = useCallback((idx: number) => {
    const item = materialsDelivered[idx];
    Alert.alert(
      'Remove material?',
      item ? `Remove "${item}" from today's deliveries?` : 'Remove this material?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => {
          setMaterialsDelivered(prev => prev.filter((_, i) => i !== idx));
          if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
        } },
      ],
    );
  }, [materialsDelivered]);

  const handlePickPhoto = useCallback(async () => {
    if (photos.length >= 10) {
      Alert.alert('Limit Reached', 'Maximum 10 photos per report.');
      return;
    }
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
        allowsMultipleSelection: false,
      });
      if (!result.canceled && result.assets[0]) {
        // Library photos may have been taken anywhere / any time \u2014 we don't
        // pretend the *current* GPS reading represents where the picture was
        // taken. Geo-stamp only on camera capture, where "now" is correct.
        const photo: DFRPhoto = {
          id: createId('photo'),
          uri: result.assets[0].uri,
          timestamp: new Date().toISOString(),
        };
        setPhotos(prev => [...prev, photo]);
        if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch (err) {
      console.log('[DFR] Photo pick error:', err);
    }
  }, [photos.length]);

  const handleTakePhoto = useCallback(async () => {
    if (photos.length >= 10) {
      Alert.alert('Limit Reached', 'Maximum 10 photos per report.');
      return;
    }
    try {
      let result: ImagePicker.ImagePickerResult;
      if (Platform.OS === 'web') {
        // Camera capture is not supported on web — use image library instead.
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.7,
        });
      } else {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Permission Required', 'Camera access is needed to take photos.');
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          quality: 0.7,
        });
      }
      if (!result.canceled && result.assets[0]) {
        // Fire the GPS stamp in parallel \u2014 it has its own 3s timeout, so it
        // never blocks the photo from showing up in the report.
        const stamp = await stampPhotoLocation();
        const photo: DFRPhoto = {
          id: createId('photo'),
          uri: result.assets[0].uri,
          timestamp: new Date().toISOString(),
          ...(stamp ? {
            latitude: stamp.latitude,
            longitude: stamp.longitude,
            locationAccuracyMeters: stamp.accuracyMeters,
            locationLabel: stamp.label,
          } : null),
        };
        setPhotos(prev => [...prev, photo]);
        if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch (err) {
      console.log('[DFR] Camera error:', err);
    }
  }, [photos.length]);

  const handleRemovePhoto = useCallback((id: string) => {
    setPhotos(prev => prev.filter(p => p.id !== id));
  }, []);

  // ─── Homeowner summary generation ───
  const handleGenerateHomeownerSummary = useCallback(async () => {
    if (!project) return;
    if (!workPerformed.trim() && !manpower.length && !issuesAndDelays.trim()) {
      Alert.alert(
        'Not enough to summarize yet',
        'Fill in at least the work performed, crew, or any issues — then I can write a homeowner-friendly version.',
      );
      return;
    }
    setHsGenerating(true);
    try {
      const ownerName = project.clientPortal?.invites?.[0]?.name?.split(' ')[0];
      const result = await generateHomeownerSummary({
        id: existingReport?.id ?? 'draft',
        projectId: project.id,
        date: existingReport?.date ?? new Date().toISOString(),
        weather, manpower,
        workPerformed,
        materialsDelivered,
        issuesAndDelays,
        photos,
        status: 'draft',
        createdAt: existingReport?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, {
        projectName: project.name,
        companyName: settings?.branding?.companyName ?? 'Your contractor',
        ownerFirstName: ownerName,
        language: project.clientPortal?.homeownerLanguage,
      });
      setHomeownerSummary(result.summary);
      setHsHighlights(result.highlights ?? []);
      setHsLookingAhead(result.lookingAhead ?? '');
      setHsGeneratedAt(new Date().toISOString());
      // Generating overrides any prior published flag — GC must re-review.
      setHsPublished(false);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e) {
      Alert.alert('Could not generate', e instanceof Error ? e.message : 'Try again in a moment.');
    } finally {
      setHsGenerating(false);
    }
  }, [project, workPerformed, manpower, materialsDelivered, issuesAndDelays, photos, weather, existingReport, settings]);

  // ─── Profit Leak scan ───
  // Hash all three inputs the prompt scans so a materials-only change correctly
  // invalidates cached results and shows the 'Notes changed — re-scan' badge.
  const currentLeakHash = useMemo(
    () => hashLeakText(workPerformed, issuesAndDelays, materialsDelivered),
    [workPerformed, issuesAndDelays, materialsDelivered],
  );
  const leakIsStale = !!leakScan && leakScan.textHash !== currentLeakHash;

  const handleLeakScan = useCallback(async () => {
    if (!project) return;
    if (!project.linkedEstimate?.items?.length) {
      Alert.alert('No estimate to compare against', 'The scan flags work outside your estimate scope. Link an estimate to this project first.');
      return;
    }
    if (!workPerformed.trim() && !issuesAndDelays.trim()) {
      Alert.alert('Nothing to scan yet', "Fill in the work performed (or issues) first — that's the text the scan reads.");
      return;
    }
    // Set scanning state synchronously before any await so a double-tap finds
    // the button already disabled and cannot fire a second paid AI call.
    setLeakScanning(true);
    const limit = await checkAILimit(tier, 'fast', 'profitLeak');
    if (!limit.allowed) { setLeakScanning(false); setUpgradeLimit(limit); return; }

    try {
      const scope = buildScopeSummary(project, getChangeOrdersForProject(project.id));
      const hash = hashLeakText(workPerformed, issuesAndDelays, materialsDelivered);
      // Include a hash of the scope summary in the cacheKey so estimate / CO
      // changes also invalidate the 720h relay cache (not just text changes).
      const scopeHash = hashLeakText(scope, '', []);
      const res = await mageAI({
        prompt: buildLeakPrompt(scope, { workPerformed, issuesAndDelays, materialsDelivered }),
        tier: 'fast',
        maxTokens: 1200,
        feature: 'profitLeak',
        schemaHint: LEAK_SCHEMA_HINT,
        cacheKey: `leak_${stableReportId}_${hash}_${scopeHash}`,
        cacheHours: 720,
      });
      if (!res.success) {
        Alert.alert('Scan failed', res.error ?? 'Try again in a moment.');
        return;
      }
      const items = coerceLeakResult(res.data);
      const costDb = buildCostDatabase(projects, commitments, receipts);
      const record: LeakScanRecord = {
        items: priceLeakItems(items, costDb),
        scannedAt: new Date().toISOString(),
        textHash: hash,
      };
      setLeakScan(record);
      if (existingReport) updateDailyReport(existingReport.id, { leakScan: record });
      // G4: fire-and-forget capture — ledger failure must never break report save
      if (record.items.length > 0) {
        try {
          recordPrediction(
            'leak_flag',
            stableReportId,
            {
              reportId: stableReportId,
              items: record.items.slice(0, 12).map(it => ({
                category: it.trade,
                description: it.description,
                estPrice: it.estimatedPrice ?? null,
              })),
            },
            project?.id ?? null,
          );
        } catch { /* G4 */ }
      }
      if (!res.fromCache) void recordAIUsage('fast', 'profitLeak');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } finally {
      setLeakScanning(false);
    }
  }, [project, workPerformed, issuesAndDelays, materialsDelivered, tier, projects, commitments, receipts, getChangeOrdersForProject, existingReport, updateDailyReport, stableReportId]);

  const handleDraftLeakCO = useCallback(() => {
    if (!projectId || !leakScan || leakScan.items.length === 0) return;

    const pricedItems = leakScan.items.filter(it => it.estimatedPrice !== null && it.estimatedPrice !== undefined);
    const unpricedItems = leakScan.items.filter(it => it.estimatedPrice === null || it.estimatedPrice === undefined);
    const totalPriced = pricedItems.reduce((s, it) => s + (it.estimatedPrice ?? 0), 0);

    const when = new Date(reportDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const pricedLines = pricedItems.map(it =>
      `${it.description} (~$${(it.estimatedPrice ?? 0).toLocaleString('en-US')}${it.reportQuote ? ` — "${it.reportQuote}"` : ''})`
    );
    const unpricedLines = unpricedItems.map(it =>
      `NEEDS PRICE: ${it.description}${it.reportQuote ? ` ("${it.reportQuote}")` : ''}`
    );
    const description = `Out-of-scope work from daily report ${when}: ` +
      [...pricedLines, ...unpricedLines].join('; ');

    // Warn the GC when any flagged item has no learned price so they know to
    // fill in those line items before sending the CO.
    const doNavigate = () => router.push({
      pathname: '/change-order' as any,
      params: {
        projectId,
        prefillReason: 'out_of_scope',
        prefillDescription: description,
        prefillAmount: String(totalPriced),
      },
    });

    if (unpricedItems.length > 0) {
      Alert.alert(
        `${unpricedItems.length} flagged item${unpricedItems.length === 1 ? '' : 's'} have no learned price`,
        'Add their prices in the change order before sending. They are marked "NEEDS PRICE" in the description.',
        [
          { text: 'Review anyway', onPress: doNavigate },
          { text: 'Cancel', style: 'cancel' },
        ],
      );
    } else {
      doNavigate();
    }
  }, [projectId, leakScan, reportDate, router]);
  // ─── Delay cascade scan ───
  const scheduleTasks = useMemo<ScheduleTask[]>(() => project?.schedule?.tasks ?? [], [project]);

  // Mirrors app/(tabs)/schedule/index.tsx:283-287 — the schedule's own CPM options.
  const delayCpmOptions = useMemo(() => ({
    scheduleStartDate: project?.schedule?.startDate,
    workingDaysPerWeek: project?.schedule?.workingDaysPerWeek,
    nonWorkingDates: project?.schedule?.nonWorkingDates,
  }), [project?.schedule?.startDate, project?.schedule?.workingDaysPerWeek, project?.schedule?.nonWorkingDates]);

  // ScheduleDiffView reads exactly ctx.currentTasks + ctx.cpmOptions; the rest
  // satisfies the CopilotContext required fields (ctx is `any` by design).
  const diffCtx = useMemo<CopilotContext>(() => ({
    project: project ?? null,
    projectId: project?.id ?? '',
    ctx: null,
    tier,
    currentTasks: scheduleTasks,
    cpmOptions: delayCpmOptions,
  }), [project, tier, scheduleTasks, delayCpmOptions]);

  // Hydrate the persisted applied-delay marker for this report. Cross-session
  // guard: without it, reopening the report and re-running the (cached) scan
  // would re-offer the already-applied delay with no memory of the apply.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(DELAY_APPLIED_STORE_KEY)
      .then(raw => {
        if (cancelled) return;
        setAppliedDelayHash(parseAppliedDelayMap(raw)[stableReportId] ?? null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [stableReportId]);

  const liveDelayHash = useMemo(() => hashDelayText(issuesAndDelays), [issuesAndDelays]);
  // Rows were scanned from different text than what's on screen now.
  const delayRowsStale = delayScannedHash != null && delayScannedHash !== liveDelayHash;
  // This scan's text is exactly what was already applied to the schedule.
  const delayAlreadyApplied = delayScannedHash != null && appliedDelayHash != null
    && delayScannedHash === appliedDelayHash && !delayReArmed;
  // APPLIED pill: applied this session, or the persisted marker matches the
  // live text (report reopened after an apply, nothing edited since).
  const showAppliedPill = delayApplied || (appliedDelayHash != null && appliedDelayHash === liveDelayHash);

  // Editing the issues text invalidates an open ripple preview — its ops were
  // built from rows that no longer describe the text.
  useEffect(() => {
    if (delayScannedHash != null && hashDelayText(issuesAndDelays) !== delayScannedHash) {
      setDelayPreviewOps(null);
    }
  }, [issuesAndDelays, delayScannedHash]);

  const handleDelayScan = useCallback(async () => {
    if (!project?.schedule || scheduleTasks.length === 0) return;
    if (!issuesAndDelays.trim()) {
      Alert.alert('Nothing to scan yet', "Note the delay under Issues & Delays first — that's the text the scan reads.");
      return;
    }
    // Re-entry guard + busy state BEFORE the first await: checkAILimit is a
    // network round-trip, and a double tap in that window used to fire two
    // paid scans (and bump the daily counter twice) for one user action.
    if (delayScanBusyRef.current) return;
    delayScanBusyRef.current = true;
    setDelayScanning(true);
    setDelayPreviewOps(null);
    try {
      const limit = await checkAILimit(tier, 'fast', 'delayScan');
      if (!limit.allowed) { setUpgradeLimit(limit); return; }
      const res = await mageAI({
        prompt: buildDelayPrompt(issuesAndDelays, scheduleTasks.map(t => t.title)),
        tier: 'fast',
        maxTokens: 800,
        feature: 'delayScan',
        schemaHint: DELAY_SCHEMA_HINT,
        cacheKey: `delay_${stableReportId}_${hashDelayText(issuesAndDelays)}`,
      });
      if (!res.success) {
        // Keep the previous rows AND the applied indication intact — a failed
        // re-scan must not present an un-applied state for an applied ripple.
        Alert.alert('Scan failed', res.error ?? 'Try again in a moment.');
        return;
      }
      const scannedHash = hashDelayText(issuesAndDelays);
      const { hits } = coerceDelayResult(res.data);
      setDelayRows(hits.map(h => ({
        quote: h.quote,
        deltaDays: h.deltaDays,
        taskId: matchTaskByTitle(h.taskTitleGuess, scheduleTasks)?.id ?? null,
      })));
      setDelayScannedHash(scannedHash);
      setDelayReArmed(false);
      // Re-scanning unchanged, already-applied text keeps the applied flag;
      // new/changed text clears it. (Lives in the SUCCESS path so a failed
      // scan can't wipe the APPLIED pill.)
      setDelayApplied(appliedDelayHash != null && scannedHash === appliedDelayHash);
      if (!res.fromCache) void recordAIUsage('fast', 'delayScan');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } finally {
      delayScanBusyRef.current = false;
      setDelayScanning(false);
    }
  }, [project, scheduleTasks, issuesAndDelays, tier, stableReportId, appliedDelayHash]);

  const confirmableRows = useMemo(
    () => (delayRows ?? []).filter((r): r is DelayRow & { taskId: string } => !!r.taskId && r.deltaDays > 0),
    [delayRows],
  );

  const handlePreviewRipple = useCallback(() => {
    // Guarded in the handler too (not just the disabled prop): stale rows
    // describe text that changed since the scan, and an already-applied scan
    // must be explicitly re-armed before it can move the schedule again.
    if (confirmableRows.length === 0 || delayRowsStale || delayAlreadyApplied) return;
    setDelayPreviewOps(confirmableRows.map(r => ({ op: 'move' as const, task: r.taskId, deltaDays: r.deltaDays })));
  }, [confirmableRows, delayRowsStale, delayAlreadyApplied]);

  const handleApplyRipple = useCallback(() => {
    const schedule = project?.schedule;
    if (!project || !schedule || !delayPreviewOps) return;
    // Recompute exactly what ScheduleDiffView previewed (it computes internally
    // from ops + ctx; onApply hands us nothing).
    const { nextTasks } = interpretScheduleOps(delayPreviewOps, schedule.tasks);
    const edited = applyEditEffects(delayPreviewOps, nextTasks, delayCpmOptions);
    // persistEditedTasks pattern (app/(tabs)/schedule/index.tsx:447-473):
    // reflow startDays via CPM, re-derive the scalar fields, merge over a
    // spread of the schedule so sidecar fields (startDate, calendars,
    // scenarios, baseline, …) survive. NEVER touch schedule.startDate.
    const reflowed = applyToProjectSchedule(schedule, edited, delayCpmOptions).tasks;
    const cpmResult = runCpm(reflowed, delayCpmOptions);
    const built = buildScheduleFromTasks(
      schedule.name ?? project.name ?? 'Schedule',
      project.id,
      reflowed,
      schedule.baseline ?? null,
      { criticalPathDays: cpmResult.projectFinish },
    );
    updateProject(project.id, {
      schedule: {
        ...schedule,
        tasks: reflowed,
        totalDurationDays: built.totalDurationDays,
        criticalPathDays: built.criticalPathDays,
        healthScore: built.healthScore,
        laborAlignmentScore: built.laborAlignmentScore,
        riskItems: built.riskItems,
        updatedAt: new Date().toISOString(),
      },
    });
    setDelayPreviewOps(null);
    // Disarm the confirm rows — the ops are RELATIVE moves, so a re-tap
    // through preview→apply would shift the same tasks again.
    setDelayRows(null);
    setDelayApplied(true);
    setDelayReArmed(false);
    // Persist the applied marker (separate mageid_delay_applied store — NOT a
    // report field, which sync rehydration would wipe) so reopening the report
    // and re-scanning the same text renders "already applied" instead of
    // re-offering the same ripple.
    const appliedHash = delayScannedHash ?? hashDelayText(issuesAndDelays);
    setAppliedDelayHash(appliedHash);
    AsyncStorage.getItem(DELAY_APPLIED_STORE_KEY)
      .then(raw => AsyncStorage.setItem(
        DELAY_APPLIED_STORE_KEY,
        JSON.stringify(withAppliedDelay(parseAppliedDelayMap(raw), stableReportId, appliedHash)),
      ))
      .catch(() => {});
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    // G4: fire-and-forget capture — ledger failure must never break ripple apply
    try {
      const hits = delayPreviewOps
        .filter((op): op is { op: 'move'; task: string; deltaDays?: number; toStartDay?: number } => op.op === 'move')
        .map(op => ({ taskId: op.task, deltaDays: op.deltaDays ?? 0 }));
      recordPrediction(
        'delay_ripple_applied',
        stableReportId,
        {
          reportId: stableReportId,
          hits,
          predictedFinishDay: cpmResult.projectFinish,
        },
        project.id,
      );
    } catch { /* G4 */ }
    // Wave 6 did-for-you: one line per ripple apply
    try {
      const hitCount = delayPreviewOps.length;
      recordDidForYou(
        `Rippled ${hitCount} task${hitCount === 1 ? '' : 's'} from your delay note`,
        project.id,
      );
    } catch { /* G4 */ }
  }, [project, delayPreviewOps, delayCpmOptions, updateProject, delayScannedHash, issuesAndDelays, stableReportId]);

  const totalManpower = useMemo(() => {
    return manpower.reduce((sum, m) => sum + m.headcount, 0);
  }, [manpower]);

  // Workforce role rollup — bucket each manpower entry's `trade` into one of
  // four high-level roles (Supervisors / Skilled Labor / Operators / Other),
  // then sum headcount per bucket. Surfaces as 4 tiles above the manpower
  // entries so the GC sees the day's labor mix at a glance — the mock's
  // "premium DFR" pattern.
  const workforceByRole = useMemo(() => {
    const buckets = { supervisors: 0, skilled: 0, operators: 0, other: 0 };
    for (const m of manpower) {
      const t = (m.trade ?? '').toLowerCase();
      if (/super(visor|intend|visor)|foreman|pm|project manager|site manager/.test(t)) {
        buckets.supervisors += m.headcount;
      } else if (/operator|driver|crane|excav|loader|forklift|dozer/.test(t)) {
        buckets.operators += m.headcount;
      } else if (/laborer|helper|cleaner|generic|misc/.test(t)) {
        buckets.other += m.headcount;
      } else {
        // Default trades (Carpentry, Electrical, Plumbing, HVAC, Concrete,
        // Masonry, Roofing, Drywall, Painting, Framer, etc.) → skilled.
        buckets.skilled += m.headcount;
      }
    }
    return buckets;
  }, [manpower]);

  const totalManHours = useMemo(() => {
    return manpower.reduce((sum, m) => sum + (m.headcount * m.hoursWorked), 0);
  }, [manpower]);

  const handleSave = useCallback((status: 'draft' | 'sent', recipientName?: string, recipientEmail?: string) => {
    if (!projectId) return;

    const now = new Date().toISOString();
    const recipientInfo = recipientName ? ` to ${recipientName}${recipientEmail ? ` (${recipientEmail})` : ''}` : '';

    const incidentPayload: IncidentReport | undefined = incident.hasIncident
      ? {
          ...incident,
          description: (incident.description ?? '').trim(),
          peopleInvolved: (incident.peopleInvolved ?? '').trim(),
          correctiveAction: (incident.correctiveAction ?? '').trim(),
          reportedBy: (incident.reportedBy ?? '').trim(),
          reportedAt: incident.reportedAt ?? now,
        }
      : undefined;

    if (existingReport) {
      updateDailyReport(existingReport.id, {
        date: reportDate,  // honor the user-picked date on edit too
        weather,
        manpower,
        workPerformed: workPerformed.trim(),
        workProgress: workProgress.length > 0 ? workProgress : undefined,
        materialsDelivered,
        issuesAndDelays: issuesAndDelays.trim(),
        photos,
        status,
        incident: incidentPayload,
        homeownerSummary: homeownerSummary.trim() || undefined,
        homeownerSummaryGeneratedAt: hsGeneratedAt,
        homeownerSummaryPublished: hsPublished,
        leakScan: leakScan ?? undefined,
      });
      // Mirror NEW photos into the project gallery on edit too — previously
      // this only happened in the create branch, so photos added while
      // editing an existing report never reached the gallery. Diff against
      // the report's already-saved photo ids so we don't re-add (duplicate)
      // photos that were mirrored on the original save. Same payload shape
      // as the create branch below.
      const alreadyMirrored = new Set((existingReport.photos ?? []).map(p => p.id));
      for (const p of photos) {
        if (alreadyMirrored.has(p.id)) continue;
        addProjectPhoto({
          id: p.id,
          projectId,
          uri: p.uri,
          timestamp: p.timestamp,
          tag: 'Daily Report',
          createdAt: p.timestamp,
        });
      }
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Updated', `Daily report has been ${status === 'sent' ? `sent${recipientInfo}` : 'saved to project'}.`);
    } else {
      const report: DailyFieldReport = {
        id: stableReportId,  // stable id — also used as the PDF filename
                             // in the project-documents bucket so re-saves
                             // overwrite in place
        projectId,
        date: reportDate,  // user-picked date instead of "now" — pre-fix
                           // a report typed on Tuesday for Monday's work
                           // was misfiled as Tuesday's record
        weather,
        manpower,
        workPerformed: workPerformed.trim(),
        workProgress: workProgress.length > 0 ? workProgress : undefined,
        materialsDelivered,
        issuesAndDelays: issuesAndDelays.trim(),
        photos,
        status,
        incident: incidentPayload,
        homeownerSummary: homeownerSummary.trim() || undefined,
        homeownerSummaryGeneratedAt: hsGeneratedAt,
        homeownerSummaryPublished: hsPublished,
        leakScan: leakScan ?? undefined,
        createdAt: now,
        updatedAt: now,
      };
      addDailyReport(report);
      // Sync DFR photos into project photo gallery
      for (const p of photos) {
        addProjectPhoto({
          id: p.id,
          projectId,
          uri: p.uri,
          timestamp: p.timestamp,
          tag: 'Daily Report',
          createdAt: p.timestamp,
        });
      }
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // The hammer-strike toast confirms without blocking the back nav.
      nailIt(status === 'sent' ? `Daily report sent${recipientInfo}` : 'Daily report saved.');
    }
    router.back();
  }, [projectId, weather, manpower, workPerformed, workProgress, materialsDelivered, issuesAndDelays, photos, incident, existingReport, homeownerSummary, hsGeneratedAt, hsPublished, leakScan, addDailyReport, updateDailyReport, addProjectPhoto, router, reportDate, stableReportId]);

  const handleSendPress = useCallback(() => {
    setShowSendRecipient(true);
  }, []);

  const handleConfirmSend = useCallback(async () => {
    // Pre-fix the only "send" target was email and a blank email
    // hard-blocked the modal. Now: email is optional when "Save to
    // project files" is on — a GC who just wants the PDF in the
    // shared drive without emailing it should be able to skip the
    // recipient.
    const wantsEmail = sendRecipientEmail.trim().length > 0;
    if (!wantsEmail && !saveToProjectFiles) {
      Alert.alert(
        'Pick a destination',
        'Either enter a recipient email, toggle "Save to project files", or both.',
      );
      return;
    }
    setShowSendRecipient(false);

    if (wantsEmail) {
      const branding = settings.branding ?? { companyName: '', contactName: '', email: '', phone: '', address: '', licenseNumber: '', tagline: '' };
      const weatherForEmail = {
        condition: typeof weather.conditions === 'string' ? weather.conditions : 'N/A',
        tempHigh: parseInt(String(weather.temperature)) || 0,
        tempLow: parseInt(String(weather.temperature)) || 0,
      };
      const html = buildDailyReportEmailHtml({
        companyName: branding.companyName,
        recipientName: sendRecipientName,
        projectName: project?.name ?? 'Project',
        date: reportDate,  // honor the user-picked date in the email body
        weather: weatherForEmail,
        totalManpower,
        totalManHours,
        workPerformed: workPerformed.trim(),
        issuesAndDelays: issuesAndDelays.trim(),
        contactName: branding.contactName,
        contactEmail: branding.email,
        growthBadge: isFree,
      });

      const result = await sendEmail({
        to: sendRecipientEmail.trim(),
        subject: `Daily report · ${new Date(reportDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · ${project?.name ?? 'Project'}`,
        html,
        replyTo: branding.email || undefined,
        fromCompanyName: branding.companyName || undefined,
        unsubscribe: { recipientEmail: sendRecipientEmail.trim(), eventKey: 'daily_report', enabled: true },
      });

      if (!result.success) {
        if (result.error === 'cancelled') {
          return;
        }
        console.warn('[DailyReport] Email send failed:', result.error);
        Alert.alert('Email Notice', `Report saved but email could not be sent: ${result.error}`);
        return;
      } else {
        console.log('[DailyReport] Email sent successfully');
      }
    }

    // Save the rendered report to the project's shared-drive folder
    // when the toggle is on. Pre-fix the only persistence beyond the
    // structured DailyFieldReport record was the ephemeral email — if
    // the recipient lost it or the GC needed to forward it later, it
    // didn't exist anywhere accessible. Now: a copy lives at
    // project-documents/<projectId>/daily-reports/<reportId>.pdf.
    // We use stableReportId (not existingReport.id) so even a brand-
    // new DFR can be saved to project files on the very first send.
    if (saveToProjectFiles && projectId) {
      try {
        const branding = settings.branding ?? { companyName: '', contactName: '', email: '', phone: '', address: '', licenseNumber: '', tagline: '' };
        const weatherForFile = {
          condition: typeof weather.conditions === 'string' ? weather.conditions : 'N/A',
          tempHigh: parseInt(String(weather.temperature)) || 0,
          tempLow: parseInt(String(weather.temperature)) || 0,
        };
        const html = buildDailyReportEmailHtml({
          companyName: branding.companyName,
          recipientName: '',
          projectName: project?.name ?? 'Project',
          date: reportDate,
          weather: weatherForFile,
          totalManpower,
          totalManHours,
          workPerformed: workPerformed.trim(),
          issuesAndDelays: issuesAndDelays.trim(),
          contactName: branding.contactName,
          contactEmail: branding.email,
        });
        const dateLabel = new Date(reportDate).toISOString().slice(0, 10);
        await saveDailyReportToProjectFiles({
          projectId,
          reportId: stableReportId,
          html,
          fileName: `Daily Report — ${dateLabel}.pdf`,
        });
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (err) {
        // Log but don't block — the structured DFR record still saves
        // below. The user gets a non-fatal toast so they know the
        // shared-drive copy didn't land and can retry.
        console.warn('[DailyReport] Save to project files failed:', err);
        Alert.alert('Project files notice', `Sent, but the project-files copy didn't land: ${(err as Error).message}`);
      }
    }

    handleSave('sent', sendRecipientName, sendRecipientEmail);
  }, [handleSave, sendRecipientName, sendRecipientEmail, settings, project, weather, totalManpower, totalManHours, workPerformed, issuesAndDelays, reportDate, saveToProjectFiles, projectId, existingReport, isFree]);

  if (!project) {
    return (
      <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
        <Stack.Screen options={{ title: 'Daily Report' }} />
        <EmptyState
          icon={<MageDailyReport size={36} color={themeColors.accent} />}
          title="No daily report open yet"
          message="Daily field reports (DFRs) log weather, manpower, and progress on a specific project. To start one:"
          steps={[
            'Open or create a project from the Projects tab.',
            'Tap Daily Report inside the project tile grid.',
            'Voice-dictate the day or fill weather, crew, and progress fields, then submit.',
          ]}
          actionLabel="Open Projects"
          onAction={() => router.push('/(tabs)/(home)' as any)}
        />
      </View>
    );
  }

  const isLocked = existingReport?.status === 'sent';

  return (
    <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {/* Custom top bar: back arrow on the left, "Daily Report" + date
            stacked in the middle, Save Draft (text link) + Submit Report
            (filled primary) on the right. Matches the mock's top-right
            CTA pattern — "save vs submit" intent is explicit instead of
            buried in two buttons of similar weight at the bottom. */}
        <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.topBarBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
          >
            <ChevronLeft size={22} color={themeColors.text} strokeWidth={1.75} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.topBarTitleCol}
            onPress={() => setShowDatePicker(true)}
            activeOpacity={0.7}
            disabled={isLocked}
            accessibilityRole="button"
            accessibilityLabel="Change report date"
          >
            <Text style={styles.topBarTitle}>Daily Report</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={styles.topBarDate}>
                {new Date(reportDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </Text>
              {!isLocked && <CalendarDays size={11} color={themeColors.textMuted} strokeWidth={1.75} />}
            </View>
          </TouchableOpacity>
          {!isLocked ? (
            <View style={styles.topBarActions}>
              <Button
                label="Save Draft"
                onPress={() => handleSave('draft')}
                variant="secondary"
                size="sm"
                testID="save-draft-btn"
              />
              <Button
                label="Submit"
                onPress={handleSendPress}
                size="sm"
                testID="submit-report-btn"
              />
            </View>
          ) : (
            <View style={styles.topBarActions}>
              <View style={[styles.statusBadge, { backgroundColor: themeColors.successSoft, marginTop: 0 }]}>
                <Text style={[styles.statusText, { color: themeColors.success }]}>Sent</Text>
              </View>
            </View>
          )}
        </View>

        <ScrollView
          contentContainerStyle={[{ paddingBottom: insets.bottom + 32 }, isDesktop && styles.contentDesktop]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
            <VoiceRecorder
              onTranscriptReady={async (transcript) => {
                setVoiceLoading(true);
                try {
                  const parsed = await parseDFRFromTranscript(transcript, projectId ?? '', todaysProjectPhotos);
                  // Track what was filled this round — used to build the
                  // preview card so the GC can verify before saving.
                  const populated: typeof voiceParsed = {};
                  if (parsed.weather && !weather.temperature) {
                    setWeather(parsed.weather);
                    populated.weather = { temperature: parsed.weather.temperature, conditions: parsed.weather.conditions };
                  }
                  if (parsed.manpower && manpower.length === 0) {
                    setManpower(parsed.manpower);
                    const total = parsed.manpower.reduce((s, m) => s + (m.headcount ?? 0), 0);
                    const trades = parsed.manpower.map(m => `${m.headcount ?? 0} ${m.trade?.toLowerCase() ?? 'workers'}`).join(', ');
                    populated.crewSummary = total > 0 ? trades : undefined;
                  }
                  if (parsed.workPerformed && !workPerformed) {
                    setWorkPerformed(parsed.workPerformed);
                    populated.workPerformed = parsed.workPerformed;
                  }
                  if (parsed.materialsDelivered && materialsDelivered.length === 0) {
                    setMaterialsDelivered(parsed.materialsDelivered);
                    populated.materialsDelivered = parsed.materialsDelivered;
                  }
                  if (parsed.issuesAndDelays && !issuesAndDelays) {
                    setIssuesAndDelays(parsed.issuesAndDelays);
                    populated.issuesAndDelays = parsed.issuesAndDelays;
                  }
                  setVoiceParsed(Object.keys(populated).length > 0 ? populated : null);
                  setShowVoiceBanner(true);
                  await recordAIUsage('fast', 'voiceCapture');
                  setGateRefresh(n => n + 1);
                  if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
                  console.log('[DFR] Voice auto-fill complete');
                } catch (err) {
                  console.log('[DFR] Voice parse error:', err);
                  Alert.alert(
                    'Could not understand the recording',
                    'The transcription service may be slow or down. Try recording again, or fill in the report by hand.',
                  );
                } finally {
                  setVoiceLoading(false);
                }
              }}
              isLoading={voiceLoading}
              isLocked={voiceBlocked}
              onLockedPress={openVoiceUpgrade}
              title="Dictate today's report"
              contextLine={project?.name ? `for ${project.name}` : undefined}
              suggestions={[
                'Crew arrived at 7:30, framed the back wall, finished around 4 PM',
                "Joe's Plumbing on site for rough-in — three guys, three hours",
                'Concrete pour delayed thirty minutes due to rain',
                'Inspector signed off on electrical rough-in this morning',
                'Delivered ten sheets of drywall and two doors',
              ]}
              // Numbered topic checklist — visible to the GC while
              // dictating so they cover every section in one pass.
              // The voice parser will route each topic to the right
              // field automatically; this is just to prevent skipped
              // sections in long dictations.
              topicChecklist={[
                { label: 'Weather on site', hint: 'temp, conditions, wind — e.g. "55 and clear, light wind"' },
                { label: 'Crew on site', hint: 'who showed up, how many, what trade — e.g. "4 framers from Smith Construction"' },
                { label: 'Work performed today', hint: 'concrete tasks completed — be specific' },
                { label: 'Materials delivered', hint: 'what arrived, from whom — e.g. "20 sheets of drywall from ABC Supply"' },
                { label: 'Issues, delays, or RFIs', hint: 'anything blocking work or needing attention' },
                { label: 'Safety incidents', hint: 'only if any — say "no incidents" if clean day' },
                { label: "Tomorrow's plan", hint: 'what crews and tasks are scheduled (optional)' },
              ]}
            />
          </View>

          {showVoiceBanner && voiceParsed && (
            <View style={voiceStyles.previewCard}>
              <View style={voiceStyles.previewHead}>
                <MageAIMark size={14} color={themeColors.accent} />
                <Text style={voiceStyles.previewTitle}>Here&apos;s what I heard</Text>
                <TouchableOpacity onPress={() => { setShowVoiceBanner(false); setVoiceParsed(null); }} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
                  <X size={14} color={themeColors.textMuted} strokeWidth={1.75} />
                </TouchableOpacity>
              </View>
              <Text style={voiceStyles.previewHelper}>
                Review each row below — tap any field in the form to edit. Anything you had already typed wasn&apos;t overwritten.
              </Text>
              <View style={voiceStyles.previewList}>
                {voiceParsed.weather && (
                  <VoiceRow label="Weather" value={[voiceParsed.weather.conditions, voiceParsed.weather.temperature].filter(Boolean).join(' · ') || '—'} />
                )}
                {voiceParsed.crewSummary && (
                  <VoiceRow label="Crew" value={voiceParsed.crewSummary} />
                )}
                {voiceParsed.workPerformed && (
                  <VoiceRow label="Work performed" value={voiceParsed.workPerformed.length > 90 ? voiceParsed.workPerformed.slice(0, 90) + '…' : voiceParsed.workPerformed} />
                )}
                {voiceParsed.materialsDelivered && voiceParsed.materialsDelivered.length > 0 && (
                  <VoiceRow label="Materials" value={voiceParsed.materialsDelivered.join(', ')} />
                )}
                {voiceParsed.issuesAndDelays && (
                  <VoiceRow label="Issues" value={voiceParsed.issuesAndDelays.length > 90 ? voiceParsed.issuesAndDelays.slice(0, 90) + '…' : voiceParsed.issuesAndDelays} valueColor={themeColors.danger} />
                )}
              </View>
            </View>
          )}

          {showVoiceBanner && !voiceParsed && (
            <TouchableOpacity
              style={{ marginHorizontal: 16, marginBottom: 8, backgroundColor: themeColors.info, borderRadius: Tokens.radius.md, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}
              onPress={() => setShowVoiceBanner(false)}
              activeOpacity={0.7}
            >
              <Text style={{ flex: 1, fontSize: Type.footnote.fontSize, color: themeColors.info }}>Nothing new picked up — the fields you already had stay as-is.</Text>
              <X size={14} color={themeColors.info} strokeWidth={1.75} />
            </TouchableOpacity>
          )}

          {!existingReport && todaysProjectPhotos.length > 0 && (
            <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
              <AIDFRFromPhotos
                projectName={project.name}
                weatherStr={[weather.conditions, weather.temperature].filter(Boolean).join(' · ') || 'Clear'}
                photos={todaysProjectPhotos}
                isLocked={voiceBlocked}
                onLockedPress={openVoiceUpgrade}
                onGenerated={(parsed) => {
                  if (parsed.weather && !weather.temperature) setWeather({ ...parsed.weather, isManual: false });
                  if (parsed.manpower && manpower.length === 0) setManpower(parsed.manpower);
                  if (parsed.workPerformed && !workPerformed) setWorkPerformed(parsed.workPerformed);
                  if (parsed.materialsDelivered && materialsDelivered.length === 0) setMaterialsDelivered(parsed.materialsDelivered);
                  if (parsed.issuesAndDelays && !issuesAndDelays) setIssuesAndDelays(parsed.issuesAndDelays);
                  setShowVoiceBanner(true);
                  recordAIUsage('fast', 'voiceCapture').then(() => setGateRefresh(n => n + 1));
                }}
              />
            </View>
          )}

          {!existingReport && project.schedule && project.schedule.tasks.length > 0 && (
            <View style={{ paddingHorizontal: 16, marginBottom: 4 }}>
              <AIDailyReportGen
                projectName={project.name}
                tasks={project.schedule.tasks}
                weatherStr={weather.conditions || 'Clear'}
                isLocked={voiceBlocked}
                onLockedPress={openVoiceUpgrade}
                onGenerated={(result: DailyReportGenResult) => {
                  if (result.workCompleted.length > 0 || result.workInProgress.length > 0) {
                    const workText = [
                      ...result.workCompleted.map(w => `[Completed] ${w}`),
                      ...result.workInProgress.map(w => `[In Progress] ${w}`),
                    ].join('\n');
                    setWorkPerformed(workText);
                  }
                  if (result.issuesAndDelays.length > 0) {
                    setIssuesAndDelays(result.issuesAndDelays.join('\n'));
                  }
                  if (result.crewsOnSite.length > 0 && manpower.length === 0) {
                    const entries: ManpowerEntry[] = result.crewsOnSite.map((c, idx) => ({
                      id: createId('mp'),
                      trade: c.trade,
                      company: '',
                      headcount: c.count,
                      hoursWorked: 8,
                    }));
                    setManpower(entries);
                  }
                  setShowVoiceBanner(true);
                }}
              />
            </View>
          )}

          <View style={styles.heroCard}>
            <Text style={styles.heroLabel}>Daily Field Report</Text>
            <Text style={styles.heroProject}>{project.name}</Text>
            <Text style={styles.heroDate}>{reportDateStr}</Text>
            {projectDayInfo && (
              <View style={styles.heroDayRow}>
                <CalendarDays size={13} color={themeColors.textMuted} strokeWidth={1.75} />
                <Text style={styles.heroDayText}>
                  Day {projectDayInfo.day} of {projectDayInfo.total}
                </Text>
              </View>
            )}
            {existingReport && (
              <View style={[styles.statusBadge, { backgroundColor: existingReport.status === 'sent' ? themeColors.successSoft : themeColors.line }]}>
                <Text style={[styles.statusText, { color: existingReport.status === 'sent' ? themeColors.success : themeColors.textSecondary }]}>
                  {existingReport.status === 'sent' ? 'Sent' : 'Saved'}
                </Text>
              </View>
            )}
          </View>

          {existingReport && (
            <View style={{ paddingHorizontal: 16 }}>
              <PortalStatusPill portalState={existingReport.portalState} itemUpdatedAt={existingReport.updatedAt} />
            </View>
          )}

          {/* Progress + carry-forward toolbar — sits between the hero and
              the section forms. Progress pill on the left tells the GC how
              close they are to a sendable report; "Copy from <last>" pill
              on the right loads the last report's manpower / work / mats
              / issues so the user only has to edit the deltas. The single
              most-requested DFR feature in user reviews. */}
          <View style={styles.dfrToolbar}>
            <View style={[
              styles.progressPill,
              progressMeta.isReady ? styles.progressPillReady : null,
            ]}>
              {progressMeta.isReady ? (
                <CheckCircle2 size={14} color={themeColors.success} strokeWidth={2.2} />
              ) : null}
              <Text style={[
                styles.progressPillText,
                progressMeta.isReady ? { color: themeColors.success } : null,
              ]}>
                {progressMeta.done} of {progressMeta.total} filled
                {progressMeta.isReady ? ' · ready to send' : ''}
              </Text>
            </View>
            {!isLocked && lastReport && !carryFormFromId && (
              <TouchableOpacity
                style={styles.carryBtn}
                onPress={handleCarryForward}
                activeOpacity={0.7}
                testID="carry-forward-btn"
              >
                <Copy size={14} color={themeColors.accent} strokeWidth={2.2} />
                <Text style={styles.carryBtnText}>Copy from {lastReportLabel}</Text>
              </TouchableOpacity>
            )}
            {carryFormFromId && (
              <View style={styles.carriedBadge}>
                <CheckCircle2 size={12} color={themeColors.accent} strokeWidth={2.4} />
                <Text style={styles.carriedBadgeText}>Carried forward</Text>
              </View>
            )}
          </View>

          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Cloud size={18} color={themeColors.info} strokeWidth={1.75} />
              <Text style={styles.sectionTitle}>Weather</Text>
              {!isLocked && (
                <TouchableOpacity
                  style={styles.refreshBtn}
                  onPress={fetchWeather}
                  activeOpacity={0.7}
                  disabled={weatherLoading}
                >
                  <Text style={styles.refreshBtnText}>
                    {weatherLoading ? 'Loading...' : 'Auto-fetch'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={styles.weatherGrid}>
              <View style={styles.weatherItem}>
                <Thermometer size={14} color={themeColors.accent} strokeWidth={1.75} />
                {!isLocked ? (
                  <TextInput
                    style={styles.weatherInput}
                    value={weather.temperature}
                    onChangeText={(v) => setWeather(prev => ({ ...prev, temperature: v, isManual: true }))}
                    placeholder="72°F"
                    placeholderTextColor={themeColors.textMuted}
                  />
                ) : (
                  <Text style={styles.weatherValue}>{weather.temperature || 'N/A'}</Text>
                )}
              </View>
              <View style={styles.weatherItem}>
                <Cloud size={14} color={themeColors.info} strokeWidth={1.75} />
                {!isLocked ? (
                  <TextInput
                    style={styles.weatherInput}
                    value={weather.conditions}
                    onChangeText={(v) => setWeather(prev => ({ ...prev, conditions: v, isManual: true }))}
                    placeholder="Sunny, Cloudy..."
                    placeholderTextColor={themeColors.textMuted}
                  />
                ) : (
                  <Text style={styles.weatherValue}>{weather.conditions || 'N/A'}</Text>
                )}
              </View>
              <View style={styles.weatherItem}>
                <Wind size={14} color={themeColors.textSecondary} strokeWidth={1.75} />
                {!isLocked ? (
                  <TextInput
                    style={styles.weatherInput}
                    value={weather.wind}
                    onChangeText={(v) => setWeather(prev => ({ ...prev, wind: v, isManual: true }))}
                    placeholder="5 mph NW"
                    placeholderTextColor={themeColors.textMuted}
                  />
                ) : (
                  <Text style={styles.weatherValue}>{weather.wind || 'N/A'}</Text>
                )}
              </View>
            </View>
          </View>

          {/* Work Progress — structured per-task percent-complete chips.
              Lets the GC log "Concrete Pour 100%, Steel Erection 60%" as
              data, not free-text. Pulls candidate tasks from the project
              schedule; falls back to a helper note if no schedule exists.
              The schedule rollup + portal both consume the chips so the
              data flows downstream without re-entry. */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <BarChart3 size={18} color={themeColors.accent} strokeWidth={1.75} />
              <Text style={styles.sectionTitle}>Work Progress</Text>
              <Text style={styles.sectionTotal}>{workProgress.length > 0 ? `${workProgress.length} task${workProgress.length === 1 ? '' : 's'}` : 'What was completed today?'}</Text>
              {!isLocked && (project.schedule?.tasks?.length ?? 0) > 0 && (
                <TouchableOpacity
                  style={styles.addSmallBtn}
                  onPress={() => setShowTaskPicker(true)}
                  activeOpacity={0.7}
                  testID="add-work-progress-btn" accessibilityRole="button" accessibilityLabel="Add work">
                  <Plus size={14} color={themeColors.accent} strokeWidth={1.75} />
                </TouchableOpacity>
              )}
            </View>

            {(project.schedule?.tasks?.length ?? 0) === 0 ? (
              <Text style={styles.emptyText}>
                Build a project schedule first — Work Progress chips pull from your task list.
              </Text>
            ) : workProgress.length === 0 ? (
              <Text style={styles.emptyText}>
                No tasks logged yet — tap + to mark which schedule tasks made progress today.
              </Text>
            ) : (
              <View style={styles.progressChipGrid}>
                {workProgress.map(p => {
                  const phaseColor = PHASE_COLORS[p.phase] ?? PHASE_COLORS.General;
                  return (
                    <View key={p.taskId} style={styles.progressChip}>
                      <View style={[styles.progressChipDot, { backgroundColor: phaseColor }]} />
                      <Text style={styles.progressChipName} numberOfLines={1}>{p.taskName}</Text>
                      <View style={[styles.progressChipPctPill, { backgroundColor: phaseColor + '1A' }]}>
                        <Text style={[styles.progressChipPctText, { color: phaseColor }]}>{p.pct}%</Text>
                      </View>
                      {!isLocked && (
                        <TouchableOpacity
                          onPress={() => setWorkProgress(prev => prev.filter(x => x.taskId !== p.taskId))}
                          hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                          accessibilityRole="button"
                          accessibilityLabel="Remove"
                        >
                          <X size={14} color={themeColors.textMuted} strokeWidth={1.75} />
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })}
              </View>
            )}
          </View>

          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Users size={18} color={themeColors.accent} strokeWidth={1.75} />
              <Text style={styles.sectionTitle}>Workforce</Text>
              <Text style={styles.sectionTotal}>Total · {totalManpower}</Text>
              {!isLocked && (
                <TouchableOpacity
                  style={styles.addSmallBtn}
                  onPress={() => setShowManpowerModal(true)}
                  activeOpacity={0.7}
                  testID="add-manpower-btn" accessibilityRole="button" accessibilityLabel="Add">
                  <Plus size={14} color={themeColors.accent} strokeWidth={1.75} />
                </TouchableOpacity>
              )}
            </View>

            {/* 4-tile role rollup. Tiles render even when empty (count=0)
                so the layout doesn't shift as the GC adds entries — Apple
                pattern: skeleton stays put, the numbers fill in. */}
            <View style={styles.roleTileGrid}>
              <RoleTile icon={User} label="Supervisors" count={workforceByRole.supervisors} color="#3B82F6" />
              <RoleTile icon={HardHat} label="Skilled" count={workforceByRole.skilled} color="#10B981" />
              <RoleTile icon={Tractor} label="Operators" count={workforceByRole.operators} color="#5B6470" />
              <RoleTile icon={Users} label="Other" count={workforceByRole.other} color="#F59E0B" />
            </View>

            {totalManHours > 0 && (
              <Text style={styles.workforceTotalLine}>{totalManHours} man-hours today</Text>
            )}

            {manpower.length === 0 && (
              <Text style={styles.emptyText}>No manpower entries yet — tap + to add a crew.</Text>
            )}
            {manpower.map((entry) => (
              <View key={entry.id} style={styles.mpRow}>
                <View style={styles.mpInfo}>
                  <Text style={styles.mpTrade}>{entry.trade}</Text>
                  <Text style={styles.mpMeta}>
                    {entry.company ? `${entry.company} · ` : ''}{entry.headcount} workers · {entry.hoursWorked}h each
                  </Text>
                </View>
                {!isLocked && (
                  <TouchableOpacity onPress={() => handleRemoveManpower(entry.id)} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Delete">
                    <Trash2 size={14} color={themeColors.danger} strokeWidth={1.75} />
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>

          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <HardHat size={18} color={themeColors.accent} strokeWidth={1.75} />
              <Text style={styles.sectionTitle}>Work Performed</Text>
            </View>
            {!isLocked ? (
              <TextInput
                style={styles.textArea}
                value={workPerformed}
                onChangeText={setWorkPerformed}
                placeholder="Describe work completed today..."
                placeholderTextColor={themeColors.textMuted}
                multiline
                textAlignVertical="top"
                testID="work-performed-input"
              />
            ) : (
              <Text style={styles.readOnlyText}>{workPerformed || 'No notes.'}</Text>
            )}
          </View>

          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Package size={18} color={themeColors.accent} strokeWidth={1.75} />
              <Text style={styles.sectionTitle}>Materials Delivered</Text>
            </View>
            {!isLocked && (
              <View style={styles.addMaterialRow}>
                <TextInput
                  style={styles.materialInput}
                  value={newMaterial}
                  onChangeText={setNewMaterial}
                  placeholder="Material received..."
                  placeholderTextColor={themeColors.textMuted}
                  onSubmitEditing={handleAddMaterial}
                  returnKeyType="done"
                />
                <TouchableOpacity style={styles.addMaterialBtn} onPress={handleAddMaterial} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Add"><Plus size={16} color={themeColors.accent} strokeWidth={1.75} /></TouchableOpacity>
              </View>
            )}
            {materialsDelivered.length === 0 && (
              <Text style={styles.emptyText}>No materials delivered today.</Text>
            )}
            {materialsDelivered.map((mat, idx) => (
              <View key={idx} style={styles.materialRow}>
                <View style={styles.materialDot} />
                <Text style={styles.materialText}>{mat}</Text>
                {!isLocked && (
                  <TouchableOpacity onPress={() => handleRemoveMaterial(idx)} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Close">
                    <X size={14} color={themeColors.danger} strokeWidth={1.75} />
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>

          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <AlertTriangle size={18} color={themeColors.danger} strokeWidth={1.75} />
              <Text style={styles.sectionTitle}>Issues & Delays</Text>
            </View>
            {!isLocked ? (
              <TextInput
                style={styles.textArea}
                value={issuesAndDelays}
                onChangeText={setIssuesAndDelays}
                placeholder="Note any problems or delays..."
                placeholderTextColor={themeColors.textMuted}
                multiline
                textAlignVertical="top"
              />
            ) : (
              <Text style={styles.readOnlyText}>{issuesAndDelays || 'No issues reported.'}</Text>
            )}
          </View>

          {/* Profit Leak — scan today's notes against the estimate scope for
              unbilled out-of-scope work. AI identifies; the cost book prices. */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <ScanSearch size={18} color={themeColors.accent} strokeWidth={1.75} />
              <Text style={styles.sectionTitle}>Profit Leak</Text>
              {leakScan && !leakIsStale && (
                <View style={[leakStyles.badge, leakScan.items.length > 0 ? leakStyles.badgeFlags : leakStyles.badgeClean]}>
                  <Text style={[leakStyles.badgeText, leakScan.items.length > 0 ? leakStyles.badgeTextFlags : leakStyles.badgeTextClean]}>
                    {leakScan.items.length > 0 ? `${leakScan.items.length} ${leakScan.items.length === 1 ? 'FLAG' : 'FLAGS'}` : 'SCANNED'}
                  </Text>
                </View>
              )}
            </View>
            <Text style={leakStyles.helperText}>
              Scans today&apos;s notes against the estimate scope and prior change orders. Flags work you haven&apos;t billed — priced from your own cost history.
            </Text>

            <TouchableOpacity
              style={[leakStyles.scanBtn, leakScanning && leakStyles.scanBtnDisabled]}
              onPress={handleLeakScan}
              disabled={leakScanning}
              testID="leak-scan"
              accessibilityRole="button"
              accessibilityLabel={leakScan ? (leakIsStale ? 'Notes changed — re-scan for unbilled work' : 'Re-scan for unbilled work') : 'Scan for unbilled work'}
              accessibilityState={{ disabled: leakScanning, busy: leakScanning }}
            >
              {leakScanning ? (
                <>
                  <RefreshCw size={14} color={themeColors.accent} strokeWidth={1.75} />
                  <Text style={leakStyles.scanBtnText}>Reading today&apos;s report…</Text>
                </>
              ) : (
                <>
                  <MageAIMark size={14} color={themeColors.accent} />
                  <Text style={leakStyles.scanBtnText}>
                    {leakScan ? (leakIsStale ? 'Notes changed — re-scan' : 'Re-scan for unbilled work') : 'Scan for unbilled work'}
                  </Text>
                </>
              )}
            </TouchableOpacity>

            {leakScan && leakScan.items.length === 0 && (
              <View style={leakStyles.cleanRow}>
                <CheckCircle2 size={16} color={themeColors.success} strokeWidth={1.75} />
                <Text style={leakStyles.cleanText}>Nothing out of scope detected in this report.</Text>
              </View>
            )}

            {leakScan && leakScan.items.length > 0 && (
              <View style={leakStyles.resultBlock}>
                {leakIsStale && (
                  <Text style={leakStyles.staleHint}>Notes changed since this scan — re-scan for fresh results.</Text>
                )}
                {leakScan.items.map((item, i) => (
                  <View key={i} style={[leakStyles.itemRow, leakIsStale && leakStyles.itemRowStale]}>
                    <AlertTriangle size={14} color={leakIsStale ? themeColors.textMuted : Colors.warning} strokeWidth={1.75} style={{ marginTop: 2 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={[leakStyles.itemDesc, leakIsStale && leakStyles.itemDescStale]}>{item.description}</Text>
                      {!!item.reportQuote && <Text style={leakStyles.itemQuote}>&ldquo;{item.reportQuote}&rdquo;</Text>}
                      <Text style={leakStyles.itemMeta}>
                        {item.trade} · {item.estimatedPrice !== null
                          ? `~$${item.estimatedPrice.toLocaleString('en-US')} from your cost history`
                          : 'No price history — price it yourself'} · {item.confidence} confidence
                      </Text>
                    </View>
                  </View>
                ))}
                {/* Disable Draft-CO when scan is stale — text has changed since scan. */}
                <TouchableOpacity
                  style={[leakStyles.draftCoBtn, leakIsStale && leakStyles.draftCoBtnDisabled]}
                  onPress={leakIsStale ? undefined : handleDraftLeakCO}
                  disabled={leakIsStale}
                  testID="leak-draft-co"
                  accessibilityRole="button"
                  accessibilityLabel={(() => {
                    if (leakIsStale) return 'Re-scan first — notes changed';
                    const t = leakScan.items.reduce((s, it) => s + (it.estimatedPrice ?? 0), 0);
                    return t > 0 ? `Draft change order for approximately $${t.toLocaleString('en-US')}` : 'Draft change order';
                  })()}
                  accessibilityState={{ disabled: leakIsStale }}
                >
                  <Text style={[leakStyles.draftCoBtnText, leakIsStale && leakStyles.draftCoBtnTextDisabled]}>
                    {leakIsStale ? 'Re-scan first — notes changed' : (() => {
                      const t = leakScan.items.reduce((s, it) => s + (it.estimatedPrice ?? 0), 0);
                      return t > 0 ? `Draft change order · ~$${t.toLocaleString('en-US')}` : 'Draft change order';
                    })()}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
          {/* Delay cascade — one tap turns the delay noted above into the downstream
              schedule ripple. AI reads the text; the user confirms task + days; the
              CPM engine computes every number. */}
          {scheduleTasks.length > 0 && issuesAndDelays.trim().length > 0 && (
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <CalendarClock size={18} color={themeColors.accent} strokeWidth={1.75} />
                <Text style={styles.sectionTitle}>Schedule impact</Text>
                {showAppliedPill && (
                  <View style={dcStyles.appliedPill}>
                    <Text style={dcStyles.appliedPillText}>APPLIED</Text>
                  </View>
                )}
              </View>
              <Text style={dcStyles.helperText}>
                Reads the delays above, maps them to schedule tasks, and shows the downstream ripple — what slides, what turns critical, how the finish moves. Nothing changes until you apply it.
              </Text>

              <TouchableOpacity
                style={[dcStyles.aiBtn, delayScanning && dcStyles.aiBtnDisabled]}
                onPress={handleDelayScan}
                disabled={delayScanning}
                testID="delay-scan"
                accessibilityRole="button"
                accessibilityLabel={delayRows ? 'Re-check schedule impact' : 'Check schedule impact'}
                accessibilityState={{ disabled: delayScanning, busy: delayScanning }}
              >
                {delayScanning ? (
                  <>
                    <RefreshCw size={14} color={themeColors.accent} strokeWidth={1.75} />
                    <Text style={dcStyles.aiBtnText}>Reading the delays…</Text>
                  </>
                ) : (
                  <>
                    <MageAIMark size={14} color={themeColors.accent} />
                    <Text style={dcStyles.aiBtnText}>{delayRows ? 'Re-check schedule impact' : 'Check schedule impact'}</Text>
                  </>
                )}
              </TouchableOpacity>

              {delayRows && delayRows.length === 0 && (
                <View style={dcStyles.cleanRow}>
                  <CheckCircle2 size={16} color={themeColors.success} strokeWidth={1.75} />
                  <Text style={dcStyles.cleanText}>No delay language detected in this report.</Text>
                </View>
              )}

              {delayRows && delayRows.length > 0 && !delayPreviewOps && (
                <View style={dcStyles.rowsBlock}>
                  {delayRows.map((row, i) => {
                    const rowTask = scheduleTasks.find(t => t.id === row.taskId);
                    return (
                      <View key={i} style={[dcStyles.hitRow, delayAlreadyApplied && dcStyles.hitRowApplied]}>
                        <View style={dcStyles.hitQuoteRow}>
                          <Text style={[dcStyles.hitQuote, { flex: 1 }]}>&ldquo;{row.quote}&rdquo;</Text>
                          <TouchableOpacity
                            style={dcStyles.hitDismissBtn}
                            onPress={() => setDelayRows(rs => (rs ?? []).filter((_, j) => j !== i))}
                            disabled={delayAlreadyApplied}
                            hitSlop={8}
                            testID={`delay-dismiss-${i}`}
                            accessibilityRole="button"
                            accessibilityLabel="Dismiss this delay"
                            accessibilityState={{ disabled: delayAlreadyApplied }}
                          >
                            <X size={14} color={themeColors.textMuted} strokeWidth={1.75} />
                          </TouchableOpacity>
                        </View>
                        <View style={dcStyles.hitControls}>
                          <TouchableOpacity
                            style={dcStyles.taskPickBtn}
                            onPress={() => setDelayTaskPickerIdx(i)}
                            disabled={delayAlreadyApplied}
                            activeOpacity={0.7}
                            testID={`delay-task-${i}`}
                            accessibilityRole="button"
                            accessibilityLabel={rowTask ? `Delayed task: ${rowTask.title}` : 'Delayed task: none picked'}
                            accessibilityState={{ disabled: delayAlreadyApplied }}
                          >
                            <Link2 size={14} color={rowTask ? themeColors.accent : themeColors.textMuted} strokeWidth={1.75} />
                            <Text style={[dcStyles.taskPickText, !rowTask && { color: themeColors.textMuted }]} numberOfLines={1}>
                              {rowTask ? rowTask.title : 'Pick the delayed task'}
                            </Text>
                            <ChevronDown size={14} color={themeColors.textMuted} strokeWidth={1.75} />
                          </TouchableOpacity>
                          <View style={dcStyles.stepperRow}>
                            <TouchableOpacity
                              style={dcStyles.stepBtn}
                              onPress={() => setDelayRows(rs => (rs ?? []).map((r, j) => j === i ? { ...r, deltaDays: Math.max(1, r.deltaDays - 1) } : r))}
                              disabled={delayAlreadyApplied}
                              accessibilityRole="button" accessibilityLabel="One day less"
                              accessibilityState={{ disabled: delayAlreadyApplied }}
                            >
                              <Minus size={14} color={themeColors.text} strokeWidth={2} />
                            </TouchableOpacity>
                            <Text style={dcStyles.stepValue}>{row.deltaDays}d</Text>
                            <TouchableOpacity
                              style={dcStyles.stepBtn}
                              onPress={() => setDelayRows(rs => (rs ?? []).map((r, j) => j === i ? { ...r, deltaDays: Math.min(MAX_DELTA_DAYS, r.deltaDays + 1) } : r))}
                              disabled={delayAlreadyApplied}
                              accessibilityRole="button" accessibilityLabel="One day more"
                              accessibilityState={{ disabled: delayAlreadyApplied }}
                            >
                              <Plus size={14} color={themeColors.text} strokeWidth={2} />
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>
                    );
                  })}
                  {delayAlreadyApplied ? (
                    // This exact delay text was already applied to the schedule —
                    // re-applying would double-shift the same tasks. Explicit
                    // re-arm required to run it again.
                    <View style={dcStyles.appliedNotice}>
                      <CheckCircle2 size={15} color={themeColors.success} strokeWidth={1.75} />
                      <Text style={dcStyles.appliedNoticeText}>Already applied to the schedule.</Text>
                      <TouchableOpacity
                        style={dcStyles.reArmBtn}
                        onPress={() => setDelayReArmed(true)}
                        activeOpacity={0.7}
                        testID="delay-rearm"
                        accessibilityRole="button"
                        accessibilityLabel="Re-arm to apply this delay again"
                      >
                        <Text style={dcStyles.reArmBtnText}>Re-arm</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <>
                      {delayRowsStale && (
                        <Text style={dcStyles.staleNoticeText}>Report text changed — re-check schedule impact.</Text>
                      )}
                      <TouchableOpacity
                        style={[dcStyles.previewBtn, (confirmableRows.length === 0 || delayRowsStale) && dcStyles.previewBtnOff]}
                        onPress={handlePreviewRipple}
                        disabled={confirmableRows.length === 0 || delayRowsStale}
                        activeOpacity={0.85}
                        testID="delay-preview"
                        accessibilityRole="button"
                        accessibilityLabel="Preview the ripple"
                        accessibilityState={{ disabled: confirmableRows.length === 0 || delayRowsStale }}
                      >
                        <Text style={dcStyles.previewBtnText}>
                          {delayRowsStale
                            ? 'Re-check schedule impact first'
                            : confirmableRows.length === 0
                              ? 'Pick a task to preview the ripple'
                              : `Preview the ripple (${confirmableRows.length} ${confirmableRows.length === 1 ? 'delay' : 'delays'})`}
                        </Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              )}

              {delayPreviewOps && (
                <View style={dcStyles.diffWrap}>
                  <ScheduleDiffView
                    ops={delayPreviewOps}
                    ctx={diffCtx}
                    onApply={handleApplyRipple}
                    onDiscard={() => setDelayPreviewOps(null)}
                  />
                </View>
              )}
            </View>
          )}

          {/* Homeowner-friendly summary — AI generates from technical fields,
              GC reviews + edits, then publishes to the portal as the daily
              "Latest update" panel. The toggle for what shows in portal is
              the published flag (independent of the technical DFR being sent
              by email). */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <HomeIcon size={18} color={themeColors.accent} strokeWidth={1.75} />
              <Text style={styles.sectionTitle}>Homeowner update</Text>
              {hsPublished && (
                <View style={hsStyles.publishedPill}>
                  <Text style={hsStyles.publishedPillText}>PUBLISHED</Text>
                </View>
              )}
            </View>
            <Text style={hsStyles.helperText}>
              A short, jargon-free summary of today for the homeowner&apos;s portal. AI writes a draft from your notes above — review, edit, then publish.
            </Text>

            {!isLocked && (
              <TouchableOpacity
                style={[hsStyles.aiBtn, hsGenerating && hsStyles.aiBtnDisabled]}
                onPress={handleGenerateHomeownerSummary}
                disabled={hsGenerating}
                testID="hs-generate"
              >
                {hsGenerating ? (
                  <>
                    <RefreshCw size={14} color={themeColors.accent} strokeWidth={1.75} />
                    <Text style={hsStyles.aiBtnText}>Writing the homeowner version…</Text>
                  </>
                ) : (
                  <>
                    <MageAIMark size={14} color={themeColors.accent} />
                    <Text style={hsStyles.aiBtnText}>{homeownerSummary ? 'Re-generate from notes' : 'Generate from today\'s notes'}</Text>
                  </>
                )}
              </TouchableOpacity>
            )}

            {!isLocked ? (
              <TextInput
                style={[styles.textArea, { marginTop: 10 }]}
                value={homeownerSummary}
                onChangeText={(v) => {
                  setHomeownerSummary(v);
                  if (hsPublished) setHsPublished(false);  // edit invalidates the published copy
                }}
                placeholder='AI draft will appear here. Or write your own — "Hi Sarah, big day on site today…"'
                placeholderTextColor={themeColors.textMuted}
                multiline
                textAlignVertical="top"
                editable={!hsGenerating}
              />
            ) : (
              <Text style={styles.readOnlyText}>{homeownerSummary || 'No homeowner summary.'}</Text>
            )}

            {hsHighlights.length > 0 && (
              <View style={hsStyles.highlightsBlock}>
                <Text style={hsStyles.highlightsLabel}>Suggested bullet points</Text>
                {hsHighlights.map((h, i) => (
                  <View key={i} style={hsStyles.highlightRow}>
                    <View style={hsStyles.highlightDot} />
                    <Text style={hsStyles.highlightText}>{h}</Text>
                  </View>
                ))}
              </View>
            )}

            {hsLookingAhead && (
              <Text style={hsStyles.lookingAhead}>
                Looking ahead: {hsLookingAhead}
              </Text>
            )}

            {!isLocked && homeownerSummary.trim().length > 0 && (
              <TouchableOpacity
                style={[hsStyles.publishBtn, hsPublished && hsStyles.publishBtnPublished]}
                onPress={() => {
                  setHsPublished(p => !p);
                  if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
                }}
                testID="hs-publish-toggle"
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  {hsPublished && <CheckCircle2 size={Type.footnote.fontSize} color={themeColors.success} strokeWidth={2} />}
                  <Text style={[hsStyles.publishBtnText, hsPublished && hsStyles.publishBtnTextPublished]}>
                    {hsPublished ? 'Showing in portal' : 'Publish to portal'}
                  </Text>
                </View>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <HardHat size={18} color={themeColors.danger} strokeWidth={1.75} />
              <Text style={styles.sectionTitle}>Safety & Incident</Text>
            </View>
            {!isLocked ? (
              <>
                <TouchableOpacity
                  style={[styles.incidentToggle, incident.hasIncident && styles.incidentToggleActive]}
                  onPress={() => setIncident(p => ({ ...p, hasIncident: !p.hasIncident }))}
                  activeOpacity={0.85}
                >
                  <View style={[styles.incidentToggleDot, incident.hasIncident && styles.incidentToggleDotActive]} />
                  <Text style={[styles.incidentToggleText, incident.hasIncident && { color: themeColors.danger }]}>
                    {incident.hasIncident ? 'Incident occurred today' : 'No incidents today'}
                  </Text>
                </TouchableOpacity>

                {incident.hasIncident && (
                  <View style={styles.incidentBlock}>
                    <Text style={styles.incidentLabel}>Severity</Text>
                    <View style={styles.severityRow}>
                      {(['near_miss','minor','moderate','major','critical'] as IncidentSeverity[]).map(sev => {
                        const active = incident.severity === sev;
                        const labels: Record<IncidentSeverity, string> = {
                          near_miss: 'Near Miss', minor: 'Minor', moderate: 'Moderate', major: 'Major', critical: 'Critical',
                        };
                        return (
                          <TouchableOpacity
                            key={sev}
                            style={[styles.severityChip, active && styles.severityChipActive]}
                            onPress={() => setIncident(p => ({ ...p, severity: sev }))}
                          >
                            <Text style={[styles.severityChipText, active && styles.severityChipTextActive]}>{labels[sev]}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    <Text style={styles.incidentLabel}>What happened?</Text>
                    <TextInput
                      style={styles.textArea}
                      value={incident.description ?? ''}
                      onChangeText={val => setIncident(p => ({ ...p, description: val }))}
                      placeholder="Describe the incident..."
                      placeholderTextColor={themeColors.textMuted}
                      multiline
                      textAlignVertical="top"
                    />

                    <Text style={styles.incidentLabel}>People involved</Text>
                    <TextInput
                      style={styles.textInput}
                      value={incident.peopleInvolved ?? ''}
                      onChangeText={val => setIncident(p => ({ ...p, peopleInvolved: val }))}
                      placeholder="Names or roles"
                      placeholderTextColor={themeColors.textMuted}
                    />

                    <View style={styles.checkboxRow}>
                      <TouchableOpacity style={styles.checkboxItem} onPress={() => setIncident(p => ({ ...p, injuriesReported: !p.injuriesReported }))}>
                        <View style={[styles.checkbox, incident.injuriesReported && styles.checkboxActive]} />
                        <Text style={styles.checkboxLabel}>Injuries</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.checkboxItem} onPress={() => setIncident(p => ({ ...p, medicalTreatment: !p.medicalTreatment }))}>
                        <View style={[styles.checkbox, incident.medicalTreatment && styles.checkboxActive]} />
                        <Text style={styles.checkboxLabel}>Medical treatment</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.checkboxItem} onPress={() => setIncident(p => ({ ...p, oshaRecordable: !p.oshaRecordable }))}>
                        <View style={[styles.checkbox, incident.oshaRecordable && styles.checkboxActive]} />
                        <Text style={styles.checkboxLabel}>OSHA recordable</Text>
                      </TouchableOpacity>
                    </View>

                    <Text style={styles.incidentLabel}>Corrective action</Text>
                    <TextInput
                      style={styles.textArea}
                      value={incident.correctiveAction ?? ''}
                      onChangeText={val => setIncident(p => ({ ...p, correctiveAction: val }))}
                      placeholder="Immediate fixes, training, policy changes..."
                      placeholderTextColor={themeColors.textMuted}
                      multiline
                      textAlignVertical="top"
                    />

                    <Text style={styles.incidentLabel}>Reported by</Text>
                    <TextInput
                      style={styles.textInput}
                      value={incident.reportedBy ?? ''}
                      onChangeText={val => setIncident(p => ({ ...p, reportedBy: val }))}
                      placeholder="Your name / role"
                      placeholderTextColor={themeColors.textMuted}
                    />
                  </View>
                )}
              </>
            ) : (
              <Text style={styles.readOnlyText}>
                {incident.hasIncident
                  ? `${incident.severity?.replace('_', ' ').toUpperCase()} — ${incident.description || 'No description.'}`
                  : 'No incidents reported.'}
              </Text>
            )}
          </View>

          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <ImageIcon size={18} color={themeColors.accent} strokeWidth={1.75} />
              <Text style={styles.sectionTitle}>Photos ({photos.length}/10)</Text>
            </View>
            {!isLocked && (
              <View style={styles.photoActions}>
                {Platform.OS !== 'web' && (
                  <TouchableOpacity style={styles.photoBtn} onPress={handleTakePhoto} activeOpacity={0.7}>
                    <Camera size={16} color={themeColors.accent} strokeWidth={1.75} />
                    <Text style={styles.photoBtnText}>Take Photo</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.photoBtn} onPress={handlePickPhoto} activeOpacity={0.7}>
                  <ImageIcon size={16} color={themeColors.accent} strokeWidth={1.75} />
                  <Text style={styles.photoBtnText}>From Library</Text>
                </TouchableOpacity>
              </View>
            )}
            {photos.length === 0 && (
              <Text style={styles.emptyText}>No photos attached.</Text>
            )}
            {photos.length > 0 && (
              <View style={styles.photoGrid}>
                {photos.map((photo) => (
                  <View key={photo.id} style={styles.photoCard}>
                    {/* Render the actual captured/library photo. photoCard is a
                        fixed 80x80 with overflow:hidden, so cover-fit fills the
                        tile. The capture time sits in a small overlay caption
                        at the bottom so the GC can still read it at a glance. */}
                    <Image
                      source={{ uri: photo.uri }}
                      style={styles.photoImage}
                      resizeMode="cover"
                    />
                    <View style={styles.photoTimestampOverlay}>
                      <Text style={styles.photoTimestampOverlayText} numberOfLines={1}>
                        {new Date(photo.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                      </Text>
                    </View>
                    {!isLocked && (
                      <TouchableOpacity
                        style={styles.photoRemoveBtn}
                        onPress={() => handleRemovePhoto(photo.id)}
                        activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Close">
                        <X size={12} color={themeColors.danger} strokeWidth={1.75} />
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </View>
            )}
          </View>

          {existingReport && (
            <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
              <SendToClientButton
                kind="daily_report"
                itemId={existingReport.id}
                projectId={existingReport.projectId}
                portalState={existingReport.portalState}
                itemUpdatedAt={existingReport.updatedAt}
                canSend={workPerformed.trim().length > 0 || manpower.length > 0}
                canSendReason={workPerformed.trim().length === 0 && manpower.length === 0 ? 'Add work performed or crew before sending.' : undefined}
              />
            </View>
          )}
        </ScrollView>

        {/* Bottom save bar removed — Save Draft + Submit now live in the
            top bar where the Apple-style mock places them. */}
      </KeyboardAvoidingView>

      <Modal visible={showSendRecipient} transparent animationType="slide" onRequestClose={() => setShowSendRecipient(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalCard, { paddingBottom: insets.bottom + 16 }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Send Report To</Text>
                <TouchableOpacity onPress={() => setShowSendRecipient(false)} accessibilityRole="button" accessibilityLabel="Close">
                  <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
                </TouchableOpacity>
              </View>

              {contactPicked ? (
                <View style={styles.selectedRecipientCard}>
                  <User size={16} color={themeColors.accent} strokeWidth={1.75} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.selectedRecipientName}>{sendRecipientName}</Text>
                    {sendRecipientEmail ? <Text style={styles.selectedRecipientEmail}>{sendRecipientEmail}</Text> : null}
                  </View>
                  <TouchableOpacity onPress={() => { setSendRecipientName(''); setSendRecipientEmail(''); setContactPicked(false); }} style={styles.clearRecipientBtn} accessibilityRole="button" accessibilityLabel="Close">
                    <X size={12} color={themeColors.textMuted} strokeWidth={1.75} />
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <Text style={styles.modalFieldLabel}>Recipient Name</Text>
                  <TextInput
                    style={styles.modalInput}
                    value={sendRecipientName}
                    onChangeText={setSendRecipientName}
                    placeholder="Enter name or pick from contacts"
                    placeholderTextColor={themeColors.textMuted}
                  />
                  <Text style={styles.modalFieldLabel}>Email</Text>
                  <TextInput
                    style={styles.modalInput}
                    value={sendRecipientEmail}
                    onChangeText={setSendRecipientEmail}
                    placeholder="email@example.com"
                    placeholderTextColor={themeColors.textMuted}
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                  {contacts.length > 0 && (
                    <TouchableOpacity
                      style={styles.pickContactBtn}
                      onPress={() => { setShowSendRecipient(false); setTimeout(() => setShowContactPicker(true), 350); }}
                      activeOpacity={0.7}
                    >
                      <BookUser size={14} color={themeColors.accent} strokeWidth={1.75} />
                      <Text style={styles.pickContactText}>Pick from Contacts</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}

              {/* Save-to-project-files toggle — Procore-style "drop a
                  copy in the project drive" path. Defaults to on so a
                  GC who hits Send always has a project-side copy
                  regardless of whether the email lands. Tapping the
                  whole row flips the toggle (bigger touch target than
                  the switch alone). */}
              <TouchableOpacity
                style={styles.toggleRow}
                onPress={() => setSaveToProjectFiles(v => !v)}
                activeOpacity={0.7}
                accessibilityRole="switch"
                accessibilityState={{ checked: saveToProjectFiles }}
              >
                <View style={styles.toggleIconWrap}>
                  <FolderOpen size={16} color={themeColors.accent} strokeWidth={1.75} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.toggleTitle}>Save copy to project files</Text>
                  <Text style={styles.toggleSub}>
                    Drops a PDF into {project?.name ?? 'this project'}&apos;s shared drive at
                    {' '}<Text style={{ fontWeight: '600' as const }}>Daily Reports / {new Date(reportDate).toISOString().slice(0, 10)}.pdf</Text>
                  </Text>
                </View>
                <View style={[styles.toggleSwitch, saveToProjectFiles && styles.toggleSwitchOn]}>
                  <View style={[styles.toggleKnob, saveToProjectFiles && styles.toggleKnobOn]} />
                </View>
              </TouchableOpacity>

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                <TouchableOpacity style={styles.saveDraftBtn} onPress={() => setShowSendRecipient(false)} activeOpacity={0.7}>
                  <Text style={styles.saveDraftBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.sendBtn} onPress={handleConfirmSend} activeOpacity={0.7}>
                  <Send size={16} color={"#FFFFFF"} strokeWidth={1.75} />
                  <Text style={styles.sendBtnText}>
                    {sendRecipientEmail.trim() ? 'Send' : (saveToProjectFiles ? 'Save' : 'Send')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Date picker — opened from the top-bar title row. Defaults to
          today, blocks future dates, lets the GC backfill any day in
          the past 5 years. */}
      <DatePickerModal
        visible={showDatePicker}
        value={reportDate}
        onClose={() => setShowDatePicker(false)}
        onChange={setReportDate}
        title="Report date"
      />

      <ContactPickerModal
        visible={showContactPicker}
        onClose={() => { setShowContactPicker(false); setTimeout(() => setShowSendRecipient(true), 350); }}
        contacts={contacts}
        title="Select Recipient"
        onSelect={(contact) => {
          const name = `${contact.firstName} ${contact.lastName}`.trim() || contact.companyName;
          setSendRecipientName(name);
          setSendRecipientEmail(contact.email);
          setContactPicked(true);
          setShowContactPicker(false);
          setTimeout(() => setShowSendRecipient(true), 350);
        }}
      />

      {/* Task picker for Work Progress chips. Lists every task in the
          project schedule that isn't already on the DFR; tapping one
          adds a chip seeded at the task's current progress. The user
          can adjust pct via a quick-step row (0/25/50/75/100). */}
      <Modal visible={showTaskPicker} transparent animationType="slide" onRequestClose={() => setShowTaskPicker(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Work Progress</Text>
              <TouchableOpacity onPress={() => setShowTaskPicker(false)} accessibilityRole="button" accessibilityLabel="Close">
                <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalHelper}>Pick a task and the percent complete you observed today.</Text>
            <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 6 }} showsVerticalScrollIndicator={false}>
              {(project?.schedule?.tasks ?? [])
                .filter(t => !workProgress.some(p => p.taskId === t.id))
                .map(t => {
                  const phaseColor = PHASE_COLORS[t.phase] ?? PHASE_COLORS.General;
                  return (
                    <TouchableOpacity
                      key={t.id}
                      style={styles.pickerRow}
                      onPress={() => {
                        const fresh: DFRWorkProgress = {
                          taskId: t.id,
                          taskName: t.title || 'Untitled',
                          phase: t.phase,
                          pct: t.progress ?? 0,
                        };
                        setWorkProgress(prev => [...prev, fresh]);
                        setShowTaskPicker(false);
                      }}
                      activeOpacity={0.85}
                    >
                      <View style={[styles.pickerDot, { backgroundColor: phaseColor }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.pickerTitle} numberOfLines={1}>{t.title || 'Untitled'}</Text>
                        <Text style={styles.pickerMeta}>{t.phase} · {(t.progress ?? 0)}%</Text>
                      </View>
                      <Plus size={16} color={themeColors.accent} strokeWidth={1.75} />
                    </TouchableOpacity>
                  );
                })}
              {(project?.schedule?.tasks ?? []).filter(t => !workProgress.some(p => p.taskId === t.id)).length === 0 && (
                <Text style={styles.emptyText}>Every scheduled task is already logged.</Text>
              )}
            </ScrollView>
            {workProgress.length > 0 && (
              <>
                <Text style={[styles.modalHelper, { marginTop: 14 }]}>Adjust an existing chip&apos;s percent:</Text>
                <ScrollView style={{ maxHeight: 200 }} contentContainerStyle={{ gap: 6 }}>
                  {workProgress.map(p => {
                    const phaseColor = PHASE_COLORS[p.phase] ?? PHASE_COLORS.General;
                    return (
                      <View key={p.taskId} style={styles.pickerRow}>
                        <View style={[styles.pickerDot, { backgroundColor: phaseColor }]} />
                        <Text style={[styles.pickerTitle, { flex: 1 }]} numberOfLines={1}>{p.taskName}</Text>
                        <View style={styles.pctStepperRow}>
                          {[0, 25, 50, 75, 100].map(v => (
                            <TouchableOpacity
                              key={v}
                              onPress={() => setWorkProgress(prev => prev.map(x => x.taskId === p.taskId ? { ...x, pct: v } : x))}
                              style={[styles.pctStepBtn, p.pct === v && { backgroundColor: phaseColor, borderColor: phaseColor }]}
                            >
                              <Text style={[styles.pctStepBtnText, p.pct === v && { color: '#fff' }]}>{v}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>
                    );
                  })}
                </ScrollView>
              </>
            )}
            <TouchableOpacity style={styles.modalDoneBtn} onPress={() => setShowTaskPicker(false)} activeOpacity={0.85}>
              <Text style={styles.modalDoneBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showManpowerModal} transparent animationType="slide" onRequestClose={() => setShowManpowerModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalCard, { paddingBottom: insets.bottom + 16 }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Add Manpower</Text>
                <TouchableOpacity onPress={() => setShowManpowerModal(false)} accessibilityRole="button" accessibilityLabel="Close">
                  <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
                </TouchableOpacity>
              </View>
              <Text style={styles.modalFieldLabel}>Trade</Text>
              <TextInput
                style={styles.modalInput}
                value={mpTrade}
                onChangeText={setMpTrade}
                placeholder="e.g. Electrician, Plumber..."
                placeholderTextColor={themeColors.textMuted}
              />
              <Text style={styles.modalFieldLabel}>Company / Sub</Text>
              <TextInput
                style={styles.modalInput}
                value={mpCompany}
                onChangeText={setMpCompany}
                placeholder="Company name (optional)"
                placeholderTextColor={themeColors.textMuted}
              />
              <View style={styles.modalRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalFieldLabel}>Headcount</Text>
                  <TextInput
                    style={styles.modalInput}
                    value={mpHeadcount}
                    onChangeText={setMpHeadcount}
                    placeholder="1"
                    placeholderTextColor={themeColors.textMuted}
                    keyboardType="numeric"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalFieldLabel}>Hours Worked</Text>
                  <TextInput
                    style={styles.modalInput}
                    value={mpHours}
                    onChangeText={setMpHours}
                    placeholder="8"
                    placeholderTextColor={themeColors.textMuted}
                    keyboardType="numeric"
                  />
                </View>
              </View>
              <TouchableOpacity style={styles.modalAddBtn} onPress={handleAddManpower} activeOpacity={0.85}>
                <Text style={styles.modalAddBtnText}>Add Entry</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      {/* Delay-row task picker */}
      <Modal visible={delayTaskPickerIdx !== null} transparent animationType="fade" onRequestClose={() => setDelayTaskPickerIdx(null)}>
        <Pressable style={dcStyles.modalOverlay} onPress={() => setDelayTaskPickerIdx(null)}>
          <Pressable style={dcStyles.taskPickerCard} onPress={() => undefined}>
            <View style={dcStyles.taskPickerHeader}>
              <Text style={dcStyles.taskPickerTitle}>Which task slipped?</Text>
              <TouchableOpacity onPress={() => setDelayTaskPickerIdx(null)} accessibilityRole="button" accessibilityLabel="Close">
                <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 360 }}>
              {scheduleTasks.map(t => {
                const active = delayTaskPickerIdx !== null && delayRows?.[delayTaskPickerIdx]?.taskId === t.id;
                return (
                  <TouchableOpacity
                    key={t.id}
                    style={[dcStyles.taskOption, active && dcStyles.taskOptionActive]}
                    onPress={() => {
                      setDelayRows(rs => (rs ?? []).map((r, j) => j === delayTaskPickerIdx ? { ...r, taskId: t.id } : r));
                      setDelayTaskPickerIdx(null);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={t.title}
                    accessibilityState={{ selected: active }}
                  >
                    {active && <CheckCircle2 size={14} color={themeColors.accent} strokeWidth={1.75} />}
                    <View style={{ flex: 1 }}>
                      <Text style={[dcStyles.taskOptionText, active && dcStyles.taskOptionTextActive]} numberOfLines={1}>{t.title}</Text>
                      <Text style={dcStyles.taskOptionMeta}>{t.phase} · {t.durationDays}d · day {t.startDay}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
      <UpgradeSheet
        visible={!!upgradeLimit}
        limit={upgradeLimit}
        featureLabel="Voice Capture"
        onClose={() => setUpgradeLimit(null)}
      />
    </View>
  );
}

function VoiceRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  const voiceStyles = useThemedStyles(makeVoiceStyles);
  return (
    <View style={voiceStyles.row}>
      <Text style={voiceStyles.rowLabel}>{label}</Text>
      <Text style={[voiceStyles.rowValue, valueColor ? { color: valueColor } : null]} numberOfLines={3}>{value}</Text>
    </View>
  );
}

// Single role tile for the Workforce rollup — colored icon chip on the left,
// role label + count stacked on the right. Stays visually consistent across
// the 4 buckets so the eye reads them as a group.
function RoleTile(props: {
  icon: React.ComponentType<{ size: number; color: string; strokeWidth?: number }>;
  label: string;
  count: number;
  color: string;
}) {
  const { icon: Icon, label, count, color } = props;
  const dim = count === 0;
  const roleTileStyles = useThemedStyles(makeRoleTileStyles);
  return (
    <View style={[roleTileStyles.tile, dim && { opacity: 0.55 }]}>
      <View style={[roleTileStyles.iconChip, { backgroundColor: color + '1A' }]}>
        <Icon size={16} color={color} strokeWidth={2} />
      </View>
      <Text style={roleTileStyles.label} numberOfLines={1} adjustsFontSizeToFit>{label}</Text>
      <Text style={roleTileStyles.count}>{count}</Text>
    </View>
  );
}

const makeRoleTileStyles = (themeColors: ThemeColors) => StyleSheet.create({
  // Vertical-stacked tile so the role label has room to breathe — narrow
  // 4-up grid on phone width truncates a horizontal layout to "Sup...".
  tile: {
    alignItems: 'flex-start' as const,
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: Tokens.radius.card,
    backgroundColor: themeColors.surfaceAlt,
    flex: 1,
    minWidth: 0,
  },
  iconChip: {
    width: 28, height: 28, borderRadius: 8,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: 4,
  },
  label: {
    fontSize: Type.caption2.fontSize,
    color: themeColors.textMuted,
    fontWeight: '600' as const,
  },
  count: {
    fontSize: Type.headline.fontSize,
    fontWeight: '800' as const,
    color: themeColors.text,
    letterSpacing: -0.3,
  },
});

const makeVoiceStyles = (themeColors: ThemeColors) => StyleSheet.create({
  previewCard: {
    marginHorizontal: 16, marginBottom: 8,
    backgroundColor: themeColors.accent + '0D',
    borderWidth: 1, borderColor: themeColors.accent + '30',
    borderRadius: Tokens.radius.card, padding: 14, gap: 8,
  },
  previewHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  previewTitle: { flex: 1, fontSize: Type.footnote.fontSize, fontWeight: '800', color: themeColors.accent, letterSpacing: -0.2 },
  previewHelper: { fontSize: Type.caption2.fontSize, color: themeColors.textMuted, lineHeight: 15 },
  previewList: { gap: 6, marginTop: 4 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  rowLabel: { width: 90, fontSize: Type.caption2.fontSize, fontWeight: '800', color: themeColors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, paddingTop: 1 },
  rowValue: { flex: 1, fontSize: Type.footnote.fontSize, color: themeColors.text, lineHeight: 18 },
});

const makeLeakStyles = (themeColors: ThemeColors) => StyleSheet.create({
  helperText: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, marginBottom: 10, lineHeight: 17 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.full, marginLeft: 'auto' },
  badgeClean: { backgroundColor: 'rgba(30,142,74,0.12)' },
  badgeFlags: { backgroundColor: 'rgba(233,168,38,0.16)' },
  badgeText: { fontSize: 9, fontWeight: '800' as const, letterSpacing: 0.6 },
  badgeTextClean: { color: themeColors.success },
  badgeTextFlags: { color: Colors.warning },
  scanBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6,
    paddingHorizontal: 12, paddingVertical: 11, borderRadius: 11,
    backgroundColor: themeColors.accent + '0F', borderWidth: 1, borderColor: themeColors.accent + '40',
  },
  scanBtnDisabled: { opacity: 0.7 },
  scanBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.accent },
  cleanRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginTop: 12 },
  cleanText: { flex: 1, fontSize: Type.footnote.fontSize, color: themeColors.text },
  resultBlock: { marginTop: 12, gap: 10 },
  itemRow: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 8 },
  itemDesc: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.text },
  itemQuote: { fontSize: Type.caption1.fontSize, color: themeColors.textSecondary, fontStyle: 'italic' as const, marginTop: 2 },
  itemMeta: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, marginTop: 2 },
  draftCoBtn: { marginTop: 4, paddingVertical: 11, borderRadius: 11, alignItems: 'center' as const, backgroundColor: themeColors.accent },
  draftCoBtnDisabled: { backgroundColor: themeColors.textMuted, opacity: 0.6 },
  draftCoBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: '#FFFFFF' },
  draftCoBtnTextDisabled: { color: '#FFFFFF' },
  staleHint: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, fontStyle: 'italic' as const, marginBottom: 4 },
  itemRowStale: { opacity: 0.5 },
  itemDescStale: { color: themeColors.textMuted },
});

const makeDcStyles = (themeColors: ThemeColors) => StyleSheet.create({
  helperText: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, marginBottom: 10, lineHeight: 17 },
  appliedPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.full, marginLeft: 'auto' as const, backgroundColor: 'rgba(30,142,74,0.12)' },
  appliedPillText: { fontSize: 9, fontWeight: '800' as const, color: themeColors.success, letterSpacing: 0.6 },
  aiBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6,
    paddingHorizontal: 12, paddingVertical: 11, borderRadius: 11,
    backgroundColor: themeColors.accent + '0F', borderWidth: 1, borderColor: themeColors.accent + '40',
  },
  aiBtnDisabled: { opacity: 0.7 },
  aiBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.accent },
  cleanRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginTop: 12 },
  cleanText: { flex: 1, fontSize: Type.footnote.fontSize, color: themeColors.text },
  rowsBlock: { marginTop: 12, gap: 12 },
  hitRow: { gap: 8 },
  hitRowApplied: { opacity: 0.55 },
  hitQuoteRow: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 8 },
  hitQuote: { fontSize: Type.caption1.fontSize, color: themeColors.textSecondary, fontStyle: 'italic' as const },
  hitDismissBtn: { padding: 2 },
  hitControls: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  appliedNotice: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginTop: 2 },
  appliedNoticeText: { flex: 1, fontSize: Type.footnote.fontSize, color: themeColors.text },
  reArmBtn: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: Tokens.radius.md,
    backgroundColor: themeColors.bg, borderWidth: 1, borderColor: themeColors.line,
  },
  reArmBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.accent },
  staleNoticeText: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, fontStyle: 'italic' as const },
  taskPickBtn: {
    flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6,
    backgroundColor: themeColors.bg, borderWidth: 1, borderColor: themeColors.line,
    borderRadius: Tokens.radius.md, paddingHorizontal: 10, paddingVertical: 9,
  },
  taskPickText: { flex: 1, fontSize: Type.footnote.fontSize, color: themeColors.text },
  stepperRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  stepBtn: {
    width: 30, height: 30, borderRadius: Tokens.radius.md, alignItems: 'center' as const, justifyContent: 'center' as const,
    backgroundColor: themeColors.bg, borderWidth: 1, borderColor: themeColors.line,
  },
  stepValue: { minWidth: 34, textAlign: 'center' as const, fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.text },
  previewBtn: { marginTop: 2, paddingVertical: 12, borderRadius: 11, alignItems: 'center' as const, backgroundColor: themeColors.accent },
  previewBtnOff: { opacity: 0.4 },
  previewBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: '#FFFFFF' },
  diffWrap: { marginTop: 12 },
  modalOverlay: { flex: 1, backgroundColor: '#00000060', justifyContent: 'center' as const, alignItems: 'center' as const, padding: 24 },
  taskPickerCard: { backgroundColor: themeColors.surface, borderRadius: Tokens.radius.panel, width: '100%' as const, overflow: 'hidden' as const },
  taskPickerHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, padding: 16, borderBottomWidth: 1, borderBottomColor: themeColors.line },
  taskPickerTitle: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: themeColors.text },
  taskOption: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, padding: 12, borderBottomWidth: 1, borderBottomColor: themeColors.line + '80' },
  taskOptionActive: { backgroundColor: themeColors.accent + '10' },
  taskOptionText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '500' as const, color: themeColors.text },
  taskOptionTextActive: { fontWeight: '700' as const, color: themeColors.accent },
  taskOptionMeta: { fontSize: Type.caption2.fontSize, color: themeColors.textSecondary, marginTop: 1 },
});

const makeHsStyles = (themeColors: ThemeColors) => StyleSheet.create({
  helperText: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, marginBottom: 10, lineHeight: 17 },
  publishedPill: {
    backgroundColor: 'rgba(30,142,74,0.12)', paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: Tokens.radius.full, marginLeft: 'auto',
  },
  publishedPillText: { fontSize: 9, fontWeight: '800', color: themeColors.success, letterSpacing: 0.6 },
  aiBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 11, borderRadius: 11,
    backgroundColor: themeColors.accent + '0F', borderWidth: 1, borderColor: themeColors.accent + '40',
  },
  aiBtnDisabled: { opacity: 0.7 },
  aiBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: themeColors.accent },
  highlightsBlock: { marginTop: 10, gap: 4 },
  highlightsLabel: { fontSize: 10, fontWeight: '800', color: themeColors.textMuted, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 4 },
  highlightRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 2 },
  highlightDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: themeColors.accent, marginTop: 7 },
  highlightText: { flex: 1, fontSize: Type.footnote.fontSize, color: themeColors.text, lineHeight: 19 },
  lookingAhead: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, marginTop: 8, fontStyle: 'italic' },
  publishBtn: {
    marginTop: 12, paddingVertical: 11, borderRadius: 11,
    backgroundColor: themeColors.bg, borderWidth: 1, borderColor: themeColors.line,
    alignItems: 'center',
  },
  publishBtnPublished: { backgroundColor: 'rgba(30,142,74,0.10)', borderColor: '#1E8E4A' },
  publishBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: themeColors.text },
  publishBtnTextPublished: { color: themeColors.success },
});

const makeStyles = (themeColors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: themeColors.bg },
  contentDesktop: { width: '100%', maxWidth: 840, alignSelf: 'center' as const },
  center: { alignItems: 'center', justifyContent: 'center' },
  notFoundText: { fontSize: Type.subheadline.fontSize, color: themeColors.textSecondary, marginBottom: 16 },

  // Custom top bar — replaces the default Stack header so Save Draft +
  // Submit can sit at the top right (matches the mock).
  topBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 10,
    backgroundColor: themeColors.bg,
    borderBottomWidth: 1,
    borderBottomColor: themeColors.line,
  },
  topBarBack: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: themeColors.surface,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 1, borderColor: themeColors.line,
  },
  topBarTitleCol: {
    flex: 1,
    minWidth: 0,
  },
  topBarTitle: {
    fontSize: Type.title3.fontSize,
    fontWeight: '800' as const,
    color: themeColors.text,
    letterSpacing: -0.4,
  },
  topBarDate: {
    fontSize: Type.caption1.fontSize,
    color: themeColors.textMuted,
    marginTop: 1,
  },
  topBarActions: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  topBarDraftBtn: {
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  topBarDraftText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: themeColors.accent,
  },
  topBarSubmitBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Tokens.radius.full,
    backgroundColor: themeColors.accent,
  },
  topBarSubmitText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '800' as const,
    color: "#FFFFFF",
    letterSpacing: -0.2,
  },
  backBtn: { backgroundColor: themeColors.accent, paddingHorizontal: 24, paddingVertical: 12, borderRadius: Tokens.radius.md },
  backBtnText: { color: "#FFFFFF", fontSize: Type.subhead.fontSize, fontWeight: '600' as const },
  heroCard: { backgroundColor: themeColors.accent, marginHorizontal: 20, marginTop: 12, borderRadius: Tokens.radius.panel, padding: 20, gap: 4 },
  heroLabel: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  heroProject: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: "#FFFFFF" },
  heroDate: { fontSize: Type.bodyCompact.fontSize, color: 'rgba(255,255,255,0.8)', marginTop: 2 },
  heroDayRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5,
    marginTop: 6,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.18)',
  },
  heroDayText: {
    fontSize: Type.caption1.fontSize,
    color: 'rgba(255,255,255,0.85)',
    fontWeight: '600' as const,
  },
  statusBadge: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 4, borderRadius: Tokens.radius.sm, marginTop: 6 },
  statusText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const },
  sectionCard: { marginHorizontal: 20, marginTop: 16, backgroundColor: themeColors.surface, borderRadius: Tokens.radius.panel, padding: 18, borderWidth: 1, borderColor: themeColors.line },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  sectionTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.text },
  sectionTotal: { flex: 1, fontSize: Type.caption1.fontSize, color: themeColors.textMuted, fontWeight: '600' as const },
  roleTileGrid: {
    flexDirection: 'row' as const,
    gap: 8,
    marginBottom: 12,
  },
  workforceTotalLine: {
    fontSize: Type.caption2.fontSize,
    color: themeColors.textMuted,
    marginBottom: 8,
  },
  refreshBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.info },
  refreshBtnText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.info },
  weatherGrid: { gap: 10 },
  weatherItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  weatherInput: { flex: 1, minHeight: 38, borderRadius: Tokens.radius.md, backgroundColor: themeColors.surfaceAlt, paddingHorizontal: 12, fontSize: Type.bodyCompact.fontSize, color: themeColors.text },
  weatherValue: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: themeColors.text },
  addSmallBtn: { width: 32, height: 32, borderRadius: Tokens.radius.panel, backgroundColor: themeColors.accent + '15', alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: Type.footnote.fontSize, color: themeColors.textMuted, fontStyle: 'italic' as const },
  mpRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderTopColor: themeColors.line, gap: 10 },
  mpInfo: { flex: 1, gap: 2 },
  mpTrade: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: themeColors.text },
  mpMeta: { fontSize: Type.caption1.fontSize, color: themeColors.textSecondary },
  textArea: { minHeight: 80, borderRadius: Tokens.radius.card, backgroundColor: themeColors.surfaceAlt, paddingHorizontal: 14, paddingTop: 12, fontSize: Type.bodyCompact.fontSize, color: themeColors.text },
  textInput: { minHeight: 44, borderRadius: Tokens.radius.card, backgroundColor: themeColors.surfaceAlt, paddingHorizontal: 14, fontSize: Type.bodyCompact.fontSize, color: themeColors.text },
  readOnlyText: { fontSize: Type.bodyCompact.fontSize, color: themeColors.text, lineHeight: 20 },
  incidentToggle: { flexDirection: 'row', alignItems: 'center' as const, gap: 10, paddingVertical: 12, paddingHorizontal: 12, borderRadius: Tokens.radius.card, backgroundColor: themeColors.surfaceAlt, borderWidth: 1, borderColor: themeColors.line },
  incidentToggleActive: { backgroundColor: themeColors.danger, borderColor: themeColors.danger + '40' },
  incidentToggleDot: { width: 16, height: 16, borderRadius: Tokens.radius.sm, borderWidth: 2, borderColor: themeColors.line },
  incidentToggleDotActive: { backgroundColor: themeColors.danger, borderColor: themeColors.danger },
  incidentToggleText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: themeColors.text },
  incidentBlock: { marginTop: 10, gap: 6 },
  incidentLabel: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary, marginTop: 8 },
  severityRow: { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 6 },
  severityChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: Tokens.radius.md, backgroundColor: themeColors.line },
  severityChipActive: { backgroundColor: themeColors.danger },
  severityChipText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary },
  severityChipTextActive: { color: '#FFF' },
  checkboxRow: { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 12, marginTop: 8 },
  checkboxItem: { flexDirection: 'row', alignItems: 'center' as const, gap: 6 },
  checkbox: { width: 18, height: 18, borderRadius: 4, borderWidth: 2, borderColor: themeColors.line },
  checkboxActive: { backgroundColor: themeColors.danger, borderColor: themeColors.danger },
  checkboxLabel: { fontSize: Type.footnote.fontSize, color: themeColors.text, fontWeight: '500' as const },
  addMaterialRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  materialInput: { flex: 1, minHeight: 40, borderRadius: Tokens.radius.md, backgroundColor: themeColors.surfaceAlt, paddingHorizontal: 12, fontSize: Type.bodyCompact.fontSize, color: themeColors.text },
  addMaterialBtn: { width: 40, height: 40, borderRadius: Tokens.radius.md, backgroundColor: themeColors.accent + '15', alignItems: 'center', justifyContent: 'center' },
  materialRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  materialDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: themeColors.accent },
  materialText: { flex: 1, fontSize: Type.bodyCompact.fontSize, color: themeColors.text },
  photoActions: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  photoBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: Tokens.radius.md, backgroundColor: themeColors.accent + '10', borderWidth: 1, borderColor: themeColors.accent + '20' },
  photoBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.accent },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  photoCard: { width: 80, height: 80, borderRadius: Tokens.radius.md, backgroundColor: themeColors.surfaceAlt, overflow: 'hidden' as const, position: 'relative' as const },
  photoImage: { width: '100%' as const, height: '100%' as const },
  photoTimestampOverlay: { position: 'absolute' as const, left: 0, right: 0, bottom: 0, backgroundColor: Colors.overlay, paddingHorizontal: 4, paddingVertical: 2 },
  photoTimestampOverlayText: { fontSize: 9, color: '#FFFFFF', fontWeight: '600' as const },
  photoRemoveBtn: { position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: Tokens.radius.md, backgroundColor: themeColors.danger, alignItems: 'center', justifyContent: 'center' },
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: themeColors.surface, borderTopWidth: 0.5, borderTopColor: themeColors.line, paddingHorizontal: 20, paddingTop: 12, flexDirection: 'row', gap: 10 },
  toggleRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: themeColors.surfaceAlt,
    borderRadius: Tokens.radius.md,
    marginTop: 12,
  },
  toggleIconWrap: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center' as const, justifyContent: 'center' as const,
    backgroundColor: themeColors.accent + '14',
  },
  toggleTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: themeColors.text },
  toggleSub: { fontSize: Type.caption2.fontSize, color: themeColors.textSecondary, marginTop: 2 },
  toggleSwitch: {
    width: 38, height: 22, borderRadius: 11,
    backgroundColor: themeColors.line,
    padding: 2,
    justifyContent: 'center' as const,
  },
  toggleSwitchOn: { backgroundColor: themeColors.accent },
  toggleKnob: { width: 18, height: 18, borderRadius: 9, backgroundColor: themeColors.surface },
  toggleKnobOn: { transform: [{ translateX: 16 }] },
  saveDraftBtn: { flex: 1, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.line, alignItems: 'center', justifyContent: 'center' },
  saveDraftBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: themeColors.text },
  saveProjectBtn: { flex: 1, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accent + '15', borderWidth: 1.5, borderColor: themeColors.accent, alignItems: 'center', justifyContent: 'center' },
  saveProjectBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: themeColors.accent },
  sendBtn: { flex: 1.2, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accent, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  sendBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: "#FFFFFF" },
  selectedRecipientCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: themeColors.accent + '10', borderRadius: Tokens.radius.card, paddingHorizontal: 12, paddingVertical: 10, gap: 10, borderWidth: 1, borderColor: themeColors.accent + '25' },
  selectedRecipientName: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: themeColors.text },
  selectedRecipientEmail: { fontSize: Type.caption1.fontSize, color: themeColors.textSecondary },
  clearRecipientBtn: { width: 24, height: 24, borderRadius: Tokens.radius.card, backgroundColor: themeColors.line, alignItems: 'center', justifyContent: 'center' },
  pickContactBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 8, paddingVertical: 6, paddingHorizontal: 10, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.accent + '10' },
  pickContactText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.accent },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: 'flex-end' },
  modalCard: { backgroundColor: themeColors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, gap: 8 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  modalTitle: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: themeColors.text },
  modalFieldLabel: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary, marginTop: 4 },
  modalInput: { minHeight: 44, borderRadius: Tokens.radius.card, backgroundColor: themeColors.surfaceAlt, paddingHorizontal: 12, fontSize: Type.subhead.fontSize, color: themeColors.text },
  modalRow: { flexDirection: 'row', gap: 10 },
  modalAddBtn: { backgroundColor: themeColors.accent, borderRadius: Tokens.radius.lg, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  modalAddBtnText: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: "#FFFFFF" },

  modalHelper: {
    fontSize: Type.footnote.fontSize,
    color: themeColors.textMuted,
    marginBottom: 4,
  },
  modalDoneBtn: {
    backgroundColor: themeColors.accent,
    borderRadius: Tokens.radius.lg,
    paddingVertical: 14,
    alignItems: 'center' as const,
    marginTop: 12,
  },
  modalDoneBtnText: {
    fontSize: Type.callout.fontSize,
    fontWeight: '700' as const,
    color: "#FFFFFF",
  },
  pickerRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: Tokens.radius.card,
    backgroundColor: themeColors.surfaceAlt,
  },
  pickerDot: {
    width: 10, height: 10, borderRadius: 5,
  },
  pickerTitle: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: themeColors.text,
  },
  pickerMeta: {
    fontSize: Type.caption2.fontSize,
    color: themeColors.textMuted,
    marginTop: 2,
  },
  pctStepperRow: {
    flexDirection: 'row' as const,
    gap: 4,
  },
  pctStepBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Tokens.radius.sm,
    borderWidth: 1,
    borderColor: themeColors.line,
    backgroundColor: themeColors.surface,
  },
  pctStepBtnText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
  },

  // Work Progress chips on the DFR section card.
  progressChipGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 6,
  },
  progressChip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingVertical: 6,
    paddingLeft: 10,
    paddingRight: 8,
    borderRadius: Tokens.radius.full,
    backgroundColor: themeColors.surfaceAlt,
    borderWidth: 1,
    borderColor: themeColors.line,
    maxWidth: '100%',
  },
  progressChipDot: {
    width: 8, height: 8, borderRadius: 4,
  },
  progressChipName: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '600' as const,
    color: themeColors.text,
    maxWidth: 140,
  },
  progressChipPctPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: Tokens.radius.full,
  },
  progressChipPctText: {
    fontSize: 10,
    fontWeight: '800' as const,
    letterSpacing: 0.2,
  },

  // Toolbar between the hero card and the section forms — holds the
  // progress pill and the carry-forward "Copy from <last>" affordance.
  dfrToolbar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    flexWrap: 'wrap' as const,
    gap: 10,
    paddingHorizontal: 16,
    // Sits cleanly BELOW the hero card. The hero card has no bottom
    // margin, so this positive top margin is the only gap between them.
    // (Was -6, which pulled the progress pill / "Copy from…" button up
    // over the card's rounded bottom corners and the Saved badge.)
    marginTop: 12,
    marginBottom: 12,
  },
  progressPill: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: themeColors.line,
    borderWidth: 1,
    borderColor: themeColors.line,
  },
  progressPillReady: {
    backgroundColor: themeColors.successSoft,
    borderColor: themeColors.success + '40',
  },
  progressPillText: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '600' as const,
    color: themeColors.textSecondary,
    letterSpacing: 0.1,
  },
  carryBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: themeColors.accent + '12',
    borderWidth: 1,
    borderColor: themeColors.accent + '40',
  },
  carryBtnText: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '700' as const,
    color: themeColors.accent,
    letterSpacing: 0.1,
  },
  carriedBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: themeColors.accent + '14',
  },
  carriedBadgeText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: themeColors.accent,
    letterSpacing: 0.2,
  },
});
