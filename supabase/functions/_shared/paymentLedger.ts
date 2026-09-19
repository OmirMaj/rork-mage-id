// _shared/paymentLedger.ts — the QuickBooks side of the invoice payments ledger.
//
// NO Deno imports (only ./paymentMath.ts, which has none either), so
// scripts/validate-qbo-payment-ledger.ts runs these under bun and
// qbo-reconciler (Deno) executes the same file.
//
// Two decisions live here, and both used to be made on a TAG instead of on the
// money:
//
//  1) planQboPaidReconcile — QuickBooks says an invoice is paid (Balance 0).
//     What, if anything, does MAGE's ledger still need?
//
//     The reconciler used to ask only "is there already a source:'qbo' entry?"
//     Payments the GC records in MAGE are pushed by qbo-mapping/payment.ts and
//     tagged source:'mage'; Stripe pay-link payments carry method:'stripe' and
//     no source. Neither matched, so the push itself — which drops the QuickBooks
//     Balance to 0 and bumps the invoice's LastUpdatedTime — put the invoice in
//     the very next pull, and a second full-TotalAmt "qbo" payment dated today
//     was appended. Every invoice paid in full in MAGE with QuickBooks connected
//     was counted twice within one 30-minute cron cycle: 'Received' on Payments,
//     the Cash Flow current balance, the weekly snapshot.
//
//     The rule now: cash already in the ledger counts first. Only a QuickBooks
//     Payment the ledger does not know (by qboId) and only up to the shortfall
//     between QuickBooks' TotalAmt and the cash MAGE already holds is appended —
//     keyed `qbo-payment-<PaymentId>`, dated with that Payment's own TxnDate, so
//     a re-run is a no-op by id rather than by luck.
//
//  2) paymentsToPushToQbo — which ledger entries still have to reach QuickBooks.
//     A payment reached QuickBooks only when the app's updateInvoice fired a
//     push for it, the moment it ran. Pay-link payments (written by the Stripe
//     webhook, server-side) never went; a push that failed — offline queue still
//     holding the invoice write, the invoice not yet in QuickBooks — was never
//     retried. The reconciler now sweeps these on every run.

import { ledgerFrom, ledgerSum, toCents2, type LedgerEntry } from "./paymentMath.ts";

/** A ledger entry as the QuickBooks paths read it. Every field beyond
 *  LedgerEntry is written by qbo-mapping/payment.ts or by the reconciler. */
export interface QboLedgerEntry extends LedgerEntry {
  /** QuickBooks Payment.Id this entry is (or was matched to). */
  qboId?: string;
  /** 'qbo' = came FROM QuickBooks, never pushed back. 'mage' = pushed by MAGE. */
  source?: "mage" | "qbo";
  qboApplied?: number;
  /** Last push failure, so the setup screen and a bookkeeper can see why. */
  qboError?: string;
  /** Failed push attempts by the reconciler. Capped by MAX_PAYMENT_PUSH_ATTEMPTS. */
  qboAttempts?: number;
  /** On a refund / lost-dispute entry whose payment QuickBooks already had:
   *  when the GC said he recorded the reversal in QuickBooks himself (qbo-sync
   *  kind 'reversal'). Until then qbo-setup lists it — nothing posts a
   *  RefundReceipt automatically. */
  qboReversalRecordedAt?: string;
  /** How much of the reversal he said he recorded, positive. Stamped with the
   *  date because the stamp is per ENTRY, not per amount: on current Stripe API
   *  versions the webhook keeps ONE cumulative refund entry per charge and
   *  copies the old entry forward (paymentMath), so a second partial refund
   *  arrives on an entry already stamped. The difference is still listed.
   *  Absent on a stamp from before this field — read as the whole entry. */
  qboReversalRecordedAmount?: number;
}

/** A QuickBooks Payment linked to the invoice, reduced to what the plan needs. */
export interface QboLinkedPayment {
  /** Payment.Id */
  id: string;
  /** Payment.TxnDate — a calendar day ('YYYY-MM-DD'), QuickBooks' own date. */
  txnDate?: string | null;
  /** CASH of this Payment that went to THIS invoice (linkedPaymentCash) — not
   *  the Payment total, and not a credit memo or journal entry it applied. */
  applied: number;
  /** Dollars this Payment cleared on THIS invoice with a credit (a credit
   *  memo, a journal entry) rather than money. Never cash. */
  credit?: number;
  /** Payment.MetaData.CreateTime — when the bookkeeper keyed it (an instant
   *  with QuickBooks' offset). A Payment cannot be the copy of a MAGE payment
   *  it was keyed before. */
  createdAt?: string | null;
  /** The MAGE ledger entry id payment.ts tagged the Payment with, if any. */
  mageEntryId?: string | null;
}

export const MAX_PAYMENT_PUSH_ATTEMPTS = 5;

/**
 * The ledger stores INSTANTS (the app and stripe-webhook write
 * `new Date().toISOString()`), and every reader parses them with `new Date()`:
 * app/invoice.tsx's payment history, cashFlowEngine.getEffectiveStartingBalance.
 * QuickBooks hands us a CALENDAR DAY. Written bare, 'YYYY-MM-DD' parses as UTC
 * midnight — the evening BEFORE in every US timezone — so a payment QuickBooks
 * dated Sep 10 showed as Sep 9, and could fall on the wrong side of the cash
 * balance's as-of instant. Noon UTC is the same calendar day from UTC-11 to
 * UTC+11, which covers every company QuickBooks Online serves in the US.
 */
export function ledgerInstantForDay(day: string | null | undefined): string | undefined {
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  return `${day}T12:00:00.000Z`;
}

/**
 * The push sweep does not reach back before it existed.
 *
 * Before this sweep, a pay-link payment never went to QuickBooks, so a careful
 * bookkeeper keyed it in by hand — often as an unlinked bank deposit, which
 * leaves the QuickBooks invoice open. Nothing links that deposit to the invoice,
 * so exact-amount matching cannot see it and the Balance>0 guard does not fire;
 * pushing the history would post every one of those dollars a second time as
 * income. Payments dated before this floor (or before the QuickBooks connection
 * existed) are left for a person: they stay in qbo-setup's "not in QuickBooks"
 * count, which says to match them by hand.
 */
export const PAYMENT_SWEEP_FLOOR = "2026-09-17T00:00:00.000Z";

