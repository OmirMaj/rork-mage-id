import { z } from 'zod';

/**
 * The phases the generator is told it may use.
 *
 * The original sixteen describe a house going up from dirt. They have no word
 * for the sequence a tenant fit-out actually runs — demo the existing suite,
 * get above-ceiling rough-in inspected, close the ceiling, commission the
 * systems, hand over the O&M binder — so a commercial job's schedule came back
 * with most of its tasks filed under 'General'.
 *
 * The ten added below are ordered where they belong in a real sequence, not
 * appended, because app/schedule-review.tsx sorts its phase groups by THIS
 * array's index. Appending them would have printed commissioning above
 * foundation.
 */
export const SCHEDULE_PHASES = [
  'Site Work', 'Demo', 'Abatement', 'Foundation', 'Structure', 'Framing', 'Roofing',
  'Building Envelope', 'MEP', 'Plumbing', 'Electrical', 'HVAC', 'Fire Protection',
  'Low Voltage', 'Insulation', 'Drywall', 'Above-Ceiling Inspection', 'Ceilings',
  'Interior', 'Millwork', 'Finishes', 'Landscaping', 'Inspections',
  'Commissioning', 'Closeout', 'General',
] as const;

/** How long a phase label is allowed to be. A model that returns a sentence
 *  where a phase belongs is not coining a phase, it is misusing the field, and
 *  a 200-character group header would wreck the review screen. */
const MAX_PHASE_LEN = 40;

/** One generated task. `rationale` (required) is the explainability moat:
 *  a one-line reason for the task's sequencing + duration basis. `assumption`
 *  (optional) flags a task whose duration/sequence was guessed rather than
 *  derived from cost-DB / crew rates, so the review UI can highlight it. */
export const autoScheduleTaskSchema = z.object({
  id: z.string(),
  name: z.string(),
  phase: z.string(),
  duration: z.number(),
  predecessorIds: z.array(z.string()),
  isMilestone: z.boolean(),
  isCriticalPath: z.boolean(),
  crewSize: z.number(),
  wbs: z.string(),
  rationale: z.string(),
  assumption: z.boolean().optional(),
  linkedCategories: z.array(z.string()).optional(),
});

export const autoScheduleSchema = z.object({
  tasks: z.array(autoScheduleTaskSchema),
});

export type GeneratedTask = {
  id: string; name: string; phase: string; duration: number;
  predecessorIds: string[]; isMilestone: boolean; isCriticalPath: boolean;
  crewSize: number; wbs: string; rationale: string; assumption: boolean;
  linkedCategories: string[];
  /** True when the model named a phase that is not in SCHEDULE_PHASES and we
   *  KEPT it. Lets the review screen show the word it chose and ask whether
   *  that is right, instead of the app deciding on his behalf. */
  coinedPhase: boolean;
};

/**
 * Decide what a task's phase actually is.
 *
 * THIS USED TO DESTROY INFORMATION. The line was:
 *
 *     phase: SCHEDULE_PHASES.includes(t?.phase) ? t.phase : 'General'
 *
 * — so when the model, correctly reading a commercial scope, answered
 * "Commissioning" or "Above-Ceiling Inspection", the app threw the word away
 * and wrote 'General'. Nothing anywhere recorded that a substitution had
 * happened. The result was a schedule that looked like the generator had
 * nothing to say about half the job, when in fact it had said the right thing
 * and been overruled by a list that predated the job type.
 *
 * Now an unrecognised phase is KEPT and MARKED. Every consumer already
 * tolerates one: app/schedule-review.tsx sorts unknown phases last by
 * construction (`idx === -1 ? SCHEDULE_PHASES.length : idx`), and the phase is
 * a free `string` in the zod schema and on ScheduleTask. The only thing that
 * was enforcing the list was this line.
 *
 * 'General' remains the answer in exactly one case: the model gave no usable
 * phase at all. That is not a coined phase, it is an absent one, so
 * `coinedPhase` stays false and the review screen says nothing about it.
 */
function resolvePhase(raw: unknown): { phase: string; coinedPhase: boolean } {
  const trimmed = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  if (!trimmed || trimmed.length > MAX_PHASE_LEN) return { phase: 'General', coinedPhase: false };

  // Case-insensitive match against the canon, so "framing" becomes the
  // canonical "Framing" and does not get flagged as something new.
  const canon = (SCHEDULE_PHASES as readonly string[])
    .find(p => p.toLowerCase() === trimmed.toLowerCase());
  if (canon) return { phase: canon, coinedPhase: false };

  return { phase: trimmed, coinedPhase: true };
}

/** Lenient normalizer — a model response may omit fields; fill safe defaults.
 *  A task with no rationale/basis is treated as an `assumption` so review flags it. */
export function normalizeGeneratedTask(t: any, idx: number): GeneratedTask {
  const rationale = typeof t?.rationale === 'string' ? t.rationale : '';
  const { phase, coinedPhase } = resolvePhase(t?.phase);
  return {
    id: t?.id || `t${idx + 1}`,
    name: t?.name || t?.title || `Task ${idx + 1}`,
    phase,
    coinedPhase,
    duration: typeof t?.duration === 'number' ? t.duration : 3,
    predecessorIds: Array.isArray(t?.predecessorIds) ? t.predecessorIds : [],
    isMilestone: !!t?.isMilestone,
    isCriticalPath: !!t?.isCriticalPath,
    crewSize: typeof t?.crewSize === 'number' ? Math.min(8, Math.max(1, Math.round(t.crewSize))) : 2,
    wbs: t?.wbs || `${idx + 1}.0`,
    rationale,
    assumption: typeof t?.assumption === 'boolean' ? t.assumption : rationale.trim() === '',
    linkedCategories: Array.isArray(t?.linkedCategories) ? t.linkedCategories.map((c: any) => String(c).toLowerCase()) : [],
  };
}
