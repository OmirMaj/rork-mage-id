import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  TrendingUp, AlertTriangle, CheckCircle2, Settings, RefreshCw, Target, XCircle, BookOpen,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import {
  scoreBid, getCompanyProfile, getCachedResult, setCachedResult,
  type CompanyAIProfile, type BidScoreResult,
} from '@/utils/aiService';
import { AIProfileSetup } from '@/components/AIBidScorer';
import {
  bidHistoryFacts, outboundBidRecordsFromResponses, type BidHistoryFacts,
} from '@/utils/bidHistoryFacts';
import { stableHash } from '@/utils/stableHash';
import { recordPrediction } from '@/utils/brain/predictionLedger';
import { useAuth } from '@/contexts/AuthContext';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

interface BidScoringInput {
  id: string;
  title: string;
  department: string;
  estimated_value: number;
  naics_code?: string;
  set_aside?: string | null;
  state?: string;
  description?: string;
}

interface AIBidScorecardProps {
  bid: BidScoringInput;
  testID?: string;
}

function scoreColor(score: number): string {
  if (score >= 80) return "#2E7D44";
  if (score >= 60) return "#FF6A1A";
  if (score >= 40) return Colors.warning;
  return "#C84038";
}

function scoreLabel(score: number): string {
  if (score >= 85) return 'Strong Fit — Go';
  if (score >= 65) return 'Good Fit — Likely Go';
  if (score >= 45) return 'Partial Fit — Review';
  return 'Weak Fit — No-Go';
}

function goNoGo(score: number): 'go' | 'review' | 'no_go' {
  if (score >= 65) return 'go';
  if (score >= 45) return 'review';
  return 'no_go';
}

const PROFILE_REQUIRED_THRESHOLD = 1;

