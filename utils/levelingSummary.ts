// utils/levelingSummary.ts — pure summary of a resource-leveling pass. No React, no I/O.
// Compares each task's current startDay to its leveled startDay (from
// cpm.leveledStartDays) and reports only the tasks that actually move.
import type { ScheduleTask } from '../types';

export interface LevelingShift { id: string; title: string; fromDay: number; toDay: number; deltaDays: number }
export interface LevelingSummary { shiftedCount: number; maxShiftDays: number; totalShiftDays: number; shifts: LevelingShift[] }

export function summarizeLeveling(prev: ScheduleTask[], leveled: Map<string, number>): LevelingSummary {
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
    shifts.push({ id: t.id, title: t.title, fromDay: t.startDay, toDay, deltaDays: delta });
  }
  return { shiftedCount: shifts.length, maxShiftDays, totalShiftDays, shifts };
}
