// utils/levelingSummary.ts — pure summary of a resource-leveling pass. No React, no I/O.
// Compares each task's current startDay to its leveled startDay (from
// cpm.leveledStartDays) and reports only the tasks that actually move.
import type { ScheduleTask } from '../types';
import type { CpmConflict } from '../utils/cpm';

export interface LevelingShift {
  id: string; title: string; fromDay: number; toDay: number; deltaDays: number;
  /**
   * WHY this task moved, in one sentence, from the engine's own conflict for
   * it. `levelResources` has always known the resource, the counterpart task,
   * the working days of delay, the float available and consumed, and whether
   * the finish moves — and this summary used to throw all of it away and
   * rebuild the list from the bare id→day map, so the preview said "Day 12 → 19"
   * and nothing else. A superintendent cannot approve a move they cannot see a
   * reason for.
   */
  reason?: string;
  /** The resource key the move frees up (e.g. `crew:framers`), unprefixed. */
  resource?: string;
  /** Title of the task this one was competing with. */
  counterpartTitle?: string;
  /** Whether this move pushes the project finish (float was not enough). */
  pushesFinish?: boolean;
}
export interface LevelingSummary { shiftedCount: number; maxShiftDays: number; totalShiftDays: number; shifts: LevelingShift[] }

/**
 * `conflicts` is optional so existing callers keep compiling, but pass it:
 * without it every row is a bare day-number move. runCpm returns them on
 * `CpmResult.conflicts` with kind `resource_overallocation` /
 * `resource_delayed_project`; the delayed task is `taskIds[0]`.
 */
export function summarizeLeveling(
  prev: ScheduleTask[],
  leveled: Map<string, number>,
  conflicts?: CpmConflict[],
): LevelingSummary {
  const reasonById = new Map<string, CpmConflict>();
  for (const c of conflicts ?? []) {
    if (c.kind !== 'resource_overallocation' && c.kind !== 'resource_delayed_project') continue;
    const id = c.taskIds[0];
    // A task can be delayed more than once (several resources). Keep the FIRST
    // — it is the move the id→day map's `fromDay` actually corresponds to.
    if (id && !reasonById.has(id)) reasonById.set(id, c);
  }
  const shifts: LevelingShift[] = [];
  let maxShiftDays = 0;
  let totalShiftDays = 0;
  for (const t of prev) {
    const toDay = leveled.get(t.id);
    if (toDay === undefined) continue;
    const delta = toDay - t.startDay;
    if (delta === 0) continue;
    const abs = Math.abs(delta);
    maxShiftDays = Math.max(maxShiftDays, abs);
    totalShiftDays += abs;
    const c = reasonById.get(t.id);
    const detail = (c?.detail ?? {}) as {
      resource?: string; counterpartTitle?: string; pushesFinish?: boolean;
    };
    shifts.push({
      id: t.id, title: t.title, fromDay: t.startDay, toDay, deltaDays: delta,
      ...(c ? {
        reason: c.message,
        resource: typeof detail.resource === 'string'
          ? detail.resource.replace(/^(sub|crew|res):/, '') : undefined,
        counterpartTitle: detail.counterpartTitle,
        pushesFinish: !!detail.pushesFinish,
      } : {}),
    });
  }
  return { shiftedCount: shifts.length, maxShiftDays, totalShiftDays, shifts };
}
