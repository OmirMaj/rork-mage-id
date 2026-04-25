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

const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

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

  if (fetchError || !invoice) {
    console.error("[stripe-webhook] Failed to fetch invoice:", invoiceId, fetchError);
    return { ok: false, reason: "invoice not found" };
  }

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
  return { ok: true };
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
      const result = await handleCheckoutCompleted(session);
      if (!result.ok) {
        console.warn("[stripe-webhook] checkout.session.completed handling failed:", result.reason);
        // We still return 200 so Stripe doesn't retry forever for non-recoverable
        // errors (e.g. invoice not found because it was deleted). Real DB errors
        // are logged and can be replayed manually from the Stripe dashboard.
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
