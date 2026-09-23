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
import { shouldAcceptStartDate, normalizeStartDate } from './dateSignal';
import { generateScheduleFromEstimate, stashDraft } from '@/utils/autoScheduleFromEstimate';
import { todayCalendarDay } from '@/utils/calendarDate';

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
      '• startDate: "" UNLESS they named a start / break-ground date, including',
      '  a concrete relative one like "in two weeks" or "end of March" — then the',
      '  calendar day as YYYY-MM-DD. NEVER guess or assume a date, never today.',
      '• phased / weatherBuffer: "unknown" unless they said so; "yes" or "no" when they did.',
      '• crewCap: 0 unless they gave a crew size; then that number.',
      '• longLeadMilestones: [] unless they named ordered / long-lead items.',
      '',
      'Fields: startDate ("" or YYYY-MM-DD), phased ("yes" | "no" | "unknown"),',
      'longLeadMilestones (string[]), crewCap (number, 0 = not said), weatherBuffer ("yes" | "no" | "unknown").',
      '',
      // Without today's date "in two weeks" / "end of March" has nothing to
      // count from — a wrong-year day passed every check and became the
      // schedule's anchor (integration review, wave 6).
      `TODAY: ${todayCalendarDay()} — count relative dates from this day; "end of March" means the next March 31 on or after it.`,
      '',
      'THEIR HISTORY:', ...grounding.facts,
      '',
      'DRAFT SO FAR: ' + JSON.stringify(draft),
      asking ? `THEY ARE ANSWERING: "${asking.question}"` : '',
      'WHAT THEY SAID: ' + transcript,
      'Return ONLY the updated draft JSON.',
    ].filter(Boolean).join('\n'),
    // TYPED examples whose value IS "not said" (W6 A2). The relay turns every
    // example key into a REQUIRED field of the example's type, and a `null`
    // example into a required STRING — so the old all-null hint forced
    // crewCap: "4" and phased: "true", which the typeof checks below threw
    // away: he said "crew of four, phase it, no weather buffer" and the draft
    // kept none of it. A null can't be expressed at all, so each field gets a
    // typed sentinel the model CAN return when he said nothing — "" / 0 /
    // "unknown" — instead of being forced to guess a boolean, which would skip
    // the very question the interview exists to ask.
    schemaHint: { startDate: '', phased: 'unknown', longLeadMilestones: [], crewCap: 0, weatherBuffer: 'unknown' },
  }),

  mergeDraft: (draft, aiJson, meta): ScheduleDraft => {
    // Only ACCEPT a model-extracted startDate when the contractor's own words
    // carried a real date signal, OR they are directly answering the start-date
    // question. Otherwise the model presumed it — drop it so the "when do you
    // break ground?" gap (impact 0.9) fires and the interview actually asks.
    // This also protects the startDate-jump bug (never let a guessed date land).
    const acceptStart = shouldAcceptStartDate(aiJson?.startDate, meta?.transcript ?? '', meta?.asking?.field === 'startDate');
    const phased = coerceStatedBool(aiJson?.phased);
    const weatherBuffer = coerceStatedBool(aiJson?.weatherBuffer);
    const crewCap = coerceStatedCrew(aiJson?.crewCap);
    return {
      startDate: acceptStart ? normalizeStartDate(aiJson.startDate) : draft.startDate ?? null,
      phased: phased ?? draft.phased ?? null,
      // Only a NON-EMPTY array counts as "stated". The model routinely echoes
      // the empty array from the schema hint; letting `[]` overwrite null would
      // make longLeadMilestones non-null and permanently suppress the long-lead
      // procurement gap (which fires only while the field is null).
      longLeadMilestones: (Array.isArray(aiJson?.longLeadMilestones) && aiJson.longLeadMilestones.length > 0)
        ? aiJson.longLeadMilestones
        : draft.longLeadMilestones,
      crewCap: crewCap ?? draft.crewCap ?? null,
      weatherBuffer: weatherBuffer ?? draft.weatherBuffer ?? null,
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
    // The sub roster, from the same shell-injected context. LEFT UNDEFINED when
    // the shell did not provide it — undefined means "not loaded", and the
    // generator then assigns nobody rather than concluding he has no subs.
    const subs = Array.isArray(ctx.ctx?.subcontractors) ? ctx.ctx.subcontractors : undefined;
    // Phasing is the one answer only the generator can honour — it goes into
    // the generator's prompt (see phasingInstruction); unstated = unchanged.
    const result = await generateScheduleFromEstimate(project, project.linkedEstimate, allProjects, subs, { phased: draft.phased ?? null });
    // Fold the interview's start date onto the generated draft. NEVER auto-stamp
    // today — only set when the user gave a date (guards the startDate jump bug).
    // Only a real calendar day: anything else would be written onto the
    // schedule as an anchor no screen can read.
    const startDay = normalizeStartDate(draft.startDate);
    if (startDay && result.schedule) result.schedule.startDate = startDay;
    // What he stated that is enforced on the generated plan afterwards. "Crew of four" caps every task's crew; "no weather
    // buffer" zeroes the schedule's separate buffer (it is never folded into a
    // duration). Phasing is not faked here — it went to the generator above.
    applyStatedConstraints(result, draft);
    stashDraft(result);
    return { route: '/schedule-review', projectId: ctx.projectId };
  },
};

/** "yes" / "true" / true → true; "no" / "false" / false → false; anything
 *  else ("unknown", "", null) → null, i.e. NOT stated — the gap still asks. */
export function coerceStatedBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v !== 'string') return null;
  const t = v.trim().toLowerCase();
  if (t === 'yes' || t === 'true' || t === 'y') return true;
  if (t === 'no' || t === 'false' || t === 'n') return false;
  return null;
}

/** 4 / "4" / "4 guys" → 4. 0, negatives, "" and non-numbers → null (not
 *  stated). Capped at 50: a crew size, not a headcount for the whole job. */
export function coerceStatedCrew(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number((v.match(/\d+(\.\d+)?/) ?? [''])[0]) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(50, Math.max(1, Math.round(n)));
}

/** Hold the generated plan to what he said: crewCap caps every task's crew
 *  size (the stashed task list and the schedule's copy), and weatherBuffer
 *  false zeroes the schedule's buffer days. Mutates the draft result. */
export function applyStatedConstraints(
  result: { tasks?: { crewSize?: number }[]; schedule?: { tasks?: { crewSize?: number }[]; bufferDays?: number } | null },
  draft: Pick<ScheduleDraft, 'crewCap' | 'weatherBuffer'>,
): void {
  const cap = typeof draft.crewCap === 'number' && draft.crewCap > 0 ? draft.crewCap : null;
  if (cap != null) {
    for (const list of [result.tasks, result.schedule?.tasks]) {
      for (const t of list ?? []) if (typeof t.crewSize === 'number' && t.crewSize > cap) t.crewSize = cap;
    }
  }
  if (draft.weatherBuffer === false && result.schedule) result.schedule.bufferDays = 0;
}
