// hooks/useFirstJobCopy.ts — the ONLY place the "Your First Job" strings live.
// Every string goes through t('office.firstJob.*', english, vars) / tn(...),
// so the i18n registry stays in one file (surface 'office.first-job', Spanish
// in i18n/catalog/es/office/firstJob.ts). components/firstJob/* import this
// and add no t() keys of their own.
//
// WORDING (design-previews/copy-style/COPY-STYLE.md, and the founder's own
// sketch): a key ending in `Label` is a name or an action and is written with
// every word capitalised, the way the sketch he approved writes them ("Send It
// To Your Client", "Show Me The Usual Order"). A key ending in `Body` or `Note`
// is one or two whole sentences in sentence case. A key ending in `Sub` is a
// caption: capital first letter, no period. No em dashes, no "&", no "e.g.",
// no arrows. Never "unlimited". No promise about how right a number is: an
// estimate is "priced from your prices" and "a draft you check". AI steps say
// plainly that MAGE drafts and the person checks every line. A paid step names
// its plan before the tap. scripts/validate-first-job-path.ts reads the
// English shard and fails on any of these.
//
// Never call t() at module scope: the object is rebuilt when the language
// changes.
import { useMemo } from 'react';
import { useT } from '@/contexts/LanguageContext';
import type {
  FirstJobAnswer, FirstJobFinishStage, FirstJobPlan, FirstJobStepId,
} from '@/utils/firstJobPath';

export type FirstJobCtaKind = 'main' | 'createProject' | 'estimateFirst' | 'openEstimate';
export type FirstJobRowState = 'done' | 'skipped' | 'next' | 'todo' | 'checking';

export interface FirstJobCopy {
  heading: string;
  // ── the question ──
  questionLabel: string;
  questionBody: string;
  answerLabel: (a: FirstJobAnswer) => string;
  /** '' for "Not Sure", which is one line. */
  answerSub: (a: FirstJobAnswer) => string;
  // ── the header ──
  ringText: (done: number, total: number) => string;
  ringA11y: (done: number, total: number) => string;
  introLine: string;
  nextLine: (step: FirstJobStepId) => string;
  doneNextLine: (done: FirstJobStepId, next: FirstJobStepId) => string;
  skippedNextLine: (next: FirstJobStepId) => string;
  hideLabel: string;
  moreLabel: string;
  stageLabel: (s: FirstJobFinishStage) => string;
  // ── a step ──
  stepLabel: (id: FirstJobStepId) => string;
  stepBody: (id: FirstJobStepId) => string;
  ctaLabel: (id: FirstJobStepId, kind: FirstJobCtaKind) => string;
  stepA11y: (id: FirstJobStepId, position: number, total: number, state: FirstJobRowState) => string;
  skippedTagLabel: string;
  checkingTagLabel: string;
  skipLabel: string;
  showMeLabel: string;
  showMeA11y: string;
  practisedLabel: string;
  aiNote: string;
  needProjectNote: string;
  needEstimateNote: string;
  planLabel: (plan: FirstJobPlan) => string;
  planA11y: (plan: FirstJobPlan) => string;
  lockedNote: (plan: FirstJobPlan) => string;
  meteredNote: (left: number | null, plan: FirstJobPlan) => string;
  sendFreeNote: (plan: FirstJobPlan) => string;
  stripeNote: string;
  stripeLinkLabel: string;
  // ── hide / remove ──
  hiddenRowLabel: (done: number, total: number) => string;
  hiddenRowA11y: string;
  removeLabel: string;
  removeQuestion: string;
  removeBody: string;
  removeConfirmLabel: string;
  removeCancelLabel: string;
  // ── finish ──
  finishLabel: string;
  finishBody: string;
  finishStageSub: (s: FirstJobFinishStage) => string;
  finishCloseLabel: string;
}

const PLAN_NAME: Record<FirstJobPlan, string> = { pro: 'Pro', business: 'Business' };

