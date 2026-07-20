// utils/copilot/scheduleEdit/interpretOps.ts — pure interpreter: apply EditOps
// to a task array with per-op guards. Never throws; every op yields an OpResult.
// React/RN-free (only domain types + cpm) so validators drive it.
import type { ScheduleTask } from '@/types';
import { wouldCreateCycle, runCpm, type RunCpmOptions } from '@/utils/cpm';
import type { EditOp } from './editOps';

export interface OpResult { op: EditOp; ok: boolean; reason?: string }

/** Resolve a TaskRef (id, else case-insensitive title match) to a task id. */
function resolveId(ref: string, tasks: ScheduleTask[]): string | null {
  if (tasks.some(t => t.id === ref)) return ref;
  const lc = ref.trim().toLowerCase();
  const byName = tasks.find(t => t.title.trim().toLowerCase() === lc)
    ?? tasks.find(t => t.title.trim().toLowerCase().includes(lc));
  return byName?.id ?? null;
}

let seq = 0;
function freshId(): string { seq += 1; return `edit-${seq}-${(seq * 2654435761 % 100000)}`; }

export function interpretScheduleOps(
  ops: EditOp[],
  tasks: ScheduleTask[],
): { nextTasks: ScheduleTask[]; results: OpResult[] } {
  let working: ScheduleTask[] = tasks.map(t => ({ ...t, dependencies: [...t.dependencies], dependencyLinks: t.dependencyLinks ? [...t.dependencyLinks] : undefined }));
  const results: OpResult[] = [];
  const patch = (id: string, over: Partial<ScheduleTask>) => { working = working.map(t => t.id === id ? { ...t, ...over } : t); };

  for (const op of ops) {
    try {
      switch (op.op) {
        case 'move': {
          const id = resolveId(op.task, working);
          if (!id) { results.push({ op, ok: false, reason: `no task matching "${op.task}"` }); break; }
          const cur = working.find(t => t.id === id)!;
          const next = op.toStartDay != null ? op.toStartDay : cur.startDay + (op.deltaDays ?? 0);
          patch(id, { startDay: Math.max(1, Math.round(next)) });
          results.push({ op, ok: true }); break;
        }
        case 'setDuration': {
          const id = resolveId(op.task, working);
          if (!id) { results.push({ op, ok: false, reason: `no task matching "${op.task}"` }); break; }
          patch(id, { durationDays: Math.max(0, Math.round(op.days)) });
          results.push({ op, ok: true }); break;
        }
        case 'setProgress': {
          const id = resolveId(op.task, working);
          if (!id) { results.push({ op, ok: false, reason: `no task matching "${op.task}"` }); break; }
          patch(id, { progress: op.pct });
          results.push({ op, ok: true }); break;
        }
        case 'setCrew': {
          const id = resolveId(op.task, working);
          if (!id) { results.push({ op, ok: false, reason: `no task matching "${op.task}"` }); break; }
          patch(id, { crewSize: op.crewSize });
          results.push({ op, ok: true }); break;
        }
        case 'addDependency': {
          const toId = resolveId(op.to, working), fromId = resolveId(op.from, working);
          if (!toId || !fromId) { results.push({ op, ok: false, reason: `couldn't resolve both tasks` }); break; }
          if (wouldCreateCycle(working, toId, fromId)) { results.push({ op, ok: false, reason: `that dependency would create a cycle` }); break; }
          const to = working.find(t => t.id === toId)!;
          const deps = to.dependencies.includes(fromId) ? to.dependencies : [...to.dependencies, fromId];
          const links = [...(to.dependencyLinks ?? []).filter(l => l.taskId !== fromId), { taskId: fromId, type: op.type, lagDays: op.lag }];
          patch(toId, { dependencies: deps, dependencyLinks: links });
          results.push({ op, ok: true }); break;
        }
        case 'removeDependency': {
          const toId = resolveId(op.to, working), fromId = resolveId(op.from, working);
          if (!toId || !fromId) { results.push({ op, ok: false, reason: `couldn't resolve both tasks` }); break; }
          const to = working.find(t => t.id === toId)!;
          patch(toId, { dependencies: to.dependencies.filter(d => d !== fromId), dependencyLinks: (to.dependencyLinks ?? []).filter(l => l.taskId !== fromId) });
          results.push({ op, ok: true }); break;
        }
        case 'removeTask': {
          const id = resolveId(op.task, working);
          if (!id) { results.push({ op, ok: false, reason: `no task matching "${op.task}"` }); break; }
          working = working.filter(t => t.id !== id).map(t => ({
            ...t,
            dependencies: t.dependencies.filter(d => d !== id),
            dependencyLinks: t.dependencyLinks?.filter(l => l.taskId !== id),
          }));
          results.push({ op, ok: true }); break;
        }
        case 'addTask': {
          const afterId = op.after ? resolveId(op.after, working) : null;
          const anchor = afterId ? working.find(t => t.id === afterId) : working[working.length - 1];
          const startDay = anchor ? anchor.startDay + anchor.durationDays : 1;
          const t: ScheduleTask = {
            id: freshId(), title: op.title, phase: anchor?.phase ?? 'General',
            durationDays: op.durationDays, startDay, progress: 0, crew: '',
            crewSize: op.crew, dependencies: afterId ? [afterId] : [], notes: '',
            status: 'not_started', isMilestone: op.isMilestone,
          };
          const idx = anchor ? working.findIndex(x => x.id === anchor.id) + 1 : working.length;
          working = [...working.slice(0, idx), t, ...working.slice(idx)];
          results.push({ op, ok: true }); break;
        }
        case 'level': {
          // Applied via applyEditEffects (which has the CPM options); the
          // interpreter just marks it applied.
          results.push({ op, ok: true }); break;
        }
        default: results.push({ op, ok: false, reason: 'unknown op' });
      }
    } catch (e) {
      results.push({ op, ok: false, reason: (e as Error).message });
    }
  }
  return { nextTasks: working, results };
}

/** Fold effects that need CPM (currently `level`) onto the task array after the
 *  pure interpreter runs. Lives here (not in the capability) so both the
 *  capability and ScheduleDiffView import it WITHOUT a cycle. Pure. */
export function applyEditEffects(ops: EditOp[], tasks: ScheduleTask[], cpmOptions: RunCpmOptions): ScheduleTask[] {
  let out = tasks;
  if (ops.some(o => o.op === 'level')) {
    const res = runCpm(out, { ...cpmOptions, levelResources: true });
    if (res.leveledStartDays) {
      const lvl = res.leveledStartDays;
      out = out.map(t => lvl.has(t.id) ? { ...t, startDay: lvl.get(t.id)! } : t);
    }
  }
  return out;
}
