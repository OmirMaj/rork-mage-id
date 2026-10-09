// components/firstJob/FirstJobViews.tsx — the drawn parts of "Your First Job":
// the progress ring, the stage pills, a step on the path, the opening
// question, the one-row hidden state and the finish state. No rules live
// here: utils/firstJobPath.ts decides, components/FirstJobPath.tsx wires, and
// these draw. Every string comes from hooks/useFirstJobCopy.
//
// MOTION. React Native's Animated only (the app's motion core in
// components/ui/motion; react-native-reanimated is stubbed out of this app and
// must not be imported). Three things move, each only for a step he just did:
// the check lands on the node (the motion kit's check beat), the line below it
// fills, and the step that opens next settles in (layoutNext, by the host).
// Under Reduce Motion nothing travels: values are set, not animated.
import React, { memo, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import {
  CalendarDays, Check, ChevronRight, HardHat, Lock, Minus, MoreHorizontal, Receipt, Tag,
} from 'lucide-react-native';
import { Colors, type ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Type } from '@/constants/typography';
import { Motion, Tokens } from '@/constants/designTokens';
import { motionCurve, nativeDriver, useReducedMotion } from '@/components/ui/motion';
import { useCheckBeat } from '@/components/motion/kit';
import type { FirstJobCopy, FirstJobCtaKind, FirstJobRowState } from '@/hooks/useFirstJobCopy';
import {
  ANSWERS, FINISH_STAGES,
  type FirstJobAnswer, type FirstJobCost, type FirstJobFinishStage, type FirstJobPlan,
  type FirstJobStageView, type FirstJobStepView,
} from '@/utils/firstJobPath';

const NODE = 26;
const RAIL = 3;
const STEP_GAP = 8;
const NODE_TOP = 10;

// ── Progress ring ───────────────────────────────────────────────────────────

export const ProgressRing = memo(function ProgressRing({ done, total, copy }: { done: number; total: number; copy: FirstJobCopy }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const size = 56;
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0;
  return (
    <View
      style={styles.ring}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={copy.ringA11y(done, total)}
      accessibilityValue={{ min: 0, max: total, now: done }}
      testID="first-job-ring"
    >
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.line} strokeWidth={stroke} fill="none" />
        {frac > 0 ? (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={colors.accent}
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${c} ${c}`}
            strokeDashoffset={c * (1 - frac)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ) : null}
      </Svg>
      <View style={styles.ringCenter} pointerEvents="none">
        <Text style={styles.ringText} testID="first-job-ring-text">{copy.ringText(done, total)}</Text>
      </View>
    </View>
  );
});

// ── Stage pills ─────────────────────────────────────────────────────────────

export const StagePills = memo(function StagePills({ stages, copy }: { stages: readonly FirstJobStageView[]; copy: FirstJobCopy }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.stages} testID="first-job-stages">
      {stages.map((s) => (
        <View
          key={s.stage}
          style={[styles.stage, s.state === 'now' && styles.stageNow, s.state === 'done' && styles.stageDone]}
          testID={`first-job-stage-${s.stage}-${s.state}`}
        >
          {s.state === 'done' ? <Check size={11} color={colors.accentLabel} strokeWidth={2.6} /> : null}
          <Text
            numberOfLines={1}
            style={[styles.stageText, s.state === 'now' && styles.stageTextNow, s.state === 'done' && styles.stageTextDone]}
          >
            {copy.stageLabel(s.stage)}
          </Text>
        </View>
      ))}
    </View>
  );
});

// ── One step on the path ────────────────────────────────────────────────────

/** The check that lands when Home sees a step he just did. At rest it has no style. */
function DoneCheck({ live, delayMs }: { live: boolean; delayMs: number }) {
  const beat = useCheckBeat('done', delayMs, live);
  return (
    <Animated.View style={beat}>
      <Check size={15} color={Colors.textOnAccent} strokeWidth={3} />
    </Animated.View>
  );
}

/** The piece of line under a node. It fills when the step above it is done. */
function PathLine({ filled, live, delayMs }: { filled: boolean; live: boolean; delayMs: number }) {
  const styles = useThemedStyles(makeStyles);
  const reduce = useReducedMotion();
  const v = useState(() => new Animated.Value(filled ? 1 : 0))[0];
  const was = useRef(filled);
  useEffect(() => {
    if (was.current === filled) return;
    was.current = filled;
    if (!filled || !live || reduce) { v.setValue(filled ? 1 : 0); return; }
    const run = Animated.timing(v, {
      toValue: 1,
      duration: Motion.duration.glide,
      delay: delayMs,
      easing: motionCurve.out,
      useNativeDriver: nativeDriver,
    });
    run.start();
    // Stopped early (another step ticked, or the card went away): the line
    // must never be left part-filled under a step that is done.
    return () => { run.stop(); v.setValue(1); };
  }, [filled, live, reduce, delayMs, v]);
  return (
    <View style={styles.lineTrack} pointerEvents="none">
      <Animated.View style={[styles.lineFill, { transform: [{ scaleY: v }] }]} />
    </View>
  );
}

export interface StepRowProps {
  step: FirstJobStepView;
  total: number;
  last: boolean;
  /** The line under this node is filled (this step and every one above it is done). */
  lineFilled: boolean;
  /** This step was seen done just now: the check and the line animate. */
  live: boolean;
  delayMs: number;
  isNext: boolean;
  copy: FirstJobCopy;
  cost: FirstJobCost;
  /** The collapsed row shows a lock and the plan name when the step's own screen is paid. */
  tagPlan: FirstJobPlan | null;
  ctaKind: FirstJobCtaKind;
  /** Extra plain sentences shown above the buttons, in order. */
  notes: readonly string[];
  showMe: 'offer' | 'practised' | null;
  showStripe: boolean;
  onToggle: () => void;
  onPrimary: () => void;
  onSkip: () => void;
  onShowMe: () => void;
  onStripe: () => void;
}

export const StepRow = memo(function StepRow(p: StepRowProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { step, copy } = p;
  const done = step.status === 'done';
  const skipped = step.status === 'skipped';
  const state: FirstJobRowState = done ? 'done' : skipped ? 'skipped' : !step.known ? 'checking' : p.isNext ? 'next' : 'todo';
  const locked = p.cost.kind === 'locked';
  return (
    <View style={styles.step} testID={`first-job-step-${step.id}`}>
      {!p.last ? <PathLine filled={p.lineFilled} live={p.live} delayMs={p.delayMs} /> : null}
      <View
        style={[styles.node, done && styles.nodeDone, step.open && !done && styles.nodeOpen]}
        testID={`first-job-node-${step.id}-${step.status}`}
      >
        {done ? <DoneCheck key={p.live ? 'live' : 'seen'} live={p.live} delayMs={p.delayMs} /> : null}
        {skipped ? <Minus size={13} color={colors.textMuted} strokeWidth={2.4} /> : null}
      </View>
      <View style={[styles.stepCard, step.open && styles.stepCardOpen]}>
        <TouchableOpacity
          style={styles.stepHead}
          onPress={p.onToggle}
          disabled={done}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={copy.stepA11y(step.id, step.position, p.total, state)}
          accessibilityState={{ expanded: step.open, disabled: done }}
          testID={`first-job-step-${step.id}-head`}
        >
          <Text style={[styles.stepName, (done || skipped) && styles.stepNameQuiet]} numberOfLines={2}>
            {copy.stepLabel(step.id)}
          </Text>
          {skipped ? <Text style={styles.tagText} testID={`first-job-step-${step.id}-skipped`}>{copy.skippedTagLabel}</Text> : null}
          {!done && !skipped && !step.known ? (
            <Text style={styles.tagText} testID={`first-job-step-${step.id}-checking`}>{copy.checkingTagLabel}</Text>
          ) : null}
          {!done && !skipped && step.known && p.tagPlan ? (
            <View
              style={styles.planTag}
              accessible
              accessibilityLabel={copy.planA11y(p.tagPlan)}
              testID={`first-job-step-${step.id}-plan`}
            >
              <Lock size={11} color={colors.textMuted} strokeWidth={2.2} />
              <Text style={styles.tagText}>{copy.planLabel(p.tagPlan)}</Text>
            </View>
          ) : null}
        </TouchableOpacity>
        {step.open && !done ? (
          <View style={styles.stepBody} testID={`first-job-step-${step.id}-body`}>
            <Text style={styles.stepWhy}>{copy.stepBody(step.id)}</Text>
            {p.notes.map((n) => <Text key={n} style={styles.stepNote}>{n}</Text>)}
            <View style={styles.actions}>
              <TouchableOpacity
                style={styles.primary}
                onPress={p.onPrimary}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={locked && p.cost.kind === 'locked'
                  ? `${copy.ctaLabel(step.id, p.ctaKind)}. ${copy.planA11y(p.cost.plan)}`
                  : copy.ctaLabel(step.id, p.ctaKind)}
                testID={`first-job-step-${step.id}-go`}
              >
                {locked ? <Lock size={14} color={Colors.textOnAccent} strokeWidth={2.2} /> : null}
                <Text style={styles.primaryText}>{copy.ctaLabel(step.id, p.ctaKind)}</Text>
              </TouchableOpacity>
              {p.showMe === 'offer' ? (
                <TouchableOpacity
                  style={styles.ghost}
                  onPress={p.onShowMe}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={copy.showMeA11y}
                  testID={`first-job-step-${step.id}-show-me`}
                >
                  <Text style={styles.ghostText}>{copy.showMeLabel}</Text>
                </TouchableOpacity>
              ) : null}
              <View style={styles.spacer} />
              {!skipped ? (
                <TouchableOpacity
                  style={styles.ghost}
                  onPress={p.onSkip}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  testID={`first-job-step-${step.id}-skip`}
                >
                  <Text style={styles.ghostTextQuiet}>{copy.skipLabel}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            {p.showMe === 'practised' ? (
              <Text style={styles.practised} testID={`first-job-step-${step.id}-practised`}>{copy.practisedLabel}</Text>
            ) : null}
            {p.showStripe ? (
              <View style={styles.stripe} testID="first-job-stripe-note">
                <Text style={styles.stepNote}>{copy.stripeNote}</Text>
                <TouchableOpacity
                  style={styles.inlineLink}
                  onPress={p.onStripe}
                  activeOpacity={0.7}
                  accessibilityRole="link"
                  testID="first-job-stripe-link"
                >
                  <Text style={styles.ghostText}>{copy.stripeLinkLabel}</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
});

// ── The opening question ────────────────────────────────────────────────────

const ANSWER_ICON: Record<Exclude<FirstJobAnswer, 'unsure'>, React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>> = {
  price: Tag, schedule: CalendarDays, bill: Receipt, site: HardHat,
};

export const QuestionView = memo(function QuestionView({ copy, onAnswer }: { copy: FirstJobCopy; onAnswer: (a: FirstJobAnswer) => void }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.question} testID="first-job-question">
      <Text style={styles.questionHeading}>{copy.questionLabel}</Text>
      <Text style={styles.stepWhy}>{copy.questionBody}</Text>
      <View style={styles.choices}>
        {ANSWERS.filter((a): a is Exclude<FirstJobAnswer, 'unsure'> => a !== 'unsure').map((a) => {
          const Icon = ANSWER_ICON[a];
          return (
            <TouchableOpacity
              key={a}
              style={styles.choice}
              onPress={() => onAnswer(a)}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={`${copy.answerLabel(a)}. ${copy.answerSub(a)}`}
              testID={`first-job-answer-${a}`}
            >
              <Icon size={22} color={colors.accent} strokeWidth={1.8} />
              <View style={styles.choiceWords}>
                <Text style={styles.choiceName}>{copy.answerLabel(a)}</Text>
                <Text style={styles.choiceSub}>{copy.answerSub(a)}</Text>
              </View>
              <ChevronRight size={16} color={colors.textMuted} strokeWidth={2} />
            </TouchableOpacity>
          );
        })}
      </View>
      <TouchableOpacity
        style={styles.unsure}
        onPress={() => onAnswer('unsure')}
        activeOpacity={0.7}
        accessibilityRole="button"
        testID="first-job-answer-unsure"
      >
        <Text style={styles.ghostText}>{copy.answerLabel('unsure')}</Text>
      </TouchableOpacity>
    </View>
  );
});

// ── Hidden: one small row ───────────────────────────────────────────────────

export const HiddenRow = memo(function HiddenRow({ done, total, copy, onOpen }: { done: number; total: number; copy: FirstJobCopy; onOpen: () => void }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <TouchableOpacity
      style={styles.hiddenRow}
      onPress={onOpen}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={copy.hiddenRowLabel(done, total)}
      accessibilityHint={copy.hiddenRowA11y}
      testID="first-job-hidden-row"
    >
      <Text style={styles.hiddenRowText} numberOfLines={1}>{copy.hiddenRowLabel(done, total)}</Text>
      <ChevronRight size={15} color={colors.textMuted} strokeWidth={2} />
    </TouchableOpacity>
  );
});

// ── Finish ──────────────────────────────────────────────────────────────────

export const FinishView = memo(function FinishView({ copy, onStage, onClose }: {
  copy: FirstJobCopy;
  onStage: (s: FirstJobFinishStage) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.finish} testID="first-job-finish">
      <View style={styles.finishMark}>
        <Check size={26} color={colors.accentLabel} strokeWidth={2.6} />
      </View>
      <Text style={styles.questionHeading}>{copy.finishLabel}</Text>
      <Text style={[styles.stepWhy, styles.finishWhy]}>{copy.finishBody}</Text>
      <View style={styles.finishList}>
        {FINISH_STAGES.map((s, i) => (
          <TouchableOpacity
            key={s}
            style={styles.finishRow}
            onPress={() => onStage(s)}
            activeOpacity={0.85}
            accessibilityRole="link"
            accessibilityLabel={`${copy.stageLabel(s)}. ${copy.finishStageSub(s)}`}
            testID={`first-job-finish-stage-${s}`}
          >
            <View style={styles.finishNum}><Text style={styles.finishNumText}>{i + 1}</Text></View>
            <View style={styles.choiceWords}>
              <Text style={styles.choiceName}>{copy.stageLabel(s)}</Text>
              <Text style={styles.choiceSub}>{copy.finishStageSub(s)}</Text>
            </View>
            <ChevronRight size={16} color={colors.textMuted} strokeWidth={2} />
          </TouchableOpacity>
        ))}
      </View>
      <TouchableOpacity
        style={styles.unsure}
        onPress={onClose}
        activeOpacity={0.7}
        accessibilityRole="button"
        testID="first-job-finish-done"
      >
        <Text style={styles.ghostText}>{copy.finishCloseLabel}</Text>
      </TouchableOpacity>
    </View>
  );
});

// ── The header's menu button ────────────────────────────────────────────────

export const MoreButton = memo(function MoreButton({ copy, open, onPress }: { copy: FirstJobCopy; open: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <TouchableOpacity
      style={styles.iconBtn}
      onPress={onPress}
      hitSlop={8}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={copy.moreLabel}
      accessibilityState={{ expanded: open }}
      testID="first-job-more"
    >
      <MoreHorizontal size={18} color={colors.textMuted} strokeWidth={2} />
    </TouchableOpacity>
  );
});

export const makeStyles = (t: ThemeColors) => StyleSheet.create({
  // ring
  ring: { width: 56, height: 56 },
  ringCenter: { ...StyleSheet.absoluteFillObject, alignItems: 'center' as const, justifyContent: 'center' as const },
  ringText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: t.text },

  // stage pills
  stages: { flexDirection: 'row' as const, gap: 6 },
  stage: {
    flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 3,
    paddingVertical: 6, paddingHorizontal: 2,
    borderRadius: Tokens.radius.full, borderWidth: 1.5, borderColor: t.line,
  },
  stageNow: { borderColor: t.accent },
  stageDone: { borderColor: t.accentSoft, backgroundColor: t.accentSoft },
  stageText: { fontSize: Type.caption2.fontSize, fontWeight: '600' as const, color: t.textMuted },
  stageTextNow: { color: t.accentLabel },
  stageTextDone: { color: t.accentLabel },

  // path
  step: { paddingLeft: NODE + 10, marginBottom: STEP_GAP },
  lineTrack: {
    position: 'absolute' as const,
    left: (NODE - RAIL) / 2,
    top: NODE_TOP + NODE,
    // Reaches the top of the next node: the gap between rows plus that node's own offset.
    bottom: -(STEP_GAP + NODE_TOP),
    width: RAIL, borderRadius: RAIL / 2,
    backgroundColor: t.line,
    overflow: 'hidden' as const,
  },
  lineFill: { flex: 1, backgroundColor: t.accent, transformOrigin: 'top' },
  node: {
    position: 'absolute' as const, left: 0, top: NODE_TOP,
    width: NODE, height: NODE, borderRadius: NODE / 2,
    borderWidth: 2, borderColor: t.line, backgroundColor: t.bg,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  nodeDone: { backgroundColor: t.accentFill, borderColor: t.accentFill },
  nodeOpen: { borderColor: t.accent },
  stepCard: {
    borderRadius: Tokens.radius.card, borderWidth: 1.5, borderColor: t.line,
    backgroundColor: t.surfaceAlt,
    ...Tokens.continuousCorners,
  },
  stepCardOpen: { borderColor: t.accent },
  stepHead: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8,
    minHeight: Tokens.touchTarget.min, paddingHorizontal: 12, paddingVertical: 8,
  },
  stepName: { flex: 1, fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: t.text },
  stepNameQuiet: { color: t.textMuted, fontWeight: '500' as const },
  tagText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: t.textMuted },
  planTag: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
  stepBody: { paddingHorizontal: 12, paddingBottom: 10, gap: 8 },
  stepWhy: { fontSize: Type.bodyCompact.fontSize, lineHeight: Type.bodyCompact.lineHeight, color: t.textSecondary },
  stepNote: { fontSize: Type.footnote.fontSize, lineHeight: Type.footnote.lineHeight, color: t.textMuted },
  actions: { flexDirection: 'row' as const, alignItems: 'center' as const, flexWrap: 'wrap' as const, gap: 4 },
  primary: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6,
    minHeight: Tokens.touchTarget.min, paddingHorizontal: 16,
    borderRadius: Tokens.radius.card, backgroundColor: t.accentFill,
    ...Tokens.continuousCorners,
  },
  primaryText: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: Colors.textOnAccent },
  ghost: { minHeight: Tokens.touchTarget.min, paddingHorizontal: 10, justifyContent: 'center' as const },
  ghostText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: t.accentLabel },
  ghostTextQuiet: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: t.textMuted },
  spacer: { flex: 1 },
  practised: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: t.textMuted },
  stripe: { gap: 0 },
  inlineLink: { alignSelf: 'flex-start' as const, minHeight: Tokens.touchTarget.min, justifyContent: 'center' as const },

  // question + finish
  question: { gap: 8 },
  questionHeading: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: t.text, letterSpacing: -0.2 },
  choices: { gap: 8, marginTop: 4 },
  choice: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12,
    minHeight: Tokens.touchTarget.large, paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: Tokens.radius.card, borderWidth: 1.5, borderColor: t.line,
    backgroundColor: t.surfaceAlt,
    ...Tokens.continuousCorners,
  },
  choiceWords: { flex: 1 },
  choiceName: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: t.text },
  choiceSub: { fontSize: Type.footnote.fontSize, color: t.textMuted, marginTop: 1 },
  unsure: { alignSelf: 'center' as const, minHeight: Tokens.touchTarget.min, justifyContent: 'center' as const, paddingHorizontal: 12 },
  finish: { alignItems: 'center' as const, gap: 6 },
  finishMark: {
    width: 52, height: 52, borderRadius: Tokens.radius.full, backgroundColor: t.accentSoft,
    alignItems: 'center' as const, justifyContent: 'center' as const, marginBottom: 4,
  },
  finishWhy: { textAlign: 'center' as const },
  finishList: { alignSelf: 'stretch' as const, gap: 8, marginTop: 8 },
  finishRow: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12,
    minHeight: Tokens.touchTarget.large, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: Tokens.radius.card, borderWidth: 1.5, borderColor: t.line,
    backgroundColor: t.surfaceAlt,
    ...Tokens.continuousCorners,
  },
  finishNum: {
    width: 24, height: 24, borderRadius: Tokens.radius.full, borderWidth: 1.5, borderColor: t.accent,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  finishNumText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: t.accentLabel },

  // hidden row
  hiddenRow: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8,
    minHeight: Tokens.touchTarget.min, paddingHorizontal: 14,
    marginHorizontal: 16, marginBottom: 12,
    borderRadius: Tokens.radius.full, borderWidth: 1, borderColor: t.line,
    backgroundColor: t.surfaceAlt,
  },
  hiddenRowText: { flex: 1, fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.textSecondary },

  iconBtn: {
    width: 32, height: 32, borderRadius: Tokens.radius.sm,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
});
