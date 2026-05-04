import React, { useCallback, useState, useMemo, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Platform, Modal, TextInput, Pressable, ScrollView, Alert, KeyboardAvoidingView,
} from 'react-native';
import ConstructionLoader from '@/components/ConstructionLoader';
import { SkeletonCard } from '@/components/Skeleton';
import TapeRollNumber from '@/components/animations/TapeRollNumber';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Plus, TrendingUp, FolderOpen, Layers, X, ChevronRight, Calculator, CalendarDays,
  BarChart3, TrendingDown, Package, DollarSign, Percent, ShoppingCart, ArrowDownRight,
  Receipt, Search, Sparkles, ChevronDown, ChevronUp, HardHat, Bell,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { generateUUID } from '@/utils/generateId';
import { useProjects } from '@/contexts/ProjectContext';
import ProjectCard from '@/components/ProjectCard';
import AIWeeklySummary from '@/components/AIWeeklySummary';
import AICopilot from '@/components/AICopilot';
import AIHomeBriefing from '@/components/AIHomeBriefing';
import SmartInbox from '@/components/SmartInbox';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useEntityNavigation } from '@/hooks/useEntityNavigation';
import { useSearch } from '@/contexts/SearchContext';
import EntityActionSheet from '@/components/EntityActionSheet';
import InlineVoiceFill from '@/components/InlineVoiceFill';
import { parseProjectFromTranscript } from '@/utils/voiceFormParsers';
import { useNotificationFeed } from '@/hooks/useNotificationFeed';
import UniversalMicButton from '@/components/UniversalMicButton';
import EmptyState from '@/components/EmptyState';
import { useAuth } from '@/contexts/AuthContext';
import Tutorial, { hasSeenTutorial } from '@/components/Tutorial';
import { OnboardingChecklist } from '@/components/OnboardingChecklist';
import { useOnboardingMilestones } from '@/utils/onboardingProgress';
import { HelpFab } from '@/components/HelpFab';
import MageRefreshControl from '@/components/MageRefreshControl';
import { useQueryClient } from '@tanstack/react-query';
import { DemoSeedPickerModal } from '@/components/DemoSeedPickerModal';
import type { DemoFlavor } from '@/utils/demoSeed';
import { CreateMenu } from '@/components/CreateMenu';
import OfflineSyncPill from '@/components/OfflineSyncPill';
import QuickFieldUpdate from '@/components/QuickFieldUpdate';
import { PROJECT_TYPES, type Project, type ProjectType, type EntityRef } from '@/types';
import { formatMoney, formatMoneyShort } from '@/utils/formatters';
import WarrantyWalkBanner from '@/components/WarrantyWalkBanner';
import { getUpcomingWarrantyWalks } from '@/utils/warrantyWalks';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import PageHeader from '@/components/PageHeader';
import PipelineHeroChart from '@/components/PipelineHeroChart';
import ProjectRow from '@/components/ProjectRow';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const notifFeed = useNotificationFeed();
  // Same width threshold as DesktopActionRail in the tabs layout — when the
  // rail is mounted, the inline SmartInbox below would duplicate its content.
  // Keep the breakpoint in sync if you change either side.
  const responsive = useResponsiveLayout();
  const isWideDesktop = responsive.isDesktop && responsive.width >= 1280;
  // Use the dense ProjectRow at tablet+ widths. On phone we keep the
  // ProjectCard pattern — stacked metas read better on narrow screens.
  const useDenseRows = !responsive.isPhone;
  const { navigateTo } = useEntityNavigation();
  const { openSearch } = useSearch();
  const projectCtx = useProjects();
  const { projects, isLoading, addProject, getTotalOutstandingBalance, invoices } = projectCtx;
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

  // Auto-open the interactive tutorial once after first login. The header
  // comment in Tutorial.tsx promised this but the auto-open never actually
  // fired — audit found it was hidden behind Settings. Now it surfaces on
  // first home-tab render, persists the "seen" flag on close.
  const [showTutorial, setShowTutorial] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const seen = await hasSeenTutorial();
      if (!seen && !cancelled) setShowTutorial(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // Onboarding milestones — drives the 5-step "Get up and running" panel.
  // Re-reads when the project / invoice count changes so the user sees
  // their checks land in real-time after creating a project, sending an
  // invoice, etc. Voice + takeoff milestones come from AsyncStorage flags.
  const milestones = useOnboardingMilestones(`${projects.length}-${invoices.length}`);
  const estimateCount = useMemo(
    () => projects.filter(p =>
      (p.linkedEstimate?.items?.length ?? 0) > 0
      || (p.estimate?.materials?.length ?? 0) > 0
      || (p.estimate?.grandTotal ?? 0) > 0,
    ).length,
    [projects],
  );

  // The picker visibility — empty-state CTA toggles it open; user picks
  // small or large; we call the actual seed.
  const [showDemoPicker, setShowDemoPicker] = useState(false);

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

  const totalOutstanding = getTotalOutstandingBalance();

  // Surface upcoming 11-month warranty walks. Hidden when none — keeps
  // the home tab quiet during normal operation. Drives an inline banner
  // below the nav bar.
  const warrantyWalkAlerts = useMemo(() => getUpcomingWarrantyWalks(projects), [projects]);

  const [showTotalDetail, setShowTotalDetail] = useState(false);
  const [showSavingsDetail, setShowSavingsDetail] = useState(false);
  const [showWeeklySummary, setShowWeeklySummary] = useState(false);
  const [showAIBriefing, setShowAIBriefing] = useState(false);

  const totalEstimated = projects.reduce((sum, p) => {
    const linked = p.linkedEstimate;
    if (linked && linked.items.length > 0) return sum + linked.grandTotal;
    return sum + (p.estimate?.grandTotal ?? 0);
  }, 0);
  const totalSavings = projects.reduce((sum, p) => {
    let savings = p.estimate?.bulkSavingsTotal ?? 0;
    if (p.linkedEstimate) {
      const linked = p.linkedEstimate;
      linked.items.forEach(item => {
        if (item.usesBulk) {
          savings += (item.bulkPrice > 0 ? (item.unitPrice - item.bulkPrice) * item.quantity : 0);
        }
      });
    }
    return sum + savings;
  }, 0);

  const projectBreakdowns = useMemo(() => {
    return projects.map(p => {
      const linked = p.linkedEstimate;
      const legacy = p.estimate;
      let total = 0;
      let materialCost = 0;
      let laborCost = 0;
      let markupCost = 0;
      let bulkSavings = 0;
      let itemCount = 0;

      if (linked && linked.items.length > 0) {
        total = linked.grandTotal;
        materialCost = linked.baseTotal;
        markupCost = linked.markupTotal;
        itemCount = linked.items.length;
        linked.items.forEach(item => {
          if (item.usesBulk) {
            bulkSavings += (item.unitPrice - item.bulkPrice) * item.quantity;
          }
        });
      } else if (legacy) {
        total = legacy.grandTotal;
        materialCost = legacy.materialTotal;
        laborCost = legacy.laborTotal;
        bulkSavings = legacy.bulkSavingsTotal;
        itemCount = legacy.materials.length;
      }

      return {
        id: p.id,
        name: p.name,
        type: p.type,
        total,
        materialCost,
        laborCost,
        markupCost,
        bulkSavings,
        itemCount,
        hasLinked: !!(linked && linked.items.length > 0),
        hasLegacy: !!legacy,
      };
    }).filter(b => b.total > 0);
  }, [projects]);

  const portfolioStats = useMemo(() => {
    const totalMaterials = projectBreakdowns.reduce((s, b) => s + b.materialCost, 0);
    const totalLabor = projectBreakdowns.reduce((s, b) => s + b.laborCost, 0);
    const totalMarkup = projectBreakdowns.reduce((s, b) => s + b.markupCost, 0);
    const totalBulk = projectBreakdowns.reduce((s, b) => s + b.bulkSavings, 0);
    const avgPerProject = projectBreakdowns.length > 0 ? totalEstimated / projectBreakdowns.length : 0;
    return { totalMaterials, totalLabor, totalMarkup, totalBulk, avgPerProject };
  }, [projectBreakdowns, totalEstimated]);

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
    // Cross-tab navigation: replace rather than push so the destination tab
    // surfaces correctly. A push stacks the target tab ON TOP of the current
    // tab's stack, which on iOS causes the new screen to render behind the
    // active one (classic "press back and the new screen appears" bug).
    if (step === 'estimate') {
      router.replace('/(tabs)/estimate' as any);
    } else if (step === 'schedule') {
      router.replace('/(tabs)/schedule' as any);
    }
    setCreatedProjectId(null);
  }, [router]);

  const renderProject = useCallback(({ item }: { item: Project }) => (
    <ProjectCard
      project={item}
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
    if (!useDenseRows || projects.length === 0) return null;
    return (
      <View style={styles.denseListWrap}>
        <View style={styles.denseListSectionHeader}>
          <Text style={styles.denseListSectionTitle}>All projects</Text>
          <Text style={styles.denseListSectionCount}>{projects.length}</Text>
        </View>
        <View style={styles.denseListContainer}>
          {projects.map((p, idx) => (
            <ProjectRow
              key={p.id}
              project={p}
              showDivider={idx < projects.length - 1}
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
  }, [useDenseRows, projects, handleProjectPress]);

  const keyExtractor = useCallback((item: Project) => item.id, []);

  if (isLoading) {
    // Show 3 skeleton cards instead of a centered spinner. Preserves the
    // visual rhythm of the project list so content appears to fade in
    // rather than punch through a loader. Premium-app feel.
    return (
      <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </View>
    );
  }



  return (
    <View style={styles.container}>
      <FlatList
        // At tablet+ widths the project list is rendered as a single bordered
        // table inside ListFooterComponent (denseProjectList). FlatList still
        // owns the scroll surface + refresh control; we just bypass per-item
        // rendering so the rows can connect into a unified card.
        data={useDenseRows ? [] : projects}
        renderItem={renderProject}
        keyExtractor={keyExtractor}
        ListFooterComponent={denseProjectList}
        refreshControl={
          <MageRefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
        contentContainerStyle={[
          styles.listContent,
          { paddingTop: insets.top, paddingBottom: insets.bottom + 90 },
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
                      style={[styles.addButton, { backgroundColor: Colors.fillTertiary }]}
                      onPress={openSearch}
                      activeOpacity={0.7}
                      testID="universal-search-btn"
                      accessibilityRole="button"
                      accessibilityLabel="Search"
                    >
                      <Search size={20} color={Colors.primary} strokeWidth={2} />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={[styles.addButton, { backgroundColor: Colors.fillTertiary }]}
                    onPress={() => router.push('/notifications-inbox' as any)}
                    activeOpacity={0.7}
                    testID="notifications-inbox-btn"
                  >
                    <Bell size={20} color={Colors.primary} strokeWidth={2} />
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
                    <Plus size={18} color={Colors.surface} strokeWidth={2.5} />
                  </TouchableOpacity>
                </>
              }
            />
            {/* Hero pipeline chart — anchors the home tab the way the
                reference SaaS dashboard's MRR line chart anchors theirs.
                Renders nothing if no projects have a value yet. */}
            {projects.length > 0 && <PipelineHeroChart projects={projects} />}

            {/* 11-month warranty walk reminders — only renders when
                there are upcoming/overdue walks. Tap → opens project. */}
            <WarrantyWalkBanner alerts={warrantyWalkAlerts} />

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

            {projects.length > 0 && (
              <View style={styles.statsSection}>
                <View style={styles.statsGrid}>
                  <View style={styles.statCard}>
                    <View style={styles.statIconWrap}>
                      <Layers size={15} color={Colors.textSecondary} strokeWidth={1.8} />
                    </View>
                    {/* Animated count: rolls up from 0 to current on mount,
                        re-clicks when projects change. Tiny visual win that
                        makes the stat feel earned. */}
                    <TapeRollNumber
                      value={projects.length}
                      duration={500}
                      style={styles.statNumber}
                    />
                    <Text style={styles.statLabel}>Projects</Text>
                  </View>
                  {totalOutstanding > 0 && (
                    <View style={styles.statCard}>
                      <View style={styles.statIconWrap}>
                        <Receipt size={15} color={Colors.textSecondary} strokeWidth={1.8} />
                      </View>
                      <TapeRollNumber
                        value={totalOutstanding}
                        duration={650}
                        formatter={formatMoneyShort}
                        style={{ ...styles.statNumber, color: Colors.accent }}
                      />
                      <Text style={styles.statLabel}>Outstanding</Text>
                    </View>
                  )}
                  <TouchableOpacity
                    style={[styles.statCard, styles.statCardMiddle]}
                    onPress={() => {
                      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setShowTotalDetail(true);
                    }}
                    activeOpacity={0.7}
                    testID="total-value-tap"
                  >
                    <View style={styles.statIconWrap}>
                      <TrendingUp size={15} color={Colors.textSecondary} strokeWidth={1.8} />
                    </View>
                    <Text style={styles.statNumber}>{formatMoneyShort(totalEstimated)}</Text>
                    <Text style={styles.statLabel}>Total Value</Text>
                    <ArrowDownRight size={10} color={Colors.textMuted} style={{ position: 'absolute', top: 12, right: 12 }} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.statCard}
                    onPress={() => {
                      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setShowSavingsDetail(true);
                    }}
                    activeOpacity={0.7}
                    testID="bulk-savings-tap"
                  >
                    <View style={styles.statIconWrap}>
                      <TrendingDown size={15} color={Colors.textSecondary} strokeWidth={1.8} />
                    </View>
                    <Text style={[styles.statNumber, { color: Colors.success }]}>{formatMoneyShort(totalSavings)}</Text>
                    <Text style={styles.statLabel}>Bulk Savings</Text>
                    <ArrowDownRight size={10} color={Colors.textMuted} style={{ position: 'absolute', top: 12, right: 12 }} />
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* (SmartInbox moved above the stats — see line ~346 — so
                "what needs you right now" reads first.) */}

            {/* 5-step onboarding checklist — auto-hides at 4/5 done OR
                when explicitly dismissed. New users always see it; veteran
                users never do. */}
            <OnboardingChecklist
              projectCount={projects.length}
              estimateCount={estimateCount}
              invoiceCount={invoices.length}
              takeoffRun={milestones.takeoffRun}
              voiceUsed={milestones.voiceUsed}
            />

            {projects.length > 0 && (
              <View style={styles.aiBriefingWrap}>
                <TouchableOpacity
                  style={styles.aiBriefingToggle}
                  onPress={() => setShowAIBriefing(prev => !prev)}
                  activeOpacity={0.7}
                  testID="ai-briefing-toggle"
                >
                  <View style={styles.aiBriefingToggleLeft}>
                    <Sparkles size={14} color={Colors.primary} strokeWidth={2.2} />
                    <Text style={styles.aiBriefingToggleText}>
                      {showAIBriefing ? 'Hide AI summary' : 'Get AI summary'}
                    </Text>
                  </View>
                  {showAIBriefing
                    ? <ChevronUp size={14} color={Colors.textSecondary} strokeWidth={2} />
                    : <ChevronDown size={14} color={Colors.textSecondary} strokeWidth={2} />}
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
            )}

            {/* CashFlowGlance + CashFlowAlerts moved to the Summary tab.
                Your Projects is for the project list itself. */}

            {projects.length > 0 && <QuickFieldUpdate />}

            {projects.length > 0 && (
              <Text style={styles.sectionHeader}>RECENT</Text>
            )}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon={<HardHat size={40} color={Colors.primary} strokeWidth={1.6} />}
            title="Build something"
            message="Your first project is one tap away. Add it to start tracking estimates, daily reports, invoices — every job, every detail."
            actionLabel="Create your first project"
            onAction={() => setShowCreateModal(true)}
            secondaryLabel={showDemoSeed ? 'Try a sample project (small or large)' : undefined}
            onSecondaryAction={showDemoSeed ? handleSeedDemo : undefined}
          />
        }
        showsVerticalScrollIndicator={false}
      />

      <Modal visible={showCreateModal} transparent animationType="slide" onRequestClose={() => setShowCreateModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <View style={[styles.createModalCard, { paddingBottom: insets.bottom + 20 }]}>
              <View style={styles.createModalHeader}>
                <Text style={styles.createModalTitle}>New Project</Text>
                <TouchableOpacity onPress={() => setShowCreateModal(false)} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close">
                  <X size={20} color={Colors.textMuted} />
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
                  placeholderTextColor={Colors.textMuted}
                  autoFocus
                  testID="project-name-input"
                />

                <Text style={styles.fieldLabel}>Description</Text>
                <TextInput
                  style={[styles.input, styles.descInput]}
                  value={projectDescription}
                  onChangeText={setProjectDescription}
                  placeholder="Brief description of the project..."
                  placeholderTextColor={Colors.textMuted}
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

      <Modal
        visible={showTotalDetail}
        animationType="slide"
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
        onRequestClose={() => setShowTotalDetail(false)}
      >
        <View style={[detailStyles.modalContainer, { paddingTop: Platform.OS === 'ios' ? 12 : insets.top + 8 }]}>
          <View style={detailStyles.modalHandle} />
          <View style={detailStyles.modalHeader}>
            <Text style={detailStyles.modalTitle}>Portfolio Value</Text>
            <TouchableOpacity
              style={detailStyles.modalCloseBtn}
              onPress={() => setShowTotalDetail(false)}
              activeOpacity={0.7}
              testID="close-total-detail" accessibilityRole="button" accessibilityLabel="Close">
              <X size={20} color={Colors.text} />
            </TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}>
            <View style={detailStyles.heroSection}>
              <View style={detailStyles.heroIconWrap}>
                <BarChart3 size={28} color={Colors.primary} />
              </View>
              <Text style={detailStyles.heroAmount}>${totalEstimated.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</Text>
              <Text style={detailStyles.heroSubtitle}>Total Portfolio Value</Text>
              <View style={detailStyles.heroChips}>
                <View style={detailStyles.heroChip}>
                  <Text style={detailStyles.heroChipLabel}>{projectBreakdowns.length}</Text>
                  <Text style={detailStyles.heroChipSub}>with estimates</Text>
                </View>
                <View style={[detailStyles.heroChip, { backgroundColor: Colors.infoLight }]}>
                  <Text style={[detailStyles.heroChipLabel, { color: Colors.info }]}>
                    ${portfolioStats.avgPerProject.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </Text>
                  <Text style={[detailStyles.heroChipSub, { color: Colors.info }]}>avg / project</Text>
                </View>
              </View>
            </View>

            <Text style={detailStyles.sectionLabel}>Cost Composition</Text>
            <View style={detailStyles.barChartWrap}>
              {[
                { label: 'Materials', value: portfolioStats.totalMaterials, color: Colors.successDark, icon: Package },
                { label: 'Labor', value: portfolioStats.totalLabor, color: Colors.info, icon: DollarSign },
                { label: 'Markup', value: portfolioStats.totalMarkup, color: Colors.warning, icon: Percent },
              ].filter(r => r.value > 0).map(row => {
                const pct = totalEstimated > 0 ? (row.value / totalEstimated) * 100 : 0;
                return (
                  <View key={row.label} style={detailStyles.barRow}>
                    <View style={detailStyles.barLabelRow}>
                      <row.icon size={14} color={row.color} />
                      <Text style={detailStyles.barLabel}>{row.label}</Text>
                      <Text style={detailStyles.barPct}>{pct.toFixed(1)}%</Text>
                    </View>
                    <View style={detailStyles.barTrack}>
                      <View style={[detailStyles.barFill, { width: `${Math.min(pct, 100)}%`, backgroundColor: row.color }]} />
                    </View>
                    <Text style={detailStyles.barValue}>${row.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
                  </View>
                );
              })}
              {totalSavings > 0 && (
                <View style={detailStyles.barRow}>
                  <View style={detailStyles.barLabelRow}>
                    <TrendingDown size={14} color={Colors.success} />
                    <Text style={[detailStyles.barLabel, { color: Colors.success }]}>Bulk Savings</Text>
                  </View>
                  <Text style={[detailStyles.barValue, { color: Colors.success }]}>-${totalSavings.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
                </View>
              )}
            </View>

            <Text style={detailStyles.sectionLabel}>By Project</Text>
            <View style={detailStyles.projectListCard}>
              {projectBreakdowns.map((b, idx) => (
                <View key={b.id}>
                  <View style={detailStyles.projectRow}>
                    <View style={detailStyles.projectRank}>
                      <Text style={detailStyles.projectRankText}>#{idx + 1}</Text>
                    </View>
                    <View style={detailStyles.projectInfo}>
                      <Text style={detailStyles.projectName} numberOfLines={1}>{b.name}</Text>
                      <Text style={detailStyles.projectMeta}>
                        {b.itemCount} items · {b.hasLinked ? 'Linked' : 'Estimated'}
                      </Text>
                    </View>
                    <View style={detailStyles.projectValues}>
                      <Text style={detailStyles.projectTotal}>${b.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
                      <Text style={detailStyles.projectPct}>
                        {totalEstimated > 0 ? ((b.total / totalEstimated) * 100).toFixed(0) : 0}%
                      </Text>
                    </View>
                  </View>
                  {idx < projectBreakdowns.length - 1 && <View style={detailStyles.projectDivider} />}
                </View>
              ))}
              {projectBreakdowns.length === 0 && (
                <View style={detailStyles.emptyProject}>
                  <Text style={detailStyles.emptyProjectText}>No projects with estimates yet</Text>
                </View>
              )}
            </View>
          </ScrollView>
        </View>
      </Modal>

      <Modal
        visible={showSavingsDetail}
        animationType="slide"
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
        onRequestClose={() => setShowSavingsDetail(false)}
      >
        <View style={[detailStyles.modalContainer, { paddingTop: Platform.OS === 'ios' ? 12 : insets.top + 8 }]}>
          <View style={detailStyles.modalHandle} />
          <View style={detailStyles.modalHeader}>
            <Text style={detailStyles.modalTitle}>Bulk Savings</Text>
            <TouchableOpacity
              style={detailStyles.modalCloseBtn}
              onPress={() => setShowSavingsDetail(false)}
              activeOpacity={0.7}
              testID="close-savings-detail" accessibilityRole="button" accessibilityLabel="Close">
              <X size={20} color={Colors.text} />
            </TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}>
            <View style={detailStyles.heroSection}>
              <View style={[detailStyles.heroIconWrap, { backgroundColor: Colors.successLight }]}>
                <TrendingDown size={28} color={Colors.success} />
              </View>
              <Text style={[detailStyles.heroAmount, { color: Colors.success }]}>
                ${totalSavings.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </Text>
              <Text style={detailStyles.heroSubtitle}>Total Bulk Savings</Text>
              <View style={detailStyles.heroChips}>
                <View style={[detailStyles.heroChip, { backgroundColor: Colors.successLight }]}>
                  <Text style={[detailStyles.heroChipLabel, { color: Colors.success }]}>
                    {totalEstimated > 0 ? ((totalSavings / (totalEstimated + totalSavings)) * 100).toFixed(1) : '0'}%
                  </Text>
                  <Text style={[detailStyles.heroChipSub, { color: Colors.success }]}>savings rate</Text>
                </View>
                <View style={detailStyles.heroChip}>
                  <Text style={detailStyles.heroChipLabel}>
                    {projectBreakdowns.filter(b => b.bulkSavings > 0).length}
                  </Text>
                  <Text style={detailStyles.heroChipSub}>projects saving</Text>
                </View>
              </View>
            </View>

            <Text style={detailStyles.sectionLabel}>How Bulk Savings Work</Text>
            <View style={detailStyles.infoCard}>
              <View style={detailStyles.infoRow}>
                <View style={[detailStyles.infoStep, { backgroundColor: Colors.primary + '15' }]}>
                  <Text style={[detailStyles.infoStepNum, { color: Colors.primary }]}>1</Text>
                </View>
                <View style={detailStyles.infoTextWrap}>
                  <Text style={detailStyles.infoTitle}>Volume Thresholds</Text>
                  <Text style={detailStyles.infoDesc}>Each material has a min bulk quantity. Once met, a lower per-unit price is unlocked.</Text>
                </View>
              </View>
              <View style={detailStyles.infoRow}>
                <View style={[detailStyles.infoStep, { backgroundColor: Colors.success + '15' }]}>
                  <Text style={[detailStyles.infoStepNum, { color: Colors.success }]}>2</Text>
                </View>
                <View style={detailStyles.infoTextWrap}>
                  <Text style={detailStyles.infoTitle}>Automatic Application</Text>
                  <Text style={detailStyles.infoDesc}>When quantities exceed thresholds, savings are calculated automatically in your estimates.</Text>
                </View>
              </View>
              <View style={detailStyles.infoRow}>
                <View style={[detailStyles.infoStep, { backgroundColor: Colors.accent + '15' }]}>
                  <Text style={[detailStyles.infoStepNum, { color: Colors.accent }]}>3</Text>
                </View>
                <View style={detailStyles.infoTextWrap}>
                  <Text style={detailStyles.infoTitle}>Buy Direct</Text>
                  <Text style={detailStyles.infoDesc}>Visit the Marketplace tab to buy materials directly from suppliers at bulk rates.</Text>
                </View>
              </View>
            </View>

            <Text style={detailStyles.sectionLabel}>Savings by Project</Text>
            <View style={detailStyles.projectListCard}>
              {projectBreakdowns.filter(b => b.bulkSavings > 0).map((b, idx) => (
                <View key={b.id}>
                  <View style={detailStyles.projectRow}>
                    <View style={[detailStyles.projectRank, { backgroundColor: Colors.successLight }]}>
                      <Text style={[detailStyles.projectRankText, { color: Colors.success }]}>#{idx + 1}</Text>
                    </View>
                    <View style={detailStyles.projectInfo}>
                      <Text style={detailStyles.projectName} numberOfLines={1}>{b.name}</Text>
                      <Text style={detailStyles.projectMeta}>{b.itemCount} items</Text>
                    </View>
                    <View style={detailStyles.projectValues}>
                      <Text style={[detailStyles.projectTotal, { color: Colors.success }]}>
                        -${b.bulkSavings.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </Text>
                    </View>
                  </View>
                  {idx < projectBreakdowns.filter(bd => bd.bulkSavings > 0).length - 1 && (
                    <View style={detailStyles.projectDivider} />
                  )}
                </View>
              ))}
              {projectBreakdowns.filter(b => b.bulkSavings > 0).length === 0 && (
                <View style={detailStyles.emptyProject}>
                  <Text style={detailStyles.emptyProjectText}>No bulk savings yet. Increase quantities to unlock bulk pricing.</Text>
                </View>
              )}
            </View>

            {projectBreakdowns.some(b => b.bulkSavings === 0 && b.total > 0) && (
              <>
                <Text style={detailStyles.sectionLabel}>Optimization Tips</Text>
                <View style={[detailStyles.infoCard, { backgroundColor: Colors.warningLight, borderColor: Colors.warning + '30' }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                    <ShoppingCart size={18} color={Colors.warning} />
                    <View style={{ flex: 1 }}>
                      <Text style={[detailStyles.infoTitle, { marginBottom: 4 }]}>Unlock More Savings</Text>
                      <Text style={detailStyles.infoDesc}>
                        {projectBreakdowns.filter(b => b.bulkSavings === 0 && b.total > 0).length} project(s) have no bulk savings yet. Increase material quantities past bulk thresholds to save more.
                      </Text>
                    </View>
                  </View>
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={showNextStepModal} transparent animationType="fade" onRequestClose={() => setShowNextStepModal(false)}>
        <Pressable style={styles.modalOverlayCenter} onPress={() => handleNextStep('later')}>
          <Pressable style={styles.nextStepCard} onPress={() => undefined}>
            <Text style={styles.nextStepTitle}>Project Created!</Text>
            <Text style={styles.nextStepDesc}>What would you like to do next?</Text>

            <TouchableOpacity style={styles.nextStepOption} onPress={() => handleNextStep('estimate')} activeOpacity={0.7}>
              <View style={[styles.nextStepIconWrap, { backgroundColor: Colors.primary + '15' }]}>
                <Calculator size={20} color={Colors.primary} />
              </View>
              <View style={styles.nextStepTextWrap}>
                <Text style={styles.nextStepOptionTitle}>Create Estimate</Text>
                <Text style={styles.nextStepOptionDesc}>Search materials and build a cost estimate</Text>
              </View>
              <ChevronRight size={18} color={Colors.textMuted} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.nextStepOption} onPress={() => handleNextStep('schedule')} activeOpacity={0.7}>
              <View style={[styles.nextStepIconWrap, { backgroundColor: Colors.info + '15' }]}>
                <CalendarDays size={20} color={Colors.info} />
              </View>
              <View style={styles.nextStepTextWrap}>
                <Text style={styles.nextStepOptionTitle}>Create Schedule</Text>
                <Text style={styles.nextStepOptionDesc}>Plan tasks and timeline for this project</Text>
              </View>
              <ChevronRight size={18} color={Colors.textMuted} />
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

      <AICopilot />

      <EntityActionSheet
        entityRef={actionSheetRef}
        onClose={() => setActionSheetRef(null)}
      />

      {/* Always-rendered FAB — internally hides itself if there are no
          projects to scope an action to. Keeping it unconditional avoids
          parent hook-tree churn on data load. */}
      <UniversalMicButton />

      {/* First-run tutorial. Auto-opens once; close persists the seen
          flag so it doesn't re-open on subsequent launches. */}
      <Tutorial visible={showTutorial} onClose={() => setShowTutorial(false)} />

      {/* Floating help — answers "what is this thing" without forcing the
          user to navigate away. Bottom-offset clears the bottom tab bar. */}
      <HelpFab bottomOffset={56} onReplayTutorial={() => setShowTutorial(true)} />

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
        onCreateProject={() => setShowCreateModal(true)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
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
    color: Colors.primary,
    letterSpacing: -0.4,
  },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primary,
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
    backgroundColor: Colors.error,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.background,
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
    color: Colors.text,
    letterSpacing: -0.5,
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
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.panel,
    padding: 18,
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    minHeight: 96,
  },
  statCardMiddle: {
    backgroundColor: Colors.surface,
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
    backgroundColor: Colors.fillTertiary,
  },
  statNumber: {
    fontSize: Type.title2.fontSize,
    fontWeight: '800' as const,
    color: Colors.text,
    letterSpacing: -0.6,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: Type.caption1.fontSize,
    color: Colors.textSecondary,
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
    color: Colors.text,
    letterSpacing: -0.1,
  },
  denseListSectionCount: {
    fontSize: Type.footnote.fontSize,
    color: Colors.textSecondary,
    fontWeight: '600' as const,
  },
  denseListContainer: {
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.panel,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    overflow: 'hidden' as const,
  },
  sectionHeader: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    letterSpacing: 0.6,
    paddingHorizontal: 20,
    marginBottom: 10,
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
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  aiBriefingToggleLeft: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  aiBriefingToggleText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: Colors.text,
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
    backgroundColor: Colors.surface,
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
    color: Colors.text,
    letterSpacing: -0.3,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: Tokens.radius.panel,
    backgroundColor: Colors.fillTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createModalScroll: {
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    minHeight: 48,
    borderRadius: Tokens.radius.lg,
    backgroundColor: Colors.surfaceAlt,
    paddingHorizontal: 14,
    fontSize: Type.callout.fontSize,
    color: Colors.text,
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
    backgroundColor: Colors.fillTertiary,
  },
  typeChipActive: {
    backgroundColor: Colors.primary,
  },
  typeChipLabel: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  typeChipLabelActive: {
    color: Colors.textOnPrimary,
  },
  createBtn: {
    backgroundColor: Colors.primary,
    borderRadius: Tokens.radius.lg,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 3,
  },
  createBtnText: {
    fontSize: Type.callout.fontSize,
    fontWeight: '700' as const,
    color: Colors.textOnPrimary,
  },
  nextStepCard: {
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius["2xl"],
    padding: 24,
    gap: 16,
    // Match the other home-screen cards.
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  nextStepTitle: {
    fontSize: Type.title2.fontSize,
    fontWeight: '700' as const,
    color: Colors.text,
    textAlign: 'center',
  },
  nextStepDesc: {
    fontSize: Type.subhead.fontSize,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: 4,
  },
  nextStepOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceAlt,
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
    color: Colors.text,
  },
  nextStepOptionDesc: {
    fontSize: Type.footnote.fontSize,
    color: Colors.textSecondary,
  },
  laterBtn: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  laterBtnText: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '500' as const,
    color: Colors.textMuted,
  },
});

const detailStyles = StyleSheet.create({
  modalContainer: { flex: 1, backgroundColor: Colors.background },
  modalHandle: { width: 36, height: 5, borderRadius: 3, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: 8 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight, backgroundColor: Colors.background },
  modalTitle: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: Colors.text, letterSpacing: -0.3 },
  modalCloseBtn: { width: 32, height: 32, borderRadius: Tokens.radius.panel, backgroundColor: Colors.fillTertiary, alignItems: 'center', justifyContent: 'center' },
  heroSection: { alignItems: 'center', paddingVertical: 28, paddingHorizontal: 20, gap: 6 },
  heroIconWrap: { width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.primary + '12', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  heroAmount: { fontSize: 38, fontWeight: '800' as const, color: Colors.text, letterSpacing: -1.5 },
  heroSubtitle: { fontSize: Type.bodyCompact.fontSize, color: Colors.textSecondary, fontWeight: '500' as const },
  heroChips: { flexDirection: 'row', gap: 10, marginTop: 14 },
  heroChip: { backgroundColor: Colors.fillTertiary, borderRadius: Tokens.radius.card, paddingHorizontal: 14, paddingVertical: 8, alignItems: 'center', gap: 2 },
  heroChipLabel: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: Colors.text },
  heroChipSub: { fontSize: Type.caption2.fontSize, color: Colors.textMuted, fontWeight: '500' as const },
  sectionLabel: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: Colors.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.8, paddingHorizontal: 20, marginBottom: 8, marginTop: 4 },
  barChartWrap: { marginHorizontal: 20, backgroundColor: Colors.surface, borderRadius: Tokens.radius.panel, padding: 16, gap: 16, marginBottom: 20, borderWidth: 1, borderColor: Colors.cardBorder },
  barRow: { gap: 6 },
  barLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  barLabel: { flex: 1, fontSize: Type.bodyCompact.fontSize, fontWeight: '500' as const, color: Colors.text },
  barPct: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: Colors.textSecondary },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: Colors.fillTertiary, overflow: 'hidden' as const },
  barFill: { height: 8, borderRadius: 4 },
  barValue: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: Colors.text },
  projectListCard: { marginHorizontal: 20, backgroundColor: Colors.surface, borderRadius: Tokens.radius.panel, padding: 14, marginBottom: 20, borderWidth: 1, borderColor: Colors.cardBorder },
  projectRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  projectRank: { width: 26, height: 26, borderRadius: 13, backgroundColor: Colors.infoLight, alignItems: 'center', justifyContent: 'center' },
  projectRankText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: Colors.info },
  projectInfo: { flex: 1, gap: 2 },
  projectName: { fontSize: Type.bodyCompact.fontSize, fontWeight: '500' as const, color: Colors.text },
  projectMeta: { fontSize: Type.caption1.fontSize, color: Colors.textMuted },
  projectValues: { alignItems: 'flex-end', gap: 1 },
  projectTotal: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: Colors.text },
  projectPct: { fontSize: Type.caption2.fontSize, fontWeight: '600' as const, color: Colors.textSecondary, backgroundColor: Colors.fillTertiary, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' as const },
  projectDivider: { height: 1, backgroundColor: Colors.borderLight },
  emptyProject: { alignItems: 'center', paddingVertical: 20 },
  emptyProjectText: { fontSize: Type.bodyCompact.fontSize, color: Colors.textMuted, textAlign: 'center' as const },
  infoCard: { marginHorizontal: 20, backgroundColor: Colors.surface, borderRadius: Tokens.radius.panel, padding: 16, gap: 16, marginBottom: 20, borderWidth: 1, borderColor: Colors.cardBorder },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  infoStep: { width: 28, height: 28, borderRadius: Tokens.radius.lg, alignItems: 'center', justifyContent: 'center' },
  infoStepNum: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const },
  infoTextWrap: { flex: 1 },
  infoTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: Colors.text },
  infoDesc: { fontSize: Type.footnote.fontSize, color: Colors.textSecondary, lineHeight: 19, marginTop: 2 },
});
