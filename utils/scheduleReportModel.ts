import type { Project, ScheduleTask, ScheduleBaseline } from '@/types';
import {
  workingOrdinalToCalendarIndex, workingDaysBetween,
  type CpmResult, type DayScaleOptions,
} from '@/utils/cpm';

const MS_DAY = 86400000;

export type ReportPaperSize = 'letter' | 'a4' | 'tabloid' | 'a3' | 'arch_d' | 'arch_e';
export type ReportSectionKey =
  | 'kpis' | 'critPath' | 'risks' | 'lookahead' | 'milestones'
  | 'gantt' | 'slippages' | 'phaseProgress' | 'weather' | 'register';

export interface ReportOptions {
  paperSize: ReportPaperSize;
  orientation: 'landscape' | 'portrait';
  sections: ReportSectionKey[];
  fitToOnePage: boolean;
  showPredecessors: boolean;
  singleWallSheet: boolean;
}

export interface ReportGanttRow {
  index: number; title: string; phase: string; crew: string;
  startIso: string; finishIso: string;
  baselineFinishIso: string | null; deltaDays: number | null;
  totalFloat: number; freeFloat: number; percent: number;
  predecessors: string;
  isCritical: boolean; isSummary: boolean; isMilestone: boolean;
  bar: { leftPct: number; widthPct: number };
  baselineBar: { leftPct: number; widthPct: number } | null;
}

export interface ScheduleReportModel {
  header: {
    projectName: string; location: string; company: string | null; client: string | null;
    reportDateIso: string; dataDateIso: string; startIso: string;
    forecastFinishIso: string; baselineFinishIso: string | null; forecastVarianceDays: number | null;
    taskCount: number; phaseCount: number; spanDays: number;
  };
  kpis: {
    percentComplete: number; tasksDone: number; tasksTotal: number;
    forecastVarianceDays: number | null; spi: number; svDays: number | null;
    criticalCount: number; minTotalFloat: number;
    behindCount: number; overdueCount: number; unstaffedCount: number;
  };
  criticalPath: { id: string; title: string; startIso: string; finishIso: string; isMilestone: boolean }[];
  risks: { kind: 'overdue' | 'zero_float' | 'low_float' | 'unstaffed' | 'behind' | 'inspection'; severity: 'hi' | 'md' | 'lo'; text: string }[];
  lookahead: { weekLabel: string; items: { title: string; crew: string; startIso: string; finishIso: string; isMilestone: boolean }[] }[];
  milestones: { title: string; dateIso: string; varianceDays: number | null; onTime: boolean }[];
  ganttRows: ReportGanttRow[];
  slippages: { title: string; deltaDays: number }[];
  phaseProgress: { phase: string; percent: number }[];
  weatherClosures: { label: string; note: string }[];
}

