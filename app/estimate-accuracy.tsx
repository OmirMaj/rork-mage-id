// estimate-accuracy.tsx — bid vs committed vs actual, per estimate line.
//
// The per-job truth view behind the cost-learning loop: for this project, what
// did you bid each scope at, what did you sign it out for, and what did it
// actually cost? Traced through commitment.linkedEstimateItems so the actuals
// land back on the line that predicted them. Per-line and per-trade variance,
// honest disclosure of any commitments that couldn't be traced.
//
// Pure read over utils/estimateActuals — no new math, no network.

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, ChevronRight, Scale, TrendingDown, TrendingUp, Info, ArrowRight, Library } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import EmptyState from '@/components/EmptyState';
import { computeEstimateActuals, variancePct, type EstimateLineActual } from '@/utils/estimateActuals';
import { formatMoney, formatMoneyFull } from '@/utils/jobCostEngine';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

const pctStr = (r: number): string => `${r >= 0 ? '+' : ''}${(r * 100).toFixed(0)}%`;

export default function EstimateAccuracyScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('job_costing')) {
    return (
      <Paywall
        visible={true}
        feature="Estimate Accuracy"
        requiredTier="pro"
        onClose={() => router.back()}
      />
    );
  }
  return <EstimateAccuracyInner />;
}

