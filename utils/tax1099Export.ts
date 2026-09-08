// 1099-NEC export — year-end summary the CPA will need.
//
// IRS Form 1099-NEC (Non-Employee Compensation) reports payments to subs at or
// above the annual reporting threshold. CPAs typically want a CSV with these
// columns:
//
//   Recipient Name | TIN (last 4) | Address | Payments-this-year |
//   1099 Required (Y/N) | W-9 On File (Y/N) | Notes
//
// We aggregate from sub-submitted invoices (status='paid'). Anything below the
// threshold is included with a flag so the CPA can reconcile against their own
// books.
//
// This isn't a tax-prep tool — it's a "give me one CSV my CPA can read"
// tool. We don't compute TIN matching, we don't file electronically.
//
// WHAT THIS EXPORT DOES NOT COVER — MONEY-1099-COV-1 (audit 2026-09-07,
// "worth doing" #28). The ONLY payment source here is the sub portal, and
// there is no INSERT path for a sub_submitted_invoice anywhere in the GC app —
// the sub creates it from their side. A GC who pays his subs by check gets a
// roster of names all reading "No payments this year" and, believing the Y/N
// column, under-files. The penalty is per form. Until commitment-level payment
// entry exists, the honest thing is to SAY so on every row and to surface what
// the app does know but cannot date: `Commitment.paidToDate` is a running
// server rollup carrying no payment dates, so it can never be attributed to a
// tax year — but "your commitments record $42,000 paid to this sub" is a
// far better thing to hand a CPA than silence. `void opts.commitments` used to
// sit where that read is now.
//
// Audit 2026-09-03 MONEY-F4 fixed three things here:
//   1. THRESHOLD BY YEAR. P.L. 119-21 §70433 (One Big Beautiful Bill Act, July
//      2025) amended IRC §6041(a): for payments made after 12/31/2025 the
//      1099-NEC/MISC threshold is $2,000 (indexed for inflation after 2026);
//      2025 and earlier stay at $600. This file flagged "1099 Required" at
//      $600 for 2026 payments.
//   2. NET OF RETENTION. "Total Paid" counted the gross invoice amount, but
//      retainage the GC is still holding was never paid to the sub. Count
//      amount − retention held, and add retention back when its release is
//      recorded.
//   3. PAYMENT DATE. `paidOn` (the date money left the account) decides the
//      tax year; `paidAt` is only when the GC logged it in MAGE. A check cut
//      12/30 and logged 1/3 belongs to the earlier year.

import type { Subcontractor, SubSubmittedInvoice, Commitment } from '@/types';

export interface ThresholdInfo {
  amount: number;
  /**
   * True when the statute indexes the figure for inflation but the IRS has
   * not published the indexed amount for `year` — the $2,000 floor is applied
   * and the CPA must confirm it before filing.
   */
  provisional: boolean;
}

/** The disclosure that rides with a provisional threshold — screen and CSV alike. */
export const THRESHOLD_PROVISIONAL_NOTE =
  'indexed figure not yet published — $2,000 floor applied; confirm with your CPA';

/**
 * What this export counts, stated on every row (MONEY-1099-COV-1).
 *
 * On EVERY row, not only the $0 ones: a sub who took two portal invoices and
 * four checks has a total that is wrong in the same way, and a "Yes" whose
 * amount is understated still misstates the form. Exported so the screen can
 * print the same sentence the CSV does.
 */
export const COVERAGE_NOTE =
  'Counts sub-portal invoices marked paid — checks, ACH, cash and anything else recorded outside the portal are not in this figure';

/**
 * Annual 1099-NEC reporting threshold for payments made in `year`.
 * P.L. 119-21 §70433 — $2,000 for payments after 12/31/2025, indexed for
 * inflation after 2026. $600 for 2025 and earlier. For 2027 and later the
 * indexed figure has not been published, so the $2,000 statutory floor is
 * returned flagged `provisional` — never silently, because "Y/N" on a 1099 is
 * exactly the column a CPA acts on.
 */
export function thresholdInfoForYear(year: number): ThresholdInfo {
  if (year >= 2027) return { amount: 2000, provisional: true };
  return { amount: year >= 2026 ? 2000 : 600, provisional: false };
}

/** The dollar threshold alone — see thresholdInfoForYear for the provisional flag. */
export function thresholdForYear(year: number): number {
  return thresholdInfoForYear(year).amount;
}

/** Statutory citation for the threshold, for the CSV notes and the screen. */
export const THRESHOLD_CITATION = 'IRC §6041(a) as amended by P.L. 119-21 §70433';

