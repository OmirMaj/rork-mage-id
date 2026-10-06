// defs/askYourPlans.ts — "Ask your plans a question".
// Runs on the SAMPLE job's sheet A-101 (the 'plan' need puts it there). The
// sample question gets a bundled, cited answer built from the sheet's own room
// labels (utils/tutorial/learn/fixturesB samplePlanAnswer): no plan search, no
// AI call, no meter change, labelled "Sample — no AI credits used". Any other
// question on the sample during the run says why it is blocked. The plan room
// is Pro and Ask is Business; Free users practise both through the practice
// pass (plan_markup, ask_your_plans). The Ask box is an RN Modal, so its steps
// draw in the askPlans layer mounted inside it. Data only.

import type { CopyCtx, TutorialDef } from '../types';

const PLANS = { pathname: '/plans', projectParam: 'projectId' } as const;
const HUB = { pathname: '/project-detail', projectParam: 'id' } as const;

function answered(ctx: CopyCtx): number | null {
  const n = ctx.payloads['askPlans.answered']?.citations;
  return typeof n === 'number' && n > 0 ? n : null;
}

function openedSheet(ctx: CopyCtx): string | null {
  const s = ctx.payloads['askPlans.sheet.opened']?.sheetNumber;
  return typeof s === 'string' && s.trim().length > 0 && s.length <= 12 ? s.trim() : null;
}

export const askYourPlans: TutorialDef = {
  id: 'ask-your-plans',
  version: 1,
  title: 'Ask Your Plans a Question',
  seconds: 35,
  endsWith: 'An answer that cites the sheet it came from',
  group: 'site',
  personas: ['contractor', 'both'],
  fieldSeatOk: false,
  sandbox: 'sarahs-place',
  needs: ['plan'],
  practiceFeatures: ['plan_markup', 'ask_your_plans'],
  start: {
    pathname: '/plans',
    params: id => ({ projectId: id }),
    stackUnder: { pathname: '/project-detail', params: id => ({ id }) },
  },
  steps: [
    {
      id: 'plans-ask-open',
      kind: 'do',
      route: PLANS,
      target: 'plans.askCta',
      text: '{Tap} Ask your plans',
      // Adaptive: with no sheet there is nothing to ask, so the ask steps
      // auto-skip (skipIf noSamplePlan) — say so before he opens the box.
      detail: ctx =>
        ctx.samplePlan === false
          ? "The sample sheet didn't load, so we'll skip the question."
          : 'Ask in plain English. The answer names the sheet it came from.',
      gesture: 'tap',
      until: { mounted: 'askPlans.input' },
      checkpoint: true,
    },
    {
      id: 'plans-ask-sample',
      kind: 'do',
      route: PLANS,
      layer: 'askPlans',
      target: 'askPlans.sampleQuestion',
      text: '{Tap} the sample question',
      detail: 'Which rooms are on sheet A-101? The sample answer uses no AI credits.',
      gesture: 'tap',
      until: { signal: 'askPlans.answered' },
      assist: 'askPlans.useSampleQuestion',
      skipIf: 'noSamplePlan',
      success: {
        title: 'Answered from sheet A-101',
        sub: ctx => {
          const n = answered(ctx);
          return n !== null ? `${n === 1 ? 'One citation' : `${n} citations`} · no AI credits used` : 'No AI credits used';
        },
      },
    },
    {
      id: 'plans-ask-citation',
      kind: 'look',
      route: PLANS,
      layer: 'askPlans',
      target: 'askPlans.citation',
      text: 'Every answer cites the sheet it came from.',
      detail: 'If no sheet matches well, it says so instead of guessing.',
      gesture: 'none',
      skipIf: 'noSamplePlan',
    },
    {
      id: 'plans-ask-open-sheet',
      kind: 'do',
      route: PLANS,
      layer: 'askPlans',
      target: 'askPlans.openCitation',
      text: '{Tap} a citation to open that sheet',
      detail: 'It opens the drawing the answer came from.',
      gesture: 'tap',
      until: { signal: 'askPlans.sheet.opened' },
      skipIf: 'noSamplePlan',
    },
    {
      id: 'plans-ask-result',
      kind: 'look',
      route: HUB,
      target: ['hub.tile.plans', 'hub.group.field'],
      text: ctx => {
        const s = openedSheet(ctx);
        return s ? `Sheet ${s} lives in Plans, on the job.` : 'The sheets you can ask live in Plans.';
      },
      textByTarget: { 'hub.group.field': 'Plans are filed under Field Ops.' },
      detail: 'Add a sheet once and every question can cite it.',
      gesture: 'none',
    },
  ],
  stat: {
    signal: 'askPlans.answered',
    lead: 'Answer found in',
    extras: p => [p['askPlans.answered'] ? 'cited to sheet A-101' : null],
  },
  handoff: {
    pathname: '/plans',
    projectParam: 'projectId',
    params: { ask: '1' },
    realJobLabel: name => `Ask the plans for ${name} →`,
    feature: 'ask_your_plans',
    paywallLabel: 'Ask your plans comes with Business — see plans',
    roles: ['owner', 'editor'],
  },
};
