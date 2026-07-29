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
  ActivityIndicator, Platform, KeyboardAvoidingView,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { ChevronLeft, ChevronRight, ArrowUp, AlertTriangle } from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { Colors, type ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useSafety } from '@/contexts/SafetyContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useBidResponsesPortfolio } from '@/hooks/useBidResponsesPortfolio';
import { useMaterialReceipts } from '@/hooks/useMaterialReceipts';
import { useLaborCostSamples } from '@/hooks/useLaborRates';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';
import { localDateISO } from '@/utils/brief/composeBrief';
import { ASK_MAGE_SUGGESTIONS } from '@/utils/mageAgent';
import { askOneMind, type OneMindCitation } from '@/utils/oneMind/answer';
import type { OneMindBundle } from '@/utils/oneMind/factBlocks';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

interface Turn {
  role: 'user' | 'assistant';
  text: string;
  error?: boolean;
  citations?: OneMindCitation[];
}

// Engine-aware prompts the old business-snapshot agent couldn't answer.
const ONE_MIND_SUGGESTIONS: string[] = [
  'Which job is bleeding margin right now?',
  'Can I afford to take on another job next month?',
];

export default function AskMageScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { seed } = useLocalSearchParams<{ seed?: string }>();

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
  const scrollRef = useRef<ScrollView>(null);

  // Prior turns for multi-turn continuity, without re-creating `ask` per turn.
  const turnsRef = useRef<Turn[]>([]);
  turnsRef.current = turns;

  const ask = useCallback(async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
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
  }, [busy, bundle, tier]);

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
  const suggestions = useMemo(() => [...ASK_MAGE_SUGGESTIONS, ...ONE_MIND_SUGGESTIONS], []);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityLabel="Back">
          <ChevronLeft size={26} color={themeColors.accent} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <View style={styles.headerIcon}><MageAIMark size={16} color={themeColors.accent} accentColor={themeColors.accent} /></View>
          <View>
            <Text style={styles.headerTitle}>Ask MAGE</Text>
            <Text style={styles.headerSub}>One answer from everything you’ve logged</Text>
          </View>
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
              <View style={styles.emptyIcon}><MageAIMark size={28} color={themeColors.accent} accentColor={themeColors.accent} /></View>
              <Text style={styles.emptyTitle}>Ask me anything about your business</Text>
              <Text style={styles.emptyBody}>
                I fuse your records with the margin, risk, schedule, pace, cash and
                portfolio engines — and cite where each answer came from so you can
                tap straight into the screen behind it.
              </Text>
              <View style={styles.suggestions}>
                {suggestions.map(s => (
                  <TouchableOpacity
                    key={s}
                    style={styles.suggestion}
                    onPress={() => ask(s)}
                    activeOpacity={0.85}
                    testID={`ask-suggestion`}
                  >
                    <Text style={styles.suggestionText}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </View>
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
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Ask about money, schedule, leads…"
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
            {busy ? <ActivityIndicator size="small" color="#FFF" /> : <ArrowUp size={18} color="#FFF" strokeWidth={2.6} />}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: t.line,
  },
  headerTitleWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerIcon: {
    width: 30, height: 30, borderRadius: Tokens.radius.md,
    backgroundColor: t.accent + '14', alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: Type.headline.fontSize, fontWeight: '800', color: t.text },
  headerSub: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: 1 },

  emptyWrap: { alignItems: 'center', paddingTop: 32, paddingHorizontal: 8 },
  emptyIcon: {
    width: 56, height: 56, borderRadius: Tokens.radius.lg,
    backgroundColor: t.accent + '14', alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  emptyTitle: { fontSize: Type.title3.fontSize, fontWeight: '800', color: t.text, textAlign: 'center', letterSpacing: -0.3 },
  emptyBody: { fontSize: Type.footnote.fontSize, color: t.textSecondary, textAlign: 'center', lineHeight: 19, marginTop: 8, maxWidth: 340 },
  suggestions: { gap: 8, marginTop: 22, alignSelf: 'stretch' },
  suggestion: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.lg, paddingHorizontal: 14, paddingVertical: 13,
    borderWidth: 1, borderColor: t.line,
  },
  suggestionText: { fontSize: Type.subhead.fontSize, fontWeight: '600', color: t.text },

  bubbleRow: { flexDirection: 'row', marginBottom: 12, maxWidth: '100%' },
  bubbleRowUser: { justifyContent: 'flex-end' },
  bubbleRowAi: { justifyContent: 'flex-start' },
  bubble: { borderRadius: Tokens.radius.lg, paddingHorizontal: 14, paddingVertical: 11, maxWidth: '88%' },
  bubbleUser: { backgroundColor: t.accent, borderBottomRightRadius: Tokens.radius.xs },
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
    width: 44, height: 44, borderRadius: Tokens.radius.full,
    backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center',
  },
  sendDim: { opacity: 0.45 },
});
