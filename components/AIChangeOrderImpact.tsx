import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, TextInput, Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { CalendarDays, DollarSign, ArrowRight, HelpCircle, BookOpen } from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { analyzeChangeOrderImpact, type ChangeOrderImpactResult } from '@/utils/aiService';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';
import { showAILimitAlert } from '@/utils/aiLimitAlert';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useRouter } from 'expo-router';
import type { Project, ProjectSchedule } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

interface Props {
  changeDescription: string;
  lineItems: { name: string; quantity: number; unitPrice: number; total: number }[];
  schedule: ProjectSchedule | null;
  /** Pass all projects so the analysis can ground pace and cost-rate facts. */
  projects?: Project[];
}

function formatCurrency(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export default React.memo(function AIChangeOrderImpact({ changeDescription, lineItems, schedule, projects }: Props) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { tier } = useSubscription();
  const router = useRouter();
  const [result, setResult] = useState<ChangeOrderImpactResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  // Holds the user's answer to a clarifying question so they can re-analyze.
  const [clarifyAnswer, setClarifyAnswer] = useState('');

  const handleAnalyze = useCallback(async (descriptionOverride?: string) => {
    const desc = (descriptionOverride ?? changeDescription).trim();
    if (isLoading || !desc) return;

    const limit = await checkAILimit(tier, 'fast', 'changeOrderImpact');
    if (!limit.allowed) {
      showAILimitAlert({ limit, router });
      return;
    }

    setIsLoading(true);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const data = await analyzeChangeOrderImpact(desc, lineItems, schedule, projects);
      await recordAIUsage('fast', 'changeOrderImpact');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setResult(data);
      setIsExpanded(true);
    } catch (err) {
      console.error('[AI CO Impact] Failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, changeDescription, lineItems, schedule, projects, tier, router]);

  if (!result) {
    return (
      <TouchableOpacity
        style={[styles.triggerBtn, !changeDescription.trim() && styles.triggerDisabled]}
        onPress={() => void handleAnalyze()}
        disabled={isLoading || !changeDescription.trim()}
      >
        {isLoading ? (
          <ActivityIndicator size="small" color={themeColors.accent} />
        ) : (
          <MageAIMark size={16} color={changeDescription.trim() ? themeColors.accent : themeColors.textMuted} />
        )}
        <Text style={[styles.triggerText, !changeDescription.trim() && { color: themeColors.textMuted }]}>
          {isLoading ? 'Analyzing Impact...' : 'Analyze Impact with AI'}
        </Text>
      </TouchableOpacity>
    );
  }

  // Thin-description path: model returned a clarifying question instead of an analysis.
  if (result.clarifyQuestion) {
    return (
      <View style={styles.card}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <HelpCircle size={16} color={themeColors.accent} strokeWidth={1.75} />
            <Text style={styles.headerTitle}>One question first</Text>
          </View>
        </View>
        <Text style={styles.clarifyQ}>{result.clarifyQuestion}</Text>
        <TextInput
          style={styles.clarifyInput}
          value={clarifyAnswer}
          onChangeText={setClarifyAnswer}
          placeholder="e.g. Electrical — add 4 recessed lights in the living room"
          placeholderTextColor={themeColors.textMuted}
          multiline
          textAlignVertical="top"
        />
        <TouchableOpacity
          style={[styles.triggerBtn, !clarifyAnswer.trim() && styles.triggerDisabled]}
          onPress={() => {
            if (!clarifyAnswer.trim()) return;
            void handleAnalyze(`${changeDescription} — ${clarifyAnswer}`);
          }}
          disabled={isLoading || !clarifyAnswer.trim()}
        >
          {isLoading
            ? <ActivityIndicator size="small" color={themeColors.accent} />
            : <MageAIMark size={16} color={clarifyAnswer.trim() ? themeColors.accent : themeColors.textMuted} />}
          <Text style={[styles.triggerText, !clarifyAnswer.trim() && { color: themeColors.textMuted }]}>
            {isLoading ? 'Analyzing...' : 'Analyze Impact'}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  const groundedOn: string[] = result.groundedOn ?? [];

  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.header} onPress={() => setIsExpanded(!isExpanded)}>
        <View style={styles.headerLeft}>
          <MageAIMark size={16} color={themeColors.accent} />
          <Text style={styles.headerTitle}>Change Order Impact Analysis</Text>
        </View>
        <Text style={styles.aiTag}>AI</Text>
      </TouchableOpacity>
      {groundedOn.length > 0 && (
        <View style={styles.groundingRow}>
          <BookOpen size={11} color={themeColors.textMuted} strokeWidth={1.75} />
          <Text style={styles.groundingText}>
            Checked against: {groundedOn.join(' · ')}
          </Text>
        </View>
      )}

      {isExpanded && (
        <>
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <CalendarDays size={14} color={themeColors.info} strokeWidth={1.75} />
              <Text style={styles.sectionTitle}>Schedule Impact</Text>
            </View>
            <Text style={styles.impactValue}>+{result.scheduleDays} days</Text>
            {(result.affectedTasks ?? []).map((task, idx) => (
              <View key={idx} style={styles.taskRow}>
                <ArrowRight size={12} color={themeColors.textMuted} strokeWidth={1.75} />
                <Text style={styles.taskText}>
                  "{task.taskName}" pushed {task.daysAdded}d ({task.currentEnd} → {task.newEnd})
                </Text>
              </View>
            ))}
            <Text style={styles.endDate}>New project end: {result.newProjectEndDate}</Text>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <DollarSign size={14} color={themeColors.success} strokeWidth={1.75} />
              <Text style={styles.sectionTitle}>Cost Impact</Text>
            </View>
            <View style={styles.costGrid}>
              <View style={styles.costItem}>
                <Text style={styles.costLabel}>Materials</Text>
                <Text style={styles.costValue}>{formatCurrency(result.costImpact?.materials ?? 0)}</Text>
              </View>
              <View style={styles.costItem}>
                <Text style={styles.costLabel}>Labor</Text>
                <Text style={styles.costValue}>{formatCurrency(result.costImpact?.labor ?? 0)}</Text>
              </View>
              <View style={styles.costItem}>
                <Text style={styles.costLabel}>Equipment</Text>
                <Text style={styles.costValue}>{formatCurrency(result.costImpact?.equipment ?? 0)}</Text>
              </View>
              <View style={[styles.costItem, { backgroundColor: `${themeColors.accent}10` }]}>
                <Text style={[styles.costLabel, { fontWeight: '700' as const }]}>Total</Text>
                <Text style={[styles.costValue, { color: themeColors.accent }]}>{formatCurrency(result.costImpact?.total ?? 0)}</Text>
              </View>
            </View>
          </View>

          {(result.downstreamEffects ?? []).length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <MageAIMark size={14} color={Colors.warning} />
                <Text style={styles.sectionTitle}>Downstream Effects</Text>
              </View>
              {(result.downstreamEffects ?? []).map((effect, idx) => (
                <Text key={idx} style={styles.effectText}>• {effect}</Text>
              ))}
            </View>
          )}

          <View style={[styles.section, { backgroundColor: `${themeColors.accent}08` }]}>
            <Text style={styles.recTitle}>Recommendation</Text>
            <Text style={styles.recText}>{result.recommendation}</Text>
          </View>

          {(result.compressionOptions ?? []).length > 0 && (
            <View style={styles.section}>
              <Text style={styles.recTitle}>Compression Options</Text>
              {(result.compressionOptions ?? []).map((opt, idx) => (
                <View key={idx} style={styles.compRow}>
                  <Text style={styles.compDesc}>{opt.description}</Text>
                  <Text style={styles.compMeta}>
                    Save {opt.daysSaved}d for {formatCurrency(opt.costPremium)} premium
                  </Text>
                </View>
              ))}
            </View>
          )}

          <TouchableOpacity style={styles.reanalyzeBtn} onPress={() => void handleAnalyze()} disabled={isLoading}>
            <Text style={styles.reanalyzeText}>{isLoading ? 'Re-analyzing...' : 'Re-analyze'}</Text>
          </TouchableOpacity>
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
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: `${t.accent}08`,
    borderRadius: Tokens.radius.card,
    borderWidth: 1,
    borderColor: `${t.accent}20`,
    marginVertical: 8,
  },
  triggerDisabled: {
    opacity: 0.5,
  },
  triggerText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: t.accent,
  },
  card: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.lg,
    padding: 16,
    marginVertical: 8,
    borderWidth: 0.5,
    borderColor: t.line,
    gap: 12,
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
  aiTag: {
    fontSize: 10,
    fontWeight: '800' as const,
    color: t.accent,
    backgroundColor: `${t.accent}12`,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    letterSpacing: 0.5,
  },
  section: {
    padding: 12,
    backgroundColor: Colors.fillSecondary,
    borderRadius: Tokens.radius.md,
    gap: 6,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionTitle: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: t.text,
  },
  impactValue: {
    fontSize: Type.title2.fontSize,
    fontWeight: '800' as const,
    color: t.danger,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginLeft: 4,
  },
  taskText: {
    fontSize: Type.footnote.fontSize,
    color: t.textSecondary,
    flex: 1,
  },
  endDate: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: t.text,
    marginTop: 4,
  },
  costGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  costItem: {
    flex: 1,
    minWidth: '45%',
    padding: 8,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.sm,
    alignItems: 'center',
  },
  costLabel: {
    fontSize: Type.caption2.fontSize,
    color: t.textMuted,
  },
  costValue: {
    fontSize: Type.callout.fontSize,
    fontWeight: '700' as const,
    color: t.text,
  },
  effectText: {
    fontSize: Type.footnote.fontSize,
    color: t.textSecondary,
  },
  recTitle: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '700' as const,
    color: t.accent,
  },
  recText: {
    fontSize: Type.footnote.fontSize,
    color: t.text,
    lineHeight: 19,
  },
  compRow: {
    padding: 8,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.sm,
    gap: 2,
  },
  compDesc: {
    fontSize: Type.footnote.fontSize,
    color: t.text,
  },
  compMeta: {
    fontSize: Type.caption1.fontSize,
    color: t.textSecondary,
  },
  reanalyzeBtn: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  reanalyzeText: {
    fontSize: Type.footnote.fontSize,
    color: t.accent,
    fontWeight: '600' as const,
  },
  groundingRow: {
    flexDirection: 'row' as const,
    alignItems: 'center',
    gap: 4,
    marginTop: -4,
  },
  groundingText: {
    fontSize: Type.caption2.fontSize,
    color: t.textMuted,
    fontStyle: 'italic' as const,
  },
  clarifyQ: {
    fontSize: Type.bodyCompact.fontSize,
    color: t.text,
    lineHeight: 20,
  },
  clarifyInput: {
    minHeight: 72,
    borderWidth: 1,
    borderColor: t.line,
    borderRadius: Tokens.radius.md,
    padding: 12,
    fontSize: Type.bodyCompact.fontSize,
    color: t.text,
    backgroundColor: t.surfaceAlt,
  },
});
