import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Lock, Unlock, FolderOpen, ChevronRight, AlertCircle, CheckCircle2,
  TrendingUp, Receipt, ArrowLeft, HelpCircle,
} from 'lucide-react-native';
import { FeatureExplainerSheet } from '@/components/FeatureExplainerSheet';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import type { Invoice, Project } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { formatMoney } from '@/utils/formatters';
import { effectiveRetentionHeld, pendingRetentionHeld } from '@/utils/invoiceBilling';
import { NATIVE_HEADER_TITLE_FACE } from '@/constants/navigation';

// HEALTH-F5: sign-correct money via the one formatter — no local Math.abs copies.
const formatCurrency = (n: number): string => formatMoney(n);
const formatCurrencyPrecise = (n: number): string => formatMoney(n, 2);

interface ProjectRetention {
  project: Project;
  totalContract: number;
  retentionHeld: number;
  retentionReleased: number;
  retentionPending: number;
  invoicesWithRetention: Invoice[];
}

export default function RetentionScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { projectId: scopeProjectId } = useLocalSearchParams<{ projectId?: string }>();
  const { projects, invoices } = useProjects();
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(scopeProjectId ?? null);
  const [explainerOpen, setExplainerOpen] = useState(false);

  const projectRetention = useMemo<ProjectRetention[]>(() => {
    // Audit 2026-09-07 ("Worth doing" #27). This filtered on the STORED
    // `retentionPercent` column, so an invoice that is genuinely holding money
    // — a legacy row with a retentionAmount but no percent, or one whose
    // percent was cleared after the fact — was missing from the Retention
    // screen entirely while the money stayed withheld. The population is now
    // the same helper that decides the amount: if effectiveRetentionHeld says
    // this invoice holds a dollar, this screen shows it.
    const relevantInvoices = invoices.filter(inv => effectiveRetentionHeld(inv) > 0);
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
      // MONEY-05: the withholding is the shared helper's (percentage of work
      // value), not the stored column — this screen caps how much a GC can
      // release, so a stale stored figure stranded $283.48 as permanently
      // "pending" on the founder's Houston invoice while the invoice screen
      // capped the release at the smaller, correct number.
      const retentionHeld = invs.reduce((s, i) => s + effectiveRetentionHeld(i), 0);
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
          headerStyle: { backgroundColor: themeColors.bg },
          headerTintColor: themeColors.accent,
          headerTitleStyle: { ...NATIVE_HEADER_TITLE_FACE, color: themeColors.text },
          // Audit 2026-09-07 ("Worth doing" #22/#27): "retention" is a term a
          // residential GC may never have met, and nothing on this screen said
          // what the percentage is taken OF.
          headerRight: () => (
            <TouchableOpacity
              onPress={() => setExplainerOpen(true)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="What is retention?"
              testID="retention-explainer-chip"
            >
              <HelpCircle size={20} color={themeColors.textSecondary} strokeWidth={2} />
            </TouchableOpacity>
          ),
        }}
      />

      <FeatureExplainerSheet
        visible={explainerOpen}
        onClose={() => setExplainerOpen(false)}
        term="Retention (Retainage)"
        definition={
          'Retention is a slice of every progress payment the client keeps back — commonly 5% or 10% — '
          + 'until the job is substantially complete and the punch list is cleared. It is your money; '
          + 'it is just being held. MAGE computes it on the WORK VALUE — the invoice subtotal, before '
          + 'sales tax — because you remit that tax to the state whether or not the client holds '
          + 'retention, so withholding against it would hold back money you have already paid out.'
        }
        whenToUse={[
          'When a contract says the owner holds 5% or 10% until substantial completion',
          'At closeout, to see exactly what is still owed to you across every job',
          'Before you release retention to a sub — hold yours until yours is released',
        ]}
      />

      <ScrollView
        {...fabScroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroIconWrap}>
            <Lock size={28} color={Colors.warningLabel} strokeWidth={1.75} />
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
            <Lock size={14} color={Colors.warningLabel} strokeWidth={1.75} />
            <Text style={styles.metricValue}>{formatCurrency(totals.totalHeld)}</Text>
            <Text style={styles.metricLabel}>Total Held</Text>
          </View>
          <View style={[styles.metricCard, { borderColor: themeColors.success + '40' }]}>
            <Unlock size={14} color={themeColors.success} strokeWidth={1.75} />
            <Text style={styles.metricValue}>{formatCurrency(totals.totalReleased)}</Text>
            <Text style={styles.metricLabel}>Released</Text>
          </View>
          <View style={[styles.metricCard, { borderColor: themeColors.danger + '40' }]}>
            <AlertCircle size={14} color={themeColors.danger} strokeWidth={1.75} />
            <Text style={styles.metricValue}>{formatCurrency(totals.totalPending)}</Text>
            <Text style={styles.metricLabel}>Pending</Text>
          </View>
        </View>

        {/* THE BASIS, stated where the figures are (audit 2026-09-07,
            "Worth doing" #27). The arithmetic has been right since MISS-04 —
            retainage is computed on the subtotal — but only app/invoice.tsx
            ever said so, so a client reading "Retention held (5%)" next to a
            tax-inclusive total multiplied it on his phone, got a different
            number, and called. */}
        {projectRetention.length > 0 && (
          <Text style={styles.basisNote} testID="retention-basis-note">
            Held on the work value — the invoice subtotal, before sales tax. Multiplying the percentage by
            an invoice total that includes tax gives a larger number; that is not what is being held.
          </Text>
        )}

        {/* Explainer */}
        {projectRetention.length === 0 && (
          <View style={styles.emptyState}>
            <Lock size={36} color={themeColors.textMuted} strokeWidth={1.75} />
            <Text style={styles.emptyTitle}>No Retention Held Yet</Text>
            <Text style={styles.emptyBody}>
              When you set a Retention % on an invoice (e.g. 10%), that amount is held back by the client until punch list is cleared or substantial completion. It will appear here so you can track and release it.
            </Text>
            <TouchableOpacity style={styles.emptyBtn} onPress={() => router.back()} activeOpacity={0.8}>
              <ArrowLeft size={14} color={themeColors.accent} strokeWidth={1.75} />
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
                    <CheckCircle2 size={18} color={themeColors.success} strokeWidth={1.75} />
                  ) : (
                    <FolderOpen size={18} color={themeColors.accent} strokeWidth={1.75} />
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
                  <Text style={[styles.projectAmount, isComplete && { color: themeColors.success }]}>
                    {formatCurrency(pr.retentionPending)}
                  </Text>
                  <Text style={styles.projectAmountLabel}>{isComplete ? 'complete' : 'pending'}</Text>
                </View>
                <ChevronRight
                  size={18}
                  color={themeColors.textMuted}
                  style={{ transform: [{ rotate: expanded ? '90deg' : '0deg' }] }} strokeWidth={1.75}
                />
              </TouchableOpacity>

              {/* Progress bar */}
              <View style={styles.progressBarWrap}>
                <View style={styles.progressBarTrack}>
                  <View style={[styles.progressBarFill, { width: `${Math.min(releasePct, 100)}%`, backgroundColor: isComplete ? themeColors.success : Colors.warning }]} />
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
                    <Text style={[styles.detailLabel, { color: Colors.warningLabel }]}>Retention Held</Text>
                    <Text style={[styles.detailValue, { color: Colors.warningLabel }]}>{formatCurrencyPrecise(pr.retentionHeld)}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={[styles.detailLabel, { color: themeColors.success }]}>Released</Text>
                    <Text style={[styles.detailValue, { color: themeColors.success }]}>{formatCurrencyPrecise(pr.retentionReleased)}</Text>
                  </View>
                  <View style={[styles.detailRow, { borderTopWidth: 1, borderTopColor: themeColors.line, paddingTop: 8, marginTop: 4 }]}>
                    <Text style={styles.detailLabelBold}>Pending Release</Text>
                    <Text style={[styles.detailValueBold, { color: isComplete ? themeColors.success : themeColors.danger }]}>
                      {formatCurrencyPrecise(pr.retentionPending)}
                    </Text>
                  </View>

                  <Text style={styles.invoicesSectionLabel}>Invoices</Text>
                  {pr.invoicesWithRetention.map(inv => {
                    const invPending = pendingRetentionHeld(inv);
                    const invDone = invPending < 0.01 && (inv.retentionReleased ?? 0) > 0;
                    return (
                      <TouchableOpacity
                        key={inv.id}
                        style={styles.invoiceRow}
                        onPress={() => openInvoice(inv)}
                        activeOpacity={0.7}
                      >
                        <View style={styles.invoiceIconWrap}>
                          <Receipt size={14} color={themeColors.accent} strokeWidth={1.75} />
                        </View>
                        <View style={{ flex: 1 }}>
                          {/* A row can now reach this screen on a stored
                              retainage amount with no percent on file (see the
                              effectiveRetentionHeld filter above), so the
                              percent is only printed when there is one. */}
                          <Text style={styles.invoiceTitle}>
                            Invoice #{inv.number}
                            {(inv.retentionPercent ?? 0) > 0
                              ? ` · ${inv.retentionPercent}% of work value`
                              : ' · retainage on file'}
                          </Text>
                          <Text style={styles.invoiceMeta}>
                            {new Date(inv.issueDate).toLocaleDateString()}
                            {' · '}
                            {formatCurrency(inv.totalDue)} total
                          </Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' as const, gap: 2 }}>
                          <Text style={[styles.invoiceRetention, { color: invDone ? themeColors.success : Colors.warning }]}>
                            {formatCurrency(invPending)}
                          </Text>
                          <Text style={styles.invoiceRetentionLabel}>
                            {invDone ? 'released' : 'pending'}
                          </Text>
                        </View>
                        <ChevronRight size={14} color={themeColors.textMuted} strokeWidth={1.75} />
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
            <TrendingUp size={16} color={themeColors.accent} strokeWidth={1.75} />
            <Text style={styles.tipText}>
              Release retention from inside each invoice. Common triggers: substantial completion, punch list clearance, final inspection sign-off.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  hero: { alignItems: 'center' as const, paddingVertical: 28, paddingHorizontal: 20, gap: 6 },
  heroIconWrap: { width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.warning + '15', alignItems: 'center' as const, justifyContent: 'center' as const, marginBottom: 8 },
  heroAmount: { fontSize: 36, fontWeight: '800' as const, color: t.text, letterSpacing: -1.2 },
  heroLabel: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary, fontWeight: '600' as const },
  heroMeta: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 4 },

  metricsRow: { flexDirection: 'row' as const, gap: 10, paddingHorizontal: 16, marginBottom: 20 },
  metricCard: { flex: 1, backgroundColor: t.surface, borderRadius: Tokens.radius.lg, padding: 12, borderWidth: 1, gap: 4, alignItems: 'flex-start' as const },
  metricValue: { fontSize: Type.subheadline.fontSize, fontWeight: '800' as const, color: t.text, marginTop: 4 },
  metricLabel: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '600' as const },

  basisNote: {
    marginHorizontal: 16, marginTop: -8, marginBottom: 16,
    fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17,
  },

  emptyState: { margin: 16, padding: 28, backgroundColor: t.surface, borderRadius: Tokens.radius.panel, borderWidth: 1, borderColor: t.line, alignItems: 'center' as const, gap: 10 },
  emptyTitle: { fontSize: Type.body.fontSize, fontWeight: '700' as const, color: t.text, marginTop: 6 },
  emptyBody: { fontSize: Type.footnote.fontSize, color: t.textSecondary, textAlign: 'center' as const, lineHeight: 19 },
  emptyBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, paddingVertical: 10, paddingHorizontal: 16, borderRadius: Tokens.radius.md, backgroundColor: t.accent + '15', marginTop: 6 },
  emptyBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.accent },

  projectCard: { marginHorizontal: 16, marginBottom: 12, backgroundColor: t.surface, borderRadius: Tokens.radius.panel, borderWidth: 1, borderColor: t.line, overflow: 'hidden' as const },
  projectHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, padding: 14 },
  projectIconWrap: { width: 36, height: 36, borderRadius: Tokens.radius.md, backgroundColor: t.surfaceAlt, alignItems: 'center' as const, justifyContent: 'center' as const },
  projectName: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  projectMeta: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 2 },
  projectAmountWrap: { alignItems: 'flex-end' as const },
  projectAmount: { fontSize: Type.callout.fontSize, fontWeight: '800' as const, color: Colors.warningLabel },
  projectAmountLabel: { fontSize: 10, color: t.textMuted, fontWeight: '600' as const, textTransform: 'uppercase' as const, letterSpacing: 0.4 },

  progressBarWrap: { paddingHorizontal: 14, paddingBottom: 12, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  progressBarTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: Colors.fillSecondary, overflow: 'hidden' as const },
  progressBarFill: { height: '100%' as const, borderRadius: 3 },
  progressBarText: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '600' as const, minWidth: 70, textAlign: 'right' as const },

  expandedSection: { borderTopWidth: 1, borderTopColor: t.line, padding: 14, gap: 6 },
  detailRow: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, paddingVertical: 3 },
  detailLabel: { fontSize: Type.footnote.fontSize, color: t.textSecondary, fontWeight: '500' as const },
  detailValue: { fontSize: Type.footnote.fontSize, color: t.text, fontWeight: '600' as const },
  detailLabelBold: { fontSize: Type.bodyCompact.fontSize, color: t.text, fontWeight: '700' as const },
  detailValueBold: { fontSize: Type.bodyCompact.fontSize, fontWeight: '800' as const },

  invoicesSectionLabel: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: t.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.6, marginTop: 10, marginBottom: 4 },
  invoiceRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, paddingVertical: 8 },
  invoiceIconWrap: { width: 28, height: 28, borderRadius: Tokens.radius.sm, backgroundColor: t.accent + '12', alignItems: 'center' as const, justifyContent: 'center' as const },
  invoiceTitle: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.text },
  invoiceMeta: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: 2 },
  invoiceRetention: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const },
  invoiceRetentionLabel: { fontSize: 10, color: t.textMuted, fontWeight: '600' as const },

  tipCard: { marginHorizontal: 16, marginTop: 8, padding: 14, backgroundColor: t.accent + '10', borderRadius: Tokens.radius.card, flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 10 },
  tipText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.accent, lineHeight: 17, fontWeight: '500' as const },
});
