// _shared/payLinkBalance.ts — what the SERVER says is owed, and whether a
// requested Pay-link amount may be minted against it.
//
// NO Deno globals and no remote imports, on purpose: create-payment-link
// (Deno) imports this file, and scripts/validate-health-moneypay.ts executes
// the same functions under bun, so the rule that refuses an overcharge is
// tested once and runs in exactly one place. The 409 body carries
// payLinkRefusalMessage's sentence, and utils/stripe.ts shows it, so the
// balance the GC reads is the one the server compared against (the app keeps
// a same-words fallback, payLinkBalanceFallback; the validator diffs them).
//
// MONEY-PAYLINK-AMOUNT-TRUST (health 2026-09-26). create-payment-link used to
// mint a Stripe charge for whatever `amountCents` the device sent. The device
// figure is local state, and device balances go stale: the client pays
// $20,000 through the portal link (the webhook sets amount_paid and nulls the
// link), a second phone that has not refetched taps Send, and a fresh $20,000
// link is minted and emailed against an invoice the server shows paid.
//
// ONLY OVERCHARGE IS REFUSED. Every app flow that mints for LESS than the
// server balance stays allowed: a re-mint after a recorded payment whose
// write has not reached the server yet, a certificate cut below the amount
// applied for, a GC who deliberately bills part of a balance.

import { netPayable, toCents2, type SettlementInput } from "./paymentMath.ts";

export type PayLinkRecordType = "invoice" | "aia_pay_app";

/** The invoice columns the balance needs. create-payment-link selects exactly these. */
export const INVOICE_BALANCE_COLUMNS =
  "status,total_due,amount_paid,subtotal,retention_percent,retention_amount,retention_released";
/** The aia_pay_apps columns the balance needs (the table has no amount_paid). */
export const AIA_BALANCE_COLUMNS = "paid_at,certified_at,pay_link_url,snapshot_totals";

export interface InvoiceBalanceRow extends SettlementInput {
  status?: string | null;
  amount_paid?: number | string | null;
}

export interface AiaBalanceRow {
  paid_at?: string | null;
  certified_at?: string | null;
  pay_link_id?: string | null;
  pay_link_url?: string | null;
  /** The saved G702 totals; the architect's certificate rides in its
   *  `__mageCertificate` sidecar (utils/projectContextPure aiaExtrasFor). */
  snapshot_totals?: unknown;
  amount_paid?: number | string | null;
}

const finite = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * What the server row says the client owes today, in integer cents — or null
 * when the row cannot vouch for a balance, in which case the caller mints as
 * it did before and logs why.
 *
 *   invoice     — retention-net total less amount paid (netPayable is NOT net
 *                 of amount_paid; it is max(0, total_due − retention pending)).
 *                 null for a DRAFT: the send path writes the edited totals
 *                 after the mint, so a draft's stored total can trail the
 *                 screen by an edit the GC just made. A draft has never been
 *                 paid through a link — a payment moves the status — so the
 *                 stale-device-after-payment case never reaches this branch.
 *                 null when total_due was not read (older schema).
 *   aia_pay_app — 0 once paid_at is set; otherwise the certified figure when
 *                 the architect's certificate is recorded, else line 8
 *                 (currentPaymentDue), less any amount paid. null for a draft
 *                 that has never been through Stripe (no link, never
 *                 certified_at): the screen mints BEFORE it writes the record,
 *                 so the row's snapshot trails the screen. null when the
 *                 snapshot carries no figure.
 */
export function serverPayableCents(recordType: PayLinkRecordType, row: Record<string, unknown> | null | undefined): number | null {
  if (!row || typeof row !== "object") return null;
  if (recordType === "invoice") {
    const inv = row as InvoiceBalanceRow;
    if (!("total_due" in row) || finite(inv.total_due) == null) return null;
    if (String(inv.status ?? "").toLowerCase() === "draft") return null;
    const owed = toCents2(netPayable(inv) - (finite(inv.amount_paid) ?? 0));
    return Math.max(0, Math.round(owed * 100));
  }
  const aia = row as AiaBalanceRow;
  if (typeof aia.paid_at === "string" && aia.paid_at.length > 0) return 0;
  const throughStripe = !!aia.pay_link_id || !!aia.pay_link_url || !!aia.certified_at;
  if (!throughStripe) return null;
  const snap = aia.snapshot_totals;
  if (snap == null || typeof snap !== "object") return null;
  const extras = (snap as Record<string, unknown>).__mageCertificate;
  const certified = extras != null && typeof extras === "object"
    ? finite((extras as Record<string, unknown>).amountCertified)
    : null;
  const payable = certified ?? finite((snap as Record<string, unknown>).currentPaymentDue);
  if (payable == null) return null;
  const owed = toCents2(payable - (finite(aia.amount_paid) ?? 0));
  return Math.max(0, Math.round(owed * 100));
}

export type PayLinkVerdict = "ok" | "balance_changed" | "nothing_due";

/**
 * May a link for `requestedCents` be minted against `serverCents`?
 *   nothing_due     — the server shows nothing owed;
 *   balance_changed — the request is ABOVE the server balance by more than a
 *                     cent (an overcharge — the device figure is stale);
 *   ok              — at or below the balance.
 */
export function payLinkAmountVerdict(requestedCents: number, serverCents: number): PayLinkVerdict {
  if (!(serverCents > 0)) return "nothing_due";
  if (requestedCents > serverCents + 1) return "balance_changed";
  return "ok";
}

function dollars(cents: number): string {
  return `$${(Math.max(0, cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** The sentence the GC reads when a mint is refused — says why and what to do. */
export function payLinkRefusalMessage(
  verdict: Exclude<PayLinkVerdict, "ok">,
  serverCents: number | null | undefined,
  recordType: PayLinkRecordType = "invoice",
): string {
  const noun = recordType === "aia_pay_app" ? "pay application" : "invoice";
  if (verdict === "nothing_due") return `Nothing is owed on this ${noun} any more.`;
  const now = typeof serverCents === "number" && Number.isFinite(serverCents) ? ` (now ${dollars(serverCents)})` : "";
  return `This ${noun}'s balance changed on the server${now}. Refresh the ${noun} before sending.`;
}
