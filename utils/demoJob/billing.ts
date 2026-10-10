// utils/demoJob/billing.ts — pay applications and invoices for the Demo Job (pure).
//
// Billing READS THE SCHEDULE. A schedule-of-values line is as complete as the
// schedule tasks that build it (schedule.ts `divs`) were at the end of the
// period, so "work completed to date" on application 9 and the schedule's
// percent complete are the same story told twice. Totals come from the app's
// own utils/aiaBilling.computeAIATotals, never from arithmetic of this file.
import type { Invoice, InvoiceLineItem, SavedAIAPayApp, SavedAIAPayAppLine } from '@/types';
import { computeAIATotals } from '@/utils/aiaBilling';
import { retainageOnWorkValue, roundCents } from '@/utils/invoiceBilling';
import type { DemoClock } from './clock';
import {
  CHANGE_ORDERS, ORIGINAL_CONTRACT_SUM, PAID_PAY_APPS, PAY_APP_COUNT, PAY_APP_ISSUED_AFTER, PAY_APP_PAID_AFTER,
  PAY_APP_PERIOD_END, RETAINAGE_PERCENT, SOV, approvedCosBy, scheduledValue,
} from './money';
import { TASK_SPECS, currentPlan, progressOn, schedulePercentOn } from './schedule';
import { DEMO_PROJECT_NAME } from './marker';
import { JOB } from './world';

/** Percent complete (0 to 100) of one CSI division at the end of working day `day`. */
export function divisionPercentOn(div: string, day: number): number {
  // General conditions are spent with time: they follow the whole job.
  if (div === '01') return schedulePercentOn(day);
  const plan = currentPlan();
  let total = 0;
  let earned = 0;
  for (const s of TASK_SPECS) {
    if (!s.divs.includes(div)) continue;
    const p = plan.get(s.key)!;
    total += p.days;
    earned += (p.days * progressOn(p, day)) / 100;
  }
  return total > 0 ? (earned / total) * 100 : 0;
}

const wholeDollars = (n: number): number => Math.round(n);

interface LineAt { key: string; itemNo: string; description: string; scheduled: number; completed: number; taskKey?: string }

/** Every schedule-of-values line as it stands at the end of working day `day`. */
export function sovAt(day: number): LineAt[] {
  const base: LineAt[] = SOV.map((l, i) => {
    const sv = scheduledValue(l);
    return { key: `div:${l.div}`, itemNo: String(i + 1), description: l.label, scheduled: sv, completed: wholeDollars((sv * divisionPercentOn(l.div, day)) / 100) };
  });
  const plan = currentPlan();
  const cos: LineAt[] = approvedCosBy(day).map((c) => {
    const p = c.task ? plan.get(c.task) : undefined;
    const pct = p ? progressOn(p, day) : 0;
    return { key: `co:${c.n}`, itemNo: `CO ${c.n}`, description: `Change Order ${c.n}: ${c.title}`, scheduled: c.amount, completed: wholeDollars((c.amount * pct) / 100), ...(c.task ? { taskKey: c.task } : {}) };
  });
  return [...base, ...cos];
}

export interface DemoBilling { payApps: SavedAIAPayApp[]; invoices: Invoice[] }

