// utils/delayScan/rfiBlocking.ts — does this open RFI sit on a task with no
// float? Pure wrapper over runCpm so the RFI screen can warn "this answer is
// holding up the critical path". The screen wraps the call in useMemo (memo-
// friendly: plain args in, plain object out). Null-safe on every input;
// never throws. React/RN-free so the validator drives it.
import type { ProjectSchedule, RFI } from '@/types';
import { runCpm, type RunCpmOptions } from '@/utils/cpm';

export interface RfiBlockStatus {
  critical: boolean;
  taskTitle?: string;
  totalFloat?: number;
}

const NOT_BLOCKING: RfiBlockStatus = { critical: false };

/**
 * How many LOCAL calendar days past due a date is. Compares local y/m/d
 * components (not elapsed 24h blocks), so a due date stored as noon UTC —
 * DatePickerModal's anchor — reads as overdue at local midnight after the due
 * day, not at some arbitrary hour the next morning. Due today → 0 (not
 * overdue all day). Invalid/empty input → 0. Pure; `now` injectable for tests.
 */
export function overdueCalendarDays(dueIso: string | null | undefined, now: Date = new Date()): number {
  if (!dueIso) return 0;
  const due = new Date(dueIso);
  if (Number.isNaN(due.getTime())) return 0;
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  // Math.round absorbs DST-shifted 23h/25h "days" in the local-midnight diff.
  return Math.max(0, Math.round((today - dueDay) / 86400000));
}

export function rfiBlockStatus(
  rfi: Pick<RFI, 'linkedTaskId' | 'status'>,
  schedule: ProjectSchedule | null | undefined,
  cpmOptions: RunCpmOptions = {},
): RfiBlockStatus {
  try {
    if (!rfi?.linkedTaskId) return NOT_BLOCKING;
    if (rfi.status !== 'open') return NOT_BLOCKING;
    const tasks = schedule?.tasks ?? [];
    const task = tasks.find(t => t.id === rfi.linkedTaskId);
    if (!task) return NOT_BLOCKING;
    if (task.status === 'done' || task.progress >= 100) return NOT_BLOCKING; // finished work can't be blocked
    const cpm = runCpm(tasks, cpmOptions);
    const r = cpm.perTask.get(task.id);
    if (!r) return NOT_BLOCKING;
    return { critical: r.isCritical, taskTitle: task.title, totalFloat: r.totalFloat };
  } catch {
    return NOT_BLOCKING;
  }
}
