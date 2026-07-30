import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { HelpCircle, DollarSign, AlertTriangle, CheckCircle2 } from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import {
  evaluateSubcontractor, getCachedResult, setCachedResult,
  type SubEvaluationResult,
} from '@/utils/aiService';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';
import { showAILimitAlert } from '@/utils/aiLimitAlert';
import { useRouter } from 'expo-router';
import type { Subcontractor } from '@/types';
import type { SubscriptionTierKey } from '@/utils/aiRateLimiter';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';

interface Props {
  sub: Subcontractor;
  projectContext: string;
  subscriptionTier: SubscriptionTierKey;
}

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

export default React.memo(function AISubEvaluator({ sub, projectContext, subscriptionTier }: Props) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [result, setResult] = useState<SubEvaluationResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleEvaluate = useCallback(async () => {
    if (isLoading) return;

    const cacheKey = `sub_eval_${sub.id}`;
    const cached = await getCachedResult<SubEvaluationResult>(cacheKey, TWENTY_FOUR_HOURS);
    if (cached) {
      setResult(cached);
      return;
    }

    const limit = await checkAILimit(subscriptionTier, 'fast', 'subEvaluation');
    if (!limit.allowed) {
      showAILimitAlert({ limit, router });
      return;
    }

    setIsLoading(true);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const data = await evaluateSubcontractor(sub, projectContext);
      await recordAIUsage('fast', 'subEvaluation');
      await setCachedResult(cacheKey, data);
      setResult(data);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.log('[AI Sub] Evaluation failed:', err);
      showAlert('AI Error', 'Could not evaluate this subcontractor. Try again.');
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, sub, projectContext, subscriptionTier]);

  if (!result) {
    return (
      <TouchableOpacity style={styles.triggerBtn} onPress={handleEvaluate} activeOpacity={0.7} disabled={isLoading}>
        {isLoading ? (
          <ActivityIndicator size="small" color={"#FF6A1A"} />
        ) : (
          <MageAIMark size={16} color={"#FF6A1A"} />
        )}
        <Text style={styles.triggerText}>{isLoading ? 'Analyzing...' : 'AI Evaluate Sub'}</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: themeColors.surface, borderColor: themeColors.line }]}>
      <View style={styles.header}>
        <MageAIMark size={12} color={"#FF6A1A"} />
        <Text style={styles.headerTitle}>AI Sub Evaluation</Text>
        <Text style={styles.aiTag}>AI-generated</Text>
      </View>

      <Text style={styles.recommendation}>{result.recommendation}</Text>

      {result.trackRecord ? (
        <View style={styles.trackRow}>
          <CheckCircle2 size={12} color={"#2E7D44"} strokeWidth={1.75} />
          <Text style={styles.trackText}>{result.trackRecord}</Text>
        </View>
      ) : null}

      <Text style={styles.sectionLabel}>Questions to Ask</Text>
      {(result.questionsToAsk ?? []).map((q, idx) => (
        <View key={idx} style={styles.questionRow}>
          <HelpCircle size={12} color={"#1565C0"} strokeWidth={1.75} />
          <Text style={styles.questionText}>{q}</Text>
        </View>
      ))}

      <Text style={styles.sectionLabel}>Typical Rates ({sub.trade})</Text>
      <View style={styles.rateGrid}>
        <View style={styles.rateItem}>
          <Text style={styles.rateLabel}>Journeyman</Text>
          <Text style={styles.rateValue}>{result.typicalRates?.journeyman ?? '—'}</Text>
        </View>
        <View style={styles.rateItem}>
          <Text style={styles.rateLabel}>Master</Text>
          <Text style={styles.rateValue}>{result.typicalRates?.master ?? '—'}</Text>
        </View>
        <View style={styles.rateItem}>
          <Text style={styles.rateLabel}>Apprentice</Text>
          <Text style={styles.rateValue}>{result.typicalRates?.apprentice ?? '—'}</Text>
        </View>
      </View>

      {(result.redFlags ?? []).length > 0 && (
        <>
          <Text style={styles.sectionLabel}>Red Flags to Watch</Text>
          {(result.redFlags ?? []).map((flag, idx) => (
            <View key={idx} style={styles.flagRow}>
              <AlertTriangle size={12} color={"#C84038"} strokeWidth={1.75} />
              <Text style={styles.flagText}>{flag}</Text>
            </View>
          ))}
        </>
      )}
    </View>
  );
});

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  triggerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: t.accent + '10',
    borderRadius: Tokens.radius.card,
    paddingVertical: 14,
    marginTop: 12,
    borderWidth: 1,
    borderColor: t.accent + '25',
  },
  triggerText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: t.accent,
  },
  container: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.lg,
    padding: 14,
    marginTop: 12,
    borderWidth: 1,
    borderColor: t.line,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  headerTitle: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '700' as const,
    color: t.text,
    flex: 1,
  },
  aiTag: {
    fontSize: 10,
    color: t.textMuted,
  },
  recommendation: {
    fontSize: Type.bodyCompact.fontSize,
    color: t.text,
    lineHeight: 20,
    marginBottom: 12,
    fontWeight: '500' as const,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: Colors.successLight,
    borderRadius: Tokens.radius.sm,
    padding: 10,
    marginBottom: 12,
  },
  trackText: {
    fontSize: Type.footnote.fontSize,
    color: t.success,
    flex: 1,
    lineHeight: 18,
  },
  sectionLabel: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: t.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.8,
    marginBottom: 6,
    marginTop: 4,
  },
  questionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginBottom: 6,
  },
  questionText: {
    fontSize: Type.footnote.fontSize,
    color: t.text,
    flex: 1,
    lineHeight: 18,
  },
  rateGrid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  rateItem: {
    flex: 1,
    backgroundColor: Colors.fillSecondary,
    borderRadius: Tokens.radius.sm,
    padding: 10,
    alignItems: 'center',
  },
  rateLabel: {
    fontSize: 10,
    color: t.textMuted,
    fontWeight: '500' as const,
  },
  rateValue: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '700' as const,
    color: t.text,
  },
  flagRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginBottom: 4,
  },
  flagText: {
    fontSize: Type.footnote.fontSize,
    color: '#D32F2F',
    flex: 1,
    lineHeight: 18,
  },
});