function EstimateAccuracyInner() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  const { projects, commitments } = useProjects();

  const project = useMemo(
    () => projects.find(p => p.id === projectId),
    [projects, projectId],
  );

  const report = useMemo(
    () => (project ? computeEstimateActuals(project, commitments) : null),
    [project, commitments],
  );

  const overallVarColor = (delta: number) =>
    delta > 0 ? t.danger : delta < 0 ? t.success : t.textSecondary;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={22} color={t.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerEyebrow}>Estimate Accuracy · MAGE</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>{project?.name ?? 'Bid vs actual'}</Text>
        </View>
        <View style={styles.headerBtn} />
      </View>

      {!project || !report || !report.hasEstimate ? (
        <EmptyState
          icon={<Scale size={36} color={t.accent} strokeWidth={1.6} />}
          title={!project ? 'Project not found' : 'No estimate to measure'}
          message={
            !project
              ? 'Open this from a project to see how its bid compared to what it actually cost.'
              : 'Estimate Accuracy compares each estimate line to what you signed and paid. To use it:'
          }
          steps={
            !project
              ? undefined
              : [
                  'Build an estimate with cost and markup.',
                  'Award buyout so commitments link back to estimate lines.',
                  'Record sub payments — actuals flow onto each line automatically.',
                ]
          }
          actionLabel={!project ? 'Back' : 'Open buyout'}
          onAction={() =>
            !project
              ? router.back()
              : router.push({ pathname: '/buyout', params: { projectId: project.id } } as any)
          }
        />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }} showsVerticalScrollIndicator={false}>
          {/* Bid → Committed → Actual KPIs */}
          <View style={styles.kpiRow}>
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>Bid</Text>
              <Text style={styles.kpiValue}>{formatMoney(report.totalBid)}</Text>
              <Text style={styles.kpiSub}>estimated cost</Text>
            </View>
            <ArrowRight size={14} color={t.textMuted} style={styles.kpiArrow} strokeWidth={1.75} />
            <View style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>Committed</Text>
              <Text style={[styles.kpiValue, { color: overallVarColor(report.totalCommitted - report.totalBid) }]}>{formatMoney(report.totalCommitted)}</Text>
              <Text style={styles.kpiSub}>
                {report.totalBid > 0 ? `${pctStr((report.totalCommitted - report.totalBid) / report.totalBid)} vs bid` : 'signed'}
              </Text>
            </View>
            {report.hasActuals && (
              <>
                <ArrowRight size={14} color={t.textMuted} style={styles.kpiArrow} strokeWidth={1.75} />
                <View style={styles.kpiCard}>
                  <Text style={styles.kpiLabel}>Actual</Text>
                  <Text style={[styles.kpiValue, { color: overallVarColor(report.totalActual - report.totalBid) }]}>{formatMoney(report.totalActual)}</Text>
                  <Text style={styles.kpiSub}>
                    {report.totalBid > 0 ? `${pctStr((report.totalActual - report.totalBid) / report.totalBid)} vs bid` : 'paid'}
                  </Text>
                </View>
              </>
            )}
          </View>

          {report.coveragePct < 99 && report.totalCommitted > 0 && (
            <View style={styles.disclose}>
              <Info size={15} color={t.accent} strokeWidth={1.75} />
              <Text style={styles.discloseText}>
                {report.coveragePct.toFixed(0)}% of committed cost is traced to estimate lines.
                {report.untracedCommitmentCount > 0
                  ? ` ${report.untracedCommitmentCount} commitment${report.untracedCommitmentCount === 1 ? '' : 's'} (${formatMoney(report.untracedCommitted)}) couldn't be linked — link them on the commitment to sharpen this.`
                  : ''}
              </Text>
            </View>
          )}

          {!report.hasActuals && (
            <View style={styles.disclose}>
              <Info size={15} color={t.textMuted} strokeWidth={1.75} />
              <Text style={styles.discloseText}>
                No actuals yet — showing bid vs committed. Record sub/PO payments and the actual column fills in per line.
              </Text>
            </View>
          )}

          {/* By trade */}
          <Text style={styles.sectionTitle}>By trade</Text>
          {report.byTrade.map(tr => {
            const ref = report.hasActuals && tr.actual > 0 ? tr.actual : tr.committed;
            const vp = variancePct(ref, tr.bid);
            return (
              <View key={tr.trade} style={styles.tradeRow}>
                <View style={styles.tradeBody}>
                  <Text style={styles.tradeName} numberOfLines={1}>{tr.trade}</Text>
                  <Text style={styles.tradeMeta}>{tr.lineCount} line{tr.lineCount === 1 ? '' : 's'} · bid {formatMoney(tr.bid)}</Text>
                </View>
                {vp !== null && (ref > 0) ? (
                  <View style={[styles.varPill, { backgroundColor: overallVarColor(ref - tr.bid) + '1F' }]}>
                    {ref - tr.bid > 0 ? <TrendingUp size={11} color={t.danger} strokeWidth={1.75} /> : <TrendingDown size={11} color={t.success} strokeWidth={1.75} />}
                    <Text style={[styles.varText, { color: overallVarColor(ref - tr.bid) }]}>{pctStr(vp)}</Text>
                  </View>
                ) : (
                  <Text style={styles.tradePending}>not signed</Text>
                )}
              </View>
            );
          })}

          {/* Per line */}
          <Text style={[styles.sectionTitle, { marginTop: 18 }]}>Every line</Text>
          {report.lines.map(l => (
            <LineCard key={l.materialId} line={l} hasActuals={report.hasActuals} t={t} styles={styles} />
          ))}

          <TouchableOpacity
            style={styles.crossLink}
            onPress={() => router.push('/cost-database' as any)}
            activeOpacity={0.7}
            testID="estimate-accuracy-cost-db-link"
          >
            <Library size={16} color={t.accent} strokeWidth={1.75} />
            <Text style={styles.crossLinkText}>See your cost database — rates learned from every closed job</Text>
            <ChevronRight size={16} color={t.textMuted} strokeWidth={1.75} />
          </TouchableOpacity>

          <Text style={styles.note}>
            Bid is the estimate&apos;s cost (pre-markup). Committed and actual are traced from signed
            subs/POs via their linked estimate items; actual is paid-to-date. Lines with no
            commitment haven&apos;t been bought out yet. These actuals feed your personal cost database.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

