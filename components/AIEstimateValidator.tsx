import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Sparkles, AlertTriangle, CheckCircle2, Lightbulb, XCircle, Search } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { validateEstimate, type EstimateValidationResult } from '@/utils/aiService';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

interface Props {
  projectType: string;
  squareFootage: number;
  totalCost: number;
  materialCost: number;
  laborCost: number;
  itemCount: number;
  hasContingency: boolean;
  location: string;
}

const ISSUE_ICONS = {
  warning: { Icon: AlertTriangle, color: Colors.warning, bg: Colors.warningLight },
  error: { Icon: XCircle, color: Colors.error, bg: Colors.errorLight },
  suggestion: { Icon: Lightbulb, color: Colors.info, bg: Colors.infoLight },
  ok: { Icon: CheckCircle2, color: Colors.success, bg: Colors.successLight },
} as const;

export default React.memo(function AIEstimateValidator(props: Props) {
  const [result, setResult] = useState<EstimateValidationResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleValidate = useCallback(async () => {
    if (isLoading) return;
    setIsLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const data = await validateEstimate(
        props.projectType,
        props.squareFootage,
        props.totalCost,
        props.materialCost,
        props.laborCost,
        props.itemCount,
        props.hasContingency,
        props.location,
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setResult(data);
      setIsExpanded(true);
    } catch (err) {
      console.error('[AI Estimate] Validation failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, props]);

  if (!result) {
    return (
      <TouchableOpacity style={styles.triggerBtn} onPress={handleValidate} disabled={isLoading}>
        {isLoading ? (
          <ActivityIndicator size="small" color={Colors.primary} />
        ) : (
          <Search size={16} color={Colors.primary} />
        )}
        <Text style={styles.triggerText}>
          {isLoading ? 'Validating...' : 'AI Validate Estimate'}
        </Text>
        <Sparkles size={14} color={Colors.primary} />
      </TouchableOpacity>
    );
  }

  const scoreColor = result.overallScore >= 7 ? Colors.success :
    result.overallScore >= 5 ? Colors.warning : Colors.error;

  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.header} onPress={() => setIsExpanded(!isExpanded)}>
        <View style={styles.headerLeft}>
          <Sparkles size={16} color={Colors.primary} />
          <Text style={styles.headerTitle}>AI Estimate Review</Text>
        </View>
        <View style={[styles.scoreBadge, { backgroundColor: `${scoreColor}15` }]}>
          <Text style={[styles.scoreText, { color: scoreColor }]}>{result.overallScore}/10</Text>
        </View>
      </TouchableOpacity>

      {isExpanded && (
        <>
          {(result.issues ?? []).map((issue, idx) => {
            const config = ISSUE_ICONS[issue.type];
            return (
              <View key={idx} style={[styles.issueRow, { backgroundColor: config.bg }]}>
                <config.Icon size={16} color={config.color} />
                <View style={styles.issueContent}>
                  <Text style={[styles.issueTitle, { color: config.color }]}>{issue.title}</Text>
                  <Text style={styles.issueDetail}>{issue.detail}</Text>
                  {issue.potentialImpact ? (
                    <Text style={styles.issueImpact}>Impact: {issue.potentialImpact}</Text>
                  ) : null}
                </View>
              </View>
            );
          })}

          {(result.missingItems ?? []).length > 0 && (
            <View style={styles.missingSection}>
              <Text style={styles.missingTitle}>Potentially Missing Items:</Text>
              {(result.missingItems ?? []).map((item, idx) => (
                <Text key={idx} style={styles.missingItem}>• {item}</Text>
              ))}
            </View>
          )}

          <Text style={styles.summary}>{result.summary}</Text>

          <TouchableOpacity style={styles.revalidateBtn} onPress={handleValidate} disabled={isLoading}>
            {isLoading ? <ActivityIndicator size="small" color={Colors.primary} /> : null}
            <Text style={styles.revalidateText}>{isLoading ? 'Re-validating...' : 'Re-validate'}</Text>
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
    borderRadius: Tokens.radius.card,
    borderWidth: 1,
    borderColor: `${Colors.primary}20`,
    marginVertical: 8,
  },
  triggerText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.lg,
    padding: 16,
    marginVertical: 8,
    borderWidth: 0.5,
    borderColor: Colors.borderLight,
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
    color: Colors.text,
  },
  scoreBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Tokens.radius.sm,
  },
  scoreText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '800' as const,
  },
  issueRow: {
    flexDirection: 'row',
    gap: 10,
    padding: 12,
    borderRadius: Tokens.radius.md,
  },
  issueContent: {
    flex: 1,
    gap: 2,
  },
  issueTitle: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
  },
  issueDetail: {
    fontSize: Type.footnote.fontSize,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  issueImpact: {
    fontSize: Type.caption1.fontSize,
    color: Colors.textMuted,
    fontStyle: 'italic' as const,
  },
  missingSection: {
    padding: 12,
    backgroundColor: Colors.fillSecondary,
    borderRadius: Tokens.radius.md,
    gap: 4,
  },
  missingTitle: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  missingItem: {
    fontSize: Type.footnote.fontSize,
    color: Colors.textSecondary,
  },
  summary: {
    fontSize: Type.footnote.fontSize,
    color: Colors.textSecondary,
    lineHeight: 19,
    fontStyle: 'italic' as const,
  },
  revalidateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  revalidateText: {
    fontSize: Type.footnote.fontSize,
    color: Colors.primary,
    fontWeight: '600' as const,
  },
});
