// stripe-webhook
//
// Receives Stripe webhook events and reconciles them back to MAGE ID
// invoices. Without this, payments succeed on Stripe but our DB never
// learns the invoice was paid — clients pay, the contractor never sees
// it, support tickets ensue.
//
// Events we handle (subscribe the Stripe endpoint to exactly these, and turn
// on "Listen to events on Connected accounts" — Payment Links are minted on
// the GC's Express account, so their sessions arrive as connected-account
// events with `event.account` set; endpoint URL
// https://<project>.supabase.co/functions/v1/stripe-webhook):
//
//   checkout.session.completed / checkout.session.async_payment_succeeded
//     → A Payment Link was paid. metadata.{record_type,record_id,invoice_id}
//       was stamped at link creation (create-payment-link/index.ts). Credits
//       the invoice ledger under the retention-NET "paid" rule, nulls its
//       pay_link_* columns and deactivates the link on Stripe (audit
//       MONEY-F2); for an AIA pay app also stamps paid_at and credits the pay
//       app's SOURCE invoice (MONEY-F16).
//   charge.refunded
//     → Negative ledger entry; amount_paid and status recomputed (MONEY-F17).
//   charge.dispute.created / charge.dispute.closed
//     → invoices.payment_disputed_at set / cleared; a LOST dispute is booked
//       in the ledger like a refund (MONEY-F17).
//   payment_intent.payment_failed / checkout.session.async_payment_failed
//     → Logged — type + object id only, never the object (card/customer PII).
//   account.updated / account.application.deauthorized
//     → Connect status mirrored into profiles.
//
// Every event is gated by its Stripe event id through public.stripe_events
// (claim → process → processed_at; the claim is released on a transient
// failure so Stripe's retry re-runs it) on top of the per-session /
// per-refund / per-dispute ledger ids. See claimEvent() below.
//
// SECURITY: every request MUST be signature-verified. Stripe signs the
// raw request body with the webhook secret using HMAC-SHA256, and we
// reject anything that doesn't match. Without this, an attacker could
// POST a fake "session.completed" body to us and mark any invoice paid.
//
// The webhook secret is generated in the Stripe dashboard when you
// create the endpoint. Store it in Supabase Edge Function secrets:
//   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
//
// We read the raw body as a string for signature verification (it must
// be byte-exact — no JSON.parse-then-stringify drift). Then we parse it
// once verified.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
// Shared email helpers — same shell every transactional email uses, so
// the receipt matches sub-portal invites, contract sends, COI warnings,
// the morning brief, and the homeowner weekly digest.
import { wrapEmailHtml, resendSend } from "../_shared/email.ts";
// Pure money rules (net-of-retention settlement, idempotent ledger, refund
// folding). No Deno imports in there so scripts/validate-stripe-webhook-math.ts
// exercises the exact code this file runs.
import {
  applyChargeRefund,
  applyLedgerEntry,
  ledgerFrom,
  netPayable,
  settlementStatus,
  toCents2,
  type LedgerEntry,
} from "../_shared/paymentMath.ts";

const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
// MONEY-F2: the webhook now talks BACK to Stripe (deactivate a paid link).
// Same project secret create-payment-link mints with; same pinned version.
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
const STRIPE_API_VERSION = "2024-06-20";

