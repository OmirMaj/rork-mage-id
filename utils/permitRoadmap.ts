import { z } from 'zod';
import type { Project, ScheduleTask, PermitRoadmap, RoadmapPermit, RoadmapInspection } from '@/types';
import { mageAISmart } from '@/utils/mageAI';
import { createId } from '@/utils/scheduleEngine';
import { projectTypeLabel } from '@/utils/projectTypes';
// The date + flag arithmetic moved to a PURE sibling so a validator can import
// it without pulling react-native in through mageAI. Re-exported here so every
// existing call site and import path is untouched.
export { bookByDate, roadmapFlags, type RoadmapLead } from '@/utils/permitRoadmapSchedule';

export const roadmapSchema = z.object({
  permits: z.array(z.object({
    type: z.string().catch('other').default('other'),
    title: z.string().catch('').default(''),
    description: z.string().catch('').default(''),
    whoPulls: z.enum(['gc', 'sub', 'owner']).catch('gc').default('gc'),
    leadTimeDays: z.number().catch(5).default(5),
  })).default([]),
  inspections: z.array(z.object({
    type: z.string().catch('other').default('other'),
    title: z.string().catch('').default(''),
    description: z.string().catch('').default(''),
    gatesTaskHint: z.string().catch('').default(''),
    leadTimeDays: z.number().catch(3).default(3),
  })).default([]),
});

// Uses linkedEstimate.items[].name — the real field on LinkedEstimateItem.
// Exported so Code Check and other callers can build a project-scope prefix
// without duplicating this logic.
export function scopeSummary(project: Project): string {
  const est = project.linkedEstimate;
  const items = (est && Array.isArray(est.items))
    ? est.items.map((li) => li.name).filter(Boolean)
    : [];
  return items.slice(0, 60).join('; ');
}

export function scopeHashOf(project: Project): string {
  const tasks = (project.schedule?.tasks ?? []).map((t) => `${t.title}:${t.startDay}:${t.durationDays}`).join('|');
  const s = scopeSummary(project) + '::' + tasks;
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return String(h);
}

export function resolveGatingTask(hint: string, tasks: ScheduleTask[]): ScheduleTask | null {
  const h = hint.trim().toLowerCase();
  if (!h) return null;
  return tasks.find((t) => (t.title || '').toLowerCase().includes(h) || (t.phase || '').toLowerCase().includes(h)) ?? null;
}

/**
 * Grounding the roadmap prompt carries, and the key fragment that makes it part
 * of the cache identity.
 *
 * The prompt used to hand the model `project.location` as RAW FREE TEXT and
 * nothing else — no adopted-code record, no issuing authority, and no sight of
 * the contractor's own permit or inspection file — and then asked it for a
 * `leadTimeDays` integer that the screen rendered as a date. The blocks are
 * built by the callers (utils/codeJurisdiction.ts groundingFactsFor,
 * utils/permitInspectionFacts.ts, utils/automation/learnedLeadTime.ts) and
 * inserted verbatim, so the model is told exactly what the on-screen chips
 * claim it was told.
 */
export interface RoadmapGrounding {
  /** Inserted into the prompt verbatim, in order. */
  blocks: string[];
  /** Stable fragment identifying this grounding. MUST change whenever `blocks`
   *  changes, or a cached roadmap answers a prompt it never saw. */
  key: string;
}

export async function generateRoadmap(
  project: Project,
  opts?: { forceFresh?: boolean; grounding?: RoadmapGrounding },
): Promise<{ ok: true; roadmap: PermitRoadmap; cached: boolean } | { ok: false; error: string }> {
  const tasks = project.schedule?.tasks ?? [];
  const taskList = tasks.map((t) => `- ${t.title} [${t.phase || 'General'}] day ${t.startDay ?? 0}`).join('\n');
  const groundingBlock = (opts?.grounding?.blocks ?? []).filter(Boolean).join('\n\n');
  const prompt = `You are a construction permitting expert. For this project, list the PERMITS required (inferred from the scope) and the INSPECTIONS required, sequenced to the schedule.\n\nLOCATION: ${project.location || 'unknown'}\n${groundingBlock ? groundingBlock + '\n' : ''}PROJECT TYPE: ${projectTypeLabel(project) || 'unknown'}\nSCOPE (estimate line items): ${scopeSummary(project) || '(none — infer from project type)'}\nSCHEDULE TASKS:\n${taskList || '(no schedule)'}\n\nFor each permit: type, title, description (tie to the scope), whoPulls (gc/sub/owner), leadTimeDays (typical issuance lead).\nFor each inspection: type, title, description, gatesTaskHint (the schedule task/phase keyword this inspection must precede, e.g. "Drywall"), leadTimeDays (book-ahead lead).\nReturn ONLY JSON matching the schema.`;
  // Cache key carries a version tag (`v2`) so the model-hint fix invalidates any
  // stale empty roadmaps cached under the old key. Regenerate forces a fresh call
  // (no cacheKey → mageAI skips the cache read/write) so "Regenerate" always
  // re-runs the model instead of returning a cached result.
  // v3: the grounding blocks are part of the prompt, so they are part of the
  // key. A v2 key would have served a roadmap generated with NO jurisdiction
  // and NO permit history back to a prompt that now carries both.
  const cacheKey = opts?.forceFresh
    ? undefined
    : `roadmap::v3::${project.id}::${scopeHashOf(project)}::${opts?.grounding?.key ?? 'ungrounded'}`;
  const res = await mageAISmart(prompt, roadmapSchema, cacheKey);
  if (!res.success) return { ok: false, error: res.error || 'Roadmap unavailable right now.' };
  const data = res.data as z.infer<typeof roadmapSchema>;
  const roadmap: PermitRoadmap = {
    id: createId('roadmap'),
    projectId: project.id,
    generatedAt: new Date().toISOString(),
    scopeHash: scopeHashOf(project),
    permits: data.permits.map((p): RoadmapPermit => ({ ...p, id: createId('rmp'), status: 'needed' as const })),
    inspections: data.inspections.map((i): RoadmapInspection => {
      const t = resolveGatingTask(i.gatesTaskHint, tasks);
      return { ...i, id: createId('rmi'), status: 'pending' as const, gatesTaskId: t?.id };
    }),
  };
  return { ok: true, roadmap, cached: res.cached ?? false };
}
