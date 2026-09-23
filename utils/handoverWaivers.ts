// handoverWaivers — the pure rows behind app/handover.tsx that read money and
// paperwork: "Lien waivers collected", "Final invoice paid" and "Permits & final
// inspection". Pure (no React, no Supabase), pinned by
// scripts/validate-handover-waivers.ts and scripts/validate-w5-closeout-handover.ts.
//
// ── Lien waivers ──────────────────────────────────────────────────────────────
// WHY (audit round 2, #22). Handover put `w.subCompanyId ?? w.subName` into a
// set and then asked it for `c.companyId` (a field Commitment does not have)
// or `c.vendorName` (the company NAME). Every waiver the app itself creates
// stores the sub's ID in subCompanyId — the sub-portal "Collect lien waiver"
// CTA and the invoice prefill in lien-waivers.tsx both do — so no app-made
// waiver could ever mark a commitment covered; only a hand-typed name that
// matched vendorName character for character could. With every sub signed,
// the row still said "3 of 3 subs have a signed waiver" in amber and "Ready to
// hand over" was unreachable.
//
// WHY FINALS ONLY (wave 5, #49). Once the matching worked, ANY signed waiver
// covered its commitment — including a conditional PROGRESS waiver signed with
// pay app #1. A progress waiver releases lien rights only through its
// through-date and only for the amount paid; the sub can still lien for the
// final payment and the retainage. So a job whose subs had each signed one
// conditional_partial read "Signed waiver for every commitment" with a green
// tick and could say "Ready to hand over". Now a commitment is graded:
//   final        a signed / received UNCONDITIONAL final waiver — the only
//                paper that closes the sub's lien rights for good;
//   conditional  its best waiver is a CONDITIONAL final — it takes effect only
//                once the final payment clears, so it is progress, not done;
//   none         partial waivers only, or nothing. A waiver whose type was
//                never saved (waiverType undefined, older rows) counts as NOT
//                final: the row fails closed rather than faking a tick.
// 'done' only when every active commitment is 'final'.
//
// Matching, most exact first:
//   1. w.commitmentId === c.id           (both prefill paths save it) — and a
//      waiver that names a commitment matches nothing else
//   2. w.subCompanyId === c.subcontractorId
//   3. trimmed, case-insensitive w.subName === c.vendorName (hand-typed waivers)

import {
  invoiceOutstanding, invoiceIsSettled, pendingRetentionHeld, roundCents,
  type NetBalanceInput,
} from './invoiceBilling';
import { formatMoney } from './formatters';
import { calendarDayOf, formatCalendarDay, todayCalendarDay } from './calendarDate';

export interface WaiverLike {
  status?: string;
  commitmentId?: string | null;
  subCompanyId?: string | null;
  subName?: string | null;
  /** LienWaiverType — 'conditional_partial' | 'unconditional_partial' |
   *  'conditional_final' | 'unconditional_final'. Optional so an older row
   *  with no type still type-checks; it then counts as a progress waiver. */
  waiverType?: string | null;
}

export interface CommitmentLike {
  id: string;
  status?: string;
  subcontractorId?: string | null;
  vendorName?: string | null;
}

/** A waiver the GC has in hand. 'requested'/'draft'/'void' do not count. */
export function waiverCounts(w: WaiverLike): boolean {
  return w.status === 'signed' || w.status === 'received';
}

const norm = (s: string | null | undefined): string => (s ?? '').trim().toLowerCase();

function waiverMatches(c: CommitmentLike, w: WaiverLike, vendor: string): boolean {
  // A waiver tied to a commitment covers THAT commitment only. A sub with
  // two POs signs one waiver per PO; matching the second on the sub id
  // alone let the first PO's waiver mark both collected.
  if (w.commitmentId) return w.commitmentId === c.id;
  if (w.subCompanyId && c.subcontractorId && w.subCompanyId === c.subcontractorId) return true;
  return !!vendor && norm(w.subName) === vendor;
}