/**
 * Written to invoices.qbo_error when QuickBooks shows an invoice paid that no
 * linked Payment explains (a credit memo, a journal entry, a write-off). It is
 * the flag qbo-setup counts and invoice-dunning's cron pauses on — the client
 * is not chased for an invoice the bookkeeper closed. The prefix is plain
 * letters so a PostgREST `like` on it needs no escaping.
 */
export const QBO_CLOSED_WITHOUT_PAYMENT_PREFIX = "QuickBooks shows this invoice closed without a payment";

// The copy used to end "Record the payment in MAGE". Doing that pushed the
// money to QuickBooks a second time, as unapplied credit on top of the credit
// memo (audit #10) — so it now says what is actually safe.
export function closedWithoutPaymentNote(unexplained: number, creditApplied = 0): string {
  const credit = toCents2(Number(creditApplied) || 0);
  const how = credit >= CENT
    ? `(including $${credit.toFixed(2)} of credit — a credit memo or journal entry — that a QuickBooks payment applied, not money)`
    : "(a credit memo, journal entry or write-off)";
  return `${QBO_CLOSED_WITHOUT_PAYMENT_PREFIX}: $${toCents2(unexplained).toFixed(2)} was cleared by something other than a payment ${how}. MAGE did not count it as cash received, and automatic reminders to the client are paused. Check the invoice in QuickBooks; if the client really paid, reverse the credit memo or journal entry there first, then record the payment.`;
}

/**
 * QuickBooks shows the invoice paid, and it counts money MAGE holds as
 * refunded or charged back (audit #100). ledgerCashReceived deliberately
 * ignores reversals so refunded money is never booked back — which left the
 * disagreement silent: MAGE short, QuickBooks paid, reminders still going.
 * Same prefix, so dunning pauses and qbo-setup lists it; NOT the credit-memo
 * wording, which would be false here.
 */
export function refundGapNote(gap: number, reversed: number, uncountedQboIds: readonly string[]): string {
  const ids = uncountedQboIds.length > 0
    ? ` QuickBooks payment${uncountedQboIds.length === 1 ? "" : "s"} ${uncountedQboIds.join(", ")} ${uncountedQboIds.length === 1 ? "was" : "were"} not counted in MAGE.`
    : "";
  return `${QBO_CLOSED_WITHOUT_PAYMENT_PREFIX}: QuickBooks counts $${toCents2(gap).toFixed(2)} more than MAGE holds — MAGE recorded $${toCents2(reversed).toFixed(2)} of this invoice's receipts as refunded or charged back.${ids} Either the client paid again, or QuickBooks still carries the refunded money. Automatic reminders are paused; check the invoice in QuickBooks.`;
}

/**
 * The invoice was VOIDED in QuickBooks (TotalAmt and Balance 0) while MAGE
 * still has money outstanding on it (audit #101). The pull used to skip it
 * silently and invoice-dunning chased the client up to FINAL NOTICE. The void
 * bumps LastUpdatedTime once, so this is written once and nothing else strips
 * it. MAGE's own status is not changed — whether the void is right is his call.
 * The text is shown verbatim on the invoice screen, so it names only steps MAGE
 * has: invoices have no void or delete (InvoiceStatus, entityActions).
 */
export function voidedInQuickBooksNote(): string {
  return `${QBO_CLOSED_WITHOUT_PAYMENT_PREFIX}: it was voided in QuickBooks. Automatic reminders to the client are paused, but the invoice's Pay link still works. If the void is right, add a note to the invoice in MAGE saying so; if not, fix it in QuickBooks.`;
}

/** The flag for an invoice QuickBooks shows with TotalAmt 0 and Balance 0, or
 *  null — a genuine $0 invoice, or nothing outstanding in MAGE, is not flagged. */
export function voidFlagFor(input: { totalAmt: unknown; balance: unknown; mageOutstanding: number }): string | null {
  const total = Number(input.totalAmt), bal = Number(input.balance);
  if (!Number.isFinite(total) || !Number.isFinite(bal)) return null;
  if (Math.round(total * 100) !== 0 || Math.round(bal * 100) !== 0) return null;
  return toCents2(input.mageOutstanding) >= CENT ? voidedInQuickBooksNote() : null;
}

export function isClosedWithoutPaymentNote(qboError: unknown): boolean {
  return typeof qboError === "string" && qboError.startsWith(QBO_CLOSED_WITHOUT_PAYMENT_PREFIX);
}

/**
 * The flag shares invoices.qbo_error with every push outcome — a tax note on a
 * good push, the reason on a failed one. Those writers used to overwrite it, so
 * any invoice push (a send or a retainage release moves due_date, which moves
 * the hash) silently lifted the dunning pause until the next reconcile put it
 * back. Now a writer KEEPS the flag at the front, where startsWith() still sees
 * it, and appends its own message after this separator.
 *
 * TWIN: qbo-mapping/invoice.ts carries a copy of this function (validate-money-
 * definitions runs that file in a sandbox holding only its own siblings);
 * scripts/validate-qbo-payment-ledger.ts executes both copies on the same cases.
 */
export const QBO_ERROR_APPEND_SEP = "\n\nAlso: ";

/** The closed-without-payment flag part of a qbo_error, or null. */
export function closedFlagOf(qboError: unknown): string | null {
  if (!isClosedWithoutPaymentNote(qboError)) return null;
  return (qboError as string).split(QBO_ERROR_APPEND_SEP)[0];
}

/** Everything in a qbo_error EXCEPT the flag — what is left when the flag lifts. */
export function withoutClosedFlag(qboError: unknown): string | null {
  if (typeof qboError !== "string" || qboError === "") return null;
  if (!isClosedWithoutPaymentNote(qboError)) return qboError;
  const at = qboError.indexOf(QBO_ERROR_APPEND_SEP);
  return at < 0 ? null : qboError.slice(at + QBO_ERROR_APPEND_SEP.length) || null;
}

/** The qbo_error to write when a push reports `next`, given what the row holds. */
export function keepClosedFlag(existing: unknown, next: string | null): string | null {
  const flag = closedFlagOf(existing);
  if (!flag) return next;
  return next ? `${flag}${QBO_ERROR_APPEND_SEP}${next}` : flag;
}

