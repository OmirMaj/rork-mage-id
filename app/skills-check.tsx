// app/skills-check.tsx — the skills check for one tutorial (?topic=<id>):
// five questions about using MAGE ID, four right to pass, then a certificate
// the SERVER issues.
//
// FLOW (the rules are pure, in utils/learn/quizEngine.ts)
//   intro → one question per screen → right / not quite + why → result.
//   Pass  → "Name on the certificate" (prefilled from the account name, never
//           from the email's local part) → Issue certificate → the server
//           re-grades the answers and writes the row → issued.
//   Fail  → "<n> of 5 right. You need 4." → Try again (choices reshuffled)
//           or Practice the tutorial again.
//   Offline / server blip → "You passed" + kept on this phone as a pending
//           award, retried when this screen gains focus or the app returns
//           to the foreground (utils/learn/skillsProgress.ts).
//   Server says not passed → the SERVER's numbers, never the local ones.
//
// HONESTY. The certificate preview, the success haptic and the issued event
// all hang off ONE fact: an award result { ok: true, passed: true }. The
// reducer's 'issued' phase is unreachable any other way, and this file reads
// that phase to draw it (scripts/validate-skill-quiz-engine.ts scans for it).
// The check is locked until the topic's tutorial is practised, says why, and
// states that it covers using the app only (CERT_SCOPE_NOTE). Free on every
// plan: there is no tier gate here or on the award.
//
// Phone: a pushed full-screen route, choices as ≥ 56 pt rows, the primary
// button pinned above the home indicator. Desktop web: the 'form' column
// (utils/desktopPage), 1–4 pick a choice and Enter is Next.

import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AppState, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@/contexts/ThemeContext';
import { useT } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { Type } from '@/constants/typography';
import { Button } from '@/components/ui/Button';
import { ActionBar, ActionBarReadout } from '@/components/ui/ActionBar';
import { Card } from '@/components/ui/Card';
import { useIsDesktopWeb } from '@/components/ui/desktop';
import { StackPush } from '@/components/motion/kit';
import { BRAIN_FAB_CLEARANCE, useBrainFabLift } from '@/components/brain/brainFabState';
import { QuizQuestionCard } from '@/components/learn/QuizQuestionCard';
import { QuizResultCard } from '@/components/learn/QuizResultCard';
import { useHotkeys } from '@/hooks/useHotkeys';
import { haptic } from '@/utils/haptics';
import { track } from '@/utils/analytics';
import { formatDateL } from '@/i18n';
import { TUTORIAL_DEFS } from '@/utils/tutorial/defs';
import { useTutorialProgress } from '@/utils/tutorial/progress';
import { startTutorial } from '@/utils/tutorial/store';
import { QUIZ_BANKS } from '@/utils/learn/quizBank';
import { skillTopic } from '@/utils/learn/topics';
import { CERT_SCOPE_NOTE, type SkillTopicId } from '@/utils/learn/types';
import {
  AWARD_MESSAGES,
  afterRetry,
  canRetryRefused,
  checkAvailability,
  cleanHolderName,
  freshSeed,
  gradeLocal,
  holderNameProblem,
  initialQuizState,
  orderFor,
  prefillHolderName,
  quizReducer,
  type AwardOutcome,
  type QuizState,
} from '@/utils/learn/quizEngine';
import {
  pendingFor,
  retryPendingAwards,
  updateSkillsProgress,
  withAttempt,
  withPending,
  withoutPending,
} from '@/utils/learn/skillsProgress';
import {
  SKILL_CERTIFICATES_QUERY_ROOT,
  awardSkillCertificate,
  useMyCertificates,
  type AwardInput,
} from '@/utils/learn/certificateClient';

function firstParam(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? '';
}

/** Send one pass to the award function through the SAME loop the focus
 *  retry uses, so a tap on Try again and a focus retry can never send it
 *  twice: write it as pending first, then run the shared loop. */
async function sendAward(input: AwardInput): Promise<AwardOutcome> {
  await updateSkillsProgress(p => withPending(p, { ...input, passedAt: new Date().toISOString() }));
  const outcomes = await retryPendingAwards(awardSkillCertificate);
  const mine = outcomes.find(o => o.topic === input.topic);
  if (mine) return mine.result;
  if (outcomes.some(o => !o.result.ok && o.result.reason === 'offline')) {
    return { ok: false, reason: 'offline', message: AWARD_MESSAGES.offline };
  }
  // Not in that loop (the write failed, or a loop already in flight read the
  // list before it): send it directly and settle the stored entry.
  const result = await awardSkillCertificate(input);
  if (afterRetry(result) === 'drop') await updateSkillsProgress(p => withoutPending(p, input.topic));
  return result;
}

