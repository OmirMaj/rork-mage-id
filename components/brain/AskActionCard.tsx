// components/brain/AskActionCard.tsx — Ask MAGE "do it for me" (lane AIDO).
//
// The assistant-side card under a do-request ("build the schedule", "write an
// RFI about the beam"): the workflow, the job it will run on (or that the job
// is picked next), his words quoted as they will be handed over, an honesty
// line, and Start. Start opens the MAGE Copilot capability; nothing is saved
// until its own review ("Build it").
//
// HONESTY: no success colour and no check mark here. "Saved: …" appears only
// when actionOutcome() finds the record in ProjectContext; a workflow whose
// records Ask cannot see says "Opened …" and nothing more. A blocked Start
// always prints why beside it (docs/VOICE.md "Blocked actions").
//
// Flat, theme tokens only, no motion of its own (AILOOK animates the row that
// holds it).
import React from 'react';
import { View, Text, TouchableOpacity, Platform, StyleSheet } from 'react-native';
import { Briefcase, ChevronRight } from 'lucide-react-native';
import { Card } from '@/components/ui';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { Colors, type ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens, Layout } from '@/constants/designTokens';
import { useAskCopy, type AskCopy } from '@/hooks/useAskCopy';
import type { UseAskAction } from '@/hooks/useAskAction';
import { needsJobPick, type AskActionOutcome, type AskActionProposal } from '@/utils/oneMind/askAction';

export interface AskActionCardProps {
  turnKey: string;
  proposals: AskActionProposal[];
  action: UseAskAction;
  onAnswerInstead?: () => void;
}

export function AskActionCard({ turnKey, proposals, action, onAnswerInstead }: AskActionCardProps) {
  const styles = useThemedStyles(makeStyles);
  const copy = useAskCopy();
  const list = Array.isArray(proposals) ? proposals.slice(0, 3) : [];
  if (list.length === 0) return <View testID="ask-action-card" />;
  const howto = list.some((p) => p.origin === 'howto');
  const multi = list.length > 1;

  const honestyPill = (
    <View style={styles.honestyPill}>
      <Text style={styles.honestyText}>{copy.honesty}</Text>
    </View>
  );
  const answerButton = onAnswerInstead ? (
    <TouchableOpacity
      accessibilityRole="button"
      onPress={onAnswerInstead}
      style={styles.textButton}
      hitSlop={8}
      testID="ask-action-answer-instead"
    >
      <Text style={styles.textButtonLabel}>{copy.answerInstead}</Text>
    </TouchableOpacity>
  ) : null;

  return (
    <Card pad={14} testID="ask-action-card" style={styles.card}>
      {howto && <Text style={styles.title}>{copy.howtoTitle}</Text>}
      {/* One proposal: title · job · words · honesty · Start + Answer instead.
          Several: one bordered row per workflow (spoken order, schedule
          last), then the honesty line and Answer instead once. */}
      <View style={multi ? styles.rows : undefined}>
        {list.map((p) => (
          <ProposalRow
            key={p.capabilityId}
            turnKey={turnKey}
            proposal={p}
            action={action}
            copy={copy}
            styles={styles}
            bordered={multi}
            beforeButtons={multi ? null : honestyPill}
            besideStart={multi ? null : answerButton}
          />
        ))}
      </View>
      {multi && honestyPill}
      {multi && answerButton}
    </Card>
  );
}

function statusText(o: AskActionOutcome, label: string, copy: AskCopy): string {
  if (o.kind === 'saved') return o.label ? copy.saved(o.label) : copy.savedNoLabel;
  if (o.kind === 'nothing') return copy.nothing;
  return copy.opened(label);
}

