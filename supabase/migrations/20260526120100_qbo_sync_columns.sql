-- 20260526120100_qbo_sync_columns.sql
-- Additive nullable qbo_* columns on the financial tables so we can track
-- the QBO counterpart, last-synced hash, and per-row sync status without
-- breaking anything. Backfill is unnecessary (everything starts as null).

alter table public.projects        add column if not exists qbo_customer_id text;
alter table public.projects        add column if not exists qbo_synced_at  timestamptz;

alter table public.invoices        add column if not exists qbo_id           text;
alter table public.invoices        add column if not exists qbo_hash         text;
alter table public.invoices        add column if not exists qbo_synced_at    timestamptz;
alter table public.invoices        add column if not exists qbo_sync_status  text;
alter table public.invoices drop constraint if exists invoices_qbo_sync_status_check;
alter table public.invoices add  constraint invoices_qbo_sync_status_check
  check (qbo_sync_status is null or qbo_sync_status in ('pending','synced','error'));
alter table public.invoices        add column if not exists qbo_error        text;
alter table public.invoices        add column if not exists qbo_retry_count  int default 0;

-- Payments live inside invoices.payments jsonb in the codebase; no separate
-- payments table. The qbo_payment_id and source markers live in-blob per
-- payment (handled in the worker).

-- Phase 2/3 columns (vendors, bills, COs, AIA) are added in their phases' migrations.
