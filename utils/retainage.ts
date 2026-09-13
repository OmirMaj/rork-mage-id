// utils/retainage.ts — project-level retainage: what is held, what a reduction
// releases, and the ONE patch that records a release on an invoice.
//
// WHY THIS FILE EXISTS.
//
// Releasing retainage used to live entirely inside app/invoice.tsx
// (`handleReleaseRetention`). Its mechanics are good — it caps the release at
// what is actually pending, it re-opens a settled invoice and restarts the
// terms clock, it resets the dunning stage so a hours-old balance does not get
// a FINAL NOTICE, and it drops the stale Stripe pay link. What it is not is
// reachable from the job. A closeout on a job with fourteen progress invoices
// meant opening fourteen invoices and typing fourteen amounts, and the one a
// contractor forgets is the one that never gets paid.
//
// So the project-level release does NOT get its own arithmetic. It plans an
// allocation here, and then calls `buildRetainageReleasePatch` once per
// invoice — the same function app/invoice.tsx now calls for a single release.
// Two ways to release the same money is exactly how this repo has produced
// double-billing before; there is one way, and it is below.
//
// ─────────────────────────────────────────────────────────────────────────────
// RETAINAGE REDUCTION IS NOT A SINGLE CLOSEOUT EVENT.
//
// The obvious shape for this feature is one big "Release All" button at the end
// of the job. That shape is wrong, and the repo already knew it in one place:
// utils/aiaBilling models retainage as a PER-LINE rate on the G702/G703
// (`retainagePercent`, plus a separate `storedRetainagePercent` for line 5b),
// precisely so a certificate can withhold at one rate early and a lower rate
// later. A release path that can only go to zero cannot express that.
//
// Retainage is commonly stepped DOWN mid-job and released in stages. Two
// authorities read on the date recorded in `RETAINAGE_SOURCES` below:
//
//   - Illinois' Contractor Prompt Payment Act (815 ILCS 603/20) caps private
//     retainage at 10% and requires it to drop to 5% once the contract is 50%
//     complete. The secondary source cited below also flags a real ambiguity in
//     that statute — whether the 5% is measured against contract value or
//     against the remaining payments — which is exactly why this app computes
//     nothing statutory on its own.
//   - California Civil Code § 8812 gives an owner on a private work 45 days
//     after completion of the work of improvement to pay the retention.
//
// WHAT THIS APP DOES WITH THAT: nothing automatic. MAGE ID does not know your
// contract, your state, or whether your job is 50% complete in the sense a
// statute means. It gives you a partial, repeatable reduction — release a
// dollar figure, or step the withholding down to a target percentage — and it
// shows you the citation and the date it was read so you can check it yourself.
// No screen in this app may state a legal requirement that is not carried in
// `RETAINAGE_SOURCES` with a URL and a read date. See utils/lienWaiverForms.ts
// (`STATUTE_TEXT_AS_OF`) for the same rule applied to statutory form text.
// ─────────────────────────────────────────────────────────────────────────────
//
// Pure module: no React, no network, no storage, so
// scripts/validate-invoice-billing.ts can drive every function below directly.

import type { Invoice, InvoiceStatus, PaymentTerms, RetentionRelease } from '@/types';
import {
  effectiveRetentionHeld,
  pendingRetentionHeld,
  netBalanceDue,
  roundCents,
} from '@/utils/invoiceBilling';

// ─────────────────────────────────────────────────────────────────────────────
// Payment terms → due date
//
// A release that re-opens a settled invoice restarts the payment clock, and
// BOTH release surfaces have to restart it the same way — app/invoice.tsx and
// app/retention.tsx. The day counts live here, in one table, so the two thin
// wrappers around them cannot drift.
//
// app/invoice.tsx keeps its own `getDueDate(issueDate, terms)` (four other call
// sites need it, and scripts/validate-calendar-date.ts carries a dated ALLOWED
// entry for its `new Date(issueDate)` — deleting the site would make that entry
// stale and fail the run). It reads the table below rather than a second switch.
// ─────────────────────────────────────────────────────────────────────────────

