import type { Invoice, ChangeOrder, Commitment, Project } from '@/types';
import { getEffectiveInvoiceStatus } from '@/utils/projectFinancials';
import { netBalanceDue, pendingRetentionHeld } from '@/utils/invoiceBilling';
import { commitmentUnpaid } from '@/utils/jobCostEngine';
import { addWorkingDays } from '@/utils/scheduleEngine';
import { parseCalendarDay } from '@/utils/calendarDate';

export type ExpenseFrequency = 'weekly' | 'biweekly' | 'monthly' | 'one_time';
export type ExpenseCategory = 'payroll' | 'materials' | 'equipment_rental' | 'subcontractor' | 'insurance' | 'overhead' | 'loan' | 'other';

export interface CashFlowExpense {
  id: string;
  name: string;
  amount: number;
  frequency: ExpenseFrequency;
  category: ExpenseCategory;
  startDate: string;
  endDate?: string;
  /**
   * The signed Commitment this row is the money for. One field, used from
   * both ends:
   *
   *   • On a DERIVED row (`derived: true`) it names the commitment the row was
   *     generated from.
   *   • On a HAND-TYPED row the GC sets it to say "this line IS my draw
   *     schedule for that sub", and buildCommittedOutflows then generates
   *     nothing for that commitment — his dates beat our even spread, and the
   *     money is counted once.
   */
  commitmentId?: string;
  /**
   * True when buildCommittedOutflows generated this row from a commitment
   * rather than the GC typing it. Derived rows are rebuilt from the
   * commitments on every forecast and are never persisted into
   * `mage_cashflow_data`, so they cannot accumulate on disk or be edited into
   * a second copy of the same money.
   */
  derived?: boolean;
}

export interface ExpectedPayment {
  id: string;
  description: string;
  amount: number;
  expectedDate: string;
  confidence: 'confirmed' | 'expected' | 'hopeful';
  projectId?: string;
}

export interface CashFlowWeek {
  weekStart: string;
  weekEnd: string;
  incomeItems: { description: string; amount: number; confidence: string }[];
  expenseItems: { description: string; amount: number; category: string }[];
  totalIncome: number;
  totalExpenses: number;
  netCashFlow: number;
  runningBalance: number;
}

export interface CashFlowSummary {
  totalIncome: number;
  totalExpenses: number;
  /**
   * CASH IN MINUS CASH OUT over the horizon. This is NOT profit and was called
   * `netProfit` until the 2026-09-07 audit's do-next #12b.
   *
   * A change in cash ignores accrual in both directions: an owner's deposit is
   * counted as gain the week it lands even though none of the work is done,
   * and a materials prepay is counted as loss even though the material is an
   * asset sitting in the yard. Work performed but not yet billed contributes
   * nothing at all. A GC who read "Net Profit" off this screen and repeated
   * the figure to his accountant or to a lender was being misled by the label
   * rather than by the arithmetic — the number is right, the word was wrong.
   *
   * Job profit lives in utils/jobCostEngine.ts (budget vs cost) and the WIP
   * report; this field must never be rendered under a profit label.
   */
  netCashChange: number;
  lowestBalance: number;
  lowestBalanceWeek: number;
  highestBalance: number;
  highestBalanceWeek: number;
  dangerWeeks: { weekNumber: number; weekDate: string; balance: number }[];
}

/**
 * Effective current cash position = stored starting balance + any invoice
 * payments recorded since the balance was last set. Lets the GC set the balance
 * once ("my bank shows $42k today"), then record payments as checks come in
 * without manually re-typing the balance each time.
 *
 * MONEY-F7 (audit 2026-09-03): a RETENTION RELEASE is not cash received. Release
 * means "now collectible" — it flows into netBalanceDue() and is forecast as
 * income below; the cash arrives when the GC records the payment, which lands
 * here through `payments`. Adding `retentionReleases[].amount` as well counted
 * the same $10,000 as bank balance AND as receivable, then a third time when
 * the check was recorded.
 */
