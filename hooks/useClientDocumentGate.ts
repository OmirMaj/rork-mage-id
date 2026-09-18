// hooks/useClientDocumentGate.ts — "ask when it matters", as one hook.
//
// A screen about to hand a client a document that prints the GC's identity,
// payment terms or warranty calls `gate.run(needs, then)`. If his profile (or
// this job's own record) already answers everything, `then` runs NOW, in the
// same press, and no sheet ever appears. Otherwise ONE sheet opens and asks
// one question per step — identity (only when the bid gate blocks), then
// "What deposit do you take?", then the warranty — saving each answer the
// moment its button is pressed, and the last press runs `then` with the
// answers as arguments.
//
// WHY `then` RUNS SYNCHRONOUSLY IN THE LAST PRESS. Three of the documents
// behind this gate leave the app through APIs that only work inside a user
// gesture: window.open for the web PDF print (utils/pdfGenerator), the web
// clipboard write for the proposal link, and — on iOS — a share sheet that
// must not be presented while a modal is still animating out. An `await`,
// setTimeout or InteractionManager hop before `then` loses the gesture on web
// (popup blocked, clipboard refused). The answers are passed IN rather than
// re-read from context because updateSettings / savePaymentTerms write
// through the offline queue and the caller's closure still holds the old
// settings. scripts/validate-payment-terms.ts checks the handler's shape.
//
// WHY THE LATCH. A press changes the sheet by state, and a second tap can land
// before React re-renders — on the last step that is two PDFs, two share
// sheets, two funnel events; on an earlier step it is the terms saved twice
// and every unconfirmed portal stamped twice with two different confirmedAt
// values. The ref latch holds the step index being submitted, so a second
// press on the SAME step is a no-op; a refusal (hint) releases it.
//
// WHY THE TOAST READS STEP FACTS. Each step records what it did (scope, "was
// this the first answer", portals stamped) at the press that answered it.
// Re-deriving that at the last press is wrong on a two-step sheet: the terms
// saved a step earlier have already re-rendered settings, so a GC's first
// ever answer would read as a change, and the warranty's own confirmation
// would never show.
//
// WHY `afterDismiss`. `then` keeps the gesture but runs while the sheet is
// still sliding out. A continuation that PRESENTS native UI on iOS (a share
// sheet, a second Modal) passes it as `opts.afterDismiss` instead: on iOS it
// waits for the Modal's onDismiss; everywhere else (RN Modal onDismiss is
// iOS-only) it runs straight after `then`, as it does when no sheet opened.
// Closing the sheet without answering drops it with `then`.
//
// Nothing here asks on mount or from an effect: every open is a press.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import type { CompanyBranding, PaymentSplit, ProjectType } from '@/types';
import { useCoreData } from '@/contexts/ProjectContext';
import { showAlert } from '@/utils/alert';
import { useAuth } from '@/contexts/AuthContext';
import { nailIt } from '@/components/animations/NailItToast';
import { bidIdentityGap, mergedBidBranding, type BidIdentityGap } from '@/utils/bidDocumentIdentity';
import {
  askStepCopy,
  confirmationForSheet,
  depositCapNote,
  missingQuestions,
  submitAskStep,
  termsLiveLine,
  warrantyLiveLine,
  type AskAnswers,
  type AskedSheetFacts,
  type AskDocumentNoun,
  type AskNeeds,
  type AskPurpose,
  type AskQuestion,
  type AskScope,
  type AskStepCopy,
} from '@/utils/clientDocumentAsk';
import {
  isValidSplit,
  nextProposalStamp,
  portalsNeedingTerms,
  resolvePaymentSplit,
  resolveWarrantyMonths,
  coerceWarrantyMonths,
} from '@/utils/paymentTerms';

export interface GateNeeds extends AskNeeds {
  purpose: Exclude<AskPurpose, 'edit'>;
  /** Offer "Just this contract / proposal" (contract purpose only). */
  justThisJob?: boolean;
  /** The job total, for "On this $400,000 job: …" and the California note. */
  total?: number | null;
  /** The job's type — a 'commercial' job gets no California down-payment note. */
  projectType?: ProjectType | null;
  documentNoun?: AskDocumentNoun;
}

export interface GateAnswers {
  /** The branding the document prints — the merged answer when identity was
   *  asked this press, otherwise the saved branding. */
  branding: CompanyBranding;
  split: PaymentSplit | null;
  warrantyMonths: number | null;
  /** How the split / warranty was answered in THIS sheet; null when it was not
   *  asked (the profile or the job's record already had it). */
  termsScope: AskScope | null;
  warrantyScope: AskScope | null;
}

