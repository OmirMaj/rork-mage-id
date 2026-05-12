import React, { useMemo, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  Alert, Platform, Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, Stack, useRouter } from 'expo-router';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import * as Haptics from 'expo-haptics';
import {
  TrendingUp, TrendingDown, DollarSign, Clock, Target, BarChart3,
  Sparkles,
} from 'lucide-react-native';
import EmptyState from '@/components/EmptyState';
import Svg, { Path, Line } from 'react-native-svg';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { calculateEVM, generateCashFlowData } from '@/utils/earnedValueEngine';
import { mageAI } from '@/utils/mageAI';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

const SCREEN_WIDTH = Dimensions.get('window').width;
const CHART_WIDTH = SCREEN_WIDTH - 64;
const CHART_HEIGHT = 200;
const CHART_PADDING = 40;

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
  const router = useRouter();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { getProject, invoices, getChangeOrdersForProject } = useProjects();

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
    return calculateEVM(project, projectInvoices, project.schedule);
  }, [project, projectInvoices]);

  const cashFlowData = useMemo(() => {
    if (!project) return [];
    return generateCashFlowData(project, projectInvoices, project.schedule, 10);
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

      const aiResult = await mageAI({ prompt, tier: 'fast' });
      if (!aiResult.success) {
        Alert.alert('AI Unavailable', aiResult.error || 'Try again.');
        return;
      }
      setForecast(aiResult.data ?? aiResult.raw ?? '');
      console.log('[EVM] AI forecast generated');
    } catch (err) {
      console.log('[EVM] Forecast generation failed:', err);
      Alert.alert('Error', 'Could not generate forecast. Please try again.');
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

    const toX = (i: number) => CHART_PADDING + (i / (cashFlowData.length - 1)) * (CHART_WIDTH - CHART_PADDING * 2);
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
  }, [cashFlowData]);

  if (!project || !metrics) {
    return (
      <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
        <Stack.Screen options={{ title: 'Budget Dashboard' }} />
        <EmptyState
          icon={<BarChart3 size={36} color={themeColors.accent} strokeWidth={1.6} />}
          title="No project to chart yet"
          message="The budget dashboard tracks earned value (CPI / SPI) against an estimate. To see one:"
          steps={[
            'Open or create a project from the Projects tab.',
            'Build an estimate so the dashboard has a planned budget to chart against.',
            'Tap Budget Dashboard inside the project tile grid.',
          ]}
          actionLabel="Open Projects"
          onAction={() => router.push('/(tabs)/(home)' as any)}
        />
      </View>
    );
  }

  const metricCards = [
    { label: 'CPI', value: metrics.costPerformanceIndex.toFixed(2), icon: DollarSign, color: getMetricColor(metrics.costPerformanceIndex, themeColors) },
    { label: 'SPI', value: metrics.schedulePerformanceIndex.toFixed(2), icon: Clock, color: getMetricColor(metrics.schedulePerformanceIndex, themeColors) },
    { label: 'Cost Variance', value: formatCurrency(metrics.costVariance), icon: metrics.costVariance >= 0 ? TrendingUp : TrendingDown, color: metrics.costVariance >= 0 ? themeColors.success : themeColors.danger },
    { label: 'Schedule Variance', value: formatCurrency(metrics.scheduleVariance), icon: metrics.scheduleVariance >= 0 ? TrendingUp : TrendingDown, color: metrics.scheduleVariance >= 0 ? themeColors.success : themeColors.danger },
    { label: 'Est. at Completion', value: formatCurrency(metrics.estimateAtCompletion), icon: Target, color: themeColors.info },
    { label: 'Variance at Comp.', value: formatCurrency(metrics.varianceAtCompletion), icon: BarChart3, color: metrics.varianceAtCompletion >= 0 ? themeColors.success : themeColors.danger },
  ];

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        title: 'Budget Dashboard',
        headerStyle: { backgroundColor: themeColors.bg },
        headerTintColor: themeColors.accent,
        headerTitleStyle: { fontWeight: '700' as const, color: themeColors.text },
      }} />
      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 20 }]} showsVerticalScrollIndicator={false}>
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
            <View key={card.label} style={[styles.metricCard, { borderLeftColor: card.color }]}>
              <View style={styles.metricHeader}>
                <card.icon size={16} color={card.color} />
                <Text style={styles.metricLabel}>{card.label}</Text>
              </View>
              <Text style={[styles.metricValue, { color: card.color }]}>{card.value}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Cash Flow S-Curve</Text>
        <View style={styles.chartCard}>
          <Svg width={CHART_WIDTH} height={CHART_HEIGHT}>
            <Line x1={CHART_PADDING} y1={CHART_HEIGHT - CHART_PADDING} x2={CHART_WIDTH - CHART_PADDING} y2={CHART_HEIGHT - CHART_PADDING} stroke={themeColors.line} strokeWidth={1} />
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
                <Sparkles size={16} color="#fff" />
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
