import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert,
  Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Sparkles, HelpCircle, DollarSign, AlertTriangle, CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import {
  evaluateSubcontractor, getCachedResult, setCachedResult,
  type SubEvaluationResult,
} from '@/utils/aiService';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';
import type { Subcontractor } from '@/types';
import type { SubscriptionTierKey } from '@/utils/aiRateLimiter';

interface Props {
  sub: Subcontractor;
  projectContext: string;
  subscriptionTier: SubscriptionTierKey;
}

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

export default React.memo(function AISubEvaluator({ sub, projectContext, subscriptionTier }: Props) {
  const [result, setResult] = useState<SubEvaluationResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleEvaluate = useCallback(async () => {
    if (isLoading) return;

    const cacheKey = `sub_eval_${sub.id}`;
    const cached = await getCachedResult<SubEvaluationResult>(cacheKey, TWENTY_FOUR_HOURS);
    if (cached) {
      setResult(cached);
      return;
    }

    const limit = await checkAILimit(subscriptionTier, 'fast');
    if (!limit.allowed) {
      Alert.alert('AI Limit Reached', limit.message ?? 'Try again tomorrow.');
      return;
    }

    setIsLoading(true);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const data = await evaluateSubcontractor(sub, projectContext);
      await recordAIUsage('fast');
      await setCachedResult(cacheKey, data);
      setResult(data);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.log('[AI Sub] Evaluation failed:', err);
      Alert.alert('AI Error', 'Could not evaluate this subcontractor. Try again.');
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, sub, projectContext, subscriptionTier]);

  if (!result) {
    return (
      <TouchableOpacity style={styles.triggerBtn} onPress={handleEvaluate} activeOpacity={0.7} disabled={isLoading}>
        {isLoading ? (
          <ActivityIndicator size="small" color={Colors.primary} />
        ) : (
          <Sparkles size={16} color={Colors.primary} />
        )}
        <Text style={styles.triggerText}>{isLoading ? 'Analyzing...' : 'AI Evaluate Sub'}</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Sparkles size={12} color={Colors.primary} />
        <Text style={styles.headerTitle}>AI Sub Evaluation</Text>
        <Text style={styles.aiTag}>AI-generated</Text>
      </View>

      <Text style={styles.recommendation}>{result.recommendation}</Text>

      {result.trackRecord ? (
        <View style={styles.trackRow}>
          <CheckCircle2 size={12} color={Colors.success} />
          <Text style={styles.trackText}>{result.trackRecord}</Text>
        </View>
      ) : null}

      <Text style={styles.sectionLabel}>Questions to Ask</Text>
      {result.questionsToAsk.map((q, idx) => (
        <View key={idx} style={styles.questionRow}>
          <HelpCircle size={12} color={Colors.info} />
          <Text style={styles.questionText}>{q}</Text>
        </View>
      ))}

      <Text style={styles.sectionLabel}>Typical Rates ({sub.trade})</Text>
      <View style={styles.rateGrid}>
        <View style={styles.rateItem}>
          <Text style={styles.rateLabel}>Journeyman</Text>
          <Text style={styles.rateValue}>{result.typicalRates.journeyman}</Text>
        </View>
        <View style={styles.rateItem}>
          <Text style={styles.rateLabel}>Master</Text>
          <Text style={styles.rateValue}>{result.typicalRates.master}</Text>
        </View>
        <View style={styles.rateItem}>
          <Text style={styles.rateLabel}>Apprentice</Text>
          <Text style={styles.rateValue}>{result.typicalRates.apprentice}</Text>
        </View>
      </View>

      {result.redFlags.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>Red Flags to Watch</Text>
          {result.redFlags.map((flag, idx) => (
            <View key={idx} style={styles.flagRow}>
              <AlertTriangle size={12} color="#FF3B30" />
              <Text style={styles.flagText}>{flag}</Text>
            </View>
          ))}
        </>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  triggerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary + '10',
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 12,
    borderWidth: 1,
    borderColor: Colors.primary + '25',
  },
  triggerText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  container: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    marginTop: 12,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  headerTitle: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.text,
    flex: 1,
  },
  aiTag: {
    fontSize: 10,
    color: Colors.textMuted,
  },
  recommendation: {
    fontSize: 14,
    color: Colors.text,
    lineHeight: 20,
    marginBottom: 12,
    fontWeight: '500' as const,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: Colors.successLight,
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  trackText: {
    fontSize: 13,
    color: Colors.success,
    flex: 1,
    lineHeight: 18,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: Colors.textMuted,
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
    fontSize: 13,
    color: Colors.text,
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
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
  },
  rateLabel: {
    fontSize: 10,
    color: Colors.textMuted,
    fontWeight: '500' as const,
  },
  rateValue: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  flagRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginBottom: 4,
  },
  flagText: {
    fontSize: 13,
    color: '#D32F2F',
    flex: 1,
    lineHeight: 18,
  },
});
