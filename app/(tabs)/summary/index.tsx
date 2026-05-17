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
  Inbox, Wallet, UserPlus, Gavel,
} from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import ConstructionLoader from '@/components/ConstructionLoader';
import { SkeletonCard, Skeleton } from '@/components/Skeleton';
import EmptyState from '@/components/EmptyState';
import { NavRow } from '@/components/NavRow';
import CashFlowGlance from '@/components/CashFlowGlance';
import { NextStepHero } from '@/components/NextStepHero';
import CashFlowAlerts from '@/components/CashFlowAlerts';
import { generateForecast, type CashFlowWeek } from '@/utils/cashFlowEngine';
import { loadCashFlowData, isSetupComplete } from '@/utils/cashFlowStorage';
import { formatMoney, formatMoneyShort } from '@/utils/formatters';
import { computeARAgingReport } from '@/utils/financialReports';
import type { Project } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { effectiveEstimateTotal } from '@/utils/estimateCommit';

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

  const budget = effectiveEstimateTotal(project);

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
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);

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

  // A/R aging bucket totals. Surfaced as a compact strip on the Summary
  // tab so bookkeepers see the 0-30 / 31-60 / 61-90 / 90+ breakdown
  // without diving into Reports → A/R Aging. The audit's #1 missing
  // bookkeeper view. Pure derive — uses the existing computeARAgingReport.
  const aging = useMemo(() => computeARAgingReport(invoices, projects), [invoices, projects]);
  const showAgingStrip = aging.rows.length > 0;

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
    // Skeleton placeholders rendered in the same shape the populated
    // Summary will take — large title, 4 stat tiles, 3 card rows. Feels
    // like the screen is loading rather than the app has paused.
    return (
      <View style={[styles.container, { backgroundColor: themeColors.bg, paddingTop: insets.top + 12 }]}>
        <Skeleton width={180} height={32} radius={8} style={{ marginHorizontal: 20, marginTop: 4, marginBottom: 6 }} />
        <Skeleton width={240} height={14} radius={6} style={{ marginHorizontal: 20, marginBottom: 16 }} />
        <View style={{ flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, paddingHorizontal: 12, marginBottom: 16 }}>
          {[0, 1, 2, 3].map(i => (
            <View key={i} style={{ flex: 1, minWidth: '46%' as any, backgroundColor: themeColors.surface, borderRadius: Tokens.radius.lg, borderWidth: 1, borderColor: themeColors.line, paddingVertical: 12, paddingHorizontal: 14, gap: 6 }}>
              <Skeleton width={64} height={20} radius={6} />
              <Skeleton width={88} height={11} radius={4} />
            </View>
          ))}
        </View>
        <SkeletonCard style={{ marginHorizontal: 16, marginBottom: 12 }} />
        <SkeletonCard style={{ marginHorizontal: 16, marginBottom: 12 }} />
        <SkeletonCard style={{ marginHorizontal: 16 }} />
      </View>
    );
  }

  if (projects.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: themeColors.bg, paddingTop: insets.top + 24 }]}>
        <Text style={styles.heading}>Summary</Text>
        <EmptyState
          icon={<FolderOpen size={36} color={themeColors.accent} />}
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
    <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.heading}>Summary</Text>
        <Text style={styles.subheading}>
          {active.length} active project{active.length === 1 ? '' : 's'}
        </Text>

        {/* NextStepHero — one dynamic action card, the same UI surface
            that lives on the home tab. Picks from money + compliance
            + scheduling pain. Hidden when nothing's pressing. */}
        {projects.length > 0 && (
          <NextStepHero
            projects={projects}
            invoices={invoices}
            testID="summary-next-step"
          />
        )}

        <View style={styles.portfolioRow}>
          {/* Semantic tints. Total Budget = neutral (it's just context).
              Outstanding turns danger-red when > 0 so the eye actually
              lands on the number that needs the GC's attention. Pre-fix
              both stats were the same orange — competed for the same
              attention with no signal of which one needed action. */}
          <PortfolioStat styles={styles} label="Total Budget" value={formatMoneyShort(portfolio.budget)} tint={themeColors.text} />
          <PortfolioStat styles={styles} label="Outstanding" value={formatMoneyShort(portfolio.outstanding)} tint={portfolio.outstanding > 0 ? themeColors.danger : themeColors.textMuted} />
          <PortfolioStat styles={styles} label="Open Punch" value={`${portfolio.punch}`} tint={themeColors.info} />
          <PortfolioStat styles={styles} label="At Risk" value={`${portfolio.risks}`} tint={portfolio.risks > 0 ? themeColors.danger : themeColors.success} />
        </View>

        {showAgingStrip && (
          // A/R aging bucket strip — tap any pill to jump to the full
          // Reports → A/R Aging view filtered to that bucket. Colors
          // escalate: current = textMuted, 0-30 = textSecondary,
          // 31-60 = warning, 61-90 = danger soft, 90+ = danger.
          <TouchableOpacity
            style={styles.agingStrip}
            onPress={() => router.push('/reports' as never)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Open A/R aging report"
            testID="summary-ar-aging-strip"
          >
            <View style={styles.agingHeaderRow}>
              <Text style={styles.agingHeader}>A/R AGING</Text>
              <Text style={styles.agingHeaderMeta}>
                {aging.rows.length} open · tap to open
              </Text>
            </View>
            <View style={styles.agingBucketRow}>
              <AgingBucket styles={styles} label="Current" value={aging.totals.current}     tone={themeColors.textMuted} />
              <AgingBucket styles={styles} label="0-30"    value={aging.totals['0-30']}     tone={themeColors.textSecondary} />
              <AgingBucket styles={styles} label="31-60"   value={aging.totals['31-60']}    tone="#E65100" />
              <AgingBucket styles={styles} label="61-90"   value={aging.totals['61-90']}    tone={themeColors.danger} />
              <AgingBucket styles={styles} label="90+"     value={aging.totals['90+']}      tone={themeColors.danger} />
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
              <FileDown size={18} color={themeColors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.reportsTitle}>Bank-ready reports</Text>
              <Text style={styles.reportsBody}>
                WIP · Profit by project · A/R aging · PDF + CSV export
              </Text>
            </View>
            <ChevronRight size={16} color={themeColors.textMuted} />
          </TouchableOpacity>
        )}

        {/* Tools — entry points for actions that used to live in the
            8-icon home navbar. Single column, neutral tone, in the
            place users naturally come to look at portfolio-level work. */}
        <View style={styles.toolsGroup}>
          <Text style={styles.toolsHeader}>Tools</Text>
          <View style={styles.toolsCard}>
            {projects.length > 0 && (
              <NavRow
                Icon={Inbox}
                title="Reports inbox"
                subtitle="Daily field reports waiting for review"
                onPress={() => router.push('/report-inbox' as any)}
                testID="summary-reports-inbox"
              />
            )}
            {projects.length > 0 && (
              <View style={styles.toolsDivider} />
            )}
            {projects.length > 0 && (
              <NavRow
                Icon={Wallet}
                title="Cash flow"
                subtitle="Multi-week forecast across all projects"
                onPress={() => router.push('/cash-flow' as any)}
                testID="summary-cash-flow"
              />
            )}
            <View style={styles.toolsDivider} />
            <NavRow
              Icon={UserPlus}
              title="Pipeline"
              subtitle="Inquiries → qualified → proposal → won"
              onPress={() => router.push('/leads' as never)}
              testID="summary-pipeline"
            />
            <View style={styles.toolsDivider} />
            <NavRow
              Icon={Gavel}
              title="Buyout"
              subtitle="Sub package builder + bid award flow"
              onPress={() => router.push('/buyout' as never)}
              testID="summary-buyout"
            />
            <View style={styles.toolsDivider} />
            <NavRow
              Icon={FileDown}
              title="1099-NEC export"
              subtitle="Year-end CSV for your CPA — flags subs paid ≥ $600"
              onPress={() => router.push('/tax-1099-export' as never)}
              testID="summary-tax-1099"
            />
          </View>
        </View>

        {stats.length === 0 ? (
          <View style={styles.emptyCard}>
            <CheckCircle2 size={32} color={themeColors.success} />
            <Text style={styles.emptyTitle}>All projects wrapped</Text>
            <Text style={styles.emptyDesc}>
              Every project is marked completed or closed. Kick off a new one to see it here.
            </Text>
          </View>
        ) : (
          stats.map(s => <SummaryCard key={s.project.id} stats={s} onPress={() => openProject(s.project.id)} styles={styles} colors={themeColors} />)
        )}
      </ScrollView>
    </View>
  );
}