function ProposalRow({ turnKey, proposal, action, copy, styles, bordered, beforeButtons, besideStart }: {
  turnKey: string;
  proposal: AskActionProposal;
  action: UseAskAction;
  copy: AskCopy;
  styles: Styles;
  bordered: boolean;
  beforeButtons: React.ReactNode;
  besideStart: React.ReactNode;
}) {
  const { colors } = useTheme();
  const { isDesktop } = useResponsiveLayout();
  const p = action.live(proposal);
  const label = copy.label(p);
  const outcome = action.outcome(turnKey, proposal);
  const pickRoute = p.capabilityId === 'schedule' && p.schedule?.kind === 'pick' ? p.schedule : null;
  const blocked = !p.precondition.ok && p.precondition.kind === 'no_estimate';
  const blockedReason = !p.precondition.ok && blocked ? p.precondition.message : '';
  // A new project / lead has no job to pick: /copilot opens it with no picker.
  const jobLine = p.projectName ? copy.forJob(p.projectName) : needsJobPick(p) ? copy.pickJobNext : null;

  return (
    <View style={bordered ? styles.row : styles.single}>
      <Text style={styles.title}>{label}</Text>
      {!!jobLine && (
        <View style={styles.jobLine}>
          <Briefcase size={14} color={colors.textSecondary} strokeWidth={2} />
          <Text style={styles.jobText} numberOfLines={1}>{jobLine}</Text>
        </View>
      )}
      {!!p.seed && (
        <Text style={styles.seed} numberOfLines={2}>{'“'}{p.seed}{'”'}</Text>
      )}
      {action.leavesAsk(p) && !outcome && <Text style={styles.note}>{copy.scheduleLeaves}</Text>}
      {beforeButtons}

      {pickRoute && !outcome ? (
        <View style={styles.pickList}>
          <Text style={styles.pickTitle}>{copy.pickTitle}</Text>
          {pickRoute.candidates.map((c) => (
            <TouchableOpacity
              key={c.id}
              accessibilityRole="button"
              accessibilityLabel={copy.startA11y(`${label}, ${c.name}`)}
              onPress={() => action.pick(turnKey, proposal, c.id)}
              style={styles.pickRow}
              activeOpacity={0.8}
              testID={`ask-action-pick-${c.id}`}
            >
              <Text style={styles.pickName} numberOfLines={1}>{c.name}</Text>
              <ChevronRight size={16} color={colors.textMuted} strokeWidth={1.9} />
            </TouchableOpacity>
          ))}
        </View>
      ) : outcome ? (
        <View style={styles.statusRow}>
          <Text style={styles.status} testID="ask-action-status">{statusText(outcome, label, copy)}</Text>
          {outcome.kind === 'saved' && outcome.href ? (
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => action.openHref(outcome.href!)}
              hitSlop={8}
              testID="ask-action-open-result"
            >
              <Text style={styles.textButtonLabel}>{copy.openResult}</Text>
            </TouchableOpacity>
          ) : outcome.kind === 'nothing' ? (
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => action.start(turnKey, proposal)}
              hitSlop={8}
              testID="ask-action-start"
            >
              <Text style={styles.textButtonLabel}>{copy.openAgain}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : (
        <View style={[styles.buttons, isDesktop && styles.buttonsDesktop]}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={copy.startA11y(label)}
            accessibilityHint={blocked ? blockedReason : undefined}
            accessibilityState={{ disabled: blocked }}
            disabled={blocked}
            onPress={() => action.start(turnKey, proposal)}
            style={[styles.startBtn, isDesktop && styles.startBtnDesktop, blocked && styles.startBtnBlocked]}
            activeOpacity={0.9}
            testID="ask-action-start"
          >
            <Text style={[styles.startLabel, blocked && styles.startLabelBlocked]}>{copy.start}</Text>
          </TouchableOpacity>
          {!blocked && besideStart}
          {blocked && (
            <View style={styles.blockedWrap}>
              <Text style={styles.blockedText}>{blockedReason}</Text>
              {!!p.projectId && (
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={() => action.startEstimateFirst(turnKey, proposal)}
                  hitSlop={8}
                  testID="ask-action-estimate-first"
                >
                  <Text style={styles.textButtonLabel}>{copy.estimateFirst}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          {blocked && besideStart}
        </View>
      )}
      {(pickRoute && !outcome) || outcome ? besideStart : null}
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function makeStyles(t: ThemeColors) {
  return StyleSheet.create({
    card: { gap: Tokens.spacing.sm, alignSelf: 'stretch' },
    rows: { gap: 8 },
    single: { gap: 6 },
    row: { gap: 6, borderWidth: 1, borderColor: t.line, borderRadius: Tokens.radius.lg, padding: 12 },
    title: { ...Type.subheadEmphasized, color: t.text },
    jobLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    jobText: { ...Type.footnote, color: t.textSecondary, flexShrink: 1 },
    seed: { ...Type.footnote, color: t.textMuted },
    note: { ...Type.footnote, color: t.textSecondary },
    honestyPill: { alignSelf: 'flex-start', backgroundColor: t.neutralSoft, borderRadius: Tokens.radius.full, paddingHorizontal: 10, paddingVertical: 4 },
    honestyText: { ...Type.caption2, color: t.textSecondary },
    buttons: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Tokens.spacing.sm, marginTop: 4 },
    buttonsDesktop: { alignSelf: 'flex-start' },
    startBtn: {
      minHeight: 44, minWidth: Layout.button.minWidth.sm, paddingHorizontal: Tokens.spacing.lg,
      alignItems: 'center', justifyContent: 'center', borderRadius: Tokens.radius.lg, backgroundColor: t.accentFill,
    },
    startBtnDesktop: { minWidth: Layout.button.minWidth.md },
    startBtnBlocked: { backgroundColor: t.neutralSoft },
    startLabel: { ...Type.subheadEmphasized, color: Colors.textOnAccent },
    startLabelBlocked: { color: t.textSecondary },
    blockedWrap: { flex: 1, minWidth: 160, gap: 4 },
    blockedText: { ...Type.footnote, color: t.textSecondary },
    textButton: { alignSelf: 'flex-start', paddingVertical: 4, minHeight: 32, justifyContent: 'center' },
    textButtonLabel: { ...Type.subheadEmphasized, color: t.accentLabel, ...(Platform.OS === 'web' ? { cursor: 'pointer' as never } : null) },
    statusRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Tokens.spacing.sm, marginTop: 4 },
    status: { ...Type.footnote, color: t.text, flexShrink: 1 },
    pickList: { gap: 6, marginTop: 4 },
    pickTitle: { ...Type.footnote, color: t.textSecondary },
    pickRow: {
      flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.sm, minHeight: 44,
      paddingHorizontal: 12, borderWidth: 1, borderColor: t.line, borderRadius: Tokens.radius.md,
    },
    pickName: { ...Type.subheadEmphasized, color: t.text, flex: 1 },
  });
}
