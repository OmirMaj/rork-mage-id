// app/track-record.tsx — the Brain's Track Record.
//
// The moat, made visible. Everyone else organizes your job; MAGE learns from it.
// This is where that claim gets receipts: every call the Brain made — a pace
// duration, an estimate, a margin verdict, a profit-leak flag, a bid — graded
// against what actually happened, once the job closes.
//
// Two layers, in order of trust:
//   1. SCOREBOARD  — per-domain rates (utils/brain/accuracyReport.ts): the
//      honest, n-gated summary ("pace beat the AI 8 of 10").
//   2. THE RECEIPTS — the individual predicted-vs-actual rows
//      (utils/brain/trackRecord.ts) that make the scoreboard believable.
//
// Mounting useBrainGrading() here also runs the grading sweep + loads resolved
// history, so opening this screen advances the loop.
//
// Business+ gated (same 'brain_accuracy' proxy as /brief and /business).
// Anti-slop: Colors/Type/Tokens only; lucide + MageAIMark for all glyphs.

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { ChevronLeft, Check, X, Minus, Info, TrendingUp } from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { Colors, type ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { useBrainGrading } from '@/hooks/useBrainGrading';
import {
  buildTrackRecord,
  summarizeTrackRecord,
  type ReceiptVerdict,
  type TrackRecordReceipt,
} from '@/utils/brain/trackRecord';
import type { AccuracyRow } from '@/utils/brain/accuracyReport';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

const MAX_RECEIPTS = 60;

// ─── Business gate ────────────────────────────────────────────────────────────

export default function TrackRecordScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('brain_accuracy')) {
    return (
      <Paywall
        visible={true}
        feature="Track Record"
        requiredTier="business"
        onClose={() => router.back()}
      />
    );
  }
  return <TrackRecordInner />;
}

// ─── Verdict → glyph + color ──────────────────────────────────────────────────

function verdictColor(v: ReceiptVerdict, t: ThemeColors): string {
  if (v === 'hit') return t.success;
  if (v === 'miss') return t.danger;
  if (v === 'tie') return t.textMuted;
  return t.accent; // info
}
const VERDICT_ICON: Record<ReceiptVerdict, typeof Check> = {
  hit: Check,
  miss: X,
  tie: Minus,
  info: Info,
};

