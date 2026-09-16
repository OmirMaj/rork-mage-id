// utils/retainageSource.ts — ONE layered answer to "what does this job hold back?",
// and an honest label for where that answer came from.
//
// WHY THIS FILE EXISTS.
//
// The retainage machinery in this repo is complete and correct: utils/retainage
// plans and records releases, utils/invoiceBilling.retainageOnWorkValue withholds
// on the value of the work (never on sales tax), the cash-flow forecast excludes
// held money from the runway, and the G702 certificate and the invoice agree by
// construction. All of it is downstream of ONE number that nothing ever asked
// for: the percentage in the contract.
//
// Invoice #2 onward was already handled — app/invoice.tsx carries the rate
// forward from the most recent non-draft invoice on the job and says so on
// screen. Invoice #1 has nothing to carry from, and app/bill-from-estimate.tsx
// writes its Invoice literal with no `retentionPercent` at all and calls
// addInvoice BEFORE the editor mounts. So the first invoice on every job held
// zero. On a job where the owner holds 10%, invoice #1 for $80,000 goes out
// asking for $80,000, the owner's AP deducts the 10% regardless and pays
// $72,000 — and MAGE then shows $8,000 outstanding on an invoice the owner
// considers settled. That phantom receivable propagates into A/R aging, the
// weekly cash-flow forecast, payment predictions, and the retention screen,
// which sees nothing held and therefore has nothing to plan a release against.
// He chases $8,000 that was never owed and forgets the $8,000 genuinely held.
//
// ── WHY A RESOLVER RATHER THAN A FIELD ──────────────────────────────────────
//
// The tempting fix is a `retainagePercent` on Project. On its own that makes a
// fourth independent source of truth which can silently disagree with the
// invoices already sent — the same class of bug as two copies of the release
// arithmetic, which utils/retainage exists to prevent. So the field is only one
// LAYER here, and every screen reads the stack through this function:
//
//   1. this invoice's own saved rate  — including a deliberate 0. An issued
//      invoice is a document; its rate is a fact about it, not a preference.
//   2. the most recent NON-DRAFT invoice on the job — the existing carry, kept
//      first-in-line so nothing that works today regresses. Drafts are excluded
//      because a draft is a guess in progress.
//   3. Project.retainagePercent — the contract term, when he has told us.
//   4. the newest saved G702 pay application — a job already certifying at 10%
//      on a signed pay app must never be asked what its retainage is.
//   5. nothing. `needsAsk` is true and `percent` is 0, because 0 is what the
//      math must use when the rate is unknown — but the LABEL says "not on
//      file", never "0% withheld", because the app has not been told that.
//
// NOTHING IS INVENTED AT ANY LAYER. There is no 10% fallback here; one was
// deliberately removed from the AIA seeder (app/aia-pay-app.tsx) for exactly
// this reason. A rate the app makes up is worse than no rate, because a wrong
// withholding is billed, sent, and then argued about.

import type { Invoice, Project, SavedAIAPayApp } from '@/types';

export type RetainageSourceKind = 'invoice' | 'carried' | 'contract' | 'payApp' | 'unknown';

export interface ResolvedRetainage {
  /** The rate to bill at. 0 when unknown — see `needsAsk` before showing it as a fact. */
  percent: number;
  source: RetainageSourceKind;
  /** One honest line for the UI. Never claims a source this resolve did not use. */
  label: string;
  /** Nothing anywhere records a rate for this job. Ask; do not guess. */
  needsAsk: boolean;
}

/** Prior invoices on the same job, in any order. */
export type RetainagePriorInvoice = Pick<Invoice, 'id' | 'number' | 'status' | 'retentionPercent' | 'createdAt'>;
export type RetainageProject = Pick<Project, 'retainagePercent' | 'retainagePercentAssumed'>;
export type RetainagePayApp = Pick<SavedAIAPayApp, 'applicationNumber' | 'retainagePercent'>;

