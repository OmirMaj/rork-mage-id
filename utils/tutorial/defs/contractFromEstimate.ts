// defs/contractFromEstimate.ts — "Set up a contract from the estimate".
// Contracts are Pro (client_portal); Free users practise on the sample through
// the practice pass, which app/contract.tsx reads for the sample job only.
//
// THE TUTORIAL TEACHES THE SET-UP AND NEVER THE LEGAL ACT. It lights the
// contract sum, sets the timeline and the payment terms, saves the DRAFT, and
// then LOOKS at Sign & send with a sentence that says signing happens with the
// client on a real job. Nothing is signed, sealed, sent or queued: on a sample
// app/contract.tsx refuses Sign & send, Sign together and every delivery
// (utils/sampleGuard SAMPLE_DOC_NOT_SENT), whether or not a run is live.
//
// SIGNALS. contract.timeline.set fires when the draft on screen carries BOTH
// halves of the timeline (the screen has no timeline save of its own; the
// draft save writes it). contract.terms.set fires only after the screen's own
// saveDraftFrom has written the draft with a payment schedule on it — the
// stamp is a confirmed write. Data only.

import type { CopyCtx, TutorialDef } from '../types';
import { formatCalendarDay } from '@/utils/calendarDate';

const CONTRACT = { pathname: '/contract', projectParam: 'projectId' } as const;
const HUB = { pathname: '/project-detail', projectParam: 'id' } as const;

/** 'Starts Oct 5 · 120 days', from the saved draft (else the filled one). */
function timelineLine(ctx: CopyCtx): string | null {
  const saved = ctx.payloads['contract.terms.set'];
  const filled = ctx.payloads['contract.timeline.set'];
  const start = saved?.startDate ?? filled?.startDate;
  const days = saved?.durationDays ?? filled?.durationDays;
  if (!start || typeof days !== 'number' || days <= 0) return null;
  const label = formatCalendarDay(start, { month: 'short', day: 'numeric' });
  if (!label) return null;
  return `Starts ${label} · ${days} day${days === 1 ? '' : 's'}`;
}

export const contractFromEstimate: TutorialDef = {
  id: 'contract-from-estimate',
  version: 1,
  title: 'Set Up a Contract from the Estimate',
  seconds: 45,
  endsWith: 'Start date and payment terms set, ready to sign',
  group: 'client',
  personas: ['contractor', 'both'],
  fieldSeatOk: false,
  sandbox: 'sarahs-place',
  // estimateLines: the contract sum comes from the estimate. schedule: the
  // "Use my schedule" suggestion is built from the job's schedule
  // (utils/contractTimelineCore suggestContractTimeline) — without one the
  // timeline step has no one-tap answer.
  needs: ['estimateLines', 'schedule'],
  practiceFeatures: ['client_portal'],
  start: {
    pathname: '/contract',
    params: id => ({ projectId: id }),
    stackUnder: { pathname: '/project-detail', params: id => ({ id }) },
  },
  steps: [
    {
      id: 'contract-sum',
      kind: 'look',
      route: CONTRACT,
      target: 'contract.sum',
      text: 'The contract sum comes from the estimate.',
      detail: 'Change it here if the price you agreed is different.',
      gesture: 'none',
      checkpoint: true,
    },
    {
      id: 'contract-timeline',
      kind: 'do',
      route: CONTRACT,
      target: 'contract.timeline',
      text: '{Tap} Use my schedule, or pick a start date',
      detail: 'A start date and a length in days. Both are binding terms.',
      gesture: 'tap',
      until: { signal: 'contract.timeline.set' },
    },
    {
      id: 'contract-review',
      kind: 'look',
      route: CONTRACT,
      target: ['contract.reviewNotice', 'contract.warranty'],
      text: 'Read the terms and warranty before you sign.',
      detail: 'Your client signs exactly what is written here.',
      gesture: 'none',
    },
    {
      id: 'contract-terms',
      kind: 'do',
      route: CONTRACT,
      target: ['contract.paymentTerms', 'contract.saveDraft'],
      text: '{Tap} Set your payment terms',
      textByTarget: { 'contract.saveDraft': '{Tap} Save draft' },
      detail: 'Deposit, progress and final. Saving puts them on the draft.',
      gesture: 'tap',
      until: { signal: 'contract.terms.set' },
      success: {
        title: 'Draft Saved with Your Terms',
        sub: ctx => {
          const parts: string[] = [];
          const t = timelineLine(ctx);
          if (t) parts.push(t);
          if (ctx.payloads['contract.terms.set']?.warrantySet === false) parts.push('set the warranty before signing');
          return parts.length > 0 ? parts.join(' · ') : 'Saved on the sample job';
        },
      },
    },
    {
      id: 'contract-sign',
      kind: 'look',
      route: CONTRACT,
      target: 'contract.sign',
      text: 'Signing happens with your client on a real job.',
      detail: 'Sign and Send emails your client a link to sign. It stays off on the sample.',
      gesture: 'none',
    },
    {
      id: 'contract-back',
      kind: 'do',
      route: CONTRACT,
      target: 'contract.back',
      text: '{Tap} back to the job',
      gesture: 'tap',
      until: { route: HUB },
    },
    {
      id: 'contract-result',
      kind: 'look',
      route: HUB,
      target: ['hub.tile.contract', 'hub.group.money'],
      text: ctx => (ctx.payloads['contract.terms.set'] ? 'Your draft contract is filed here.' : 'Contracts are filed here.'),
      textByTarget: { 'hub.group.money': 'Contracts are filed under Money.' },
      detail: 'Open it on a real job when your client is ready to sign.',
      gesture: 'none',
    },
  ],
  stat: {
    signal: 'contract.terms.set',
    lead: 'Contract set up in',
    extras: p => {
      const s = p['contract.terms.set'];
      return [s && typeof s.durationDays === 'number' && s.durationDays > 0 ? `${s.durationDays} days` : null];
    },
  },
  handoff: {
    pathname: '/contract',
    projectParam: 'projectId',
    realJobLabel: name => `Set up the contract on ${name}`,
    feature: 'client_portal',
    paywallLabel: 'Contracts come with Pro. See plans.',
    // Only the project owner's account can send the signing link.
    roles: ['owner'],
  },
  chainNext: { tutorialId: 'pay-app-period', label: 'Next: bill the first period · 45 s' },
};
