// defs/payAppPeriod.ts — "Fill in a pay application period".
// AIA-style pay apps are Pro (aia_pay_app); Free users practise on the sample
// through the practice pass, which app/aia-pay-app.tsx honours on the
// sample job only (never after "Different project", never for another
// project's invoice).
//
// THE TUTORIAL ENDS AT A SAVED DRAFT. The save point is the screen's plain
// "Save to project" (handleSave → addAIAPayApp): it certifies nothing and, on
// a sample, mints no pay link (utils/sampleGuard SAMPLE_DOC_NOT_SENT — the
// create-payment-link server fence refuses a sample too). Certifying is the
// "Generate PDF" slide and the architect's response is its own save; the
// tutorial only LOOKS at the architect's certificate with a sentence that
// says it happens on a real job. Data only.

import type { TutorialDef } from '../types';
import { formatUsd } from './invoiceToSelf';

const PAY = { pathname: '/aia-pay-app', projectParam: 'projectId' } as const;
const HUB = { pathname: '/project-detail', projectParam: 'id' } as const;

function usdCents(cents: number): string {
  return formatUsd(cents / 100);
}

export const payAppPeriod: TutorialDef = {
  id: 'pay-app-period',
  version: 1,
  title: 'Fill in a pay application period',
  seconds: 45,
  endsWith: 'A draft pay application for this period',
  group: 'money',
  personas: ['contractor', 'both'],
  fieldSeatOk: false,
  sandbox: 'sarahs-place',
  // The schedule of values is the linked estimate's lines.
  needs: ['estimateLines'],
  practiceFeatures: ['aia_pay_app'],
  start: {
    pathname: '/aia-pay-app',
    params: id => ({ projectId: id }),
    stackUnder: { pathname: '/project-detail', params: id => ({ id }) },
  },
  steps: [
    {
      // The screen is invoice-keyed: with two or more progress invoices on
      // the job it asks which one this pay app bills. With exactly one it
      // opens straight into the pay app, PERIOD TO is already mounted, and
      // this step completes on entry.
      id: 'pay-pick-period',
      kind: 'do',
      route: PAY,
      target: 'payApp.pickPeriod',
      text: 'Pick the progress invoice you are billing',
      detail: 'A pay app covers one billing period. Each period is a progress invoice.',
      gesture: 'tap',
      until: { mounted: 'payApp.periodTo' },
      checkpoint: true,
    },
    {
      id: 'pay-period-to',
      kind: 'do',
      route: PAY,
      // A period saved on an earlier run opens read-only (review mode) with
      // Edit draft in its banner: that button is lit first, then the field.
      target: ['payApp.editDraft', 'payApp.periodTo'],
      text: '{Tap} Edit draft, then set the period end',
      textByTarget: { 'payApp.periodTo': 'Set the period end, or use today' },
      detail: 'The last day of the work this pay app bills, as YYYY-MM-DD.',
      gesture: 'tap',
      until: { signal: 'payApp.period.set' },
      assist: 'payApp.usePeriodToday',
    },
    {
      id: 'pay-g703',
      kind: 'look',
      route: PAY,
      target: 'payApp.g703',
      text: 'These lines come from the estimate.',
      detail: 'Scheduled value is the whole contract line. This period is this bill.',
      gesture: 'none',
    },
    {
      id: 'pay-line',
      kind: 'do',
      route: PAY,
      target: ['payApp.lineProgress', 'payApp.g703'],
      text: "Enter this period's work on one line",
      textByTarget: { 'payApp.g703': "Type this period's work on one line" },
      detail: 'Type an amount, or {tap} a % to set how far along the line is.',
      gesture: 'tap',
      until: { signal: 'payApp.line.set' },
    },
    {
      id: 'pay-save',
      kind: 'do',
      route: PAY,
      target: 'payApp.saveDraft',
      text: '{Tap} Save to project',
      detail: 'Saved as a draft. Nothing is certified or sent.',
      gesture: 'tap',
      until: { signal: 'payApp.saved' },
      success: {
        title: 'Pay application saved as a draft',
        sub: ctx => {
          const s = ctx.payloads['payApp.saved'];
          if (!s) return 'Saved on the sample job';
          const parts: string[] = [];
          if (typeof s.applicationNumber === 'number' && s.applicationNumber > 0) parts.push(`Application #${s.applicationNumber}`);
          if (typeof s.currentDueCents === 'number' && s.currentDueCents > 0) parts.push(`${usdCents(s.currentDueCents)} due this period`);
          return parts.length > 0 ? parts.join(' · ') : 'Saved on the sample job';
        },
      },
    },
    {
      id: 'pay-certify',
      kind: 'look',
      route: PAY,
      target: 'payApp.certifyExplain',
      text: 'The architect certifies on a real job.',
      detail: 'When their certificate comes back, record the amount they certified here.',
      gesture: 'none',
    },
    {
      id: 'pay-back',
      kind: 'do',
      route: PAY,
      target: 'payApp.back',
      text: '{Tap} back to the job',
      gesture: 'tap',
      until: { route: HUB },
    },
    {
      id: 'pay-result',
      kind: 'look',
      route: HUB,
      target: ['hub.tile.invoices', 'hub.group.money'],
      text: 'Pay apps are filed with their invoices.',
      textByTarget: { 'hub.group.money': 'Pay apps are filed under Money.' },
      detail: 'Open the progress invoice to reach its pay app again.',
      gesture: 'none',
    },
  ],
  stat: {
    signal: 'payApp.saved',
    lead: 'Pay app drafted in',
    extras: p => {
      const c = p['payApp.saved']?.currentDueCents;
      return [typeof c === 'number' && c > 0 ? `${usdCents(c)} due` : null];
    },
  },
  handoff: {
    pathname: '/aia-pay-app',
    projectParam: 'projectId',
    realJobLabel: name => `Bill a period on ${name} →`,
    feature: 'aia_pay_app',
    paywallLabel: 'Pay apps come with Pro — see plans',
    roles: ['owner', 'editor'],
  },
};
