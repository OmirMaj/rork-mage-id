import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator, Animated, Platform, TouchableOpacity,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { AlertTriangle } from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import {
  predictInvoicePayment, getCachedResult, setCachedResult,
  type InvoicePredictionResult,
} from '@/utils/aiService';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';
import { showAILimitAlert } from '@/utils/aiLimitAlert';
import { useRouter } from 'expo-router';
import { paymentHistoryForInvoice } from '@/utils/paymentPrediction';
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

// Themed pairs, not the static `Colors.successLight`/`warningLight` tints: those
// are baked LIGHT values, and the label inks beside them theme, so in dark mode
// the badge drew a vivid ink on a pale ground (constants/colors.ts).
const confidenceStyle = (t: ThemeColors, level: 'high' | 'medium' | 'low') => (
  level === 'high' ? { color: t.successLabel, bg: t.successSoft, label: 'High' }
  : level === 'low' ? { color: t.textSecondary, bg: t.surfaceAlt, label: 'Low' }
  : { color: t.warningLabel, bg: t.warningSoft, label: 'Medium' }
);

export default React.memo(function AIInvoicePredictor({ invoice, projectName, allInvoices, subscriptionTier }: Props) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [result, setResult] = useState<InvoicePredictionResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkedCache, setCheckedCache] = useState(false);
  const shimmerAnim = React.useRef(new Animated.Value(0)).current;
  const router = useRouter();

  // The evidence base, computed once and used for BOTH the payload and the
  // chip — so the chip cannot claim a record the prompt never saw.
  const history = useMemo(
    () => paymentHistoryForInvoice(invoice, allInvoices),
    [invoice, allInvoices],
  );

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

  /**
   * `cacheOnly` reads yesterday's answer off disk and spends nothing. Anything
   * else is a user gesture.
   *
   * This card used to run from a bare mount effect on every unpaid, non-draft
   * invoice — so opening the invoice screen on a cold cache spent a metered AI
   * call the GC never asked for, and a block or a throw then rendered NOTHING,
   * making both the spend and the failure invisible (audit 2026-09-07,
   * ai-features).
   */
  const fetchPrediction = useCallback(async (cacheOnly = false) => {
    if (invoice.status === 'paid' || invoice.status === 'draft') return;

    const cacheKey = `invoice_pred_${invoice.id}`;
    const cached = await getCachedResult<InvoicePredictionResult>(cacheKey, TWENTY_FOUR_HOURS);
    if (cached) {
      setResult(cached);
      setCheckedCache(true);
      return;
    }
    setCheckedCache(true);
    if (cacheOnly) return;

    const limit = await checkAILimit(subscriptionTier, 'fast', 'invoicePrediction');
    if (!limit.allowed) {
      // A blocked control says why, AND offers the way out. This was a bare
      // `return`, so the card never appeared and the GC had no way to know a
      // cap existed. Two surfaces on purpose: `limit.message` is written as a
      // pitch ("Upgrade to Pro for 30/day", utils/aiRateLimiterCore.ts:216)
      // and naming an upgrade with no route to it is the same defect one level
      // up — so the tap also raises the shared cap sheet, which is the only
      // thing in the app that routes to /paywall. The inline copy is what's
      // left on the card after the sheet is dismissed.
      showAILimitAlert({ limit, router });
      setError(limit.message ?? "You've used today's AI allowance — predictions reset at midnight.");
      return;
    }

    setError(null);
    setIsLoading(true);
    try {
      const data = await predictInvoicePayment(invoice, projectName, {
        // Scoped to THIS invoice's project. It used to average every paid
        // invoice in the account under the prompt heading "CLIENT HISTORY", so
        // one chronically late homeowner was scored against nine prompt
        // commercial clients (utils/paymentPrediction.ts).
        avgDaysLate: history.avgDaysLate ?? 0,
        totalInvoices: history.paidInvoices,
      });
      await recordAIUsage('fast', 'invoicePrediction');
      await setCachedResult(cacheKey, data);
      setResult(data);
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (err) {
      console.log('[AI Invoice] Prediction failed:', err);
      setError(`Couldn't predict payment on this invoice. ${err instanceof Error && err.message ? err.message : 'Tap to retry.'}`);
    } finally {
      setIsLoading(false);
    }
  }, [invoice, projectName, history, subscriptionTier, router]);

  // Mount reads the cache and nothing else — no AI call without a tap.
  useEffect(() => {
    if (invoice.status !== 'paid' && invoice.status !== 'draft') {
      void fetchPrediction(true);
    }
    // fetchPrediction is deliberately absent: its identity changes on every
    // invoice edit, and re-running the cache read on each would fight the
    // tap-to-run state below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice.id]);

  if (invoice.status === 'paid' || invoice.status === 'draft') return null;

  if (isLoading && !result) {
    const opacity = shimmerAnim.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.8] });
    return (
      <View style={[styles.container, { backgroundColor: themeColors.surface, borderColor: themeColors.line }]}>
        <View style={styles.header}>
          <MageAIMark size={12} color={"#FF6A1A"} />
          <Text style={styles.headerTitle}>Payment Prediction</Text>
        </View>
        <Animated.View style={[styles.skeleton, { opacity }]} />
        <Animated.View style={[styles.skeleton, styles.skeletonShort, { opacity }]} />
      </View>
    );
  }

  // No result yet: offer the run, and say why the last one didn't happen.
  // The card used to `return null` here, so a cap or a throw was
  // indistinguishable from the feature not existing.
  if (!result) {
    if (!checkedCache) return null;
    return (
      <View>
        <TouchableOpacity
          style={styles.triggerBtn}
          onPress={() => { void fetchPrediction(); }}
          disabled={isLoading}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Predict when this invoice will be paid"
        >
          <MageAIMark size={14} color={themeColors.accentLabel} />
          <Text style={styles.triggerText}>
            {error ? 'Try payment prediction again' : 'Predict when this gets paid'}
          </Text>
        </TouchableOpacity>
        <Text style={styles.groundingChip}>{history.summary}</Text>
        {error ? (
          <View style={styles.errorRow}>
            <AlertTriangle size={13} color={themeColors.dangerLabel} strokeWidth={1.75} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
      </View>
    );
  }

  const conf = confidenceStyle(themeColors, result.confidenceLevel);
  const dueDate = new Date(invoice.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  // The schema defaults this to '', so an absent prediction arrives as a blank
  // string. Rendering it would leave an empty accent-coloured slot under the
  // words "Predicted payment", which reads as a date that failed to load.
  const predictedDate = result.predictedPaymentDate.trim();

  return (
    <View style={[styles.container, { backgroundColor: themeColors.surface, borderColor: themeColors.line }]}>
      <View style={styles.header}>
        <MageAIMark size={12} color={"#FF6A1A"} />
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
          <Text style={[styles.predValue, predictedDate ? { color: themeColors.accentLabel } : { color: themeColors.textMuted }]}>
            {predictedDate || 'No date returned'}
          </Text>
        </View>
        <View style={[styles.confBadge, { backgroundColor: conf.bg }]}>
          <Text style={[styles.confText, { color: conf.color }]}>{conf.label}</Text>
        </View>
      </View>

      <Text style={styles.reasoning}>{result.reasoning}</Text>

      {/* Counts exactly what went into the prompt — the prior paid invoices on
          THIS project and nothing else. */}
      <Text style={styles.groundingChip}>{history.summary}</Text>

      {result.tip ? (
        <View style={styles.tipRow}>
          <MageAIMark size={12} color={themeColors.info} />
          <Text style={styles.tipText}>{result.tip}</Text>
        </View>
      ) : null}
    </View>
  );
});

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.lg,
    padding: 14,
    marginTop: 8,
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
    color: t.textMuted,
    fontWeight: '500' as const,
  },
  predValue: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: t.text,
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
    color: t.textSecondary,
    lineHeight: 18,
    marginBottom: 8,
  },
  triggerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: t.accent + '10',
    borderRadius: Tokens.radius.card,
    paddingVertical: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: t.accent + '25',
  },
  triggerText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: t.accentLabel,
  },
  groundingChip: {
    fontSize: Type.caption2.fontSize,
    color: t.textMuted,
    marginTop: 6,
    marginBottom: 8,
    lineHeight: 15,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: t.dangerSoft,
    borderRadius: Tokens.radius.md,
    padding: 10,
  },
  errorText: {
    flex: 1,
    fontSize: Type.caption1.fontSize,
    color: t.dangerLabel,
    fontWeight: '500' as const,
    lineHeight: 17,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    // t.info at 12%, not the static Colors.infoLight: that tint is a baked
    // LIGHT value while the ink beside it themes, so dark mode put #4EA7FF on
    // pale blue (constants/colors.ts).
    backgroundColor: t.info + '1F',
    borderRadius: Tokens.radius.sm,
    padding: 10,
  },
  tipText: {
    fontSize: Type.caption1.fontSize,
    color: t.info,
    flex: 1,
    lineHeight: 17,
    fontWeight: '500' as const,
  },
  skeleton: {
    height: 12,
    backgroundColor: t.surfaceAlt,
    borderRadius: Tokens.radius.xs,
    marginBottom: 6,
  },
  skeletonShort: {
    width: '60%',
  },
});