export function buildBilling(id: (key: string) => string, clock: DemoClock, contractorName: string): DemoBilling {
  const payApps: SavedAIAPayApp[] = [];
  const invoices: Invoice[] = [];
  let prevCompleted = new Map<string, number>();
  let prevEarnedLessRetainage = 0;
  for (let k = 1; k <= PAY_APP_COUNT; k += 1) {
    const end = PAY_APP_PERIOD_END[k - 1];
    const issuedDay = end + PAY_APP_ISSUED_AFTER;
    const at = sovAt(end);
    const lines: SavedAIAPayAppLine[] = at.map((l) => {
      const before = prevCompleted.get(l.key) ?? 0;
      return {
        id: id(`pa:${k}:${l.key}`),
        itemNo: l.itemNo,
        description: l.description,
        scheduledValue: l.scheduled,
        fromPreviousApp: before,
        thisPeriod: roundCents(l.completed - before),
        materialsPresentlyStored: 0,
        retainagePercent: RETAINAGE_PERCENT,
        ...(l.taskKey ? { linkedTaskId: id(`task:${l.taskKey}`) } : {}),
      };
    });
    const netChange = approvedCosBy(end).reduce((s, c) => s + c.amount, 0);
    const header = {
      applicationNumber: k,
      applicationDate: clock.at(issuedDay, 10),
      periodTo: clock.at(end, 17),
      contractDate: clock.at(-9, 9),
      ownerName: JOB.owner,
      contractorName,
      architectName: JOB.architect,
      projectName: DEMO_PROJECT_NAME,
      projectLocation: JOB.address,
      contractForDescription: JOB.contractFor,
      originalContractSum: ORIGINAL_CONTRACT_SUM,
      netChangeByCO: netChange,
      contractSumToDate: ORIGINAL_CONTRACT_SUM + netChange,
      retainagePercent: RETAINAGE_PERCENT,
      lessPreviousCertificates: prevEarnedLessRetainage,
      lines,
    };
    const t = computeAIATotals(header);
    const paid = k <= PAID_PAY_APPS;
    const paidDay = end + PAY_APP_PAID_AFTER;
    const invoiceId = id(`invoice:${k}`);
    const workThisPeriod = roundCents(lines.reduce((s, l) => s + l.thisPeriod, 0));
    const held = retainageOnWorkValue(workThisPeriod, RETAINAGE_PERCENT);
    payApps.push({
      id: id(`payapp:${k}`),
      projectId: id('project'),
      invoiceId,
      ...header,
      notes: 'Made-up demo application. Typed by the contractor. Not certified by an architect and not sent to anyone.',
      totals: {
        totalScheduledValue: t.totalScheduledValue,
        totalCompletedAndStored: t.totalCompletedAndStored,
        totalRetainage: t.totalRetainage,
        totalEarnedLessRetainage: t.totalEarnedLessRetainage,
        currentPaymentDue: t.currentPaymentDue,
        balanceToFinish: t.balanceToFinish,
        percentComplete: t.percentComplete,
      },
      ...(paid ? { paidAt: clock.at(paidDay, 14) } : {}),
      createdAt: clock.at(issuedDay, 10),
      updatedAt: clock.at(paid ? paidDay : issuedDay, 14),
      savedAt: clock.at(issuedDay, 10),
    });
    const items: InvoiceLineItem[] = lines.filter((l) => l.thisPeriod !== 0).map((l) => ({
      id: id(`invoice:${k}:${l.id}`),
      name: l.description,
      description: `Work this period, pay application ${k}`,
      quantity: 1,
      unit: 'LS',
      unitPrice: l.thisPeriod,
      total: l.thisPeriod,
    }));
    const issue = clock.at(issuedDay, 10);
    const due = new Date(new Date(issue).getTime() + 30 * 86_400_000).toISOString();
    invoices.push({
      id: invoiceId,
      number: k,
      projectId: id('project'),
      type: 'progress',
      progressPercent: Math.round(t.percentComplete * 10) / 10,
      issueDate: issue,
      dueDate: due,
      paymentTerms: 'net_30',
      notes: `Pay application ${k}. Made-up demo invoice: it is never sent, and no reminder or pay link is made for it.`,
      lineItems: items,
      subtotal: workThisPeriod,
      taxRate: 0,
      taxAmount: 0,
      totalDue: workThisPeriod,
      amountPaid: paid ? t.currentPaymentDue : 0,
      status: paid ? 'paid' : 'sent',
      payments: paid
        ? [{ id: id(`payment:${k}`), date: clock.at(paidDay, 14), amount: t.currentPaymentDue, method: 'ach', reference: `Demo payment ${k}, recorded by the contractor` }]
        : [],
      retentionPercent: RETAINAGE_PERCENT,
      retentionAmount: held,
      billToName: JOB.owner,
      createdAt: issue,
      updatedAt: clock.at(paid ? paidDay : issuedDay, 14),
    });
    prevCompleted = new Map(at.map((l) => [l.key, l.completed] as const));
    prevEarnedLessRetainage = t.totalEarnedLessRetainage;
  }
  return { payApps, invoices };
}

export { CHANGE_ORDERS };
