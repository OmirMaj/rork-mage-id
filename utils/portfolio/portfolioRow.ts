// utils/portfolio/portfolioRow.ts — one row of the desktop Home portfolio table.
//
// PURE: no React, no react-native (bun-executable; scripts/validate-portfolio-row.ts
// runs it over fixtures).
//
// WHY (wave 6c, lane F). The desktop Home was the phone's card list stretched
// across a 1512 px laptop: the project table rendered AFTER twelve full-width
// cards, and its columns were 'Area', 'Quality', 'Burn' and 'Estimate' — none
// of which is what a GC scans his book for. The portfolio table answers the
// four questions he opens Home with: where is each job (stage, % done), is it
// on time (schedule, finish), is it billed (contract, billed %, A/R) and what
// is waiting on it (open items, next milestone, last activity).
//
// HONESTY. Every unknown is null — the table prints '—' — never a 0 computed
// from a list that was not read or a job whose money is not on this device:
//   • contract / billed / A/R come only through `burnByProject`, i.e.
//     utils/projectClone buildBurnByProject's visibility rule (a job someone
//     else owns, a field seat, or unread invoices / change orders get NO entry);
//   • % complete is null without a schedule to roll up;
//   • the schedule verdict is 'undated' (not a date made up from today) when
//     the schedule has no start date, and null when there is no schedule;
//   • slip is null without a baseline — the status then comes from overdue
//     tasks and the schedule's health score alone.
//
// The schedule half is derived EXACTLY as the phone schedule screen derives it
// (components/schedule/MobileScheduleScreen: runCpm on the resolved anchor,
// the active baseline's finish on the working scale, workingDaysBetween, the
// calendar-day deadline rule for overdue), so Home and the Schedule tab can
// never quote two verdicts for one job.

import type { ChangeOrder, DailyFieldReport, Invoice, Project, PunchItem, RFI } from '@/types';
import { computeProjectProgress } from '@/utils/projectProgress';
import { computePillStatus, type PillStatus } from '@/utils/scheduleHealth';
import {
  resolveScheduleAnchor,
  getActiveBaseline,
  baselineFinishDayWorkingScale,
} from '@/utils/scheduleOps';
import { runCpm, workingDaysBetween, calendarDayToDate } from '@/utils/cpm';
import { parseCalendarDay, toCalendarDayString } from '@/utils/calendarDate';
import { invoiceOutstanding } from '@/utils/invoiceBilling';
import { getDaysPastDue } from '@/utils/projectFinancials';
import { displayText } from '@/utils/formatters';
import { stageForStatus, statusLabel, type ProjectStage } from '@/utils/projectStage';
import { billedPct } from '@/utils/projectWorkspaceLayout';

export interface PortfolioSchedule {
  status: PillStatus;
  /** Working days past the active baseline's finish; null with no baseline. */
  slipDays: number | null;
  /** Unfinished tasks whose deadline day has passed. */
  overdueCount: number;
}

export interface PortfolioOpenItems {
  rfi: number;
  co: number;
  punch: number;
}

export interface PortfolioRow {
  id: string;
  name: string;
  /** The jobsite as typed (displayText), or null. */
  city: string | null;
  status: Project['status'];
  stage: ProjectStage;
  /** utils/projectStage statusLabel — the one stage vocabulary. */
  stageLabel: string;
  /** Duration-weighted % complete; null when there is no schedule to roll up. */
  pct: number | null;
  /** 'undated' = a schedule with no start date; null = no schedule / no tasks. */
  schedule: PortfolioSchedule | 'undated' | null;
  /** The CPM finish as a calendar day ('YYYY-MM-DD'); null undated / no tasks. */
  finishISO: string | null;
  /** Revised contract (estimate + approved COs); null when not on this device. */
  contract: number | null;
  /** Invoiced to date ÷ revised contract, rounded, clamped 0–100; null when unknown or no contract. */
  billedPct: number | null;
  /** Outstanding (invoiceOutstanding) over the job's non-draft invoices; null when the money is not on this device. */
  ar: number | null;
  /** Any of those invoices more than 30 days past due. */
  arOver30: boolean;
  open: PortfolioOpenItems;
  nextMilestone: { title: string; dateISO: string | null } | null;
  lastActivityISO: string | null;
  /** riskRank × 100000 + finish epoch-day (99999 when none). Ascending = worst first. */
  scheduleSortValue: number;
}

export interface BurnEntry {
  invoicedToDate: number;
  revisedContract: number;
}

export interface PortfolioRowInput {
  projects: readonly Project[];
  invoices: readonly Invoice[];
  changeOrders: readonly ChangeOrder[];
  rfis: readonly RFI[];
  punchItems: readonly PunchItem[];
  /** For last activity. Optional: a caller without the reports passes none. */
  dailyReports?: readonly DailyFieldReport[];
  burnByProject: ReadonlyMap<string, BurnEntry>;
  now: Date;
}

