-- D2 — per-invoice dunning dedup markers (mirror coi-expiry-watch's
-- coi_last_warned_* pattern). Additive, idempotent, nullable, no default/
-- rewrite — safe on the live invoices table. Operational columns only;
-- the app never reads them; service-role dunning fn bypasses RLS. Applied
-- via Supabase MCP apply_migration at ship (independent of Netlify/H4).
alter table public.invoices add column if not exists dunning_stage integer;
alter table public.invoices add column if not exists dunning_last_sent_at timestamptz;
