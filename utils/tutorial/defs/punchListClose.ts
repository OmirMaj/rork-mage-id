// defs/punchListClose.ts — "Add, assign and close a punch item".
//
// The punch list (app/punch-list.tsx) on the SAMPLE job: add one item (the
// bundled line, or his own words), assign a sub to it, then move it through
// to Closed with the status badge. Punch list & closeout is Business; Free and
// Pro practise it on the sample through the practice pass.
//
// NOBODY IS NOTIFIED. Adding or assigning a punch item sends nothing: the only
// punch notification is punch_marked_ready, fired when a SUB marks an item
// ready from his portal (supabase/migrations/20260920120000_punch_sub_portal_v2
// trg_notify_punch_marked_ready), and a sub sees items only through a portal
// link made for that project — the sample has none unless he made one. So the
// assign step is a real do step (founder FQ-C2 keeps it only on that basis).
// The close-the-project slide is never a step.
//
// The add / edit form is a layer-less modal: while it is up the screen mounts
// 'punchList.modalUp' and the coach draws nothing, so the do steps light the
// control that OPENS the form and complete on the real save behind it. Data
// plus the bundled line.

import type { TutorialDef } from '../types';

const PL = { pathname: '/punch-list', projectParam: 'projectId' } as const;
const HUB = { pathname: '/project-detail', projectParam: 'id' } as const;

/** 'Do it for me' on the add step: the form opens with this line and room
 *  filled in (sample run only). He still taps Save. A different line from the
 *  punch walk's PUNCH_SAMPLE, so the two tutorials' items never look like one. */
export const PUNCH_LIST_SAMPLE = { line: 'Touch up paint at the hall closet', room: 'Hall' } as const;

/** A sub name, clipped for a ≤ 60-char stamp. */
function clipName(s: string, max = 30): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export const punchListClose: TutorialDef = {
  id: 'punch-list-close',
  version: 1,
  title: 'Add, assign and close a punch item',
  seconds: 40,
  endsWith: "A closed item on the sample's punch list",
  group: 'site',
  personas: ['contractor', 'both'],
  fieldSeatOk: true,
  sandbox: 'sarahs-place',
  needs: [],
  practiceFeatures: ['punch_list_closeout'],
  start: {
    pathname: '/punch-list',
    params: id => ({ projectId: id }),
    stackUnder: { pathname: '/project-detail', params: id => ({ id }) },
  },
  steps: [
    {
      id: 'punch-add',
      kind: 'do',
      route: PL,
      target: 'punchList.addBar',
      text: '{Tap} Add, describe it, then Save',
      detail: 'Sample: Touch up paint at the hall closet. Do it for me fills the form; you Save.',
      gesture: 'tap',
      until: { signal: 'punchList.saved' },
      assist: 'punchList.useSampleLine',
      checkpoint: true,
      success: {
        title: 'Punch item added',
        sub: () => "It's open on the sample's punch list. Nobody is notified.",
      },
    },
    {
      id: 'punch-assign',
      kind: 'do',
      route: PL,
      target: 'punchList.row',
      text: '{Tap} the item, pick a sub, then Save',
      detail: 'Other… takes any name. No sub is told from the sample.',
      gesture: 'tap',
      until: { signal: 'punchList.assigned' },
      success: {
        title: ctx => {
          const s = ctx.payloads['punchList.assigned']?.sub;
          return s && s.trim() ? `Assigned to ${clipName(s)}` : 'Sub assigned';
        },
        sub: () => 'On a real job, their portal lists it once you share one.',
      },
    },
    {
      id: 'punch-close',
      kind: 'do',
      route: PL,
      target: 'punchList.markDone',
      text: '{Tap} the status until it reads Closed',
      detail: 'Open, In progress, Ready for review, Closed. Each {tap} moves it one step.',
      gesture: 'tap',
      until: { signal: 'punchList.closed' },
      success: {
        title: 'Punch item closed',
        sub: () => 'The close date is stamped for the closeout record.',
      },
    },
    {
      id: 'punch-result',
      kind: 'look',
      route: HUB,
      target: ['hub.tile.punchList', 'hub.group.field'],
      text: 'The punch list lives here on the job.',
      textByTarget: { 'hub.group.field': 'The punch list is under Field Ops.' },
      detail: 'The number on the tile counts every item, open and closed.',
      gesture: 'none',
    },
  ],
  stat: {
    signal: 'punchList.closed',
    lead: 'Item closed in',
  },
  handoff: {
    pathname: '/punch-list',
    projectParam: 'projectId',
    realJobLabel: name => `Open ${name}'s punch list →`,
    feature: 'punch_list_closeout',
    paywallLabel: 'Punch lists come with Business — see plans',
    roles: ['owner', 'editor', 'field'],
  },
};
