// insuranceAuditPack.ts — the workers' comp premium-audit pack.
//
// Every year the GC's workers' comp carrier audits him. The auditor asks one
// question about every sub he paid: "show me a WC certificate that covered the
// day you paid them" — money paid to a sub with no certificate is charged back
// as if the sub's crew were the GC's own payroll. The GC has the payments (sub
// portal invoices, bills he recorded against a subcontract) and the
// certificates (the COI vault) in MAGE already; this module lines them up.
//
// WHAT IT STATES, AND WHAT IT NEVER STATES. It reports what the records show,
// payment by payment: a certificate of that type spans the payment date, or it
// does not, or the records cannot tell. It is not insurance advice. "Can't
// tell" (a certificate with no dates, AI-read dates nobody confirmed, a payment
// with no usable date) is its own figure — never folded into "covered" and
// never into "not covered". Workers' comp exemptions are not tracked in MAGE,
// and every output says so (EXEMPTION_NOTE).
//
// MONEY IS INTEGER CENTS end to end. Dollar floats from the records are
// converted ONCE, at the edge (toCents), and every sum after that is integer
// arithmetic.
//
// DATES ARE CALENDAR DAYS. A payment date and a certificate's effective /
// expiry are compared as 'YYYY-MM-DD' strings (their first ten characters), so
// a receipt stamped at 11:58 pm local and a certificate stored as a full ISO
// instant compare on the day the paper says — never through a timezone.
//
// Pure logic: no React, no React Native, no I/O. The one impure import is
// transitive — utils/coiFiles (hasUnconfirmedAi, the vault's own "is this row
// still only what the AI read?" test) also carries the storage client, so
// scripts/validate-insurance-audit.ts stubs '@/lib/supabase' before loading it,
// the same way validate-w5-coi-subs-coverage does.

import type {
  CertificateOfInsurance, COICoverage, Commitment, MaterialReceipt, Subcontractor, SubSubmittedInvoice,
  CompanyBranding,
} from '@/types';
import { paymentDateOf, cashPaidOf } from '@/utils/tax1099Export';
import { hasUnconfirmedAi } from '@/utils/coiFiles';
import { csvCell } from '@/utils/punchExportCore';
import { formatCalendarDay } from '@/utils/calendarDate';
import { escHtml, pdfShell, pdfTitle, pdfTable, pdfStatGrid, pdfSectionHeader } from '@/utils/pdfDesign';

// ─── Constants ─────────────────────────────────────────────────────────────

export const AUDIT_COVERAGE_TYPES = ['workers_comp', 'general_liability'] as const;
export type AuditCoverageType = (typeof AUDIT_COVERAGE_TYPES)[number];

export const COVERAGE_TYPE_LABEL: Record<AuditCoverageType, string> = {
  workers_comp: "Workers' comp",
  general_liability: 'General liability',
};

/** Fixed note — on the screen, in the CSV and in the PDF. */
export const EXEMPTION_NOTE =
  "Workers' comp exemptions (e.g. a sole proprietor with no employees) are not tracked in MAGE — a sub marked not covered may hold an exemption certificate. Confirm with your carrier or auditor.";

/** What MAGE reads as a sub payment — the same two sources the 1099 export
 *  reads (utils/tax1099Export COVERAGE_NOTE_WITH_RECORDED_BILLS). */
export const AUDIT_SOURCES_NOTE =
  'Reads sub-portal invoices marked paid and bills you recorded against a subcontract. A check, ACH or cash payment with no record in MAGE is not here.';

export const PORTAL_LOAD_FAILED_PREFIX =
  "Portal payments couldn't be loaded — totals below leave them out.";

export const EXPORT_BLOCKED_PORTAL =
  "Export needs the sub-portal payments. Reconnect and tap Retry — without them the file would leave out every payment made through the portal.";

export const EMPTY_HEADLINE = 'No dated sub payments recorded in this period';

/** The row note for a payment whose project is unknown. */
export const PROJECT_UNKNOWN_NOTE =
  'project unknown — only certificates not tied to one job were checked';

