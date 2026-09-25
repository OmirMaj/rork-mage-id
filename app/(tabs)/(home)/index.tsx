import React, { useCallback, useState, useMemo, useEffect, useRef, useReducer } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Platform, Modal, TextInput, Pressable, ScrollView, KeyboardAvoidingView,
} from 'react-native';
import ConstructionLoader from '@/components/ConstructionLoader';
import { SkeletonCard } from '@/components/Skeleton';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Plus, FolderOpen, X, ChevronRight, Calculator, CalendarDays,
  Search, ChevronDown, ChevronUp, HardHat, Bell, CheckCircle2,
  Wallet, CloudOff, MapPin,
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
import ErrorState from '@/components/ErrorState';
import { IconWrapper } from '@/components/ui/IconWrapper';
import { useAuth } from '@/contexts/AuthContext';
import { OnboardingChecklist } from '@/components/OnboardingChecklist';
import { NextStepHero } from '@/components/NextStepHero';
import { useOnboardingMilestones } from '@/utils/onboardingProgress';
import { capProjectCount, countsTowardFreeCap, isSampleProjectName } from '@/utils/projectCap';
import MageRefreshControl from '@/components/MageRefreshControl';
import { useQuery } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchStripeConnectStatus } from '@/utils/stripeConnect';
import { effectiveEstimateTotal } from '@/utils/estimateCommit';
import { parseCalendarDay } from '@/utils/calendarDate';
import {
  cloneProjectAsTemplate, voiceUnappliedNote, buildBurnByProject,
  homeStatusFilterReducer, HOME_STATUS_FILTER_INITIAL, type HomeStatusFilter,
} from '@/utils/projectClone';
import { resolveWarrantyMonths } from '@/utils/paymentTerms';
import { scheduleDayOnCalendar, isTaskActiveOnScheduleDay } from '@/utils/scheduleOps';

// Sticky-dismiss key for the proactive Stripe Connect home banner.
// Versioned so we can re-show after a future revamp if needed.
const STRIPE_BANNER_DISMISSED_KEY = 'mageid_home_stripe_banner_dismissed_v1';
import { DemoSeedPickerModal } from '@/components/DemoSeedPickerModal';
import type { DemoFlavor } from '@/utils/demoSeed';
import { CreateMenu } from '@/components/CreateMenu';
import OfflineSyncPill from '@/components/OfflineSyncPill';
import QuickFieldUpdate from '@/components/QuickFieldUpdate';
import { PROJECT_TYPES, type Project, type ProjectType, type EntityRef } from '@/types';
import { cleanProjectTypeOther, projectTypeBlockReason, PROJECT_TYPE_OTHER_MAX } from '@/utils/projectTypes';
import { projectTypeFromParsedType } from '@/utils/scopeQuestions';
import WarrantyWalkBanner from '@/components/WarrantyWalkBanner';
import { getUpcomingWarrantyWalks, describeWalkTiming, warrantyWalkTitle } from '@/utils/warrantyWalks';
import { Type } from '@/constants/typography';
import { Layout, Tokens } from '@/constants/designTokens';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import PageHeader from '@/components/PageHeader';
import ProjectRow from '@/components/ProjectRow';
import { useTheme } from '@/contexts/ThemeContext';
import ClientHome from '@/components/ClientHome';
import PropertyManagerHome from '@/components/PropertyManagerHome';
import BrainWatchCard from '@/components/home/BrainWatchCard';
import PendingInvitesCard from '@/components/collaborators/PendingInvitesCard';
import ReadyToBillCard from '@/components/home/ReadyToBillCard';
import RecoveredCard from '@/components/home/RecoveredCard';
import MorningBriefCard from '@/components/home/MorningBriefCard';
import WeekCloseCard from '@/components/home/WeekCloseCard';
import DailyLogCard from '@/components/home/DailyLogCard';
import { showAlert } from '@/utils/alert';
// Wave 6c, lane F — the desktop portfolio. Everything below renders only on the
// desktop branch or appends a style that is null on a phone.
import { useShellDock } from '@/components/desktop/ShellDock';
import { NoticeStrip, type Notice } from '@/components/desktop/NoticeStrip';
import { FormGrid, FormField } from '@/components/desktop/FormGrid';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { TileGrid } from '@/components/ui/TileGrid';
import { Button } from '@/components/ui/Button';
import { useSheetFrame, useSheetPrimaryHotkey } from '@/components/ui/Sheet';
import { useIsDesktopWeb, desktopToggle } from '@/components/ui/desktop';
import { PortfolioTable } from '@/components/portfolio/PortfolioTable';
import { PortfolioHomeLayout } from '@/components/portfolio/PortfolioHomeLayout';
import { buildPortfolioRows } from '@/utils/portfolio/portfolioRow';
import { actionRailVisible } from '@/utils/sidebarRail';
import { stageLabel } from '@/utils/projectStage';

// Status filter buckets. ONE label map for the dense table's section header,
// the chips and the empty-bucket state, so "No closeout jobs" names the same
// bucket the chip the GC just tapped does.
//
// Wave 6c (C2, honesty copy): the words are utils/projectStage's — the job
// page's four lifecycle names. Home used to call a finished-but-not-closed job
// "Closeout" and a closed one "Closed", while the job page called the same
// two "Post-Con" and "Closeout", so the chip he tapped and the job he opened
// disagreed. The KEYS (and so the reducer, the auto-pick and any saved pick)
// are unchanged; only the words moved.
type StatusFilter = HomeStatusFilter;
const STATUS_FILTER_LABEL: Record<StatusFilter, string> = {
  all: 'All projects',
  active: stageLabel('construction'),
  precon: stageLabel('precon'),
  closeout: stageLabel('postcon'),
  closed: stageLabel('closeout'),
};

// The desktop stage chips (wave 6c): lifecycle order, in utils/projectStage's
// words, over the reducer's keys (closeout = the 'completed' bucket, which
// projectStage calls Post-Con; closed = Closeout).
const DESKTOP_STAGE_CHIPS: { key: StatusFilter; label: string }[] = [
  { key: 'precon', label: stageLabel('precon') },
  { key: 'active', label: stageLabel('construction') },
  { key: 'closeout', label: stageLabel('postcon') },
  { key: 'closed', label: stageLabel('closeout') },
  { key: 'all', label: 'All' },
];

// "Today on site" shows this many jobs, then a "+N more on site today" row.
const TODAY_ON_SITE_ROWS = 4;
// …and this many task titles per job, then " · +N more".
const TODAY_ON_SITE_TASKS = 3;

