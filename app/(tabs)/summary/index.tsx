import React, { useMemo, useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  ClipboardList, DollarSign, AlertTriangle, CheckCircle2, ChevronRight,
  Receipt, Wrench, Calendar, TrendingUp, FolderOpen, FileDown,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import ConstructionLoader from '@/components/ConstructionLoader';
import EmptyState from '@/components/EmptyState';
import CashFlowGlance from '@/components/CashFlowGlance';
import CashFlowAlerts from '@/components/CashFlowAlerts';
import { generateForecast, type CashFlowWeek } from '@/utils/cashFlowEngine';
import { loadCashFlowData, isSetupComplete } from '@/utils/cashFlowStorage';
import { formatMoney, formatMoneyShort } from '@/utils/formatters';
import { computeARAgingReport } from '@/utils/financialReports';
import type { Project } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

// Summary tab: a bird's-eye "what's happening across all my projects" view.
// Each card collapses the key operational numbers (budget, outstanding invoices,
// open punch items, next milestone) so a GC running 6+ projects doesn't have
// to drill into every project to see what needs attention. Tapping a card
// navigates to the full project-detail screen.

interface ProjectSummaryStats {
  project: Project;
  budget: number;
  outstandingInvoices: number;
  paidInvoices: number;
  openPunchItems: number;
  urgentPunchItems: number;
  nextMilestone: { title: string; date: string } | null;
  pendingChangeOrders: number;
  healthScore: 'good' | 'watch' | 'risk';
  healthReason: string;
}

function daysFromNow(iso: string): number {
  const diff = new Date(iso).getTime() - Date.now();
  return Math.round(diff / (1000 * 60 * 60 * 24));
}

function computeStats(
  project: Project,
  invoices: ReturnType<typeof useProjects>['invoices'],
  punchItems: ReturnType<typeof useProjects>['punchItems'],
  changeOrders: ReturnType<typeof useProjects>['changeOrders'],
): ProjectSummaryStats {
  const projInvoices = invoices.filter(i => i.projectId === project.id);
  const projPunch = punchItems.filter(pi => pi.projectId === project.id);
  const projCOs = changeOrders.filter(co => co.projectId === project.id);

  const outstandingInvoices = projInvoices
    .filter(i => i.status !== 'paid')
    .reduce((sum, i) => sum + Math.max(0, (i.totalDue ?? 0) - (i.amountPaid ?? 0)), 0);
  const paidInvoices = projInvoices
    .reduce((sum, i) => sum + (i.amountPaid ?? 0), 0);

  const openPunch = projPunch.filter(pi => pi.status !== 'closed');
  const urgentPunch = openPunch.filter(pi => pi.priority === 'high');

  const pendingCOs = projCOs.filter(co =>
    co.status === 'submitted' || co.status === 'under_review',
  ).length;

  // Next scheduled milestone: next task marked isMilestone with a future startDay,
  // measured against the schedule.startDate (fall back to project.createdAt).
  let nextMilestone: { title: string; date: string } | null = null;
  if (project.schedule) {
    const startBase = project.schedule.startDate
      ? new Date(project.schedule.startDate)
      : new Date(project.createdAt);
    const candidates = project.schedule.tasks
      .filter(t => t.isMilestone && t.status !== 'done')
      .map(t => {
        const d = new Date(startBase);
        d.setDate(d.getDate() + (t.startDay ?? 0));
        return { title: t.title, dateObj: d };
      })
      .filter(c => c.dateObj.getTime() >= Date.now() - 24 * 60 * 60 * 1000)
      .sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime());
    if (candidates.length > 0) {
      nextMilestone = {
        title: candidates[0].title,
        date: candidates[0].dateObj.toISOString(),
      };
    }
  }

  const budget = project.linkedEstimate?.grandTotal
    ?? project.estimate?.grandTotal
    ?? 0;

  // Health score — simple rollup. Risk = high-priority punch items open OR an
  // invoice is more than 30 days past due. Watch = any open change orders or
  // any overdue invoice under 30 days. Good otherwise.
  let health: ProjectSummaryStats['healthScore'] = 'good';
  let reason = 'On track';
  const overdueInvoices = projInvoices.filter(i => {
    if (i.status === 'paid') return false;
    const dueDiff = daysFromNow(i.dueDate);
    return dueDiff < 0;
  });
  if (urgentPunch.length > 0) {
    health = 'risk';
    reason = `${urgentPunch.length} high-priority punch item${urgentPunch.length === 1 ? '' : 's'}`;
  } else if (overdueInvoices.some(i => daysFromNow(i.dueDate) < -30)) {
    health = 'risk';
    reason = 'Invoice 30+ days overdue';
  } else if (overdueInvoices.length > 0) {
    health = 'watch';
    reason = `${overdueInvoices.length} overdue invoice${overdueInvoices.length === 1 ? '' : 's'}`;
  } else if (pendingCOs > 0) {
    health = 'watch';
    reason = `${pendingCOs} change order${pendingCOs === 1 ? '' : 's'} awaiting approval`;
  }

  return {
    project,
    budget,
    outstandingInvoices,
    paidInvoices,
    openPunchItems: openPunch.length,
    urgentPunchItems: urgentPunch.length,
    nextMilestone,
    pendingChangeOrders: pendingCOs,
    healthScore: health,
    healthReason: reason,
  };
}

