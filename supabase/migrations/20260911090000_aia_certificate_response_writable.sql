-- The architect's response must be recordable on a CERTIFIED pay application.
--
-- Migration 20260728120000 freezes the financial content of an aia_pay_apps
-- row once `certified_at` is set (create-payment-link stamps it the instant it
-- mints a Stripe link). `snapshot_totals` is in that frozen list, and it has to
-- be: the totals a lender funded against are exactly what must not move.
--
-- What that also froze, unintentionally, is AMOUNT CERTIFIED. A201 §9.5/§9.6
-- let the architect certify an amount DIFFERENT from the one applied for, the
-- G702 carries a line for it, and the NEXT application's line 7 is "Line 6 from
-- prior Certificate" — the CERTIFIED figure. It arrives AFTER the application
-- was sent, i.e. always on a row that is already certified. The app stores it
-- (with its date and explanation) in the `__mageCertificate` sidecar inside
-- snapshot_totals — a sidecar rather than three new columns because an OTA
-- reaches devices before a migration is applied, and an unknown top-level key
-- makes PostgREST reject the whole write, which the offline queue then re-sends
-- forever (utils/projectContextPure.ts documents that choice in full).
--
-- Net effect before this migration: a GC with Stripe Connect could never record
-- what came back, so the next period's line 7 kept seeding from the amount
-- APPLIED FOR — the exact defect AMOUNT CERTIFIED was built to fix, in the only
-- flow it exists for. An architect certifying $58,200 against a $64,000
-- application left the GC permanently $5,800 short, in a number he believes is
-- automatic.
--
-- So: compare snapshot_totals with the three RESPONSE keys removed. Everything
-- else inside it — the totals themselves, the frozen CHANGE ORDER SUMMARY, the
-- notary jurat, PERIOD FROM, line 5b's rate — stays immutable, and every other
-- column in the original list is untouched.
--
-- Idempotent: CREATE OR REPLACE plus DROP/CREATE trigger, same as 20260728120000.
-- Inert for rows with certified_at IS NULL, which is still the ordinary case.

create or replace function public.freeze_certified_aia_pay_app()
returns trigger
language plpgsql
as $$
declare
  old_frozen jsonb;
  new_frozen jsonb;
begin
  if old.certified_at is not null then
    -- The architect's answer is not part of the application's financial
    -- content; strip it from both sides before comparing.
    old_frozen := (to_jsonb(old.snapshot_totals)
                     #- '{__mageCertificate,amountCertified}'
                     #- '{__mageCertificate,certifiedDate}'
                     #- '{__mageCertificate,certifiedExplanation}');
    new_frozen := (to_jsonb(new.snapshot_totals)
                     #- '{__mageCertificate,amountCertified}'
                     #- '{__mageCertificate,certifiedDate}'
                     #- '{__mageCertificate,certifiedExplanation}');

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
      or new_frozen                     is distinct from old_frozen
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
