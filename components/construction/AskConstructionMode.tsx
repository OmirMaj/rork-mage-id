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
//
// Errors say what actually happened (audit #121): no signal, a timeout, a
// server failure and "not built yet" are four different sentences, and the
// first three carry a Try again that re-runs the kept question. Sources list
// only what the answer used; everything else the engine looked at is shown
// muted under "Also checked" (audit #120).
//
// Building record (Baltimore lane, 2026-09-28): when the linked job's public
// building record is LOADED (NYC DOB, Baltimore City or Baltimore County open
// data, via useJobBuildingRecord), its summary block rides with the question
// so the answer can cite it with its as-of date. Ask never starts a lookup:
// the lookup is the contractor's tap on the job's Building record card. The
// jurisdiction resolves through jurisdictionQueryForProject, so a job whose
// location ends in a ZIP that lies in one government, or whose parcel side
// the contractor confirmed, gets that government's codes.

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, Linking, Platform, StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  MessageCircleQuestion, ExternalLink, FileText, Calculator,
  AlertTriangle, FileQuestion, DollarSign, RotateCcw,
} from 'lucide-react-native';
import { Colors, type ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { MageAIMark } from '@/components/icons';
import {
  askConstruction, ConstructionAnswerError, CONSTRUCTION_ANSWER_COPY, isRetryableConstructionError,
  MAX_QUESTION_CHARS, consultedSummary,
  type ConstructionAnswerResponse,
} from '@/utils/constructionAnswer';
import type {
  AnswerCitation, ConstructionAnswerBuildingRecord, ConstructionAnswerJurisdiction,
} from '@/types/constructionAnswer';
import type { Project } from '@/types';
import { codesSummary, jurisdictionQueryForProject, resolveCodeJurisdiction, type AddressableProject } from '@/utils/codeJurisdiction';
import { formatCalendarDay } from '@/utils/calendarDate';
import { useJobBuildingRecord, type JobBuildingRecordState } from '@/hooks/useJobBuildingRecord';
// Learn-by-doing tutorial "construction-ai-ask" (utils/tutorial/defs): on the
// SAMPLE job while a run is live, the sample question — about the job's own
// records, never codes — is answered by fixturesB sampleJobAnswer from the
// sample's estimate, change orders and invoices: no construction-answer call,
// no meter change. Every other question says why it is blocked
// (validate-tutorial-learn-b pins the guard). Wrappers render only during the run.
import { TutorialTarget } from '@/components/tutorial/TutorialTarget';
import { TutorialScrollAnchor } from '@/components/tutorial/TutorialScrollAnchor';
import { tutorialSignal, useTutorialAssist, useTutorialPractice, useTutorialSandboxId } from '@/utils/tutorial/store';
import { SAMPLE_NO_CREDITS_LABEL } from '@/utils/tutorial/fixtures';
import { SAMPLE_JOB_QUESTION, isSampleQuestion, sampleJobAnswer, tutorialAiLock } from '@/utils/tutorial/learn/fixturesB';
import { useProjects } from '@/contexts/ProjectContext';
import { t } from '@/i18n/core';

/** The selected job's verified adoption record, or null (unknown place / no job). */
function jurisdictionForAsk(
  project: AddressableProject | null,
  confirmedCounty: string | null,
): ConstructionAnswerJurisdiction | null {
  if (!project) return null;
  const q = jurisdictionQueryForProject(project, confirmedCounty);
  const r = resolveCodeJurisdiction(q);
  if (r.kind === 'unknown') return null;
  // A Baltimore address that names neither government (the mailing name
  // "Baltimore" is used by both) says so in the jobsite line, so the model is
  // never handed Maryland's state codes as if they settled it.
  const ambiguity = r.kind === 'state' ? r.localAmbiguity : undefined;
  const place = [q.city, q.state].filter(Boolean).join(', ');
  return {
    authority: r.entry.authorityName,
    codesInForce: codesSummary(r.entry.codes),
    checkedOn: r.entry.checkedOn,
    sourceUrl: r.entry.sourceUrl,
    place: ambiguity
      ? `${place} (${ambiguity.candidates.join(' or ')}: not decided, so no local code is grounded)`
      : place,
    scope: r.kind,
  };
}

/** The loaded building record to send with the question, or null. Only a
 *  record the contractor already loaded (phase 'ready') is sent. */
export function buildingRecordForAsk(
  building: Pick<JobBuildingRecordState, 'supported' | 'phase' | 'summary' | 'sourceLabel' | 'asOf'>,
): ConstructionAnswerBuildingRecord | null {
  if (!building.supported || building.phase !== 'ready') return null;
  const block = building.summary.promptBlock;
  if (!block) return null;
  return { source: building.sourceLabel, asOf: building.asOf, block };
}

interface Props {
  projects: Project[];
  bottomInset: number;
  /** The job to link when the tab is opened for one with mode=ask. */
  entryProjectId?: string | null;
  /** The tutorial's sample job when the tab was opened on it during a run
   *  (the tab's lock). While set, nothing on this mode reaches the network. */
  tutorialSampleId?: string | null;
}

const PRESETS = [
  'Is a 2x10 at 16" OC OK for a 16 ft floor span?',
  'Egress requirements for a basement bedroom?',
  'What permits do I need for a garage-to-ADU conversion?',
];

export default function AskConstructionMode({ projects, bottomInset, entryProjectId = null, tutorialSampleId = null }: Props) {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { canAccess } = useTierAccess();

  const [question, setQuestion] = useState('');
  const [projectId, setProjectId] = useState<string | null>(entryProjectId);
  // A later entry for another job (the tab stays mounted) links that job.
  useEffect(() => { if (entryProjectId) setProjectId(entryProjectId); }, [entryProjectId]);

  // ── Tutorial: construction-ai-ask (the sample job only) ──────────────────
  // The practice pass is keyed to the LINKED job (or, before the entry link
  // lands, the tab's sample), so linking a real job drops it (practicePass.ts
  // scopes it to the run's sandbox id).
  const tutorialSandboxId = useTutorialSandboxId();
  const practice = useTutorialPractice(projectId ?? tutorialSampleId);
  const canAsk = canAccess('construction_answer') || practice.has('construction_answer');
  // The AI lock: the tab's own lock, or a run live / the pass open on the
  // linked job. While it holds, askConstruction() is never called.
  const tutorialLock = !!tutorialSampleId || tutorialAiLock(projectId, tutorialSandboxId, practice.size);
  // The job the sample answer is computed from.
  const sampleJobId = tutorialSampleId ?? (tutorialLock ? projectId : null);
  const tutorialOn = !!tutorialSandboxId && (tutorialSandboxId === tutorialSampleId || tutorialSandboxId === projectId);
  const { getProject, getInvoicesForProject, getChangeOrdersForProject, invoicesLoaded, changeOrdersLoaded } = useProjects();
  const [tutorialBlocked, setTutorialBlocked] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ConstructionAnswerResponse | null>(null);
  const [errCode, setErrCode] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [showPaywall, setShowPaywall] = useState(false);

  const canSubmit = question.trim().length > 3 && !loading;

  // Called on every render (hook order); inert when no job is linked.
  const linkedProject = projects.find((p) => p.id === projectId) ?? null;
  const building = useJobBuildingRecord(linkedProject);
  const attachedRecord = useMemo(
    () => buildingRecordForAsk(building),
    // The fields buildingRecordForAsk reads; the state object itself is new each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [building.supported, building.phase, building.summary, building.sourceLabel, building.asOf],
  );
  const confirmedCounty = building.confirmedCounty;

  /** The sample answer, computed now from the sample job's own records. No
   *  construction-answer call, no meter change. */
  const showSampleAnswer = useCallback(() => {
    const job = sampleJobId ? getProject(sampleJobId) : null;
    if (!job) return;
    setErrCode(null);
    setErrMsg(null);
    // Never answer "nothing billed" from a list that has not loaded yet.
    if (!invoicesLoaded || !changeOrdersLoaded) {
      setResult(null);
      setTutorialBlocked(t('common.tutorial.caiStillLoading', "This job's invoices are still loading. Try again in a moment."));
      return;
    }
    const a = sampleJobAnswer(job, getInvoicesForProject(job.id), getChangeOrdersForProject(job.id));
    setTutorialBlocked(null);
    setResult({
      answer: a.answer,
      citations: a.citations,
      consulted: a.consulted,
      verified: a.verified,
      disclaimer: a.disclaimer,
      usedAI: a.usedAI,
    });
    tutorialSignal('cai.answered', { projectId: job.id, source: 'sample', consulted: a.citations.length + a.consulted.length, leftCents: a.leftCents });
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, [sampleJobId, getProject, invoicesLoaded, changeOrdersLoaded, getInvoicesForProject, getChangeOrdersForProject]);

  // The question step's real success point: the box holds the sample
  // question (typed word for word, or filled by the chip / Do it for me).
  useEffect(() => {
    if (!tutorialLock || !sampleJobId) return;
    if (isSampleQuestion(question, SAMPLE_JOB_QUESTION)) tutorialSignal('cai.question.filled', { projectId: sampleJobId, chars: question.length });
  }, [question, tutorialLock, sampleJobId]);
  const fillSampleQuestion = useCallback(() => {
    setQuestion(SAMPLE_JOB_QUESTION);
    setTutorialBlocked(null);
  }, []);
  // 'Do it for me': fills the box. He still taps Get answer.
  useTutorialAssist('cai.useSampleQuestion', fillSampleQuestion);

  const runAsk = useCallback(async () => {
    // TUTORIAL AI GUARD (validate-tutorial-learn-b): on the sample during a
    // run the sample question is answered from the job's records and anything
    // else is refused — askConstruction() is never reached.
    if (tutorialLock) {
      if (sampleJobId && isSampleQuestion(question, SAMPLE_JOB_QUESTION)) showSampleAnswer();
      else {
        setResult(null);
        setTutorialBlocked(t('common.tutorial.sampleQuestionBlocked', 'On the sample, use the sample question. Your own questions run on a real job.'));
      }
      return;
    }
    if (!canAsk) { setShowPaywall(true); return; }
    if (!canSubmit) return;
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLoading(true);
    setResult(null);
    setErrCode(null);
    setErrMsg(null);
    try {
      const res = await askConstruction({
        question: question.trim(),
        projectId,
        jurisdiction: jurisdictionForAsk(linkedProject, confirmedCounty),
        buildingRecord: attachedRecord,
      });
      setResult(res);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      // Anything that isn't a typed error is a failure on our side, never
      // "not available yet" — that sentence is for not_configured only.
      const code = e instanceof ConstructionAnswerError ? e.code : 'server_error';
      setErrCode(code);
      setErrMsg(e instanceof ConstructionAnswerError ? e.message : CONSTRUCTION_ANSWER_COPY.server_error);
    } finally {
      setLoading(false);
    }
  }, [canAsk, canSubmit, question, projectId, linkedProject, confirmedCounty, attachedRecord, tutorialLock, sampleJobId, showSampleAnswer]);

  const openCitation = useCallback((c: AnswerCitation) => {
    if (c.kind === 'web' && c.url) { void Linking.openURL(c.url); return; }
    if (c.kind === 'plan' && c.ref) { router.push(`/plan-viewer?sheetId=${encodeURIComponent(c.ref)}` as never); return; }
  }, [router]);

  const showHonesty = !!result && (!result.verified || !!result.disclaimer);

  // Hoisted so the tutorial's spotlights can wrap them during a run on the
  // sample; otherwise they render exactly as before.
  const questionInput = (
    <TextInput
      value={question}
      onChangeText={setQuestion}
      placeholder="Ask about codes, spans, permits or your plans"
      placeholderTextColor={Colors.textMuted}
      style={styles.textArea}
      multiline
      numberOfLines={4}
      textAlignVertical="top"
      // The server refuses longer questions (400); cap here so it can't.
      maxLength={MAX_QUESTION_CHARS}
      testID="construction-ask-input"
    />
  );
  const runButton = (
    <TouchableOpacity
      style={[styles.runBtn, !canSubmit && styles.runBtnDisabled]}
      onPress={runAsk}
      disabled={!canSubmit}
      activeOpacity={0.85}
      testID="construction-ask-run"
    >
      {loading ? <ActivityIndicator color="#FFF" /> : <MageAIMark size={18} color="#FFF" />}
      <Text style={styles.runBtnText}>{loading ? 'Researching the code for your project…' : 'Get answer'}</Text>
    </TouchableOpacity>
  );

  // The answer's grounding (what it rests on, what else it checked) and its
  // honesty banner — hoisted for the tutorial's two look steps.
  const groundingBlock = result ? (
    <>
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

    {result.consulted && result.consulted.length > 0 ? (
      // Looked at, not used: muted and never tappable, so "Sources"
      // means only what the answer rests on.
      <View testID="construction-ask-consulted">
        <Text style={styles.consultedLabel}>Also checked</Text>
        <Text style={styles.consultedText}>
          {consultedSummary(result.consulted.map(c => c.label))}
        </Text>
      </View>
    ) : null}
    </>
  ) : null;
  const honestyBanner = result && showHonesty ? (
    <View style={styles.honestyBanner} testID="construction-ask-ahj">
      <AlertTriangle size={14} color={Colors.warningLabel} strokeWidth={1.75} />
      <Text style={styles.honestyText}>
        {result.disclaimer || 'General guidance — confirm details with your local building department (AHJ).'}
      </Text>
    </View>
  ) : null;

  return (
    <ScrollView
      ref={scrollRef}
      contentContainerStyle={{ padding: 20, paddingBottom: bottomInset + 80 }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <MaybeScrollAnchor on={tutorialOn} scrollRef={scrollRef}>
      <View style={styles.hero}>
        <View style={styles.heroIconWrap}>
          <MessageCircleQuestion size={28} color={Colors.primary} strokeWidth={1.75} />
        </View>
        <Text style={styles.heroTitle}>Ask</Text>
        <Text style={styles.heroSubtitle}>
          Answers on codes, spans and permits, researched against the code and your project, with every source cited.
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
          {attachedRecord ? (
            <Text style={styles.recordNote} testID="construction-ask-record">
              {`Using the building record from ${attachedRecord.source} (${attachedRecord.asOf ? `as of ${formatCalendarDay(attachedRecord.asOf)}` : 'as-of date not published'}).`}
            </Text>
          ) : linkedProject && building.supported && (building.phase === 'loading' || building.phase === 'resolving') ? (
            <Text style={styles.recordNote} testID="construction-ask-record-loading">
              Loading the job&apos;s building record. It is added to your question once it loads.
            </Text>
          ) : linkedProject && building.supported ? (
            <Text style={styles.recordNote} testID="construction-ask-record-missing">
              Building record not loaded. Open the job&apos;s Building record card to add it.
            </Text>
          ) : null}
        </>
      )}

      <Text style={styles.label}>Your question</Text>
      {tutorialOn ? (
        // The tutorial's sample question rides in the same spotlight hole as
        // the box. It is about the job's records — never a code question.
        <TutorialTarget id="cai.askInput" style={styles.sampleWrap}>
          {questionInput}
          <TouchableOpacity
            style={styles.sampleChip}
            onPress={fillSampleQuestion}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={t('common.tutorial.caiSampleA11y', 'Use the sample question. {note}.', { note: SAMPLE_NO_CREDITS_LABEL })}
            testID="construction-ask-sample-question"
          >
            <Text style={styles.sampleLabel}>{SAMPLE_NO_CREDITS_LABEL}</Text>
            <Text style={styles.sampleChipText}>{t('common.tutorial.caiSampleQuestion', 'Use the sample question: {question}', { question: SAMPLE_JOB_QUESTION })}</Text>
          </TouchableOpacity>
        </TutorialTarget>
      ) : questionInput}

      {/* The code presets stay out of the tutorial: it teaches asking about
          the job, not code content. */}
      {!tutorialOn && (
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
      )}

      {canAsk ? (
        tutorialOn ? <TutorialTarget id="cai.run">{runButton}</TutorialTarget> : runButton
      ) : (
        <TouchableOpacity
          style={styles.runBtn}
          onPress={() => setShowPaywall(true)}
          activeOpacity={0.85}
          testID="construction-ask-upgrade"
        >
          <MageAIMark size={18} color="#FFF" />
          <Text style={styles.runBtnText}>See Business plan</Text>
        </TouchableOpacity>
      )}

      {/* Why the sample refused that question (a blocked control says why). */}
      {tutorialBlocked ? (
        <View style={styles.noticeCard} testID="construction-ask-tutorial-blocked">
          <Text style={styles.noticeText}>{tutorialBlocked}</Text>
        </View>
      ) : null}

      {/* ── Errors (graceful, never a crash) ── */}
      {errCode ? (
        <View style={styles.noticeCard} testID="construction-ask-error">
          {errCode === 'needs_business' ? (
            <TouchableOpacity onPress={() => setShowPaywall(true)} activeOpacity={0.8}>
              <Text style={styles.noticeText}>Construction answers are on the Business plan. Tap to see plans.</Text>
            </TouchableOpacity>
          ) : errCode === 'limit_reached' ? (
            <Text style={styles.noticeText}>{errMsg || "You've hit this month's Construction Answers limit."}</Text>
          ) : errCode === 'unauthenticated' ? (
            <TouchableOpacity onPress={() => router.push('/login')} activeOpacity={0.8}>
              <Text style={styles.noticeText}>Sign in to ask construction questions.</Text>
            </TouchableOpacity>
          ) : (
            // offline / timeout / server_error / not_configured — each says
            // what happened (CONSTRUCTION_ANSWER_COPY); the question stays in
            // the box, so Try again re-runs it without retyping.
            <>
              <Text style={styles.noticeText}>
                {errMsg || CONSTRUCTION_ANSWER_COPY[errCode as keyof typeof CONSTRUCTION_ANSWER_COPY] || CONSTRUCTION_ANSWER_COPY.server_error}
              </Text>
              {isRetryableConstructionError(errCode) ? (
                <TouchableOpacity
                  style={styles.retryBtn}
                  onPress={runAsk}
                  disabled={!canSubmit}
                  activeOpacity={0.8}
                  testID="construction-ask-retry"
                >
                  <RotateCcw size={14} color={Colors.primary} strokeWidth={2} />
                  <Text style={styles.retryText}>Try again</Text>
                </TouchableOpacity>
              ) : null}
            </>
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

          {groundingBlock ? (
            tutorialOn ? <TutorialTarget id="cai.consulted" style={styles.groundingWrap}>{groundingBlock}</TutorialTarget> : groundingBlock
          ) : null}

          {honestyBanner ? (
            tutorialOn ? <TutorialTarget id="cai.honesty">{honestyBanner}</TutorialTarget> : honestyBanner
          ) : null}
        </View>
      ) : null}
      </MaybeScrollAnchor>

      <Paywall
        visible={showPaywall}
        feature="Construction Answers"
        requiredTier="business"
        onClose={() => setShowPaywall(false)}
      />
      {/* Tutorial blocker: the Paywall sheet draws above the root layer, so
          while it is up the coach draws nothing. Run-only. */}
      {tutorialOn && showPaywall ? <TutorialTarget id="cai.askModalUp" /> : null}
    </ScrollView>
  );
}

/** The scroll anchor only during a tutorial run, so the tree is unchanged
 *  otherwise (a composite with no host View of its own when off). */
function MaybeScrollAnchor({ on, scrollRef, children }: {
  on: boolean; scrollRef: React.RefObject<ScrollView | null>; children: React.ReactNode;
}) {
  return on ? <TutorialScrollAnchor scrollRef={scrollRef}>{children}</TutorialScrollAnchor> : <>{children}</>;
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
  // accentFill, not Colors.primary, under the white labels here and on runBtn:
  // the dark-theme brand #5DB36E gives white 2.58:1 (accentFill 4.83:1). The
  // border is the fill's own edge, so it moves with it.
  chipActive: { backgroundColor: c.accentFill, borderColor: c.accentFill },
  chipText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: c.text, maxWidth: 160 },
  chipTextActive: { color: '#FFF' },
  recordNote: { fontSize: Type.caption1.fontSize, color: c.textMuted, lineHeight: 18, marginTop: 6 },
  presetList: { gap: 8, marginTop: 12 },
  presetPill: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: Tokens.radius.card,
    backgroundColor: c.surface, borderWidth: 1, borderColor: c.line,
  },
  presetPillText: { fontSize: Type.footnote.fontSize, color: c.textSecondary },
  runBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8,
    backgroundColor: c.accentFill, borderRadius: Tokens.radius.card, paddingVertical: 14, marginTop: 16,
  },
  runBtnDisabled: { opacity: 0.5 },
  runBtnText: { color: '#FFF', fontSize: Type.subhead.fontSize, fontWeight: '700' as const },
  noticeCard: {
    marginTop: 14, padding: 14, borderRadius: Tokens.radius.card,
    backgroundColor: c.surface, borderWidth: 1, borderColor: c.line,
  },
  noticeText: { fontSize: Type.footnote.fontSize, color: c.textSecondary, lineHeight: 20 },
  retryBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, alignSelf: 'flex-start' as const,
    marginTop: 10, paddingHorizontal: 12, paddingVertical: 7, borderRadius: Tokens.radius.panel,
    borderWidth: 1, borderColor: c.line, backgroundColor: c.bg,
  },
  retryText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: Colors.primary },
  consultedLabel: {
    fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: c.textMuted, letterSpacing: 0.5, marginBottom: 4,
  },
  consultedText: { fontSize: Type.caption1.fontSize, color: c.textMuted, lineHeight: 18 },
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
  // The tutorial's wrappers and its sample-question chip (alt surface — the
  // accent is never the background), in the same hole as the box.
  sampleWrap: { gap: 8 },
  groundingWrap: { gap: 12 },
  sampleChip: {
    padding: 12, gap: 4, borderRadius: Tokens.radius.card,
    backgroundColor: c.surfaceAlt, borderWidth: 1, borderColor: c.line,
  },
  sampleLabel: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: c.textSecondary, letterSpacing: 0.3 },
  sampleChipText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: c.text },
});