// Route-level recovery (audit 2026-09-07, "Worth doing" #8). Home renders a
// dozen independent cards — Brain Watch, Ready to Bill, Morning Brief, Week
// Close — and a render bug in any one of them used to unwind to the root
// boundary and restart the whole bundle. Contained here, the tab bar survives
// and "Go Back" is a real way out.
export { RouteErrorFallback as ErrorBoundary } from '@/components/ErrorBoundary';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { openCreate } = useLocalSearchParams<{ openCreate?: string }>();
  const openCreateConsumed = useRef(false);

  // The old home-only FAB stack was retired — the one global MAGE Brain FAB
  // (app/_layout → components/brain/BrainSurface) now carries AI, voice, and
  // help on every screen. Its scroll-hide came back as a shared behaviour: the
  // FAB was sitting on the checklist's "Try it free" chip and the inbox rows
  // (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const notifFeed = useNotificationFeed();
  const responsive = useResponsiveLayout();
  // Browser-only behaviour (Enter-to-create in the New Project fields) is
  // gated on desktop WEB: isDesktop is also true on a >= 1024 native window.
  const desktopWeb = useIsDesktopWeb();
  // Use the dense ProjectRow at tablet+ widths. On phone we keep the
  // ProjectCard pattern — stacked metas read better on narrow screens.
  const useDenseRows = !responsive.isPhone;
  const { navigateTo } = useEntityNavigation();
  const { openSearch } = useSearch();
  const projectCtx = useProjects();
  const {
    projects, isLoading, addProject, getTotalOutstandingBalance, invoices, settings, userRole,
    changeOrders, changeOrdersLoaded, invoicesLoaded,
    // RT-R1: an empty `projects` is EITHER a brand-new account OR every read
    // 401'd and this device has a cold cache. The list's empty state answers
    // that question, so it has to know which (audit 2026-09-07).
    sourceFailed, retryRemoteReads,
  } = projectCtx;
  // ONE rule for "is the action rail up" — lane S's actionRailVisible, the
  // same call the tabs layout makes to mount it (Home index, window >= 1280,
  // not a client or property manager, the shell dock empty). While it is up
  // the rail IS the attention list, so this screen leaves the inline Smart
  // Inbox (and, on desktop, Brain Watch, Ready to Bill, the daily-log card and
  // the warranty banner) out instead of drawing the same list twice.
  const dock = useShellDock();
  const railShowing = actionRailVisible({
    isDesktop: responsive.isDesktop,
    width: responsive.width,
    segments: ['(tabs)', '(home)'],
    userRole,
    dockOpen: dock.content != null,
  });
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
  const showDemoSeed = true;

  // Free tier is capped at 1 real project (Sample — … demo projects don't
  // count). A free user at the cap gets the upgrade Paywall instead of the
  // create modal. Paid tiers are unlimited (maxProjects: Infinity).
  //
  // The count is the SERVER's rule (utils/projectCap, audit wave 5 #58/#127):
  // non-sample projects he OWNS. It used to count every project in the list,
  // so a free foreman invited to one GC job was paywalled from his own first
  // job — which the trigger would have accepted. An owned awarded-RFP job
  // counts, as it does on the server.
  const { canCreateProject } = useTierAccess();
  const [projectCapPaywall, setProjectCapPaywall] = useState(false);
  const userId = user?.id;
  const realProjectCount = useMemo(
    () => capProjectCount(projects, userId),
    [projects, userId],
  );
  // The onboarding checklist's "real work" (#155): estimates and invoices on
  // demo projects are the seed's, not his. Seeding a sample used to tick
  // "Send your first invoice" and "Try it" before he had done either. The set
  // is the SAME one projectCount counts (owned, not a sample): work on a job
  // another contractor shared with him is the GC's, and counting it would tick
  // "Try it" off the GC's estimate and show "Send your first invoice" held
  // ('after your first project') beside an invoice he can see.
  const ownedRealProjects = useMemo(
    () => projects.filter(p => countsTowardFreeCap(p, userId)),
    [projects, userId],
  );
  const realInvoiceCount = useMemo(() => {
    const realIds = new Set(ownedRealProjects.map(p => p.id));
    return invoices.filter(i => realIds.has(i.projectId)).length;
  }, [invoices, ownedRealProjects]);
  const handleCreatePress = useCallback(() => {
    if (!canCreateProject(realProjectCount)) {
      setProjectCapPaywall(true);
      return;
    }
    setShowCreateModal(true);
  }, [canCreateProject, realProjectCount]);

  // Tutorials live at /tutorials (the Brain surface's Help sheet, Settings →
  // Tutorials, and the desktop sidebar) — not on home. NextStepHero is the
  // real first-run spine.

  // Onboarding milestones — drives the 5-step "Get up and running" panel.
  // Re-reads when the project / invoice count changes so the user sees
  // their checks land in real-time after creating a project, sending an
  // invoice, etc. Voice + takeoff milestones come from AsyncStorage flags.
  const milestones = useOnboardingMilestones(`${projects.length}-${invoices.length}`);
  const estimateCount = useMemo(
    () => ownedRealProjects.filter(p =>
      (p.linkedEstimate?.items?.length ?? 0) > 0
      || (p.estimate?.materials?.length ?? 0) > 0
      || effectiveEstimateTotal(p) > 0,
    ).length,
    [ownedRealProjects],
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
  //
  // A FAILED CHECK IS NOT AN ANSWER (audit wave 5, #153). This used to map
  // `!r.success` to 'none' and cache it for ten minutes, so a GC who IS
  // connected, opening the app on site with one bar, was told "Get paid in one
  // tap — Connect Stripe" and saw the checklist un-tick the step. Now a failure
  // throws: react-query retries, keeps the last real answer if it had one, and
  // `data` stays undefined on a cold start — the banner (=== 'none') stays
  // hidden and the checklist row reads "Checking…" until the server says.
  // utils/stripeConnect keeps its no-throw contract for its other callers.
  const stripeStatusQ = useQuery({
    queryKey: ['stripeConnectStatus', user?.id],
    enabled: !!user?.id,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      if (!user?.id) throw new Error('connect-status: not signed in');
      const r = await fetchStripeConnectStatus(user.id);
      if (!r.success) throw new Error(r.error ?? 'connect-status failed');
      return { status: r.status ?? ('none' as const) };
    },
  });
  // undefined = not known yet (loading, or every read so far has failed).
  const stripeConnected: boolean | undefined = stripeStatusQ.data
    ? stripeStatusQ.data.status === 'connected'
    : undefined;
  // Every retry has failed and nothing is fetching now: "Checking…" would claim
  // work that has stopped. Still never "not connected", never un-ticked.
  const stripeCheckFailed = stripeStatusQ.data === undefined && stripeStatusQ.isError && !stripeStatusQ.isFetching;
  const refetchStripe = stripeStatusQ.refetch;

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

  // Pull-to-refresh. Re-reads every list a card on this screen is drawn from:
  // projects, invoices (Ready to Bill, burn), daily reports (Daily Log),
  // change orders (Recovered, Ready to Bill), RFIs / submittals / punch items
  // (Smart Inbox, Brain Watch) and permits (Brain Watch).
  //
  // Audit wave 5, #150: this used to invalidate ['daily-reports'], a key no
  // query has, so after the foreman filed today's report a pull still left the
  // Daily Log card asking for today — and COs, RFIs, submittals, punch items
  // and permits were never re-read at all.
  //
  // CONTRACT 24: the context's refreshAll (= its foreground refetch) re-reads
  // projects, money, pro docs (daily reports, RFIs, submittals, punch items,
  // permits) and the portal lists. It bumps the portal read epoch first and
  // skips the projects re-read while a project write is still queued — which
  // raw ['projects'] / ['invoices'] invalidations did not, so a pull a moment
  // after an offline edit could briefly show the server's older row.
  const { refreshAll } = projectCtx;
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refreshAll(),
        // The checklist's "Couldn't check Stripe — pull down to refresh" row
        // (#153) promises that this pull asks Stripe again.
        user?.id ? refetchStripe() : Promise.resolve(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [refreshAll, user?.id, refetchStripe]);
  const { tier } = useSubscription();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [projectType, setProjectType] = useState<ProjectType>('renovation');
  // Q6 · his words when he picks Other ("Whole-house repipe").
  const [projectTypeOther, setProjectTypeOther] = useState('');
  // Jobsite address and size. Both used to be hardcoded at write time
  // (`location: 'United States'`, `squareFootage: 0`) because this modal had
  // no field for either — see handleCreateProject for what that placeholder
  // cost every document the job would ever produce. Blank is the honest
  // starting value: we never pre-fill an address nobody told us.
  const [projectLocation, setProjectLocation] = useState('');
  const [projectSqft, setProjectSqft] = useState('');
  // The contractor's default market from Settings ("Houston, TX"). Offered as
  // a ONE-TAP fill, never as a pre-filled value: it is where they usually
  // work, not necessarily where this job is, and silently stamping it on a
  // project would be the same lie as 'United States' with a better ZIP —
  // only harder to spot, because it looks like a real address. 'United
  // States' is the settings field's own placeholder, so it is never offered.
  const usualArea = useMemo(() => {
    const l = settings?.location?.trim() ?? '';
    return l && l !== 'United States' ? l : null;
  }, [settings?.location]);
  const [_createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  // The job just created, highlighted in the desktop table (wave 6c, D6).
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);
  const [showNextStepModal, setShowNextStepModal] = useState(false);
  const [actionSheetRef, setActionSheetRef] = useState<EntityRef | null>(null);

  // The Outstanding total used to anchor a stat tile up top — we kept the
  // computation reachable to other places that may inspect state via the
  // hook, but stripped the visual tile (it duplicated Summary tab).
  void getTotalOutstandingBalance;

  // Surface upcoming warranty walks. Hidden when none — keeps the home tab
  // quiet during normal operation. Drives an inline banner below the nav bar.
  // The walk is timed off the GC's OWN warranty length from Settings (audit
  // wave 5, #142 — it used to be hard-wired to 12 months, so a 24-month
  // warranty was prompted at month 11 and never before its real expiry).
  // resolveWarrantyMonths returns null when none is saved; the engine then
  // assumes 12 and flags the alert as assumed.
  const warrantyMonths = resolveWarrantyMonths(settings);
  const warrantyWalkAlerts = useMemo(
    () => getUpcomingWarrantyWalks(projects, warrantyMonths),
    [projects, warrantyMonths],
  );

  const [showWeeklySummary, setShowWeeklySummary] = useState(false);
  const [showAIBriefing, setShowAIBriefing] = useState(false);

  // ── Status filter chips ────────────────────────────────────────
  // Replace the old money-themed stat tiles (Total Value / Outstanding /
  // Bulk Savings) with project-state filter chips: "All / Active /
  // Pre-construction / Closeout / Closed". Active is selected by default
  // when the user has any active projects so the list isn't cluttered
  // with closed jobs from years ago. Tapping a chip filters the list
  // below. (StatusFilter and its labels are module-level — STATUS_FILTER_LABEL.)
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

  // Status filter (audit wave 5, #154). On first load with ≥5 projects (the
  // chips are shown — below that there'd be no chip to switch back) and at
  // least one active, the app picks Active; his last choice sticks after that.
  // The app owns what happens to a bucket IT picked: when the last active job
  // closes, go back to All rather than leave him on an empty default view he
  // never chose. A bucket HE tapped stays put — the empty-bucket state below
  // says what it is and offers "Show all jobs".
  //
  // One reducer, not two effects and a ref: the ref version lost the "app
  // picked it" flag in the same commit it was set (the reset effect's closure
  // still read the old 'all'), so the reset never ran. See
  // utils/projectClone homeStatusFilterReducer.
  const [statusFilterState, dispatchStatusFilter] = useReducer(homeStatusFilterReducer, HOME_STATUS_FILTER_INITIAL);
  const statusFilter = statusFilterState.filter;
  useEffect(() => {
    dispatchStatusFilter({ type: 'data', projectCount: projects.length, activeCount: statusBuckets.active.length });
  }, [projects.length, statusBuckets.active.length]);
  const pickStatusFilter = useCallback((next: StatusFilter) => {
    dispatchStatusFilter({ type: 'pick', filter: next });
  }, []);

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

  // Billed-to-date per job for the Burn column / bar (audit wave 5, #151).
  // ProjectRow and ProjectCard used to read `project.invoicedTotal` — a field
  // Project does not have and nothing ever wrote — so every job on the web
  // table said "Burn 0%" however much had been invoiced. The money is the
  // shared definitions in utils/projectFinancials: invoiced = non-draft
  // invoice totals (getInvoicedToDate), against the REVISED contract =
  // estimate + approved change orders (getContractValue, the same basis
  // client-view uses), so a job with approved add-ons doesn't read as over
  // 100%.
  //
  // `undefined` until both lists have actually been read: before that the
  // rows print '—', never a 0% computed from an empty list with no source.
  // `invoicesLoaded` is the context's per-account stamp, set in the same
  // update that copies the read into `invoices` — so it can never be true
  // while `invoices` still holds nothing (or the last account's rows).
  const invoicesRead = invoicesLoaded;
  // Jobs someone else owns, field roles and unread lists get no entry — see
  // buildBurnByProject for why each would be a sourceless 0%.
  const burnByProject = useMemo(() => buildBurnByProject({
    projects, invoices, changeOrders, userId, invoicesRead, changeOrdersLoaded,
  }), [invoicesRead, changeOrdersLoaded, invoices, changeOrders, projects, userId]);

  // The desktop portfolio table's rows (wave 6c) — computed only on desktop;
  // the phone and tablet lists never read them.
  const { rfis, punchItems, dailyReports } = projectCtx;
  const portfolioRows = useMemo(() => (responsive.isDesktop ? buildPortfolioRows({
    projects: filteredProjects, invoices, changeOrders, rfis, punchItems, dailyReports, burnByProject, now: new Date(),
  }) : []), [responsive.isDesktop, filteredProjects, invoices, changeOrders, rfis, punchItems, dailyReports, burnByProject]);

  // ── Today on site ──────────────────────────────────────────────
  // Active projects whose schedule has at least one task running today.
  // Membership MUST match the Summary tab's "Today on site" exactly — both
  // surfaces use the canonical 1-indexed, working-day-aware model that the
  // schedule engine uses (utils/scheduleEngine getTaskDateRange:
  //   start = addWorkingDays(startDate, startDay - 1); end = +durationDays-1).
  // So `todayDayNumber` is a 1-INDEXED working-day count from the schedule
  // start (day 1 = start date; weekends skipped when workingDaysPerWeek < 7),
  // and a task is live when startDay <= todayDayNumber <= startDay+dur-1
  // (isTaskActiveOnScheduleDay, the same predicate the briefing applies).
  //
  // Uses schedule.startDate as day 1, and still falls back to
  // project.createdAt when there is none — the last un-migrated anchor
  // invention on this screen, tracked as KNOWN_UNMIGRATED in
  // scripts/validate-schedule-date-basis.ts. Fixing it means giving this strip
  // the undated disclosure the Schedule tab has ("no start date — set one"),
  // not deleting the row silently.
  const todayOnSite = useMemo(() => {
    const out: { project: Project; activeTaskTitles: string[]; activeTaskCount: number }[] = [];
    const now = new Date();
    for (const p of projects) {
      if (p.status !== 'in_progress') continue;
      const sched = p.schedule;
      if (!sched || !sched.tasks || sched.tasks.length === 0) continue;
      const baseIso = sched.startDate || p.createdAt;
      // UX-F1: schedule.startDate is a bare 'YYYY-MM-DD'. Date.parse reads
      // that as UTC midnight — the PREVIOUS evening anywhere west of
      // Greenwich — so this ran one working day ahead of the schedule tab,
      // which anchors via parseCalendarDay. createdAt is a full instant and
      // still goes through new Date().
      const base = parseCalendarDay(baseIso) ?? new Date(baseIso);
      if (!Number.isFinite(base.getTime())) continue;
      // MEMBERSHIP, so scheduleDayOnCalendar — NOT scheduleDayNumberFor. This
      // strip asks "is this task on site TODAY", and scheduleDayNumberFor
      // answers a different question ("what working day is the job on") with
      // two clamps that invent work when read as membership: every date at or
      // before the anchor is day 1, and a closed day folds back onto the
      // working day before it. On this screen that meant a job starting
      // 2026-10-01 listed its day-1 tasks on 2026-09-06, and on a Saturday the
      // strip re-listed Friday's crew as if they were out there. Same defect
      // the morning briefing had (utils/summaryBriefing.ts scheduleDayFor);
      // this is the same fix, and the two now agree day for day.
      //
      // null = today is not a day of this schedule at all. The whole section
      // is gated on `todayOnSite.length > 0`, so contributing nothing IS the
      // honest empty state — an absent fact beats an invented one.
      const todayDayNumber = scheduleDayOnCalendar(base, now, sched.workingDaysPerWeek, sched.nonWorkingDates);
      if (todayDayNumber === null) continue;
      // Shared with the briefing (and the week strip), so a task this screen
      // lists is exactly a task Summary counts.
      const liveTasks = sched.tasks.filter(t => isTaskActiveOnScheduleDay(t, todayDayNumber));
      if (liveTasks.length > 0) {
        out.push({
          project: p,
          activeTaskTitles: liveTasks.slice(0, TODAY_ON_SITE_TASKS).map(t => t.title),
          activeTaskCount: liveTasks.length,
        });
      }
    }
    // THE WHOLE LIST, not the first four (audit wave 5, #158). This returned
    // `out.slice(0, 4)` in project-list order, so on a busy day the 5th and
    // 6th crews simply weren't on the strip and nothing said so. The render
    // shows TODAY_ON_SITE_ROWS rows and then "+N more on site today"; sorting
    // first makes the cut deliberate: most tasks running today first, then the
    // most recently updated job, then the name (so ties are stable).
    out.sort((a, b) =>
      (b.activeTaskCount - a.activeTaskCount)
      || ((Date.parse(b.project.updatedAt) || 0) - (Date.parse(a.project.updatedAt) || 0))
      || a.project.name.localeCompare(b.project.name));
    return out;
  }, [projects]);
  const todayOnSiteShown = todayOnSite.slice(0, TODAY_ON_SITE_ROWS);
  const todayOnSiteHidden = todayOnSite.length - todayOnSiteShown.length;

  const handleProjectPress = useCallback((project: Project) => {
    console.log('[Home] Opening project:', project.id);
    navigateTo({ kind: 'project', id: project.id });
  }, [navigateTo]);

  const handleCreateProject = useCallback(() => {
    const name = projectName.trim();
    if (!name) {
      showAlert('Missing Name', 'Please enter a project name.');
      return;
    }
    // Q6: Other needs his words — "Other" alone tells nobody what the job is.
    const typeBlock = projectTypeBlockReason(projectType, projectTypeOther);
    if (typeBlock) {
      showAlert('Describe the job', typeBlock);
      return;
    }
    const now = new Date().toISOString();
    // MUST be a real UUID — projects.id is uuid in Supabase. Pre-fix this
    // used `project-{timestamp}-{rand}`, which Postgres rejected on upsert.
    // The error was caught silently in supabaseWrite, so the row only
    // existed in local AsyncStorage; on the next refetch the project
    // disappeared because the server didn't have it.
    const id = generateUUID();
    // The jobsite address, and blank STAYS blank — it is never backfilled with
    // a placeholder. This modal used to write `location: 'United States'`
    // verbatim, and because Project.location is the one string 30+ surfaces
    // read, that single literal became: "Location: United States" on every
    // proposal, invoice and closeout binder (utils/pdfGenerator.ts), the
    // ship-to on purchase orders sent to real suppliers
    // (utils/purchaseOrderPdf.ts), and the jurisdiction the permit roadmap
    // searched (utils/permitRoadmap.ts), which returned permits for nowhere.
    // Worst of all it geocoded SUCCESSFULLY: shouldGeocode accepts any string
    // over three characters, so "United States" resolved to the country
    // centroid and the job then reported real, unlabelled weather for rural
    // Kansas. An empty string is under that threshold, so no address now means
    // no coordinates, and the schedule correctly falls through to the marked
    // simulated-weather path instead of quietly inventing a site.
    const location = projectLocation.trim();
    // Digits only — contractors type "2,400" and "2400 sq ft".
    const sqftDigits = projectSqft.replace(/[^0-9]/g, '');
    const squareFootage = sqftDigits ? Number.parseInt(sqftDigits, 10) : 0;
    const newProject: Project = {
      id,
      name,
      type: projectType,
      ...(projectType === 'other' ? { projectTypeOther: cleanProjectTypeOther(projectTypeOther) } : {}),
      location,
      squareFootage: Number.isFinite(squareFootage) ? squareFootage : 0,
      // `quality` is a genuine default, not a stand-in for an answer we
      // skipped: 'standard' is also the estimate wizard's own default, it is
      // never printed as a stated fact, and the wizard asks for it properly.
      // Unlike location and squareFootage above, nothing downstream mistakes
      // it for something the contractor told us.
      quality: 'standard',
      description: projectDescription.trim(),
      createdAt: now,
      updatedAt: now,
      estimate: null,
      schedule: null,
      status: 'draft',
    };
    addProject(newProject);
    // A new job is a draft (Pre-Con). Created while a stage chip that does not
    // hold drafts is picked, it used to vanish the moment it was saved — so the
    // filter moves to where the job actually is, and the table highlights it.
    if (statusFilter !== 'all' && statusFilter !== 'precon') pickStatusFilter('precon');
    setJustCreatedId(id);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setShowCreateModal(false);
    setCreatedProjectId(id);
    setShowNextStepModal(true);
    setProjectName('');
    setProjectDescription('');
    setProjectType('renovation');
    setProjectTypeOther('');
    setProjectLocation('');
    setProjectSqft('');
  }, [projectName, projectDescription, projectType, projectTypeOther, projectLocation, projectSqft, addProject, statusFilter, pickStatusFilter]);

  // The highlight clears 6 s after the next-step dialog closes, or as soon as
  // he leaves Home (opening a row, or the wizard the dialog sent him to).
  useEffect(() => {
    if (!justCreatedId || showNextStepModal) return undefined;
    const timer = setTimeout(() => setJustCreatedId(null), 6000);
    return () => clearTimeout(timer);
  }, [justCreatedId, showNextStepModal]);
  useFocusEffect(useCallback(() => () => setJustCreatedId(null), []));

  // D8 — the two hand-rolled dialogs adopt the 6b sheet frame. On a phone
  // every frame part is null and animationType is the original literal, so the
  // sheets render exactly as before; on desktop they centre in the content
  // column (the create form at the 720 'wide' size, the next step at 440).
  const createFrame = useSheetFrame('wide', { visible: showCreateModal, animationType: 'slide' });
  useSheetPrimaryHotkey(showCreateModal, handleCreateProject);
  const nextStepFrame = useSheetFrame('dialog', { visible: showNextStepModal, animationType: 'fade' });

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
      router.push({ pathname: '/schedule-wizard', params: { projectId: pid, scratch: '1' } } as never);
    }
    setCreatedProjectId(null);
  }, [router, _createdProjectId]);

  const renderProject = useCallback(({ item, index }: { item: Project; index: number }) => (
    <ProjectCard
      project={item}
      index={index}
      // Primitives, not the map entry: ProjectCard is memoized, and a number
      // changing is what makes it re-render when an invoice lands (#151).
      invoicedToDate={burnByProject.get(item.id)?.invoicedToDate}
      revisedContract={burnByProject.get(item.id)?.revisedContract}
      onPress={() => handleProjectPress(item)}
      onLongPress={() => {
        if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        setActionSheetRef({ kind: 'project', id: item.id, label: item.name });
      }}
    />
  ), [handleProjectPress, burnByProject]);

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
            {STATUS_FILTER_LABEL[statusFilter]}
          </Text>
          <Text style={styles.denseListSectionCount}>{filteredProjects.length}</Text>
        </View>
        <View style={styles.denseListContainer}>
          {filteredProjects.map((p, idx) => (
            <ProjectRow
              key={p.id}
              project={p}
              invoicedToDate={burnByProject.get(p.id)?.invoicedToDate}
              revisedContract={burnByProject.get(p.id)?.revisedContract}
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
  }, [useDenseRows, filteredProjects, statusFilter, handleProjectPress, burnByProject]);

  // Secondary widgets that used to live above the project list. Moved
  // BELOW the project list so the user's first scroll-target is the
  // project itself — the most common thing they came here to do.
  // QuickFieldUpdate / AI summary toggle stay one short scroll away.
  // Ask MAGE, the Copilot entry and the AI summary toggle — each ONE element,
  // used by the phone footer below and by the desktop footer (wave 6c: Ask
  // MAGE and the Copilot two-up in a TileGrid, the toggle hugging its label
  // instead of spanning 1,368 px), so the JSX and its strings exist once. The
  // desktop styles are appended behind `responsive.isDesktop &&` and are
  // dropped on a phone.
  const aiEntries = useMemo(() => ({
    // Ask MAGE — whole-business conversational agent. Entry point lives in
    // the home AI section; opens the /ask chat.
    askMage: (
      <TouchableOpacity
        onPress={() => router.push('/ask' as never)}
        activeOpacity={0.85}
        testID="home-ask-mage"
        style={[{
          flexDirection: 'row', alignItems: 'center', gap: 10,
          backgroundColor: themeColors.accentSoft, borderRadius: Tokens.radius.lg,
          paddingHorizontal: 16, paddingVertical: 14, marginBottom: 8,
          borderWidth: 1, borderColor: themeColors.accent,
        }, responsive.isDesktop && styles.launcherDesktop]}
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
    ),
    // Copilot Hub — voice-driven workflow builder. Cross-link from home so
    // the flagship conversational surface is one tap away without requiring
    // the user to navigate to a specific project first.
    copilot: (
      <TouchableOpacity
        onPress={() => router.push('/copilot-hub' as never)}
        activeOpacity={0.85}
        testID="home-copilot-hub"
        style={[{
          flexDirection: 'row', alignItems: 'center', gap: 10,
          backgroundColor: themeColors.surface, borderRadius: Tokens.radius.lg,
          paddingHorizontal: 16, paddingVertical: 14, marginBottom: 12,
          borderWidth: 1, borderColor: themeColors.line,
        }, responsive.isDesktop && styles.launcherDesktop]}
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
    ),
    briefing: (
      <View style={[styles.aiBriefingWrap, responsive.isDesktop && styles.aiBriefingWrapDesktop]}>
        <TouchableOpacity
          style={[styles.aiBriefingToggle, responsive.isDesktop && desktopToggle]}
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
    ),
  }), [projects, invoices, tier, showAIBriefing, themeColors, router, responsive.isDesktop, styles]);

  const projectsFooterExtras = useMemo(() => {
    if (projects.length === 0) return null;
    return (
      <View style={styles.footerExtras}>
        {aiEntries.askMage}

        {aiEntries.copilot}
        {aiEntries.briefing}
        <QuickFieldUpdate />
      </View>
    );
  }, [projects.length, aiEntries, styles]);

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

  // ── Today on site ──────────────────────────────────────────────
  // Active projects with at least one task running today per their schedule.
  // The "what's actually happening on the ground RIGHT NOW" line — the
  // contractor's mental model. Renders nothing when nothing's on (weekends,
  // between phases) so the screen stays quiet. ONE element (wave 6c): the
  // phone header renders it where it always sat, and the desktop layout in its
  // left column, so its strings exist once.
  const todayOnSiteBlock = todayOnSite.length > 0 ? (
    <View style={[styles.todaySection, responsive.isDesktop && styles.todaySectionDesktop]}>
      <Text style={styles.sectionHeader}>
        TODAY ON SITE{todayOnSiteHidden > 0 ? ` · ${todayOnSite.length}` : ''}
      </Text>
      <View style={styles.todayCard}>
        {todayOnSiteShown.map((entry, idx) => {
          const moreTasks = entry.activeTaskCount - entry.activeTaskTitles.length;
          return (
            <TouchableOpacity
              key={entry.project.id}
              onPress={() => handleProjectPress(entry.project)}
              activeOpacity={0.7}
              // The last shown row still gets a divider when the
              // "+N more" row follows it.
              style={[styles.todayRow, (idx < todayOnSiteShown.length - 1 || todayOnSiteHidden > 0) && styles.todayRowDivider]}
              testID={`today-on-site-${entry.project.id}`}
            >
              <View style={styles.todayDot} />
              <View style={{ flex: 1 }}>
                <Text style={styles.todayProjectName} numberOfLines={1}>{entry.project.name}</Text>
                <Text style={styles.todayTasks} numberOfLines={1}>
                  {/* Three titles are not all of them when there are five. */}
                  {entry.activeTaskTitles.join(' · ')}{moreTasks > 0 ? ` · +${moreTasks} more` : ''}
                </Text>
              </View>
              <ChevronRight size={14} color={themeColors.textMuted} strokeWidth={1.75} />
            </TouchableOpacity>
          );
        })}
        {todayOnSiteHidden > 0 && (
          // The jobs past the first four are still on site. Summary's
          // Today on site lists every task on every job, uncapped.
          <TouchableOpacity
            onPress={() => router.push('/(tabs)/summary' as never)}
            activeOpacity={0.7}
            style={styles.todayRow}
            accessibilityRole="button"
            accessibilityLabel={`${todayOnSiteHidden} more ${todayOnSiteHidden === 1 ? 'job' : 'jobs'} on site today. Opens Summary.`}
            testID="today-on-site-more"
          >
            <Text style={styles.todayMoreText}>
              +{todayOnSiteHidden} more on site today
            </Text>
            <ChevronRight size={14} color={themeColors.textMuted} strokeWidth={1.75} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  ) : null;

  // 5-step onboarding checklist — auto-hides at 4/5 done OR when explicitly
  // dismissed. ONE element for the phone header and the desktop cards column;
  // it stays a full mounted card at every width (its 'Show me first' entry
  // starts the tutorial — validate-tutorial-entry-points).
  const onboardingChecklistCard = (
    <OnboardingChecklist
      companyInfoDone={companyInfoDone}
      // realProjectCount, not projects.length (polish audit 2026-09-10,
      // first-ten-minutes #15). Seeding "Sample — The Henderson Residence"
      // ticked off "Create your first project" here, while handleCreatePress
      // above deliberately filters samples OUT when it answers the same
      // question for the free-tier cap. One definition of "a project", used
      // by both, or this card credits him with work the rest of the app
      // does not count.
      // Owned, non-sample (utils/projectCap) — a job shared with him
      // is the GC's, so it doesn't tick "Create your first project"
      // either (#58).
      projectCount={realProjectCount}
      estimateCount={estimateCount}
      stripeConnected={stripeConnected}
      stripeCheckFailed={stripeCheckFailed}
      // Invoices on a demo project are the seed's (#155).
      invoiceCount={realInvoiceCount}
      triedWowFeature={milestones.voiceUsed || milestones.takeoffRun || estimateCount > 0}
    />
  );

  // ── The desktop Home (wave 6c, lane F) ─────────────────────────
  // Built only on desktop. The order a GC reads his book in: header, one
  // notice line, the portfolio table (8 jobs above the fold at 1512 × 945),
  // then Today on site beside the self-gated cards, then the AI entries. While
  // the action rail is up it carries Brain Watch, Ready to Bill, the daily-log
  // gaps and the warranty walks, so they are not drawn here a second time.
  const allSamples = projects.length > 0 && projects.every(p => isSampleProjectName(p.name));
  const firstWalk = warrantyWalkAlerts[0];
  const desktopHome = responsive.isDesktop ? (
    <PortfolioHomeLayout
      header={
        <PageHeader
          title="Your Projects"
          statusPill={<OfflineSyncPill />}
          onSearchPress={openSearch}
          actions={
            <>
              <TouchableOpacity
                style={[styles.addButton, { backgroundColor: themeColors.surfaceAlt }]}
                onPress={() => router.push('/notifications-inbox')}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Notifications"
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
              {/* The labelled primary: straight to the New Project form
                  (the cap check included), no menu in between. */}
              <Button label="New project" size="md" onPress={handleCreatePress} testID="home-new-project" />
              {/* Everything else that can be created. */}
              <TouchableOpacity
                style={styles.addButton}
                onPress={() => setShowCreateMenu(true)}
                activeOpacity={0.7}
                testID="new-project-btn"
                accessibilityRole="button"
                accessibilityLabel="Create something else"
              >
                <Plus size={18} color={Colors.textOnAccent} strokeWidth={2.5} />
              </TouchableOpacity>
            </>
          }
        />
      }
      notices={
        <NoticeStrip
          testID="home-notices"
          // Its own gutter: the layout does not wrap it, so a strip with
          // nothing to show leaves no blank band above the table.
          style={responsive.isDesktop && styles.noticesDesktop}
          notices={[
            {
              id: 'stripe',
              visible: showStripeBanner,
              message: 'Get paid in one tap — connect Stripe so clients can pay invoices from their phone. About 3 minutes, then Stripe reviews it.',
              onDismiss: handleDismissStripeBanner,
              action: { label: 'Connect', onPress: () => router.push('/payments-setup') },
              testID: 'stripe-connect-home-notice',
            },
            {
              id: 'samples',
              visible: allSamples,
              message: 'These are sample projects — create your own to start for real.',
              action: { label: 'New project', onPress: handleCreatePress },
              testID: 'samples-notice',
            },
            {
              // While the rail is up its WARRANTY WALKS section carries these.
              id: 'warranty',
              visible: !railShowing && !!firstWalk,
              tone: firstWalk?.severity === 'urgent' ? 'warn' : 'info',
              message: firstWalk
                ? `${firstWalk.warrantyMonthsAssumed ? 'Warranty walk' : warrantyWalkTitle(firstWalk.warrantyMonths)} — ${firstWalk.project.name} · ${describeWalkTiming(firstWalk)}${warrantyWalkAlerts.length > 1 ? ` · +${warrantyWalkAlerts.length - 1} more` : ''}`
                : '',
              action: firstWalk
                ? { label: 'Open', onPress: () => router.push({ pathname: '/warranty-walk', params: { projectId: firstWalk.project.id } }) }
                : undefined,
              testID: 'warranty-walk-notice',
            },
          ] satisfies Notice[]}
        />
      }
      table={projects.length > 0 ? (
        <PortfolioTable
          projects={filteredProjects}
          rows={portfolioRows}
          burnByProject={burnByProject}
          highlightId={justCreatedId}
          onOpenProject={handleProjectPress}
          onOpenActions={(p) => setActionSheetRef({ kind: 'project', id: p.id, label: p.name })}
          stageChips={
            <SegmentedControl<StatusFilter>
              // Lifecycle order, in utils/projectStage's words. The keys are
              // the reducer's, so the auto-pick and "Show all jobs" still work.
              options={DESKTOP_STAGE_CHIPS.map(c => ({
                value: c.key,
                label: c.label,
                count: statusBuckets[c.key].length,
                testID: `stage-chip-${c.key}`,
              }))}
              value={statusFilter}
              onChange={pickStatusFilter}
              variant="pill"
              accessibilityLabel="Filter jobs by stage"
              testID="stage-chips"
            />
          }
          emptyState={
            <EmptyState
              icon={<FolderOpen size={40} color={themeColors.textMuted} strokeWidth={1.6} />}
              title={`No ${STATUS_FILTER_LABEL[statusFilter].toLowerCase()} jobs`}
              message="Nothing in this stage right now."
              actionLabel="Show all jobs"
              onAction={() => pickStatusFilter('all')}
            />
          }
        />
      ) : null}
      belowLeft={todayOnSiteBlock}
      belowRight={
        <>
          <PendingInvitesCard />
          {projects.length > 0 && !isLoading && <MorningBriefCard />}
          {projects.length > 0 && !isLoading && <WeekCloseCard />}
          {onboardingChecklistCard}
          {projects.length > 0 && !allSamples ? (
            <NextStepHero
              projects={projects}
              invoices={invoices}
            />
          ) : null}
          {projects.length > 0 && !isLoading && <RecoveredCard />}
          {!railShowing && projects.length > 0 && !isLoading && <BrainWatchCard />}
          {!railShowing && projects.length > 0 && !isLoading && <ReadyToBillCard />}
          {!railShowing && projects.length > 0 && !isLoading && <DailyLogCard />}
          {!railShowing && projects.length > 0 && <SmartInbox />}
        </>
      }
      footer={projects.length > 0 ? (
        <View style={styles.desktopFooter}>
          <TileGrid preset="nav" testID="home-ai-entries">
            {aiEntries.askMage}
            {aiEntries.copilot}
          </TileGrid>
          {aiEntries.briefing}
        </View>
      ) : null}
    />
  ) : null;

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
        // Desktop: the portfolio layout in the header owns the table and the
        // AI entries, so there is no footer.
        ListFooterComponent={responsive.isDesktop ? null : listFooter}
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
        {...fabScroll}
        contentContainerStyle={[
          styles.listContent,
          // Bottom padding clears the single MAGE Brain FAB (bottom:
          // insets.bottom + 70, 56px) plus a margin so the last rows aren't
          // tucked under it: 70 + 56 + 24 = 150. Now shared, so every screen
          // that clears the FAB uses the one number.
          { paddingTop: insets.top, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE },
          projects.length === 0 && styles.emptyList,
        ]}
        ListHeaderComponent={responsive.isDesktop ? desktopHome : (
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

            {/* Collaboration invites waiting for this user's email — shown
                even with zero projects, because that is exactly the state a
                first-time foreman lands in when the emailed link was lost
                between Safari and the app (audit round 2 #29). Renders
                nothing when none are waiting. */}
            <PendingInvitesCard />

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
            {projects.length > 0 && !isLoading && <ReadyToBillCard />}
            {/* The receipt: money MAGE found that the client already signed off.
                Sits below ReadyToBill deliberately — "what to send" is the
                action, "what you collected" is the proof. Self-hides at zero. */}
            {projects.length > 0 && !isLoading && <RecoveredCard />}

            {/* Daily log completeness. A missing day costs more than a boring
                one — the card asks for today, counts a "nothing happened" day
                as filed, and never offers to backfill a gap (a late report
                carries the date it was typed). Self-hides unless today is
                unfiled or the last 30 days have a hole. */}
            {projects.length > 0 && !isLoading && <DailyLogCard />}

            {/* "Today" feed — surfaces overdue invoices, unanswered
                RFIs, pending CO approvals, late tasks, etc. as the
                FIRST scrollable content under the title. North-star
                pattern (CompanyCam): the user opens the app and the
                very first thing they see is "what needs you right now"
                — before stats, before project list. SmartInbox already
                aggregates from useSmartInbox().

                It does NOT render nothing when there are zero items — this
                comment said so for a long time and components/SmartInbox.tsx:80
                has always rendered "Inbox 0 | All caught up. | Nothing urgent
                across your projects." instead. That sentence is a claim about
                every project made from nine rules, and it is the same false
                all-clear the polish audit found on this card's neighbours; it
                is also the string the DesktopActionRail dropped for exactly
                that reason. The rules it is drawn from now include an expired
                permit (hooks/useSmartInbox.ts permit_expiring, added because
                this card printed "All caught up" four rows under "permit has
                expired — work on it is unpermitted"), but the SENTENCE still
                needs scoping in that component. */}
            {/* Inline SmartInbox is suppressed while the DesktopActionRail is
                up (railShowing — lane S's actionRailVisible): the rail is
                rendering the same items in the right column. */}
            {projects.length > 0 && !railShowing && <SmartInbox />}

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
                  {(['all', 'active', 'precon', 'closeout', 'closed'] as StatusFilter[]).map(key => {
                    const chip = {
                      key,
                      // The chip says "All"; the table header says "All projects".
                      label: key === 'all' ? 'All' : STATUS_FILTER_LABEL[key],
                      count: statusBuckets[key].length,
                    };
                    const isActive = statusFilter === chip.key;
                    return (
                      <TouchableOpacity
                        key={chip.key}
                        onPress={() => {
                          if (Platform.OS !== 'web') void Haptics.selectionAsync();
                          pickStatusFilter(chip.key);
                        }}
                        activeOpacity={0.85}
                        // An empty bucket is dimmed but stays tappable — the
                        // list then says "No closed jobs" instead of the day-one
                        // card (#154).
                        style={[styles.filterChip, isActive && styles.filterChipActive, chip.count === 0 && !isActive && styles.filterChipEmpty]}
                        accessibilityRole="button"
                        accessibilityLabel={`${chip.label}, ${chip.count} ${chip.count === 1 ? 'job' : 'jobs'}`}
                        accessibilityState={{ selected: isActive }}
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
                todayOnSiteBlock (above the return) — one element for the
                phone header and the desktop layout's left column. */}
            {todayOnSiteBlock}

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
                  {/* Three screens quoted three different durations for this one
                      step and none was the true one: this said 2 minutes, the
                      checklist says "About 2 minutes" for a list containing it,
                      and app/payments-setup.tsx says 3 — then tells you Stripe's
                      own review takes "an hour, sometimes a few minutes". This
                      one now matches the screen it sends you to, and names the
                      wait it cannot control (polish audit 2026-09-10,
                      first-ten-minutes #11). The other two strings are in files
                      this change does not own. */}
                  <Text style={styles.stripeBannerSub}>
                    Connect Stripe so clients can pay invoices from their phone. About 3 minutes, then Stripe reviews it.
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
            {onboardingChecklistCard}

            {/* NextStepHero — the answer to "where do I start?" for users
                who've completed onboarding. Picks one action from current
                state (overdue invoices, expiring COIs, stale RFIs, fresh
                projects without scope/estimate/invoice) and renders it
                as a single CTA. Hidden when there's nothing to suggest —
                a calm view is the reward for being caught up. */}
            {projects.length > 0 && projects.every(p => isSampleProjectName(p.name)) ? (
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
        )}
        ListEmptyComponent={
          // FlatList renders this whenever `data` is empty — and at tablet+
          // widths `data` is hard-wired to `[]` above (the rows render as one
          // table in ListFooterComponent), so on the web app this fired for
          // EVERY GC, printing "Your first project is one tap away / Create
          // your first project" directly above the table listing his twenty
          // jobs. Pre-existing, found while routing the failed-read copy
          // through here (review 2026-09-07): an empty state is a claim, and
          // on desktop it was a false one. Say nothing when the table has rows.
          useDenseRows && filteredProjects.length > 0 ? null :
          // Desktop (wave 6c): the portfolio table carries the empty-bucket
          // state itself, so the list below it stays silent while he has jobs.
          responsive.isDesktop && projects.length > 0 ? null :
          // A failed read is not an empty account. This is the day-one
          // onboarding card — "Your first project is one tap away" — and it
          // was what a GC saw after reinstalling, or signing in on a second
          // device, when every read came back 401 (audit 2026-09-07, the
          // sourceFailed site batch 1 could not reach). Same copy contract the
          // Summary tab already uses for this exact fact.
          //
          // ORDER MATTERS: only the FAILED read takes this branch. A genuinely
          // new account has sourceFailed === false and still gets the friendly
          // empty state below, which is the whole point.
          //
          // GATED ON `projects`, NOT ON THE LIST'S OWN EMPTINESS (review fix,
          // 2026-09-07). This ListEmptyComponent fires in two states that are
          // NOT "he has nothing": the status chips filter to `filteredProjects`
          // (pick "Active" with only closed jobs and the list is empty while
          // the book is full), and at tablet+ widths `data` is hard-wired to
          // `[]` because the rows render as a table in ListFooterComponent.
          // Gating the error copy on `sourceFailed` alone therefore told a GC
          // sitting in a basement with twenty cached projects that they
          // "didn't come back" — on desktop, directly above the table listing
          // them. Same discipline report-inbox uses (`rows.length === 0`).
          projects.length === 0 && sourceFailed ? (
            <ErrorState
              icon={<CloudOff size={40} color={themeColors.warningLabel} strokeWidth={1.6} />}
              title="Couldn't reach MAGE"
              body="Your projects didn't come back from the last read. Nothing has been deleted — this device just has nothing cached to show yet."
              steps={[
                'Check that you have signal or Wi-Fi.',
                'Tap Try again below.',
                'If it keeps failing, sign out and back in — the session may have expired.',
              ]}
              onRetry={retryRemoteReads}
              testID="home-unreachable"
            />
          ) : projects.length > 0 ? (
            // He HAS jobs; the chip he tapped just has none in it (audit wave
            // 5, #154). This used to fall through to the day-one card below —
            // "Your first project is one tap away" plus a sample-project offer
            // — for a GC with twelve active jobs who tapped "Closed 0". Name
            // the bucket, say it's empty, and give the one way out. No create
            // or sample CTAs: those are for an account with nothing.
            <EmptyState
              icon={<FolderOpen size={40} color={themeColors.textMuted} strokeWidth={1.6} />}
              title={`No ${STATUS_FILTER_LABEL[statusFilter].toLowerCase()} jobs`}
              message="Nothing in this stage right now."
              actionLabel="Show all jobs"
              onAction={() => pickStatusFilter('all')}
            />
          ) : (
            <EmptyState
              icon={<HardHat size={40} color={themeColors.accent} strokeWidth={1.6} />}
              title="Build something"
              message="Your first project is one tap away. Add it to start tracking estimates, daily reports, invoices — every job, every detail."
              actionLabel="Create your first project"
              onAction={handleCreatePress}
              secondaryLabel={showDemoSeed ? 'Try a sample project (small or large)' : undefined}
              onSecondaryAction={showDemoSeed ? handleSeedDemo : undefined}
            />
          )
        }
        showsVerticalScrollIndicator={false}
      />

      {/* Opaque strip under the clock/Dynamic Island — home's large-title
          header lives INSIDE the scroll surface, so scrolled content was
          colliding with the status bar (sim-audit #7). */}
      <StatusBarMask />

      <Modal visible={showCreateModal} transparent animationType={createFrame.animationType} onRequestClose={() => setShowCreateModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[styles.modalOverlay, createFrame.overlay]}>
            <View style={[styles.createModalCard, { paddingBottom: insets.bottom + 20 }, createFrame.card]}>
              <View style={styles.createModalHeader}>
                <Text style={styles.createModalTitle}>New Project</Text>
                <TouchableOpacity onPress={() => setShowCreateModal(false)} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close">
                  <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} style={styles.createModalScroll} keyboardShouldPersistTaps="handled">
                {/* FormGrid / FormField are fragments on a phone (the tree is
                    today's); on desktop each field caps at its size. */}
                <FormGrid>
                <FormField span="full">
                <InlineVoiceFill
                  title="Dictate this project"
                  buttonLabel="Fill project by voice"
                  // Only fields this form keeps: name, address, type and
                  // description (audit wave 5, #157). The examples used to say
                  // "budget eighty thousand" and "start date June 1st" — both
                  // parsed and then thrown away without a word.
                  suggestions={[
                    'Smith kitchen remodel at 123 Main Street San Diego',
                    'Bathroom renovation for the Patel residence, full gut and new tile',
                    'Two-story addition on the Garcia house at 88 Elm Street',
                    'New construction ADU at 456 Oak Avenue',
                  ]}
                  onTranscript={async (transcript) => {
                    const partial = await parseProjectFromTranscript(transcript);
                    // The parser returns an EMPTY result (type defaulted to
                    // 'renovation') when the AI call fails, rather than
                    // throwing — so "something was heard" is decided from the
                    // fields a person actually says, and a failed parse does
                    // not overwrite the type he already picked.
                    const heardSomething = !!(partial.name || partial.notes || partial.location);
                    if (partial.name) setProjectName(prev => prev || partial.name);
                    if (partial.notes) setProjectDescription(prev => prev || partial.notes);
                    // Q6: the parse may name the job in his words ("HVAC
                    // changeout") — resolved to a real type, with the words
                    // kept for Other. Unresolvable → renovation, as before.
                    const heardType = projectTypeFromParsedType(partial.type) ?? { type: 'renovation' as ProjectType, projectTypeOther: undefined };
                    if (partial.type && heardSomething) setProjectType(heardType.type);
                    if (partial.type && heardSomething) setProjectTypeOther(heardType.projectTypeOther ?? '');
                    // The parser has always returned `location` — it is right
                    // there in the suggestion copy above ("at 123 Main Street
                    // San Diego") — and this handler dropped it on the floor
                    // because there was nowhere to put it. There is now.
                    if (partial.location) setProjectLocation(prev => prev || partial.location);
                    // `partial.targetBudget` is still deliberately NOT applied
                    // here. project.targetBudget is what the client portal
                    // renders as "Contract Value", so turning a number said
                    // out loud into one is a product decision, not a parsing
                    // one — it belongs on the screens that already own that
                    // field (estimate wizard, client-portal-setup). Left
                    // unapplied rather than half-applied behind the GC's back.
                    //
                    // …but never silently (#157): if he SAID a budget or a
                    // start date, tell him it was heard and where it goes.
                    // InlineVoiceFill shows the note as one muted line under
                    // the fill; it lives in this modal, so it is gone when the
                    // modal closes.
                    const note = voiceUnappliedNote(partial.targetBudget, partial.startDate);
                    if (!heardSomething) {
                      return {
                        filled: false,
                        note: note ?? "Couldn't pick out a project name or address from that — type them below.",
                      };
                    }
                    return note ? { filled: true, note } : undefined;
                  }}
                />
                </FormField>

                <FormField span="full" size="md">
                <Text style={styles.fieldLabel}>Project Name</Text>
                <TextInput
                  style={styles.input}
                  value={projectName}
                  onChangeText={setProjectName}
                  placeholder="e.g. Kitchen Renovation"
                  placeholderTextColor={themeColors.textMuted}
                  autoFocus
                  onSubmitEditing={desktopWeb ? handleCreateProject : undefined}
                  testID="project-name-input"
                />
                </FormField>

                <FormField span="full" size="lg">
                <Text style={styles.fieldLabel}>Jobsite Address</Text>
                <TextInput
                  style={styles.input}
                  value={projectLocation}
                  onChangeText={setProjectLocation}
                  placeholder="e.g. 123 Main St, San Diego, CA"
                  placeholderTextColor={themeColors.textMuted}
                  onSubmitEditing={desktopWeb ? handleCreateProject : undefined}
                  testID="project-location-input"
                />
                {usualArea && !projectLocation.trim() ? (
                  <TouchableOpacity
                    style={styles.fieldChip}
                    onPress={() => setProjectLocation(usualArea)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Use my usual area, ${usualArea}`}
                    testID="project-location-usual"
                  >
                    <MapPin size={13} color={themeColors.accent} strokeWidth={1.9} />
                    <Text style={styles.fieldChipLabel}>Use my usual area — {usualArea}</Text>
                  </TouchableOpacity>
                ) : null}
                {!projectLocation.trim() ? (
                  <Text style={styles.fieldHint}>
                    Optional — but this is the address your proposals, invoices and purchase orders
                    print, and what permit lookups and site weather run on. Left blank they stay
                    blank rather than guess; you can add it any time in Project Details.
                  </Text>
                ) : null}
                </FormField>

                <FormField span="full">
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
                </FormField>

                <FormField span="full">
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
                {projectType === 'other' ? (
                  <>
                    <Text style={styles.fieldLabel}>Describe the job</Text>
                    <TextInput
                      style={styles.input}
                      value={projectTypeOther}
                      onChangeText={setProjectTypeOther}
                      placeholder="e.g. Whole-house repipe"
                      placeholderTextColor={themeColors.textMuted}
                      maxLength={PROJECT_TYPE_OTHER_MAX}
                      testID="project-type-other-input"
                    />
                    <Text style={styles.fieldHint}>
                      Shown instead of &quot;Other&quot; on the job list, PDFs and the client portal, and sent to the AI as the project type.
                    </Text>
                  </>
                ) : null}
                </FormField>

                <FormField span="full" size="xs">
                <Text style={styles.fieldLabel}>Square Footage</Text>
                <TextInput
                  style={styles.input}
                  value={projectSqft}
                  onChangeText={setProjectSqft}
                  placeholder="e.g. 2400 — leave blank if you don't know yet"
                  placeholderTextColor={themeColors.textMuted}
                  keyboardType="number-pad"
                  onSubmitEditing={desktopWeb ? handleCreateProject : undefined}
                  testID="project-sqft-input"
                />
                </FormField>
                <FormField span="full">
                <Text style={styles.fieldHint}>
                  Sizes the estimate wizard's per-square-foot benchmarks. Blank is recorded as
                  unknown, so the wizard asks instead of pricing against zero.
                </Text>
                </FormField>
                </FormGrid>
                <View style={{ height: 20 }} />
              </ScrollView>

              <TouchableOpacity style={[styles.createBtn, createFrame.footerButton, responsive.isDesktop && styles.createBtnDesktop]} onPress={handleCreateProject} activeOpacity={0.85} testID="create-project-btn">
                <Text style={styles.createBtnText}>Create Project</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>


      <Modal visible={showNextStepModal} transparent animationType={nextStepFrame.animationType} onRequestClose={() => setShowNextStepModal(false)}>
        <Pressable style={[styles.modalOverlayCenter, nextStepFrame.overlay]} onPress={() => handleNextStep('later')}>
          <Pressable style={[styles.nextStepCard, nextStepFrame.card]} onPress={() => undefined}>
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
        // The one verb the handler below performs. The sheet shows no mutating
        // verb that nobody handles, so naming it here is what makes it appear.
        callerVerbs={actionSheetRef?.kind === 'project' ? ['duplicate'] : []}
        onAction={(id, ref) => {
          if (id !== 'duplicate' || ref.kind !== 'project') return;
          const source = projects.find(p => p.id === ref.id);
          if (!source) return;
          const cloneName = `${source.name} (copy)`;
          // The same cap '+ Project' checks (audit wave 5, #57). Without it a
          // free GC at the cap got a copy the server trigger refuses: he was
          // taken into it, built on it, and it never synced. A copy of a
          // sample keeps the 'Sample — ' prefix, which the server exempts, so
          // it stays allowed.
          if (!isSampleProjectName(cloneName) && !canCreateProject(realProjectCount)) {
            setActionSheetRef(null);
            setProjectCapPaywall(true);
            return;
          }
          // Scope-only clone, built from a WHITELIST (utils/projectClone,
          // audit wave 5 #60): name, type, sf, quality, location,
          // description, scope, contract model, linked estimate, a GC-set
          // target budget, and the schedule's plan with its progress,
          // actuals, baselines and start date taken off. Everything else —
          // the old client (primaryContact: the waivers named the previous
          // homeowner), Handover ticks, estimate history, QuickBooks link,
          // zoning-confirmed address, closeout / warranty dates,
          // coordinates, photos, collaborators, public profile and the
          // client portal and its credential — starts empty. Photos / DFRs /
          // invoices / RFIs / COs live in their own contexts keyed by
          // project_id and were never copied. status 'draft' + createdAt now
          // lets the copy flow through the normal new-project setup.
          const clone: Project = {
            ...cloneProjectAsTemplate(source, new Date().toISOString(), {
              id: generateUUID(),
              name: cloneName,
              scheduleId: generateUUID(),
            }),
            // Already absent from the whitelist; stated here as well because
            // it is the one field whose leak is silent AND fatal — the source
            // portal's access token, and a unique portalId index that turns
            // the copy's first sync into a discarded write (see the
            // projectClone header; validate-portal-security pins this line).
            clientPortal: undefined,
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
  emptyList: {
    flex: 1,
  },
  // ── Desktop (wave 6c) — each appended behind `responsive.isDesktop &&` ──
  // Ask MAGE / Copilot in the footer's TileGrid: the grid owns the gap.
  launcherDesktop: {
    marginBottom: 0,
  },
  // The footer slot already sits on the page gutter.
  aiBriefingWrapDesktop: {
    marginHorizontal: 0,
  },
  // Today on site in the layout's left column, flush with the gutter.
  todaySectionDesktop: {
    paddingHorizontal: 0,
    marginTop: 0,
  },
  noticesDesktop: {
    marginHorizontal: Layout.gutter,
  },
  // The Create button hugs its label at the dialog's right edge.
  createBtnDesktop: {
    alignSelf: 'flex-end' as const,
  },
  desktopFooter: {
    gap: 12,
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
    backgroundColor: t.accentFill,
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
    backgroundColor: t.accentFill,
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
  fieldHint: {
    fontSize: Type.caption1.fontSize,
    lineHeight: Type.caption1.lineHeight,
    color: t.textMuted,
    marginTop: 8,
  },
  fieldChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Tokens.radius.card,
    backgroundColor: t.surfaceAlt,
  },
  fieldChipLabel: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '600' as const,
    color: t.accentLabel,
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
    backgroundColor: t.accentFill,
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
    backgroundColor: t.accentFill,
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
    backgroundColor: t.accentFill,
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
  filterChipEmpty: {
    opacity: 0.55,
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
  todayMoreText: {
    flex: 1,
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: t.accentLabel,
  },
});
