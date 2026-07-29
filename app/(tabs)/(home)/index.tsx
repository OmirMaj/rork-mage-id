import React, { useCallback, useState, useMemo, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Platform, Modal, TextInput, Pressable, ScrollView, Alert, KeyboardAvoidingView,
} from 'react-native';
import ConstructionLoader from '@/components/ConstructionLoader';
import { SkeletonCard } from '@/components/Skeleton';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Plus, FolderOpen, X, ChevronRight, Calculator, CalendarDays,
  Search, ChevronDown, ChevronUp, HardHat, Bell, CheckCircle2,
  Wallet,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { generateUUID } from '@/utils/generateId';
import { useProjects } from '@/contexts/ProjectContext';
import ProjectCard from '@/components/ProjectCard';
import AIWeeklySummary from '@/components/AIWeeklySummary';
import StatusBarMask from '@/components/StatusBarMask';
import AIHomeBriefing from '@/components/AIHomeBriefing';
import SmartInbox from '@/components/SmartInbox';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { useEntityNavigation } from '@/hooks/useEntityNavigation';
import { useSearch } from '@/contexts/SearchContext';
import EntityActionSheet from '@/components/EntityActionSheet';
import InlineVoiceFill from '@/components/InlineVoiceFill';
import { parseProjectFromTranscript } from '@/utils/voiceFormParsers';
import { useNotificationFeed } from '@/hooks/useNotificationFeed';
import EmptyState from '@/components/EmptyState';
import { IconWrapper } from '@/components/ui/IconWrapper';
import { useAuth } from '@/contexts/AuthContext';
import { OnboardingChecklist } from '@/components/OnboardingChecklist';
import { NextStepHero } from '@/components/NextStepHero';
import { useOnboardingMilestones } from '@/utils/onboardingProgress';
import MageRefreshControl from '@/components/MageRefreshControl';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchStripeConnectStatus } from '@/utils/stripeConnect';
import { effectiveEstimateTotal } from '@/utils/estimateCommit';

// Sticky-dismiss key for the proactive Stripe Connect home banner.
// Versioned so we can re-show after a future revamp if needed.
const STRIPE_BANNER_DISMISSED_KEY = 'mageid_home_stripe_banner_dismissed_v1';
import { DemoSeedPickerModal } from '@/components/DemoSeedPickerModal';
import type { DemoFlavor } from '@/utils/demoSeed';
import { CreateMenu } from '@/components/CreateMenu';
import OfflineSyncPill from '@/components/OfflineSyncPill';
import QuickFieldUpdate from '@/components/QuickFieldUpdate';
import { PROJECT_TYPES, type Project, type ProjectType, type EntityRef } from '@/types';
import WarrantyWalkBanner from '@/components/WarrantyWalkBanner';
import { getUpcomingWarrantyWalks } from '@/utils/warrantyWalks';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import PageHeader from '@/components/PageHeader';
import ProjectRow from '@/components/ProjectRow';
import { useTheme } from '@/contexts/ThemeContext';
import ClientHome from '@/components/ClientHome';
import PropertyManagerHome from '@/components/PropertyManagerHome';
import BrainWatchCard from '@/components/home/BrainWatchCard';
import MorningBriefCard from '@/components/home/MorningBriefCard';
import WeekCloseCard from '@/components/home/WeekCloseCard';