export interface RetainageSourceInput {
  /** The invoice being edited, when it already exists. */
  invoice?: Pick<Invoice, 'retentionPercent'> | null;
  /** Every invoice on the project — this one included; pass `excludeInvoiceId`. */
  priorInvoices?: RetainagePriorInvoice[];
  excludeInvoiceId?: string;
  project?: RetainageProject | null;
  payApps?: RetainagePayApp[];
}

/**
 * A rate only counts as RECORDED when it is a finite number inside 0–100.
 * Rejected rather than clamped: a stored 150 or a NaN means the row is damaged,
 * and clamping it to 100 would turn damage into a confident withholding. Falling
 * through to the next layer — and ultimately to asking — is the honest move.
 */
export function isRecordedRetainageRate(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;
}

export function resolveRetainagePercent(input: RetainageSourceInput): ResolvedRetainage {
  // 1 — this invoice's own rate. A deliberate 0 wins here; app/invoice.tsx
  // persists 0 AS 0 precisely so "withheld nothing" stays distinguishable from
  // "never recorded", and re-deriving a rate for an issued invoice would let a
  // later contract edit silently rewrite a document already in the client's inbox.
  if (isRecordedRetainageRate(input.invoice?.retentionPercent)) {
    return { percent: input.invoice!.retentionPercent as number, source: 'invoice', label: 'set on this invoice', needsAsk: false };
  }

  // 2 — carry from the most recent NON-DRAFT invoice on the job. Sorted by
  // createdAt descending, the same comparison app/invoice.tsx has used since the
  // carry-forward shipped; keeping it identical is what makes this refactor a
  // no-op for every job that already bills.
  const prior = (input.priorInvoices ?? [])
    .filter(i => i.id !== input.excludeInvoiceId && i.status !== 'draft' && isRecordedRetainageRate(i.retentionPercent))
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))[0];
  if (prior) {
    return { percent: prior.retentionPercent as number, source: 'carried', label: `same as #${prior.number}`, needsAsk: false };
  }

  // 3 — the contract term, if he has told us. `retainagePercentAssumed` means the
  // app inferred it from his own earlier paperwork rather than reading it off the
  // agreement, so the label must not promise "from your contract".
  if (isRecordedRetainageRate(input.project?.retainagePercent)) {
    const assumed = input.project?.retainagePercentAssumed === true;
    return {
      percent: input.project!.retainagePercent as number,
      source: 'contract',
      label: assumed ? 'carried from earlier billing — check your contract' : 'from your contract',
      needsAsk: false,
    };
  }

  // 4 — the newest saved G702. A job already certifying at a rate on a signed
  // pay application has answered this question; asking again would be the app
  // failing to read its own records.
  const payApp = (input.payApps ?? [])
    .filter(a => isRecordedRetainageRate(a.retainagePercent))
    .sort((a, b) => (b.applicationNumber ?? 0) - (a.applicationNumber ?? 0))[0];
  if (payApp) {
    return { percent: payApp.retainagePercent, source: 'payApp', label: `same as Pay App #${payApp.applicationNumber}`, needsAsk: false };
  }

  // 5 — nothing on file. The math gets 0 because it must get a number; the
  // screen gets a label that does NOT dress that 0 up as a decision.
  return { percent: 0, source: 'unknown', label: 'not on file — retainage not held', needsAsk: true };
}

/**
 * What to write onto the Project when the GC answers the ask.
 *
 * `null` in (he tapped "Not sure") means `null` out: store NOTHING rather than a
 * guess with a caveat attached, so the next invoice still says "not on file"
 * instead of quietly withholding at a rate nobody confirmed. This is the same
 * rule Project.noticePeriodDays documents, applied one notch stricter — a wrong
 * notice window costs a countdown, a wrong retainage costs billed money.
 *
 * `assumed` is for the back-fill path only: seeding the job from a prior invoice
 * or a pay app records the number but flags that it was never read off a contract.
 */
export function retainageAnswerPatch(
  percent: number | null,
  opts?: { assumed?: boolean },
): Pick<Project, 'retainagePercent' | 'retainagePercentAssumed'> | null {
  if (percent == null || !isRecordedRetainageRate(percent)) return null;
  return { retainagePercent: percent, retainagePercentAssumed: opts?.assumed === true };
}