/** Any in-hand waiver (of any type) for this commitment. Kept for callers that
 *  ask "has this sub signed anything"; the handover row uses the grade below. */
export function commitmentHasWaiver(c: CommitmentLike, waivers: readonly WaiverLike[]): boolean {
  const vendor = norm(c.vendorName);
  return waivers.some((w) => waiverCounts(w) && waiverMatches(c, w, vendor));
}

export type CommitmentWaiverGrade = 'final' | 'conditional' | 'none';

export function commitmentWaiverGrade(c: CommitmentLike, waivers: readonly WaiverLike[]): CommitmentWaiverGrade {
  const vendor = norm(c.vendorName);
  let grade: CommitmentWaiverGrade = 'none';
  for (const w of waivers) {
    if (!waiverCounts(w) || !waiverMatches(c, w, vendor)) continue;
    if (w.waiverType === 'unconditional_final') return 'final';
    if (w.waiverType === 'conditional_final') grade = 'conditional';
  }
  return grade;
}

export interface WaiverCoverage {
  /** Non-draft commitments — the ones a final waiver is owed for. */
  total: number;
  /** Of those, how many have a signed / received UNCONDITIONAL final. */
  final: number;
  /** How many have only a CONDITIONAL final (awaiting the final payment). */
  conditional: number;
  /** How many have in-hand waivers, but progress (partial) ones only. */
  progressOnly: number;
  status: 'done' | 'partial' | 'open';
}

export function lienWaiverCoverage(
  commitments: readonly CommitmentLike[],
  waivers: readonly WaiverLike[],
): WaiverCoverage {
  const active = commitments.filter((c) => c.status !== 'draft');
  let final = 0, conditional = 0, progressOnly = 0;
  for (const c of active) {
    const g = commitmentWaiverGrade(c, waivers);
    if (g === 'final') final++;
    else if (g === 'conditional') conditional++;
    else if (commitmentHasWaiver(c, waivers)) progressOnly++;
  }
  const total = active.length;
  const status: WaiverCoverage['status'] =
    total === 0 ? 'open'
    : final === total ? 'done'
    : final + conditional > 0 ? 'partial'
    : 'open';
  return { total, final, conditional, progressOnly, status };
}

/** The row's detail line — kept beside the rule so the words cannot drift from it. */
export function lienWaiverDetail(cov: WaiverCoverage): string {
  if (cov.total === 0) return 'No subcontractor commitments on file. Add commitments to track lien waivers.';
  if (cov.status === 'done') return `Unconditional final waiver from every sub (${cov.total})`;
  const withFinal = cov.final + cov.conditional;
  let s = `${withFinal} of ${cov.total} subs have a final waiver`;
  if (cov.conditional > 0) s += ` (${cov.conditional} conditional, awaiting payment)`;
  if (cov.progressOnly > 0) {
    s += `. ${cov.progressOnly} ${cov.progressOnly === 1 ? 'has' : 'have'} progress waivers only — progress waivers don't cover final payment or retainage`;
  }
  return s;
}

// ── Final invoice (wave 5, #139) ──────────────────────────────────────────────
// The row used to read ONLY the highest-numbered invoice: #5 paid, #4 overdue
// with $18,400 open, and the row went green with "Invoice #5 paid in full". It
// now reads the whole job through utils/invoiceBilling (the one definition of
// outstanding — a hand-rolled totalDue − amountPaid fails
// validate-money-outstanding): 'done' only when there is at least one billed
// invoice, nothing is outstanding, no draft is left unsent and no retention is
// still held. Retention held at handover is 'partial', not 'done' — the
// founder's interim (productDecision #139): the release has to be billed first.

export interface HandoverInvoiceLike extends NetBalanceInput {
  id?: string;
  number: number;
  status: string;
  dueDate?: string | null;
}

export interface InvoiceHandoverState {
  status: 'done' | 'partial' | 'open';
  detail: string;
  /** The invoice the row's CTA should open — the oldest open one, else the
   *  draft to send, else the newest. Undefined with no invoices. */
  targetInvoiceId?: string;
}