/**
 * The qbo_error change the reconciler's pull makes for the "closed in
 * QuickBooks without a payment" flag: set it (keeping whatever followed it),
 * lift it (keeping the rest), or nothing. Applies to an invoice whose own push
 * is in 'error' too — it used to be skipped so the push error was not written
 * over, which left invoice-dunning's cron chasing the client for an invoice
 * the bookkeeper had closed. keepClosedFlag keeps the push error after the
 * separator, so both messages stand.
 */
export function closedFlagChange(qboError: unknown, flag: string | null): { qbo_error?: string | null } {
  if (flag && closedFlagOf(qboError) !== flag) return { qbo_error: keepClosedFlag(flag, withoutClosedFlag(qboError)) };
  if (!flag && isClosedWithoutPaymentNote(qboError)) return { qbo_error: withoutClosedFlag(qboError) };
  return {};
}

/**
 * Why the push sweep must NOT send this payment, or null to send it.
 *
 * payment.ts never applies more than QuickBooks shows open — the excess becomes
 * unapplied customer credit. That is right for a genuine overpayment typed in
 * the app, and wrong for the sweep's usual reason for a short balance: the
 * bookkeeper already keyed this payment in (net of Stripe's fee, or split), so
 * pushing it posts the same income twice. The sweep cannot tell those apart,
 * so it does not guess; it records why on the payment for a person.
 * Compared in whole cents: money is exact to the cent, never to a float.
 *
 * `taxShortfall` is the one short balance that is NOT a duplicate: QuickBooks'
 * Automated Sales Tax charged less tax than MAGE did (qbo-mapping/invoice.ts
 * accepts that invoice as synced — the work total matches). The client paid
 * MAGE's figure, so the final payment is over QuickBooks' balance by exactly
 * that tax gap. Refusing it left the invoice open in QuickBooks forever while
 * MAGE showed it paid, and blamed a hand-entered payment that did not exist.
 * Within the allowance the payment is pushed and payment.ts records the gap as
 * its noted unapplied credit — the same thing qbo-sync does for a check the GC
 * records in the app. The caller passes 0 when QuickBooks holds linked money
 * the ledger cannot account for: then a short balance may well be a duplicate.
 */
/**
 * The zero-balance refusal. TWIN: qbo-mapping/payment.ts throws this exact
 * sentence (inlined — validate-money-definitions runs that file in a sandbox
 * holding only its siblings), because the app's own push used to post at
 * Balance 0 anyway: a TotalAmt with no Line, i.e. the whole payment as
 * unapplied customer credit on top of the credit memo that closed the invoice
 * (audit #10). qbo-setup reads the "already shows invoice" wording as
 * 'refused'. validate-qbo-payment-ledger pins the two equal.
 */
export function alreadyPaidRefusal(invoiceNumber: number | string): string {
  return `QuickBooks already shows invoice #${invoiceNumber} paid, so this payment was not sent (it would be recorded twice). Check the invoice in QuickBooks.`;
}

export function sweepPushRefusal(
  entryAmount: number,
  qboBalance: number,
  invoiceNumber: number | string,
  taxShortfall = 0,
): string | null {
  if (!Number.isFinite(qboBalance)) return null; // payment.ts re-reads and refuses blind itself
  const balanceCents = Math.round(qboBalance * 100);
  const amountCents = Math.round(Number(entryAmount) * 100);
  const allowanceCents = Number.isFinite(taxShortfall) && taxShortfall > 0 ? Math.round(taxShortfall * 100) : 0;
  if (balanceCents <= 0) return alreadyPaidRefusal(invoiceNumber);
  if (amountCents > balanceCents + allowanceCents + 1) {
    return `QuickBooks shows only $${(balanceCents / 100).toFixed(2)} open on invoice #${invoiceNumber}, less than this $${(amountCents / 100).toFixed(2)} payment, so it was not sent; MAGE will not send it while QuickBooks shows less open. `
      + `Check whether this payment was already entered in QuickBooks, or whether QuickBooks recalculated the invoice total (its own sales tax), then match it there by hand.`;
  }
  return null;
}

/**
 * How much LESS sales tax QuickBooks charged than MAGE on this invoice — the
 * allowance sweepPushRefusal gives a final payment. 0 when QuickBooks charged
 * the same or more, or when its tax is not on the read (no TxnTaxDetail: then
 * the gap cannot be told from a duplicate, so no allowance — the safe side).
 */
export function qboTaxShortfall(mageTax: unknown, qboTotalTax: unknown): number {
  const mage = Number(mageTax);
  if (typeof qboTotalTax !== "number" || !Number.isFinite(qboTotalTax) || !Number.isFinite(mage)) return 0;
  const gapCents = Math.round(mage * 100) - Math.round(qboTotalTax * 100);
  return gapCents > 0 ? gapCents / 100 : 0;
}

/**
 * True when a push failed because QuickBooks or the connection is down, not
 * because of this payment: 401 after qboFetch's own refresh, 403, 408, 429,
 * 5xx, a timeout, a network failure, a token refresh, or MAGE's own database
 * read/write. The sweep rethrows these so the user's run aborts WITHOUT
 * charging the payment's MAX_PAYMENT_PUSH_ATTEMPTS — an outage used to spend
 * the retries of payments that were never wrong. Anything else (a 400
 * validation fault, a project with no QuickBooks customer) is this payment's
 * own problem and is charged, or it would stall the run forever.
 */
export function isQboOutageError(e: unknown): boolean {
  const msg = String((e as Error)?.message ?? e ?? "");
  const name = String((e as Error)?.name ?? "");
  if (/^QBO (401|403|408|429|5\d\d) /.test(msg)) return true;
  if (/^Intuit (token refresh|OAuth not configured)/.test(msg)) return true;
  if (/^(qbo_connections (read|write) failed|invoice (read|update|re-read): )/.test(msg)) return true;
  if (name === "AbortError" || name === "TimeoutError") return true;
  return /signal has been aborted|timed out|error sending request|connection (reset|refused|closed)|network error|fetch failed/i.test(msg);
}

