// AskConstructionMode — the Business+ "Ask" mode of the Construction AI tab.
//
// Calls the agentic construction-answer engine (Claude + live web search + the
// contractor's own data + a deterministic calculator) and renders a CITED,
// HONEST answer: source chips, the calc when present, and an amber
// "confirm with your AHJ" banner whenever the answer isn't fully verified.
//
// Self-contained so it doesn't add surgery to the 2200-line tab file. Inert for
// non-Business users (upgrade CTA) and when the edge fn is undeployed/keyless
// (graceful "not available yet" — never a crash), per the design spec.

import React, { useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, Linking, Platform, StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  MessageCircleQuestion, ExternalLink, FileText, Calculator,
  AlertTriangle, FileQuestion, DollarSign,
} from 'lucide-react-native';
import { Colors, type ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { MageAIMark } from '@/components/icons';
import { askConstruction, ConstructionAnswerError } from '@/utils/constructionAnswer';
import type { ConstructionAnswerResult, AnswerCitation } from '@/types/constructionAnswer';

interface ProjectLite { id: string; name: string }

interface Props {
  projects: ProjectLite[];
  bottomInset: number;
}

const PRESETS = [
  'Is a 2x10 at 16" OC OK for a 16 ft floor span?',
  'Egress requirements for a basement bedroom?',
  'What permits do I need for a garage-to-ADU conversion?',
];

export default function AskConstructionMode({ projects, bottomInset }: Props) {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { canAccess } = useTierAccess();
  const canAsk = canAccess('construction_answer');

  const [question, setQuestion] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ConstructionAnswerResult | null>(null);
  const [errCode, setErrCode] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [showPaywall, setShowPaywall] = useState(false);

  const canSubmit = question.trim().length > 3 && !loading;

  const runAsk = useCallback(async () => {
    if (!canAsk) { setShowPaywall(true); return; }
    if (!canSubmit) return;
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLoading(true);
    setResult(null);
    setErrCode(null);
    setErrMsg(null);
    try {
      const res = await askConstruction({ question: question.trim(), projectId });
      setResult(res);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      const code = e instanceof ConstructionAnswerError ? e.code : 'unavailable';
      setErrCode(code);
      setErrMsg(e instanceof Error ? e.message : null);
    } finally {
      setLoading(false);
    }
  }, [canAsk, canSubmit, question, projectId]);

  const openCitation = useCallback((c: AnswerCitation) => {
    if (c.kind === 'web' && c.url) { void Linking.openURL(c.url); return; }
    if (c.kind === 'plan' && c.ref) { router.push(`/plan-viewer?sheetId=${encodeURIComponent(c.ref)}` as never); return; }
  }, [router]);

  const showHonesty = !!result && (!result.verified || !!result.disclaimer);

  return (
    <ScrollView
      contentContainerStyle={{ padding: 20, paddingBottom: bottomInset + 80 }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.hero}>
        <View style={styles.heroIconWrap}>
          <MessageCircleQuestion size={28} color={Colors.primary} strokeWidth={1.75} />
        </View>
        <Text style={styles.heroTitle}>Ask</Text>
        <Text style={styles.heroSubtitle}>
          Deep answers on codes, spans and permits — researched against the actual code and your job, with every source cited.
        </Text>
        <View style={styles.tierChip}><Text style={styles.tierChipText}>Business</Text></View>
      </View>

      {projects.length > 0 && (
        <>
          <Text style={styles.label}>Link a project (optional)</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity
                style={[styles.chip, projectId === null && styles.chipActive]}
                onPress={() => setProjectId(null)}
                activeOpacity={0.8}
              >
                <Text style={[styles.chipText, projectId === null && styles.chipTextActive]}>No project</Text>
              </TouchableOpacity>
              {projects.map((p) => {
                const active = p.id === projectId;
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => setProjectId(p.id)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>{p.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
        </>
      )}

      <Text style={styles.label}>Your question</Text>
      <TextInput
        value={question}
        onChangeText={setQuestion}
        placeholder="Ask about codes, spans, permits, or your plans…"
        placeholderTextColor={Colors.textMuted}
        style={styles.textArea}
        multiline
        numberOfLines={4}
        textAlignVertical="top"
        testID="construction-ask-input"
      />

      <View style={styles.presetList}>
        {PRESETS.map((q) => (
          <TouchableOpacity
            key={q}
            onPress={() => { setQuestion(q); if (Platform.OS !== 'web') void Haptics.selectionAsync(); }}
            activeOpacity={0.7}
            style={styles.presetPill}
          >
            <Text style={styles.presetPillText} numberOfLines={2}>{q}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {canAsk ? (
        <TouchableOpacity
          style={[styles.runBtn, !canSubmit && styles.runBtnDisabled]}
          onPress={runAsk}
          disabled={!canSubmit}
          activeOpacity={0.85}
          testID="construction-ask-run"
        >
          {loading ? <ActivityIndicator color="#FFF" /> : <MageAIMark size={18} color="#FFF" />}
          <Text style={styles.runBtnText}>{loading ? 'Researching your codes + job…' : 'Get answer'}</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={styles.runBtn}
          onPress={() => setShowPaywall(true)}
          activeOpacity={0.85}
          testID="construction-ask-upgrade"
        >
          <MageAIMark size={18} color="#FFF" />
          <Text style={styles.runBtnText}>Upgrade to Business to ask</Text>
        </TouchableOpacity>
      )}

      {/* ── Errors (graceful, never a crash) ── */}
      {errCode ? (
        <View style={styles.noticeCard} testID="construction-ask-error">
          {errCode === 'needs_business' ? (
            <TouchableOpacity onPress={() => setShowPaywall(true)} activeOpacity={0.8}>
              <Text style={styles.noticeText}>Construction Answers is on the Business plan. Tap to upgrade.</Text>
            </TouchableOpacity>
          ) : errCode === 'limit_reached' ? (
            <Text style={styles.noticeText}>{errMsg || "You've hit this month's Construction Answers limit."}</Text>
          ) : errCode === 'unauthenticated' ? (
            <Text style={styles.noticeText}>Please sign in to use Construction Answers.</Text>
          ) : (
            <Text style={styles.noticeText}>Construction Answers isn&apos;t available yet.</Text>
          )}
        </View>
      ) : null}

      {/* ── Result ── */}
      {result ? (
        <View style={styles.resultCard} testID="construction-ask-result">
          <Text style={styles.answerText} selectable>{result.answer}</Text>

          {result.calc ? (
            <View style={styles.calcBadge}>
              <Calculator size={14} color={Colors.primary} strokeWidth={1.75} />
              <Text style={styles.calcText}>
                {result.calc.expression} = {result.calc.value}
                {result.calc.note ? `  ·  ${result.calc.note}` : ''}
              </Text>
            </View>
          ) : null}

          {result.citations.length > 0 ? (
            <>
              <Text style={styles.sourcesLabel}>Sources</Text>
              <View style={styles.chipWrap}>
                {result.citations.map((c, i) => {
                  const tappable = (c.kind === 'web' && !!c.url) || (c.kind === 'plan' && !!c.ref);
                  const Icon = c.kind === 'web' ? ExternalLink : c.kind === 'plan' ? FileText : c.kind === 'rfi' ? FileQuestion : DollarSign;
                  return (
                    <TouchableOpacity
                      key={`${c.kind}-${i}`}
                      style={styles.sourceChip}
                      onPress={() => openCitation(c)}
                      disabled={!tappable}
                      activeOpacity={tappable ? 0.7 : 1}
                    >
                      <Icon size={12} color={tappable ? Colors.primary : Colors.textMuted} strokeWidth={1.75} />
                      <Text style={[styles.sourceChipText, tappable && styles.sourceChipTextLink]} numberOfLines={1}>{c.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          ) : null}

          {showHonesty ? (
            <View style={styles.honestyBanner} testID="construction-ask-ahj">
              <AlertTriangle size={14} color={Colors.warning} strokeWidth={1.75} />
              <Text style={styles.honestyText}>
                {result.disclaimer || 'General guidance — confirm details with your local building department (AHJ).'}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <Paywall
        visible={showPaywall}
        feature="Construction Answers"
        requiredTier="business"
        onClose={() => setShowPaywall(false)}
      />
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  hero: { alignItems: 'center' as const, marginBottom: 8 },
  heroIconWrap: {
    width: 60, height: 60, borderRadius: Tokens.radius.panel, alignItems: 'center' as const,
    justifyContent: 'center' as const, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, marginBottom: 12,
  },
  heroTitle: { fontSize: 24, fontWeight: '700' as const, color: c.text },
  heroSubtitle: {
    fontSize: Type.bodyCompact.fontSize, color: c.textMuted, textAlign: 'center' as const,
    paddingHorizontal: 20, lineHeight: 20, marginTop: 4,
  },
  tierChip: {
    marginTop: 10, paddingHorizontal: 10, paddingVertical: 3, borderRadius: Tokens.radius.panel,
    backgroundColor: c.surface, borderWidth: 1, borderColor: c.line,
  },
  tierChipText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: c.textSecondary, letterSpacing: 0.4 },
  label: {
    fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: c.textMuted,
    marginTop: 16, marginBottom: 8, letterSpacing: 0.5,
  },
  textArea: {
    minHeight: 96, backgroundColor: c.surface, borderRadius: Tokens.radius.card, borderWidth: 1,
    borderColor: c.line, padding: 12, fontSize: Type.subhead.fontSize, color: c.text,
  },
  chipWrap: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: Tokens.radius.panel,
    backgroundColor: c.surface, borderWidth: 1, borderColor: c.line,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: c.text, maxWidth: 160 },
  chipTextActive: { color: '#FFF' },
  presetList: { gap: 8, marginTop: 12 },
  presetPill: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: Tokens.radius.card,
    backgroundColor: c.surface, borderWidth: 1, borderColor: c.line,
  },
  presetPillText: { fontSize: Type.footnote.fontSize, color: c.textSecondary },
  runBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8,
    backgroundColor: Colors.primary, borderRadius: Tokens.radius.card, paddingVertical: 14, marginTop: 16,
  },
  runBtnDisabled: { opacity: 0.5 },
  runBtnText: { color: '#FFF', fontSize: Type.subhead.fontSize, fontWeight: '700' as const },
  noticeCard: {
    marginTop: 14, padding: 14, borderRadius: Tokens.radius.card,
    backgroundColor: c.surface, borderWidth: 1, borderColor: c.line,
  },
  noticeText: { fontSize: Type.footnote.fontSize, color: c.textSecondary, lineHeight: 20 },
  resultCard: {
    marginTop: 16, padding: 16, borderRadius: Tokens.radius.panel,
    backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, gap: 12,
  },
  answerText: { fontSize: Type.subhead.fontSize, color: c.text, lineHeight: 22 },
  calcBadge: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, alignSelf: 'flex-start' as const,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: Tokens.radius.panel,
    backgroundColor: c.surface, borderWidth: 1, borderColor: c.line,
  },
  calcText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: c.text, fontVariant: ['tabular-nums'] as const },
  sourcesLabel: {
    fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: c.textMuted, letterSpacing: 0.5,
  },
  sourceChip: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, maxWidth: '100%' as const,
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: Tokens.radius.panel,
    backgroundColor: c.surface, borderWidth: 1, borderColor: c.line,
  },
  sourceChipText: { fontSize: Type.caption1.fontSize, color: c.textSecondary, maxWidth: 220 },
  sourceChipTextLink: { color: Colors.primary, fontWeight: '600' as const },
  honestyBanner: {
    flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 8,
    padding: 12, borderRadius: Tokens.radius.card,
    backgroundColor: `${Colors.warning}14`, borderWidth: 1, borderColor: `${Colors.warning}40`,
  },
  honestyText: { flex: 1, fontSize: Type.footnote.fontSize, color: c.textSecondary, lineHeight: 19 },
});