function shortDate(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── Inner screen ─────────────────────────────────────────────────────────────

function TrackRecordInner() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { isDesktop } = useResponsiveLayout();

  // Mounting this runs the once-per-session grading sweep AND loads the full
  // resolved history for the accuracy state.
  const { resolvedRows, accuracyReport } = useBrainGrading();

  const receipts = useMemo(() => buildTrackRecord(resolvedRows), [resolvedRows]);
  const summary = useMemo(() => summarizeTrackRecord(receipts), [receipts]);
  const shown = receipts.slice(0, MAX_RECEIPTS);

  const hasAnything = accuracyReport.hasEnoughData || receipts.length > 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.headerBar}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Back"
          testID="track-record-back"
        >
          <ChevronLeft size={22} color={t.text} strokeWidth={2} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <MageAIMark size={15} color={t.accent} />
          <Text style={styles.headerTitle} numberOfLines={1}>Track record</Text>
        </View>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        {...fabScroll}
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.content, isDesktop && styles.contentDesktop]}>
          {/* Hero */}
          <View style={styles.hero}>
            <Text style={styles.eyebrow}>What the Brain called vs. what happened</Text>
            {summary.hitRatePct != null ? (
              <>
                <Text style={styles.heroStat}>{summary.hitRatePct}% right</Text>
                <Text style={styles.heroSub}>
                  {summary.hits} of {summary.hits + summary.misses} decisive calls landed
                  {summary.total > summary.hits + summary.misses
                    ? ` · ${summary.total} graded`
                    : ''}
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.heroStat}>Still learning</Text>
                <Text style={styles.heroSub}>
                  The Brain grades itself as your jobs close. Keep feeding it actuals and its
                  record fills in here.
                </Text>
              </>
            )}
          </View>

          {!hasAnything ? (
            <View style={styles.emptyCard}>
              <TrendingUp size={18} color={t.accent} strokeWidth={2} />
              <Text style={styles.emptyText}>
                Nothing graded yet. Every pace call, estimate, margin verdict, leak flag, and bid
                gets scored against reality once a job closes — the receipts show up right here.
              </Text>
            </View>
          ) : (
            <>
              {/* SCOREBOARD — per-domain rates */}
              {accuracyReport.hasEnoughData && (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>Scoreboard</Text>
                  <View style={[styles.scoreList, isDesktop && styles.scoreListDesktop]}>
                    {accuracyReport.rows.map((row) => (
                      <ScoreCard key={row.kind} row={row} styles={styles} t={t} isDesktop={isDesktop} />
                    ))}
                  </View>
                </View>
              )}

              {/* THE RECEIPTS — itemized proof */}
              {receipts.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>The receipts</Text>
                  <View style={styles.receiptList}>
                    {shown.map((r) => (
                      <ReceiptRow key={r.id} r={r} styles={styles} t={t} />
                    ))}
                  </View>
                  {receipts.length > MAX_RECEIPTS && (
                    <Text style={styles.overflowHint}>
                      +{receipts.length - MAX_RECEIPTS} more graded calls
                    </Text>
                  )}
                </View>
              )}
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Scoreboard card ──────────────────────────────────────────────────────────

function ScoreCard({
  row,
  styles,
  isDesktop,
}: {
  row: AccuracyRow;
  styles: ReturnType<typeof makeStyles>;
  t: ThemeColors;
  isDesktop: boolean;
}) {
  const pct = row.rate != null ? Math.round(Math.max(0, Math.min(1, row.rate)) * 100) : null;
  return (
    <View style={[styles.scoreCard, isDesktop && styles.scoreCardDesktop]}>
      <View style={styles.scoreTop}>
        <Text style={styles.scoreLabel}>{row.label}</Text>
        <Text style={styles.scoreN}>{row.n} graded</Text>
      </View>
      <Text style={styles.scoreHeadline}>{row.headline}</Text>
      {pct != null && (
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${pct}%` }]} />
        </View>
      )}
      <Text style={styles.scoreDetail}>{row.detail}</Text>
    </View>
  );
}

// ─── Receipt row ──────────────────────────────────────────────────────────────

function ReceiptRow({
  r,
  styles,
  t,
}: {
  r: TrackRecordReceipt;
  styles: ReturnType<typeof makeStyles>;
  t: ThemeColors;
}) {
  const c = verdictColor(r.verdict, t);
  const VIcon = VERDICT_ICON[r.verdict];
  const when = shortDate(r.whenISO);
  return (
    <View style={styles.receiptRow}>
      <View style={[styles.verdictDot, { backgroundColor: c + '1A' }]}>
        <VIcon size={12} color={c} strokeWidth={2.75} />
      </View>
      <View style={styles.receiptBody}>
        <View style={styles.receiptTop}>
          <Text style={styles.receiptLabel} numberOfLines={1}>
            {r.label}
          </Text>
          {when ? <Text style={styles.receiptWhen}>{when}</Text> : null}
        </View>
        <View style={styles.paRow}>
          <Text style={styles.pred} numberOfLines={1}>
            {r.predicted}
          </Text>
          <Minus size={11} color={t.textMuted} strokeWidth={2} style={styles.paArrow} />
          <Text style={[styles.actual, { color: c }]} numberOfLines={1}>
            {r.actual}
          </Text>
          {r.note ? (
            <Text style={styles.note} numberOfLines={1}>
              · {r.note}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (t: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: t.bg },

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

    scrollContent: { paddingBottom: 40 },
    content: {
      width: '100%',
      alignSelf: 'center',
      paddingHorizontal: Tokens.spacing.md,
      paddingTop: Tokens.spacing.lg,
    },
    // Desktop: scoreboard + receipts are data, not prose. Use the viewport;
    // the scoreboard becomes a multi-column grid, receipts get full width.
    contentDesktop: { maxWidth: 1400, paddingHorizontal: Tokens.spacing.lg },

    hero: { marginBottom: Tokens.spacing.lg },
    eyebrow: {
      ...Type.caption1,
      color: t.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 1,
      marginBottom: Tokens.spacing.xs,
    },
    heroStat: { ...Type.largeTitle, color: t.text },
    heroSub: { ...Type.subhead, color: t.textSecondary, marginTop: 4 },

    section: { marginBottom: Tokens.spacing.lg },
    sectionLabel: {
      ...Type.footnoteEmphasized,
      color: t.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginBottom: Tokens.spacing.sm,
    },

    // Scoreboard
    scoreList: { gap: Tokens.spacing.sm },
    scoreListDesktop: { flexDirection: 'row', flexWrap: 'wrap' },
    scoreCardDesktop: { flexGrow: 1, flexBasis: 320, maxWidth: 460 },
    scoreCard: {
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.line,
      borderRadius: Tokens.radius.panel,
      padding: Tokens.spacing.md,
    },
    scoreTop: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 4,
    },
    scoreLabel: { ...Type.subheadEmphasized, color: t.text },
    scoreN: { ...Type.caption1, color: t.textMuted },
    scoreHeadline: { ...Type.footnote, color: t.textSecondary, marginBottom: Tokens.spacing.sm },
    barTrack: {
      height: 6,
      borderRadius: Tokens.radius.full,
      backgroundColor: t.surfaceAlt,
      overflow: 'hidden',
      marginBottom: Tokens.spacing.sm,
    },
    barFill: { height: '100%', borderRadius: Tokens.radius.full, backgroundColor: t.accent },
    scoreDetail: { ...Type.caption1, color: t.textMuted, lineHeight: 17 },

    // Receipts
    receiptList: {
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.line,
      borderRadius: Tokens.radius.panel,
      paddingHorizontal: Tokens.spacing.md,
    },
    receiptRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Tokens.spacing.sm,
      paddingVertical: 11,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.line,
    },
    verdictDot: {
      width: 22,
      height: 22,
      borderRadius: Tokens.radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    receiptBody: { flex: 1 },
    receiptTop: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 1,
    },
    receiptLabel: { ...Type.footnoteEmphasized, color: t.text, flexShrink: 1 },
    receiptWhen: { ...Type.caption2, color: t.textMuted, marginLeft: Tokens.spacing.sm },
    paRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    paArrow: { marginHorizontal: 1 },
    pred: { ...Type.caption1, color: t.textSecondary, flexShrink: 1 },
    actual: { ...Type.caption1, fontWeight: '700' },
    note: { ...Type.caption1, color: t.textMuted, flexShrink: 1 },

    overflowHint: { ...Type.caption1, color: t.textMuted, marginTop: Tokens.spacing.sm },

    // Empty
    emptyCard: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Tokens.spacing.sm,
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.line,
      borderRadius: Tokens.radius.panel,
      padding: Tokens.spacing.md,
    },
    emptyText: { ...Type.footnote, color: t.textSecondary, flex: 1, lineHeight: 19 },
  });