export function useFirstJobCopy(): FirstJobCopy {
  const { t, tn } = useT();
  return useMemo<FirstJobCopy>(() => {
    const stepLabel = (id: FirstJobStepId): string => {
      switch (id) {
        case 'company': return t('office.firstJob.step.companyLabel', 'Add Your Company Name');
        case 'prices': return t('office.firstJob.step.pricesLabel', 'Add Your Prices');
        case 'estimate': return t('office.firstJob.step.estimateLabel', 'Price Your First Job');
        case 'send': return t('office.firstJob.step.sendLabel', 'Send It To Your Client');
        case 'schedule': return t('office.firstJob.step.scheduleLabel', 'Build The Schedule');
        case 'daily': return t('office.firstJob.step.dailyLabel', 'Log One Day On Site');
        case 'invoice': return t('office.firstJob.step.invoiceLabel', 'Send Your First Invoice');
      }
    };
    const stageLabel = (s: FirstJobFinishStage): string => {
      switch (s) {
        case 'win': return t('office.firstJob.stage.winLabel', 'Win It');
        case 'plan': return t('office.firstJob.stage.planLabel', 'Plan It');
        case 'build': return t('office.firstJob.stage.buildLabel', 'Build It');
        case 'paid': return t('office.firstJob.stage.paidLabel', 'Get Paid');
        case 'close': return t('office.firstJob.stage.closeLabel', 'Close It');
      }
    };
    const rowState = (s: FirstJobRowState): string => {
      switch (s) {
        case 'done': return t('office.firstJob.state.doneLine', 'Done');
        case 'skipped': return t('office.firstJob.state.skippedLine', 'Skipped');
        case 'next': return t('office.firstJob.state.nextLine', 'Next step');
        case 'checking': return t('office.firstJob.state.checkingLine', 'Checking');
        case 'todo': return t('office.firstJob.state.todoLine', 'Not started');
      }
    };
    return {
      heading: t('office.firstJob.headingLabel', 'Your First Job'),

      questionLabel: t('office.firstJob.question.titleLabel', 'What Do You Want To Do First?'),
      questionBody: t('office.firstJob.question.body', 'Your path starts there. Every other step still follows, so nothing gets missed.'),
      answerLabel: (a) => {
        switch (a) {
          case 'price': return t('office.firstJob.answer.priceLabel', 'Price A Job');
          case 'schedule': return t('office.firstJob.answer.scheduleLabel', 'Schedule A Job');
          case 'bill': return t('office.firstJob.answer.billLabel', 'Bill A Client');
          case 'site': return t('office.firstJob.answer.siteLabel', 'Run The Site');
          case 'unsure': return t('office.firstJob.answer.unsureLabel', 'Not Sure. Show Me The Usual Order');
        }
      },
      answerSub: (a) => {
        switch (a) {
          case 'price': return t('office.firstJob.answer.priceSub', 'Get a number to a client today');
          case 'schedule': return t('office.firstJob.answer.scheduleSub', 'Lay out the work week by week');
          case 'bill': return t('office.firstJob.answer.billSub', 'Send an invoice and get paid');
          case 'site': return t('office.firstJob.answer.siteSub', 'Daily reports, photos and punch lists');
          case 'unsure': return '';
        }
      },

      ringText: (done, total) => t('office.firstJob.ring.text', '{done} of {total}', { done, total }),
      ringA11y: (done, total) => t('office.firstJob.ring.a11y', '{done} of {total} steps done.', { done, total }),
      introLine: t('office.firstJob.line.introBody', 'Seven steps. Skip any you do not need.'),
      nextLine: (step) => t('office.firstJob.line.next', 'Next: {step}', { step: stepLabel(step) }),
      doneNextLine: (done, next) => t('office.firstJob.line.doneNext', 'Done: {done}. Next: {next}', { done: stepLabel(done), next: stepLabel(next) }),
      skippedNextLine: (next) => t('office.firstJob.line.skippedNext', 'Skipped. Next: {next}', { next: stepLabel(next) }),
      hideLabel: t('office.firstJob.hideLabel', 'Hide'),
      moreLabel: t('office.firstJob.moreLabel', 'More'),
      stageLabel,

      stepLabel,
      stepBody: (id) => {
        switch (id) {
          case 'company': return t('office.firstJob.step.companyBody', 'Everything you send to a client carries it. It takes about 30 seconds.');
          case 'prices': return t('office.firstJob.step.pricesBody', 'Tell MAGE what you charge for labor and materials. Every estimate after this starts from your numbers.');
          case 'estimate': return t('office.firstJob.step.estimateBody', 'Describe the job in your own words. MAGE drafts the estimate from your prices.');
          case 'send': return t('office.firstJob.step.sendBody', 'A number only wins work once the client has it. Send a proposal, or share the estimate as a PDF.');
          case 'schedule': return t('office.firstJob.step.scheduleBody', 'Lay the work out week by week. MAGE can draft it from the estimate you already made.');
          case 'daily': return t('office.firstJob.step.dailyBody', 'Who was there, what got done, and a few photos. One report you can share with your client.');
          case 'invoice': return t('office.firstJob.step.invoiceBody', 'Bill from the estimate you already wrote. No typing it twice.');
        }
      },
      ctaLabel: (id, kind) => {
        if (kind === 'createProject') return t('office.firstJob.cta.createProjectLabel', 'Create The Project First');
        if (kind === 'estimateFirst') return t('office.firstJob.cta.estimateFirstLabel', 'Price A Job First');
        if (kind === 'openEstimate') return t('office.firstJob.cta.openEstimateLabel', 'Open The Estimate');
        switch (id) {
          case 'company': return t('office.firstJob.cta.companyLabel', 'Add Company Name');
          case 'prices': return t('office.firstJob.cta.pricesLabel', 'Add Prices');
          case 'estimate': return t('office.firstJob.cta.estimateLabel', 'Price A Job');
          case 'send': return t('office.firstJob.cta.sendLabel', 'Send Proposal');
          case 'schedule': return t('office.firstJob.cta.scheduleLabel', 'Build Schedule');
          case 'daily': return t('office.firstJob.cta.dailyLabel', 'Start A Report');
          case 'invoice': return t('office.firstJob.cta.invoiceLabel', 'Create Invoice');
        }
      },
      stepA11y: (id, position, total, state) => t('office.firstJob.step.a11y', '{step}. Step {position} of {total}. {state}.', {
        step: stepLabel(id), position, total, state: rowState(state),
      }),
      skippedTagLabel: t('office.firstJob.tag.skippedLabel', 'Skipped'),
      checkingTagLabel: t('office.firstJob.tag.checkingLabel', 'Checking'),
      skipLabel: t('office.firstJob.skipLabel', 'Skip'),
      showMeLabel: t('office.firstJob.showMeLabel', 'Show Me First'),
      showMeA11y: t('office.firstJob.showMe.a11y', 'Show me first. Practise this step on a sample job.'),
      practisedLabel: t('office.firstJob.practisedLabel', 'Practised On The Sample'),
      aiNote: t('office.firstJob.note.aiNote', 'MAGE drafts this with AI, and you check every line before it goes anywhere. It counts toward the AI allowance on your plan.'),
      needProjectNote: t('office.firstJob.note.needProjectNote', 'This step lives inside a project. Create the project, then come back here.'),
      needEstimateNote: t('office.firstJob.note.needEstimateNote', 'There is no estimate to send yet. Price a job first.'),
      planLabel: (plan) => PLAN_NAME[plan],
      planA11y: (plan) => t('office.firstJob.plan.a11y', 'Needs the {plan} plan.', { plan: PLAN_NAME[plan] }),
      lockedNote: (plan) => t('office.firstJob.note.lockedNote', 'This opens with the {plan} plan. The button shows you the plans first.', { plan: PLAN_NAME[plan] }),
      meteredNote: (left, plan) => (left == null
        ? t('office.firstJob.note.meteredUnknownNote', 'A free plan includes a small number of AI estimates. After that it needs the {plan} plan.', { plan: PLAN_NAME[plan] })
        : tn('office.firstJob.note.meteredNote', left, {
          one: '1 free AI estimate left. After that it needs the {plan} plan.',
          other: '{count} free AI estimates left. After that it needs the {plan} plan.',
        }, { plan: PLAN_NAME[plan] })),
      sendFreeNote: (plan) => t('office.firstJob.note.sendFreeNote', 'A proposal your client signs on a phone needs the {plan} plan. Sharing the estimate as a PDF is free, and it counts.', { plan: PLAN_NAME[plan] }),
      stripeNote: t('office.firstJob.note.stripeNote', 'Want card payments? Set up Stripe when you are ready. Card payments carry processing fees.'),
      stripeLinkLabel: t('office.firstJob.stripeLinkLabel', 'Set Up Stripe'),

      hiddenRowLabel: (done, total) => t('office.firstJob.hiddenRowLabel', 'Your First Job: {done} Of {total} Done', { done, total }),
      hiddenRowA11y: t('office.firstJob.hiddenRow.a11y', 'Opens your first job path.'),
      removeLabel: t('office.firstJob.removeLabel', 'Remove'),
      removeQuestion: t('office.firstJob.remove.question', 'Remove this card for good?'),
      removeBody: t('office.firstJob.remove.body', 'Your work stays where it is. Every tool is still in Discover.'),
      removeConfirmLabel: t('office.firstJob.remove.confirmLabel', 'Remove'),
      removeCancelLabel: t('office.firstJob.remove.cancelLabel', 'Keep It'),

      finishLabel: t('office.firstJob.finish.titleLabel', 'You Ran A Whole Job'),
      finishBody: t('office.firstJob.finish.body', 'The path is done, and this card will not come back. Every tool lives under one of these five stages.'),
      finishStageSub: (s) => {
        switch (s) {
          case 'win': return t('office.firstJob.finish.winSub', 'Your prices, estimates and proposals');
          case 'plan': return t('office.firstJob.finish.planSub', 'Schedules and lookaheads');
          case 'build': return t('office.firstJob.finish.buildSub', 'Daily reports, photos and punch lists');
          case 'paid': return t('office.firstJob.finish.paidSub', 'Invoices and payments');
          case 'close': return t('office.firstJob.finish.closeSub', 'Warranties and handover');
        }
      },
      finishCloseLabel: t('office.firstJob.finish.closeLabel', 'Done'),
    };
  }, [t, tn]);
}
