// app/auto-bids.tsx — "MAGE bids for you".
//
// Inbound opportunities, already priced. Other AI bidding tools find and match
// bids but can't price them — they don't know your costs. MAGE prices each one
// from what your closed jobs of that kind cost you (when you have any) and the
// Win Optimizer's win curve, then ranks by expected profit. The screen says
// "in your numbers" only when a row actually used your history, and names the
// markup it assumed when you have never set one (audit wave 5, #16).
//
// Pro-gated (bid_scoring). Anti-slop: Colors/Type/Tokens + lucide only.

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { ChevronLeft, ChevronRight, Clock, AlertTriangle, Target } from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { InfoBubble } from '@/components/InfoBubble';
import { Colors, type ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { useBids } from '@/contexts/BidsContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useMaterialCart } from '@/contexts/MaterialCartContext';
import { useMaterialReceipts } from '@/hooks/useMaterialReceipts';
import { useLaborRates, useTimeEntriesMirror } from '@/hooks/useLaborRates';
import { formatMoney } from '@/utils/formatters';
import {
  buildPricedBids, historyFromProjects, ASSUMED_MARKUP, type PricedBid, type JobHistoryPoint,
} from '@/utils/autoBid';
import { suggestCostToDateWithSource } from '@/utils/wip';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

const BASIS_LABEL: Record<PricedBid['basis'], string> = {
  your_history: 'priced from what your past jobs cost',
  their_budget: 'priced off their posted budget',
  none: '',
};

function pct(markup: number): string {
  return `${Math.round(markup * 100)}%`;
}

export default function AutoBidsScreen() {
  const router = useRouter();
  const { canAccess, requiredTierFor } = useTierAccess();
  if (!canAccess('bid_scoring')) {
    return <Paywall visible feature="MAGE bids for you" requiredTier={requiredTierFor('bid_scoring')} onClose={() => router.back()} />;
  }
  return <AutoBidsInner />;
}

function AutoBidsInner() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { bids } = useBids();
  const { projects, leads, commitments, equipment, permits } = useProjects();
  const { receipts } = useMaterialReceipts();
  const timeEntries = useTimeEntriesMirror();
  const { rates: laborRates, overtimeMultiplier, overtimeRule } = useLaborRates();
  const { globalMarkup, markupDecided } = useMaterialCart();
  const { isDesktop } = useResponsiveLayout();

  // His markup when he has set one; otherwise an 18% every row calls assumed.
  const markupAssumed = markupDecided !== true || !Number.isFinite(globalMarkup);
  const typicalMarkup = markupAssumed ? ASSUMED_MARKUP : globalMarkup / 100;

  // Cost anchor: what his CLOSED jobs cost him — recorded job-costing actuals
  // (the same sources /wip-report prices: sub/PO payments, receipts, priced
  // crew hours, equipment days, permit fees) when they plausibly cover the
  // job, else the estimate before markup. Never the sell price (#16).
  const history = useMemo<JobHistoryPoint[]>(
    () =>
      historyFromProjects(projects, (projectId) => {
        const r = suggestCostToDateWithSource(
          commitments.filter((c) => c.projectId === projectId),
          receipts.filter((m) => m.projectId === projectId),
          { projectId, timeEntries, laborRates, overtimeMultiplier, overtimeRule, equipment, permits },
        );
        return { value: r.value, complete: r.complete };
      }),
    [projects, commitments, receipts, timeEntries, laborRates, overtimeMultiplier, overtimeRule, equipment, permits],
  );

  const priced = useMemo(
    () =>
      buildPricedBids({
        opportunities: (bids ?? []).map((b) => ({
          id: b.id,
          title: b.title,
          category: String(b.category ?? 'general'),
          estimatedValue: b.estimatedValue,
          budgetMin: b.budgetMin,
          budgetMax: b.budgetMax,
          deadline: b.deadline,
          city: b.city,
          state: b.state,
        })),
        history,
        leads: leads ?? [],
        typicalMarkup,
        markupAssumed,
        nowMs: Date.now(),
      }),
    [bids, history, leads, typicalMarkup, markupAssumed],
  );

  const top = priced.slice(0, 25);
  const totalExpected = priced.reduce((s, b) => s + b.expectedProfit, 0);
  // "In your numbers" is a claim about HIS costs: only when a row used them.
  const anyHistory = priced.some((b) => b.basis === 'your_history');
  const markupPhrase = markupAssumed ? `an assumed ${pct(typicalMarkup)} markup` : `your ${pct(typicalMarkup)} markup`;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.headerBar}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <ChevronLeft size={22} color={t.text} strokeWidth={2} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <MageAIMark size={15} color={t.accent} />
          <Text style={styles.headerTitle} numberOfLines={1}>Pre-priced bids</Text>
        </View>
        <View style={styles.backBtn} />
      </View>

      <ScrollView {...fabScroll} contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }]} showsVerticalScrollIndicator={false}>
        <View style={[styles.content, isDesktop && styles.contentDesktop]}>
          <View style={styles.hero}>
            <Text style={styles.eyebrow}>{anyHistory ? 'Priced in your numbers' : 'Priced off posted budgets'}</Text>
            {priced.length > 0 ? (
              <>
                <Text style={styles.heroStat}>{priced.length} ready to review</Text>
                <Text style={styles.heroSub}>
                  {formatMoney(totalExpected)} of expected profit across these bids, at the price
                  that maximizes what you actually take home.
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.heroStat}>Nothing to price yet</Text>
                <Text style={styles.heroSub}>
                  As opportunities come in — and as you close jobs that teach MAGE your real costs —
                  they show up here already priced.
                </Text>
              </>
            )}
          </View>

          <View style={isDesktop ? styles.cardGrid : undefined}>
          {top.map((b) => (
            <TouchableOpacity
              key={b.id}
              style={[styles.card, isDesktop && styles.cardDesktop]}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={`${b.title}, recommended ${formatMoney(b.recommendedPrice)}`}
              onPress={() => router.push({ pathname: '/bid-detail', params: { id: b.id } } as never)}
            >
              <View style={styles.cardTop}>
                <Text style={styles.cardTitle} numberOfLines={1}>{b.title}</Text>
                <ChevronRight size={15} color={t.textMuted} strokeWidth={2} />
              </View>

              <View style={styles.priceRow}>
                <View>
                  <Text style={styles.priceLabel}>MAGE price</Text>
                  <Text style={styles.priceVal}>{formatMoney(b.recommendedPrice)}</Text>
                </View>
                <View style={styles.metricBox}>
                  <Text style={styles.priceLabel}>Win odds</Text>
                  <Text style={styles.metricVal}>{Math.round(b.winProbability * 100)}%</Text>
                </View>
                <View style={styles.metricBox}>
                  <Text style={styles.priceLabel}>Exp. profit</Text>
                  <Text style={[styles.metricVal, { color: t.success }]}>{formatMoney(b.expectedProfit)}</Text>
                </View>
              </View>

              <Text style={styles.basis}>
                {BASIS_LABEL[b.basis]} · {b.markupAssumed ? `assumed ${pct(b.markup)} markup` : `your ${pct(b.markup)} markup`} · {b.confidence} confidence
              </Text>

              <View style={styles.flagRow}>
                {b.daysToDeadline != null && (
                  <View style={styles.flag}>
                    <Clock size={11} color={b.daysToDeadline <= 3 ? t.danger : t.textSecondary} strokeWidth={2} />
                    <Text
                      style={[
                        styles.flagText,
                        { color: b.daysToDeadline <= 3 ? t.danger : t.textSecondary },
                      ]}
                    >
                      {b.daysToDeadline}d to submit
                    </Text>
                  </View>
                )}
                {b.overBudget && (
                  <View style={styles.flag}>
                    <AlertTriangle size={11} color={Colors.warningLabel} strokeWidth={2} />
                    <Text style={[styles.flagText, { color: Colors.warningLabel }]}>
                      above their posted budget
                    </Text>
                  </View>
                )}
                {b.fit >= 1 && (
                  <View style={styles.flag}>
                    <Target size={11} color={t.success} strokeWidth={2} />
                    <Text style={[styles.flagText, { color: t.success }]}>your typical size</Text>
                  </View>
                )}
              </View>

              {b.drivers.length > 0 && (
                <Text style={styles.driver} numberOfLines={2}>{b.drivers[0]}</Text>
              )}
            </TouchableOpacity>
          ))}
          </View>

          {priced.length > top.length && (
            <Text style={styles.overflow}>+{priced.length - top.length} more priced bids</Text>
          )}

          <View style={styles.footnote}>
            <Text style={styles.footnoteText}>
              {anyHistory
                ? `Prices come from what your closed jobs cost and your win record, at ${markupPhrase}.`
                : `Priced off each owner's posted budget at ${markupPhrase} — close jobs to teach MAGE your costs.`}
            </Text>
            <InfoBubble
              title="How MAGE prices a bid"
              what={anyHistory
                ? `Where you have closed jobs of the same kind, MAGE starts from what they cost you (your recorded costs, or the estimate before markup when little was recorded), blended with the owner's posted budget at ${markupPhrase}. It then picks the price that maximizes expected profit — the balance of margin and your odds of winning.`
                : `You have no closed jobs of these kinds yet, so MAGE backs a cost out of each owner's posted budget at ${markupPhrase}, then picks the price that maximizes expected profit — the balance of margin and your odds of winning.`}
              why="Bidding too high loses the job; too low wins work that isn't worth building. This finds the price that makes you the most money over many bids."
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    headerBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: Tokens.spacing.sm,
      paddingVertical: Tokens.spacing.xs,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.line,
    },
    backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    headerTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xs },
    headerTitle: { ...Type.serifHeadline, color: t.text },
    scroll: { paddingBottom: 40 },
    content: {
      width: '100%',
      alignSelf: 'center',
      paddingHorizontal: Tokens.spacing.md,
      paddingTop: Tokens.spacing.lg,
    },
    // Desktop: this is a card LIST, not prose — use the viewport and lay the
    // bid cards out in a responsive grid instead of one 640px column.
    contentDesktop: { maxWidth: 1400, paddingHorizontal: Tokens.spacing.lg },
    cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Tokens.spacing.sm },
    // flexBasis picks the column count for the viewport; maxWidth stops a lone
    // trailing card from stretching across the whole 1400px row.
    cardDesktop: { flexGrow: 1, flexBasis: 380, maxWidth: 520, marginBottom: 0 },
    hero: { marginBottom: Tokens.spacing.lg },
    eyebrow: {
      ...Type.caption1,
      color: t.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 1,
      marginBottom: 2,
    },
    heroStat: { ...Type.title2, color: t.text },
    heroSub: { ...Type.subhead, color: t.textSecondary, marginTop: 4 },
    card: {
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.line,
      borderRadius: Tokens.radius.panel,
      padding: Tokens.spacing.md,
      marginBottom: Tokens.spacing.sm,
    },
    cardTop: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.sm },
    cardTitle: { ...Type.subheadEmphasized, color: t.text, flex: 1 },
    priceRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: Tokens.spacing.lg,
      marginTop: Tokens.spacing.sm,
    },
    priceLabel: { ...Type.caption2, color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
    priceVal: { ...Type.title3, color: t.text, fontVariant: ['tabular-nums'] },
    metricBox: {},
    metricVal: { ...Type.subheadEmphasized, color: t.text, fontVariant: ['tabular-nums'] },
    basis: { ...Type.caption1, color: t.textMuted, marginTop: 6 },
    flagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Tokens.spacing.sm, marginTop: Tokens.spacing.sm },
    flag: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    flagText: { ...Type.caption1, fontWeight: '600' },
    driver: { ...Type.caption1, color: t.textSecondary, marginTop: 8, lineHeight: 16 },
    overflow: { ...Type.caption1, color: t.textMuted, marginTop: Tokens.spacing.xs },
    footnote: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: Tokens.spacing.lg,
    },
    footnoteText: { ...Type.caption1, color: t.textMuted, flexShrink: 1 },
  });