/**
 * Where the invoice pull resumes next run (qbo_connections.last_sync_at).
 *
 * It used to be stamped `now` at the END of the run, over a query with no
 * ORDERBY and MAXRESULTS 200: a payment the bookkeeper recorded in QuickBooks
 * while the run was working was never pulled, and neither was anything past
 * the first 200 (a first run on a real company). The client kept being dunned
 * for an invoice QuickBooks shows paid. Re-reading is safe —
 * planQboPaidReconcile is idempotent by qbo-payment-<Id> — so:
 *  - a full page resumes from the newest LastUpdatedTime it saw (the query is
 *    ordered ascending with `>=`, so a same-second tail is re-read, not lost);
 *    a page that made no forward progress steps one second past the cursor;
 *  - caught up, it stamps the QUERY START minus a 5-minute overlap (Intuit
 *    clock skew, late-committing transactions), never moving backwards.
 * Same rule as the cost pull's per-entity cursors in qbo-reconciler.
 */
export const INVOICE_PULL_PAGE_SIZE = 200;
export const INVOICE_PULL_LOOKBACK_MS = 5 * 60 * 1000;

export function nextInvoicePullCursor(input: {
  sinceIso: string | null | undefined;
  queryStartMs: number;
  rows: readonly { MetaData?: { LastUpdatedTime?: string } }[];
}): string {
  const sinceMs = Date.parse(input.sinceIso ?? "") || 0;
  let maxSeenMs = 0;
  for (const r of input.rows) {
    const ms = Date.parse(r?.MetaData?.LastUpdatedTime ?? "");
    if (!Number.isNaN(ms) && ms > maxSeenMs) maxSeenMs = ms;
  }
  if (input.rows.length >= INVOICE_PULL_PAGE_SIZE && maxSeenMs > 0) {
    return new Date(maxSeenMs > sinceMs ? maxSeenMs : sinceMs + 1000).toISOString();
  }
  return new Date(Math.max(sinceMs, input.queryStartMs - INVOICE_PULL_LOOKBACK_MS)).toISOString();
}

/**
 * True when a QuickBooks error is about ONE object (this invoice or this
 * payment), not the connection. qboFetch throws `QBO <status> <path>: ...`.
 * A GET for an invoice deleted in QuickBooks, or one whose stored qbo_id
 * belongs to a company the GC has since disconnected from, answers 400
 * "Object Not Found" (or 404). That must be charged to the payments on that
 * invoice and skipped — thrown out of the user's run, it stalled the pull,
 * the cost staging and the cursor for that GC every 30 minutes, forever.
 * 401 (after qboFetch's own refresh), 403, 429, 5xx, timeouts and token
 * refresh failures are the connection or QuickBooks, and still abort the run.
 */
export function isPerObjectQboError(e: unknown): boolean {
  const msg = String((e as Error)?.message ?? e ?? "");
  return /^QBO (400|404) /.test(msg);
}

const CENT = 0.01;

/** Cash IN the ledger: positive entries only. A refund or lost dispute is a
 *  reversal of money that did arrive once; QuickBooks' Balance 0 does not
 *  un-refund it, so it must not open a "shortfall" that re-adds refunded cash. */
export function ledgerCashReceived(ledger: readonly LedgerEntry[]): number {
  return toCents2(ledger.reduce((s, e) => {
    const n = Number(e.amount ?? 0);
    return Number.isFinite(n) && n > 0 ? s + n : s;
  }, 0));
}

/** A QuickBooks Payment as the reconciler reads it (GET /payment/<id>). */
export interface QboPaymentRead {
  Id?: string;
  TxnDate?: string;
  TotalAmt?: unknown;
  PrivateNote?: string;
  MetaData?: { CreateTime?: string };
  Line?: { Amount?: unknown; LinkedTxn?: { TxnId?: string; TxnType?: string }[] }[];
}

/**
 * How much of a QuickBooks Payment reached ONE invoice as CASH, and how much
 * as credit (audit #9).
 *
 * The reconciler used to add up every Line linked to the invoice and call it
 * money. QuickBooks' own "apply a credit memo" flow is a Payment of TotalAmt
 * $0.00 whose lines link the invoice ($10,000) AND the credit memo ($10,000),
 * so a write-off became $10,000 "received": Payments, the Cash Flow balance,
 * and the closed-without-a-payment flag — built for exactly this — never fired.
 *
 * Intuit's rule: TotalAmt = invoice lines − credit lines + unapplied cash. So
 * the cash that went into invoices is (invoice lines − credit lines), never
 * more than TotalAmt. QuickBooks does not say WHICH invoice a credit went to
 * when one Payment covers several, so the cash is shared out pro rata by the
 * invoice lines — `min(invoiceLinked, TotalAmt)` would hand the whole check to
 * every invoice. Any linked line that is not an Invoice (CreditMemo,
 * JournalEntry, anything else) counts as credit: the side that never books
 * cash that cannot be proved. Rounded to the cent, clamped to [0, linked].
 */
export function linkedPaymentCash(pay: QboPaymentRead | null | undefined, invoiceQboId: string): { cash: number; credit: number } {
  let toThis = 0, toInvoices = 0, credits = 0;
  for (const line of pay?.Line ?? []) {
    const amt = Math.abs(Number(line?.Amount) || 0);
    const links = line?.LinkedTxn ?? [];
    if (links.length === 0) continue;
    if (links.some((t) => t?.TxnType === "Invoice")) {
      toInvoices += amt;
      if (links.some((t) => t?.TxnType === "Invoice" && String(t.TxnId) === String(invoiceQboId))) toThis += amt;
    } else {
      credits += amt;
    }
  }
  toThis = toCents2(toThis);
  if (toThis <= 0 || toInvoices <= 0) return { cash: 0, credit: 0 };
  let pool = Math.max(0, toInvoices - credits);
  const total = Number(pay?.TotalAmt);
  if (pay?.TotalAmt != null && Number.isFinite(total)) pool = Math.min(pool, Math.max(0, total));
  const cash = Math.min(toThis, Math.max(0, toCents2(toThis * pool / toInvoices)));
  return { cash, credit: toCents2(toThis - cash) };
}

/**
 * payment.ts tags every Payment it posts with the MAGE entry it came from, in
 * the internal-only PrivateNote. A Payment that carries the tag is matched to
 * THAT entry exactly — the "posted, then failed to save the id" case no longer
 * rides on amount-matching. TWIN: payment.ts writes the same tag (inlined; see
 * alreadyPaidRefusal); validate-qbo-payment-ledger pins the two.
 */