// Canonical 1-indexed, working-day-aware "which schedule day is today" — the
// exact inverse of scheduleEngine.getTaskDateRange (start = addWorkingDays(
// startDate, startDay - 1)). Day 1 = the schedule start date; a date on/before
// start is day 1; weekends are skipped when workingDaysPerWeek < 7 so the count
// matches how task bars are laid out. Replicated verbatim in
// app/(tabs)/summary/index.tsx so Home and Summary agree on "today on site".
function todayScheduleDayNumber(baseMs: number, now: Date, workingDaysPerWeek?: number): number {
  const base = new Date(baseMs);
  base.setHours(0, 0, 0, 0);
  const tgt = new Date(now);
  tgt.setHours(0, 0, 0, 0);
  if (tgt.getTime() <= base.getTime()) return 1;
  const wdpw = workingDaysPerWeek ?? 5;
  if (wdpw >= 7) {
    return Math.floor((tgt.getTime() - base.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  }
  let count = 1;
  const cur = new Date(base);
  while (cur < tgt) {
    cur.setDate(cur.getDate() + 1);
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { openCreate } = useLocalSearchParams<{ openCreate?: string }>();
  const openCreateConsumed = useRef(false);

  // The old home-only FAB stack (and its scroll-hide) was retired — the one
  // global MAGE Brain FAB (app/_layout → components/brain/BrainSurface) now
  // carries AI, voice, and help on every screen.
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const notifFeed = useNotificationFeed();
  // Same width threshold as DesktopActionRail in the tabs layout. When the
  // rail is mounted it becomes the wide-desktop needs-you surface (canonical
  // useBrainWatch set), so we suppress the inline Smart Inbox feed here to
  // avoid two competing attention columns in the same viewport. Keep the
  // breakpoint in sync if you change either side.
  const responsive = useResponsiveLayout();
  const isWideDesktop = responsive.isDesktop && responsive.width >= 1280;
  // Use the dense ProjectRow at tablet+ widths. On phone we keep the
  // ProjectCard pattern — stacked metas read better on narrow screens.
  const useDenseRows = !responsive.isPhone;
  const { navigateTo } = useEntityNavigation();
  const { openSearch } = useSearch();
  const projectCtx = useProjects();
  const { projects, isLoading, addProject, getTotalOutstandingBalance, invoices, settings, userRole } = projectCtx;
  const { user } = useAuth();
  // "Try a sample project" — un-gated as of the explainability refresh.
  // Original design had this owner-only because we worried users would
  // get confused by a fake $511K Henderson Brownstone in their account.
  // 2025 SOTA (Linear, Notion templates) says the opposite: showing a
  // realistic faux-filled project is the FASTEST way for a new user to
  // understand what the app does. The seeded project is clearly named
  // "Sample — The Henderson Residence" and one tap in Settings → Reset
  // wipes it; risk of confusion is now lower than the cost of users
  // bouncing because the empty state taught them nothing.
  void user; // user kept available for future per-tier gates
  const showDemoSeed = true;

  // Free tier is capped at 1 real project (Sample — … demo projects don't
  // count). A free user at the cap gets the upgrade Paywall instead of the
  // create modal. Paid tiers are unlimited (maxProjects: Infinity).
  const { canCreateProject } = useTierAccess();
  const [projectCapPaywall, setProjectCapPaywall] = useState(false);
  const realProjectCount = useMemo(
    () => projects.filter(p => !p.name.startsWith('Sample — ')).length,
    [projects],
  );
  const handleCreatePress = useCallback(() => {
    if (!canCreateProject(realProjectCount)) {
      setProjectCapPaywall(true);
      return;
    }
    setShowCreateModal(true);
  }, [canCreateProject, realProjectCount]);

  // Tutorial replay lives in Settings ("Show Tutorial") and the Brain surface's
  // Help sheet — not on home. NextStepHero is the real first-run spine.

  // Onboarding milestones — drives the 5-step "Get up and running" panel.
  // Re-reads when the project / invoice count changes so the user sees
  // their checks land in real-time after creating a project, sending an
  // invoice, etc. Voice + takeoff milestones come from AsyncStorage flags.
  const milestones = useOnboardingMilestones(`${projects.length}-${invoices.length}`);
  const estimateCount = useMemo(
    () => projects.filter(p =>
      (p.linkedEstimate?.items?.length ?? 0) > 0
      || (p.estimate?.materials?.length ?? 0) > 0
      || effectiveEstimateTotal(p) > 0,
    ).length,
    [projects],
  );

  // Company info checklist signal — "done" when the GC has at least
  // a company name + one contact channel. Pre-fix branding info wasn't
  // on the checklist; sending an invoice with empty branding was the
  // single most embarrassing first-impression bug we shipped.
  const companyInfoDone = useMemo(() => {
    const b = settings?.branding;
    if (!b) return false;
    const hasName = !!b.companyName?.trim();
    const hasContact = !!(b.email?.trim() || b.phone?.trim());
    return hasName && hasContact;
  }, [settings?.branding]);

  // Stripe Connect status — feeds the checklist + the proactive home
  // banner. Polled lazily (10 min stale time) since the value rarely
  // changes; we don't need to hammer the connect-status edge function.
  const stripeStatusQ = useQuery({
    queryKey: ['stripeConnectStatus', user?.id],
    enabled: !!user?.id,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      if (!user?.id) return { status: 'none' as const };
      const r = await fetchStripeConnectStatus(user.id);
      return { status: (r.success && r.status) ? r.status : 'none' as const };
    },
  });
  const stripeConnected = stripeStatusQ.data?.status === 'connected';

  // The picker visibility — empty-state CTA toggles it open; user picks
  // small or large; we call the actual seed.
  const [showDemoPicker, setShowDemoPicker] = useState(false);

  // Stripe Connect banner dismissed state. Loaded once on mount; null
  // means "still loading," false means "show," true means "hide forever."
  const [stripeBannerDismissed, setStripeBannerDismissed] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STRIPE_BANNER_DISMISSED_KEY).then(v => {
      if (!cancelled) setStripeBannerDismissed(v === '1');
    }).catch(() => { if (!cancelled) setStripeBannerDismissed(false); });
    return () => { cancelled = true; };
  }, []);
  const handleDismissStripeBanner = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setStripeBannerDismissed(true);
    void AsyncStorage.setItem(STRIPE_BANNER_DISMISSED_KEY, '1');
  }, []);
  // Show the proactive Stripe Connect banner when: (a) the user has at
  // least one project (so the nudge isn't premature), (b) they're not
  // already connected, (c) they haven't dismissed the banner. The OK-
  // -checklist also surfaces Stripe as a step, but the checklist can be
  // dismissed or auto-hidden; the banner is the durable "you missed
  // this" nudge per the strategic audit.
  const showStripeBanner =
    stripeBannerDismissed === false
    && projects.length >= 1
    && stripeStatusQ.data?.status === 'none';

  const handleSeedFlavor = useCallback(async (flavor: DemoFlavor) => {
    setShowDemoPicker(false);
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { seedDemoProject } = require('@/utils/demoSeed');
      const { projectId } = await seedDemoProject({
        addProject: projectCtx.addProject,
        addInvoice: projectCtx.addInvoice,
        addDailyReport: projectCtx.addDailyReport,
        addPunchItem: projectCtx.addPunchItem,
        addProjectPhoto: projectCtx.addProjectPhoto,
        addRFI: projectCtx.addRFI,
        addChangeOrder: projectCtx.addChangeOrder,
        flavor,
      });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.push({ pathname: '/project-detail' as never, params: { id: projectId } } as never);
    } catch (e) {
      console.warn('[seedDemo] failed', e);
    }
  }, [projectCtx, router]);

  const handleSeedDemo = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setShowDemoPicker(true);
  }, []);

  // Pull-to-refresh — premium SaaS bar. Invalidates projects + invoices
  // + daily reports so the home tab pulls fresh data after a sync.
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
        queryClient.invalidateQueries({ queryKey: ['invoices'] }),
        queryClient.invalidateQueries({ queryKey: ['daily-reports'] }),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);
  const { tier } = useSubscription();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [projectType, setProjectType] = useState<ProjectType>('renovation');
  const [_createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const [showNextStepModal, setShowNextStepModal] = useState(false);
  const [actionSheetRef, setActionSheetRef] = useState<EntityRef | null>(null);

  // The Outstanding total used to anchor a stat tile up top — we kept the
  // computation reachable to other places that may inspect state via the
  // hook, but stripped the visual tile (it duplicated Summary tab).
  void getTotalOutstandingBalance;

  // Surface upcoming 11-month warranty walks. Hidden when none — keeps
  // the home tab quiet during normal operation. Drives an inline banner
  // below the nav bar.
  const warrantyWalkAlerts = useMemo(() => getUpcomingWarrantyWalks(projects), [projects]);

  const [showWeeklySummary, setShowWeeklySummary] = useState(false);
  const [showAIBriefing, setShowAIBriefing] = useState(false);

  // ── Status filter chips ────────────────────────────────────────
  // Replace the old money-themed stat tiles (Total Value / Outstanding /
  // Bulk Savings) with project-state filter chips: "All / Active /
  // Pre-construction / Closeout / Closed". Active is selected by default
  // when the user has any active projects so the list isn't cluttered
  // with closed jobs from years ago. Tapping a chip filters the list
  // below.
  type StatusFilter = 'all' | 'active' | 'precon' | 'closeout' | 'closed';
  const statusBuckets = useMemo(() => {
    const buckets: Record<StatusFilter, Project[]> = {
      all: projects,
      active: projects.filter(p => p.status === 'in_progress'),
      precon: projects.filter(p => p.status === 'draft' || p.status === 'estimated'),
      closeout: projects.filter(p => p.status === 'completed'),
      closed: projects.filter(p => p.status === 'closed'),
    };
    return buckets;
  }, [projects]);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  // First-render correction: if the user has active projects, default to
  // the Active bucket. If they don't (new account, all in pre-con), stay
  // on All. Only fires once — afterwards the user's last choice sticks.
  const [didAutoFilter, setDidAutoFilter] = useState(false);
  useEffect(() => {
    if (didAutoFilter) return;
    if (projects.length === 0) return;
    // Only auto-select 'active' when the filter chips are actually
    // rendered (projects.length >= 5, matching the chip render guard
    // below). Otherwise a user with 1-4 projects — at least one
    // in_progress — got silently pinned to 'active' with NO chip to
    // switch back, hiding their completed/closed jobs with no way out.
    if (projects.length >= 5 && statusBuckets.active.length > 0) setStatusFilter('active');
    setDidAutoFilter(true);
  }, [projects.length, statusBuckets.active.length, didAutoFilter]);

  // FF1-A: /?openCreate=1 is pushed by the global "+" "Project" row,
  // the zero-project fallback, and the onboarding checklist's #1 row,
  // but nothing consumed it (the route resolved to home with no modal).
  // Open the create modal exactly once, then clear the param. The ref
  // guard guarantees fire-once even if a re-render re-delivers it before
  // setParams clears; no param ⇒ inert ⇒ zero change to normal entry.
  useEffect(() => {
    if (openCreate && !openCreateConsumed.current) {
      openCreateConsumed.current = true;
      handleCreatePress();
      router.setParams({ openCreate: undefined });
    }
  }, [openCreate, router, handleCreatePress]);

  const filteredProjects = useMemo(
    () => statusBuckets[statusFilter],
    [statusBuckets, statusFilter],
  );

  // ── Today on site ──────────────────────────────────────────────
  // Active projects whose schedule has at least one task running today.
  // Membership MUST match the Summary tab's "Today on site" exactly — both
  // surfaces use the canonical 1-indexed, working-day-aware model that the
  // schedule engine uses (utils/scheduleEngine getTaskDateRange:
  //   start = addWorkingDays(startDate, startDay - 1); end = +durationDays-1).
  // So `todayDayNumber` is a 1-INDEXED working-day count from the schedule
  // start (day 1 = start date; weekends skipped when workingDaysPerWeek < 7),
  // and a task is live when startDay <= todayDayNumber <= startDay+dur-1.
  // Uses schedule.startDate as day 1; falls back to project.createdAt.
  const todayOnSite = useMemo(() => {
    const out: { project: Project; activeTaskTitles: string[] }[] = [];
    const now = new Date();
    for (const p of projects) {
      if (p.status !== 'in_progress') continue;
      const sched = p.schedule;
      if (!sched || !sched.tasks || sched.tasks.length === 0) continue;
      const baseIso = sched.startDate || p.createdAt;
      const baseMs = Date.parse(baseIso);
      if (!Number.isFinite(baseMs)) continue;
      const todayDayNumber = todayScheduleDayNumber(baseMs, now, sched.workingDaysPerWeek);
      const liveTasks = sched.tasks.filter(t => {
        if (t.status === 'done') return false;
        const start = Math.max(1, t.startDay ?? 1);
        const dur = Math.max(0, t.durationDays ?? 0);
        // Inclusive last active day = start + dur - 1 (matches getTaskDateRange).
        return todayDayNumber >= start && todayDayNumber <= start + dur - 1;
      });
      if (liveTasks.length > 0) {
        out.push({
          project: p,
          activeTaskTitles: liveTasks.slice(0, 3).map(t => t.title),
        });
      }
    }
    // Cap at 4 so the strip stays compact. Anyone running 5+ jobs at
    // once is likely a small commercial GC who'll drill into Summary
    // anyway for the full picture.
    return out.slice(0, 4);
  }, [projects]);

  const handleProjectPress = useCallback((project: Project) => {
    console.log('[Home] Opening project:', project.id);
    navigateTo({ kind: 'project', id: project.id });
  }, [navigateTo]);

  const handleCreateProject = useCallback(() => {
    const name = projectName.trim();
    if (!name) {
      Alert.alert('Missing Name', 'Please enter a project name.');
      return;
    }
    const now = new Date().toISOString();
    // MUST be a real UUID — projects.id is uuid in Supabase. Pre-fix this
    // used `project-{timestamp}-{rand}`, which Postgres rejected on upsert.
    // The error was caught silently in supabaseWrite, so the row only
    // existed in local AsyncStorage; on the next refetch the project
    // disappeared because the server didn't have it.
    const id = generateUUID();
    const newProject: Project = {
      id,
      name,
      type: projectType,
      location: 'United States',
      squareFootage: 0,
      quality: 'standard',
      description: projectDescription.trim(),
      createdAt: now,
      updatedAt: now,
      estimate: null,
      schedule: null,
      status: 'draft',
    };
    addProject(newProject);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setShowCreateModal(false);
    setCreatedProjectId(id);
    setShowNextStepModal(true);
    setProjectName('');
    setProjectDescription('');
    setProjectType('renovation');
  }, [projectName, projectDescription, projectType, addProject]);

  const handleNextStep = useCallback((step: 'estimate' | 'schedule' | 'later') => {
    setShowNextStepModal(false);
    // Carry the just-created project into the wizard. Pre-audit this did
    // router.replace('/(tabs)/estimate') with NO projectId — the single
    // most-guided moment dropped context, landing the user on a generic
    // tab bound to the wrong (or no) project. estimate-wizard is now
    // project-aware (scope feature), so passing projectId folds the AI
    // estimate straight into the project. These are modal/stack screens,
    // not tabs, so push-with-params is correct here.
    const pid = _createdProjectId;
    if (step === 'estimate' && pid) {
      router.push({ pathname: '/estimate-wizard', params: { projectId: pid } } as never);
    } else if (step === 'schedule' && pid) {
      router.push({ pathname: '/schedule-wizard', params: { projectId: pid } } as never);
    }
    setCreatedProjectId(null);
  }, [router, _createdProjectId]);

  const renderProject = useCallback(({ item, index }: { item: Project; index: number }) => (
    <ProjectCard
      project={item}
      index={index}
      onPress={() => handleProjectPress(item)}
      onLongPress={() => {
        if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        setActionSheetRef({ kind: 'project', id: item.id, label: item.name });
      }}
    />
  ), [handleProjectPress]);

  // Dense-row variant: at tablet+ widths we render the projects as a single
  // bordered "table" with internal dividers (one wrapping View, one row per
  // project) instead of a stack of independent floating cards. Reads as a
  // SaaS data table — denser, more scannable on wide screens.
  const denseProjectList = useMemo(() => {
    if (!useDenseRows || filteredProjects.length === 0) return null;
    return (
      <View style={styles.denseListWrap}>
        <View style={styles.denseListSectionHeader}>
          <Text style={styles.denseListSectionTitle}>
            {statusFilter === 'all' ? 'All projects'
              : statusFilter === 'active' ? 'Active'
              : statusFilter === 'precon' ? 'Pre-construction'
              : statusFilter === 'closeout' ? 'Closeout'
              : 'Closed'}
          </Text>
          <Text style={styles.denseListSectionCount}>{filteredProjects.length}</Text>
        </View>
        <View style={styles.denseListContainer}>
          {filteredProjects.map((p, idx) => (
            <ProjectRow
              key={p.id}
              project={p}
              showDivider={idx < filteredProjects.length - 1}
              onPress={() => handleProjectPress(p)}
              onLongPress={() => {
                if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                setActionSheetRef({ kind: 'project', id: p.id, label: p.name });
              }}
            />
          ))}
        </View>
      </View>
    );
  }, [useDenseRows, filteredProjects, statusFilter, handleProjectPress]);

  // Secondary widgets that used to live above the project list. Moved
  // BELOW the project list so the user's first scroll-target is the
  // project itself — the most common thing they came here to do.
  // QuickFieldUpdate / AI summary toggle stay one short scroll away.
  const projectsFooterExtras = useMemo(() => {
    if (projects.length === 0) return null;
    return (
      <View style={styles.footerExtras}>
        {/* Ask MAGE — whole-business conversational agent. Entry point lives
            in the home AI section; opens the /ask chat. */}
        <TouchableOpacity
          onPress={() => router.push('/ask' as never)}
          activeOpacity={0.85}
          testID="home-ask-mage"
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 10,
            backgroundColor: themeColors.accentSoft, borderRadius: Tokens.radius.lg,
            paddingHorizontal: 16, paddingVertical: 14, marginBottom: 8,
            borderWidth: 1, borderColor: themeColors.accent,
          }}
        >
          <MageAIMark size={18} color={themeColors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: themeColors.text, fontWeight: '800', fontSize: Type.footnote.fontSize }}>Ask MAGE anything</Text>
            <Text style={{ color: themeColors.textSecondary, fontSize: Type.caption2.fontSize, marginTop: 2 }}>
              What&apos;s overdue? What&apos;s unbilled? Which job is over budget?
            </Text>
          </View>
          <ChevronRight size={16} color={themeColors.accent} strokeWidth={2} />
        </TouchableOpacity>

        {/* Copilot Hub — voice-driven workflow builder. Cross-link from home
            so the flagship conversational surface is one tap away without
            requiring the user to navigate to a specific project first. */}
        <TouchableOpacity
          onPress={() => router.push('/copilot-hub' as never)}
          activeOpacity={0.85}
          testID="home-copilot-hub"
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 10,
            backgroundColor: themeColors.surface, borderRadius: Tokens.radius.lg,
            paddingHorizontal: 16, paddingVertical: 14, marginBottom: 12,
            borderWidth: 1, borderColor: themeColors.line,
          }}
        >
          <MageAIMark size={18} color={themeColors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: themeColors.text, fontWeight: '700', fontSize: Type.footnote.fontSize }}>MAGE Copilot</Text>
            <Text style={{ color: themeColors.textSecondary, fontSize: Type.caption2.fontSize, marginTop: 2 }}>
              Say what you need — build schedules, write change orders, create reports by voice
            </Text>
          </View>
          <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={2} />
        </TouchableOpacity>
        <View style={styles.aiBriefingWrap}>
          <TouchableOpacity
            style={styles.aiBriefingToggle}
            onPress={() => setShowAIBriefing(prev => !prev)}
            activeOpacity={0.7}
            testID="ai-briefing-toggle"
          >
            <View style={styles.aiBriefingToggleLeft}>
              <MageAIMark size={14} color={themeColors.accent} />
              <Text style={styles.aiBriefingToggleText}>
                {showAIBriefing ? 'Hide AI summary' : 'Get AI summary'}
              </Text>
            </View>
            {showAIBriefing
              ? <ChevronUp size={14} color={themeColors.textSecondary} strokeWidth={2} />
              : <ChevronDown size={14} color={themeColors.textSecondary} strokeWidth={2} />}
          </TouchableOpacity>
          {showAIBriefing && (
            <AIHomeBriefing
              projects={projects}
              invoices={invoices}
              subscriptionTier={tier as any}
              onViewFull={() => setShowWeeklySummary(true)}
            />
          )}
        </View>
        <QuickFieldUpdate />
      </View>
    );
  }, [projects, invoices, tier, showAIBriefing, themeColors.accent, themeColors.textSecondary, router]);

  // Compose the footer: project list first (denseProjectList renders nothing
  // on phone widths since they use FlatList items), then secondary widgets.
  const listFooter = useMemo(() => (
    <View>
      {denseProjectList}
      {projectsFooterExtras}
    </View>
  ), [denseProjectList, projectsFooterExtras]);

  const keyExtractor = useCallback((item: Project) => item.id, []);

  if (isLoading) {
    // Show 3 skeleton cards instead of a centered spinner. Preserves the
    // visual rhythm of the project list so content appears to fade in
    // rather than punch through a loader. Premium-app feel.
    return (
      <View style={[styles.container, { backgroundColor: themeColors.bg, paddingTop: insets.top + 16 }]}>
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </View>
    );
  }



  // Persona branch — clients see a marketplace-shaped hub (post RFP →
  // bids → award → track), not the contractor operations dashboard.
  // 'both' falls through to the contractor view by design (user can
  // switch personas from Settings). Placed AFTER all hooks have fired
  // so we don't violate the rules of hooks; the contractor-specific
  // hook work is wasted for client renders but the cost is small
  // (mostly cached query reads + AsyncStorage). If this becomes a real
  // perf issue, split HomeScreen into two sibling components — one for
  // each persona — and dispatch at the route level.
  if (userRole === 'client') {
    return <ClientHome />;
  }
  if (userRole === 'property_manager') {
    return <PropertyManagerHome />;
  }

  return (
    <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
      <FlatList
        // At tablet+ widths the project list is rendered as a single bordered
        // table inside ListFooterComponent (denseProjectList). FlatList still
        // owns the scroll surface + refresh control; we just bypass per-item
        // rendering so the rows can connect into a unified card.
        data={useDenseRows ? [] : filteredProjects}
        renderItem={renderProject}
        keyExtractor={keyExtractor}
        ListFooterComponent={listFooter}
        // FlatList perf knobs: render only the first 6 cards initially, keep
        // off-screen cards in 11 windows (~5 above + 5 below current), and
        // clip subviews on Android (no-op on iOS). Tuned for the common case
        // (10-30 projects) — doesn't materially help past ~50 items, which
        // is where FlashList would matter.
        initialNumToRender={6}
        maxToRenderPerBatch={8}
        windowSize={11}
        removeClippedSubviews={Platform.OS === 'android'}
        refreshControl={
          <MageRefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
        scrollEventThrottle={32}
        contentContainerStyle={[
          styles.listContent,
          responsive.isDesktop && styles.listContentDesktop,
          // Bottom padding clears the single MAGE Brain FAB (bottom:
          // insets.bottom + 70, 56px) plus a margin so the last rows aren't
          // tucked under it: 70 + 56 + 24 = 150.
          { paddingTop: insets.top, paddingBottom: insets.bottom + 150 },
          projects.length === 0 && styles.emptyList,
        ]}
        ListHeaderComponent={
          <View>
            {/* Unified PageHeader replaces the old two-row pattern (a
                navBar with logo + 3 icons stacked above a separate large
                title). The new strip puts title + sync chip on the left
                and search field + bell + create on the right — single
                toolbar instead of two disconnected rows. Phone widths
                drop the inline search field and rely on the search icon
                button in the actions cluster. */}
            <PageHeader
              title="Your Projects"
              statusPill={<OfflineSyncPill />}
              onSearchPress={openSearch}
              actions={
                <>
                  {responsive.isPhone && (
                    <TouchableOpacity
                      style={[styles.addButton, { backgroundColor: themeColors.surfaceAlt }]}
                      onPress={openSearch}
                      activeOpacity={0.7}
                      testID="universal-search-btn"
                      accessibilityRole="button"
                      accessibilityLabel="Search"
                    >
                      <Search size={20} color={themeColors.accent} strokeWidth={2} />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={[styles.addButton, { backgroundColor: themeColors.surfaceAlt }]}
                    onPress={() => router.push('/notifications-inbox' as any)}
                    activeOpacity={0.7}
                    testID="notifications-inbox-btn"
                  >
                    <Bell size={20} color={themeColors.accent} strokeWidth={2} />
                    {notifFeed.unreadCount > 0 && (
                      <View style={styles.notifBadge}>
                        <Text style={styles.notifBadgeText}>
                          {notifFeed.unreadCount > 9 ? '9+' : String(notifFeed.unreadCount)}
                        </Text>
                      </View>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.addButton}
                    onPress={() => setShowCreateMenu(true)}
                    activeOpacity={0.7}
                    testID="new-project-btn"
                    accessibilityRole="button"
                    accessibilityLabel="Add"
                  >
                    <Plus size={18} color={Colors.textOnAccent} strokeWidth={2.5} />
                  </TouchableOpacity>
                </>
              }
            />
            {/* Hero chart was here (cumulative booked $). Removed in
                the Your Projects clean-up: it duplicated the money-themed
                surfaces that already live on the Summary tab and didn't
                drive any decision a small GC actually makes. The new top
                of this screen is filter chips + Today on site instead. */}

            {/* 11-month warranty walk reminders — only renders when
                there are upcoming/overdue walks. Tap → opens project. */}
            <WarrantyWalkBanner alerts={warrantyWalkAlerts} />

            {/* Morning Brief — pinned entry card until opened or dismissed
                today (BRIEF_LAST_SEEN_KEY). Business+; renders nothing below
                the gate. Also owns the local nudge re-arm loop. */}
            {projects.length > 0 && !isLoading && <MorningBriefCard />}
            {/* Friday Close — pinned Fri–Sun until seen/dismissed this week.
                Mounts the once-per-session leak CO sweep (F3) as a side-effect.
                Business+; renders nothing below the gate. */}
            {projects.length > 0 && !isLoading && <WeekCloseCard />}

            {/* Brain Watch — proactive "what needs your attention now" card.
                Aggregates schedule health, overdue invoices, upcoming permit
                inspections, and expiring certifications from signals the engine
                already computes. Renders once projects have loaded so the card
                never flickers empty on cold launch. */}
            {projects.length > 0 && !isLoading && <BrainWatchCard />}

            {/* "Today" feed — surfaces overdue invoices, unanswered
                RFIs, pending CO approvals, late tasks, etc. as the
                FIRST scrollable content under the title. North-star
                pattern (CompanyCam): the user opens the app and the
                very first thing they see is "what needs you right now"
                — before stats, before project list. SmartInbox already
                aggregates from useSmartInbox(). Renders nothing when
                there are zero items. */}
            {/* Inline SmartInbox is suppressed at wide desktop widths — the
                DesktopActionRail in the tabs layout is rendering the same
                items in the right column. */}
            {projects.length > 0 && !isWideDesktop && <SmartInbox />}

            {/* ── Status filter chips ─────────────────────────────
                Replaces the old 4-tile stats grid (Projects / Outstanding
                / Total Value / Bulk Savings). Each chip filters the
                project list below — a Linear-style segmented control
                with a count next to each label. The financial numbers
                live on the Summary tab; this screen is for finding the
                right project quickly. Threshold raised from > 0 to >= 5
                (May 2026 UX rollup): filtering 1-3 projects is noise that
                competes with the NextStepHero card for attention. */}
            {(projects.length >= 5 || projects.some(p => p.status !== 'in_progress')) && (
              <View style={styles.filterChipsWrap}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChipsScroll}>
                  {([
                    { key: 'all',      label: 'All',             count: statusBuckets.all.length },
                    { key: 'active',   label: 'Active',          count: statusBuckets.active.length },
                    { key: 'precon',   label: 'Pre-construction',count: statusBuckets.precon.length },
                    { key: 'closeout', label: 'Closeout',        count: statusBuckets.closeout.length },
                    { key: 'closed',   label: 'Closed',          count: statusBuckets.closed.length },
                  ] as { key: StatusFilter; label: string; count: number }[]).map(chip => {
                    const isActive = statusFilter === chip.key;
                    return (
                      <TouchableOpacity
                        key={chip.key}
                        onPress={() => {
                          if (Platform.OS !== 'web') void Haptics.selectionAsync();
                          setStatusFilter(chip.key);
                        }}
                        activeOpacity={0.85}
                        style={[styles.filterChip, isActive && styles.filterChipActive]}
                        testID={`filter-chip-${chip.key}`}
                      >
                        <Text style={[styles.filterChipLabel, isActive && styles.filterChipLabelActive]}>
                          {chip.label}
                        </Text>
                        <Text style={[styles.filterChipCount, isActive && styles.filterChipCountActive]}>
                          {chip.count}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            {/* ── Today on site ──────────────────────────────────
                Active projects with at least one task running today per
                their schedule. The "what's actually happening on the
                ground RIGHT NOW" line — the contractor's mental model.
                Renders nothing when nothing's on (weekends, between
                phases) so the screen stays quiet. */}
            {todayOnSite.length > 0 && (
              <View style={styles.todaySection}>
                <Text style={styles.sectionHeader}>TODAY ON SITE</Text>
                <View style={styles.todayCard}>
                  {todayOnSite.map((entry, idx) => (
                    <TouchableOpacity
                      key={entry.project.id}
                      onPress={() => handleProjectPress(entry.project)}
                      activeOpacity={0.7}
                      style={[styles.todayRow, idx < todayOnSite.length - 1 && styles.todayRowDivider]}
                      testID={`today-on-site-${entry.project.id}`}
                    >
                      <View style={styles.todayDot} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.todayProjectName} numberOfLines={1}>{entry.project.name}</Text>
                        <Text style={styles.todayTasks} numberOfLines={1}>
                          {entry.activeTaskTitles.join(' · ')}
                        </Text>
                      </View>
                      <ChevronRight size={14} color={themeColors.textMuted} strokeWidth={1.75} />
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            {/* (SmartInbox moved above the stats — see line ~346 — so
                "what needs you right now" reads first.) */}

            {/* Proactive Stripe Connect banner. Shows when the GC has a
                project but hasn't connected Stripe — the audit's #1
                friction point ("first time you hit Send invoice, you
                get blocked"). Houzz Pro / Buildertrend both surface
                this in onboarding; we surface it on Home until they
                act on it. Dismissable per the audit doc. */}
            {showStripeBanner && (
              <TouchableOpacity
                style={styles.stripeBanner}
                onPress={() => router.push('/payments-setup' as never)}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Connect Stripe to get paid"
                testID="stripe-connect-home-banner"
              >
                <View style={styles.stripeBannerIcon}>
                  <Wallet size={20} color="#FFFFFF" strokeWidth={1.75} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.stripeBannerTitle}>Get paid in one tap</Text>
                  <Text style={styles.stripeBannerSub}>
                    Connect Stripe so clients can pay invoices from their phone. Takes 2 minutes.
                  </Text>
                </View>
                <ChevronRight size={18} color="#FFFFFF" style={{ opacity: 0.85 }} strokeWidth={1.75} />
                <TouchableOpacity
                  onPress={handleDismissStripeBanner}
                  hitSlop={8}
                  style={styles.stripeBannerClose}
                  accessibilityRole="button"
                  accessibilityLabel="Dismiss"
                >
                  <X size={14} color="#FFFFFF" strokeWidth={1.75} />
                </TouchableOpacity>
              </TouchableOpacity>
            )}

            {/* 5-step onboarding checklist — auto-hides at 4/5 done OR
                when explicitly dismissed. New users always see it; veteran
                users never do. */}
            <OnboardingChecklist
              companyInfoDone={companyInfoDone}
              projectCount={projects.length}
              estimateCount={estimateCount}
              stripeConnected={stripeConnected}
              invoiceCount={invoices.length}
              triedWowFeature={milestones.voiceUsed || milestones.takeoffRun || estimateCount > 0}
            />

            {/* NextStepHero — the answer to "where do I start?" for users
                who've completed onboarding. Picks one action from current
                state (overdue invoices, expiring COIs, stale RFIs, fresh
                projects without scope/estimate/invoice) and renders it
                as a single CTA. Hidden when there's nothing to suggest —
                a calm view is the reward for being caught up. */}
            {projects.length > 0 && projects.every(p => p.name.startsWith('Sample — ')) ? (
              // Only the auto-seeded demo projects exist. NextStepHero is
              // sample-filtered (renders nothing here), so without this the
              // brand-new user has no spine. Tell them plainly these are
              // samples and point at project creation.
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={handleCreatePress}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 12,
                  marginHorizontal: 16, marginBottom: 12, padding: 14, borderRadius: 14,
                  backgroundColor: themeColors.surfaceAlt,
                  borderWidth: StyleSheet.hairlineWidth, borderColor: themeColors.line,
                }}
                testID="samples-banner"
              >
                <MageAIMark size={20} color={themeColors.accent} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: themeColors.text }}>
                    These are sample projects
                  </Text>
                  <Text style={{ fontSize: 13, color: themeColors.textSecondary, marginTop: 2 }}>
                    Tap to create your own and start for real.
                  </Text>
                </View>
                <ChevronRight size={18} color={themeColors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
            ) : projects.length > 0 ? (
              <NextStepHero
                projects={projects}
                invoices={invoices}
              />
            ) : null}

            {/* AI summary + Quick Field Update moved below the project
                list — the user's first scroll target is now the project
                itself. (Onboarding checklist stays here because it auto-
                hides at 4/5 milestones done — veteran users never see it.) */}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon={<HardHat size={40} color={themeColors.accent} strokeWidth={1.6} />}
            title="Build something"
            message="Your first project is one tap away. Add it to start tracking estimates, daily reports, invoices — every job, every detail."
            actionLabel="Create your first project"
            onAction={handleCreatePress}
            secondaryLabel={showDemoSeed ? 'Try a sample project (small or large)' : undefined}
            onSecondaryAction={showDemoSeed ? handleSeedDemo : undefined}
          />
        }
        showsVerticalScrollIndicator={false}
      />

      {/* Opaque strip under the clock/Dynamic Island — home's large-title
          header lives INSIDE the scroll surface, so scrolled content was
          colliding with the status bar (sim-audit #7). */}
      <StatusBarMask />

      <Modal visible={showCreateModal} transparent animationType="slide" onRequestClose={() => setShowCreateModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <View style={[styles.createModalCard, { paddingBottom: insets.bottom + 20 }]}>
              <View style={styles.createModalHeader}>
                <Text style={styles.createModalTitle}>New Project</Text>
                <TouchableOpacity onPress={() => setShowCreateModal(false)} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close">
                  <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} style={styles.createModalScroll} keyboardShouldPersistTaps="handled">
                <InlineVoiceFill
                  title="Dictate this project"
                  buttonLabel="Fill project by voice"
                  suggestions={[
                    'Smith kitchen remodel at 123 Main Street San Diego, budget eighty thousand',
                    'Bathroom renovation for the Patel residence, twenty-five thousand',
                    'Two-story addition on the Garcia house, two hundred thousand budget',
                    'New construction ADU at 456 Oak Avenue, one fifty start date June 1st',
                  ]}
                  onTranscript={async (transcript) => {
                    const partial = await parseProjectFromTranscript(transcript);
                    if (partial.name) setProjectName(prev => prev || partial.name);
                    if (partial.notes) setProjectDescription(prev => prev || partial.notes);
                    if (partial.type) setProjectType(partial.type as ProjectType);
                  }}
                />

                <Text style={styles.fieldLabel}>Project Name</Text>
                <TextInput
                  style={styles.input}
                  value={projectName}
                  onChangeText={setProjectName}
                  placeholder="e.g. Kitchen Renovation"
                  placeholderTextColor={themeColors.textMuted}
                  autoFocus
                  testID="project-name-input"
                />

                <Text style={styles.fieldLabel}>Description</Text>
                <TextInput
                  style={[styles.input, styles.descInput]}
                  value={projectDescription}
                  onChangeText={setProjectDescription}
                  placeholder="Brief description of the project..."
                  placeholderTextColor={themeColors.textMuted}
                  multiline
                  textAlignVertical="top"
                  testID="project-desc-input"
                />

                <Text style={styles.fieldLabel}>Project Type</Text>
                <View style={styles.typeGrid}>
                  {PROJECT_TYPES.map(pt => (
                    <TouchableOpacity
                      key={pt.id}
                      style={[styles.typeChip, projectType === pt.id && styles.typeChipActive]}
                      onPress={() => setProjectType(pt.id)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.typeChipLabel, projectType === pt.id && styles.typeChipLabelActive]}>{pt.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={{ height: 20 }} />
              </ScrollView>

              <TouchableOpacity style={styles.createBtn} onPress={handleCreateProject} activeOpacity={0.85} testID="create-project-btn">
                <Text style={styles.createBtnText}>Create Project</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>


      <Modal visible={showNextStepModal} transparent animationType="fade" onRequestClose={() => setShowNextStepModal(false)}>
        <Pressable style={styles.modalOverlayCenter} onPress={() => handleNextStep('later')}>
          <Pressable style={styles.nextStepCard} onPress={() => undefined}>
            <View style={styles.nextStepSuccessIcon}>
              <CheckCircle2 size={36} color={themeColors.success} strokeWidth={2.4} />
            </View>
            <Text style={styles.nextStepTitle}>Project Created!</Text>
            <Text style={styles.nextStepDesc}>What would you like to do next?</Text>

            <TouchableOpacity style={styles.nextStepOption} onPress={() => handleNextStep('estimate')} activeOpacity={0.7}>
              <IconWrapper icon={Calculator} tone="accent" size="md" />
              <View style={styles.nextStepTextWrap}>
                <Text style={styles.nextStepOptionTitle}>Create Estimate</Text>
                <Text style={styles.nextStepOptionDesc}>Search materials and build a cost estimate</Text>
              </View>
              <ChevronRight size={18} color={themeColors.textMuted} strokeWidth={1.75} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.nextStepOption} onPress={() => handleNextStep('schedule')} activeOpacity={0.7}>
              <IconWrapper icon={CalendarDays} tone="info" size="md" />
              <View style={styles.nextStepTextWrap}>
                <Text style={styles.nextStepOptionTitle}>Create Schedule</Text>
                <Text style={styles.nextStepOptionDesc}>Plan tasks and timeline for this project</Text>
              </View>
              <ChevronRight size={18} color={themeColors.textMuted} strokeWidth={1.75} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.laterBtn} onPress={() => handleNextStep('later')} activeOpacity={0.7}>
              <Text style={styles.laterBtnText}>I'll do this later</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <AIWeeklySummary
        projects={projects}
        visible={showWeeklySummary}
        onClose={() => setShowWeeklySummary(false)}
      />


      <EntityActionSheet
        entityRef={actionSheetRef}
        onClose={() => setActionSheetRef(null)}
        onAction={(id, ref) => {
          if (id !== 'duplicate' || ref.kind !== 'project') return;
          const source = projects.find(p => p.id === ref.id);
          if (!source) return;
          // Scope-only clone: keep the inputs that took effort to set
          // up (name, type, sf, quality, location, contract model,
          // linked estimate). Drop the execution artifacts — they
          // belong to the original job, not the template. Resetting
          // status='draft' and createdAt=now lets the new project flow
          // through the normal new-project setup (geocode, etc.).
          const now = new Date().toISOString();
          const clone: Project = {
            ...source,
            id: generateUUID(),
            name: `${source.name} (copy)`,
            status: 'draft',
            createdAt: now,
            updatedAt: now,
            // Reset closeout / warranty state — those refer to the
            // source project's lifecycle, not the clone's.
            closedAt: undefined,
            substantialCompletionDate: undefined,
            warrantyWalkCompletedAt: undefined,
            // Re-geocode after the user adjusts the address (if any).
            locationLatitude: undefined,
            locationLongitude: undefined,
            locationGeocodedAt: undefined,
            // Photos / DFRs / invoices / RFIs / change orders / contacts
            // live in their own contexts keyed by project_id — we don't
            // copy them here. The clone starts as a clean execution surface.
            photoCount: 0,
            // Strip collaborators + public portfolio — opt in per project.
            collaborators: undefined,
            publicProfile: undefined,
          };
          addProject(clone);
          if (Platform.OS !== 'web') {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
          // Navigate to the new draft so the user can adjust right away.
          router.push({ pathname: '/project-detail', params: { id: clone.id } } as never);
        }}
      />


      {/* Demo-seed picker — small ($420K) or large ($14M). Empty-state
          "Try a sample project" CTA toggles this open. */}
      <DemoSeedPickerModal
        visible={showDemoPicker}
        onClose={() => setShowDemoPicker(false)}
        onPick={handleSeedFlavor}
      />

      {/* + New… discovery sheet (Notion "/" / Linear Cmd+K analog).
          Lists every creatable thing in the app with plain-English
          subtitles so users can discover features they didn't know
          existed. Triggered by the (+) button in the navbar.

          We pass the "create project" callback through so picking
          Project opens the same in-place modal the empty-state CTA
          uses — keeps a single source of truth for project creation. */}
      <CreateMenu
        visible={showCreateMenu}
        onClose={() => setShowCreateMenu(false)}
        onCreateProject={handleCreatePress}
      />
      <Paywall
        visible={projectCapPaywall}
        feature="Unlimited Projects"
        requiredTier="pro"
        onClose={() => setProjectCapPaywall(false)}
      />
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: t.bg,
  },
  loaderWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingBottom: 20,
  },
  listContentDesktop: {
    width: '100%',
    maxWidth: 1100,
    alignSelf: 'center' as const,
  },
  emptyList: {
    flex: 1,
  },
  navBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  // Bumped from small uppercase ("MAGE ID" tracking 0.3, 13px) to a
  // proper brand wordmark — feels like the app is owned by the brand
  // instead of just labeled by it. User asked to "make the app more
  // exciting looking entirely"; the navbar is the first thing they see.
  navTitle: {
    fontSize: Type.title2.fontSize,
    fontWeight: '900' as const,
    color: t.accent,
    letterSpacing: -0.4,
  },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: t.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: t.danger,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: t.bg,
  },
  notifBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' as const, letterSpacing: -0.2 },
  titleRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    paddingHorizontal: 20,
    marginTop: 4,
    marginBottom: 20,
  },
  largeTitle: {
    fontSize: Type.largeTitle.fontSize,
    fontWeight: '700' as const,
    color: t.text,
    letterSpacing: -0.5,
  },
  // Proactive Stripe Connect banner. Filled accent for unmissability —
  // this is the highest-leverage Day-1 nudge in the app.
  stripeBanner: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    paddingRight: 32, // room for the absolute-positioned close button
    backgroundColor: t.accent,
    borderRadius: Tokens.radius.lg,
    shadowColor: t.accent,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 4,
    position: 'relative' as const,
  },
  stripeBannerIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  stripeBannerTitle: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '800' as const,
    color: '#FFFFFF',
    letterSpacing: -0.1,
  },
  stripeBannerSub: {
    fontSize: Type.caption1.fontSize,
    color: 'rgba(255,255,255,0.88)',
    marginTop: 2,
    lineHeight: 16,
  },
  stripeBannerClose: {
    position: 'absolute' as const,
    top: 8, right: 8,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.18)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  statsSection: {
    paddingHorizontal: 20,
    marginBottom: 28,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  // KPI card refresh — neutralized icon treatment (monochrome bg,
  // smaller chip in the corner) and a bigger, more confident number.
  // Color now lives only on the value itself when it carries meaning
  // (e.g. Bulk Savings / Outstanding) — all decoration is grayscale,
  // matching the SaaS-dashboard reference layout the user shared.
  statCard: {
    flex: 1,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.panel,
    padding: 18,
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: t.line,
    minHeight: 96,
  },
  statCardMiddle: {
    backgroundColor: t.surface,
  },
  // Icon now sits in a neutral fill chip — color is reserved for the
  // number itself when meaningful. The icon becomes a quiet category
  // marker rather than a decoration grabbing attention.
  statIconWrap: {
    width: 28,
    height: 28,
    borderRadius: Tokens.radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    backgroundColor: t.surfaceAlt,
  },
  statNumber: {
    fontSize: Type.title2.fontSize,
    fontWeight: '800' as const,
    color: t.text,
    letterSpacing: -0.6,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: Type.caption1.fontSize,
    color: t.textSecondary,
    fontWeight: '500' as const,
    letterSpacing: 0.1,
  },
  // Dense desktop project list — wraps ProjectRow children in a single
  // bordered card with internal row dividers. Mirrors a SaaS data-table
  // layout (Linear / Notion / the reference dashboard).
  denseListWrap: {
    paddingHorizontal: 20,
    marginTop: 8,
    marginBottom: 24,
  },
  denseListSectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  denseListSectionTitle: {
    fontSize: Type.subheadline.fontSize,
    fontWeight: '700' as const,
    color: t.text,
    letterSpacing: -0.1,
  },
  denseListSectionCount: {
    fontSize: Type.footnote.fontSize,
    color: t.textSecondary,
    fontWeight: '600' as const,
  },
  denseListContainer: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.panel,
    borderWidth: 1,
    borderColor: t.line,
    overflow: 'hidden' as const,
  },
  sectionHeader: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '600' as const,
    color: t.textSecondary,
    letterSpacing: 0.6,
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  footerExtras: {
    marginTop: 8,
  },
  aiBriefingWrap: {
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 4,
  },
  aiBriefingToggle: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: Tokens.radius.card,
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.line,
  },
  aiBriefingToggleLeft: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  aiBriefingToggleText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: t.text,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'flex-end',
  },
  modalOverlayCenter: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'center',
    padding: 24,
  },
  createModalCard: {
    backgroundColor: t.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    maxHeight: '85%',
  },
  createModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  createModalTitle: {
    fontSize: Type.title2.fontSize,
    fontWeight: '700' as const,
    color: t.text,
    letterSpacing: -0.3,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: Tokens.radius.panel,
    backgroundColor: t.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createModalScroll: {
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: t.textSecondary,
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    minHeight: 48,
    borderRadius: Tokens.radius.lg,
    backgroundColor: t.surfaceAlt,
    paddingHorizontal: 14,
    fontSize: Type.callout.fontSize,
    color: t.text,
  },
  descInput: {
    minHeight: 90,
    paddingTop: 14,
    textAlignVertical: 'top' as const,
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  typeChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: Tokens.radius.card,
    backgroundColor: t.surfaceAlt,
  },
  typeChipActive: {
    backgroundColor: t.accent,
  },
  typeChipLabel: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: t.textSecondary,
  },
  typeChipLabelActive: {
    color: '#FFFFFF',
  },
  createBtn: {
    backgroundColor: t.accent,
    borderRadius: Tokens.radius.lg,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: t.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 3,
  },
  createBtnText: {
    fontSize: Type.callout.fontSize,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  nextStepCard: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius["2xl"],
    padding: 24,
    gap: 16,
    // Match the other home-screen cards.
    borderWidth: 1,
    borderColor: t.line,
  },
  nextStepSuccessIcon: {
    alignSelf: 'center' as const,
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: t.success + '15',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  nextStepTitle: {
    fontSize: Type.title2.fontSize,
    fontWeight: '700' as const,
    color: t.text,
    textAlign: 'center',
  },
  nextStepDesc: {
    fontSize: Type.subhead.fontSize,
    color: t.textSecondary,
    textAlign: 'center',
    marginBottom: 4,
  },
  nextStepOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.surfaceAlt,
    borderRadius: Tokens.radius.panel,
    padding: 16,
    gap: 14,
  },
  nextStepIconWrap: {
    width: 44,
    height: 44,
    borderRadius: Tokens.radius.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextStepTextWrap: {
    flex: 1,
    gap: 2,
  },
  nextStepOptionTitle: {
    fontSize: Type.callout.fontSize,
    fontWeight: '600' as const,
    color: t.text,
  },
  nextStepOptionDesc: {
    fontSize: Type.footnote.fontSize,
    color: t.textSecondary,
  },
  laterBtn: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  laterBtnText: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '500' as const,
    color: t.textMuted,
  },

  // ── Status filter chips ────────────────────────────────────────
  filterChipsWrap: {
    paddingHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
  },
  filterChipsScroll: {
    gap: 8,
    paddingVertical: 4,
  },
  filterChip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: t.surfaceAlt,
    borderWidth: 1,
    borderColor: t.line,
  },
  filterChipActive: {
    backgroundColor: t.accent,
    borderColor: t.accent,
  },
  filterChipLabel: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '700' as const,
    color: t.text,
  },
  filterChipLabelActive: {
    color: '#FFF',
  },
  filterChipCount: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: t.textMuted,
    minWidth: 14,
    textAlign: 'right' as const,
  },
  filterChipCountActive: {
    color: 'rgba(255,255,255,0.7)',
  },

  // ── Today on site ──────────────────────────────────────────────
  todaySection: {
    paddingHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
  },
  todayCard: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.card,
    borderWidth: 1,
    borderColor: t.line,
    overflow: 'hidden' as const,
  },
  todayRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  todayRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: t.line,
  },
  todayDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: t.success,
  },
  todayProjectName: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: t.text,
  },
  todayTasks: {
    fontSize: Type.caption1.fontSize,
    color: t.textMuted,
    marginTop: 2,
  },
});
