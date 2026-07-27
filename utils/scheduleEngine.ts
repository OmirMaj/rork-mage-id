import type { ScheduleTask, DependencyLink, ProjectSchedule, ScheduleRiskItem, ScheduleBaseline } from '@/types';
import { generateUUID } from '@/utils/generateId';

export const PHASE_OPTIONS = [
  'Site Work', 'Demo', 'Foundation', 'Framing', 'Roofing',
  'MEP', 'Plumbing', 'Electrical', 'HVAC', 'Insulation',
  'Drywall', 'Interior', 'Finishes', 'Landscaping', 'Inspections', 'General',
];

// Phase colors — vibrant, Apple-friendly palette. Each phase reads as a
// distinct hue at a glance even on a dense Gantt. Saturation is tuned for
// light backgrounds; the bar fill uses the color directly, the row dot
// uses the same color, and dimmed/baseline ghosts use the color at low
// alpha. Pick colors with enough hue separation that two adjacent phases
// don't blur together at small bar widths.
export const PHASE_COLORS: Record<string, string> = {
  'Site Work':    '#3B82F6', // blue
  'Demo':         '#EF4444', // red
  'Foundation':   '#10B981', // emerald
  'Framing':      '#A855F7', // purple
  'Roofing':      '#06B6D4', // cyan
  'MEP':          '#F59E0B', // amber
  'Plumbing':     '#0EA5E9', // sky
  'Electrical':   '#EAB308', // yellow
  'HVAC':         '#14B8A6', // teal
  'Insulation':   '#F97316', // orange
  'Drywall':      '#94A3B8', // slate
  'Interior':     '#EC4899', // pink
  'Finishes':     '#22C55E', // green
  'Landscaping':  '#84CC16', // lime
  'Inspections':  '#F59E0B', // amber (matches MEP — they share the inspection cadence)
  // 'General' is the DEFAULT phase every quick-added task lands in, so its
  // color is effectively the app's "default task" color. The old indigo
  // (#6366F1) made the whole schedule read as a second accent family next
  // to the ink+amber system (sim-audit slop #5). Warm stone keeps it
  // neutral — real trades keep their categorical hues.
  'General':      '#7A7266', // warm stone (neutral — uncategorized work)
};

