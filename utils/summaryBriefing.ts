// utils/summaryBriefing.ts
// Pure, React-free rollups that power the Summary "Morning Briefing" dashboard.
// (Distinct from utils/summaryRollup.ts, which is the WBS summary-task rollup.)
//
// Day math: ONE rule, shared with every other schedule surface
// (utils/scheduleOps.ts). A schedule is anchored at its own `startDate` or it
// is UNDATED — there is no fallback anchor. Both rollups below used to anchor
// an undated schedule at `project.createdAt`, which put "today" at working day
// ~122 on a 30-day plan and returned nothing: the morning briefing reported an
// empty day and an empty week on two jobs with 20 and 15 open tasks, while the
// Schedule tab drew those same jobs starting today and NEEDS YOU called them
// "schedule at risk" two cards below (runtime audit MISS-01).
//
// THIS WEEK also ran a different membership rule from TODAY ON SITE — a raw
// CALENDAR index (Math.round over MS_DAY) with a 0-indexed start and an
// end of `startDay + durationDays`, versus TODAY's 1-indexed WORKING-day
// count with an inclusive `startDay + durationDays - 1`. Two cards on one
// screen, disagreeing about the same task. Both now call
// scheduleDayOnCalendar + isTaskActiveOnScheduleDay, so a task counted by one
// is counted by the other — the validator reconciles them day by day across a
// whole week.
import type { Project, Invoice, PunchItem, ChangeOrder } from '@/types';
import { PROJECT_CHIP_PALETTE } from '@/constants/colors';
import { toCalendarDayString } from '@/utils/calendarDate';
import {
  isMilestoneOnScheduleDay,
  isTaskActiveOnScheduleDay,
  resolveScheduleAnchor,
  scheduleDayOnCalendar,
} from '@/utils/scheduleOps';

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
  /**
   * Projects with a populated schedule but NO start date. Their work cannot be
   * placed on a calendar week at all, so it is absent from `days` — and the
   * screen must SAY so rather than let "0 tasks" read as "nothing to do".
   */
  undated: UndatedSchedule[];
}

/** A project whose schedule has tasks but no calendar anchor. */
export interface UndatedSchedule {
  projectId: string;
  projectName: string;
  openTasks: number;
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

// Moved to constants/colors.ts and DARKENED 2026-09-07: 10pt white initials
// sit on these chips and four of the six originals failed AA against white
// (worst #0FB5AE at 2.55:1). Hue families preserved so colour memory holds.
const SUMMARY_PROJECT_COLORS = PROJECT_CHIP_PALETTE;

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

/**
 * Which schedule day (1-indexed, WORKING days on the project's own calendar)
 * `day` is for `p` — or null when `day` is not a day of this schedule at all:
 * no anchor, before the anchor, or a weekend / site closure.
 *
 * MEMBERSHIP, so `scheduleDayOnCalendar` and NOT `scheduleDayNumberFor`. The
 * latter answers "what working day is this job on today", and to do that it
 * clamps: every date at or before the anchor is day 1, and a closed day folds
 * back onto the working day before it. Both cards below ask a different
 * question — "is this task on site on THIS calendar day" — and under those
 * clamps the answer is invented work: a job starting 2026-10-01 reported its
 * day-1 task as on site on 2026-09-06, the week strip put a crew on the three
 * days before a Thursday start, and one 0-day milestone was counted four times
 * in `milestoneCount` (Mon–Thu all clamp to day 1). That is MISS-01 pointed
 * the other way — over-reporting instead of under-reporting — and an invented
 * fact is worse than an absent one either way.
 */
function scheduleDayFor(p: Project, day: Date): number | null {
  const anchor = resolveScheduleAnchor(p.schedule);
  if (!anchor.date) return null;
  return scheduleDayOnCalendar(anchor.date, day, p.schedule?.workingDaysPerWeek, p.schedule?.nonWorkingDates);
}

/**
 * Projects carrying a schedule with tasks but no start date. Reported by both
 * rollups so the UI can name what it could not place, instead of rendering a
 * silent zero.
 */
export function undatedSchedules(projects: Project[]): UndatedSchedule[] {
  const out: UndatedSchedule[] = [];
  for (const p of projects) {
    const tasks = p.schedule?.tasks;
    if (!tasks || tasks.length === 0) continue;
    if (resolveScheduleAnchor(p.schedule).dated) continue;
    out.push({
      projectId: p.id,
      projectName: p.name,
      openTasks: tasks.filter((t) => t.status !== 'done').length,
    });
  }
  return out;
}

export function computeTodayTasks(projects: Project[], now: Date = new Date()): TodayTask[] {
  const out: TodayTask[] = [];
  for (const p of projects) {
    const tasks = p.schedule?.tasks;
    if (!tasks || tasks.length === 0) continue;
    const dayNumber = scheduleDayFor(p, now);
    if (dayNumber === null) continue; // undated — reported by undatedSchedules()
    for (const t of tasks) {
      if (!isTaskActiveOnScheduleDay(t, dayNumber)) continue;
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
      const dayNumber = scheduleDayFor(p, d);
      if (dayNumber === null) continue; // undated — reported below, not counted
      for (const t of tasks) {
        if (isTaskActiveOnScheduleDay(t, dayNumber)) count++;
        if (isMilestoneOnScheduleDay(t, dayNumber)) {
          hasMilestone = true;
          milestoneCount++;
        }
      }
    }
    totalTasks += count;
    days.push({
      // LOCAL components, not toISOString().slice(0, 10) — that re-projects
      // local midnight into UTC and names the NEXT day for the whole strip
      // anywhere east of Greenwich (and the previous one west of it).
      date: toCalendarDayString(d),
      weekdayLabel: labels[i],
      isToday: dayMs === todayMs,
      isWeekend: i >= 5,
      count,
      hasMilestone,
    });
  }
  return { days, totalTasks, milestoneCount, undated: undatedSchedules(projects) };
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
    // Drafts are unsent and not collectible — they can't be overdue.
    (i) => i.status !== 'paid' && i.status !== 'draft' && i.dueDate && new Date(i.dueDate).getTime() < nowMs,
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
