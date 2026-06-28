// win-optimizer.tsx — the bid price that makes you the most money.
//
// Reads the job's cost (prefilled from the project estimate when present), the
// GC's usual markup, and how many bidders they're up against, then runs
// utils/winOptimizer over their own Lead win/loss history to recommend the
// price that maximizes EXPECTED profit (price × P(win)). Three framed options —
// price-to-win, recommended, hold-margin — plus the reasoning behind the call.
//
// Works two ways: open it with a ?projectId to price that job's estimate, or
// open it standalone and type a cost ("what should I bid on a $40k job?").
// Pro-gated like the rest of the cost-intelligence suite.

import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, Stack, useRouter } from 'expo-router';
import { ChevronLeft, Trophy, TrendingUp, Target, Gem } from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { computeWinOptimizer, type BidPoint } from '@/utils/winOptimizer';
import { formatMoney } from '@/utils/formatters';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export default function WinOptimizerScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('job_costing')) {
    return (
      <Paywall
        visible={true}
        feature="Win Optimizer"
        requiredTier="pro"
        onClose={() => router.back()}
      />
    );
  }
  return <WinOptimizerInner />;
}

/** globalMarkup may be stored as a fraction (0.18) or a percent (18). Normalize to a percent for the input. */
function markupToPercent(globalMarkup: number | undefined): number {
  if (!globalMarkup || !Number.isFinite(globalMarkup)) return 18;
  return globalMarkup > 1 ? Math.round(globalMarkup) : Math.round(globalMarkup * 100);
}

