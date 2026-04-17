import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  Sparkles, Zap, TrendingUp, AlertTriangle, CheckCircle2, Settings, RefreshCw, Target,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import {
  scoreBid, getCompanyProfile, getCachedResult, setCachedResult,
  type CompanyAIProfile, type BidScoreResult,
} from '@/utils/aiService';
import { AIProfileSetup } from '@/components/AIBidScorer';

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
  if (score >= 80) return Colors.success;
  if (score >= 60) return Colors.primary;
  if (score >= 40) return Colors.warning;
  return Colors.error;
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
  const [profile, setProfile] = useState<CompanyAIProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [showProfileSetup, setShowProfileSetup] = useState(false);
  const [score, setScore] = useState<BidScoreResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cacheKey = useMemo(() => `bidscore_${bid.id}`, [bid.id]);

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
      const result = await scoreBid(bid, profile);
      await setCachedResult(cacheKey, result);
      setScore(result);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      setError(err?.message || 'Failed to score bid');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  }, [bid, profile, profileReady, cacheKey]);

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
            <Sparkles size={18} color={Colors.primary} />
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
              <Zap size={15} color="#FFF" />
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
        <ActivityIndicator size="small" color={Colors.primary} />
        <Text style={styles.loadingText}>Scoring bid against your profile…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, { borderColor: Colors.error + '40' }]} testID={testID}>
        <View style={styles.heroRow}>
          <AlertTriangle size={18} color={Colors.error} />
          <Text style={[styles.title, { color: Colors.error }]}>Scoring Failed</Text>
        </View>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.runBtn} onPress={() => void runScore(true)} activeOpacity={0.85}>
          <RefreshCw size={14} color="#FFF" />
          <Text style={styles.runBtnText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!score) return null;

  const color = scoreColor(score.matchScore);
  const decision = goNoGo(score.matchScore);
  const winPct = Math.round((score.estimatedWinProbability ?? 0));

  return (
    <View style={styles.container} testID={testID}>
      <View style={styles.heroRow}>
        <View style={styles.iconWrap}>
          <Sparkles size={18} color={Colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>AI Go/No-Go Analysis</Text>
          <Text style={styles.subtitle}>Cached · tap refresh to re-score</Text>
        </View>
        <TouchableOpacity onPress={() => void runScore(true)} activeOpacity={0.7} style={styles.refreshBtn} testID="ai-rescore-btn">
          <RefreshCw size={14} color={Colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setShowProfileSetup(true)} activeOpacity={0.7} style={styles.refreshBtn} testID="ai-edit-profile-btn">
          <Settings size={14} color={Colors.textMuted} />
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
            <Target size={12} color={Colors.textMuted} />
            <Text style={styles.winText}>
              <Text style={styles.winPct}>{winPct}%</Text> est. win probability
            </Text>
          </View>
        </View>
      </View>

      {/* Recommendation pill */}
      <View style={[styles.decisionPill, {
        backgroundColor: decision === 'go' ? Colors.success + '18' : decision === 'review' ? Colors.warning + '18' : Colors.error + '18',
      }]}>
        <Text style={[styles.decisionPillText, {
          color: decision === 'go' ? Colors.success : decision === 'review' ? Colors.warning : Colors.error,
        }]}>
          {decision === 'go' ? '✓ Recommend pursuing' : decision === 'review' ? '⚠ Worth reviewing' : '✕ Recommend passing'}
        </Text>
      </View>

      {/* Why it matches */}
      {score.matchReasons && score.matchReasons.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <CheckCircle2 size={14} color={Colors.success} />
            <Text style={styles.sectionTitle}>Why it fits</Text>
          </View>
          {score.matchReasons.map((reason, i) => (
            <View key={`reason-${i}`} style={styles.bulletRow}>
              <View style={[styles.bulletDot, { backgroundColor: Colors.success }]} />
              <Text style={styles.bulletText}>{reason}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Concerns */}
      {score.concerns && score.concerns.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <AlertTriangle size={14} color={Colors.warning} />
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
        <View style={[styles.section, { backgroundColor: Colors.primary + '0C', borderRadius: 12, padding: 12 }]}>
          <View style={styles.sectionHeader}>
            <TrendingUp size={14} color={Colors.primary} />
            <Text style={[styles.sectionTitle, { color: Colors.primary }]}>Bid Strategy</Text>
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

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    gap: 12,
  },
  loadingContainer: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, paddingVertical: 24 },
  loadingText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' as const },
  heroRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  iconWrap: { width: 34, height: 34, borderRadius: 10, backgroundColor: Colors.primary + '15', alignItems: 'center' as const, justifyContent: 'center' as const },
  title: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  subtitle: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  refreshBtn: { width: 30, height: 30, borderRadius: 8, backgroundColor: Colors.fillTertiary, alignItems: 'center' as const, justifyContent: 'center' as const },
  runBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6, paddingVertical: 12, borderRadius: 12, backgroundColor: Colors.primary },
  runBtnText: { fontSize: 14, fontWeight: '700' as const, color: '#FFF' },
  errorText: { fontSize: 13, color: Colors.textSecondary, marginBottom: 6 },
  gaugeCard: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 14, backgroundColor: Colors.surfaceAlt, borderRadius: 14, padding: 14 },
  scoreBubble: { width: 72, height: 72, borderRadius: 36, alignItems: 'center' as const, justifyContent: 'center' as const, borderWidth: 2 },
  scoreNum: { fontSize: 24, fontWeight: '800' as const, letterSpacing: -0.5 },
  scoreOutOf: { fontSize: 9, fontWeight: '700' as const, marginTop: -2 },
  decisionLabel: { fontSize: 15, fontWeight: '700' as const },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: Colors.fillSecondary, overflow: 'hidden' as const },
  barFill: { height: '100%' as const, borderRadius: 3 },
  winRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5 },
  winText: { fontSize: 11, color: Colors.textMuted, fontWeight: '500' as const },
  winPct: { fontWeight: '700' as const, color: Colors.text },
  decisionPill: { alignSelf: 'flex-start' as const, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  decisionPillText: { fontSize: 12, fontWeight: '700' as const },
  section: { gap: 6 },
  sectionHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, marginBottom: 4 },
  sectionTitle: { fontSize: 12, fontWeight: '700' as const, color: Colors.text, textTransform: 'uppercase' as const, letterSpacing: 0.4 },
  bulletRow: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 8, paddingLeft: 4, paddingVertical: 2 },
  bulletDot: { width: 5, height: 5, borderRadius: 2.5, marginTop: 7 },
  bulletText: { flex: 1, fontSize: 13, color: Colors.text, lineHeight: 18 },
  strategyText: { fontSize: 13, color: Colors.primary, lineHeight: 18, fontWeight: '500' as const },
});
