// Project financial derivations.
//
// The "contract value" of a project is not a stored field. It's derived every time
// from (a) the base estimate total, plus (b) the sum of all approved change order
// change amounts. Storing it would invite drift between the CO screen, the cash flow
// forecast, the portal snapshot, and anything else that reads it. So this file is the
// single source of truth for anything money-shaped that spans Project + ChangeOrders
// + Invoices.

import type { Project, ChangeOrder, Invoice, InvoiceStatus } from '@/types';

/**
 * Total contract value = base estimate + approved change orders.
 * Unapproved / void / rejected COs do not count.
 */
export function getContractValue(
  project: Project | null | undefined,
  changeOrders: ChangeOrder[] | null | undefined,
): number {
  const base = project?.estimate?.grandTotal ?? 0;
  const coSum = (changeOrders ?? [])
    .filter(co => co.status === 'approved')
    .reduce((sum, co) => sum + (co.changeAmount ?? 0), 0);
  return base + coSum;
}

/**
 * Base estimate before any change orders (useful for showing the "original"
 * contract total next to the "current" one for transparency).
 */
export function getBaseContractValue(project: Project | null | undefined): number {
  return project?.estimate?.grandTotal ?? 0;
}

/**
 * Pending CO value — COs that are submitted but not yet approved or rejected.
 * Useful for "potential upside" callouts in the UI.
 */
export function getPendingChangeOrderValue(
  changeOrders: ChangeOrder[] | null | undefined,
): number {
  return (changeOrders ?? [])
    .filter(co => co.status === 'submitted' || co.status === 'under_review')
    .reduce((sum, co) => sum + (co.changeAmount ?? 0), 0);
}

/**
 * Total already collected from the client (invoices.amountPaid summed).
 * Includes retention releases if they've been recorded as payments.
 */
export function getPaidToDate(invoices: Invoice[] | null | undefined): number {
  return (invoices ?? []).reduce((sum, inv) => sum + (inv.amountPaid ?? 0), 0);
}

/**
 * Total invoiced — what has been billed regardless of payment status.
 * Excludes drafts (which represent work not yet submitted for payment).
 */
export function getInvoicedToDate(invoices: Invoice[] | null | undefined): number {
  return (invoices ?? [])
    .filter(inv => inv.status !== 'draft')
    .reduce((sum, inv) => sum + (inv.totalDue ?? 0), 0);
}

/**
 * Outstanding = invoiced – paid. The amount the GC is waiting on.
 */
export function getOutstandingBalance(invoices: Invoice[] | null | undefined): number {
  const billed = getInvoicedToDate(invoices);
  const paid = getPaidToDate(invoices);
  return Math.max(0, billed - paid);
}

/**
 * Unbilled = contract value – invoiced. Work not yet turned into invoices.
 */
export function getUnbilledValue(
  project: Project | null | undefined,
  changeOrders: ChangeOrder[] | null | undefined,
  invoices: Invoice[] | null | undefined,
): number {
  const contractValue = getContractValue(project, changeOrders);
  const billed = getInvoicedToDate(invoices);
  return Math.max(0, contractValue - billed);
}

/**
 * Effective invoice status — computed rather than stored, because a stored
 * `status = 'sent'` invoice is actually overdue once its due date passes but
 * nobody's running a cron to mutate the record. Use this anywhere you render
 * a status badge so the UI always reflects reality.
 */
export function getEffectiveInvoiceStatus(invoice: Invoice): InvoiceStatus {
  if (invoice.status === 'draft') return 'draft';
  if (invoice.status === 'paid') return 'paid';
  if (invoice.amountPaid >= invoice.totalDue && invoice.totalDue > 0) return 'paid';
  if (invoice.amountPaid > 0 && invoice.amountPaid < invoice.totalDue) return 'partially_paid';

  // Overdue check — 'sent' with a due date in the past.
  if (invoice.status === 'sent' && invoice.dueDate) {
    const dueTs = new Date(invoice.dueDate).getTime();
    if (!Number.isNaN(dueTs) && dueTs < Date.now()) return 'overdue';
  }
  return invoice.status;
}

/**
 * Days past due for an overdue invoice. Returns 0 if not overdue.
 */
export function getDaysPastDue(invoice: Invoice): number {
  const eff = getEffectiveInvoiceStatus(invoice);
  if (eff !== 'overdue') return 0;
  if (!invoice.dueDate) return 0;
  const dueTs = new Date(invoice.dueDate).getTime();
  if (Number.isNaN(dueTs)) return 0;
  const diffMs = Date.now() - dueTs;
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

/**
 * Percent complete by billing — how far through the contract has the GC billed?
 * Used in budget summary widgets and the client portal.
 */
export function getPercentBilled(
  project: Project | null | undefined,
  changeOrders: ChangeOrder[] | null | undefined,
  invoices: Invoice[] | null | undefined,
): number {
  const contractValue = getContractValue(project, changeOrders);
  if (contractValue <= 0) return 0;
  const billed = getInvoicedToDate(invoices);
  return Math.min(100, Math.round((billed / contractValue) * 100));
}

/**
 * Percent complete by cash — how much of the contract has actually been paid?
 */
export function getPercentPaid(
  project: Project | null | undefined,
  changeOrders: ChangeOrder[] | null | undefined,
  invoices: Invoice[] | null | undefined,
): number {
  const contractValue = getContractValue(project, changeOrders);
  if (contractValue <= 0) return 0;
  const paid = getPaidToDate(invoices);
  return Math.min(100, Math.round((paid / contractValue) * 100));
}

/**
 * Compact financial summary the UI layer can destructure.
 */
export interface ProjectFinancialSummary {
  baseContract: number;
  approvedChangeOrderTotal: number;
  pendingChangeOrderTotal: number;
  contractValue: number;
  invoiced: number;
  paidToDate: number;
  outstanding: number;
  unbilled: number;
  pctBilled: number;
  pctPaid: number;
  hasOverdueInvoices: boolean;
  overdueAmount: number;
}

export function summarizeProjectFinancials(
  project: Project | null | undefined,
  changeOrders: ChangeOrder[] | null | undefined,
  invoices: Invoice[] | null | undefined,
): ProjectFinancialSummary {
  const baseContract = getBaseContractValue(project);
  const approvedCO = (changeOrders ?? [])
    .filter(co => co.status === 'approved')
    .reduce((sum, co) => sum + (co.changeAmount ?? 0), 0);
  const pendingCO = getPendingChangeOrderValue(changeOrders);
  const contractValue = baseContract + approvedCO;
  const invoiced = getInvoicedToDate(invoices);
  const paidToDate = getPaidToDate(invoices);
  const outstanding = Math.max(0, invoiced - paidToDate);
  const unbilled = Math.max(0, contractValue - invoiced);

  const overdueInvoices = (invoices ?? []).filter(
    inv => getEffectiveInvoiceStatus(inv) === 'overdue',
  );
  const overdueAmount = overdueInvoices.reduce(
    (sum, inv) => sum + Math.max(0, inv.totalDue - inv.amountPaid),
    0,
  );

  return {
    baseContract,
    approvedChangeOrderTotal: approvedCO,
    pendingChangeOrderTotal: pendingCO,
    contractValue,
    invoiced,
    paidToDate,
    outstanding,
    unbilled,
    pctBilled: contractValue > 0 ? Math.min(100, Math.round((invoiced / contractValue) * 100)) : 0,
    pctPaid: contractValue > 0 ? Math.min(100, Math.round((paidToDate / contractValue) * 100)) : 0,
    hasOverdueInvoices: overdueInvoices.length > 0,
    overdueAmount,
  };
}
