// _shared/paymentMath.ts — pure money math for the Stripe webhook.
//
// NO Deno imports, on purpose. scripts/validate-stripe-webhook-math.ts runs
// these functions under bun, and stripe-webhook/index.ts (Deno) imports the
// same file — so the rule that decides "this invoice is paid" is tested once
// and executed in exactly one place.
//
// Audit 2026-09-03:
//   MONEY-F2  — the webhook compared amount_paid with the GROSS total_due, so a
//               retention invoice paid in full (net) stayed partially_paid and
//               the portal offered the spent Payment Link for the "balance".
//   MONEY-F16 — an AIA pay app paid via Stripe never credited its invoice.
//   MONEY-F17 — refunds and lost disputes never touched the ledger.

export interface LedgerEntry {
  id: string;
  /** Dollars. Negative for refunds and lost disputes. */
  amount: number;
  method?: string;
  /** What app/invoice.tsx renders in the payment history (`new Date(p.date)`). */
  date?: string;
  receivedAt?: string;
  reference?: string;
  notes?: string;
  /** Lets charge.refunded / charge.dispute.* find the invoice by PaymentIntent. */
  paymentIntentId?: string;
  kind?: "payment" | "refund" | "dispute";
}

export interface SettlementInput {
  total_due?: number | string | null;
  retention_amount?: number | string | null;
  retention_released?: number | string | null;
}

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Round to cents so repeated float arithmetic never drifts the NUMERIC column. */
export function toCents2(n: number): number {
  const r = Math.round(n * 100) / 100;
  return r === 0 ? 0 : r; // normalise -0
}

/** Retention the contract still lets the client hold back. */
export function retentionPending(inv: SettlementInput): number {
  return Math.max(0, num(inv.retention_amount) - num(inv.retention_released));
}

/**
 * What the client can be asked for today: total_due net of held retention.
 * Mirrors netBalanceDue / invoiceIsSettled in utils/invoiceBilling.ts.
 */
export function netPayable(inv: SettlementInput): number {
  return Math.max(0, num(inv.total_due) - retentionPending(inv));
}

/**
 * Settled-status rule (MONEY-F2): 'paid' when amount_paid covers the
 * retention-NET balance within a cent — never the gross total_due.
 * With nothing paid any more (full refund, lost dispute) a paid /
 * partially_paid invoice falls back to 'sent'; any other prior status
 * (draft, overdue) is kept as it was.
 */
export function settlementStatus(
  prevStatus: string | null | undefined,
  amountPaid: number,
  inv: SettlementInput,
): string {
  if (amountPaid > 0.005) {
    return amountPaid >= netPayable(inv) - 0.01 ? "paid" : "partially_paid";
  }
  if (prevStatus === "paid" || prevStatus === "partially_paid") return "sent";
  return prevStatus || "sent";
}

export function ledgerFrom(raw: unknown): LedgerEntry[] {
  return Array.isArray(raw)
    ? (raw as LedgerEntry[]).filter((e) => !!e && typeof e === "object" && typeof e.id === "string")
    : [];
}

export function ledgerSum(ledger: readonly LedgerEntry[]): number {
  return toCents2(ledger.reduce((s, e) => s + num(e.amount), 0));
}

/**
 * Append one entry unless its id is already in the ledger. Stripe retries and
 * overlapping deliveries re-present the same session/refund/dispute id; the id
 * is the idempotency key, and `delta` is what amount_paid moves by.
 */
export function applyLedgerEntry(
  ledger: readonly LedgerEntry[],
  entry: LedgerEntry,
): { ledger: LedgerEntry[]; delta: number; applied: boolean } {
  if (ledger.some((e) => e.id === entry.id)) return { ledger: [...ledger], delta: 0, applied: false };
  return { ledger: [...ledger, entry], delta: toCents2(entry.amount), applied: true };
}

export interface RefundedCharge {
  id: string;
  /** Cents, CUMULATIVE across every refund on the charge. */
  amount_refunded?: number | null;
  payment_intent?: string | null;
  /** Present only when the endpoint's API version still embeds the list (< 2022-11-15) or it was expanded. */
  refunds?: { data?: { id: string; amount: number; created?: number }[] | null } | null;
}

/**
 * Fold a `charge.refunded` event into the ledger (MONEY-F17). The event fires
 * for partial AND full refunds, and Stripe re-sends it on retry, so:
 *   - when the charge carries its `refunds` list, each refund becomes its own
 *     negative entry keyed `stripe-refund-<re_id>` (already-present ids skip);
 *   - otherwise one cumulative entry keyed `stripe-refund-<ch_id>` is upserted
 *     to -amount_refunded, and `delta` is the change since the last event.
 * `delta` is what amount_paid moves by; `changed` false means nothing to write.
 */
export function applyChargeRefund(
  ledger: readonly LedgerEntry[],
  charge: RefundedCharge,
  nowIso: string,
): { ledger: LedgerEntry[]; delta: number; changed: boolean } {
  const entry = (id: string, amount: number, whenIso: string): LedgerEntry => ({
    id,
    amount,
    method: "stripe",
    kind: "refund",
    date: whenIso,
    receivedAt: whenIso,
    reference: charge.id,
    paymentIntentId: charge.payment_intent ?? undefined,
    notes: `refund of charge ${charge.id}`,
  });

  const refunds = charge.refunds?.data;
  if (Array.isArray(refunds) && refunds.length > 0) {
    const next = [...ledger];
    let delta = 0;
    let changed = false;
    for (const r of refunds) {
      const id = `stripe-refund-${r.id}`;
      if (next.some((e) => e.id === id)) continue;
      const amount = -toCents2(num(r.amount) / 100);
      const when = r.created ? new Date(r.created * 1000).toISOString() : nowIso;
      next.push(entry(id, amount, when));
      delta += amount;
      changed = true;
    }
    return { ledger: next, delta: toCents2(delta), changed };
  }

  const id = `stripe-refund-${charge.id}`;
  const cumulative = -toCents2(num(charge.amount_refunded) / 100);
  const idx = ledger.findIndex((e) => e.id === id);
  if (idx === -1) {
    if (cumulative === 0) return { ledger: [...ledger], delta: 0, changed: false };
    return { ledger: [...ledger, entry(id, cumulative, nowIso)], delta: cumulative, changed: true };
  }
  const prev = num(ledger[idx].amount);
  if (Math.abs(prev - cumulative) < 0.005) return { ledger: [...ledger], delta: 0, changed: false };
  const next = [...ledger];
  next[idx] = { ...ledger[idx], amount: cumulative, date: nowIso, receivedAt: nowIso };
  return { ledger: next, delta: toCents2(cumulative - prev), changed: true };
}
