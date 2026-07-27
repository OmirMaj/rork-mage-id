import React, { useMemo, useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Platform, TouchableOpacity } from 'react-native';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { FolderOpen, ChevronRight, Briefcase } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useCoreData, useFinancialsData } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import { Skeleton, SkeletonCard } from '@/components/Skeleton';
import EmptyState from '@/components/EmptyState';
import { effectiveEstimateTotal } from '@/utils/estimateCommit';
import { generateForecast } from '@/utils/cashFlowEngine';
import { loadCashFlowData, isSetupComplete } from '@/utils/cashFlowStorage';
import {
  computeWeekLoad, projectColor,
  type AttentionItem, type TodayTask,
} from '@/utils/summaryBriefing';
import { useBrainWatch } from '@/hooks/useBrainWatch';
import { BriefingHero } from '@/components/summary/BriefingHero';
import { TodayOnSite } from '@/components/summary/TodayOnSite';
import { WeekAheadStrip } from '@/components/summary/WeekAheadStrip';
import { MoneyStrip } from '@/components/summary/MoneyStrip';
import { NeedsYou } from '@/components/summary/NeedsYou';
import { ToolsSheet } from '@/components/summary/ToolsSheet';
import StatusBarMask from '@/components/StatusBarMask';

// Summary tab — the "Morning Briefing". A glanceable, portfolio-wide login
// dashboard: greeting hero + today's on-site schedule + this-week load +
// money snapshot + what needs the GC's attention. Tools that used to clutter
// this screen now live behind the ••• overflow (ToolsSheet). Per-project
// detail lives on the "Your Projects" tab; drill-in happens via the widgets.

// Canonical 1-indexed, working-day-aware "which schedule day is today" — the
// exact inverse of scheduleEngine.getTaskDateRange (start = addWorkingDays(
// startDate, startDay - 1)). Day 1 = the schedule start date; a date on/before
// start is day 1; weekends are skipped when workingDaysPerWeek < 7 so the count
// matches how task bars are laid out. Replicated verbatim in
// app/(tabs)/(home)/index.tsx so Home and Summary agree on "today on site".
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