function WinOptimizerInner() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { getProject, leads } = useProjects();

  const project = useMemo(() => (projectId ? getProject(projectId) : null), [projectId, getProject]);

  // Prefill from the project's linked estimate: baseTotal is the cost BEFORE
  // markup — exactly the cost basis the optimizer prices over.
  const prefillCost = project?.linkedEstimate?.baseTotal ?? 0;
  const prefillMarkupPct = markupToPercent(project?.linkedEstimate?.globalMarkup);

  const [costStr, setCostStr] = useState(prefillCost > 0 ? String(Math.round(prefillCost)) : '');
  const [markupStr, setMarkupStr] = useState(String(prefillMarkupPct));
  const [competitorsStr, setCompetitorsStr] = useState('');

  const cost = Math.max(0, parseFloat(costStr.replace(/[^0-9.]/g, '')) || 0);
  const typicalMarkup = Math.max(0, (parseFloat(markupStr) || 0) / 100);
  const competitorCount = Math.max(0, parseInt(competitorsStr, 10) || 0);

  const result = useMemo(() => {
    if (cost <= 0) return null;
    return computeWinOptimizer({
      cost,
      leads,
      typicalMarkup: typicalMarkup > 0 ? typicalMarkup : 0.18,
      competitorCount,
    });
  }, [cost, leads, typicalMarkup, competitorCount]);

  const confColor = result
    ? result.confidence === 'high' ? t.success : result.confidence === 'medium' ? t.accent : t.textMuted
    : t.textMuted;

  // Downsample the EV curve to a compact bar strip that shows the peak.
  const bars = useMemo(() => {
    if (!result) return [];
    const N = 22;
    const step = Math.max(1, Math.floor(result.curve.length / N));
    const sampled: BidPoint[] = [];
    for (let i = 0; i < result.curve.length; i += step) sampled.push(result.curve[i]);
    const maxEV = Math.max(...sampled.map(p => p.expectedProfit), 1);
    const recMarkup = result.recommended.markup;
    return sampled.map(p => ({
      h: Math.max(0.04, p.expectedProfit / maxEV),
      isPeak: Math.abs(p.markup - recMarkup) < 0.0051,
    }));
  }, [result]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={22} color={t.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerEyebrow}>Win Optimizer · MAGE</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>{project?.name ?? 'Price a bid'}</Text>
        </View>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 + insets.bottom }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Inputs */}
        <View style={styles.inputCard}>
          <View style={styles.inputRow}>
            <Text style={styles.inputLabel}>Job cost</Text>
            <View style={styles.inputWrap}>
              <Text style={styles.inputPrefix}>$</Text>
              <TextInput
                style={styles.input}
                value={costStr}
                onChangeText={setCostStr}
                placeholder="0"
                placeholderTextColor={t.textMuted}
                keyboardType="numeric"
                inputMode="numeric"
                returnKeyType="done"
              />
            </View>
          </View>
          <View style={styles.inputDivider} />
          <View style={styles.inputRow}>
            <Text style={styles.inputLabel}>Your usual markup</Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.input}
                value={markupStr}
                onChangeText={setMarkupStr}
                placeholder="18"
                placeholderTextColor={t.textMuted}
                keyboardType="numeric"
                inputMode="numeric"
                returnKeyType="done"
              />
              <Text style={styles.inputSuffix}>%</Text>
            </View>
          </View>
          <View style={styles.inputDivider} />
          <View style={styles.inputRow}>
            <Text style={styles.inputLabel}>Competing bids <Text style={styles.inputHint}>(optional)</Text></Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.input}
                value={competitorsStr}
                onChangeText={setCompetitorsStr}
                placeholder="—"
                placeholderTextColor={t.textMuted}
                keyboardType="numeric"
                inputMode="numeric"
                returnKeyType="done"
              />
            </View>
          </View>
        </View>

        {!result ? (
          <View style={styles.infoCard}>
            <Trophy size={26} color={t.accent} strokeWidth={1.7} />
            <Text style={styles.infoTitle}>Enter a job cost to price your bid</Text>
            <Text style={styles.infoBody}>
              The Win Optimizer finds the price that makes you the most money — balancing your
              margin against the odds of actually winning the job, learned from your own won/lost
              proposals.
            </Text>
          </View>
        ) : (
          <>
            {/* Recommended hero */}
            <View style={[styles.hero, { borderColor: t.accent }]}>
              <View style={styles.heroTopRow}>
                <Trophy size={16} color={t.accent} strokeWidth={1.75} />
                <Text style={styles.heroLabel}>Recommended bid</Text>
                <View style={{ flex: 1 }} />
                <View style={[styles.confChip, { backgroundColor: confColor + '22' }]}>
                  <Text style={[styles.confChipText, { color: confColor }]}>{result.confidence} confidence</Text>
                </View>
              </View>
              <Text style={styles.heroPrice}>{formatMoney(result.recommended.price)}</Text>
              <View style={styles.heroStatsRow}>
                <HeroStat label="Markup" value={`${Math.round(result.recommended.markup * 100)}%`} t={t} styles={styles} />
                <HeroStat label="Win odds" value={`${Math.round(result.recommended.winProbability * 100)}%`} t={t} styles={styles} />
                <HeroStat label="Profit" value={formatMoney(result.recommended.profit)} t={t} styles={styles} />
                <HeroStat label="Expected" value={formatMoney(result.recommended.expectedProfit)} t={t} styles={styles} accent />
              </View>
            </View>

            {/* EV curve strip */}
            <View style={styles.curveCard}>
              <Text style={styles.curveTitle}>Expected profit across price</Text>
              <View style={styles.barsRow}>
                {bars.map((b, i) => (
                  <View key={i} style={styles.barSlot}>
                    <View style={[styles.bar, { height: `${Math.round(b.h * 100)}%` as any, backgroundColor: b.isPeak ? t.accent : t.line }]} />
                  </View>
                ))}
              </View>
              <View style={styles.curveAxis}>
                <Text style={styles.curveAxisText}>lower price · win more</Text>
                <Text style={styles.curveAxisText}>higher price · earn more</Text>
              </View>
            </View>

            {/* Three options */}
            <Text style={styles.sectionTitle}>Your options</Text>
            <OptionCard
              icon={<Target size={16} color={t.success} strokeWidth={1.75} />}
              tag="Price to win" tagColor={t.success}
              point={result.aggressive} t={t} styles={styles}
            />
            <OptionCard
              icon={<TrendingUp size={16} color={t.accent} strokeWidth={1.75} />}
              tag="Recommended" tagColor={t.accent} highlight
              point={result.recommended} t={t} styles={styles}
            />
            <OptionCard
              icon={<Gem size={16} color={t.accentHot} strokeWidth={1.75} />}
              tag="Hold margin" tagColor={t.accentHot}
              point={result.premium} t={t} styles={styles}
            />

            {/* Drivers */}
            <Text style={styles.sectionTitle}>Why this price</Text>
            <View style={styles.driversCard}>
              {result.drivers.map((d, i) => (
                <View key={i} style={[styles.driverRow, i > 0 && styles.driverBorder]}>
                  <View style={{ marginTop: 2 }}><MageAIMark size={14} color={t.accent} /></View>
                  <Text style={styles.driverText}>{d}</Text>
                </View>
              ))}
            </View>

            <Text style={styles.note}>
              Win odds are modeled from your own closed proposals ({result.sampleSize} so far) — every
              lead you mark won or lost makes the next recommendation sharper. A guide, not a guarantee.
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function HeroStat({ label, value, t, styles, accent }: { label: string; value: string; t: ThemeColors; styles: ReturnType<typeof makeStyles>; accent?: boolean }) {
  return (
    <View style={styles.heroStat}>
      <Text style={styles.heroStatLabel}>{label}</Text>
      <Text style={[styles.heroStatValue, accent && { color: t.accent }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function OptionCard({ icon, tag, tagColor, point, highlight, t, styles }: {
  icon: React.ReactNode; tag: string; tagColor: string; point: BidPoint; highlight?: boolean;
  t: ThemeColors; styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={[styles.optionCard, highlight && { borderColor: tagColor, borderWidth: 1.5 }]}>
      <View style={styles.optionHead}>
        <View style={styles.optionTagRow}>
          {icon}
          <Text style={[styles.optionTag, { color: tagColor }]}>{tag}</Text>
        </View>
        <Text style={styles.optionPrice}>{formatMoney(point.price)}</Text>
      </View>
      <View style={styles.optionStatsRow}>
        <Text style={styles.optionStat}>{Math.round(point.markup * 100)}% markup</Text>
        <Text style={styles.optionDot}>·</Text>
        <Text style={styles.optionStat}>{Math.round(point.winProbability * 100)}% win</Text>
        <Text style={styles.optionDot}>·</Text>
        <Text style={styles.optionStat}>{formatMoney(point.expectedProfit)} expected</Text>
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

  inputCard: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.panel,
    borderWidth: 1, borderColor: t.line, paddingHorizontal: 16, marginBottom: 18,
  },
  inputRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, paddingVertical: 14 },
  inputDivider: { height: 1, backgroundColor: t.line },
  inputLabel: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: t.text },
  inputHint: { fontSize: Type.caption1.fontSize, color: t.textMuted, fontWeight: '500' as const },
  inputWrap: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 2, minWidth: 110, justifyContent: 'flex-end' as const },
  inputPrefix: { fontSize: Type.headline.fontSize, color: t.textSecondary, fontWeight: '700' as const },
  inputSuffix: { fontSize: Type.headline.fontSize, color: t.textSecondary, fontWeight: '700' as const },
  input: {
    fontSize: Type.title3.fontSize, fontWeight: '800' as const, color: t.text,
    textAlign: 'right' as const, minWidth: 60, padding: 0,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}),
  },

  hero: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.panel,
    padding: 18, borderWidth: 1.5, gap: 12, marginBottom: 16,
  },
  heroTopRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  heroLabel: { fontSize: Type.footnote.fontSize, color: t.textSecondary, fontWeight: '700' as const },
  confChip: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: Tokens.radius.full },
  confChipText: { fontSize: Type.caption2.fontSize, fontWeight: '800' as const, textTransform: 'capitalize' as const },
  heroPrice: { fontSize: Type.largeTitle.fontSize, fontWeight: '800' as const, color: t.text, letterSpacing: -1, lineHeight: Type.largeTitle.fontSize },
  heroStatsRow: { flexDirection: 'row' as const, gap: 8 },
  heroStat: { flex: 1 },
  heroStatLabel: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '600' as const, marginBottom: 2 },
  heroStatValue: { fontSize: Type.subhead.fontSize, fontWeight: '800' as const, color: t.text },

  curveCard: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.panel,
    borderWidth: 1, borderColor: t.line, padding: 14, marginBottom: 18, gap: 8,
  },
  curveTitle: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: t.text },
  barsRow: { flexDirection: 'row' as const, alignItems: 'flex-end' as const, height: 64, gap: 3 },
  barSlot: { flex: 1, height: '100%' as const, justifyContent: 'flex-end' as const },
  bar: { width: '100%' as const, borderRadius: Tokens.radius.full, minHeight: 3 },
  curveAxis: { flexDirection: 'row' as const, justifyContent: 'space-between' as const },
  curveAxisText: { fontSize: Type.caption2.fontSize, color: t.textMuted },

  sectionTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: t.text, marginBottom: 10, marginTop: 2 },

  optionCard: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line, padding: 14, marginBottom: 10, gap: 8,
  },
  optionHead: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
  optionTagRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  optionTag: { fontSize: Type.subhead.fontSize, fontWeight: '800' as const },
  optionPrice: { fontSize: Type.title3.fontSize, fontWeight: '800' as const, color: t.text },
  optionStatsRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, flexWrap: 'wrap' as const },
  optionStat: { fontSize: Type.footnote.fontSize, color: t.textSecondary, fontWeight: '600' as const },
  optionDot: { fontSize: Type.footnote.fontSize, color: t.textMuted },

  driversCard: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.panel,
    borderWidth: 1, borderColor: t.line, paddingHorizontal: 14, marginBottom: 16,
  },
  driverRow: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 8, paddingVertical: 12 },
  driverBorder: { borderTopWidth: 1, borderTopColor: t.line },
  driverText: { flex: 1, fontSize: Type.footnote.fontSize, color: t.text, lineHeight: 19 },

  note: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17, marginBottom: 14 },

  infoCard: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.panel,
    borderWidth: 1, borderColor: t.line, padding: 24, alignItems: 'center' as const,
    gap: 10, marginTop: 8,
  },
  infoTitle: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: t.text, textAlign: 'center' as const },
  infoBody: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 20, textAlign: 'center' as const },
});
