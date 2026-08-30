// utils/judges/capacityLoad.ts — cross-project crew load in a date window.
// "Am I already booked solid when this job would run?" No cross-project leveling
// exists today; per project we take the UNION of its task spans (parallel tasks
// within one job don't multiply how booked you are), then sum that coverage
// across projects against the window's day capacity. Pure over Project[].
// Task spans use the project's WORKING calendar. This file used to carry an
// "approximation note" saying that mapping working-day durations onto raw
// calendar days "overstates density slightly — acceptable for a coarse signal".
// Both halves of that were wrong:
//
//   • DIRECTION. Spanning a working-day duration as calendar days makes the
//     span SHORTER than the crew's real occupancy, so busyDays comes out LOW.
//     It understated density, it did not overstate it.
//   • MAGNITUDE. One 20-working-day task in a 4-week window scored 20/28 =
//     71.4% instead of 26/28 = 92.9% — enough to flip `bookedSolid` (>= 85%)
//     from true to FALSE. A GC who is booked solid was told they had room, on
//     the signal that answers "can I take this job?". That is the dangerous
//     direction to be wrong in, and it is not slight.
//
// The window math now comes from utils/lastPlanner.taskWindow, which walks
// working days exactly as the CPM engine's EF does — one implementation rather
// than a second private copy that drifts from it.
import type { Project } from '@/types';
import type { CapacitySummary } from './types';
// Canonical task-window math (working-day aware). Note the boundary
// difference: it returns an INCLUSIVE endMs; this file works in half-open
// [start, end) intervals, so the last day is added back below.
import { taskWindow } from '@/utils/lastPlanner';

const MS_PER_DAY = 86_400_000;

function daysBetween(aISO: string, bISO: string): number {
  const a = Date.parse(aISO), b = Date.parse(bISO);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / MS_PER_DAY);
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
    // Each project brings its OWN calendar — a 6-day sub and a Mon-Fri GC do not
    // occupy the same span for the same duration. Absent settings default to
    // 7-day weeks inside taskWindow (matching utils/cpm's `?? 7`), so a project
    // that declares no calendar behaves exactly as it did before.
    const calendar = {
      workingDaysPerWeek: sched.workingDaysPerWeek,
      nonWorkingDates: sched.nonWorkingDates,
    };
    for (const t of sched.tasks) {
      const w = taskWindow(t, sched.startDate, calendar);
      if (!w) continue;
      // endMs is the task's LAST day; this loop wants a half-open interval.
      const s = Math.max(w.startMs, winStart);
      const e = Math.min(w.endMs + MS_PER_DAY, winEnd);
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