const INK = "#0B0D10";
const AMBER = "#FF6A1A";
const CREAM = "#F4EFE6";
const SAND = "#E8DFCD";
const FOG = "#9AA3AD";
const STONE = "#4A5159";
const PAPER = "#FFFFFF";
const FONT_STACK = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif`;
const FONT_DISPLAY = `Georgia,'Times New Roman',serif`;

function escapeHtml(text: unknown): string {
  if (text == null) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatMoney(amount: number): string {
  // Guard non-finite input (NaN / Infinity from a bad amount_total) so the
  // receipt never renders "$NaN". Falls back to a plain zero. Otherwise
  // render with thousands separators + 2 decimals, e.g. 12500.5 → "$12,500.50".
  if (!Number.isFinite(amount)) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "stripe-signature, content-type, authorization",
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface StripeCheckoutSession {
  id: string;
  object: "checkout.session";
  amount_total: number;
  currency: string;
  customer_email?: string | null;
  metadata?: Record<string, string>;
  payment_intent?: string;
  /** The Payment Link that created this session — what MONEY-F2 deactivates. */
  payment_link?: string | null;
  payment_status: "paid" | "unpaid" | "no_payment_required";
  status: "complete" | "expired" | "open";
}

interface StripeWebhookEvent {
  id: string;
  type: string;
  data: { object: unknown };
  created: number;
  livemode: boolean;
  /**
   * Set by Stripe Connect when the event originated on a connected
   * account (i.e. a charge against a GC's Express account, not the
   * platform). We use it to attribute payments to the right contractor
   * if the invoice ever loses its metadata.
   */
  account?: string;
}

interface StripeAccountObject {
  id: string;
  object: "account";
  charges_enabled: boolean;
  details_submitted: boolean;
  payouts_enabled: boolean;
}

/** `charge.refunded` payload (MONEY-F17). `refunds` is absent on API ≥ 2022-11-15. */
interface StripeCharge {
  id: string;
  object: "charge";
  amount: number;
  amount_refunded: number;
  refunded: boolean;
  payment_intent?: string | null;
  metadata?: Record<string, string>;
  refunds?: { data?: { id: string; amount: number; created?: number }[] | null } | null;
}

/** `charge.dispute.*` payload (MONEY-F17). */
interface StripeDispute {
  id: string;
  object: "dispute";
  amount: number;
  charge?: string | null;
  payment_intent?: string | null;
  reason?: string;
  status: string;
}

/**
 * Verify a Stripe webhook signature.
 *
 * Stripe sends a header like:
 *   stripe-signature: t=1729800000,v1=hex_sha256_hmac,...
 *
 * We need to:
 *   1. Parse out the timestamp and the v1 signature.
 *   2. Compute HMAC-SHA256(secret, "{timestamp}.{rawBody}").
 *   3. Constant-time compare.
 *   4. Reject if timestamp is more than 5 minutes old (replay protection).
 */
async function verifyStripeSignature(
  rawBody: string,
  sigHeader: string,
  secret: string,
): Promise<boolean> {
  if (!sigHeader || !secret) return false;

  // Parse the header into key/value pairs.
  const parts: Record<string, string> = {};
  for (const segment of sigHeader.split(",")) {
    const [k, v] = segment.split("=");
    if (k && v) {
      // A header may have multiple v1 values (key rotation) — keep the first.
      if (parts[k] === undefined) parts[k] = v;
    }
  }

  const timestamp = parts["t"];
  const expectedSig = parts["v1"];
  if (!timestamp || !expectedSig) return false;

  // Replay protection: reject events older than 5 minutes.
  const ts = parseInt(timestamp, 10);
  if (Number.isNaN(ts)) return false;
  const ageSeconds = Math.floor(Date.now() / 1000) - ts;
  if (ageSeconds > 300) {
    console.warn("[stripe-webhook] Rejected stale event, age=", ageSeconds, "s");
    return false;
  }

  // Compute HMAC-SHA256.
  const enc = new TextEncoder();
  const keyData = enc.encode(secret);
  const payload = enc.encode(`${timestamp}.${rawBody}`);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuffer = await crypto.subtle.sign("HMAC", cryptoKey, payload);
  const computedSig = Array.from(new Uint8Array(sigBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Constant-time compare to defeat timing attacks.
  if (computedSig.length !== expectedSig.length) return false;
  let diff = 0;
  for (let i = 0; i < computedSig.length; i++) {
    diff |= computedSig.charCodeAt(i) ^ expectedSig.charCodeAt(i);
  }
  return diff === 0;
}

// Explicit generic instantiation: without it the client's Database generic
// resolves to `unknown`, every selected column becomes `unknown`, and .eq()
// calls stop type-checking (found by the first-ever `deno check`, 2026-08-29).
type Db = ReturnType<typeof createClient<any, "public", any>>;

/**
 * MONEY-F2: retire a Payment Link once it has been paid or replaced.
 * `POST /v1/payment_links/{id}` with `active=false` — "If false, customers
 * visiting the URL will be shown a page saying that the link has been
 * deactivated" (docs.stripe.com/api/payment-link/update, `active`). A link
 * minted on a connected account must be addressed AS that account, which is
 * the same Stripe-Account header create-payment-link minted it with and is
 * `event.account` on the delivered event.
 *
 * Returns "ok", "terminal" (4xx — gone, already inactive, no secret: nothing a
 * retry fixes; the DB columns are already nulled so the portal cannot show it)
 * or "retry" (5xx / network, worth a Stripe retry).
 */
async function deactivatePaymentLink(
  linkId: string,
  stripeAccount?: string,
): Promise<"ok" | "terminal" | "retry"> {
  if (!STRIPE_SECRET_KEY) {
    console.error("[stripe-webhook] STRIPE_SECRET_KEY not set — cannot deactivate", linkId);
    return "terminal";
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
    "Content-Type": "application/x-www-form-urlencoded",
    "Stripe-Version": STRIPE_API_VERSION,
  };
  if (stripeAccount) headers["Stripe-Account"] = stripeAccount;
  try {
    const res = await fetch(`https://api.stripe.com/v1/payment_links/${encodeURIComponent(linkId)}`, {
      method: "POST",
      headers,
      body: "active=false",
    });
    if (res.ok) {
      console.log("[stripe-webhook] Deactivated payment link", linkId, stripeAccount ? `on ${stripeAccount}` : "(platform)");
      return "ok";
    }
    const text = (await res.text()).slice(0, 300);
    console.error("[stripe-webhook] deactivate", linkId, "failed:", res.status, text);
    return res.status >= 500 ? "retry" : "terminal";
  } catch (err) {
    console.error("[stripe-webhook] deactivate", linkId, "threw:", err);
    return "retry";
  }
}

// ── Event-id idempotency gate ───────────────────────────────────────────────
//
// 01-security appendix: the invoice credit was a non-atomic read-modify-write
// deduplicated only by scanning payments[], so two OVERLAPPING deliveries of
// one event could both credit. public.stripe_events (migration
// 20260904100100) holds one row per Stripe event id:
//   arrival  → CLAIM the row (insert … on conflict do nothing);
//   success  → processed_at stamped; a later delivery is answered 200 unrun;
//   transient failure → the claim is DELETED so Stripe's retry re-runs;
//   a claim older than STALE_CLAIM_MS with no processed_at is a crashed run
//   and is taken over; a younger one is in flight → 409 so Stripe retries
//   (never 200: if that run fails and releases, Stripe must still come back).
// The gate sits on top of the per-session ledger dedupe, not instead of it —
// if the table is unreachable the event runs ungated rather than stranding a
// captured payment.
const STALE_CLAIM_MS = 5 * 60 * 1000;
/**
 * `token` is the received_at value THIS run wrote (insert or takeover) and is
 * the claim's ownership proof. A run that stalled past STALE_CLAIM_MS, lost
 * the claim to a takeover, and then fails transiently must not delete the new
 * owner's claim — that would let a third delivery run concurrently with it.
 */
