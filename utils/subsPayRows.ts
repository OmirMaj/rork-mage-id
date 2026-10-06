// ============================================================================
// utils/subsPayRows.ts — the job page's "Subs & pay" rows (W1 UXDOORS, D5).
//
// One row per commitment on the job: who it is with, the contract, what the
// ledger says has been paid, any bill waiting for his review, and the two
// doors — Pay (the sub's portal page, where bills are approved and paid) and
// Get waiver (the lien-waiver form, pre-filled for this sub and commitment).
//
// THE RULE THIS FILE KEEPS: it derives nothing the ledger already knows.
//   contract     jobCostEngine.commitmentValue: the signed amount + its
//                approved CO change (the sum job-costing reads);
//   approved     jobCostEngine.commitmentPaidToDate: the server rollup the
//                sub_submitted_invoices trigger keeps. It counts APPROVED and
//                PAID bills, gross of retainage — NOT cash out the door, so
//                the tile labels it "Approved bills", never "Paid";
//   open bill    bills the sub submitted that nobody has reviewed yet
//                (status 'submitted' — an approved bill is already inside
//                paid to date, so counting it here would count it twice).
// Money comes in as the ledger stores it (dollars) and leaves as integer
// cents; every label prints cents. A bill list that was not read (null) is
// never shown as "no open bill": the open figure is then null and the row
// simply does not mention it.
//
// Pure: no React, no storage, no network. scripts/validate-ux-doors.ts drives it.
// ============================================================================

import type { Commitment, Subcontractor, SubSubmittedInvoice } from '@/types';
import { formatMoney } from '@/utils/formatters';
import { commitmentPaidToDate, commitmentValue } from '@/utils/jobCostEngine';
import { lienWaiverForCommitmentHref, subPortalSetupHref } from '@/utils/uxRoutes';

type CommitmentLike = Pick<Commitment, 'id' | 'projectId' | 'number' | 'type' | 'subcontractorId' | 'vendorName' | 'description' | 'amount'>
  & Partial<Pick<Commitment, 'changeAmount' | 'paidToDate' | 'status'>>;
type SubLike = Pick<Subcontractor, 'id' | 'companyName'> & Partial<Pick<Subcontractor, 'email'>>;
type SubBillLike = Pick<SubSubmittedInvoice, 'status' | 'amount'> & Partial<Pick<SubSubmittedInvoice, 'commitmentId' | 'projectId'>>;

/** Integer cents from a stored dollar figure; anything non-finite is 0. */
export function dollarsToCents(n: number | null | undefined): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) : 0;
}

/** A money moment's label: always dollars AND cents ("$4,500.00"). */
export function centsLabel(cents: number): string {
  return formatMoney(cents / 100, 2);
}

export interface SubsPayRow {
  commitmentId: string;
  /** "SC-01 · Electrical rough + trim" (number · description), may be ''. */
  detail: string;
  /** The roster sub's company name, else the commitment's vendor name, else
   *  SUB_NOT_NAMED (the row still shows: its number and description say which). */
  name: string;
  /** 'Subcontract' or 'Purchase Order'. */
  kindLabel: string;
  contractCents: number;
  /** Approved and paid bills (the ledger's paidToDate), gross of retainage. */
  paidCents: number;
  /** Bills awaiting his review; null when the bills were not read. */
  openBillCents: number | null;
  /** The roster sub, when the commitment names one on file. */
  subId: string | null;
  /** Pay: the sub's portal page on this job. Null when the commitment names
   *  no roster sub (a vendor typed by name has no portal page to open). */
  payHref: ReturnType<typeof subPortalSetupHref> | null;
  /** Why Pay is not offered, when it is not. */
  payBlockedReason: string | null;
  /** Get waiver: the lien-waiver form pre-filled for this sub + commitment.
   *  Null when the commitment names nobody (a waiver needs a name on it). */
  waiverHref: ReturnType<typeof lienWaiverForCommitmentHref> | null;
}

export const PAY_NEEDS_ROSTER_SUB = 'Add this sub to your Subs list to pay through the sub portal.';
/** A commitment with no roster sub and no vendor name: shown, never dropped. */
export const SUB_NOT_NAMED = 'Sub Not Named';
export const NAME_THE_SUB = 'Name the sub on this commitment to pay it or get a waiver.';

/**
 * The rows for ONE job, in the order the commitments came (the context keeps
 * them in their saved order). A commitment on another job is left out. One
 * with no name at all (no roster sub, no vendor) still shows — a tile that
 * says "no subs" while commitments exist would be false — as SUB_NOT_NAMED,
 * with no Pay and no waiver door (a waiver needs a name) and NAME_THE_SUB.
 */
export function subsPayRows(input: {
  projectId: string;
  commitments: readonly CommitmentLike[];
  subs: readonly SubLike[];
  /** This job's sub bills, or null when they were not read. */
  subBills: readonly SubBillLike[] | null;
}): SubsPayRow[] {
  const { projectId } = input;
  const out: SubsPayRow[] = [];
  for (const c of input.commitments) {
    if (c.projectId !== projectId) continue;
    const sub = c.subcontractorId ? input.subs.find(s => s.id === c.subcontractorId) : undefined;
    const named = (sub?.companyName ?? c.vendorName ?? '').trim();
    // The ledger's own helpers read only amount / changeAmount / paidToDate,
    // which CommitmentLike carries.
    const contractCents = dollarsToCents(commitmentValue(c as Commitment));
    const paidCents = dollarsToCents(commitmentPaidToDate(c as Commitment));
    const openBillCents = input.subBills == null
      ? null
      : input.subBills
        .filter(b => b.commitmentId === c.id && b.status === 'submitted')
        .reduce((sum, b) => sum + Math.max(0, dollarsToCents(b.amount)), 0);
    const subId = sub?.id ?? null;
    out.push({
      commitmentId: c.id,
      detail: [c.number, (c.description ?? '').trim()].filter(Boolean).join(' · '),
      name: named || SUB_NOT_NAMED,
      kindLabel: c.type === 'purchase_order' ? 'Purchase Order' : 'Subcontract',
      contractCents,
      paidCents,
      openBillCents,
      subId,
      payHref: subId && named ? subPortalSetupHref(projectId, subId) : null,
      payBlockedReason: !named ? NAME_THE_SUB : subId ? null : PAY_NEEDS_ROSTER_SUB,
      waiverHref: named
        ? lienWaiverForCommitmentHref({
          projectId,
          subName: named,
          commitmentId: c.id,
          subCompanyId: subId,
          subEmail: sub?.email ?? null,
        })
        : null,
    });
  }
  return out;
}

/** The empty line and its one action (VOICE: what this is, plus one action). */
export const SUBS_PAY_EMPTY = { title: 'No Subs on This Project Yet', action: 'Add a Sub' } as const;
