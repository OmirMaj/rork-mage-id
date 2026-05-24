import { z } from 'zod';
import type { Project, ScheduleTask, PermitRoadmap, RoadmapPermit, RoadmapInspection, RoadmapFlag } from '@/types';
import { mageAISmart } from '@/utils/mageAI';
import { createId } from '@/utils/scheduleEngine';

const MS_DAY = 86400000;

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
function scopeSummary(project: Project): string {
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

export function bookByDate(insp: RoadmapInspection, tasks: ScheduleTask[], startDate: string): Date | null {
  const t = insp.gatesTaskId ? tasks.find((x) => x.id === insp.gatesTaskId) : null;
  if (!t) return null;
  const base = new Date(startDate); base.setHours(0, 0, 0, 0);
  return new Date(base.getTime() + (t.startDay ?? 0) * MS_DAY - insp.leadTimeDays * MS_DAY);
}

export function roadmapFlags(roadmap: PermitRoadmap, tasks: ScheduleTask[], startDate: string): RoadmapFlag[] {
  const out: RoadmapFlag[] = [];
  const now = Date.now();
  for (const insp of roadmap.inspections) {
    if (insp.status === 'passed') continue;
    const by = bookByDate(insp, tasks, startDate);
    if (by && by.getTime() <= now + 7 * MS_DAY) {
      const overdue = by.getTime() < now;
      out.push({ kind: 'inspection', itemId: insp.id, severity: overdue ? 'high' : 'med',
        message: `${insp.title}: ${overdue ? 'book-by date passed' : 'book by ' + by.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` });
    }
  }
  for (const p of roadmap.permits) {
    if (p.status === 'needed') out.push({ kind: 'permit', itemId: p.id, severity: 'med', message: `${p.title}: not pulled yet` });
  }
  return out;
}

export async function generateRoadmap(project: Project): Promise<{ ok: true; roadmap: PermitRoadmap } | { ok: false; error: string }> {
  const tasks = project.schedule?.tasks ?? [];
  const taskList = tasks.map((t) => `- ${t.title} [${t.phase || 'General'}] day ${t.startDay ?? 0}`).join('\n');
  const prompt = `You are a construction permitting expert. For this project, list the PERMITS required (inferred from the scope) and the INSPECTIONS required, sequenced to the schedule.\n\nLOCATION: ${project.location || 'unknown'}\nPROJECT TYPE: ${project.type || 'unknown'}\nSCOPE (estimate line items): ${scopeSummary(project) || '(none — infer from project type)'}\nSCHEDULE TASKS:\n${taskList || '(no schedule)'}\n\nFor each permit: type, title, description (tie to the scope), whoPulls (gc/sub/owner), leadTimeDays (typical issuance lead).\nFor each inspection: type, title, description, gatesTaskHint (the schedule task/phase keyword this inspection must precede, e.g. "Drywall"), leadTimeDays (book-ahead lead).\nReturn ONLY JSON matching the schema.`;
  const res = await mageAISmart(prompt, roadmapSchema, `roadmap::${project.id}::${scopeHashOf(project)}`);
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
  return { ok: true, roadmap };
}
