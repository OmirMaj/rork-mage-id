// defs/changeOrderDraft.ts — "Write a change order".
// Change orders are Pro; Free users practise on the sample through the
// practice pass (change_orders_invoicing), which app/change-order.tsx reads for
// a NEW change order on the sample (or one of the sample's own) only. The
// tutorial ends at a saved DRAFT: Send & Save is never lit, and on a sample a
// send could only ever reach his own address (utils/sampleGuard). Data only.

import type { CopyCtx, TutorialDef } from '../types';
import { formatUsd } from './invoiceToSelf';

const CO = { pathname: '/change-order', projectParam: 'projectId' } as const;
const HUB = { pathname: '/project-detail', projectParam: 'id' } as const;

function usdCents(cents: number): string {
  return formatUsd(cents / 100);
}

/** The saved change order's total, else the line total so far. */
function coTotalCents(ctx: CopyCtx): number | null {
  const saved = ctx.payloads['co.saved']?.totalCents;
  if (typeof saved === 'number' && saved > 0) return saved;
  const line = ctx.payloads['co.line.added']?.totalCents;
  return typeof line === 'number' && line > 0 ? line : null;
}

export const changeOrderDraft: TutorialDef = {
  id: 'change-order-draft',
  version: 1,
  title: 'Write a Change Order',
  seconds: 40,
  endsWith: 'A draft change order with its price and days',
  group: 'money',
  personas: ['contractor', 'both'],
  fieldSeatOk: false,
  sandbox: 'sarahs-place',
  needs: [],
  practiceFeatures: ['change_orders_invoicing'],
  start: {
    // new=1 is the create signal: on desktop web a bare ?projectId opens the
    // change-order LOG (utils/logs/logRoutes), new=1 opens the form.
    pathname: '/change-order',
    params: id => ({ projectId: id, new: '1' }),
    stackUnder: { pathname: '/project-detail', params: id => ({ id }) },
  },
  steps: [
    {
      id: 'co-description',
      kind: 'do',
      route: CO,
      target: 'co.description',
      text: 'Say what changed, or use the sample',
      detail: 'Sample: a recessed light over the island.',
      gesture: 'tap',
      until: { signal: 'co.description.filled' },
      assist: 'co.useSampleChange',
      checkpoint: true,
    },
    {
      id: 'co-add-line',
      kind: 'do',
      route: CO,
      target: 'co.addItem',
      text: '{Tap} Custom and price one line',
      detail: 'Enter what it costs you. The sheet adds your markup on top.',
      gesture: 'tap',
      until: { signal: 'co.line.added' },
      assist: 'co.fillSampleLine',
    },
    {
      id: 'co-days',
      kind: 'look',
      route: CO,
      target: 'co.scheduleImpact',
      text: 'Days this change adds to the job go here.',
      detail: 'Leave it empty if the change adds no time.',
      gesture: 'none',
    },
    {
      id: 'co-save',
      kind: 'do',
      route: CO,
      target: 'co.saveDraft',
      text: '{Tap} Save to Project',
      detail: 'Saved as a draft. Sending to a client happens on a real job.',
      gesture: 'tap',
      until: { signal: 'co.saved' },
      success: {
        title: 'Change Order Saved as a Draft',
        sub: ctx => {
          const parts: string[] = [];
          const t = coTotalCents(ctx);
          if (t !== null) parts.push(usdCents(t));
          const d = ctx.payloads['co.saved']?.days;
          if (typeof d === 'number' && d > 0) parts.push(`adds ${d} day${d === 1 ? '' : 's'}`);
          else if (ctx.payloads['co.saved']) parts.push('no days added');
          return parts.length > 0 ? parts.join(' · ') : 'Filed on the sample job';
        },
      },
    },
    {
      id: 'co-result',
      kind: 'look',
      route: HUB,
      target: ['hub.tile.changeOrders', 'hub.group.money'],
      // No "CO #n": a new change order's number is provisional until the
      // server confirms it (#141), so the copy never prints a guess.
      text: ctx => (ctx.payloads['co.saved'] ? 'Your draft change order is filed here.' : 'Change orders are filed here.'),
      textByTarget: { 'hub.group.money': 'Change orders are filed under Money.' },
      detail: 'Sending it for approval is the next step, on a real job.',
      gesture: 'none',
    },
  ],
  stat: {
    signal: 'co.saved',
    lead: 'Change order written in',
    extras: p => {
      const c = p['co.saved']?.totalCents;
      return [typeof c === 'number' && c > 0 ? usdCents(c) : null];
    },
  },
  handoff: {
    pathname: '/change-order',
    projectParam: 'projectId',
    params: { new: '1' },
    realJobLabel: name => `Write a change order on ${name} →`,
    feature: 'change_orders_invoicing',
    paywallLabel: 'Change orders come with Pro — see plans',
    roles: ['owner', 'editor'],
  },
};
