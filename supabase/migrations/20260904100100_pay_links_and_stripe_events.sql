-- ============================================================================
-- 20260904100100_pay_links_and_stripe_events.sql
-- Audit 2026-09-03 (final push): MONEY-F2, MONEY-F16, MONEY-F17, and the
-- 01-security-edge-functions appendix note on stripe-webhook ("non-atomic
-- read-modify-write … no event.id table").
--
-- WHY.
--   MONEY-F2   The client portal showed "Pay $10,000" against a Stripe Payment
--              Link that had been minted for $90,000 — a one-tap double charge.
--              create-payment-link now persists the amount a link was minted
--              for (pay_link_amount — DOLLARS, the same unit as
--              invoices.total_due) so the snapshot/portal can refuse to show
--              Pay unless today's balance still equals it; stripe-webhook nulls
--              pay_link_url / pay_link_id / pay_link_amount the moment a link
--              is paid (and deactivates it on Stripe).
--   MONEY-F16  aia_pay_apps had no pay-link columns at all — the AIA "Pay"
--              link lived only in device state and the portal's AIA button
--              had no paid state. Same three columns, same lifecycle.
--   MONEY-F17  charge.dispute.created / .closed now stamp and clear
--              invoices.payment_disputed_at (a lost dispute is booked in the
--              payments ledger like a refund; no column needed for that).
--   EDGE appx  public.stripe_events: one row per Stripe event id. The webhook
--              CLAIMS the row on arrival (insert … on conflict do nothing),
--              stamps processed_at on success, and deletes the claim on a
--              transient failure so Stripe's retry can re-process. Two
--              overlapping deliveries can no longer both credit an invoice.
--              Service-role only: RLS on, no policies, grants revoked.
--
-- HARD ORDERING GATE: apply this migration BEFORE deploying the
-- create-payment-link and stripe-webhook edge functions. Both write the new
-- columns and PostgREST rejects an UPDATE/PATCH that names an unknown column —
-- for the webhook that would 500 every checkout.session.completed until the
-- columns exist, stranding captured payments in Stripe's retry queue.
--
-- Additive and idempotent (add column if not exists / create table if not
-- exists). No data changes.
-- ============================================================================

-- MONEY-F2 — what the live link charges, in dollars (matches total_due).
alter table public.invoices
  add column if not exists pay_link_amount numeric;

-- MONEY-F17 — set by charge.dispute.created, cleared by charge.dispute.closed.
alter table public.invoices
  add column if not exists payment_disputed_at timestamptz;

comment on column public.invoices.pay_link_amount is
  'Dollars the current Stripe Payment Link (pay_link_id) was minted for. Nulled with pay_link_url/pay_link_id once the link is paid or replaced (audit MONEY-F2).';
comment on column public.invoices.payment_disputed_at is
  'Set when Stripe reports a dispute on a payment for this invoice; cleared when the dispute closes (audit MONEY-F17).';

-- MONEY-F16 — the AIA pay app's own link, same lifecycle as the invoice's.
alter table public.aia_pay_apps
  add column if not exists pay_link_url    text,
  add column if not exists pay_link_id     text,
  add column if not exists pay_link_amount numeric;

comment on column public.aia_pay_apps.pay_link_amount is
  'Dollars the current Stripe Payment Link (pay_link_id) was minted for. Nulled with pay_link_url/pay_link_id once the link is paid or replaced (audit MONEY-F2 / F16).';

-- EDGE appendix — idempotency by Stripe event id.
create table if not exists public.stripe_events (
  id           text primary key,
  type         text,
  received_at  timestamptz not null default now(),
  processed_at timestamptz
);

comment on table public.stripe_events is
  'One row per Stripe webhook event id. Claimed on arrival, processed_at on success, deleted on transient failure so the retry re-runs. Service-role only.';

alter table public.stripe_events enable row level security;
-- No policies on purpose: only the service-role client (stripe-webhook) may
-- touch this table. Belt and braces over RLS: nothing for the API roles.
revoke all on table public.stripe_events from anon, authenticated;
-- Explicit, not left to default privileges: if service_role could not write
-- here the webhook would silently run UNGATED behind a single log line.
grant all on table public.stripe_events to service_role;
