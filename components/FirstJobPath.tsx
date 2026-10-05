// components/FirstJobPath.tsx — "Your First Job", the interactive starter
// path at the top of Home. It replaces the old "Get up and running" card
// (components/OnboardingChecklist.tsx), which stays in the repo as the way
// back: FIRST_JOB_PATH_ENABLED = false renders it exactly as before.
//
// WHY IT LOOKS LIKE THIS. The founder said new contractors get lost among the
// features. People learn a tool one thing at a time, on their own real work,
// with a safe sample to watch first, and with progress they can see. So:
//   • one opening question, asked once, that only decides which step is first;
//   • seven steps in the order of a real job, only ONE open at a time;
//   • each open step says in two short sentences why it matters, has one
//     button that goes to the real screen, "Show Me First" where a guided
//     tutorial exists, and Skip;
//   • a step is ticked ONLY when the account's real data says it is done
//     (hooks/useFirstJobSignals). When he comes back to Home after doing the
//     work the check lands, the line fills, the next step opens, and one quiet
//     line says what is next. No pop-up, no notification, no badge;
//   • anything on a paid plan shows a lock and the plan's name before the tap,
//     and AI steps say that MAGE drafts and he checks every line.
//
// Every rule is in utils/firstJobPath.ts (pure, tested by
// scripts/validate-first-job-path.ts). This file wires data to that module and
// draws the result with components/firstJob/FirstJobViews.
//
// WHO SEES IT (utils/firstJobPath.audienceFor). Contractor and "both": the
// path. An invited field seat with no job of his own: the card he had before,
// unchanged. Property owner and property manager: nothing (their Home never
// mounts this). Home passes the same props the old card took, so the old card
// can be rendered from here without Home knowing which one it got.
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { OnboardingChecklist, type OnboardingChecklistProps } from '@/components/OnboardingChecklist';
import {
  FinishView, HiddenRow, MoreButton, ProgressRing, QuestionView, StagePills, StepRow,
} from '@/components/firstJob/FirstJobViews';
import { cardSurface } from '@/components/ui/Card';
import { layoutNext, motionCurve, nativeDriver, useReducedMotion } from '@/components/ui/motion';
import { FIRST_JOB_PATH_ENABLED } from '@/constants/featureFlags';
import type { ThemeColors } from '@/constants/colors';
import { Motion, Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import { useAuth } from '@/contexts/AuthContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useFirstJobCopy, type FirstJobCtaKind } from '@/hooks/useFirstJobCopy';
import { useFirstJobSignals } from '@/hooks/useFirstJobSignals';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTierAccess } from '@/hooks/useTierAccess';
import { getFreeTrialsRemaining } from '@/utils/aiRateLimiter';
import { track, AnalyticsEvents } from '@/utils/analytics';
import {
  USUAL_ORDER, STEP_META, answerQuestion, audienceFor, buildView, freshlyDone, hidePath, isOutOfOrder,
  markFinishShown, orderFor, removePath, showMeFor, showPath, skipStep, stepCost, stepTarget, unskipStep,
  type FirstJobAnswer, type FirstJobCost, type FirstJobFinishStage, type FirstJobPlan, type FirstJobStepId,
  type FirstJobStored, type FirstJobTarget,
} from '@/utils/firstJobPath';
import { loadFirstJobState, saveFirstJobState } from '@/utils/firstJobStore';
import { beatSchedule } from '@/utils/motion/kit';
import { CLASSIC_SCHEDULE_PATH } from '@/utils/scheduleRoute';
import { TUTORIAL_PRACTICE_PASS } from '@/utils/tutorial/practicePass';
import { useTutorialProgress } from '@/utils/tutorial/progress';
import { isFieldOnlyUser } from '@/utils/tutorial/sandboxCore';
import { startTutorial } from '@/utils/tutorial/store';

