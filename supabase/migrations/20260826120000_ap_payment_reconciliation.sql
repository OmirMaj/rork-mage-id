-- AP payment reconciliation — how a sub invoice actually got paid.
--
-- "Mark paid" was a bare status flip: the row said `paid` and stamped paid_at
-- (when the GC TAPPED the button), but recorded nothing about the payment
-- itself. So the check written from the bank and the invoice closed in MAGE
-- were two disconnected facts — nothing to reconcile against a bank statement,
-- and no answer to "which check paid this?" three months later at tax time.
--
-- MAGE deliberately does NOT move money (that would make it a payment
-- processor — see docs/audits/2026-08-26-moat-fixes.md, decision #5, founder
-- chose reconciliation-only). These columns record the payment the GC made
-- ELSEWHERE, so paid-vs-owed reconciles and the 1099/audit trail is real.
--
--   payment_method    — 'check' | 'ach' | 'card' | 'cash' | 'other'
--   payment_reference — check number, ACH trace, confirmation code
--   paid_on           — the DATE money actually left the account. Distinct from
--                       paid_at (when the GC recorded it in the app); a check
--                       written Friday and logged Monday must reconcile to
--                       Friday's bank statement, not Monday's.
--
-- Additive, idempotent, nullable, no default → no table rewrite, safe on the
-- live sub_submitted_invoices table. Existing paid rows stay valid and simply
-- read as "unreconciled" until the GC fills the detail in.
alter table public.sub_submitted_invoices add column if not exists payment_method text;
alter table public.sub_submitted_invoices add column if not exists payment_reference text;
alter table public.sub_submitted_invoices add column if not exists paid_on date;

-- Constrain the method vocabulary so the client and any future 1099 export
-- agree on spelling. NOT VALID so the check applies to new/updated rows without
-- scanning (and failing on) any legacy value already in the table.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'sub_submitted_invoices_payment_method_check'
  ) then
    alter table public.sub_submitted_invoices
      add constraint sub_submitted_invoices_payment_method_check
      check (payment_method is null or payment_method in ('check','ach','card','cash','other'))
      not valid;
  end if;
end $$;

-- "Which payments landed in this bank period?" — the reconciliation query.
-- Partial: only paid, reconciled rows carry a date.
create index if not exists sub_submitted_invoices_paid_on_idx
  on public.sub_submitted_invoices (paid_on)
  where paid_on is not null;