export function magePaymentTag(entryId: string): string {
  return `[MAGE payment ${entryId}]`;
}
export function mageEntryIdFromNote(note: unknown): string | null {
  if (typeof note !== "string") return null;
  const m = /\[MAGE payment ([^\]\s]+)\]/.exec(note);
  return m ? m[1] : null;
}

/** One QuickBooks Payment, reduced to what the plan and the matcher read. */
export function toLinkedPayment(pay: QboPaymentRead, invoiceQboId: string, id?: string): QboLinkedPayment {
  const { cash, credit } = linkedPaymentCash(pay, invoiceQboId);
  return {
    id: String(id ?? pay.Id ?? ""),
    txnDate: pay.TxnDate ?? null,
    applied: cash,
    ...(credit >= CENT ? { credit } : {}),
    createdAt: pay.MetaData?.CreateTime ?? null,
    mageEntryId: mageEntryIdFromNote(pay.PrivateNote),
  };
}

/** QuickBooks Payment ids this ledger already accounts for. */
export function knownQboPaymentIds(ledger: readonly QboLedgerEntry[]): Set<string> {
  const ids = new Set<string>();
  for (const e of ledger) {
    if (e.qboId) ids.add(String(e.qboId));
    const m = /^qbo-payment-(.+)$/.exec(e.id);
    if (m) ids.add(m[1]);
  }
  return ids;
}

/** Linked QuickBooks Payments this ledger does not already name, oldest first
 *  (then by id) so every plan built from them is deterministic. A Payment
 *  carrying less than a cent of CASH (a pure credit application) is not here:
 *  it can be neither booked as cash nor matched to money MAGE collected. */
export function unknownLinkedPayments(
  ledger: readonly QboLedgerEntry[],
  linkedPayments: readonly QboLinkedPayment[],
): QboLinkedPayment[] {
  const known = knownQboPaymentIds(ledger);
  return linkedPayments
    .filter((p) => p && p.id && !known.has(String(p.id)) && toCents2(Number(p.applied) || 0) >= CENT)
    .slice()
    .sort((a, b) => String(a.txnDate ?? "").localeCompare(String(b.txnDate ?? "")) || String(a.id).localeCompare(String(b.id)));
}

/** A Payment keyed more than this before the MAGE payment cannot be its copy.
 *  One calendar day of slack plus 12 hours for the gap between a date-only
 *  entry read as UTC midnight and any US company's clock. */
export const MATCH_CREATED_SLACK_MS = 36 * 3600 * 1000;
/** A hand-keyed copy of a Pay-link payment is dated about when the money
 *  arrived (the charge, or the payout a few business days later). A check the
 *  bookkeeper keyed in a late batch keeps its own, older date. */
export const MATCH_TXN_DATE_WINDOW_DAYS = 7;

function entryInstantMs(e: QboLedgerEntry): number {
  const raw = typeof e.receivedAt === "string" && e.receivedAt ? e.receivedAt : e.date;
  if (typeof raw !== "string" || raw === "") return NaN;
  // A bare calendar day (utils/calendarDate semantics): the START of that day.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return Date.parse(`${raw}T00:00:00Z`);
  return Date.parse(raw);
}
function dayIndex(s: unknown): number {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(s)) return NaN;
  return Math.round(Date.parse(`${s.slice(0, 10)}T00:00:00Z`) / 86_400_000);
}

/**
 * Could untagged QuickBooks Payment `p` be the copy of MAGE entry `e`? Returns
 * how far apart they were keyed (for choosing the closest), or null.
 *
 * Amount alone was the rule (audit #11): a $10,000 check the bookkeeper keyed
 * on Oct 1 swallowed a $10,000 Pay-link payment on Oct 20 — stamped "in
 * QuickBooks", never pushed, the client dunned for money he had paid. Every
 * case matching exists for is a Payment keyed AFTER MAGE had the money, so:
 * same cents, keyed no earlier than the entry's day less a day, and — when
 * QuickBooks carries a TxnDate — dated within a week of it (a late-keyed batch
 * check keeps its own date). A Payment with no CreateTime is not matchable.
 * When nothing qualifies the push goes ahead; sweepPushRefusal still refuses
 * a real duplicate once QuickBooks shows less open than the payment.
 */
export function pairDistanceMs(e: QboLedgerEntry, p: QboLinkedPayment): number | null {
  if (Math.round(Number(p.applied) * 100) !== Math.round(Number(e.amount) * 100)) return null;
  const created = typeof p.createdAt === "string" ? Date.parse(p.createdAt) : NaN;
  const at = entryInstantMs(e);
  if (!Number.isFinite(created) || !Number.isFinite(at)) return null;
  if (created < at - MATCH_CREATED_SLACK_MS) return null;
  const txnDay = dayIndex(p.txnDate);
  if (Number.isFinite(txnDay)) {
    // The day he says the money arrived wins (a bare day, billing-contract
    // #133): a cheque he backdates more than the window and a bookkeeper's
    // hand-keyed copy dated the same day still pair. Else the recorded instant.
    const entryDay = dayIndex(
      typeof e.receivedDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.receivedDate) ? e.receivedDate
        : typeof e.receivedAt === "string" && e.receivedAt ? e.receivedAt : e.date,
    );
    if (!Number.isFinite(entryDay) || Math.abs(txnDay - entryDay) > MATCH_TXN_DATE_WINDOW_DAYS) return null;
  }
  return Math.abs(created - at);
}

/**
 * Pair ledger entries QuickBooks has not been given with QuickBooks Payments
 * the ledger does not name, one-to-one.
 *
 * This is what makes the push sweep safe to run at all. An entry can lack its
 * qboId while QuickBooks HAS the money: a bookkeeper keyed the pay-link payment
 * in by hand; payment.ts posted the Payment and then failed to save the id; or
 * the app rewrote `payments` from a local copy that predates the id (updateInvoice
 * writes the whole array). Pushing any of those again is the same check twice
 * in the books. Matching turns each into a stamped qboId instead.
 *
 * First by payment.ts's tag (exact), then untagged Payments by pairDistanceMs,
 * the closest-keyed one winning so the result is deterministic. A tagged
 * Payment belongs to the entry it names and is never paired by amount.
 */
