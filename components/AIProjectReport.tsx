import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert,
  ScrollView, Modal, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Sparkles, X, CheckCircle2, AlertTriangle, Target, FileText } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import {
  generateProjectReport, getCachedResult, setCachedResult,
  type ProjectReportResult,
} from '@/utils/aiService';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';
import type { Project, Invoice, ChangeOrder } from '@/types';
import type { SubscriptionTierKey } from '@/utils/aiRateLimiter';

interface Props {
  project: Project;
  invoices: Invoice[];
  changeOrders: ChangeOrder[];
  subscriptionTier: SubscriptionTierKey;
}

const TWO_HOURS = 2 * 60 * 60 * 1000;

export default React.memo(function AIProjectReport({ project, invoices, changeOrders, subscriptionTier }: Props) {
  const insets = useSafeAreaInsets();
  const [result, setResult] = useState<ProjectReportResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const handleGenerate = useCallback(async () => {
    if (isLoading) return;

    const cacheKey = `proj_report_${project.id}`;
    const cached = await getCachedResult<ProjectReportResult>(cacheKey, TWO_HOURS);
    if (cached) {
      setResult(cached);
      setShowModal(true);
      return;
    }

    const limit = await checkAILimit(subscriptionTier, 'smart');
    if (!limit.allowed) {
      Alert.alert('AI Limit Reached', limit.message ?? 'Try again tomorrow.');
      return;
    }

    setIsLoading(true);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const data = await generateProjectReport(project, invoices, changeOrders);
      await recordAIUsage('smart');
      await setCachedResult(cacheKey, data);
      setResult(data);
      setShowModal(true);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.log('[AI Report] Generation failed:', err);
      Alert.alert('AI Error', 'Could not generate report. Try again.');
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, project, invoices, changeOrders, subscriptionTier]);

  return (
    <>
      <TouchableOpacity style={styles.triggerBtn} onPress={handleGenerate} activeOpacity={0.7} disabled={isLoading}>
        {isLoading ? (
          <ActivityIndicator size="small" color={Colors.primary} />
        ) : (
          <Sparkles size={16} color={Colors.primary} />
        )}
        <Text style={styles.triggerText}>{isLoading ? 'Generating Report...' : 'AI Project Report'}</Text>
      </TouchableOpacity>

      <Modal
        visible={showModal}
        animationType="slide"
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
        onRequestClose={() => setShowModal(false)}
      >
        <View style={[styles.modalContainer, { paddingTop: Platform.OS === 'ios' ? 12 : insets.top + 8 }]}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <View style={styles.headerLeft}>
              <Sparkles size={16} color={Colors.primary} />
              <Text style={styles.modalTitle}>Project Status Report</Text>
            </View>
            <TouchableOpacity onPress={() => setShowModal(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <X size={22} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {result && (
            <ScrollView style={styles.scroll} contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 30 }]}>
              <View style={styles.projectBanner}>
                <Text style={styles.projectName}>{project.name}</Text>
                <Text style={styles.projectMeta}>{project.type} · {project.location}</Text>
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Executive Summary</Text>
                <Text style={styles.sectionText}>{result.executiveSummary}</Text>
              </View>

              <View style={styles.twoCol}>
                <View style={[styles.statusCard, { borderLeftColor: Colors.info }]}>
                  <FileText size={14} color={Colors.info} />
                  <Text style={styles.statusLabel}>Schedule Status</Text>
                  <Text style={styles.statusText}>{result.scheduleStatus}</Text>
                </View>
                <View style={[styles.statusCard, { borderLeftColor: Colors.success }]}>
                  <FileText size={14} color={Colors.success} />
                  <Text style={styles.statusLabel}>Budget Status</Text>
                  <Text style={styles.statusText}>{result.budgetStatus}</Text>
                </View>
              </View>

              {(result.keyAccomplishments ?? []).length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Key Accomplishments</Text>
                  {(result.keyAccomplishments ?? []).map((item, idx) => (
                    <View key={idx} style={styles.listRow}>
                      <CheckCircle2 size={13} color={Colors.success} />
                      <Text style={styles.listText}>{item}</Text>
                    </View>
                  ))}
                </View>
              )}

              {(result.issuesAndRisks ?? []).length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Issues & Risks</Text>
                  {(result.issuesAndRisks ?? []).map((item, idx) => (
                    <View key={idx} style={styles.listRow}>
                      <AlertTriangle size={13} color={Colors.warning} />
                      <Text style={styles.listText}>{item}</Text>
                    </View>
                  ))}
                </View>
              )}

              {(result.nextMilestones ?? []).length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Next Milestones</Text>
                  {(result.nextMilestones ?? []).map((item, idx) => (
                    <View key={idx} style={styles.listRow}>
                      <Target size={13} color={Colors.primary} />
                      <Text style={styles.listText}>{item}</Text>
                    </View>
                  ))}
                </View>
              )}

              {(result.recommendations ?? []).length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Recommendations</Text>
                  {(result.recommendations ?? []).map((item, idx) => (
                    <View key={idx} style={styles.listRow}>
                      <Sparkles size={13} color={Colors.primary} />
                      <Text style={[styles.listText, { color: Colors.primary, fontWeight: '500' as const }]}>{item}</Text>
                    </View>
                  ))}
                </View>
              )}

              <Text style={styles.disclaimer}>Generated by MAGE AI · AI-generated</Text>
            </ScrollView>
          )}
        </View>
      </Modal>
    </>
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
    borderWidth: 1,
    borderColor: Colors.primary + '25',
  },
  triggerText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  modalHandle: {
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 12,
  },
  projectBanner: {
    backgroundColor: Colors.primary + '0A',
    borderRadius: 12,
    padding: 16,
    borderLeftWidth: 4,
    borderLeftColor: Colors.primary,
  },
  projectName: {
    fontSize: 18,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  projectMeta: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  section: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 0.5,
    borderColor: Colors.borderLight,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  sectionText: {
    fontSize: 14,
    color: Colors.text,
    lineHeight: 21,
  },
  twoCol: {
    flexDirection: 'row',
    gap: 10,
  },
  statusCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    borderLeftWidth: 3,
    gap: 4,
  },
  statusLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: '600' as const,
    textTransform: 'uppercase' as const,
  },
  statusText: {
    fontSize: 13,
    color: Colors.text,
    lineHeight: 18,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  listText: {
    fontSize: 14,
    color: Colors.text,
    lineHeight: 20,
    flex: 1,
  },
  disclaimer: {
    fontSize: 11,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: 8,
  },
});
