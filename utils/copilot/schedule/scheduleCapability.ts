// utils/copilot/schedule/scheduleCapability.ts — the Schedule Copilot capability.
//
// Grounds the interview in the project's estimate, asks only the unresolved
// schedule-logic questions (scheduleGaps), then reuses the existing
// generate→schedule-review→updateProject apply tail unchanged: apply() runs
// generateScheduleFromEstimate, folds the interview's start date onto the draft,
// stashes it, and returns a route signal so the shell opens app/schedule-review.
import type { CopilotCapability, CopilotContext, Gap, Grounding } from '../types';
import { scheduleGaps, type ScheduleDraft } from './scheduleGaps';
import { buildScheduleGrounding } from './scheduleGrounding';
import { shouldAcceptStartDate } from './dateSignal';
import { generateScheduleFromEstimate, stashDraft } from '@/utils/autoScheduleFromEstimate';

export interface ScheduleApplied { route: '/schedule-review'; projectId: string }

export const scheduleCapability: CopilotCapability<ScheduleDraft, ScheduleApplied> = {
  id: 'schedule',
  label: 'Build a schedule',
  // No dedicated FeatureKey exists for schedule creation; the `scheduleCopilot`
  // AI meter (3 free lifetime trials, smart tier) is the gate. Left unset.
  aiFeature: 'scheduleCopilot',
  maxQuestions: 4,
  askThreshold: 0.35,
  suggestions: [
    'Gut bath, break ground end of March, cabinets already ordered',
    'Kitchen and two baths, standard finishes, start in three weeks',
  ],
  topicChecklist: [
    { label: 'Scope', hint: 'what rooms / trades' },
    { label: 'Start', hint: 'when you break ground' },
    { label: 'Long-lead items', hint: 'cabinets, windows, ordered yet?' },
  ],
  copy: {
    voiceTitle: 'Build a schedule',
    reviewHeadline: 'Here’s your schedule, grounded in your jobs.',
    reviewSub: 'Review the details, then build. You can fine-tune the full Gantt on the web app.',
    buildingLabel: 'Building your schedule…',
    webRoute: '/schedule-pro',
  },
  buildGrounding: buildScheduleGrounding,
  gaps: (draft: ScheduleDraft, grounding: Grounding): Gap[] => scheduleGaps(draft, grounding),

  buildTurnPrompt: ({ transcript, draft, grounding, asking }) => ({
    prompt: [
      'You are MAGE Copilot helping a contractor scope a construction schedule.',
      'Extract structured fields ONLY from what the contractor actually said, or',
      'from their history below. Do NOT invent durations, dates, or values.',
      '',
      'CRITICAL — a null field is how you ASK the contractor about it. Leave a',
      'field null unless they explicitly stated it (or their history directly',
      'supports it). Filling a field with a guess SKIPS a question you should',
      'have asked. Specifically:',
      '• startDate: null UNLESS they named a start / break-ground date, including',
      '  a concrete relative one like "in two weeks" or "end of March". NEVER',
      '  guess or assume a date, and never default to today.',
      '• phased / weatherBuffer: null unless they said so.',
      '• crewCap: null unless they gave a crew size.',
      '• longLeadMilestones: omit unless they named ordered / long-lead items.',
      '',
      'Fields: startDate (ISO string or null), phased (bool or null),',
      'longLeadMilestones (string[]), crewCap (number or null), weatherBuffer (bool or null).',
      '',
      'THEIR HISTORY:', ...grounding.facts,
      '',
      'DRAFT SO FAR: ' + JSON.stringify(draft),
      asking ? `THEY ARE ANSWERING: "${asking.question}"` : '',
      'WHAT THEY SAID: ' + transcript,
      'Return ONLY the updated draft JSON.',
    ].filter(Boolean).join('\n'),
    // Example shows the SHAPE with unknowns left null — reinforces "don't guess".
    schemaHint: { startDate: null, phased: null, longLeadMilestones: [], crewCap: null, weatherBuffer: null },
  }),

  mergeDraft: (draft, aiJson, meta): ScheduleDraft => {
    // Only ACCEPT a model-extracted startDate when the contractor's own words
    // carried a real date signal, OR they are directly answering the start-date
    // question. Otherwise the model presumed it — drop it so the "when do you
    // break ground?" gap (impact 0.9) fires and the interview actually asks.
    // This also protects the startDate-jump bug (never let a guessed date land).
    const acceptStart = shouldAcceptStartDate(aiJson?.startDate, meta?.transcript ?? '', meta?.asking?.field === 'startDate');
    return {
      startDate: acceptStart ? aiJson.startDate : draft.startDate ?? null,
      phased: typeof aiJson?.phased === 'boolean' ? aiJson.phased : draft.phased ?? null,
      // Only a NON-EMPTY array counts as "stated". The model routinely echoes
      // the empty array from the schema hint; letting `[]` overwrite null would
      // make longLeadMilestones non-null and permanently suppress the long-lead
      // procurement gap (which fires only while the field is null).
      longLeadMilestones: (Array.isArray(aiJson?.longLeadMilestones) && aiJson.longLeadMilestones.length > 0)
        ? aiJson.longLeadMilestones
        : draft.longLeadMilestones,
      crewCap: typeof aiJson?.crewCap === 'number' ? aiJson.crewCap : draft.crewCap ?? null,
      weatherBuffer: typeof aiJson?.weatherBuffer === 'boolean' ? aiJson.weatherBuffer : draft.weatherBuffer ?? null,
    };
  },

  apply: async (draft: ScheduleDraft, ctx: CopilotContext): Promise<ScheduleApplied> => {
    const project = ctx.project;
    if (!project?.linkedEstimate) {
      throw new Error('A linked estimate is required to build a schedule by voice.');
    }
    // ctx.ctx.projects is the shell-injected all-projects array (same source
    // estimateGrounding reads) — threads the pace book into generation.
    const allProjects = Array.isArray(ctx.ctx?.projects) ? ctx.ctx.projects : [];
    const result = await generateScheduleFromEstimate(project, project.linkedEstimate, allProjects);
    // Fold the interview's start date onto the generated draft. NEVER auto-stamp
    // today — only set when the user gave a date (guards the startDate jump bug).
    if (draft.startDate && result.schedule) result.schedule.startDate = draft.startDate;
    stashDraft(result);
    return { route: '/schedule-review', projectId: ctx.projectId };
  },
};
