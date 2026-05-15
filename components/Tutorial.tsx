// In-app interactive tutorial — a guided walkthrough that actually gets
// users to tap, swipe and try things instead of just reading text.
//
// Triggered from Settings → "Show Tutorial". Also auto-opens once after
// first login via AsyncStorage key `mageid_tutorial_seen_v1`. Each step
// renders an interactive demo (tappable mock UI, drag target, quiz card,
// or a "Try it now" deep-link into the real app). The user has to perform
// the interaction to advance — that's the "interactive" part. Skip/close
// still works via the top-right X.
//
// Completing or skipping both persist the seen flag so we don't nag the
// user on every launch.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Animated, Easing, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  X, ChevronLeft, ChevronRight, Home, FileText, Calendar, DollarSign,
  Users, Sparkles, Gavel, Wrench, Camera, ClipboardCheck, Plus, CheckCircle2,
  LayoutDashboard, Target, ArrowRight, ShoppingCart, PenTool, BookOpen,
  Pencil, ScrollText, Globe, Bell, Footprints,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';

// Bumped to v2 so existing users see the post-Wave-5 walkthrough
// (contracts, AI selections, closeout binder, photo markup, AI daily
// digest, handover checklist, multi-language portal, etc.). The old
// `_v1` key is left in AsyncStorage but ignored — no migration needed.
export const TUTORIAL_SEEN_KEY = 'mageid_tutorial_seen_v2';

// ── Step definitions ───────────────────────────────────────────────────
// Each step has copy + an interactive demo. The demo component receives
// an onComplete callback that unlocks the "Next" button.

type DemoProps = { onComplete: () => void; completed: boolean };

interface TutorialStep {
  title: string;
  body: string;
  Icon: typeof Home;
  // Optional deep link — shown as a secondary "Try it live" button.
  deepLink?: string;
  // Interactive demo rendered above the body text.
  Demo: React.ComponentType<DemoProps>;
  // Instruction shown when the demo is not yet complete.
  instruction: string;
}

// --- Demos ------------------------------------------------------------

// Tap the "+" to create a project.
const TapPlusDemo: React.FC<DemoProps> = ({ onComplete, completed }) => {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (completed) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
      Animated.timing(pulse, { toValue: 0, duration: 800, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse, completed]);
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.9] });

  return (
    <View style={demoStyles.mockScreen}>
      <View style={demoStyles.mockHeader}>
        <Text style={demoStyles.mockHeaderText}>Projects</Text>
      </View>
      <View style={demoStyles.mockBody}>
        <View style={demoStyles.mockProjectRow}><Text style={demoStyles.mockProjectText}>Kitchen Remodel</Text></View>
        <View style={demoStyles.mockProjectRow}><Text style={demoStyles.mockProjectText}>Basement Finish</Text></View>
        <View style={demoStyles.mockEmpty}>
          <Text style={demoStyles.mockEmptyText}>Tap + to add a new project</Text>
        </View>
      </View>
      <View style={demoStyles.fabContainer}>
        {!completed && (
          <Animated.View
            style={[demoStyles.fabPulse, { transform: [{ scale }], opacity }]}
            pointerEvents="none"
          />
        )}
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => {
            if (!completed) {
              if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              onComplete();
            }
          }}
          style={[demoStyles.fab, completed && demoStyles.fabComplete]}
          testID="tutorial-demo-plus"
        >
          {completed ? <CheckCircle2 size={22} color="#FFF" /> : <Plus size={22} color="#FFF" />}
        </TouchableOpacity>
      </View>
    </View>
  );
};

