// defs/estimateFirst.ts — "Price a job from a scope".
// The quick-estimate wizard on the sample job. The wizard has no tier gate of
// its own (its AI run is metered instead), so no practice pass is needed — and
// on the sample, while this run is live, the wizard makes NO AI call at all:
// the sample scope prices from the bundled result (fixturesA, labelled
// "Sample — no AI credits used") and anything he types himself is refused
// with a reason. The save writes the estimate to the sample as a NEW revision
// and never replaces the seeded estimate the invoice tutorial bills from
// (founder FQ-A1). Data only.

import type { CopyCtx, TutorialDef } from '../types';
import { formatUsd } from './invoiceToSelf';

const EST = { pathname: '/estimate-wizard', projectParam: 'projectId' } as const;
const HUB = { pathname: '/project-detail', projectParam: 'id' } as const;

/** '$422,400' from integer cents. */
function usdCents(cents: number): string {
  return formatUsd(cents / 100);
}

/** The markup the payload names, or null when he has none set (or zero). */
function markupOf(m: number | null | undefined): number | null {
  return typeof m === 'number' && Number.isFinite(m) && m > 0 ? m : null;
}

function generatedLine(ctx: CopyCtx): string {
  const g = ctx.payloads['estimate.generated'];
  if (!g || !(g.totalCents > 0)) return 'Your total, line by line, from the sample job.';
  const m = markupOf(g.markupPct);
  return m !== null
    ? `${usdCents(g.totalCents)} at your ${m}% markup.`
    : `${usdCents(g.totalCents)} is your cost, with no markup yet.`;
}

export const estimateFirst: TutorialDef = {
  id: 'estimate-first',
  version: 1,
  title: 'Price a job from a scope',
  seconds: 45,
  endsWith: 'A priced estimate saved on the sample job',
  group: 'bid',
  personas: ['contractor', 'both'],
  fieldSeatOk: false,
  sandbox: 'sarahs-place',
  needs: [],
  practiceFeatures: [],
  start: {
    pathname: '/estimate-wizard',
    params: id => ({ projectId: id }),
    stackUnder: { pathname: '/project-detail', params: id => ({ id }) },
  },
  steps: [
    {
      id: 'estimate-scope',
      kind: 'do',
      route: EST,
      layer: 'estimateWizard',
      target: 'estimate.scope',
      text: 'Describe the job in a sentence or two',
      detail: 'On the sample, use the sample scope. Sample — no AI credits used.',
      gesture: 'tap',
      until: { signal: 'estimate.scope.filled' },
      assist: 'estimate.useSampleScope',
      checkpoint: true,
    },
    {
      id: 'estimate-generate',
      kind: 'do',
      route: EST,
      layer: 'estimateWizard',
      target: 'estimate.generate',
      text: '{Tap} Generate estimate',
      detail: 'The sample prices from the sample job. Sample — no AI credits used.',
      gesture: 'tap',
      until: { signal: 'estimate.generated' },
      // He may have typed his own scope at step 1 (it completes the step), and
      // the sample refuses it here with the reason. 'Do it for me' puts the
      // sample scope back; Generate stays his tap.
      assist: 'estimate.useSampleScope',
    },
    {
      id: 'estimate-summary',
      kind: 'look',
      route: EST,
      layer: 'estimateWizard',
      target: 'estimate.summary',
      text: generatedLine,
      detail: ctx => {
        const g = ctx.payloads['estimate.generated'];
        if (g && markupOf(g.markupPct) === null) return '{Tap} the row above the total to add your markup. Only you see it.';
        return 'The markup row is yours only. The client sees the total.';
      },
      gesture: 'none',
    },
    {
      id: 'estimate-save',
      kind: 'do',
      route: EST,
      layer: 'estimateWizard',
      target: 'estimate.save',
      text: '{Tap} Save to the sample job',
      detail: "It goes in as a new revision. The job's current estimate stays as it is.",
      gesture: 'tap',
      until: { signal: 'estimate.saved' },
      success: {
        title: 'Estimate saved on the sample job',
        sub: ctx => {
          const s = ctx.payloads['estimate.saved'];
          const parts: string[] = [];
          if (s && typeof s.totalCents === 'number' && s.totalCents > 0) parts.push(usdCents(s.totalCents));
          if (s && s.lineCount > 0) parts.push(`${s.lineCount} line${s.lineCount === 1 ? '' : 's'}`);
          return parts.length > 0 ? parts.join(' · ') : 'Saved as a new revision';
        },
      },
    },
    {
      id: 'estimate-open-job',
      kind: 'do',
      route: EST,
      layer: 'estimateWizard',
      target: 'estimate.openJob',
      text: '{Tap} Open the job',
      gesture: 'tap',
      until: { route: HUB },
    },
    {
      id: 'estimate-result',
      kind: 'look',
      route: HUB,
      target: ['hub.tile.linkedEstimate', 'hub.group.money'],
      text: ctx => (ctx.payloads['estimate.saved'] ? 'Your estimate is here, under Revisions.' : 'Estimates and their revisions are here.'),
      textByTarget: { 'hub.group.money': 'Estimates are filed under Money.' },
      detail: "The job's current estimate is unchanged. Restore a revision to make it current.",
      gesture: 'none',
    },
  ],
  stat: {
    signal: 'estimate.saved',
    lead: 'Estimate priced and saved in',
    extras: p => {
      const n = p['estimate.saved']?.lineCount ?? 0;
      return [n > 0 ? `${n} line${n === 1 ? '' : 's'}` : null];
    },
  },
  handoff: {
    pathname: '/estimate-wizard',
    projectParam: 'projectId',
    realJobLabel: name => `Price ${name} →`,
    roles: ['owner', 'editor'],
  },
};
