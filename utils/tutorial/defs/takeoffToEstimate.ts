// defs/takeoffToEstimate.ts — "Count a plan and price it".
// The takeoff runs on the SAMPLE job with a bundled result for sheet A-101
// (utils/tutorial/learn/fixturesB SAMPLE_TAKEOFF_RESULT): no upload, no AI
// call, no meter change, labelled "Sample — no AI credits used". The prices
// are HIS — each line is priced from his own cost book, and a line his book
// has no rate for says "No price yet". Converting puts the lines on the sample
// job's estimate (added, never a replace). An upload on the sample during the
// run shows why it is blocked instead. The estimate step is Pro; Free users
// practise it through the practice pass (ai_estimate_wizard). Data only.

import type { CopyCtx, TutorialDef } from '../types';

const TAKEOFF = { pathname: '/takeoff', projectParam: 'projectId' } as const;
const HUB = { pathname: '/project-detail', projectParam: 'id' } as const;

function counted(ctx: CopyCtx): number | null {
  const n = ctx.payloads['takeoff.result.ready']?.items;
  return typeof n === 'number' && n > 0 ? n : null;
}

function converted(ctx: CopyCtx): { lines: number; priced: number | null } | null {
  const p = ctx.payloads['takeoff.converted'];
  if (!p || typeof p.lineCount !== 'number' || p.lineCount <= 0) return null;
  return { lines: p.lineCount, priced: typeof p.pricedCount === 'number' ? p.pricedCount : null };
}

export const takeoffToEstimate: TutorialDef = {
  id: 'takeoff-to-estimate',
  version: 1,
  title: 'Count a Plan and Price It',
  seconds: 45,
  endsWith: 'Counts from sheet A-101 turned into estimate lines',
  group: 'bid',
  personas: ['contractor', 'both'],
  fieldSeatOk: false,
  sandbox: 'sarahs-place',
  needs: ['plan'],
  practiceFeatures: ['ai_estimate_wizard'],
  start: {
    pathname: '/takeoff',
    params: id => ({ projectId: id }),
    stackUnder: { pathname: '/project-detail', params: id => ({ id }) },
  },
  steps: [
    {
      id: 'takeoff-sample',
      kind: 'do',
      route: TAKEOFF,
      target: 'takeoff.useSample',
      text: '{Tap} Use the sample plan, sheet A-101',
      // Adaptive: with no sheet on the sample the counts are still the bundled
      // A-101's — say so rather than imply the sheet is in his plan room.
      detail: ctx =>
        ctx.samplePlan === false
          ? "Sheet A-101 didn't load on the sample. The counts still come from it."
          : 'A bundled result for the sample sheet. Your own plans upload on a real job.',
      gesture: 'tap',
      until: { signal: 'takeoff.result.ready' },
      assist: 'takeoff.useSamplePlan',
      checkpoint: true,
    },
    {
      id: 'takeoff-results',
      kind: 'look',
      route: TAKEOFF,
      target: 'takeoff.results',
      text: ctx => {
        const n = counted(ctx);
        return n !== null ? `${n} counts, room by room, from sheet A-101.` : 'Counts, room by room, from sheet A-101.';
      },
      detail: 'Each price is your own rate. A line your cost book has no rate for says No price yet.',
      gesture: 'none',
    },
    {
      id: 'takeoff-convert',
      kind: 'do',
      route: TAKEOFF,
      target: 'takeoff.convert',
      text: '{Tap} Convert to estimate',
      detail: "The lines go on the sample job's estimate. Nothing is sent.",
      gesture: 'tap',
      until: { signal: 'takeoff.converted' },
      success: {
        title: ctx => {
          const c = converted(ctx);
          return c ? `${c.lines} lines added to the estimate` : 'Lines added to the estimate';
        },
        sub: ctx => {
          const c = converted(ctx);
          if (!c || c.priced === null) return 'On the sample job';
          if (c.priced === 0) return 'No rates in your cost book yet. Each line says No price yet.';
          return `${c.priced} priced from your cost book`;
        },
      },
    },
    {
      id: 'takeoff-result',
      kind: 'look',
      route: HUB,
      target: ['hub.tile.linkedEstimate', 'hub.group.money'],
      text: ctx => (converted(ctx) ? 'The counted lines are on the estimate.' : 'Estimate lines are filed here.'),
      textByTarget: { 'hub.group.money': 'The estimate is filed under Money.' },
      detail: 'Open it to price any line that says No price yet.',
      gesture: 'none',
    },
  ],
  stat: {
    signal: 'takeoff.converted',
    lead: 'Plan to estimate in',
    extras: p => {
      const c = p['takeoff.converted'];
      if (!c || typeof c.lineCount !== 'number' || c.lineCount <= 0) return [];
      return [`${c.lineCount} lines`];
    },
  },
  handoff: {
    pathname: '/takeoff',
    projectParam: 'projectId',
    realJobLabel: name => `Count the plans for ${name}`,
    feature: 'ai_estimate_wizard',
    paywallLabel: 'Takeoff to estimate comes with Pro. See plans.',
    roles: ['owner', 'editor'],
  },
  chainNext: { tutorialId: 'estimate-first', label: 'Next: price a job from a scope · 45 s' },
};
