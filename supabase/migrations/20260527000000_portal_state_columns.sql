-- 20260527000000_portal_state_columns.sql
-- Additive jsonb `portal_state` columns on every item type that participates
-- in the Send-to-Client workflow. All nullable; an absent column is treated
-- as Sent by the snapshot filter (backward-compat preserved). No backfill.
--
-- The autoShare toggle group lives inside the existing client_portal jsonb
-- on projects — no schema change needed for it.
--
-- Table name corrections vs. original spec:
--   aia_pay_applications  → aia_pay_apps        (actual table name)
--   daily_field_reports   → daily_reports        (actual table name)
--   selections            → selection_categories (actual table name)

alter table public.change_orders        add column if not exists portal_state jsonb;
alter table public.invoices             add column if not exists portal_state jsonb;
alter table public.aia_pay_apps         add column if not exists portal_state jsonb;
alter table public.rfis                 add column if not exists portal_state jsonb;
alter table public.submittals           add column if not exists portal_state jsonb;
alter table public.daily_reports        add column if not exists portal_state jsonb;
alter table public.photos               add column if not exists portal_state jsonb;
alter table public.selection_categories add column if not exists portal_state jsonb;
alter table public.warranties           add column if not exists portal_state jsonb;

-- Defensive CHECK: the jsonb's `status` key (when present) must be one of
-- the three valid values. Mirrors the TypeScript union; protects against
-- bad writes via the supabase rest API. Allows null jsonb + jsonb without
-- a status key (grandfathered → Sent).
do $$
declare
  t text;
begin
  foreach t in array array[
    'change_orders','invoices','aia_pay_apps','rfis','submittals',
    'daily_reports','photos','selection_categories','warranties'
  ] loop
    execute format($f$
      alter table public.%I drop constraint if exists %I;
      alter table public.%I add  constraint %I
        check (portal_state is null
               or not (portal_state ? 'status')
               or portal_state->>'status' in ('draft','sent','recalled'));
    $f$, t, t || '_portal_state_status_check', t, t || '_portal_state_status_check');
  end loop;
end $$;
