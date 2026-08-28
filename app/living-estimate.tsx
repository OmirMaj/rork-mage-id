// living-estimate.tsx — projected margin at completion, recomputed live.
//
// Reads the same project data as Job Costing (estimate + COs + commitments +
// invoices), runs it through utils/livingEstimate, and renders the margin
// the GC will actually finish with — plus a driver breakdown of what moved it
// off the bid. See utils/livingEstimate for the math.

import React, { useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { useLocalSearchParams, Stack, useRouter } from 'expo-router';
import {
  ChevronLeft, TrendingUp, TrendingDown, AlertTriangle, ArrowRight,
  Activity, ShieldAlert,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import EmptyState from '@/components/EmptyState';
import { computeLivingEstimate, type MarginHealth } from '@/utils/livingEstimate';
import { formatMoneyFull } from '@/utils/jobCostEngine';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

function money(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}${formatMoneyFull(Math.abs(n))}`;
}
function signedMoney(n: number): string {
  return `${n >= 0 ? '+' : '-'}${formatMoneyFull(Math.abs(n))}`;
}
function pct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

export default function LivingEstimateScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('job_costing')) {
    return (
      <Paywall
        visible={true}
        feature="Living Estimate"
        requiredTier="pro"
        onClose={() => router.back()}
      />
    );
  }
  return <LivingEstimateInner />;
}

function LivingEstimateInner() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { getProject, changeOrders, commitments, invoices } = useProjects();

  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);

  const snapshot = useMemo(() => {
    if (!project) return null;
    return computeLivingEstimate({ project, changeOrders, commitments, invoices });
  }, [project, changeOrders, commitments, invoices]);

  if (!project) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <Stack.Screen options={{ title: 'Living Estimate' }} />
        <EmptyState
          icon={<Activity size={36} color={t.accent} strokeWidth={1.6} />}
          title="No project to track yet"
          message="The Living Estimate recomputes your projected margin as change orders, buyout, and actual costs land. To see one:"
          steps={[
            'Open or create a project from the Projects tab.',
            'Build an estimate with markup so there is a margin to track.',
            'Approve a change order or log a sub commitment and watch it move.',
          ]}
          actionLabel="Open Projects"
          onAction={() => router.push('/(tabs)/(home)' as any)}
        />
      </View>
    );
  }

  const health: MarginHealth = snapshot?.health ?? 'healthy';
  const healthColor =
    health === 'critical' ? t.danger : health === 'watch' ? t.accent : t.success;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={22} color={t.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerEyebrow}>Living Estimate · MAGE ID</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>{project.name}</Text>
        </View>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView {...fabScroll} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }} showsVerticalScrollIndicator={false}>
        {!snapshot?.hasMarginBasis ? (
          <View style={styles.basisCard}>
            <MageAIMark size={28} color={t.accent} />
            <Text style={styles.basisTitle}>Add markup to track live margin</Text>
            <Text style={styles.basisBody}>
              This project&apos;s estimate doesn&apos;t carry a cost-and-markup split, so
              there&apos;s no bid margin to recompute against. Open the estimate, apply
              your markup, and the Living Estimate will track your projected margin as
              change orders, buyout, and actuals land.
            </Text>
            <TouchableOpacity
              style={styles.basisBtn}
              onPress={() => router.push({ pathname: '/job-costing', params: { projectId: project.id } } as any)}
              activeOpacity={0.85}
            >
              <Text style={styles.basisBtnText}>Open Job Costing</Text>
              <ArrowRight size={16} color={t.accent} strokeWidth={1.75} />
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* Hero — projected margin */}
            <View style={[styles.hero, { borderColor: healthColor }]}>
              <View style={styles.heroTopRow}>
                <Text style={styles.heroLabel}>Projected margin at completion</Text>
                <View style={[styles.healthChip, { backgroundColor: healthColor + '22' }]}>
                  {health === 'critical' ? (
                    <AlertTriangle size={13} color={healthColor} strokeWidth={1.75} />
                  ) : health === 'watch' ? (
                    <TrendingDown size={13} color={healthColor} strokeWidth={1.75} />
                  ) : (
                    <TrendingUp size={13} color={healthColor} strokeWidth={1.75} />
                  )}
                  <Text style={[styles.healthChipText, { color: healthColor }]}>
                    {health === 'critical' ? 'At risk' : health === 'watch' ? 'Watch' : 'On track'}
                  </Text>
                </View>
              </View>
              <Text style={[styles.heroValue, { color: healthColor }]}>
                {pct(snapshot.projected.marginPct)}
              </Text>
              <Text style={styles.heroSub}>{money(snapshot.projected.margin)} projected profit</Text>

              <View style={styles.heroDelta}>
                <Text style={styles.heroDeltaText}>
                  As bid <Text style={styles.heroDeltaStrong}>{pct(snapshot.original.marginPct)}</Text>
                </Text>
                <ArrowRight size={14} color={t.textMuted} strokeWidth={1.75} />
                <Text style={styles.heroDeltaText}>
                  Now <Text style={[styles.heroDeltaStrong, { color: healthColor }]}>{pct(snapshot.projected.marginPct)}</Text>
                </Text>
                <View style={{ flex: 1 }} />
                <Text style={[styles.heroErosion, { color: snapshot.marginErosionPoints >= 0 ? t.success : t.danger }]}>
                  {snapshot.marginErosionPoints >= 0 ? '+' : ''}{snapshot.marginErosionPoints.toFixed(1)} pts
                </Text>
              </View>
            </View>

            {/* Revenue vs cost, original vs projected */}
            <View style={styles.compareCard}>
              <View style={styles.compareHeaderRow}>
                <Text style={[styles.compareCol, styles.compareColLabel]} />
                <Text style={[styles.compareCol, styles.compareColHead]}>As bid</Text>
                <Text style={[styles.compareCol, styles.compareColHead]}>Projected</Text>
              </View>
              <CompareRow label="Revenue" original={snapshot.original.revenue} projected={snapshot.projected.revenue} t={t} styles={styles} />
              <CompareRow label="Cost" original={snapshot.original.cost} projected={snapshot.projected.cost} invert t={t} styles={styles} />
              <View style={styles.compareDivider} />
              <CompareRow label="Margin $" original={snapshot.original.margin} projected={snapshot.projected.margin} bold t={t} styles={styles} />
            </View>

            {/* Drivers — what moved margin off the bid */}
            {snapshot.drivers.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>What moved your margin</Text>
                <View style={styles.driversCard}>
                  {snapshot.drivers.map((d, i) => {
                    const up = d.marginImpact >= 0;
                    return (
                      <View key={d.key} style={[styles.driverRow, i > 0 && styles.driverRowBorder]}>
                        <View style={[styles.driverIcon, { backgroundColor: (up ? t.success : t.danger) + '1A' }]}>
                          {up ? <TrendingUp size={15} color={t.success} strokeWidth={1.75} /> : <TrendingDown size={15} color={t.danger} strokeWidth={1.75} />}
                        </View>
                        <View style={styles.driverBody}>
                          <Text style={styles.driverLabel}>{d.label}</Text>
                          <Text style={styles.driverDetail}>{d.detail}</Text>
                        </View>
                        <Text style={[styles.driverImpact, { color: up ? t.success : t.danger }]}>
                          {signedMoney(d.marginImpact)}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </>
            )}

            {/* Pending CO upside */}
            {snapshot.pendingChangeOrders !== 0 && (
              <View style={styles.upsideCard}>
                <MageAIMark size={16} color={t.info} />
                <Text style={styles.upsideText}>
                  <Text style={styles.upsideStrong}>{money(snapshot.pendingChangeOrders)}</Text> in pending change orders
                  — not yet booked into the projection.
                </Text>
              </View>
            )}

            {/* Method note */}
            <Text style={styles.note}>
              Cost projection uses the same EAC as Job Costing. Change orders are costed
              at your bid margin ({pct(snapshot.original.marginPct)}).
              {snapshot.untracedCommitments > 0
                ? ` ${snapshot.untracedCommitments} commitment${snapshot.untracedCommitments === 1 ? '' : 's'} aren't linked to estimate items, so their over/under-estimate variance lands in “Cost growth.”`
                : ''}
            </Text>

            <TouchableOpacity
              style={styles.linkRow}
              onPress={() => router.push({ pathname: '/margin-risk', params: { projectId: project.id } } as any)}
              activeOpacity={0.8}
            >
              <ShieldAlert size={16} color={t.accent} strokeWidth={1.75} />
              <Text style={styles.linkRowText}>Score this project&apos;s margin risk</Text>
              <ArrowRight size={16} color={t.accent} strokeWidth={1.75} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.linkRow}
              onPress={() => router.push({ pathname: '/job-costing', params: { projectId: project.id } } as any)}
              activeOpacity={0.8}
            >
              <Text style={styles.linkRowText}>Open Job Costing for phase detail</Text>
              <ArrowRight size={16} color={t.accent} strokeWidth={1.75} />
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function CompareRow({
  label, original, projected, invert, bold, t, styles,
}: {
  label: string;
  original: number;
  projected: number;
  invert?: boolean;
  bold?: boolean;
  t: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const delta = projected - original;
  // For cost, an increase is bad (red); for revenue/margin, an increase is good.
  const good = invert ? delta <= 0 : delta >= 0;
  const showDelta = Math.abs(delta) >= 1;
  return (
    <View style={styles.compareRow}>
      <Text style={[styles.compareCol, styles.compareColLabel, bold && styles.compareBold]}>{label}</Text>
      <Text style={[styles.compareCol, styles.compareColVal, bold && styles.compareBold]}>{money(original)}</Text>
      <View style={[styles.compareCol, styles.compareColValWrap]}>
        <Text style={[styles.compareColVal, bold && styles.compareBold]}>{money(projected)}</Text>
        {showDelta && (
          <Text style={[styles.compareDelta, { color: good ? t.success : t.danger }]}>
            {delta >= 0 ? '+' : '-'}{formatMoneyFull(Math.abs(delta))}
          </Text>
        )}
      </View>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: t.line,
  },
  headerBtn: { width: 38, height: 38, alignItems: 'center' as const, justifyContent: 'center' as const },
  headerText: { flex: 1 },
  headerEyebrow: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '600' as const, letterSpacing: 0.4 },
  headerTitle: { ...Type.serifHeadline, color: t.text },

  hero: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.panel,
    padding: 18,
    borderWidth: 1.5,
    gap: 4,
    marginBottom: 16,
  },
  heroTopRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
  heroLabel: { fontSize: Type.footnote.fontSize, color: t.textSecondary, fontWeight: '600' as const },
  healthChip: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.full },
  healthChipText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const },
  // The screen's ONE hero figure — projected margin. Serif per the type rule
  // (numbers that matter); the stat rows below stay sans so this keeps its
  // contrast. tabular-nums so the digits don't jitter as the margin updates.
  heroValue: { ...Type.serifLargeTitle, letterSpacing: -1, marginTop: 2, fontVariant: ['tabular-nums'] as const },
  heroSub: { fontSize: Type.subhead.fontSize, color: t.textSecondary, fontWeight: '500' as const },
  heroDelta: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: t.line,
  },
  heroDeltaText: { fontSize: Type.footnote.fontSize, color: t.textSecondary },
  heroDeltaStrong: { fontWeight: '800' as const, color: t.text },
  heroErosion: { fontSize: Type.subhead.fontSize, fontWeight: '800' as const },

  compareCard: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.panel,
    padding: 16,
    borderWidth: 1,
    borderColor: t.line,
    marginBottom: 16,
  },
  compareHeaderRow: { flexDirection: 'row' as const, marginBottom: 8 },
  compareRow: { flexDirection: 'row' as const, alignItems: 'center' as const, paddingVertical: 7 },
  compareCol: { flex: 1 },
  compareColLabel: { fontSize: Type.subhead.fontSize, color: t.textSecondary },
  compareColHead: { fontSize: Type.caption1.fontSize, color: t.textMuted, fontWeight: '700' as const, textAlign: 'right' as const, textTransform: 'uppercase' as const, letterSpacing: 0.4 },
  compareColVal: { fontSize: Type.subhead.fontSize, color: t.text, textAlign: 'right' as const, fontWeight: '600' as const },
  compareColValWrap: { alignItems: 'flex-end' as const },
  compareDelta: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, marginTop: 1 },
  compareBold: { fontWeight: '800' as const, color: t.text },
  compareDivider: { height: 1, backgroundColor: t.line, marginVertical: 4 },

  sectionTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: t.text, marginBottom: 10 },
  driversCard: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.panel,
    borderWidth: 1,
    borderColor: t.line,
    paddingHorizontal: 14,
    marginBottom: 16,
  },
  driverRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, paddingVertical: 13 },
  driverRowBorder: { borderTopWidth: 1, borderTopColor: t.line },
  driverIcon: { width: 30, height: 30, borderRadius: Tokens.radius.sm, alignItems: 'center' as const, justifyContent: 'center' as const },
  driverBody: { flex: 1, gap: 2 },
  driverLabel: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  driverDetail: { fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 16 },
  driverImpact: { fontSize: Type.subhead.fontSize, fontWeight: '800' as const },

  upsideCard: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    backgroundColor: t.info + '14',
    borderRadius: Tokens.radius.card,
    padding: 14,
    marginBottom: 16,
  },
  upsideText: { flex: 1, fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 18 },
  upsideStrong: { fontWeight: '800' as const, color: t.text },

  note: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17, marginBottom: 16 },

  linkRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    paddingVertical: 14,
  },
  linkRowText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.accent },

  basisCard: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.panel,
    padding: 24,
    borderWidth: 1,
    borderColor: t.line,
    alignItems: 'center' as const,
    gap: 12,
    marginTop: 24,
  },
  basisTitle: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: t.text, textAlign: 'center' as const },
  basisBody: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 20, textAlign: 'center' as const },
  basisBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, marginTop: 4 },
  basisBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.accent },
});
