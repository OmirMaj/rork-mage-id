import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { RefreshCw, AlertTriangle, CheckCircle2, TrendingDown } from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import {
  analyzeScheduleRisk, getCachedResult, setCachedResult,
  type ScheduleRiskResult,
} from '@/utils/aiService';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';
import { showAILimitAlert } from '@/utils/aiLimitAlert';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useRouter } from 'expo-router';
import type { ProjectSchedule } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

interface Props {
  schedule: ProjectSchedule;
  projectId: string;
  weatherData?: string;
}

const SEVERITY_STYLES = {
  high: { bg: Colors.errorLight, border: '#C84038', icon: AlertTriangle, label: 'HIGH RISK', textColor: '#D32F2F' },
  medium: { bg: '#FFF8E1', border: Colors.warning, icon: MageAIMark, label: 'MEDIUM RISK', textColor: Colors.warningDark },
  low: { bg: Colors.successLight, border: '#2E7D44', icon: CheckCircle2, label: 'LOW RISK', textColor: Colors.successDark },
} as const;

const TWO_HOURS = 2 * 60 * 60 * 1000;

export default React.memo(function AIScheduleRisk({ schedule, projectId, weatherData }: Props) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { tier } = useSubscription();
  const router = useRouter();
  const [result, setResult] = useState<ScheduleRiskResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastAnalyzed, setLastAnalyzed] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  const cacheKey = `risk_${projectId}`;

  const loadOrAnalyze = useCallback(async (forceRefresh = false, showAlertOnBlock = false) => {
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

    const limit = await checkAILimit(tier, 'smart', 'scheduleBuilder');
    if (!limit.allowed) {
      if (showAlertOnBlock) showAILimitAlert({ limit, router });
      return;
    }

    setIsLoading(true);
    try {
      const data = await analyzeScheduleRisk(schedule, weatherData);
      await recordAIUsage('smart', 'scheduleBuilder');
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
  }, [isLoading, schedule, weatherData, cacheKey, hasLoaded, tier, router]);

  React.useEffect(() => {
    if (!hasLoaded && schedule.tasks.length > 0) {
      loadOrAnalyze();
    }
  }, [hasLoaded, schedule.tasks.length, loadOrAnalyze]);

  if (!hasLoaded && !isLoading) {
    return (
      <TouchableOpacity style={styles.initCard} onPress={() => loadOrAnalyze(false, true)}>
        <MageAIMark size={18} color={themeColors.accent} />
        <Text style={styles.initText}>Tap to run AI Risk Analysis</Text>
      </TouchableOpacity>
    );
  }

  if (isLoading && !result) {
    return (
      <View style={styles.card}>
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={themeColors.accent} />
          <Text style={styles.loadingText}>Analyzing schedule risks...</Text>
        </View>
      </View>
    );
  }

  if (!result) return null;

  const risks = Array.isArray(result.risks) ? result.risks : [];
  const highRisks = risks.filter(r => r?.severity === 'high');
  const medRisks = risks.filter(r => r?.severity === 'medium');
  const lowCount = risks.filter(r => r?.severity === 'low').length;
  const otherCount = Math.max(0, schedule.tasks.length - risks.length);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <MageAIMark size={16} color={themeColors.accent} />
          <Text style={styles.headerTitle}>AI Risk Forecast</Text>
        </View>
        <TouchableOpacity
          onPress={() => loadOrAnalyze(true, true)}
          disabled={isLoading}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color={themeColors.accent} />
          ) : (
            <RefreshCw size={16} color={themeColors.textSecondary} strokeWidth={1.75} />
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
            <Text style={styles.riskProb}>{risk.delayProbability ?? 0}% likely to be delayed {risk.delayDays ?? 0}+ days</Text>
            {(risk.reasons ?? []).map((r, i) => (
              <Text key={i} style={styles.riskReason}>• {r}</Text>
            ))}
            {risk.recommendation ? <Text style={styles.riskRec}>→ {risk.recommendation}</Text> : null}
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
            <Text style={styles.riskProb}>{risk.delayProbability ?? 0}% likely to slip {risk.delayDays ?? 0} days</Text>
            {risk.recommendation ? <Text style={styles.riskRec}>→ {risk.recommendation}</Text> : null}
          </View>
        );
      })}

      {(lowCount + otherCount) > 0 && (
        <View style={[styles.riskItem, { backgroundColor: Colors.successLight, borderLeftColor: themeColors.success }]}>
          <View style={styles.riskHeader}>
            <CheckCircle2 size={14} color={Colors.successDark} strokeWidth={1.75} />
            <Text style={[styles.riskSeverity, { color: Colors.successDark }]}>
              LOW RISK: {lowCount + otherCount} other tasks on track
            </Text>
          </View>
        </View>
      )}

      <View style={styles.confidenceRow}>
        <View style={styles.confItem}>
          <Text style={styles.confLabel}>Completion Confidence</Text>
          <Text style={[styles.confValue, { color: (result.overallConfidence ?? 0) >= 70 ? themeColors.success : Colors.warning }]}>
            {result.overallConfidence ?? 0}%
          </Text>
        </View>
        {result.predictedEndDate ? (
          <View style={styles.confItem}>
            <Text style={styles.confLabel}>Predicted End</Text>
            <Text style={styles.confValue}>{result.predictedEndDate}</Text>
          </View>
        ) : null}
        {(result.predictedDelay ?? 0) > 0 && (
          <View style={styles.confItem}>
            <Text style={styles.confLabel}>Delay</Text>
            <Text style={[styles.confValue, { color: themeColors.danger }]}>+{result.predictedDelay}d</Text>
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

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  initCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 16,
    backgroundColor: `${t.accent}08`,
    borderRadius: Tokens.radius.lg,
    borderWidth: 1,
    borderColor: `${t.accent}20`,
    borderStyle: 'dashed',
    marginHorizontal: 16,
    marginVertical: 8,
  },
  initText: {
    fontSize: Type.bodyCompact.fontSize,
    color: t.accent,
    fontWeight: '600' as const,
  },
  card: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.lg,
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 8,
    borderWidth: 0.5,
    borderColor: t.line,
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
    fontSize: Type.subhead.fontSize,
    fontWeight: '700' as const,
    color: t.text,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 8,
  },
  loadingText: {
    fontSize: Type.bodyCompact.fontSize,
    color: t.textSecondary,
    fontStyle: 'italic' as const,
  },
  riskItem: {
    padding: 12,
    borderRadius: Tokens.radius.md,
    borderLeftWidth: 3,
    gap: 4,
  },
  riskHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  riskSeverity: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '700' as const,
  },
  riskProb: {
    fontSize: Type.footnote.fontSize,
    color: t.textSecondary,
  },
  riskReason: {
    fontSize: Type.caption1.fontSize,
    color: t.textSecondary,
    marginLeft: 4,
  },
  riskRec: {
    fontSize: Type.footnote.fontSize,
    color: t.accent,
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
    borderRadius: Tokens.radius.sm,
    alignItems: 'center',
  },
  confLabel: {
    fontSize: 10,
    color: t.textMuted,
    fontWeight: '500' as const,
  },
  confValue: {
    fontSize: Type.callout.fontSize,
    fontWeight: '800' as const,
    color: t.text,
  },
  timestamp: {
    fontSize: Type.caption2.fontSize,
    color: t.textMuted,
    textAlign: 'right',
  },
});