export interface Tax1099Row {
  subcontractorId: string;
  recipientName: string;
  tinLast4: string;
  address: string;
  /** Cash actually paid in the year — net of retention still held. */
  totalPaid: number;
  paymentCount: number;
  /** The threshold applied to this row's year (thresholdForYear). */
  threshold: number;
  /** The threshold is the unindexed $2,000 floor (2027+) — see THRESHOLD_PROVISIONAL_NOTE. */
  thresholdProvisional: boolean;
  required1099: boolean;        // totalPaid >= threshold
  w9OnFile: boolean;
  notes: string;                // e.g. "TIN missing", "address blank", "below $2,000"
  /**
   * Money the app knows was paid to this sub and CANNOT put in a tax year:
   * the sum of `Commitment.paidToDate` across their commitments
   * (MONEY-1099-COV-1). Deliberately NOT added to `totalPaid` and NOT allowed
   * to flip `required1099` — `paidToDate` is a running rollup with no payment
   * dates on it, and dating money by guessing is the exact failure
   * `paymentDateOf` exists to prevent. It is disclosed so the CPA can go look.
   */
  uncountedCommitmentPaid: number;
}

/**
 * The date that decides which tax year a payment belongs to: the day money
 * left the account (`paidOn`), else when the GC recorded it (`paidAt`), else
 * when the GC approved it (`reviewedAt`). `createdAt` is the LAST resort for a
 * legacy paid row carrying none of those stamps — it answers "when was it
 * submitted", not "when was it paid", but dropping the row would understate
 * the sub's total, which is worse for the CPA than a possible year slip.
 */
export function paymentDateOf(inv: Pick<SubSubmittedInvoice, 'paidOn' | 'paidAt' | 'reviewedAt' | 'createdAt'>): string | undefined {
  return inv.paidOn || inv.paidAt || inv.reviewedAt || inv.createdAt || undefined;
}

/**
 * Cash paid to the sub on one invoice: the invoice amount less the retention
 * the GC is still holding.
 *
 * Deliberately NO add-back of released retention. sub_submitted_invoices has
 * no release column, and a release is cash that leaves the account on ITS OWN
 * date: folding it into this row would attribute it to the original invoice's
 * `paidOn` year, so a December invoice whose retainage is released the
 * following March would report the March cash in the earlier year — the exact
 * mis-year MONEY-F4 exists to prevent. When releases are recorded they must
 * enter this export as dated payments of their own, never as a field here; a
 * defensive `retentionReleased` read used to sit in this function and would
 * have done the mis-yearing silently the day such a column appeared.
 */
export function cashPaidOf(inv: Pick<SubSubmittedInvoice, 'amount' | 'retentionAmount'>): number {
  const gross = inv.amount ?? 0;
  const held = Math.max(0, inv.retentionAmount ?? 0);
  return Math.max(0, gross - held);
}

/**
 * Compute totals paid to each subcontractor in the given calendar year from
 * sub-submitted invoices (paid status).
 *
 * `commitments` is read for DISCLOSURE only (MONEY-1099-COV-1): their
 * `paidToDate` rollups carry no payment dates, so they land in
 * `uncountedCommitmentPaid` and a note, never in `totalPaid` and never in the
 * Y/N. Out-of-portal payments (cash / check / Zelle) become countable when
 * they are recorded as DATED payments — see the header.
 */
