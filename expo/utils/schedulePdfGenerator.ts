import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type { ProjectSchedule, ScheduleTask, CompanyBranding, ScheduleRiskItem } from '@/types';
import {
  addWorkingDays,
  formatShortDate,
  getTaskDateRange,
  getStatusLabel,
  getPhaseColor,
  getHealthColor,
  getDepLinks,
  getSuccessors,
  generateWbsCodes,
  calculateHealthScore,
} from '@/utils/scheduleEngine';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDateFull(date: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

function formatDateShort(date: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}

function getStatusEmoji(task: ScheduleTask, projectStartDate: Date, workingDaysPerWeek: number): string {
  if (task.status === 'done') return '&#x2705;';
  if (task.progress > 0) return `&#x1F504; ${task.progress}%`;
  const { end } = getTaskDateRange(task, projectStartDate, workingDaysPerWeek);
  if (end < new Date() && task.progress < 100) return '&#x26A0;&#xFE0F;';
  return '&#x23F3;';
}

function getStatusText(task: ScheduleTask, projectStartDate: Date, workingDaysPerWeek: number): string {
  if (task.status === 'done') return '100%';
  if (task.progress > 0) return `${task.progress}%`;
  const { end } = getTaskDateRange(task, projectStartDate, workingDaysPerWeek);
  if (end < new Date() && task.progress < 100) return 'Late';
  return '0%';
}

function getPredecessorWbs(task: ScheduleTask, allTasks: ScheduleTask[]): string {
  const links = getDepLinks(task);
  if (links.length === 0) return '—';
  return links.map(link => {
    const pred = allTasks.find(t => t.id === link.taskId);
    if (!pred) return '?';
    const wbs = pred.wbsCode ?? '?';
    const type = link.type ?? 'FS';
    const lag = link.lagDays ?? 0;
    let label = wbs;
    if (type !== 'FS') label += ` ${type}`;
    if (lag !== 0) label += `${lag > 0 ? '+' : ''}${lag}d`;
    return label;
  }).join(', ');
}

function getSuccessorWbs(task: ScheduleTask, allTasks: ScheduleTask[]): string {
  const succs = getSuccessors(task.id, allTasks);
  if (succs.length === 0) return '—';
  return succs.map(s => s.wbsCode ?? '?').join(', ');
}

export interface SchedulePdfOptions {
  schedule: ProjectSchedule;
  projectStartDate: Date;
  projectName: string;
  branding?: CompanyBranding;
  mode: 'full' | 'gantt' | 'trade';
  selectedPhase?: string;
}

interface GanttBarData {
  task: ScheduleTask;
  startPct: number;
  widthPct: number;
  color: string;
  progressPct: number;
  isMilestone: boolean;
  isCritical: boolean;
}

function buildTaskGanttBars(
  tasks: ScheduleTask[],
  projectStartDate: Date,
  workingDaysPerWeek: number,
  totalMs: number,
  projectStartMs: number,
): GanttBarData[] {
  return tasks.map(task => {
    const { start, end } = getTaskDateRange(task, projectStartDate, workingDaysPerWeek);
    const sMs = start.getTime() - projectStartMs;
    const eMs = end.getTime() - projectStartMs;
    const startPct = Math.max(0, (sMs / totalMs) * 100);
    const widthPct = Math.max(0.3, ((eMs - sMs) / totalMs) * 100);

    let color = getPhaseColor(task.phase);
    if (task.status === 'done') color = '#34C759';
    if (task.isCriticalPath) color = '#DC2626';
    if (task.status === 'on_hold') color = '#FF9500';

    return {
      task,
      startPct,
      widthPct,
      color,
      progressPct: task.progress,
      isMilestone: task.isMilestone ?? false,
      isCritical: task.isCriticalPath ?? false,
    };
  });
}

function buildLandscapeGanttHtml(
  tasks: ScheduleTask[],
  projectStartDate: Date,
  workingDaysPerWeek: number,
  totalDurationDays: number,
): string {
  if (tasks.length === 0) return '';

  const endDate = addWorkingDays(projectStartDate, totalDurationDays, workingDaysPerWeek);
  const totalMs = endDate.getTime() - projectStartDate.getTime();
  if (totalMs <= 0) return '';

  const projectStartMs = projectStartDate.getTime();
  const todayMs = Date.now() - projectStartMs;
  const todayPct = Math.max(0, Math.min(100, (todayMs / totalMs) * 100));

  const totalWeeks = Math.max(1, Math.ceil(totalDurationDays / workingDaysPerWeek));
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const months: { label: string; startPct: number; widthPct: number }[] = [];
  const cursor = new Date(projectStartDate);
  cursor.setDate(1);
  while (cursor <= endDate) {
    const monthStart = new Date(Math.max(cursor.getTime(), projectStartMs));
    const nextMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    const monthEnd = new Date(Math.min(nextMonth.getTime(), endDate.getTime()));
    const startPct = ((monthStart.getTime() - projectStartMs) / totalMs) * 100;
    const widthPct = ((monthEnd.getTime() - monthStart.getTime()) / totalMs) * 100;
    if (widthPct > 0.5) {
      months.push({ label: `${monthNames[cursor.getMonth()]} ${cursor.getFullYear()}`, startPct, widthPct });
    }
    cursor.setMonth(cursor.getMonth() + 1);
    cursor.setDate(1);
  }

  const phases = new Map<string, ScheduleTask[]>();
  for (const t of tasks) {
    if (!phases.has(t.phase)) phases.set(t.phase, []);
    phases.get(t.phase)!.push(t);
  }

  const ganttBars = buildTaskGanttBars(tasks, projectStartDate, workingDaysPerWeek, totalMs, projectStartMs);
  const barMap = new Map<string, GanttBarData>();
  for (const b of ganttBars) barMap.set(b.task.id, b);

  let rows = '';
  for (const [phase, phaseTasks] of phases) {
    const phaseColor = getPhaseColor(phase);
    let phaseStartPct = 100;
    let phaseEndPct = 0;
    for (const t of phaseTasks) {
      const bar = barMap.get(t.id);
      if (bar) {
        phaseStartPct = Math.min(phaseStartPct, bar.startPct);
        phaseEndPct = Math.max(phaseEndPct, bar.startPct + bar.widthPct);
      }
    }
    const phaseWidthPct = phaseEndPct - phaseStartPct;
    const avgProgress = phaseTasks.length > 0
      ? Math.round(phaseTasks.reduce((s, t) => s + t.progress, 0) / phaseTasks.length) : 0;

    rows += `<div class="g-row g-phase-row">
      <div class="g-label" style="font-weight:700;color:${phaseColor};">${escapeHtml(phase)}</div>
      <div class="g-track">
        <div class="g-bar" style="left:${phaseStartPct.toFixed(1)}%;width:${Math.max(phaseWidthPct, 0.3).toFixed(1)}%;background:${phaseColor};opacity:0.25;border-radius:3px;"></div>
      </div>
    </div>`;

    for (const task of phaseTasks) {
      const bar = barMap.get(task.id);
      if (!bar) continue;

      if (bar.isMilestone) {
        rows += `<div class="g-row">
          <div class="g-label g-label-task">${escapeHtml(task.title)}</div>
          <div class="g-track">
            <div class="g-milestone" style="left:${bar.startPct.toFixed(1)}%;">&#x25C6;</div>
          </div>
        </div>`;
      } else {
        const progressFill = bar.progressPct > 0
          ? `<div class="g-fill" style="width:${bar.progressPct}%;background:rgba(255,255,255,0.4);"></div>`
          : '';
        rows += `<div class="g-row">
          <div class="g-label g-label-task${bar.isCritical ? ' g-critical-label' : ''}">${escapeHtml(task.title)}</div>
          <div class="g-track">
            <div class="g-bar" style="left:${bar.startPct.toFixed(1)}%;width:${Math.max(bar.widthPct, 0.3).toFixed(1)}%;background:${bar.color};border-radius:3px;">
              ${progressFill}
            </div>
          </div>
        </div>`;
      }
    }
  }

  const monthHeaders = months.map(m =>
    `<div class="g-month-header" style="left:${m.startPct.toFixed(1)}%;width:${m.widthPct.toFixed(1)}%;">${m.label}</div>`
  ).join('');

  return `
    <div class="gantt-section">
      <div class="gantt-title">GANTT CHART</div>
      <div class="gantt-wrapper">
        <div class="g-timeline">
          ${monthHeaders}
        </div>
        <div class="g-body">
          <div class="g-today-line" style="left:${todayPct.toFixed(1)}%;"></div>
          ${rows}
        </div>
      </div>
      <div class="g-legend">
        <div class="g-legend-item"><div class="g-legend-bar" style="background:#34C759;"></div> Completed</div>
        <div class="g-legend-item"><div class="g-legend-bar" style="background:#007AFF;"></div> In Progress</div>
        <div class="g-legend-item"><div class="g-legend-bar" style="background:#9CA3AF;"></div> Not Started</div>
        <div class="g-legend-item"><div class="g-legend-bar" style="background:#DC2626;"></div> Critical Path</div>
        <div class="g-legend-item"><div class="g-legend-bar" style="background:#FF9500;"></div> On Hold</div>
        <div class="g-legend-item"><span style="color:#007AFF;font-size:11px;">&#x25C6;</span> Milestone</div>
        <div class="g-legend-item"><div style="width:2px;height:10px;background:#DC2626;display:inline-block;"></div> Today</div>
      </div>
    </div>
  `;
}

function buildSchedulePdfHtml(options: SchedulePdfOptions): string {
  const { schedule, projectStartDate, projectName, branding, mode, selectedPhase } = options;
  const now = new Date();
  const nowStr = formatDateFull(now);

  let tasksToShow = generateWbsCodes(
    schedule.tasks.slice().sort((a, b) => a.startDay - b.startDay || a.title.localeCompare(b.title))
  );
  if (mode === 'trade' && selectedPhase) {
    tasksToShow = tasksToShow.filter(t => t.phase === selectedPhase);
  }

  const endDate = addWorkingDays(projectStartDate, schedule.totalDurationDays, schedule.workingDaysPerWeek);
  const healthScore = schedule.healthScore ?? calculateHealthScore(schedule.tasks, schedule.updatedAt);
  const healthColor = getHealthColor(healthScore);

  const completedCount = tasksToShow.filter(t => t.status === 'done').length;
  const inProgressCount = tasksToShow.filter(t => t.status === 'in_progress').length;
  const notStartedCount = tasksToShow.filter(t => t.status === 'not_started').length;
  const overdueCount = tasksToShow.filter(t => {
    if (t.status === 'done') return false;
    const { end } = getTaskDateRange(t, projectStartDate, schedule.workingDaysPerWeek);
    return end < now && t.progress < 100;
  }).length;
  const milestoneCount = tasksToShow.filter(t => t.isMilestone).length;
  const milestonesPassed = tasksToShow.filter(t => t.isMilestone && t.status === 'done').length;
  const totalProgress = tasksToShow.length > 0
    ? Math.round(tasksToShow.reduce((s, t) => s + t.progress, 0) / tasksToShow.length) : 0;
  const onTrackCount = Math.max(0, tasksToShow.length - overdueCount - completedCount);

  const logoBlock = branding?.logoUri
    ? `<img src="${escapeHtml(branding.logoUri)}" class="logo-img" />`
    : '';

  const companyBlock = branding?.companyName
    ? `<div class="company-header">
        ${logoBlock}
        <div class="company-info">
          <div class="company-name">${escapeHtml(branding.companyName)}</div>
          ${branding.address ? `<div class="company-detail">${escapeHtml(branding.address)}</div>` : ''}
          ${branding.phone ? `<div class="company-detail">${escapeHtml(branding.phone)}</div>` : ''}
          ${branding.licenseNumber ? `<div class="company-detail">License: ${escapeHtml(branding.licenseNumber)}</div>` : ''}
        </div>
      </div>`
    : '';

  const phases = new Map<string, ScheduleTask[]>();
  for (const t of tasksToShow) {
    if (!phases.has(t.phase)) phases.set(t.phase, []);
    phases.get(t.phase)!.push(t);
  }

  const fontSize = tasksToShow.length > 50 ? '7px' : tasksToShow.length > 30 ? '8px' : '9px';

  let taskTableRows = '';
  for (const [phase, pTasks] of phases) {
    const phaseColor = getPhaseColor(phase);
    taskTableRows += `<tr class="phase-row"><td colspan="7" style="border-left:4px solid ${phaseColor};font-weight:700;background:#f3f4f6;padding:5px 8px;font-size:${fontSize};">&#x25BC; ${escapeHtml(phase.toUpperCase())}</td></tr>`;
    for (const task of pTasks) {
      const dr = getTaskDateRange(task, projectStartDate, schedule.workingDaysPerWeek);
      const statusTxt = getStatusText(task, projectStartDate, schedule.workingDaysPerWeek);
      const predWbs = getPredecessorWbs(task, tasksToShow);
      const isCritical = task.isCriticalPath;
      const isOverdue = task.status !== 'done' && dr.end < now && task.progress < 100;
      const namePrefix = task.isMilestone ? '&#x25C6; ' : '';
      const rowBg = isOverdue ? 'background:#fef3c7;' : '';
      const nameStyle = isCritical ? 'color:#DC2626;font-weight:700;' : '';
      const statusColor = task.status === 'done' ? '#16a34a' : isOverdue ? '#DC2626' : task.progress > 0 ? '#007AFF' : '#9CA3AF';

      taskTableRows += `<tr style="${rowBg}">
        <td class="td-wbs">${task.wbsCode ?? ''}</td>
        <td class="td-task" style="${nameStyle}">${namePrefix}${escapeHtml(task.title)}</td>
        <td class="td-dur">${task.durationDays}d</td>
        <td class="td-date">${formatDateShort(dr.start)}</td>
        <td class="td-date">${formatDateShort(dr.end)}</td>
        <td class="td-pred">${escapeHtml(predWbs)}</td>
        <td class="td-status" style="color:${statusColor};font-weight:600;">${statusTxt}</td>
      </tr>`;
    }
  }

  const ganttHtml = (mode === 'full' || mode === 'gantt')
    ? buildLandscapeGanttHtml(tasksToShow, projectStartDate, schedule.workingDaysPerWeek, schedule.totalDurationDays)
    : '';

  let riskHtml = '';
  if (mode === 'full' && (schedule.riskItems || []).length > 0) {
    riskHtml = `<div class="risk-section">
      <div class="section-title">RISK ITEMS</div>
      ${(schedule.riskItems || []).map((risk: ScheduleRiskItem) => {
        const sevColor = risk.severity === 'high' ? '#DC2626' : risk.severity === 'medium' ? '#F59E0B' : '#6B7280';
        return `<div class="risk-card" style="border-left:3px solid ${sevColor};">
          <span class="risk-sev" style="color:${sevColor};">${risk.severity.toUpperCase()}</span>
          <span class="risk-text">${escapeHtml(risk.title)} — ${escapeHtml(risk.detail)}</span>
        </div>`;
      }).join('')}
    </div>`;
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  @page { size: landscape; margin: 0.4in; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1a1a2e; font-size: 9px; line-height: 1.35; }

  .company-header { display:flex; align-items:center; gap:14px; margin-bottom:14px; }
  .logo-img { max-height:45px; max-width:160px; object-fit:contain; }
  .company-info { }
  .company-name { font-size:18px; font-weight:800; color:#1a1a2e; }
  .company-detail { font-size:9px; color:#6b7280; }

  .page-title { font-size:20px; font-weight:800; color:#1a1a2e; margin:4px 0 2px; letter-spacing:1px; }
  .page-subtitle { font-size:11px; color:#6b7280; margin-bottom:10px; }

  .summary-row { display:flex; gap:8px; margin:10px 0 16px; }
  .s-card { flex:1; background:#f9fafb; border:1px solid #e5e7eb; border-radius:6px; padding:8px 6px; text-align:center; }
  .s-card-val { font-size:15px; font-weight:800; color:#1a1a2e; }
  .s-card-lbl { font-size:7px; color:#6b7280; text-transform:uppercase; letter-spacing:0.4px; margin-top:2px; }

  .section-title { font-size:11px; font-weight:700; color:#1a1a2e; margin:14px 0 6px; padding-bottom:3px; border-bottom:2px solid #1a1a2e; text-transform:uppercase; letter-spacing:0.5px; }

  table.schedule { width:100%; border-collapse:collapse; font-size:${fontSize}; margin-bottom:10px; }
  table.schedule th { background:#1a1a2e; color:#fff; padding:4px 4px; text-align:center; font-weight:600; font-size:7px; text-transform:uppercase; letter-spacing:0.3px; border:1px solid #374151; }
  table.schedule th:nth-child(2) { text-align:left; }
  table.schedule td { padding:3px 4px; border-bottom:1px solid #e5e7eb; vertical-align:middle; }
  .td-wbs { width:32px; text-align:center; color:#9CA3AF; font-size:${fontSize}; }
  .td-task { text-align:left; max-width:180px; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
  .td-dur { width:28px; text-align:center; }
  .td-date { width:44px; text-align:center; font-size:${fontSize}; }
  .td-pred { width:50px; text-align:center; font-size:7px; color:#6b7280; }
  .td-status { width:34px; text-align:center; font-size:8px; }
  .phase-row td { background:#f3f4f6; }

  .gantt-section { margin:14px 0; page-break-inside:avoid; }
  .gantt-title { font-size:11px; font-weight:700; color:#1a1a2e; margin-bottom:6px; padding-bottom:3px; border-bottom:2px solid #1a1a2e; text-transform:uppercase; letter-spacing:0.5px; }
  .gantt-wrapper { border:1px solid #e5e7eb; border-radius:6px; overflow:hidden; background:#fafafa; }
  .g-timeline { position:relative; height:22px; background:#1a1a2e; display:flex; }
  .g-month-header { position:absolute; top:0; height:22px; line-height:22px; font-size:8px; font-weight:600; color:#fff; text-align:center; border-right:1px solid #374151; padding:0 4px; overflow:hidden; white-space:nowrap; }
  .g-body { position:relative; padding:4px 0; min-height:30px; }
  .g-row { display:flex; align-items:center; height:16px; margin-bottom:1px; }
  .g-phase-row { height:14px; margin-top:4px; }
  .g-label { width:110px; min-width:110px; font-size:7px; font-weight:600; color:#374151; text-align:right; padding-right:6px; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
  .g-label-task { font-weight:400; color:#6b7280; }
  .g-critical-label { color:#DC2626; font-weight:600; }
  .g-track { flex:1; position:relative; height:12px; }
  .g-bar { position:absolute; top:1px; height:10px; min-width:2px; }
  .g-fill { position:absolute; top:0; left:0; height:100%; border-radius:3px; }
  .g-milestone { position:absolute; top:-1px; font-size:10px; color:#007AFF; transform:translateX(-50%); line-height:12px; }
  .g-today-line { position:absolute; top:0; bottom:0; width:2px; background:#DC2626; z-index:10; opacity:0.8; }

  .g-legend { display:flex; gap:12px; padding:6px 10px; background:#f3f4f6; border-top:1px solid #e5e7eb; font-size:7px; color:#6b7280; flex-wrap:wrap; }
  .g-legend-item { display:flex; align-items:center; gap:3px; }
  .g-legend-bar { width:14px; height:6px; border-radius:2px; }

  .risk-section { margin:10px 0; }
  .risk-card { display:flex; gap:6px; align-items:baseline; background:#f9fafb; border-radius:4px; padding:5px 8px; margin-bottom:4px; font-size:8px; }
  .risk-sev { font-weight:700; font-size:7px; min-width:40px; }
  .risk-text { color:#374151; }

  .stats-grid { display:flex; flex-wrap:wrap; gap:6px; margin:8px 0; }
  .stat-box { flex:1; min-width:80px; background:#f9fafb; border:1px solid #e5e7eb; border-radius:4px; padding:6px; text-align:center; }
  .stat-val { font-size:14px; font-weight:800; }
  .stat-lbl { font-size:7px; color:#6b7280; text-transform:uppercase; }

  .footer { margin-top:16px; padding-top:8px; border-top:1px solid #e5e7eb; display:flex; justify-content:space-between; font-size:8px; color:#9CA3AF; }
  .page-break { page-break-before:always; }
</style>
</head>
<body>
  ${companyBlock}

  <div class="page-title">${escapeHtml(projectName)}</div>
  <div class="page-subtitle">Construction Schedule${mode === 'trade' && selectedPhase ? ` — ${escapeHtml(selectedPhase)}` : ''}</div>

  <div class="summary-row">
    <div class="s-card">
      <div class="s-card-val">${schedule.totalDurationDays}</div>
      <div class="s-card-lbl">Working Days</div>
    </div>
    <div class="s-card">
      <div class="s-card-val">${formatDateShort(projectStartDate)}</div>
      <div class="s-card-lbl">Start</div>
    </div>
    <div class="s-card">
      <div class="s-card-val">${formatDateShort(endDate)}</div>
      <div class="s-card-lbl">End</div>
    </div>
    <div class="s-card">
      <div class="s-card-val" style="color:${healthColor};">${healthScore}</div>
      <div class="s-card-lbl">Health Score</div>
    </div>
    <div class="s-card">
      <div class="s-card-val">${totalProgress}%</div>
      <div class="s-card-lbl">Progress</div>
    </div>
    <div class="s-card">
      <div class="s-card-val">${tasksToShow.length}</div>
      <div class="s-card-lbl">Tasks</div>
    </div>
  </div>

  ${mode !== 'gantt' ? `
  <div class="section-title">Task Schedule</div>
  <table class="schedule">
    <thead>
      <tr>
        <th>WBS</th>
        <th style="text-align:left;">Task Name</th>
        <th>Dur</th>
        <th>Start</th>
        <th>End</th>
        <th>Pred</th>
        <th>%</th>
      </tr>
    </thead>
    <tbody>
      ${taskTableRows}
    </tbody>
  </table>
  ` : ''}

  ${ganttHtml}

  ${mode === 'full' ? `
  <div class="section-title">Summary</div>
  <div class="stats-grid">
    <div class="stat-box"><div class="stat-val" style="color:#34C759;">${completedCount}</div><div class="stat-lbl">Completed</div></div>
    <div class="stat-box"><div class="stat-val" style="color:#007AFF;">${inProgressCount}</div><div class="stat-lbl">In Progress</div></div>
    <div class="stat-box"><div class="stat-val" style="color:#9CA3AF;">${notStartedCount}</div><div class="stat-lbl">Not Started</div></div>
    <div class="stat-box"><div class="stat-val" style="color:#DC2626;">${overdueCount}</div><div class="stat-lbl">Overdue</div></div>
    <div class="stat-box"><div class="stat-val">${schedule.criticalPathDays}d</div><div class="stat-lbl">Critical Path</div></div>
    <div class="stat-box"><div class="stat-val">${milestoneCount}</div><div class="stat-lbl">Milestones (${milestonesPassed} done)</div></div>
    <div class="stat-box"><div class="stat-val">${schedule.laborAlignmentScore}%</div><div class="stat-lbl">Labor Score</div></div>
  </div>
  ` : ''}

  ${riskHtml}

  <div class="footer">
    <span>Generated by MAGE ID &bull; mageid.com</span>
    <span>${branding?.companyName ? escapeHtml(branding.companyName) + ' &bull; ' : ''}${nowStr}</span>
  </div>
</body>
</html>`;
}

export async function generateSchedulePdf(options: SchedulePdfOptions): Promise<void> {
  console.log('[SchedulePDF] Generating landscape PDF, mode:', options.mode, 'tasks:', options.schedule.tasks.length);
  const html = buildSchedulePdfHtml(options);

  if (Platform.OS === 'web') {
    const newWindow = window.open('', '_blank');
    if (newWindow) {
      newWindow.document.write(html);
      newWindow.document.close();
      newWindow.print();
    }
    return;
  }

  try {
    const { uri } = await Print.printToFileAsync({
      html,
      base64: false,
      width: 792,
      height: 612,
    });
    console.log('[SchedulePDF] Landscape PDF created at:', uri);
    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: `${options.projectName} Schedule`,
        UTI: 'com.adobe.pdf',
      });
    } else {
      await Print.printAsync({ uri });
    }
  } catch (error) {
    console.error('[SchedulePDF] Error generating PDF:', error);
    throw error;
  }
}

export async function generateScheduleSectionPdf(
  schedule: ProjectSchedule,
  projectName: string,
  branding?: CompanyBranding,
): Promise<void> {
  const projectStartDate = (schedule as any).projectStartDate
    ? new Date((schedule as any).projectStartDate)
    : new Date();
  await generateSchedulePdf({
    schedule,
    projectStartDate,
    projectName,
    branding,
    mode: 'full',
  });
}

export async function generateSchedulePdfUri(options: SchedulePdfOptions): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    const html = buildSchedulePdfHtml(options);
    const { uri } = await Print.printToFileAsync({
      html,
      base64: false,
      width: 792,
      height: 612,
    });
    return uri;
  } catch (error) {
    console.error('[SchedulePDF] Error generating PDF URI:', error);
    return null;
  }
}