/** The real screen behind a step's one button. Typed routes: a dead path is a tsc error. */
function hrefFor(target: FirstJobTarget): Href {
  switch (target.to) {
    case 'company': return '/company-profile';
    case 'prices': return '/cost-seed';
    case 'estimate':
    case 'estimateFirst': return '/estimate-wizard';
    case 'createProject': return { pathname: '/', params: { openCreate: '1' } };
    case 'proposal': return { pathname: '/contract', params: { projectId: target.projectId } };
    case 'projectEstimate': return { pathname: '/project-detail', params: { id: target.projectId } };
    case 'schedule': return { pathname: CLASSIC_SCHEDULE_PATH, params: { projectId: target.projectId, focus: String(Date.now()) } };
    case 'daily': return { pathname: '/daily-report', params: { projectId: target.projectId, new: '1' } };
    case 'invoice': return { pathname: '/invoice', params: { projectId: target.projectId, new: '1' } };
  }
}

/** Where each of the five stages already lives in the app. */
const STAGE_HOME: Record<FirstJobFinishStage, Href> = {
  win: '/(tabs)/discover/estimate',
  plan: '/(tabs)/discover/schedule',
  build: '/(tabs)/discover/tools',
  paid: '/payments',
  close: '/warranties',
};

function ctaKindFor(target: FirstJobTarget): FirstJobCtaKind {
  if (target.to === 'createProject') return 'createProject';
  if (target.to === 'estimateFirst') return 'estimateFirst';
  if (target.to === 'projectEstimate') return 'openEstimate';
  return 'main';
}

const FREE: FirstJobCost = { kind: 'free' };

type Quiet = { kind: 'done'; id: FirstJobStepId } | { kind: 'skipped' } | null;

interface CardProps {
  estimateCount: number;
  invoiceCount: number;
  realProjectCount: number;
}

type Commit = (change: (s: FirstJobStored) => FirstJobStored) => void;

/**
 * Reads what the card remembers, then mounts the path. A card he removed
 * mounts nothing at all: no data is read for it and nothing is asked of the
 * network.
 */
function FirstJobPathCard(props: CardProps) {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  // ── What the card remembers (per user, on this device) ──
  const [stored, setStored] = useState<FirstJobStored | null>(null);
  const storedRef = useRef<FirstJobStored | null>(null);
  useEffect(() => {
    let cancelled = false;
    storedRef.current = null;
    setStored(null);
    if (!userId) return;
    void loadFirstJobState(userId).then((s) => {
      if (cancelled) return;
      storedRef.current = s;
      setStored(s);
    });
    return () => { cancelled = true; };
  }, [userId]);
  const commit = useCallback((change: (s: FirstJobStored) => FirstJobStored) => {
    const cur = storedRef.current;
    if (!cur || !userId) return;
    const next = change(cur);
    if (next === cur) return;
    storedRef.current = next;
    setStored(next);
    void saveFirstJobState(userId, next);
  }, [userId]);

  if (!stored || stored.removed) return null;
  return <FirstJobPathBody {...props} stored={stored} storedRef={storedRef} commit={commit} />;
}

