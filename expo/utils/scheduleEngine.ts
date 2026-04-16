import type { ScheduleTask, DependencyLink, ProjectSchedule, ScheduleRiskItem, ScheduleBaseline } from '@/types';

export const PHASE_OPTIONS = [
  'Site Work', 'Demo', 'Foundation', 'Framing', 'Roofing',
  'MEP', 'Plumbing', 'Electrical', 'HVAC', 'Insulation',
  'Drywall', 'Interior', 'Finishes', 'Landscaping', 'Inspections', 'General',
];

export const PHASE_COLORS: Record<string, string> = {
  'Site Work': '#8B6914',
  'Demo': '#C75050',
  'Foundation': '#6B7280',
  'Framing': '#B45309',
  'Roofing': '#7C3AED',
  'MEP': '#0891B2',
  'Plumbing': '#2563EB',
  'Electrical': '#DC2626',
  'HVAC': '#059669',
  'Insulation': '#D97706',
  'Drywall': '#9CA3AF',
  'Interior': '#EC4899',
  'Finishes': '#10B981',
  'Landscaping': '#22C55E',
  'Inspections': '#F59E0B',
  'General': '#6366F1',
};

export function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getDepLinks(task: ScheduleTask): DependencyLink[] {
  if (task.dependencyLinks && task.dependencyLinks.length > 0) return task.dependencyLinks;
  return task.dependencies.map(id => ({ taskId: id, type: 'FS' as const, lagDays: 0 }));
}

export function recalculateStartDays(tasks: ScheduleTask[]): ScheduleTask[] {
  const taskMap = new Map<string, ScheduleTask>();
  for (const t of tasks) taskMap.set(t.id, { ...t });

  const resolved = new Set<string>();

  const resolve = (id: string): number => {
    const task = taskMap.get(id);
    if (!task) return 0;
    if (resolved.has(id)) return task.startDay + task.durationDays;

    resolved.add(id);

    const links = getDepLinks(task);
    if (links.length === 0) {
      if (task.startDay < 1) task.startDay = 1;
      return task.startDay + task.durationDays;
    }

    let latestEnd = 0;
    for (const link of links) {
      if (taskMap.has(link.taskId)) {
        const dep = taskMap.get(link.taskId)!;
        const depEnd = resolve(link.taskId);
        const depStart = dep.startDay;
        const lag = link.lagDays || 0;
        const type = link.type || 'FS';

        let effectiveStart = 0;
        switch (type) {
          case 'FS':
            effectiveStart = depEnd + lag;
            break;
          case 'SS':
            effectiveStart = depStart + lag;
            break;
          case 'FF':
            effectiveStart = (depEnd + lag) - task.durationDays;
            break;
          case 'SF':
            effectiveStart = depStart + lag - task.durationDays;
            break;
          default:
            effectiveStart = depEnd + lag;
        }
        latestEnd = Math.max(latestEnd, effectiveStart);
      }
    }

    task.startDay = latestEnd > 0 ? latestEnd : task.startDay;
    return task.startDay + task.durationDays;
  };

  for (const t of tasks) resolve(t.id);

  const result: ScheduleTask[] = [];
  for (const t of tasks) result.push(taskMap.get(t.id)!);
  return result;
}

export function getSuccessors(taskId: string, tasks: ScheduleTask[]): ScheduleTask[] {
  return tasks.filter(t => {
    const links = getDepLinks(t);
    return links.some(l => l.taskId === taskId);
  });
}

export function getPredecessors(task: ScheduleTask, tasks: ScheduleTask[]): ScheduleTask[] {
  const links = getDepLinks(task);
  return links
    .map(l => tasks.find(t => t.id === l.taskId))
    .filter((t): t is ScheduleTask => t !== undefined);
}

export function getLagForDep(task: ScheduleTask, depId: string): number {
  const links = getDepLinks(task);
  const link = links.find(l => l.taskId === depId);
  return link?.lagDays ?? 0;
}

export function getDepTypeForDep(task: ScheduleTask, depId: string): string {
  const links = getDepLinks(task);
  const link = links.find(l => l.taskId === depId);
  return link?.type ?? 'FS';
}