function startOfDayMs(d: Date): number { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); }
function isoAddDays(startIso: string, dayNumber: number): string {
  const d = new Date(startIso + 'T00:00:00');
  if (!Number.isFinite(d.getTime())) return '—';
  d.setDate(d.getDate() + Math.max(0, dayNumber - 1));
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function isoShort(startIso: string, dayNumber: number): string {
  const d = new Date(startIso + 'T00:00:00');
  if (!Number.isFinite(d.getTime())) return '—';
  d.setDate(d.getDate() + Math.max(0, dayNumber - 1));
  return d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
}
// ---------------------------------------------------------------------------
// ONE CLOCK FOR THE WHOLE REPORT
// ---------------------------------------------------------------------------
// Every day number in this file is a CALENDAR INDEX (day 1 = startDateIso, every
// calendar day consumes an index) — because `dayCursor` is one, `isoAddDays` /
// `isoShort` render one, and everything on `cpm.perTask` is one.
//
// This file used to mix two scales inside a single document. `ganttRows` read
// cpm.es/ef (calendar) while the Critical Path table, the 3-week lookahead and
// the milestone list read `t.startDay` / `finishDay(t)` (WORKING ordinals), so
// the SAME TASK printed different dates in two tables of the same PDF. And
// `finishDay(t) = startDay + durationDays - 1` added a working-day duration to a
// number then compared against the calendar `dayCursor`, so a 20-working-day
// task starting day 1 on a 5-day week was called overdue from calendar day 21 —
// six days early. (utils/crossProjectLoad.ts:32-35 documents the same class of
// bug as one this repo had already fixed elsewhere.)
//
// `taskWindow` below is the single accessor. It prefers the engine and falls
// back to converting the stored working ordinal, never to mixing the two.
interface TaskWindow { es: number; ef: number }

function makeTaskWindow(cpm: CpmResult, scale: DayScaleOptions) {
  return (t: ScheduleTask): TaskWindow => {
    const ct = cpm.perTask.get(t.id);
    if (ct) return { es: ct.es, ef: ct.ef };
    const es = workingOrdinalToCalendarIndex(t.startDay ?? 1, scale);
    const ef = workingOrdinalToCalendarIndex((t.startDay ?? 1) + Math.max(1, t.durationDays || 1) - 1, scale);
    return { es, ef };
  };
}

export function scheduleSpi(
  tasks: ScheduleTask[],
  dayCursor: number,
  windowOf?: (t: ScheduleTask) => TaskWindow,
): number {
  let earned = 0, planned = 0;
  for (const t of tasks) {
    if (t.isSummary || t.isMilestone) continue;
    const dur = Math.max(1, t.durationDays || 1);
    earned += dur * Math.max(0, Math.min(100, t.progress ?? 0)) / 100;
    // `dayCursor` is a CALENDAR index, so the window it is compared against has
    // to be one too. The planned fraction is then the calendar-elapsed share of
    // the task's calendar span — the same basis on both sides of the ratio.
    const w = windowOf ? windowOf(t) : { es: t.startDay ?? 1, ef: (t.startDay ?? 1) + dur - 1 };
    const span = Math.max(1, w.ef - w.es + 1);
    const frac = dayCursor >= w.ef ? 1 : dayCursor < w.es ? 0 : (dayCursor - w.es + 1) / span;
    planned += dur * frac;
  }
  return planned > 0 ? earned / planned : 1;
}

export function detectRisks(
  tasks: ScheduleTask[], cpm: CpmResult, dayCursor: number,
  /** Baseline finish per task, already on the CALENDAR scale. */
  baselineEndById: Map<string, number>,
  windowOf: (t: ScheduleTask) => TaskWindow,
  /** Working-day gap between two calendar indices, for honest variance text. */
  slipDays: (fromDay: number, toDay: number) => number,
): ScheduleReportModel['risks'] {
  const out: ScheduleReportModel['risks'] = [];
  for (const t of tasks) {
    if (t.isSummary) continue;
    const done = t.status === 'done' || (t.progress ?? 0) >= 100;
    const ct = cpm.perTask.get(t.id);
    const tf = ct?.totalFloat ?? 0;
    const w = windowOf(t);
    if (!done && w.ef < dayCursor) out.push({ kind: 'overdue', severity: 'hi', text: `${t.title} — overdue, ${t.progress ?? 0}%` });
    else if (!done && tf <= 0 && !t.isMilestone) out.push({ kind: 'zero_float', severity: 'hi', text: `${t.title} — 0 float (drives finish)` });
    else if (!done && tf > 0 && tf <= 2 && !t.isMilestone) out.push({ kind: 'low_float', severity: 'md', text: `${t.title} — only ${tf}d float` });
    if (!done && !t.isMilestone && !(t.crew || '').trim() && !t.assignedSubName) out.push({ kind: 'unstaffed', severity: 'lo', text: `${t.title} — no crew assigned` });
    const blEnd = baselineEndById.get(t.id);
    if (blEnd != null) {
      const slip = slipDays(blEnd, w.ef);
      if (slip >= 2) out.push({ kind: 'behind', severity: 'md', text: `${t.title} — +${slip}d vs baseline` });
    }
    if (!done && t.isMilestone && /inspect/i.test(t.title) && w.es >= dayCursor && w.es <= dayCursor + 21) out.push({ kind: 'inspection', severity: 'md', text: `${t.title} — upcoming inspection, book ahead` });
  }
  return out.slice(0, 10);
}

export function pickPaperSize(taskCount: number): ReportPaperSize {
  if (taskCount <= 12) return 'letter';
  if (taskCount <= 35) return 'a3';
  if (taskCount <= 80) return 'arch_d';
  return 'arch_e';
}

export function assembleScheduleReport(input: {
  project: Project;
  tasks: ScheduleTask[];
  startDateIso: string;
  cpm: CpmResult;
  baseline?: ScheduleBaseline | null;
  company?: { name?: string } | null;
  nonWorkingDates?: string[];
  reportDate?: Date;
}): ScheduleReportModel {
  const { project, tasks, startDateIso, cpm, baseline, company, nonWorkingDates } = input;
  const reportDate = input.reportDate ?? new Date();
  const baseMs = startOfDayMs(new Date(startDateIso + 'T00:00:00'));
  const dayCursor = Math.max(1, Math.round((startOfDayMs(reportDate) - baseMs) / MS_DAY) + 1);

  // The project calendar, taken off the project itself so the (not-owned-here)
  // call site needs no change. Without it every conversion below degrades to
  // the identity, which is exactly the 7-day-week case where the two scales
  // genuinely coincide.
  const scale: DayScaleOptions = {
    scheduleStartDate: startDateIso,
    workingDaysPerWeek: project.schedule?.workingDaysPerWeek,
    nonWorkingDates: project.schedule?.nonWorkingDates ?? nonWorkingDates,
  };
  const windowOf = makeTaskWindow(cpm, scale);
  const toCalendar = (workingOrdinal: number) => workingOrdinalToCalendarIndex(workingOrdinal, scale);
  /** Variance between two CALENDAR indices, expressed in working days. */
  const slipDays = (fromDay: number, toDay: number) => workingDaysBetween(fromDay, toDay, scale);

  // Baseline rows persist WORKING ordinals (captureBaseline writes startDay and
  // a raw startDay + dur - 1). Lift them onto the calendar scale ONCE, here, so
  // every comparison below is calendar-vs-calendar. Subtracting a raw baseline
  // endDay from the calendar-aware cpm.projectFinish is the phantom-slip bug
  // schedule-pro fixed for its own KPI (see the comment at app/schedule-pro.tsx
  // around baselineFinishDayWorkingScale); the report was still doing it.
  const baselineEndById = new Map<string, number>();
  if (baseline?.tasks?.length) for (const b of baseline.tasks) baselineEndById.set(b.id, toCalendar(b.endDay));
  else for (const t of tasks) if (t.baselineEndDay != null) baselineEndById.set(t.id, toCalendar(t.baselineEndDay));

  const baselineFinishDay = baselineEndById.size ? Math.max(...baselineEndById.values()) : null;
  const forecastFinishDay = cpm.projectFinish;
  const totalDays = Math.max(1, forecastFinishDay, baselineFinishDay ?? 1);
  // In WORKING days, like every other variance the app reports.
  const forecastVarianceDays = baselineFinishDay != null ? slipDays(baselineFinishDay, forecastFinishDay) : null;

  const real = tasks.filter((t) => !t.isSummary);
  const totalDur = real.reduce((s, t) => s + Math.max(1, t.durationDays || 1), 0);
  const percentComplete = totalDur > 0 ? Math.round(real.reduce((s, t) => s + (t.progress ?? 0) * Math.max(1, t.durationDays || 1), 0) / totalDur) : 0;
  const tasksDone = real.filter((t) => t.status === 'done' || (t.progress ?? 0) >= 100).length;

  const ganttRows: ReportGanttRow[] = tasks.map((t, i) => {
    const ct = cpm.perTask.get(t.id);
    const { es, ef } = windowOf(t);
    const dur = Math.max(1, t.durationDays || 1);
    const blEnd = baselineEndById.get(t.id) ?? null;
    const rawBlStart = baseline?.tasks?.find((b) => b.id === t.id)?.startDay ?? t.baselineStartDay ?? null;
    const blStart = rawBlStart != null ? toCalendar(rawBlStart) : null;
    return {
      index: i + 1, title: t.title || 'Untitled', phase: t.phase || 'General', crew: t.crew || (t.assignedSubName ?? ''),
      startIso: isoShort(startDateIso, es), finishIso: isoShort(startDateIso, ef),
      baselineFinishIso: blEnd != null ? isoShort(startDateIso, blEnd) : null,
      // Working days, both operands on the calendar scale. `ef - blEnd` mixed a
      // calendar EF with a raw working endDay, so the Slippages list and
      // behindCount fabricated variance per task on an unchanged schedule.
      deltaDays: blEnd != null ? slipDays(blEnd, ef) : null,
      totalFloat: ct?.totalFloat ?? 0, freeFloat: ct?.freeFloat ?? 0,
      percent: Math.max(0, Math.min(100, t.progress ?? 0)),
      predecessors: (t.dependencies ?? []).map((id) => tasks.findIndex((x) => x.id === id) + 1).filter((n) => n > 0).join(', '),
      isCritical: !!ct?.isCritical && t.status !== 'done', isSummary: !!t.isSummary, isMilestone: !!t.isMilestone || dur === 0,
      // The bar axis is calendar days wide (totalDays is cpm.projectFinish), so
      // the width has to be the CALENDAR span, not the working duration.
      bar: { leftPct: ((es - 1) / totalDays) * 100, widthPct: Math.max(0.4, ((ef - es + 1) / totalDays) * 100) },
      baselineBar: blStart != null && blEnd != null ? { leftPct: ((blStart - 1) / totalDays) * 100, widthPct: Math.max(0.4, ((blEnd - blStart + 1) / totalDays) * 100) } : null,
    };
  });

  const phaseSet = new Set(real.map((t) => t.phase || 'General'));
  const phaseProgress = Array.from(phaseSet).map((phase) => {
    const ts = real.filter((t) => (t.phase || 'General') === phase);
    const dur = ts.reduce((s, t) => s + Math.max(1, t.durationDays || 1), 0);
    const pct = dur > 0 ? Math.round(ts.reduce((s, t) => s + (t.progress ?? 0) * Math.max(1, t.durationDays || 1), 0) / dur) : 0;
    return { phase, percent: pct };
  });

  const criticalPath = cpm.criticalPath
    .map((id) => tasks.find((t) => t.id === id))
    .filter((t): t is ScheduleTask => !!t && !t.isSummary)
    .map((t) => { const w = windowOf(t); return { id: t.id, title: t.title || 'Untitled', startIso: isoShort(startDateIso, w.es), finishIso: isoShort(startDateIso, w.ef), isMilestone: !!t.isMilestone }; });

  const lookahead = [0, 1, 2].map((w) => {
    const lo = dayCursor + w * 7, hi = lo + 6;
    const items = real
      .filter((t) => { const w = windowOf(t); return w.es <= hi && w.ef >= lo; })
      .slice(0, 6)
      .map((t) => { const w = windowOf(t); return { title: t.title || 'Untitled', crew: t.crew || (t.assignedSubName ?? ''), startIso: isoShort(startDateIso, w.es), finishIso: isoShort(startDateIso, w.ef), isMilestone: !!t.isMilestone }; });
    return { weekLabel: w === 0 ? 'This week' : w === 1 ? 'Next week' : '+2 weeks', items };
  });

  const milestones = tasks
    .filter((t) => (t.isMilestone || (t.durationDays || 0) === 0) && windowOf(t).ef >= dayCursor)
    .slice(0, 8)
    .map((t) => { const w = windowOf(t); const blEnd = baselineEndById.get(t.id) ?? null; const v = blEnd != null ? slipDays(blEnd, w.ef) : null; return { title: t.title || 'Milestone', dateIso: isoShort(startDateIso, w.ef), varianceDays: v, onTime: v == null || v <= 0 }; });

  const slippages = ganttRows.filter((r) => (r.deltaDays ?? 0) > 0).sort((a, b) => (b.deltaDays ?? 0) - (a.deltaDays ?? 0)).slice(0, 8).map((r) => ({ title: r.title, deltaDays: r.deltaDays ?? 0 }));

  const minTotalFloat = real.length ? Math.min(...real.map((t) => cpm.perTask.get(t.id)?.totalFloat ?? 0)) : 0;
  const overdueCount = real.filter((t) => (t.status !== 'done' && (t.progress ?? 0) < 100) && windowOf(t).ef < dayCursor).length;
  const unstaffedCount = real.filter((t) => !t.isMilestone && !(t.crew || '').trim() && !t.assignedSubName && (t.status !== 'done')).length;
  const behindCount = ganttRows.filter((r) => (r.deltaDays ?? 0) > 0).length;
  const spi = scheduleSpi(tasks, dayCursor, windowOf);

  const spanEndMs = baseMs + (totalDays - 1) * MS_DAY;
  const closures = (nonWorkingDates ?? [])
    .map((iso) => ({ iso, ms: startOfDayMs(new Date(iso + 'T00:00:00')) }))
    .filter((c) => Number.isFinite(c.ms) && c.ms >= baseMs && c.ms <= spanEndMs)
    .sort((a, b) => a.ms - b.ms);
  const weatherClosures: ScheduleReportModel['weatherClosures'] = closures.slice(0, 6).map((c) => ({
    label: new Date(c.iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    note: 'non-working day',
  }));
  if (closures.length > 6) weatherClosures.push({ label: `+${closures.length - 6} more`, note: 'closures in span' });

  return {
    header: {
      projectName: project.name, location: project.location || '', company: company?.name ?? null,
      client: project.primaryContact?.name ?? null,
      reportDateIso: reportDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
      // NOT a data date. A data date is a scheduling INPUT — the line left of
      // which work is actual and right of which it is forecast — and this engine
      // deliberately has none (types/index.ts documents the decision: progress is
      // read-only to CPM, "the plan stays the plan until you say so"). Printing
      // the report's own generation date under a "Data date" heading advertised
      // a capability the schedule does not have, to the one audience least able
      // to check. Kept on the model as the printed-on date; the HTML labels it
      // as such.
      dataDateIso: reportDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
      startIso: new Date(startDateIso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
      forecastFinishIso: isoAddDays(startDateIso, forecastFinishDay),
      baselineFinishIso: baselineFinishDay != null ? isoAddDays(startDateIso, baselineFinishDay) : null,
      forecastVarianceDays, taskCount: real.length, phaseCount: phaseSet.size, spanDays: totalDays,
    },
    kpis: {
      percentComplete, tasksDone, tasksTotal: real.length, forecastVarianceDays, spi,
      svDays: forecastVarianceDays != null ? -forecastVarianceDays : null,
      criticalCount: criticalPath.length, minTotalFloat, behindCount, overdueCount, unstaffedCount,
    },
    criticalPath, risks: detectRisks(tasks, cpm, dayCursor, baselineEndById, windowOf, slipDays),
    lookahead, milestones, ganttRows, slippages, phaseProgress, weatherClosures,
  };
}
