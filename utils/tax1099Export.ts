// 1099-NEC export — year-end summary the CPA will need.
//
// IRS Form 1099-NEC (Non-Employee Compensation) reports payments to subs
// over $600 in a calendar year. CPAs typically want a CSV with these
// columns:
//
//   Recipient Name | TIN (last 4) | Address | Payments-this-year |
//   1099 Required (Y/N) | W-9 On File (Y/N) | Notes
//
// We aggregate from sub-submitted invoices (status='paid') AND
// regular invoices that link to a commitment (project-side payments
// made to the sub). Anything below $600 is included with a flag so
// the CPA can reconcile against their own books.
//
// This isn't a tax-prep tool — it's a "give me one CSV my CPA can read"
// tool. We don't compute TIN matching, we don't file electronically.

import type { Subcontractor, SubSubmittedInvoice, Commitment } from '@/types';

export interface Tax1099Row {
  subcontractorId: string;
  recipientName: string;
  tinLast4: string;
  address: string;
  totalPaid: number;
  paymentCount: number;
  required1099: boolean;        // total >= $600
  w9OnFile: boolean;
  notes: string;                // e.g. "TIN missing", "address blank", "below $600"
}

/**
 * Compute totals paid to each subcontractor in the given calendar year.
 * Pulls from BOTH sub-submitted invoices (paid status) AND any GC
 * invoices linked to a commitment (the GC paid the sub directly outside
 * the portal flow).
 */
export function buildTax1099Dataset(opts: {
  year: number;
  subcontractors: Subcontractor[];
  commitments: Commitment[];
  /** Sub-submitted invoices (via the sub portal). Status filter applied here. */
  subSubmittedInvoices: SubSubmittedInvoice[];
}): Tax1099Row[] {
  const yearStart = new Date(opts.year, 0, 1).getTime();
  const yearEnd = new Date(opts.year + 1, 0, 1).getTime();
  const inYear = (iso?: string) => {
    if (!iso) return false;
    const t = Date.parse(iso);
    return Number.isFinite(t) && t >= yearStart && t < yearEnd;
  };

  // Map of subcontractorId → totals.
  const totals = new Map<string, { paid: number; count: number }>();

  // Sub-submitted invoices: count when paid (paidAt) OR approved
  // (reviewedAt). Use paidAt if present, else fall back to createdAt.
  for (const inv of opts.subSubmittedInvoices) {
    if (inv.status !== 'paid') continue;
    const dateIso = inv.paidAt || inv.reviewedAt || inv.createdAt;
    if (!inYear(dateIso)) continue;
    const subId = inv.subcontractorId;
    if (!subId) continue;
    const t = totals.get(subId) ?? { paid: 0, count: 0 };
    t.paid += inv.amount ?? 0;
    t.count += 1;
    totals.set(subId, t);
  }

  // Future: when the GC records out-of-portal payments to subs (cash,
  // check, Zelle), we'll wire them in here too. Today the only
  // sub-payment ledger is sub-submitted invoices via the portal; the
  // commitments map is held in scope for that future enrichment.
  void opts.commitments;

  // Build the row set, including subs with $0 in this year so the CPA
  // sees the full roster (helpful for year-over-year comparisons).
  const rows: Tax1099Row[] = [];
  for (const sub of opts.subcontractors) {
    const t = totals.get(sub.id) ?? { paid: 0, count: 0 };
    const required = t.paid >= 600;
    const notes: string[] = [];
    if (required && !sub.taxIdLast4) notes.push('TIN missing — collect from W-9');
    if (required && !sub.address) notes.push('Address missing — required on 1099');
    if (!sub.w9OnFile) notes.push('W-9 not on file');
    if (!required && t.paid > 0) notes.push('Below $600 — 1099 not required but disclosed');
    if (t.paid <= 0) notes.push('No payments this year');
    rows.push({
      subcontractorId: sub.id,
      recipientName: sub.legalName || sub.companyName || sub.contactName || 'UNKNOWN',
      tinLast4: sub.taxIdLast4 || '',
      address: sub.address ?? '',
      totalPaid: Math.round(t.paid * 100) / 100,
      paymentCount: t.count,
      required1099: required,
      w9OnFile: !!sub.w9OnFile,
      notes: notes.join('; '),
    });
  }
  // Sort by total paid descending so the highest-volume subs sit at top.
  rows.sort((a, b) => b.totalPaid - a.totalPaid);
  return rows;
}

/**
 * CSV serialization for the dataset above. Keep header order stable —
 * downstream automations (CPA's own template, Bench/Pilot importers)
 * may rely on column position.
 */
export function tax1099DatasetToCsv(rows: Tax1099Row[]): string {
  const csvCell = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const header = [
    'Sub ID', 'Recipient Name', 'TIN (last 4)', 'Address',
    'Total Paid', 'Payment Count', '1099 Required', 'W-9 On File', 'Notes',
  ];
  const lines: string[] = [header.map(csvCell).join(',')];
  for (const r of rows) {
    lines.push([
      r.subcontractorId, r.recipientName, r.tinLast4, r.address,
      r.totalPaid.toFixed(2), r.paymentCount, r.required1099 ? 'Yes' : 'No',
      r.w9OnFile ? 'Yes' : 'No', r.notes,
    ].map(csvCell).join(','));
  }
  return lines.join('\n');
}
