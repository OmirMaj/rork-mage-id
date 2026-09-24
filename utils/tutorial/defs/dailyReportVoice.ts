// defs/dailyReportVoice.ts — "File today's daily report by talking".
// The first-run tutorial: free, for every GC and foreman, about 35 s. Data
// only; the engine and the screens do the work. Copy uses {tap}/{Tap} so web
// reads 'Click' (validate-tutorial-defs refuses a hard-coded verb).

import type { TutorialDef } from '../types';

const DFR = { pathname: '/daily-report', projectParam: 'projectId' } as const;
const HUB = { pathname: '/project-detail', projectParam: 'id' } as const;

export const dailyReportVoice: TutorialDef = {
  id: 'daily-report-voice',
  version: 1,
  title: "File today's daily report by talking",
  seconds: 35,
  endsWith: "Today's report filed on the sample job",
  group: 'site',
  personas: ['contractor', 'both'],
  fieldSeatOk: true,
  sandbox: 'sarahs-place',
  needs: [],
  practiceFeatures: [],
  start: {
    pathname: '/daily-report',
    params: (id, ctx) => ({ projectId: id, date: ctx.reportDay }),
    stackUnder: { pathname: '/project-detail', params: id => ({ id }) },
  },
  steps: [
    {
      id: 'dfr-voice',
      kind: 'do',
      route: DFR,
      target: 'dfr.voice',
      text: '{Tap} the sample note — or the mic and say your day',
      // The web VoiceRecorder is disabled (components/VoiceRecorder.tsx), so
      // the sample chip is the only path there.
      textWeb: '{Tap} the sample voice note',
      detail: ctx =>
        ctx.freeTier && !ctx.web
          ? 'Sample — no AI credits used. The mic uses 1 of your 3 free voice fills.'
          : 'Sample — no AI credits used.',
      gesture: 'tap',
      until: { signal: 'dfr.voice.applied' },
      assist: 'dfr.useSampleNote',
      checkpoint: true,
    },
    {
      id: 'dfr-preview',
      kind: 'look',
      route: DFR,
      target: ['dfr.voicePreview', 'dfr.workPerformed'],
      text: 'One note filled crew, work done and the delay.',
      detail: 'Check it — {tap} any field to fix it.',
      gesture: 'none',
    },
    {
      id: 'dfr-save',
      kind: 'do',
      route: DFR,
      target: 'dfr.saveDraft',
      text: '{Tap} Save Draft',
      gesture: 'tap',
      until: { signal: 'dfr.saved' },
      success: {
        title: 'Daily report saved',
        sub: ctx => {
          const saved = ctx.payloads['dfr.saved'];
          const voice = ctx.payloads['dfr.voice.applied'];
          const parts: string[] = [];
          if (ctx.reportDayLabel) parts.push(ctx.reportDayLabel);
          if (typeof saved?.crew === 'number' && saved.crew > 0) parts.push(`${saved.crew} crew`);
          if (voice && voice.fields.length > 0) parts.push(`${voice.fields.length} sections from one note`);
          return parts.length > 0 ? parts.join(' · ') : 'Filed on the sample job';
        },
      },
    },
    {
      id: 'dfr-result',
      kind: 'look',
      route: HUB,
      target: ['hub.tile.dailyReports', 'hub.group.field'],
      text: "Today's report is filed here.",
      textByTarget: { 'hub.group.field': "Today's report is filed under Field Ops." },
      detail: "Submit sends it to the owner when you're ready. On a sample job it goes only to you.",
      gesture: 'none',
    },
  ],
  stat: {
    signal: 'dfr.saved',
    lead: 'Report filed in',
    extras: p => {
      const n = p['dfr.voice.applied']?.fields.length ?? 0;
      return [n > 0 ? `${n} sections from one note` : null];
    },
  },
  handoff: {
    pathname: '/daily-report',
    projectParam: 'projectId',
    realJobLabel: name => `File today's report on ${name} →`,
    roles: ['owner', 'editor', 'field'],
  },
  chainNext: { tutorialId: 'punch-walk', label: 'Next: walk the job — log a punch item · 45 s' },
};
