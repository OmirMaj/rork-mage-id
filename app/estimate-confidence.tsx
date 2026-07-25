// estimate-confidence.tsx — how much can you trust THIS estimate?
//
// The forward-looking close of the cost-learning loop. Takes the estimate you're
// about to send and scores every line against your personal cost database: lines
// priced in line with your proven actuals are "backed"; lines priced below what
// the work has actually cost you are flagged as underpriced (margin risk before
// the job starts); trades you've never done get a no-history flag. The headline
// score is the share of estimate $ backed by aligned, proven costs.
//
// Pure read over utils/estimateConfidence + utils/costDatabase. No network.

import React, { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, ShieldCheck, AlertTriangle, HelpCircle, CheckCircle2, Info, Wand2 } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useMaterialReceipts } from '@/hooks/useMaterialReceipts';
import { useEstimateCalibration } from '@/hooks/useEstimateCalibration';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import EmptyState from '@/components/EmptyState';
import { buildCostDatabase } from '@/utils/costDatabase';
import { applyCalibrationToEstimate } from '@/utils/applyCalibration';
import { commitEstimatePatch } from '@/utils/estimateCommit';
import { computeEstimateConfidence, type EstimateLineCheck, type PriceFlag } from '@/utils/estimateConfidence';
import { formatMoney, formatMoneyFull } from '@/utils/jobCostEngine';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

function formatRate(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  if (n >= 100) return `$${n.toFixed(0)}`;
  return `$${n.toFixed(2)}`;
}

export default function EstimateConfidenceScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('job_costing')) {
    return (
      <Paywall
        visible={true}
        feature="Estimate Confidence"
        requiredTier="pro"
        onClose={() => router.back()}
      />
    );
  }
  return <EstimateConfidenceInner />;
}

function flagColor(flag: PriceFlag, t: ThemeColors): string {
  switch (flag) {
    case 'underpriced': return t.danger;
    case 'overpriced': return t.accentHot;
    case 'aligned': return t.success;
    case 'unknown': return t.textMuted;
  }
}

