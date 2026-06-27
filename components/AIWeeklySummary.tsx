import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Modal, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { X, TrendingUp, AlertTriangle, CheckCircle2, Share2, Wrench, Target } from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import ConstructionLoader from '@/components/ConstructionLoader';
import { generateWeeklySummary, type WeeklySummaryResult } from '@/utils/aiService';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';
import { useSubscription } from '@/contexts/SubscriptionContext';
import type { Project } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

interface Props {
  projects: Project[];
  visible: boolean;
  onClose: () => void;
}

const STATUS_CONFIG = {
  on_track: { icon: CheckCircle2, color: "#2E7D44", label: 'ON TRACK', bg: Colors.successLight },
  at_risk: { icon: AlertTriangle, color: Colors.warning, label: 'AT RISK', bg: Colors.warningLight },
  behind: { icon: AlertTriangle, color: "#C84038", label: 'BEHIND', bg: Colors.errorLight },
  ahead: { icon: TrendingUp, color: "#1565C0", label: 'AHEAD', bg: Colors.infoLight },
} as const;

const SEVERITY_CONFIG = {
  critical: { color: '#D32F2F', bg: Colors.errorLight,  label: 'CRITICAL' },
  high:     { color: Colors.warningDark, bg: Colors.warningLight,  label: 'HIGH' },
  medium:   { color: '#F57F17', bg: '#FFFDE7',  label: 'MEDIUM' },
  low:      { color: '#5E6873', bg: '#F2F4F7',  label: 'LOW' },
} as const;

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0, high: 1, medium: 2, low: 3,
};

