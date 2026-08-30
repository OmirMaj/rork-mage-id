// stripe-webhook
//
// Receives Stripe webhook events and reconciles them back to MAGE ID
// invoices. Without this, payments succeed on Stripe but our DB never
// learns the invoice was paid — clients pay, the contractor never sees
// it, support tickets ensue.
//
// Events we care about (configure these in the Stripe dashboard webhook
// endpoint, point at https://<project>.supabase.co/functions/v1/stripe-webhook):
//
//   checkout.session.completed
//     → Stripe Payment Link emits this when the client finishes paying.
//     → metadata.invoice_id is the MAGE ID invoice we attached at link
//       creation time (see create-payment-link/index.ts:218).
//     → Mark the invoice as paid (or partially_paid if amount_paid <
//       total_due), append a payment record, set updated_at.
//
//   payment_intent.payment_failed
//     → For now we just log it. Future: surface to the contractor as a
//       "Client tried to pay but card failed" notification.
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

const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";

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

interface StripeCheckoutSession {
  id: string;
  object: "checkout.session";
  amount_total: number;
  currency: string;
  customer_email?: string | null;
  metadata?: Record<string, string>;
  payment_intent?: string;
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

interface InvoicePaymentRecord {
  id: string;
  amount: number;
  method: "stripe";
  receivedAt: string;
  reference: string;
  notes?: string;
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

/**
 * Reconciles a successful checkout back to an AIA pay application. AIA pay
 * apps live in their own table (public.aia_pay_apps) and — unlike invoices —
 * carry no amount_paid / payments ledger, so "paid" is a single flip of
 * paid_at + payment_intent_id. Uses the same service-role client the invoice
 * path uses, so the write is a service-role REST PATCH under the hood.
 *
 * Idempotency: paid_at is set once. A Stripe retry re-runs this, but the
 * PATCH is naturally idempotent (same paid_at/payment_intent_id values land
 * again — no double-credit ledger to corrupt like there is for invoices).
 */
async function handleAiaPayAppCompleted(
  recordId: string,
  session: StripeCheckoutSession,
): Promise<{ ok: boolean; reason?: string }> {
  if (session.payment_status !== "paid") {
    return { ok: false, reason: `session.payment_status is ${session.payment_status}, not paid` };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { error: updateError } = await supabase
    .from("aia_pay_apps")
    .update({
      paid_at: new Date().toISOString(),
      payment_intent_id: session.payment_intent ?? null,
    })
    .eq("id", recordId);

  if (updateError) {
    console.error("[stripe-webhook] Failed to update aia_pay_app:", recordId, updateError);
    return { ok: false, reason: "db update failed" };
  }

  console.log("[stripe-webhook] Marked aia_pay_app", recordId, "paid, PI:", session.payment_intent ?? "(none)");
  return { ok: true };
}

async function handleCheckoutCompleted(
  session: StripeCheckoutSession,
): Promise<{ ok: boolean; reason?: string }> {
  const invoiceId = session.metadata?.invoice_id;
  if (!invoiceId) {
    return { ok: false, reason: "session has no metadata.invoice_id" };
  }
  if (session.payment_status !== "paid") {
    return { ok: false, reason: `session.payment_status is ${session.payment_status}, not paid` };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Fetch the invoice — we need current amount_paid + total_due to compute
  // the new status (paid vs partially_paid).
  const { data: invoice, error: fetchError } = await supabase
    .from("invoices")
    .select("id, total_due, amount_paid, payments, status")
    .eq("id", invoiceId)
    .single();

  if (fetchError) {
    console.error("[stripe-webhook] Failed to fetch invoice:", invoiceId, fetchError);
    // Split terminal from transient. `.single()` returns PGRST116 when zero
    // rows match (invoice genuinely gone — retrying won't help). Any other
    // error code is a transient DB/network read failure — a captured payment
    // would be stranded if we ACK'd 200, so signal a retry instead.
    if (fetchError.code === "PGRST116") return { ok: false, reason: "invoice not found" };
    return { ok: false, reason: "db fetch failed" };
  }
  if (!invoice) return { ok: false, reason: "invoice not found" };

  // Stripe amount_total is in cents; our DB stores dollars as NUMERIC.
  const amountReceived = session.amount_total / 100;
  const newAmountPaid = Number(invoice.amount_paid ?? 0) + amountReceived;
  const totalDue = Number(invoice.total_due ?? 0);
  const newStatus = newAmountPaid >= totalDue - 0.01 ? "paid" : "partially_paid";

  const paymentRecord: InvoicePaymentRecord = {
    id: `stripe-${session.id}`,
    amount: amountReceived,
    method: "stripe",
    receivedAt: new Date().toISOString(),
    reference: session.id,
    notes: session.payment_intent ? `payment_intent: ${session.payment_intent}` : undefined,
  };

  // Idempotency: don't double-credit if Stripe retries the webhook.
  const existingPayments: InvoicePaymentRecord[] = Array.isArray(invoice.payments) ? invoice.payments : [];
  if (existingPayments.some((p) => p.id === paymentRecord.id)) {
    console.log("[stripe-webhook] Duplicate session, skipping:", session.id);
    return { ok: true, reason: "duplicate" };
  }

  const { error: updateError } = await supabase
    .from("invoices")
    .update({
      amount_paid: newAmountPaid,
      payments: [...existingPayments, paymentRecord],
      status: newStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", invoiceId);

  if (updateError) {
    console.error("[stripe-webhook] Failed to update invoice:", updateError);
    return { ok: false, reason: "db update failed" };
  }

  console.log(
    "[stripe-webhook] Marked invoice",
    invoiceId,
    "as",
    newStatus,
    "amount_paid:",
    newAmountPaid,
    "/",
    totalDue,
  );

  // Best-effort receipt email — fire-and-forget so a Resend hiccup never
  // fails the webhook (Stripe retries on non-2xx and the duplicate-payment
  // guard above would refuse the second run).
  void sendReceiptEmail(supabase, {
    invoiceId,
    amountReceived,
    newAmountPaid,
    totalDue,
    newStatus,
    sessionId: session.id,
    customerEmail: (session as unknown as { customer_email?: string; customer_details?: { email?: string } })
      .customer_email
      ?? (session as unknown as { customer_details?: { email?: string } }).customer_details?.email,
  });

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
  newStatus: "paid" | "partially_paid";
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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sigHeader = req.headers.get("stripe-signature") || "";
  const rawBody = await req.text();

  if (!STRIPE_WEBHOOK_SECRET) {
    console.error("[stripe-webhook] STRIPE_WEBHOOK_SECRET not configured");
    return new Response(JSON.stringify({ error: "webhook misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const verified = await verifyStripeSignature(rawBody, sigHeader, STRIPE_WEBHOOK_SECRET);
  if (!verified) {
    console.warn("[stripe-webhook] Signature verification failed");
    return new Response(JSON.stringify({ error: "signature verification failed" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let event: StripeWebhookEvent;
  try {
    event = JSON.parse(rawBody) as StripeWebhookEvent;
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  console.log("[stripe-webhook] Received:", event.type, "id:", event.id);

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as StripeCheckoutSession;

      // Property-owner RFP post fee — a platform-direct charge from
      // create-rfp-checkout (not a Connect invoice). Grant one post credit,
      // idempotent by Stripe session id, and skip invoice/AIA reconciliation.
      if (session.metadata?.purpose === "rfp_post_fee") {
        const paid = session.payment_status === "paid" || session.payment_status === "no_payment_required";
        const userId = session.metadata?.user_id;
        if (!paid || !userId) {
          console.warn("[stripe-webhook] rfp_post_fee: not paid or missing user_id");
          break;
        }
        try {
          const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
          const { data: granted, error } = await supabase.rpc("grant_rfp_post_credit", {
            p_user: userId,
            p_session: session.id,
            p_n: 1,
          });
          if (error) {
            console.warn("[stripe-webhook] rfp credit grant failed:", error.message);
            // Transient: the payment landed but our grant didn't — 500 so Stripe
            // retries. The session-keyed grant makes the retry safe (no double).
            return new Response(
              JSON.stringify({ error: "transient db failure, retry" }),
              { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
          console.log("[stripe-webhook] rfp post credit:", granted ? "granted" : "duplicate", userId);
        } catch (err) {
          console.warn("[stripe-webhook] rfp credit grant threw:", err);
          return new Response(
            JSON.stringify({ error: "transient db failure, retry" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        break;
      }

      // Route by record_type stamped at link-creation time. Default (absent
      // or "invoice") preserves the original invoice reconciliation path
      // byte-for-byte. "aia_pay_app" flips paid_at on the AIA record instead.
      const recordType = session.metadata?.record_type;
      const result = recordType === "aia_pay_app"
        ? await handleAiaPayAppCompleted(
            session.metadata?.record_id ?? session.metadata?.invoice_id ?? "",
            session,
          )
        : await handleCheckoutCompleted(session);
      if (!result.ok) {
        console.warn("[stripe-webhook] checkout.session.completed handling failed:", result.reason);
        // Distinguish recoverable from terminal outcomes. A transient DB
        // write failure means the payment succeeded on Stripe but our
        // reconciliation didn't land — if we ACK with 200 here, Stripe never
        // retries and the invoice is stranded "unpaid" forever with no alert.
        // Return 500 so Stripe retries with backoff; the idempotency guard in
        // handleCheckoutCompleted (existing payment id match) makes the retry
        // safe. Terminal cases (invoice not found / deleted, no
        // metadata.invoice_id, payment_status not "paid", duplicate) are not
        // fixable by retrying, so those fall through to the 200 ACK below.
        if (result.reason === "db update failed" || result.reason === "db fetch failed") {
          return new Response(
            JSON.stringify({ error: "transient db failure, retry" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }
      break;
    }
    case "payment_intent.payment_failed": {
      console.log("[stripe-webhook] Payment failed:", JSON.stringify(event.data.object).slice(0, 200));
      // TODO: notify the contractor that a client tried but failed.
      break;
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
        // landed — 500 so Stripe retries. The flag write is idempotent, so a
        // retry is safe. The terminal 'no account id' case falls through to 200.
        if (result.reason === "db update failed") {
          return new Response(
            JSON.stringify({ error: "transient db failure, retry" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }
      break;
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
        break;
      }
      try {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
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
      break;
    }
    default:
      // Ignore other event types — we acknowledge with 200 so Stripe stops
      // retrying. The dashboard webhook config should only subscribe us to
      // event types we actually handle.
      console.log("[stripe-webhook] Ignored event type:", event.type);
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
