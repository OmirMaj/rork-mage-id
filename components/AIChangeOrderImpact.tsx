import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Sparkles, CalendarDays, DollarSign, ArrowRight, Zap } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { analyzeChangeOrderImpact, type ChangeOrderImpactResult } from '@/utils/aiService';
import type { ProjectSchedule } from '@/types';

interface Props {
  changeDescription: string;
  lineItems: Array<{ name: string; quantity: number; unitPrice: number; total: number }>;
  schedule: ProjectSchedule | null;
}

function formatCurrency(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export default React.memo(function AIChangeOrderImpact({ changeDescription, lineItems, schedule }: Props) {
  const [result, setResult] = useState<ChangeOrderImpactResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);

  const handleAnalyze = useCallback(async () => {
    if (isLoading || !changeDescription.trim()) return;
    setIsLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const data = await analyzeChangeOrderImpact(changeDescription, lineItems, schedule);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setResult(data);
      setIsExpanded(true);
    } catch (err) {
      console.error('[AI CO Impact] Failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, changeDescription, lineItems, schedule]);

  if (!result) {
    return (
      <TouchableOpacity
        style={[styles.triggerBtn, !changeDescription.trim() && styles.triggerDisabled]}
        onPress={handleAnalyze}
        disabled={isLoading || !changeDescription.trim()}
      >
        {isLoading ? (
          <ActivityIndicator size="small" color={Colors.primary} />
        ) : (
          <Sparkles size={16} color={changeDescription.trim() ? Colors.primary : Colors.textMuted} />
        )}
        <Text style={[styles.triggerText, !changeDescription.trim() && { color: Colors.textMuted }]}>
          {isLoading ? 'Analyzing Impact...' : 'Analyze Impact with AI'}
        </Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.header} onPress={() => setIsExpanded(!isExpanded)}>
        <View style={styles.headerLeft}>
          <Sparkles size={16} color={Colors.primary} />
          <Text style={styles.headerTitle}>Change Order Impact Analysis</Text>
        </View>
        <Text style={styles.aiTag}>AI</Text>
      </TouchableOpacity>

      {isExpanded && (
        <>
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <CalendarDays size={14} color={Colors.info} />
              <Text style={styles.sectionTitle}>Schedule Impact</Text>
            </View>
            <Text style={styles.impactValue}>+{result.scheduleDays} days</Text>
            {result.affectedTasks.map((task, idx) => (
              <View key={idx} style={styles.taskRow}>
                <ArrowRight size={12} color={Colors.textMuted} />
                <Text style={styles.taskText}>
                  "{task.taskName}" pushed {task.daysAdded}d ({task.currentEnd} → {task.newEnd})
                </Text>
              </View>
            ))}
            <Text style={styles.endDate}>New project end: {result.newProjectEndDate}</Text>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <DollarSign size={14} color={Colors.success} />
              <Text style={styles.sectionTitle}>Cost Impact</Text>
            </View>
            <View style={styles.costGrid}>
              <View style={styles.costItem}>
                <Text style={styles.costLabel}>Materials</Text>
                <Text style={styles.costValue}>{formatCurrency(result.costImpact.materials)}</Text>
              </View>
              <View style={styles.costItem}>
                <Text style={styles.costLabel}>Labor</Text>
                <Text style={styles.costValue}>{formatCurrency(result.costImpact.labor)}</Text>
              </View>
              <View style={styles.costItem}>
                <Text style={styles.costLabel}>Equipment</Text>
                <Text style={styles.costValue}>{formatCurrency(result.costImpact.equipment)}</Text>
              </View>
              <View style={[styles.costItem, { backgroundColor: `${Colors.primary}10` }]}>
                <Text style={[styles.costLabel, { fontWeight: '700' as const }]}>Total</Text>
                <Text style={[styles.costValue, { color: Colors.primary }]}>{formatCurrency(result.costImpact.total)}</Text>
              </View>
            </View>
          </View>

          {result.downstreamEffects.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Zap size={14} color={Colors.warning} />
                <Text style={styles.sectionTitle}>Downstream Effects</Text>
              </View>
              {result.downstreamEffects.map((effect, idx) => (
                <Text key={idx} style={styles.effectText}>• {effect}</Text>
              ))}
            </View>
          )}

          <View style={[styles.section, { backgroundColor: `${Colors.primary}08` }]}>
            <Text style={styles.recTitle}>Recommendation</Text>
            <Text style={styles.recText}>{result.recommendation}</Text>
          </View>

          {result.compressionOptions.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.recTitle}>Compression Options</Text>
              {result.compressionOptions.map((opt, idx) => (
                <View key={idx} style={styles.compRow}>
                  <Text style={styles.compDesc}>{opt.description}</Text>
                  <Text style={styles.compMeta}>
                    Save {opt.daysSaved}d for {formatCurrency(opt.costPremium)} premium
                  </Text>
                </View>
              ))}
            </View>
          )}

          <TouchableOpacity style={styles.reanalyzeBtn} onPress={handleAnalyze} disabled={isLoading}>
            <Text style={styles.reanalyzeText}>{isLoading ? 'Re-analyzing...' : 'Re-analyze'}</Text>
          </TouchableOpacity>
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
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: `${Colors.primary}08`,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: `${Colors.primary}20`,
    marginVertical: 8,
  },
  triggerDisabled: {
    opacity: 0.5,
  },
  triggerText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    marginVertical: 8,
    borderWidth: 0.5,
    borderColor: Colors.borderLight,
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
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  aiTag: {
    fontSize: 10,
    fontWeight: '800' as const,
    color: Colors.primary,
    backgroundColor: `${Colors.primary}12`,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    letterSpacing: 0.5,
  },
  section: {
    padding: 12,
    backgroundColor: Colors.fillSecondary,
    borderRadius: 10,
    gap: 6,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  impactValue: {
    fontSize: 22,
    fontWeight: '800' as const,
    color: Colors.error,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginLeft: 4,
  },
  taskText: {
    fontSize: 13,
    color: Colors.textSecondary,
    flex: 1,
  },
  endDate: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text,
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
    backgroundColor: Colors.surface,
    borderRadius: 8,
    alignItems: 'center',
  },
  costLabel: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  costValue: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  effectText: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  recTitle: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.primary,
  },
  recText: {
    fontSize: 13,
    color: Colors.text,
    lineHeight: 19,
  },
  compRow: {
    padding: 8,
    backgroundColor: Colors.surface,
    borderRadius: 8,
    gap: 2,
  },
  compDesc: {
    fontSize: 13,
    color: Colors.text,
  },
  compMeta: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  reanalyzeBtn: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  reanalyzeText: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: '600' as const,
  },
});
