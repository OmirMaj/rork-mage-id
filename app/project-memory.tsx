// project-memory.tsx — "Ask this project's history".
//
// Sibling to Ask MAGE (app/ask.tsx): a per-project chat that answers from the
// project's own accumulated records (RFIs, daily reports, change-order
// rationales, submittals, punch items). The institutional memory that usually
// leaves with the PM. Retrieval is client-side TF-IDF (utils/projectMemory); the
// single AI call routes through the same mageAI relay, inheriting auth + caps.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, Platform, KeyboardAvoidingView,
} from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import * as Haptics from 'expo-haptics';
import { ChevronLeft, ArrowUp, AlertTriangle } from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { Colors, type ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import {
  extractMemoryDocs, answerFromMemorySemantic, syncMemoryEmbeddings, PROJECT_MEMORY_SUGGESTIONS,
} from '@/utils/projectMemory';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

interface Turn {
  role: 'user' | 'assistant';
  text: string;
  error?: boolean;
  refs?: string[];
  searched?: number;
  semantic?: boolean;
}

export default function ProjectMemoryScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('job_costing')) {
    return <Paywall visible={true} feature="Project Memory" requiredTier="pro" onClose={() => router.back()} />;
  }
  return <ProjectMemoryInner />;
}

function ProjectMemoryInner() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  const {
    getProject, getRFIsForProject, getDailyReportsForProject,
    getChangeOrdersForProject, getSubmittalsForProject, getPunchItemsForProject,
  } = useProjects();
  const { tier } = useSubscription();

  const project = useMemo(() => (projectId ? getProject(projectId) : null), [projectId, getProject]);

  const docs = useMemo(() => {
    if (!projectId) return [];
    return extractMemoryDocs({
      rfis: getRFIsForProject(projectId),
      dailyReports: getDailyReportsForProject(projectId),
      changeOrders: getChangeOrdersForProject(projectId),
      submittals: getSubmittalsForProject(projectId),
      punchItems: getPunchItemsForProject(projectId),
    });
  }, [projectId, getRFIsForProject, getDailyReportsForProject, getChangeOrdersForProject, getSubmittalsForProject, getPunchItemsForProject]);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // Best-effort: keep the semantic index fresh when the screen opens / records
  // change. No-op (silent) until the v2 embed function is deployed.
  useEffect(() => {
    if (projectId && docs.length > 0) void syncMemoryEmbeddings(projectId, docs);
  }, [projectId, docs]);

  const ask = useCallback(async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setDraft('');
    setTurns(prev => [...prev, { role: 'user', text: q }]);
    setBusy(true);
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    try {
      // Smart-tier call — meter it like every other call site (client-side
      // daily caps per CLAUDE.md; the relay only sees the feature id).
      const limit = await checkAILimit(tier, 'smart', 'projectMemory');
      if (!limit.allowed) {
        setTurns(prev => [...prev, {
          role: 'assistant',
          text: limit.message ?? "You've used today's advanced AI calls. Try again tomorrow.",
          error: true,
        }]);
        return;
      }
      const res = await answerFromMemorySemantic(q, projectId ?? '', docs, { feature: 'projectMemory' });
      // Count only successful, non-cached answers that actually hit the model
      // (searched === 0 short-circuits before any AI call).
      if (!res.errorKind && res.searched > 0 && res.answer.trim() && !res.fromCache) {
        void recordAIUsage('smart', 'projectMemory');
      }
      setTurns(prev => [...prev, {
        role: 'assistant', text: res.answer, error: !!res.errorKind,
        refs: res.matched ? res.usedRefs : undefined, searched: res.searched, semantic: res.semantic,
      }]);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    }
  }, [busy, docs, projectId, tier]);

  const empty = turns.length === 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityLabel="Back">
          <ChevronLeft size={26} color={themeColors.accent} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <View style={styles.headerIcon}><MageAIMark size={15} color={themeColors.accent} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle} numberOfLines={1}>Project Memory</Text>
            <Text style={styles.headerSub} numberOfLines={1}>{project?.name ?? 'Ask this project’s history'}</Text>
          </View>
        </View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top}
      >
        <ScrollView
          {...fabScroll}
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {empty ? (
            <View style={styles.emptyWrap}>
              <View style={styles.emptyIcon}><MageAIMark size={26} color={themeColors.accent} /></View>
              <Text style={styles.emptyTitle}>Ask this project anything</Text>
              <Text style={styles.emptyBody}>
                I&apos;ve read {docs.length} record{docs.length === 1 ? '' : 's'} from this job — RFIs, daily reports,
                change orders, submittals and punch items. Ask why something happened or how it was handled.
              </Text>
              <View style={styles.suggestions}>
                {PROJECT_MEMORY_SUGGESTIONS.map(s => (
                  <TouchableOpacity key={s} style={styles.suggestion} onPress={() => ask(s)} activeOpacity={0.85} testID="memory-suggestion">
                    <Text style={styles.suggestionText}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ) : (
            turns.map((turn, i) => (
              <View key={i}>
                <View style={[styles.bubbleRow, turn.role === 'user' ? styles.bubbleRowUser : styles.bubbleRowAi]}>
                  {turn.role === 'assistant' && turn.error && (
                    <AlertTriangle size={14} color={themeColors.danger} style={{ marginTop: 3, marginRight: 6 }} strokeWidth={1.75} />
                  )}
                  <View style={[styles.bubble, turn.role === 'user' ? styles.bubbleUser : styles.bubbleAi]}>
                    <Text style={turn.role === 'user' ? styles.bubbleUserText : styles.bubbleAiText}>{turn.text}</Text>
                  </View>
                </View>
                {turn.role === 'assistant' && !turn.error && (turn.searched ?? 0) > 0 && (
                  <Text style={styles.cite}>
                    {turn.semantic ? 'Semantic search · ' : 'Searched '}{turn.searched} record{turn.searched === 1 ? '' : 's'}
                    {turn.refs && turn.refs.length > 0 ? ` · ${turn.refs.slice(0, 4).join(', ')}` : ''}
                  </Text>
                )}
              </View>
            ))
          )}
          {busy && (
            <View style={[styles.bubbleRow, styles.bubbleRowAi]}>
              <View style={[styles.bubble, styles.bubbleAi, styles.thinking]}>
                <ActivityIndicator size="small" color={themeColors.accent} />
                <Text style={styles.thinkingText}>Searching the record…</Text>
              </View>
            </View>
          )}
        </ScrollView>

        <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Ask why, how, or what happened…"
            placeholderTextColor={themeColors.textMuted}
            multiline
            onSubmitEditing={() => ask(draft)}
            blurOnSubmit
            testID="memory-input"
          />
          <TouchableOpacity
            style={[styles.send, (busy || !draft.trim()) && styles.sendDim]}
            onPress={() => ask(draft)}
            disabled={busy || !draft.trim()}
            accessibilityLabel="Send"
            testID="memory-send"
          >
            {busy ? <ActivityIndicator size="small" color={Colors.textOnAccent} /> : <ArrowUp size={18} color={Colors.textOnAccent} strokeWidth={2.6} />}
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
  headerTitle: { ...Type.serifHeadline, color: t.text },
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

  bubbleRow: { flexDirection: 'row', marginBottom: 4, maxWidth: '100%' },
  bubbleRowUser: { justifyContent: 'flex-end' },
  bubbleRowAi: { justifyContent: 'flex-start' },
  bubble: { borderRadius: Tokens.radius.lg, paddingHorizontal: 14, paddingVertical: 11, maxWidth: '88%' },
  bubbleUser: { backgroundColor: t.accentFill, borderBottomRightRadius: Tokens.radius.xs },
  bubbleAi: { backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, borderBottomLeftRadius: Tokens.radius.xs },
  bubbleUserText: { color: Colors.textOnAccent, fontSize: Type.subhead.fontSize, lineHeight: 21 },
  bubbleAiText: { color: t.text, fontSize: Type.subhead.fontSize, lineHeight: 21 },
  cite: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginBottom: 12, marginLeft: 4 },

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