// Generic "tap the highlighted thing" demo — used for tab selection.
function buildTapTarget(targetIdx: number, items: { label: string; Icon: typeof Home }[]): React.FC<DemoProps> {
  const Comp: React.FC<DemoProps> = ({ onComplete, completed }) => {
    const pulse = useRef(new Animated.Value(0)).current;
    useEffect(() => {
      if (completed) return;
      const loop = Animated.loop(Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
      ]));
      loop.start();
      return () => loop.stop();
    }, [pulse, completed]);
    const pulseOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.7] });

    return (
      <View style={demoStyles.mockScreen}>
        <View style={demoStyles.tabBar}>
          {items.map((item, i) => {
            const isTarget = i === targetIdx;
            const done = completed && isTarget;
            const Icon = item.Icon;
            return (
              <TouchableOpacity
                key={item.label}
                disabled={!isTarget || completed}
                onPress={() => {
                  if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  onComplete();
                }}
                activeOpacity={0.8}
                style={demoStyles.tabItem}
                testID={`tutorial-tap-${item.label.toLowerCase()}`}
              >
                {isTarget && !completed && (
                  <Animated.View style={[demoStyles.tabHighlight, { opacity: pulseOpacity }]} />
                )}
                <Icon size={18} color={done ? Colors.success : isTarget ? Colors.primary : Colors.textMuted} />
                <Text style={[
                  demoStyles.tabLabel,
                  done && { color: Colors.success },
                  isTarget && !done && { color: Colors.primary, fontWeight: '700' },
                ]}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={demoStyles.mockBody}>
          <View style={demoStyles.hintRow}>
            <Target size={14} color={Colors.primary} />
            <Text style={demoStyles.hintText}>
              {completed ? 'Nice — that\'s how you switch tabs.' : `Tap the "${items[targetIdx].label}" tab`}
            </Text>
          </View>
        </View>
      </View>
    );
  };
  return Comp;
}

// Swipe / drag-style demo — a mock Gantt bar. User drags it to fill the timeline.
const GanttDragDemo: React.FC<DemoProps> = ({ onComplete, completed }) => {
  const [progress, setProgress] = useState(0);
  const fill = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fill, { toValue: progress, duration: 180, useNativeDriver: false }).start();
    if (progress >= 1 && !completed) {
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onComplete();
    }
  }, [progress, fill, completed, onComplete]);

  const width = fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <View style={demoStyles.mockScreen}>
      <Text style={demoStyles.mockLabel}>Mock Schedule — tap the segments to extend the bar</Text>
      <View style={demoStyles.ganttTrack}>
        <Animated.View style={[demoStyles.ganttFill, { width }]} />
        <View style={demoStyles.ganttSegments}>
          {[0, 1, 2, 3].map((i) => (
            <TouchableOpacity
              key={i}
              disabled={completed}
              style={demoStyles.ganttSegment}
              onPress={() => {
                const nextProgress = Math.min(1, (i + 1) / 4);
                if (nextProgress > progress) {
                  setProgress(nextProgress);
                  if (Platform.OS !== 'web') void Haptics.selectionAsync();
                }
              }}
              activeOpacity={0.6}
              testID={`tutorial-gantt-${i}`}
            />
          ))}
        </View>
      </View>
      <View style={demoStyles.ganttLabels}>
        <Text style={demoStyles.ganttLabel}>Demo</Text>
        <Text style={demoStyles.ganttLabel}>Frame</Text>
        <Text style={demoStyles.ganttLabel}>Finish</Text>
        <Text style={demoStyles.ganttLabel}>Punch</Text>
      </View>
    </View>
  );
};

