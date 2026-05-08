import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, Platform, KeyboardAvoidingView, Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import {
  Plus, Trash2, X, Send, Cloud, Wind, Thermometer, Camera, Users,
  HardHat, Package, AlertTriangle, Image as ImageIcon, BookUser, User,
  Sparkles, Home as HomeIcon, RefreshCw, Copy, CheckCircle2,
  CalendarDays, ChevronLeft, Tractor, Wrench, ChartBar, BarChart3, ClipboardList,
} from 'lucide-react-native';
import EmptyState from '@/components/EmptyState';
import DatePickerModal from '@/components/DatePickerModal';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import ContactPickerModal from '@/components/ContactPickerModal';
import { saveDailyReportToProjectFiles } from '@/utils/projectDocuments';
import { FolderOpen } from 'lucide-react-native';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { sendEmail, buildDailyReportEmailHtml } from '@/utils/emailService';
import VoiceRecorder from '@/components/VoiceRecorder';
import { parseDFRFromTranscript } from '@/utils/voiceDFRParser';
import AIDailyReportGen from '@/components/AIDailyReportGen';
import AIDFRFromPhotos from '@/components/AIDFRFromPhotos';
import type { ManpowerEntry, DFRPhoto, DailyFieldReport, DFRWeather, IncidentReport, IncidentSeverity, DFRWorkProgress } from '@/types';
import { PHASE_COLORS, PHASE_OPTIONS } from '@/utils/scheduleEngine';
import { stampPhotoLocation } from '@/utils/photoGeoStamp';
import type { DailyReportGenResult } from '@/utils/aiService';
import { generateHomeownerSummary } from '@/utils/aiService';
import { nailIt } from '@/components/animations/NailItToast';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { generateUUID } from '@/utils/generateId';

function createId(_prefix: string): string {
  return generateUUID();
}