function LineCard({
  line, hasActuals, t, styles,
}: {
  line: EstimateLineActual;
  hasActuals: boolean;
  t: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const ref = hasActuals && line.hasActual ? line.actual : line.committed;
  const showVar = line.hasCommitment && line.bid > 0;
  const delta = ref - line.bid;
  const vp = variancePct(ref, line.bid);
  const varColor = delta > 0 ? t.danger : delta < 0 ? t.success : t.textSecondary;

  return (
    <View style={styles.line}>
      <View style={styles.lineHead}>
        <Text style={styles.lineName} numberOfLines={1}>{line.name}</Text>
        {showVar && vp !== null ? (
          <View style={[styles.varPill, { backgroundColor: varColor + '1F' }]}>
            <Text style={[styles.varText, { color: varColor }]}>{pctStr(vp)}</Text>
          </View>
        ) : (
          <Text style={styles.linePending}>not signed</Text>
        )}
      </View>
      <View style={styles.lineNums}>
        <View style={styles.lineNum}>
          <Text style={styles.lineNumLabel}>Bid</Text>
          <Text style={styles.lineNumVal}>{formatMoneyFull(line.bid)}</Text>
          {line.bidUnit !== null && <Text style={styles.lineUnit}>{formatMoney(line.bidUnit)}/{line.unit || 'unit'}</Text>}
        </View>
        <View style={styles.lineNum}>
          <Text style={styles.lineNumLabel}>Committed</Text>
          <Text style={[styles.lineNumVal, { color: line.hasCommitment ? t.text : t.textMuted }]}>
            {line.hasCommitment ? formatMoneyFull(line.committed) : '—'}
          </Text>
          {line.committedUnit !== null && <Text style={styles.lineUnit}>{formatMoney(line.committedUnit)}/{line.unit || 'unit'}</Text>}
        </View>
        {hasActuals && (
          <View style={styles.lineNum}>
            <Text style={styles.lineNumLabel}>Actual</Text>
            <Text style={[styles.lineNumVal, { color: line.hasActual ? t.text : t.textMuted }]}>
              {line.hasActual ? formatMoneyFull(line.actual) : '—'}
            </Text>
            {line.actualUnit !== null && <Text style={[styles.lineUnit, { color: varColor }]}>{formatMoney(line.actualUnit)}/{line.unit || 'unit'}</Text>}
          </View>
        )}
      </View>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  header: {
    flexDirection: 'row' as const, alignItems: 'center' as const,
    paddingHorizontal: 12, paddingVertical: 10, gap: 8,
    borderBottomWidth: 1, borderBottomColor: t.line,
  },
  headerBtn: { width: 38, height: 38, alignItems: 'center' as const, justifyContent: 'center' as const },
  headerText: { flex: 1 },
  headerEyebrow: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '600' as const, letterSpacing: 0.4 },
  headerTitle: { fontSize: Type.headline.fontSize, fontWeight: '700' as const, color: t.text },

  kpiRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, marginBottom: 14 },
  kpiCard: {
    flex: 1, backgroundColor: t.surface, borderRadius: Tokens.radius.panel,
    borderWidth: 1, borderColor: t.line, padding: 12, gap: 2,
  },
  kpiArrow: { marginHorizontal: -2 },
  kpiLabel: { fontSize: Type.caption2.fontSize, color: t.textSecondary, fontWeight: '700' as const, letterSpacing: 0.3 },
  kpiValue: { fontSize: Type.title3.fontSize, fontWeight: '800' as const, color: t.text },
  kpiSub: { fontSize: Type.caption2.fontSize, color: t.textMuted },

  disclose: {
    flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 8,
    backgroundColor: t.surfaceAlt, borderRadius: Tokens.radius.card,
    padding: 12, marginBottom: 12,
  },
  discloseText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 17 },

  sectionTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: t.text, marginBottom: 10 },

  tradeRow: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10,
    backgroundColor: t.surface, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line, padding: 12, marginBottom: 8,
  },
  tradeBody: { flex: 1, gap: 2 },
  tradeName: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  tradeMeta: { fontSize: Type.caption1.fontSize, color: t.textSecondary },
  tradePending: { fontSize: Type.caption1.fontSize, color: t.textMuted, fontWeight: '600' as const },

  varPill: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 3,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: Tokens.radius.sm,
  },
  varText: { fontSize: Type.caption1.fontSize, fontWeight: '800' as const },

  line: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line, padding: 12, marginBottom: 8, gap: 10,
  },
  lineHead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  lineName: { flex: 1, fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  linePending: { fontSize: Type.caption1.fontSize, color: t.textMuted, fontWeight: '600' as const },
  lineNums: { flexDirection: 'row' as const, gap: 8 },
  lineNum: { flex: 1, gap: 1 },
  lineNumLabel: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '600' as const, letterSpacing: 0.3 },
  lineNumVal: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  lineUnit: { fontSize: Type.caption2.fontSize, color: t.textSecondary },

  crossLink: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8,
    backgroundColor: t.accent + '12', borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.accent + '33', padding: 12, marginTop: 14,
  },
  crossLinkText: { flex: 1, fontSize: Type.footnote.fontSize, color: t.textSecondary, fontWeight: '600' as const },

  note: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17, marginTop: 12 },
});

