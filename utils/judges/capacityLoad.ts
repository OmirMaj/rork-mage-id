// utils/judges/capacityLoad.ts — cross-project crew load in a date window.
// "Am I already booked solid when this job would run?" No cross-project leveling
// exists today; per project we take the UNION of its task spans (parallel tasks
// within one job don't multiply how booked you are), then sum that coverage
// across projects against the window's day capacity. Pure over Project[].
// Approximation note: schedule startDay/durationDays are working-day indices;
// mapping them to raw calendar days overstates density slightly — acceptable
// for a coarse "how booked am I" signal, not for date math.
import type { Project, ScheduleTask } from '@/types';
import type { CapacitySummary } from './types';

const MS_PER_DAY = 86_400_000;

function daysBetween(aISO: string, bISO: string): number {
  const a = Date.parse(aISO), b = Date.parse(bISO);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / MS_PER_DAY);
}

/** Task calendar span [startDayISO, endDayISO) from schedule.startDate + startDay/duration. */
function taskWindow(scheduleStartISO: string, task: ScheduleTask): { start: number; end: number } | null {
  const base = Date.parse(scheduleStartISO);
  if (!Number.isFinite(base)) return null;
  const startDay = Math.max(1, Math.floor(task.startDay ?? 1));
  const dur = Math.max(1, Math.floor(task.durationDays ?? 1));
  const start = base + (startDay - 1) * MS_PER_DAY;
  const end = start + dur * MS_PER_DAY;
  return { start, end };
}

export function computeCapacityLoad(projects: Project[], windowStartISO: string, windowEndISO: string): CapacitySummary {
  const winStart = Date.parse(windowStartISO);
  const winEnd = Date.parse(windowEndISO);
  const windowDays = Math.max(1, daysBetween(windowStartISO, windowEndISO));
  if (!Number.isFinite(winStart) || !Number.isFinite(winEnd) || winEnd <= winStart) {
    return { loadPct: 0, bookedSolid: false, overlappingProjects: 0 };
  }

  let busyDays = 0;
  let overlapping = 0;
  for (const p of projects) {
    if (p.status === 'completed' || p.status === 'closed' || p.status === 'draft') continue;
    const sched = p.schedule;
    if (!sched?.startDate || !Array.isArray(sched.tasks) || sched.tasks.length === 0) continue;
    // Union of this project's task spans inside the window — parallel tasks in
    // one job count once, not N times.
    const intervals: { s: number; e: number }[] = [];
    for (const t of sched.tasks) {
      const w = taskWindow(sched.startDate, t);
      if (!w) continue;
      const s = Math.max(w.start, winStart);
      const e = Math.min(w.end, winEnd);
      if (e > s) intervals.push({ s, e });
    }
    if (intervals.length > 0) {
      intervals.sort((a, b) => a.s - b.s);
      let covered = 0;
      let curS = intervals[0].s, curE = intervals[0].e;
      for (let i = 1; i < intervals.length; i++) {
        const iv = intervals[i];
        if (iv.s <= curE) curE = Math.max(curE, iv.e);
        else { covered += curE - curS; curS = iv.s; curE = iv.e; }
      }
      covered += curE - curS;
      busyDays += covered / MS_PER_DAY;
      overlapping += 1;
    }
  }

  // Capacity = the window's days per concurrent project already running. With one
  // crew baseline, loadPct is busyDays / windowDays, capped at 1.
  const loadPct = Math.min(1, busyDays / windowDays);
  return { loadPct, bookedSolid: loadPct >= 0.85, overlappingProjects: overlapping };
}
