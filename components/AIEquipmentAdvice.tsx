import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { RefreshCw, TrendingUp, ArrowRight, Tag, ClipboardList } from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import {
  analyzeEquipmentRentVsBuy, getCachedResult, setCachedResult,
  type EquipmentAdviceResult,
} from '@/utils/aiService';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';
import { showAILimitAlert } from '@/utils/aiLimitAlert';
import { useRouter } from 'expo-router';
import type { Equipment } from '@/types';
import type { SubscriptionTierKey } from '@/utils/aiRateLimiter';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';

interface Props {
  equipment: Equipment;
  subscriptionTier: SubscriptionTierKey;
}

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

const REC_STYLES = {
  rent: { label: 'Keep Renting', Icon: RefreshCw, color: "#1565C0", bg: Colors.infoLight },
  buy: { label: 'Buy It', Icon: Tag, color: "#2E7D44", bg: Colors.successLight },
  lease: { label: 'Consider Leasing', Icon: ClipboardList, color: Colors.warning, bg: Colors.warningLight },
} as const;

export default React.memo(function AIEquipmentAdvice({ equipment, subscriptionTier }: Props) {
  const styles = useThemedStyles(makeStyles);
  const [result, setResult] = useState<EquipmentAdviceResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleAnalyze = useCallback(async () => {
    if (isLoading) return;

    const cacheKey = `equip_advice_${equipment.id}`;
    const cached = await getCachedResult<EquipmentAdviceResult>(cacheKey, SEVEN_DAYS);
    if (cached) {
      setResult(cached);
      return;
    }

    const limit = await checkAILimit(subscriptionTier, 'fast', 'equipmentAdvice');
    if (!limit.allowed) {
      showAILimitAlert({ limit, router });
      return;
    }

    setIsLoading(true);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const uniqueProjects = new Set(equipment.utilizationLog.map(u => u.projectId)).size;
      const avgDays = equipment.utilizationLog.length > 0
        ? Math.round(equipment.utilizationLog.reduce((s, u) => s + u.hoursUsed, 0) / (uniqueProjects || 1) / 8)
        : 12;

      const data = await analyzeEquipmentRentVsBuy(equipment, Math.max(uniqueProjects, 2), avgDays);
      await recordAIUsage('fast', 'equipmentAdvice');
      await setCachedResult(cacheKey, data);
      setResult(data);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.log('[AI Equipment] Analysis failed:', err);
      showAlert('AI Error', 'Could not analyze equipment. Try again.');
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, equipment, subscriptionTier]);

  if (!result) {
    return (
      <TouchableOpacity style={styles.triggerBtn} onPress={handleAnalyze} activeOpacity={0.7} disabled={isLoading}>
        {isLoading ? (
          <ActivityIndicator size="small" color={"#FF6A1A"} />
        ) : (
          <MageAIMark size={16} color={"#FF6A1A"} />
        )}
        <Text style={styles.triggerText}>{isLoading ? 'Analyzing...' : 'AI Rent vs Buy Advice'}</Text>
      </TouchableOpacity>
    );
  }

  const rec = REC_STYLES[result.recommendation] ?? REC_STYLES.rent;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <MageAIMark size={12} color={"#FF6A1A"} />
        <Text style={styles.headerTitle}>Rent vs Buy: {equipment.name}</Text>
        <Text style={styles.aiTag}>AI-generated</Text>
      </View>

      <View style={[styles.recBadge, { backgroundColor: rec.bg }]}>
        <rec.Icon size={15} color={rec.color} strokeWidth={2} />
        <Text style={[styles.recLabel, { color: rec.color }]}>RECOMMENDATION: {rec.label.toUpperCase()}</Text>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Annual rental</Text>
          <Text style={styles.statValue}>${result.annualRentalCost.toLocaleString()}</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Purchase price</Text>
          <Text style={styles.statValue}>{result.purchasePrice}</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Break-even</Text>
          <Text style={styles.statValue}>{result.breakEvenProjects}+ projects/yr</Text>
        </View>
      </View>

      <Text style={styles.reasoning}>{result.reasoning}</Text>

      <View style={styles.reconsiderRow}>
        <ArrowRight size={12} color={"#9AA3AD"} strokeWidth={1.75} />
        <Text style={styles.reconsiderText}>{result.reconsiderWhen}</Text>
      </View>
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
  recBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: Tokens.radius.md,
    padding: 12,
    marginBottom: 12,
  },
  recIcon: {
    fontSize: Type.subheadline.fontSize,
  },
  recLabel: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '800' as const,
    letterSpacing: 0.5,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  statItem: {
    flex: 1,
    backgroundColor: Colors.fillSecondary,
    borderRadius: Tokens.radius.sm,
    padding: 10,
    alignItems: 'center',
    gap: 2,
  },
  statLabel: {
    fontSize: 10,
    color: t.textMuted,
    fontWeight: '500' as const,
  },
  statValue: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '700' as const,
    color: t.text,
    textAlign: 'center' as const,
  },
  reasoning: {
    fontSize: Type.footnote.fontSize,
    color: t.text,
    lineHeight: 19,
    marginBottom: 8,
  },
  reconsiderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: Colors.fillSecondary,
    borderRadius: Tokens.radius.sm,
    padding: 10,
  },
  reconsiderText: {
    fontSize: Type.caption1.fontSize,
    color: t.textSecondary,
    flex: 1,
    lineHeight: 17,
    fontStyle: 'italic' as const,
  },
});