export default function DailyReportScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projectId, reportId } = useLocalSearchParams<{ projectId: string; reportId?: string }>();
  const {
    getProject, getDailyReportsForProject, addDailyReport, updateDailyReport, contacts, settings, addProjectPhoto,
    getPhotosForProject, updateProject,
  } = useProjects();
  const { isProOrAbove } = useSubscription();
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [showVoiceBanner, setShowVoiceBanner] = useState(false);
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

  // ─── Soft per-day uniqueness ───
  // Procore enforces one daily log per project per day. We do the same — but
  // soft, in the UI: when the user opens "New Daily Report" and a report
  // already exists for today, we silently redirect to the existing record
  // instead of letting them fill out a duplicate that the context's
  // addDailyReport would then reject. The save-time check in
  // addDailyReport is the safety net for date-edit edge cases.
  useEffect(() => {
    if (reportId) return;            // editing — no dup check needed
    if (!projectId) return;
    const todayKey = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    })();
    const existing = existingReports.find(r => {
      const d = new Date(r.date);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` === todayKey;
    });
    if (existing) {
      // replace (not push) so the user's back-button still goes to project
      // detail, not back into the empty new-report screen.
      router.replace({ pathname: '/daily-report' as any, params: { projectId, reportId: existing.id } });
      nailIt(`Opening today's existing report. Add to it instead of starting over.`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);  // intentionally mount-only — date-edit case is caught at save

  const [weather, setWeather] = useState<DFRWeather>(
    existingReport?.weather ?? { temperature: '', conditions: '', wind: '', isManual: true }
  );
  const [manpower, setManpower] = useState<ManpowerEntry[]>(existingReport?.manpower ?? []);
  const [workPerformed, setWorkPerformed] = useState(existingReport?.workPerformed ?? '');
  // Structured per-task progress chips. Each entry pins a task from the
  // project schedule + a percent-complete the GC observed today.
  const [workProgress, setWorkProgress] = useState<DFRWorkProgress[]>(existingReport?.workProgress ?? []);
  const [showTaskPicker, setShowTaskPicker] = useState(false);
  const [showPhasePicker, setShowPhasePicker] = useState(false);
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
  // Multi-recipient distribution list. Pre-filled from
  // `project.dfrRecipients` (project-level default) → `settings.dfrRecipients`
  // (org-wide default) on first open of the Submit modal. Add via typed
  // inputs (the "Add" button) or "Pick from Contacts." Tap a chip's X to
  // remove. Persisted back to the project when "Remember for this project"
  // is checked at send time.
  const [recipients, setRecipients] = useState<{ name?: string; email: string }[]>([]);
  // True after we've seeded `recipients` from defaults so we don't keep
  // overwriting the user's edits every time they reopen the modal.
  const [recipientsSeeded, setRecipientsSeeded] = useState(false);
  const [rememberRecipientsForProject, setRememberRecipientsForProject] = useState(false);
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
  useEffect(() => {
    if (existingReport?.date) setReportDate(existingReport.date);
  }, [existingReport]);
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

  const todayStr = useMemo(() => {
    return new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }, []);

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
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission Required', 'Camera access is needed to take photos.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        quality: 0.7,
      });
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

  // Auto-derive the construction phase for this report from the project's
  // schedule. Strategy: of all tasks live on `reportDate` (started, not
  // done, not a milestone/summary), pick the one with the largest crew —
  // that's the phase the day was *really* about. Falls back to 'General'
  // when the project has no schedule or no tasks land on this date. The
  // GC can override via a manual chip selector but the auto-pick is right
  // ~80% of the time, which is the bar a "folder" abstraction needs to
  // earn its weight.
  const derivedPhase = useMemo<string | undefined>(() => {
    const sched = project?.schedule;
    if (!sched?.tasks?.length) return undefined;
    const baseIso = sched.startDate || project?.createdAt;
    const baseMs = baseIso ? Date.parse(baseIso) : NaN;
    if (!Number.isFinite(baseMs)) return undefined;
    const dayMs = 86_400_000;
    const reportMs = Date.parse(reportDate);
    if (!Number.isFinite(reportMs)) return undefined;
    const dayIndex = Math.floor((reportMs - baseMs) / dayMs);
    const live = sched.tasks.filter(t => {
      if (t.status === 'done') return false;
      if (t.isMilestone || t.isLevelOfEffort || t.isSummary) return false;
      const start = t.startDay ?? 0;
      const dur = t.durationDays ?? 0;
      return start <= dayIndex && start + dur > dayIndex;
    });
    if (live.length === 0) return undefined;
    // Pick the phase with the most aggregate crew on that day.
    const phaseCrew = new Map<string, number>();
    for (const t of live) {
      const phase = t.phase || 'General';
      phaseCrew.set(phase, (phaseCrew.get(phase) ?? 0) + Math.max(1, t.crewSize ?? 1));
    }
    let best: string | undefined;
    let bestCrew = -1;
    for (const [phase, crew] of phaseCrew.entries()) {
      if (crew > bestCrew) { best = phase; bestCrew = crew; }
    }
    return best;
  }, [project?.schedule, project?.createdAt, reportDate]);

  // The phase actually saved on the report. Manual override beats the
  // schedule-derived value; otherwise we fall back to derivedPhase.
  const [phaseOverride, setPhaseOverride] = useState<string | undefined>(existingReport?.phase);
  const effectivePhase = phaseOverride ?? derivedPhase;

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
        phase: effectivePhase,
      });
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
        phase: effectivePhase,
        createdAt: now,
        updatedAt: now,
      };
      // addDailyReport now returns { id, isExisting }. If the user picked
      // a date that already has a report (e.g. backfilled to yesterday),
      // we route into edit mode on the existing record instead of
      // silently dropping the user's input.
      const result = addDailyReport(report);
      if (result.isExisting && result.id !== stableReportId) {
        Alert.alert(
          'Report already exists for this date',
          'A daily report for this date is already saved. Opening it so you can add to it.',
          [
            {
              text: 'Open existing',
              onPress: () => router.replace({ pathname: '/daily-report' as any, params: { projectId, reportId: result.id } }),
            },
          ],
        );
        return;
      }
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
  }, [projectId, weather, manpower, workPerformed, workProgress, materialsDelivered, issuesAndDelays, photos, incident, existingReport, homeownerSummary, hsGeneratedAt, hsPublished, addDailyReport, updateDailyReport, addProjectPhoto, router, reportDate, stableReportId, effectivePhase]);

  const handleSendPress = useCallback(() => {
    // Seed the recipient list from the project-level default first, then
    // org-wide default. Only on first open per session — once the user has
    // edited the chip list, reopening the modal preserves their edits.
    if (!recipientsSeeded) {
      const projectDefaults = project?.dfrRecipients ?? [];
      const orgDefaults = settings.dfrRecipients ?? [];
      const source = projectDefaults.length > 0 ? projectDefaults : orgDefaults;
      if (source.length > 0) {
        setRecipients(source.map(email => ({ email })));
      }
      setRecipientsSeeded(true);
    }
    setShowSendRecipient(true);
  }, [recipientsSeeded, project?.dfrRecipients, settings.dfrRecipients]);

  // Add the currently-typed name + email to the recipients chip list. Used
  // by the "Add" button in the Submit modal. Validates email shape so
  // typo-only entries don't get sent silently.
  const handleAddTypedRecipient = useCallback(() => {
    const email = sendRecipientEmail.trim();
    if (!email) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      Alert.alert('Invalid email', `"${email}" doesn't look like a valid email address.`);
      return;
    }
    if (recipients.some(r => r.email.toLowerCase() === email.toLowerCase())) {
      Alert.alert('Already added', `${email} is already in the recipient list.`);
      return;
    }
    setRecipients(prev => [...prev, { name: sendRecipientName.trim() || undefined, email }]);
    setSendRecipientName('');
    setSendRecipientEmail('');
    if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
  }, [sendRecipientEmail, sendRecipientName, recipients]);

  const handleRemoveRecipient = useCallback((email: string) => {
    setRecipients(prev => prev.filter(r => r.email.toLowerCase() !== email.toLowerCase()));
    if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
  }, []);

  const handleConfirmSend = useCallback(async () => {
    // Build the final recipient list: chips already in the list, PLUS any
    // typed-but-not-yet-added entry. This avoids the "I typed it and hit
    // Send and it didn't go" surprise — the most common cause of bug
    // reports on multi-recipient flows in other apps.
    const typedEmail = sendRecipientEmail.trim();
    const typedName = sendRecipientName.trim();
    const isTypedValid = typedEmail.length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typedEmail);
    const isTypedAlreadyInList = isTypedValid && recipients.some(r => r.email.toLowerCase() === typedEmail.toLowerCase());
    const finalRecipients: { name?: string; email: string }[] = [
      ...recipients,
      ...(isTypedValid && !isTypedAlreadyInList ? [{ name: typedName || undefined, email: typedEmail }] : []),
    ];

    const wantsEmail = finalRecipients.length > 0;
    if (!wantsEmail && !saveToProjectFiles) {
      Alert.alert(
        'Pick a destination',
        'Add at least one recipient, toggle "Save to project files", or both.',
      );
      return;
    }
    if (typedEmail.length > 0 && !isTypedValid) {
      Alert.alert('Invalid email', `"${typedEmail}" doesn't look like a valid email address. Fix it or clear the field.`);
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

      // Send to each recipient sequentially. Sequential (not parallel)
      // because the sendEmail edge function is rate-aware and a short
      // burst of 4-6 sends is cheap enough that the simpler control
      // flow + per-recipient error reporting is worth it.
      const failures: { email: string; error?: string }[] = [];
      for (const r of finalRecipients) {
        const html = buildDailyReportEmailHtml({
          companyName: branding.companyName,
          recipientName: r.name ?? '',
          projectName: project?.name ?? 'Project',
          date: reportDate,
          weather: weatherForEmail,
          totalManpower,
          totalManHours,
          workPerformed: workPerformed.trim(),
          issuesAndDelays: issuesAndDelays.trim(),
          contactName: branding.contactName,
          contactEmail: branding.email,
        });
        const result = await sendEmail({
          to: r.email,
          subject: `Daily report · ${new Date(reportDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · ${project?.name ?? 'Project'}`,
          html,
          replyTo: branding.email || undefined,
          fromCompanyName: branding.companyName || undefined,
          unsubscribe: { recipientEmail: r.email, eventKey: 'daily_report', enabled: true },
        });
        if (!result.success) {
          if (result.error === 'cancelled') {
            // User cancelled the native mail composer — abort the whole
            // batch so we don't keep popping the composer for each
            // remaining recipient.
            return;
          }
          console.warn('[DailyReport] Email send failed for', r.email, ':', result.error);
          failures.push({ email: r.email, error: result.error });
        }
      }
      if (failures.length > 0) {
        const summary = failures.map(f => `${f.email}${f.error ? ` (${f.error})` : ''}`).join(', ');
        Alert.alert(
          'Some emails did not send',
          `${finalRecipients.length - failures.length} of ${finalRecipients.length} sent. Failed: ${summary}`,
        );
      }

      // Persist the recipient list back to the project when "Remember"
      // was checked. We dedupe + lowercase-normalize so the next session
      // doesn't accumulate mixed-case duplicates.
      if (rememberRecipientsForProject && projectId) {
        const normalized = Array.from(
          new Set(finalRecipients.map(r => r.email.toLowerCase().trim())),
        ).filter(Boolean);
        updateProject(projectId, { dfrRecipients: normalized });
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

    // Toast the *count* when the batch is multi-recipient so the GC sees
    // "Daily report sent to 4 recipients" instead of just one of the
    // names — same wording style as Procore's "Distributed to 4."
    if (finalRecipients.length > 1) {
      handleSave('sent', `${finalRecipients.length} recipients`, undefined);
    } else if (finalRecipients.length === 1) {
      handleSave('sent', finalRecipients[0].name, finalRecipients[0].email);
    } else {
      handleSave('sent', undefined, undefined);
    }
  }, [handleSave, sendRecipientName, sendRecipientEmail, recipients, rememberRecipientsForProject, updateProject, settings, project, weather, totalManpower, totalManHours, workPerformed, issuesAndDelays, reportDate, saveToProjectFiles, projectId, stableReportId]);

  if (!project) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Daily Report' }} />
        <EmptyState
          icon={<ClipboardList size={36} color={Colors.primary} strokeWidth={1.6} />}
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
    <View style={styles.container}>
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
            <ChevronLeft size={22} color={Colors.text} />
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
              {!isLocked && <CalendarDays size={11} color={Colors.textMuted} />}
            </View>
          </TouchableOpacity>
          {!isLocked ? (
            <View style={styles.topBarActions}>
              <TouchableOpacity
                onPress={() => handleSave('draft')}
                style={styles.topBarDraftBtn}
                accessibilityRole="button"
                accessibilityLabel="Save draft"
                testID="save-draft-btn"
                activeOpacity={0.7}
              >
                <Text style={styles.topBarDraftText}>Save Draft</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSendPress}
                style={styles.topBarSubmitBtn}
                accessibilityRole="button"
                accessibilityLabel="Submit report"
                testID="submit-report-btn"
                activeOpacity={0.85}
              >
                <Text style={styles.topBarSubmitText}>Submit</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.topBarActions}>
              <View style={[styles.statusBadge, { backgroundColor: Colors.successLight, marginTop: 0 }]}>
                <Text style={[styles.statusText, { color: Colors.success }]}>Sent</Text>
              </View>
            </View>
          )}
        </View>

        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
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
              isLocked={!isProOrAbove}
              onLockedPress={() => router.push('/paywall' as any)}
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
                <Sparkles size={14} color={Colors.primary} />
                <Text style={voiceStyles.previewTitle}>Here&apos;s what I heard</Text>
                <TouchableOpacity onPress={() => { setShowVoiceBanner(false); setVoiceParsed(null); }} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
                  <X size={14} color={Colors.textMuted} />
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
                  <VoiceRow label="Issues" value={voiceParsed.issuesAndDelays.length > 90 ? voiceParsed.issuesAndDelays.slice(0, 90) + '…' : voiceParsed.issuesAndDelays} valueColor={Colors.error} />
                )}
              </View>
            </View>
          )}

          {showVoiceBanner && !voiceParsed && (
            <TouchableOpacity
              style={{ marginHorizontal: 16, marginBottom: 8, backgroundColor: Colors.infoLight, borderRadius: Tokens.radius.md, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}
              onPress={() => setShowVoiceBanner(false)}
              activeOpacity={0.7}
            >
              <Text style={{ flex: 1, fontSize: Type.footnote.fontSize, color: Colors.info }}>Nothing new picked up — the fields you already had stay as-is.</Text>
              <X size={14} color={Colors.info} />
            </TouchableOpacity>
          )}

          {!existingReport && todaysProjectPhotos.length > 0 && (
            <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
              <AIDFRFromPhotos
                projectName={project.name}
                weatherStr={[weather.conditions, weather.temperature].filter(Boolean).join(' · ') || 'Clear'}
                photos={todaysProjectPhotos}
                isLocked={!isProOrAbove}
                onLockedPress={() => router.push('/paywall' as any)}
                onGenerated={(parsed) => {
                  if (parsed.weather && !weather.temperature) setWeather({ ...parsed.weather, isManual: false });
                  if (parsed.manpower && manpower.length === 0) setManpower(parsed.manpower);
                  if (parsed.workPerformed && !workPerformed) setWorkPerformed(parsed.workPerformed);
                  if (parsed.materialsDelivered && materialsDelivered.length === 0) setMaterialsDelivered(parsed.materialsDelivered);
                  if (parsed.issuesAndDelays && !issuesAndDelays) setIssuesAndDelays(parsed.issuesAndDelays);
                  setShowVoiceBanner(true);
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
            <Text style={styles.heroDate}>{todayStr}</Text>
            {projectDayInfo && (
              <View style={styles.heroDayRow}>
                <CalendarDays size={13} color={Colors.textMuted} />
                <Text style={styles.heroDayText}>
                  Day {projectDayInfo.day} of {projectDayInfo.total}
                </Text>
              </View>
            )}
            {existingReport && (
              <View style={[styles.statusBadge, { backgroundColor: existingReport.status === 'sent' ? Colors.successLight : Colors.fillTertiary }]}>
                <Text style={[styles.statusText, { color: existingReport.status === 'sent' ? Colors.success : Colors.textSecondary }]}>
                  {existingReport.status === 'sent' ? 'Sent' : 'Saved'}
                </Text>
              </View>
            )}
          </View>

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
                <CheckCircle2 size={14} color={Colors.success} strokeWidth={2.2} />
              ) : null}
              <Text style={[
                styles.progressPillText,
                progressMeta.isReady ? { color: Colors.success } : null,
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
                <Copy size={14} color={Colors.primary} strokeWidth={2.2} />
                <Text style={styles.carryBtnText}>Copy from {lastReportLabel}</Text>
              </TouchableOpacity>
            )}
            {carryFormFromId && (
              <View style={styles.carriedBadge}>
                <CheckCircle2 size={12} color={Colors.primary} strokeWidth={2.4} />
                <Text style={styles.carriedBadgeText}>Carried forward</Text>
              </View>
            )}
          </View>

          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Cloud size={18} color={Colors.info} />
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
                <Thermometer size={14} color={Colors.accent} />
                {!isLocked ? (
                  <TextInput
                    style={styles.weatherInput}
                    value={weather.temperature}
                    onChangeText={(v) => setWeather(prev => ({ ...prev, temperature: v, isManual: true }))}
                    placeholder="72°F"
                    placeholderTextColor={Colors.textMuted}
                  />
                ) : (
                  <Text style={styles.weatherValue}>{weather.temperature || 'N/A'}</Text>
                )}
              </View>
              <View style={styles.weatherItem}>
                <Cloud size={14} color={Colors.info} />
                {!isLocked ? (
                  <TextInput
                    style={styles.weatherInput}
                    value={weather.conditions}
                    onChangeText={(v) => setWeather(prev => ({ ...prev, conditions: v, isManual: true }))}
                    placeholder="Sunny, Cloudy..."
                    placeholderTextColor={Colors.textMuted}
                  />
                ) : (
                  <Text style={styles.weatherValue}>{weather.conditions || 'N/A'}</Text>
                )}
              </View>
              <View style={styles.weatherItem}>
                <Wind size={14} color={Colors.textSecondary} />
                {!isLocked ? (
                  <TextInput
                    style={styles.weatherInput}
                    value={weather.wind}
                    onChangeText={(v) => setWeather(prev => ({ ...prev, wind: v, isManual: true }))}
                    placeholder="5 mph NW"
                    placeholderTextColor={Colors.textMuted}
                  />
                ) : (
                  <Text style={styles.weatherValue}>{weather.wind || 'N/A'}</Text>
                )}
              </View>
            </View>
          </View>

          {/* Phase pill — auto-derived from the project schedule's most-
              active task on this date, manually overridable. Drives the
              "group reports by phase" view on Project Detail (the
              Procore-style folder answer without a separate folder
              entity). Hidden when there's no schedule + no override —
              would just show "General" with no signal. */}
          {(effectivePhase || project.schedule?.tasks?.length) ? (
            <TouchableOpacity
              style={styles.phasePillRow}
              onPress={() => !isLocked && setShowPhasePicker(true)}
              activeOpacity={isLocked ? 1 : 0.7}
              accessibilityRole={isLocked ? undefined : 'button'}
              accessibilityLabel={isLocked ? `Phase: ${effectivePhase ?? 'General'}` : `Change phase. Currently ${effectivePhase ?? 'auto'}`}
              disabled={isLocked}
              testID="phase-pill"
            >
              <View
                style={[
                  styles.phasePillDot,
                  { backgroundColor: PHASE_COLORS[effectivePhase ?? 'General'] ?? PHASE_COLORS.General },
                ]}
              />
              <Text style={styles.phasePillLabel}>Phase</Text>
              <Text style={styles.phasePillValue}>
                {effectivePhase ?? 'Auto-detect on save'}
              </Text>
              {phaseOverride && (
                <View style={styles.phasePillOverrideBadge}>
                  <Text style={styles.phasePillOverrideBadgeText}>Manual</Text>
                </View>
              )}
              {!isLocked && (
                <Text style={styles.phasePillCta}>
                  {phaseOverride ? 'Change' : (derivedPhase ? 'Override' : 'Set')}
                </Text>
              )}
            </TouchableOpacity>
          ) : null}

          {/* Work Progress — structured per-task percent-complete chips.
              Lets the GC log "Concrete Pour 100%, Steel Erection 60%" as
              data, not free-text. Pulls candidate tasks from the project
              schedule; falls back to a helper note if no schedule exists.
              The schedule rollup + portal both consume the chips so the
              data flows downstream without re-entry. */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <BarChart3 size={18} color={Colors.primary} />
              <Text style={styles.sectionTitle}>Work Progress</Text>
              <Text style={styles.sectionTotal}>{workProgress.length > 0 ? `${workProgress.length} task${workProgress.length === 1 ? '' : 's'}` : 'What was completed today?'}</Text>
              {!isLocked && (project.schedule?.tasks?.length ?? 0) > 0 && (
                <TouchableOpacity
                  style={styles.addSmallBtn}
                  onPress={() => setShowTaskPicker(true)}
                  activeOpacity={0.7}
                  testID="add-work-progress-btn" accessibilityRole="button" accessibilityLabel="Add work">
                  <Plus size={14} color={Colors.primary} />
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
                          <X size={14} color={Colors.textMuted} />
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
              <Users size={18} color={Colors.primary} />
              <Text style={styles.sectionTitle}>Workforce</Text>
              <Text style={styles.sectionTotal}>Total · {totalManpower}</Text>
              {!isLocked && (
                <TouchableOpacity
                  style={styles.addSmallBtn}
                  onPress={() => setShowManpowerModal(true)}
                  activeOpacity={0.7}
                  testID="add-manpower-btn" accessibilityRole="button" accessibilityLabel="Add">
                  <Plus size={14} color={Colors.primary} />
                </TouchableOpacity>
              )}
            </View>

            {/* 4-tile role rollup. Tiles render even when empty (count=0)
                so the layout doesn't shift as the GC adds entries — Apple
                pattern: skeleton stays put, the numbers fill in. */}
            <View style={styles.roleTileGrid}>
              <RoleTile icon={User} label="Supervisors" count={workforceByRole.supervisors} color="#3B82F6" />
              <RoleTile icon={HardHat} label="Skilled" count={workforceByRole.skilled} color="#10B981" />
              <RoleTile icon={Tractor} label="Operators" count={workforceByRole.operators} color="#A855F7" />
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
                    <Trash2 size={14} color={Colors.error} />
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>

          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <HardHat size={18} color={Colors.accent} />
              <Text style={styles.sectionTitle}>Work Performed</Text>
            </View>
            {!isLocked ? (
              <TextInput
                style={styles.textArea}
                value={workPerformed}
                onChangeText={setWorkPerformed}
                placeholder="Describe work completed today..."
                placeholderTextColor={Colors.textMuted}
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
              <Package size={18} color={Colors.primary} />
              <Text style={styles.sectionTitle}>Materials Delivered</Text>
            </View>
            {!isLocked && (
              <View style={styles.addMaterialRow}>
                <TextInput
                  style={styles.materialInput}
                  value={newMaterial}
                  onChangeText={setNewMaterial}
                  placeholder="Material received..."
                  placeholderTextColor={Colors.textMuted}
                  onSubmitEditing={handleAddMaterial}
                  returnKeyType="done"
                />
                <TouchableOpacity style={styles.addMaterialBtn} onPress={handleAddMaterial} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Add"><Plus size={16} color={Colors.primary} /></TouchableOpacity>
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
                    <X size={14} color={Colors.error} />
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>

          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <AlertTriangle size={18} color={Colors.error} />
              <Text style={styles.sectionTitle}>Issues & Delays</Text>
            </View>
            {!isLocked ? (
              <TextInput
                style={styles.textArea}
                value={issuesAndDelays}
                onChangeText={setIssuesAndDelays}
                placeholder="Note any problems or delays..."
                placeholderTextColor={Colors.textMuted}
                multiline
                textAlignVertical="top"
              />
            ) : (
              <Text style={styles.readOnlyText}>{issuesAndDelays || 'No issues reported.'}</Text>
            )}
          </View>

          {/* Homeowner-friendly summary — AI generates from technical fields,
              GC reviews + edits, then publishes to the portal as the daily
              "Latest update" panel. The toggle for what shows in portal is
              the published flag (independent of the technical DFR being sent
              by email). */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <HomeIcon size={18} color={Colors.primary} />
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
                    <RefreshCw size={14} color={Colors.primary} />
                    <Text style={hsStyles.aiBtnText}>Writing the homeowner version…</Text>
                  </>
                ) : (
                  <>
                    <Sparkles size={14} color={Colors.primary} />
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
                placeholderTextColor={Colors.textMuted}
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
                <Text style={[hsStyles.publishBtnText, hsPublished && hsStyles.publishBtnTextPublished]}>
                  {hsPublished ? '✓ Showing in portal' : 'Publish to portal'}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <HardHat size={18} color={Colors.error} />
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
                  <Text style={[styles.incidentToggleText, incident.hasIncident && { color: Colors.error }]}>
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
                      placeholderTextColor={Colors.textMuted}
                      multiline
                      textAlignVertical="top"
                    />

                    <Text style={styles.incidentLabel}>People involved</Text>
                    <TextInput
                      style={styles.textInput}
                      value={incident.peopleInvolved ?? ''}
                      onChangeText={val => setIncident(p => ({ ...p, peopleInvolved: val }))}
                      placeholder="Names or roles"
                      placeholderTextColor={Colors.textMuted}
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
                      placeholderTextColor={Colors.textMuted}
                      multiline
                      textAlignVertical="top"
                    />

                    <Text style={styles.incidentLabel}>Reported by</Text>
                    <TextInput
                      style={styles.textInput}
                      value={incident.reportedBy ?? ''}
                      onChangeText={val => setIncident(p => ({ ...p, reportedBy: val }))}
                      placeholder="Your name / role"
                      placeholderTextColor={Colors.textMuted}
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
              <ImageIcon size={18} color={Colors.accent} />
              <Text style={styles.sectionTitle}>Photos ({photos.length}/10)</Text>
            </View>
            {!isLocked && (
              <View style={styles.photoActions}>
                {Platform.OS !== 'web' && (
                  <TouchableOpacity style={styles.photoBtn} onPress={handleTakePhoto} activeOpacity={0.7}>
                    <Camera size={16} color={Colors.primary} />
                    <Text style={styles.photoBtnText}>Take Photo</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.photoBtn} onPress={handlePickPhoto} activeOpacity={0.7}>
                  <ImageIcon size={16} color={Colors.primary} />
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
                    <View style={styles.photoPlaceholder}>
                      <Camera size={20} color={Colors.textMuted} />
                      <Text style={styles.photoTimestamp}>
                        {new Date(photo.timestamp).toLocaleTimeString()}
                      </Text>
                    </View>
                    {!isLocked && (
                      <TouchableOpacity
                        style={styles.photoRemoveBtn}
                        onPress={() => handleRemovePhoto(photo.id)}
                        activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Close">
                        <X size={12} color={Colors.error} />
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </View>
            )}
          </View>
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
                  <X size={20} color={Colors.textMuted} />
                </TouchableOpacity>
              </View>

              {/* Distribution list — chips render every recipient that
                  will be sent to. Pre-seeded from project.dfrRecipients
                  → settings.dfrRecipients on first open. Tap the X on a
                  chip to remove. The "Add" button below appends the
                  typed name+email. */}
              {recipients.length > 0 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.recipientChipsRow}
                  style={{ maxHeight: 50, marginTop: 4, marginBottom: 8 }}
                >
                  {recipients.map(r => (
                    <View key={r.email} style={styles.recipientChip}>
                      <User size={12} color={Colors.primary} />
                      <Text style={styles.recipientChipText} numberOfLines={1}>
                        {r.name ? `${r.name} · ${r.email}` : r.email}
                      </Text>
                      <TouchableOpacity
                        onPress={() => handleRemoveRecipient(r.email)}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${r.email}`}
                        hitSlop={{ top: 6, right: 6, bottom: 6, left: 6 }}
                      >
                        <X size={12} color={Colors.textMuted} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </ScrollView>
              )}
              {recipients.length === 0 && (
                <Text style={styles.recipientHelpText}>
                  No recipients yet. Add at least one below, or just toggle &quot;Save to project files&quot; to file the report without emailing.
                </Text>
              )}

              <Text style={styles.modalFieldLabel}>
                {recipients.length === 0 ? 'Recipient Name' : 'Add Another · Name'}
              </Text>
              <TextInput
                style={styles.modalInput}
                value={sendRecipientName}
                onChangeText={setSendRecipientName}
                placeholder="Optional"
                placeholderTextColor={Colors.textMuted}
              />
              <Text style={styles.modalFieldLabel}>Email</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput
                  style={[styles.modalInput, { flex: 1 }]}
                  value={sendRecipientEmail}
                  onChangeText={setSendRecipientEmail}
                  placeholder="email@example.com"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  onSubmitEditing={handleAddTypedRecipient}
                  returnKeyType="done"
                />
                <TouchableOpacity
                  style={[styles.addRecipientBtn, !sendRecipientEmail.trim() && styles.addRecipientBtnDisabled]}
                  onPress={handleAddTypedRecipient}
                  disabled={!sendRecipientEmail.trim()}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Add recipient to list"
                >
                  <Plus size={14} color={sendRecipientEmail.trim() ? Colors.textOnPrimary : Colors.textMuted} />
                  <Text style={[styles.addRecipientBtnText, !sendRecipientEmail.trim() && { color: Colors.textMuted }]}>Add</Text>
                </TouchableOpacity>
              </View>
              {contacts.length > 0 && (
                <TouchableOpacity
                  style={styles.pickContactBtn}
                  onPress={() => { setShowSendRecipient(false); setTimeout(() => setShowContactPicker(true), 350); }}
                  activeOpacity={0.7}
                >
                  <BookUser size={14} color={Colors.primary} />
                  <Text style={styles.pickContactText}>Pick from Contacts</Text>
                </TouchableOpacity>
              )}

              {/* Remember for this project — saves the current chip list
                  as the project's default DFR distribution. Next time
                  the GC opens this project's Submit modal, the chips
                  are pre-filled. The org-wide settings.dfrRecipients
                  default still applies to projects that haven't set
                  their own list. */}
              {recipients.length > 0 && (
                <TouchableOpacity
                  style={[styles.toggleRow, { marginTop: 8 }]}
                  onPress={() => setRememberRecipientsForProject(v => !v)}
                  activeOpacity={0.7}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: rememberRecipientsForProject }}
                >
                  <View style={styles.toggleIconWrap}>
                    <BookUser size={16} color={Colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.toggleTitle}>Remember for this project</Text>
                    <Text style={styles.toggleSub}>
                      Pre-fill these recipients next time you submit a daily report on {project?.name ?? 'this project'}.
                    </Text>
                  </View>
                  <View style={[styles.toggleSwitch, rememberRecipientsForProject && styles.toggleSwitchOn]}>
                    <View style={[styles.toggleKnob, rememberRecipientsForProject && styles.toggleKnobOn]} />
                  </View>
                </TouchableOpacity>
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
                  <FolderOpen size={16} color={Colors.primary} />
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
                  <Send size={16} color={Colors.textOnPrimary} />
                  <Text style={styles.sendBtnText}>
                    {(() => {
                      const typedHasEmail = sendRecipientEmail.trim().length > 0;
                      const totalCount = recipients.length + (typedHasEmail ? 1 : 0);
                      if (totalCount === 0) return saveToProjectFiles ? 'Save' : 'Send';
                      if (totalCount === 1) return 'Send';
                      return `Send to ${totalCount}`;
                    })()}
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
        title="Add Recipient"
        onSelect={(contact) => {
          const name = `${contact.firstName} ${contact.lastName}`.trim() || contact.companyName;
          const email = contact.email?.trim();
          if (!email) {
            Alert.alert('No email on contact', `${name || 'This contact'} has no email saved.`);
            setShowContactPicker(false);
            setTimeout(() => setShowSendRecipient(true), 350);
            return;
          }
          // Append to the chip list rather than replace the single-recipient
          // form fields. Skip silently if already in the list.
          setRecipients(prev => {
            if (prev.some(r => r.email.toLowerCase() === email.toLowerCase())) return prev;
            return [...prev, { name: name || undefined, email }];
          });
          setShowContactPicker(false);
          setTimeout(() => setShowSendRecipient(true), 350);
        }}
      />

      {/* Phase picker — overrides the auto-derived phase. "Auto-detect"
          clears the override and lets the schedule decide on save.
          This is the manual escape hatch for projects where the
          schedule and reality diverge on a given day (e.g., concrete
          delay pushed Foundation work into a day the schedule said
          would be Framing). */}
      <Modal visible={showPhasePicker} transparent animationType="slide" onRequestClose={() => setShowPhasePicker(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Phase for this report</Text>
              <TouchableOpacity onPress={() => setShowPhasePicker(false)} accessibilityRole="button" accessibilityLabel="Close">
                <X size={20} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalHelper}>
              Used to group reports by phase on the project. Auto-detect picks the most-active phase from your schedule on this date.
            </Text>
            <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ gap: 6, paddingVertical: 4 }} showsVerticalScrollIndicator={false}>
              <TouchableOpacity
                style={[styles.phaseRow, !phaseOverride && styles.phaseRowActive]}
                onPress={() => { setPhaseOverride(undefined); setShowPhasePicker(false); }}
                activeOpacity={0.7}
                testID="phase-auto"
              >
                <View style={[styles.phasePillDot, { backgroundColor: Colors.textMuted }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.phaseRowName}>Auto-detect</Text>
                  <Text style={styles.phaseRowSub}>
                    {derivedPhase ? `Currently picks: ${derivedPhase}` : 'No active phase on this date — falls back to General'}
                  </Text>
                </View>
                {!phaseOverride && <CheckCircle2 size={16} color={Colors.primary} />}
              </TouchableOpacity>
              {PHASE_OPTIONS.map(p => (
                <TouchableOpacity
                  key={p}
                  style={[styles.phaseRow, phaseOverride === p && styles.phaseRowActive]}
                  onPress={() => { setPhaseOverride(p); setShowPhasePicker(false); }}
                  activeOpacity={0.7}
                  testID={`phase-${p}`}
                >
                  <View style={[styles.phasePillDot, { backgroundColor: PHASE_COLORS[p] ?? PHASE_COLORS.General }]} />
                  <Text style={[styles.phaseRowName, { flex: 1 }]}>{p}</Text>
                  {phaseOverride === p && <CheckCircle2 size={16} color={Colors.primary} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

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
                <X size={20} color={Colors.textMuted} />
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
                      <Plus size={16} color={Colors.primary} />
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
                  <X size={20} color={Colors.textMuted} />
                </TouchableOpacity>
              </View>
              <Text style={styles.modalFieldLabel}>Trade</Text>
              <TextInput
                style={styles.modalInput}
                value={mpTrade}
                onChangeText={setMpTrade}
                placeholder="e.g. Electrician, Plumber..."
                placeholderTextColor={Colors.textMuted}
              />
              <Text style={styles.modalFieldLabel}>Company / Sub</Text>
              <TextInput
                style={styles.modalInput}
                value={mpCompany}
                onChangeText={setMpCompany}
                placeholder="Company name (optional)"
                placeholderTextColor={Colors.textMuted}
              />
              <View style={styles.modalRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalFieldLabel}>Headcount</Text>
                  <TextInput
                    style={styles.modalInput}
                    value={mpHeadcount}
                    onChangeText={setMpHeadcount}
                    placeholder="1"
                    placeholderTextColor={Colors.textMuted}
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
                    placeholderTextColor={Colors.textMuted}
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
    </View>
  );
}

function VoiceRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
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

const roleTileStyles = StyleSheet.create({
  // Vertical-stacked tile so the role label has room to breathe — narrow
  // 4-up grid on phone width truncates a horizontal layout to "Sup...".
  tile: {
    alignItems: 'flex-start' as const,
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: Tokens.radius.card,
    backgroundColor: Colors.surfaceAlt,
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
    color: Colors.textMuted,
    fontWeight: '600' as const,
  },
  count: {
    fontSize: Type.headline.fontSize,
    fontWeight: '800' as const,
    color: Colors.text,
    letterSpacing: -0.3,
  },
});

const voiceStyles = StyleSheet.create({
  previewCard: {
    marginHorizontal: 16, marginBottom: 8,
    backgroundColor: Colors.primary + '0D',
    borderWidth: 1, borderColor: Colors.primary + '30',
    borderRadius: Tokens.radius.card, padding: 14, gap: 8,
  },
  previewHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  previewTitle: { flex: 1, fontSize: Type.footnote.fontSize, fontWeight: '800', color: Colors.primary, letterSpacing: -0.2 },
  previewHelper: { fontSize: Type.caption2.fontSize, color: Colors.textMuted, lineHeight: 15 },
  previewList: { gap: 6, marginTop: 4 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  rowLabel: { width: 90, fontSize: Type.caption2.fontSize, fontWeight: '800', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, paddingTop: 1 },
  rowValue: { flex: 1, fontSize: Type.footnote.fontSize, color: Colors.text, lineHeight: 18 },
});

const hsStyles = StyleSheet.create({
  helperText: { fontSize: Type.caption1.fontSize, color: Colors.textMuted, marginBottom: 10, lineHeight: 17 },
  publishedPill: {
    backgroundColor: 'rgba(30,142,74,0.12)', paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: Tokens.radius.full, marginLeft: 'auto',
  },
  publishedPillText: { fontSize: 9, fontWeight: '800', color: Colors.successDark, letterSpacing: 0.6 },
  aiBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 11, borderRadius: 11,
    backgroundColor: Colors.primary + '0F', borderWidth: 1, borderColor: Colors.primary + '40',
  },
  aiBtnDisabled: { opacity: 0.7 },
  aiBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: Colors.primary },
  highlightsBlock: { marginTop: 10, gap: 4 },
  highlightsLabel: { fontSize: 10, fontWeight: '800', color: Colors.textMuted, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 4 },
  highlightRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 2 },
  highlightDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: Colors.primary, marginTop: 7 },
  highlightText: { flex: 1, fontSize: Type.footnote.fontSize, color: Colors.text, lineHeight: 19 },
  lookingAhead: { fontSize: Type.caption1.fontSize, color: Colors.textMuted, marginTop: 8, fontStyle: 'italic' },
  publishBtn: {
    marginTop: 12, paddingVertical: 11, borderRadius: 11,
    backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center',
  },
  publishBtnPublished: { backgroundColor: 'rgba(30,142,74,0.10)', borderColor: '#1E8E4A' },
  publishBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: Colors.text },
  publishBtnTextPublished: { color: Colors.successDark },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  notFoundText: { fontSize: Type.subheadline.fontSize, color: Colors.textSecondary, marginBottom: 16 },

  // Custom top bar — replaces the default Stack header so Save Draft +
  // Submit can sit at the top right (matches the mock).
  topBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 10,
    backgroundColor: Colors.background,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  topBarBack: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.surface,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 1, borderColor: Colors.cardBorder,
  },
  topBarTitleCol: {
    flex: 1,
    minWidth: 0,
  },
  topBarTitle: {
    fontSize: Type.title3.fontSize,
    fontWeight: '800' as const,
    color: Colors.text,
    letterSpacing: -0.4,
  },
  topBarDate: {
    fontSize: Type.caption1.fontSize,
    color: Colors.textMuted,
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
    color: Colors.primary,
  },
  topBarSubmitBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Tokens.radius.full,
    backgroundColor: Colors.primary,
  },
  topBarSubmitText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '800' as const,
    color: Colors.textOnPrimary,
    letterSpacing: -0.2,
  },
  backBtn: { backgroundColor: Colors.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: Tokens.radius.md },
  backBtnText: { color: Colors.textOnPrimary, fontSize: Type.subhead.fontSize, fontWeight: '600' as const },
  heroCard: { backgroundColor: Colors.primary, marginHorizontal: 20, marginTop: 12, borderRadius: Tokens.radius.panel, padding: 20, gap: 4 },
  heroLabel: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  heroProject: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: Colors.textOnPrimary },
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
  sectionCard: { marginHorizontal: 20, marginTop: 16, backgroundColor: Colors.card, borderRadius: Tokens.radius.panel, padding: 18, borderWidth: 1, borderColor: Colors.cardBorder },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  sectionTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: Colors.text },
  sectionTotal: { flex: 1, fontSize: Type.caption1.fontSize, color: Colors.textMuted, fontWeight: '600' as const },
  roleTileGrid: {
    flexDirection: 'row' as const,
    gap: 8,
    marginBottom: 12,
  },
  workforceTotalLine: {
    fontSize: Type.caption2.fontSize,
    color: Colors.textMuted,
    marginBottom: 8,
  },
  refreshBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: Tokens.radius.sm, backgroundColor: Colors.infoLight },
  refreshBtnText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: Colors.info },
  weatherGrid: { gap: 10 },
  weatherItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  weatherInput: { flex: 1, minHeight: 38, borderRadius: Tokens.radius.md, backgroundColor: Colors.surfaceAlt, paddingHorizontal: 12, fontSize: Type.bodyCompact.fontSize, color: Colors.text },
  weatherValue: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: Colors.text },
  addSmallBtn: { width: 32, height: 32, borderRadius: Tokens.radius.panel, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: Type.footnote.fontSize, color: Colors.textMuted, fontStyle: 'italic' as const },
  mpRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderTopColor: Colors.borderLight, gap: 10 },
  mpInfo: { flex: 1, gap: 2 },
  mpTrade: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: Colors.text },
  mpMeta: { fontSize: Type.caption1.fontSize, color: Colors.textSecondary },
  textArea: { minHeight: 80, borderRadius: Tokens.radius.card, backgroundColor: Colors.surfaceAlt, paddingHorizontal: 14, paddingTop: 12, fontSize: Type.bodyCompact.fontSize, color: Colors.text },
  textInput: { minHeight: 44, borderRadius: Tokens.radius.card, backgroundColor: Colors.surfaceAlt, paddingHorizontal: 14, fontSize: Type.bodyCompact.fontSize, color: Colors.text },
  readOnlyText: { fontSize: Type.bodyCompact.fontSize, color: Colors.text, lineHeight: 20 },
  incidentToggle: { flexDirection: 'row', alignItems: 'center' as const, gap: 10, paddingVertical: 12, paddingHorizontal: 12, borderRadius: Tokens.radius.card, backgroundColor: Colors.surfaceAlt, borderWidth: 1, borderColor: Colors.cardBorder },
  incidentToggleActive: { backgroundColor: Colors.errorLight, borderColor: Colors.error + '40' },
  incidentToggleDot: { width: 16, height: 16, borderRadius: Tokens.radius.sm, borderWidth: 2, borderColor: Colors.border },
  incidentToggleDotActive: { backgroundColor: Colors.error, borderColor: Colors.error },
  incidentToggleText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: Colors.text },
  incidentBlock: { marginTop: 10, gap: 6 },
  incidentLabel: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: Colors.textSecondary, marginTop: 8 },
  severityRow: { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 6 },
  severityChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: Tokens.radius.md, backgroundColor: Colors.fillTertiary },
  severityChipActive: { backgroundColor: Colors.error },
  severityChipText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: Colors.textSecondary },
  severityChipTextActive: { color: '#FFF' },
  checkboxRow: { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 12, marginTop: 8 },
  checkboxItem: { flexDirection: 'row', alignItems: 'center' as const, gap: 6 },
  checkbox: { width: 18, height: 18, borderRadius: 4, borderWidth: 2, borderColor: Colors.border },
  checkboxActive: { backgroundColor: Colors.error, borderColor: Colors.error },
  checkboxLabel: { fontSize: Type.footnote.fontSize, color: Colors.text, fontWeight: '500' as const },
  addMaterialRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  materialInput: { flex: 1, minHeight: 40, borderRadius: Tokens.radius.md, backgroundColor: Colors.surfaceAlt, paddingHorizontal: 12, fontSize: Type.bodyCompact.fontSize, color: Colors.text },
  addMaterialBtn: { width: 40, height: 40, borderRadius: Tokens.radius.md, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  materialRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  materialDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.primary },
  materialText: { flex: 1, fontSize: Type.bodyCompact.fontSize, color: Colors.text },
  photoActions: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  photoBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: Tokens.radius.md, backgroundColor: Colors.primary + '10', borderWidth: 1, borderColor: Colors.primary + '20' },
  photoBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: Colors.primary },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  photoCard: { width: 80, height: 80, borderRadius: Tokens.radius.md, backgroundColor: Colors.surfaceAlt, overflow: 'hidden' as const, position: 'relative' as const },
  photoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  photoTimestamp: { fontSize: 9, color: Colors.textMuted },
  photoRemoveBtn: { position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: Tokens.radius.md, backgroundColor: Colors.errorLight, alignItems: 'center', justifyContent: 'center' },
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: Colors.surface, borderTopWidth: 0.5, borderTopColor: Colors.borderLight, paddingHorizontal: 20, paddingTop: 12, flexDirection: 'row', gap: 10 },
  toggleRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: Colors.fillSecondary,
    borderRadius: Tokens.radius.md,
    marginTop: 12,
  },
  toggleIconWrap: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center' as const, justifyContent: 'center' as const,
    backgroundColor: Colors.primary + '14',
  },
  toggleTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: Colors.text },
  toggleSub: { fontSize: Type.caption2.fontSize, color: Colors.textSecondary, marginTop: 2 },
  toggleSwitch: {
    width: 38, height: 22, borderRadius: 11,
    backgroundColor: Colors.fillTertiary,
    padding: 2,
    justifyContent: 'center' as const,
  },
  toggleSwitchOn: { backgroundColor: Colors.primary },
  toggleKnob: { width: 18, height: 18, borderRadius: 9, backgroundColor: Colors.surface },
  toggleKnobOn: { transform: [{ translateX: 16 }] },
  saveDraftBtn: { flex: 1, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: Colors.fillTertiary, alignItems: 'center', justifyContent: 'center' },
  saveDraftBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: Colors.text },
  saveProjectBtn: { flex: 1, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: Colors.primary + '15', borderWidth: 1.5, borderColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  saveProjectBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: Colors.primary },
  sendBtn: { flex: 1.2, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  sendBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: Colors.textOnPrimary },
  selectedRecipientCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.primary + '10', borderRadius: Tokens.radius.card, paddingHorizontal: 12, paddingVertical: 10, gap: 10, borderWidth: 1, borderColor: Colors.primary + '25' },
  selectedRecipientName: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: Colors.text },
  selectedRecipientEmail: { fontSize: Type.caption1.fontSize, color: Colors.textSecondary },
  clearRecipientBtn: { width: 24, height: 24, borderRadius: Tokens.radius.card, backgroundColor: Colors.fillTertiary, alignItems: 'center', justifyContent: 'center' },
  pickContactBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 8, paddingVertical: 6, paddingHorizontal: 10, borderRadius: Tokens.radius.sm, backgroundColor: Colors.primary + '10' },
  pickContactText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: Colors.primary },
  // Recipient chips (multi-recipient distribution list).
  recipientChipsRow: { flexDirection: 'row', gap: 6, paddingVertical: 4 },
  recipientChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.primary + '10',
    borderRadius: Tokens.radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.primary + '25',
    maxWidth: 240,
  },
  recipientChipText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: Colors.text,
    maxWidth: 180,
  },
  recipientHelpText: {
    fontSize: Type.footnote.fontSize,
    color: Colors.textMuted,
    marginTop: 4,
    marginBottom: 4,
  },
  addRecipientBtn: {
    minWidth: 70,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: Colors.primary,
    borderRadius: Tokens.radius.card,
    paddingHorizontal: 14,
  },
  addRecipientBtnDisabled: {
    backgroundColor: Colors.fillTertiary,
  },
  addRecipientBtnText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '700' as const,
    color: Colors.textOnPrimary,
  },
  // Phase pill (Procore-style "folder" answer — phase wraps the day,
  // no separate folder entity). Sits inline above Work Progress.
  phasePillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Tokens.radius.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  phasePillDot: { width: 10, height: 10, borderRadius: 5 },
  phasePillLabel: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '600' as const,
    color: Colors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  },
  phasePillValue: {
    flex: 1,
    fontSize: Type.subhead.fontSize,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  phasePillOverrideBadge: {
    backgroundColor: Colors.primary + '15',
    borderRadius: Tokens.radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  phasePillOverrideBadgeText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: Colors.primary,
    letterSpacing: 0.3,
  },
  phasePillCta: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '700' as const,
    color: Colors.primary,
  },
  phaseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: Tokens.radius.card,
    backgroundColor: Colors.surfaceAlt,
  },
  phaseRowActive: {
    borderWidth: 1.5,
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '08',
  },
  phaseRowName: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  phaseRowSub: {
    fontSize: Type.caption1.fontSize,
    color: Colors.textMuted,
    marginTop: 2,
  },
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' },
  modalCard: { backgroundColor: Colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, gap: 8 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  modalTitle: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: Colors.text },
  modalFieldLabel: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: Colors.textSecondary, marginTop: 4 },
  modalInput: { minHeight: 44, borderRadius: Tokens.radius.card, backgroundColor: Colors.surfaceAlt, paddingHorizontal: 12, fontSize: Type.subhead.fontSize, color: Colors.text },
  modalRow: { flexDirection: 'row', gap: 10 },
  modalAddBtn: { backgroundColor: Colors.primary, borderRadius: Tokens.radius.lg, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  modalAddBtnText: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: Colors.textOnPrimary },

  modalHelper: {
    fontSize: Type.footnote.fontSize,
    color: Colors.textMuted,
    marginBottom: 4,
  },
  modalDoneBtn: {
    backgroundColor: Colors.primary,
    borderRadius: Tokens.radius.lg,
    paddingVertical: 14,
    alignItems: 'center' as const,
    marginTop: 12,
  },
  modalDoneBtnText: {
    fontSize: Type.callout.fontSize,
    fontWeight: '700' as const,
    color: Colors.textOnPrimary,
  },
  pickerRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: Tokens.radius.card,
    backgroundColor: Colors.surfaceAlt,
  },
  pickerDot: {
    width: 10, height: 10, borderRadius: 5,
  },
  pickerTitle: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  pickerMeta: {
    fontSize: Type.caption2.fontSize,
    color: Colors.textMuted,
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
    borderColor: Colors.borderLight,
    backgroundColor: Colors.surface,
  },
  pctStepBtnText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: Colors.text,
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
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    maxWidth: '100%',
  },
  progressChipDot: {
    width: 8, height: 8, borderRadius: 4,
  },
  progressChipName: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '600' as const,
    color: Colors.text,
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
    marginTop: -6,
    marginBottom: 12,
  },
  progressPill: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: Colors.fillTertiary,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  progressPillReady: {
    backgroundColor: Colors.successLight,
    borderColor: Colors.success + '40',
  },
  progressPillText: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    letterSpacing: 0.1,
  },
  carryBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: Colors.primary + '12',
    borderWidth: 1,
    borderColor: Colors.primary + '40',
  },
  carryBtnText: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '700' as const,
    color: Colors.primary,
    letterSpacing: 0.1,
  },
  carriedBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: Colors.primary + '14',
  },
  carriedBadgeText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: Colors.primary,
    letterSpacing: 0.2,
  },
});
