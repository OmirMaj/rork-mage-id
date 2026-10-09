// defs/constructionAiAsk.ts — "Ask Construction AI about your job".
// Ask mode on the SAMPLE job with a question about the job's OWN records —
// "What's left to bill on this job?" — answered by a pure function of the
// sample's estimate, approved change orders and invoices (utils/tutorial/
// learn/fixturesB sampleJobAnswer): no construction-answer call, no meter
// change, labelled "Sample — no AI credits used". It teaches how to ask and
// how to read the grounding (the records it read, the honesty banner) —
// NEVER code, safety or trade content, so the certificate stays an app skill
// (founder FQ-B1). Every other question, and every Code check / Roadmap / Plan
// review run, on the sample during the run says why it is blocked. The tab
// gates on ai_code_check and Ask mode on construction_answer; Free users
// practise through the practice pass (both listed). Data only.

import type { CopyCtx, TutorialDef } from '../types';

const CAI = { pathname: '/construction-ai', projectParam: 'projectId' } as const;

function records(ctx: CopyCtx): number | null {
  const n = ctx.payloads['cai.answered']?.consulted;
  return typeof n === 'number' && n > 0 ? n : null;
}

export const constructionAiAsk: TutorialDef = {
  id: 'construction-ai-ask',
  version: 1,
  title: 'Ask Construction AI About Your Job',
  seconds: 35,
  endsWith: "An answer built from the job's own records",
  group: 'bid',
  personas: ['contractor', 'both'],
  fieldSeatOk: false,
  sandbox: 'sarahs-place',
  needs: [],
  practiceFeatures: ['ai_code_check', 'construction_answer'],
  start: {
    pathname: '/construction-ai',
    params: id => ({ projectId: id, mode: 'ask' }),
  },
  steps: [
    {
      id: 'cai-modes',
      kind: 'look',
      route: CAI,
      target: 'cai.modeAsk',
      text: "Four modes. You're in Ask.",
      detail: 'Code check, Project roadmap and Plan review sit beside it.',
      gesture: 'none',
      checkpoint: true,
    },
    {
      id: 'cai-question',
      kind: 'do',
      route: CAI,
      target: 'cai.askInput',
      text: "Ask about the job, or {tap} the sample question",
      detail: "What's left to bill on this job? It reads the sample job's records.",
      gesture: 'tap',
      until: { signal: 'cai.question.filled' },
      assist: 'cai.useSampleQuestion',
    },
    {
      id: 'cai-run',
      kind: 'do',
      route: CAI,
      target: 'cai.run',
      text: '{Tap} Get answer',
      detail: 'The sample answer uses no AI credits.',
      gesture: 'tap',
      until: { signal: 'cai.answered' },
      success: {
        title: 'Answered from the Job',
        sub: ctx => {
          const n = records(ctx);
          return n !== null ? `${n} record${n === 1 ? '' : 's'} read · no AI credits used` : 'No AI credits used';
        },
      },
    },
    {
      id: 'cai-consulted',
      kind: 'look',
      route: CAI,
      target: 'cai.consulted',
      text: 'These are the records it read.',
      detail: 'Sources hold up the answer. Anything it checked and left out is listed too.',
      gesture: 'none',
    },
    {
      id: 'cai-honesty',
      kind: 'look',
      route: CAI,
      target: 'cai.honesty',
      text: 'It says how it got the answer.',
      detail: 'A code answer that is not fully checked tells you to confirm with your building department.',
      gesture: 'none',
    },
  ],
  stat: {
    signal: 'cai.answered',
    lead: 'Answer in',
    extras: p => {
      const n = p['cai.answered']?.consulted;
      return [typeof n === 'number' && n > 0 ? `${n} record${n === 1 ? '' : 's'} read` : null];
    },
  },
  handoff: {
    pathname: '/construction-ai',
    projectParam: 'projectId',
    params: { mode: 'ask' },
    realJobLabel: name => `Ask about ${name}`,
    feature: 'construction_answer',
    paywallLabel: 'Construction answers come with Business. See Plans',
    roles: ['owner', 'editor'],
  },
};
