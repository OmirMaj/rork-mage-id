// app/ask.tsx — "Ask MAGE anything", powered by One Mind.
//
// One question in, one fused answer out. The engine (utils/oneMind/*) routes
// the question (project-scoped vs business-wide — deterministic, no AI),
// assembles fact blocks from EVERY engine the app runs — business records,
// live margin, margin risk, schedule health, pace book, RFI latency, brain
// watch, cash flow, the four portfolio engines, the brain's own accuracy
// report and open leak flags — and answers with citations. Each cited block
// renders as a tappable chip that drills into the real screen behind it.
//
// This screen is just the chat shell: bundle assembly, metering (askMage —
// the established AIFeature pattern), and the citation-chip UI.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, Platform, KeyboardAvoidingView, Animated, Easing, Keyboard,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ChevronRight, ArrowUp, AlertTriangle, Search, X, Clock, DollarSign, CalendarClock,
  Mic, Gauge, Users, Wallet, TrendingUp, Sparkles, type LucideIcon,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import VoiceCaptureModal from '@/components/VoiceCaptureModal';
import { Colors, type ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useSearch } from '@/contexts/SearchContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useSafety } from '@/contexts/SafetyContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useBidResponsesPortfolio } from '@/hooks/useBidResponsesPortfolio';
import { useMaterialReceipts } from '@/hooks/useMaterialReceipts';
import { useLaborCostSamples } from '@/hooks/useLaborRates';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';
import { localDateISO } from '@/utils/brief/composeBrief';
import { askOneMind, type OneMindCitation } from '@/utils/oneMind/answer';
import { type OneMindBundle, isColdStart } from '@/utils/oneMind/factBlocks';
import { resolveStarters, ONBOARDING_STARTERS, type Starter, type StarterIcon } from '@/utils/resolveStarters';
import { followupsForRefs } from '@/utils/oneMind/followupMapping';
import { DEMO_ANSWERS } from '@/utils/oneMind/demoColdStart';
import { loadAskThreads, saveAskThread, type AskThread } from '@/utils/askHistory';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

interface Turn {
  role: 'user' | 'assistant';
  text: string;
  error?: boolean;
  citations?: OneMindCitation[];
}

// Starter icon KEY -> Lucide component. Keys come from utils/resolveStarters so
// that pure data module carries no component dependency.
const STARTER_ICON: Record<StarterIcon, LucideIcon> = {
  clock: Clock, dollar: DollarSign, alert: AlertTriangle, calendar: CalendarClock,
  gauge: Gauge, users: Users, wallet: Wallet, trending: TrendingUp, sparkle: Sparkles,
};

