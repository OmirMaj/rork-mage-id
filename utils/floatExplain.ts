// utils/floatExplain.ts — pure plain-language explanation of CPM float. No React, no I/O.
import type { ScheduleTask } from '../types';
import type { CpmResult } from './cpm';

/** Plain-language slack phrase for a task's total float. */
export function floatPhrase(totalFloat: number): string {
  if (totalFloat <= 0) return 'On the critical path — no slack';
  return `Can slip ${totalFloat} ${totalFloat === 1 ? 'day' : 'days'}`;
}

export interface CriticalPathExplanation {
  finishDay: number;
  criticalTitles: { id: string; title: string }[];
  slack: { id: string; title: string; canSlipDays: number }[];
}

/** Build a plain-language explanation from an already-computed CPM result. */
export function buildCriticalPathExplanation(cpm: CpmResult, tasks: ScheduleTask[]): CriticalPathExplanation {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const criticalTitles = cpm.criticalPath
    .map(id => ({ id, title: byId.get(id)?.title ?? id }));
  const slack = tasks
    .map(t => ({ t, r: cpm.perTask.get(t.id) }))
    .filter(({ r }) => !!r && !r.isCritical && r.totalFloat > 0)
    .map(({ t, r }) => ({ id: t.id, title: t.title, canSlipDays: r!.totalFloat }))
    .sort((a, b) => a.canSlipDays - b.canSlipDays)
    .slice(0, 20);
  return { finishDay: cpm.projectFinish, criticalTitles, slack };
}
