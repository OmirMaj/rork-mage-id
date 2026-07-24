// utils/delayScan/matchTask.ts — resolve the AI's task-title guess to a real
// ScheduleTask for PRE-SELECTION in the confirm row. Deliberately stricter
// than the copilot resolver (interpretOps.resolveId): ambiguity returns null
// so the USER picks, instead of silently taking the first substring hit.
// Pure; React/RN-free so the validator drives it.
import type { ScheduleTask } from '@/types';

function norm(s: string): string {
  return (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function matchTaskByTitle(guess: string, tasks: ScheduleTask[]): ScheduleTask | null {
  const g = norm(guess);
  if (!g) return null;
  const exact = (tasks ?? []).filter(t => norm(t.title) === g);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const sub = (tasks ?? []).filter(t => {
    const title = norm(t.title);
    return title.length > 0 && (title.includes(g) || g.includes(title));
  });
  return sub.length === 1 ? sub[0] : null;
}
