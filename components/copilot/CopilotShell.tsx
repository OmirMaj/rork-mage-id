// components/copilot/CopilotShell.tsx — the MAGE Copilot interview screen.
//
// Renders the conversational interview by phase (spec §3.7 visual design):
//   listening → VoiceCaptureModal (voice in) → thinking → asking (resolved
//   chips + Fraunces question + mono grounding + tap-to-pick options + editable
//   transcript) → review (confirm-back) → applying → done. Ink ground, cream
//   text, MAGE-orange the single accent, amber the "your data" signal, Fraunces
//   for the question only, JetBrains-Mono for every grounded citation. Built
//   from Colors/Type/Tokens (no raw hex / inline fontSize / borderRadius).
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { Mic, Check, ChevronRight, X, Monitor, Pencil, Hammer, CalendarDays } from 'lucide-react-native';
import VoiceCaptureModal from '@/components/VoiceCaptureModal';
import DatePickerModal from '@/components/DatePickerModal';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { Colors, type ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useCopilotConversation } from '@/hooks/useCopilotConversation';
import { optionsForGap } from '@/utils/copilot/gapOptions';
import type { CopilotCapabilityId, CopilotContext } from '@/utils/copilot/types';

interface Props {
  capabilityId: CopilotCapabilityId;
  ctx: CopilotContext;
  onDone: () => void;
}

