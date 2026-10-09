// defs/fieldTicketLog.ts — "Log extra work on a field ticket".
// T&M tickets sit behind change_orders_invoicing (Pro); Free users practise on
// the sample through the practice pass, which app/field-ticket.tsx reads for
// the sample's own tickets only. The tutorial saves the ticket UNSIGNED:
// signing is a legal act on site, and Get signature / the signature pad are
// never lit, queued or practised. No photo step (FQ-A2: the punch walk teaches
// the camera). Data only.

import type { TutorialDef } from '../types';

const FT = { pathname: '/field-ticket', projectParam: 'projectId' } as const;
const HUB = { pathname: '/project-detail', projectParam: 'id' } as const;

export const fieldTicketLog: TutorialDef = {
  id: 'field-ticket-log',
  version: 1,
  title: 'Log Extra Work on a T&M Ticket',
  seconds: 35,
  endsWith: 'An unsigned ticket you can price or sign later',
  group: 'site',
  personas: ['contractor', 'both'],
  fieldSeatOk: true,
  sandbox: 'sarahs-place',
  needs: [],
  practiceFeatures: ['change_orders_invoicing'],
  start: {
    // start=1 opens the composer (app/field-ticket.tsx).
    pathname: '/field-ticket',
    params: id => ({ projectId: id, start: '1' }),
    stackUnder: { pathname: '/project-detail', params: id => ({ id }) },
  },
  steps: [
    {
      id: 'ticket-work',
      kind: 'do',
      route: FT,
      target: 'ticket.work',
      text: 'Say what the crew did, or use the sample',
      detail: 'Sample: a new island circuit, 3 electrician hours.',
      gesture: 'tap',
      until: { signal: 'ticket.work.filled' },
      assist: 'ticket.useSampleWork',
      checkpoint: true,
    },
    {
      id: 'ticket-reason',
      kind: 'do',
      route: FT,
      target: 'ticket.reason',
      text: "{Tap} why it's extra",
      detail: 'One reason chip is enough. Typing is optional.',
      gesture: 'tap',
      until: { signal: 'ticket.reason.filled' },
      assist: 'ticket.useSampleReason',
    },
    {
      id: 'ticket-price',
      kind: 'look',
      route: FT,
      target: 'ticket.price',
      text: 'O&P is optional. Rates come after the signature.',
      detail: 'On saved tickets, field seats see hours and quantities, not money.',
      gesture: 'none',
    },
    {
      id: 'ticket-save',
      kind: 'do',
      route: FT,
      target: 'ticket.saveUnsigned',
      text: '{Tap} Save',
      detail: 'Saved unsigned. Get it signed on site when the work is done.',
      gesture: 'tap',
      until: { signal: 'ticket.saved' },
      success: {
        title: 'Ticket Saved, Unsigned',
        sub: () => 'A note for now. A signature makes it billable.',
      },
    },
    {
      id: 'ticket-convert',
      kind: 'look',
      route: FT,
      target: 'ticket.convert',
      text: 'Once signed, this turns it into a change order.',
      detail: "Unsigned, it can't be billed yet. The owner's rep signs it on site.",
      gesture: 'none',
    },
    {
      id: 'ticket-back',
      kind: 'do',
      route: FT,
      target: 'ticket.back',
      text: '{Tap} back to the job',
      gesture: 'tap',
      until: { route: HUB },
    },
    {
      id: 'ticket-result',
      kind: 'look',
      route: HUB,
      target: ['hub.tile.fieldTickets', 'hub.group.field'],
      text: 'T&M tickets live here.',
      textByTarget: { 'hub.group.field': 'T&M tickets are under Field Ops.' },
      // The tile's badge counts SIGNED tickets only (app/project-detail), so
      // the copy must not claim his unsigned ticket is counted.
      detail: 'The number on the tile counts signed tickets, not drafts.',
      gesture: 'none',
    },
  ],
  stat: {
    signal: 'ticket.saved',
    lead: 'Ticket logged in',
  },
  handoff: {
    pathname: '/field-ticket',
    projectParam: 'projectId',
    params: { start: '1' },
    realJobLabel: name => `Log Extra Work on ${name}`,
    feature: 'change_orders_invoicing',
    paywallLabel: 'T&M Tickets Come with Pro: See Plans',
    roles: ['owner', 'editor', 'field'],
  },
  chainNext: { tutorialId: 'change-order-draft', label: 'Next: write a change order · 40 s' },
};
