// utils/summaryBriefing.ts
// Pure, React-free rollups that power the Summary "Morning Briefing" dashboard.
// (Distinct from utils/summaryRollup.ts, which is the WBS summary-task rollup.)
//
// Day math: each project's schedule lives in a day-index space anchored at
// schedule.startDate (fallback project.createdAt). A calendar day maps to a
// per-project index; a task is "active" on that day when
// startDay <= index <= startDay + durationDays.
import type { Project, Invoice, PunchItem, ChangeOrder } from '@/types';

const MS_DAY = 24 * 60 * 60 * 1000;

export interface TodayTask {
  projectId: string;
  projectName: string;
  projectColor: string;
  taskTitle: string;
  isCritical: boolean;
  context: string; // crew or assigned sub; '' when none
}

export interface WeekDay {
  date: string; // ISO yyyy-mm-dd
  weekdayLabel: string; // 'M' 'T' 'W' 'T' 'F' 'S' 'S'
  isToday: boolean;
  isWeekend: boolean;
  count: number; // tasks active that day across all projects
  hasMilestone: boolean; // a milestone lands that day
}

export interface WeekLoad {
  days: WeekDay[]; // length 7, Monday → Sunday
  totalTasks: number; // sum of per-day counts
  milestoneCount: number; // milestone tasks landing within the week
}

export type AttentionSeverity = 'danger' | 'amber';

export interface AttentionItem {
  id: string;
  severity: AttentionSeverity;
  label: string;
  actionLabel: string; // 'View' | 'Review' | 'Send'
  route: string; // expo-router pathname (confirmed routes only)
  params?: Record<string, string>;
}

const SUMMARY_PROJECT_COLORS = ['#F2700A', '#0A84FF', '#1F9D57', '#7A5AF8', '#0FB5AE', '#D0211A'];

export function projectColor(projectId: string): string {
  let h = 0;
  for (let i = 0; i < projectId.length; i++) h = (h * 31 + projectId.charCodeAt(i)) >>> 0;
  return SUMMARY_PROJECT_COLORS[h % SUMMARY_PROJECT_COLORS.length];
}

export function chipInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '–';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function startOfDayMs(d: Date): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

function projectStartBaseMs(p: Project): number {
  const raw = p.schedule?.startDate ? new Date(p.schedule.startDate) : new Date(p.createdAt);
  raw.setHours(0, 0, 0, 0);
  return raw.getTime();
}

function dayIndexFor(p: Project, dayMs: number): number {
  return Math.round((dayMs - projectStartBaseMs(p)) / MS_DAY);
}

export function computeTodayTasks(projects: Project[], now: Date = new Date()): TodayTask[] {
  const todayMs = startOfDayMs(now);
  const out: TodayTask[] = [];
  for (const p of projects) {
    const tasks = p.schedule?.tasks;
    if (!tasks || tasks.length === 0) continue;
    const idx = dayIndexFor(p, todayMs);
    for (const t of tasks) {
      if (t.status === 'done') continue;
      const start = t.startDay ?? 0;
      const end = start + Math.max(0, t.durationDays ?? 0);
      if (idx >= start && idx <= end) {
        out.push({
          projectId: p.id,
          projectName: p.name,
          projectColor: projectColor(p.id),
          taskTitle: t.title,
          isCritical: !!t.isCriticalPath,
          context: (t.crew || t.assignedSubName || '').trim(),
        });
      }
    }
  }
  return out.sort((a, b) => Number(b.isCritical) - Number(a.isCritical));
}

export function computeWeekLoad(projects: Project[], now: Date = new Date()): WeekLoad {
  const base = new Date(now);
  base.setHours(0, 0, 0, 0);
  const mondayOffset = (base.getDay() + 6) % 7; // 0 = Monday
  const monday = new Date(base);
  monday.setDate(base.getDate() - mondayOffset);
  const todayMs = base.getTime();
  const labels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const days: WeekDay[] = [];
  let totalTasks = 0;
  let milestoneCount = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    d.setHours(0, 0, 0, 0);
    const dayMs = d.getTime();
    let count = 0;
    let hasMilestone = false;
    for (const p of projects) {
      const tasks = p.schedule?.tasks;
      if (!tasks) continue;
      const idx = dayIndexFor(p, dayMs);
      for (const t of tasks) {
        if (t.status === 'done') continue;
        const start = t.startDay ?? 0;
        const end = start + Math.max(0, t.durationDays ?? 0);
        if (idx >= start && idx <= end) {
          count++;
          if (t.isMilestone && idx === start) {
            hasMilestone = true;
            milestoneCount++;
          }
        }
      }
    }
    totalTasks += count;
    days.push({
      date: d.toISOString().slice(0, 10),
      weekdayLabel: labels[i],
      isToday: dayMs === todayMs,
      isWeekend: i >= 5,
      count,
      hasMilestone,
    });
  }
  return { days, totalTasks, milestoneCount };
}

export function aggregateAttention(
  projects: Project[],
  invoices: Invoice[],
  punchItems: PunchItem[],
  changeOrders: ChangeOrder[],
  now: Date = new Date(),
): AttentionItem[] {
  const nowMs = now.getTime();
  const out: AttentionItem[] = [];

  const overdue = invoices.filter(
    (i) => i.status !== 'paid' && i.dueDate && new Date(i.dueDate).getTime() < nowMs,
  );
  if (overdue.length > 0) {
    const worst = [...overdue].sort(
      (a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime(),
    )[0];
    const days = Math.max(1, Math.floor((nowMs - new Date(worst.dueDate).getTime()) / MS_DAY));
    out.push({
      id: 'overdue-invoices',
      severity: 'danger',
      label:
        overdue.length === 1
          ? `Invoice ${days} days overdue`
          : `${overdue.length} invoices overdue (worst ${days}d)`,
      actionLabel: 'View',
      route: '/reports',
    });
  }

  const urgentPunch = punchItems.filter((pi) => pi.status !== 'closed' && pi.priority === 'high');
  if (urgentPunch.length > 0) {
    out.push({
      id: 'urgent-punch',
      severity: 'danger',
      label: `${urgentPunch.length} high-priority punch item${urgentPunch.length === 1 ? '' : 's'}`,
      actionLabel: 'View',
      route: '/project-detail',
      params: { id: urgentPunch[0].projectId },
    });
  }

  const pendingCO = changeOrders.filter(
    (co) => co.status === 'submitted' || co.status === 'under_review',
  );
  if (pendingCO.length > 0) {
    out.push({
      id: 'pending-cos',
      severity: 'amber',
      label: `${pendingCO.length} change order${pendingCO.length === 1 ? '' : 's'} awaiting approval`,
      actionLabel: 'Review',
      route: '/project-detail',
      params: { id: pendingCO[0].projectId },
    });
  }

  return out;
}