/** The row note for a GC-recorded bill dated by when it was entered. */
export const DATE_RECORDED_NOTE = 'date recorded, not payment date';
/** The same for a portal invoice that only carries its submission stamp. */
export const DATE_SUBMITTED_NOTE = 'date submitted, not payment date';

// ─── Types ─────────────────────────────────────────────────────────────────

export type CoverageStatus =
  /** A certificate of that type, with confirmed dates, spans the payment date. */
  | 'covered'
  /** Certificates of that type exist, and none spans the date. */
  | 'not_covered'
  /** No certificate of that type for this sub (that could apply to this job). */
  | 'no_certificate'
  /** A certificate of that type exists but lacks the date(s) to tell. */
  | 'dates_missing'
  /** The only spanning coverage has AI-read dates the GC has not confirmed. */
  | 'unconfirmed'
  /** The payment itself has no usable date — nothing can be tested. */
  | 'undated';

export const STATUS_LABEL: Record<CoverageStatus, string> = {
  covered: 'Certificate spans this date',
  not_covered: 'Not covered on this date',
  no_certificate: 'No certificate on file',
  dates_missing: 'Certificate is missing dates',
  unconfirmed: 'AI-read dates, not yet confirmed',
  undated: "Payment date unknown — can't be tested",
};

/** A GC-recorded sub payment with its project and the basis of its date. */
export interface AuditGcPayment {
  subcontractorId: string;
  /** Gross dollars on the bill (converted to cents in buildInsuranceAudit). */
  amount: number;
  date?: string;
  reference?: string;
  projectId?: string;
  /** 'receipt' = the date printed on the bill; 'created' = when it was entered. */
  dateSource: 'receipt' | 'created';
}

export interface AuditPayment {
  key: string;
  subcontractorId: string;
  amountCents: number;
  /** Calendar day, or null when the record has no usable date. */
  payDay: string | null;
  source: 'portal' | 'recorded';
  reference?: string;
  projectId?: string;
  /** Row notes: the date basis, a project-unknown caveat. */
  notes: string[];
  status: Record<AuditCoverageType, CoverageStatus>;
  /** The certificates of that type that were tested, described for the row. */
  certificates: Record<AuditCoverageType, string>;
}

export interface AuditSubRow {
  subcontractorId: string;
  name: string;
  phone?: string;
  email?: string;
  payments: AuditPayment[];
  paidCents: number;
  /** WC not_covered + no_certificate, in cents. */
  uncoveredWcCents: number;
  /** Payments whose WC status asks for a new certificate (not_covered,
   *  no_certificate, dates_missing) — what requestMessageFor quotes. */
  needsCertificate: AuditPayment[];
  /** Commitment.paidToDate across this sub's commitments — undated, never tested. */
  undatedCommitmentCents: number;
  /** "Also recorded, no dates" note, or null. */
  commitmentNote: string | null;
}

export type StatusTotals = Record<CoverageStatus, number>;

export interface InsuranceAudit {
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  portalLoaded: boolean;
  /** Dated payments in the period, in cents. */
  paidTotalCents: number;
  /** Distinct subs with a dated payment in the period. */
  paidSubCount: number;
  byStatus: Record<AuditCoverageType, StatusTotals>;
  /** $Y — WC not_covered + no_certificate, cents. */
  uncoveredWcCents: number;
  /** K — distinct subs among $Y. */
  subsWithUncovered: number;
  /** $Z — WC dates_missing + unconfirmed + undated, cents. */
  cantTellWcCents: number;
  /** Undated payments (listed separately; may fall outside the period). */
  undatedPayments: AuditPayment[];
  subs: AuditSubRow[];
  headline: string;
  /** Null when export may run; otherwise the reason the button is disabled. */
  exportBlockedReason: string | null;
}

// ─── Money + date helpers ──────────────────────────────────────────────────

