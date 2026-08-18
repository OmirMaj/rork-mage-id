// estimate-calibration.tsx — where your bids run high or low, across jobs.
//
// The cross-job correction layer of the cost-learning loop. estimate-accuracy
// measures ONE job after the fact; estimate-confidence scores the NEXT bid
// before it goes out. This screen sits between them: it compounds every
// measured job into a per-category bias ("you under-estimate Tile by 12%
// across 4 jobs") and lets the GC APPLY a correction factor that persists.
//
// Pure read over utils/estimateCalibration; applied factors persist via
// hooks/useEstimateCalibration. No network.
//
// FOLLOW-UP (documented, intentionally not built here): the estimate wizard
// should read useEstimateCalibration's applied factors and surface them as
// per-category price adjustments when building a new estimate. This screen
// only records the GC's decision; the wizard integration ships separately.

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { Stack, useRouter } from 'expo-router';
import { ChevronLeft, SlidersHorizontal, TrendingUp, TrendingDown, CheckCircle2, Scale, ArrowRight } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import EmptyState from '@/components/EmptyState';
import { computeCalibration, type CategoryCalibration, type CalibrationDirection, type CalibrationConfidence } from '@/utils/estimateCalibration';
import { useEstimateCalibration } from '@/hooks/useEstimateCalibration';
import { formatMoney } from '@/utils/jobCostEngine';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export default function EstimateCalibrationScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('portfolio_margin')) {
    return (
      <Paywall
        visible={true}
        feature="Estimate Calibration"
        requiredTier="pro"
        onClose={() => router.back()}
      />
    );
  }
  return <EstimateCalibrationInner />;
}

function directionColor(direction: CalibrationDirection, t: ThemeColors): string {
  switch (direction) {
    case 'under': return t.danger;
    case 'over': return t.accentHot;
    case 'aligned': return t.success;
  }
}

function confidenceLabel(c: CalibrationConfidence): string {
  switch (c) {
    case 'high': return 'High confidence';
    case 'medium': return 'Medium confidence';
    case 'low': return 'Low confidence';
  }
}

function EstimateCalibrationInner() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { projects, commitments } = useProjects();
  const { applyCorrection, removeCorrection, getCorrection } = useEstimateCalibration();

  const report = useMemo(
    () => computeCalibration({ projects, commitments }),
    [projects, commitments],
  );

  // Headline: $-weighted bias across every measured category.
  const biasPct = Math.round((report.summary.weightedBias - 1) * 100);
  const headline =
    biasPct > 0 ? `Your estimates run ${biasPct}% low`
    : biasPct < 0 ? `Your estimates run ${Math.abs(biasPct)}% high`
    : 'Your estimates are on the money';
  const heroColor =
    biasPct > 3 ? t.danger : biasPct < -3 ? t.accentHot : t.success;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={22} color={t.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerEyebrow}>Estimate Calibration · MAGE</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>Cross-job bias</Text>
        </View>
        <View style={styles.headerBtn} />
      </View>

      {!report.hasData ? (
        <EmptyState
          icon={<SlidersHorizontal size={36} color={t.accent} strokeWidth={1.6} />}
          title="No measured jobs yet"
          message="Calibration compounds bid-vs-actual truth across jobs into a per-category correction. To light it up:"
          steps={[
            'Build estimates with cost and markup on your projects.',
            'Award buyout so commitments link back to estimate lines.',
            'Record sub payments — once actuals exist, bias appears here.',
          ]}
          actionLabel="Open Projects"
          onAction={() => router.push('/(tabs)/(home)' as any)}
        />
      ) : (
        <ScrollView {...fabScroll} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }} showsVerticalScrollIndicator={false}>
          {/* Overall calibration hero */}
          <View style={[styles.hero, { borderColor: heroColor }]}>
            <Text style={styles.heroLabel}>Overall calibration</Text>
            <Text style={[styles.heroHeadline, { color: heroColor }]}>{headline}</Text>
            <Text style={styles.heroSub}>
              {`Weighted across ${report.summary.categoryCount} ${report.summary.categoryCount === 1 ? 'category' : 'categories'} with real actuals on ${report.summary.totalJobs} ${report.summary.totalJobs === 1 ? 'job' : 'jobs'}.`}
              {report.summary.biggestUnder
                ? ` Biggest bleed: ${report.summary.biggestUnder.category}, ${formatMoney(report.summary.biggestUnder.actualTotal - report.summary.biggestUnder.estimatedTotal)} over bid.`
                : ' No category is running meaningfully under right now.'}
            </Text>
          </View>

          {/* Per-category corrections */}
          <Text style={styles.sectionTitle}>By category — worst calibration first</Text>
          {report.categories.map(c => (
            <CategoryCard
              key={c.category}
              c={c}
              t={t}
              styles={styles}
              applied={getCorrection(c.category)?.multiplier}
              onApply={() => applyCorrection(c.category, c.suggestedMultiplier)}
              onRemove={() => removeCorrection(c.category)}
            />
          ))}

          <Text style={styles.note}>
            Applied factors are saved on this device. They record your decision so
            you can revisit it here, but they don't yet sync across devices or feed
            new estimates automatically — reapply them after a reinstall or on a new
            phone. Suggestions are clamped to a 0.8–1.5 band; bias beyond that usually
            means a scope bust or an unlinked commitment, not a pricing habit.
          </Text>

          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => router.push('/cost-database' as any)}
            activeOpacity={0.8}
          >
            <Scale size={16} color={t.accent} strokeWidth={1.75} />
            <Text style={styles.linkRowText}>Open your Cost Database</Text>
            <ArrowRight size={16} color={t.accent} strokeWidth={1.75} />
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  );
}

