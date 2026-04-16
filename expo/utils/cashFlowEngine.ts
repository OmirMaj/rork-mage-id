import type { Invoice } from '@/types';

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
  defaultPaymentTerms: string = 'net_30'
): CashFlowWeek[] {
  console.log('[CashFlowEngine] Generating forecast for', weeksToForecast, 'weeks');
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
      if (inv.status === 'paid') return;
      const termsDays = getPaymentTermsDays(inv.paymentTerms ?? defaultPaymentTerms);
      const issueDate = new Date(inv.issueDate);
      const expectedDate = new Date(issueDate);
      expectedDate.setDate(expectedDate.getDate() + termsDays);
      const remaining = inv.totalDue - inv.amountPaid;
      if (remaining > 0 && isDateInWeek(expectedDate.toISOString(), weekStart, weekEnd)) {
        incomeItems.push({
          description: `Invoice #${inv.number} (${inv.projectId?.slice(0, 8) ?? 'N/A'})`,
          amount: remaining,
          confidence: inv.status === 'sent' ? 'expected' : 'hopeful',
        });
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