export function matchUnpushedPayments(
  ledger: readonly QboLedgerEntry[],
  unknown: readonly QboLinkedPayment[],
): { ledger: QboLedgerEntry[]; matches: { entryId: string; qboId: string }[] } {
  const next = [...ledger];
  const matches: { entryId: string; qboId: string }[] = [];
  const used = new Set<string>();
  const stamp = (i: number, p: QboLinkedPayment) => {
    const e = next[i];
    used.add(String(p.id));
    const { qboError: _drop, ...rest } = e;
    void _drop;
    next[i] = { ...rest, qboId: String(p.id) };
    matches.push({ entryId: e.id, qboId: String(p.id) });
  };
  const open = next.map((e, i) => (needsQboPush(e, ledger) ? i : -1)).filter((i) => i >= 0);
  const done = new Set<number>();
  for (const i of open) {
    const tagged = unknown.find((p) => !used.has(String(p.id)) && p.mageEntryId === next[i].id);
    if (tagged) { stamp(i, tagged); done.add(i); }
  }
  for (const i of open) {
    if (done.has(i)) continue;
    let best: QboLinkedPayment | null = null, bestD = Infinity;
    for (const p of unknown) {
      if (used.has(String(p.id)) || p.mageEntryId) continue;
      const d = pairDistanceMs(next[i], p);
      if (d !== null && d < bestD) { best = p; bestD = d; }
    }
    if (best) stamp(i, best);
  }
  return { ledger: next, matches };
}

/** Write matches onto a FRESH read of the ledger, by entry id. Null = nothing to write. */
export function applyQboMatches(
  payments: unknown,
  matches: readonly { entryId: string; qboId: string }[],
): QboLedgerEntry[] | null {
  const ledger = ledgerFrom(payments) as QboLedgerEntry[];
  let changed = false;
  const next = ledger.map((e) => {
    const m = matches.find((x) => x.entryId === e.id);
    if (!m || e.qboId) return e;
    changed = true;
    const { qboError: _drop, ...rest } = e;
    void _drop;
    return { ...rest, qboId: m.qboId };
  });
  return changed ? next : null;
}

export interface QboPaidReconcilePlan {
  /** Entries to append (already in `ledger`). */
  appended: QboLedgerEntry[];
  /** Ids of MAGE entries matched to a QuickBooks Payment the bookkeeper keyed
   *  in by hand (qboId stamped, nothing appended). */
  matched: string[];
  /** True when `ledger` differs from the stored one and must be written. */
  changed: boolean;
  /** The ledger to write when `changed`. */
  ledger: QboLedgerEntry[];
  /** amount_paid recomputed FROM the ledger — never QuickBooks' TotalAmt. */
  amountPaid: number;
  /** Dollars QuickBooks calls paid that no linked Payment explains (a credit
   *  memo, a journal entry, a discount). Not cash, so never booked as cash. */
  unexplained: number;
  /** Credit (not cash) the linked Payments applied to this invoice. */
  creditApplied: number;
  /** QuickBooks paid, nothing unexplained, yet MAGE's NET ledger is short of
   *  TotalAmt: reversed (refunded / charged-back) cash fills the gap. */
  refundGap: number;
  /** Unknown linked Payments neither matched nor booked — what to look at. */
  uncountedQboIds: string[];
}

/**
 * QuickBooks reports the invoice paid in full. Decide what MAGE's ledger needs.
 *
 * `totalAmt` is QuickBooks' Invoice.TotalAmt — what QuickBooks considers owed
 * (net of retainage still held, see qbo-mapping/invoice.ts). `linkedPayments`
 * are the Payments linked to the invoice (Invoice.LinkedTxn, TxnType Payment),
 * each already reduced to its CASH on this invoice (linkedPaymentCash).
 */
export function planQboPaidReconcile(input: {
  payments: unknown;
  totalAmt: number;
  linkedPayments: readonly QboLinkedPayment[];
  /** Calendar day used only when a Payment carries no TxnDate — the day
   *  QuickBooks last changed the invoice, never "today" by default. */
  fallbackDate?: string;
}): QboPaidReconcilePlan {
  const stored = ledgerFrom(input.payments) as QboLedgerEntry[];
  const totalAmt = toCents2(Math.max(0, Number(input.totalAmt) || 0));
  const unknown = unknownLinkedPayments(stored, input.linkedPayments);
  const known = knownQboPaymentIds(stored);
  const creditApplied = toCents2(input.linkedPayments
    .filter((p) => p && p.id && !known.has(String(p.id)))
    .reduce((s, p) => s + (Number(p.credit) || 0), 0));

  // MATCH before adding. A pay-link payment MAGE has not pushed yet that the
  // bookkeeper already keyed into QuickBooks is ONE payment seen from both
  // sides. Stamping its qboId records that, and stops the push sweep from
  // sending it over a second time.
  const m = matchUnpushedPayments(stored, unknown);
  const ledger = m.ledger;
  const matched = m.matches.map((x) => x.entryId);
  const used = new Set(m.matches.map((x) => x.qboId));

  const received = ledgerCashReceived(ledger);
  let remaining = toCents2(totalAmt - received);

  const appended: QboLedgerEntry[] = [];
  // Covered within a cent: the money QuickBooks calls paid is money MAGE
  // already has (its own push, a Stripe payment, or both). Nothing to add.
  for (const p of unknown) {
    if (remaining < CENT) break;
    if (used.has(p.id)) continue;
    const applied = toCents2(Number(p.applied));
    const amount = toCents2(Math.min(applied, remaining));
    if (amount < CENT) continue;
    const txnDate = ledgerInstantForDay(
      typeof p.txnDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(p.txnDate)
        ? p.txnDate.slice(0, 10)
        : input.fallbackDate,
    );
    appended.push({
      id: `qbo-payment-${p.id}`,
      amount,
      method: "qbo",
      kind: "payment",
      source: "qbo",
      qboId: String(p.id),
      ...(txnDate ? { date: txnDate } : {}),
      notes: amount < applied
        ? `Recorded in QuickBooks (payment ${p.id}); $${amount.toFixed(2)} of $${applied.toFixed(2)} counted, the rest was already in MAGE`
        : `Recorded in QuickBooks (payment ${p.id})`,
    });
    remaining = toCents2(remaining - amount);
  }

  const next = [...ledger, ...appended];
  const amountPaid = ledgerSum(next);
  const unexplained = remaining >= CENT ? remaining : 0;
  // Only when everything QuickBooks calls paid is explained by cash MAGE
  // received at some point: then a NET shortfall can only be money MAGE has
  // since recorded as going back out. (Unexplained takes precedence — its
  // flag already pauses the reminders and names the credit.)
  const netShort = toCents2(totalAmt - amountPaid);
  const refundGap = unexplained === 0 && netShort >= CENT ? netShort : 0;
  const booked = new Set(appended.map((a) => String(a.qboId)));
  return {
    appended,
    matched,
    changed: appended.length > 0 || matched.length > 0,
    ledger: next,
    amountPaid,
    unexplained,
    creditApplied,
    refundGap,
    uncountedQboIds: unknown.filter((p) => !used.has(String(p.id)) && !booked.has(String(p.id))).map((p) => String(p.id)),
  };
}