function CategoryCard({
  c, t, styles, applied, onApply, onRemove,
}: {
  c: CategoryCalibration;
  t: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
  applied: number | undefined;
  onApply: () => void;
  onRemove: () => void;
}) {
  const dc = directionColor(c.direction, t);
  const pct = Math.round((c.bias - 1) * 100);
  const isApplied = applied !== undefined;
  return (
    <View style={[styles.card, { borderLeftColor: dc }]}>
      <View style={styles.cardHead}>
        {c.direction === 'under' ? (
          <TrendingUp size={16} color={dc} strokeWidth={1.75} />
        ) : c.direction === 'over' ? (
          <TrendingDown size={16} color={dc} strokeWidth={1.75} />
        ) : (
          <CheckCircle2 size={16} color={dc} strokeWidth={1.75} />
        )}
        <Text style={styles.cardTitle} numberOfLines={1}>{c.category}</Text>
        <Text style={[styles.cardPct, { color: dc }]}>{pct >= 0 ? '+' : ''}{pct}%</Text>
      </View>

      <View style={styles.cardMetaRow}>
        <Text style={styles.cardMeta}>{formatMoney(c.estimatedTotal)} bid → {formatMoney(c.actualTotal)} actual</Text>
        <View style={[styles.confChip, { backgroundColor: t.line }]}>
          <Text style={styles.confChipText}>{confidenceLabel(c.confidence)} · {c.jobs} {c.jobs === 1 ? 'job' : 'jobs'}</Text>
        </View>
      </View>

      <Text style={styles.cardDetail}>{c.detail}</Text>

      {c.direction !== 'aligned' && (
        isApplied ? (
          <View style={styles.appliedRow}>
            <View style={styles.appliedBadge}>
              <CheckCircle2 size={14} color={t.success} strokeWidth={1.75} />
              <Text style={[styles.appliedText, { color: t.success }]}>Correction ×{(applied ?? 1).toFixed(2)} applied</Text>
            </View>
            <TouchableOpacity onPress={onRemove} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove correction for ${c.category}`}>
              <Text style={[styles.removeText, { color: t.danger }]}>Remove</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.applyBtn, { backgroundColor: t.accent }]}
            onPress={onApply}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={`Apply correction for ${c.category}`}
          >
            <SlidersHorizontal size={14} color={t.bg} strokeWidth={1.75} />
            <Text style={[styles.applyBtnText, { color: t.bg }]}>Apply ×{c.suggestedMultiplier.toFixed(2)} correction</Text>
          </TouchableOpacity>
        )
      )}
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
    backgroundColor: t.surface, borderRadius: Tokens.radius.panel,
    padding: 18, borderWidth: 1.5, gap: 8, marginBottom: 18,
  },
  heroLabel: { fontSize: Type.footnote.fontSize, color: t.textSecondary, fontWeight: '600' as const },
  heroHeadline: { fontSize: Type.title2.fontSize, fontWeight: '800' as const, letterSpacing: -0.5 },
  heroSub: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 18 },

  sectionTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: t.text, marginBottom: 10, marginTop: 2 },

  card: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line, borderLeftWidth: 4,
    padding: 14, marginBottom: 10, gap: 8,
  },
  cardHead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  cardTitle: { flex: 1, fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  cardPct: { fontSize: Type.subhead.fontSize, fontWeight: '800' as const },
  cardMetaRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, gap: 8, flexWrap: 'wrap' as const },
  cardMeta: { fontSize: Type.caption1.fontSize, color: t.textMuted },
  confChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.full },
  confChipText: { fontSize: Type.caption2.fontSize, color: t.textSecondary, fontWeight: '700' as const },
  cardDetail: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 18 },

  applyBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const,
    gap: 6, paddingVertical: 10, borderRadius: Tokens.radius.full, marginTop: 2,
  },
  applyBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '800' as const },
  appliedRow: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const,
    marginTop: 2, paddingVertical: 4,
  },
  appliedBadge: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  appliedText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const },
  removeText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const },

  note: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17, marginTop: 6, marginBottom: 14 },

  linkRow: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const,
    gap: 6, paddingVertical: 14,
  },
  linkRowText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.accent },
});