export function calculateHealthScore(tasks: ScheduleTask[], updatedAt: string): number {
  if (tasks.length === 0) return 100;

  const now = new Date();
  const totalTasks = tasks.length;

  const onTimeTasks = tasks.filter(t => {
    if (t.status === 'done') return true;
    if (t.status === 'not_started' && t.progress === 0) return true;
    return t.progress > 0;
  }).length;
  const onTimeScore = (onTimeTasks / totalTasks) * 40;

  const milestones = tasks.filter(t => t.isMilestone);
  const hitMilestones = milestones.filter(t => t.status === 'done');
  const milestoneScore = milestones.length > 0
    ? (hitMilestones.length / milestones.length) * 20
    : 20;

  const criticalTasks = tasks.filter(t => t.isCriticalPath);
  const criticalOnTrack = criticalTasks.filter(t => t.status === 'done' || t.progress > 0);
  const criticalScore = criticalTasks.length > 0
    ? (criticalOnTrack.length / criticalTasks.length) * 25
    : 25;

  const lastUpdate = new Date(updatedAt);
  const daysSinceUpdate = Math.floor((now.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24));
  const recencyScore = daysSinceUpdate <= 3 ? 15 : daysSinceUpdate <= 7 ? 10 : 5;

  return Math.min(100, Math.max(0, Math.round(onTimeScore + milestoneScore + criticalScore + recencyScore)));
}

export function getHealthColor(score: number): string {
  if (score >= 80) return '#34C759';
  if (score >= 60) return '#FF9500';
  return '#FF3B30';
}

export function addWorkingDays(start: Date, days: number, workingDaysPerWeek: number): Date {
  const result = new Date(start);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const dow = result.getDay();
    if (workingDaysPerWeek >= 7 || (dow !== 0 && dow !== 6)) {
      added++;
    }
  }
  return result;
}

export function formatShortDate(date: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}

export function getTaskDateRange(
  task: ScheduleTask,
  projectStartDate: Date,
  workingDaysPerWeek: number
): { start: Date; end: Date } {
  const start = addWorkingDays(projectStartDate, task.startDay - 1, workingDaysPerWeek);
  const end = addWorkingDays(start, task.durationDays - 1, workingDaysPerWeek);
  return { start, end };
}

export function getStatusLabel(status: ScheduleTask['status']): string {
  switch (status) {
    case 'done': return 'Complete';
    case 'in_progress': return 'In Progress';
    case 'on_hold': return 'On Hold';
    default: return 'Not Started';
  }
}

export function getStatusColor(status: ScheduleTask['status']): string {
  switch (status) {
    case 'done': return '#34C759';
    case 'in_progress': return '#007AFF';
    case 'on_hold': return '#FF9500';
    default: return '#8E8E93';
  }
}

export function getTaskBorderColor(task: ScheduleTask, projectStartDate: Date, workingDaysPerWeek: number): string {
  if (task.isMilestone) return '#007AFF';
  if (task.status === 'done') return '#34C759';
  if (task.status === 'not_started' && task.progress === 0) return '#C7C7CC';

  const { end } = getTaskDateRange(task, projectStartDate, workingDaysPerWeek);
  const now = new Date();
  const daysUntilEnd = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (daysUntilEnd < 0) return '#FF3B30';
  if (daysUntilEnd <= 3) return '#FF9500';
  return '#34C759';
}

export function suggestDuration(taskName: string): number {
  const name = taskName.toLowerCase();
  if (name.includes('pour') || name.includes('concrete slab')) return 2;
  if (name.includes('framing') || name.includes('frame')) return 10;
  if (name.includes('paint')) return 3;
  if (name.includes('demo') || name.includes('demolition')) return 2;
  if (name.includes('inspection')) return 1;
  if (name.includes('roof')) return 5;
  if (name.includes('plumb')) return 5;
  if (name.includes('electric')) return 5;
  if (name.includes('hvac')) return 4;
  if (name.includes('drywall')) return 4;
  if (name.includes('floor')) return 3;
  if (name.includes('insulation')) return 2;
  if (name.includes('tile')) return 4;
  if (name.includes('cabinet')) return 2;
  if (name.includes('landscape')) return 3;
  if (name.includes('foundation')) return 5;
  if (name.includes('excavat')) return 3;
  if (name.includes('grading')) return 2;
  if (name.includes('permit')) return 5;
  return 5;
}

