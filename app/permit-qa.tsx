// permit-qa.tsx — Permit Q&A agent.
//
// Lightweight chat-style screen where the GC asks DOB / building-permit
// questions ("How long does an Alt-2 take in Brooklyn?", "What triggers
// a special inspection in NYC?", "What's the typical fee for a kitchen
// reno permit in Phoenix?") and gets a fast answer.
//
// Today: uses the existing mageAI relay with a permit-specific system
// prompt. Provides a useful baseline answer for any metro using
// Gemini's general knowledge.
//
// v1.1: a research corpus from the spawned background agent gets
// merged into the system prompt — at that point the answers become
// citation-grade. The UI doesn't change; the corpus injection is a
// system-prompt swap.

import React, { useCallback, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  Send, ChevronDown, MapPin, AlertCircle,
  User as UserIcon, BookOpen, Check,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { mageAI } from '@/utils/mageAI';
import { getMetroContext, CROSS_JURISDICTION_PRINCIPLES, type MetroKey } from '@/utils/permitCorpus';
import { findRelevantSections, renderSectionsForPrompt } from '@/utils/codeLibrary';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

const METROS: { key: MetroKey; label: string }[] = [
  { key: 'NYC', label: 'New York City' },
  { key: 'Long Island', label: 'Nassau / Suffolk (LI)' },
  { key: 'LA', label: 'Los Angeles County' },
  { key: 'Chicago', label: 'Chicago / Cook County' },
  { key: 'Houston', label: 'Houston / Harris County' },
  { key: 'Phoenix', label: 'Phoenix / Maricopa County' },
  { key: 'Miami', label: 'Miami-Dade' },
  { key: 'Seattle', label: 'Seattle / King County' },
  { key: 'SF', label: 'San Francisco' },
];

const STARTER_QUESTIONS = [
  'How long does a typical residential renovation permit take?',
  'What are the most common reasons plan examiners reject filings?',
  'When do I need a special inspection?',
  'What\'s the typical fee structure for a $250K reno?',
  'What inspections are required during construction?',
];

function buildSystemPrompt(metro: MetroKey, query: string): string {
  // Pull research-backed metadata corpus for the selected metro
  // (filing types, timelines, top rejections, fees, quirks).
  const metroCorpus = getMetroContext(metro);

  // Topic-detect the query and pull citation-grade code text from
  // the public-code library. Limited to top 6 most-relevant sections
  // to keep token budget manageable. When the library has no match,
  // the agent falls back to the metadata + Gemini's general knowledge.
  const relevantSections = findRelevantSections({
    jurisdiction: metro,
    query,
    maxSections: 6,
  });
  const sectionsBlock = renderSectionsForPrompt(relevantSections);

  return [
    'You are a permit and building-code expert assistant for small construction GCs.',
    `The user is operating in ${metro}. Use the metro-specific data below as your primary source.`,
    '',
    '─── METRO-SPECIFIC CORPUS ───',
    metroCorpus,
    '',
    sectionsBlock,
    '',
    '─── CROSS-JURISDICTION PRINCIPLES ───',
    CROSS_JURISDICTION_PRINCIPLES,
    '',
    '─── RESPONSE STYLE ───',
    '- Be terse and factual. Construction GCs do not have time for fluff.',
    '- When the relevant code text block above includes a verbatim quote, USE IT — quote the section number and a short verbatim excerpt.',
    '- Always cite the specific code section, agency, or filing type when possible.',
    '- If a number is involved (timeline, fee, square footage threshold), pull it from the corpus. If you cannot find it, say so explicitly — never make numbers up.',
    '- Format answers as 2-4 short paragraphs maximum. Use bullet lists when comparing options.',
    '- Never give legal advice or substitute for a licensed expediter on contested matters. Suggest contacting an expediter when the question is jurisdiction-specific or filing-specific.',
    '- If neither the metro corpus nor the code library covers the question, say "verify with [authority]" and suggest the public data feed listed in the metro corpus.',
  ].filter(Boolean).join('\n');
}

export default function PermitQAScreen() {
  const insets = useSafeAreaInsets();
  const [metro, setMetro] = useState<MetroKey>('NYC');
  const [metroPickerOpen, setMetroPickerOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);

  const currentMetroLabel = METROS.find(m => m.key === metro)?.label ?? metro;

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    const userMsg: Message = {
      id: `m-${Date.now()}-u`,
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setSending(true);
    if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});

    // Build the conversation context — last 6 messages so we don't
    // blow the token budget on a long thread, while preserving recent
    // back-and-forth context.
    const recent = [...messages, userMsg].slice(-6);
    const conversationText = recent
      .map(m => `${m.role === 'user' ? 'CONTRACTOR' : 'AGENT'}: ${m.content}`)
      .join('\n\n');

    const fullPrompt = [
      buildSystemPrompt(metro, trimmed),
      '',
      '─── Conversation so far ───',
      conversationText,
      '',
      'Reply as the AGENT to the most recent CONTRACTOR question. 2-4 short paragraphs. Use the metro context AND any relevant code text quoted above.',
    ].join('\n');

    try {
      const result = await mageAI({
        prompt: fullPrompt,
        tier: 'fast',
        maxTokens: 1200,
      });

      const assistantMsg: Message = {
        id: `m-${Date.now()}-a`,
        role: 'assistant',
        content: result.success
          ? (typeof result.data === 'string' ? result.data : (result.raw ?? 'No response.'))
          : (result.errorKind === 'unauthenticated'
              ? 'Sign in to use the permit Q&A agent.'
              : result.errorKind === 'monthly_cap'
              ? 'You\'ve hit your monthly AI quota. Resets ' + (result.error ?? 'next month') + '.'
              : 'Sorry, the agent had trouble responding. Try rephrasing.'),
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      console.warn('[permit-qa] send failed', err);
      setMessages(prev => [...prev, {
        id: `m-${Date.now()}-err`,
        role: 'assistant',
        content: 'Network error. Check your connection and try again.',
        timestamp: Date.now(),
      }]);
    } finally {
      setSending(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages, metro, sending]);

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Permit Q&A',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
        }}
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: 16 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Metro picker */}
          <TouchableOpacity
            style={styles.metroBar}
            onPress={() => setMetroPickerOpen(o => !o)}
            activeOpacity={0.85}
          >
            <MapPin size={14} color={Colors.accent} />
            <Text style={styles.metroBarText}>
              Asking about <Text style={styles.metroBarBold}>{currentMetroLabel}</Text>
            </Text>
            <ChevronDown size={14} color="rgba(244, 239, 230, 0.5)" />
          </TouchableOpacity>
          {metroPickerOpen && (
            <View style={styles.pickerList}>
              {METROS.map(m => (
                <TouchableOpacity
                  key={m.key}
                  style={styles.pickerItem}
                  onPress={() => {
                    setMetro(m.key);
                    setMetroPickerOpen(false);
                  }}
                >
                  <Text style={styles.pickerItemText}>{m.label}</Text>
                  {m.key === metro ? <Check size={14} color={Colors.primary} /> : null}
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Empty state — Fraunces hero + permit-stamp starter chips */}
          {messages.length === 0 && (
            <View style={styles.emptyHero}>
              <Text style={styles.emptyEyebrow}>
                {currentMetroLabel.toUpperCase()} · CODE LIBRARY
              </Text>
              <Text style={styles.emptyTitle}>
                Ask the <Text style={styles.emptyTitleItalic}>code.</Text>
              </Text>
              <Text style={styles.emptyBody}>
                Fast answers on filing types, timelines, rejections, fees, and inspection
                sequences. Verbatim quotes with section citations.
              </Text>
              <View style={styles.starterList}>
                {STARTER_QUESTIONS.map((q, i) => (
                  <TouchableOpacity
                    key={q}
                    style={styles.starterChip}
                    onPress={() => sendMessage(q)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.starterStamp}>§ {String(i + 1).padStart(2, '0')}</Text>
                    <Text style={styles.starterText}>{q}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.disclaimerBox}>
                <AlertCircle size={11} color={Colors.warning} />
                <Text style={styles.disclaimerText}>
                  Not legal advice. For contested filings or sub-licensing matters, consult a licensed
                  expediter or attorney.
                </Text>
              </View>
            </View>
          )}

          {/* Messages */}
          {messages.map(m => (
            <View
              key={m.id}
              style={[styles.message, m.role === 'user' ? styles.messageUser : styles.messageAgent]}
            >
              <View style={[styles.messageIconWrap, m.role === 'user' ? styles.messageIconUser : styles.messageIconAgent]}>
                {m.role === 'user'
                  ? <UserIcon size={13} color={Colors.cream} />
                  : <BookOpen size={13} color={Colors.ink} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.messageRole}>
                  {m.role === 'user' ? 'YOU' : 'PERMIT § AGENT'}
                </Text>
                <Text style={styles.messageContent}>{m.content}</Text>
              </View>
            </View>
          ))}

          {sending && (
            <View style={styles.message}>
              <View style={[styles.messageIconWrap, styles.messageIconAgent]}>
                <BookOpen size={13} color={Colors.ink} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.messageRole}>PERMIT § AGENT</Text>
                <View style={{ flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginTop: 4 }}>
                  <ActivityIndicator size="small" color={Colors.accent} />
                  <Text style={styles.messageContent}>Looking up code…</Text>
                </View>
              </View>
            </View>
          )}
        </ScrollView>

        {/* Composer */}
        <View style={[styles.composer, { paddingBottom: insets.bottom > 0 ? insets.bottom : 12 }]}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={`Ask about ${currentMetroLabel} permits…`}
            placeholderTextColor={Colors.textMuted}
            style={styles.composerInput}
            multiline
            onSubmitEditing={() => sendMessage(input)}
            blurOnSubmit={false}
          />
          <TouchableOpacity
            onPress={() => sendMessage(input)}
            disabled={!input.trim() || sending}
            style={[styles.composerSend, (!input.trim() || sending) && styles.composerSendDisabled]}
            activeOpacity={0.85}
          >
            <Send size={16} color={Colors.background} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  metroBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
    backgroundColor: Colors.ink,
    marginHorizontal: 16,
    borderRadius: Tokens.radius.md,
    marginBottom: 12,
    marginTop: 4,
  },
  metroBarText: {
    flex: 1,
    fontSize: Type.footnote.fontSize,
    color: 'rgba(244, 239, 230, 0.7)', // cream at 70%
  },
  metroBarBold: {
    ...Type.mono,
    color: Colors.accent,
    fontWeight: '600' as const,
    fontSize: 13,
  },
  pickerList: {
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    marginHorizontal: 16,
    marginBottom: 12,
    overflow: 'hidden' as const,
  },
  pickerItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderLight,
  },
  pickerItemText: { fontSize: Type.body.fontSize, color: Colors.text, fontWeight: '500' as const },

  // Empty hero — cream block, Fraunces title, mono eyebrow + section
  // stamps on the starter chips. Borrows directly from the marketing
  // landing aesthetic so Permit Q&A reads as "the same product" the
  // user saw before signing up.
  emptyHero: {
    marginHorizontal: 16,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 18,
    backgroundColor: Colors.cream,
    borderRadius: Tokens.radius.panel,
    borderWidth: 1,
    borderColor: Colors.bone,
  },
  emptyEyebrow: {
    ...Type.monoSm,
    color: Colors.concrete,
    fontWeight: '600' as const,
    marginBottom: 12,
  },
  emptyTitle: {
    ...Type.displaySm,
    color: Colors.ink,
  },
  emptyTitleItalic: {
    ...Type.displaySmItalic,
    color: Colors.accent,
  },
  emptyBody: {
    fontSize: Type.subhead.fontSize,
    color: Colors.concrete,
    marginTop: 6,
    marginBottom: 18,
    lineHeight: 21,
  },
  starterList: { gap: 8 },
  starterChip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    backgroundColor: Colors.off,
    borderWidth: 1,
    borderColor: Colors.bone,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: Tokens.radius.md,
  },
  starterStamp: {
    ...Type.monoSm,
    color: Colors.accent,
    fontWeight: '600' as const,
  },
  starterText: {
    flex: 1,
    fontSize: Type.bodyCompact.fontSize,
    color: Colors.ink,
    lineHeight: 18,
  },
  disclaimerBox: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 6,
    backgroundColor: Colors.warning + '10',
    borderRadius: Tokens.radius.sm,
    padding: 10,
    marginTop: 16,
  },
  disclaimerText: {
    flex: 1,
    fontSize: Type.caption2.fontSize,
    color: Colors.textSecondary,
    lineHeight: 14,
  },

  message: {
    flexDirection: 'row' as const,
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  messageUser: {},
  messageAgent: {},
  messageIconWrap: {
    width: 28,
    height: 28,
    borderRadius: Tokens.radius.full,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginTop: 2,
  },
  messageIconUser: { backgroundColor: Colors.ink },
  messageIconAgent: { backgroundColor: Colors.accent },
  messageRole: {
    ...Type.monoSm,
    color: Colors.accent,
    fontWeight: '600' as const,
    textTransform: 'uppercase' as const,
  },
  messageContent: {
    fontSize: Type.body.fontSize,
    color: Colors.ink,
    marginTop: 4,
    lineHeight: 22,
  },

  composer: {
    flexDirection: 'row' as const,
    alignItems: 'flex-end' as const,
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    backgroundColor: Colors.background,
  },
  composerInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: Type.body.fontSize,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  composerSend: {
    width: 40,
    height: 40,
    borderRadius: Tokens.radius.full,
    backgroundColor: Colors.accent,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  composerSendDisabled: { opacity: 0.5 },
});
