-- 20260713120000_invoice_retention_paylink_columns.sql
-- Additive, nullable columns so retention and Stripe pay-link data survive a
-- cloud refetch. Before this, retentionPercent/Amount/Released/Releases and
-- payLinkUrl/payLinkId lived ONLY in in-memory state + AsyncStorage — they were
-- never written to Supabase, so the invoicesQuery refetch (staleTime 5min,
-- refetchOnWindowFocus) returned rows without them and overwrote both caches,
-- permanently destroying retention balances (A/R money) and pay links.
--
-- HARD ORDERING GATE: this migration MUST be applied to the target project
-- BEFORE the JS that writes these columns ships (OTA). The offline write queue
-- 400s on unknown columns and can drop the entire invoice write, silently
-- failing totalDue/amountPaid/status sync. Apply here first, then OTA.
--
-- No backfill, and NO app-side reconcile is implemented yet: existing
-- retention/pay-link values only live on-device and are still overwritten by
-- the first post-fix cloud refetch, just as before. This fix only prevents loss
-- going FORWARD (values written from now on survive). Preserving the CURRENT
-- on-device values needs a one-time local->cloud reconcile — owner-gated
-- follow-up. All columns nullable; absent = unset.

alter table public.invoices add column if not exists retention_percent  numeric;
alter table public.invoices add column if not exists retention_amount   numeric;
alter table public.invoices add column if not exists retention_released numeric;
alter table public.invoices add column if not exists retention_releases jsonb;
alter table public.invoices add column if not exists pay_link_url        text;
alter table public.invoices add column if not exists pay_link_id         text;
