import React, { useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  ClipboardList, DollarSign, AlertTriangle, CheckCircle2, ChevronRight,
  Receipt, Wrench, Calendar, TrendingUp, FolderOpen,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import ConstructionLoader from '@/components/ConstructionLoader';
import EmptyState from '@/components/EmptyState';
import { formatMoney, formatMoneyShort } from '@/utils/formatters';
import type { Project } from '@/types';

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
          message="Create a project from the Projects tab and its summary will show up here."
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
            {project.location || 'No location'} · {project.status.replace('_', ' ')}
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
  heading: { fontSize: 34, fontWeight: '800' as const, color: Colors.text, paddingHorizontal: 20, letterSpacing: -0.5 },
  subheading: { fontSize: 14, color: Colors.textMuted, paddingHorizontal: 20, marginTop: 2, marginBottom: 16 },
  portfolioRow: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, gap: 8, marginBottom: 16 },
  portfolioStat: { flex: 1, minWidth: '46%' as any, backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.cardBorder, paddingVertical: 12, paddingHorizontal: 14, gap: 4 },
  portfolioValue: { fontSize: 20, fontWeight: '800' as const, letterSpacing: -0.3 },
  portfolioLabel: { fontSize: 11, fontWeight: '600' as const, color: Colors.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.6 },
  card: { marginHorizontal: 16, marginBottom: 12, backgroundColor: Colors.surface, borderRadius: 18, borderWidth: 1, borderColor: Colors.cardBorder, padding: 14, gap: 10 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardTitle: { fontSize: 17, fontWeight: '700' as const, color: Colors.text, letterSpacing: -0.2 },
  cardSubtitle: { fontSize: 12, color: Colors.textMuted, marginTop: 2, textTransform: 'capitalize' as const },
  healthPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  healthPillText: { fontSize: 11, fontWeight: '700' as const, textTransform: 'uppercase' as const, letterSpacing: 0.4 },
  healthReason: { fontSize: 12, color: Colors.textSecondary, marginTop: -4 },
  statGrid: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, backgroundColor: Colors.surfaceAlt, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 8, gap: 2, alignItems: 'flex-start' as const },
  statValue: { fontSize: 14, fontWeight: '800' as const },
  statLabel: { fontSize: 10, color: Colors.textMuted, fontWeight: '500' as const, textTransform: 'uppercase' as const, letterSpacing: 0.3 },
  billedRow: { gap: 6 },
  billedLabel: { fontSize: 11, color: Colors.textMuted, fontWeight: '500' as const },
  billedBar: { height: 5, backgroundColor: Colors.fillTertiary, borderRadius: 3, overflow: 'hidden' as const },
  billedFill: { height: '100%' as any, backgroundColor: Colors.primary, borderRadius: 3 },
  milestoneRow: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.primary + '10', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10 },
  milestoneText: { flex: 1, fontSize: 12, fontWeight: '600' as const, color: Colors.text },
  milestoneDate: { fontSize: 12, fontWeight: '700' as const, color: Colors.primary },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: -2 },
  openDetailText: { fontSize: 12, fontWeight: '600' as const, color: Colors.primary },
  emptyCard: { marginHorizontal: 16, padding: 24, alignItems: 'center' as const, gap: 10, backgroundColor: Colors.surface, borderRadius: 18, borderWidth: 1, borderColor: Colors.cardBorder },
  emptyTitle: { fontSize: 17, fontWeight: '700' as const, color: Colors.text },
  emptyDesc: { fontSize: 13, color: Colors.textMuted, textAlign: 'center' as const, lineHeight: 18 },
});
