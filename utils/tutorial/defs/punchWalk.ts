// defs/punchWalk.ts — "Walk the job: log a punch item on the plan".
// Punch walk is Business; Free and Pro users practise it on the sample
// through the practice pass (punch_list_closeout). Data only.

import type { TutorialDef } from '../types';
import { listJoin } from '../stats';

const WALK = { pathname: '/punch-walk', projectParam: 'projectId' } as const;
const HUB = { pathname: '/project-detail', projectParam: 'id' } as const;

export const punchWalk: TutorialDef = {
  id: 'punch-walk',
  version: 1,
  title: 'Walk the job: log a punch item on the plan',
  seconds: 45,
  endsWith: 'A punch item pinned on the plan',
  group: 'site',
  personas: ['contractor', 'both'],
  fieldSeatOk: true,
  sandbox: 'sarahs-place',
  needs: ['plan'],
  practiceFeatures: ['punch_list_closeout'],
  start: {
    pathname: '/punch-walk',
    params: id => ({ projectId: id }),
    stackUnder: { pathname: '/project-detail', params: id => ({ id }) },
  },
  steps: [
    {
      id: 'punch-photo',
      kind: 'do',
      route: WALK,
      target: 'punch.camera',
      text: '{Tap} Photo — or use the sample photo',
      // With no sample plan the pin steps auto-skip (skipIf noSamplePlan) and
      // the photo does not open the plan screen — say so up front (spec).
      detail: ctx =>
        ctx.samplePlan === false
          ? "The sample plan didn't load — we'll skip the pin."
          : ctx.web ? 'The sample photo is an illustration, labelled as a sample.' : 'The sample photo skips the camera prompt.',
      gesture: 'tap',
      until: { signal: 'punch.photo.added' },
      assist: 'punch.useSamplePhoto',
      checkpoint: true,
    },
    {
      id: 'punch-pin',
      kind: 'do',
      route: WALK,
      layer: 'planPin',
      target: 'punch.planImage',
      text: '{Tap} where the problem is — try the Kitchen',
      detail: 'Pinch to zoom. The pin goes where you {tap}.',
      gesture: 'tap-point',
      // Kitchen label centre on the bundled A-101 (fixtures SAMPLE_PLAN).
      point: { x: 0.2, y: 0.3 },
      until: { mounted: 'punch.pinMarker' },
      assist: 'punch.dropPinKitchen',
      skipIf: 'noSamplePlan',
    },
    {
      id: 'punch-pin-next',
      kind: 'do',
      route: WALK,
      layer: 'planPin',
      target: 'punch.pinNext',
      text: 'Looks right? {Tap} Next',
      gesture: 'tap',
      until: { signal: 'punch.pin.decided' },
      skipIf: 'noSamplePlan',
    },
    {
      id: 'punch-describe',
      kind: 'do',
      route: WALK,
      target: 'punch.description',
      text: "Say what's wrong — or {tap} the sample line",
      detail: 'It picks the trade from your words.',
      gesture: 'tap',
      until: { signal: 'punch.description.filled' },
      assist: 'punch.useSampleLine',
    },
    {
      id: 'punch-save',
      kind: 'do',
      route: WALK,
      target: 'punch.save',
      text: '{Tap} Save to punch list',
      gesture: 'tap',
      until: { signal: 'punch.saved' },
      success: {
        title: 'Punch item logged',
        sub: ctx => {
          const s = ctx.payloads['punch.saved'];
          if (!s) return 'Saved on the sample job';
          const parts = [s.location, s.trade].filter(x => typeof x === 'string' && x.trim().length > 0);
          if (s.pinned) parts.push(s.sheet ? `pinned on ${s.sheet}` : 'pinned on the plan');
          return parts.length > 0 ? parts.join(' · ') : 'Saved on the sample job';
        },
      },
    },
    {
      id: 'punch-session',
      kind: 'look',
      route: WALK,
      target: 'punch.sessionCount',
      text: '1 item logged this walk.',
      detail: 'They stack up as you walk. The room carries to the next item.',
      gesture: 'none',
    },
    {
      id: 'punch-back',
      kind: 'do',
      route: WALK,
      target: 'punch.back',
      text: 'Done walking? {Tap} back to the job',
      gesture: 'tap',
      until: { route: HUB },
    },
    {
      id: 'punch-result',
      kind: 'look',
      route: HUB,
      target: ['hub.tile.punchList', 'hub.group.field'],
      text: "It's on the punch list.",
      textByTarget: { 'hub.group.field': "It's on the punch list, under Field Ops." },
      // Built from what this run actually attached: with no sample plan the
      // pin step was skipped, and the copy must not claim a pin.
      detail: ctx => {
        const parts: string[] = [];
        if (ctx.payloads['punch.photo.added']) parts.push('photo');
        if (ctx.payloads['punch.saved']?.pinned) parts.push('pin');
        if (ctx.payloads['punch.saved']?.trade) parts.push('trade');
        const list = listJoin(parts);
        const lead = list ? `${list[0].toUpperCase()}${list.slice(1)} ${parts.length > 1 ? 'are' : 'is'} attached. ` : '';
        return `${lead}Crew-list items never reach the client portal.`;
      },
      gesture: 'none',
    },
  ],
  stat: {
    signal: 'punch.saved',
    lead: '1 item in',
    extras: p => {
      const parts: string[] = [];
      if (p['punch.photo.added']) parts.push('photo');
      if (p['punch.saved']?.pinned) parts.push('pin');
      if (p['punch.saved']?.trade) parts.push('trade');
      return [parts.length > 0 ? listJoin(parts) : null];
    },
  },
  handoff: {
    pathname: '/punch-walk',
    projectParam: 'projectId',
    realJobLabel: name => `Walk ${name} →`,
    feature: 'punch_list_closeout',
    paywallLabel: 'Punch walk comes with Business — see plans',
    roles: ['owner', 'editor', 'field'],
  },
  chainNext: { tutorialId: 'invoice-to-self', label: 'Next: bill the job · 40 s' },
};