type Claim =
  | { state: "claimed"; token: string }
  | { state: "processed" | "in_flight" | "ungated" };

async function claimEvent(supabase: Db, event: StripeWebhookEvent): Promise<Claim> {
  try {
    // Written explicitly (not the column default) so the token is known here.
    const token = new Date().toISOString();
    const { data, error } = await supabase
      .from("stripe_events")
      .upsert({ id: event.id, type: event.type, received_at: token }, { onConflict: "id", ignoreDuplicates: true })
      .select("id");
    if (error) {
      console.error("[stripe-webhook] stripe_events claim failed — running ungated:", error.message);
      return { state: "ungated" };
    }
    if (Array.isArray(data) && data.length > 0) return { state: "claimed", token };

    const { data: row, error: readError } = await supabase
      .from("stripe_events")
      .select("processed_at, received_at")
      .eq("id", event.id)
      .maybeSingle();
    if (readError || !row) return { state: "ungated" };
    if (row.processed_at) return { state: "processed" };
    const receivedMs = Date.parse(String(row.received_at ?? ""));
    if (!Number.isFinite(receivedMs) || Date.now() - receivedMs < STALE_CLAIM_MS) return { state: "in_flight" };

    // Stale claim: take it over, but only if nobody else just did. The new
    // received_at becomes this run's token.
    const cutoffIso = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
    const takeover = new Date().toISOString();
    const { data: taken } = await supabase
      .from("stripe_events")
      .update({ received_at: takeover })
      .eq("id", event.id)
      .is("processed_at", null)
      .lt("received_at", cutoffIso)
      .select("id");
    return Array.isArray(taken) && taken.length > 0 ? { state: "claimed", token: takeover } : { state: "in_flight" };
  } catch (err) {
    console.error("[stripe-webhook] stripe_events claim threw — running ungated:", err);
    return { state: "ungated" };
  }
}

/** Release a claim after a transient failure — only if this run still owns it. */
async function releaseEvent(supabase: Db, eventId: string, token: string): Promise<void> {
  try {
    await supabase
      .from("stripe_events")
      .delete()
      .eq("id", eventId)
      .is("processed_at", null)
      .eq("received_at", token);
  } catch (err) {
    console.error("[stripe-webhook] stripe_events release failed:", eventId, err);
  }
}

async function markProcessed(supabase: Db, eventId: string): Promise<void> {
  try {
    await supabase.from("stripe_events").update({ processed_at: new Date().toISOString() }).eq("id", eventId);
  } catch (err) {
    console.error("[stripe-webhook] stripe_events mark-processed failed:", eventId, err);
  }
}

/**
 * Reconciles a Stripe `account.updated` event back to our profiles
 * table. Fires whenever the GC finishes onboarding, completes
 * verification, links a bank, etc. Without this the app would never
 * flip from "Pending verification" → "Connected ✓".
 */
async function handleAccountUpdated(
  acct: StripeAccountObject,
): Promise<{ ok: boolean; reason?: string }> {
  if (!acct.id) return { ok: false, reason: "no account id" };
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { error } = await supabase
    .from("profiles")
    .update({
      stripe_charges_enabled: !!acct.charges_enabled,
      stripe_details_submitted: !!acct.details_submitted,
      stripe_payouts_enabled: !!acct.payouts_enabled,
      stripe_connect_updated_at: new Date().toISOString(),
    })
    .eq("stripe_account_id", acct.id);
  if (error) {
    console.error("[stripe-webhook] profile update for account.updated failed:", error);
    return { ok: false, reason: "db update failed" };
  }
  console.log(
    "[stripe-webhook] Account",
    acct.id,
    "updated → charges:", acct.charges_enabled,
    "details:", acct.details_submitted,
    "payouts:", acct.payouts_enabled,
  );
  return { ok: true };
}

const INVOICE_COLS = "id, total_due, amount_paid, payments, status, retention_amount, retention_released, pay_link_id";

interface InvoiceRow {
  id: string;
  total_due: number | string | null;
  amount_paid: number | string | null;
  payments: unknown;
  status: string | null;
  retention_amount: number | string | null;
  retention_released: number | string | null;
  pay_link_id: string | null;
}

type HandlerResult = { ok: true; reason?: string } | { ok: false; reason: string };

type CreditResult =
  | { ok: true; duplicate: boolean; amountReceived: number; newAmountPaid: number; totalDue: number; newStatus: string }
  | { ok: false; reason: "invoice not found" | "db fetch failed" | "db update failed" };

/** PGRST116 = zero rows; 22P02 = the id is not a uuid (a legacy text AIA invoice_id). Both terminal. */
const isNotFound = (code: string | undefined) => code === "PGRST116" || code === "22P02";

/**
 * Credit one paid Checkout Session to an invoice. Shared by the invoice path
 * and the AIA pay-app path (MONEY-F16), idempotent by session id: the ledger
 * entry `stripe-<session.id>` is the key, so a Stripe retry or a second
 * overlapping delivery reports `duplicate` and moves nothing.
 *
 * MONEY-F2: "paid" is decided against the retention-NET balance
 * (settlementStatus), and the invoice's pay_link_* columns are nulled in the
 * same write — the link was minted for a balance that no longer exists. Its
 * own link (when the money arrived through an AIA pay app's link) is retired
 * on Stripe as well.
 */