/** Sum of the reversals (refunds, lost disputes) in a ledger, as a positive number. */
function reversedCash(ledger: readonly LedgerEntry[]): number {
  return toCents2(ledger.reduce((s, e) => {
    const n = Number(e.amount ?? 0);
    return Number.isFinite(n) && n < 0 ? s - n : s;
  }, 0));
}

/** The closed-in-QuickBooks flag this plan calls for, or null to lift it. */
export function closedFlagForPlan(plan: QboPaidReconcilePlan): string | null {
  if (plan.unexplained > 0) return closedWithoutPaymentNote(plan.unexplained, plan.creditApplied);
  if (plan.refundGap > 0) return refundGapNote(plan.refundGap, reversedCash(plan.ledger), plan.uncountedQboIds);
  return null;
}

/** Cash MAGE holds that QuickBooks has not been given — refunded or not. */
export function isUnsyncedCash(e: QboLedgerEntry): boolean {
  if (!e || typeof e.id !== "string") return false;
  if (e.qboId) return false;                         // already in QuickBooks
  if (e.source === "qbo" || e.method === "qbo") return false; // came FROM QuickBooks
  if (e.kind === "refund" || e.kind === "dispute") return false; // not a Payment
  const n = Number(e.amount ?? 0);
  return Number.isFinite(n) && n > 0;
}

/** True when a refund or dispute entry reverses (some of) this payment. The
 *  webhook keys both sides by PaymentIntent. */
function isReversed(e: QboLedgerEntry, ledger: readonly QboLedgerEntry[]): boolean {
  if (!e.paymentIntentId) return false;
  return ledger.some((r) =>
    r !== e && (r.kind === "refund" || r.kind === "dispute") && r.paymentIntentId === e.paymentIntentId);
}

/**
 * True when the sweep may push this entry. A payment Stripe has since refunded
 * or lost in a dispute is NOT pushed: a QuickBooks Payment for money that went
 * back out overstates the books, and the right QuickBooks record (a refund
 * receipt, or the net) is a bookkeeper's call. It stays in the "not in
 * QuickBooks" count so somebody makes it.
 */
export function needsQboPush(e: QboLedgerEntry, ledger: readonly QboLedgerEntry[] = []): boolean {
  return isUnsyncedCash(e) && !isReversed(e, ledger);
}

/** Entries the reconciler should (re)try pushing now — not yet given up on,
 *  and dated on or after `notBefore` (see PAYMENT_SWEEP_FLOOR). An entry with
 *  no readable date is left for a person rather than guessed at. */
export function paymentsToPushToQbo(
  payments: unknown,
  opts: { notBefore?: string | null } = {},
): QboLedgerEntry[] {
  const ledger = ledgerFrom(payments) as QboLedgerEntry[];
  const floorMs = opts.notBefore ? Date.parse(opts.notBefore) : NaN;
  return ledger.filter((e) => {
    if (!needsQboPush(e, ledger) || (e.qboAttempts ?? 0) >= MAX_PAYMENT_PUSH_ATTEMPTS) return false;
    if (!Number.isFinite(floorMs)) return true;
    const at = typeof e.date === "string" ? Date.parse(e.date) : NaN;
    return Number.isFinite(at) && at >= floorMs;
  });
}

/** The later of the sweep floor and the day the QuickBooks connection was made. */
export function paymentSweepFloor(connectionCreatedAt: string | null | undefined): string {
  const conn = connectionCreatedAt ? Date.parse(connectionCreatedAt) : NaN;
  const floor = Date.parse(PAYMENT_SWEEP_FLOOR);
  return Number.isFinite(conn) && conn > floor ? new Date(conn).toISOString() : PAYMENT_SWEEP_FLOOR;
}

/**
 * Read-only repair report for ledgers the OLD reconciler already doubled
 * (synthetic `qbo-<InvoiceId>-<epochMs>` entries appended on top of money MAGE
 * held). Not run by anything — a person runs it in the SQL editor and fixes each
 * row by hand, because which copy to keep is a bookkeeping decision.
 */
export const LEGACY_DOUBLED_LEDGER_REPORT_SQL = `
select i.user_id, i.id, i.number, i.total_due, i.amount_paid,
       sum((e->>'amount')::numeric) filter (where (e->>'amount')::numeric > 0) as cash_in_ledger,
       jsonb_agg(e) filter (where e->>'id' ~ '^qbo-[^-]+-[0-9]{12,}$') as legacy_qbo_entries
from public.invoices i
cross join lateral jsonb_array_elements(case when jsonb_typeof(i.payments) = 'array' then i.payments else '[]'::jsonb end) e
group by i.user_id, i.id, i.number, i.total_due, i.amount_paid
having bool_or(e->>'id' ~ '^qbo-[^-]+-[0-9]{12,}$')
   and sum((e->>'amount')::numeric) filter (where (e->>'amount')::numeric > 0) > i.total_due + 0.01
order by i.user_id, i.number;
`;

/** Every payment QuickBooks does not have — retries exhausted, refunded, or
 *  pending — what the setup screen reports as "payments not in QuickBooks". */
export function countPaymentsNotInQbo(payments: unknown): number {
  return (ledgerFrom(payments) as QboLedgerEntry[]).filter(isUnsyncedCash).length;
}

/** A refund or lost dispute of a payment QuickBooks already HAS (audit #97). */
export interface QboReversalNotInQbo {
  entryId: string;
  /** The reversal's own amount, positive — partial refunds happen. */
  amount: number;
  kind: "refund" | "dispute";
  /** The QuickBooks Payment still carrying the money, for the bookkeeper. */
  paymentQboId: string;
}

