import React, { useMemo, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  Alert, Platform, Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  TrendingUp, TrendingDown, DollarSign, Clock, Target, BarChart3,
  Sparkles,
} from 'lucide-react-native';
import Svg, { Path, Line } from 'react-native-svg';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { calculateEVM, generateCashFlowData } from '@/utils/earnedValueEngine';
import { mageAI } from '@/utils/mageAI';

const SCREEN_WIDTH = Dimensions.get('window').width;
const CHART_WIDTH = SCREEN_WIDTH - 64;
const CHART_HEIGHT = 200;
const CHART_PADDING = 40;

function formatCurrency(n: number): string {
  if (Math.abs(n) >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M';
  if (Math.abs(n) >= 1000) return '$' + (n / 1000).toFixed(1) + 'K';
  return '$' + n.toFixed(0);
}

function getMetricColor(value: number): string {
  if (value >= 1.0) return Colors.success;
  if (value >= 0.9) return Colors.warning;
  return Colors.error;
}

export default function BudgetDashboardScreen() {
  const insets = useSafeAreaInsets();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { getProject, invoices } = useProjects();

  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);
  const projectInvoices = useMemo(() => invoices.filter(inv => inv.projectId === (projectId ?? '')), [invoices, projectId]);

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
      <View style={[styles.container, styles.center]}>
        <Stack.Screen options={{ title: 'Budget Dashboard' }} />
        <Text style={styles.emptyText}>Project not found</Text>
      </View>
    );
  }

  const metricCards = [
    { label: 'CPI', value: metrics.costPerformanceIndex.toFixed(2), icon: DollarSign, color: getMetricColor(metrics.costPerformanceIndex) },
    { label: 'SPI', value: metrics.schedulePerformanceIndex.toFixed(2), icon: Clock, color: getMetricColor(metrics.schedulePerformanceIndex) },
    { label: 'Cost Variance', value: formatCurrency(metrics.costVariance), icon: metrics.costVariance >= 0 ? TrendingUp : TrendingDown, color: metrics.costVariance >= 0 ? Colors.success : Colors.error },
    { label: 'Schedule Variance', value: formatCurrency(metrics.scheduleVariance), icon: metrics.scheduleVariance >= 0 ? TrendingUp : TrendingDown, color: metrics.scheduleVariance >= 0 ? Colors.success : Colors.error },
    { label: 'Est. at Completion', value: formatCurrency(metrics.estimateAtCompletion), icon: Target, color: Colors.info },
    { label: 'Variance at Comp.', value: formatCurrency(metrics.varianceAtCompletion), icon: BarChart3, color: metrics.varianceAtCompletion >= 0 ? Colors.success : Colors.error },
  ];

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        title: 'Budget Dashboard',
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.primary,
        headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
      }} />
      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 20 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.projectHeader}>
          <Text style={styles.projectName}>{project.name}</Text>
          <Text style={styles.projectBudget}>Budget: {formatCurrency(metrics.budgetAtCompletion)}</Text>
          <View style={styles.progressBarContainer}>
            <View style={[styles.progressBar, { width: `${Math.min(metrics.percentComplete, 100)}%` as any, backgroundColor: getMetricColor(metrics.costPerformanceIndex) }]} />
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
            <Line x1={CHART_PADDING} y1={CHART_HEIGHT - CHART_PADDING} x2={CHART_WIDTH - CHART_PADDING} y2={CHART_HEIGHT - CHART_PADDING} stroke={Colors.borderLight} strokeWidth={1} />
            <Line x1={CHART_PADDING} y1={CHART_PADDING} x2={CHART_PADDING} y2={CHART_HEIGHT - CHART_PADDING} stroke={Colors.borderLight} strokeWidth={1} />

            {chartPath.planned && <Path d={chartPath.planned} stroke={Colors.info} strokeWidth={2.5} fill="none" />}
            {chartPath.actual && <Path d={chartPath.actual} stroke={Colors.success} strokeWidth={2.5} fill="none" />}
            {chartPath.forecast && <Path d={chartPath.forecast} stroke={Colors.warning} strokeWidth={2} fill="none" strokeDasharray="6,4" />}
          </Svg>
          <View style={styles.chartLegend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: Colors.info }]} />
              <Text style={styles.legendText}>Planned</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: Colors.success }]} />
              <Text style={styles.legendText}>Actual</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: Colors.warning }]} />
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: Colors.textSecondary,
  },
  scrollContent: {
    padding: 16,
  },
  projectHeader: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 18,
    marginBottom: 20,
    gap: 6,
  },
  projectName: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  projectBudget: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  progressBarContainer: {
    height: 8,
    backgroundColor: Colors.fillTertiary,
    borderRadius: 4,
    marginTop: 8,
    overflow: 'hidden',
  },
  progressBar: {
    height: 8,
    borderRadius: 4,
  },
  progressText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text,
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 12,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 24,
  },
  metricCard: {
    width: '48%' as any,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderLeftWidth: 4,
    gap: 6,
  },
  metricHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metricLabel: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  metricValue: {
    fontSize: 22,
    fontWeight: '800' as const,
  },
  chartCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    marginBottom: 24,
  },
  chartLegend: {
    flexDirection: 'row',
    gap: 20,
    marginTop: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '500' as const,
  },
  forecastCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 18,
    gap: 14,
    marginBottom: 20,
  },
  forecastText: {
    fontSize: 14,
    color: Colors.text,
    lineHeight: 22,
  },
  forecastPlaceholder: {
    fontSize: 14,
    color: Colors.textMuted,
    lineHeight: 20,
    fontStyle: 'italic',
  },
  forecastBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
  },
  forecastBtnText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: '#fff',
  },
});
