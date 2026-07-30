-- Lock certified AIA pay-apps at the DB level (Audit-2026-05-21 #28.1 HIGH).
--
-- app/aia-pay-app.tsx has a UI-only edit lock: once a pay-app's Stripe pay link
-- is minted ("sent for payment") the screen hides the edit controls. But the
-- lock was never enforced server-side — a stale bundle, a second device, or a
-- direct PostgREST call could still UPDATE the SOV lines, retainage, or contract
-- sums, drifting them from the architect's already-certified copy and poisoning
-- the next period's carried-forward "billed-through" totals. On a commercial job
-- that is a real audit / fraud exposure.
--
-- The lock signal: a new `certified_at` timestamp. The create-payment-link edge
-- function stamps it (service role) the instant it mints a pay link for a
-- recordType='aia_pay_app' — the authoritative "sent" moment. The app never
-- persisted its local `payLinkUrl` to this table (there is no such column), so a
-- dedicated server-stamped column is the right, unambiguous signal.
--
-- Once certified, the FINANCIAL content is frozen. Reconciliation and display
-- columns stay writable so the rest of the system keeps working:
--   • paid_at / payment_intent_id  — the stripe-webhook flips these on payment
--   • portal_state                 — the client portal sync writes display state
--   • notes / updated_at           — bookkeeping
--   • certified_at                 — the stamp itself (set once, NULL -> value)
--
-- Inert for existing data: every current row has certified_at = NULL, so the
-- guard below is skipped until a link is actually minted. No back-fill, no
-- behavior change for drafts.
--
-- Idempotent: add-column-if-not-exists + CREATE OR REPLACE + DROP/CREATE trigger.

alter table public.aia_pay_apps
  add column if not exists certified_at timestamptz;

create or replace function public.freeze_certified_aia_pay_app()
returns trigger
language plpgsql
as $$
begin
  if old.certified_at is not null then
    if ( new.application_number         is distinct from old.application_number
      or new.application_date           is distinct from old.application_date
      or new.period_to                  is distinct from old.period_to
      or new.contract_date              is distinct from old.contract_date
      or new.original_contract_sum      is distinct from old.original_contract_sum
      or new.net_change_by_co           is distinct from old.net_change_by_co
      or new.contract_sum_to_date       is distinct from old.contract_sum_to_date
      or new.retainage_percent          is distinct from old.retainage_percent
      or new.less_previous_certificates is distinct from old.less_previous_certificates
      or new.lines                      is distinct from old.lines
      or new.snapshot_totals            is distinct from old.snapshot_totals
      or new.owner_name                 is distinct from old.owner_name
      or new.contractor_name            is distinct from old.contractor_name
      or new.architect_name             is distinct from old.architect_name
      or new.project_name               is distinct from old.project_name
      or new.project_location           is distinct from old.project_location
      or new.contract_for_description   is distinct from old.contract_for_description
      or new.invoice_id                 is distinct from old.invoice_id
      -- Also forbid clearing the certification (can't "un-send" to edit).
      or new.certified_at               is distinct from old.certified_at
    ) then
      raise exception
        'AIA pay application %/% is certified (sent for payment); its financial fields are immutable. Create the next application period instead.',
        old.project_id, old.application_number
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_freeze_certified_aia_pay_app on public.aia_pay_apps;
create trigger trg_freeze_certified_aia_pay_app
  before update on public.aia_pay_apps
  for each row execute function public.freeze_certified_aia_pay_app();