function EstimateConfidenceInner() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  const { projects, commitments, updateProject } = useProjects();
  const { receipts } = useMaterialReceipts();
  const { corrections } = useEstimateCalibration();

  const project = useMemo(() => projects.find(p => p.id === projectId), [projects, projectId]);

  const report = useMemo(() => {
    if (!project) return null;
    const db = buildCostDatabase(projects, commitments, receipts);
    return computeEstimateConfidence(project, db);
  }, [project, projects, commitments, receipts]);

  // The payoff of the cost-learning moat: preview what applying the GC's saved
  // per-category corrections would do to THIS estimate. Only offered when a
  // correction actually matches a line here.
  const calibPreview = useMemo(() => {
    if (!project?.linkedEstimate || corrections.length === 0) return null;
    return applyCalibrationToEstimate(project.linkedEstimate, corrections);
  }, [project, corrections]);

  const onApplyCalibration = useCallback(() => {
    if (!project?.linkedEstimate || !calibPreview || calibPreview.changedCount === 0) return;
    const delta = calibPreview.newGrandTotal - calibPreview.oldGrandTotal;
    Alert.alert(
      'Apply your cost corrections?',
      `${calibPreview.changedCount} line${calibPreview.changedCount > 1 ? 's' : ''} across ${calibPreview.changedCategories.join(', ')} will be re-priced from your job history.\n\n${formatMoney(calibPreview.oldGrandTotal)} → ${formatMoney(calibPreview.newGrandTotal)}  (${delta >= 0 ? '+' : ''}${formatMoney(delta)})\n\nThe prior estimate is snapshotted so you can restore it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Apply',
          onPress: () => {
            updateProject(project.id, commitEstimatePatch(project, calibPreview.estimate, { reason: 'pre_overwrite', note: 'Cost calibration applied' }));
            if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          },
        },
      ],
    );
  }, [project, calibPreview, updateProject]);

  const scoreColor = report
    ? report.score >= 70 ? t.success : report.score >= 40 ? t.accentHot : t.danger
    : t.textMuted;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={22} color={t.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerEyebrow}>Estimate Confidence · MAGE</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>{project?.name ?? 'Price check'}</Text>
        </View>
        <View style={styles.headerBtn} />
      </View>

      {!project || !report || !report.hasEstimate ? (
        <EmptyState
          icon={<ShieldCheck size={36} color={t.accent} strokeWidth={1.6} />}
          title={!project ? 'Project not found' : 'No estimate to check'}
          message={
            !project
              ? 'Open this from a project to price-check its estimate against your history.'
              : 'Estimate Confidence checks each line against your cost database. Build an estimate with cost and markup to use it.'
          }
          actionLabel="Back"
          onAction={() => router.back()}
        />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }} showsVerticalScrollIndicator={false}>
          {/* Score hero */}
          <View style={[styles.hero, { borderColor: scoreColor + '55' }]}>
            <View style={[styles.scoreCircle, { backgroundColor: scoreColor + '1A', borderColor: scoreColor }]}>
              <Text style={[styles.scoreNum, { color: scoreColor }]}>{report.score}</Text>
            </View>
            <View style={styles.heroBody}>
              <Text style={styles.heroTitle}>
                {report.score >= 70 ? 'Well-backed estimate' : report.score >= 40 ? 'Partly proven' : 'Thin on history'}
              </Text>
              <Text style={styles.heroSub}>
                {Math.round(report.backedPct * 100)}% of this estimate ({formatMoney(report.backedCost)}) is priced in line with your proven costs.
              </Text>
            </View>
          </View>

          {calibPreview && calibPreview.changedCount > 0 && (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={onApplyCalibration}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, marginBottom: 14, backgroundColor: t.accent + '14', borderWidth: 1, borderColor: t.accent + '40' }}
              testID="apply-calibration-cta"
            >
              <Wand2 size={20} color={t.accent} strokeWidth={1.9} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: Type.subhead.fontSize, fontWeight: '800', color: t.text }}>Apply your cost corrections</Text>
                <Text style={{ fontSize: Type.footnote.fontSize, color: t.textMuted, marginTop: 2 }}>
                  {calibPreview.changedCount} line{calibPreview.changedCount > 1 ? 's' : ''} · {formatMoney(calibPreview.oldGrandTotal)} → {formatMoney(calibPreview.newGrandTotal)}
                </Text>
              </View>
              <ChevronLeft size={18} color={t.textMuted} strokeWidth={2} style={{ transform: [{ rotate: '180deg' }] }} />
            </TouchableOpacity>
          )}

          {!report.hasHistory && (
            <View style={styles.disclose}>
              <Info size={15} color={t.accent} strokeWidth={1.75} />
              <Text style={styles.discloseText}>
                No cost history yet — close a job or two with linked commitments and this fills in. Until then every line reads as no-history.
              </Text>
            </View>
          )}

          {/* Risk summary */}
          <View style={styles.summaryRow}>
            <View style={styles.sumCard}>
              <AlertTriangle size={15} color={t.danger} strokeWidth={1.75} />
              <Text style={[styles.sumNum, { color: report.underpricedExposure > 0 ? t.danger : t.text }]}>{formatMoney(report.underpricedExposure)}</Text>
              <Text style={styles.sumLabel}>underpriced · {report.underpricedCount} line{report.underpricedCount === 1 ? '' : 's'}</Text>
            </View>
            <View style={styles.sumCard}>
              <HelpCircle size={15} color={t.textMuted} strokeWidth={1.75} />
              <Text style={styles.sumNum}>{formatMoney(report.noHistoryExposure)}</Text>
              <Text style={styles.sumLabel}>no history · {report.noHistoryCount} line{report.noHistoryCount === 1 ? '' : 's'}</Text>
            </View>
          </View>

          <Text style={styles.sectionTitle}>Line-by-line</Text>
          {report.lines.map(l => (
            <LineRow key={l.materialId} line={l} t={t} styles={styles} />
          ))}

          <Text style={styles.note}>
            Underpriced = you&apos;re bidding below what this scope has actually cost you (margin risk).
            Overpriced = padded vs your history (may be uncompetitive). Aligned = within ±10% of your
            learned rate. Suggested rates come from your Cost Database and sharpen as you close jobs.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

function LineRow({
  line, t, styles,
}: {
  line: EstimateLineCheck;
  t: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const c = flagColor(line.flag, t);
  const Icon =
    line.flag === 'aligned' ? CheckCircle2
      : line.flag === 'underpriced' ? AlertTriangle
        : line.flag === 'overpriced' ? AlertTriangle
          : HelpCircle;
  const flagLabel =
    line.flag === 'aligned' ? 'Aligned'
      : line.flag === 'underpriced' ? 'Underpriced'
        : line.flag === 'overpriced' ? 'Padded'
          : 'No history';

  return (
    <View style={styles.line}>
      <View style={[styles.stripe, { backgroundColor: c }]} />
      <View style={styles.lineBody}>
        <View style={styles.lineHead}>
          <Text style={styles.lineName} numberOfLines={1}>{line.name}</Text>
          <View style={[styles.flagPill, { backgroundColor: c + '1F' }]}>
            <Icon size={11} color={c} />
            <Text style={[styles.flagText, { color: c }]}>{flagLabel}</Text>
          </View>
        </View>
        <View style={styles.lineMeta}>
          <Text style={styles.lineMetaText}>
            You: <Text style={styles.lineMetaStrong}>{formatRate(line.bidUnit)}</Text>/{line.unit}
          </Text>
          {line.learnedRate !== null ? (
            <>
              <Text style={styles.lineDot}>·</Text>
              <Text style={styles.lineMetaText}>
                Yours: <Text style={styles.lineMetaStrong}>{formatRate(line.learnedRate)}</Text>/{line.unit}
              </Text>
              {line.deviation !== null && (
                <>
                  <Text style={styles.lineDot}>·</Text>
                  <Text style={[styles.lineMetaStrong, { color: c }]}>
                    {line.deviation >= 0 ? '+' : ''}{Math.round(line.deviation * 100)}%
                  </Text>
                </>
              )}
              <Text style={styles.lineDot}>·</Text>
              <Text style={styles.lineMetaText}>{line.jobCount} job{line.jobCount === 1 ? '' : 's'}</Text>
            </>
          ) : (
            <>
              <Text style={styles.lineDot}>·</Text>
              <Text style={styles.lineMetaText}>{formatMoneyFull(line.lineTotal)} · no prior data</Text>
            </>
          )}
        </View>
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

  hero: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 14,
    backgroundColor: t.surface, borderRadius: Tokens.radius.panel,
    borderWidth: 1, padding: 16, marginBottom: 14,
  },
  scoreCircle: {
    width: 64, height: 64, borderRadius: Tokens.radius.full, borderWidth: 2,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  scoreNum: { fontSize: Type.title2.fontSize, fontWeight: '800' as const },
  heroBody: { flex: 1, gap: 3 },
  heroTitle: { fontSize: Type.headline.fontSize, fontWeight: '800' as const, color: t.text },
  heroSub: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 18 },

  disclose: {
    flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 8,
    backgroundColor: t.surfaceAlt, borderRadius: Tokens.radius.card, padding: 12, marginBottom: 12,
  },
  discloseText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 17 },

  summaryRow: { flexDirection: 'row' as const, gap: 12, marginBottom: 16 },
  sumCard: {
    flex: 1, backgroundColor: t.surface, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line, padding: 12, gap: 3,
  },
  sumNum: { fontSize: Type.title3.fontSize, fontWeight: '800' as const, color: t.text },
  sumLabel: { fontSize: Type.caption2.fontSize, color: t.textMuted },

  sectionTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: t.text, marginBottom: 10 },

  line: {
    flexDirection: 'row' as const, alignItems: 'stretch' as const, gap: 10,
    backgroundColor: t.surface, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line, paddingRight: 12, marginBottom: 8,
    overflow: 'hidden' as const,
  },
  stripe: { width: 4 },
  lineBody: { flex: 1, paddingVertical: 12, gap: 4 },
  lineHead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  lineName: { flex: 1, fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  flagPill: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.sm,
  },
  flagText: { fontSize: Type.caption2.fontSize, fontWeight: '800' as const, letterSpacing: 0.3 },
  lineMeta: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5, flexWrap: 'wrap' as const },
  lineMetaText: { fontSize: Type.caption1.fontSize, color: t.textSecondary },
  lineMetaStrong: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: t.text },
  lineDot: { fontSize: Type.caption1.fontSize, color: t.textMuted },

  note: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17, marginTop: 12 },
});