export default function SummaryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projects, invoices, punchItems, changeOrders, isLoading } = useProjects();

  const active = useMemo(
    () => projects.filter(p => p.status !== 'closed' && p.status !== 'completed'),
    [projects],
  );

  const stats = useMemo<ProjectSummaryStats[]>(
    () => active.map(p => computeStats(p, invoices, punchItems, changeOrders)),
    [active, invoices, punchItems, changeOrders],
  );

  const portfolio = useMemo(() => {
    return stats.reduce(
      (acc, s) => ({
        budget: acc.budget + s.budget,
        outstanding: acc.outstanding + s.outstandingInvoices,
        punch: acc.punch + s.openPunchItems,
        risks: acc.risks + (s.healthScore === 'risk' ? 1 : 0),
      }),
      { budget: 0, outstanding: 0, punch: 0, risks: 0 },
    );
  }, [stats]);

  // A/R aging buckets — surfaced inline on the Summary tab so a GC
  // running 6+ jobs sees "$45k in 0-30, $12k in 30-60, $8k in 90+" at
  // a glance instead of just one "Outstanding" total. Pre-fix this
  // existed only on /reports and required two taps to see what was
  // most urgent. Tapping the row deep-links into the dedicated
  // /reports?tab=aging view for the full row-level breakdown.
  const aging = useMemo(() => computeARAgingReport(invoices, projects), [invoices, projects]);

  // Cash flow forecast — moved here from the home tab so Your Projects
  // stays focused on the project list, and Summary becomes the financial
  // bird's-eye view it was always meant to be.
  const [cashFlowForecast, setCashFlowForecast] = useState<CashFlowWeek[] | null>(null);
  useEffect(() => {
    const loadForecast = async () => {
      try {
        const setupDone = await isSetupComplete();
        if (!setupDone) return;
        const data = await loadCashFlowData();
        if (data.startingBalance > 0 || data.expenses.length > 0) {
          const forecast = generateForecast(
            data.startingBalance,
            data.expenses,
            [],
            data.expectedPayments,
            12,
            data.defaultPaymentTerms,
          );
          setCashFlowForecast(forecast);
        }
      } catch (err) {
        console.log('[Summary] Cash flow forecast load failed:', err);
      }
    };
    void loadForecast();
  }, [projects]);

  const openProject = useCallback((projectId: string) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({ pathname: '/project-detail', params: { id: projectId } } as any);
  }, [router]);

  if (isLoading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ConstructionLoader size="lg" />
      </View>
    );
  }

  if (projects.length === 0) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 24 }]}>
        <Text style={styles.heading}>Summary</Text>
        <EmptyState
          icon={<FolderOpen size={36} color={Colors.primary} />}
          title="No projects yet"
          message="Summary rolls up budget, outstanding cash, punch, and risk across every project. To populate it:"
          steps={[
            'Open the Projects tab from the sidebar.',
            'Tap + New Project (or Try a sample project) to spin one up.',
            'Come back here once you have estimates, invoices, or daily reports flowing.',
          ]}
          actionLabel="Open Projects"
          onAction={() => router.push('/(tabs)/(home)' as any)}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.heading}>Summary</Text>
        <Text style={styles.subheading}>
          {active.length} active project{active.length === 1 ? '' : 's'}
        </Text>

        <View style={styles.portfolioRow}>
          <PortfolioStat label="Total Budget" value={formatMoneyShort(portfolio.budget)} tint={Colors.primary} />
          <PortfolioStat label="Outstanding" value={formatMoneyShort(portfolio.outstanding)} tint={Colors.warning} />
          <PortfolioStat label="Open Punch" value={`${portfolio.punch}`} tint={Colors.info} />
          <PortfolioStat label="At Risk" value={`${portfolio.risks}`} tint={portfolio.risks > 0 ? Colors.error : Colors.success} />
        </View>

        {/* A/R aging strip — only render when there's anything past
            due. Hides cleanly when every invoice is current. Tap the
            strip to drop into /reports on the aging tab. */}
        {aging.totals.totalOutstanding > 0 && (aging.totals['0-30'] + aging.totals['31-60'] + aging.totals['61-90'] + aging.totals['90+']) > 0 && (
          <TouchableOpacity
            style={styles.agingStrip}
            onPress={() => router.push('/reports?tab=aging' as any)}
            activeOpacity={0.85}
            testID="summary-ar-aging-strip"
            accessibilityRole="button"
            accessibilityLabel="View A/R aging report"
          >
            <View style={styles.agingStripHeader}>
              <Text style={styles.agingStripTitle}>A/R Aging</Text>
              <Text style={styles.agingStripTotal}>{formatMoneyShort(aging.totals.totalOutstanding)} outstanding</Text>
              <ChevronRight size={14} color={Colors.textMuted} />
            </View>
            <View style={styles.agingBucketRow}>
              <AgingBucket label="0-30" value={aging.totals['0-30']} tint={Colors.warning} />
              <AgingBucket label="31-60" value={aging.totals['31-60']} tint={Colors.warning} />
              <AgingBucket label="61-90" value={aging.totals['61-90']} tint={Colors.error} />
              <AgingBucket label="90+" value={aging.totals['90+']} tint={Colors.error} />
            </View>
          </TouchableOpacity>
        )}

        {projects.length > 0 && (
          <CashFlowGlance forecast={cashFlowForecast} weeks={4} />
        )}

        {projects.length > 0 && (
          <CashFlowAlerts forecast={cashFlowForecast} invoices={[]} />
        )}

        {/* Reports CTA — opens the WIP / Profit / A/R Aging hub. The
            three reports a banker, owner, or CFO will ask for first. */}
        {projects.length > 0 && (
          <TouchableOpacity
            style={styles.reportsCard}
            onPress={() => router.push('/reports' as any)}
            activeOpacity={0.85}
            testID="summary-reports-cta"
          >
            <View style={styles.reportsIcon}>
              <FileDown size={18} color={Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.reportsTitle}>Bank-ready reports</Text>
              <Text style={styles.reportsBody}>
                WIP · Profit by project · A/R aging · PDF + CSV export
              </Text>
            </View>
            <ChevronRight size={16} color={Colors.textMuted} />
          </TouchableOpacity>
        )}

        {/* Tools moved to their own tab — Summary is now just a
            summary (portfolio KPIs, A/R aging, cash flow). Tap below to
            jump over. */}
        <TouchableOpacity
          style={styles.toolsCta}
          onPress={() => router.push('/(tabs)/tools' as never)}
          activeOpacity={0.85}
          testID="summary-open-tools"
        >
          <View style={styles.toolsCtaIcon}>
            <Wrench size={18} color={Colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.toolsCtaTitle}>Open Tools</Text>
            <Text style={styles.toolsCtaBody}>
              Approvals · Cash flow · Permit calendar · 13 more
            </Text>
          </View>
          <ChevronRight size={16} color={Colors.textMuted} />
        </TouchableOpacity>


        {stats.length === 0 ? (
          <View style={styles.emptyCard}>
            <CheckCircle2 size={32} color={Colors.success} />
            <Text style={styles.emptyTitle}>All projects wrapped</Text>
            <Text style={styles.emptyDesc}>
              Every project is marked completed or closed. Kick off a new one to see it here.
            </Text>
          </View>
        ) : (
          stats.map(s => <SummaryCard key={s.project.id} stats={s} onPress={() => openProject(s.project.id)} />)
        )}
      </ScrollView>
    </View>
  );
}