/** Days added to the issue instant for each payment term. */
export const PAYMENT_TERM_DAYS: Record<PaymentTerms, number> = {
  due_on_receipt: 0,
  net_15: 15,
  net_30: 30,
  net_45: 45,
};

/**
 * Due date for an issue instant under `terms`, using `setDate` rather than
 * millisecond arithmetic so a term that crosses a DST boundary still lands on
 * the same wall-clock time.
 */
export function dueDateForTerms(issuedIso: string, terms: PaymentTerms): string {
  const d = new Date(issuedIso);
  if (!Number.isFinite(d.getTime())) return issuedIso;
  d.setDate(d.getDate() + (PAYMENT_TERM_DAYS[terms] ?? 0));
  return d.toISOString();
}

// ─────────────────────────────────────────────────────────────────────────────
// Citations
// ─────────────────────────────────────────────────────────────────────────────

export interface RetainageSource {
  /** Short label for the authority, as a contractor would refer to it. */
  authority: string;
  /** What it says, in the narrowest form that is actually supported. */
  says: string;
  /** The page that was read. */
  url: string;
  /** ISO date the page above was read. Move it only when you re-read the page. */
  readOn: string;
  /** 'primary' = the code itself. 'secondary' = someone describing the code. */
  kind: 'primary' | 'secondary';
}

/**
 * The ONLY legal statements any retainage surface may make, each with the page
 * it came from and the day it was read. A screen that wants to say something
 * else about the law adds it here, with a URL and a read date, or does not say
 * it. Statutes are amended and this app cannot know when; every surface that
 * prints one of these must also print `RETAINAGE_LEGAL_DISCLAIMER`.
 */
export const RETAINAGE_SOURCES: readonly RetainageSource[] = [
  {
    authority: 'Illinois Contractor Prompt Payment Act, 815 ILCS 603/20',
    says:
      'On private construction contracts, retainage is capped at 10%, and once the contract is '
      + '50% complete the withholding must be reduced to no more than 5%. The source below notes '
      + 'that the statute is ambiguous about whether that 5% is measured against contract value or '
      + 'against the remaining payments.',
    url: 'https://natlawreview.com/article/gov-pritzker-signs-retainage-cap-law-immediately-impacts-construction-contract-and',
    readOn: '2026-09-13',
    kind: 'secondary',
  },
  {
    authority: 'California Civil Code § 8812',
    says:
      'On a private work of improvement, the owner must pay the retention within 45 days after '
      + 'completion of the work of improvement. Where there is a good-faith dispute the owner may '
      + 'withhold up to 150% of the disputed amount.',
    url: 'https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=8812',
    readOn: '2026-09-13',
    kind: 'primary',
  },
] as const;

export const RETAINAGE_LEGAL_DISCLAIMER =
  'These are the pages MAGE ID read, on the dates shown — not advice, and not a rule this app applies '
  + 'to your job. Retainage law is state by state and statutes are amended. Your contract and an '
  + 'attorney licensed in your state decide what you may hold and when you must release it.';

// ─────────────────────────────────────────────────────────────────────────────
// What is held
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The work value a row's retainage is measured against — the invoice subtotal,
 * floored at zero, never the tax-inclusive total. Same basis
 * `effectiveRetentionHeld` uses (see utils/invoiceBilling MISS-04 / MONEY-05);
 * duplicated as a named function only because a percentage TARGET needs the
 * denominator, which the held figure alone does not expose.
 *
 * Returns 0 for a non-finite or negative subtotal — a credit memo withholds
 * nothing, and a row with no usable basis cannot be stepped to a percentage at
 * all (`planRetainageReduction` reports those rather than guessing).
 */
export function retainageWorkValue(inv: Pick<Invoice, 'subtotal'>): number {
  const s = inv.subtotal;
  if (s == null || !Number.isFinite(s)) return 0;
  return roundCents(Math.max(0, s));
}