// Quiz-style: pick the correct option.
function buildQuizDemo(question: string, options: string[], correctIdx: number): React.FC<DemoProps> {
  const Comp: React.FC<DemoProps> = ({ onComplete, completed }) => {
    const [picked, setPicked] = useState<number | null>(null);

    return (
      <View style={demoStyles.mockScreen}>
        <Text style={demoStyles.quizQuestion}>{question}</Text>
        <View style={{ gap: 8 }}>
          {options.map((o, i) => {
            const isPicked = picked === i;
            const isCorrect = completed && i === correctIdx;
            const isWrong = isPicked && i !== correctIdx && picked !== null && !completed;
            return (
              <TouchableOpacity
                key={o}
                disabled={completed}
                onPress={() => {
                  setPicked(i);
                  if (i === correctIdx) {
                    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    onComplete();
                  } else {
                    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                  }
                }}
                style={[
                  demoStyles.quizOption,
                  isCorrect && demoStyles.quizOptionCorrect,
                  isWrong && demoStyles.quizOptionWrong,
                ]}
                activeOpacity={0.8}
                testID={`tutorial-quiz-${i}`}
              >
                <Text style={[
                  demoStyles.quizOptionText,
                  isCorrect && { color: Colors.success, fontWeight: '700' },
                  isWrong && { color: Colors.error },
                ]}>
                  {o}
                </Text>
                {isCorrect ? <CheckCircle2 size={16} color={Colors.success} /> : null}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  };
  return Comp;
}

// Success checkbox — auto-completes on tap. Used for the final "ready" step.
const TapToFinishDemo: React.FC<DemoProps> = ({ onComplete, completed }) => (
  <View style={demoStyles.mockScreen}>
    <TouchableOpacity
      onPress={() => {
        if (!completed) {
          if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          onComplete();
        }
      }}
      activeOpacity={0.85}
      style={[demoStyles.finishBtn, completed && demoStyles.finishBtnDone]}
      testID="tutorial-finish-demo"
    >
      {completed ? (
        <>
          <CheckCircle2 size={28} color="#FFF" />
          <Text style={demoStyles.finishBtnText}>All set!</Text>
        </>
      ) : (
        <>
          <Wrench size={24} color="#FFF" />
          <Text style={demoStyles.finishBtnText}>I\u2019m ready</Text>
        </>
      )}
    </TouchableOpacity>
  </View>
);

// --- Steps ------------------------------------------------------------

const TAB_ITEMS = [
  { label: 'Summary', Icon: LayoutDashboard },
  { label: 'Projects', Icon: Home },
  { label: 'Discover', Icon: Sparkles },
  { label: 'Settings', Icon: Wrench },
];

// "Got it" — universal step demo for the trimmed tour. Replaces the
// previous quiz/mock-UI pattern that felt slideshow-y.
const GotItDemo = ({ onComplete, completed }: { onComplete: () => void; completed: boolean }) => (
  <View style={demoStyles.mockScreen}>
    <TouchableOpacity
      onPress={() => {
        if (!completed) {
          if (Platform.OS !== 'web') void Haptics.selectionAsync();
          onComplete();
        }
      }}
      activeOpacity={0.85}
      style={[demoStyles.finishBtn, completed && demoStyles.finishBtnDone]}
      testID="tutorial-got-it"
      accessibilityRole="button"
      accessibilityLabel={completed ? 'Step done' : 'Got it — continue to next step'}
    >
      {completed
        ? <CheckCircle2 size={28} color="#FFF" />
        : <Sparkles size={22} color="#FFF" />}
      <Text style={demoStyles.finishBtnText}>{completed ? 'Got it' : 'Got it — next'}</Text>
    </TouchableOpacity>
  </View>
);

const STEPS: TutorialStep[] = [
  // Tutorial v3 (May 2026): trimmed from 19 quiz-and-mock-UI steps down
  // to 5 lean orientation cards. Previous version was a feature catalog
  // disguised as a tutorial — every step had a quiz testing trivia. The
  // new version explains the happy-path lifecycle in plain English; each
  // step ends with a "Take me there now" deep-link that closes the modal
  // and drops the user into the real screen. Less reading, more doing.
  //
  // Three-layer guidance system shipped May 2026:
  //   1. OnboardingChecklist (home tab) — 5-step activation funnel,
  //      drives the user through their first project end-to-end.
  //   2. NextStepHero (home + summary + project-detail) — perpetual
  //      "what should I do next?" card based on live state.
  //   3. This Tutorial — one-time orientation, 5 steps, ~60 seconds.
  //
  // The buildQuizDemo/buildTapTarget/Gantt/TapPlus/TapToFinish mock
  // helpers above are retained as dead code for now; we may need their
  // patterns back if user testing shows the GotItDemo is too sparse.
  {
    title: 'The 60-second tour',
    body: 'MAGE ID handles the full lifecycle of a construction job from one screen: estimate the work, schedule the crew, log daily reports + photos, send invoices, collect closeout. This tour explains the shape. The home tab\u2019s checklist walks you through your first project step-by-step.',
    Icon: Home,
    instruction: 'Tap to start',
    Demo: GotItDemo,
  },
  {
    title: '1. Start with a project',
    body: 'Every job in MAGE is a project. Add the address, square footage, and one paragraph describing the scope. That paragraph is what AI uses to draft your estimate, schedule, and the homeowner portal copy.',
    Icon: Home,
    instruction: 'Got it? Let\u2019s look at the home tab',
    Demo: GotItDemo,
    deepLink: '/(tabs)/(home)',
  },
  {
    title: '2. AI does the estimating',
    body: 'Open your project and tap Estimator. Describe the job and the AI returns line items: materials with quantities + unit costs, labor, subs, permits, contingency. You review, edit, and add markup. A typical kitchen takes 3 minutes instead of 3 hours.',
    Icon: Sparkles,
    instruction: 'Take me to the AI estimator',
    Demo: GotItDemo,
    deepLink: '/(tabs)/discover/estimate',
  },
  {
    title: '3. Run the job in the field',
    body: 'On the jobsite: voice-dictate daily reports, snap photos with GPS + AI tagging, fire off RFIs to the architect, log change orders, track punch items. Everything syncs offline-first \u2014 works in a foundation pit with no signal, uploads when you get bars.',
    Icon: Camera,
    instruction: 'I\u2019m on it',
    Demo: GotItDemo,
  },
  {
    title: '4. Get paid + close out',
    body: 'Generate AIA G702/G703 pay applications or simple invoices, send the homeowner a Stripe payment link, track who has and hasn\u2019t paid. At closeout: punch list, lien waivers, warranty packet, and a homeowner binder with every paint color and appliance \u2014 auto-compiled and delivered to their portal forever.',
    Icon: DollarSign,
    instruction: 'You\u2019re ready \u2014 replay this tour anytime from Settings.',
    Demo: GotItDemo,
  },
];

// ── Main component ────────────────────────────────────────────────────

interface TutorialProps {
  visible: boolean;
  onClose: () => void;
  /** Optional substring matched (case-insensitive) against step titles
   *  on open. Lets callers deep-link to a specific feature explainer
   *  (e.g. from a FeatureExplainerSheet "Walk me through it" CTA).
   *  Falls back to step 0 if no match. */
  startAtStepKey?: string;
}

export default function Tutorial({ visible, onClose, startAtStepKey }: TutorialProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [index, setIndex] = useState(0);
  // Track which steps have had their demo completed so we can show a
  // green check on the progress indicator and enable Next.
  const [done, setDone] = useState<boolean[]>(() => STEPS.map(() => false));

  // Reset when the tutorial re-opens. If a startAtStepKey is supplied,
  // jump to the first step whose title contains it (case-insensitive)
  // so callers can deep-link to a relevant tour step.
  useEffect(() => {
    if (visible) {
      let startIdx = 0;
      if (startAtStepKey) {
        const needle = startAtStepKey.toLowerCase();
        const found = STEPS.findIndex(s => s.title.toLowerCase().includes(needle));
        if (found >= 0) startIdx = found;
      }
      setIndex(startIdx);
      setDone(STEPS.map(() => false));
    }
  }, [visible, startAtStepKey]);

  const step = STEPS[index];
  const isLast = index === STEPS.length - 1;
  const isFirst = index === 0;
  const currentDone = done[index];

  const markDone = useCallback(() => {
    setDone((prev) => {
      if (prev[index]) return prev;
      const next = [...prev];
      next[index] = true;
      return next;
    });
  }, [index]);

  const finish = useCallback(async () => {
    try { await AsyncStorage.setItem(TUTORIAL_SEEN_KEY, '1'); } catch {}
    setIndex(0);
    setDone(STEPS.map(() => false));
    onClose();
  }, [onClose]);

  const next = useCallback(() => {
    if (!currentDone) return;
    if (isLast) { void finish(); return; }
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIndex((i) => Math.min(STEPS.length - 1, i + 1));
  }, [isLast, finish, currentDone]);

  const back = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  const tryLive = useCallback(() => {
    if (!step.deepLink) return;
    void finish();
    setTimeout(() => router.push(step.deepLink as never), 150);
  }, [step.deepLink, finish, router]);

  const Demo = step.Demo;
  const StepIcon = step.Icon;

  const progress = useMemo(() => (index + 1) / STEPS.length, [index]);

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={finish}>
      <View style={[styles.container, { paddingTop: insets.top + 8, paddingBottom: insets.bottom }]}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={finish} style={styles.closeBtn} testID="tutorial-close" accessibilityRole="button" accessibilityLabel="Close"><X size={22} color={colors.textMuted} /></TouchableOpacity>
          <View style={styles.progressDots}>
            {STEPS.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.progressDot,
                  i === index && styles.progressDotActive,
                  done[i] && styles.progressDotDone,
                ]}
              />
            ))}
          </View>
          <Text style={styles.progressLabel}>{index + 1}/{STEPS.length}</Text>
        </View>

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.iconWrap}>
            <StepIcon size={28} color={colors.accent} />
          </View>
          <Text style={styles.title}>{step.title}</Text>
          <Text style={styles.body}>{step.body}</Text>

          <View style={styles.instructionRow}>
            {currentDone ? (
              <>
                <CheckCircle2 size={16} color={colors.success} />
                <Text style={[styles.instructionText, { color: Colors.success }]}>Nice work — tap Next to continue</Text>
              </>
            ) : (
              <>
                <Target size={16} color={colors.accent} />
                <Text style={styles.instructionText}>{step.instruction}</Text>
              </>
            )}
          </View>

          <Demo onComplete={markDone} completed={currentDone} />

          {step.deepLink ? (
            <TouchableOpacity
              onPress={tryLive}
              style={styles.deepLinkBtn}
              activeOpacity={0.8}
              testID="tutorial-deep-link"
            >
              <Text style={styles.deepLinkText}>Try it live in the app</Text>
              <ArrowRight size={14} color={colors.accent} />
            </TouchableOpacity>
          ) : null}
        </ScrollView>

        <View style={styles.actions}>
          <TouchableOpacity
            onPress={back}
            disabled={isFirst}
            style={[styles.secondaryBtn, isFirst && styles.secondaryBtnDisabled]}
            activeOpacity={0.8}
            testID="tutorial-back"
          >
            <ChevronLeft size={18} color={isFirst ? Colors.textMuted : Colors.text} />
            <Text style={[styles.secondaryText, isFirst && { color: Colors.textMuted }]}>Back</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={next}
            disabled={!currentDone}
            style={[styles.primaryBtn, !currentDone && styles.primaryBtnDisabled]}
            activeOpacity={0.85}
            testID="tutorial-next"
          >
            <Text style={styles.primaryText}>{isLast ? 'Finish' : 'Next'}</Text>
            {!isLast ? <ChevronRight size={18} color="#FFF" /> : null}
          </TouchableOpacity>
        </View>

        {!isLast ? (
          <TouchableOpacity onPress={finish} activeOpacity={0.7} style={styles.skipRow}>
            <Text style={styles.skipText}>Skip tutorial</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </Modal>
  );
}

export async function hasSeenTutorial(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(TUTORIAL_SEEN_KEY);
    return v === '1';
  } catch {
    return false;
  }
}