async function creditInvoice(
  supabase: Db,
  invoiceId: string,
  session: StripeCheckoutSession,
  eventAccount: string | undefined,
  via: "invoice" | "aia_pay_app",
  viaId?: string,
): Promise<CreditResult> {
  const { data: invoice, error: fetchError } = await supabase
    .from("invoices")
    .select(INVOICE_COLS)
    .eq("id", invoiceId)
    .single();

  if (fetchError) {
    console.error("[stripe-webhook] Failed to fetch invoice:", invoiceId, fetchError.code ?? fetchError.message);
    // Terminal (row genuinely gone / id not a uuid) vs transient (DB or
    // network) — a captured payment would be stranded if we ACK'd a transient
    // read failure with 200, so that case signals a retry instead.
    if (isNotFound(fetchError.code)) return { ok: false, reason: "invoice not found" };
    return { ok: false, reason: "db fetch failed" };
  }
  if (!invoice) return { ok: false, reason: "invoice not found" };
  const inv = invoice as InvoiceRow;

  // Stripe amount_total is in cents; our DB stores dollars as NUMERIC.
  const now = new Date().toISOString();
  const amountReceived = toCents2(Number(session.amount_total ?? 0) / 100);
  const totalDue = Number(inv.total_due ?? 0);
  const entry: LedgerEntry = {
    id: `stripe-${session.id}`,
    amount: amountReceived,
    method: "stripe",
    kind: "payment",
    date: now,
    receivedAt: now,
    reference: session.id,
    // Lets charge.refunded / charge.dispute.* find this invoice later.
    paymentIntentId: session.payment_intent ?? undefined,
    notes: [
      session.payment_intent ? `payment_intent: ${session.payment_intent}` : "",
      via === "aia_pay_app" ? `via AIA pay app ${viaId}` : "",
    ].filter(Boolean).join(" · ") || undefined,
  };

  const applied = applyLedgerEntry(ledgerFrom(inv.payments), entry);
  if (!applied.applied) {
    console.log("[stripe-webhook] Duplicate session, not re-credited:", session.id);
    return {
      ok: true, duplicate: true, amountReceived,
      newAmountPaid: Number(inv.amount_paid ?? 0), totalDue, newStatus: inv.status ?? "",
    };
  }

  const newAmountPaid = toCents2(Number(inv.amount_paid ?? 0) + applied.delta);
  const newStatus = settlementStatus(inv.status, newAmountPaid, inv);

  const { error: updateError } = await supabase
    .from("invoices")
    .update({
      amount_paid: newAmountPaid,
      payments: applied.ledger,
      status: newStatus,
      updated_at: now,
      // MONEY-F2: the link on this row was minted for the OLD balance — spent
      // or stale either way. The portal must not offer it again.
      pay_link_url: null,
      pay_link_id: null,
      pay_link_amount: null,
    })
    .eq("id", invoiceId);

  if (updateError) {
    console.error("[stripe-webhook] Failed to update invoice:", invoiceId, updateError.message);
    return { ok: false, reason: "db update failed" };
  }

  console.log(
    "[stripe-webhook] Credited invoice", invoiceId, "via", via, "→", newStatus,
    "amount_paid:", newAmountPaid, "/ net", netPayable(inv), "(gross", totalDue + ")",
  );

  // The invoice's OWN link, when different from the one just paid (AIA route,
  // or a re-mint the app lost track of), is now stale — retire it. Best-effort:
  // the columns above are already nulled, so the portal cannot show it.
  if (inv.pay_link_id && inv.pay_link_id !== session.payment_link) {
    await deactivatePaymentLink(inv.pay_link_id, eventAccount);
  }

  return { ok: true, duplicate: false, amountReceived, newAmountPaid, totalDue, newStatus };
}

async function handleCheckoutCompleted(
  supabase: Db,
  session: StripeCheckoutSession,
  eventAccount: string | undefined,
): Promise<HandlerResult> {
  const invoiceId = session.metadata?.invoice_id;
  if (!invoiceId) {
    return { ok: false, reason: "session has no metadata.invoice_id" };
  }
  if (session.payment_status !== "paid") {
    return { ok: false, reason: `session.payment_status is ${session.payment_status}, not paid` };
  }

  const credit = await creditInvoice(supabase, invoiceId, session, eventAccount, "invoice");
  if (!credit.ok) return credit;
  if (credit.duplicate) return { ok: true, reason: "duplicate" };

  // Best-effort receipt email — fire-and-forget so a Resend hiccup never
  // fails the webhook (Stripe retries on non-2xx and the duplicate-payment
  // guard above would refuse the second run).
  void sendReceiptEmail(supabase, {
    invoiceId,
    amountReceived: credit.amountReceived,
    newAmountPaid: credit.newAmountPaid,
    totalDue: credit.totalDue,
    newStatus: credit.newStatus,
    sessionId: session.id,
    customerEmail: (session as unknown as { customer_email?: string; customer_details?: { email?: string } })
      .customer_email
      ?? (session as unknown as { customer_details?: { email?: string } }).customer_details?.email,
  });

  return { ok: true };
}

/**
 * Reconciles a successful checkout back to an AIA pay application, then to
 * the invoice the pay app bills (MONEY-F16). Before this only paid_at flipped:
 * dunning, A/R aging, cash flow and the home strip kept chasing an invoice the
 * owner had already paid through the pay app's link.
 *
 * Idempotent: paid_at is set ONCE (a retry keeps the first timestamp), the
 * pay_link_* nulling is naturally idempotent, and the invoice credit is keyed
 * by session id inside creditInvoice.
 */