const money = (n: number) => formatMoney(roundCents(n), 2);

function isPastDue(inv: HandoverInvoiceLike, today: string): boolean {
  if (inv.status === 'overdue') return true;
  const due = calendarDayOf(inv.dueDate ?? null);
  return !!due && due < today;
}

export function jobInvoiceHandoverState(
  invoices: readonly HandoverInvoiceLike[],
  today: string = todayCalendarDay(),
): InvoiceHandoverState {
  const byNumber = [...invoices].sort((a, b) => Number(a.number ?? 0) - Number(b.number ?? 0));
  if (byNumber.length === 0) {
    return { status: 'open', detail: 'No invoices yet. Issue the final invoice for the remaining balance.' };
  }
  const billed = byNumber.filter((i) => i.status !== 'draft');
  const open = billed.filter((i) => !invoiceIsSettled(i) && invoiceOutstanding(i) > 0);
  if (open.length > 0) {
    const first = open[0];
    const firstAmt = invoiceOutstanding(first);
    const totalCents = open.reduce((s, i) => s + Math.round(invoiceOutstanding(i) * 100), 0);
    let detail = `Invoice #${first.number} has ${money(firstAmt)} open${isPastDue(first, today) ? ' (overdue)' : ''}`;
    if (open.length > 1) detail += ` (+${open.length - 1} more, ${money(totalCents / 100)} total)`;
    return { status: 'partial', detail, targetInvoiceId: first.id };
  }
  const newest = byNumber[byNumber.length - 1];
  if (newest.status === 'draft') {
    return { status: 'open', detail: `Invoice #${newest.number} is still a draft — send it`, targetInvoiceId: newest.id };
  }
  const drafts = byNumber.filter((i) => i.status === 'draft');
  if (drafts.length > 0) {
    // An earlier draft is billing that never went out. It can't be "paid in
    // full" while it sits there; send it or delete it.
    return {
      status: 'partial',
      detail: `Invoice #${drafts[0].number} is still a draft — send it or delete it before handover`,
      targetInvoiceId: drafts[0].id,
    };
  }
  const heldCents = billed.reduce((s, i) => s + Math.round(pendingRetentionHeld(i) * 100), 0);
  if (heldCents > 0) {
    return {
      status: 'partial',
      detail: `All invoices paid — ${money(heldCents / 100)} retention still held; bill the release before handover`,
      targetInvoiceId: newest.id,
    };
  }
  return {
    status: 'done',
    detail: billed.length === 1 ? `Invoice #${billed[0].number} paid in full` : `All ${billed.length} invoices paid in full`,
    targetInvoiceId: newest.id,
  };
}

// ── Permits & final inspection (wave 5, #50) ──────────────────────────────────
// Handover never read a permit: a failed final inspection or a missing
// Certificate of Occupancy still reached "Ready to hand over the keys". The
// rule:
//   open     any permit denied, expired (by status, or an unclosed permit
//            past its expiry day — except an approved time-boxed approval
//            such as hot work, whose window simply ended) or
//            inspection_failed — the detail names them
//   partial  applied / under_review / inspection_scheduled; an approved permit
//            that needs an inspection and has none passed; or a building permit
//            with no approved / passed occupancy permit ("No Certificate of
//            Occupancy logged")
//   done     every permit inspection_passed, or approved for a type that has
//            no inspection (occupancy = the CO itself, and the occupied-building
//            approvals: hot work, shutdown, after-hours, landlord, elevator/dock)
//   none     zero permits on the job — NOT a hard block (paint and cabinet
//            swaps pull no permit); the screen turns it into a manual "No
//            permits required on this job" confirm the GC asserts.

export interface PermitLike {
  type: string;
  status: string;
  expiresDate?: string | null;
}

export interface PermitsHandoverState {
  status: 'done' | 'partial' | 'open' | 'none';
  detail: string;
}