export function getEffectiveStartingBalance(
  storedBalance: number,
  balanceAsOf: string | undefined,
  invoices: Invoice[],
): number {
  if (!balanceAsOf) return storedBalance;
  const cutoff = new Date(balanceAsOf).getTime();
  if (Number.isNaN(cutoff)) return storedBalance;

  let additional = 0;
  for (const inv of invoices) {
    for (const p of inv.payments ?? []) {
      const ts = new Date(p.date).getTime();
      if (!Number.isNaN(ts) && ts > cutoff) {
        additional += p.amount ?? 0;
      }
    }
  }
  return storedBalance + additional;
}

function getPaymentTermsDays(terms: string | undefined): number {
  switch (terms) {
    case 'net_15': return 15;
    case 'net_45': return 45;
    case 'due_on_receipt': return 0;
    case 'net_30':
    default: return 30;
  }
}

function isDateInWeek(dateStr: string, weekStart: Date, weekEnd: Date): boolean {
  const d = new Date(dateStr);
  return d >= weekStart && d <= weekEnd;
}

function shouldExpenseOccurInWeek(
  expense: CashFlowExpense,
  weekStart: Date,
  weekEnd: Date,
  weekIndex: number
): boolean {
  const start = new Date(expense.startDate);
  if (start > weekEnd) return false;
  if (expense.endDate) {
    const end = new Date(expense.endDate);
    if (end < weekStart) return false;
  }

  switch (expense.frequency) {
    case 'weekly':
      return true;
    case 'biweekly': {
      // Fire every 14 days ANCHORED to the expense's own startDate, not to the
      // absolute forecast week (weekIndex). Using weekIndex phased every
      // biweekly expense off week 0 of the forecast regardless of when it
      // actually starts, so an expense starting next week could fire this week.
      // Count whole weeks from the expense's start week to this week and fire
      // on even parity — mirrors the monthly branch's startDate anchoring.
      const MS_WEEK = 7 * 24 * 60 * 60 * 1000;
      // Normalize both anchors to their week-start so partial-week offsets in
      // startDate don't flip the parity. weekStart is already a week boundary
      // in the forecast; align the expense start the same way by flooring.
      const startWeekMs = new Date(start).setHours(0, 0, 0, 0);
      const weekStartMs = new Date(weekStart).setHours(0, 0, 0, 0);
      const weeksSinceStart = Math.round((weekStartMs - startWeekMs) / MS_WEEK);
      return weeksSinceStart >= 0 && weeksSinceStart % 2 === 0;
    }
    case 'monthly': {
      // Fire exactly ONCE per calendar month, anchored to the expense's
      // start day-of-month. Walk each day in the week and check whether it is
      // the anchor day for its own month — clamping the anchor to that month's
      // last day so a dom of 29/30/31 still fires once in shorter months
      // (e.g. dom=31 in a 30-day month fires on the 30th).
      const dom = start.getDate();
      for (let d = new Date(weekStart); d <= weekEnd; d.setDate(d.getDate() + 1)) {
        const lastDayOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        const anchorDay = Math.min(dom, lastDayOfMonth);
        if (d.getDate() === anchorDay) return true;
      }
      return false;
    }
    case 'one_time':
      return isDateInWeek(expense.startDate, weekStart, weekEnd);
    default:
      return false;
  }
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Everything buildCommittedOutflows needs to turn signed commitments into
 * dated outflow. Pure input — no storage, no network.
 */
export interface CommittedOutflowInput {
  /** Signed subcontracts and POs. Draft ones are skipped, matching
   *  computeJobCost's own filter. */
  commitments: Commitment[];
  /** Projects, for the schedule that dates each commitment's draw. */
  projects: Project[];
  /** The GC's hand-entered expense rows. Only read to find rows that CLAIM a
   *  commitment, which suppresses that commitment's derived row. */
  expenses: CashFlowExpense[];
  /** Injectable clock so the guard can pin the week arithmetic. */
  now?: Date;
}

export interface CommittedOutflows {
  /** Derived expense rows, ready to concat onto the GC's own list before
   *  calling generateForecast. */
  scheduled: CashFlowExpense[];
  /** Committed balance we could NOT honestly put on a week — the job carries no
   *  schedule, or it is finished and the balance is a record nobody closed out.
   *  Deliberately absent from the weekly runway and surfaced beside it, the way
   *  retention is. */
  undated: number;
  /** Commitments behind `undated`, so the screen can name them. */
  undatedCommitmentIds: string[];
  /** Commitments that produced nothing because a hand-entered expense claims
   *  them. */
  suppressedCommitmentIds: string[];
  /** Hand-entered rows in a commitment-shaped category (subcontractor /
   *  materials) that name no commitment, so we cannot tell whether they are a
   *  second copy of money now being pulled in automatically. Counted and
   *  shown, never silently removed. */
  ambiguousManualCount: number;
  /** The ids of exactly those rows. The count alone tells the GC a duplicate
   *  may exist without telling him WHERE, which leaves him deleting rows at
   *  random on a solvency screen; the screen marks these rows in place. */
  ambiguousManualIds: string[];
}

/**
 * Drop rows this engine generated, keeping only what the GC typed.
 *
 * Derived rows are a VIEW of the live commitments, recomputed on every
 * forecast. If one ever reached storage it would be counted twice from then on
 * — once as the frozen copy on disk and again as the commitment it came from —
 * and it would keep the amount it had the day it was written, so paying the sub
 * down would not shrink it. utils/cashFlowStorage.ts runs this on both the read
 * and the write path, which also cleans up any row a previous build left
 * behind.
 */
export function stripDerivedExpenses(expenses: CashFlowExpense[]): CashFlowExpense[] {
  return expenses.filter(e => !e.derived);
}

/**
 * The last calendar day the project's schedule still has work on, or null when
 * the schedule cannot date itself.
 *
 * CALENDAR day derived from WORKING days: `totalDurationDays` counts working
 * days, so it goes through utils/scheduleEngine.addWorkingDays — the same
 * function the Gantt draws with, including the project's own non-working
 * dates. Treating a 60-working-day schedule as 60 calendar days would pull
 * roughly three weeks of subcontract draw forward into weeks the crew will not
 * have worked, on the one screen where being early with an outflow is the
 * cheap error and being late is the expensive one.
 */
function scheduleFinishDay(project: Project): Date | null {
  const schedule = project.schedule;
  if (!schedule) return null;
  const start = parseCalendarDay(schedule.startDate);
  if (!start) return null;
  const duration = Number.isFinite(schedule.totalDurationDays)
    ? Math.floor(schedule.totalDurationDays)
    : 0;
  if (duration <= 0) return null;
  const perWeek = Number.isFinite(schedule.workingDaysPerWeek) && schedule.workingDaysPerWeek > 0
    ? schedule.workingDaysPerWeek
    : 5;
  const finish = addWorkingDays(start, duration - 1, perWeek, schedule.nonWorkingDates);
  finish.setHours(0, 0, 0, 0);
  return finish;
}

/**
 * Turn signed commitments into the outflow rows the forecast was missing.
 *
 * THE DEFECT THIS CLOSES (audit 2026-09-07, do-next #12b). The income side of
 * this screen is fully automatic — invoices and expected payments flow in on
 * their own — while the expense side counted ONLY rows the GC typed by hand.
 * Signed subcontracts and POs, the largest committed outflow a GC has, never
 * appeared at all. Automatic on the money coming in and manual on the money
 * going out biases every forecast toward solvency, which is the exact
 * direction that hurts on the one screen whose job is "can I make payroll on
 * Friday" — and the bias propagated, because the morning brief
 * (hooks/useMorningBrief.ts) and the AI fact blocks (utils/oneMind/
 * factBlocks.ts) read this same projection.
 *
 * THE MONEY. `commitmentUnpaid` comes from utils/jobCostEngine.ts rather than
 * being re-derived here, so "what have I still got to pay this sub" has ONE
 * definition in the app: signed amount + approved CO revisions − the paid
 * rollup. Snapped material receipts are NOT netted out of it — that helper's
 * doc gives the full reason, but the short of it is that a receipt is a
 * supplier invoice rather than a payment, nothing in generateForecast spends
 * it, and receipts never leave the device that snapped them.
 *
 * HOW A DUPLICATE IS PREVENTED, exactly. There are three doors and each is
 * shut deliberately:
 *
 *   1. A hand-entered row that carries `commitmentId` claims that commitment,
 *      and the commitment then generates nothing. The match is on ID and
 *      nothing else — never on a name, an amount or a category, because a
 *      fuzzy match that fires wrongly DELETES real outflow from a solvency
 *      screen, which is worse than the double count it was trying to avoid.
 *   2. Derived rows are regenerated from the commitments on every forecast and
 *      are never written back into `mage_cashflow_data` (app/cash-flow.tsx
 *      concatenates them at forecast time and persists only
 *      `cashFlowData.expenses`), so they cannot accumulate on disk, and
 *      re-running this builder over its own output adds nothing.
 *   3. `commitmentUnpaid` nets the paid rollup, so a draw already sent is not
 *      forecast again. It does NOT net snapped receipts: there is no third
 *      count to remove, because generateForecast never spends a receipt.
 *
 * The door that CANNOT be shut from here is a legacy hand-typed row that is
 * the same money as a commitment but names no id — the GC's "Framing sub —
 * Miller Bros, $12,000/mo" typed before commitments existed. Guessing at those
 * would be door 1's fuzzy match by another name, so they are counted as typed
 * and returned in `ambiguousManualIds` for the screen to mark in place.
 *
 * TIMING. A commitment carries `signedDate` and no payment dates at all, so
 * the draw is spread evenly across the project's remaining schedule — a
 * subcontract is billed as the work proceeds, and the schedule is the only
 * real signal in the app for when that work happens. Where there is no such
 * signal the money is NOT given an invented date: it goes to `undated` and is
 * reported beside the runway, following the same rule this file already applies
 * to retention — a forecast that names a date it cannot know is worse than one
 * that admits the money is not scheduled yet. Two cases reach `undated`:
 *
 *   • The project carries no usable schedule.
 *
 *   • The job is OVER — the project is completed/closed, or the commitment
 *     itself is closed. `paidToDate` is only maintained by the server trigger
 *     on sub-submitted invoices, so a sub paid by check outside the portal
 *     leaves a full balance sitting on a finished contract forever. Dating that
 *     balance to week 0 put the whole of every historic subcontract into THIS
 *     week, on every open of the screen, for the rest of the account's life —
 *     a permanent false Danger that teaches the GC to ignore the one screen he
 *     must not ignore. It is still real money if he genuinely never paid it, so
 *     it is reported rather than dropped.
 */
export function buildCommittedOutflows({
  commitments, projects, expenses, now = new Date(),
}: CommittedOutflowInput): CommittedOutflows {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();

  const claimed = new Set(
    expenses
      .filter(e => !e.derived && typeof e.commitmentId === 'string' && e.commitmentId.length > 0)
      .map(e => e.commitmentId as string),
  );
  const ambiguousManualIds = expenses
    .filter(e => !e.derived && !e.commitmentId && (e.category === 'subcontractor' || e.category === 'materials'))
    .map(e => e.id);

  const projectById = new Map(projects.map(p => [p.id, p]));

  const scheduled: CashFlowExpense[] = [];
  const undatedCommitmentIds: string[] = [];
  const suppressedCommitmentIds: string[] = [];
  let undated = 0;

  for (const c of commitments) {
    // A draft is not signed, so nothing is owed on it yet. Same filter
    // computeJobCost uses.
    if (c.status === 'draft') continue;
    if (claimed.has(c.id)) {
      suppressedCommitmentIds.push(c.id);
      continue;
    }

    const remaining = commitmentUnpaid(c);
    if (remaining <= 0) continue;

    const project = projectById.get(c.projectId);
    // A finished job's leftover balance is a record nobody closed out, not a
    // payment due in some particular week — see the `undated` note above for
    // why dating it to week 0 made the screen cry wolf permanently.
    const jobIsOver = c.status === 'closed'
      || project?.status === 'completed' || project?.status === 'closed';
    const finish = project && !jobIsOver ? scheduleFinishDay(project) : null;
    if (!finish) {
      undated += remaining;
      undatedCommitmentIds.push(c.id);
      continue;
    }

    const who = c.vendorName?.trim() || c.description?.trim() || 'Committed work';
    const name = `${who} · ${c.number} (committed)`;
    // A subcontract is labour, a PO is material. The category only drives the
    // expense-list grouping and colour, never the arithmetic.
    const category: ExpenseCategory = c.type === 'purchase_order' ? 'materials' : 'subcontractor';

    if (finish.getTime() <= todayMs) {
      // The schedule says this job should already be finished, so whatever is
      // left on the contract is due now rather than on some future week. Week
      // 0 is the conservative read on a solvency screen — the same clamp
      // generateForecast makes for an overdue receivable, pointed the other
      // way.
      scheduled.push({
        id: `committed-${c.id}`,
        name,
        amount: remaining,
        frequency: 'one_time',
        category,
        startDate: today.toISOString(),
        commitmentId: c.id,
        derived: true,
      });
      continue;
    }

    // Whole forecast weeks the draw window still covers. generateForecast's
    // week w runs from midnight on today+7w, so a weekly row fires in weeks
    // 0..floor(daysOut / 7) — dividing by exactly that count makes the spread
    // sum back to `remaining` over the window instead of over- or
    // under-spending it. Math.round on the day difference absorbs the hour a
    // DST boundary adds or removes between two midnights.
    const daysOut = Math.round((finish.getTime() - todayMs) / MS_PER_DAY);
    const weeksRemaining = Math.max(1, Math.floor(daysOut / 7) + 1);
    const endOfFinishDay = new Date(finish);
    endOfFinishDay.setHours(23, 59, 59, 999);

    scheduled.push({
      id: `committed-${c.id}`,
      name,
      amount: remaining / weeksRemaining,
      frequency: 'weekly',
      category,
      startDate: today.toISOString(),
      // An instant, not a bare calendar day: shouldExpenseOccurInWeek compares
      // it against week boundaries with `new Date(...)`, and a 'YYYY-MM-DD'
      // string parses as UTC midnight, which is the previous evening anywhere
      // west of Greenwich — it would drop the last week of the draw.
      endDate: endOfFinishDay.toISOString(),
      commitmentId: c.id,
      derived: true,
    });
  }

  return {
    scheduled, undated, undatedCommitmentIds, suppressedCommitmentIds,
    ambiguousManualCount: ambiguousManualIds.length, ambiguousManualIds,
  };
}

export function generateForecast(
  startingBalance: number,
  expenses: CashFlowExpense[],
  invoices: Invoice[],
  expectedPayments: ExpectedPayment[],
  weeksToForecast: number,
  defaultPaymentTerms: string = 'net_30',
  changeOrders: ChangeOrder[] = []
): CashFlowWeek[] {
  console.log('[CashFlowEngine] Generating forecast for', weeksToForecast, 'weeks (COs:', changeOrders.length, ')');
  const weeks: CashFlowWeek[] = [];
  let balance = startingBalance;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let w = 0; w < weeksToForecast; w++) {
    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() + w * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    // END of day 6, not its midnight. isDateInWeek tests `d <= weekEnd`, and
    // weekStart is midnight-aligned, so without this every instant after
    // 00:00:00.000 on the last day of a week belonged to NO week at all.
    //
    // Invoice dates carry a real time-of-day — app/invoice.tsx:354 stores
    // `issueDate: now` as a full ISO timestamp and generateForecast preserves
    // it through `expectedDate.setDate(+termsDays)` — so roughly one receivable
    // in seven fell through the gap and never appeared in the runway at all.
    // Not late, not in a later week: absent. Verified with a $76,780 invoice
    // landing on a week's last day, which forecast $0.
    weekEnd.setHours(23, 59, 59, 999);

    const incomeItems: CashFlowWeek['incomeItems'] = [];
    const expenseItems: CashFlowWeek['expenseItems'] = [];

    invoices.forEach(inv => {
      // Use the effective status so an overdue-but-unpaid invoice still forecasts
      // at its original expected date (and a silently paid-in-full one is excluded).
      const effStatus = getEffectiveInvoiceStatus(inv);
      if (effStatus === 'paid' || effStatus === 'draft') return;
      const termsDays = getPaymentTermsDays(inv.paymentTerms ?? defaultPaymentTerms);
      const issueDate = new Date(inv.issueDate);
      const expectedDate = new Date(issueDate);
      expectedDate.setDate(expectedDate.getDate() + termsDays);
      // RETENTION IS NOT COLLECTIBLE ON TERMS. `totalDue` is the GROSS figure —
      // it includes the retention the contract holds back until closeout — so
      // `totalDue - amountPaid` forecast that held-back money as cash arriving
      // on net-30. On a $500k job at 10% retention that is $50k of money the
      // client is contractually NOT going to send, landing in the forecast
      // weeks or months before it exists.
      //
      // This screen's whole job is the danger-week / can-I-make-payroll call,
      // and it feeds the morning brief and the AI fact blocks as well, so the
      // overstatement propagated into "you're fine this week" advice.
      //
      // netBalanceDue() is the SAME function the Stripe pay link and the
      // in-app "Generate Payment Link" button use, so the forecast now projects
      // exactly what the client is actually being asked to pay. Pending
      // retention is reported separately via pendingRetention() — omitted from
      // the weekly runway rather than guessed at, because nothing here knows
      // the closeout date, and a forecast that names a date it cannot know is
      // worse than one that admits the money is not scheduled yet.
      const remaining = netBalanceDue(inv);
      // AN OVERDUE INVOICE'S EXPECTED DATE IS IN THE PAST, and every forecast
      // week runs from today forward — so it matched no week and contributed
      // ZERO. The 'hopeful' confidence branch below, written specifically for
      // effStatus === 'overdue', was unreachable, and the money most at risk was
      // the money the forecast could not see. (The comment above claims overdue
      // invoices "still forecast at their original expected date"; that date is
      // outside the window, so the code could never do what it said.)
      //
      // Clamping to today puts them in week 0 — you are chasing that cash now —
      // while keeping the lower 'hopeful' confidence they already carry.
      const forecastDate = expectedDate < today ? today : expectedDate;
      if (remaining > 0 && isDateInWeek(forecastDate.toISOString(), weekStart, weekEnd)) {
        const confidence =
          effStatus === 'overdue' ? 'hopeful' :
          effStatus === 'partially_paid' ? 'expected' :
          effStatus === 'sent' ? 'expected' : 'hopeful';
        incomeItems.push({
          description: `Invoice #${inv.number} (${inv.projectId?.slice(0, 8) ?? 'N/A'})`,
          amount: remaining,
          confidence,
        });
      }
    });

    // NOTE: Approved change orders are intentionally NOT projected as income
    // here. In normal GC practice an approved CO is billed through a progress
    // invoice, so its dollars already appear in that invoice's totalDue and
    // are captured by the invoice loop above. Projecting the standalone
    // approved-CO line too would double-count the same money.
    // Pending / submitted COs are NOT yet invoiced, so they remain a
    // legitimate 'hopeful' projection here.
    changeOrders.forEach(co => {
      if (co.status === 'submitted' || co.status === 'under_review') {
        const projectedApproval = new Date(today);
        projectedApproval.setDate(projectedApproval.getDate() + 21);
        const expectedDate = new Date(projectedApproval);
        expectedDate.setDate(expectedDate.getDate() + getPaymentTermsDays(defaultPaymentTerms));
        if (co.changeAmount > 0 && isDateInWeek(expectedDate.toISOString(), weekStart, weekEnd)) {
          incomeItems.push({
            description: `Change Order #${co.number} (pending)`,
            amount: co.changeAmount,
            confidence: 'hopeful',
          });
        }
      }
    });

    expectedPayments.forEach(ep => {
      if (isDateInWeek(ep.expectedDate, weekStart, weekEnd)) {
        incomeItems.push({
          description: ep.description,
          amount: ep.amount,
          confidence: ep.confidence,
        });
      }
    });

    expenses.forEach(exp => {
      if (shouldExpenseOccurInWeek(exp, weekStart, weekEnd, w)) {
        // Guard non-finite amounts (legacy/imported rows): an unguarded NaN
        // poisons the running balance and every subsequent week, producing a
        // false "Healthy / $0" verdict that hides real danger weeks.
        const amount = Number.isFinite(exp.amount) ? exp.amount : 0;
        expenseItems.push({
          description: exp.name,
          amount,
          category: exp.category,
        });
      }
    });

    const totalIncome = incomeItems.reduce((s, i) => s + (Number.isFinite(i.amount) ? i.amount : 0), 0);
    const totalExpenses = expenseItems.reduce((s, e) => s + (Number.isFinite(e.amount) ? e.amount : 0), 0);
    const netCashFlow = totalIncome - totalExpenses;
    balance += netCashFlow;

    weeks.push({
      weekStart: weekStart.toISOString().split('T')[0],
      weekEnd: weekEnd.toISOString().split('T')[0],
      incomeItems,
      expenseItems,
      totalIncome,
      totalExpenses,
      netCashFlow,
      runningBalance: balance,
    });
  }

  console.log('[CashFlowEngine] Forecast generated:', weeks.length, 'weeks');
  return weeks;
}

