// utils/copilot/scheduleEdit/editOps.ts — the typed edit-operation vocabulary
// the AI emits, plus a pure normalizer. React/RN-free so validators drive it.
import type { DependencyType } from '@/types';

/** A task reference: a ScheduleTask.id. The resolver (interpretOps) also
 *  falls back to a case-insensitive name match. */
export type TaskRef = string;

export type EditOp =
  | { op: 'move'; task: TaskRef; deltaDays?: number; toStartDay?: number }
  | { op: 'setDuration'; task: TaskRef; days: number }
  | { op: 'addDependency'; from: TaskRef; to: TaskRef; type: DependencyType; lag: number }
  | { op: 'removeDependency'; from: TaskRef; to: TaskRef }
  | { op: 'addTask'; title: string; durationDays: number; after?: TaskRef; crew?: number; isMilestone?: boolean }
  | { op: 'removeTask'; task: TaskRef }
  | { op: 'setCrew'; task: TaskRef; crewSize: number }
  | { op: 'setProgress'; task: TaskRef; pct: number }
  | { op: 'level' };
// NOTE: a `setStartDate` op is intentionally NOT in v1 — re-anchoring the whole
// schedule interacts with the start-date-jump behavior and belongs to a
// dedicated flow, not a task-array edit. Shipping it here would be a silent
// no-op (the commit path only touches tasks). Add it deliberately later.

const DEP_TYPES: DependencyType[] = ['FS', 'SS', 'FF', 'SF'];
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const numOr = (v: unknown, fallback: number): number => (typeof v === 'number' && isFinite(v) ? v : fallback);
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Validate + clean a raw AI ops array into usable EditOps. Pure. Unknown ops,
 *  missing required refs, and out-of-bounds values are dropped/clamped rather
 *  than trusted. */
export function normalizeEditOps(raw: unknown): EditOp[] {
  if (!Array.isArray(raw)) return [];
  const out: EditOp[] = [];
  for (const r of raw) {
    const op = (r as { op?: unknown })?.op;
    if (typeof op !== 'string') continue;
    const a = r as Record<string, unknown>;
    switch (op) {
      case 'move': {
        const task = str(a.task); if (!task) break;
        const move: EditOp = { op: 'move', task };
        if (typeof a.deltaDays === 'number') move.deltaDays = Math.round(a.deltaDays);
        if (typeof a.toStartDay === 'number') move.toStartDay = Math.max(1, Math.round(a.toStartDay));
        if (move.deltaDays === undefined && move.toStartDay === undefined) break;
        out.push(move); break;
      }
      case 'setDuration': {
        const task = str(a.task); const days = numOr(a.days, NaN);
        if (task && isFinite(days) && days >= 0) out.push({ op: 'setDuration', task, days: Math.round(days) });
        break;
      }
      case 'addDependency': {
        const from = str(a.from), to = str(a.to);
        if (!from || !to || from === to) break;
        const type = DEP_TYPES.includes(a.type as DependencyType) ? (a.type as DependencyType) : 'FS';
        out.push({ op: 'addDependency', from, to, type, lag: Math.round(numOr(a.lag, 0)) });
        break;
      }
      case 'removeDependency': {
        const from = str(a.from), to = str(a.to);
        if (from && to) out.push({ op: 'removeDependency', from, to });
        break;
      }
      case 'addTask': {
        const title = str(a.title); const durationDays = numOr(a.durationDays, NaN);
        if (!title || !isFinite(durationDays) || durationDays < 0) break;
        const t: EditOp = { op: 'addTask', title, durationDays: Math.round(durationDays) };
        if (str(a.after)) t.after = str(a.after);
        if (typeof a.crew === 'number' && a.crew > 0) t.crew = Math.round(a.crew);
        if (a.isMilestone === true || durationDays === 0) t.isMilestone = true;
        out.push(t); break;
      }
      case 'removeTask': {
        const task = str(a.task); if (task) out.push({ op: 'removeTask', task }); break;
      }
      case 'setCrew': {
        const task = str(a.task); const crewSize = numOr(a.crewSize ?? a.crew, NaN);
        if (task && isFinite(crewSize) && crewSize >= 0) out.push({ op: 'setCrew', task, crewSize: Math.round(crewSize) });
        break;
      }
      case 'setProgress': {
        const task = str(a.task); const pct = numOr(a.pct, NaN);
        if (task && isFinite(pct)) out.push({ op: 'setProgress', task, pct: clamp(Math.round(pct), 0, 100) });
        break;
      }
      case 'level': out.push({ op: 'level' }); break;
      default: break;
    }
  }
  return out;
}
