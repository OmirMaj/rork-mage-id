// bid-analytics.tsx — Bid Win Rate Optimizer (vision-doc #18).
//
// "Most small GCs bid 20-40 jobs/year and win 3-7. They have no idea
// why they win or lose. Their bidding is gut feel."
//
// This screen reads every bid_response row the GC has submitted to
// homeowner RFPs (the marketplace) and computes:
//
//   - Total submitted / awarded / declined / withdrawn
//   - Win rate (awarded / submitted)
//   - Avg bid amount on wins vs. losses
//   - Distribution by project size (under $100K / $100-500K / $500K+)
//   - Day-of-week wins (right-on-the-money for the vision-doc framing)
//
// At zero data, the screen shows the FRAME with empty placeholders so
// the GC sees what to expect. As they bid more jobs, the cells fill in.
// The vision-doc claim is statistical-significance at 50+ bids — at that
// volume the recommendations engine kicks in (v1.1).

import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  TrendingUp, Trophy, XCircle, Clock, ChevronRight, BarChart3,
  Calendar, DollarSign, Sparkles, AlertCircle,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { formatMoney, formatMoneyShort } from '@/utils/formatters';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

interface BidResponse {
  id: string;
  bid_id: string;
  estimate_amount: number;
  status: 'submitted' | 'shortlisted' | 'awarded' | 'declined' | 'withdrawn';
  submitted_at: string;
  responded_at: string | null;
}

const SIGNIFICANCE_THRESHOLD = 50;

