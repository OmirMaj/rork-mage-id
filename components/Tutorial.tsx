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
  LayoutDashboard, Target, ArrowRight,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';

export const TUTORIAL_SEEN_KEY = 'mageid_tutorial_seen_v1';

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

const STEPS: TutorialStep[] = [
  {
    title: 'Welcome to MAGE ID',
    body: 'This interactive tour takes about a minute. Tap things as you go — we\u2019ll teach you by doing, not by reading.',
    Icon: Home,
    instruction: 'Tap the pulsing button below to begin',
    Demo: ({ onComplete, completed }) => (
      <View style={demoStyles.mockScreen}>
        <TouchableOpacity
          onPress={() => {
            if (!completed) {
              if (Platform.OS !== 'web') void Haptics.selectionAsync();
              onComplete();
            }
          }}
          style={[demoStyles.startBtn, completed && demoStyles.startBtnDone]}
          activeOpacity={0.85}
          testID="tutorial-start"
        >
          {completed ? <CheckCircle2 size={22} color="#FFF" /> : <Sparkles size={22} color="#FFF" />}
          <Text style={demoStyles.startBtnText}>{completed ? 'Let\u2019s go' : 'Start the tour'}</Text>
        </TouchableOpacity>
      </View>
    ),
  },
  {
    title: 'Tabs are your home base',
    body: 'The bottom tab bar holds every top-level destination: Summary, your Projects, Discover (for finding work) and Settings.',
    Icon: LayoutDashboard,
    instruction: 'Tap the Summary tab in the mock below',
    Demo: buildTapTarget(0, TAB_ITEMS),
  },
  {
    title: 'Create a Project',
    body: 'Every build starts with a project. Tap the + to open the new-project sheet and add scope, location and budget.',
    Icon: FileText,
    instruction: 'Tap the + button to spin up a project',
    Demo: TapPlusDemo,
    deepLink: '/(tabs)/(home)',
  },
  {
    title: 'Build the Estimate',
    body: 'The Estimate tab tallies materials and labor. Pro tip: tap the Sparkles icon and describe your job — MAGE AI drafts the line items for you.',
    Icon: Sparkles,
    instruction: 'Pick the fastest way to build an estimate',
    Demo: buildQuizDemo(
      'You just scoped a kitchen remodel. What\u2019s the quickest way to estimate materials?',
      ['Type every SKU by hand', 'Tap the Sparkles icon and describe the job', 'Phone every supplier for quotes'],
      1,
    ),
    deepLink: '/(tabs)/discover/estimate',
  },
  {
    title: 'Schedule the Work',
    body: 'Drag tasks onto a Gantt timeline and the CPM engine finds the critical path — the chain of tasks that, if delayed, pushes your end date.',
    Icon: Calendar,
    instruction: 'Drag across the bar to schedule all four phases',
    Demo: GanttDragDemo,
    deepLink: '/(tabs)/discover/schedule',
  },
  {
    title: 'Track Cash Flow',
    body: 'Cash Flow Forecaster projects weekly balances so you can see crunches before they happen. Mix-in pending invoices and change orders for a real picture.',
    Icon: DollarSign,
    instruction: 'Which month will your cash position be tightest?',
    Demo: buildQuizDemo(
      'Your forecast shows: Jun +$12k, Jul -$3k, Aug +$8k. When should you chase invoices hardest?',
      ['June', 'July', 'August', 'It doesn\u2019t matter'],
      1,
    ),
    deepLink: '/cash-flow',
  },
  {
    title: 'Log a Daily Report',
    body: 'From the job site, log crew, weather, photos and progress in seconds. Share a snapshot link with the client or GC in one tap.',
    Icon: Camera,
    instruction: 'What belongs in a Daily Report?',
    Demo: buildQuizDemo(
      'What should you capture in a daily field report?',
      ['Only what went wrong', 'Crew, weather, progress + photos', 'Nothing — it\u2019s paperwork'],
      1,
    ),
  },
  {
    title: 'AI Code Check',
    body: 'Describe your project and Construction AI flags the likely codes, permits and common violations. A starting point, not legal advice — always confirm with your AHJ.',
    Icon: Gavel,
    instruction: 'Tap Construction AI in the mock nav',
    Demo: buildTapTarget(3, [
      { label: 'Projects', Icon: Home },
      { label: 'Estimate', Icon: Sparkles },
      { label: 'Hire', Icon: Users },
      { label: 'AI', Icon: Gavel },
    ]),
    deepLink: '/(tabs)/construction-ai',
  },
  {
    title: 'Closeout & Punch List',
    body: 'When a project wraps, generate a closeout packet, knock out punch items and send warranties + lien waivers straight from the project screen.',
    Icon: ClipboardCheck,
    instruction: 'Which item belongs on a punch list?',
    Demo: buildQuizDemo(
      'Which of these is a typical punch-list item?',
      ['Scratched countertop edge', 'Whole-house rewire', 'New foundation pour'],
      0,
    ),
  },
  {
    title: 'You\u2019re Ready',
    body: 'That\u2019s the core loop. Replay this tour anytime from Settings → Show Tutorial, and check the FAQ for deeper guides.',
    Icon: Wrench,
    instruction: 'Tap below to finish the tour',
    Demo: TapToFinishDemo,
  },
];

