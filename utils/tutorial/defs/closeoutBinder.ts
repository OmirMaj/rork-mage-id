// defs/closeoutBinder.ts — "Build a closeout binder".
// The binder screen has no plan gate of its own (only its Home Passport step
// checks client_portal, and a draft never shows that step), so this tutorial
// asks the practice pass for nothing.
//
// THE TUTORIAL ENDS AT A SAVED DRAFT. The save point is the screen's own
// handleSave (persistBinder → saveCloseoutBinder, an online write): the stamp
// fires only after it resolves with a row. Finalize and Deliver are LOOKED at,
// never pressed by the coach; on a sample app/closeout-binder.tsx refuses
// Deliver and Re-deliver (utils/sampleGuard SAMPLE_DOC_NOT_SENT), whether or
// not a run is live. The section list is the screen's own preview card
// (fixturesD BINDER_SECTION_LABELS, pinned by validate-tutorial-learn-d).
// Data only.

import type { TutorialDef } from '../types';
import { BINDER_SECTION_LABELS } from '../learn/fixturesD';

const BINDER = { pathname: '/closeout-binder', projectParam: 'projectId' } as const;
const HUB = { pathname: '/project-detail', projectParam: 'id' } as const;

const SECTION_TOTAL = BINDER_SECTION_LABELS.length;

export const closeoutBinder: TutorialDef = {
  id: 'closeout-binder',
  version: 1,
  title: 'Build a closeout binder',
  seconds: 35,
  endsWith: 'A draft binder with every section in one place',
  group: 'client',
  personas: ['contractor', 'both'],
  fieldSeatOk: false,
  sandbox: 'sarahs-place',
  needs: [],
  practiceFeatures: [],
  start: {
    pathname: '/closeout-binder',
    params: id => ({ projectId: id }),
    stackUnder: { pathname: '/project-detail', params: id => ({ id }) },
  },
  steps: [
    {
      id: 'binder-sections',
      kind: 'look',
      route: BINDER,
      target: 'binder.sections',
      text: 'The binder pulls these from the job.',
      detail: 'Finishes and fixtures, trades, warranties and the maintenance schedule.',
      gesture: 'none',
      checkpoint: true,
    },
    {
      id: 'binder-save',
      kind: 'do',
      route: BINDER,
      target: 'binder.saveDraft',
      text: '{Tap} Save draft',
      detail: 'A draft stays with you. Your client sees nothing until you deliver.',
      gesture: 'tap',
      until: { signal: 'binder.saved' },
      success: {
        title: 'Binder saved as a draft',
        sub: ctx => {
          const n = ctx.payloads['binder.saved']?.sections;
          if (typeof n !== 'number') return 'Saved on the sample job';
          if (n >= SECTION_TOTAL) return `All ${SECTION_TOTAL} sections in one draft`;
          return `${n} of ${SECTION_TOTAL} sections have something in them so far`;
        },
      },
    },
    {
      id: 'binder-deliver',
      kind: 'look',
      route: BINDER,
      target: ['binder.deliver', 'binder.finalize'],
      text: 'Delivery to the owner happens on a real job.',
      detail: 'Finalize locks it in. Deliver puts it in their portal and emails them.',
      gesture: 'none',
    },
    {
      id: 'binder-back',
      kind: 'do',
      route: BINDER,
      target: 'binder.back',
      text: '{Tap} back to the job',
      gesture: 'tap',
      until: { route: HUB },
    },
    {
      id: 'binder-result',
      kind: 'look',
      route: HUB,
      target: ['hub.tile.closeoutBinder', 'hub.group.money'],
      text: ctx => (ctx.payloads['binder.saved'] ? 'Your draft binder is filed here.' : 'The closeout binder is filed here.'),
      textByTarget: { 'hub.group.money': 'The closeout binder is under Money.' },
      detail: 'It fills in as you log warranties, selections and trades.',
      gesture: 'none',
    },
  ],
  stat: {
    signal: 'binder.saved',
    lead: 'Binder drafted in',
    extras: p => {
      const n = p['binder.saved']?.sections;
      return [typeof n === 'number' && n > 0 ? `${n} of ${SECTION_TOTAL} sections filled` : null];
    },
  },
  handoff: {
    pathname: '/closeout-binder',
    projectParam: 'projectId',
    realJobLabel: name => `Build the binder on ${name} →`,
    roles: ['owner', 'editor'],
  },
};
