import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert,
  Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Sparkles, RefreshCw, TrendingUp, ArrowRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import {
  analyzeEquipmentRentVsBuy, getCachedResult, setCachedResult,
  type EquipmentAdviceResult,
} from '@/utils/aiService';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';
import type { Equipment } from '@/types';
import type { SubscriptionTierKey } from '@/utils/aiRateLimiter';

interface Props {
  equipment: Equipment;
  subscriptionTier: SubscriptionTierKey;
}

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

const REC_STYLES = {
  rent: { label: 'Keep Renting', icon: '🔄', color: Colors.info, bg: Colors.infoLight },
  buy: { label: 'Buy It', icon: '🏷️', color: Colors.success, bg: Colors.successLight },
  lease: { label: 'Consider Leasing', icon: '📋', color: Colors.warning, bg: Colors.warningLight },
} as const;

export default React.memo(function AIEquipmentAdvice({ equipment, subscriptionTier }: Props) {
  const [result, setResult] = useState<EquipmentAdviceResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleAnalyze = useCallback(async () => {
    if (isLoading) return;

    const cacheKey = `equip_advice_${equipment.id}`;
    const cached = await getCachedResult<EquipmentAdviceResult>(cacheKey, SEVEN_DAYS);
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
      const uniqueProjects = new Set((equipment.utilizationLog ?? []).map(u => u.projectId)).size;
      const avgDays = (equipment.utilizationLog ?? []).length > 0
        ? Math.round((equipment.utilizationLog ?? []).reduce((s, u) => s + u.hoursUsed, 0) / (uniqueProjects || 1) / 8)
        : 12;

      const data = await analyzeEquipmentRentVsBuy(equipment, Math.max(uniqueProjects, 2), avgDays);
      await recordAIUsage('fast');
      await setCachedResult(cacheKey, data);
      setResult(data);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.log('[AI Equipment] Analysis failed:', err);
      Alert.alert('AI Error', 'Could not analyze equipment. Try again.');
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, equipment, subscriptionTier]);

  if (!result) {
    return (
      <TouchableOpacity style={styles.triggerBtn} onPress={handleAnalyze} activeOpacity={0.7} disabled={isLoading}>
        {isLoading ? (
          <ActivityIndicator size="small" color={Colors.primary} />
        ) : (
          <Sparkles size={16} color={Colors.primary} />
        )}
        <Text style={styles.triggerText}>{isLoading ? 'Analyzing...' : 'AI Rent vs Buy Advice'}</Text>
      </TouchableOpacity>
    );
  }

  const rec = REC_STYLES[result.recommendation] ?? REC_STYLES.rent;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Sparkles size={12} color={Colors.primary} />
        <Text style={styles.headerTitle}>Rent vs Buy: {equipment.name}</Text>
        <Text style={styles.aiTag}>AI-generated</Text>
      </View>

      <View style={[styles.recBadge, { backgroundColor: rec.bg }]}>
        <Text style={styles.recIcon}>{rec.icon}</Text>
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
        <ArrowRight size={12} color={Colors.textSecondary} />
        <Text style={styles.reconsiderText}>{result.reconsiderWhen}</Text>
      </View>
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
  recBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  recIcon: {
    fontSize: 18,
  },
  recLabel: {
    fontSize: 13,
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
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
    gap: 2,
  },
  statLabel: {
    fontSize: 10,
    color: Colors.textMuted,
    fontWeight: '500' as const,
  },
  statValue: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.text,
    textAlign: 'center' as const,
  },
  reasoning: {
    fontSize: 13,
    color: Colors.text,
    lineHeight: 19,
    marginBottom: 8,
  },
  reconsiderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: Colors.fillSecondary,
    borderRadius: 8,
    padding: 10,
  },
  reconsiderText: {
    fontSize: 12,
    color: Colors.textSecondary,
    flex: 1,
    lineHeight: 17,
    fontStyle: 'italic' as const,
  },
});
