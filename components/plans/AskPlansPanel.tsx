// components/plans/AskPlansPanel.tsx — "Ask Your Plans" question box.
//
// Lets a GC type a plain-English question about their uploaded plan set and
// get a grounded, cited answer with a tap-to-jump to the relevant sheet.
// Also exposes Index / re-index to extract + embed sheets into project memory.
//
// Tier gate: Business+ (uses 'ask_your_plans' FeatureKey). If locked, an
// inline upsell card is shown instead of the panel.

import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ActivityIndicator, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  Search, RefreshCw, BookOpen, Lock, ArrowRight,
} from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTierAccess } from '@/hooks/useTierAccess';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { askPlans, indexPlanSheets } from '@/utils/plans/askYourPlans';
import type { PlanSheet } from '@/types';

interface Props {
  projectId: string;
  sheets: PlanSheet[];
}

export default function AskPlansPanel({ projectId, sheets }: Props) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { canAccess } = useTierAccess();

  if (!canAccess('ask_your_plans')) {
    return <UpsellCard t={t} styles={styles} />;
  }

  return <AskPlansPanelInner projectId={projectId} sheets={sheets} t={t} styles={styles} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Inner (authenticated) panel
// ─────────────────────────────────────────────────────────────────────────────

type AskState = 'idle' | 'asking' | 'answered' | 'error';
type IndexState = 'idle' | 'indexing' | 'done' | 'error';