export function buildScheduleFromTasks(
  name: string,
  projectId: string | null,
  tasks: ScheduleTask[],
  existingBaseline?: ScheduleBaseline | null
): ProjectSchedule {
  const recalculated = recalculateStartDays(tasks);
  const sortedTasks = recalculated
    .slice()
    .sort((a, b) => a.startDay - b.startDay || a.title.localeCompare(b.title));

  const totalDurationDays = sortedTasks.reduce((max, task) => {
    return Math.max(max, task.startDay + task.durationDays);
  }, 0);

  const criticalTasks = sortedTasks.filter(t => t.isCriticalPath || getDepLinks(t).length > 0 || t.durationDays >= 4);
  const criticalPathDays = criticalTasks.reduce((sum, task) => sum + task.durationDays, 0);

  const averageProgress = sortedTasks.length > 0
    ? sortedTasks.reduce((sum, task) => sum + task.progress, 0) / sortedTasks.length
    : 0;

  const laborAlignmentScore = Math.max(56, Math.min(98, Math.round(82 - sortedTasks.length * 1.5 + averageProgress * 0.18)));

  const updatedAt = new Date().toISOString();
  const healthScore = calculateHealthScore(sortedTasks, updatedAt);

  const overdueTasks = sortedTasks.filter(t => {
    if (t.status === 'done') return false;
    const end = t.startDay + t.durationDays;
    const now = new Date();
    const projectStart = new Date();
    const endDate = addWorkingDays(projectStart, end, 5);
    return endDate < now && t.progress < 100;
  });

  const riskItems: ScheduleRiskItem[] = [];

  overdueTasks.slice(0, 2).forEach((task) => {
    riskItems.push({
      id: `${task.id}-risk-overdue`,
      title: `${task.title} is behind schedule`,
      detail: `This task is overdue with ${task.progress}% complete. It may impact downstream tasks.`,
      severity: 'high',
    });
  });

  const criticalBehind = sortedTasks.filter(t => t.isCriticalPath && t.status !== 'done' && t.progress < 50);
  criticalBehind.slice(0, 2).forEach((task) => {
    if (!riskItems.some(r => r.id.startsWith(task.id))) {
      riskItems.push({
        id: `${task.id}-risk-critical`,
        title: `Critical path at risk: ${task.title}`,
        detail: `Only ${task.progress}% complete. Delays here will push the project end date.`,
        severity: 'high',
      });
    }
  });

  if (riskItems.length === 0 && sortedTasks.length > 0) {
    const notStarted = sortedTasks.filter(t => t.status === 'not_started' && t.startDay <= 6);
    notStarted.slice(0, 2).forEach((task, i) => {
      riskItems.push({
        id: `${task.id}-risk-${i}`,
        title: `Early phase watch: ${task.title}`,
        detail: `Scheduled to start soon but not yet begun. Monitor closely.`,
        severity: 'medium',
      });
    });
  }

  return {
    id: createId('schedule'),
    name,
    projectId,
    workingDaysPerWeek: 5,
    bufferDays: 3,
    tasks: sortedTasks,
    totalDurationDays: totalDurationDays + 3,
    criticalPathDays,
    laborAlignmentScore,
    healthScore,
    riskItems,
    baseline: existingBaseline ?? null,
    updatedAt,
  };
}

export function saveBaseline(schedule: ProjectSchedule): ScheduleBaseline {
  return {
    savedAt: new Date().toISOString(),
    tasks: schedule.tasks.map(t => ({
      id: t.id,
      startDay: t.startDay,
      endDay: t.startDay + t.durationDays,
    })),
  };
}

export function getBaselineVariance(task: ScheduleTask, baseline: ScheduleBaseline | null | undefined): number | null {
  if (!baseline) return null;
  const bt = baseline.tasks.find(b => b.id === task.id);
  if (!bt) return null;
  const currentEnd = task.startDay + task.durationDays;
  return currentEnd - bt.endDay;
}

export function getPhaseColor(phase: string): string {
  return PHASE_COLORS[phase] || '#6366F1';
}

export function generateWbsCodes(tasks: ScheduleTask[]): ScheduleTask[] {
  const phaseMap = new Map<string, number>();
  let phaseIdx = 0;

  return tasks.map(task => {
    if (!phaseMap.has(task.phase)) {
      phaseIdx++;
      phaseMap.set(task.phase, phaseIdx);
    }
    const pIdx = phaseMap.get(task.phase)!;
    const tasksInPhase = tasks.filter(t => t.phase === task.phase);
    const taskIdx = tasksInPhase.indexOf(task) + 1;

    return {
      ...task,
      wbsCode: task.wbsCode || `${pIdx}.${taskIdx}`,
    };
  });
}
