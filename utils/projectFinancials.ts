// Project financial derivations.
//
// The "contract value" of a project is not a stored field. It's derived every time
// from (a) the base estimate total, plus (b) the sum of all approved change order
// change amounts. Storing it would invite drift between the CO screen, the cash flow
// forecast, the portal snapshot, and anything else that reads it. So this file is the
// single source of truth for anything money-shaped that spans Project + ChangeOrders
// + Invoices.

import type { Project, ChangeOrder, Invoice, InvoiceStatus } from '@/types';
import { effectiveEstimateTotal } from '@/utils/estimateCommit';
import { invoiceOutstanding, invoiceIsSettled, pendingRetentionHeld } from '@/utils/invoiceBilling';

/**
 * Total contract value = base estimate + approved change orders.
 * Unapproved / void / rejected COs do not count.
 *
 * THIS IS THE ESTIMATE BASIS, AND IT STILL IS (MONEY-CONTRACT-1, audit
 * 2026-09-11 — stated here rather than left for the next reader to discover).
 * `resolveContractSum` below prefers the SIGNED contract when one exists; this
 * function cannot, because it takes no contract and its two callers —
 * utils/marginRiskScore.ts and utils/livingEstimate.ts — are pure engines that
 * receive no contract from any of their own eleven call sites. Threading one
 * through is the work, and it is not free: `ProjectContract` lives behind
 * `fetchActiveContract`, an async Supabase read, while both engines are
 * synchronous and are called from render.
 *
 * The consequence is bounded and worth stating: both engines measure MARGIN,
 * and a GC who signed BELOW his estimate reads a margin computed against the
 * estimate — optimistic by the difference. Neither figure is printed on a
 * client document, which is where the same defect actually mattered (the
 * portal, fixed; app/change-order.tsx and utils/aiaBilling.ts G702 line 1,
 * still on the estimate and out of this wave's scope). See
 * docs/audits/2026-09-11-handoff-money-to-wip.md.
 */
