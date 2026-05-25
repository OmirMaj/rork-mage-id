import type { Project, ScheduleTask, ScheduleBaseline } from '@/types';
import type { CpmResult } from '@/utils/cpm';

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
function finishDay(t: ScheduleTask): number { return (t.startDay ?? 1) + Math.max(1, t.durationDays || 1) - 1; }

export function scheduleSpi(tasks: ScheduleTask[], dayCursor: number): number {
  let earned = 0, planned = 0;
  for (const t of tasks) {
    if (t.isSummary || t.isMilestone) continue;
    const dur = Math.max(1, t.durationDays || 1);
    earned += dur * Math.max(0, Math.min(100, t.progress ?? 0)) / 100;
    const start = t.startDay ?? 1;
    const end = start + dur - 1;
    const frac = dayCursor >= end ? 1 : dayCursor < start ? 0 : (dayCursor - start + 1) / dur;
    planned += dur * frac;
  }
  return planned > 0 ? earned / planned : 1;
}

export function detectRisks(
  tasks: ScheduleTask[], cpm: CpmResult, dayCursor: number,
  baselineEndById: Map<string, number>,
): ScheduleReportModel['risks'] {
  const out: ScheduleReportModel['risks'] = [];
  for (const t of tasks) {
    if (t.isSummary) continue;
    const done = t.status === 'done' || (t.progress ?? 0) >= 100;
    const ct = cpm.perTask.get(t.id);
    const tf = ct?.totalFloat ?? 0;
    if (!done && finishDay(t) < dayCursor) out.push({ kind: 'overdue', severity: 'hi', text: `${t.title} — overdue, ${t.progress ?? 0}%` });
    else if (!done && tf <= 0 && !t.isMilestone) out.push({ kind: 'zero_float', severity: 'hi', text: `${t.title} — 0 float (drives finish)` });
    else if (!done && tf > 0 && tf <= 2 && !t.isMilestone) out.push({ kind: 'low_float', severity: 'md', text: `${t.title} — only ${tf}d float` });
    if (!done && !t.isMilestone && !(t.crew || '').trim() && !t.assignedSubName) out.push({ kind: 'unstaffed', severity: 'lo', text: `${t.title} — no crew assigned` });
    const blEnd = baselineEndById.get(t.id);
    if (blEnd != null && finishDay(t) - blEnd >= 2) out.push({ kind: 'behind', severity: 'md', text: `${t.title} — +${finishDay(t) - blEnd}d vs baseline` });
    if (!done && t.isMilestone && /inspect/i.test(t.title) && (t.startDay ?? 1) >= dayCursor && (t.startDay ?? 1) <= dayCursor + 21) out.push({ kind: 'inspection', severity: 'md', text: `${t.title} — upcoming inspection, book ahead` });
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

  const baselineEndById = new Map<string, number>();
  if (baseline?.tasks?.length) for (const b of baseline.tasks) baselineEndById.set(b.id, b.endDay);
  else for (const t of tasks) if (t.baselineEndDay != null) baselineEndById.set(t.id, t.baselineEndDay);

  const baselineFinishDay = baselineEndById.size ? Math.max(...baselineEndById.values()) : null;
  const forecastFinishDay = cpm.projectFinish;
  const totalDays = Math.max(1, forecastFinishDay, baselineFinishDay ?? 1);
  const forecastVarianceDays = baselineFinishDay != null ? forecastFinishDay - baselineFinishDay : null;

  const real = tasks.filter((t) => !t.isSummary);
  const totalDur = real.reduce((s, t) => s + Math.max(1, t.durationDays || 1), 0);
  const percentComplete = totalDur > 0 ? Math.round(real.reduce((s, t) => s + (t.progress ?? 0) * Math.max(1, t.durationDays || 1), 0) / totalDur) : 0;
  const tasksDone = real.filter((t) => t.status === 'done' || (t.progress ?? 0) >= 100).length;

  const ganttRows: ReportGanttRow[] = tasks.map((t, i) => {
    const ct = cpm.perTask.get(t.id);
    const es = ct?.es ?? t.startDay ?? 1;
    const ef = ct?.ef ?? finishDay(t);
    const dur = Math.max(1, t.durationDays || 1);
    const blEnd = baselineEndById.get(t.id) ?? null;
    const blStart = baseline?.tasks?.find((b) => b.id === t.id)?.startDay ?? t.baselineStartDay ?? null;
    return {
      index: i + 1, title: t.title || 'Untitled', phase: t.phase || 'General', crew: t.crew || (t.assignedSubName ?? ''),
      startIso: isoShort(startDateIso, es), finishIso: isoShort(startDateIso, ef),
      baselineFinishIso: blEnd != null ? isoShort(startDateIso, blEnd) : null,
      deltaDays: blEnd != null ? ef - blEnd : null,
      totalFloat: ct?.totalFloat ?? 0, freeFloat: ct?.freeFloat ?? 0,
      percent: Math.max(0, Math.min(100, t.progress ?? 0)),
      predecessors: (t.dependencies ?? []).map((id) => tasks.findIndex((x) => x.id === id) + 1).filter((n) => n > 0).join(', '),
      isCritical: !!ct?.isCritical && t.status !== 'done', isSummary: !!t.isSummary, isMilestone: !!t.isMilestone || dur === 0,
      bar: { leftPct: ((es - 1) / totalDays) * 100, widthPct: Math.max(0.4, (dur / totalDays) * 100) },
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
    .map((t) => ({ id: t.id, title: t.title || 'Untitled', startIso: isoShort(startDateIso, t.startDay ?? 1), finishIso: isoShort(startDateIso, finishDay(t)), isMilestone: !!t.isMilestone }));

  const lookahead = [0, 1, 2].map((w) => {
    const lo = dayCursor + w * 7, hi = lo + 6;
    const items = real
      .filter((t) => { const s = t.startDay ?? 1; const e = finishDay(t); return s <= hi && e >= lo; })
      .slice(0, 6)
      .map((t) => ({ title: t.title || 'Untitled', crew: t.crew || (t.assignedSubName ?? ''), startIso: isoShort(startDateIso, t.startDay ?? 1), finishIso: isoShort(startDateIso, finishDay(t)), isMilestone: !!t.isMilestone }));
    return { weekLabel: w === 0 ? 'This week' : w === 1 ? 'Next week' : '+2 weeks', items };
  });

  const milestones = tasks
    .filter((t) => (t.isMilestone || (t.durationDays || 0) === 0) && finishDay(t) >= dayCursor)
    .slice(0, 8)
    .map((t) => { const blEnd = baselineEndById.get(t.id) ?? null; const v = blEnd != null ? finishDay(t) - blEnd : null; return { title: t.title || 'Milestone', dateIso: isoShort(startDateIso, finishDay(t)), varianceDays: v, onTime: v == null || v <= 0 }; });

  const slippages = ganttRows.filter((r) => (r.deltaDays ?? 0) > 0).sort((a, b) => (b.deltaDays ?? 0) - (a.deltaDays ?? 0)).slice(0, 8).map((r) => ({ title: r.title, deltaDays: r.deltaDays ?? 0 }));

  const minTotalFloat = real.length ? Math.min(...real.map((t) => cpm.perTask.get(t.id)?.totalFloat ?? 0)) : 0;
  const overdueCount = real.filter((t) => (t.status !== 'done' && (t.progress ?? 0) < 100) && finishDay(t) < dayCursor).length;
  const unstaffedCount = real.filter((t) => !t.isMilestone && !(t.crew || '').trim() && !t.assignedSubName && (t.status !== 'done')).length;
  const behindCount = ganttRows.filter((r) => (r.deltaDays ?? 0) > 0).length;
  const spi = scheduleSpi(tasks, dayCursor);

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
    criticalPath, risks: detectRisks(tasks, cpm, dayCursor, baselineEndById),
    lookahead, milestones, ganttRows, slippages, phaseProgress, weatherClosures,
  };
}