// ── Styles ────────────────────────────────────────────────────────────

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: t.bg,
    paddingHorizontal: 20,
  },
  topBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    marginBottom: 12,
    gap: 12,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: Tokens.radius.xl,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: t.surface,
  },
  progressDots: {
    flex: 1,
    flexDirection: 'row' as const,
    justifyContent: 'center' as const,
    gap: 4,
  },
  progressDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: t.line,
  },
  progressDotActive: {
    backgroundColor: t.accent,
    width: 14,
  },
  progressDotDone: {
    backgroundColor: t.success,
  },
  progressLabel: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: t.textMuted,
    minWidth: 36,
    textAlign: 'right' as const,
  },
  progressTrack: {
    height: 3,
    backgroundColor: t.line,
    borderRadius: 2,
    overflow: 'hidden' as const,
    marginBottom: 16,
  },
  progressFill: {
    height: '100%' as const,
    backgroundColor: t.accent,
  },
  scroll: {
    flexGrow: 1,
    alignItems: 'center' as const,
    paddingVertical: 8,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: Tokens.radius.full,
    backgroundColor: t.accentSoft,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: 12,
  },
  title: {
    ...Type.serifTitle,
    color: t.text,
    textAlign: 'center' as const,
    marginBottom: 8,
  },
  body: {
    fontSize: Type.bodyCompact.fontSize,
    color: t.textMuted,
    textAlign: 'center' as const,
    lineHeight: 20,
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  instructionRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    backgroundColor: t.accentSoft,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Tokens.radius.md,
    marginBottom: 12,
    alignSelf: 'center' as const,
  },
  instructionText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: t.accentLabel,
  },
  deepLinkBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: Tokens.radius.md,
    borderWidth: 1,
    borderColor: t.accent + '66',
    backgroundColor: t.surface,
  },
  deepLinkText: {
    fontSize: Type.caption1.fontSize,
    color: t.accentLabel,
    fontWeight: '600' as const,
  },
  actions: {
    flexDirection: 'row' as const,
    gap: 12,
    marginBottom: 8,
  },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.full,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: t.line,
  },
  secondaryBtnDisabled: { opacity: 0.5 },
  secondaryText: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '600' as const,
    color: t.text,
  },
  primaryBtn: {
    flex: 2,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    backgroundColor: t.accent,
    borderRadius: Tokens.radius.full,
    paddingVertical: 14,
  },
  primaryBtnDisabled: {
    opacity: 0.4,
  },
  primaryText: {
    fontSize: Type.callout.fontSize,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  skipRow: {
    alignItems: 'center' as const,
    paddingVertical: 12,
  },
  skipText: {
    fontSize: Type.footnote.fontSize,
    color: t.textMuted,
    fontWeight: '500' as const,
  },
});

