import type { Invoice, ChangeOrder } from '@/types';
import { getEffectiveInvoiceStatus } from '@/utils/projectFinancials';

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
  incomeItems: Array<{ description: string; amount: number; confidence: string }>;
  expenseItems: Array<{ description: string; amount: number; category: string }>;
  totalIncome: number;
  totalExpenses: number;
  netCashFlow: number;
  runningBalance: number;
}

export interface CashFlowSummary {
  totalIncome: number;
  totalExpenses: number;
  netProfit: number;
  lowestBalance: number;
  lowestBalanceWeek: number;
  highestBalance: number;
  highestBalanceWeek: number;
  dangerWeeks: Array<{ weekNumber: number; weekDate: string; balance: number }>;
}

/**
 * Effective current cash position = stored starting balance + any invoice
 * payments recorded since the balance was last set. Lets the GC set the balance
 * once ("my bank shows $42k today"), then record payments as checks come in
 * without manually re-typing the balance each time.
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
    for (const r of inv.retentionReleases ?? []) {
      const ts = new Date(r.date).getTime();
      if (!Number.isNaN(ts) && ts > cutoff) {
        additional += r.amount ?? 0;
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
    case 'biweekly':
      return weekIndex % 2 === 0;
    case 'monthly': {
      for (let d = new Date(weekStart); d <= weekEnd; d.setDate(d.getDate() + 1)) {
        if (d.getDate() === 1 || d.getDate() === 15) return true;
      }
      return false;
    }
    case 'one_time':
      return isDateInWeek(expense.startDate, weekStart, weekEnd);
    default:
      return false;
  }
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
      const remaining = inv.totalDue - inv.amountPaid;
      if (remaining > 0 && isDateInWeek(expectedDate.toISOString(), weekStart, weekEnd)) {
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

    // Approved change orders that haven't been invoiced yet show as projected
    // future income. Timing: approval date (updatedAt) + payment terms.
    // Pending / submitted COs show with 'hopeful' confidence at a conservative
    // date — today + 21 days (typical approval delay) + payment terms.
    changeOrders.forEach(co => {
      if (co.status === 'approved') {
        const approvedAt = new Date(co.updatedAt);
        const expectedDate = new Date(approvedAt);
        expectedDate.setDate(expectedDate.getDate() + getPaymentTermsDays(defaultPaymentTerms));
        // Only project future CO cash — past expected dates are assumed to have
        // rolled into invoices already (invoice loop will capture them).
        if (expectedDate < today) return;
        if (co.changeAmount > 0 && isDateInWeek(expectedDate.toISOString(), weekStart, weekEnd)) {
          incomeItems.push({
            description: `Change Order #${co.number} (approved)`,
            amount: co.changeAmount,
            confidence: 'expected',
          });
        }
      } else if (co.status === 'submitted' || co.status === 'under_review') {
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
        let amount = exp.amount;
        if (exp.frequency === 'monthly') {
          amount = exp.amount;
        }
        expenseItems.push({
          description: exp.name,
          amount,
          category: exp.category,
        });
      }
    });

    const totalIncome = incomeItems.reduce((s, i) => s + i.amount, 0);
    const totalExpenses = expenseItems.reduce((s, e) => s + e.amount, 0);
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
    netProfit: totalIncome - totalExpenses,
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