/** A run with `terms: true` is handed a non-null split, and `warranty: true` a
 *  non-null month count, so a caller cannot print "not set". */
export type AnswersFor<N extends GateNeeds> = GateAnswers
  & (N extends { terms: true } ? { split: PaymentSplit } : unknown)
  & (N extends { warranty: true } ? { warrantyMonths: number } : unknown);

export interface AskDraft {
  companyName: string;
  licenseNumber: string;
  deposit: string;
  progress: string;
  final: string;
  months: string;
}

/** Shown when a gate is pressed before the profile has loaded. */
export const PROFILE_LOADING_REASON = 'Loading your company profile \u2014 try again in a second.';

const EMPTY_DRAFT: AskDraft = { companyName: '', licenseNumber: '', deposit: '', progress: '', final: '', months: '' };

/** Props for components/ClientDocumentAskSheet.tsx. */
export interface ClientDocumentAskSheetProps {
  visible: boolean;
  question: AskQuestion | null;
  copy: AskStepCopy | null;
  /** From the SAVED branding: decides whether the licence field renders. */
  identityGap: BidIdentityGap | null;
  draft: AskDraft;
  onChangeDraft: (patch: Partial<AskDraft>) => void;
  hint: string | null;
  termsLine: { kind: 'empty' | 'hint' | 'amounts'; text: string };
  warrantyLine: { kind: 'empty' | 'hint' | 'sentence'; text: string };
  /** California down-payment note, or null. Never blocks. */
  depositNote: string | null;
  onPrimary: () => void;
  onSecondary: (() => void) | null;
  onClose: () => void;
  /** iOS: runs once the sheet has finished sliding away (RN Modal onDismiss).
   *  For a continuation that presents native UI; the gate itself never waits. */
  onDismiss?: () => void;
}

interface OpenAsk {
  mode: 'run' | 'edit';
  questions: AskQuestion[];
  stepIndex: number;
  needs: GateNeeds | null;
  purpose: AskPurpose;
}

