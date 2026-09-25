// utils/logs/invoiceLogRows.ts — the invoice log's cells, filters and footer
// totals (wave 6c, lane G). PURE: scripts/validate-g-logs.ts runs it.
//
// Every money figure comes from the app's own rules, never re-derived here:
// the balance is utils/invoiceBilling.netBalanceDue (net of the retention the
// contract lets the client hold), the status and aging are
// utils/projectFinancials.getEffectiveInvoiceStatus / getDaysPastDue.

import type { Invoice, InvoiceStatus } from '@/types';
import { netBalanceDue } from '@/utils/invoiceBilling';
import { getDaysPastDue, getEffectiveInvoiceStatus } from '@/utils/projectFinancials';
import { dueDateForTerms } from '@/utils/retainage';

/** The status the app shows everywhere (a sent invoice past due reads overdue). */
export function invoiceLogStatus(inv: Invoice): InvoiceStatus {
  return getEffectiveInvoiceStatus(inv);
}

/** 'Current' when not past due, 'n d' when it is; null ('—') for a draft,
 *  which has not started a payment clock. */
export function invoiceAgingLabel(inv: Invoice): string | null {
  if (inv.status === 'draft') return null;
  const d = getDaysPastDue(inv);
  return d > 0 ? `${d}d` : 'Current';
}

/** Sortable aging: null for a draft, else days past due. */
export function invoiceAgingDays(inv: Invoice): number | null {
  if (inv.status === 'draft') return null;
  return getDaysPastDue(inv);
}

export function invoiceBalance(inv: Invoice): number {
  return netBalanceDue(inv);
}

/** 'Synced' / 'Pending' / 'Error'; null when the invoice never met QuickBooks. */
export function invoiceQboLabel(inv: Pick<Invoice, 'qboSyncStatus'>): string | null {
  switch (inv.qboSyncStatus) {
    case 'synced': return 'Synced';
    case 'pending': return 'Pending';
    case 'error': return 'Error';
    default: return null;
  }
}

/** 'Full' or 'Progress · 25%' (the percent only when recorded). */
export function invoiceTypeLabel(inv: Pick<Invoice, 'type' | 'progressPercent'>): string {
  if (inv.type === 'progress') {
    const p = inv.progressPercent;
    return typeof p === 'number' && Number.isFinite(p) ? `Progress · ${p}%` : 'Progress';
  }
  return 'Full';
}

export type InvoiceLogFilter = 'draft' | 'unpaid' | 'overdue' | 'paid' | 'all';

export const INVOICE_LOG_FILTERS: readonly { key: InvoiceLogFilter; label: string }[] = [
  { key: 'draft', label: 'Draft' },
  { key: 'unpaid', label: 'Unpaid' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'paid', label: 'Paid' },
  { key: 'all', label: 'All' },
];

export function invoiceLogFilter(inv: Invoice, filter: InvoiceLogFilter): boolean {
  const s = getEffectiveInvoiceStatus(inv);
  switch (filter) {
    case 'draft': return s === 'draft';
    case 'unpaid': return s === 'sent' || s === 'partially_paid' || s === 'overdue';
    case 'overdue': return s === 'overdue';
    case 'paid': return s === 'paid';
    case 'all': return true;
    default: return true;
  }
}

export function invoiceLogChipCounts(rows: readonly Invoice[]): Record<InvoiceLogFilter, number> {
  const out: Record<InvoiceLogFilter, number> = { draft: 0, unpaid: 0, overdue: 0, paid: 0, all: 0 };
  for (const r of rows) for (const f of INVOICE_LOG_FILTERS) if (invoiceLogFilter(r, f.key)) out[f.key] += 1;
  return out;
}

function cents(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Total billed, paid and open balance over the rows given. */
export function invoiceLogTotals(rows: readonly Invoice[]): { total: number; paid: number; balance: number } {
  let total = 0;
  let paid = 0;
  let balance = 0;
  for (const r of rows) {
    total += Number.isFinite(r.totalDue) ? r.totalDue : 0;
    paid += Number.isFinite(r.amountPaid) ? r.amountPaid : 0;
    balance += netBalanceDue(r);
  }
  return { total: cents(total), paid: cents(paid), balance: cents(balance) };
}

const STATUS_LABEL: Readonly<Record<InvoiceStatus, string>> = {
  draft: 'Draft',
  sent: 'Sent',
  partially_paid: 'Partly paid',
  paid: 'Paid',
  overdue: 'Overdue',
};

export function invoiceStatusLabel(s: InvoiceStatus | null | undefined): string | null {
  return s ? STATUS_LABEL[s] ?? null : null;
}

export function invoiceSearchText(inv: Pick<Invoice, 'number' | 'notes' | 'type'>): string {
  return [`INV-${String(inv.number ?? '').padStart(3, '0')}`, String(inv.number ?? ''), inv.type, inv.notes ?? '']
    .filter((x) => typeof x === 'string' && x.length > 0)
    .join(' ');
}

// ── Bulk "Mark sent" (wave 6d, lane V3) ─────────────────────────────────────
// The log's bulk action writes one invoice at a time through the context's
// updateInvoice (the offline queue), with EXACTLY the patch the invoice
// screen's status pipeline writes for "Mark sent" on a draft (app/invoice.tsx
// onAdvance): status sent, issued today, due today + its terms. It emails
// nobody. scripts/validate-log-bulk.ts runs that handler beside this function
// on the same invoice and clock and requires the same patch.

/** The "Mark sent" patch for a draft; null for anything already out. */
export function markSentPatch(
  inv: Pick<Invoice, 'status' | 'paymentTerms'>,
  nowIso: string,
): Pick<Invoice, 'status' | 'issueDate' | 'dueDate'> | null {
  if (inv.status !== 'draft') return null;
  return { status: 'sent', issueDate: nowIso, dueDate: dueDateForTerms(nowIso, inv.paymentTerms) };
}

export const MARK_SENT_SKIP = {
  sent: 'already sent',
  paid: 'paid',
  sample: 'sample job — sends only reach you',
} as const;

export interface InvoiceBulkMarkSentPlan {
  mark: { id: string; patch: Pick<Invoice, 'status' | 'issueDate' | 'dueDate'> }[];
  skipped: { number: number; reason: string }[];
}

/** Which of the picked invoices "Mark sent" writes, and why the rest are
 *  left alone: anything past draft (paid, or already sent), and a draft on
 *  the sample job. */
export function invoiceBulkMarkSentPlan(
  invs: readonly Invoice[],
  nowIso: string,
  isSample: (projectId: string) => boolean,
): InvoiceBulkMarkSentPlan {
  const out: InvoiceBulkMarkSentPlan = { mark: [], skipped: [] };
  for (const inv of invs) {
    const patch = markSentPatch(inv, nowIso);
    if (!patch) {
      const paid = inv.status === 'paid' || getEffectiveInvoiceStatus(inv) === 'paid';
      out.skipped.push({ number: inv.number, reason: paid ? MARK_SENT_SKIP.paid : MARK_SENT_SKIP.sent });
      continue;
    }
    if (isSample(inv.projectId)) {
      out.skipped.push({ number: inv.number, reason: MARK_SENT_SKIP.sample });
      continue;
    }
    out.mark.push({ id: inv.id, patch });
  }
  return out;
}
