import React, { useMemo, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Platform, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { useLocalSearchParams, Stack, useRouter } from 'expo-router';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import * as Haptics from 'expo-haptics';
import {
  TrendingUp, TrendingDown, DollarSign, Clock, Target, BarChart3,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import EmptyState from '@/components/EmptyState';
import { ToolProjectPicker } from '@/components/ToolScreenChrome';
import { FeatureHeader } from '@/components/FeatureHeader';
import Svg, { Path, Line } from 'react-native-svg';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { useProjects } from '@/contexts/ProjectContext';
import { legacyEvmMetrics, buildCashFlow } from '@/utils/scheduleEarnedValue';
import { mageAI } from '@/utils/mageAI';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';

const CHART_HEIGHT = 200;
const CHART_PADDING = 40;
// Horizontal chrome subtracted from the window width to get the chart's drawable
// width: 16pt scroll padding + 16pt chart-card padding on each side = 64pt total.
const CHART_HORIZONTAL_INSET = 64;
// Cap the chart width on desktop so the S-curve doesn't stretch absurdly wide.
const CHART_MAX_WIDTH = 720;

function formatCurrency(n: number): string {
  if (Math.abs(n) >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M';
  if (Math.abs(n) >= 1000) return '$' + (n / 1000).toFixed(1) + 'K';
  return '$' + n.toFixed(0);
}

function getMetricColor(value: number, t: ThemeColors): string {
  if (value >= 1.0) return t.success;
  if (value >= 0.9) return t.accent;
  return t.danger;
}

export default function BudgetDashboardScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('full_budget_dashboard')) {
    return (
      <Paywall
        visible={true}
        feature="Full Budget Dashboard (EVM)"
        requiredTier="business"
        onClose={() => router.back()}
      />
    );
  }
  return <BudgetDashboardScreenInner />;
}

function BudgetDashboardScreenInner() {
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  // Reactive chart width, derived from the chart card's MEASURED width — not
  // the window. This screen renders inside the 240px desktop sidebar shell
  // (it is not in DESKTOP_SHELL_EXEMPT), so window-based math overflows the
  // content pane in the 900–1023px window band: min(window−64, 720) yields
  // 720 while the pane is only window−240−padding ≈ 596–720px. onLayout
  // measures the real container (shell, page padding, resize, rotation all
  // included); the window-based value is only the pre-first-layout fallback.
  const { width: windowWidth } = useWindowDimensions();
  const [measuredCardWidth, setMeasuredCardWidth] = useState<number | null>(null);
  const onChartCardLayout = useCallback((e: { nativeEvent: { layout: { width: number } } }) => {
    const w = e.nativeEvent.layout.width;
    setMeasuredCardWidth(prev => (prev === w ? prev : w));
  }, []);
  // Measured card width includes the card's own 16pt padding per side.
  const chartWidth = Math.min(
    measuredCardWidth !== null ? measuredCardWidth - 32 : windowWidth - CHART_HORIZONTAL_INSET,
    CHART_MAX_WIDTH,
  );
  const router = useRouter();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { isDesktop } = useResponsiveLayout();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { projects, getProject, invoices, getChangeOrdersForProject } = useProjects();

  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);
  const projectInvoices = useMemo(() => invoices.filter(inv => inv.projectId === (projectId ?? '')), [invoices, projectId]);
  // AUD-007: surface revised contract value. Sum approved COs against the
  // original BAC so the user sees Original / Approved CO total / Revised.
  const projectChangeOrders = useMemo(
    () => (projectId ? getChangeOrdersForProject(projectId) : []),
    [projectId, getChangeOrdersForProject],
  );
  const approvedCOTotal = useMemo(
    () => projectChangeOrders.filter(co => co.status === 'approved').reduce((s, co) => s + (co.changeAmount ?? 0), 0),
    [projectChangeOrders],
  );

  const metrics = useMemo(() => {
    if (!project) return null;
    return legacyEvmMetrics(project, projectInvoices, project.schedule);
  }, [project, projectInvoices]);

  const cashFlowData = useMemo(() => {
    if (!project) return [];
    return buildCashFlow(project, projectInvoices, project.schedule, 10);
  }, [project, projectInvoices]);

  const [forecast, setForecast] = useState('');
  const [forecastLoading, setForecastLoading] = useState(false);

  const handleGenerateForecast = useCallback(async () => {
    if (!project || !metrics) return;
    setForecastLoading(true);
    try {
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const prompt = `You are a construction project financial analyst. Analyze these Earned Value Management metrics for a ${project.type} project named "${project.name}" with a budget of ${formatCurrency(metrics.budgetAtCompletion)}:

CPI: ${metrics.costPerformanceIndex}
SPI: ${metrics.schedulePerformanceIndex}
Cost Variance: ${formatCurrency(metrics.costVariance)}
Schedule Variance: ${formatCurrency(metrics.scheduleVariance)}
Estimate at Completion: ${formatCurrency(metrics.estimateAtCompletion)}
Percent Complete: ${metrics.percentComplete}%
Actual Cost: ${formatCurrency(metrics.actualCost)}

Write a 3-paragraph project financial health summary covering:
1. Current status assessment
2. Root cause analysis of any variance
3. Recommended corrective actions

Be specific and actionable. Use construction industry terminology.`;

      const aiResult = await mageAI({ prompt, tier: 'fast', feature: 'fullBudgetDashboard' });
      if (!aiResult.success) {
        showAlert('AI Unavailable', aiResult.error || 'Try again.');
        return;
      }
      setForecast(aiResult.data ?? aiResult.raw ?? '');
      console.log('[EVM] AI forecast generated');
    } catch (err) {
      console.log('[EVM] Forecast generation failed:', err);
      showAlert('Error', 'Could not generate forecast. Please try again.');
    } finally {
      setForecastLoading(false);
    }
  }, [project, metrics]);

  const chartPath = useMemo(() => {
    if (cashFlowData.length === 0) return { planned: '', actual: '', forecast: '' };

    const maxVal = Math.max(
      ...cashFlowData.map(d => Math.max(d.plannedCumulative, d.actualCumulative, d.forecastCumulative)),
      1,
    );

    const toX = (i: number) => CHART_PADDING + (i / (cashFlowData.length - 1)) * (chartWidth - CHART_PADDING * 2);
    const toY = (v: number) => CHART_HEIGHT - CHART_PADDING - ((v / maxVal) * (CHART_HEIGHT - CHART_PADDING * 2));

    const buildPath = (key: 'plannedCumulative' | 'actualCumulative' | 'forecastCumulative') => {
      return cashFlowData.map((d, i) => {
        const x = toX(i);
        const y = toY(d[key]);
        return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
      }).join(' ');
    };

    return {
      planned: buildPath('plannedCumulative'),
      actual: buildPath('actualCumulative'),
      forecast: buildPath('forecastCumulative'),
    };
  }, [cashFlowData, chartWidth]);

  // Opened without a projectId (e.g. from the Tools launcher) → show a picker
  // instead of dead-ending on the empty state. Budget Dashboard is
  // single-project EVM, so it needs a project to chart.
  //
  // UX-AUDIT-2026-08-03 #3: this used to be a SECOND, hand-rolled picker — the
  // app shipped two answers to one question. It now renders the same
  // ToolProjectPicker as field-ticket and the seven screens the audit named,
  // so there is one picker in the app and one place to fix it. The pick still
  // goes through router.setParams here, which keeps the choice in the URL.
  if (!project) {
    return (
      <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
        <Stack.Screen options={{
          title: 'Budget Dashboard',
          headerStyle: { backgroundColor: themeColors.bg },
          headerTintColor: themeColors.accent,
          headerTitleStyle: { fontWeight: '700' as const, color: themeColors.text },
        }} />
        <ToolProjectPicker
          toolName="the Budget Dashboard"
          message="Budget Dashboard tracks earned value (CPI / SPI) for one project at a time."
          projects={projects}
          onPick={(id) => router.setParams({ projectId: id })}
          staleProjectId={projectId ? projectId : undefined}
          icon={<BarChart3 size={36} color={themeColors.accent} strokeWidth={1.6} />}
          steps={[
            'Open or create a project from the Projects tab.',
            'Build an estimate so the dashboard has a planned budget to chart against.',
            'Tap Budget Dashboard inside the project tile grid.',
          ]}
        />
      </View>
    );
  }

  if (!metrics) {
    return (
      <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
        <Stack.Screen options={{ title: 'Budget Dashboard' }} />
        {/* A project IS selected here — the picker above handles "no project".
            This is the narrower case: the job has no estimate, so there is no
            planned value to chart earned value against. Saying "no project"
            here would be the same false copy the audit called out. */}
        <EmptyState
          icon={<BarChart3 size={36} color={themeColors.accent} strokeWidth={1.6} />}
          title="Nothing to chart yet"
          message={`${project.name} has no estimate, so there's no planned budget to measure earned value (CPI / SPI) against.`}
          steps={[
            'Open the project and build or import an estimate.',
            'Log invoices and commitments as the job runs.',
            'Come back here to see CPI / SPI against that plan.',
          ]}
          actionLabel="Open project"
          onAction={() => router.push({ pathname: '/project-detail' as never, params: { id: project.id } as never })}
        />
      </View>
    );
  }

  // Plain-language caption under each acronym so a jobsite user doesn't need
  // to know EVM theory. Captions translate the number into "what it means for
  // your money," using the actual value (self-explaining pattern).
  const cpi = metrics.costPerformanceIndex;
  const spi = metrics.schedulePerformanceIndex;
  const cpiSpend = cpi > 0 ? (1 / cpi) : 0; // $ spent per $1 of work earned
  const metricCards = [
    {
      label: 'CPI',
      value: cpi.toFixed(2),
      icon: DollarSign,
      color: getMetricColor(cpi, themeColors),
      caption: cpi >= 1
        ? `On budget — spending $${cpiSpend.toFixed(2)} for every $1 of work earned`
        : `Over budget — spending $${cpiSpend.toFixed(2)} for every $1 of work earned`,
    },
    {
      label: 'SPI',
      value: spi.toFixed(2),
      icon: Clock,
      color: getMetricColor(spi, themeColors),
      caption: spi >= 1 ? 'On or ahead of schedule' : 'Behind schedule — work is landing slower than planned',
    },
    {
      label: 'Cost Variance',
      value: formatCurrency(metrics.costVariance),
      icon: metrics.costVariance >= 0 ? TrendingUp : TrendingDown,
      color: metrics.costVariance >= 0 ? themeColors.success : themeColors.danger,
      caption: metrics.costVariance >= 0 ? 'Under budget so far' : 'Over budget so far',
    },
    {
      label: 'Schedule Variance',
      value: formatCurrency(metrics.scheduleVariance),
      icon: metrics.scheduleVariance >= 0 ? TrendingUp : TrendingDown,
      color: metrics.scheduleVariance >= 0 ? themeColors.success : themeColors.danger,
      caption: metrics.scheduleVariance >= 0 ? 'Ahead of plan in dollar terms' : 'Behind plan in dollar terms',
    },
    {
      label: 'Est. at Completion',
      value: formatCurrency(metrics.estimateAtCompletion),
      icon: Target,
      color: themeColors.info,
      caption: 'What this job will really cost if the current pace holds',
    },
    {
      label: 'Variance at Comp.',
      value: formatCurrency(metrics.varianceAtCompletion),
      icon: BarChart3,
      color: metrics.varianceAtCompletion >= 0 ? themeColors.success : themeColors.danger,
      caption: metrics.varianceAtCompletion >= 0 ? 'Projected to finish under budget' : 'Projected to finish over budget',
    },
  ];

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        title: 'Budget Dashboard',
        headerStyle: { backgroundColor: themeColors.bg },
        headerTintColor: themeColors.accent,
        headerTitleStyle: { fontWeight: '700' as const, color: themeColors.text },
      }} />
      <ScrollView {...fabScroll} contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }, isDesktop && styles.contentDesktop]} showsVerticalScrollIndicator={false}>
        <FeatureHeader
          eyebrow="Earned Value"
          title="Are you making or losing money on this job?"
          subtitle="Tracks how much work you've actually earned against what you've spent and scheduled — so overruns show up early, not at closeout."
          style={styles.featureHeader}
          explainer={{
            term: 'Earned Value Management (EVM)',
            definition: 'EVM compares three numbers: what you planned to spend, what you actually spent, and the dollar value of the work you\'ve genuinely completed. CPI (cost) and SPI (schedule) boil that down to a single ratio — 1.0 means on track, below 1.0 means over budget or behind schedule.',
            whenToUse: [
              'Weekly, to catch a cost overrun while you can still fix it',
              'Before a draw or owner meeting, to explain where the money went',
              'When a job "feels" tight but you can\'t point to why',
            ],
          }}
        />
        <View style={styles.projectHeader}>
          <Text style={styles.projectName}>{project.name}</Text>
          <Text style={styles.projectBudget}>Budget: {formatCurrency(metrics.budgetAtCompletion)}</Text>
          {approvedCOTotal !== 0 && (
            <View style={styles.revisedContractRow}>
              <Text style={styles.revisedContractLabel}>
                Approved COs <Text style={[styles.revisedContractAccent, { color: approvedCOTotal > 0 ? themeColors.accent : themeColors.success }]}>{approvedCOTotal > 0 ? '+' : ''}{formatCurrency(approvedCOTotal)}</Text>
              </Text>
              <Text style={styles.revisedContractValue}>
                Revised <Text style={{ fontWeight: '800', color: themeColors.text }}>{formatCurrency(metrics.budgetAtCompletion + approvedCOTotal)}</Text>
              </Text>
            </View>
          )}
          <View style={styles.progressBarContainer}>
            <View style={[styles.progressBar, { width: `${Math.min(metrics.percentComplete, 100)}%` as any, backgroundColor: getMetricColor(metrics.costPerformanceIndex, themeColors) }]} />
          </View>
          <Text style={styles.progressText}>{metrics.percentComplete.toFixed(1)}% Complete</Text>
        </View>

        <Text style={styles.sectionTitle}>EVM Metrics</Text>
        <View style={styles.metricsGrid}>
          {metricCards.map((card) => (
            <View key={card.label} style={[styles.metricCard, isDesktop && styles.metricCardDesktop, { borderLeftColor: card.color }]}>
              <View style={styles.metricHeader}>
                <card.icon size={16} color={card.color} />
                <Text style={styles.metricLabel}>{card.label}</Text>
              </View>
              <Text style={[styles.metricValue, { color: card.color }]}>{card.value}</Text>
              <Text style={styles.metricCaption}>{card.caption}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Cash Flow S-Curve</Text>
        <View style={styles.chartCard} onLayout={onChartCardLayout}>
          <Svg width={chartWidth} height={CHART_HEIGHT}>
            <Line x1={CHART_PADDING} y1={CHART_HEIGHT - CHART_PADDING} x2={chartWidth - CHART_PADDING} y2={CHART_HEIGHT - CHART_PADDING} stroke={themeColors.line} strokeWidth={1} />
            <Line x1={CHART_PADDING} y1={CHART_PADDING} x2={CHART_PADDING} y2={CHART_HEIGHT - CHART_PADDING} stroke={themeColors.line} strokeWidth={1} />

            {chartPath.planned && <Path d={chartPath.planned} stroke={themeColors.info} strokeWidth={2.5} fill="none" />}
            {chartPath.actual && <Path d={chartPath.actual} stroke={themeColors.success} strokeWidth={2.5} fill="none" />}
            {chartPath.forecast && <Path d={chartPath.forecast} stroke={themeColors.accent} strokeWidth={2} fill="none" strokeDasharray="6,4" />}
          </Svg>
          <View style={styles.chartLegend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: themeColors.info }]} />
              <Text style={styles.legendText}>Planned</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: themeColors.success }]} />
              <Text style={styles.legendText}>Actual</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: themeColors.accent }]} />
              <Text style={styles.legendText}>Forecast</Text>
            </View>
          </View>
        </View>

        <Text style={styles.sectionTitle}>AI Forecast</Text>
        <View style={styles.forecastCard}>
          {forecast ? (
            <Text style={styles.forecastText}>{forecast}</Text>
          ) : (
            <Text style={styles.forecastPlaceholder}>
              Generate an AI-powered financial health analysis based on your project's EVM data.
            </Text>
          )}
          <TouchableOpacity
            style={styles.forecastBtn}
            onPress={handleGenerateForecast}
            activeOpacity={0.85}
            disabled={forecastLoading}
            testID="generate-forecast"
          >
            {forecastLoading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <MageAIMark size={16} color="#fff" />
                <Text style={styles.forecastBtnText}>{forecast ? 'Regenerate Forecast' : 'Generate Forecast'}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: t.bg,
  },
  // Budget dashboard — bars + cost-code rows benefit from the extra width.
  contentDesktop: { width: '100%', maxWidth: 1320, alignSelf: 'center' as const },
  center: {
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  emptyText: {
    fontSize: Type.callout.fontSize,
    color: t.textSecondary,
  },
  scrollContent: {
    padding: 16,
  },
  featureHeader: {
    paddingHorizontal: 0,
    marginBottom: 4,
  },
  // (pickerRow / pickerRowText removed — the hand-rolled project picker they
  // styled is now the shared ToolProjectPicker. UX-AUDIT-2026-08-03 #3.)
  projectHeader: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.panel,
    padding: 18,
    marginBottom: 20,
    gap: 6,
    borderWidth: 1,
    borderColor: t.line,
  },
  projectName: {
    fontSize: Type.title3.fontSize,
    fontWeight: '700' as const,
    color: t.text,
  },
  projectBudget: {
    fontSize: Type.bodyCompact.fontSize,
    color: t.textSecondary,
  },
  revisedContractRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginTop: 4,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: t.line,
  },
  revisedContractLabel: {
    fontSize: Type.footnote.fontSize,
    color: t.textSecondary,
  },
  revisedContractAccent: {
    fontWeight: '700' as const,
  },
  revisedContractValue: {
    fontSize: Type.footnote.fontSize,
    color: t.textSecondary,
  },
  progressBarContainer: {
    height: 8,
    backgroundColor: t.line,
    borderRadius: 4,
    marginTop: 8,
    overflow: 'hidden' as const,
  },
  progressBar: {
    height: 8,
    borderRadius: 4,
  },
  progressText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: t.text,
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: Type.subheadline.fontSize,
    fontWeight: '700' as const,
    color: t.text,
    marginBottom: 12,
  },
  metricsGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 10,
    marginBottom: 24,
  },
  // Desktop: pack the metric cards across the wider column rather than two
  // 600px-wide cards per row.
  metricCardDesktop: { width: 'auto' as any, flexBasis: 220, flexGrow: 1, maxWidth: 340 },
  metricCard: {
    width: '48%' as any,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: t.line,
    borderLeftWidth: 4,
    gap: 6,
  },
  metricHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
  },
  metricLabel: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '600' as const,
    color: t.textSecondary,
  },
  metricValue: {
    fontSize: Type.title2.fontSize,
    fontWeight: '800' as const,
  },
  metricCaption: {
    fontSize: Type.caption2.fontSize,
    color: t.textSecondary,
    lineHeight: 15,
    marginTop: 2,
  },
  chartCard: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.panel,
    padding: 16,
    alignItems: 'center' as const,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: t.line,
  },
  chartLegend: {
    flexDirection: 'row' as const,
    gap: 20,
    marginTop: 12,
  },
  legendItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: Type.caption1.fontSize,
    color: t.textSecondary,
    fontWeight: '500' as const,
  },
  forecastCard: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.panel,
    padding: 18,
    gap: 14,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: t.line,
  },
  forecastText: {
    fontSize: Type.bodyCompact.fontSize,
    color: t.text,
    lineHeight: 22,
  },
  forecastPlaceholder: {
    fontSize: Type.bodyCompact.fontSize,
    color: t.textMuted,
    lineHeight: 20,
    fontStyle: 'italic' as const,
  },
  forecastBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    backgroundColor: t.accent,
    borderRadius: Tokens.radius.card,
    paddingVertical: 14,
  },
  forecastBtnText: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '600' as const,
    color: '#fff',
  },
});