// ── Demo-specific styles ──────────────────────────────────────────────

const demoStyles = StyleSheet.create({
  mockScreen: {
    width: '100%' as const,
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.panel,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    padding: 14,
    minHeight: 180,
  },
  mockHeader: {
    paddingBottom: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
    marginBottom: 10,
  },
  mockHeaderText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '700' as const,
    color: Colors.textSecondary,
    letterSpacing: 0.5,
  },
  mockBody: {
    gap: 8,
  },
  mockProjectRow: {
    backgroundColor: Colors.fillTertiary,
    borderRadius: Tokens.radius.sm,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  mockProjectText: {
    fontSize: Type.footnote.fontSize,
    color: Colors.text,
    fontWeight: '500' as const,
  },
  mockEmpty: {
    paddingVertical: 16,
    alignItems: 'center' as const,
  },
  mockEmptyText: {
    fontSize: Type.caption1.fontSize,
    color: Colors.textMuted,
    fontStyle: 'italic' as const,
  },
  mockLabel: {
    fontSize: Type.caption1.fontSize,
    color: Colors.textMuted,
    marginBottom: 10,
    fontWeight: '500' as const,
  },
  fabContainer: {
    position: 'absolute' as const,
    right: 14,
    bottom: 14,
    width: 56,
    height: 56,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  fabPulse: {
    position: 'absolute' as const,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primary + '55',
  },
  fab: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  fabComplete: {
    backgroundColor: Colors.success,
  },
  tabBar: {
    flexDirection: 'row' as const,
    justifyContent: 'space-around' as const,
    backgroundColor: Colors.fillSecondary,
    borderRadius: Tokens.radius.card,
    padding: 8,
    marginBottom: 10,
  },
  tabItem: {
    alignItems: 'center' as const,
    gap: 2,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: Tokens.radius.sm,
    position: 'relative' as const,
    minWidth: 56,
  },
  tabHighlight: {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: Colors.primary + '30',
    borderRadius: Tokens.radius.sm,
  },
  tabLabel: {
    fontSize: 10,
    color: Colors.textMuted,
    fontWeight: '500' as const,
  },
  hintRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingVertical: 8,
    justifyContent: 'center' as const,
  },
  hintText: {
    fontSize: Type.caption1.fontSize,
    color: Colors.text,
  },
  ganttTrack: {
    height: 36,
    backgroundColor: Colors.fillSecondary,
    borderRadius: Tokens.radius.sm,
    overflow: 'hidden' as const,
    position: 'relative' as const,
    marginBottom: 6,
  },
  ganttFill: {
    position: 'absolute' as const,
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: Colors.primary,
    borderRadius: Tokens.radius.sm,
  },
  ganttSegments: {
    flexDirection: 'row' as const,
    height: '100%' as const,
  },
  ganttSegment: {
    flex: 1,
    height: '100%' as const,
    borderRightWidth: 1,
    borderRightColor: 'rgba(255,255,255,0.2)',
  },
  ganttLabels: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 2,
  },
  ganttLabel: {
    flex: 1,
    fontSize: 10,
    color: Colors.textMuted,
    textAlign: 'center' as const,
    fontWeight: '500' as const,
  },
  quizQuestion: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 10,
    lineHeight: 19,
  },
  quizOption: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    backgroundColor: Colors.fillTertiary,
    borderRadius: Tokens.radius.md,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  quizOptionCorrect: {
    borderColor: Colors.success,
    backgroundColor: Colors.success + '15',
  },
  quizOptionWrong: {
    borderColor: Colors.error,
    backgroundColor: Colors.error + '10',
  },
  quizOptionText: {
    flex: 1,
    fontSize: Type.footnote.fontSize,
    color: Colors.text,
  },
  startBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 10,
    backgroundColor: Colors.primary,
    borderRadius: Tokens.radius.lg,
    paddingVertical: 16,
    paddingHorizontal: 24,
    alignSelf: 'center' as const,
  },
  startBtnDone: {
    backgroundColor: Colors.success,
  },
  startBtnText: {
    color: '#FFF',
    fontSize: Type.callout.fontSize,
    fontWeight: '700' as const,
  },
  finishBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 10,
    backgroundColor: Colors.primary,
    borderRadius: Tokens.radius.lg,
    paddingVertical: 18,
    paddingHorizontal: 28,
    alignSelf: 'center' as const,
  },
  finishBtnDone: {
    backgroundColor: Colors.success,
  },
  finishBtnText: {
    color: '#FFF',
    fontSize: Type.callout.fontSize,
    fontWeight: '700' as const,
  },
});
