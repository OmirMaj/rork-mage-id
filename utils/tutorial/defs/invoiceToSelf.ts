// defs/invoiceToSelf.ts — "Bill the job and see what your client gets".
// Invoicing is Pro; Free users practise it on the sample through the practice
// pass (change_orders_invoicing). On a sample the send is locked to the
// signed-in user's own email and no pay link is minted (utils/sampleGuard +
// the create-payment-link server fence), so the only person who gets the
// invoice is him. Data only.

import type { CopyCtx, TutorialDef } from '../types';

const INV = { pathname: '/invoice', projectParam: 'projectId' } as const;
const HUB = { pathname: '/project-detail', projectParam: 'id' } as const;

/** '$63,360' — whole dollars when the total is whole, else cents. */
export function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return '';
  const whole = Math.abs(n - Math.round(n)) < 0.005;
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  });
}

/** The real total from the latest signal that carried one. */
function billedTotal(ctx: CopyCtx): number | null {
  const sent = ctx.payloads['invoice.sent']?.total;
  if (typeof sent === 'number' && sent > 0) return sent;
  const set = ctx.payloads['invoice.amount.set']?.total;
  return typeof set === 'number' && set > 0 ? set : null;
}

function invoiceNumber(ctx: CopyCtx): number | null {
  const n = ctx.payloads['invoice.sent']?.number;
  return typeof n === 'number' && n > 0 ? n : null;
}

export const invoiceToSelf: TutorialDef = {
  id: 'invoice-to-self',
  version: 1,
  title: 'Bill the job and see what your client gets',
  seconds: 40,
  endsWith: "The client's copy of the invoice in your inbox",
  group: 'money',
  personas: ['contractor', 'both'],
  fieldSeatOk: false,
  sandbox: 'sarahs-place',
  needs: ['estimateLines'],
  practiceFeatures: ['change_orders_invoicing'],
  start: {
    pathname: '/invoice',
    params: id => ({ projectId: id, type: 'progress' }),
    stackUnder: { pathname: '/project-detail', params: id => ({ id }) },
  },
  steps: [
    {
      id: 'invoice-percent',
      kind: 'do',
      route: INV,
      target: 'invoice.percent',
      text: 'Bill 15% for the rough-in',
      detail: 'Lines come straight from the estimate — nothing to retype.',
      gesture: 'tap',
      until: { signal: 'invoice.amount.set' },
      assist: 'invoice.fillPercent',
      checkpoint: true,
    },
    {
      id: 'invoice-totals',
      kind: 'look',
      route: INV,
      target: 'invoice.totals',
      text: ctx => {
        const t = billedTotal(ctx);
        return t !== null ? `${formatUsd(t)} due — tax and terms come from the job.` : 'Tax and terms come from the job.';
      },
      gesture: 'none',
    },
    {
      id: 'invoice-send',
      kind: 'do',
      route: INV,
      target: 'invoice.send',
      text: '{Tap} Send to me — see what Sarah gets',
      detail: 'Sample job — it goes to you, not a client. No pay link is made.',
      gesture: 'tap',
      until: { signal: 'invoice.sent' },
      failOn: 'invoice.send.failed',
    },
    {
      // NEVER the current step: it shares invoice.sent with 'invoice-send',
      // so the signal completes both together (machine completeRun) and
      // SKIP_STEP skips both together; validate-tutorial-defs pins that a
      // wait step always sits behind a do step with the same `until`. It
      // exists to carry the success stamp (the last step of the block
      // celebrates) and to name the sheet in the def.
      // What keeps the coach off the send sheet is NOT this step: while the
      // sheet (or any other layer-less invoice modal) is up, app/invoice.tsx
      // mounts the 'invoice.modalUp' blocker sentinel and coachView draws
      // nothing — 'invoice-send' is still current underneath, and cancelling
      // the sheet unmounts the sentinel and brings its spotlight back.
      id: 'invoice-sheet',
      kind: 'wait',
      route: INV,
      text: 'Send it from the sheet — it goes to you only.',
      until: { signal: 'invoice.sent' },
      failOn: 'invoice.send.failed',
      success: {
        title: ctx => {
          const n = invoiceNumber(ctx);
          return n !== null ? `Invoice #${n} sent to you` : 'Invoice sent to you';
        },
        sub: ctx => {
          const parts: string[] = [];
          const t = billedTotal(ctx);
          if (t !== null) parts.push(formatUsd(t));
          const to = ctx.payloads['invoice.sent']?.to || ctx.userEmail;
          parts.push(to ? `check ${to}` : 'check your inbox');
          return parts.join(' · ');
        },
      },
    },
    {
      id: 'invoice-result',
      kind: 'look',
      route: HUB,
      target: ['hub.tile.invoices', 'hub.group.money'],
      text: ctx => {
        const n = invoiceNumber(ctx);
        // No number means no invoice.sent this run (he skipped the send), so
        // the copy must not claim an invoice that was never made.
        return n !== null ? `Invoice #${n} is filed here.` : 'Invoices are filed here.';
      },
      textByTarget: { 'hub.group.money': 'Invoices are filed under Money.' },
      detail: 'On a real job, a card payment through Pay marks it Paid on its own.',
      gesture: 'none',
    },
  ],
  stat: {
    signal: 'invoice.sent',
    lead: 'Invoice out in',
    extras: p => [p['invoice.sent'] ? "the client's copy went to your inbox" : null],
  },
  handoff: {
    pathname: '/invoice',
    projectParam: 'projectId',
    realJobLabel: name => `Bill ${name} →`,
    feature: 'change_orders_invoicing',
    paywallLabel: 'Invoicing comes with Pro — see plans',
    roles: ['owner', 'editor'],
    offerStripe: true,
  },
};