/**
 * Money MAGE sent to QuickBooks that has since gone back out. Once the sweep
 * pushed Pay-link payments, a refund or a lost chargeback left QuickBooks
 * holding the cash, while both counters skipped the reversal (not a Payment)
 * AND the original (it has a qboId) — so qbo-setup showed the green "every
 * payment is in QuickBooks". Nothing posts a RefundReceipt automatically: how
 * to record it (refund receipt, or delete the payment) is the bookkeeper's
 * call, the same rule needsQboPush follows for an unpushed refund. A reversal
 * of a payment that was never pushed is NOT listed here — the original is
 * already counted as not in QuickBooks, and counting both would say it twice.
 * TWIN: app/qbo-setup.tsx (pinned by validate-qbo-payment-ledger).
 */
export function reversalsNotInQbo(payments: unknown): QboReversalNotInQbo[] {
  const ledger = ledgerFrom(payments) as QboLedgerEntry[];
  const out: QboReversalNotInQbo[] = [];
  for (const r of ledger) {
    if (!r || (r.kind !== "refund" && r.kind !== "dispute")) continue;
    const amt = Number(r.amount ?? 0);
    if (!Number.isFinite(amt) || amt > -CENT || r.qboId || !r.paymentIntentId) continue;
    // What is still unrecorded: the whole reversal, less what he already said
    // he recorded. A second partial refund grows the same entry past its stamp.
    const recorded = r.qboReversalRecordedAt ? Number(r.qboReversalRecordedAmount ?? -amt) : 0;
    const open = toCents2(-amt - (Number.isFinite(recorded) ? recorded : 0));
    if (open < CENT) continue;
    const orig = ledger.find((e) => e !== r && e.paymentIntentId === r.paymentIntentId && Number(e.amount) > 0 && e.qboId);
    if (!orig) continue;
    out.push({ entryId: r.id, amount: open, kind: r.kind, paymentQboId: String(orig.qboId) });
  }
  return out;
}

/** Stamp "recorded in QuickBooks by hand" on one reversal, on a FRESH read by
 *  id (never a stale copy of the ledger). Null = gone, or not such a reversal.
 *
 *  `listedAmount` is the open amount qbo-setup SHOWED him on the line he
 *  tapped (round 4). Stripe keeps one cumulative refund entry per charge, so a
 *  second partial refund between the list and the tap grows the entry: he
 *  recorded −$300, the entry now says −$450, and stamping the WHOLE entry
 *  would mark $150 he never saw as recorded — never listed again, left in
 *  QuickBooks as received. So the stamp is what was recorded before plus what
 *  he was shown, capped at the entry's size; the growth stays listed. An old
 *  client that sends no amount keeps the previous whole-entry rule. */
export function markReversalRecorded(
  payments: unknown,
  entryId: string,
  atIso: string,
  listedAmount?: number,
): QboLedgerEntry[] | null {
  const ledger = ledgerFrom(payments) as QboLedgerEntry[];
  if (!reversalsNotInQbo(ledger).some((x) => x.entryId === entryId)) return null;
  return ledger.map((e) => {
    if (e.id !== entryId) return e;
    const whole = toCents2(-Number(e.amount ?? 0));
    let recordedNow = whole;
    if (listedAmount != null && Number.isFinite(listedAmount) && listedAmount > 0) {
      const before = e.qboReversalRecordedAt ? Number(e.qboReversalRecordedAmount ?? 0) : 0;
      recordedNow = Math.min(whole, toCents2((Number.isFinite(before) ? before : 0) + listedAmount));
    }
    return { ...e, qboReversalRecordedAt: atIso, qboReversalRecordedAmount: recordedNow };
  });
}

/**
 * What the reconciler will actually do with a payment QuickBooks does not
 * have (audit #102) — so qbo-setup's label is the sweep's own predicate, not a
 * guess. It used to say "will retry next reconcile" for a refunded payment and
 * for one dated before the sweep floor; paymentsToPushToQbo returns neither.
 *   reversed  — refunded / charged back: never pushed, record the net by hand
 *   stopped   — out of attempts
 *   not-swept — dated before the floor, or no readable date
 *   refused   — the sweep's balance refusal (a likely duplicate)
 *   retrying  — paymentsToPushToQbo returns it: it goes next run
 * TWIN: app/qbo-setup.tsx (pinned by validate-qbo-payment-ledger).
 */
export type UnsyncedPaymentState = "reversed" | "stopped" | "not-swept" | "refused" | "retrying";
export function unsyncedPaymentState(
  e: QboLedgerEntry,
  ledger: readonly QboLedgerEntry[],
  floorIso: string = PAYMENT_SWEEP_FLOOR,
): UnsyncedPaymentState {
  if (isReversed(e, ledger)) return "reversed";
  if ((e.qboAttempts ?? 0) >= MAX_PAYMENT_PUSH_ATTEMPTS) return "stopped";
  const at = typeof e.date === "string" ? Date.parse(e.date) : NaN;
  const floor = Date.parse(floorIso);
  if (!Number.isFinite(at) || (Number.isFinite(floor) && at < floor)) return "not-swept";
  if (typeof e.qboError === "string" && /^QuickBooks (shows only|already shows invoice)/.test(e.qboError)) return "refused";
  return "retrying";
}

/**
 * Stamp one entry's push outcome onto a FRESH read of the ledger (by id), so a
 * payment written by the webhook or the app between the read and this write is
 * never dropped. Returns null when the entry is gone or has since been pushed.
 */
export function markPushFailure(
  payments: unknown,
  entryId: string,
  message: string,
  // false for an outage (isQboOutageError): the message is still recorded for
  // a person, but QuickBooks being down must not spend one of the payment's
  // MAX_PAYMENT_PUSH_ATTEMPTS — the sweep already follows that rule.
  opts: { countAttempt?: boolean } = {},
): QboLedgerEntry[] | null {
  const ledger = ledgerFrom(payments) as QboLedgerEntry[];
  const idx = ledger.findIndex((e) => e.id === entryId);
  if (idx === -1 || ledger[idx].qboId) return null;
  const next = [...ledger];
  const attempts = ledger[idx].qboAttempts ?? 0;
  next[idx] = {
    ...ledger[idx],
    qboError: message.slice(0, 300),
    qboAttempts: opts.countAttempt === false ? attempts : attempts + 1,
  };
  return next;
}
