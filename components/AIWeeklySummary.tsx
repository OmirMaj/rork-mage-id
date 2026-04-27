import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Sparkles, X, TrendingUp, AlertTriangle, CheckCircle2, Share2, Wrench, Target, Zap } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import ConstructionLoader from '@/components/ConstructionLoader';
import { generateWeeklySummary, type WeeklySummaryResult } from '@/utils/aiService';
import type { Project } from '@/types';

interface Props {
  projects: Project[];
  visible: boolean;
  onClose: () => void;
}

const STATUS_CONFIG = {
  on_track: { icon: CheckCircle2, color: '#34C759', label: 'ON TRACK', bg: '#E8F5E9' },
  at_risk: { icon: AlertTriangle, color: '#FF9500', label: 'AT RISK', bg: '#FFF3E0' },
  behind: { icon: AlertTriangle, color: '#FF3B30', label: 'BEHIND', bg: '#FFF0EF' },
  ahead: { icon: TrendingUp, color: '#007AFF', label: 'AHEAD', bg: '#EBF3FF' },
} as const;

const SEVERITY_CONFIG = {
  critical: { color: '#D32F2F', bg: '#FFEBEE',  label: 'CRITICAL' },
  high:     { color: '#E65100', bg: '#FFF3E0',  label: 'HIGH' },
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
  const insets = useSafeAreaInsets();
  const [result, setResult] = useState<WeeklySummaryResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleGenerate = useCallback(async () => {
    if (isLoading || projects.length === 0) return;
    setIsLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const data = await generateWeeklySummary(projects);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setResult(data);
    } catch (err) {
      console.error('[AI Weekly] Failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, projects]);

  React.useEffect(() => {
    if (visible && !result && !isLoading && projects.length > 0) {
      handleGenerate();
    }
  }, [visible, result, isLoading, projects.length, handleGenerate]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Sparkles size={18} color={Colors.primary} />
            <Text style={styles.headerTitle}>Full Project Analysis</Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <X size={22} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {isLoading && !result ? (
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
                  <Text style={[styles.overviewValue, { color: Colors.success }]}>{result.portfolioSummary?.onTrack ?? 0}</Text>
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
                  <AlertTriangle size={16} color={Colors.error} />
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
                            <View style={[styles.issueRowIcon, { backgroundColor: '#FFF3E0' }]}>
                              <Target size={11} color="#E65100" />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.issueRowLabel}>CAUSE</Text>
                              <Text style={styles.issueRowText}>{iss.cause}</Text>
                            </View>
                          </View>
                        ) : null}

                        {iss.impact ? (
                          <View style={styles.issueRow}>
                            <View style={[styles.issueRowIcon, { backgroundColor: '#FFEBEE' }]}>
                              <Zap size={11} color="#D32F2F" />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.issueRowLabel}>IMPACT</Text>
                              <Text style={styles.issueRowText}>{iss.impact}</Text>
                            </View>
                          </View>
                        ) : null}

                        {iss.fix ? (
                          <View style={[styles.issueRow, styles.issueRowFix]}>
                            <View style={[styles.issueRowIcon, { backgroundColor: '#E8F5E9' }]}>
                              <Wrench size={11} color="#2E7D32" />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.issueRowLabel, { color: '#2E7D32' }]}>NEXT STEP</Text>
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
                <CheckCircle2 size={20} color={Colors.success} />
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
                      <Text style={{ color: Colors.success }}>
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
                <Sparkles size={14} color={Colors.primary} />
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
    backgroundColor: Colors.surface,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  loadingSubtext: {
    fontSize: 14,
    color: Colors.textSecondary,
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
    backgroundColor: Colors.fillTertiary,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 12,
  },
  weekText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  overviewCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 0.5,
    borderColor: Colors.borderLight,
    gap: 12,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: Colors.textMuted,
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
    borderRadius: 10,
  },
  overviewValue: {
    fontSize: 22,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  overviewLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: '500' as const,
  },
  combinedValue: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: Colors.borderLight,
  },
  combinedLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  combinedAmount: {
    fontSize: 18,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  projectCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 0.5,
    borderColor: Colors.borderLight,
    gap: 8,
  },
  projectHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  projectName: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
    flex: 1,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700' as const,
  },
  progressRow: {
    flexDirection: 'row',
    gap: 4,
  },
  progressLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  progressValue: {
    fontSize: 13,
    color: Colors.text,
    fontWeight: '600' as const,
  },
  progressBar: {
    height: 6,
    backgroundColor: Colors.fillTertiary,
    borderRadius: 3,
  },
  progressFill: {
    height: 6,
    backgroundColor: Colors.primary,
    borderRadius: 3,
  },
  keyLabel: {
    fontSize: 13,
    color: Colors.text,
  },
  riskLabel: {
    fontSize: 13,
    color: Colors.warning,
  },
  recLabel: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: '600' as const,
  },
  overallRec: {
    flexDirection: 'row',
    gap: 8,
    padding: 16,
    backgroundColor: `${Colors.primary}08`,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: `${Colors.primary}15`,
  },
  overallRecText: {
    fontSize: 14,
    color: Colors.text,
    lineHeight: 20,
    flex: 1,
  },
  aiDisclaimer: {
    fontSize: 11,
    color: Colors.textMuted,
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
    fontSize: 16,
    fontWeight: '800' as const,
    color: Colors.text,
    letterSpacing: -0.2,
  },
  issuesCountPill: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: Colors.error + '15',
  },
  issuesCountText: {
    fontSize: 11,
    fontWeight: '800' as const,
    color: Colors.error,
    letterSpacing: 0.4,
  },
  issuesHelper: {
    fontSize: 12,
    color: Colors.textMuted,
    marginBottom: 12,
    lineHeight: 17,
  },
  issueCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
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
    borderRadius: 999,
  },
  severityText: {
    fontSize: 9,
    fontWeight: '800' as const,
    letterSpacing: 0.6,
  },
  issueProject: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.textSecondary,
  },
  issueText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text,
    lineHeight: 20,
    letterSpacing: -0.1,
  },
  issueRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 10,
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: Colors.borderLight,
  },
  issueRowFix: {
    paddingTop: 10,
    paddingBottom: 4,
  },
  issueRowIcon: {
    width: 20,
    height: 20,
    borderRadius: 6,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginTop: 2,
  },
  issueRowLabel: {
    fontSize: 9,
    fontWeight: '800' as const,
    color: Colors.textMuted,
    letterSpacing: 0.8,
    marginBottom: 3,
  },
  issueRowText: {
    fontSize: 13,
    color: Colors.text,
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
    borderRadius: 12,
    backgroundColor: Colors.success + '0D',
    borderWidth: 1,
    borderColor: Colors.success + '30',
    marginBottom: 16,
  },
  noIssuesTitle: {
    fontSize: 14,
    fontWeight: '800' as const,
    color: Colors.success,
  },
  noIssuesBody: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 17,
    marginTop: 2,
  },
});