function AskPlansPanelInner({
  projectId, sheets, t, styles,
}: Props & { t: ThemeColors; styles: ReturnType<typeof makeStyles> }) {
  const router = useRouter();
  const inputRef = useRef<TextInput>(null);

  const [question, setQuestion] = useState('');
  const [askState, setAskState] = useState<AskState>('idle');
  const [answer, setAnswer] = useState('');
  const [citations, setCitations] = useState<{ ref: string; sheetId: string }[]>([]);
  const [noneFound, setNoneFound] = useState(false);

  const [indexState, setIndexState] = useState<IndexState>('idle');
  const [indexedCount, setIndexedCount] = useState(0);

  const handleAsk = useCallback(async () => {
    const q = question.trim();
    if (!q || askState === 'asking') return;
    setAskState('asking');
    setAnswer('');
    setCitations([]);
    setNoneFound(false);
    try {
      const result = await askPlans(projectId, q);
      setAnswer(result.answer);
      setCitations(result.citations);
      setNoneFound(result.noneFound);
      setAskState('answered');
    } catch {
      setAnswer("Couldn't reach the plan brain right now — try again.");
      setCitations([]);
      setNoneFound(false);
      setAskState('error');
    }
  }, [projectId, question, askState]);

  const handleIndex = useCallback(async () => {
    if (indexState === 'indexing') return;
    setIndexState('indexing');
    setIndexedCount(0);
    try {
      const count = await indexPlanSheets(projectId, sheets);
      setIndexedCount(count);
      setIndexState('done');
    } catch {
      setIndexState('error');
    }
  }, [projectId, sheets, indexState]);

  const jumpToSheet = useCallback((sheetId: string) => {
    router.push({ pathname: '/plan-viewer', params: { sheetId } });
  }, [router]);

  const indexLabel = (() => {
    if (indexState === 'indexing') return `Indexing ${sheets.length} sheet${sheets.length === 1 ? '' : 's'}…`;
    if (indexState === 'done') return indexedCount > 0 ? `${indexedCount} chunk${indexedCount === 1 ? '' : 's'} indexed` : 'Indexing complete';
    if (indexState === 'error') return 'Indexing failed — try again';
    return sheets.length > 0 ? `Index ${sheets.length} sheet${sheets.length === 1 ? '' : 's'}` : 'Index plans';
  })();

  return (
    <View style={styles.panel}>
      {/* Header */}
      <View style={styles.panelHeader}>
        <BookOpen size={16} color={t.accent} strokeWidth={1.75} />
        <Text style={styles.panelTitle}>Ask Your Plans</Text>
      </View>

      {/* Input row */}
      <View style={styles.inputRow}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={question}
          onChangeText={setQuestion}
          placeholder="Ask your plans…"
          placeholderTextColor={t.textMuted}
          returnKeyType="send"
          onSubmitEditing={() => void handleAsk()}
          editable={askState !== 'asking'}
          multiline={false}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!question.trim() || askState === 'asking') && styles.sendBtnDisabled]}
          onPress={() => void handleAsk()}
          disabled={!question.trim() || askState === 'asking'}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Ask"
        >
          {askState === 'asking' ? (
            <ActivityIndicator size="small" color={Colors.textOnAccent} />
          ) : (
            <Search size={16} color={Colors.textOnAccent} strokeWidth={1.75} />
          )}
        </TouchableOpacity>
      </View>

      {/* Loading state */}
      {askState === 'asking' && (
        <Text style={styles.statusText}>Reading your plans…</Text>
      )}

      {/* Answer */}
      {(askState === 'answered' || askState === 'error') && answer ? (
        <View style={styles.answerCard}>
          <Text style={styles.answerText}>{answer}</Text>

          {/* Citations */}
          {citations.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.citationRow}
            >
              {citations.map(({ ref, sheetId }) => (
                <TouchableOpacity
                  key={sheetId}
                  style={styles.citationChip}
                  onPress={() => jumpToSheet(sheetId)}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  accessibilityLabel={`Jump to Sheet ${ref}`}
                >
                  <Text style={styles.citationChipText}>Sheet {ref}</Text>
                  <ArrowRight size={11} color={t.accent} strokeWidth={2} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {/* None-found message */}
          {noneFound && (
            <Text style={styles.noneFoundText}>
              I couldn't find that in the indexed plans — try rephrasing, or index new sheets below.
            </Text>
          )}
        </View>
      ) : null}

      {/* Index / re-index action */}
      <TouchableOpacity
        style={[styles.indexBtn, indexState === 'indexing' && styles.indexBtnActive]}
        onPress={() => void handleIndex()}
        disabled={indexState === 'indexing'}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel={indexLabel}
      >
        {indexState === 'indexing' ? (
          <ActivityIndicator size="small" color={t.accent} />
        ) : (
          <RefreshCw size={13} color={indexState === 'done' ? t.success : t.textMuted} strokeWidth={1.75} />
        )}
        <Text style={[
          styles.indexBtnText,
          indexState === 'done' && { color: t.success },
          indexState === 'error' && { color: t.danger },
        ]}>
          {indexLabel}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Upsell card (shown when not Business+)
// ─────────────────────────────────────────────────────────────────────────────

function UpsellCard({ t, styles }: { t: ThemeColors; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.upsellCard}>
      <Lock size={15} color={t.accent} strokeWidth={1.75} />
      <View style={{ flex: 1 }}>
        <Text style={styles.upsellTitle}>Ask your plans in plain English</Text>
        <Text style={styles.upsellSub}>
          Type a question, get a cited answer with a tap-to-jump to the sheet — Business plan.
        </Text>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  panel: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.card,
    borderWidth: 1,
    borderColor: t.line,
    padding: 14,
    marginBottom: 14,
    gap: 10,
  },

  panelHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 7,
  },
  panelTitle: {
    ...Type.subheadline,
    fontWeight: '700' as const,
    color: t.text,
  },

  inputRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: t.surfaceAlt,
    borderRadius: Tokens.radius.sm,
    borderWidth: 1,
    borderColor: t.line,
    paddingHorizontal: 12,
    paddingVertical: 10,
    ...Type.subhead,
    color: t.text,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: Tokens.radius.full,
    backgroundColor: t.accent,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  sendBtnDisabled: {
    opacity: 0.45,
  },

  statusText: {
    ...Type.caption1,
    color: t.textMuted,
    fontWeight: '500' as const,
  },

  answerCard: {
    backgroundColor: t.surfaceAlt,
    borderRadius: Tokens.radius.sm,
    borderWidth: 1,
    borderColor: t.line,
    padding: 12,
    gap: 10,
  },
  answerText: {
    ...Type.body,
    color: t.text,
    lineHeight: 22,
  },

  citationRow: {
    flexDirection: 'row' as const,
    gap: 8,
  },
  citationChip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5,
    backgroundColor: t.accent + '14',
    borderRadius: Tokens.radius.full,
    borderWidth: 1,
    borderColor: t.accent + '44',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  citationChipText: {
    ...Type.caption1,
    color: t.accent,
    fontWeight: '700' as const,
  },

  noneFoundText: {
    ...Type.caption1,
    color: t.textMuted,
    lineHeight: 17,
  },

  indexBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    alignSelf: 'flex-start' as const,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Tokens.radius.full,
    borderWidth: 1,
    borderColor: t.line,
  },
  indexBtnActive: {
    opacity: 0.7,
  },
  indexBtnText: {
    ...Type.caption1,
    color: t.textMuted,
    fontWeight: '600' as const,
  },

  upsellCard: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 10,
    backgroundColor: t.accent + '0D',
    borderRadius: Tokens.radius.card,
    borderWidth: 1,
    borderColor: t.accent + '33',
    padding: 14,
    marginBottom: 14,
  },
  upsellTitle: {
    ...Type.subhead,
    fontWeight: '700' as const,
    color: t.text,
    marginBottom: 3,
  },
  upsellSub: {
    ...Type.caption1,
    color: t.textSecondary,
    lineHeight: 16,
  },
});