const PERMIT_TYPE_LABELS: Record<string, string> = {
  building: 'Building', electrical: 'Electrical', plumbing: 'Plumbing', mechanical: 'Mechanical',
  demolition: 'Demolition', grading: 'Grading', fire: 'Fire', occupancy: 'Occupancy',
  special_inspection: 'Special inspection', hot_work: 'Hot work', shutdown: 'System shutdown',
  after_hours: 'After-hours work', landlord_approval: 'Landlord approval', elevator_dock: 'Elevator / dock',
  other: 'Other',
};

/** Types whose approval IS the close-out — no inspection follows. */
export const PERMIT_TYPES_WITHOUT_INSPECTION: ReadonlySet<string> = new Set([
  'occupancy', 'hot_work', 'shutdown', 'after_hours', 'landlord_approval', 'elevator_dock',
]);

/**
 * Time-boxed approvals: a hot-work, shutdown, after-hours, landlord or
 * elevator/dock approval covers a work window and lapses by nature once that
 * window closes. PermitStatus has no "closed" state the GC could set, so a
 * lapsed expiry on an APPROVED one of these is the normal end of its life,
 * not a blocker — treating it as one would leave him only the choice of
 * deleting the record or falsifying its date. Occupancy is deliberately NOT
 * here: a lapsed temporary CO is a real blocker to handing over the keys.
 */
const TIME_BOXED_APPROVAL_TYPES: ReadonlySet<string> = new Set(
  [...PERMIT_TYPES_WITHOUT_INSPECTION].filter((t) => t !== 'occupancy'),
);

const OPEN_PERMIT_STATUSES = new Set(['applied', 'under_review', 'approved', 'inspection_scheduled']);

const typeLabel = (t: string) => PERMIT_TYPE_LABELS[t] ?? (t ? t.replace(/_/g, ' ') : 'Permit');

function listed(items: string[]): string {
  if (items.length <= 2) return items.join('; ');
  return `${items.slice(0, 2).join('; ')}; +${items.length - 2} more`;
}

export function permitsHandoverState(permits: readonly PermitLike[], today: string): PermitsHandoverState {
  if (permits.length === 0) {
    return { status: 'none', detail: 'No permits logged on this job.' };
  }
  const blockers: string[] = [];
  const pending: string[] = [];
  for (const p of permits) {
    const label = typeLabel(p.type);
    const expiry = calendarDayOf(p.expiresDate ?? null);
    if (p.status === 'denied') blockers.push(`${label}: denied`);
    else if (p.status === 'expired') blockers.push(`${label}: expired`);
    else if (p.status === 'inspection_failed') blockers.push(`${label}: inspection failed`);
    else if (
      OPEN_PERMIT_STATUSES.has(p.status) && expiry && expiry < today
      && !(p.status === 'approved' && TIME_BOXED_APPROVAL_TYPES.has(p.type))
    ) {
      blockers.push(`${label}: expired ${formatCalendarDay(expiry)}`);
    } else if (p.status === 'applied') pending.push(`${label}: applied`);
    else if (p.status === 'under_review') pending.push(`${label}: under review`);
    else if (p.status === 'inspection_scheduled') pending.push(`${label}: inspection scheduled`);
    else if (p.status === 'approved' && !PERMIT_TYPES_WITHOUT_INSPECTION.has(p.type)) {
      pending.push(`${label}: approved, no inspection passed yet`);
    } else if (p.status !== 'approved' && p.status !== 'inspection_passed') {
      // An unknown status is not a pass.
      pending.push(`${label}: ${p.status.replace(/_/g, ' ')}`);
    }
  }
  if (blockers.length > 0) return { status: 'open', detail: listed(blockers) };
  const hasBuilding = permits.some((p) => p.type === 'building');
  const hasCO = permits.some((p) => p.type === 'occupancy' && (p.status === 'approved' || p.status === 'inspection_passed'));
  if (hasBuilding && !hasCO) pending.push('No Certificate of Occupancy logged');
  if (pending.length > 0) return { status: 'partial', detail: listed(pending) };
  return {
    status: 'done',
    detail: permits.length === 1 ? 'The permit is closed out' : `All ${permits.length} permits closed out`,
  };
}
