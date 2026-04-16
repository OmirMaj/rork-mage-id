import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Sparkles, RefreshCw, AlertTriangle, CheckCircle2, Zap, TrendingDown } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import {
  analyzeScheduleRisk, getCachedResult, setCachedResult,
  type ScheduleRiskResult,
} from '@/utils/aiService';
import type { ProjectSchedule } from '@/types';

interface Props {
  schedule: ProjectSchedule;
  projectId: string;
  weatherData?: string;
}

const SEVERITY_STYLES = {
  high: { bg: '#FFF0EF', border: '#FF3B30', icon: AlertTriangle, label: 'HIGH RISK', textColor: '#D32F2F' },
  medium: { bg: '#FFF8E1', border: '#FF9500', icon: Zap, label: 'MEDIUM RISK', textColor: '#E65100' },
  low: { bg: '#E8F5E9', border: '#34C759', icon: CheckCircle2, label: 'LOW RISK', textColor: '#2E7D32' },
} as const;

const TWO_HOURS = 2 * 60 * 60 * 1000;

export default React.memo(function AIScheduleRisk({ schedule, projectId, weatherData }: Props) {
  const [result, setResult] = useState<ScheduleRiskResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastAnalyzed, setLastAnalyzed] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  const cacheKey = `risk_${projectId}`;

  const loadOrAnalyze = useCallback(async (forceRefresh = false) => {
    if (isLoading) return;

    if (!forceRefresh && !hasLoaded) {
      const cached = await getCachedResult<ScheduleRiskResult & { analyzedAt: string }>(cacheKey, TWO_HOURS);
      if (cached) {
        setResult(cached);
        setLastAnalyzed(cached.analyzedAt);
        setHasLoaded(true);
        return;
      }
    }

    setIsLoading(true);
    try {
      const data = await analyzeScheduleRisk(schedule, weatherData);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const now = new Date().toISOString();
      setResult(data);
      setLastAnalyzed(now);
      setHasLoaded(true);
      await setCachedResult(cacheKey, { ...data, analyzedAt: now });
    } catch (err) {
      console.error('[AI Risk] Failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, schedule, weatherData, cacheKey, hasLoaded]);

  React.useEffect(() => {
    if (!hasLoaded && (schedule.tasks ?? []).length > 0) {
      loadOrAnalyze();
    }
  }, [hasLoaded, (schedule.tasks ?? []).length, loadOrAnalyze]);

  if (!hasLoaded && !isLoading) {
    return (
      <TouchableOpacity style={styles.initCard} onPress={() => loadOrAnalyze()}>
        <Sparkles size={18} color={Colors.primary} />
        <Text style={styles.initText}>Tap to run AI Risk Analysis</Text>
      </TouchableOpacity>
    );
  }

  if (isLoading && !result) {
    return (
      <View style={styles.card}>
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={Colors.primary} />
          <Text style={styles.loadingText}>Analyzing schedule risks...</Text>
        </View>
      </View>
    );
  }

  if (!result) return null;

  const risks = Array.isArray(result.risks) ? result.risks : [];
  const highRisks = risks.filter(r => r.severity === 'high');
  const medRisks = risks.filter(r => r.severity === 'medium');
  const lowCount = risks.filter(r => r.severity === 'low').length;
  const otherCount = (schedule.tasks ?? []).length - risks.length;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Sparkles size={16} color={Colors.primary} />
          <Text style={styles.headerTitle}>AI Risk Forecast</Text>
        </View>
        <TouchableOpacity
          onPress={() => loadOrAnalyze(true)}
          disabled={isLoading}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color={Colors.primary} />
          ) : (
            <RefreshCw size={16} color={Colors.textSecondary} />
          )}
        </TouchableOpacity>
      </View>

      {highRisks.map((risk, idx) => {
        const sev = SEVERITY_STYLES.high;
        return (
          <View key={`h-${idx}`} style={[styles.riskItem, { backgroundColor: sev.bg, borderLeftColor: sev.border }]}>
            <View style={styles.riskHeader}>
              <sev.icon size={14} color={sev.textColor} />
              <Text style={[styles.riskSeverity, { color: sev.textColor }]}>{sev.label}: "{risk.taskName}"</Text>
            </View>
            <Text style={styles.riskProb}>{risk.delayProbability}% likely to be delayed {risk.delayDays}+ days</Text>
            {(risk.reasons ?? []).map((r, i) => (
              <Text key={i} style={styles.riskReason}>• {r}</Text>
            ))}
            <Text style={styles.riskRec}>→ {risk.recommendation}</Text>
          </View>
        );
      })}

      {medRisks.map((risk, idx) => {
        const sev = SEVERITY_STYLES.medium;
        return (
          <View key={`m-${idx}`} style={[styles.riskItem, { backgroundColor: sev.bg, borderLeftColor: sev.border }]}>
            <View style={styles.riskHeader}>
              <sev.icon size={14} color={sev.textColor} />
              <Text style={[styles.riskSeverity, { color: sev.textColor }]}>{sev.label}: "{risk.taskName}"</Text>
            </View>
            <Text style={styles.riskProb}>{risk.delayProbability}% likely to slip {risk.delayDays} days</Text>
            <Text style={styles.riskRec}>→ {risk.recommendation}</Text>
          </View>
        );
      })}

      {(lowCount + otherCount) > 0 && (
        <View style={[styles.riskItem, { backgroundColor: '#E8F5E9', borderLeftColor: '#34C759' }]}>
          <View style={styles.riskHeader}>
            <CheckCircle2 size={14} color="#2E7D32" />
            <Text style={[styles.riskSeverity, { color: '#2E7D32' }]}>
              LOW RISK: {lowCount + otherCount} other tasks on track
            </Text>
          </View>
        </View>
      )}

      <View style={styles.confidenceRow}>
        <View style={styles.confItem}>
          <Text style={styles.confLabel}>Completion Confidence</Text>
          <Text style={[styles.confValue, { color: result.overallConfidence >= 70 ? Colors.success : Colors.warning }]}>
            {result.overallConfidence}%
          </Text>
        </View>
        <View style={styles.confItem}>
          <Text style={styles.confLabel}>Predicted End</Text>
          <Text style={styles.confValue}>{result.predictedEndDate}</Text>
        </View>
        {result.predictedDelay > 0 && (
          <View style={styles.confItem}>
            <Text style={styles.confLabel}>Delay</Text>
            <Text style={[styles.confValue, { color: Colors.error }]}>+{result.predictedDelay}d</Text>
          </View>
        )}
      </View>

      {lastAnalyzed && (
        <Text style={styles.timestamp}>
          Last analyzed: {new Date(lastAnalyzed).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  initCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 16,
    backgroundColor: `${Colors.primary}08`,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: `${Colors.primary}20`,
    borderStyle: 'dashed',
    marginHorizontal: 16,
    marginVertical: 8,
  },
  initText: {
    fontSize: 14,
    color: Colors.primary,
    fontWeight: '600' as const,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 8,
    borderWidth: 0.5,
    borderColor: Colors.borderLight,
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 8,
  },
  loadingText: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontStyle: 'italic' as const,
  },
  riskItem: {
    padding: 12,
    borderRadius: 10,
    borderLeftWidth: 3,
    gap: 4,
  },
  riskHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  riskSeverity: {
    fontSize: 13,
    fontWeight: '700' as const,
  },
  riskProb: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  riskReason: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginLeft: 4,
  },
  riskRec: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: '600' as const,
    marginTop: 2,
  },
  confidenceRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  confItem: {
    flex: 1,
    backgroundColor: Colors.fillSecondary,
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  confLabel: {
    fontSize: 10,
    color: Colors.textMuted,
    fontWeight: '500' as const,
  },
  confValue: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  timestamp: {
    fontSize: 11,
    color: Colors.textMuted,
    textAlign: 'right',
  },
});
