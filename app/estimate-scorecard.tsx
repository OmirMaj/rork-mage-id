// estimate-scorecard.tsx — where your estimates are wrong, in dollars.
//
// The moat's proof screen. Three surfaces already touch estimate accuracy and
// none answers the question a GC actually has:
//   • /estimate-accuracy  — ONE project's lines (bid → committed → actual)
//   • /track-record       — the Brain's PREDICTIONS graded (different domain)
//   • /cost-database      — the price book, sorted by EXPOSURE, with bias
//                           rendered as a sentence at the bottom of a card
//
// The missing question is portfolio-level and money-denominated: "which trades
// are systematically costing me, and how much?" A percentage is a statistic;
// "drywall has cost you $18,400 more than you bid across 7 jobs" is a decision.
//
// All maths lives in utils/accuracyScorecard (pure, pinned by
// test:accuracy-scorecard). This file is a read — no new computation.

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { ChevronLeft, TrendingUp, TrendingDown, Minus, Library } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useMaterialReceipts } from '@/hooks/useMaterialReceipts';
import { useLaborCostSamples } from '@/hooks/useLaborRates';
import { useCostSeeds } from '@/hooks/useCostSeeds';
import { useTierAccess } from '@/hooks/useTierAccess';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import Paywall from '@/components/Paywall';
import EmptyState from '@/components/EmptyState';
import { buildCostDatabase } from '@/utils/costDatabase';
import {
  computeAccuracyScorecard, tradeHeadline, tradeAction, type TradeAccuracy,
} from '@/utils/accuracyScorecard';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

function money(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  return `${sign}$${Math.round(abs)}`;
}

export default function EstimateScorecardScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('job_costing')) {
    return (
      <Paywall visible feature="Estimate Scorecard" requiredTier="pro" onClose={() => router.back()} />
    );
  }
  return <ScorecardInner />;
}

function ScorecardInner() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const fabScroll = useBrainFabScroll();
  const router = useRouter();

  const { projects, commitments } = useProjects();
  const { receipts } = useMaterialReceipts();
  const laborSamples = useLaborCostSamples();
  const { seeds } = useCostSeeds();

  const card = useMemo(() => {
    const db = buildCostDatabase(projects, commitments, receipts, laborSamples, seeds);
    return computeAccuracyScorecard(db);
  }, [projects, commitments, receipts, laborSamples, seeds]);

  const patterns = card.trades.filter(x => x.isPattern);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={22} color={t.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerEyebrow}>Estimate Scorecard · MAGE ID</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>Where your bids are off</Text>
        </View>
        <View style={styles.headerBtn} />
      </View>

      {card.tradesRated === 0 ? (
        <EmptyState
          icon={<Library size={36} color={t.accent} strokeWidth={1.6} />}
          title="No bid-vs-actual history yet"
          message="Close a project that had a cost estimate, with commitments linked to its estimate lines. Once a scope has both a bid and a real cost, it shows up here — and every job after that sharpens it."
        />
      ) : (
        <ScrollView
          {...fabScroll}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }]}
        >
          {/* ── the number ─────────────────────────────────────────── */}
          <View style={styles.hero}>
            <Text style={styles.heroEyebrow}>LEFT ON THE TABLE</Text>
            <Text style={styles.heroValue}>{money(card.underbidDollars)}</Text>
            <Text style={styles.heroSub}>
              across {card.jobsAnalyzed} closed job{card.jobsAnalyzed === 1 ? '' : 's'} —
              scopes that cost more than you bid them
            </Text>

            <View style={styles.heroSplit}>
              <View style={styles.heroCell}>
                <Text style={styles.heroCellLabel}>Underbid</Text>
                <Text style={[styles.heroCellValue, { color: t.danger }]}>{money(card.underbidDollars)}</Text>
              </View>
              <View style={styles.heroCellDivider} />
              <View style={styles.heroCell}>
                <Text style={styles.heroCellLabel}>Overbid</Text>
                <Text style={[styles.heroCellValue, { color: t.successLabel }]}>{money(card.overbidDollars)}</Text>
              </View>
              <View style={styles.heroCellDivider} />
              <View style={styles.heroCell}>
                <Text style={styles.heroCellLabel}>Net</Text>
                <Text style={[styles.heroCellValue, { color: card.netMissDollars > 0 ? t.danger : t.text }]}>
                  {money(card.netMissDollars)}
                </Text>
              </View>
            </View>

            {/* Netting is the trap this screen refuses to fall into. */}
            <Text style={styles.heroNote}>
              These don&rsquo;t cancel out. Padding one trade while starving another is two
              problems, not zero — the padded bids cost you jobs you never won.
            </Text>
          </View>

          {/* ── findings ───────────────────────────────────────────── */}
          {patterns.length > 0 ? (
            <>
              <Text style={styles.sectionTitle}>
                {patterns.length} trade{patterns.length === 1 ? '' : 's'} with a pattern
              </Text>
              {patterns.map(tr => <TradeRow key={tr.key} tr={tr} styles={styles} t={t} />)}
            </>
          ) : (
            <View style={styles.calmCard}>
              <Text style={styles.calmTitle}>No systematic bias yet</Text>
              <Text style={styles.calmBody}>
                Every trade with enough history is bidding within a few percent of what it
                actually costs. Individual jobs still vary — that&rsquo;s normal — but nothing is
                consistently off in one direction.
              </Text>
            </View>
          )}

          {/* Everything else, for completeness — rated but not a pattern. */}
          {card.trades.length > patterns.length ? (
            <>
              <Text style={styles.sectionTitle}>Everything else</Text>
              {card.trades.filter(x => !x.isPattern).map(tr => (
                <TradeRow key={tr.key} tr={tr} styles={styles} t={t} muted />
              ))}
            </>
          ) : null}

          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => router.push('/cost-database')}
            accessibilityRole="button"
          >
            <Library size={16} color={t.accent} strokeWidth={1.75} />
            <Text style={styles.linkText}>Open the price book these numbers come from</Text>
          </TouchableOpacity>

          <Text style={styles.footnote}>
            Measured from closed jobs only — rates you typed in are excluded, and so is any
            job the cost engine set aside as a one-off. A miss is quantity × (what it cost −
            what you bid), per scope.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