export default function BidAnalyticsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [bids, setBids] = useState<BidResponse[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user?.id || !isSupabaseConfigured) {
        setLoading(false);
        return;
      }
      try {
        const { data, error } = await supabase
          .from('bid_responses')
          .select('id, bid_id, estimate_amount, status, submitted_at, responded_at')
          .eq('proposer_user_id', user.id);
        if (cancelled) return;
        if (error) {
          console.warn('[bid-analytics] pull failed', error.message);
        } else {
          setBids((data ?? []) as BidResponse[]);
        }
      } catch (err) {
        console.warn('[bid-analytics] fetch error', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  // ─── Statistics ──────────────────────────────────────────────
  const stats = useMemo(() => {
    const total = bids.length;
    const awarded = bids.filter(b => b.status === 'awarded').length;
    const declined = bids.filter(b => b.status === 'declined').length;
    const open = bids.filter(b => b.status === 'submitted' || b.status === 'shortlisted').length;
    const decided = awarded + declined;
    const winRate = decided > 0 ? Math.round((awarded / decided) * 100) : 0;

    const wonAmounts = bids.filter(b => b.status === 'awarded').map(b => b.estimate_amount);
    const lostAmounts = bids.filter(b => b.status === 'declined').map(b => b.estimate_amount);
    const avgWonAmount = wonAmounts.length > 0
      ? wonAmounts.reduce((s, n) => s + n, 0) / wonAmounts.length
      : 0;
    const avgLostAmount = lostAmounts.length > 0
      ? lostAmounts.reduce((s, n) => s + n, 0) / lostAmounts.length
      : 0;

    // Bucket by project size
    const buckets = { small: { won: 0, total: 0 }, medium: { won: 0, total: 0 }, large: { won: 0, total: 0 } };
    for (const b of bids) {
      const bucket = b.estimate_amount < 100_000 ? 'small'
        : b.estimate_amount < 500_000 ? 'medium' : 'large';
      buckets[bucket].total++;
      if (b.status === 'awarded') buckets[bucket].won++;
    }

    // Day-of-week analysis (when did the GC submit the winning bids?)
    const dowWins = [0, 0, 0, 0, 0, 0, 0]; // Sun-Sat
    const dowAll = [0, 0, 0, 0, 0, 0, 0];
    for (const b of bids) {
      const day = new Date(b.submitted_at).getDay();
      dowAll[day]++;
      if (b.status === 'awarded') dowWins[day]++;
    }

    return {
      total, awarded, declined, open, decided, winRate,
      avgWonAmount, avgLostAmount, buckets, dowWins, dowAll,
    };
  }, [bids]);

  const significant = stats.total >= SIGNIFICANCE_THRESHOLD;

  if (loading) {
    return (
      <View style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
        <Stack.Screen options={{ title: 'Bid analytics' }} />
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Bid analytics',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
        }}
      />
      <ScrollView contentContainerStyle={{ paddingTop: 12, paddingBottom: insets.bottom + 30 }}>
        {/* Hero — win rate front and center */}
        <View style={styles.hero}>
          <View style={styles.heroIconWrap}>
            <Trophy size={20} color={Colors.primary} />
          </View>
          <Text style={styles.heroTitle}>{stats.winRate}% win rate</Text>
          <Text style={styles.heroSub}>
            {stats.decided === 0
              ? `${stats.total} bid${stats.total === 1 ? '' : 's'} on file · no decisions yet`
              : `${stats.awarded} won of ${stats.decided} decided · ${stats.open} still open`}
          </Text>
        </View>

        {!significant && (
          <View style={styles.calloutCard}>
            <Sparkles size={14} color={Colors.warning} />
            <Text style={styles.calloutText}>
              {stats.total === 0
                ? 'Submit your first bid to start your win-rate baseline. The recommendations engine activates at 50 bids.'
                : `${stats.total} bid${stats.total === 1 ? '' : 's'} on file. AI recommendations unlock at ${SIGNIFICANCE_THRESHOLD}.`}
            </Text>
          </View>
        )}

        {/* Quick-stats grid */}
        <View style={styles.statsGrid}>
          <View style={styles.statCell}>
            <Trophy size={14} color={Colors.success} />
            <Text style={styles.statValue}>{stats.awarded}</Text>
            <Text style={styles.statLabel}>Won</Text>
          </View>
          <View style={styles.statCell}>
            <XCircle size={14} color={Colors.error} />
            <Text style={styles.statValue}>{stats.declined}</Text>
            <Text style={styles.statLabel}>Lost</Text>
          </View>
          <View style={styles.statCell}>
            <Clock size={14} color={Colors.info} />
            <Text style={styles.statValue}>{stats.open}</Text>
            <Text style={styles.statLabel}>Open</Text>
          </View>
        </View>

        {/* Avg amounts */}
        {stats.decided > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Avg bid amount</Text>
            <View style={styles.compareRow}>
              <View style={[styles.compareCell, { borderColor: Colors.success + '40' }]}>
                <Text style={[styles.compareLabel, { color: Colors.success }]}>WINS</Text>
                <Text style={styles.compareValue}>{stats.avgWonAmount > 0 ? formatMoneyShort(stats.avgWonAmount) : '—'}</Text>
              </View>
              <View style={[styles.compareCell, { borderColor: Colors.error + '40' }]}>
                <Text style={[styles.compareLabel, { color: Colors.error }]}>LOSSES</Text>
                <Text style={styles.compareValue}>{stats.avgLostAmount > 0 ? formatMoneyShort(stats.avgLostAmount) : '—'}</Text>
              </View>
            </View>
            {stats.avgWonAmount > 0 && stats.avgLostAmount > 0 && (
              <Text style={styles.compareNote}>
                {stats.avgWonAmount < stats.avgLostAmount
                  ? `You win when you bid ${formatMoney(stats.avgLostAmount - stats.avgWonAmount)} less than your typical losing bid.`
                  : `Your winning bids run ${formatMoney(stats.avgWonAmount - stats.avgLostAmount)} higher than your losing ones — pricing isn't your problem.`}
              </Text>
            )}
          </View>
        )}

        {/* Bucketed win rate */}
        {stats.total > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Win rate by project size</Text>
            <View style={styles.bucketCard}>
              {([
                { key: 'small' as const, label: 'Under $100K' },
                { key: 'medium' as const, label: '$100K – $500K' },
                { key: 'large' as const, label: 'Over $500K' },
              ]).map((b, idx) => {
                const bucket = stats.buckets[b.key];
                const rate = bucket.total > 0 ? Math.round((bucket.won / bucket.total) * 100) : 0;
                return (
                  <View
                    key={b.key}
                    style={[styles.bucketRow, idx < 2 && styles.bucketRowBorder]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.bucketLabel}>{b.label}</Text>
                      <Text style={styles.bucketSub}>
                        {bucket.total === 0
                          ? 'No bids in this range'
                          : `${bucket.won} won of ${bucket.total} bid${bucket.total === 1 ? '' : 's'}`}
                      </Text>
                    </View>
                    <View style={styles.bucketRateWrap}>
                      <Text style={[
                        styles.bucketRate,
                        rate >= 30 ? { color: Colors.success } : rate > 0 ? { color: Colors.warning } : { color: Colors.textMuted },
                      ]}>
                        {bucket.total > 0 ? `${rate}%` : '—'}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* Day-of-week */}
        {stats.awarded > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Wins by day-of-week</Text>
            <View style={styles.dowRow}>
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => {
                const total = stats.dowAll[i];
                const wins = stats.dowWins[i];
                const rate = total > 0 ? Math.round((wins / total) * 100) : 0;
                const intensity = Math.min(1, rate / 100);
                return (
                  <View key={`${d}-${i}`} style={styles.dowCell}>
                    <View
                      style={[
                        styles.dowBar,
                        { backgroundColor: Colors.success + Math.round(intensity * 240).toString(16).padStart(2, '0') },
                      ]}
                    />
                    <Text style={styles.dowLabel}>{d}</Text>
                    <Text style={styles.dowCount}>{total > 0 ? `${rate}%` : '·'}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* Recommendations callout (placeholder) */}
        {significant && (
          <View style={styles.recommendCard}>
            <View style={styles.recommendHeader}>
              <Sparkles size={14} color={Colors.primary} />
              <Text style={styles.recommendTitle}>AI recommendations</Text>
            </View>
            <Text style={styles.recommendBody}>
              You've crossed the 50-bid significance threshold. The AI recommendation engine
              activates in v1.1 — it'll tell you what markup to use per project size, what
              days to respond, and which scopes to walk away from.
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={styles.openMarketBtn}
          activeOpacity={0.85}
          onPress={() => router.push('/(tabs)/mage-id-bids' as never)}
        >
          <BarChart3 size={14} color={Colors.primary} />
          <Text style={styles.openMarketText}>Open marketplace</Text>
          <ChevronRight size={14} color={Colors.textMuted} />
        </TouchableOpacity>

        <View style={styles.footer}>
          <AlertCircle size={11} color={Colors.textMuted} />
          <Text style={styles.footerText}>
            Win-rate analytics improve as your bid history grows. Anonymized regional
            benchmarks (your win-rate vs. metro average) come in v1.1.
          </Text>
        </View>
      </ScrollView>

      {void Calendar}
      {void DollarSign}
      {void TrendingUp}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  hero: {
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.lg,
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  heroIconWrap: {
    width: 36,
    height: 36,
    borderRadius: Tokens.radius.md,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: 8,
  },
  heroTitle: {
    fontSize: Type.title1.fontSize,
    fontWeight: '900' as const,
    color: Colors.text,
    letterSpacing: -0.6,
  },
  heroSub: {
    fontSize: Type.footnote.fontSize,
    color: Colors.textSecondary,
    marginTop: 4,
  },

  calloutCard: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    backgroundColor: Colors.warning + '12',
    borderRadius: Tokens.radius.md,
    padding: 12,
    marginHorizontal: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.warning + '30',
  },
  calloutText: {
    flex: 1,
    fontSize: Type.caption1.fontSize,
    color: Colors.text,
    lineHeight: 17,
  },

  statsGrid: {
    flexDirection: 'row' as const,
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  statCell: {
    flex: 1,
    alignItems: 'center' as const,
    paddingVertical: 14,
    borderRadius: Tokens.radius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    gap: 4,
  },
  statValue: {
    fontSize: Type.title2.fontSize,
    fontWeight: '900' as const,
    color: Colors.text,
    letterSpacing: -0.4,
  },
  statLabel: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: Colors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  },

  section: { paddingHorizontal: 16, marginBottom: 18 },
  sectionTitle: {
    fontSize: Type.subheadline.fontSize,
    fontWeight: '800' as const,
    color: Colors.text,
    marginBottom: 8,
    letterSpacing: -0.2,
  },

  compareRow: {
    flexDirection: 'row' as const,
    gap: 10,
  },
  compareCell: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: Tokens.radius.md,
    borderWidth: 1,
    backgroundColor: Colors.surface,
    alignItems: 'center' as const,
  },
  compareLabel: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '900' as const,
    letterSpacing: 0.6,
  },
  compareValue: {
    fontSize: Type.title2.fontSize,
    fontWeight: '900' as const,
    color: Colors.text,
    letterSpacing: -0.4,
    marginTop: 4,
  },
  compareNote: {
    fontSize: Type.caption1.fontSize,
    color: Colors.textSecondary,
    marginTop: 8,
    fontStyle: 'italic' as const,
    lineHeight: 17,
  },

  bucketCard: {
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  bucketRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  bucketRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderLight,
  },
  bucketLabel: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  bucketSub: {
    fontSize: Type.caption2.fontSize,
    color: Colors.textMuted,
    marginTop: 1,
  },
  bucketRateWrap: { minWidth: 56, alignItems: 'flex-end' as const },
  bucketRate: {
    fontSize: Type.title3.fontSize,
    fontWeight: '900' as const,
    letterSpacing: -0.3,
  },

  dowRow: {
    flexDirection: 'row' as const,
    gap: 6,
    paddingVertical: 8,
  },
  dowCell: {
    flex: 1,
    alignItems: 'center' as const,
    gap: 4,
  },
  dowBar: {
    width: '100%',
    height: 50,
    borderRadius: Tokens.radius.sm,
  },
  dowLabel: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: Colors.textMuted,
  },
  dowCount: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: Colors.text,
  },

  recommendCard: {
    backgroundColor: Colors.primary + '08',
    borderRadius: Tokens.radius.md,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: Colors.primary + '30',
  },
  recommendHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, marginBottom: 6 },
  recommendTitle: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  recommendBody: {
    fontSize: Type.caption1.fontSize,
    color: Colors.textSecondary,
    lineHeight: 17,
  },

  openMarketBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    paddingVertical: 12,
    marginHorizontal: 16,
    borderRadius: Tokens.radius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  openMarketText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: Colors.text,
  },

  footer: {
    flexDirection: 'row' as const,
    gap: 8,
    alignItems: 'flex-start' as const,
    paddingHorizontal: 18,
    paddingVertical: 16,
    opacity: 0.7,
  },
  footerText: {
    flex: 1,
    fontSize: Type.caption2.fontSize,
    color: Colors.textMuted,
    lineHeight: 14,
  },
});