/** Dollars → integer cents, ONCE, at the edge. Non-finite / negative → 0. */
export function toCents(dollars: number | null | undefined): number {
  const n = typeof dollars === 'number' ? dollars : Number(dollars);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

/** '$1,234.50' / '$412,000' from integer cents. `always2` forces the cents. */
export function formatCents(cents: number, always2 = false): string {
  const c = Math.max(0, Math.round(cents));
  const dollars = Math.floor(c / 100);
  const rem = c % 100;
  const whole = dollars.toLocaleString('en-US');
  return rem === 0 && !always2 ? `$${whole}` : `$${whole}.${String(rem).padStart(2, '0')}`;
}

/** '1234.50' — a CSV amount: two decimals, no separators, from integer cents. */
export function csvAmount(cents: number): string {
  const c = Math.max(0, Math.round(cents));
  return `${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The calendar day of a date or an instant: its first ten characters, when
 *  they are a real 'YYYY-MM-DD'. Anything else is missing. */
export function calendarDayOfValue(v: string | null | undefined): string | null {
  if (!v || typeof v !== 'string') return null;
  const d = v.trim().slice(0, 10);
  if (!DAY_RE.test(d)) return null;
  const [y, m, dd] = d.split('-').map(Number);
  const probe = new Date(y, m - 1, dd);
  if (probe.getFullYear() !== y || probe.getMonth() !== m - 1 || probe.getDate() !== dd) return null;
  return d;
}

function dayLabel(day: string): string {
  return formatCalendarDay(day, { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── Payment sources ───────────────────────────────────────────────────────

/**
 * GC-recorded sub payments for the audit. The SAME filter and field choices as
 * utils/tax1099Export gcRecordedSubPaymentsFromReceipts — receipt names a
 * commitment, that commitment is a subcontract naming a sub, amount is the
 * receipt total (max 0), date is receiptDate else createdAt, reference is the
 * document number else vendor else the commitment number — PLUS the two things
 * an audit needs that the 1099 export does not: the commitment's project (a
 * project-scoped certificate only covers its own job) and which date it is.
 * scripts/validate-insurance-audit.ts proves the parity on sub / amount / date.
 */
export function auditGcPaymentsFromReceipts(
  receipts: readonly MaterialReceipt[],
  commitments: readonly Commitment[],
): AuditGcPayment[] {
  const byId = new Map(commitments.map(c => [c.id, c]));
  const out: AuditGcPayment[] = [];
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
      projectId: c.projectId || undefined,
      dateSource: r.receiptDate ? 'receipt' : 'created',
    });
  }
  return out;
}

// ─── Coverage test ─────────────────────────────────────────────────────────

interface Candidate { coi: CertificateOfInsurance; cov: COICoverage }

function describeCoverage(cov: COICoverage): string {
  const unconfirmed = hasUnconfirmedAi(cov);
  const eff = calendarDayOfValue(cov.effectiveDate) ?? (unconfirmed ? calendarDayOfValue(cov.aiEffectiveDate) : null);
  const exp = calendarDayOfValue(cov.expiresAt) ?? (unconfirmed ? calendarDayOfValue(cov.aiExpiresAt) : null);
  const parts = [
    cov.carrierName?.trim() || 'carrier not recorded',
    cov.policyNumber?.trim() ? `policy ${cov.policyNumber.trim()}` : 'no policy number',
    `${eff ?? 'no effective date'} to ${exp ?? 'no expiry date'}`,
  ];
  return parts.join(', ') + (unconfirmed ? ' (AI-read, unconfirmed)' : '');
}

/**
 * The certificates of `type` that can speak for this payment. A COI tied to a
 * project counts only for a payment on that same project; a payment whose
 * project is UNKNOWN is tested against unscoped certificates only — a
 * project-scoped certificate never makes it covered.
 */
function candidatesFor(
  cois: readonly CertificateOfInsurance[],
  subId: string,
  projectId: string | undefined,
  type: AuditCoverageType,
): Candidate[] {
  const out: Candidate[] = [];
  for (const coi of cois) {
    if (coi.subcontractorId !== subId) continue;
    if (coi.projectId && coi.projectId !== projectId) continue;
    for (const cov of coi.coverages ?? []) if (cov.type === type) out.push({ coi, cov });
  }
  return out;
}

/**
 * One payment against one coverage type. Order of the verdict:
 *   covered       — a confirmed coverage whose effective ≤ day ≤ expiry;
 *   unconfirmed   — none confirmed, but an AI-read span covers the day;
 *   dates_missing — a coverage lacks a date and nothing it DOES carry rules
 *                   the day out (an effective date after the day, or an expiry
 *                   before it, rules it out whatever the other field says);
 *   not_covered   — certificates of the type exist and every one is ruled out;
 *   no_certificate— none of the type could apply.
 */
export function coverageStatusFor(
  payDay: string | null,
  candidates: readonly Candidate[],
): CoverageStatus {
  if (!payDay) return 'undated';
  if (candidates.length === 0) return 'no_certificate';
  let unconfirmedSpan = false;
  let missing = false;
  for (const { cov } of candidates) {
    const ai = hasUnconfirmedAi(cov);
    const eff = calendarDayOfValue(cov.effectiveDate) ?? (ai ? calendarDayOfValue(cov.aiEffectiveDate) : null);
    const exp = calendarDayOfValue(cov.expiresAt) ?? (ai ? calendarDayOfValue(cov.aiExpiresAt) : null);
    if ((eff && payDay < eff) || (exp && payDay > exp)) continue; // ruled out
    if (!eff || !exp) { missing = true; continue; }
    // eff <= payDay <= exp
    if (ai) unconfirmedSpan = true;
    else return 'covered';
  }
  if (unconfirmedSpan) return 'unconfirmed';
  if (missing) return 'dates_missing';
  return 'not_covered';
}

// ─── The pack ──────────────────────────────────────────────────────────────

export interface InsuranceAuditInput {
  periodStart: string;
  periodEnd: string;
  /** Optional label for the headline; defaults to 'Mon D, YYYY–Mon D, YYYY'. */
  periodLabel?: string;
  subs: readonly Subcontractor[];
  /** null = the portal read FAILED (not an empty list). */
  portalInvoices: readonly SubSubmittedInvoice[] | null;
  gcRecordedPayments: readonly AuditGcPayment[];
  cois: readonly CertificateOfInsurance[];
  commitments: readonly Commitment[];
}

const EMPTY_TOTALS = (): StatusTotals => ({
  covered: 0, not_covered: 0, no_certificate: 0, dates_missing: 0, unconfirmed: 0, undated: 0,
});

export function defaultPeriodLabel(start: string, end: string): string {
  return `${dayLabel(start)}–${dayLabel(end)}`;
}

export function buildInsuranceAudit(input: InsuranceAuditInput): InsuranceAudit {
  const periodStart = calendarDayOfValue(input.periodStart) ?? input.periodStart;
  const periodEnd = calendarDayOfValue(input.periodEnd) ?? input.periodEnd;
  const periodLabel = input.periodLabel ?? defaultPeriodLabel(periodStart, periodEnd);
  const portalLoaded = input.portalInvoices !== null;
  const inPeriod = (day: string) => day >= periodStart && day <= periodEnd;

  // 1. Every payment, in cents, with its calendar day.
  type Raw = Omit<AuditPayment, 'status' | 'certificates'>;
  const raw: Raw[] = [];
  const submitterName = new Map<string, string>();
  for (const inv of input.portalInvoices ?? []) {
    if (inv.status !== 'paid' || !inv.subcontractorId) continue;
    const date = paymentDateOf(inv);
    const notes: string[] = [];
    if (!inv.paidOn && !inv.paidAt && !inv.reviewedAt && inv.createdAt) notes.push(DATE_SUBMITTED_NOTE);
    const name = inv.submittedByName?.trim();
    if (name && !submitterName.has(inv.subcontractorId)) submitterName.set(inv.subcontractorId, name);
    const cents = toCents(cashPaidOf(inv));
    if (cents <= 0) continue;
    raw.push({
      key: `portal:${inv.id}`,
      subcontractorId: inv.subcontractorId,
      amountCents: cents,
      payDay: calendarDayOfValue(date),
      source: 'portal',
      reference: inv.invoiceNumber || undefined,
      projectId: inv.projectId || undefined,
      notes,
    });
  }
  input.gcRecordedPayments.forEach((p, i) => {
    if (!p.subcontractorId) return;
    const cents = toCents(p.amount);
    if (cents <= 0) return;
    raw.push({
      key: `recorded:${i}:${p.reference ?? ''}`,
      subcontractorId: p.subcontractorId,
      amountCents: cents,
      payDay: calendarDayOfValue(p.date),
      source: 'recorded',
      reference: p.reference,
      projectId: p.projectId,
      notes: p.dateSource === 'created' ? [DATE_RECORDED_NOTE] : [],
    });
  });

  // 2. In the period (dated) or undated (listed apart; may belong to any year).
  const scoped = raw.filter(p => (p.payDay ? inPeriod(p.payDay) : true));

  // 3. Test each against the certificates.
  const payments: AuditPayment[] = scoped.map(p => {
    const notes = [...p.notes];
    if (!p.projectId) notes.push(PROJECT_UNKNOWN_NOTE);
    const status = {} as Record<AuditCoverageType, CoverageStatus>;
    const certificates = {} as Record<AuditCoverageType, string>;
    for (const type of AUDIT_COVERAGE_TYPES) {
      const cands = candidatesFor(input.cois, p.subcontractorId, p.projectId, type);
      status[type] = coverageStatusFor(p.payDay, cands);
      certificates[type] = cands.map(c => describeCoverage(c.cov)).join('; ');
    }
    return { ...p, notes, status, certificates };
  });
  payments.sort((a, b) => (a.payDay ?? '9999').localeCompare(b.payDay ?? '9999') || a.key.localeCompare(b.key));

  // 4. Totals — integer cents only.
  const byStatus: Record<AuditCoverageType, StatusTotals> = {
    workers_comp: EMPTY_TOTALS(), general_liability: EMPTY_TOTALS(),
  };
  let paidTotalCents = 0;
  const paidSubs = new Set<string>();
  const uncoveredSubs = new Set<string>();
  for (const p of payments) {
    for (const type of AUDIT_COVERAGE_TYPES) byStatus[type][p.status[type]] += p.amountCents;
    if (p.payDay) { paidTotalCents += p.amountCents; paidSubs.add(p.subcontractorId); }
    if (p.status.workers_comp === 'not_covered' || p.status.workers_comp === 'no_certificate') {
      uncoveredSubs.add(p.subcontractorId);
    }
  }
  const wc = byStatus.workers_comp;
  const uncoveredWcCents = wc.not_covered + wc.no_certificate;
  const cantTellWcCents = wc.dates_missing + wc.unconfirmed + wc.undated;

  // 5. Undated commitment money, per sub — shown, never tested.
  const undatedCommit = new Map<string, number>();
  for (const c of input.commitments) {
    if (!c.subcontractorId) continue;
    const cents = toCents(c.paidToDate);
    if (cents <= 0) continue;
    undatedCommit.set(c.subcontractorId, (undatedCommit.get(c.subcontractorId) ?? 0) + cents);
  }

  // 6. Per-sub rows: every sub with a payment here or undated commitment money.
  const bySub = new Map<string, AuditPayment[]>();
  for (const p of payments) {
    const list = bySub.get(p.subcontractorId) ?? [];
    list.push(p);
    bySub.set(p.subcontractorId, list);
  }
  const ids = new Set<string>([...bySub.keys(), ...undatedCommit.keys()]);
  const roster = new Map(input.subs.map(s => [s.id, s]));
  const subs: AuditSubRow[] = [...ids].map(id => {
    const s = roster.get(id);
    const list = bySub.get(id) ?? [];
    const undated = undatedCommit.get(id) ?? 0;
    const name = s
      ? (s.companyName || s.legalName || s.contactName || 'Subcontractor')
      : submitterName.has(id) ? `${submitterName.get(id)} (deleted from your Subs list)` : `Deleted sub (${id.slice(0, 8)})`;
    return {
      subcontractorId: id,
      name,
      phone: s?.phone?.trim() || undefined,
      email: s?.email?.trim() || undefined,
      payments: list,
      paidCents: list.filter(p => p.payDay).reduce((n, p) => n + p.amountCents, 0),
      uncoveredWcCents: list
        .filter(p => p.status.workers_comp === 'not_covered' || p.status.workers_comp === 'no_certificate')
        .reduce((n, p) => n + p.amountCents, 0),
      needsCertificate: list.filter(p => p.payDay && (
        p.status.workers_comp === 'not_covered' || p.status.workers_comp === 'no_certificate'
        || p.status.workers_comp === 'dates_missing')),
      undatedCommitmentCents: undated,
      commitmentNote: undated > 0
        ? `Commitments also record ${formatCents(undated)} paid to date with no payment dates — not tested against a certificate; confirm against your books.`
        : null,
    };
  });
  subs.sort((a, b) => b.uncoveredWcCents - a.uncoveredWcCents || b.paidCents - a.paidCents || a.name.localeCompare(b.name));

  // 7. The headline — what the records show, nothing more.
  const datedCount = payments.filter(p => p.payDay).length;
  const undatedPayments = payments.filter(p => !p.payDay);
  let headline: string;
  if (datedCount === 0 && undatedPayments.length === 0) {
    headline = `${EMPTY_HEADLINE}. ${AUDIT_SOURCES_NOTE}`;
  } else {
    const n = paidSubs.size;
    const k = uncoveredSubs.size;
    headline = `${periodLabel}: ${formatCents(paidTotalCents)} paid to ${n} sub${n === 1 ? '' : 's'}. `
      + `${formatCents(uncoveredWcCents)} went to ${k} sub${k === 1 ? '' : 's'} with no workers' comp certificate covering the payment date.`
      + (cantTellWcCents > 0
        ? ` ${formatCents(cantTellWcCents)} more can't be checked from the records (missing or unconfirmed dates).`
        : '');
  }
  if (!portalLoaded) headline = `${PORTAL_LOAD_FAILED_PREFIX} ${headline}`;

  return {
    periodStart, periodEnd, periodLabel, portalLoaded,
    paidTotalCents, paidSubCount: paidSubs.size, byStatus,
    uncoveredWcCents, subsWithUncovered: uncoveredSubs.size, cantTellWcCents,
    undatedPayments, subs, headline,
    exportBlockedReason: portalLoaded ? null : EXPORT_BLOCKED_PORTAL,
  };
}