/** Sort rank of a schedule verdict: late first, then at risk, on track, and
 *  last the jobs with no verdict at all (undated or no schedule). */
export const SCHEDULE_RISK_RANK: Readonly<Record<PillStatus | 'none', number>> = {
  late: 0,
  at_risk: 1,
  on_track: 2,
  none: 3,
};

const NO_FINISH_DAY = 99999;
const DAY_MS = 86400000;

/** A calendar day ('YYYY-MM-DD') as whole days since the epoch — timezone-free. */
function epochDay(iso: string | null): number | null {
  const d = parseCalendarDay(iso);
  if (!d) return null;
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
}

/** Any stored date (a bare calendar day or a full instant) as epoch ms, or null. */
function instantOf(value: string | null | undefined): number | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const d = parseCalendarDay(value);
    return d ? d.getTime() : null;
  }
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

/**
 * Billed % — the ONE rule: this delegates to the job page's own billedPct
 * (utils/projectWorkspaceLayout, lane E's Billed KPI), so Home and the job page
 * print the same number for the same invoices over the same contract.
 *
 * NOT clamped at 100. An overbilled job (invoiced past the revised contract)
 * reads 114%, as it does on the job page — a 100% cap hid exactly the job a GC
 * most needs to see. Below 0 cannot happen (billedPct floors invoiced at 0).
 * Unknown on either side, or a contract ≤ 0, is null ('—').
 *
 * The DENOMINATOR is still Home's: the revised contract from buildBurnByProject
 * (estimate + approved change orders). The job page prefers a SIGNED contract's
 * price (MONEY-CONTRACT-1); Home reads no project_contracts, so for a job signed
 * at a price other than its estimate the two can differ — recorded as an
 * accepted deviation, and the desktop table says so under the table
 * (components/portfolio/PortfolioTable, CONTRACT_BASIS_NOTE).
 */
export function billedPercent(invoicedToDate: number | null | undefined, revisedContract: number | null | undefined): number | null {
  if (invoicedToDate == null || revisedContract == null) return null;
  if (!Number.isFinite(invoicedToDate) || !Number.isFinite(revisedContract)) return null;
  return billedPct(invoicedToDate, revisedContract);
}

function scheduleFacts(p: Project, now: Date): {
  pct: number | null;
  schedule: PortfolioRow['schedule'];
  finishISO: string | null;
  nextMilestone: PortfolioRow['nextMilestone'];
} {
  const progress = computeProjectProgress(p);
  const pct = progress.hasSchedule ? progress.pct : null;
  const sched = p.schedule;
  const tasks = sched?.tasks ?? [];
  if (!sched || tasks.length === 0) return { pct, schedule: null, finishISO: null, nextMilestone: null };

  const anchor = resolveScheduleAnchor(sched, now);
  const calendar = {
    scheduleStartDate: anchor.iso ?? undefined,
    workingDaysPerWeek: sched.workingDaysPerWeek,
    nonWorkingDates: sched.nonWorkingDates,
  };
  // No anchor ⇒ NO scheduleStartDate: runCpm stays in raw-day mode (the
  // finish-jump bug was passing today here).
  const cpm = runCpm(tasks, calendar);

  // Next milestone: the first unfinished milestone by early start.
  let nextMilestone: PortfolioRow['nextMilestone'] = null;
  let bestEs = Infinity;
  for (const t of tasks) {
    if (!t.isMilestone || t.status === 'done' || (t.progress ?? 0) >= 100) continue;
    const es = cpm.perTask.get(t.id)?.es ?? t.startDay ?? Infinity;
    if (es < bestEs) {
      bestEs = es;
      nextMilestone = {
        title: t.title,
        dateISO: anchor.date && Number.isFinite(es) ? toCalendarDayString(calendarDayToDate(anchor.date, es)) : null,
      };
    }
  }

  if (!anchor.dated || !anchor.date) {
    return { pct, schedule: 'undated', finishISO: null, nextMilestone };
  }

  const baseline = getActiveBaseline(sched);
  const baselineFinish = baseline ? baselineFinishDayWorkingScale(baseline, calendar) : null;
  const slipDays = baselineFinish == null ? null : workingDaysBetween(baselineFinish, cpm.projectFinish, calendar);

  // A deadline is a calendar day: late once the day itself has passed
  // (local midnights compared — MobileScheduleScreen's rule).
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const overdueCount = tasks.filter((t) => {
    if (t.status === 'done' || !t.deadline) return false;
    const due = parseCalendarDay(t.deadline);
    return due != null && due.getTime() < todayMidnight;
  }).length;

  const status = computePillStatus({
    cpmSlipDays: slipDays ?? 0,
    overdueCount,
    healthScore: sched.healthScore ?? 100,
  });

  return {
    pct,
    schedule: { status, slipDays, overdueCount },
    finishISO: toCalendarDayString(calendarDayToDate(anchor.date, cpm.projectFinish)),
    nextMilestone,
  };
}

