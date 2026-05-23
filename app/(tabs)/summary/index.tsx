import React, { useMemo, useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { FolderOpen } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { useCoreData, useFinancialsData, useFieldData } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import { Skeleton, SkeletonCard } from '@/components/Skeleton';
import EmptyState from '@/components/EmptyState';
import { effectiveEstimateTotal } from '@/utils/estimateCommit';
import { generateForecast } from '@/utils/cashFlowEngine';
import { loadCashFlowData, isSetupComplete } from '@/utils/cashFlowStorage';
import {
  computeTodayTasks, computeWeekLoad, aggregateAttention, type AttentionItem,
} from '@/utils/summaryBriefing';
import { BriefingHero } from '@/components/summary/BriefingHero';
import { TodayOnSite } from '@/components/summary/TodayOnSite';
import { WeekAheadStrip } from '@/components/summary/WeekAheadStrip';
import { MoneyStrip } from '@/components/summary/MoneyStrip';
import { NeedsYou } from '@/components/summary/NeedsYou';
import { ToolsSheet } from '@/components/summary/ToolsSheet';

// Summary tab — the "Morning Briefing". A glanceable, portfolio-wide login
// dashboard: greeting hero + today's on-site schedule + this-week load +
// money snapshot + what needs the GC's attention. Tools that used to clutter
// this screen now live behind the ••• overflow (ToolsSheet). Per-project
// detail lives on the "Your Projects" tab; drill-in happens via the widgets.

export default function SummaryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projects, isLoading } = useCoreData();
  const { invoices, changeOrders } = useFinancialsData();
  const { punchItems } = useFieldData();
  const { user } = useAuth();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [toolsOpen, setToolsOpen] = useState(false);

  const active = useMemo(
    () => projects.filter(p => p.status !== 'closed' && p.status !== 'completed'),
    [projects],
  );

  const today = useMemo(() => computeTodayTasks(active), [active]);
  const week = useMemo(() => computeWeekLoad(active), [active]);
  const attention = useMemo(
    () => aggregateAttention(active, invoices, punchItems, changeOrders),
    [active, invoices, punchItems, changeOrders],
  );
  const jobCount = useMemo(() => new Set(today.map(t => t.projectId)).size, [today]);

  const budget = useMemo(
    () => active.reduce((sum, p) => sum + effectiveEstimateTotal(p), 0),
    [active],
  );
  const outstanding = useMemo(
    () => invoices
      .filter(i => i.status !== 'paid')
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
          icon={<FolderOpen size={36} color={themeColors.accent} />}
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
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }}
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
      </ScrollView>

      <ToolsSheet visible={toolsOpen} onClose={() => setToolsOpen(false)} onNavigate={onTool} />
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  heading: { fontSize: Type.largeTitle.fontSize, fontWeight: '700' as const, color: t.text, paddingHorizontal: 20, letterSpacing: -0.5 },
});