// ─── The request message ───────────────────────────────────────────────────

/** A pre-written ask for the certificate. Opened in the share sheet by his tap
 *  and editable before he sends it — never sent from here. */
export function requestMessageFor(
  sub: { name: string },
  uncoveredPayments: readonly Pick<AuditPayment, 'payDay'>[],
  gcName?: string | null,
): string {
  const days = uncoveredPayments.map(p => p.payDay).filter((d): d is string => !!d).sort();
  const range = days.length === 0
    ? 'the dates we paid you'
    : days[0] === days[days.length - 1]
      ? dayLabel(days[0])
      : `${dayLabel(days[0])}–${dayLabel(days[days.length - 1])}`;
  const holder = gcName?.trim() || 'us';
  return `Hi ${sub.name}, our insurance auditor needs your workers' comp certificate covering ${range}. `
    + `Could you have your agent send a current COI naming ${holder} as certificate holder? Thanks.`;
}

// ─── Exports ───────────────────────────────────────────────────────────────

export const AUDIT_CSV_HEADER = [
  'Sub', 'Payment date', 'Amount', 'Source', 'WC status', 'WC certificate (carrier, policy, dates)',
  'GL status', 'GL certificate', 'Notes',
] as const;

function sourceLabel(p: AuditPayment): string {
  const base = p.source === 'portal' ? 'Sub-portal invoice' : 'Bill you recorded';
  return p.reference ? `${base} ${p.reference}` : base;
}