export default function AskMageScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { openSearch } = useSearch();
  const { seed, screen } = useLocalSearchParams<{ seed?: string; screen?: string }>();

  // Gentle breathing on the empty-state mark — the same "alive assistant"
  // language as the Brain FAB. Native driver, subtle.
  const breathe = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(breathe, { toValue: 1.05, duration: 1700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(breathe, { toValue: 1, duration: 1700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [breathe]);

  // Search is a pageSheet modal and so is this screen. Dismiss ask first, then
  // present search — the same close-then-open timing the Brain FAB used for its
  // voice/help sheets, so search animates in cleanly instead of stacking.
  const openSearchFromAsk = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    router.back();
    setTimeout(() => openSearch(), 350);
  }, [router, openSearch]);

  const {
    projects, invoices, leads, changeOrders, rfis,
    commitments, dailyReports, permits, submittals, punchItems,
    projectsLoaded,
  } = useProjects();
  const safety = useSafety();
  const { tier } = useSubscription();
  const { bidResponses } = useBidResponsesPortfolio();
  const { receipts } = useMaterialReceipts();
  const laborSamples = useLaborCostSamples();

  const bundle = useMemo<OneMindBundle>(() => {
    // Local calendar day, not toISOString() (UTC flips the date for evening
    // hours west of Greenwich) — same discipline as the Morning Brief.
    const todayISO = localDateISO(new Date());
    return {
      projects, commitments, changeOrders, invoices,
      rfis, leads, dailyReports, permits, submittals, punchItems,
      expiringCertifications: safety.expiringCertifications(todayISO) as OneMindBundle['expiringCertifications'],
      bidResponses,
      receipts,
      laborSamples,
    };
  }, [
    projects, commitments, changeOrders, invoices, rfis, leads, dailyReports,
    permits, submittals, punchItems, safety, bidResponses, receipts, laborSamples,
  ]);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [recentThreads, setRecentThreads] = useState<AskThread[]>([]);
  const scrollRef = useRef<ScrollView>(null);
  // Stable id for THIS conversation, so history save upserts one thread/session.
  const sessionId = useRef(String(Date.now())).current;

  // Prior turns for multi-turn continuity, without re-creating `ask` per turn.
  const turnsRef = useRef<Turn[]>([]);
  turnsRef.current = turns;

  const ask = useCallback(async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    // Cold-start onboarding: answer the canned demo prompts instantly and
    // entirely client-side — no model call, no metering, no network.
    const demo = isColdStart(bundle) ? DEMO_ANSWERS[q] : undefined;
    if (demo) {
      setDraft('');
      setTurns(prev => [
        ...prev,
        { role: 'user', text: q },
        { role: 'assistant', text: demo.answer, citations: demo.citations },
      ]);
      return;
    }
    const prior = turnsRef.current.map(t => ({ role: t.role, text: t.text }));
    setDraft('');
    setTurns(prev => [...prev, { role: 'user', text: q }]);
    setBusy(true);
    // Let the user message paint before we scroll.
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    try {
      // Smart-tier call — meter it like every other call site (client-side
      // daily caps per CLAUDE.md; the relay only sees the feature id).
      const limit = await checkAILimit(tier, 'smart', 'askMage');
      if (!limit.allowed) {
        const canUpgrade = tier === 'free' || tier === 'pro';
        setTurns(prev => [...prev, {
          role: 'assistant',
          text: limit.message ?? (canUpgrade
            ? "You've hit today's advanced AI limit. Upgrade to keep asking MAGE — opening your plan options now."
            : "You've used today's advanced AI calls. Try again tomorrow."),
          error: true,
        }]);
        // Convert at the moment of intent instead of dead-ending: send
        // upgradeable tiers to the paywall so they can lift the cap right now.
        if (canUpgrade) router.push('/paywall');
        return;
      }
      const res = await askOneMind(q, prior, bundle);
      // Count only answers that actually hit the model — cold-start and
      // verbatim-fallback answers report usedAI: false and cost nothing.
      if (res.usedAI) {
        void recordAIUsage('smart', 'askMage');
      }
      setTurns(prev => [...prev, {
        role: 'assistant',
        text: res.answer,
        error: !!res.errorKind,
        citations: res.citations,
      }]);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    }
  }, [busy, bundle, tier, router]);

  // Load saved threads for the Recent strip on mount.
  useEffect(() => { void loadAskThreads().then(setRecentThreads); }, []);

  // Persist a completed Q&A thread (upsert by session id) so it can be recalled
  // for free from the Recent strip. Only save once an assistant turn has landed.
  useEffect(() => {
    const last = turns[turns.length - 1];
    if (last && last.role === 'assistant') {
      void saveAskThread(sessionId, turns, Date.now()).then(setRecentThreads);
    }
  }, [turns, sessionId]);

  // Copilot-hub handoff: arrive with ?seed=<question> and auto-ask it once —
  // but only after the project data has hydrated. Firing against a
  // pre-hydration (empty) bundle hit One Mind's cold-start short-circuit and
  // told users with plenty of data "you have no data", with no retry. The
  // projectsLoaded gate re-runs this effect when hydration lands, so the
  // seed still fires exactly once.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || !projectsLoaded) return;
    if (typeof seed === 'string' && seed.trim() && turnsRef.current.length === 0) {
      seededRef.current = true;
      void ask(seed);
    }
  }, [seed, ask, projectsLoaded]);

  const openCitation = useCallback((c: OneMindCitation) => {
    if (!c.drillIn) return;
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    // drillIn.pathname is typed against the router (FactBlockDrillIn.pathname:
    // Route), so a dead route fails tsc at the block that declares it. The
    // Href cast here only bridges the pathname UNION into push's overloads —
    // it cannot smuggle an unknown route past the compiler the way the old
    // `as never` did.
    router.push({ pathname: c.drillIn.pathname, params: c.drillIn.params } as Href);
  }, [router]);

  const empty = turns.length === 0;
  const cold = isColdStart(bundle);
  // Starters adapt to context: onboarding demos when there's no data yet,
  // otherwise the set tuned to the screen the user opened Ask from.
  const starters = useMemo<Starter[]>(
    () => (cold ? ONBOARDING_STARTERS : resolveStarters(screen)),
    [cold, screen],
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header — brand left, search + close right */}
      <View style={styles.header}>
        <View style={styles.brand}>
          <View style={styles.brandMark}>
            <LinearGradient colors={[themeColors.accentHot, themeColors.accentFill]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={StyleSheet.absoluteFill} />
            <MageAIMark size={15} color={Colors.textOnAccent} accentColor={Colors.textOnAccent} />
          </View>
          <Text style={styles.brandName}>MAGE</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.iconBtn} onPress={openSearchFromAsk} hitSlop={6} accessibilityLabel="Search" testID="ask-search">
            <Search size={18} color={themeColors.textMuted} strokeWidth={2} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={() => router.back()} hitSlop={6} accessibilityLabel="Close" testID="ask-close">
            <X size={18} color={themeColors.textMuted} strokeWidth={2.2} />
          </TouchableOpacity>
        </View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top}
      >
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {empty ? (
            <View style={styles.emptyWrap}>
              <Animated.View style={[styles.halo, { transform: [{ scale: breathe }] }]}>
                <LinearGradient colors={[themeColors.accentHot, themeColors.accentFill]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={StyleSheet.absoluteFill} />
                <MageAIMark size={28} color={Colors.textOnAccent} accentColor={Colors.textOnAccent} />
              </Animated.View>
              <Text style={styles.emptyTitle}>What can I help with?</Text>
              <Text style={styles.emptyBody}>
                Ask about your money, schedules, leads — anything across your jobs.
                Every answer cites where it came from.
              </Text>
              <View style={styles.suggestions}>
                {starters.map(({ q, icon }) => {
                  const Icon = STARTER_ICON[icon];
                  return (
                    <TouchableOpacity
                      key={q}
                      style={styles.suggestion}
                      onPress={() => ask(q)}
                      activeOpacity={0.85}
                      testID="ask-suggestion"
                    >
                      <Icon size={17} color={themeColors.accent} strokeWidth={2} />
                      <Text style={styles.suggestionText}>{q}</Text>
                      <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={2} />
                    </TouchableOpacity>
                  );
                })}
              </View>
              {recentThreads.length > 0 && (
                <View style={styles.recentWrap}>
                  <Text style={styles.recentLabel}>RECENT</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recentRow}>
                    {recentThreads.map(thread => {
                      const firstQ = thread.turns.find(x => x.role === 'user')?.text ?? 'Conversation';
                      return (
                        <TouchableOpacity
                          key={thread.id}
                          style={styles.recentCard}
                          onPress={() => setTurns(thread.turns as Turn[])}
                          activeOpacity={0.85}
                          testID="ask-recent"
                        >
                          <Clock size={13} color={themeColors.textMuted} strokeWidth={2} />
                          <Text style={styles.recentText} numberOfLines={2}>{firstQ}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              )}
            </View>
          ) : (
            turns.map((t, i) => (
              <View key={i}>
                <View
                  style={[styles.bubbleRow, t.role === 'user' ? styles.bubbleRowUser : styles.bubbleRowAi]}
                >
                  {t.role === 'assistant' && t.error && (
                    <AlertTriangle size={14} color={themeColors.danger} style={{ marginTop: 3, marginRight: 6 }} strokeWidth={1.75} />
                  )}
                  <View style={[styles.bubble, t.role === 'user' ? styles.bubbleUser : styles.bubbleAi]}>
                    <Text style={t.role === 'user' ? styles.bubbleUserText : styles.bubbleAiText}>{t.text}</Text>
                  </View>
                </View>
                {t.role === 'assistant' && !!t.citations?.length && (
                  <View style={styles.citationRow}>
                    {t.citations.map(c => (
                      <TouchableOpacity
                        key={c.ref}
                        style={styles.citationChip}
                        onPress={() => openCitation(c)}
                        disabled={!c.drillIn}
                        activeOpacity={0.8}
                        testID={`ask-citation-${c.ref}`}
                      >
                        <Text style={styles.citationText}>{c.domain}</Text>
                        {c.drillIn && <ChevronRight size={12} color={themeColors.accent} strokeWidth={2.2} />}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
                {t.role === 'assistant' && i === turns.length - 1 && !busy &&
                  followupsForRefs((t.citations ?? []).map(c => c.ref)).length > 0 && (
                  <View style={styles.followupRow}>
                    {followupsForRefs((t.citations ?? []).map(c => c.ref)).map(f => (
                      <TouchableOpacity
                        key={f}
                        style={styles.followupChip}
                        onPress={() => ask(f)}
                        activeOpacity={0.85}
                        testID="ask-followup"
                      >
                        <Text style={styles.followupText}>{f}</Text>
                        <ChevronRight size={13} color={themeColors.textSecondary} strokeWidth={2} />
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            ))
          )}
          {busy && (
            <View style={[styles.bubbleRow, styles.bubbleRowAi]}>
              <View style={[styles.bubble, styles.bubbleAi, styles.thinking]}>
                <ActivityIndicator size="small" color={themeColors.accent} />
                <Text style={styles.thinkingText}>Reading your data…</Text>
              </View>
            </View>
          )}
        </ScrollView>

        {/* Input bar */}
        <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <TouchableOpacity
            style={styles.micBtn}
            onPress={() => { Keyboard.dismiss(); setVoiceOpen(true); }}
            accessibilityLabel="Ask by voice"
            testID="ask-mic"
          >
            <Mic size={20} color={themeColors.textMuted} strokeWidth={2} />
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Ask anything…"
            placeholderTextColor={themeColors.textMuted}
            multiline
            onSubmitEditing={() => ask(draft)}
            blurOnSubmit
            testID="ask-input"
          />
          <TouchableOpacity
            style={[styles.send, (busy || !draft.trim()) && styles.sendDim]}
            onPress={() => ask(draft)}
            disabled={busy || !draft.trim()}
            accessibilityLabel="Send"
            testID="ask-send"
          >
            <LinearGradient colors={[themeColors.accentHot, themeColors.accentFill]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={StyleSheet.absoluteFill} />
            {busy ? <ActivityIndicator size="small" color={Colors.textOnAccent} /> : <ArrowUp size={18} color={Colors.textOnAccent} strokeWidth={2.6} />}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <VoiceCaptureModal
        visible={voiceOpen}
        onClose={() => setVoiceOpen(false)}
        onTranscriptReady={(t) => { setVoiceOpen(false); void ask(t); }}
        title="Ask by voice"
        contextLine="Speak your question — I'll answer from your jobs."
        suggestions={starters.map(s => s.q)}
      />
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: t.line,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  brandMark: {
    width: 28, height: 28, borderRadius: Tokens.radius.md, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: t.accent, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 4,
  },
  brandName: { fontSize: Type.headline.fontSize, fontWeight: '800', color: t.text, letterSpacing: 0.3 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: {
    width: 34, height: 34, borderRadius: Tokens.radius.md,
    backgroundColor: t.surface, borderWidth: 1, borderColor: t.line,
    alignItems: 'center', justifyContent: 'center',
  },

  emptyWrap: { alignItems: 'flex-start', paddingTop: 28, paddingHorizontal: 8 },
  halo: {
    width: 58, height: 58, borderRadius: Tokens.radius.lg, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
    shadowColor: t.accent, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.45, shadowRadius: 16, elevation: 8,
  },
  emptyTitle: { ...Type.serifTitle, color: t.text },
  emptyBody: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 19, marginTop: 8, maxWidth: 320 },
  suggestions: { gap: 9, marginTop: 22, alignSelf: 'stretch' },
  suggestion: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    backgroundColor: t.surface, borderRadius: Tokens.radius.lg, paddingHorizontal: 14, paddingVertical: 14,
    borderWidth: 1, borderColor: t.line,
  },
  suggestionText: { flex: 1, fontSize: Type.subhead.fontSize, fontWeight: '600', color: t.text },

  bubbleRow: { flexDirection: 'row', marginBottom: 12, maxWidth: '100%' },
  bubbleRowUser: { justifyContent: 'flex-end' },
  bubbleRowAi: { justifyContent: 'flex-start' },
  bubble: { borderRadius: Tokens.radius.lg, paddingHorizontal: 14, paddingVertical: 11, maxWidth: '88%' },
  bubbleUser: { backgroundColor: t.accentFill, borderBottomRightRadius: Tokens.radius.xs },
  bubbleAi: { backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, borderBottomLeftRadius: Tokens.radius.xs },
  bubbleUserText: { color: Colors.textOnAccent, fontSize: Type.subhead.fontSize, lineHeight: 21 },
  bubbleAiText: { color: t.text, fontSize: Type.subhead.fontSize, lineHeight: 21 },

  citationRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6,
    marginTop: -6, marginBottom: 12, maxWidth: '88%',
  },
  citationChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: t.accent + '10', borderWidth: 1, borderColor: t.accent + '2E',
    borderRadius: Tokens.radius.full, paddingHorizontal: 10, paddingVertical: 5,
  },
  citationText: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.accent },

  thinking: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  thinkingText: { color: t.textMuted, fontSize: Type.footnote.fontSize, fontStyle: 'italic' },

  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    paddingHorizontal: 12, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: t.line, backgroundColor: t.bg,
  },
  input: {
    flex: 1, maxHeight: 120, minHeight: 44,
    backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, borderRadius: Tokens.radius.xl,
    paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12,
    fontSize: Type.bodyCompact.fontSize, color: t.text,
  },
  send: {
    width: 44, height: 44, borderRadius: Tokens.radius.full, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: t.accent, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 6,
  },
  sendDim: { opacity: 0.45 },
  micBtn: {
    width: 44, height: 44, borderRadius: Tokens.radius.full,
    alignItems: 'center', justifyContent: 'center',
  },

  // Recent-threads strip in the empty state — recall a past answer for free.
  recentWrap: { marginTop: 22, alignSelf: 'stretch' },
  recentLabel: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.textMuted, letterSpacing: 1, marginBottom: 10 },
  recentRow: { gap: 9, paddingRight: 8 },
  recentCard: {
    width: 152, flexDirection: 'row', alignItems: 'flex-start', gap: 7,
    backgroundColor: t.surface, borderWidth: 1, borderColor: t.line,
    borderRadius: Tokens.radius.lg, paddingHorizontal: 12, paddingVertical: 11,
  },
  recentText: { flex: 1, fontSize: Type.caption2.fontSize, color: t.textSecondary, lineHeight: 16 },

  // Follow-up chips under the latest answer — surface-colored to stay distinct
  // from the accent-tinted citation chips.
  followupRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: -2, marginBottom: 14 },
  followupChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: t.surface, borderWidth: 1, borderColor: t.line,
    borderRadius: Tokens.radius.full, paddingHorizontal: 11, paddingVertical: 7,
  },
  followupText: { fontSize: Type.caption2.fontSize, fontWeight: '600', color: t.textSecondary },
});