/**
 * Retention dollars billed but contractually held back, across open invoices.
 *
 * This money is real and the GC will eventually get it — it is simply not on
 * the payment-terms clock, so it is deliberately absent from generateForecast's
 * weekly runway. Surface it next to the forecast ("plus $X retention held to
 * closeout") so the omission reads as a fact about the contract rather than as
 * money the app lost track of.
 *
 * Excludes draft invoices (nothing is owed yet) and already-released retention.
 */
export function pendingRetention(invoices: Invoice[]): number {
  let total = 0;
  for (const inv of invoices) {
    if (getEffectiveInvoiceStatus(inv) === 'draft') continue;
    // MONEY-05: percentage of work value via the shared helper. Reading the
    // stored column here made "plus $X retention held to closeout" contradict
    // the runway right beside it, which nets the SAME retention out of every
    // receivable through netBalanceDue.
    total += pendingRetentionHeld(inv);
  }
  return total;
}

export function calculateSummary(weeks: CashFlowWeek[]): CashFlowSummary {
  let lowestBalance = Infinity;
  let lowestBalanceWeek = 0;
  let highestBalance = -Infinity;
  let highestBalanceWeek = 0;
  let totalIncome = 0;
  let totalExpenses = 0;
  const dangerWeeks: CashFlowSummary['dangerWeeks'] = [];

  weeks.forEach((w, i) => {
    totalIncome += w.totalIncome;
    totalExpenses += w.totalExpenses;
    if (w.runningBalance < lowestBalance) {
      lowestBalance = w.runningBalance;
      lowestBalanceWeek = i + 1;
    }
    if (w.runningBalance > highestBalance) {
      highestBalance = w.runningBalance;
      highestBalanceWeek = i + 1;
    }
    if (w.runningBalance < 0) {
      dangerWeeks.push({ weekNumber: i + 1, weekDate: w.weekStart, balance: w.runningBalance });
    }
  });

  return {
    totalIncome,
    totalExpenses,
    netCashChange: totalIncome - totalExpenses,
    lowestBalance: lowestBalance === Infinity ? 0 : lowestBalance,
    lowestBalanceWeek,
    highestBalance: highestBalance === -Infinity ? 0 : highestBalance,
    highestBalanceWeek,
    dangerWeeks,
  };
}

export function formatCurrency(n: number): string {
  const abs = Math.abs(n);
  const formatted = abs >= 1000
    ? '$' + abs.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
    : '$' + abs.toFixed(0);
  return n < 0 ? '-' + formatted : formatted;
}

export function formatCurrencyShort(n: number): string {
  const abs = Math.abs(n);
  let formatted: string;
  if (abs >= 1000000) formatted = `$${(abs / 1000000).toFixed(1)}M`;
  else if (abs >= 1000) formatted = `$${(abs / 1000).toFixed(0)}K`;
  else formatted = `$${abs.toFixed(0)}`;
  return n < 0 ? '-' + formatted : formatted;
}
