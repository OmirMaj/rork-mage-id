import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react-native';
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
  const [error, setError] = useState<string | null>(null);

  const cacheKey = `risk_${projectId}`;

  /**
   * `cacheOnly` reads the 2h cache and stops there. Only a tap analyses.
   *
   * The mount effect below used to fall straight through a cache miss into
   * checkAILimit + analyzeScheduleRisk, so merely OPENING the Schedule tab
   * spent a 'smart' call per project, several times a day — and the "Tap to
   * run AI Risk Analysis" card was dead UI nobody could reach. A Pro GC with
   * three jobs burned his allowance browsing and then hit a paywall on the AI
   * Schedule Builder he actually wanted (audit 2026-09-07, ai-features).
   */
  const loadOrAnalyze = useCallback(async (forceRefresh = false, cacheOnly = false) => {
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
    if (cacheOnly) return;

    const limit = await checkAILimit(tier, 'smart', 'scheduleBuilder');
    if (!limit.allowed) {
      showAILimitAlert({ limit, router });
      setError(limit.message ?? "You've used today's AI allowance for this.");
      return;
    }

    setError(null);
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
      // Say what broke on the card. A spinner that returns to a dashed "Tap to
      // run" box reads as "the feature does nothing".
      console.error('[AI Risk] Failed:', err);
      setError(`Couldn't run the risk forecast. ${err instanceof Error && err.message ? err.message : 'Tap to retry.'}`);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, schedule, weatherData, cacheKey, hasLoaded, tier, router]);

  React.useEffect(() => {
    if (!hasLoaded && schedule.tasks.length > 0) {
      void loadOrAnalyze(false, true);
    }
  }, [hasLoaded, schedule.tasks.length, loadOrAnalyze]);

  if (!hasLoaded && !isLoading) {
    return (
      <TouchableOpacity
        style={styles.initCard}
        onPress={() => void loadOrAnalyze()}
        accessibilityRole="button"
        accessibilityLabel="Run AI risk analysis"
        testID="schedule-risk-run"
      >
        <MageAIMark size={18} color={themeColors.accent} />
        <View style={styles.initTextCol}>
          <Text style={styles.initText}>{error ? 'Tap to try the risk analysis again' : 'Tap to run AI Risk Analysis'}</Text>
          {error ? <Text style={styles.initError}>{error}</Text> : null}
        </View>
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
          onPress={() => void loadOrAnalyze(true)}
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

      {error ? (
        <View style={styles.errorRow}>
          <AlertTriangle size={13} color={themeColors.dangerLabel} strokeWidth={1.75} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

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
  initTextCol: {
    flex: 1,
    gap: 3,
  },
  initText: {
    fontSize: Type.bodyCompact.fontSize,
    color: t.accent,
    fontWeight: '600' as const,
  },
  initError: {
    fontSize: Type.caption1.fontSize,
    color: t.dangerLabel,
    lineHeight: 16,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    // dangerSoft, not the static `Colors.errorLight`: that tint is a baked
    // LIGHT value while `dangerLabel` themes, so inside this factory dark mode
    // put #FF5A51 ink on pale pink at 2.78:1. The themed pair measures 4.77:1
    // light / 4.79:1 dark (constants/colors.ts).
    backgroundColor: t.dangerSoft,
    borderRadius: Tokens.radius.md,
    padding: 10,
  },
  errorText: {
    flex: 1,
    fontSize: Type.footnote.fontSize,
    color: t.dangerLabel,
    fontWeight: '500' as const,
    lineHeight: 18,
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
