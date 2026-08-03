-- Contract payment milestone → invoice link.
--
-- The one-tap "Create invoice" on a PaymentMilestone row stamps the milestone
-- (and its contract) onto the invoice it produced. The milestone's own
-- payment_schedule entry ALSO flips to status='invoiced' — but that is a
-- separate write to project_contracts, and it can fail (offline, RLS, app
-- killed) after the invoice has already landed. Recording the link on the
-- invoice too makes the double-bill guard two-sided: the contract screen can
-- see "this milestone already produced an invoice" even when the flip was
-- lost, so the same work can never be billed to the client twice.
--
-- Additive, idempotent, nullable, no default → no table rewrite, safe on the
-- live invoices table. Applied via Supabase MCP apply_migration at ship.
alter table public.invoices add column if not exists source_milestone_id text;
alter table public.invoices add column if not exists source_contract_id text;

-- Lookup path for "has this milestone already been billed?". Partial index —
-- the vast majority of invoices are not milestone-sourced.
create index if not exists invoices_source_milestone_id_idx
  on public.invoices (source_milestone_id)
  where source_milestone_id is not null;
