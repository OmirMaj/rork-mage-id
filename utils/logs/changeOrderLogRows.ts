// utils/logs/changeOrderLogRows.ts — the change-order log's cells, filters and
// footer totals (wave 6c, lane G). PURE: scripts/validate-g-logs.ts runs it.
//
// Honesty: a CO with no schedule impact recorded has '—' days, not 0; a CO
// nobody was asked to approve has '—' approvals, not "0/0".

import type { ChangeOrder, ChangeOrderStatus } from '@/types';

type CoLike = Pick<ChangeOrder, 'status' | 'changeAmount'>;

/** { approved, required } over the REQUIRED approvers, or null when none. */
export function coApprovals(co: Pick<ChangeOrder, 'approvers'>): { approved: number; required: number } | null {
  const req = (co.approvers ?? []).filter((a) => a && a.required);
  if (req.length === 0) return null;
  return { approved: req.filter((a) => a.status === 'approved').length, required: req.length };
}

/** "x/y", or null ('—'). */
export function coApprovalsLabel(co: Pick<ChangeOrder, 'approvers'>): string | null {
  const a = coApprovals(co);
  return a ? `${a.approved}/${a.required}` : null;
}

/** Schedule impact in days, or null when none was recorded. */
export function coScheduleDays(co: Pick<ChangeOrder, 'scheduleImpactDays'>): number | null {
  const d = co.scheduleImpactDays;
  return typeof d === 'number' && Number.isFinite(d) ? d : null;
}

/** The signed amount, as a number (null when the row carries none). */
export function coSignedAmount(co: Pick<ChangeOrder, 'changeAmount'>): number | null {
  const a = co.changeAmount;
  return typeof a === 'number' && Number.isFinite(a) ? a : null;
}

export type CoLogFilter = 'open' | 'approved' | 'rejected' | 'void' | 'all';

export const CO_LOG_FILTERS: readonly { key: CoLogFilter; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'void', label: 'Void' },
  { key: 'all', label: 'All' },
];

const OPEN: readonly ChangeOrderStatus[] = ['draft', 'submitted', 'under_review', 'revised'];
/** Out for a decision — counted as pending money. Drafts are not: nobody has
 *  been asked to pay them yet. */
const PENDING: readonly ChangeOrderStatus[] = ['submitted', 'under_review', 'revised'];

export function coLogFilter(co: Pick<ChangeOrder, 'status'>, filter: CoLogFilter): boolean {
  switch (filter) {
    case 'open': return OPEN.includes(co.status);
    case 'approved': return co.status === 'approved';
    case 'rejected': return co.status === 'rejected';
    case 'void': return co.status === 'void';
    case 'all': return true;
    default: return true;
  }
}

export function coLogChipCounts(rows: readonly Pick<ChangeOrder, 'status'>[]): Record<CoLogFilter, number> {
  const out: Record<CoLogFilter, number> = { open: 0, approved: 0, rejected: 0, void: 0, all: 0 };
  for (const r of rows) for (const f of CO_LOG_FILTERS) if (coLogFilter(r, f.key)) out[f.key] += 1;
  return out;
}

function cents(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Approved net, pending (submitted / under review / revised) — drafts not
 *  counted. Over the rows given (the log passes the visible filter's rows). */
export function coLogTotals(rows: readonly CoLike[]): { approved: number; pending: number } {
  let approved = 0;
  let pending = 0;
  for (const r of rows) {
    const a = coSignedAmount(r);
    if (a === null) continue;
    if (r.status === 'approved') approved += a;
    else if (PENDING.includes(r.status)) pending += a;
  }
  return { approved: cents(approved), pending: cents(pending) };
}

const STATUS_LABEL: Readonly<Record<ChangeOrderStatus, string>> = {
  draft: 'Draft',
  submitted: 'Submitted',
  under_review: 'Under review',
  approved: 'Approved',
  rejected: 'Rejected',
  revised: 'Revised',
  void: 'Void',
};

export function coStatusLabel(s: ChangeOrderStatus | null | undefined): string | null {
  return s ? STATUS_LABEL[s] ?? null : null;
}

export function coSearchText(co: Pick<ChangeOrder, 'number' | 'description' | 'reason'>): string {
  return [`CO-${String(co.number ?? '').padStart(3, '0')}`, String(co.number ?? ''), co.description, co.reason]
    .filter((x) => typeof x === 'string' && x.length > 0)
    .join(' ');
}
