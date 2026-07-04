import { z } from 'zod';

export const SCHEDULE_PHASES = [
  'Site Work', 'Demo', 'Foundation', 'Framing', 'Roofing',
  'MEP', 'Plumbing', 'Electrical', 'HVAC', 'Insulation',
  'Drywall', 'Interior', 'Finishes', 'Landscaping', 'Inspections', 'General',
] as const;

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
};

/** Lenient normalizer — a model response may omit fields; fill safe defaults.
 *  A task with no rationale/basis is treated as an `assumption` so review flags it. */
export function normalizeGeneratedTask(t: any, idx: number): GeneratedTask {
  const rationale = typeof t?.rationale === 'string' ? t.rationale : '';
  return {
    id: t?.id || `t${idx + 1}`,
    name: t?.name || t?.title || `Task ${idx + 1}`,
    phase: (SCHEDULE_PHASES as readonly string[]).includes(t?.phase) ? t.phase : 'General',
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