export function getContractValue(
  project: Project | null | undefined,
  changeOrders: ChangeOrder[] | null | undefined,
): number {
  const base = effectiveEstimateTotal(project);
  const coSum = (changeOrders ?? [])
    .filter(co => co.status === 'approved')
    .reduce((sum, co) => sum + (co.changeAmount ?? 0), 0);
  return base + coSum;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE SIGNED CONTRACT IS THE CONTRACT SUM (MONEY-CONTRACT-1, audit 2026-09-11).
//
// `project_contracts.contract_value` was read by four SCREENS and by no money
// engine. Everything that printed a contract figure printed
// `effectiveEstimateTotal(project)` instead — the estimate.
//
// The two agree until they don't. `buildDraftContract` seeds `contractValue`
// from the estimate, so a contract nobody edited matches; but the contract
// screen exposes that field for editing, and an estimate is the OPENING of a
// negotiation. The moment a GC signs at a number he negotiated, the portal his
// homeowner reads prints the ESTIMATE as "Original Contract" on the same page
// that links them to the executed PDF carrying a different one.
//
// So: prefer the signed contract, fall back to the estimate, and SAY WHICH —
// a contract figure that cannot name its source is the thing that started
// this. Callers render the source; they never re-derive it.
//
// ONLY 'signed' COUNTS. A 'sent' contract is an offer the owner has not
// accepted and a 'draft' is not an offer at all; treating either as the
// contract sum would let an unaccepted asking price become the number on a
// change order. A signed contract with no usable value (zero, negative, or
// non-finite — a legacy row, or a hand-cleared field) also falls back rather
// than reporting a $0 contract.
// ─────────────────────────────────────────────────────────────────────────────

export type ContractSumSource = 'signed_contract' | 'estimate';

export interface ContractSumResolution {
  /** The original (pre-change-order) contract sum. */
  value: number;
  source: ContractSumSource;
  /** What the estimate says, always — so a screen can show the divergence. */
  estimateTotal: number;
}

/** What the caller needs off a ProjectContract. Structural, so this file stays
 *  importable by a bun guard (utils/contractEngine.ts pulls @/lib/supabase). */
export interface SignedContractLike {
  status?: string;
  contractValue?: number;
}

/**
 * WHO CALLS THIS TODAY, precisely — so nobody reads it as the app-wide
 * definition it is not yet (audit 2026-09-11, review round 3).
 *
 *   • app/client-view.tsx — the homeowner portal. Live for a signed-in GC
 *     previewing it; in SNAPSHOT mode (the mode a real homeowner is in) the
 *     screen never fetches a contract, so this answers 'estimate' and the
 *     caption says so rather than asserting an absence. Carrying the resolved
 *     sum into utils/portalSnapshot.ts is what makes the anon view print the
 *     signed figure, and that file belongs to the WIP/AIA wave.
 *
 * STILL ON THE ESTIMATE, none of them in this wave's scope:
 *   • `getContractValue` above (see its own note) → marginRiskScore, livingEstimate;
 *   • app/change-order.tsx — prints "Original Contract Value" on the document a
 *     homeowner signs;
 *   • utils/aiaBilling.ts `seedAIAPayApplicationFromInvoice` — G702 line 1;
 *   • utils/wip.ts `deriveOriginalContractWithSource` — seven branches, no
 *     `signed_contract` among them.
 */
export function resolveContractSum(
  project: Project | null | undefined,
  contract: SignedContractLike | null | undefined,
): ContractSumResolution {
  const estimateTotal = effectiveEstimateTotal(project);
  const v = contract?.contractValue;
  if (contract?.status === 'signed' && typeof v === 'number' && Number.isFinite(v) && v > 0) {
    return { value: v, source: 'signed_contract', estimateTotal };
  }
  return { value: estimateTotal, source: 'estimate', estimateTotal };
}

/**
 * Base estimate before any change orders (useful for showing the "original"
 * contract total next to the "current" one for transparency).
 */
export function getBaseContractValue(project: Project | null | undefined): number {
  return effectiveEstimateTotal(project);
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
 *
 * DRAFTS ARE EXCLUDED (MONEY-PAID-DRAFT-1, audit 2026-09-11), and that is not
 * a formality. This was the ONE billing aggregation in the file with no status
 * filter, sitting between two that have one (`getInvoicedToDate` below,
 * `getOutstandingBalance` after it) — and it is what the client portal prints
 * as "Paid to date". A payment recorded against a draft therefore read as
 * money collected on the document the HOMEOWNER reads, while the same payment
 * was excluded from invoiced-to-date and from outstanding: the portal's own
 * money bar could not foot against itself.
 *
 * A draft is a document issued to nobody (utils/wip.ts DEFINITION 1). Nobody
 * pays one. A non-zero `amountPaid` on a draft is either a payment logged
 * before the invoice was sent — in which case sending it is the fix and the
 * dollars reappear the moment it is — or a stale row; neither is cash the GC
 * should be told he has collected on a job.
 */
export function getPaidToDate(invoices: Invoice[] | null | undefined): number {
  return (invoices ?? [])
    .filter(inv => inv.status !== 'draft')
    .reduce((sum, inv) => sum + (inv.amountPaid ?? 0), 0);
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
 * Outstanding = what clients can be asked for today, summed over sent
 * invoices: each invoice's total NET of the retention the contract lets the
 * client hold, less what they have paid (utils/invoiceBilling.invoiceOutstanding).
 *
 * MONEY-F5 (audit 2026-09-03): this used to be invoiced − paid, which reported
 * held retention as money the GC was "waiting on" and painted it overdue.
 * Held retention is reported separately by getRetentionHeld().
 */
export function getOutstandingBalance(invoices: Invoice[] | null | undefined): number {
  return (invoices ?? [])
    .filter(inv => inv.status !== 'draft')
    .reduce((sum, inv) => sum + invoiceOutstanding(inv), 0);
}

/** Retention still held on sent invoices (released amounts excluded). Not due today. */
export function getRetentionHeld(invoices: Invoice[] | null | undefined): number {
  return (invoices ?? [])
    .filter(inv => inv.status !== 'draft')
    .reduce((sum, inv) => sum + pendingRetentionOf(inv), 0);
}

/**
 * Retention currently held on one invoice, less what has been released.
 *
 * MONEY-05: the withholding comes from `pendingRetentionHeld` — percentage of
 * work value, stored column only as a fallback — so this figure and the one
 * `invoiceOutstanding` nets out are always two halves of the same total. When
 * they were computed differently, held + outstanding did not foot to total_due.
 */
export function pendingRetentionOf(
  invoice: Pick<Invoice, 'subtotal' | 'retentionPercent' | 'retentionAmount' | 'retentionReleased'>,
): number {
  return pendingRetentionHeld(invoice);
}

/**
 * True while retention is still held on this invoice. Independent of
 * paid/settled: a settled invoice can have retention open until closeout,
 * which is exactly the state getEffectiveInvoiceStatus() no longer hides
 * behind 'partially_paid'.
 */
export function retentionOpen(
  invoice: Pick<Invoice, 'subtotal' | 'retentionPercent' | 'retentionAmount' | 'retentionReleased'>,
): boolean {
  return pendingRetentionOf(invoice) > 0;
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
  // A stored 'paid' is trusted only while nothing is collectible. Releasing
  // retention on a settled invoice (or a legacy row whose status was flipped
  // without the money) reopens a balance, and a short-circuit here hid that
  // balance from cash-flow, the portal and the invoice screen — the released
  // $10,000 could never be billed or recorded (review of B3a, 2026-09-05).
  // The money rules below decide instead, so such rows heal on read.
  const settled = invoiceIsSettled(invoice);
  if (invoice.status === 'paid' && invoiceOutstanding(invoice) <= 0.01) return 'paid';
  // MONEY-F5: "paid" means everything collectible TODAY has been paid — net of
  // the retention the contract lets the client hold. Before this, a $100k
  // invoice holding $10k retention and paid down to the $90k asked for stayed
  // 'partially_paid' forever. Held retention is a separate fact: retentionOpen().
  if (invoice.totalDue > 0 && settled) return 'paid';
  if (invoice.amountPaid > 0 && !settled) return 'partially_paid';

  // A distrusted 'paid' (balance open, nothing paid) reads as 'sent' from here
  // on, so the overdue rule and the fallthrough never hand back 'paid'.
  const base: InvoiceStatus = invoice.status === 'paid' ? 'sent' : invoice.status;

  // Overdue check — 'sent' with a due date in the past.
  if (base === 'sent' && invoice.dueDate) {
    const dueTs = new Date(invoice.dueDate).getTime();
    if (!Number.isNaN(dueTs) && dueTs < Date.now()) return 'overdue';
  }
  return base;
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
  /** Collectible today, net of held retention (MONEY-F5). */
  outstanding: number;
  /** Retention still held on sent invoices — not due, not overdue. */
  retentionHeld: number;
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
  const outstanding = getOutstandingBalance(invoices);
  const retentionHeld = getRetentionHeld(invoices);
  const unbilled = Math.max(0, contractValue - invoiced);

  const overdueInvoices = (invoices ?? []).filter(
    inv => getEffectiveInvoiceStatus(inv) === 'overdue',
  );
  const overdueAmount = overdueInvoices.reduce(
    (sum, inv) => sum + invoiceOutstanding(inv),
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
    retentionHeld,
    unbilled,
    pctBilled: contractValue > 0 ? Math.min(100, Math.round((invoiced / contractValue) * 100)) : 0,
    pctPaid: contractValue > 0 ? Math.min(100, Math.round((paidToDate / contractValue) * 100)) : 0,
    hasOverdueInvoices: overdueInvoices.length > 0,
    overdueAmount,
  };
}
