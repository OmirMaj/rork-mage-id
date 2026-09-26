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
  Activity, Wallet, AlertTriangle, ChevronRight,
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
import { useMaterialReceipts } from '@/hooks/useMaterialReceipts';
import { useLaborRates, useTimeEntriesMirror } from '@/hooks/useLaborRates';
import { computeJobCost } from '@/utils/jobCostEngine';
import {
  legacyEvmMetrics, buildCashFlow, describeCostBasisGap, type ActualCostEvidence,
} from '@/utils/scheduleEarnedValue';
import { mageAI } from '@/utils/mageAI';
import { Type } from '@/constants/typography';
import { Layout, Tokens } from '@/constants/designTokens';
import { TileGrid } from '@/components/ui';
import { DashboardColumns } from '@/components/desktop/DashboardColumns';
import { showAlert } from '@/utils/alert';
import { formatMoneyShort } from '@/utils/formatters';
import { NATIVE_HEADER_TITLE_FACE } from '@/constants/navigation';
import { projectTypeLabel } from '@/utils/projectTypes';

const CHART_HEIGHT = 200;
const CHART_PADDING = 40;
// Horizontal chrome subtracted from the window width to get the chart's drawable
// width: 16pt scroll padding + 16pt chart-card padding on each side = 64pt total.
const CHART_HORIZONTAL_INSET = 64;
// Cap the chart width on desktop so the S-curve doesn't stretch absurdly wide.
const CHART_MAX_WIDTH = 720;

