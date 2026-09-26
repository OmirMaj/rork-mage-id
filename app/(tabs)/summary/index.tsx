import React, { useMemo, useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Platform, TouchableOpacity, type StyleProp, type ViewStyle } from 'react-native';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { FolderOpen, ChevronRight, Briefcase, CalendarOff, CloudOff } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Layout, Tokens } from '@/constants/designTokens';
import { useCoreData, useFinancialsData } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import { Skeleton, SkeletonCard } from '@/components/Skeleton';
import EmptyState from '@/components/EmptyState';
import { LandingSlot, useLanding } from '@/components/animations/Landing';
import { effectiveEstimateTotal } from '@/utils/estimateCommit';
import { getContractValue } from '@/utils/projectFinancials';
import { invoiceOutstanding } from '@/utils/invoiceBilling';
import { fourWeekCashPosition } from '@/utils/cashFlowEngine';
import { loadCashFlowSettings, type CashFlowSettings } from '@/utils/cashFlowStorage';
import {
  computeTodayTasks, computeWeekLoad,
  type AttentionItem,
} from '@/utils/summaryBriefing';
import { useBrainWatch } from '@/hooks/useBrainWatch';
import { BriefingHero } from '@/components/summary/BriefingHero';
import { TodayOnSite } from '@/components/summary/TodayOnSite';
import { WeekAheadStrip } from '@/components/summary/WeekAheadStrip';
import { MoneyStrip } from '@/components/summary/MoneyStrip';
import { NeedsYou } from '@/components/summary/NeedsYou';
import { ToolsSheet } from '@/components/summary/ToolsSheet';
import StatusBarMask from '@/components/StatusBarMask';
import PendingInvitesCard from '@/components/collaborators/PendingInvitesCard';
import { useTierAccess } from '@/hooks/useTierAccess';
import { useIsDesktopWeb } from '@/components/ui/desktop';
import { canOpenSchedulePro, proFitsWindow, scheduleDestination, SCHEDULE_PRO_FEATURE } from '@/utils/scheduleRoute';
import { getSidebarRail } from '@/utils/sidebarRailStore';

// Summary tab — the "Morning Briefing". A glanceable, portfolio-wide login
// dashboard: greeting hero + today's on-site schedule + this-week load +
// money snapshot + what needs the GC's attention. Tools that used to clutter
// this screen now live behind the ••• overflow (ToolsSheet). Per-project
// detail lives on the "Your Projects" tab; drill-in happens via the widgets.