function TradeRow({
  tr, styles, t, muted,
}: {
  tr: TradeAccuracy;
  styles: ReturnType<typeof makeStyles>;
  t: ThemeColors;
  muted?: boolean;
}) {
  const head = tradeHeadline(tr);
  const action = tradeAction(tr);
  const Icon = tr.direction === 'under' ? TrendingUp : tr.direction === 'over' ? TrendingDown : Minus;
  const tone = tr.direction === 'under' ? t.danger : tr.direction === 'over' ? t.successLabel : t.textMuted;

  return (
    <View style={[styles.row, muted && styles.rowMuted]}>
      <View style={styles.rowHead}>
        <Text style={styles.rowTrade} numberOfLines={1}>{tr.trade}</Text>
        <Text style={[styles.rowMoney, { color: tone }]}>{money(tr.missDollars)}</Text>
      </View>
      <View style={styles.rowMetaRow}>
        <Icon size={12} color={tone} strokeWidth={2} />
        <Text style={[styles.rowMeta, { color: tone }]}>
          {head ?? `${tr.jobCount} job${tr.jobCount === 1 ? '' : 's'} · within a few percent`}
        </Text>
        <Text style={styles.rowConfidence}>{tr.confidence}</Text>
      </View>
      {action ? <Text style={styles.rowAction}>{action}</Text> : null}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  header: {
    flexDirection: 'row' as const, alignItems: 'center' as const,
    paddingHorizontal: 8, paddingBottom: 10, gap: 4,
  },
  headerBtn: { width: 40, height: 40, alignItems: 'center' as const, justifyContent: 'center' as const },
  headerText: { flex: 1 },
  headerEyebrow: { ...Type.monoCaption, color: t.textMuted, letterSpacing: 0.8 },
  headerTitle: { ...Type.serifHeadline, color: t.text },

  content: { padding: 16, gap: 10 },

  hero: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.lg,
    borderWidth: 1, borderColor: t.line, padding: 20,
  },
  heroEyebrow: { ...Type.monoCaption, color: t.textMuted, letterSpacing: 1.4 },
  heroValue: {
    ...Type.serifLargeTitle, color: t.text, marginTop: 6,
    fontVariant: ['tabular-nums'] as const,
  },
  heroSub: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 19, marginTop: 6 },

  heroSplit: {
    flexDirection: 'row' as const, alignItems: 'center' as const,
    marginTop: 18, paddingTop: 16, borderTopWidth: 1, borderTopColor: t.line,
  },
  heroCell: { flex: 1 },
  heroCellDivider: { width: 1, height: 28, backgroundColor: t.line },
  heroCellLabel: { ...Type.monoCaption, color: t.textMuted, letterSpacing: 0.4, marginBottom: 4 },
  heroCellValue: {
    fontSize: Type.subheadline.fontSize, fontWeight: '700' as const,
    fontVariant: ['tabular-nums'] as const,
  },
  heroNote: {
    fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17,
    marginTop: 14,
  },

  sectionTitle: {
    ...Type.monoCaption, color: t.textMuted, letterSpacing: 1,
    marginTop: 16, marginBottom: 2, textTransform: 'uppercase' as const,
  },

  row: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.lg,
    borderWidth: 1, borderColor: t.line, padding: 14, gap: 6,
  },
  rowMuted: { opacity: 0.72 },
  rowHead: { flexDirection: 'row' as const, alignItems: 'baseline' as const, gap: 10 },
  rowTrade: { flex: 1, fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: t.text },
  rowMoney: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, fontVariant: ['tabular-nums'] as const },
  rowMetaRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  rowMeta: { flex: 1, fontSize: Type.caption1.fontSize, fontWeight: '600' as const },
  rowConfidence: { ...Type.monoCaption, color: t.textMuted, letterSpacing: 0.4 },
  rowAction: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 18 },

  calmCard: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.lg,
    borderWidth: 1, borderColor: t.line, padding: 16, gap: 6,
  },
  calmTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: t.text },
  calmBody: { fontSize: Type.footnote.fontSize, color: t.textMuted, lineHeight: 19 },

  linkRow: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8,
    paddingVertical: 14, marginTop: 4,
  },
  linkText: { flex: 1, fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.accent },

  footnote: { fontSize: Type.caption2.fontSize, color: t.textMuted, lineHeight: 16, marginTop: 2 },
});