export default function CopilotShell({ capabilityId, ctx, onDone }: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const convo = useCopilotConversation(capabilityId, ctx);
  const { state, cap, start, utterance, answer, skip, confirm, cancel } = convo;
  const [micOpen, setMicOpen] = useState(false);
  const [compose, setCompose] = useState('');
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  // On mount: build grounding → listening (the compose view; voice is optional).
  useEffect(() => {
    void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onTranscript = useCallback((t: string) => { setMicOpen(false); utterance(t); }, [utterance]);
  const submitCompose = useCallback(() => {
    const t = compose.trim();
    if (!t) return;
    setCompose('');
    utterance(t);
  }, [compose, utterance]);
  const openWeb = useCallback(() => { onDone(); router.push({ pathname: cap.copy.webRoute as never, params: { id: ctx.projectId } as never }); }, [onDone, router, ctx.projectId, cap.copy.webRoute]);
  const close = useCallback(() => { cancel(); onDone(); }, [cancel, onDone]);

  const thinking = state.phase === 'thinking';

  return (
    <View style={styles.root}>
      {/* voice capture overlay for the listening phase + re-openable mic */}
      <VoiceCaptureModal
        visible={micOpen}
        onClose={() => setMicOpen(false)}
        onTranscriptReady={onTranscript}
        title={cap.copy.voiceTitle}
        contextLine={ctx.project?.name ? `for ${ctx.project.name}` : undefined}
        suggestions={cap.suggestions}
        topicChecklist={cap.topicChecklist}
      />

      {/* date wheel for a `date` gap — answers with a real ISO date. */}
      <DatePickerModal
        visible={datePickerOpen}
        value=""
        allowFuture
        title={state.currentGap?.question ?? 'Pick the start date'}
        onClose={() => setDatePickerOpen(false)}
        onChange={(iso) => {
          setDatePickerOpen(false);
          if (state.currentGap) answer(state.currentGap.field, iso);
        }}
      />

      {/* top bar */}
      <View style={styles.topbar}>
        <View style={styles.topRow}>
          <Text style={styles.brand}>MAGE&nbsp;COPILOT</Text>
          <TouchableOpacity onPress={close} accessibilityLabel="Close" hitSlop={10}>
            <X size={20} color={colors.textMuted} strokeWidth={2} />
          </TouchableOpacity>
        </View>
        {state.questionCount > 0 && (
          <Text style={styles.progress}>Question {state.questionCount} · grounded in your jobs</Text>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* resolved defaults — shown, not asked */}
        {state.resolved.length > 0 && (
          <View style={styles.resolvedGroup}>
            <Text style={styles.resHead}>SET FROM YOUR HISTORY — NOTHING TO ASK</Text>
            {state.resolved.map(r => (
              <View key={r.field} style={styles.resRow}>
                <View style={styles.tick}><Check size={11} color={colors.success} strokeWidth={3} /></View>
                <View style={styles.resText}>
                  <Text style={styles.resLabel} numberOfLines={2}>{r.label}</Text>
                  <Text style={styles.basis} numberOfLines={2}>{r.basis}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {(state.phase === 'listening' || state.phase === 'idle') && (
          <View style={styles.ask}>
            <Text style={styles.askEyebrow}>TELL ME ABOUT THE JOB</Text>
            <Text style={styles.question}>What are we building?</Text>
            <Text style={styles.grounding}>Speak it or type it — scope, rooms, start date, what’s ordered.</Text>
            <TextInput
              style={styles.composeInput}
              value={compose}
              onChangeText={setCompose}
              placeholder={cap.suggestions[0]}
              placeholderTextColor={colors.textMuted}
              multiline
              testID="copilot-compose"
            />
            <TouchableOpacity style={styles.buildBtn} activeOpacity={0.9} onPress={submitCompose} testID="copilot-send">
              <Text style={styles.buildBtnText}>Continue</Text>
            </TouchableOpacity>
          </View>
        )}

        {thinking && (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.thinkingText}>Reading your numbers…</Text>
          </View>
        )}

        {/* the question */}
        {state.phase === 'asking' && state.currentGap && (
          <View style={styles.ask}>
            <Text style={styles.askEyebrow}>GROUNDED IN YOUR JOB</Text>
            <Text style={styles.question}>{state.currentGap.question}</Text>
            <Text style={styles.grounding}>{state.currentGap.groundedDefault.basis}</Text>

            {/* A `date` gap (e.g. the start date) needs a real day, not a
                Yes/No — open the date wheel so the answer is a true ISO date. */}
            {state.currentGap.kind === 'date' ? (
              <View style={styles.options}>
                <TouchableOpacity
                  style={[styles.opt, styles.optRec]}
                  activeOpacity={0.85}
                  onPress={() => setDatePickerOpen(true)}
                >
                  <CalendarDays size={20} color={colors.accent} strokeWidth={2} />
                  <View style={styles.optLab}>
                    <Text style={styles.optText}>Pick the start date</Text>
                    <Text style={styles.optSub}>Tap to choose the day you break ground</Text>
                  </View>
                  <ChevronRight size={18} color={colors.textMuted} strokeWidth={2} />
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.options}>
                {optionsForGap(state.currentGap).map((c, i) => (
                  <TouchableOpacity
                    key={i}
                    style={[styles.opt, c.recommended && styles.optRec]}
                    activeOpacity={0.85}
                    onPress={() => answer(state.currentGap!.field, c.value)}
                  >
                    <View style={[styles.radio, c.recommended && styles.radioRec]} />
                    <View style={styles.optLab}>
                      <Text style={styles.optText}>{c.label}</Text>
                      {!!c.basis && <Text style={styles.optSub}>{c.basis}</Text>}
                    </View>
                    {c.recommended && <Text style={styles.suggested}>SUGGESTED</Text>}
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* editable transcript chip */}
            {state.transcript.length > 0 && (
              <TouchableOpacity style={styles.heard} onPress={() => setMicOpen(true)} activeOpacity={0.7}>
                <Text style={styles.heardLabel}>YOU SAID</Text>
                <Text style={styles.heardText} numberOfLines={2}>“{state.transcript[state.transcript.length - 1].text}”</Text>
                <Pencil size={14} color={colors.textMuted} strokeWidth={1.9} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* review / confirm-back */}
        {state.phase === 'review' && (
          <View style={styles.ask}>
            <Text style={styles.askEyebrow}>READY TO BUILD</Text>
            <Text style={styles.question}>{cap.copy.reviewHeadline}</Text>
            <Text style={styles.grounding}>{cap.copy.reviewSub}</Text>
            <TouchableOpacity style={styles.buildBtn} activeOpacity={0.9} onPress={async () => { const a = await confirm(); if (a?.route) { onDone(); router.replace({ pathname: a.route as never, params: { id: a.projectId, ...(a.params ?? {}) } as never }); } }}>
              <Hammer size={18} color={Colors.textOnAccent} strokeWidth={2} />
              <Text style={styles.buildBtnText}>Build it</Text>
            </TouchableOpacity>
          </View>
        )}

        {state.phase === 'applying' && (
          <View style={styles.center}><ActivityIndicator color={colors.accent} /><Text style={styles.thinkingText}>{cap.copy.buildingLabel}</Text></View>
        )}

        {state.phase === 'error' && (
          <View style={styles.ask}>
            <Text style={styles.askEyebrow}>SOMETHING WENT WRONG</Text>
            <Text style={styles.question}>{state.errorMessage ?? 'Try again.'}</Text>
            <TouchableOpacity style={styles.buildBtn} activeOpacity={0.9} onPress={() => setMicOpen(true)}>
              <Mic size={18} color={Colors.textOnAccent} strokeWidth={2} />
              <Text style={styles.buildBtnText}>Try again</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* persistent escapes */}
      <View style={styles.actionbar}>
        <TouchableOpacity style={styles.mic} onPress={() => setMicOpen(true)} accessibilityLabel="Answer by voice">
          <Mic size={22} color={Colors.textOnAccent} strokeWidth={1.9} />
        </TouchableOpacity>
        <View style={styles.escapes}>
          {state.phase === 'asking' && (
            <TouchableOpacity style={styles.ghost} onPress={skip}>
              <Check size={14} color={colors.textMuted} strokeWidth={1.9} />
              <Text style={styles.ghostText}>Build it now — skip the rest</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.ghost} onPress={openWeb}>
            <Monitor size={14} color={colors.textMuted} strokeWidth={1.9} />
            <Text style={styles.ghostText}>Open on web to fine-tune</Text>
            <ChevronRight size={14} color={colors.textMuted} strokeWidth={1.9} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    topbar: { paddingHorizontal: Tokens.spacing.lg, paddingTop: Tokens.spacing.md, paddingBottom: Tokens.spacing.sm, gap: Tokens.spacing.xs },
    topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    brand: { ...Type.monoEyebrow, color: colors.textSecondary },
    progress: { ...Type.monoLabel, color: colors.textMuted },
    body: { paddingHorizontal: Tokens.spacing.lg, paddingBottom: Tokens.spacing['3xl'], gap: Tokens.spacing.lg },

    resolvedGroup: { gap: Tokens.spacing.xs },
    resHead: { ...Type.monoLabel, color: colors.textMuted },
    resRow: { flexDirection: 'row', gap: Tokens.spacing.sm, alignItems: 'flex-start', padding: Tokens.spacing.sm, borderWidth: 1, borderColor: colors.line, borderRadius: Tokens.radius.lg },
    tick: { width: 18, height: 18, borderRadius: Tokens.radius.full, borderWidth: 1, borderColor: colors.success, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
    resText: { flex: 1, gap: 2 },
    resLabel: { ...Type.subheadEmphasized, color: colors.text },
    basis: { ...Type.monoLabel, color: colors.textMuted },

    center: { alignItems: 'center', gap: Tokens.spacing.sm, paddingVertical: Tokens.spacing['2xl'] },
    thinkingText: { ...Type.footnote, color: colors.textMuted },

    ask: { gap: Tokens.spacing.sm },
    askEyebrow: { ...Type.monoEyebrow, color: Colors.accentLight },
    question: { ...Type.serifHeadline, color: colors.text },
    grounding: { ...Type.monoLabel, color: colors.textMuted, borderLeftWidth: 2, borderLeftColor: Colors.accentLight, paddingLeft: Tokens.spacing.sm },
    composeInput: { ...Type.body, color: colors.text, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: Tokens.radius.lg, padding: Tokens.spacing.md, minHeight: 96, textAlignVertical: 'top', marginTop: Tokens.spacing.xxs },

    options: { gap: Tokens.spacing.xs, marginTop: Tokens.spacing.xxs },
    opt: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.sm, padding: Tokens.spacing.md, borderRadius: Tokens.radius.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
    optRec: { borderColor: colors.accent },
    radio: { width: 18, height: 18, borderRadius: Tokens.radius.full, borderWidth: 1, borderColor: colors.textMuted },
    radioRec: { borderColor: colors.accent, backgroundColor: colors.accent },
    optLab: { flex: 1, gap: 2 },
    optText: { ...Type.bodyCompactEmphasized, color: colors.text },
    optSub: { ...Type.monoLabel, color: colors.textMuted },
    suggested: { ...Type.monoLabel, color: colors.accent },

    heard: { flexDirection: 'row', alignItems: 'flex-start', gap: Tokens.spacing.xs, padding: Tokens.spacing.sm, borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: colors.line, borderStyle: 'dashed' },
    heardLabel: { ...Type.monoLabel, color: colors.textMuted, marginTop: 1 },
    heardText: { ...Type.footnote, color: colors.textSecondary, flex: 1, fontStyle: 'italic' },

    buildBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Tokens.spacing.xs, backgroundColor: colors.accent, borderRadius: Tokens.radius.lg, paddingVertical: Tokens.spacing.md, marginTop: Tokens.spacing.sm },
    buildBtnText: { ...Type.bodyEmphasized, color: Colors.textOnAccent },

    actionbar: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.sm, paddingHorizontal: Tokens.spacing.lg, paddingVertical: Tokens.spacing.md, borderTopWidth: 1, borderTopColor: colors.line },
    mic: { width: 52, height: 52, borderRadius: Tokens.radius.full, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
    escapes: { flex: 1, gap: Tokens.spacing.xxs },
    ghost: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xs },
    ghostText: { ...Type.subhead, color: colors.textSecondary, flex: 1 },
  });
}