async function handleAiaPayAppCompleted(
  supabase: Db,
  recordId: string,
  session: StripeCheckoutSession,
  eventAccount: string | undefined,
): Promise<HandlerResult> {
  if (session.payment_status !== "paid") {
    return { ok: false, reason: `session.payment_status is ${session.payment_status}, not paid` };
  }
  if (!recordId) return { ok: false, reason: "session has no metadata.record_id" };

  const { data: app, error: fetchError } = await supabase
    .from("aia_pay_apps")
    .select("id, invoice_id, paid_at, pay_link_id")
    .eq("id", recordId)
    .single();
  if (fetchError) {
    console.error("[stripe-webhook] Failed to fetch aia_pay_app:", recordId, fetchError.code ?? fetchError.message);
    if (isNotFound(fetchError.code)) return { ok: false, reason: "aia_pay_app not found" };
    return { ok: false, reason: "db fetch failed" };
  }
  if (!app) return { ok: false, reason: "aia_pay_app not found" };

  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("aia_pay_apps")
    .update({
      paid_at: (app.paid_at as string | null) ?? now,
      payment_intent_id: session.payment_intent ?? null,
      // MONEY-F2: the AIA portal button had no paid state at all — the pay
      // app's link stays offered forever unless these are cleared.
      pay_link_url: null,
      pay_link_id: null,
      pay_link_amount: null,
    })
    .eq("id", recordId);

  if (updateError) {
    console.error("[stripe-webhook] Failed to update aia_pay_app:", recordId, updateError.message);
    return { ok: false, reason: "db update failed" };
  }
  console.log("[stripe-webhook] Marked aia_pay_app", recordId, "paid, PI:", session.payment_intent ?? "(none)");

  // MONEY-F2 (AIA): the pay app's OWN link, when it is not the one just paid
  // (an earlier mint the app re-saved over), is retired too. Left live, a
  // second payment through it arrives as a NEW session id the ledger dedupe
  // cannot see and is credited again. Best-effort — the columns above are
  // already nulled, so the portal cannot show it.
  const priorLink = typeof app.pay_link_id === "string" ? app.pay_link_id : null;
  if (priorLink && priorLink !== session.payment_link) {
    await deactivatePaymentLink(priorLink, eventAccount);
  }

  // MONEY-F16: apply the same payment record / amount_paid / status update to
  // the source invoice. invoice_id is text on aia_pay_apps; a legacy non-uuid
  // value is a terminal "not found", logged, not retried.
  const invoiceId = typeof app.invoice_id === "string" ? app.invoice_id.trim() : "";
  if (!invoiceId) {
    console.warn("[stripe-webhook] aia_pay_app", recordId, "has no invoice_id — no invoice credited");
    return { ok: true };
  }
  const credit = await creditInvoice(supabase, invoiceId, session, eventAccount, "aia_pay_app", recordId);
  if (!credit.ok) {
    if (credit.reason === "invoice not found") {
      console.warn("[stripe-webhook] aia_pay_app", recordId, "points at missing invoice", invoiceId, "— paid_at set, invoice not credited");
      return { ok: true };
    }
    // Transient: pay app is stamped (idempotent), invoice credit is not — 500
    // so Stripe retries the whole event; the retry re-runs both safely.
    return credit;
  }
  return { ok: true };
}

/**
 * Locate the invoice a charge / dispute belongs to through its PaymentIntent.
 * New ledger entries carry `paymentIntentId`; entries written before 2026-09-04
 * only had `notes: "payment_intent: pi_…"`. Both are exact jsonb containment
 * probes (payments @> '[{…}]') passed as a JSON STRING — postgrest-js turns a
 * JS array into the `{a,b}` array-literal form, which is wrong for jsonb.
 */
async function findInvoiceByPaymentIntent(
  supabase: Db,
  paymentIntent: string | null | undefined,
): Promise<InvoiceRow | null | "db fetch failed"> {
  if (!paymentIntent) return null;
  const probes = [{ paymentIntentId: paymentIntent }, { notes: `payment_intent: ${paymentIntent}` }];
  for (const probe of probes) {
    const { data, error } = await supabase
      .from("invoices")
      .select(INVOICE_COLS)
      .contains("payments", JSON.stringify([probe]))
      .limit(1);
    if (error) {
      console.error("[stripe-webhook] invoice lookup by payment_intent failed:", error.message);
      return "db fetch failed";
    }
    if (Array.isArray(data) && data.length > 0) return data[0] as InvoiceRow;
  }
  return null;
}

/**
 * MONEY-F17: a refund (partial or full, issued from the Stripe dashboard or
 * API) lands in the ledger as a negative entry and moves amount_paid and the
 * status back. See applyChargeRefund for the two event shapes and the
 * idempotency keys.
 */
async function handleChargeRefunded(supabase: Db, charge: StripeCharge): Promise<HandlerResult> {
  const found = await findInvoiceByPaymentIntent(supabase, charge.payment_intent);
  if (found === "db fetch failed") return { ok: false, reason: "db fetch failed" };
  if (!found) return { ok: false, reason: `no invoice for charge ${charge.id}` };

  const now = new Date().toISOString();
  const refund = applyChargeRefund(ledgerFrom(found.payments), charge, now);
  if (!refund.changed) return { ok: true, reason: "duplicate" };

  const newAmountPaid = toCents2(Math.max(0, Number(found.amount_paid ?? 0) + refund.delta));
  const newStatus = settlementStatus(found.status, newAmountPaid, found);
  const { error } = await supabase
    .from("invoices")
    .update({ amount_paid: newAmountPaid, payments: refund.ledger, status: newStatus, updated_at: now })
    .eq("id", found.id);
  if (error) {
    console.error("[stripe-webhook] Failed to apply refund to invoice:", found.id, error.message);
    return { ok: false, reason: "db update failed" };
  }
  console.log("[stripe-webhook] Refund", charge.id, "→ invoice", found.id, newStatus, "amount_paid:", newAmountPaid, "delta:", refund.delta);
  return { ok: true };
}

