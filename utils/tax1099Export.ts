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

import type { Subcontractor, SubSubmittedInvoice, Commitment, MaterialReceipt } from '@/types';

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
 * The same sentence for a caller that PASSES `gcRecordedPayments` to
 * `buildTax1099Dataset`.
 *
 * TWO CONSTANTS, DELIBERATELY (audit 2026-09-11, review round 2). The first
 * cut of this change rewrote `COVERAGE_NOTE` in place to describe GC-recorded
 * bills as counted — while app/tax-1099-export.tsx, the screen that renders it,
 * was left unwired. The live export then told a CPA in writing that it counted
 * bills recorded against a subcontract and, three lines further down, printed
 * "no bills recorded against a subcontract either" for a sub who had them.
 * That is strictly worse than the narrow sentence it replaced, on a deliverable
 * with an IRS deadline.
 *
 * A string may only describe what the caller actually ran. Screens that have
 * not been widened render `COVERAGE_NOTE`; the one that passes the argument
 * renders this. `coverageNoteFor(rows)` below picks between them from the data
 * itself so a future caller cannot get the pairing wrong.
 */
export const COVERAGE_NOTE_WITH_RECORDED_BILLS =
  'Counts sub-portal invoices marked paid plus bills you recorded against a subcontract — a check, ACH or cash payment with no record in MAGE is not in this figure';

/**
 * The coverage sentence that is TRUE of a given dataset. Derived from the rows
 * rather than from what the caller believes it passed, so the note and the
 * numbers cannot disagree.
 */
export function coverageNoteFor(rows: readonly Tax1099Row[]): string {
  return rows.some(r => r.gcRecordedPaid > 0) ? COVERAGE_NOTE_WITH_RECORDED_BILLS : COVERAGE_NOTE;
}

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
  /**
   * The slice of `totalPaid` that came from GC-RECORDED bills rather than from
   * portal invoices (MONEY-1099-GC-1). Counted, because it is dated and
   * attributable — but broken out so the CPA can see which basis produced the
   * figure. Zero on an account that bills entirely through the sub portal.
   */
  gcRecordedPaid: number;
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

// ─────────────────────────────────────────────────────────────────────────────
// GC-RECORDED SUB PAYMENTS (MONEY-1099-GC-1, audit 2026-09-11).
//
// THE DEFECT. `sub_submitted_invoices` is the only source this export counted,
// and it has no GC INSERT path anywhere in the app — the sub creates the row
// from inside a portal he has to log into. In residential and light-commercial
// the framer texts a photo of an invoice and gets a check. For every one of
// those subs this export returned $0 and printed "1099 Required: No" — a Y/N a
// CPA acts on, on a deliverable with an IRS deadline, whose penalty is per
// form. `Commitment.paidToDate` does not rescue it either: that column is
// written ONLY by the server trigger on sub-submitted invoices, so a
// check-paid sub reads $0 there too.
//
// WHAT DOES EXIST. A bill the GC recorded against a SUBCONTRACT commitment
// (app/material-receipt.tsx, widened to accept subcontracts by MONEY-AP-1).
// Unlike `paidToDate` it carries a DATE, which is the whole reason it can be
// counted: `paymentDateOf` exists precisely so money is never assigned to a
// tax year by guessing.
//
// THE BASIS IS DISCLOSED, NOT HIDDEN. The date is the date printed on the
// document, not the date the check cleared, and a recorded bill is not proof
// of payment. That makes this a cash-basis APPROXIMATION, and every row that
// uses it says so. We count it anyway because the alternative is a confident
// "No" on a form the GC is legally required to file: over-disclosing sends the
// CPA to reconcile one number, under-disclosing sends the GC a penalty.
// ─────────────────────────────────────────────────────────────────────────────

/** One GC-recorded payment to a sub: dated, attributable, countable. */
export interface GcRecordedSubPayment {
  subcontractorId: string;
  /** Gross dollars on the bill. */
  amount: number;
  /** Retention withheld on it, if any — netted off like a portal invoice. */
  retentionHeld?: number;
  /** YYYY-MM-DD, or an ISO timestamp. Decides the tax year. */
  date?: string;
  /** For the CPA's audit trail — document number or vendor. */
  reference?: string;
}

/**
 * GC-recorded sub payments derived from material receipts linked to a
 * SUBCONTRACT commitment.
 *
 * Three filters, each load-bearing:
 *  - the receipt must name a commitment (an unlinked receipt is material, not
 *    a sub payment, and counting it would put lumber on a 1099);
 *  - that commitment must be `type: 'subcontract'` (a purchase order is a
 *    supplier — 1099-NEC is for services, and a materials-only vendor is
 *    generally not reportable at all);
 *  - the commitment must name a `subcontractorId`, because a row with no
 *    recipient cannot become a form.
 *
 * The receipt TOTAL is used, not the summed lines: `total` is the document
 * grand total the GC paid, lines are an OCR decomposition of it.
 */