export interface RetainageInvoiceView {
  invoice: Invoice;
  /** Work value the withholding is measured against. */
  workValue: number;
  /** Retainage withheld on this invoice, on the work basis. */
  held: number;
  /** Already released (made collectible) on this invoice. */
  released: number;
  /** Still withheld: held − released, never negative. */
  pending: number;
  /**
   * Pending as a percentage of the work value, or null when there is no work
   * value to divide by. This is the number a "reduce to 5%" target compares
   * against — and it is DERIVED, so it can disagree with the row's stored
   * `retentionPercent` on a partially-released invoice. That is correct: after
   * you release half of a 10% withholding you are holding 5%.
   */
  pendingPercent: number | null;
}

export interface ProjectRetainageSummary {
  projectId: string;
  /** Every invoice on the project that holds, or has ever held, retainage. */
  invoices: RetainageInvoiceView[];
  /** Sum of the work values the withholding is measured against. */
  workValue: number;
  held: number;
  released: number;
  pending: number;
  /** Portfolio-level pending ÷ work value × 100, or null when workValue is 0. */
  pendingPercent: number | null;
  /** Invoices with a dollar still withheld. */
  pendingCount: number;
}

/** True when this invoice is worth showing on a retainage screen. */
export function invoiceTouchesRetainage(inv: Invoice): boolean {
  return effectiveRetentionHeld(inv) > 0 || (inv.retentionReleased ?? 0) > 0;
}

/**
 * Everything a project-level retainage surface needs, in one pass, computed
 * from the shared helpers rather than the stored `retention_amount` column.
 *
 * Invoices are ordered OLDEST FIRST (by issue date, then invoice number) —
 * which is also the order a dollar release is allocated in, so the preview a GC
 * reads and the patches the app writes are in the same sequence.
 */