export function createId(_prefix: string): string {
  return generateUUID();
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

/**
 * Advances `start` by `days` working days. Weekends are skipped when
 * `workingDaysPerWeek < 7`. When `nonWorkingDates` (ISO YYYY-MM-DD) is passed
 * in, those calendar days are also skipped — used to model holidays, rain
 * days, and site closures. We keep the signature backwards-compatible: old
 * callers passing just three args get weekend-only behavior.
 */
export function addWorkingDays(
  start: Date,
  days: number,
  workingDaysPerWeek: number,
  nonWorkingDates?: string[],
): Date {
  const result = new Date(start);
  const blocked = nonWorkingDates && nonWorkingDates.length > 0
    ? new Set(nonWorkingDates)
    : null;
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const dow = result.getDay();
    const weekendSkip = workingDaysPerWeek < 7 && (dow === 0 || dow === 6);
    if (weekendSkip) continue;
    if (blocked) {
      const iso = `${result.getFullYear()}-${String(result.getMonth() + 1).padStart(2, '0')}-${String(result.getDate()).padStart(2, '0')}`;
      if (blocked.has(iso)) continue;
    }
    added++;
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
  existingBaseline?: ScheduleBaseline | null,
  opts?: {
    /** Engine-derived project-finish day. When omitted, falls back to
     *  max(t.startDay + t.durationDays - 1) — correct for a single-pass
     *  forward-only resolver. Pass `cpm.projectFinish` to use the full
     *  CPM result. */
    criticalPathDays?: number;
    /** Calendar anchor (yyyy-mm-dd). When omitted the built schedule has NO
     *  startDate key at all — the engine must never invent one, because
     *  retro-stamping today onto a dateless schedule flips CPM raw-day →
     *  calendar mode and the finish date jumps (the documented startDate bug).
     *  CREATION flows anchor explicitly at the persist site instead. */
    startDate?: string;
  },
): ProjectSchedule {
  // Gap E (audit) — Skip the legacy forward-pass-only resolver when the
  // caller has already run full CPM and threaded cpm.projectFinish in via
  // opts.criticalPathDays. Without this guard the engine double-executes:
  // schedule-pro runs runCpm (full forward + backward + anchors + calendar),
  // then this function re-runs the simpler forward-pass-only resolver,
  // which can disagree by ±1 day on certain edge cases — surfaces as a
  // "save jitters task by 1 day" bug.
  //
  // Classic-mobile callers in app/(tabs)/schedule/index.tsx don't run full
  // CPM themselves and DO need recalculateStartDays as a forward-fix safety
  // net, so we keep it for them (signal: no opts.criticalPathDays).
  const recalculated = opts?.criticalPathDays !== undefined
    ? tasks
    : recalculateStartDays(tasks);
  const sortedTasks = recalculated
    .slice()
    .sort((a, b) => a.startDay - b.startDay || a.title.localeCompare(b.title));

  // ONE derivation for both duration scalars (2026-07 sim-audit fix #2):
  // the same schedule used to show three different lengths — the modal's
  // "Duration" (max(startDay + durationDays), a fencepost one past the true
  // finish, PLUS a hidden +3 buffer baked in), the "Critical path" (CPM
  // projectFinish), and the wizard's estimate (max CPM EF). All three now
  // resolve to the ENGINE's project-finish day:
  //   - when the caller threads cpm.projectFinish in via opts.criticalPathDays
  //     (schedule-pro, mobile Pro, classic persistEditedTasks), that value is
  //     authoritative for BOTH scalars;
  //   - otherwise fall back to the latest task end-day using the CPM EF
  //     convention — a task ENDS on startDay + durationDays - 1, and a 0-day
  //     milestone ends ON its startDay (never startDay - 1). This matches
  //     runCpm's forward pass in raw-day mode, so the fallback and the engine
  //     agree for already-resolved task sets.
  // bufferDays stays a SEPARATE field — never silently folded into duration.
  const fallbackFinish = sortedTasks.reduce((max, t) => {
    const dur = Math.max(0, t.durationDays || 0);
    const end = dur === 0 ? t.startDay : t.startDay + dur - 1;
    return Math.max(max, end);
  }, 0);
  const projectFinishDay = opts?.criticalPathDays ?? fallbackFinish;

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
    // NO today-default (the documented finish-jump bug): stamping a date onto
    // a previously dateless schedule flips CPM from raw-day to calendar mode
    // and the finish silently jumps. The key is OMITTED entirely when absent
    // so `{ ...existing, ...built }` spreads can't clobber a real startDate
    // with undefined. Creation flows that want an anchor pass opts.startDate.
    ...(opts?.startDate ? { startDate: opts.startDate } : {}),
    workingDaysPerWeek: 5,
    bufferDays: 3,
    tasks: sortedTasks,
    totalDurationDays: projectFinishDay,
    criticalPathDays: projectFinishDay,
    laborAlignmentScore,
    healthScore,
    riskItems,
    baseline: existingBaseline ?? null,
    updatedAt,
  };
}

/**
 * Merge a freshly-built schedule's DERIVED SCALARS onto an existing schedule,
 * preserving every sidecar field. Mirrors the classic persistEditedTasks merge
 * in app/(tabs)/schedule/index.tsx: spread the existing schedule first, then
 * overwrite ONLY the fields the CPM/build pass just recomputed. This is what a
 * manual-edit save (mobile Pro, desktop) must do — a naive `{ ...built }` write
 * silently drops nonWorkingDates, scenarios, activeScenarioId,
 * criticalFloatThresholdDays, resources, resourceCalendars, fragnets,
 * baselines[], weatherAlerts, weatherDelayLog AND resets bufferDays /
 * workingDaysPerWeek to buildScheduleFromTasks' hardcoded defaults.
 *
 * The `built` argument is the output of buildScheduleFromTasks (its derived
 * scalars are authoritative); `existing` supplies every other field.
 */
export function mergeEditedSchedule(
  existing: ProjectSchedule,
  built: ProjectSchedule,
  opts?: {
    /** New calendar anchor to set (creation flows). Omit to keep existing. */
    startDate?: string;
    /** projectId to stamp (mobile passes the selected project id). */
    projectId?: string | null;
  },
): ProjectSchedule {
  return {
    ...existing,
    tasks: built.tasks,
    totalDurationDays: built.totalDurationDays,
    criticalPathDays: built.criticalPathDays,
    healthScore: built.healthScore,
    laborAlignmentScore: built.laborAlignmentScore,
    riskItems: built.riskItems,
    ...(opts?.startDate ? { startDate: opts.startDate } : {}),
    ...(opts?.projectId !== undefined ? { projectId: opts.projectId ?? existing.projectId } : {}),
    updatedAt: new Date().toISOString(),
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
  // Unknown phases fall back to the same neutral as 'General' — an unmapped
  // phase is uncategorized work, not a new accent color.
  return PHASE_COLORS[phase] || '#7A7266';
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