function PortfolioStat({ label, value, tint }: { label: string; value: string; tint: string }) {
  return (
    <View style={styles.portfolioStat}>
      <Text style={[styles.portfolioValue, { color: tint }]}>{value}</Text>
      <Text style={styles.portfolioLabel}>{label}</Text>
    </View>
  );
}

function AgingBucket({ label, value, tint }: { label: string; value: number; tint: string }) {
  // Per-bucket cell on the A/R aging strip. Zero-value buckets render
  // muted ("—") rather than "$0" so the eye lands on the buckets that
  // actually have money in them.
  const isZero = value <= 0;
  return (
    <View style={styles.agingBucketCell}>
      <Text style={[styles.agingBucketValue, { color: isZero ? Colors.textMuted : tint }]}>
        {isZero ? '—' : formatMoneyShort(value)}
      </Text>
      <Text style={styles.agingBucketLabel}>{label}</Text>
    </View>
  );
}

function SummaryCard({ stats, onPress }: { stats: ProjectSummaryStats; onPress: () => void }) {
  const { project, budget, outstandingInvoices, paidInvoices, openPunchItems,
    urgentPunchItems, nextMilestone, pendingChangeOrders, healthScore, healthReason } = stats;

  const healthTint = healthScore === 'good'
    ? Colors.success
    : healthScore === 'watch' ? Colors.warning : Colors.error;

  const percentBilled = budget > 0 ? Math.min(100, Math.round(((paidInvoices + outstandingInvoices) / budget) * 100)) : 0;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75} testID={`summary-card-${project.id}`}>
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle} numberOfLines={1}>{project.name}</Text>
          <Text style={styles.cardSubtitle} numberOfLines={1}>
            {project.location || 'No location'} · {project.status.replace(/_/g, ' ')}
          </Text>
        </View>
        <View style={[styles.healthPill, { backgroundColor: healthTint + '18' }]}>
          {healthScore === 'good'
            ? <CheckCircle2 size={12} color={healthTint} />
            : <AlertTriangle size={12} color={healthTint} />}
          <Text style={[styles.healthPillText, { color: healthTint }]}>
            {healthScore === 'good' ? 'On track' : healthScore === 'watch' ? 'Watch' : 'At risk'}
          </Text>
        </View>
      </View>

      <Text style={styles.healthReason} numberOfLines={1}>{healthReason}</Text>

      <View style={styles.statGrid}>
        <Stat icon={DollarSign} label="Budget" value={formatMoneyShort(budget)} tint={Colors.primary} />
        <Stat icon={Receipt} label="Outstanding" value={formatMoney(outstandingInvoices)} tint={outstandingInvoices > 0 ? Colors.warning : Colors.textMuted} />
        <Stat
          icon={Wrench}
          label="Punch"
          value={`${openPunchItems}${urgentPunchItems > 0 ? ` · ${urgentPunchItems}!` : ''}`}
          tint={urgentPunchItems > 0 ? Colors.error : openPunchItems > 0 ? Colors.info : Colors.textMuted}
        />
        <Stat
          icon={ClipboardList}
          label="COs pending"
          value={`${pendingChangeOrders}`}
          tint={pendingChangeOrders > 0 ? Colors.warning : Colors.textMuted}
        />
      </View>

      {budget > 0 && (
        <View style={styles.billedRow}>
          <Text style={styles.billedLabel}>
            <TrendingUp size={11} color={Colors.textMuted} /> Billed {percentBilled}% of budget
          </Text>
          <View style={styles.billedBar}>
            <View style={[styles.billedFill, { width: `${percentBilled}%` }]} />
          </View>
        </View>
      )}

      {nextMilestone && (
        <View style={styles.milestoneRow}>
          <Calendar size={13} color={Colors.primary} />
          <Text style={styles.milestoneText} numberOfLines={1}>
            Next: {nextMilestone.title}
          </Text>
          <Text style={styles.milestoneDate}>
            {new Date(nextMilestone.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </Text>
        </View>
      )}

      <View style={styles.cardFooter}>
        <Text style={styles.openDetailText}>Open project</Text>
        <ChevronRight size={16} color={Colors.primary} />
      </View>
    </TouchableOpacity>
  );
}

