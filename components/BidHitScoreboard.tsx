// BidHitScoreboard — the contractor's marketplace win-rate, made legible.
//
// Research finding: <6% of contractors track their bid-hit ratio, yet it's
// the clearest "am I winning?" signal. Surfacing it — with the ~25% industry
// average as a benchmark — turns vague effort into a falsifiable scoreboard
// and gives the app a recurring reason to open ("how am I doing?").
//
// Data source: CRM leads with source 'mage_bids' (created automatically when
// a contractor submits a bid via the marketplace — see submit-bid-response).
// Decided bids = won + lost; win-rate = won / decided. Speed-to-lead is the
// median minutes from receivedAt → firstRespondedAt.

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Trophy, Clock, Target, TrendingUp } from 'lucide-react-native';
import { useProjects } from '@/contexts/ProjectContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

// Industry-average commercial bid win-rate (~25%, "2-3 wins per 10 bids"),
// used as the benchmark line. See research synthesis.
const BENCHMARK_WIN_RATE = 0.25;

export default function BidHitScoreboard({ testID }: { testID?: string }) {
  const { leads } = useProjects();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const stats = useMemo(() => {
    const mine = (leads ?? []).filter(l => l.source === 'mage_bids');
    const won = mine.filter(l => l.stage === 'won').length;
    const lost = mine.filter(l => l.stage === 'lost').length;
    const decided = won + lost;
    const pending = mine.length - decided;
    const winRate = decided > 0 ? won / decided : null;

    // Median response time (minutes) where we have both timestamps.
    const responseMins: number[] = [];
    for (const l of mine) {
      if (l.receivedAt && l.firstRespondedAt) {
        const d = (+new Date(l.firstRespondedAt) - +new Date(l.receivedAt)) / 60000;
        if (Number.isFinite(d) && d >= 0) responseMins.push(d);
      }
    }
    responseMins.sort((a, b) => a - b);
    const medianResp = responseMins.length
      ? responseMins[Math.floor(responseMins.length / 2)]
      : null;

    return { total: mine.length, won, lost, pending, winRate, medianResp };
  }, [leads]);

  // Nothing to show until the contractor has submitted at least one bid.
  if (stats.total === 0) return null;

  const pct = stats.winRate != null ? Math.round(stats.winRate * 100) : null;
  const beatsBenchmark = stats.winRate != null && stats.winRate >= BENCHMARK_WIN_RATE;

  const respLabel = (() => {
    if (stats.medianResp == null) return '—';
    if (stats.medianResp < 1) return '<1 min';
    if (stats.medianResp < 60) return `${Math.round(stats.medianResp)} min`;
    const h = stats.medianResp / 60;
    if (h < 24) return `${h.toFixed(h < 10 ? 1 : 0)} hr`;
    return `${Math.round(h / 24)} d`;
  })();

  return (
    <View style={styles.card} testID={testID ?? 'bid-hit-scoreboard'}>
      <View style={styles.head}>
        <View style={styles.headIcon}><Target size={15} color={colors.accent} /></View>
        <Text style={styles.headTitle}>Your Bid-Hit Scoreboard</Text>
      </View>

      <View style={styles.row}>
        <View style={styles.stat}>
          <View style={styles.statTop}>
            <Trophy size={13} color={beatsBenchmark ? colors.success : colors.text} />
            <Text style={[styles.statValue, beatsBenchmark && { color: colors.success }]}>
              {pct != null ? `${pct}%` : '—'}
            </Text>
          </View>
          <Text style={styles.statLabel}>Win rate</Text>
        </View>
        <View style={styles.div} />
        <View style={styles.stat}>
          <View style={styles.statTop}>
            <TrendingUp size={13} color={colors.text} />
            <Text style={styles.statValue}>{stats.won}/{stats.won + stats.lost}</Text>
          </View>
          <Text style={styles.statLabel}>Won / decided</Text>
        </View>
        <View style={styles.div} />
        <View style={styles.stat}>
          <View style={styles.statTop}>
            <Clock size={13} color={colors.text} />
            <Text style={styles.statValue}>{respLabel}</Text>
          </View>
          <Text style={styles.statLabel}>Median response</Text>
        </View>
      </View>

      {pct != null ? (
        <Text style={styles.benchmark}>
          {beatsBenchmark
            ? `Above the ~25% industry average — keep it up.`
            : `Industry average is ~25%. Faster, more professional bids close the gap.`}
        </Text>
      ) : (
        <Text style={styles.benchmark}>
          {stats.pending} bid{stats.pending === 1 ? '' : 's'} pending. Win rate appears once results come in.
        </Text>
      )}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  card: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.lg, padding: 14,
    borderWidth: 1, borderColor: t.line, marginBottom: 12,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  headIcon: {
    width: 26, height: 26, borderRadius: 8, backgroundColor: t.accent + '15',
    alignItems: 'center', justifyContent: 'center',
  },
  headTitle: { fontSize: Type.subhead.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.2 },
  row: { flexDirection: 'row', alignItems: 'center' },
  stat: { flex: 1, alignItems: 'center', gap: 4 },
  statTop: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statValue: { fontSize: Type.title3.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.4 },
  statLabel: { fontSize: 10, fontWeight: '700', color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  div: { width: 1, alignSelf: 'stretch', backgroundColor: t.line, marginVertical: 4 },
  benchmark: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 12, lineHeight: 16, textAlign: 'center' },
});