export function summarizeProjectRetainage(
  projectId: string,
  allInvoices: readonly Invoice[],
): ProjectRetainageSummary {
  const rows = allInvoices
    .filter(inv => inv.projectId === projectId && invoiceTouchesRetainage(inv))
    .slice()
    .sort((a, b) => {
      const at = new Date(a.issueDate).getTime();
      const bt = new Date(b.issueDate).getTime();
      // A NaN issueDate must not scramble the order (and must not decide the
      // allocation order for real money): fall through to the invoice number.
      if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return at - bt;
      return (a.number ?? 0) - (b.number ?? 0);
    });

  const invoices: RetainageInvoiceView[] = rows.map(invoice => {
    const workValue = retainageWorkValue(invoice);
    const held = effectiveRetentionHeld(invoice);
    const released = roundCents(Math.max(0, invoice.retentionReleased ?? 0));
    const pending = pendingRetentionHeld(invoice);
    return {
      invoice,
      workValue,
      held,
      released,
      pending,
      pendingPercent: workValue > 0 ? (pending / workValue) * 100 : null,
    };
  });

  const workValue = roundCents(invoices.reduce((s, r) => s + r.workValue, 0));
  const held = roundCents(invoices.reduce((s, r) => s + r.held, 0));
  const released = roundCents(invoices.reduce((s, r) => s + r.released, 0));
  const pending = roundCents(invoices.reduce((s, r) => s + r.pending, 0));

  return {
    projectId,
    invoices,
    workValue,
    held,
    released,
    pending,
    pendingPercent: workValue > 0 ? (pending / workValue) * 100 : null,
    pendingCount: invoices.filter(r => r.pending > 0.005).length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Planning a release
// ─────────────────────────────────────────────────────────────────────────────

export interface RetainageAllocation {
  invoiceId: string;
  invoiceNumber: number;
  /** Dollars this invoice releases. Always > 0 — zero rows are not emitted. */
  amount: number;
  /** What was withheld on this invoice before the release. */
  pendingBefore: number;
  /** What is withheld after: pendingBefore − amount. */
  pendingAfter: number;
}

export interface RetainageSkip {
  invoiceId: string;
  invoiceNumber: number;
  reason: 'no_work_value' | 'no_percentage_basis' | 'already_at_or_below_target';
}

/**
 * True when this row's withholding is a PERCENTAGE of its work value — the only
 * basis a percentage target can legitimately step down.
 *
 * Mirrors, deliberately, the branch `effectiveRetentionHeld` takes: a row with a
 * positive stored percent and a finite subtotal holds `subtotal × pct`; anything
 * else holds the stored `retention_amount` dollar figure, which is not a
 * percentage of anything this app knows.
 */
export function hasPercentageBasis(inv: Pick<Invoice, 'retentionPercent' | 'subtotal'>): boolean {
  const pct = inv.retentionPercent;
  return (
    pct != null && Number.isFinite(pct) && pct > 0
    && inv.subtotal != null && Number.isFinite(inv.subtotal)
  );
}

export interface RetainageReleasePlan {
  /** What the caller asked for, rounded to cents. */
  requested: number;
  /** What can actually be released — never more than the sum of pending. */
  allocated: number;
  /** requested − allocated. Non-zero means the ask exceeded what is withheld. */
  unallocated: number;
  allocations: RetainageAllocation[];
  /** Project-wide withholding once these allocations are applied. */
  pendingAfter: number;
  /**
   * `pendingAfter` as a percentage of the project's whole work value, or null
   * when there is no work value to divide by.
   *
   * This exists because the screen has TWO denominators and used one label for
   * both. The card and the modal header print the PROJECT rate (all withholding
   * ÷ all work value), while a percentage target is applied PER INVOICE and
   * skips rows already at zero. On a job where a dollar release has already
   * emptied the oldest invoices, a job reading "5.71% of work value" steps to a
   * 5% target and lands at 2.86% — four times the money the header's own rate
   * implies. Printing the resulting project rate next to the total is what makes
   * the two denominators visible before the money moves.
   */
  pendingPercentAfter: number | null;
  /** Rows a percentage target could not touch, and why. Empty for a dollar plan. */
  skipped: RetainageSkip[];
}

const percentOf = (amount: number, workValue: number): number | null =>
  (workValue > 0 ? (amount / workValue) * 100 : null);

const EMPTY_PLAN = (requested: number, summary: ProjectRetainageSummary): RetainageReleasePlan => ({
  requested,
  allocated: 0,
  unallocated: roundCents(Math.max(0, requested)),
  allocations: [],
  pendingAfter: summary.pending,
  pendingPercentAfter: percentOf(summary.pending, summary.workValue),
  skipped: [],
});

/**
 * Allocate a DOLLAR release across a project's invoices, oldest invoice first.
 *
 * Oldest-first, not pro-rata, because a dollar release at closeout is a payment
 * against the oldest outstanding withholding — the same order an A/R ledger
 * applies a cheque in. A percentage step-down is a different operation with a
 * different allocation; that is `planRetainageReduction`.
 *
 * Two invariants the validator mutates against, because both are money:
 *
 *   1. No allocation ever exceeds that invoice's own pending withholding. This
 *      is what stops the project-level path from releasing money the
 *      per-invoice path would have refused.
 *   2. sum(allocations) === min(requested, total pending), TO THE CENT. Each
 *      allocation is rounded as it is taken and the running remainder is
 *      recomputed from the rounded figure, so the last invoice absorbs the
 *      residual instead of the plan quietly losing or inventing a penny.
 */
export function planRetainageRelease(
  summary: ProjectRetainageSummary,
  requestedAmount: number,
): RetainageReleasePlan {
  const requested = Number.isFinite(requestedAmount) ? roundCents(requestedAmount) : 0;
  if (requested <= 0) return EMPTY_PLAN(0, summary);

  const allocations: RetainageAllocation[] = [];
  let remaining = Math.min(requested, summary.pending);
  remaining = roundCents(remaining);

  for (const row of summary.invoices) {
    if (remaining <= 0.005) break;
    if (row.pending <= 0.005) continue;
    const amount = roundCents(Math.min(row.pending, remaining));
    if (amount <= 0) continue;
    allocations.push({
      invoiceId: row.invoice.id,
      invoiceNumber: row.invoice.number,
      amount,
      pendingBefore: row.pending,
      pendingAfter: roundCents(row.pending - amount),
    });
    remaining = roundCents(remaining - amount);
  }

  const allocated = roundCents(allocations.reduce((s, a) => s + a.amount, 0));
  const pendingAfter = roundCents(Math.max(0, summary.pending - allocated));
  return {
    requested,
    allocated,
    unallocated: roundCents(Math.max(0, requested - allocated)),
    allocations,
    pendingAfter,
    pendingPercentAfter: percentOf(pendingAfter, summary.workValue),
    skipped: [],
  };
}

/**
 * Step the withholding DOWN to a target percentage of each invoice's work value
 * — the partial, repeatable reduction this feature exists for.
 *
 * Per invoice, not pro-rata over the portfolio: "we are now holding 5%" is a
 * statement about each certificate's own withholding, and the AIA continuation
 * sheet carries the rate per line for the same reason. An invoice already at or
 * below the target is left alone and reported in `skipped`, so pressing the
 * same target twice releases nothing the second time. That is the repeatability
 * property — a 10% → 5% step at mid-job, then 5% → 0% at closeout, and neither
 * one can double-release the other's dollars.
 *
 * TWO populations are NOT stepped by a positive target, both reported in
 * `skipped` so the screen can say so and offer the dollar path instead:
 *
 *  - `no_work_value` — subtotal 0, missing, or negative. There is no
 *    denominator at all.
 *  - `no_percentage_basis` — a legacy stored-dollar hold: `retention_amount`
 *    with no positive `retention_percent`, which is exactly what
 *    `effectiveRetentionHeld` falls back to. This row's withholding is NOT a
 *    percentage of anything the app knows. An earlier version of this function
 *    skipped only on `workValue <= 0`, so the pre-MISS-04 population it was
 *    written for — subtotal $100,000 holding a stored $10,800 (10% of the
 *    TAX-INCLUSIVE total) — was measured against a basis that withholding never
 *    used: a GC typing their contract rate of 10 released $800 they never
 *    agreed to release. Inventing a denominator to release money against is the
 *    kind of guess this codebase deletes features for.
 *
 * A target of exactly 0 steps BOTH populations, because releasing everything
 * needs no denominator — and closeout is the case this feature exists for.
 */
export function planRetainageReduction(
  summary: ProjectRetainageSummary,
  targetPercent: number,
): RetainageReleasePlan {
  const pct = Number.isFinite(targetPercent) ? Math.max(0, Math.min(100, targetPercent)) : 0;
  const allocations: RetainageAllocation[] = [];
  const skipped: RetainageSkip[] = [];

  for (const row of summary.invoices) {
    if (row.pending <= 0.005) continue;
    // pct === 0 releases everything and needs no denominator, so neither basis
    // check applies to a closeout.
    if (pct > 0 && row.workValue <= 0) {
      skipped.push({
        invoiceId: row.invoice.id,
        invoiceNumber: row.invoice.number,
        reason: 'no_work_value',
      });
      continue;
    }
    if (pct > 0 && !hasPercentageBasis(row.invoice)) {
      skipped.push({
        invoiceId: row.invoice.id,
        invoiceNumber: row.invoice.number,
        reason: 'no_percentage_basis',
      });
      continue;
    }
    const targetPending = roundCents(row.workValue * (pct / 100));
    const amount = roundCents(row.pending - targetPending);
    if (amount <= 0.005) {
      skipped.push({
        invoiceId: row.invoice.id,
        invoiceNumber: row.invoice.number,
        reason: 'already_at_or_below_target',
      });
      continue;
    }
    allocations.push({
      invoiceId: row.invoice.id,
      invoiceNumber: row.invoice.number,
      amount,
      pendingBefore: row.pending,
      pendingAfter: roundCents(row.pending - amount),
    });
  }

  const allocated = roundCents(allocations.reduce((s, a) => s + a.amount, 0));
  const pendingAfter = roundCents(Math.max(0, summary.pending - allocated));
  return {
    requested: allocated,
    allocated,
    unallocated: 0,
    allocations,
    pendingAfter,
    pendingPercentAfter: percentOf(pendingAfter, summary.workValue),
    skipped,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Recording a release — THE one mechanic
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The columns a release reads and writes. `Invoice` satisfies this structurally,
 * and app/invoice.tsx passes its LIVE editor figures (subtotal, percent, amount,
 * payments) over the stored row so a draft mid-edit releases against what is on
 * screen — which is what `handleReleaseRetention` always did.
 */
export interface RetainageReleaseTarget {
  id: string;
  number: number;
  subtotal: number;
  totalDue: number;
  amountPaid: number;
  status: InvoiceStatus;
  paymentTerms: PaymentTerms;
  retentionPercent?: number;
  retentionAmount?: number;
  retentionReleased?: number;
  retentionReleases?: RetentionRelease[];
  payLinkUrl?: string;
}

export interface RetainageReleaseContext {
  /** ISO timestamp stamped on the release record and used to restart the clock. */
  now: string;
  /** Id factory — the caller owns id generation (app uses generateUUID). */
  makeId: () => string;
  /** Terms → due date. app/invoice.tsx passes its own `getDueDate`. */
  dueDateFor: (issuedIso: string, terms: PaymentTerms) => string;
  note?: string;
}

export interface RetainageReleaseOutcome {
  invoiceId: string;
  invoiceNumber: number;
  amount: number;
  /** Exactly what to hand `updateInvoice`. Nothing else may be written. */
  patch: Partial<Invoice>;
  /** Collectible balance after the release. */
  newBalance: number;
  /** True when a settled invoice was re-opened by this release. */
  reopened: boolean;
  /**
   * True when this invoice carried a live Stripe pay link minted for the OLD
   * balance. The patch clears it locally, but `pay_link_*` are server-owned and
   * come back on the next refetch — the portal keeps them hidden because
   * `payLinkAmount` no longer equals the balance (MONEY-F2), so nothing charges
   * the wrong figure. It still has to be re-minted before the client can pay by
   * link, and the caller is the only thing that knows whether it can mint.
   */
  needsPayLinkRemint: boolean;
}

/**
 * Build the single-invoice release patch — the ONE place retainage becomes
 * collectible. app/invoice.tsx's "Release Retention" and app/retention.tsx's
 * project-level reduction both go through here.
 *
 * Returns null, writing nothing, when the amount is not a positive number or
 * exceeds what is actually withheld on this invoice. That refusal is the
 * double-release guard: a project-level plan computed against a stale snapshot
 * cannot push an invoice past its own pending, because the cap is re-checked
 * here against the row being written.
 *
 * The patch reproduces, exactly, what `handleReleaseRetention` has always done:
 *
 *  - MONEY-F7: released means COLLECTIBLE, not paid. No payment method is
 *    recorded; the cash arrives later as an InvoicePayment.
 *  - A release on a settled invoice RE-OPENS it. The stored 'paid' used to
 *    survive the write and every reader that trusts stored status — dunning's
 *    cron query, the portal pill, the invoice screen's own gates — went on
 *    treating the released money as already collected.
 *  - The re-opened invoice gets a FRESH due date and `dunningStage: 0`. The
 *    money became collectible today, not on the original due date; without this
 *    the A/R report ages it from the old date and dunning's first run sends a
 *    FINAL NOTICE for a balance that is hours old.
 *  - MONEY-F2: the pay link is cleared. The balance just grew and a link minted
 *    for the old one would charge the wrong amount.
 */
export function buildRetainageReleasePatch(
  target: RetainageReleaseTarget,
  amount: number,
  ctx: RetainageReleaseContext,
): RetainageReleaseOutcome | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const retentionReleased = Math.max(0, target.retentionReleased ?? 0);
  const pending = pendingRetentionHeld({
    subtotal: target.subtotal,
    retentionPercent: target.retentionPercent,
    retentionAmount: target.retentionAmount,
    retentionReleased,
  });
  // The same 0.001 slack app/invoice.tsx used, so "Full" (which types
  // pending.toFixed(2)) is never rejected by a floating-point hair.
  if (amount > pending + 0.001) return null;

  const amt = roundCents(amount);
  if (amt <= 0) return null;

  const release: RetentionRelease = {
    id: ctx.makeId(),
    date: ctx.now,
    amount: amt,
    note: ctx.note?.trim() ? ctx.note.trim() : undefined,
  };
  const newReleased = roundCents(retentionReleased + amt);
  const amountPaid = target.amountPaid ?? 0;
  const newBalance = netBalanceDue({
    totalDue: target.totalDue,
    amountPaid,
    subtotal: target.subtotal,
    retentionPercent: target.retentionPercent,
    retentionAmount: target.retentionAmount,
    retentionReleased: newReleased,
  });

  const reopened = target.status === 'paid' && newBalance > 0.01;

  const patch: Partial<Invoice> = {
    retentionReleased: newReleased,
    retentionReleases: [...(target.retentionReleases ?? []), release],
    ...(reopened
      ? {
          status: (amountPaid > 0 ? 'partially_paid' : 'sent') as InvoiceStatus,
          dueDate: ctx.dueDateFor(ctx.now, target.paymentTerms),
          dunningStage: 0,
        }
      : {}),
    payLinkUrl: undefined,
    payLinkId: undefined,
    payLinkAmount: undefined,
  };

  return {
    invoiceId: target.id,
    invoiceNumber: target.number,
    amount: amt,
    patch,
    newBalance,
    reopened,
    needsPayLinkRemint: Boolean(target.payLinkUrl) && newBalance > 0,
  };
}

export interface RetainageReleaseResult {
  outcomes: RetainageReleaseOutcome[];
  /** Total actually released. */
  released: number;
  /** Allocations the cap refused — a stale plan, or an invoice changed underneath. */
  refused: RetainageAllocation[];
}

/**
 * Turn a plan into patches, re-reading each invoice from the CURRENT list.
 *
 * The plan is a preview; by the time a GC taps Apply the underlying invoice may
 * have moved (another device released some, the subtotal was edited). Every
 * allocation is re-checked against the live row by
 * `buildRetainageReleasePatch`, and one that no longer fits is refused and
 * reported rather than clamped — a silently smaller release is a number the GC
 * was never shown.
 */
export function buildProjectRetainageRelease(
  plan: RetainageReleasePlan,
  currentInvoices: readonly Invoice[],
  ctx: RetainageReleaseContext,
): RetainageReleaseResult {
  const byId = new Map(currentInvoices.map(inv => [inv.id, inv]));
  const outcomes: RetainageReleaseOutcome[] = [];
  const refused: RetainageAllocation[] = [];

  for (const alloc of plan.allocations) {
    const inv = byId.get(alloc.invoiceId);
    if (!inv) { refused.push(alloc); continue; }
    const outcome = buildRetainageReleasePatch(inv, alloc.amount, ctx);
    if (!outcome) { refused.push(alloc); continue; }
    outcomes.push(outcome);
  }

  return {
    outcomes,
    released: roundCents(outcomes.reduce((s, o) => s + o.amount, 0)),
    refused,
  };
}

/**
 * Hand back the ONE release still to be written, and the rest.
 *
 * WHY THIS IS NOT A `forEach`. `contexts/ProjectContext.updateInvoice` is not a
 * functional updater: it is `useCallback((id, updates) => { const updated =
 * invoices.map(…); setInvoices(updated); saveInvoicesMutation.mutate(updated) },
 * [invoices, …])`, so it rebuilds the WHOLE array from the `invoices` array the
 * current render captured. Calling it N times inside one handler tick therefore
 * computes patch k+1 from a list that never saw patch k, and only the last
 * `setInvoices` survives. Measured on the shipped planner and builder: a
 * closeout of 14 invoices at $50,000 / 10% released $70,000 on the server and
 * left $65,000 still showing as held on the device — and offline, where no
 * refetch ever repairs it, that IS the ledger. Worse, the next release read the
 * stale row and overwrote the first release's audit record.
 *
 * So the writes are drained ONE PER RENDER: the caller applies `write`, stores
 * `remaining`, and the resulting commit hands the effect a fresh
 * `updateInvoice` closed over a list that already contains the previous patch.
 * That keeps the app on the single write path (a batch mutator would be a
 * second one, with its own copy of `updateInvoice`'s column scoping) at the
 * cost of N commits, which is what N `supabaseWrite`s already cost.
 *
 * Pure and total, so the drain can be replayed against a stale-closure model in
 * a validator rather than asserted about with a regex.
 */
export function nextRetainageWrite(
  pending: readonly RetainageReleaseOutcome[],
): { write: RetainageReleaseOutcome | null; remaining: RetainageReleaseOutcome[] } {
  if (pending.length === 0) return { write: null, remaining: [] };
  return { write: pending[0], remaining: pending.slice(1) };
}

// ─────────────────────────────────────────────────────────────────────────────
// The reminder — built only from facts this app actually holds
// ─────────────────────────────────────────────────────────────────────────────

export interface RetainageReadinessInput {
  pending: number;
  /** Project.status. */
  projectStatus: 'draft' | 'estimated' | 'in_progress' | 'completed' | 'closed';
  /** Project.substantialCompletionDate, when the G704 has been issued. */
  substantialCompletionDate?: string;
  /** Punch items on this project, by count. */
  punchTotal: number;
  punchOpen: number;
  /** Issue date of the most recent invoice on the project that holds retainage. */
  lastRetainageInvoiceIso?: string;
  now: Date;
}

export interface RetainageReadinessSignal {
  level: 'none' | 'watch' | 'due';
  /** One line, stating the amount and the strongest fact behind it. */
  headline: string;
  /** Every fact that fed the level. Each is something the app can point at. */
  reasons: string[];
}

function daysBetween(fromIso: string, now: Date): number | null {
  const t = new Date(fromIso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((now.getTime() - t) / 86_400_000);
}

/**
 * "You are still holding $X and here is why it looks releasable" — the reminder
 * Knowify ships and MAGE did not.
 *
 * EVERY reason is a fact already in this app: a substantial-completion date the
 * GC stamped, a punch list this app tracks, a project status the GC set, the
 * age of the last retainage-bearing invoice. Nothing here reads a statute,
 * infers a deadline, or claims money is owed. The strongest thing it says is
 * that the job looks finished and the money is still held — which is true, or
 * the facts would not be there.
 *
 * Two deliberate refusals:
 *
 *  - A project with NO punch items on file is not "punch list clear". Zero rows
 *    is an empty tracker, not a cleared one, and this app has deleted features
 *    for presenting a guess as a fact. It says "no punch list on file" and that
 *    fact does not count toward `due`.
 *  - Nothing escalates on age alone. An old invoice is not evidence the work is
 *    complete; it is at most a reason to look.
 */
export function retainageReadiness(input: RetainageReadinessInput): RetainageReadinessSignal {
  const { pending, now } = input;
  if (!(pending > 0.005)) {
    return { level: 'none', headline: 'No retainage is being held on this job.', reasons: [] };
  }

  const reasons: string[] = [];
  let completionFact = false;
  let punchFact = false;

  if (input.substantialCompletionDate) {
    const d = daysBetween(input.substantialCompletionDate, now);
    completionFact = true;
    reasons.push(
      d != null && d >= 0
        ? `Substantial completion recorded ${d} day${d === 1 ? '' : 's'} ago.`
        : 'Substantial completion has been recorded on this job.',
    );
  } else if (input.projectStatus === 'completed' || input.projectStatus === 'closed') {
    completionFact = true;
    reasons.push(`You marked this job ${input.projectStatus === 'closed' ? 'closed' : 'completed'}.`);
  }

  if (input.punchTotal <= 0) {
    reasons.push('No punch list on file — nothing here says the punch is clear.');
  } else if (input.punchOpen === 0) {
    punchFact = true;
    reasons.push(`All ${input.punchTotal} punch item${input.punchTotal === 1 ? '' : 's'} closed.`);
  } else {
    reasons.push(`${input.punchOpen} of ${input.punchTotal} punch items still open.`);
  }

  if (input.lastRetainageInvoiceIso) {
    const d = daysBetween(input.lastRetainageInvoiceIso, now);
    if (d != null && d >= 0) {
      reasons.push(`Last invoice holding retainage was issued ${d} day${d === 1 ? '' : 's'} ago.`);
    }
  }

  if (completionFact && punchFact) {
    return {
      level: 'due',
      headline: 'This job reads as finished and the retainage is still held.',
      reasons,
    };
  }
  if (completionFact || punchFact) {
    return {
      level: 'watch',
      headline: 'Closeout has started and the retainage is still held.',
      reasons,
    };
  }
  return { level: 'none', headline: 'Retainage is held while the work is in progress.', reasons };
}
