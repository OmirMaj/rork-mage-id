// utils/copilot/scheduleEdit/diffSchedule.ts — pure before→after schedule diff
// for the edit preview. React/RN-free.
import type { ScheduleTask, DependencyType } from '@/types';
import type { CpmResult } from '@/utils/cpm';

export interface ScheduleDiff {
  finishBeforeDay: number; finishAfterDay: number; finishDeltaDays: number;
  moved: { id: string; name: string; startDelta: number; durationDelta: number }[];
  added: { name: string; startDay: number; durationDays: number; isMilestone: boolean }[];
  removed: { name: string }[];
  depChanges: { fromName: string; toName: string; type: DependencyType; added: boolean }[];
  criticalEntered: string[];
  criticalLeft: string[];
  rejected: { summary: string }[];
}

export function diffSchedule(
  before: ScheduleTask[], after: ScheduleTask[],
  cpmBefore: CpmResult, cpmAfter: CpmResult,
  rejected: { summary: string }[] = [],
): ScheduleDiff {
  const beforeById = new Map(before.map(t => [t.id, t]));
  const afterById = new Map(after.map(t => [t.id, t]));
  const nameOf = (id: string) => afterById.get(id)?.title ?? beforeById.get(id)?.title ?? id;

  const moved: ScheduleDiff['moved'] = [];
  for (const a of after) {
    const b = beforeById.get(a.id);
    if (!b) continue;
    const startDelta = a.startDay - b.startDay;
    const durationDelta = a.durationDays - b.durationDays;
    if (startDelta !== 0 || durationDelta !== 0) moved.push({ id: a.id, name: a.title, startDelta, durationDelta });
  }
  const added = after.filter(a => !beforeById.has(a.id))
    .map(a => ({ name: a.title, startDay: a.startDay, durationDays: a.durationDays, isMilestone: !!a.isMilestone }));
  const removed = before.filter(b => !afterById.has(b.id)).map(b => ({ name: b.title }));

  const depChanges: ScheduleDiff['depChanges'] = [];
  for (const a of after) {
    const b = beforeById.get(a.id);
    const beforeDeps = new Set(b?.dependencies ?? []);
    const afterDeps = new Set(a.dependencies);
    for (const dep of afterDeps) if (!beforeDeps.has(dep)) {
      const type = a.dependencyLinks?.find(l => l.taskId === dep)?.type ?? 'FS';
      depChanges.push({ fromName: nameOf(dep), toName: a.title, type, added: true });
    }
    for (const dep of beforeDeps) if (!afterDeps.has(dep)) depChanges.push({ fromName: nameOf(dep), toName: a.title, type: 'FS', added: false });
  }

  const critBefore = new Set([...cpmBefore.perTask].filter(([, r]) => r.isCritical).map(([id]) => id));
  const critAfter = new Set([...cpmAfter.perTask].filter(([, r]) => r.isCritical).map(([id]) => id));
  const criticalEntered = [...critAfter].filter(id => !critBefore.has(id)).map(nameOf);
  const criticalLeft = [...critBefore].filter(id => !critAfter.has(id) && afterById.has(id)).map(nameOf);

  return {
    finishBeforeDay: cpmBefore.projectFinish,
    finishAfterDay: cpmAfter.projectFinish,
    finishDeltaDays: cpmAfter.projectFinish - cpmBefore.projectFinish,
    moved, added, removed, depChanges, criticalEntered, criticalLeft, rejected,
  };
}