function formatCurrency(n: number): string {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

export default function AIWeeklySummary({ projects, visible, onClose }: Props) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { tier: subscriptionTier } = useSubscription();
  const [result, setResult] = useState<WeeklySummaryResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  // Track whether the user was blocked by a paywall so the modal can show
  // the upgrade message instead of just spinning forever.
  const [paywallReason, setPaywallReason] = useState<string | null>(null);

  const handleGenerate = useCallback(async () => {
    if (isLoading || projects.length === 0) return;
    // Weekly Full Analysis is Pro+ — large smart-tier prompt + 4500 tokens
    // out is too expensive for free tier.
    const limit = await checkAILimit(subscriptionTier, 'smart', 'weeklyAnalysis');
    if (!limit.allowed) {
      setPaywallReason(limit.message ?? 'Upgrade to unlock Full Analysis.');
      return;
    }
    setIsLoading(true);
    setPaywallReason(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const data = await generateWeeklySummary(projects);
      await recordAIUsage('smart', 'weeklyAnalysis');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setResult(data);
    } catch (err) {
      console.error('[AI Weekly] Failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, projects, subscriptionTier]);

  React.useEffect(() => {
    if (visible && !result && !isLoading && !paywallReason && projects.length > 0) {
      handleGenerate();
    }
  }, [visible, result, isLoading, paywallReason, projects.length, handleGenerate]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <MageAIMark size={18} color={"#FF6A1A"} />
            <Text style={styles.headerTitle}>Full Project Analysis</Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityRole="button" accessibilityLabel="Close"><X size={22} color={"#9AA3AD"} /></TouchableOpacity>
        </View>

        {paywallReason ? (
          <View style={styles.loadingState}>
            <MageAIMark size={40} color={"#FF6A1A"} />
            <Text style={[styles.headerTitle, { marginTop: 16, textAlign: 'center' }]}>Pro Feature</Text>
            <Text style={[styles.loadingSubtext, { marginTop: 8, textAlign: 'center', paddingHorizontal: 24 }]}>{paywallReason}</Text>
          </View>
        ) : isLoading && !result ? (
          <View style={styles.loadingState}>
            <ConstructionLoader size="lg" label="Analyzing your portfolio..." />
            <Text style={styles.loadingSubtext}>Reviewing {projects.length} project(s)</Text>
          </View>
        ) : result ? (
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            <View style={styles.weekBadge}>
              <Text style={styles.weekText}>{result.weekRange}</Text>
            </View>

            <View style={styles.overviewCard}>
              <Text style={styles.sectionLabel}>PORTFOLIO OVERVIEW</Text>
              <View style={styles.overviewGrid}>
                <View style={styles.overviewItem}>
                  <Text style={styles.overviewValue}>{result.portfolioSummary?.totalProjects ?? 0}</Text>
                  <Text style={styles.overviewLabel}>Active</Text>
                </View>
                <View style={styles.overviewItem}>
                  <Text style={[styles.overviewValue, { color: "#2E7D44" }]}>{result.portfolioSummary?.onTrack ?? 0}</Text>
                  <Text style={styles.overviewLabel}>On Track</Text>
                </View>
                <View style={styles.overviewItem}>
                  <Text style={[styles.overviewValue, { color: Colors.warning }]}>{result.portfolioSummary?.atRisk ?? 0}</Text>
                  <Text style={styles.overviewLabel}>At Risk</Text>
                </View>
                <View style={styles.overviewItem}>
                  <Text style={styles.overviewValue}>{result.portfolioSummary?.tasksCompletedThisWeek ?? 0}</Text>
                  <Text style={styles.overviewLabel}>Completed</Text>
                </View>
              </View>
              <View style={styles.combinedValue}>
                <Text style={styles.combinedLabel}>Combined portfolio value</Text>
                <Text style={styles.combinedAmount}>{formatCurrency(result.portfolioSummary?.combinedValue ?? 0)}</Text>
              </View>
            </View>

            {/* Issues breakdown — the main reason the GC opened Full Analysis.
                Each issue has a clear cause / impact / fix structure. Sorted
                by severity so the worst stuff is at the top. */}
            {(result.criticalIssues ?? []).length > 0 ? (
              <View style={styles.issuesSection}>
                <View style={styles.issuesHeader}>
                  <AlertTriangle size={16} color={"#C84038"} />
                  <Text style={styles.issuesTitle}>Issues breakdown</Text>
                  <View style={styles.issuesCountPill}>
                    <Text style={styles.issuesCountText}>{result.criticalIssues.length}</Text>
                  </View>
                </View>
                <Text style={styles.issuesHelper}>
                  What&apos;s wrong, why it&apos;s happening, and what to do about it. Sorted by severity.
                </Text>

                {[...result.criticalIssues]
                  .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9))
                  .map((iss, idx) => {
                    const sev = SEVERITY_CONFIG[iss.severity] ?? SEVERITY_CONFIG.medium;
                    return (
                      <View key={idx} style={[styles.issueCard, { borderLeftColor: sev.color }]}>
                        <View style={styles.issueHead}>
                          <View style={[styles.severityPill, { backgroundColor: sev.bg }]}>
                            <Text style={[styles.severityText, { color: sev.color }]}>{sev.label}</Text>
                          </View>
                          {iss.projectName ? (
                            <Text style={styles.issueProject} numberOfLines={1}>{iss.projectName}</Text>
                          ) : null}
                        </View>

                        <Text style={styles.issueText}>{iss.issue}</Text>

                        {iss.cause ? (
                          <View style={styles.issueRow}>
                            <View style={[styles.issueRowIcon, { backgroundColor: Colors.warningLight }]}>
                              <Target size={11} color={Colors.warningDark} />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.issueRowLabel}>CAUSE</Text>
                              <Text style={styles.issueRowText}>{iss.cause}</Text>
                            </View>
                          </View>
                        ) : null}

                        {iss.impact ? (
                          <View style={styles.issueRow}>
                            <View style={[styles.issueRowIcon, { backgroundColor: Colors.errorLight }]}>
                              <MageAIMark size={11} color="#D32F2F" />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.issueRowLabel}>IMPACT</Text>
                              <Text style={styles.issueRowText}>{iss.impact}</Text>
                            </View>
                          </View>
                        ) : null}

                        {iss.fix ? (
                          <View style={[styles.issueRow, styles.issueRowFix]}>
                            <View style={[styles.issueRowIcon, { backgroundColor: Colors.successLight }]}>
                              <Wrench size={11} color={Colors.successDark} />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.issueRowLabel, { color: Colors.successDark }]}>NEXT STEP</Text>
                              <Text style={[styles.issueRowText, styles.issueRowFixText]}>{iss.fix}</Text>
                            </View>
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
              </View>
            ) : (
              <View style={styles.noIssuesCard}>
                <CheckCircle2 size={20} color={"#2E7D44"} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.noIssuesTitle}>Nothing critical to flag</Text>
                  <Text style={styles.noIssuesBody}>
                    AI didn&apos;t spot any blocking issues this week. Project status is below.
                  </Text>
                </View>
              </View>
            )}

            {(result.projects ?? []).map((proj, idx) => {
              const config = STATUS_CONFIG[proj.status] ?? STATUS_CONFIG.on_track;
              const StatusIcon = config.icon;
              return (
                <View key={idx} style={styles.projectCard}>
                  <View style={styles.projectHeader}>
                    <Text style={styles.projectName}>{proj.name}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: config.bg }]}>
                      <StatusIcon size={12} color={config.color} />
                      <Text style={[styles.statusText, { color: config.color }]}>{config.label}</Text>
                    </View>
                  </View>

                  <View style={styles.progressRow}>
                    <Text style={styles.progressLabel}>Progress:</Text>
                    <Text style={styles.progressValue}>
                      {proj.progressStart}% → {proj.progressEnd}%{' '}
                      <Text style={{ color: "#2E7D44" }}>
                        (+{proj.progressEnd - proj.progressStart}% this week)
                      </Text>
                    </Text>
                  </View>

                  <View style={styles.progressBar}>
                    <View style={[styles.progressFill, { width: `${Math.min(proj.progressEnd, 100)}%` }]} />
                  </View>

                  <Text style={styles.keyLabel}>Key: {proj.keyAccomplishment}</Text>
                  {proj.primaryRisk !== 'None' && (
                    <Text style={styles.riskLabel}>Risk: {proj.primaryRisk}</Text>
                  )}
                  {proj.recommendation ? (
                    <Text style={styles.recLabel}>→ {proj.recommendation}</Text>
                  ) : null}
                </View>
              );
            })}

            {result.overallRecommendation ? (
              <View style={styles.overallRec}>
                <MageAIMark size={14} color={"#FF6A1A"} />
                <Text style={styles.overallRecText}>{result.overallRecommendation}</Text>
              </View>
            ) : null}

            <Text style={styles.aiDisclaimer}>Generated by MAGE AI</Text>
          </ScrollView>
        ) : (
          <View style={styles.loadingState}>
            <Text style={styles.loadingText}>No projects to analyze</Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: t.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: t.line,
    backgroundColor: t.surface,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: Type.body.fontSize,
    fontWeight: '700' as const,
    color: t.text,
  },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: Type.callout.fontSize,
    fontWeight: '600' as const,
    color: t.text,
  },
  loadingSubtext: {
    fontSize: Type.bodyCompact.fontSize,
    color: t.textSecondary,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
    gap: 12,
  },
  weekBadge: {
    alignSelf: 'center',
    backgroundColor: t.surfaceAlt,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: Tokens.radius.card,
  },
  weekText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: t.textSecondary,
  },
  overviewCard: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.lg,
    padding: 16,
    borderWidth: 0.5,
    borderColor: t.line,
    gap: 12,
  },
  sectionLabel: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: t.textMuted,
    letterSpacing: 1,
  },
  overviewGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  overviewItem: {
    flex: 1,
    alignItems: 'center',
    padding: 10,
    backgroundColor: Colors.fillSecondary,
    borderRadius: Tokens.radius.md,
  },
  overviewValue: {
    fontSize: Type.title2.fontSize,
    fontWeight: '800' as const,
    color: t.text,
  },
  overviewLabel: {
    fontSize: Type.caption2.fontSize,
    color: t.textMuted,
    fontWeight: '500' as const,
  },
  combinedValue: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: t.line,
  },
  combinedLabel: {
    fontSize: Type.footnote.fontSize,
    color: t.textSecondary,
  },
  combinedAmount: {
    fontSize: Type.subheadline.fontSize,
    fontWeight: '800' as const,
    color: t.text,
  },
  projectCard: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.lg,
    padding: 16,
    borderWidth: 0.5,
    borderColor: t.line,
    gap: 8,
  },
  projectHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  projectName: {
    fontSize: Type.callout.fontSize,
    fontWeight: '700' as const,
    color: t.text,
    flex: 1,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Tokens.radius.xs,
  },
  statusText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
  },
  progressRow: {
    flexDirection: 'row',
    gap: 4,
  },
  progressLabel: {
    fontSize: Type.footnote.fontSize,
    color: t.textSecondary,
  },
  progressValue: {
    fontSize: Type.footnote.fontSize,
    color: t.text,
    fontWeight: '600' as const,
  },
  progressBar: {
    height: 6,
    backgroundColor: t.surfaceAlt,
    borderRadius: 3,
  },
  progressFill: {
    height: 6,
    backgroundColor: t.accent,
    borderRadius: 3,
  },
  keyLabel: {
    fontSize: Type.footnote.fontSize,
    color: t.text,
  },
  riskLabel: {
    fontSize: Type.footnote.fontSize,
    color: Colors.warning,
  },
  recLabel: {
    fontSize: Type.footnote.fontSize,
    color: t.accent,
    fontWeight: '600' as const,
  },
  overallRec: {
    flexDirection: 'row',
    gap: 8,
    padding: 16,
    backgroundColor: `${t.accent}08`,
    borderRadius: Tokens.radius.lg,
    borderWidth: 1,
    borderColor: `${t.accent}15`,
  },
  overallRecText: {
    fontSize: Type.bodyCompact.fontSize,
    color: t.text,
    lineHeight: 20,
    flex: 1,
  },
  aiDisclaimer: {
    fontSize: Type.caption2.fontSize,
    color: t.textMuted,
    textAlign: 'center',
    marginTop: 8,
  },

  // ─── Issues breakdown ───
  issuesSection: {
    marginTop: 4,
    marginBottom: 16,
  },
  issuesHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 6,
  },
  issuesTitle: {
    flex: 1,
    fontSize: Type.callout.fontSize,
    fontWeight: '800' as const,
    color: t.text,
    letterSpacing: -0.2,
  },
  issuesCountPill: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: Tokens.radius.full,
    backgroundColor: t.danger + '15',
  },
  issuesCountText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '800' as const,
    color: t.danger,
    letterSpacing: 0.4,
  },
  issuesHelper: {
    fontSize: Type.caption1.fontSize,
    color: t.textMuted,
    marginBottom: 12,
    lineHeight: 17,
  },
  issueCard: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.card,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: t.line,
    borderLeftWidth: 4,
    gap: 10,
  },
  issueHead: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  severityPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: Tokens.radius.full,
  },
  severityText: {
    fontSize: 9,
    fontWeight: '800' as const,
    letterSpacing: 0.6,
  },
  issueProject: {
    flex: 1,
    fontSize: Type.caption1.fontSize,
    fontWeight: '700' as const,
    color: t.textSecondary,
  },
  issueText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: t.text,
    lineHeight: 20,
    letterSpacing: -0.1,
  },
  issueRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 10,
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: t.line,
  },
  issueRowFix: {
    paddingTop: 10,
    paddingBottom: 4,
  },
  issueRowIcon: {
    width: 20,
    height: 20,
    borderRadius: Tokens.radius.xs,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginTop: 2,
  },
  issueRowLabel: {
    fontSize: 9,
    fontWeight: '800' as const,
    color: t.textMuted,
    letterSpacing: 0.8,
    marginBottom: 3,
  },
  issueRowText: {
    fontSize: Type.footnote.fontSize,
    color: t.text,
    lineHeight: 18,
  },
  issueRowFixText: {
    color: '#1B5E20',
    fontWeight: '600' as const,
  },
  noIssuesCard: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    padding: 14,
    borderRadius: Tokens.radius.card,
    backgroundColor: t.success + '0D',
    borderWidth: 1,
    borderColor: t.success + '30',
    marginBottom: 16,
  },
  noIssuesTitle: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '800' as const,
    color: t.success,
  },
  noIssuesBody: {
    fontSize: Type.caption1.fontSize,
    color: t.textSecondary,
    lineHeight: 17,
    marginTop: 2,
  },
});