export default function SkillsCheckScreen() {
  const params = useLocalSearchParams<{ topic?: string | string[] }>();
  const topic = skillTopic(firstParam(params.topic));
  const bank = topic ? QUIZ_BANKS[topic.id] : undefined;
  if (!topic || !bank) return <SkillsCheckUnavailable />;
  return <SkillsCheck key={topic.id} topicId={topic.id} />;
}

function useLeave() {
  const router = useRouter();
  return useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/tutorials');
  }, [router]);
}

/** The decorative cards' onPick: they are pictures, nothing to press. */
const noop = () => {};

function SkillsCheckUnavailable() {
  const { colors } = useTheme();
  const { t } = useT();
  const leave = useLeave();
  return (
    <View style={[styles.fill, styles.unavailable, { backgroundColor: colors.bg }]} testID="skills-check-unavailable">
      <Text style={[Type.bodyCompact, { color: colors.textSecondary }]}>
        {t('settings.learn.unavailable', "This skills check isn't available in this version of the app.")}
      </Text>
      <Button label={t('settings.learn.back', 'Back')} variant="secondary" onPress={leave} testID="skills-check-back" />
    </View>
  );
}

function SkillsCheck({ topicId }: { topicId: SkillTopicId }) {
  const topic = skillTopic(topicId)!;
  const bank = QUIZ_BANKS[topicId];
  const { colors } = useTheme();
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const leave = useLeave();
  const router = useRouter();
  const queryClient = useQueryClient();
  const isDesktopWeb = useIsDesktopWeb();
  const { user } = useAuth();
  const { progress, loaded } = useTutorialProgress();
  const certsQ = useMyCertificates();

  const [state, dispatch] = useReducer(quizReducer, undefined, (): QuizState => initialQuizState(topicId, bank, freshSeed()));
  const [holderName, setHolderName] = useState(() => prefillHolderName(user?.name, user?.email));
  const stateRef = useRef(state);
  stateRef.current = state;
  const issuingRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const availability = useMemo(
    () => checkAvailability(topicId, progress, TUTORIAL_DEFS, certsQ.data ?? [], QUIZ_BANKS),
    [topicId, progress, certsQ.data],
  );
  const phase = state.phase;

  // A pass already waiting on this phone: show it as pending, not the intro.
  useEffect(() => {
    let live = true;
    void pendingFor(topicId).then(p => {
      if (!live || !p) return;
      const g = gradeLocal(bank, p.answers);
      if (!g.passed) return;
      setHolderName(p.holderName);
      dispatch({ type: 'RESUME_PENDING', answers: p.answers, correct: g.correct, total: g.total });
    });
    return () => { live = false; };
  }, [topicId, bank]);

  // ── The award ───────────────────────────────────────────────────────────

  const landAward = useCallback((result: AwardOutcome) => {
    if (!mounted.current) return;
    dispatch({ type: 'AWARD_RESULT', result });
    if (result.ok && result.passed) {
      // The server wrote the row: only now the haptic, the event and the list.
      haptic.success();
      track('skill_certificate_issued', { topic: topicId });
      void queryClient.invalidateQueries({ queryKey: [SKILL_CERTIFICATES_QUERY_ROOT] });
    } else if (result.ok) {
      track('skills_check_failed', { topic: topicId });
    }
  }, [queryClient, topicId]);

  const issue = useCallback(async () => {
    const p = stateRef.current.phase;
    const name = cleanHolderName(holderName);
    const canIssue = p.kind === 'naming' || p.kind === 'pending' || (p.kind === 'refused' && canRetryRefused(p.reason));
    if (!name || !canIssue || issuingRef.current) return;
    issuingRef.current = true;
    dispatch({ type: 'ISSUE', holderName: name });
    try {
      const result = await sendAward({ topic: topicId, quizVersion: bank.version, answers: { ...stateRef.current.answers }, holderName: name });
      landAward(result);
    } finally {
      issuingRef.current = false;
    }
  }, [holderName, topicId, bank.version, landAward]);

  // Pending awards: retried on focus and on the app's return to the
  // foreground while this screen is focused.
  const retryPending = useCallback(() => {
    if (issuingRef.current) return;
    void retryPendingAwards(awardSkillCertificate).then(outcomes => {
      for (const o of outcomes) {
        if (o.result.ok && o.result.passed) void queryClient.invalidateQueries({ queryKey: [SKILL_CERTIFICATES_QUERY_ROOT] });
        if (o.topic === topicId && stateRef.current.phase.kind === 'pending' && !issuingRef.current) landAward(o.result);
      }
    });
  }, [queryClient, topicId, landAward]);

  useFocusEffect(useCallback(() => {
    retryPending();
    const sub = AppState.addEventListener('change', s => { if (s === 'active') retryPending(); });
    return () => sub.remove();
  }, [retryPending]));

  // ── Local grade: record the attempt once per result ────────────────────
  const graded = phase.kind === 'naming' || (phase.kind === 'failed' && phase.source === 'local');
  useEffect(() => {
    if (!graded || (phase.kind !== 'naming' && phase.kind !== 'failed')) return;
    void updateSkillsProgress(p => withAttempt(p, topicId, { correct: phase.correct, total: phase.total, at: new Date().toISOString() }));
    track(phase.kind === 'naming' ? 'skills_check_passed' : 'skills_check_failed', { topic: topicId });
  }, [graded]); // eslint-disable-line react-hooks/exhaustive-deps -- once per graded result

  // ── Actions ─────────────────────────────────────────────────────────────

  const begin = useCallback(() => {
    track('skills_check_started', { topic: topicId });
    dispatch({ type: 'BEGIN' });
  }, [topicId]);

  const restart = useCallback(() => {
    const seed = freshSeed(Date.now() + state.seed);
    track('skills_check_started', { topic: topicId });
    dispatch({ type: 'RESTART', questions: orderFor(bank, seed), seed });
  }, [bank, state.seed, topicId]);

  const practise = useCallback(() => {
    void startTutorial(topicId, { entry: 'hub' });
  }, [topicId]);

  const pick = useCallback((choiceId: string) => dispatch({ type: 'PICK', choiceId }), []);
  const next = useCallback(() => dispatch({ type: 'NEXT' }), []);

  const qIndex = phase.kind === 'question' || phase.kind === 'answered' ? phase.index : -1;
  const question = qIndex >= 0 ? state.questions[qIndex] : null;
  const isLast = qIndex === state.questions.length - 1;

  // Desktop web: 1–4 pick, Enter is Next (the registry's typing guard leaves
  // a focused field's keys alone).
  const pickNth = (n: number) => () => {
    const p = stateRef.current.phase;
    if (p.kind !== 'question') return;
    const c = stateRef.current.questions[p.index]?.choices[n];
    if (c) pick(c.id);
  };
  useHotkeys([
    { combo: '1', handler: pickNth(0), label: 'Pick choice 1', group: 'Skills check' },
    { combo: '2', handler: pickNth(1), label: 'Pick choice 2', group: 'Skills check' },
    { combo: '3', handler: pickNth(2), label: 'Pick choice 3', group: 'Skills check' },
    { combo: '4', handler: pickNth(3), label: 'Pick choice 4', group: 'Skills check' },
    { combo: 'enter', handler: () => { if (stateRef.current.phase.kind === 'answered') next(); }, label: 'Next Question', group: 'Skills check' },
  ], { scope: 'page', enabled: isDesktopWeb });

  // ── The pinned bar ──────────────────────────────────────────────────────
  // The bar floats over the bottom of the scroll (an overlay, not a flex
  // sibling), so the FAB lifts by its height and the scroll pads for both.
  const [barH, setBarH] = useState(0);
  const fabLift = barH;
  useBrainFabLift(fabLift);

  // The award function's own name rule (2 to 80 characters, no '@'): a name
  // it would refuse never reaches it, and the bar says which rule.
  const nameProblem = holderNameProblem(holderName);
  const nameBlocked = nameProblem !== null;
  const nameReason = nameProblem === 'email'
    ? t('settings.learn.nameEmail', 'Use a name, not an email address.')
    : nameProblem === 'short'
      ? t('settings.learn.nameShort', 'Use at least 2 characters for the name.')
      : nameProblem === 'long'
        ? t('settings.learn.nameLong', 'Use 80 characters or fewer for the name.')
        : t('settings.learn.nameMissing', 'Add the name to print first.');
  let blockedReason: string | null = null;
  let bar: React.ReactNode = null;

  if (phase.kind === 'intro') {
    if (!loaded) bar = null;
    else if (availability.kind === 'open') {
      bar = <Button label={t('settings.learn.start', 'Start the Check')} variant="primary" fullWidth onPress={begin} testID="skills-check-start" />;
    } else if (availability.kind === 'locked') {
      // The intro already says why (skills-check-locked), right above.
      bar = <Button label={t('settings.learn.practiseFirst', 'Practice the Tutorial')} variant="primary" fullWidth onPress={practise} testID="skills-check-practise" />;
    } else {
      bar = <Button label={t('settings.learn.done', 'Done')} variant="secondary" fullWidth onPress={leave} testID="skills-check-done" />;
    }
  } else if (phase.kind === 'answered') {
    bar = (
      <Button
        label={isLast ? t('settings.learn.seeResult', 'See Your Result') : t('settings.learn.next', 'Next Question')}
        variant="primary"
        fullWidth
        onPress={next}
        testID="skills-check-next"
      />
    );
  } else if (phase.kind === 'naming' || phase.kind === 'issuing') {
    if (phase.kind === 'naming' && nameBlocked) blockedReason = nameReason;
    bar = (
      <Button
        label={phase.kind === 'issuing' ? t('settings.learn.issuing', 'Issuing…') : t('settings.learn.issue', 'Issue Certificate')}
        variant="primary"
        fullWidth
        loading={phase.kind === 'issuing'}
        disabled={phase.kind === 'naming' && nameBlocked}
        onPress={() => { void issue(); }}
        testID="skills-check-issue"
      />
    );
  } else if (phase.kind === 'failed') {
    // A fragment, not a wrapper: the ActionBar sizes each button on desktop.
    bar = (
      <>
        <Button label={t('settings.learn.tryAgain', 'Try Again')} variant="primary" fullWidth onPress={restart} testID="skills-check-retry" />
        <Button label={t('settings.learn.practiseAgain', 'Practice the Tutorial Again')} variant="secondary" fullWidth onPress={practise} testID="skills-check-practise-again" />
      </>
    );
  } else if (phase.kind === 'refused' && phase.reason === 'revoked') {
    // Not issued again: the card says why, and there is nothing to retry.
    bar = <Button label={t('settings.learn.done', 'Done')} variant="secondary" fullWidth onPress={leave} testID="skills-check-done" />;
  } else if (phase.kind === 'pending' || phase.kind === 'refused') {
    // A changed quiz, or a request the function refused for a reason that is
    // not the name (the identical body would get the identical 400): take the
    // check again rather than re-send.
    const fresh = phase.kind === 'refused' && (phase.reason === 'quiz_changed' || phase.reason === 'bad_request');
    if (!fresh && nameBlocked) blockedReason = nameReason;
    bar = (
      <Button
        label={t('settings.learn.tryAgain', 'Try Again')}
        variant="primary"
        fullWidth
        disabled={!fresh && nameBlocked}
        onPress={fresh ? restart : () => { void issue(); }}
        testID="skills-check-retry"
      />
    );
  } else if (phase.kind === 'issued') {
    bar = (
      <>
        <Button label={t('settings.learn.seeCertificates', 'See Your Certificates')} variant="primary" fullWidth
          onPress={() => router.replace('/skills-certificates')} testID="skills-check-see-certificates" />
        <Button label={t('settings.learn.done', 'Done')} variant="secondary" fullWidth onPress={leave} testID="skills-check-done" />
      </>
    );
  }

  // No def or no bank in this build: the check does not exist yet.
  if (phase.kind === 'intro' && availability.kind === 'hidden') return <SkillsCheckUnavailable />;

  return (
    <View style={[styles.fill, { backgroundColor: colors.bg }]} testID="skills-check">
      <ScrollView
        style={styles.fill}
        contentContainerStyle={[styles.content, { paddingBottom: fabLift + BRAIN_FAB_CLEARANCE }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* The topic card opens into the stacked question cards (motion kit
            StackPush): the finished card slides away left, the next steps
            forward, and the cards behind show how many are left. Behind
            cards are empty shells, never the next question; the leaving card
            is a decorative copy. Exactly one live question card at a time.
            Reduce Motion: one flat card, a 100 ms swap-fade (StackPush). */}
        {phase.kind === 'intro' || question ? (
          <StackPush
            index={qIndex}
            count={state.questions.length}
            style={styles.stack}
            testID="skills-check-stack"
            chapter={(
              <Card testID="skills-check-intro">
                <Text style={[Type.title2, { color: colors.text }]} accessibilityRole="header">
                  {t('settings.learn.introTitle', 'Skills check: {label}', { label: topic.label })}
                </Text>
                <Text style={[Type.body, styles.introLine, { color: colors.text }]}>
                  {t('settings.learn.introLine', '5 questions about using MAGE ID. Get 4 right to pass.')}
                </Text>
                <Text style={[Type.footnote, styles.scope, { color: colors.textSecondary }]} testID="skills-check-scope">
                  {CERT_SCOPE_NOTE}
                </Text>
                {loaded && availability.kind === 'locked' ? (
                  <Text style={[Type.bodyCompactEmphasized, styles.status, { color: colors.warningLabel }]} testID="skills-check-locked">
                    {t('settings.learn.locked', 'Finish the tutorial first.')}
                  </Text>
                ) : null}
                {availability.kind === 'passed' ? (
                  <View style={styles.status} testID="skills-check-already">
                    <Text style={[Type.bodyCompactEmphasized, { color: colors.successLabel }]}>
                      {t('settings.learn.hubPassed', 'Skills Check: Passed')}
                    </Text>
                    <Text style={[Type.footnote, styles.alreadySub, { color: colors.textSecondary }]}>
                      {t('settings.learn.alreadyIssued', 'Issued {date} to {name}.', {
                        date: formatDateL(availability.certificate.issuedAt),
                        name: availability.certificate.holderName,
                      })}
                    </Text>
                  </View>
                ) : null}
              </Card>
            )}
            renderCard={(i) => (
              <Card style={i === qIndex ? undefined : styles.stackFill}>
                {i === qIndex ? (
                  <QuizQuestionCard
                    question={state.questions[i]}
                    index={i}
                    total={state.questions.length}
                    pickedId={phase.kind === 'answered' ? phase.choiceId : null}
                    showKeys={isDesktopWeb}
                    onPick={pick}
                  />
                ) : i < qIndex ? (
                  <QuizQuestionCard
                    decorative
                    question={state.questions[i]}
                    index={i}
                    total={state.questions.length}
                    pickedId={state.answers[state.questions[i].id] ?? null}
                    showKeys={false}
                    onPick={noop}
                  />
                ) : (
                  <View style={styles.shell} />
                )}
              </Card>
            )}
          />
        ) : null}

        {/* The result. 'issued' (the certificate) renders only from the
            reducer's issued phase, which only an ok award reaches. */}
        {phase.kind === 'naming' || phase.kind === 'issuing' || phase.kind === 'failed'
          || phase.kind === 'pending' || phase.kind === 'refused' || phase.kind === 'issued' ? (
          <QuizResultCard phase={phase} label={topic.label} holderName={holderName} onChangeName={setHolderName} />
        ) : null}
      </ScrollView>

      {bar ? (
        <ActionBar
          style={[styles.bar, { paddingBottom: insets.bottom + 12, borderTopColor: colors.line, backgroundColor: colors.bg }]}
          onLayout={e => setBarH(e.nativeEvent.layout.height)}
          testID="skills-check-bar"
        >
          {blockedReason ? (
            <ActionBarReadout>
              <Text style={[Type.footnote, styles.blocked, { color: colors.textSecondary }]} testID="skills-check-blocked">
                {blockedReason}
              </Text>
            </ActionBarReadout>
          ) : null}
          {bar}
        </ActionBar>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  unavailable: { padding: 16, gap: 16, justifyContent: 'center' },
  content: { paddingHorizontal: 16, paddingTop: 20 },
  // Room above the stack for the cards behind (8 / 16 pt peeks).
  stack: { marginTop: 16 },
  // A card behind or leaving fills its layer's absoluteFill box.
  stackFill: { flex: 1 },
  shell: { minHeight: 1 },
  introLine: { marginTop: 10 },
  scope: { marginTop: 10 },
  status: { marginTop: 20 },
  alreadySub: { marginTop: 4 },
  bar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: 16, paddingTop: 12, gap: 8, borderTopWidth: StyleSheet.hairlineWidth,
  },
  blocked: { textAlign: 'center' },
});