/** One CSV per audit: a row per payment, then the notes. RFC-4180 quoting and
 *  the formula-injection guard come from the house cell (punchExportCore csvCell). */
export function toCsv(audit: InsuranceAudit): string {
  const lines: string[] = [AUDIT_CSV_HEADER.map(h => csvCell(h)).join(',')];
  for (const s of audit.subs) {
    for (const p of s.payments) {
      lines.push([
        s.name,
        p.payDay ?? 'unknown',
        csvAmount(p.amountCents),
        sourceLabel(p),
        STATUS_LABEL[p.status.workers_comp],
        p.certificates.workers_comp,
        STATUS_LABEL[p.status.general_liability],
        p.certificates.general_liability,
        p.notes.join('; '),
      ].map(v => csvCell(v)).join(','));
    }
    if (s.commitmentNote) lines.push([s.name, '', '', '', '', '', '', '', s.commitmentNote].map(v => csvCell(v)).join(','));
  }
  lines.push('');
  lines.push(csvCell(audit.headline));
  lines.push(csvCell(AUDIT_SOURCES_NOTE));
  lines.push(csvCell(EXEMPTION_NOTE));
  return lines.join('\n');
}

/** Printable HTML for the auditor, built on the house PDF design. */
export function toPdfHtml(audit: InsuranceAudit, branding?: CompanyBranding | null, gcName?: string | null): string {
  const rows: string[][] = [];
  for (const s of audit.subs) {
    for (const p of s.payments) {
      rows.push([
        escHtml(s.name),
        escHtml(p.payDay ?? 'unknown'),
        escHtml(csvAmount(p.amountCents)),
        escHtml(sourceLabel(p)),
        escHtml(STATUS_LABEL[p.status.workers_comp]) + (p.certificates.workers_comp ? `<br/><span style="color:#6b7280">${escHtml(p.certificates.workers_comp)}</span>` : ''),
        escHtml(STATUS_LABEL[p.status.general_liability]),
        escHtml(p.notes.join('; ')),
      ]);
    }
  }
  const commitmentNotes = audit.subs.filter(s => s.commitmentNote)
    .map(s => `<p style="margin:0 0 6px">${escHtml(s.name)}: ${escHtml(s.commitmentNote ?? '')}</p>`).join('');
  const body = `
    ${pdfTitle({
      eyebrow: "Workers' comp audit",
      title: 'Sub payments vs. certificates of insurance',
      subtitle: audit.periodLabel,
      meta: gcName ? [{ label: 'Prepared by', value: gcName }] : undefined,
    })}
    <p style="margin:0 0 14px;font-size:13px">${escHtml(audit.headline)}</p>
    ${pdfStatGrid([
      { label: 'Paid in period', value: formatCents(audit.paidTotalCents) },
      { label: 'No WC certificate on the date', value: formatCents(audit.uncoveredWcCents), accent: audit.uncoveredWcCents > 0 ? 'error' : undefined },
      { label: "Can't tell from the records", value: formatCents(audit.cantTellWcCents), accent: audit.cantTellWcCents > 0 ? 'amber' : undefined },
    ])}
    ${pdfSectionHeader('Payments')}
    ${pdfTable([
      { header: 'Sub' }, { header: 'Date' }, { header: 'Amount', align: 'right' }, { header: 'Source' },
      { header: "Workers' comp" }, { header: 'General liability' }, { header: 'Notes' },
    ], rows)}
    ${commitmentNotes}
    <p style="margin:12px 0 6px;font-size:11px">${escHtml(AUDIT_SOURCES_NOTE)}</p>
    <p style="margin:0;font-size:11px">${escHtml(EXEMPTION_NOTE)}</p>
  `;
  // pdfShell only names the document; the branding header is not drawn here.
  return pdfShell({ bodyHtml: body, branding: (branding ?? {}) as CompanyBranding, title: `Insurance audit — ${audit.periodLabel}` });
}