/**
 * The portfolio rows, sorted by name (localeCompare) so the table's stable
 * sort breaks ties by name.
 */
export function buildPortfolioRows(input: PortfolioRowInput): PortfolioRow[] {
  const { projects, invoices, changeOrders, rfis, punchItems, dailyReports = [], burnByProject, now } = input;

  const byProject = <T extends { projectId: string }>(list: readonly T[]) => {
    const m = new Map<string, T[]>();
    for (const x of list) {
      const arr = m.get(x.projectId);
      if (arr) arr.push(x); else m.set(x.projectId, [x]);
    }
    return m;
  };
  const invByP = byProject(invoices);
  const coByP = byProject(changeOrders);
  const rfiByP = byProject(rfis);
  const punchByP = byProject(punchItems);
  const dfrByP = byProject(dailyReports);

  const rows = projects.map((p): PortfolioRow => {
    const facts = scheduleFacts(p, now);
    const burn = burnByProject.get(p.id);
    const jobInvoices = invByP.get(p.id) ?? [];

    let ar: number | null = null;
    let arOver30 = false;
    if (burn) {
      ar = 0;
      for (const inv of jobInvoices) {
        // Drafts are not billed. A stored 'paid' is NOT skipped: the money
        // rules decide (utils/projectFinancials getEffectiveInvoiceStatus) — a
        // settled invoice owes 0, and a legacy 'paid' row with a released,
        // unpaid retention still owes it.
        if (inv.status === 'draft') continue;
        ar += invoiceOutstanding(inv);
        if (getDaysPastDue(inv) > 30) arOver30 = true;
      }
      ar = Math.round(ar * 100) / 100;
    }

    const open: PortfolioOpenItems = {
      rfi: (rfiByP.get(p.id) ?? []).filter((r) => r.status === 'open').length,
      co: (coByP.get(p.id) ?? []).filter((c) => c.status === 'submitted' || c.status === 'under_review').length,
      punch: (punchByP.get(p.id) ?? []).filter((x) => x.status !== 'closed').length,
    };

    let last: number | null = instantOf(p.updatedAt);
    const consider = (v: string | null | undefined) => {
      const t = instantOf(v);
      if (t != null && (last == null || t > last)) last = t;
    };
    for (const inv of jobInvoices) consider(inv.issueDate);
    for (const r of dfrByP.get(p.id) ?? []) consider(r.date);
    for (const r of rfiByP.get(p.id) ?? []) consider(r.dateSubmitted);

    const verdict = facts.schedule && facts.schedule !== 'undated' ? facts.schedule.status : 'none';
    const finishDay = epochDay(facts.finishISO);

    return {
      id: p.id,
      name: p.name,
      city: displayText(p.location) || null,
      status: p.status,
      stage: stageForStatus(p.status),
      stageLabel: statusLabel(p.status),
      pct: facts.pct,
      schedule: facts.schedule,
      finishISO: facts.finishISO,
      contract: burn ? burn.revisedContract : null,
      billedPct: burn ? billedPercent(burn.invoicedToDate, burn.revisedContract) : null,
      ar,
      arOver30,
      open,
      nextMilestone: facts.nextMilestone,
      lastActivityISO: last == null ? null : new Date(last).toISOString(),
      scheduleSortValue: SCHEDULE_RISK_RANK[verdict] * 100000 + (finishDay ?? NO_FINISH_DAY),
    };
  });

  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/** '3 RFI · 1 CO · 12 punch', zeros skipped; '—' when nothing is open. */
export function formatOpenItems(open: PortfolioOpenItems): string {
  const parts: string[] = [];
  if (open.rfi > 0) parts.push(`${open.rfi} RFI`);
  if (open.co > 0) parts.push(`${open.co} CO`);
  if (open.punch > 0) parts.push(`${open.punch} punch`);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

/** The Schedule cell: 'On track' / 'At risk' / 'Late +Nd' / 'No start date';
 *  '—' with no schedule. Late names its reason: the slip in working days when
 *  there is a baseline to slip from, otherwise the overdue task count — an
 *  overdue count is not a number of days, so it is never printed as '+Nd'.
 *  It prints as 'N overdue' (in the late ink), not 'Late · N overdue': the
 *  longer form does not fit the Schedule column (PORTFOLIO_COLUMN_WIDTHS) and
 *  was cut to 'Late · 3 ov…'. The full sentence is scheduleCellDescription. */
export function scheduleCellLabel(s: PortfolioRow['schedule']): string {
  if (s === null) return '—';
  if (s === 'undated') return 'No start date';
  if (s.status === 'on_track') return 'On track';
  if (s.status === 'at_risk') return 'At risk';
  if (s.slipDays != null && s.slipDays > 0) return `Late +${s.slipDays}d`;
  if (s.overdueCount > 0) return `${s.overdueCount} overdue`;
  return 'Late';
}

/** The Schedule cell as a sentence — its accessibilityLabel and web tooltip. */
export function scheduleCellDescription(s: PortfolioRow['schedule']): string {
  if (s === null) return 'No schedule';
  if (s === 'undated') return 'Schedule has no start date';
  if (s.status === 'on_track') return 'On track';
  if (s.status === 'at_risk') return 'At risk';
  const reasons: string[] = [];
  if (s.slipDays != null && s.slipDays > 0) reasons.push(`${s.slipDays} working ${s.slipDays === 1 ? 'day' : 'days'} behind baseline`);
  if (s.overdueCount > 0) reasons.push(`${s.overdueCount} overdue ${s.overdueCount === 1 ? 'task' : 'tasks'}`);
  return reasons.length > 0 ? `Late, ${reasons.join(', ')}` : 'Late';
}

/** The desktop portfolio table's fixed column widths (px; each cell has 10 px
 *  of padding a side). Kept here, pure, so validate-portfolio-row can prove
 *  the longest Stage and Schedule words fit, and that Job keeps its 160 px
 *  minimum at EVERY table width (see PORTFOLIO_HIDE_BELOW). Finish is 72, not
 *  the spec's 76: its longest text is 'Sep 30' (six characters), and the 4 px
 *  pay for the highlighted row's 3 px left border at 1512 with the rail. */
export const PORTFOLIO_COLUMN_WIDTHS = {
  jobMin: 160,
  stage: 120,
  pct: 64,
  schedule: 112,
  finish: 72,
  contract: 84,
  billed: 64,
  ar: 84,
  open: 116,
  milestone: 160,
  activity: 112,
  actions: 40,
} as const;

/** What a row loses to chrome, beyond its cells: the card's 1 px border each
 *  side, plus the 3 px left border of the highlighted (just-created) or
 *  keyboard-focused row (DataTable rowActive / rowFocused). */
export const PORTFOLIO_ROW_CHROME = 2 + 3;

/** hideBelow for each hideable column, measured on the TABLE's outer width
 *  (DataTable's onLayout). The rule: a column shows only when Job still gets
 *  its minimum with it and every column that shows before it. Columns hide in
 *  this order as the table narrows: Last activity, Next milestone, %,
 *  Contract, Open, Billed. Each threshold is the cumulative sum, so no table
 *  width, whatever the window, sidebar, action rail or scrollbar, can push Job
 *  under its minimum (validate-portfolio-row sweeps every width). Next
 *  milestone and Last activity keep the spec's 1200 / 1320, which are wider
 *  than their sums. Billed is the one the spec marks 'never': it hides only
 *  under 657 px, which a web window of 900–944 px with the full sidebar
 *  reaches, and where Stage + Schedule + Finish + Billed + A/R + ⋯ + Job
 *  cannot all fit. */
const W_ = PORTFOLIO_COLUMN_WIDTHS;
const ALWAYS_SHOWN = W_.jobMin + PORTFOLIO_ROW_CHROME + W_.stage + W_.schedule + W_.finish + W_.ar + W_.actions;
const BILLED_AT = ALWAYS_SHOWN + W_.billed;
const OPEN_AT = BILLED_AT + W_.open;
const CONTRACT_AT = OPEN_AT + W_.contract;
const PCT_AT = CONTRACT_AT + W_.pct;
const MILESTONE_AT = Math.max(1200, PCT_AT + W_.milestone);
export const PORTFOLIO_HIDE_BELOW = {
  billed: BILLED_AT, // 657
  open: OPEN_AT, // 773
  contract: CONTRACT_AT, // 857
  pct: PCT_AT, // 921
  milestone: MILESTONE_AT, // 1200
  activity: Math.max(1320, MILESTONE_AT + W_.activity), // 1320
} as const;

/** DataTable's cell padding, a side. */
export const PORTFOLIO_CELL_PAD = 10;
/** The Stage cell's tone dot (6) plus its gap (6). */
export const PORTFOLIO_STAGE_DOT = 12;

/** Whole days between a stored instant and `now` — 'Today', '1d ago', 'Nd ago'. */
export function relativeDaysLabel(iso: string | null, now: Date): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const dayOf = (ms: number) => {
    const d = new Date(ms);
    return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
  };
  const days = dayOf(now.getTime()) - dayOf(t);
  if (days <= 0) return 'Today';
  return `${days}d ago`;
}
