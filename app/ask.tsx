// app/ask.tsx — "Ask MAGE anything".
//
// A whole-business chat: the user types a plain question ("what's overdue?",
// "how much is unpaid?", "which job is over budget?") and MAGE answers by
// reasoning across projects, invoices, schedule, leads, change orders and
// RFIs. This is the surface that makes the app feel like an "AI operating
// system" — and it answers cross-domain (money + schedule + pipeline)
// questions a single-silo competitor's agent can't.
//
// All intelligence lives in utils/mageAgent.ts (context builder + askMage);
// this screen is just the chat shell.

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, Platform, KeyboardAvoidingView,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { ChevronLeft, ArrowUp, AlertTriangle } from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { Colors, type ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { askMage, ASK_MAGE_SUGGESTIONS, type MageAgentData } from '@/utils/mageAgent';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

interface Turn {
  role: 'user' | 'assistant';
  text: string;
  error?: boolean;
}

export default function AskMageScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { projects, invoices, leads, changeOrders, rfis } = useProjects();
  const data = useMemo<MageAgentData>(
    () => ({ projects, invoices, leads, changeOrders, rfis }),
    [projects, invoices, leads, changeOrders, rfis],
  );

  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const ask = useCallback(async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setDraft('');
    setTurns(prev => [...prev, { role: 'user', text: q }]);
    setBusy(true);
    // Let the user message paint before we scroll.
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    try {
      const res = await askMage(q, data);
      setTurns(prev => [...prev, { role: 'assistant', text: res.answer, error: !!res.errorKind }]);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    }
  }, [busy, data]);

  const empty = turns.length === 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityLabel="Back">
          <ChevronLeft size={26} color={themeColors.accent} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <View style={styles.headerIcon}><MageAIMark size={16} color={themeColors.accent} accentColor={themeColors.accent} /></View>
          <View>
            <Text style={styles.headerTitle}>Ask MAGE</Text>
            <Text style={styles.headerSub}>Answers across your whole business</Text>
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
                I can see your projects, invoices, schedules, leads, change orders and RFIs.
                Tap a question to start.
              </Text>
              <View style={styles.suggestions}>
                {ASK_MAGE_SUGGESTIONS.map(s => (
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
              <View
                key={i}
                style={[styles.bubbleRow, t.role === 'user' ? styles.bubbleRowUser : styles.bubbleRowAi]}
              >
                {t.role === 'assistant' && t.error && (
                  <AlertTriangle size={14} color={themeColors.danger} style={{ marginTop: 3, marginRight: 6 }} />
                )}
                <View style={[styles.bubble, t.role === 'user' ? styles.bubbleUser : styles.bubbleAi]}>
                  <Text style={t.role === 'user' ? styles.bubbleUserText : styles.bubbleAiText}>{t.text}</Text>
                </View>
              </View>
            ))
          )}
          {busy && (
            <View style={[styles.bubbleRow, styles.bubbleRowAi]}>
              <View style={[styles.bubble, styles.bubbleAi, styles.thinking]}>
                <ActivityIndicator size="small" color={themeColors.accent} />
                <Text style={styles.thinkingText}>Thinking…</Text>
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