export default function SummaryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projects, isLoading } = useCoreData();
  const { invoices } = useFinancialsData();
  const { user } = useAuth();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { isDesktop } = useResponsiveLayout();
  const [toolsOpen, setToolsOpen] = useState(false);

  const active = useMemo(
    () => projects.filter(p => p.status !== 'closed' && p.status !== 'completed'),
    [projects],
  );

  // "Today on site" — computed inline (not via summaryBriefing.computeTodayTasks)
  // so membership matches the Projects/Home tab's "TODAY ON SITE" strip EXACTLY.
  // Both use the canonical 1-indexed working-day model (todayScheduleDayNumber
  // + inclusive last day = startDay + durationDays - 1). Previously Summary used
  // a 0-indexed rounded calendar index with an off-by-one-long inclusive end,
  // so the same project/day could appear on one tab and not the other.
  const today = useMemo<TodayTask[]>(() => {
    const now = new Date();
    const out: TodayTask[] = [];
    for (const p of active) {
      const tasks = p.schedule?.tasks;
      if (!tasks || tasks.length === 0) continue;
      const baseIso = p.schedule?.startDate || p.createdAt;
      const baseMs = Date.parse(baseIso);
      if (!Number.isFinite(baseMs)) continue;
      const todayDayNumber = todayScheduleDayNumber(baseMs, now, p.schedule?.workingDaysPerWeek);
      for (const t of tasks) {
        if (t.status === 'done') continue;
        const start = Math.max(1, t.startDay ?? 1);
        const dur = Math.max(0, t.durationDays ?? 0);
        if (todayDayNumber >= start && todayDayNumber <= start + dur - 1) {
          out.push({
            projectId: p.id,
            projectName: p.name,
            projectColor: projectColor(p.id),
            taskTitle: t.title,
            isCritical: !!t.isCriticalPath,
            context: (t.crew || t.assignedSubName || '').trim(),
          });
        }
      }
    }
    return out.sort((a, b) => Number(b.isCritical) - Number(a.isCritical));
  }, [active]);
  const week = useMemo(() => computeWeekLoad(active), [active]);
  // THE canonical needs-attention set (useBrainWatch) — the same items +
  // count the home Brain Watch card and the tab badge show, mapped to this
  // screen's row shape. Summary used to run its own 3-rule aggregate
  // (aggregateAttention), so it said "1" while home said "11" (sim-audit
  // #15). The old rollups (high-priority punch, pending COs) are now part
  // of the canonical set itself.
  const { items: watchItems } = useBrainWatch();
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

  const budget = useMemo(
    () => active.reduce((sum, p) => sum + effectiveEstimateTotal(p), 0),
    [active],
  );
  const outstanding = useMemo(
    () => invoices
      // Exclude drafts — an unsent draft invoice isn't owed yet, so it must
      // not inflate Outstanding (mirrors how SmartInbox already excludes drafts).
      .filter(i => i.status !== 'paid' && i.status !== 'draft')
      .reduce((s, i) => s + Math.max(0, (i.totalDue ?? 0) - (i.amountPaid ?? 0)), 0),
    [invoices],
  );

  // Cash · 4wk — projected running balance at the end of week 4 of the forecast.
  // null when the user hasn't set up cash flow yet (renders as "—").
  const [cash4wk, setCash4wk] = useState<number | null>(null);
  useEffect(() => {
    const load = async () => {
      try {
        const done = await isSetupComplete();
        if (!done) { setCash4wk(null); return; }
        const data = await loadCashFlowData();
        if (data.startingBalance > 0 || data.expenses.length > 0) {
          const forecast = generateForecast(
            data.startingBalance, data.expenses, [], data.expectedPayments, 12, data.defaultPaymentTerms,
          );
          const wk4 = forecast[3] ?? forecast[forecast.length - 1];
          setCash4wk(wk4 ? wk4.runningBalance : null);
        } else {
          setCash4wk(null);
        }
      } catch (err) {
        console.log('[Summary] cash forecast load failed:', err);
        setCash4wk(null);
      }
    };
    void load();
  }, [projects]);

  const greetingName = useMemo(() => {
    const raw = (user?.name ?? '').trim().split(/\s+/)[0] ?? '';
    if (!raw) return '';
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }, [user]);

  const openProject = useCallback((projectId: string) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({ pathname: '/project-detail', params: { id: projectId } } as any);
  }, [router]);

  const onAttention = useCallback((item: AttentionItem) => {
    if (!item.route) return; // guard: never push an empty route into a dead-end
    if (item.params) router.push({ pathname: item.route, params: item.params } as any);
    else router.push(item.route as any);
  }, [router]);

  const onTool = useCallback((route: string) => {
    setToolsOpen(false);
    router.push(route as any);
  }, [router]);

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

  if (projects.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: themeColors.bg, paddingTop: insets.top + 24 }]}>
        <Text style={styles.heading}>Summary</Text>
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
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
      <ScrollView
        contentContainerStyle={[
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 },
          isDesktop && styles.contentDesktop,
        ]}
        showsVerticalScrollIndicator={false}
      >
        <BriefingHero
          greetingName={greetingName}
          attentionCount={attention.length}
          activeCount={active.length}
          onOpenTools={() => setToolsOpen(true)}
        />
        <TodayOnSite tasks={today} jobCount={jobCount} onPressTask={openProject} />
        <WeekAheadStrip week={week} />
        <MoneyStrip
          budget={budget}
          outstanding={outstanding}
          cash4wk={cash4wk}
          onPressOutstanding={() => router.push('/reports' as any)}
          onPressCash={() => router.push('/cash-flow' as any)}
        />
        <NeedsYou items={attention} onPressItem={onAttention} />
        {/* Your Business strip — one row max (plan spec B6) */}
        <TouchableOpacity
          style={styles.businessStrip}
          onPress={() => router.push('/business' as any)}
          activeOpacity={0.75}
        >
          <Briefcase size={16} color={themeColors.accent} />
          <Text style={styles.businessStripText}>Your Business</Text>
          <Text style={styles.businessStripSub}>margins · pipeline · clients · weather</Text>
          <ChevronRight size={14} color={themeColors.textSecondary} />
        </TouchableOpacity>
      </ScrollView>

      {/* Safe-area padding lives in the scroll CONTENT above, so scrolled
          text slid under the clock — same fix as home (sim-audit #7). */}
      <StatusBarMask />

      <ToolsSheet visible={toolsOpen} onClose={() => setToolsOpen(false)} onNavigate={onTool} />
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  contentDesktop: { width: '100%', maxWidth: 1100, alignSelf: 'center' as const },
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
});
