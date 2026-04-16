import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Animated,
  Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Sparkles, AlertTriangle, CheckCircle2, ChevronRight, TrendingDown } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import {
  generateHomeBriefing, getCachedResult, setCachedResult,
  type HomeBriefingResult,
} from '@/utils/aiService';
import { checkAILimit, recordAIUsage, getAIUsageStats } from '@/utils/aiRateLimiter';
import type { Project, Invoice } from '@/types';
import type { SubscriptionTierKey } from '@/utils/aiRateLimiter';

interface Props {
  projects: Project[];
  invoices: Invoice[];
  subscriptionTier: SubscriptionTierKey;
  onViewFull?: () => void;
}

const FOUR_HOURS = 4 * 60 * 60 * 1000;

const STATUS_ICONS = {
  on_track: { Icon: CheckCircle2, color: '#34C759', bg: '#E8F5E9' },
  at_risk: { Icon: AlertTriangle, color: '#FF9500', bg: '#FFF3E0' },
  behind: { Icon: TrendingDown, color: '#FF3B30', bg: '#FFF0EF' },
} as const;

export default React.memo(function AIHomeBriefing({ projects, invoices, subscriptionTier, onViewFull }: Props) {
  const [result, setResult] = useState<HomeBriefingResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [usageText, setUsageText] = useState('');
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

  const loadUsage = useCallback(async () => {
    const stats = await getAIUsageStats(subscriptionTier);
    setUsageText(`${stats.used}/${stats.limit} today`);
  }, [subscriptionTier]);

  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

  const fetchBriefing = useCallback(async () => {
    if (!Array.isArray(projects) || projects.length === 0 || isLoading) return;

    const today = new Date().toISOString().split('T')[0];
    const cacheKey = `home_briefing_${today}`;
    const cached = await getCachedResult<HomeBriefingResult>(cacheKey, FOUR_HOURS);
    if (cached) {
      setResult(cached);
      return;
    }

    const limit = await checkAILimit(subscriptionTier, 'fast');
    if (!limit.allowed) return;

    setIsLoading(true);
    try {
      const data = await generateHomeBriefing(projects, invoices);
      await recordAIUsage('fast');
      await setCachedResult(cacheKey, data);
      setResult(data);
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      void loadUsage();
    } catch (err) {
      console.log('[AI Briefing] Failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [projects, invoices, subscriptionTier, isLoading, loadUsage]);

  useEffect(() => {
    if (safeProjects.length > 0) {
      void fetchBriefing();
    }
  }, [projects.length]);

  const safeProjects = Array.isArray(projects) ? projects : [];
  if (safeProjects.length === 0) return null;

  if (isLoading && !result) {
    const shimmerOpacity = shimmerAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [0.4, 0.8],
    });
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Sparkles size={14} color={Colors.primary} />
            <Text style={styles.headerTitle}>MAGE AI Daily Briefing</Text>
          </View>
        </View>
        <Animated.View style={[styles.skeletonLine, { opacity: shimmerOpacity }]} />
        <Animated.View style={[styles.skeletonLine, styles.skeletonShort, { opacity: shimmerOpacity }]} />
        <Animated.View style={[styles.skeletonLine, styles.skeletonMedium, { opacity: shimmerOpacity }]} />
      </View>
    );
  }

  if (!result) return null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Sparkles size={14} color={Colors.primary} />
          <Text style={styles.headerTitle}>MAGE AI Daily Briefing</Text>
        </View>
        <Text style={styles.aiLabel}>AI-generated</Text>
      </View>

      <Text style={styles.briefingText}>{result.briefing}</Text>

      {(Array.isArray(result.projects) ? result.projects : []).map((proj, idx) => {
        const config = STATUS_ICONS[proj.status] ?? STATUS_ICONS.on_track;
        const StatusIcon = config.Icon;
        return (
          <View key={idx} style={styles.projectRow}>
            <View style={[styles.statusDot, { backgroundColor: config.bg }]}>
              <StatusIcon size={12} color={config.color} />
            </View>
            <View style={styles.projectInfo}>
              <Text style={styles.projectName}>{proj.name}</Text>
              <Text style={styles.projectInsight}>{proj.keyInsight}</Text>
              {proj.actionItem ? (
                <Text style={styles.actionItem}>→ {proj.actionItem}</Text>
              ) : null}
            </View>
          </View>
        );
      })}

      {(Array.isArray(result.urgentItems) ? result.urgentItems : []).length > 0 && (
        <View style={styles.urgentSection}>
          {(Array.isArray(result.urgentItems) ? result.urgentItems : []).map((item, idx) => (
            <View key={idx} style={styles.urgentRow}>
              <AlertTriangle size={12} color="#FF3B30" />
              <Text style={styles.urgentText}>{item}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.footer}>
        {onViewFull ? (
          <TouchableOpacity
            onPress={onViewFull}
            style={styles.viewFullBtn}
            activeOpacity={0.7}
          >
            <Text style={styles.viewFullText}>View Full Analysis</Text>
            <ChevronRight size={14} color={Colors.primary} />
          </TouchableOpacity>
        ) : <View />}
        <Text style={styles.usageText}>{usageText}</Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 20,
    marginBottom: 20,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerTitle: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.text,
    letterSpacing: 0.2,
  },
  aiLabel: {
    fontSize: 10,
    color: Colors.textMuted,
    fontWeight: '500' as const,
  },
  briefingText: {
    fontSize: 14,
    color: Colors.text,
    lineHeight: 20,
    marginBottom: 12,
  },
  projectRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
    paddingTop: 10,
    borderTopWidth: 0.5,
    borderTopColor: Colors.borderLight,
  },
  statusDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  projectInfo: {
    flex: 1,
    gap: 2,
  },
  projectName: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  projectInsight: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  actionItem: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: '500' as const,
    marginTop: 2,
  },
  urgentSection: {
    backgroundColor: '#FFF0EF',
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
    gap: 6,
  },
  urgentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  urgentText: {
    fontSize: 13,
    color: '#D32F2F',
    flex: 1,
    lineHeight: 18,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 0.5,
    borderTopColor: Colors.borderLight,
  },
  viewFullBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  viewFullText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  usageText: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: '500' as const,
  },
  skeletonLine: {
    height: 12,
    backgroundColor: Colors.fillTertiary,
    borderRadius: 6,
    marginBottom: 8,
    width: '100%',
  },
  skeletonShort: {
    width: '60%',
  },
  skeletonMedium: {
    width: '80%',
  },
});