function Stat({ icon: Icon, label, value, tint }: { icon: typeof DollarSign; label: string; value: string; tint: string }) {
  return (
    <View style={styles.stat}>
      <Icon size={14} color={tint} />
      <Text style={[styles.statValue, { color: tint }]} numberOfLines={1}>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  heading: { ...Type.display, color: Colors.ink, paddingHorizontal: 20 },
  subheading: { fontSize: Type.bodyCompact.fontSize, color: Colors.textMuted, paddingHorizontal: 20, marginTop: 2, marginBottom: 16 },
  portfolioRow: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, gap: 8, marginBottom: 16 },
  agingStrip: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.lg,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  agingStripHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginBottom: 10 },
  agingStripTitle: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: Colors.text, letterSpacing: 0.2, textTransform: 'uppercase' as const },
  agingStripTotal: { flex: 1, fontSize: Type.caption1.fontSize, color: Colors.textMuted, textAlign: 'right' as const },
  agingBucketRow: { flexDirection: 'row' as const, gap: 6 },
  agingBucketCell: { flex: 1, padding: 8, borderRadius: Tokens.radius.sm, backgroundColor: Colors.surfaceAlt, alignItems: 'flex-start' as const },
  agingBucketValue: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, letterSpacing: -0.2 },
  agingBucketLabel: { fontSize: 10, color: Colors.textMuted, fontWeight: '600' as const, marginTop: 2, textTransform: 'uppercase' as const, letterSpacing: 0.4 },
  portfolioStat: { flex: 1, minWidth: '46%' as any, backgroundColor: Colors.surface, borderRadius: Tokens.radius.lg, borderWidth: 1, borderColor: Colors.cardBorder, paddingVertical: 12, paddingHorizontal: 14, gap: 4 },
  portfolioValue: { fontSize: Type.title3.fontSize, fontWeight: '800' as const, letterSpacing: -0.3 },
  portfolioLabel: { fontSize: Type.caption2.fontSize, fontWeight: '600' as const, color: Colors.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.6 },
  card: { marginHorizontal: 16, marginBottom: 12, backgroundColor: Colors.surface, borderRadius: Tokens.radius.xl, borderWidth: 1, borderColor: Colors.cardBorder, padding: 14, gap: 10 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardTitle: { fontSize: Type.body.fontSize, fontWeight: '700' as const, color: Colors.text, letterSpacing: -0.2 },
  cardSubtitle: { fontSize: Type.caption1.fontSize, color: Colors.textMuted, marginTop: 2, textTransform: 'capitalize' as const },
  healthPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: Tokens.radius.sm },
  healthPillText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, textTransform: 'uppercase' as const, letterSpacing: 0.4 },
  healthReason: { fontSize: Type.caption1.fontSize, color: Colors.textSecondary, marginTop: -4 },
  statGrid: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, backgroundColor: Colors.surfaceAlt, borderRadius: Tokens.radius.md, paddingVertical: 8, paddingHorizontal: 8, gap: 2, alignItems: 'flex-start' as const },
  statValue: { fontSize: Type.bodyCompact.fontSize, fontWeight: '800' as const },
  statLabel: { fontSize: 10, color: Colors.textMuted, fontWeight: '500' as const, textTransform: 'uppercase' as const, letterSpacing: 0.3 },
  billedRow: { gap: 6 },
  billedLabel: { fontSize: Type.caption2.fontSize, color: Colors.textMuted, fontWeight: '500' as const },
  billedBar: { height: 5, backgroundColor: Colors.fillTertiary, borderRadius: 3, overflow: 'hidden' as const },
  billedFill: { height: '100%' as any, backgroundColor: Colors.primary, borderRadius: 3 },
  milestoneRow: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.primary + '10', borderRadius: Tokens.radius.md, paddingVertical: 8, paddingHorizontal: 10 },
  milestoneText: { flex: 1, fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: Colors.text },
  milestoneDate: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: Colors.primary },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: -2 },
  openDetailText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: Colors.primary },
  emptyCard: { marginHorizontal: 16, padding: 24, alignItems: 'center' as const, gap: 10, backgroundColor: Colors.surface, borderRadius: Tokens.radius.xl, borderWidth: 1, borderColor: Colors.cardBorder },
  emptyTitle: { fontSize: Type.body.fontSize, fontWeight: '700' as const, color: Colors.text },
  emptyDesc: { fontSize: Type.footnote.fontSize, color: Colors.textMuted, textAlign: 'center' as const, lineHeight: 18 },
  reportsCard: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12,
    marginHorizontal: 16, marginBottom: 12,
    padding: 14, borderRadius: Tokens.radius.lg,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.cardBorder,
  },
  reportsIcon: {
    width: 38, height: 38, borderRadius: 11,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  reportsTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '800' as const, color: Colors.text, letterSpacing: -0.2 },
  reportsBody:  { fontSize: Type.caption1.fontSize, color: Colors.textSecondary, marginTop: 2, lineHeight: 16 },

  // Tools CTA — small card that points at the new Tools tab. Lives
  // inline on Summary so users who used to find tools here aren't lost.
  // Matches the visual weight of `reportsCard` above (sibling CTA pair).
  toolsCta: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12,
    marginHorizontal: 16, marginBottom: 12,
    padding: 14, borderRadius: Tokens.radius.lg,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.cardBorder,
  },
  toolsCtaIcon: {
    width: 38, height: 38, borderRadius: 11,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  toolsCtaTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '800' as const, color: Colors.text, letterSpacing: -0.2 },
  toolsCtaBody:  { fontSize: Type.caption1.fontSize, color: Colors.textSecondary, marginTop: 2, lineHeight: 16 },
});
