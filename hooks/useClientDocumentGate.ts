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
import { useQueryClient } from '@tanstack/react-query';
import type { AppSettings, CompanyBranding, PaymentSplit, ProjectType } from '@/types';
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
import { PROFILE_LOADING_REASON, profileGateNotice, savedTermsView } from '@/utils/settingsLoadGuard';
import { portalsDisagreeingWithSplit } from '@/utils/projectContextPure';

/** How old the profile copy may be before a terms / warranty question re-reads
 *  it (#121). Another device may have answered since this one loaded. */
export const ASK_SETTINGS_FRESH_MS = 5_000;

/** The line shown when the re-read finds the answer another device saved. */
export function answeredElsewhereHint(question: 'terms' | 'warranty', fresh: Pick<AppSettings, 'paymentSplit' | 'warrantyMonths'>): string | null {
  if (question === 'terms') {
    const s = fresh.paymentSplit;
    if (!isValidSplit(s)) return null;
    return `Already saved on another device: ${s.depositPct} / ${s.progressPct} / ${s.finalPct}. Press to use it, or change it here.`;
  }
  const m = resolveWarrantyMonths(fresh as AppSettings);
  return m == null ? null : `Already saved on another device: ${m} months. Press to use it, or change it here.`;
}

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

/** Shown when a gate is pressed before the profile has loaded. The copy
 *  lives in utils/settingsLoadGuard (pure, so the validator can read it). */
export { PROFILE_LOADING_REASON };

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
  const { settings, settingsLoaded, settingsLoadFailed, sourceFailed, retryRemoteReads, projects, updateSettings, savePaymentTerms, updateProject } = useCoreData();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();
  // #121: the profile as the re-read below last found it, for this sheet only.
  // Context `settings` catches up a render later — or never, when a local edit
  // is newer — and "is this his FIRST set of terms" must not be answered from
  // a copy that predates the web's answer: that is how a second answer on the
  // iPhone stamped 30/60/10 over portals the web had already stamped 25/65/10.
  const freshSettingsRef = useRef<AppSettings | null>(null);
  const askSeqRef = useRef(0);

  // Before his profile has loaded, a gated press says why nothing happened
  // and offers Retry — which invalidates ['settings', userId] and cancels a
  // stalled read. When the read failed or timed out with no device copy, or
  // MAGE cannot be reached at all, it says so plainly and what still works,
  // instead of "try again in a second" for as long as the signal is gone
  // (finding 105). Retry is always offered: the press is the only thing that
  // would ever re-read settings on native.
  const refuseUntilLoaded = useCallback(() => {
    const notice = profileGateNotice({ failed: settingsLoadFailed || sourceFailed });
    showAlert(notice.title, notice.message, [
      { text: 'Not now', style: 'cancel' },
      { text: 'Retry', onPress: retryRemoteReads },
    ]);
  }, [settingsLoadFailed, sourceFailed, retryRemoteReads]);

  const [ask, setAsk] = useState<OpenAsk | null>(null);
  // The open sheet as of the last render, for the #121 re-read's callback.
  const askRef = useRef<OpenAsk | null>(null);
  useEffect(() => { askRef.current = ask; }, [ask]);
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

  // #121: before a terms / warranty question is answered, re-read his profile
  // if this device's copy is more than a few seconds old — the web may have
  // answered it since the iPhone loaded (no native focus refetch reached
  // settings). The sheet still opens in THIS press (the last press of the
  // sheet must keep the user gesture, see the header), and when the re-read
  // finds the answer, the step shows it pre-filled with where it came from.
  const refreshForAsk = useCallback((questions: readonly AskQuestion[]) => {
    freshSettingsRef.current = null;
    const seq = ++askSeqRef.current;
    if (!userId || !questions.some(q => q === 'terms' || q === 'warranty')) return;
    void queryClient.fetchQuery<AppSettings>({ queryKey: ['settings', userId], staleTime: ASK_SETTINGS_FRESH_MS })
      .then((fresh) => {
        if (askSeqRef.current !== seq || !fresh) return;
        freshSettingsRef.current = fresh;
        const cur = askRef.current;
        if (!cur || cur.mode !== 'run' || latchRef.current != null) return;
        const q = cur.questions[cur.stepIndex];
        if (q !== 'terms' && q !== 'warranty') return;
        const line = answeredElsewhereHint(q, fresh);
        if (!line) return;
        if (q === 'terms' && isValidSplit(fresh.paymentSplit)) {
          const sp = fresh.paymentSplit;
          setDraft((d) => ({ ...d, deposit: String(sp.depositPct), progress: String(sp.progressPct), final: String(sp.finalPct) }));
        } else if (q === 'warranty') {
          const m = resolveWarrantyMonths(fresh);
          if (m != null) setDraft((d) => ({ ...d, months: String(m) }));
        }
        setHint(line);
      })
      .catch(() => { /* the question stands; the saved copy decides as before */ });
  }, [queryClient, userId]);

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
      refuseUntilLoaded();
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
    refreshForAsk(questions);
    return 'asked';
  }, [settings, settingsLoaded, answersFrom, refuseUntilLoaded, refreshForAsk]);

  /** Company Profile / Settings: the same sheet, one step, pre-filled, "Save". */
  const edit = useCallback((question: 'terms' | 'warranty') => {
    // Pre-filling from DEFAULT would show blank terms he has in fact set.
    if (!settingsLoaded) {
      refuseUntilLoaded();
      return;
    }
    const split = resolvePaymentSplit({ settings }).split;
    const months = resolveWarrantyMonths(settings);
    askSeqRef.current += 1;
    freshSettingsRef.current = null;
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
  }, [settings, settingsLoaded, refuseUntilLoaded]);

  const dismiss = useCallback(() => {
    // Closing drops the paused action: nothing is sent.
    askSeqRef.current += 1;
    freshSettingsRef.current = null;
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
    // GC had it when he pressed THIS step — as freshly as this device knows it
    // (#121: the re-read above may have found another device's answer).
    const fresh = freshSettingsRef.current;
    const hadSplit = isValidSplit(settings.paymentSplit) || (!!fresh && isValidSplit(fresh.paymentSplit));
    const hadWarranty = resolveWarrantyMonths(settings) != null || (!!fresh && resolveWarrantyMonths(fresh) != null);
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
          // "…now all say X" only when it is true (#121): a portal already
          // stamped with DIFFERENT terms keeps them, so it counts against it.
          unconfirmedPortalCount = needing.length + portalsDisagreeingWithSplit(projects, userId, res.answers.split).length;
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

/**
 * His saved payment split and warranty for a LABEL, or why they are not known
 * yet (finding 106). Before the profile loads `settings` is DEFAULT_SETTINGS,
 * which has neither, so every "Payment terms · Not set" on Settings, Company
 * Profile, the wizard and the estimate review was false for a GC who had set
 * them. A screen shows `pendingLabel` while status is not 'ready', and offers
 * `retry` when it is 'failed'.
 */
export function useSavedPaymentTerms() {
  const { settings, settingsLoaded, settingsLoadFailed, sourceFailed, retryRemoteReads } = useCoreData();
  const failed = settingsLoadFailed || sourceFailed;
  const view = useMemo(
    () => savedTermsView({ settings, settingsLoaded, failed }),
    [settings, settingsLoaded, failed],
  );
  return { ...view, retry: retryRemoteReads };
}
