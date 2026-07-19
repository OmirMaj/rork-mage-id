// utils/copilot/dailyReport/dfrCapability.ts — the Daily Report Copilot capability.
//
// One spoken end-of-day update → the interview confirms today's critical-path
// progress + whether it was a clean day → apply() fans the dictation out into a
// full DailyFieldReport (reusing voiceDFRParser), attaches the progress chip,
// and saves it. addDailyReport propagates the chip into the schedule and the
// owner's portal automatically — the DFR is the hub that moves everything.
import type { CopilotCapability, CopilotContext, Gap, Grounding } from '../types';
import { dfrGaps, type DFRDraft, type DFRGroundData } from './dfrGaps';
import { buildDFRGrounding } from './dfrGrounding';
import { parseDFRFromTranscript } from '@/utils/voiceDFRParser';
import { createId } from '@/utils/scheduleEngine';
import type { DailyFieldReport } from '@/types';

export interface DFRApplied {
  route: '/daily-report';
  projectId: string;
  params: { projectId: string; reportId: string };
}

export const dailyReportCapability: CopilotCapability<DFRDraft, DFRApplied> = {
  id: 'daily_report',
  label: 'Log a daily report',
  aiFeature: 'dailyReport',
  maxQuestions: 2,
  askThreshold: 0.4,
  suggestions: [
    'Four framers on site, finished the second-floor walls, poured the garage slab, no issues',
    'Slow day — rain held up the roofers, plumber roughed in two baths',
  ],
  topicChecklist: [
    { label: 'Crew', hint: 'who was on site' },
    { label: 'Work', hint: 'what got done' },
    { label: 'Issues', hint: 'delays / a clean day' },
  ],
  copy: {
    voiceTitle: 'Log a daily report',
    reviewHeadline: 'Here’s today’s report, ready to log.',
    reviewSub: 'Saving it moves the schedule and updates the owner’s portal. Fine-tune anything on the report screen.',
    buildingLabel: 'Writing up your report…',
    webRoute: '/daily-report',
  },
  buildGrounding: buildDFRGrounding,
  gaps: (draft: DFRDraft, grounding: Grounding): Gap[] => dfrGaps(draft, grounding),

  buildTurnPrompt: ({ transcript, draft, grounding, asking }) => ({
    prompt: [
      'You are MAGE Copilot reading a contractor\'s spoken end-of-day update.',
      'Determine ONE thing: did they mention any issue, delay, problem, setback,',
      'weather hold, injury, or anything that went wrong? Return issuesMentioned',
      'true ONLY if so, else false. Never invent a problem.',
      '',
      ...grounding.facts,
      '',
      'DRAFT SO FAR: ' + JSON.stringify(draft),
      asking ? `THEY ARE ANSWERING: "${asking.question}"` : '',
      'WHAT THEY SAID: ' + transcript,
      'Return ONLY JSON.',
    ].filter(Boolean).join('\n'),
    schemaHint: { issuesMentioned: false },
  }),

  mergeDraft: (draft, aiJson, meta): DFRDraft => ({
    transcript: meta?.transcript ?? draft.transcript ?? null,
    issuesMentioned: typeof aiJson?.issuesMentioned === 'boolean' ? aiJson.issuesMentioned : draft.issuesMentioned ?? null,
    cleanDay: draft.cleanDay ?? null,
    criticalTaskPct: draft.criticalTaskPct ?? null,
  }),

  apply: async (draft: DFRDraft, ctx: CopilotContext): Promise<DFRApplied> => {
    const project = ctx.project;
    if (!project) throw new Error('No project to log the report against.');
    const transcript = (draft.transcript ?? '').trim();
    if (!transcript) throw new Error('Tell me about the day first, then I can write it up.');

    // Fan the dictation out into structured fields (best-effort).
    let parsed: Partial<DailyFieldReport> = {};
    try {
      parsed = await parseDFRFromTranscript(transcript, ctx.projectId);
    } catch {
      parsed = { workPerformed: transcript };
    }

    const grounding = await buildDFRGrounding(ctx);
    const crit = (grounding.data as DFRGroundData).criticalTask;
    const now = new Date().toISOString();
    const reportId = createId('dfr');

    const issues = draft.cleanDay === true
      ? 'No issues — clean day.'
      : (parsed.issuesAndDelays || (draft.cleanDay === false ? 'An issue was flagged — see notes.' : ''));

    const report: DailyFieldReport = {
      id: reportId,
      projectId: ctx.projectId,
      date: now.slice(0, 10),
      weather: parsed.weather ?? { temperature: '', conditions: '', wind: '', isManual: false },
      manpower: parsed.manpower ?? [],
      workPerformed: parsed.workPerformed ?? transcript,
      materialsDelivered: parsed.materialsDelivered ?? [],
      issuesAndDelays: issues,
      photos: [],
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      ...(draft.criticalTaskPct != null && crit
        ? { workProgress: [{ taskId: crit.id, taskName: crit.title, phase: crit.phase, pct: draft.criticalTaskPct }] }
        : {}),
    };

    ctx.ctx?.addDailyReport?.(report); // saves + propagates progress to schedule + portal
    return { route: '/daily-report', projectId: ctx.projectId, params: { projectId: ctx.projectId, reportId } };
  },
};