export function buildTax1099Dataset(opts: {
  year: number;
  subcontractors: Subcontractor[];
  commitments: Commitment[];
  /** Sub-submitted invoices (via the sub portal). Status filter applied here. */
  subSubmittedInvoices: SubSubmittedInvoice[];
}): Tax1099Row[] {
  const { amount: threshold, provisional: thresholdProvisional } = thresholdInfoForYear(opts.year);
  // Calendar-day comparison: `paidOn` is a plain YYYY-MM-DD, so the year is
  // its first four characters — never parse it through the local timezone.
  // Timestamps (paidAt / reviewedAt / createdAt) are compared in local time,
  // which is the GC's own books.
  const yearStart = new Date(opts.year, 0, 1).getTime();
  const yearEnd = new Date(opts.year + 1, 0, 1).getTime();
  const inYear = (iso?: string) => {
    if (!iso) return false;
    const day = /^(\d{4})-\d{2}-\d{2}$/.exec(iso);
    if (day) return Number(day[1]) === opts.year;
    const t = Date.parse(iso);
    return Number.isFinite(t) && t >= yearStart && t < yearEnd;
  };

  // Map of subcontractorId → totals.
  const totals = new Map<string, { paid: number; count: number }>();

  for (const inv of opts.subSubmittedInvoices) {
    if (inv.status !== 'paid') continue;
    if (!inYear(paymentDateOf(inv))) continue;
    const subId = inv.subcontractorId;
    if (!subId) continue;
    const t = totals.get(subId) ?? { paid: 0, count: 0 };
    t.paid += cashPaidOf(inv);
    t.count += 1;
    totals.set(subId, t);
  }

  // What the app knows but cannot date. Keyed by sub so a row can disclose it
  // beside the number the CPA is about to act on. `paidToDate` is maintained
  // server-side across the WHOLE commitment, not per payment and with no dates,
  // so it can never be split into tax years here — see the header.
  const undated = new Map<string, number>();
  for (const c of opts.commitments) {
    const subId = c.subcontractorId;
    if (!subId) continue;
    const paid = Math.max(0, c.paidToDate ?? 0);
    if (paid <= 0) continue;
    undated.set(subId, (undated.get(subId) ?? 0) + paid);
  }

  const fmt = (n: number) => `$${n.toLocaleString('en-US')}`;

  // Build the row set, including subs with $0 in this year so the CPA
  // sees the full roster (helpful for year-over-year comparisons).
  const rows: Tax1099Row[] = [];
  for (const sub of opts.subcontractors) {
    const t = totals.get(sub.id) ?? { paid: 0, count: 0 };
    const paid = Math.round(t.paid * 100) / 100;
    const required = paid >= threshold;
    const uncountedCommitmentPaid = Math.round((undated.get(sub.id) ?? 0) * 100) / 100;
    const notes: string[] = [];
    if (required && !sub.taxIdLast4) notes.push('TIN missing — collect from W-9');
    if (required && !sub.address) notes.push('Address missing — required on 1099');
    if (!sub.w9OnFile) notes.push('W-9 not on file');
    if (!required && paid > 0) notes.push(`Below ${fmt(threshold)} (${opts.year} threshold, ${THRESHOLD_CITATION}) — 1099 not required but disclosed`);
    // "No payments this year" was the line eleven subs got while the GC paid
    // every one of them by check. It now names the source it is speaking for.
    if (paid <= 0) notes.push(`No sub-portal payments recorded in ${opts.year}`);
    if (uncountedCommitmentPaid > 0) {
      notes.push(`Commitments record ${fmt(uncountedCommitmentPaid)} paid to date with no payment dates — not counted above; confirm the year against your books`);
    }
    notes.push(COVERAGE_NOTE);
    rows.push({
      subcontractorId: sub.id,
      recipientName: sub.legalName || sub.companyName || sub.contactName || 'UNKNOWN',
      tinLast4: sub.taxIdLast4 || '',
      address: sub.address ?? '',
      totalPaid: paid,
      paymentCount: t.count,
      threshold,
      thresholdProvisional,
      required1099: required,
      w9OnFile: !!sub.w9OnFile,
      notes: notes.join('; '),
      uncountedCommitmentPaid,
    });
  }
  // Sort by total paid descending so the highest-volume subs sit at top.
  rows.sort((a, b) => b.totalPaid - a.totalPaid);
  return rows;
}

/**
 * CSV serialization for the dataset above. Keep header order stable —
 * downstream automations (CPA's own template, Bench/Pilot importers)
 * may rely on column position. The threshold applied is its own column so
 * the CPA can see which rule produced the Y/N.
 */
export function tax1099DatasetToCsv(rows: Tax1099Row[]): string {
  const csvCell = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  // Column ORDER is the contract (see above); the wording of a header cell is
  // not, and 'Total Paid' alone was silent about the source it summed
  // (MONEY-1099-COV-1). The undated-commitment column is APPENDED so every
  // existing position is untouched.
  const header = [
    'Sub ID', 'Recipient Name', 'TIN (last 4)', 'Address',
    'Total Paid (sub-portal invoices, net of retention held)', 'Payment Count', '1099 Required', 'Threshold Applied', 'W-9 On File', 'Notes',
    'Commitment Paid To Date (undated — NOT counted)',
  ];
  const lines: string[] = [header.map(csvCell).join(',')];
  for (const r of rows) {
    lines.push([
      r.subcontractorId, r.recipientName, r.tinLast4, r.address,
      r.totalPaid.toFixed(2), r.paymentCount, r.required1099 ? 'Yes' : 'No',
      // A provisional threshold says so IN the column the CPA reads the Y/N
      // against, not in a footnote they may never see.
      r.thresholdProvisional
        ? `${r.threshold.toFixed(2)} (provisional: ${THRESHOLD_PROVISIONAL_NOTE})`
        : r.threshold.toFixed(2),
      r.w9OnFile ? 'Yes' : 'No', r.notes,
      r.uncountedCommitmentPaid > 0 ? r.uncountedCommitmentPaid.toFixed(2) : '',
    ].map(csvCell).join(','));
  }
  return lines.join('\n');
}