/**
 * MONEY-F17: charge.dispute.created stamps invoices.payment_disputed_at so
 * the GC sees the chargeback instead of "Paid in full"; charge.dispute.closed
 * clears it, and a LOST dispute (funds withdrawn for good) is booked like a
 * refund, keyed by dispute id.
 */
async function handleDispute(supabase: Db, dispute: StripeDispute, closed: boolean): Promise<HandlerResult> {
  const found = await findInvoiceByPaymentIntent(supabase, dispute.payment_intent);
  if (found === "db fetch failed") return { ok: false, reason: "db fetch failed" };
  if (!found) return { ok: false, reason: `no invoice for dispute ${dispute.id}` };

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = closed
    ? { payment_disputed_at: null, updated_at: now }
    : { payment_disputed_at: now, updated_at: now };

  if (closed && dispute.status === "lost") {
    const applied = applyLedgerEntry(ledgerFrom(found.payments), {
      id: `stripe-dispute-${dispute.id}`,
      amount: -toCents2(Number(dispute.amount ?? 0) / 100),
      method: "stripe",
      kind: "dispute",
      date: now,
      receivedAt: now,
      reference: dispute.charge ?? dispute.id,
      paymentIntentId: dispute.payment_intent ?? undefined,
      notes: `chargeback lost (${dispute.reason ?? "unspecified"})`,
    });
    if (applied.applied) {
      const newAmountPaid = toCents2(Math.max(0, Number(found.amount_paid ?? 0) + applied.delta));
      patch.payments = applied.ledger;
      patch.amount_paid = newAmountPaid;
      patch.status = settlementStatus(found.status, newAmountPaid, found);
    }
  }

  const { error } = await supabase.from("invoices").update(patch).eq("id", found.id);
  if (error) {
    console.error("[stripe-webhook] Failed to record dispute on invoice:", found.id, error.message);
    return { ok: false, reason: "db update failed" };
  }
  console.log("[stripe-webhook] Dispute", dispute.id, closed ? `closed (${dispute.status})` : "opened", "→ invoice", found.id);
  return { ok: true };
}

// ── Branded receipt email — sent after a successful Stripe payment lands
//    on the invoice. Pulls invoice number + project name + GC company name
//    from Supabase so the recipient sees a proper "Receipt from Smith
//    Builders for the Henderson Renovation" instead of a faceless robot
//    note. Failures are swallowed (best-effort).
interface ReceiptOpts {
  invoiceId: string;
  amountReceived: number;
  newAmountPaid: number;
  totalDue: number;
  newStatus: string; // "paid" | "partially_paid" after a credit (settlementStatus)
  sessionId: string;
  customerEmail?: string;
}

async function sendReceiptEmail(
  supabase: ReturnType<typeof createClient<any, "public", any>>,
  opts: ReceiptOpts,
): Promise<void> {
  if (!RESEND_API_KEY) return;
  if (!opts.customerEmail) {
    console.log("[stripe-webhook] No customer email on session; skipping receipt");
    return;
  }
  try {
    const { data: invoice } = await supabase
      .from("invoices")
      .select("id, number, project_id, user_id, line_items")
      .eq("id", opts.invoiceId)
      .single();
    if (!invoice) return;

    const { data: project } = await supabase
      .from("projects")
      .select("id, name, location")
      .eq("id", invoice.project_id)
      .single();

    const { data: profile } = await supabase
      .from("profiles")
      .select("id, email, name, company_name, contact_name, phone")
      .eq("id", invoice.user_id)
      .single();

    const companyName = (profile?.company_name as string | null)
      || (profile?.contact_name as string | null)
      || "MAGE ID";
    const projectName = (project?.name as string | null) ?? "your project";
    const invoiceNumber = (invoice.number as number | null) ?? "—";
    const remaining = Math.max(0, opts.totalDue - opts.newAmountPaid);
    const balanceLine = opts.newStatus === "paid"
      ? "Paid in full — no balance remaining."
      : `Balance remaining: <strong>${escapeHtml(formatMoney(remaining))}</strong>`;

    const bodyHtml = `
      <p style="margin:0 0 14px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:14px;line-height:22px;color:#4A5159;">
        Thanks — your payment for <strong>${escapeHtml(projectName)}</strong> (Invoice #${escapeHtml(String(invoiceNumber))}) was received.
      </p>
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:16px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:13px;color:#4A5159;">
        <tr><td style="padding:4px 12px 4px 0;color:#9AA3AD;">Project</td><td style="padding:4px 0;">${escapeHtml(projectName)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#9AA3AD;">Invoice #</td><td style="padding:4px 0;">${escapeHtml(String(invoiceNumber))}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#9AA3AD;">Amount received</td><td style="padding:4px 0;font-weight:700;color:#0B0D10;">${escapeHtml(formatMoney(opts.amountReceived))}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#9AA3AD;">Status</td><td style="padding:4px 0;">${opts.newStatus === "paid" ? "Paid in full" : "Partially paid"}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#9AA3AD;">Reference</td><td style="padding:4px 0;font-family:Menlo,monospace;font-size:11px;">${escapeHtml(opts.sessionId)}</td></tr>
      </table>
      <p style="margin:0 0 16px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:14px;line-height:22px;color:#4A5159;">${balanceLine}</p>
    `;

    const html = wrapEmailHtml({
      preheader: opts.newStatus === "paid"
        ? `Paid in full — ${projectName}`
        : `Payment received — ${projectName}`,
      eyebrow: "Payment received",
      title: formatMoney(opts.amountReceived),
      bodyHtml,
      companyName,
      project: { name: projectName, location: project?.location as string | undefined },
      sender: profile?.email ? { email: profile.email as string, phone: profile?.phone as string | undefined } : undefined,
      // Receipts are transactional — recipient should always get them.
      unsubscribe: { enabled: false },
    });

    const subject = opts.newStatus === "paid"
      ? `Payment received — ${projectName} paid in full`
      : `Payment received — ${projectName}`;

    const result = await resendSend(RESEND_API_KEY, {
      to: opts.customerEmail,
      subject,
      html,
      fromCompanyName: companyName,
      replyTo: profile?.email as string | undefined,
      unsubscribe: { enabled: false },
    });
    if (!result.ok) {
      console.warn("[stripe-webhook] receipt send failed", JSON.stringify(result.resp).slice(0, 200));
    }
  } catch (err) {
    console.warn("[stripe-webhook] receipt email error", err);
  }
}