// HEALTH-F5: compact, sign-correct money ("-$12K", not "$-12.0K") via the one
// formatter — no local copy.
const formatCurrency = (n: number): string => formatMoneyShort(n);

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
  const {
    projects, getProject, invoices, getChangeOrdersForProject,
    // MONEY-EVM-1: the cost ledger. Actual Cost on this screen used to be the
    // client's paid invoices — money IN read as money OUT — so every cost-side
    // card was measuring the wrong money (see utils/scheduleEarnedValue.ts).
    // These are the same arrays app/job-costing.tsx feeds computeJobCost.
    commitments, changeOrders, equipment, permits, subcontractors,
  } = useProjects();
  const { receipts } = useMaterialReceipts();
  const timeEntries = useTimeEntriesMirror();
  const { rates: laborRates, overtimeMultiplier, overtimeRule } = useLaborRates();

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

  // The FULL cost bundle, not the four-argument shorthand. utils/
  // financialReports.ts called computeJobCost without receipts and time
  // entries and reported a cost-to-date made of subcontracts only (the
  // 2026-09-07 audit flagged it); doing that here would swap "AC is client
  // revenue" for "AC omits every material receipt, crew hour, equipment day
  // and permit fee" — a wrong number that looks right. `subcontractors` is
  // load-bearing too: it is the only signal that joins an in-app subcontract
  // to the estimate line it bought out (JOBCOST-PHASE-1).
  const jobCost = useMemo(() => {
    if (!project) return null;
    return computeJobCost({
      project, commitments, changeOrders, receipts, timeEntries, laborRates,
      overtimeMultiplier, overtimeRule, equipment, permits, subcontractors,
    });
  }, [project, commitments, changeOrders, receipts, timeEntries, laborRates,
      overtimeMultiplier, overtimeRule, equipment, permits, subcontractors]);

  // Actual Cost WITH the records that produced it. The counts are the union of
  // JobCostLine.sources across every phase, deduped — a receipt that splits
  // over three categories names itself on three lines and is still one record.
  //
  // The counts, not the dollars, decide whether CPI / Cost Variance / EAC get
  // rendered at all. Production holds jobs with zero commitments and a handful
  // of permits, so gating on `actual > 0` alone would simply trade a wildly
  // pessimistic AC (the client's money) for a wildly optimistic one (nothing
  // recorded) and print a glowing green "Under budget" on the same broken
  // screen. An empty ledger is a missing answer, and it gets said out loud.
  const costEvidence: ActualCostEvidence | undefined = useMemo(() => {
    if (!jobCost) return undefined;
    const seen = {
      commitments: new Set<string>(), receipts: new Set<string>(),
      timeEntries: new Set<string>(), equipment: new Set<string>(),
      permits: new Set<string>(),
    };
    for (const line of jobCost.byPhase) {
      for (const id of line.sources.commitments) seen.commitments.add(id);
      for (const id of line.sources.receipts) seen.receipts.add(id);
      for (const id of line.sources.timeEntries) seen.timeEntries.add(id);
      for (const id of line.sources.equipment) seen.equipment.add(id);
      for (const id of line.sources.permits) seen.permits.add(id);
    }
    return {
      amount: jobCost.actual,
      ledgers: {
        commitments: seen.commitments.size,
        receipts: seen.receipts.size,
        timeEntries: seen.timeEntries.size,
        equipment: seen.equipment.size,
        permits: seen.permits.size,
      },
    };
  }, [jobCost]);

  const metrics = useMemo(() => {
    if (!project) return null;
    return legacyEvmMetrics(project, projectInvoices, project.schedule, costEvidence);
  }, [project, projectInvoices, costEvidence]);

  const cashFlowData = useMemo(() => {
    if (!project) return [];
    return buildCashFlow(project, projectInvoices, project.schedule, 10, costEvidence);
  }, [project, projectInvoices, costEvidence]);

  const [forecast, setForecast] = useState('');
  const [forecastLoading, setForecastLoading] = useState(false);

  const handleGenerateForecast = useCallback(async () => {
    if (!project || !metrics) return;
    setForecastLoading(true);
    try {
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      // The model gets the cost half ONLY when a real cost ledger produced it.
      // It used to be handed the client's paid invoices under the label
      // "Actual Cost" and asked for root-cause analysis of the variance, so it
      // wrote three confident paragraphs about an overrun that was a deposit
      // (MONEY-EVM-1). When there is no ledger we say so in the prompt and
      // forbid the cost assessment outright rather than leaving the model to
      // fill the silence.
      const costBlock = metrics.costBasis.grounded
        ? `Actual Cost (money paid OUT — sub/PO payments, material receipts, crew hours, equipment, permits): ${formatCurrency(metrics.actualCost ?? 0)}
CPI: ${metrics.costPerformanceIndex}
Cost Variance: ${formatCurrency(metrics.costVariance ?? 0)}
Estimate at Completion: ${formatCurrency(metrics.estimateAtCompletion ?? 0)}`
        : `Actual Cost: NOT AVAILABLE. ${describeCostBasisGap(metrics.costBasis)}
Do NOT assess cost performance, CPI, cost variance or final cost — there is no cost data for this job. Say plainly that cost tracking is not set up yet and what the contractor should record to get it.`;

      const prompt = `You are a construction project financial analyst. Analyze these Earned Value Management metrics for a ${projectTypeLabel(project) || 'construction'} project named "${project.name}" with a budget of ${formatCurrency(metrics.budgetAtCompletion)}:

SPI: ${metrics.schedulePerformanceIndex}
Schedule Variance: ${formatCurrency(metrics.scheduleVariance)}
Percent Complete: ${metrics.percentComplete}%
Earned Value (work completed, priced at the estimate): ${formatCurrency(metrics.earnedValue)}
Collected from the client to date (revenue, NOT a cost): ${formatCurrency(metrics.collectedToDate)}
${costBlock}

Write a 3-paragraph project financial health summary covering:
1. Current status assessment
2. Root cause analysis of any variance
3. Recommended corrective actions

Never treat client payments as a cost. Be specific and actionable. Use construction industry terminology.`;

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
    if (cashFlowData.length === 0) return { planned: '', collected: '', forecast: '' };

    // A forecast point is null on a job with no grounded CPI — there is
    // nothing to divide the plan by. The dashed curve is then not drawn at
    // all, rather than drawn on top of Planned and labelled "Forecast"
    // (MONEY-EVM-1).
    const hasForecast = cashFlowData.every(d => d.forecastCumulative !== null);

    const maxVal = Math.max(
      ...cashFlowData.map(d => Math.max(d.plannedCumulative, d.collectedCumulative, d.forecastCumulative ?? 0)),
      1,
    );

    const toX = (i: number) => CHART_PADDING + (i / (cashFlowData.length - 1)) * (chartWidth - CHART_PADDING * 2);
    const toY = (v: number) => CHART_HEIGHT - CHART_PADDING - ((v / maxVal) * (CHART_HEIGHT - CHART_PADDING * 2));

    const buildPath = (pick: (d: typeof cashFlowData[number]) => number) => {
      return cashFlowData.map((d, i) => {
        const x = toX(i);
        const y = toY(pick(d));
        return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
      }).join(' ');
    };

    return {
      planned: buildPath(d => d.plannedCumulative),
      collected: buildPath(d => d.collectedCumulative),
      forecast: hasForecast ? buildPath(d => d.forecastCumulative ?? 0) : '',
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
          headerTitleStyle: { ...NATIVE_HEADER_TITLE_FACE, color: themeColors.text },
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
            // Not "log invoices": a client invoice is money IN and buys you no
            // cost performance here (MONEY-EVM-1). Costs are what CPI needs.
            'Record what the job costs as it runs — sub and PO payments, material receipts, crew hours.',
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
  //
  // MONEY-EVM-1: the four COST cards (CPI, Cost Variance, Est. at Completion,
  // Variance at Comp.) are built only when a real cost ledger backs them. They
  // are not defaulted, not greyed out and not shown with a footnote — a
  // confident "Over budget so far" in red is exactly as wrong whether or not
  // there is small print under it, and this screen printed that on day one of
  // a healthy job every time a deposit cleared. The gap card below the section
  // title says which ledger is empty and links to the screen that fills it.
  // SPI, Schedule Variance, Earned Value and Collected to date need no cost
  // ledger and always render.
  const costGrounded = metrics.costBasis.grounded;
  const cpi = metrics.costPerformanceIndex;
  const spi = metrics.schedulePerformanceIndex;
  const cv = metrics.costVariance;
  const vac = metrics.varianceAtCompletion;
  const cpiSpend = cpi && cpi > 0 ? (1 / cpi) : 0; // $ spent per $1 of work earned
  // Billed-vs-earned: the comparison the collected figure exists to make.
  const billingGap = metrics.collectedToDate - metrics.earnedValue;

  type MetricCard = {
    label: string;
    value: string;
    icon: typeof DollarSign;
    color: string;
    caption: string;
  };
  const metricCards: MetricCard[] = [];

  if (costGrounded && cpi != null) {
    metricCards.push({
      label: 'CPI',
      value: cpi.toFixed(2),
      icon: DollarSign,
      color: getMetricColor(cpi, themeColors),
      caption: cpi >= 1
        ? `On budget — spending $${cpiSpend.toFixed(2)} for every $1 of work earned`
        : `Over budget — spending $${cpiSpend.toFixed(2)} for every $1 of work earned`,
    });
  }
  metricCards.push({
    label: 'SPI',
    value: spi.toFixed(2),
    icon: Clock,
    color: getMetricColor(spi, themeColors),
    caption: spi >= 1 ? 'On or ahead of schedule' : 'Behind schedule — work is landing slower than planned',
  });
  if (costGrounded && cv != null) {
    metricCards.push({
      label: 'Cost Variance',
      value: formatCurrency(cv),
      icon: cv >= 0 ? TrendingUp : TrendingDown,
      color: cv >= 0 ? themeColors.success : themeColors.danger,
      caption: cv >= 0 ? 'Under budget so far' : 'Over budget so far',
    });
  }
  metricCards.push({
    label: 'Schedule Variance',
    value: formatCurrency(metrics.scheduleVariance),
    icon: metrics.scheduleVariance >= 0 ? TrendingUp : TrendingDown,
    color: metrics.scheduleVariance >= 0 ? themeColors.success : themeColors.danger,
    caption: metrics.scheduleVariance >= 0 ? 'Ahead of plan in dollar terms' : 'Behind plan in dollar terms',
  });
  if (costGrounded && metrics.estimateAtCompletion != null) {
    metricCards.push({
      label: 'Est. at Completion',
      value: formatCurrency(metrics.estimateAtCompletion),
      icon: Target,
      color: themeColors.info,
      caption: 'What this job will really cost if the current pace holds',
    });
  }
  if (costGrounded && vac != null) {
    metricCards.push({
      label: 'Variance at Comp.',
      value: formatCurrency(vac),
      icon: BarChart3,
      color: vac >= 0 ? themeColors.success : themeColors.danger,
      caption: vac >= 0 ? 'Projected to finish under budget' : 'Projected to finish over budget',
    });
  }
  metricCards.push({
    label: 'Earned Value',
    value: formatCurrency(metrics.earnedValue),
    icon: Activity,
    color: themeColors.info,
    caption: `The work you've completed, priced at your estimate — ${metrics.percentComplete.toFixed(0)}% of the budget`,
  });
  metricCards.push({
    label: 'Collected to date',
    value: formatCurrency(metrics.collectedToDate),
    icon: Wallet,
    color: themeColors.accent,
    caption: billingGap >= 0
      ? `Client payments in — ${formatCurrency(billingGap)} ahead of the work you've earned`
      : `Client payments in — ${formatCurrency(Math.abs(billingGap))} behind the work you've earned`,
  });

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        title: 'Budget Dashboard',
        headerStyle: { backgroundColor: themeColors.bg },
        headerTintColor: themeColors.accent,
        headerTitleStyle: { ...NATIVE_HEADER_TITLE_FACE, color: themeColors.text },
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
        {/* Desktop web: the EVM story in the main column, the AI forecast in
            the 360 rail beside it. The rail is today's contiguous tail, so on
            a phone DashboardColumns renders main + rail in today's order. */}
        <DashboardColumns
          main={<>
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
            {/* The bar took its colour from CPI, which is absent on a job with
                no cost ledger — a neutral accent bar beats a green one that
                claims a cost verdict nobody computed. */}
            <View style={[styles.progressBar, { width: `${Math.min(metrics.percentComplete, 100)}%` as any, backgroundColor: costGrounded && cpi != null ? getMetricColor(cpi, themeColors) : themeColors.accent }]} />
          </View>
          <Text style={styles.progressText}>{metrics.percentComplete.toFixed(1)}% Complete</Text>
        </View>

        <Text style={styles.sectionTitle}>EVM Metrics</Text>
        {!costGrounded && (
          <View style={styles.costGapCard} testID="cost-basis-gap">
            <View style={styles.costGapHeader}>
              <AlertTriangle size={16} color={themeColors.warningLabel} />
              <Text style={styles.costGapTitle}>Cost performance is hidden on this job</Text>
            </View>
            <Text style={styles.costGapBody}>{describeCostBasisGap(metrics.costBasis)}</Text>
            <TouchableOpacity
              style={styles.costGapBtn}
              onPress={() => router.push({ pathname: '/job-costing' as never, params: { projectId: project.id } as never })}
              activeOpacity={0.85}
              testID="cost-basis-gap-action"
            >
              <Text style={styles.costGapBtnText}>Record costs in Job Costing</Text>
              <ChevronRight size={16} color={themeColors.accentLabel} />
            </TouchableOpacity>
          </View>
        )}
        <TileGrid preset="kpi" phoneStyle={styles.metricsGrid}>
          {metricCards.map((card) => (
            <View key={card.label} style={[styles.metricCard, { borderLeftColor: card.color }]}>
              <View style={styles.metricHeader}>
                <card.icon size={16} color={card.color} />
                <Text style={styles.metricLabel}>{card.label}</Text>
              </View>
              <Text style={[styles.metricValue, { color: card.color }]}>{card.value}</Text>
              <Text style={styles.metricCaption}>{card.caption}</Text>
            </View>
          ))}
        </TileGrid>

        <Text style={styles.sectionTitle}>Cash Flow S-Curve</Text>
        <View style={styles.chartCard} onLayout={onChartCardLayout}>
          <Svg width={chartWidth} height={CHART_HEIGHT}>
            <Line x1={CHART_PADDING} y1={CHART_HEIGHT - CHART_PADDING} x2={chartWidth - CHART_PADDING} y2={CHART_HEIGHT - CHART_PADDING} stroke={themeColors.line} strokeWidth={1} />
            <Line x1={CHART_PADDING} y1={CHART_PADDING} x2={CHART_PADDING} y2={CHART_HEIGHT - CHART_PADDING} stroke={themeColors.line} strokeWidth={1} />

            {chartPath.planned && <Path d={chartPath.planned} stroke={themeColors.info} strokeWidth={2.5} fill="none" />}
            {chartPath.collected && <Path d={chartPath.collected} stroke={themeColors.success} strokeWidth={2.5} fill="none" />}
            {chartPath.forecast && <Path d={chartPath.forecast} stroke={themeColors.accent} strokeWidth={2} fill="none" strokeDasharray="6,4" />}
          </Svg>
          <View style={styles.chartLegend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: themeColors.info }]} />
              <Text style={styles.legendText}>Planned</Text>
            </View>
            <View style={styles.legendItem}>
              {/* Was labelled "Actual" beside "Planned", which read as spend —
                  it has always been the client's payments. Same curve, honest
                  name (MONEY-EVM-1). */}
              <View style={[styles.legendDot, { backgroundColor: themeColors.success }]} />
              <Text style={styles.legendText}>Collected</Text>
            </View>
            {!!chartPath.forecast && (
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: themeColors.accent }]} />
                <Text style={styles.legendText}>Forecast</Text>
              </View>
            )}
          </View>
          {!chartPath.forecast && (
            <Text style={styles.chartNote}>
              No forecast curve: projecting the final cost needs a cost performance index, and this job has no recorded costs to build one from.
            </Text>
          )}
        </View>
          </>}
          rail={<>
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
          </>}
        />
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
  contentDesktop: { width: '100%', maxWidth: Layout.page.dashboard, alignSelf: 'center' as const },
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
  // The "why this is hidden" card that stands in for the four cost cards. It
  // is a full-width panel rather than a seventh tile on purpose: a tile reads
  // as one more metric, and the point is that four metrics are absent.
  costGapCard: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.panel,
    borderWidth: 1,
    borderColor: t.line,
    borderLeftWidth: 4,
    borderLeftColor: t.warningLabel,
    padding: 14,
    gap: 8,
    marginBottom: 12,
  },
  costGapHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  costGapTitle: {
    flex: 1,
    fontSize: Type.subhead.fontSize,
    fontWeight: '700' as const,
    color: t.text,
  },
  costGapBody: {
    fontSize: Type.footnote.fontSize,
    color: t.textSecondary,
    lineHeight: 19,
  },
  costGapBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    alignSelf: 'flex-start' as const,
    gap: 4,
    paddingVertical: 6,
  },
  costGapBtnText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '700' as const,
    color: t.accentLabel,
  },
  chartNote: {
    fontSize: Type.caption2.fontSize,
    color: t.textSecondary,
    lineHeight: 15,
    marginTop: 10,
    textAlign: 'center' as const,
  },
  metricsGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 10,
    marginBottom: 24,
  },
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
    backgroundColor: t.accentFill,
    borderRadius: Tokens.radius.card,
    paddingVertical: 14,
  },
  forecastBtnText: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '600' as const,
    color: '#fff',
  },
});
