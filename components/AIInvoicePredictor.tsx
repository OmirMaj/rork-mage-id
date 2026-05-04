import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator, Animated, Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Sparkles, Clock, Lightbulb } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import {
  predictInvoicePayment, getCachedResult, setCachedResult,
  type InvoicePredictionResult,
} from '@/utils/aiService';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';
import type { Invoice } from '@/types';
import type { SubscriptionTierKey } from '@/utils/aiRateLimiter';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

interface Props {
  invoice: Invoice;
  projectName: string;
  allInvoices: Invoice[];
  subscriptionTier: SubscriptionTierKey;
}

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

const CONFIDENCE_STYLES = {
  high: { color: Colors.successDark, bg: Colors.successLight, label: 'High' },
  medium: { color: Colors.warningDark, bg: Colors.warningLight, label: 'Medium' },
  low: { color: '#757575', bg: '#F5F5F5', label: 'Low' },
} as const;

export default React.memo(function AIInvoicePredictor({ invoice, projectName, allInvoices, subscriptionTier }: Props) {
  const [result, setResult] = useState<InvoicePredictionResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const shimmerAnim = React.useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isLoading) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(shimmerAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
          Animated.timing(shimmerAnim, { toValue: 0, duration: 1000, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    }
  }, [isLoading, shimmerAnim]);

  const fetchPrediction = useCallback(async () => {
    if (invoice.status === 'paid' || invoice.status === 'draft') return;

    const cacheKey = `invoice_pred_${invoice.id}`;
    const cached = await getCachedResult<InvoicePredictionResult>(cacheKey, TWENTY_FOUR_HOURS);
    if (cached) {
      setResult(cached);
      return;
    }

    const limit = await checkAILimit(subscriptionTier, 'fast', 'invoicePrediction');
    if (!limit.allowed) return;

    setIsLoading(true);
    try {
      const paidInvoices = allInvoices.filter(i => i.status === 'paid' && i.payments.length > 0);
      let avgDaysLate = 0;
      if (paidInvoices.length > 0) {
        const totalDaysLate = paidInvoices.reduce((sum, inv) => {
          const due = new Date(inv.dueDate).getTime();
          const lastPayment = inv.payments[inv.payments.length - 1];
          const paid = lastPayment ? new Date(lastPayment.date).getTime() : due;
          return sum + Math.max(0, Math.round((paid - due) / (1000 * 60 * 60 * 24)));
        }, 0);
        avgDaysLate = Math.round(totalDaysLate / paidInvoices.length);
      }

      const data = await predictInvoicePayment(invoice, projectName, {
        avgDaysLate,
        totalInvoices: paidInvoices.length,
      });
      await recordAIUsage('fast', 'invoicePrediction');
      await setCachedResult(cacheKey, data);
      setResult(data);
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (err) {
      console.log('[AI Invoice] Prediction failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [invoice, projectName, allInvoices, subscriptionTier]);

  useEffect(() => {
    if (invoice.status !== 'paid' && invoice.status !== 'draft') {
      void fetchPrediction();
    }
  }, [invoice.id]);

  if (invoice.status === 'paid' || invoice.status === 'draft') return null;

  if (isLoading && !result) {
    const opacity = shimmerAnim.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.8] });
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Sparkles size={12} color={Colors.primary} />
          <Text style={styles.headerTitle}>Payment Prediction</Text>
        </View>
        <Animated.View style={[styles.skeleton, { opacity }]} />
        <Animated.View style={[styles.skeleton, styles.skeletonShort, { opacity }]} />
      </View>
    );
  }

  if (!result) return null;

  const conf = CONFIDENCE_STYLES[result.confidenceLevel] ?? CONFIDENCE_STYLES.medium;
  const dueDate = new Date(invoice.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Sparkles size={12} color={Colors.primary} />
        <Text style={styles.headerTitle}>Payment Prediction</Text>
        <Text style={styles.aiTag}>AI-generated</Text>
      </View>

      <View style={styles.predRow}>
        <View style={styles.predItem}>
          <Text style={styles.predLabel}>Due date</Text>
          <Text style={styles.predValue}>{dueDate}</Text>
        </View>
        <View style={styles.predItem}>
          <Text style={styles.predLabel}>Predicted payment</Text>
          <Text style={[styles.predValue, { color: Colors.primary }]}>{result.predictedPaymentDate}</Text>
        </View>
        <View style={[styles.confBadge, { backgroundColor: conf.bg }]}>
          <Text style={[styles.confText, { color: conf.color }]}>{conf.label}</Text>
        </View>
      </View>

      <Text style={styles.reasoning}>{result.reasoning}</Text>

      {result.tip ? (
        <View style={styles.tipRow}>
          <Lightbulb size={12} color={Colors.info} />
          <Text style={styles.tipText}>{result.tip}</Text>
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.lg,
    padding: 14,
    marginTop: 8,
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
    fontSize: Type.footnote.fontSize,
    fontWeight: '700' as const,
    color: Colors.text,
    flex: 1,
  },
  aiTag: {
    fontSize: 10,
    color: Colors.textMuted,
  },
  predRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  predItem: {
    flex: 1,
  },
  predLabel: {
    fontSize: Type.caption2.fontSize,
    color: Colors.textMuted,
    fontWeight: '500' as const,
  },
  predValue: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  confBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Tokens.radius.xs,
  },
  confText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
  },
  reasoning: {
    fontSize: Type.footnote.fontSize,
    color: Colors.textSecondary,
    lineHeight: 18,
    marginBottom: 8,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: Colors.infoLight,
    borderRadius: Tokens.radius.sm,
    padding: 10,
  },
  tipText: {
    fontSize: Type.caption1.fontSize,
    color: Colors.info,
    flex: 1,
    lineHeight: 17,
    fontWeight: '500' as const,
  },
  skeleton: {
    height: 12,
    backgroundColor: Colors.fillTertiary,
    borderRadius: Tokens.radius.xs,
    marginBottom: 6,
  },
  skeletonShort: {
    width: '60%',
  },
});