// ── Main component ────────────────────────────────────────────────────

interface TutorialProps {
  visible: boolean;
  onClose: () => void;
}

export default function Tutorial({ visible, onClose }: TutorialProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [index, setIndex] = useState(0);
  // Track which steps have had their demo completed so we can show a
  // green check on the progress indicator and enable Next.
  const [done, setDone] = useState<boolean[]>(() => STEPS.map(() => false));

  // Reset when the tutorial re-opens.
  useEffect(() => {
    if (visible) {
      setIndex(0);
      setDone(STEPS.map(() => false));
    }
  }, [visible]);

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
          <TouchableOpacity onPress={finish} style={styles.closeBtn} testID="tutorial-close">
            <X size={22} color={Colors.textMuted} />
          </TouchableOpacity>
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
            <StepIcon size={28} color={Colors.primary} />
          </View>
          <Text style={styles.title}>{step.title}</Text>
          <Text style={styles.body}>{step.body}</Text>

          <View style={styles.instructionRow}>
            {currentDone ? (
              <>
                <CheckCircle2 size={16} color={Colors.success} />
                <Text style={[styles.instructionText, { color: Colors.success }]}>Nice work — tap Next to continue</Text>
              </>
            ) : (
              <>
                <Target size={16} color={Colors.primary} />
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
              <ArrowRight size={14} color={Colors.primary} />
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
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
    borderRadius: 18,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: Colors.surface,
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
    backgroundColor: Colors.cardBorder,
  },
  progressDotActive: {
    backgroundColor: Colors.primary,
    width: 14,
  },
  progressDotDone: {
    backgroundColor: Colors.success,
  },
  progressLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textMuted,
    minWidth: 36,
    textAlign: 'right' as const,
  },
  progressTrack: {
    height: 3,
    backgroundColor: Colors.cardBorder,
    borderRadius: 2,
    overflow: 'hidden' as const,
    marginBottom: 16,
  },
  progressFill: {
    height: '100%' as const,
    backgroundColor: Colors.primary,
  },
  scroll: {
    flexGrow: 1,
    alignItems: 'center' as const,
    paddingVertical: 8,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primary + '14',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '700' as const,
    color: Colors.text,
    textAlign: 'center' as const,
    marginBottom: 8,
  },
  body: {
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: 'center' as const,
    lineHeight: 20,
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  instructionRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    backgroundColor: Colors.primary + '10',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    marginBottom: 12,
    alignSelf: 'center' as const,
  },
  instructionText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  deepLinkBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.primary + '40',
    backgroundColor: Colors.surface,
  },
  deepLinkText: {
    fontSize: 12,
    color: Colors.primary,
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
    backgroundColor: Colors.surface,
    borderRadius: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  secondaryBtnDisabled: { opacity: 0.5 },
  secondaryText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  primaryBtn: {
    flex: 2,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
  },
  primaryBtnDisabled: {
    opacity: 0.4,
  },
  primaryText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  skipRow: {
    alignItems: 'center' as const,
    paddingVertical: 12,
  },
  skipText: {
    fontSize: 13,
    color: Colors.textMuted,
    fontWeight: '500' as const,
  },
});

// ── Demo-specific styles ──────────────────────────────────────────────

const demoStyles = StyleSheet.create({
  mockScreen: {
    width: '100%' as const,
    backgroundColor: Colors.surface,
    borderRadius: 16,
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
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.textSecondary,
    letterSpacing: 0.5,
  },
  mockBody: {
    gap: 8,
  },
  mockProjectRow: {
    backgroundColor: Colors.fillTertiary,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  mockProjectText: {
    fontSize: 13,
    color: Colors.text,
    fontWeight: '500' as const,
  },
  mockEmpty: {
    paddingVertical: 16,
    alignItems: 'center' as const,
  },
  mockEmptyText: {
    fontSize: 12,
    color: Colors.textMuted,
    fontStyle: 'italic' as const,
  },
  mockLabel: {
    fontSize: 12,
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
    borderRadius: 12,
    padding: 8,
    marginBottom: 10,
  },
  tabItem: {
    alignItems: 'center' as const,
    gap: 2,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
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
    borderRadius: 8,
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
    fontSize: 12,
    color: Colors.text,
  },
  ganttTrack: {
    height: 36,
    backgroundColor: Colors.fillSecondary,
    borderRadius: 8,
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
    borderRadius: 8,
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
    fontSize: 14,
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
    borderRadius: 10,
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
    fontSize: 13,
    color: Colors.text,
  },
  startBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 10,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 24,
    alignSelf: 'center' as const,
  },
  startBtnDone: {
    backgroundColor: Colors.success,
  },
  startBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700' as const,
  },
  finishBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 10,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: 28,
    alignSelf: 'center' as const,
  },
  finishBtnDone: {
    backgroundColor: Colors.success,
  },
  finishBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700' as const,
  },
});