export function gcRecordedSubPaymentsFromReceipts(
  receipts: readonly MaterialReceipt[],
  commitments: readonly Commitment[],
): GcRecordedSubPayment[] {
  const byId = new Map(commitments.map(c => [c.id, c]));
  const out: GcRecordedSubPayment[] = [];
  for (const r of receipts) {
    if (!r.commitmentId) continue;
    const c = byId.get(r.commitmentId);
    if (!c || c.type !== 'subcontract' || !c.subcontractorId) continue;
    const amount = Number.isFinite(r.total) ? Math.max(0, r.total) : 0;
    if (amount <= 0) continue;
    out.push({
      subcontractorId: c.subcontractorId,
      amount,
      date: r.receiptDate || r.createdAt,
      reference: r.documentNumber || r.vendor || c.number,
    });
  }
  return out;
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
  /**
   * Dated payments the GC recorded himself — see MONEY-1099-GC-1 above and
   * `gcRecordedSubPaymentsFromReceipts` for the adapter. OPTIONAL, and an
   * omitted array reproduces the portal-only behaviour exactly, so a caller
   * that has not been widened still compiles and still returns what it did.
   * It also still under-reports by every check the GC wrote, which is the
   * whole finding — omitting this argument is not a neutral choice.
   */
  gcRecordedPayments?: GcRecordedSubPayment[];
}): Tax1099Row[] {
  const { amount: threshold, provisional: thresholdProvisional } = thresholdInfoForYear(opts.year);
  /** Did this run actually consider GC-recorded bills? Drives the wording of
   *  the "nothing this year" note — see below. */
  const countedRecordedBills = opts.gcRecordedPayments !== undefined;
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

  // Map of subcontractorId → totals. `gc` is the slice that came from
  // GC-recorded bills, tracked separately so each row can disclose its basis.
  const totals = new Map<string, { paid: number; count: number; gc: number }>();
  const bump = (subId: string) => {
    const t = totals.get(subId) ?? { paid: 0, count: 0, gc: 0 };
    totals.set(subId, t);
    return t;
  };

  for (const inv of opts.subSubmittedInvoices) {
    if (inv.status !== 'paid') continue;
    if (!inYear(paymentDateOf(inv))) continue;
    const subId = inv.subcontractorId;
    if (!subId) continue;
    const t = bump(subId);
    t.paid += cashPaidOf(inv);
    t.count += 1;
  }

  // GC-recorded payments (MONEY-1099-GC-1). Same year test, same
  // net-of-retention rule — a sub was not paid the money his GC is holding.
  for (const pay of opts.gcRecordedPayments ?? []) {
    if (!pay.subcontractorId) continue;
    if (!inYear(pay.date)) continue;
    const net = Math.max(0, (pay.amount ?? 0) - Math.max(0, pay.retentionHeld ?? 0));
    if (net <= 0) continue;
    const t = bump(pay.subcontractorId);
    t.paid += net;
    t.gc += net;
    t.count += 1;
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
    const t = totals.get(sub.id) ?? { paid: 0, count: 0, gc: 0 };
    const paid = Math.round(t.paid * 100) / 100;
    const gcRecordedPaid = Math.round(t.gc * 100) / 100;
    const required = paid >= threshold;
    const uncountedCommitmentPaid = Math.round((undated.get(sub.id) ?? 0) * 100) / 100;
    const notes: string[] = [];
    if (required && !sub.taxIdLast4) notes.push('TIN missing — collect from W-9');
    if (required && !sub.address) notes.push('Address missing — required on 1099');
    if (!sub.w9OnFile) notes.push('W-9 not on file');
    if (!required && paid > 0) notes.push(`Below ${fmt(threshold)} (${opts.year} threshold, ${THRESHOLD_CITATION}) — 1099 not required but disclosed`);
    // "No payments this year" was the line eleven subs got while the GC paid
    // every one of them by check. It now names the source it is speaking for.
    // Only claim to have looked where we actually looked. `gcRecordedPayments`
    // absent means no caller handed us GC-recorded bills, so "and no bills
    // recorded against a subcontract either" would be an assertion about a
    // population this run never saw.
    if (paid <= 0) {
      notes.push(countedRecordedBills
        ? `No sub-portal payments recorded in ${opts.year}, and no bills recorded against a subcontract either`
        : `No sub-portal payments recorded in ${opts.year}`);
    }
    if (gcRecordedPaid > 0) {
      notes.push(
        `${fmt(gcRecordedPaid)} of this total is bills you recorded against a subcontract; the tax year comes from the DATE ON THE DOCUMENT, not from when the check cleared — confirm any bill near a year end`,
      );
    }
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
      gcRecordedPaid,
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
  // THE HEADER DESCRIBES THE DATA, NOT THE FEATURE. It names GC-recorded bills
  // only when the rows actually contain some; on an export built without
  // `gcRecordedPayments` — which is every caller until app/tax-1099-export.tsx
  // is widened — it reads exactly as it always did. A column heading that
  // misnames its own population is how a CPA gets misled, and the first cut of
  // this change did precisely that: it renamed the column for an engine no
  // screen was calling.
  const countsRecordedBills = rows.some(r => r.gcRecordedPaid > 0);
  const header = [
    'Sub ID', 'Recipient Name', 'TIN (last 4)', 'Address',
    countsRecordedBills
      ? 'Total Paid (portal invoices + bills you recorded, net of retention held)'
      : 'Total Paid (sub-portal invoices, net of retention held)',
    'Payment Count', '1099 Required', 'Threshold Applied', 'W-9 On File', 'Notes',
    'Commitment Paid To Date (undated — NOT counted)',
    // APPENDED, like the column before it — every existing position is
    // untouched, because column ORDER is the contract with the CPA's importer.
    'Of which: bills you recorded (document date basis)',
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
      r.gcRecordedPaid > 0 ? r.gcRecordedPaid.toFixed(2) : '',
    ].map(csvCell).join(','));
  }
  return lines.join('\n');
}
