-- AIA pay-app payment reconciliation columns
--
-- The AIA "Pay" button now mints a Stripe payment link against an
-- aia_pay_apps row (recordType 'aia_pay_app' in create-payment-link). On a
-- successful checkout the stripe-webhook flips these columns via the
-- service-role client. aia_pay_apps had no status/payments ledger — unlike
-- invoices — so "paid" is a single paid_at flip plus the Stripe PaymentIntent
-- id for reconciliation/audit.
--
-- Idempotent: safe to re-run (add column if not exists), which keeps the
-- controller's apply step replay-safe against an already-migrated database.

alter table public.aia_pay_apps
  add column if not exists paid_at timestamptz,
  add column if not exists payment_intent_id text;
