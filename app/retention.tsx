import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Lock, Unlock, FolderOpen, ChevronRight, AlertCircle, CheckCircle2,
  TrendingUp, Receipt, ArrowLeft,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import type { Invoice, Project } from '@/types';

function formatCurrency(n: number): string {
  return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatCurrencyPrecise(n: number): string {
  return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface ProjectRetention {
  project: Project;
  totalContract: number;
  retentionHeld: number;
  retentionReleased: number;
  retentionPending: number;
  invoicesWithRetention: Invoice[];
}

export default function RetentionScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projectId: scopeProjectId } = useLocalSearchParams<{ projectId?: string }>();
  const { projects, invoices } = useProjects();
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(scopeProjectId ?? null);

  const projectRetention = useMemo<ProjectRetention[]>(() => {
    const relevantInvoices = invoices.filter(inv => (inv.retentionPercent ?? 0) > 0);
    const byProject: Record<string, Invoice[]> = {};
    relevantInvoices.forEach(inv => {
      if (!byProject[inv.projectId]) byProject[inv.projectId] = [];
      byProject[inv.projectId].push(inv);
    });
    const list: ProjectRetention[] = [];
    Object.entries(byProject).forEach(([pid, invs]) => {
      const project = projects.find(p => p.id === pid);
      if (!project) return;
      if (scopeProjectId && pid !== scopeProjectId) return;
      const totalContract = invs.reduce((s, i) => s + (i.totalDue ?? 0), 0);
      const retentionHeld = invs.reduce((s, i) => s + (i.retentionAmount ?? 0), 0);
      const retentionReleased = invs.reduce((s, i) => s + (i.retentionReleased ?? 0), 0);
      const retentionPending = Math.max(0, retentionHeld - retentionReleased);
      list.push({
        project,
        totalContract,
        retentionHeld,
        retentionReleased,
        retentionPending,
        invoicesWithRetention: invs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
      });
    });
    return list.sort((a, b) => b.retentionPending - a.retentionPending);
  }, [projects, invoices, scopeProjectId]);

  const totals = useMemo(() => {
    const totalHeld = projectRetention.reduce((s, p) => s + p.retentionHeld, 0);
    const totalReleased = projectRetention.reduce((s, p) => s + p.retentionReleased, 0);
    const totalPending = projectRetention.reduce((s, p) => s + p.retentionPending, 0);
    const projectsWithRetention = projectRetention.length;
    const fullyReleased = projectRetention.filter(p => p.retentionPending < 0.01 && p.retentionReleased > 0).length;
    return { totalHeld, totalReleased, totalPending, projectsWithRetention, fullyReleased };
  }, [projectRetention]);

  const toggleExpand = (pid: string) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setExpandedProjectId(prev => (prev === pid ? null : pid));
  };

  const openInvoice = (inv: Invoice) => {
    router.push({ pathname: '/invoice', params: { projectId: inv.projectId, invoiceId: inv.id } } as any);
  };

  const scopedProject = scopeProjectId ? projects.find(p => p.id === scopeProjectId) : null;

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: scopedProject ? `${scopedProject.name} · Retention` : 'Retention',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
        }}
      />

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroIconWrap}>
            <Lock size={28} color={Colors.warning} />
          </View>
          <Text style={styles.heroAmount}>{formatCurrencyPrecise(totals.totalPending)}</Text>
          <Text style={styles.heroLabel}>Retention Pending Release</Text>
          {totals.projectsWithRetention > 0 && (
            <Text style={styles.heroMeta}>
              Across {totals.projectsWithRetention} project{totals.projectsWithRetention === 1 ? '' : 's'}
              {totals.fullyReleased > 0 ? ` · ${totals.fullyReleased} fully released` : ''}
            </Text>
          )}
        </View>

        {/* Metrics */}
        <View style={styles.metricsRow}>
          <View style={[styles.metricCard, { borderColor: Colors.warning + '40' }]}>
            <Lock size={14} color={Colors.warning} />
            <Text style={styles.metricValue}>{formatCurrency(totals.totalHeld)}</Text>
            <Text style={styles.metricLabel}>Total Held</Text>
          </View>
          <View style={[styles.metricCard, { borderColor: Colors.success + '40' }]}>
            <Unlock size={14} color={Colors.success} />
            <Text style={styles.metricValue}>{formatCurrency(totals.totalReleased)}</Text>
            <Text style={styles.metricLabel}>Released</Text>
          </View>
          <View style={[styles.metricCard, { borderColor: Colors.error + '40' }]}>
            <AlertCircle size={14} color={Colors.error} />
            <Text style={styles.metricValue}>{formatCurrency(totals.totalPending)}</Text>
            <Text style={styles.metricLabel}>Pending</Text>
          </View>
        </View>

        {/* Explainer */}
        {projectRetention.length === 0 && (
          <View style={styles.emptyState}>
            <Lock size={36} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No Retention Held Yet</Text>
            <Text style={styles.emptyBody}>
              When you set a Retention % on an invoice (e.g. 10%), that amount is held back by the client until punch list is cleared or substantial completion. It will appear here so you can track and release it.
            </Text>
            <TouchableOpacity style={styles.emptyBtn} onPress={() => router.back()} activeOpacity={0.8}>
              <ArrowLeft size={14} color={Colors.primary} />
              <Text style={styles.emptyBtnText}>Back</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Per-project */}
        {projectRetention.map(pr => {
          const expanded = expandedProjectId === pr.project.id;
          const releasePct = pr.retentionHeld > 0 ? Math.round((pr.retentionReleased / pr.retentionHeld) * 100) : 0;
          const isComplete = pr.retentionPending < 0.01 && pr.retentionReleased > 0;
          return (
            <View key={pr.project.id} style={styles.projectCard}>
              <TouchableOpacity
                style={styles.projectHeader}
                onPress={() => toggleExpand(pr.project.id)}
                activeOpacity={0.75}
              >
                <View style={styles.projectIconWrap}>
                  {isComplete ? (
                    <CheckCircle2 size={18} color={Colors.success} />
                  ) : (
                    <FolderOpen size={18} color={Colors.primary} />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.projectName} numberOfLines={1}>{pr.project.name}</Text>
                  <Text style={styles.projectMeta}>
                    {pr.invoicesWithRetention.length} invoice{pr.invoicesWithRetention.length === 1 ? '' : 's'} with retention
                    {isComplete ? ' · Fully released' : ''}
                  </Text>
                </View>
                <View style={styles.projectAmountWrap}>
                  <Text style={[styles.projectAmount, isComplete && { color: Colors.success }]}>
                    {formatCurrency(pr.retentionPending)}
                  </Text>
                  <Text style={styles.projectAmountLabel}>{isComplete ? 'complete' : 'pending'}</Text>
                </View>
                <ChevronRight
                  size={18}
                  color={Colors.textMuted}
                  style={{ transform: [{ rotate: expanded ? '90deg' : '0deg' }] }}
                />
              </TouchableOpacity>

              {/* Progress bar */}
              <View style={styles.progressBarWrap}>
                <View style={styles.progressBarTrack}>
                  <View style={[styles.progressBarFill, { width: `${Math.min(releasePct, 100)}%`, backgroundColor: isComplete ? Colors.success : Colors.warning }]} />
                </View>
                <Text style={styles.progressBarText}>{releasePct}% released</Text>
              </View>

              {expanded && (
                <View style={styles.expandedSection}>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Contract Billed</Text>
                    <Text style={styles.detailValue}>{formatCurrencyPrecise(pr.totalContract)}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={[styles.detailLabel, { color: Colors.warning }]}>Retention Held</Text>
                    <Text style={[styles.detailValue, { color: Colors.warning }]}>{formatCurrencyPrecise(pr.retentionHeld)}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={[styles.detailLabel, { color: Colors.success }]}>Released</Text>
                    <Text style={[styles.detailValue, { color: Colors.success }]}>{formatCurrencyPrecise(pr.retentionReleased)}</Text>
                  </View>
                  <View style={[styles.detailRow, { borderTopWidth: 1, borderTopColor: Colors.borderLight, paddingTop: 8, marginTop: 4 }]}>
                    <Text style={styles.detailLabelBold}>Pending Release</Text>
                    <Text style={[styles.detailValueBold, { color: isComplete ? Colors.success : Colors.error }]}>
                      {formatCurrencyPrecise(pr.retentionPending)}
                    </Text>
                  </View>

                  <Text style={styles.invoicesSectionLabel}>Invoices</Text>
                  {pr.invoicesWithRetention.map(inv => {
                    const invPending = Math.max(0, (inv.retentionAmount ?? 0) - (inv.retentionReleased ?? 0));
                    const invDone = invPending < 0.01 && (inv.retentionReleased ?? 0) > 0;
                    return (
                      <TouchableOpacity
                        key={inv.id}
                        style={styles.invoiceRow}
                        onPress={() => openInvoice(inv)}
                        activeOpacity={0.7}
                      >
                        <View style={styles.invoiceIconWrap}>
                          <Receipt size={14} color={Colors.primary} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.invoiceTitle}>
                            Invoice #{inv.number} · {inv.retentionPercent}%
                          </Text>
                          <Text style={styles.invoiceMeta}>
                            {new Date(inv.issueDate).toLocaleDateString()}
                            {' · '}
                            {formatCurrency(inv.totalDue)} total
                          </Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' as const, gap: 2 }}>
                          <Text style={[styles.invoiceRetention, { color: invDone ? Colors.success : Colors.warning }]}>
                            {formatCurrency(invPending)}
                          </Text>
                          <Text style={styles.invoiceRetentionLabel}>
                            {invDone ? 'released' : 'pending'}
                          </Text>
                        </View>
                        <ChevronRight size={14} color={Colors.textMuted} />
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>
          );
        })}

        {projectRetention.length > 0 && !scopeProjectId && (
          <View style={styles.tipCard}>
            <TrendingUp size={16} color={Colors.primary} />
            <Text style={styles.tipText}>
              Release retention from inside each invoice. Common triggers: substantial completion, punch list clearance, final inspection sign-off.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  hero: { alignItems: 'center' as const, paddingVertical: 28, paddingHorizontal: 20, gap: 6 },
  heroIconWrap: { width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.warning + '15', alignItems: 'center' as const, justifyContent: 'center' as const, marginBottom: 8 },
  heroAmount: { fontSize: 36, fontWeight: '800' as const, color: Colors.text, letterSpacing: -1.2 },
  heroLabel: { fontSize: 14, color: Colors.textSecondary, fontWeight: '600' as const },
  heroMeta: { fontSize: 12, color: Colors.textMuted, marginTop: 4 },

  metricsRow: { flexDirection: 'row' as const, gap: 10, paddingHorizontal: 16, marginBottom: 20 },
  metricCard: { flex: 1, backgroundColor: Colors.surface, borderRadius: 14, padding: 12, borderWidth: 1, gap: 4, alignItems: 'flex-start' as const },
  metricValue: { fontSize: 18, fontWeight: '800' as const, color: Colors.text, marginTop: 4 },
  metricLabel: { fontSize: 11, color: Colors.textMuted, fontWeight: '600' as const },

  emptyState: { margin: 16, padding: 28, backgroundColor: Colors.surface, borderRadius: 16, borderWidth: 1, borderColor: Colors.cardBorder, alignItems: 'center' as const, gap: 10 },
  emptyTitle: { fontSize: 17, fontWeight: '700' as const, color: Colors.text, marginTop: 6 },
  emptyBody: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center' as const, lineHeight: 19 },
  emptyBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, backgroundColor: Colors.primary + '15', marginTop: 6 },
  emptyBtnText: { fontSize: 13, fontWeight: '600' as const, color: Colors.primary },

  projectCard: { marginHorizontal: 16, marginBottom: 12, backgroundColor: Colors.surface, borderRadius: 16, borderWidth: 1, borderColor: Colors.cardBorder, overflow: 'hidden' as const },
  projectHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, padding: 14 },
  projectIconWrap: { width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.fillTertiary, alignItems: 'center' as const, justifyContent: 'center' as const },
  projectName: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  projectMeta: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  projectAmountWrap: { alignItems: 'flex-end' as const },
  projectAmount: { fontSize: 16, fontWeight: '800' as const, color: Colors.warning },
  projectAmountLabel: { fontSize: 10, color: Colors.textMuted, fontWeight: '600' as const, textTransform: 'uppercase' as const, letterSpacing: 0.4 },

  progressBarWrap: { paddingHorizontal: 14, paddingBottom: 12, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  progressBarTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: Colors.fillSecondary, overflow: 'hidden' as const },
  progressBarFill: { height: '100%' as const, borderRadius: 3 },
  progressBarText: { fontSize: 11, color: Colors.textMuted, fontWeight: '600' as const, minWidth: 70, textAlign: 'right' as const },

  expandedSection: { borderTopWidth: 1, borderTopColor: Colors.borderLight, padding: 14, gap: 6 },
  detailRow: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, paddingVertical: 3 },
  detailLabel: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' as const },
  detailValue: { fontSize: 13, color: Colors.text, fontWeight: '600' as const },
  detailLabelBold: { fontSize: 14, color: Colors.text, fontWeight: '700' as const },
  detailValueBold: { fontSize: 14, fontWeight: '800' as const },

  invoicesSectionLabel: { fontSize: 11, fontWeight: '700' as const, color: Colors.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.6, marginTop: 10, marginBottom: 4 },
  invoiceRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, paddingVertical: 8 },
  invoiceIconWrap: { width: 28, height: 28, borderRadius: 8, backgroundColor: Colors.primary + '12', alignItems: 'center' as const, justifyContent: 'center' as const },
  invoiceTitle: { fontSize: 13, fontWeight: '600' as const, color: Colors.text },
  invoiceMeta: { fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  invoiceRetention: { fontSize: 14, fontWeight: '700' as const },
  invoiceRetentionLabel: { fontSize: 10, color: Colors.textMuted, fontWeight: '600' as const },

  tipCard: { marginHorizontal: 16, marginTop: 8, padding: 14, backgroundColor: Colors.primary + '10', borderRadius: 12, flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 10 },
  tipText: { flex: 1, fontSize: 12, color: Colors.primary, lineHeight: 17, fontWeight: '500' as const },
});