interface Outcome {
  retry: boolean;
  reason?: string;
}

const TRANSIENT_REASONS = new Set(["db update failed", "db fetch failed"]);

/** Transient failures ask Stripe to retry; everything else is ACKed after a log line. */
function outcomeOf(label: string, result: HandlerResult): Outcome {
  if (result.ok) return { retry: false };
  console.warn("[stripe-webhook]", label, "handling failed:", result.reason);
  return TRANSIENT_REASONS.has(result.reason) ? { retry: true, reason: result.reason } : { retry: false };
}

/**
 * Route one verified, claimed event. { retry: true } is returned for
 * TRANSIENT failures only — a captured payment whose reconciliation did not
 * land. The caller then releases the event claim and answers 500 so Stripe
 * retries with backoff; every handler is idempotent (ledger ids, set-once
 * columns, on-conflict grants) so the retry is safe. Terminal outcomes
 * (record gone, session unpaid, duplicate, unknown type) are ACKed with 200 —
 * retrying cannot fix them and would only exhaust Stripe's retry budget.
 */
async function dispatchEvent(supabase: Db, event: StripeWebhookEvent): Promise<Outcome> {
  switch (event.type) {
    case "checkout.session.completed":
    // MONEY-F17 sibling: delayed-notification methods (ACH debit, …) complete
    // the session UNPAID and settle later; the paid signal is this second
    // event, carrying the same session object. Routed identically.
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object as StripeCheckoutSession;

      // Property-owner RFP post fee — a platform-direct charge from
      // create-rfp-checkout (not a Connect invoice). Grant one post credit,
      // idempotent by Stripe session id, and skip invoice/AIA reconciliation.
      if (session.metadata?.purpose === "rfp_post_fee") {
        const paid = session.payment_status === "paid" || session.payment_status === "no_payment_required";
        const userId = session.metadata?.user_id;
        if (!paid || !userId) {
          console.warn("[stripe-webhook] rfp_post_fee: not paid or missing user_id");
          return { retry: false };
        }
        try {
          const { data: granted, error } = await supabase.rpc("grant_rfp_post_credit", {
            p_user: userId,
            p_session: session.id,
            p_n: 1,
          });
          if (error) {
            console.warn("[stripe-webhook] rfp credit grant failed:", error.message);
            // Transient: the payment landed but our grant didn't — retry. The
            // session-keyed grant makes the retry safe (no double).
            return { retry: true, reason: "rfp credit grant failed" };
          }
          console.log("[stripe-webhook] rfp post credit:", granted ? "granted" : "duplicate", userId);
        } catch (err) {
          console.warn("[stripe-webhook] rfp credit grant threw:", err);
          return { retry: true, reason: "rfp credit grant threw" };
        }
        return { retry: false };
      }

      // Route by record_type stamped at link-creation time. Default (absent
      // or "invoice") is the invoice reconciliation path; "aia_pay_app"
      // stamps the AIA record AND credits its source invoice (MONEY-F16).
      const recordType = session.metadata?.record_type;
      const result = recordType === "aia_pay_app"
        ? await handleAiaPayAppCompleted(
            supabase,
            session.metadata?.record_id ?? session.metadata?.invoice_id ?? "",
            session,
            event.account,
          )
        : await handleCheckoutCompleted(supabase, session, event.account);
      const outcome = outcomeOf(event.type, result);
      if (outcome.retry) return outcome;

      // MONEY-F2: retire the link that was just paid, on the account that
      // owns it. Runs on duplicate deliveries too (a retry after a Stripe 5xx
      // here must still get to deactivate). Links minted after 2026-09-04
      // carry restrictions.completed_sessions.limit=1 and are already
      // inactive — Stripe accepts active=false on an inactive link — so this
      // is what retires the links minted before that which are still live.
      //
      // ONLY for links MAGE minted: create-payment-link stamps record_id /
      // invoice_id on every link it creates. A Payment Link the platform or a
      // connected account created elsewhere carries no MAGE metadata and is
      // not ours to retire — the terminal "no metadata.invoice_id" outcome
      // above must not turn into a deactivation.
      const isMageLink = !!(session.metadata?.record_id || session.metadata?.invoice_id);
      if (isMageLink && session.payment_status === "paid" && session.payment_link) {
        const d = await deactivatePaymentLink(session.payment_link, event.account);
        if (d === "retry") return { retry: true, reason: "payment link deactivation failed" };
      }
      return { retry: false };
    }
    case "charge.refunded": {
      return outcomeOf(event.type, await handleChargeRefunded(supabase, event.data.object as StripeCharge));
    }
    case "charge.dispute.created":
    case "charge.dispute.closed": {
      return outcomeOf(
        event.type,
        await handleDispute(supabase, event.data.object as StripeDispute, event.type === "charge.dispute.closed"),
      );
    }
    case "checkout.session.async_payment_failed":
    case "payment_intent.payment_failed": {
      // Log type + object id ONLY. The object carries card and customer
      // details; the old line dumped 200 chars of it into the logs
      // (01-security appendix). TODO: surface as a contractor notification.
      const obj = event.data.object as { id?: string } | null;
      console.log("[stripe-webhook] Payment failed:", event.type, obj?.id ?? "(no id)");
      return { retry: false };
    }
    case "account.updated": {
      // Connect lifecycle event — the connected account's status changed
      // (KYC completed, bank linked, etc.). Reconcile the flags into our
      // profiles table so the Settings page reflects reality.
      const acct = event.data.object as StripeAccountObject;
      const result = await handleAccountUpdated(acct);
      if (!result.ok) {
        console.warn("[stripe-webhook] account.updated handling failed:", result.reason);
        // A transient DB write failure means the Connect status flags never
        // landed — retry. The flag write is idempotent. The terminal
        // 'no account id' case is ACKed.
        if (result.reason === "db update failed") return { retry: true, reason: result.reason };
      }
      return { retry: false };
    }
    case "account.application.deauthorized": {
      // Audit-2026-05-21 #30.4: connected account disconnected from the
      // platform. Stripe fires this when a GC deauthorizes us from their
      // Express dashboard (or when Stripe disables the account on their
      // end). Pre-fix we ignored the event entirely — the profile's
      // stripe_account_id + stripe_charges_enabled flags stayed set,
      // leaving the Settings page claiming "Connected" against a Stripe
      // account that no longer accepts charges.
      //
      // The event payload's data.object IS the Account object, but the
      // top-level event.account field is the more-reliable identifier
      // for deauthorization events per Stripe's docs (Account object
      // can be partial here).
      const acctId = event.account ?? (event.data.object as StripeAccountObject)?.id;
      if (!acctId) {
        console.warn("[stripe-webhook] account.application.deauthorized with no account id");
        return { retry: false };
      }
      try {
        const { error } = await supabase
          .from("profiles")
          .update({
            stripe_account_id: null,
            stripe_charges_enabled: false,
            stripe_payouts_enabled: false,
            stripe_details_submitted: false,
            stripe_connect_updated_at: new Date().toISOString(),
          })
          .eq("stripe_account_id", acctId);
        if (error) {
          console.error("[stripe-webhook] deauthorize cleanup failed:", error);
        } else {
          console.log("[stripe-webhook] Cleared Connect linkage for deauthorized account", acctId);
        }
      } catch (err) {
        console.error("[stripe-webhook] deauthorize handler threw:", err);
      }
      return { retry: false };
    }
    default:
      // Ignore other event types — we acknowledge with 200 so Stripe stops
      // retrying. The dashboard webhook config should only subscribe us to
      // event types we actually handle.
      console.log("[stripe-webhook] Ignored event type:", event.type);
      return { retry: false };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const sigHeader = req.headers.get("stripe-signature") || "";
  const rawBody = await req.text();

  if (!STRIPE_WEBHOOK_SECRET) {
    console.error("[stripe-webhook] STRIPE_WEBHOOK_SECRET not configured");
    return jsonResponse({ error: "webhook misconfigured" }, 500);
  }

  const verified = await verifyStripeSignature(rawBody, sigHeader, STRIPE_WEBHOOK_SECRET);
  if (!verified) {
    console.warn("[stripe-webhook] Signature verification failed");
    return jsonResponse({ error: "signature verification failed" }, 401);
  }

  let event: StripeWebhookEvent;
  try {
    event = JSON.parse(rawBody) as StripeWebhookEvent;
  } catch {
    return jsonResponse({ error: "invalid json" }, 400);
  }
  if (!event || typeof event.id !== "string" || typeof event.type !== "string") {
    return jsonResponse({ error: "not a stripe event" }, 400);
  }

  console.log("[stripe-webhook] Received:", event.type, "id:", event.id);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Idempotency by Stripe event id (see claimEvent).
  const claim = await claimEvent(supabase, event);
  if (claim.state === "processed") {
    console.log("[stripe-webhook] Event already processed, skipping:", event.id);
    return jsonResponse({ received: true, duplicate: true }, 200);
  }
  if (claim.state === "in_flight") {
    console.warn("[stripe-webhook] Event in flight elsewhere, asking Stripe to retry:", event.id);
    return jsonResponse({ error: "event is being processed, retry" }, 409);
  }

  let outcome: Outcome;
  try {
    outcome = await dispatchEvent(supabase, event);
  } catch (err) {
    console.error("[stripe-webhook] handler threw:", event.type, event.id, err);
    outcome = { retry: true, reason: "handler threw" };
  }

  if (outcome.retry) {
    console.warn("[stripe-webhook] transient failure, releasing claim for retry:", event.id, outcome.reason);
    if (claim.state === "claimed") await releaseEvent(supabase, event.id, claim.token);
    return jsonResponse({ error: "transient failure, retry", reason: outcome.reason }, 500);
  }
  if (claim.state === "claimed") await markProcessed(supabase, event.id);
  return jsonResponse({ received: true }, 200);
});