export default function SummaryScreen() {
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  // RT-R1: `sourceFailed` is the reason this screen is allowed to say "no
  // projects" or "nothing scheduled" at all. Every read behind it swallows a
  // failure and serves the local cache, so on a cold cache a dead session
  // renders as a calm, empty, all-clear briefing — the foreman plans his
  // morning off a day that actually has open tasks (audit 2026-09-07 #1).
  const { projects, isLoading, sourceFailed, retryRemoteReads } = useCoreData();
  const { invoices, commitments, changeOrders } = useFinancialsData();
  const { user } = useAuth();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { isDesktop, width } = useResponsiveLayout();
  const isDesktopWeb = useIsDesktopWeb();
  const { canAccess } = useTierAccess();
  const [toolsOpen, setToolsOpen] = useState(false);

  const active = useMemo(
    () => projects.filter(p => p.status !== 'closed' && p.status !== 'completed'),
    [projects],
  );

  // "Today on site" and "This week" run the SAME rule, from the SAME module
  // (utils/summaryBriefing, which resolves the anchor through
  // utils/scheduleOps.resolveScheduleAnchor). This used to be a private inline
  // copy here — kept inline "so membership matches Home EXACTLY" — while THIS
  // WEEK below ran a raw-calendar-day rule and BOTH anchored an undated
  // schedule at project.createdAt. On 2026-09-06 that reported an empty day and
  // an empty week for The Henderson Residence (20 open tasks) and Watermark 9F
  // (15), with "schedule at risk" two cards below (runtime audit MISS-01).
  // An undated schedule is now absent from both AND named in `week.undated`,
  // so a zero here means "no work", never "we could not tell".
  const today = useMemo(() => computeTodayTasks(active), [active]);
  const week = useMemo(() => computeWeekLoad(active), [active]);
  // THE canonical needs-attention set (useBrainWatch) — the same items +
  // count the home Brain Watch card and the tab badge show, mapped to this
  // screen's row shape. Summary used to run its own 3-rule aggregate
  // (aggregateAttention), so it said "1" while home said "11" (sim-audit
  // #15). The old rollups (high-priority punch, pending COs) are now part
  // of the canonical set itself.
  const { items: watchItems } = useBrainWatch();
  // Same sentence the home Brain Watch card and the desktop rail use, so an
  // unreachable backend reads as one recognisable state across the app.
  const unreachableLine =
    `Couldn't reach MAGE — showing what's on this ${Platform.OS === 'web' ? 'device' : 'phone'}`;
  const attention = useMemo<AttentionItem[]>(
    () => watchItems.map((it) => ({
      id: it.id,
      severity: it.severity === 'medium' ? 'amber' : 'danger',
      label: it.message,
      actionLabel: 'View',
      route: it.route.pathname,
      params: it.route.params,
    })),
    [watchItems],
  );
  const jobCount = useMemo(() => new Set(today.map(t => t.projectId)).size, [today]);

  // MONEY (C2, wave 6c). 'Budget' summed the estimate of every open job —
  // drafts and unsold bids included — and the hero's 'N active' counted them
  // too. Now: CONTRACT = what the jobs actually running are worth (estimate +
  // approved change orders, per job — getContractValue does not filter change
  // orders by project, so each job is handed only its own), and the unsold
  // estimates are named separately as pipeline.
  const inProgress = useMemo(() => projects.filter(p => p.status === 'in_progress'), [projects]);
  const contractInProgress = useMemo(
    () => inProgress.reduce(
      (sum, p) => sum + getContractValue(p, changeOrders.filter(co => co.projectId === p.id)),
      0,
    ),
    [inProgress, changeOrders],
  );
  const pipeline = useMemo(
    () => projects
      .filter(p => p.status === 'draft' || p.status === 'estimated')
      .reduce((sum, p) => sum + effectiveEstimateTotal(p), 0),
    [projects],
  );
  const outstanding = useMemo(
    () => invoices
      // Exclude drafts — an unsent draft invoice isn't owed yet, so it must
      // not inflate Outstanding (mirrors how SmartInbox already excludes drafts).
      .filter(i => i.status !== 'paid' && i.status !== 'draft')
      .reduce((s, i) => s + invoiceOutstanding(i) /* MONEY-F5: net of held retention */, 0),
    [invoices],
  );

  // Cash · 4wk — projected running balance at the end of week 4 of the forecast.
  // null when the user hasn't set up cash flow yet (renders as "—").
  //
  // SAME FORECAST AS /cash-flow (audit round 2, #17). This tile used to forecast
  // on its own: the device cache only (no user id, so '—' on the web and on a
  // second phone even with a server row), the stored balance without the
  // payments recorded since, no invoices, no signed subcontracts or POs, no
  // COs — and it only re-ran when `projects` changed. $40k in the bank, $6k a
  // week of overhead and a $52k framing draw read +$16k in green here and
  // −$36k on the screen the tile opens. fourWeekCashPosition goes through the
  // one buildForecastInputs both screens share.
  const [cashSettings, setCashSettings] = useState<CashFlowSettings | null>(null);
  const userId = user?.id;
  const loadCash = useCallback(() => {
    let cancelled = false;
    loadCashFlowSettings(userId)
      .then(settings => { if (!cancelled) setCashSettings(settings); })
      .catch(err => {
        console.log('[Summary] cash forecast load failed:', err);
        if (!cancelled) setCashSettings(null);
      });
    return () => { cancelled = true; };
  }, [userId]);
  // Re-read on focus: the balance and the bill list are edited on /cash-flow,
  // and this tab stays mounted underneath it.
  useFocusEffect(loadCash);
  const cash4wk = useMemo(() => {
    try {
      return fourWeekCashPosition({
        cashData: cashSettings?.data ?? null,
        setupComplete: cashSettings?.setupComplete ?? false,
        invoices, commitments, projects, changeOrders,
      });
    } catch (err) {
      console.log('[Summary] cash forecast failed:', err);
      return null;
    }
  }, [cashSettings, invoices, commitments, projects, changeOrders]);
  // How stale the starting balance is — the whole forecast hangs off it.
  const cashAsOf = cash4wk === null ? null : cashSettings?.data.balanceAsOf ?? null;

  const greetingName = useMemo(() => {
    const raw = (user?.name ?? '').trim().split(/\s+/)[0] ?? '';
    if (!raw) return '';
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }, [user]);

  const openProject = useCallback((projectId: string) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({ pathname: '/project-detail', params: { id: projectId } } as any);
  }, [router]);

  // "Set start date" — the fix for an undated schedule lives on the schedule
  // screen (its banner opens the picker). `focus` is the nonce
  // MobileScheduleScreen uses to tell a fresh navigation from sticky tab
  // params, so arriving here always selects the project the row names.
  const openSchedule = useCallback((projectId: string) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: '/(tabs)/schedule',
      params: { projectId, focus: String(Date.now()) },
    } as any);
  }, [router]);

  // Desktop web (wave 6c): a task row opens THAT task — in Schedule Pro when
  // Pro's own gate opens the job (own tier or the collaborator grant) and its
  // grid fits the window, otherwise on the classic tab with its detail sheet
  // open (both read taskId). Anywhere else it is the job page, as it always was.
  const proRoute = useCallback((projectId: string) => ({
    canPro: canOpenSchedulePro(canAccess(SCHEDULE_PRO_FEATURE), projects.find(p => p.id === projectId)?.myRole),
    proFits: proFitsWindow(width, isDesktopWeb, getSidebarRail().pref),
  }), [canAccess, projects, width, isDesktopWeb]);
  const openTodayTask = useCallback((projectId: string, taskId: string) => {
    if (!isDesktopWeb) { openProject(projectId); return; }
    router.push(scheduleDestination({
      projectId, webDesktop: true, ...proRoute(projectId), taskId, focus: String(Date.now()),
    }));
  }, [isDesktopWeb, openProject, router, proRoute]);
  // A grouped job card's '+K more': that job's schedule (the same split).
  const openJobSchedule = useCallback((projectId: string) => {
    router.push(scheduleDestination({
      projectId, webDesktop: isDesktopWeb, ...proRoute(projectId), focus: String(Date.now()),
    }));
  }, [isDesktopWeb, router, proRoute]);

  const onAttention = useCallback((item: AttentionItem) => {
    if (!item.route) return; // guard: never push an empty route into a dead-end
    if (item.params) router.push({ pathname: item.route, params: item.params } as any);
    else router.push(item.route as any);
  }, [router]);

  const onTool = useCallback((route: string) => {
    setToolsOpen(false);
    router.push(route as any);
  }, [router]);

  // A skeleton that was on screen hands over with a short fade, not a cut
  // (slick round 3). null at rest, so a first render is unchanged.
  const landing = useLanding(isLoading);

  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: themeColors.bg, paddingTop: insets.top + 12 }]}>
        <Skeleton width={140} height={14} radius={6} style={{ marginHorizontal: 20, marginBottom: 8 }} />
        <Skeleton width={220} height={30} radius={8} style={{ marginHorizontal: 20, marginBottom: 18 }} />
        <SkeletonCard style={{ marginHorizontal: 16, marginBottom: 12 }} />
        <SkeletonCard style={{ marginHorizontal: 16, marginBottom: 12 }} />
        <SkeletonCard style={{ marginHorizontal: 16, marginBottom: 12 }} />
        <SkeletonCard style={{ marginHorizontal: 16 }} />
      </View>
    );
  }

  // An empty book with a failed read is NOT an empty book. Day-one onboarding
  // copy here told a GC who reinstalled — or signed in on a second device with
  // a cold cache — that his entire book of work was gone, and handed him no way
  // to try again. Say what actually happened instead.
  if (projects.length === 0 && sourceFailed) {
    return (
      <LandingSlot style={landing.fade} fill>
      <View style={[styles.container, { backgroundColor: themeColors.bg, paddingTop: insets.top + 24 }]}>
        <Text style={styles.heading}>Summary</Text>
        <EmptyState
          icon={<CloudOff size={36} color={themeColors.warningLabel} strokeWidth={1.75} />}
          accent={themeColors.warningLabel}
          title="Couldn't reach MAGE"
          message="Your briefing needs a live read of your projects, and the last one didn't come back. Nothing here is missing — this device just has nothing cached to show yet."
          steps={[
            'Check that you have signal or Wi-Fi.',
            'Tap Try again below.',
            "If it keeps failing, sign out and back in — the session may have expired.",
          ]}
          actionLabel="Try again"
          onAction={retryRemoteReads}
        />
      </View>
      </LandingSlot>
    );
  }

  if (projects.length === 0) {
    return (
      <LandingSlot style={landing.fade} fill>
      <View style={[styles.container, { backgroundColor: themeColors.bg, paddingTop: insets.top + 24 }]}>
        <Text style={styles.heading}>Summary</Text>
        {/* Invites waiting for this email. login's no-invite fallback lands
            HERE, and a first-time foreman has no projects of his own — the
            exact state where a lost invite link strands him (audit round 2
            #29). Home mounts the same card. Renders nothing when none wait. */}
        <View style={{ marginHorizontal: 16, marginTop: 16 }}>
          <PendingInvitesCard />
        </View>
        <EmptyState
          icon={<FolderOpen size={36} color={themeColors.accent} strokeWidth={1.75} />}
          title="No projects yet"
          message="Your daily briefing rolls up today's schedule, this week, money, and what needs you — across every project. To populate it:"
          steps={[
            'Open the Projects tab from the sidebar.',
            'Tap + New Project (or Try a sample project) to spin one up.',
            'Come back here once you have estimates, invoices, or a schedule flowing.',
          ]}
          actionLabel="Open Projects"
          onAction={() => router.push('/(tabs)/(home)' as any)}
        />
      </View>
      </LandingSlot>
    );
  }

  // Cached projects, failing reads. The briefing below is composed from
  // whatever this device last stored — "Nothing scheduled on site today" is
  // then a statement about the cache, not about the day, so it gets said above
  // the hero rather than left implied.
  const unreachableRow = sourceFailed && (
    <TouchableOpacity
      style={styles.unreachableRow}
      activeOpacity={0.75}
      onPress={retryRemoteReads}
      accessibilityRole="button"
      accessibilityLabel={`${unreachableLine}. Tap to try again.`}
      testID="summary-unreachable"
    >
      <CloudOff size={14} color={themeColors.warningLabel} strokeWidth={2} />
      <Text style={styles.unreachableText}>{unreachableLine}</Text>
      <Text style={styles.unreachableRetry}>Try again</Text>
    </TouchableOpacity>
  );
  // An undated schedule has real day numbers and no calendar position, so it
  // cannot appear in TODAY or THIS WEEK. Saying that plainly is the whole
  // point: without this row, "Nothing scheduled on site today" reads as "no
  // work" on a job with 20 open tasks (runtime audit MISS-01). One tap goes to
  // the schedule, whose banner opens the start-date picker.
  const undatedCard = (extra?: StyleProp<ViewStyle>) => week.undated.length > 0 && (
    <View style={[styles.undatedCard, extra]} testID="summary-undated-schedules">
      <View style={styles.undatedHead}>
        <CalendarOff size={15} color={themeColors.warningLabel} strokeWidth={1.9} />
        <Text style={styles.undatedTitle}>
          {week.undated.length === 1
            ? '1 schedule has no start date'
            : `${week.undated.length} schedules have no start date`}
        </Text>
      </View>
      <Text style={styles.undatedBody}>
        Their tasks have day numbers but no calendar days, so they are not counted above. Set a start date to place them.
      </Text>
      {week.undated.map((u) => (
        <TouchableOpacity
          key={u.projectId}
          style={styles.undatedRow}
          activeOpacity={0.75}
          onPress={() => openSchedule(u.projectId)}
          accessibilityRole="button"
          accessibilityLabel={`Set a start date for ${u.projectName}`}
        >
          <Text style={styles.undatedName} numberOfLines={1}>{u.projectName}</Text>
          <Text style={styles.undatedCount}>{u.openTasks} open</Text>
          <ChevronRight size={14} color={themeColors.textSecondary} />
        </TouchableOpacity>
      ))}
    </View>
  );
  // Your Business strip — one row max (plan spec B6).
  const businessStrip = (extra?: StyleProp<ViewStyle>) => (
    <TouchableOpacity
      style={[styles.businessStrip, extra]}
      onPress={() => router.push('/business')}
      activeOpacity={0.75}
    >
      <Briefcase size={16} color={themeColors.accent} />
      <Text style={styles.businessStripText}>Your Business</Text>
      <Text style={styles.businessStripSub}>margins · pipeline · clients · weather</Text>
      <ChevronRight size={14} color={themeColors.textSecondary} />
    </TouchableOpacity>
  );

  // DESKTOP (wave 6c): two columns. At 1512 the single column put 32 task rows
  // above MONEY and NEEDS YOU, both off the 945 px screen. Left: TODAY ON SITE
  // grouped by job. Right, 340–440: what needs him, money, the week, the
  // undated schedules, the business link. No ••• Tools: the sidebar carries
  // them. The phone keeps today's single column in today's order, below.
  if (isDesktop) {
    return (
      <LandingSlot style={landing.fade} fill>
      <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
        <ScrollView
          {...fabScroll}
          contentContainerStyle={[
            { paddingTop: insets.top + 16, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE },
            styles.contentDesktop,
          ]}
          showsVerticalScrollIndicator={false}
        >
          {unreachableRow}
          <View style={{ marginHorizontal: 16 }}>
            <PendingInvitesCard />
          </View>
          <BriefingHero
            greetingName={greetingName}
            attentionCount={attention.length}
            activeCount={inProgress.length}
          />
          <View style={styles.columnsDesktop} testID="summary-columns">
            <View style={styles.leftColumnDesktop} testID="summary-left-column">
              <TodayOnSite
                tasks={today}
                jobCount={jobCount}
                onPressTask={openTodayTask}
                onPressJob={openJobSchedule}
                grouped
                style={styles.cardFlushDesktop}
              />
            </View>
            <View style={styles.rightColumnDesktop} testID="summary-right-column">
              <NeedsYou
                items={attention}
                onPressItem={onAttention}
                max={6}
                // /attention is lane F's route (app/(tabs)/(home)/attention.tsx).
                onSeeAll={() => router.push('/attention')}
                style={styles.cardFlushDesktop}
              />
              <MoneyStrip
                contractInProgress={contractInProgress}
                pipeline={pipeline}
                outstanding={outstanding}
                cash4wk={cash4wk}
                cashAsOf={cashAsOf}
                onPressOutstanding={() => router.push({ pathname: '/reports', params: { tab: 'aging' } })}
                onPressCash={() => router.push('/cash-flow')}
                style={styles.cardFlushDesktop}
              />
              <WeekAheadStrip week={week} style={styles.cardFlushDesktop} />
              {undatedCard(styles.cardFlushDesktop)}
              {businessStrip(styles.cardFlushDesktop)}
            </View>
          </View>
        </ScrollView>
        <StatusBarMask />
      </View>
      </LandingSlot>
    );
  }

  return (
    <LandingSlot style={landing.fade} fill>
    <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
      <ScrollView
        {...fabScroll}
        contentContainerStyle={[
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE },
          isDesktop && styles.contentDesktop,
        ]}
        showsVerticalScrollIndicator={false}
      >
        {unreachableRow}
        {/* Same card on a populated Summary: a GC invited onto another
            contractor's job still lands here after sign-in. */}
        <View style={{ marginHorizontal: 16 }}>
          <PendingInvitesCard />
        </View>
        <BriefingHero
          greetingName={greetingName}
          attentionCount={attention.length}
          activeCount={inProgress.length}
          onOpenTools={() => setToolsOpen(true)}
        />
        <TodayOnSite tasks={today} jobCount={jobCount} onPressTask={openProject} />
        <WeekAheadStrip week={week} />
        {undatedCard()}
        <MoneyStrip
          contractInProgress={contractInProgress}
          pipeline={pipeline}
          outstanding={outstanding}
          cash4wk={cash4wk}
          cashAsOf={cashAsOf}
          // "Who owes me" lands on the A/R Aging list itself, not the default
          // (Profit) tab — reports.tsx honours ?tab=aging.
          onPressOutstanding={() => router.push({ pathname: '/reports', params: { tab: 'aging' } } as never)}
          onPressCash={() => router.push('/cash-flow' as any)}
        />
        <NeedsYou items={attention} onPressItem={onAttention} />
        {businessStrip()}
      </ScrollView>

      {/* Safe-area padding lives in the scroll CONTENT above, so scrolled
          text slid under the clock — same fix as home (sim-audit #7). */}
      <StatusBarMask />

      <ToolsSheet visible={toolsOpen} onClose={() => setToolsOpen(false)} onNavigate={onTool} />
    </View>
    </LandingSlot>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  // ── Desktop (wave 6c) — the (tabs) frame already caps the page at
  // Layout.page.dashboard; the literal 1400 cap here is gone.
  contentDesktop: { paddingHorizontal: Layout.gutter },
  columnsDesktop: { flexDirection: 'row' as const, gap: Layout.groupGap, alignItems: 'flex-start' as const },
  leftColumnDesktop: { flex: 2, minWidth: 0 },
  rightColumnDesktop: { flexGrow: 1, flexShrink: 0, flexBasis: 'auto' as const, minWidth: 340, maxWidth: 440 },
  // Cards inside the columns sit flush with the column edges.
  cardFlushDesktop: { marginHorizontal: 0 },
  heading: { fontSize: Type.largeTitle.fontSize, fontWeight: '700' as const, color: t.text, paddingHorizontal: 20, letterSpacing: -0.5 },
  // Your Business entry strip — one compact row at the bottom of Summary
  businessStrip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: t.surface,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    borderRadius: Tokens.radius.md,
    paddingVertical: Tokens.spacing.sm,
    paddingHorizontal: Tokens.spacing.sm,
    gap: Tokens.spacing.xs,
  },
  businessStripText: {
    ...Type.bodyCompactEmphasized,
    color: t.text,
  },
  businessStripSub: {
    ...Type.caption1,
    color: t.textSecondary,
    flex: 1,
  },
  // RT-R1 disclosure. Same warning tint as the undated-schedule card below:
  // nothing is broken, the app just cannot vouch for what it is showing.
  unreachableRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: Tokens.radius.md,
    backgroundColor: t.warningSoft,
  },
  unreachableText: { ...Type.caption1, color: t.warningLabel, flex: 1 },
  unreachableRetry: { ...Type.caption1, color: t.warningLabel, fontWeight: '700' as const, textDecorationLine: 'underline' as const },
  // Undated-schedule disclosure. Warning-tinted, not danger: nothing is
  // broken, a field is missing and the user can fill it in one tap.
  undatedCard: {
    backgroundColor: t.warningSoft,
    borderWidth: 1,
    borderColor: t.warningSoft,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: Tokens.radius.md,
    paddingVertical: Tokens.spacing.sm,
    paddingHorizontal: Tokens.spacing.sm,
  },
  undatedHead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  undatedTitle: { ...Type.bodyCompactEmphasized, color: t.warningLabel, flex: 1 },
  undatedBody: { ...Type.caption1, color: t.textSecondary, marginTop: 4 },
  undatedRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: Tokens.radius.sm,
    backgroundColor: t.surface,
  },
  undatedName: { ...Type.bodyCompactEmphasized, color: t.text, flex: 1 },
  undatedCount: { ...Type.caption1, color: t.textSecondary },
});