function FirstJobPathBody({ estimateCount, invoiceCount, realProjectCount, stored, storedRef, commit }: CardProps & {
  stored: FirstJobStored;
  storedRef: React.MutableRefObject<FirstJobStored | null>;
  commit: Commit;
}) {
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const copy = useFirstJobCopy();
  const { userRole } = useProjects();
  const { canAccess, isFree } = useTierAccess();
  const { progress: tutorialProgress } = useTutorialProgress();
  const reduce = useReducedMotion();

  // ── Done comes only from the account's data ──
  const { signals, projects } = useFirstJobSignals({
    active: true,
    estimateCount,
    invoiceCount,
    realProjectCount,
  });

  // The free plan's AI estimate count, shown before the tap. Read-only: this
  // counts, it never spends.
  const [freeEstimatesLeft, setFreeEstimatesLeft] = useState<number | null>(null);
  useFocusEffect(useCallback(() => {
    let cancelled = false;
    if (!isFree) { setFreeEstimatesLeft(null); return; }
    void getFreeTrialsRemaining('aiEstimateWizard')
      .then((left) => { if (!cancelled) setFreeEstimatesLeft(left); })
      .catch(() => { /* no count is fine; the note then names the plan without a number */ });
    return () => { cancelled = true; };
  }, [isFree]));

  const [selected, setSelected] = useState<FirstJobStepId | null>(null);
  const [finishLive, setFinishLive] = useState(false);
  const [finishClosed, setFinishClosed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [quiet, setQuiet] = useState<Quiet>(null);

  const view = useMemo(
    () => buildView(stored, signals, { selected, finishLive }),
    [stored, signals, selected, finishLive],
  );

  // ── Seen on focus: a step ticks when Home is on screen and sees it done for
  // the first time. Steps already done when the card first read them never
  // tick, a step seen done once never ticks again, and a list that LOADS done
  // (projects hydrating, the proposal read answering) is not something he just
  // did. Nothing here runs while Home is in the background.
  const seenDone = useRef<Set<FirstJobStepId> | null>(null);
  const seenOpen = useRef<Set<FirstJobStepId>>(new Set());
  const [ticks, setTicks] = useState<{ keys: FirstJobStepId[]; gen: number }>({ keys: [], gen: 0 });
  useFocusEffect(useCallback(() => {
    const cur = storedRef.current ?? stored;
    if (seenDone.current === null) {
      seenDone.current = new Set(USUAL_ORDER.filter((id) => signals[id] === true));
    }
    for (const id of USUAL_ORDER) if (signals[id] === false) seenOpen.current.add(id);
    const fresh = freshlyDone(signals, seenDone.current, seenOpen.current);
    for (const id of USUAL_ORDER) if (signals[id] === true) seenDone.current.add(id);
    if (fresh.length === 0) return;
    // Counted only once he is on the path: before the question is answered
    // there is no order to be in or out of.
    if (cur.answer !== null && !cur.removed) {
      const order = orderFor(cur.answer);
      let done = 0;
      for (const id of USUAL_ORDER) if (signals[id] === true) done += 1;
      for (const id of fresh) {
        const outOfOrder = isOutOfOrder(id, cur, { ...signals, [id]: false });
        track(AnalyticsEvents.FIRST_JOB_STEP_DONE, {
          step: id,
          position: order.indexOf(id) + 1,
          out_of_order: outOfOrder,
          done_count: done,
        });
      }
      layoutNext();
      setTicks((t) => ({ keys: fresh, gen: t.gen + 1 }));
      setQuiet({ kind: 'done', id: fresh[fresh.length - 1] });
      setSelected(null);
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
  }, [signals, stored, storedRef]));
  const tickBeats = beatSchedule(ticks.keys.length, reduce);

  // ── The card arrives once, quietly ──
  const enter = useState(() => new Animated.Value(0))[0];
  const shown = view.kind !== 'none' && !(view.kind === 'finish' && finishClosed);
  useEffect(() => {
    if (!shown) return;
    if (reduce) { enter.setValue(1); return; }
    const run = Animated.timing(enter, {
      toValue: 1, duration: Motion.duration.enter, easing: motionCurve.out, useNativeDriver: nativeDriver,
    });
    run.start();
    return () => run.stop();
  }, [shown, reduce, enter]);

  // ── Analytics: which step is open (once per step per visit) ──
  const openedRef = useRef<Set<FirstJobStepId>>(new Set());
  const openId = view.kind === 'path' ? view.openId : null;
  const openPosition = view.kind === 'path' ? (view.steps.find((s) => s.open)?.position ?? 0) : 0;
  useEffect(() => {
    if (!openId || openedRef.current.has(openId)) return;
    openedRef.current.add(openId);
    track(AnalyticsEvents.FIRST_JOB_STEP_OPENED, { step: openId, position: openPosition, by: selected === openId ? 'tap' : 'auto' });
  }, [openId, openPosition, selected]);

  // ── Finish: shown once. It stays up for this visit, then it is gone. ──
  const finishDone = view.kind === 'finish' ? view.done : 0;
  const finishSkipped = view.kind === 'finish' ? view.skipped : 0;
  const atFinish = view.kind === 'finish';
  useEffect(() => {
    if (!atFinish || finishLive) return;
    setFinishLive(true);
    commit(markFinishShown);
    track(AnalyticsEvents.FIRST_JOB_FINISHED, { done_count: finishDone, skipped_count: finishSkipped });
  }, [atFinish, finishLive, commit, finishDone, finishSkipped]);

  // ── Show Me First ──
  const openShowMe = useMemo(() => (openId ? showMeFor(openId, {
    done: false,
    persona: userRole,
    fieldOnly: false,
    progress: tutorialProgress,
    canAccess,
    practicePass: TUTORIAL_PRACTICE_PASS,
  }) : null), [openId, userRole, tutorialProgress, canAccess]);
  // tutorial_offered {entry: 'checklist'}: the denominator of offered to
  // started for this door. Once per tutorial per visit, only while the offer
  // is actually on screen.
  const offeredRef = useRef<Set<string>>(new Set());
  const offeredId = openShowMe?.kind === 'offer' ? openShowMe.tutorialId : null;
  useEffect(() => {
    if (!offeredId || offeredRef.current.has(offeredId)) return;
    offeredRef.current.add(offeredId);
    track(AnalyticsEvents.TUTORIAL_OFFERED, { tutorial_id: offeredId, entry: 'checklist' });
  }, [offeredId]);

  const tap = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
  }, []);

  const onAnswer = useCallback((answer: FirstJobAnswer) => {
    tap();
    layoutNext();
    commit((s) => answerQuestion(s, answer));
    track(AnalyticsEvents.FIRST_JOB_QUESTION_ANSWERED, { answer });
  }, [commit, tap]);

  const onToggle = useCallback((id: FirstJobStepId) => {
    tap();
    layoutNext();
    setMenuOpen(false);
    if (storedRef.current?.skipped.includes(id)) commit((s) => unskipStep(s, id));
    // Tapping the open step closes it back to the next one; tapping any other opens it.
    setSelected((cur) => (cur === id ? null : id));
  }, [commit, tap, storedRef]);

  const onSkip = useCallback((id: FirstJobStepId, position: number) => {
    tap();
    layoutNext();
    commit((s) => skipStep(s, id));
    setSelected(null);
    setQuiet({ kind: 'skipped' });
    track(AnalyticsEvents.FIRST_JOB_STEP_SKIPPED, { step: id, position });
  }, [commit, tap]);

  const onHide = useCallback((done: number) => {
    tap();
    layoutNext();
    setMenuOpen(false);
    commit(hidePath);
    track(AnalyticsEvents.FIRST_JOB_HIDDEN, { done_count: done });
  }, [commit, tap]);

  const onReopen = useCallback((done: number) => {
    tap();
    layoutNext();
    commit(showPath);
    track(AnalyticsEvents.FIRST_JOB_REOPENED, { done_count: done });
  }, [commit, tap]);

  const [confirmRemove, setConfirmRemove] = useState(false);
  const onRemove = useCallback((done: number) => {
    tap();
    layoutNext();
    commit(removePath);
    track(AnalyticsEvents.FIRST_JOB_REMOVED, { done_count: done });
  }, [commit, tap]);

  const go = useCallback((href: Href) => {
    tap();
    router.push(href);
  }, [router, tap]);

  const onShowMe = useCallback(() => {
    if (openShowMe?.kind !== 'offer') return;
    tap();
    void startTutorial(openShowMe.tutorialId, { entry: 'checklist' });
  }, [openShowMe, tap]);

  if (view.kind === 'none') return null;
  if (view.kind === 'finish' && finishClosed) return null;

  if (view.kind === 'hidden') {
    return <HiddenRow done={view.done} total={view.total} copy={copy} onOpen={() => onReopen(view.done)} />;
  }

  const rise = { opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] };

  if (view.kind === 'finish') {
    return (
      <Animated.View style={[styles.card, rise]} testID="first-job-card">
        <FinishView copy={copy} onStage={(s) => go(STAGE_HOME[s])} onClose={() => { tap(); layoutNext(); setFinishClosed(true); }} />
      </Animated.View>
    );
  }

  const done = view.done;
  const total = view.total;
  const canProposal = canAccess('client_portal');

  const menu = menuOpen ? (
    <View style={styles.menu} testID="first-job-menu">
      {confirmRemove ? (
        <>
          <Text style={styles.menuQuestion}>{copy.removeQuestion}</Text>
          <Text style={styles.menuBody}>{copy.removeBody}</Text>
          <View style={styles.menuRow}>
            <TouchableOpacity
              style={styles.menuBtn}
              onPress={() => onRemove(done)}
              activeOpacity={0.7}
              accessibilityRole="button"
              testID="first-job-remove-confirm"
            >
              <Text style={styles.menuDanger}>{copy.removeConfirmLabel}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuBtn}
              onPress={() => { tap(); setConfirmRemove(false); setMenuOpen(false); }}
              activeOpacity={0.7}
              accessibilityRole="button"
              testID="first-job-remove-cancel"
            >
              <Text style={styles.menuQuiet}>{copy.removeCancelLabel}</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <TouchableOpacity
          style={styles.menuBtn}
          onPress={() => { tap(); layoutNext(); setConfirmRemove(true); }}
          activeOpacity={0.7}
          accessibilityRole="button"
          testID="first-job-remove"
        >
          <Text style={styles.menuQuiet}>{copy.removeLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  ) : null;

  const header = (line: string) => (
    <View style={styles.head}>
      <ProgressRing done={done} total={total} copy={copy} />
      <View style={styles.headWords}>
        <Text style={styles.heading}>{copy.heading}</Text>
        <Text style={styles.line} numberOfLines={2} accessibilityLiveRegion="polite" testID="first-job-line">{line}</Text>
      </View>
      <TouchableOpacity
        style={styles.hideBtn}
        onPress={() => onHide(done)}
        hitSlop={8}
        activeOpacity={0.7}
        accessibilityRole="button"
        testID="first-job-hide"
      >
        <Text style={styles.hideText}>{copy.hideLabel}</Text>
      </TouchableOpacity>
      <MoreButton copy={copy} open={menuOpen} onPress={() => { tap(); layoutNext(); setConfirmRemove(false); setMenuOpen((o) => !o); }} />
    </View>
  );

  if (view.kind === 'question') {
    return (
      <Animated.View style={[styles.card, rise]} testID="first-job-card">
        {header(copy.introLine)}
        {menu}
        <QuestionView copy={copy} onAnswer={onAnswer} />
      </Animated.View>
    );
  }

  const line = quiet?.kind === 'done' && quiet.id !== view.nextId ? copy.doneNextLine(quiet.id, view.nextId)
    : quiet?.kind === 'skipped' ? copy.skippedNextLine(view.nextId)
    : done === 0 ? copy.introLine
    : copy.nextLine(view.nextId);

  return (
    <Animated.View style={[styles.card, rise]} testID="first-job-card">
      {header(line)}
      {menu}
      <StagePills stages={view.stages} copy={copy} />
      <View style={styles.path} testID="first-job-path">
        {view.steps.map((step, i) => {
          const target = stepTarget(step.id, { projects, canProposal });
          const ownCost = stepCost(step.id, { canAccess, freeEstimatesLeft });
          // What the BUTTON opens decides what the button costs: a step that
          // first sends him to create a project, or to the free PDF share, is
          // not behind a paywall; one that first sends him to price a job
          // carries the estimate's own allowance.
          const cost: FirstJobCost = target.to === 'createProject' || target.to === 'projectEstimate' ? FREE
            : target.to === 'estimateFirst' ? stepCost('estimate', { canAccess, freeEstimatesLeft })
            : ownCost;
          const sendPlan: FirstJobPlan | null = step.id === 'send' && ownCost.kind === 'locked' ? ownCost.plan : null;
          // Send has a free way through, so its row carries no lock.
          const tagPlan = step.id !== 'send' && ownCost.kind === 'locked' ? ownCost.plan : null;
          const notes: string[] = [];
          if (step.open) {
            if (target.to === 'createProject') notes.push(copy.needProjectNote);
            if (target.to === 'estimateFirst') notes.push(copy.needEstimateNote);
            if (STEP_META[step.id].ai || target.to === 'estimateFirst') notes.push(copy.aiNote);
            if (cost.kind === 'locked') notes.push(copy.lockedNote(cost.plan));
            if (cost.kind === 'metered') notes.push(copy.meteredNote(cost.left, cost.plan));
            if (sendPlan && target.to === 'projectEstimate') notes.push(copy.sendFreeNote(sendPlan));
          }
          const live = ticks.keys.includes(step.id);
          return (
            <StepRow
              key={step.id}
              step={step}
              total={total}
              last={i === view.steps.length - 1}
              lineFilled={i < view.filled}
              live={live}
              delayMs={tickBeats[ticks.keys.indexOf(step.id)] ?? 0}
              isNext={step.id === view.nextId}
              copy={copy}
              cost={cost}
              tagPlan={tagPlan}
              ctaKind={ctaKindFor(target)}
              notes={notes}
              showMe={step.open && openShowMe ? openShowMe.kind : null}
              showStripe={step.open && step.id === 'invoice'}
              onToggle={() => onToggle(step.id)}
              onPrimary={() => go(hrefFor(target))}
              onSkip={() => onSkip(step.id, step.position)}
              onShowMe={onShowMe}
              onStripe={() => go('/payments-setup')}
            />
          );
        })}
      </View>
    </Animated.View>
  );
}

/**
 * The card Home mounts where the old starter card sat. It takes the old
 * card's props, so Home's edit is one swap, and it decides who sees what:
 * the path, the old card, or nothing.
 */
function FirstJobPathImpl(props: OnboardingChecklistProps) {
  const { projects, userRole } = useProjects();
  const { user } = useAuth();
  const fieldOnly = useMemo(() => isFieldOnlyUser(projects, user?.id ?? null), [projects, user?.id]);
  const audience = audienceFor({ enabled: FIRST_JOB_PATH_ENABLED, persona: userRole, fieldOnly });
  if (audience === 'legacy') return <OnboardingChecklist {...props} />;
  if (audience === 'none') return null;
  return (
    <FirstJobPathCard
      estimateCount={props.estimateCount}
      invoiceCount={props.invoiceCount}
      realProjectCount={props.projectCount}
    />
  );
}

export const FirstJobPath = memo(FirstJobPathImpl);

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  card: {
    ...cardSurface(t, { pad: 14 }),
    marginHorizontal: 16,
    marginBottom: 12,
    gap: 12,
  },
  head: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12 },
  headWords: { flex: 1 },
  heading: { fontSize: Type.headline.fontSize, fontWeight: '700' as const, color: t.text, letterSpacing: -0.2 },
  line: { fontSize: Type.footnote.fontSize, lineHeight: Type.footnote.lineHeight, color: t.textMuted, marginTop: 2 },
  hideBtn: { minHeight: Tokens.touchTarget.min, justifyContent: 'center' as const, paddingHorizontal: 4 },
  hideText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.textMuted },
  path: { marginBottom: -8 },
  menu: {
    borderRadius: Tokens.radius.card, borderWidth: 1, borderColor: t.line,
    backgroundColor: t.surfaceAlt, paddingHorizontal: 12, paddingVertical: 6,
  },
  menuRow: { flexDirection: 'row' as const, gap: 8 },
  menuBtn: { minHeight: Tokens.touchTarget.min, justifyContent: 'center' as const, paddingRight: 12 },
  menuQuestion: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: t.text, marginTop: 6 },
  menuBody: { fontSize: Type.footnote.fontSize, lineHeight: Type.footnote.lineHeight, color: t.textMuted, marginTop: 2 },
  menuDanger: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: t.dangerLabel },
  menuQuiet: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: t.textSecondary },
});