// One column inside the A/R aging strip. Shows the bucket label,
// the dollar total in that bucket (or em-dash when zero), tinted by
// severity so the eye lands on the 61-90 / 90+ buckets first.
function AgingBucket({
  label, value, tone, styles,
}: { label: string; value: number; tone: string; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.agingBucket}>
      <Text style={[styles.agingBucketValue, { color: tone }]} numberOfLines={1}>
        {value > 0 ? formatMoneyShort(value) : '—'}
      </Text>
      <Text style={styles.agingBucketLabel}>{label}</Text>
    </View>
  );
}

function PortfolioStat({ label, value, tint, styles }: { label: string; value: string; tint: string; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.portfolioStat}>
      <Text style={[styles.portfolioValue, { color: tint }]}>{value}</Text>
      <Text style={styles.portfolioLabel}>{label}</Text>
    </View>
  );
}

function SummaryCard({ stats, onPress, styles, colors }: { stats: ProjectSummaryStats; onPress: () => void; styles: ReturnType<typeof makeStyles>; colors: ThemeColors }) {
  const { project, budget, outstandingInvoices, paidInvoices, openPunchItems,
    urgentPunchItems, nextMilestone, pendingChangeOrders, healthScore, healthReason } = stats;

  const healthTint = healthScore === 'good'
    ? colors.success
    : healthScore === 'watch' ? colors.accent : colors.danger;

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
        <Stat styles={styles} icon={DollarSign} label="Budget" value={formatMoneyShort(budget)} tint={colors.accent} />
        <Stat styles={styles} icon={Receipt} label="Outstanding" value={formatMoney(outstandingInvoices)} tint={outstandingInvoices > 0 ? colors.accent : colors.textMuted} />
        <Stat
          styles={styles}
          icon={Wrench}
          label="Punch"
          value={`${openPunchItems}${urgentPunchItems > 0 ? ` · ${urgentPunchItems}!` : ''}`}
          tint={urgentPunchItems > 0 ? colors.danger : openPunchItems > 0 ? colors.info : colors.textMuted}
        />
        <Stat
          styles={styles}
          icon={ClipboardList}
          label="COs pending"
          value={`${pendingChangeOrders}`}
          tint={pendingChangeOrders > 0 ? colors.accent : colors.textMuted}
        />
      </View>

      {budget > 0 && (
        <View style={styles.billedRow}>
          <Text style={styles.billedLabel}>
            <TrendingUp size={11} color={colors.textMuted} /> Billed {percentBilled}% of budget
          </Text>
          <View style={styles.billedBar}>
            <View style={[styles.billedFill, { width: `${percentBilled}%` }]} />
          </View>
        </View>
      )}

      {nextMilestone && (
        <View style={styles.milestoneRow}>
          <Calendar size={13} color={colors.accent} />
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
        <ChevronRight size={16} color={colors.accent} />
      </View>
    </TouchableOpacity>
  );
}

function Stat({ icon: Icon, label, value, tint, styles }: { icon: typeof DollarSign; label: string; value: string; tint: string; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.stat}>
      <Icon size={14} color={tint} />
      <Text style={[styles.statValue, { color: tint }]} numberOfLines={1}>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  center: { alignItems: 'center' as const, justifyContent: 'center' as const },
  // Tab-header recipe: largeTitle / 700 / -0.5 letterSpacing. Same across
  // every bottom tab so the eye doesn't relearn the hierarchy each tab.
  heading: { fontSize: Type.largeTitle.fontSize, fontWeight: '700' as const, color: t.text, paddingHorizontal: 20, letterSpacing: -0.5 },
  subheading: { fontSize: Type.bodyCompact.fontSize, color: t.textMuted, paddingHorizontal: 20, marginTop: 2, marginBottom: 16 },
  portfolioRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, paddingHorizontal: 12, gap: 8, marginBottom: 16 },
  agingStrip: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.lg,
    borderWidth: 1,
    borderColor: t.line,
    padding: 14,
    gap: 10,
  },
  agingHeaderRow: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const },
  agingHeader: { fontSize: 11, fontWeight: '800' as const, color: t.textMuted, letterSpacing: 1.2 },
  agingHeaderMeta: { fontSize: 11, fontWeight: '600' as const, color: t.accent, letterSpacing: 0.4 },
  agingBucketRow: { flexDirection: 'row' as const, gap: 6 },
  agingBucket: { flex: 1, alignItems: 'center' as const, paddingVertical: 6, paddingHorizontal: 4, gap: 2 },
  agingBucketValue: { fontSize: Type.bodyCompact.fontSize, fontWeight: '800' as const, letterSpacing: -0.2 },
  agingBucketLabel: { fontSize: 10, fontWeight: '700' as const, color: t.textMuted, letterSpacing: 0.4 },
  portfolioStat: { flex: 1, minWidth: '46%' as any, backgroundColor: t.surface, borderRadius: Tokens.radius.lg, borderWidth: 1, borderColor: t.line, paddingVertical: 12, paddingHorizontal: 14, gap: 4 },
  portfolioValue: { fontSize: Type.title3.fontSize, fontWeight: '800' as const, letterSpacing: -0.3 },
  portfolioLabel: { fontSize: Type.caption2.fontSize, fontWeight: '600' as const, color: t.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.6 },
  card: { marginHorizontal: 16, marginBottom: 12, backgroundColor: t.surface, borderRadius: Tokens.radius.xl, borderWidth: 1, borderColor: t.line, padding: 14, gap: 10 },
  cardHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  cardTitle: { fontSize: Type.body.fontSize, fontWeight: '700' as const, color: t.text, letterSpacing: -0.2 },
  cardSubtitle: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 2, textTransform: 'capitalize' as const },
  healthPill: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: Tokens.radius.sm },
  healthPillText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, textTransform: 'uppercase' as const, letterSpacing: 0.4 },
  healthReason: { fontSize: Type.caption1.fontSize, color: t.textSecondary, marginTop: -4 },
  statGrid: { flexDirection: 'row' as const, gap: 8 },
  stat: { flex: 1, backgroundColor: t.surfaceAlt, borderRadius: Tokens.radius.md, paddingVertical: 8, paddingHorizontal: 8, gap: 2, alignItems: 'flex-start' as const },
  statValue: { fontSize: Type.bodyCompact.fontSize, fontWeight: '800' as const },
  statLabel: { fontSize: 10, color: t.textMuted, fontWeight: '500' as const, textTransform: 'uppercase' as const, letterSpacing: 0.3 },
  billedRow: { gap: 6 },
  billedLabel: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '500' as const },
  billedBar: { height: 5, backgroundColor: t.line, borderRadius: 3, overflow: 'hidden' as const },
  billedFill: { height: '100%' as any, backgroundColor: t.accent, borderRadius: 3 },
  milestoneRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, backgroundColor: t.accentSoft, borderRadius: Tokens.radius.md, paddingVertical: 8, paddingHorizontal: 10 },
  milestoneText: { flex: 1, fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: t.text },
  milestoneDate: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: t.accentLabel },
  cardFooter: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'flex-end' as const, gap: 4, marginTop: -2 },
  openDetailText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: t.accentLabel },
  emptyCard: { marginHorizontal: 16, padding: 24, alignItems: 'center' as const, gap: 10, backgroundColor: t.surface, borderRadius: Tokens.radius.xl, borderWidth: 1, borderColor: t.line },
  emptyTitle: { fontSize: Type.body.fontSize, fontWeight: '700' as const, color: t.text },
  emptyDesc: { fontSize: Type.footnote.fontSize, color: t.textMuted, textAlign: 'center' as const, lineHeight: 18 },
  reportsCard: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12,
    marginHorizontal: 16, marginBottom: 12,
    padding: 14, borderRadius: Tokens.radius.lg,
    backgroundColor: t.surface, borderWidth: 1, borderColor: t.line,
  },
  reportsIcon: {
    width: 38, height: 38, borderRadius: 11,
    backgroundColor: t.accentSoft,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  reportsTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '800' as const, color: t.text, letterSpacing: -0.2 },
  reportsBody:  { fontSize: Type.caption1.fontSize, color: t.textSecondary, marginTop: 2, lineHeight: 16 },

  // Tools group — the dropped 8-icon navbar items live here as a clean
  // grouped list, iOS-Settings-style.
  toolsGroup: { marginHorizontal: 16, marginTop: 18, marginBottom: 6 },
  toolsHeader: {
    fontSize: Type.caption2.fontSize, fontWeight: '700' as const,
    color: t.textMuted, letterSpacing: 0.6,
    textTransform: 'uppercase' as const,
    paddingHorizontal: 4, marginBottom: 8,
  },
  toolsCard: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.lg,
    borderWidth: 1, borderColor: t.line,
    overflow: 'hidden' as const,
  },
  toolsDivider: {
    height: 1, backgroundColor: t.line,
    marginLeft: 64,
  },
});