export function useClientDocumentGate() {
  const { settings, settingsLoaded, projects, updateSettings, savePaymentTerms, updateProject } = useCoreData();
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [ask, setAsk] = useState<OpenAsk | null>(null);
  const [draft, setDraft] = useState<AskDraft>(EMPTY_DRAFT);
  const [hint, setHint] = useState<string | null>(null);
  // The paused action. A ref, not state: it is a function, it must not render,
  // and dismiss must be able to drop it before any re-render.
  const thenRef = useRef<((answers: GateAnswers) => void) | null>(null);
  // The run's afterDismiss while the sheet is open; moved to pendingDismissRef
  // at the last press (iOS) so the Modal's onDismiss can run it exactly once.
  const afterDismissRef = useRef<(() => void) | null>(null);
  const pendingDismissRef = useRef<(() => void) | null>(null);
  // A `then` that navigates away unmounts the screen rendering the sheet, and
  // an unmounted Modal never fires onDismiss — the parked afterDismiss (the
  // share step) would be dropped with no sign. Run it on unmount instead: by
  // then the sheet is gone, which is all afterDismiss waits for.
  useEffect(() => () => {
    const parked = pendingDismissRef.current;
    pendingDismissRef.current = null;
    if (parked) parked();
  }, []);
  const answersRef = useRef<AskAnswers>({});
  // The step index whose press is being handled; null when none.
  const latchRef = useRef<number | null>(null);
  const factsRef = useRef<AskedSheetFacts>({});

  const answersFrom = useCallback((needs: GateNeeds | null, answered: AskAnswers): GateAnswers => {
    const recordMonths = coerceWarrantyMonths(needs?.recordWarrantyMonths ?? undefined);
    return {
      branding: answered.branding ?? mergedBidBranding(settings.branding, {}),
      split: answered.split ?? resolvePaymentSplit({ record: needs?.record, settings }).split,
      warrantyMonths: answered.warrantyMonths ?? recordMonths ?? resolveWarrantyMonths(settings),
      termsScope: answered.termsScope ?? null,
      warrantyScope: answered.warrantyScope ?? null,
    };
  }, [settings]);

  const run = useCallback(<N extends GateNeeds>(
    needs: N,
    then: (answers: AnswersFor<N>) => void,
    opts?: { afterDismiss?: () => void },
  ): 'ran' | 'asked' | 'waiting' => {
    // Before his profile has loaded `settings` is DEFAULT_SETTINGS, so every
    // question looks unanswered and he would be asked again what he already
    // told us (and the identity step would save DEFAULT contact details over
    // his row). Say why nothing happened instead; a second press after the
    // load works.
    if (!settingsLoaded) {
      showAlert('One second', PROFILE_LOADING_REASON);
      return 'waiting';
    }
    const questions = missingQuestions(needs, settings);
    if (questions.length === 0) {
      then(answersFrom(needs, {}) as AnswersFor<N>);
      // No sheet opened, so nothing is animating out.
      opts?.afterDismiss?.();
      return 'ran';
    }
    const gap = bidIdentityGap(settings.branding, settings.location);
    thenRef.current = then as (answers: GateAnswers) => void;
    afterDismissRef.current = opts?.afterDismiss ?? null;
    answersRef.current = {};
    factsRef.current = {};
    latchRef.current = null;
    setDraft({
      ...EMPTY_DRAFT,
      companyName: gap.needsCompanyName ? '' : (settings.branding.companyName ?? ''),
      licenseNumber: settings.branding.licenseNumber ?? '',
    });
    setHint(null);
    setAsk({ mode: 'run', questions, stepIndex: 0, needs, purpose: needs.purpose });
    return 'asked';
  }, [settings, settingsLoaded, answersFrom]);

  /** Company Profile / Settings: the same sheet, one step, pre-filled, "Save". */
  const edit = useCallback((question: 'terms' | 'warranty') => {
    // Pre-filling from DEFAULT would show blank terms he has in fact set.
    if (!settingsLoaded) {
      showAlert('One second', PROFILE_LOADING_REASON);
      return;
    }
    const split = resolvePaymentSplit({ settings }).split;
    const months = resolveWarrantyMonths(settings);
    thenRef.current = null;
    afterDismissRef.current = null;
    answersRef.current = {};
    factsRef.current = {};
    latchRef.current = null;
    setDraft({
      ...EMPTY_DRAFT,
      deposit: split ? String(split.depositPct) : '',
      progress: split ? String(split.progressPct) : '',
      final: split ? String(split.finalPct) : '',
      months: months != null ? String(months) : '',
    });
    setHint(null);
    setAsk({ mode: 'edit', questions: [question], stepIndex: 0, needs: null, purpose: 'edit' });
  }, [settings, settingsLoaded]);

  const dismiss = useCallback(() => {
    // Closing drops the paused action: nothing is sent.
    thenRef.current = null;
    afterDismissRef.current = null;
    answersRef.current = {};
    factsRef.current = {};
    latchRef.current = null;
    setHint(null);
    setAsk(null);
  }, []);

  const submit = useCallback((scope: AskScope) => {
    if (!ask || latchRef.current === ask.stepIndex) return;
    const question = ask.questions[ask.stepIndex];
    const stepCount = ask.questions.length;
    const res = submitAskStep(
      { stepIndex: ask.stepIndex, stepCount, profile: settings, answers: answersRef.current },
      question === 'identity'
        ? { question, companyName: draft.companyName, licenseNumber: draft.licenseNumber }
        : question === 'terms'
          ? { question, deposit: draft.deposit, progress: draft.progress, final: draft.final, scope }
          : { question, months: draft.months, scope },
    );
    if ('hint' in res) { setHint(res.hint); return; }
    latchRef.current = ask.stepIndex;

    // Captured BEFORE anything saves: "first time" is about the profile as the
    // GC had it when he pressed THIS step.
    const hadSplit = isValidSplit(settings.paymentSplit);
    const hadWarranty = resolveWarrantyMonths(settings) != null;
    let unconfirmedPortalCount = 0;

    for (const effect of res.effects) {
      if (effect === 'save_branding' && res.answers.branding) {
        updateSettings({ branding: res.answers.branding });
      } else if (effect === 'save_terms' && res.answers.split) {
        if (!savePaymentTerms({ split: res.answers.split })) {
          latchRef.current = null;
          setHint('Couldn’t save these terms — check the three percents and try again.');
          return;
        }
        if (!hadSplit) {
          // His first answer confirms every proposal he already published
          // without terms. A FIRST stamp needs no acceptance read: a proposal
          // without terms cannot be accepted, so no signed text changes.
          // Saved in the same press, merging only the stamp onto the saved
          // portal, so the next background push publishes identical text.
          const needing = portalsNeedingTerms(projects, userId);
          unconfirmedPortalCount = needing.length;
          const nowIso = new Date().toISOString();
          for (const p of needing) {
            if (!p.clientPortal) continue;
            const next = nextProposalStamp({ existing: p.clientPortal.proposalPaymentTerms, split: res.answers.split, acceptance: 'none', nowIso });
            if ('stamp' in next) {
              updateProject(p.id, { clientPortal: { ...p.clientPortal, proposalPaymentTerms: next.stamp } });
            }
          }
        }
      } else if (effect === 'save_warranty' && res.answers.warrantyMonths != null) {
        if (!savePaymentTerms({ warrantyMonths: res.answers.warrantyMonths })) {
          latchRef.current = null;
          setHint('Couldn’t save the warranty — enter a whole number of months from 1 to 120.');
          return;
        }
      }
    }

    // What this step did, for the toast.
    if (question === 'identity') {
      factsRef.current = { ...factsRef.current, identity: true };
    } else if (question === 'terms' && res.answers.split) {
      factsRef.current = { ...factsRef.current, terms: { scope, firstTime: !hadSplit, split: res.answers.split, unconfirmedPortalCount } };
    } else if (question === 'warranty' && res.answers.warrantyMonths != null) {
      factsRef.current = { ...factsRef.current, warranty: { scope, firstTime: !hadWarranty, months: res.answers.warrantyMonths } };
    }

    if (!res.done) {
      answersRef.current = res.answers;
      setHint(null);
      setAsk({ ...ask, stepIndex: ask.stepIndex + 1 });
      return;
    }

    // ── Last step. Close, confirm, and run the paused action IN THIS PRESS. ──
    // The latch stays on this step until the next run/edit resets it.
    const then = thenRef.current;
    const afterDismiss = afterDismissRef.current;
    const facts = factsRef.current;
    thenRef.current = null;
    afterDismissRef.current = null;
    answersRef.current = {};
    factsRef.current = {};
    const needs = ask.needs;
    const noun: AskDocumentNoun = needs?.documentNoun ?? (ask.purpose === 'contract' ? 'contract' : 'proposal');
    setHint(null);
    setAsk(null);
    nailIt(confirmationForSheet(facts, noun));
    if (then) then(answersFrom(needs, res.answers));
    if (afterDismiss) {
      if (Platform.OS === 'ios') pendingDismissRef.current = afterDismiss;
      else afterDismiss();
    }
  }, [ask, draft, settings, projects, userId, updateSettings, savePaymentTerms, updateProject, answersFrom]);

  const question = ask ? ask.questions[ask.stepIndex] : null;
  // The SAVED branding decides the identity step's copy and whether the
  // licence field exists — the same inputs the PDF gate uses.
  const identityGap = useMemo(
    () => (question === 'identity' ? bidIdentityGap(settings.branding, settings.location) : null),
    [question, settings.branding, settings.location],
  );

  const copy = useMemo<AskStepCopy | null>(() => {
    if (!ask || !question) return null;
    return askStepCopy(question, ask.purpose, {
      documentNoun: ask.needs?.documentNoun,
      stepIndex: ask.stepIndex,
      stepCount: ask.questions.length,
      justThisJob: ask.needs?.justThisJob,
      identityGap: identityGap ?? undefined,
    });
  }, [ask, question, identityGap]);

  const onChangeDraft = useCallback((patch: Partial<AskDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setHint(null);
  }, []);

  const onPrimary = useCallback(() => submit('profile'), [submit]);
  const onDismiss = useCallback(() => {
    const next = pendingDismissRef.current;
    pendingDismissRef.current = null;
    if (next) next();
  }, []);
  const onSecondaryPress = useCallback(() => submit('this_job'), [submit]);

  const sheet: ClientDocumentAskSheetProps = {
    visible: !!ask,
    question,
    copy,
    identityGap,
    draft,
    onChangeDraft,
    hint,
    termsLine: termsLiveLine(draft, ask?.needs?.total ?? null),
    warrantyLine: warrantyLiveLine(draft.months),
    depositNote: question === 'terms'
      ? depositCapNote({
        branding: settings.branding,
        location: settings.location,
        projectType: ask?.needs?.projectType ?? null,
        total: ask?.needs?.total ?? null,
      })?.text ?? null
      : null,
    onPrimary,
    onSecondary: copy?.secondaryLabel && question !== 'identity' ? onSecondaryPress : null,
    onClose: dismiss,
    onDismiss,
  };

  return { run, edit, dismiss, sheet };
}