export default function AIBidScorecard({ bid, testID }: AIBidScorecardProps) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { user } = useAuth();
  const [profile, setProfile] = useState<CompanyAIProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [showProfileSetup, setShowProfileSetup] = useState(false);
  const [score, setScore] = useState<BidScoreResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Win-history facts from the GC's OWN outbound bids: the marketplace
  // bid_responses THEY submitted (awarded → won, declined → lost). This must
  // NEVER be built from Subcontractor.bidHistory — those are subs' bids INTO
  // the GC's packages, a population whose pooled "win rate" is ~1/(subs per
  // package) no matter how good the GC is. See utils/bidHistoryFacts.ts
  // POPULATION RULE. With no outbound history the facts stay empty and the
  // UI honestly says odds can't be estimated yet.
  const { data: myResponses } = useQuery({
    queryKey: ['my-bid-responses', user?.id],
    enabled: !!user?.id && isSupabaseConfigured,
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error: qErr } = await supabase
        .from('bid_responses')
        .select('bid_amount,status')
        .eq('user_id', user.id);
      if (qErr) {
        console.warn('[AI Bid] outbound bid history fetch failed:', qErr.message);
        return [];
      }
      return data ?? [];
    },
  });

  const histFacts: BidHistoryFacts = useMemo(
    () => bidHistoryFacts(outboundBidRecordsFromResponses(myResponses ?? [])),
    [myResponses],
  );

  // Salt the cache key with the grounding CONTENT (facts + profile), not just
  // the bid id: a score computed before decided bids / profile edits existed
  // must not replay its stale null-probability result for the 24h TTL.
  const cacheKey = useMemo(() => {
    const factsHash = stableHash(`${histFacts.decidedCount}|${histFacts.facts.join('|')}`);
    const profileHash = profile
      ? stableHash([
          profile.specialties.join(','), profile.trades.join(','),
          profile.preferredSize, profile.location, profile.certifications.join(','),
        ].join('|'))
      : 'np';
    return `bidscore_${bid.id}_f${factsHash}_p${profileHash}`;
  }, [bid.id, histFacts, profile]);

  const loadProfile = useCallback(async () => {
    setProfileLoading(true);
    try {
      const p = await getCompanyProfile();
      setProfile(p);
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    (async () => {
      const cached = await getCachedResult<BidScoreResult>(cacheKey, 24 * 60 * 60 * 1000);
      if (cached) setScore(cached);
    })();
  }, [cacheKey]);

  const profileReady = !!profile && (profile.specialties.length + profile.trades.length) >= PROFILE_REQUIRED_THRESHOLD;

  const runScore = useCallback(async (force = false) => {
    if (!profileReady || !profile) {
      setShowProfileSetup(true);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (!force) {
        const cached = await getCachedResult<BidScoreResult>(cacheKey, 24 * 60 * 60 * 1000);
        if (cached) {
          setScore(cached);
          setLoading(false);
          return;
        }
      }
      // Pass bid history facts so the model grounds win probability on real outcomes.
      const result = await scoreBid(bid, profile, histFacts);
      await setCachedResult(cacheKey, result);
      setScore(result);
      // G4: fire-and-forget capture — only on fresh compute (cache-miss path)
      // Cache-hit renders never re-record; grading dedupes by subject_id anyway.
      try {
        recordPrediction(
          'bid_score',
          bid.id,
          {
            bidId: bid.id,
            matchScore: result.matchScore,
            estimatedWinProbability: result.estimatedWinProbability,
            decidedCount: histFacts.decidedCount,
          },
        );
      } catch { /* G4 */ }
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      setError(err?.message || 'Failed to score bid');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  }, [bid, profile, profileReady, cacheKey, histFacts]);

  const handleProfileSaved = useCallback((p: CompanyAIProfile) => {
    setProfile(p);
    setShowProfileSetup(false);
    // Auto-run scoring after profile saved
    setTimeout(() => { void runScore(true); }, 200);
  }, [runScore]);

  // Idle state — no score yet
  if (!score && !loading && !error) {
    return (
      <View style={styles.container} testID={testID}>
        <View style={styles.heroRow}>
          <View style={styles.iconWrap}>
            <MageAIMark size={18} color={"#FF6A1A"} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>AI Go/No-Go Analysis</Text>
            <Text style={styles.subtitle}>
              {profileReady
                ? 'Score this bid against your company profile in seconds.'
                : 'Set up a quick company profile and get personalized bid scoring.'}
            </Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.runBtn}
          onPress={() => void runScore(false)}
          activeOpacity={0.85}
          disabled={profileLoading}
          testID="ai-score-bid-btn"
        >
          {profileLoading ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <>
              <MageAIMark size={15} color="#FFF" />
              <Text style={styles.runBtnText}>
                {profileReady ? 'Run Go/No-Go Score' : 'Set Up & Score'}
              </Text>
            </>
          )}
        </TouchableOpacity>
        <AIProfileSetup
          visible={showProfileSetup}
          onClose={() => setShowProfileSetup(false)}
          onSave={handleProfileSaved}
          initialProfile={profile}
        />
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.loadingContainer]} testID={testID}>
        <ActivityIndicator size="small" color={"#FF6A1A"} />
        <Text style={styles.loadingText}>Scoring bid against your profile…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, { borderColor: "#C84038" + '40' }]} testID={testID}>
        <View style={styles.heroRow}>
          <AlertTriangle size={18} color={"#C84038"} strokeWidth={1.75} />
          <Text style={[styles.title, { color: "#C84038" }]}>Scoring Failed</Text>
        </View>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.runBtn} onPress={() => void runScore(true)} activeOpacity={0.85}>
          <RefreshCw size={14} color="#FFF" strokeWidth={1.75} />
          <Text style={styles.runBtnText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!score) return null;

  const color = scoreColor(score.matchScore);
  const decision = goNoGo(score.matchScore);
  const winProb = score.estimatedWinProbability;
  const winPct = winProb !== null && winProb !== undefined ? Math.round(winProb * 100) : null;

  return (
    <View style={styles.container} testID={testID}>
      <View style={styles.heroRow}>
        <View style={styles.iconWrap}>
          <MageAIMark size={18} color={"#FF6A1A"} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>AI Go/No-Go Analysis</Text>
          <Text style={styles.subtitle}>Cached · tap refresh to re-score</Text>
        </View>
        <TouchableOpacity onPress={() => void runScore(true)} activeOpacity={0.7} style={styles.refreshBtn} testID="ai-rescore-btn" accessibilityRole="button" accessibilityLabel="Refresh">
          <RefreshCw size={14} color={"#9AA3AD"} strokeWidth={1.75} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setShowProfileSetup(true)} activeOpacity={0.7} style={styles.refreshBtn} testID="ai-edit-profile-btn" accessibilityRole="button" accessibilityLabel="Settings">
          <Settings size={14} color={"#9AA3AD"} strokeWidth={1.75} />
        </TouchableOpacity>
      </View>

      {/* Score gauge */}
      <View style={styles.gaugeCard}>
        <View style={[styles.scoreBubble, { backgroundColor: color + '18', borderColor: color }]}>
          <Text style={[styles.scoreNum, { color }]}>{Math.round(score.matchScore)}</Text>
          <Text style={[styles.scoreOutOf, { color }]}>/ 100</Text>
        </View>
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={[styles.decisionLabel, { color }]}>{scoreLabel(score.matchScore)}</Text>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${Math.min(100, score.matchScore)}%`, backgroundColor: color }]} />
          </View>
          <View style={styles.winRow}>
            <Target size={12} color={"#9AA3AD"} strokeWidth={1.75} />
            {winPct !== null ? (
              <Text style={styles.winText}>
                <Text style={styles.winPct}>{winPct}%</Text> est. win probability
              </Text>
            ) : (
              <Text style={styles.winText}>
                Not enough decided bids to estimate odds — tracked from your next wins/losses
              </Text>
            )}
          </View>
          {histFacts.decidedCount > 0 && histFacts.decidedCount < 3 && (
            <View style={styles.histRow}>
              <BookOpen size={10} color={"#9AA3AD"} strokeWidth={1.75} />
              <Text style={styles.histText}>{histFacts.decidedCount} decided bid{histFacts.decidedCount === 1 ? '' : 's'} tracked so far</Text>
            </View>
          )}
        </View>
      </View>

      {/* Recommendation pill */}
      <View style={[styles.decisionPill, {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        backgroundColor: decision === 'go' ? "#2E7D44" + '18' : decision === 'review' ? Colors.warning + '18' : "#C84038" + '18',
      }]}>
        {(() => {
          const dc = decision === 'go' ? "#2E7D44" : decision === 'review' ? Colors.warning : "#C84038";
          const DIcon = decision === 'go' ? CheckCircle2 : decision === 'review' ? AlertTriangle : XCircle;
          return <DIcon size={14} color={dc} strokeWidth={2} />;
        })()}
        <Text style={[styles.decisionPillText, {
          color: decision === 'go' ? "#2E7D44" : decision === 'review' ? Colors.warning : "#C84038",
        }]}>
          {decision === 'go' ? 'Recommend pursuing' : decision === 'review' ? 'Worth reviewing' : 'Recommend passing'}
        </Text>
      </View>

      {/* Why it matches */}
      {score.matchReasons && score.matchReasons.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <CheckCircle2 size={14} color={"#2E7D44"} strokeWidth={1.75} />
            <Text style={styles.sectionTitle}>Why it fits</Text>
          </View>
          {score.matchReasons.map((reason, i) => (
            <View key={`reason-${i}`} style={styles.bulletRow}>
              <View style={[styles.bulletDot, { backgroundColor: "#2E7D44" }]} />
              <Text style={styles.bulletText}>{reason}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Concerns */}
      {score.concerns && score.concerns.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <AlertTriangle size={14} color={Colors.warning} strokeWidth={1.75} />
            <Text style={styles.sectionTitle}>Concerns</Text>
          </View>
          {score.concerns.map((concern, i) => (
            <View key={`concern-${i}`} style={styles.bulletRow}>
              <View style={[styles.bulletDot, { backgroundColor: Colors.warning }]} />
              <Text style={styles.bulletText}>{concern}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Strategy */}
      {score.bidStrategy ? (
        <View style={[styles.section, { backgroundColor: "#FF6A1A" + '0C', borderRadius: Tokens.radius.card, padding: 12 }]}>
          <View style={styles.sectionHeader}>
            <TrendingUp size={14} color={"#FF6A1A"} strokeWidth={1.75} />
            <Text style={[styles.sectionTitle, { color: "#FF6A1A" }]}>Bid Strategy</Text>
          </View>
          <Text style={styles.strategyText}>{score.bidStrategy}</Text>
        </View>
      ) : null}

      <AIProfileSetup
        visible={showProfileSetup}
        onClose={() => setShowProfileSetup(false)}
        onSave={handleProfileSaved}
        initialProfile={profile}
      />
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.panel,
    padding: 16,
    borderWidth: 1,
    borderColor: t.line,
    gap: 12,
  },
  loadingContainer: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, paddingVertical: 24 },
  loadingText: { fontSize: Type.footnote.fontSize, color: t.textSecondary, fontWeight: '500' as const },
  heroRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  iconWrap: { width: 34, height: 34, borderRadius: Tokens.radius.md, backgroundColor: t.accent + '15', alignItems: 'center' as const, justifyContent: 'center' as const },
  title: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  subtitle: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 2 },
  refreshBtn: { width: 30, height: 30, borderRadius: Tokens.radius.sm, backgroundColor: t.surfaceAlt, alignItems: 'center' as const, justifyContent: 'center' as const },
  runBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6, paddingVertical: 12, borderRadius: Tokens.radius.card, backgroundColor: t.accent },
  runBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: '#FFF' },
  errorText: { fontSize: Type.footnote.fontSize, color: t.textSecondary, marginBottom: 6 },
  gaugeCard: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 14, backgroundColor: Colors.surfaceAlt, borderRadius: Tokens.radius.lg, padding: 14 },
  scoreBubble: { width: 72, height: 72, borderRadius: 36, alignItems: 'center' as const, justifyContent: 'center' as const, borderWidth: 2 },
  scoreNum: { fontSize: 24, fontWeight: '800' as const, letterSpacing: -0.5 },
  scoreOutOf: { fontSize: 9, fontWeight: '700' as const, marginTop: -2 },
  decisionLabel: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: Colors.fillSecondary, overflow: 'hidden' as const },
  barFill: { height: '100%' as const, borderRadius: 3 },
  winRow: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 5, flexWrap: 'wrap' as const },
  winText: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '500' as const, flex: 1 },
  winPct: { fontWeight: '700' as const, color: t.text },
  histRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, marginTop: 2 },
  histText: { fontSize: 9, color: t.textMuted, fontStyle: 'italic' as const },
  decisionPill: { alignSelf: 'flex-start' as const, paddingHorizontal: 12, paddingVertical: 6, borderRadius: Tokens.radius.sm },
  decisionPillText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const },
  section: { gap: 6 },
  sectionHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, marginBottom: 4 },
  sectionTitle: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: t.text, textTransform: 'uppercase' as const, letterSpacing: 0.4 },
  bulletRow: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 8, paddingLeft: 4, paddingVertical: 2 },
  bulletDot: { width: 5, height: 5, borderRadius: 2.5, marginTop: 7 },
  bulletText: { flex: 1, fontSize: Type.footnote.fontSize, color: t.text, lineHeight: 18 },
  strategyText: { fontSize: Type.footnote.fontSize, color: t.accent, lineHeight: 18, fontWeight: '500' as const },
});
