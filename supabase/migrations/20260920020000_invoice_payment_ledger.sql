-- 20260920020000_invoice_payment_ledger.sql
--
-- Audit wave 4, #80 (= #35, BLOCKER) and #83 (= #135).
--
-- #80. A payment was recorded by writing the device's WHOLE ledger:
-- updateInvoice sent {amount_paid, payments, status} as a plain UPDATE, and the
-- offline queue replayed that UPDATE verbatim on reconnect. A phone that had
-- been offline since before the client paid $20,000 through the Pay link
-- recorded a $300 check and, when signal came back, overwrote the server's
-- ledger with [check] — the Stripe entry, its PaymentIntent id and the $20,000
-- were gone, dunning chased money already paid, and a later refund could not
-- find the invoice. The webhook's own read-then-write had the mirror race.
--
-- So a payment is now an APPEND, done on the server under a row lock:
--
--   public.invoice_append_payment(p_invoice_id uuid, p_entry jsonb) -> jsonb
--     {ok, already, amount_paid, status, balance}
--     errors: invoice_not_found (P0002), not_invoice_owner (42501),
--             bad_payment_entry (22023)
--
-- keyed by the entry id (a queue replay or a Stripe retry is a no-op), with
-- amount_paid recomputed as the cent-rounded LEDGER SUM and status by the same
-- retention-NET settled rule stripe-webhook uses (_shared/paymentMath.ts
-- settlementStatus / netPayable, 1-cent tolerance). The app queues it as an
-- 'rpc' op; stripe-webhook's credit path calls the same function.
--
-- Belt to that: public.invoices_ledger_guard, a BEFORE UPDATE trigger acting on
-- CLIENT roles only (current_user in authenticated/anon — the RPC runs as its
-- owner and the webhook as service_role, both pass). Writes queued by the app
-- BEFORE this ships still carry the whole array and will flush after the OTA;
-- the guard makes them harmless: the ledger only ever GROWS by entry id
-- (entries the server holds are kept, new ones are added), amount_paid is the
-- ledger sum, and a paid / partially_paid / sent status follows the money.
-- It gives up one thing: an app write can no longer delete or edit a payment.
-- Nothing in the app does (a delete/void is refused with its reason), and a
-- correction is a Stripe refund or a support edit as service_role.
--
-- #83. A Checkout Session paid by bank debit (ACH) completes UNPAID and settles
-- 3-5 business days later. The link is single-use, so Stripe had already killed
-- it, yet pay_link_url stayed on the row: the portal kept a dead Pay button and
-- dunning mailed "Pay $X now" to a client who had just paid. The webhook now
-- stamps a pending marker on the unpaid completion (and nulls the dead link),
-- clears it on async_payment_succeeded (after crediting) and on
-- async_payment_failed; invoice-dunning skips a fresh marker ('payment_pending').
--
-- Idempotent: IF NOT EXISTS / CREATE OR REPLACE / DROP TRIGGER IF EXISTS.

-- ── #83: the pending bank-payment marker (CONTRACT 3) ──────────────────────
alter table public.invoices     add column if not exists pay_pending_at      timestamptz;
alter table public.invoices     add column if not exists pay_pending_amount  numeric(12,2);
alter table public.invoices     add column if not exists pay_pending_session text;
alter table public.aia_pay_apps add column if not exists pay_pending_at      timestamptz;
alter table public.aia_pay_apps add column if not exists pay_pending_amount  numeric(12,2);
alter table public.aia_pay_apps add column if not exists pay_pending_session text;

comment on column public.invoices.pay_pending_at is
  'Set by stripe-webhook when a MAGE Checkout Session completes UNPAID (bank debit in flight); cleared on async_payment_succeeded / _failed. invoice-dunning skips while < 10 days old. Never written by the app.';

-- ── Pure money rules, the SQL twin of _shared/paymentMath.ts ───────────────

-- One ledger entry's amount, the way paymentMath's num() reads it: a JSON
-- number, or a numeric string; anything else counts 0. Never raises.
create or replace function public.invoice_ledger_amount(p_entry jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(p_entry -> 'amount') = 'number' then (p_entry ->> 'amount')::numeric
    when jsonb_typeof(p_entry -> 'amount') = 'string'
         and btrim(p_entry ->> 'amount') ~ '^-?[0-9]+(\.[0-9]+)?$' then btrim(p_entry ->> 'amount')::numeric
    else 0::numeric
  end
$$;

-- ledgerSum(ledgerFrom(raw)): entries that are objects with a string id,
-- summed and rounded to the cent.
create or replace function public.invoice_ledger_sum(p_ledger jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select round(coalesce(sum(public.invoice_ledger_amount(e)), 0), 2)
    from jsonb_array_elements(case when jsonb_typeof(p_ledger) = 'array' then p_ledger else '[]'::jsonb end) e
   where jsonb_typeof(e) = 'object' and jsonb_typeof(e -> 'id') = 'string'
$$;

-- netPayable(): total_due less the retention still held. effectiveRetention is
-- retention_percent of the WORK VALUE (subtotal) when both are present and the
-- percent is > 0 (clamped at 100), else the stored retention_amount.
create or replace function public.invoice_net_payable(
  p_total_due numeric, p_subtotal numeric, p_retention_percent numeric,
  p_retention_amount numeric, p_retention_released numeric
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  with eff as (
    select case
      when p_retention_percent is not null and p_subtotal is not null and p_retention_percent > 0
        then round(greatest(0, p_subtotal) * (least(100, p_retention_percent) / 100), 2)
      else round(greatest(0, coalesce(p_retention_amount, 0)), 2)
    end as held
  )
  select greatest(0, coalesce(p_total_due, 0)
           - round(greatest(0, eff.held - greatest(0, coalesce(p_retention_released, 0))), 2))
    from eff
$$;

-- settlementStatus(): 'paid' when amount_paid covers the NET balance within a
-- cent; with nothing paid a paid / partially_paid invoice falls back to 'sent';
-- any other prior status is kept.
create or replace function public.invoice_settlement_status(
  p_prev text, p_amount_paid numeric, p_net_payable numeric
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(p_amount_paid, 0) > 0.005 then
      case when p_amount_paid >= coalesce(p_net_payable, 0) - 0.01 then 'paid' else 'partially_paid' end
    when p_prev in ('paid', 'partially_paid') then 'sent'
    else coalesce(nullif(p_prev, ''), 'sent')
  end
$$;

revoke all on function public.invoice_ledger_amount(jsonb) from public, anon;
revoke all on function public.invoice_ledger_sum(jsonb) from public, anon;
revoke all on function public.invoice_net_payable(numeric, numeric, numeric, numeric, numeric) from public, anon;
revoke all on function public.invoice_settlement_status(text, numeric, numeric) from public, anon;
-- authenticated needs them: the ledger guard below runs as the writing role.
grant execute on function public.invoice_ledger_amount(jsonb) to authenticated, service_role;
grant execute on function public.invoice_ledger_sum(jsonb) to authenticated, service_role;
grant execute on function public.invoice_net_payable(numeric, numeric, numeric, numeric, numeric) to authenticated, service_role;
grant execute on function public.invoice_settlement_status(text, numeric, numeric) to authenticated, service_role;

-- ── #80: the append (CONTRACT 2) ────────────────────────────────────────────
create or replace function public.invoice_append_payment(p_invoice_id uuid, p_entry jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_service boolean := coalesce(auth.role(), '') = 'service_role';
  v_inv public.invoices%rowtype;
  v_ledger jsonb;
  v_id text;
  v_amount numeric;
  v_paid numeric;
  v_net numeric;
  v_status text;
begin
  if not v_service and auth.uid() is null then
    raise exception 'not_invoice_owner' using errcode = '42501';
  end if;

  -- A well-formed entry: an object with a non-empty string id and a numeric
  -- amount. The app may only add a positive payment of its own; refunds,
  -- disputes and the stripe-* ids are the webhook's (a device that could write
  -- 'stripe-cs_…' first would make the real credit look like a duplicate).
  -- IS DISTINCT FROM, not <>: jsonb_typeof of a missing key is NULL, and a
  -- NULL in an OR chain would let an id-less entry through.
  if jsonb_typeof(p_entry) is distinct from 'object'
     or jsonb_typeof(p_entry -> 'id') is distinct from 'string'
     or length(btrim(p_entry ->> 'id')) = 0
     or length(p_entry ->> 'id') > 200
     or jsonb_typeof(p_entry -> 'amount') is distinct from 'number' then
    raise exception 'bad_payment_entry' using errcode = '22023';
  end if;
  v_id := p_entry ->> 'id';
  v_amount := (p_entry ->> 'amount')::numeric;
  if not v_service and (
       v_amount <= 0
       or v_id like 'stripe-%'
       or coalesce(p_entry ->> 'kind', 'payment') <> 'payment'
     ) then
    raise exception 'bad_payment_entry' using errcode = '22023';
  end if;

  -- Row lock: this append, a concurrent webhook credit and a replayed queue
  -- entry serialize, so none of them reads a ledger the other is replacing.
  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'invoice_not_found' using errcode = 'P0002';
  end if;
  -- Same predicate as the invoices UPDATE policy (auth.uid() = user_id).
  if not v_service and v_inv.user_id is distinct from auth.uid() then
    raise exception 'not_invoice_owner' using errcode = '42501';
  end if;

  v_ledger := case when jsonb_typeof(v_inv.payments) = 'array' then v_inv.payments else '[]'::jsonb end;
  v_net := public.invoice_net_payable(v_inv.total_due, v_inv.subtotal, v_inv.retention_percent,
                                      v_inv.retention_amount, v_inv.retention_released);

  if exists (
    select 1 from jsonb_array_elements(v_ledger) e
     where jsonb_typeof(e) = 'object' and e ->> 'id' = v_id
  ) then
    v_paid := coalesce(v_inv.amount_paid, 0);
    return jsonb_build_object(
      'ok', true, 'already', true,
      'amount_paid', v_paid,
      'status', v_inv.status,
      'balance', round(greatest(0, v_net - v_paid), 2)
    );
  end if;

  v_ledger := v_ledger || jsonb_build_array(p_entry);
  v_paid := public.invoice_ledger_sum(v_ledger);
  if v_paid < 0 then v_paid := 0; end if;
  v_status := public.invoice_settlement_status(v_inv.status, v_paid, v_net);

  update public.invoices
     set payments = v_ledger,
         amount_paid = v_paid,
         status = v_status,
         -- QuickBooks only ever sees a sent invoice (invoiceWrites.ts).
         qbo_sync_status = case when v_status <> 'draft' then 'pending' else qbo_sync_status end,
         updated_at = now()
   where id = p_invoice_id;

  return jsonb_build_object(
    'ok', true, 'already', false,
    'amount_paid', v_paid,
    'status', v_status,
    'balance', round(greatest(0, v_net - v_paid), 2)
  );
end
$$;

revoke all on function public.invoice_append_payment(uuid, jsonb) from public, anon;
grant execute on function public.invoice_append_payment(uuid, jsonb) to authenticated, service_role;

-- ── #80 belt: no app write can shrink the ledger ───────────────────────────
create or replace function public.invoices_ledger_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_merged jsonb;
  v_ids text[];
  v_el jsonb;
  v_paid numeric;
  v_net numeric;
begin
  -- Client roles only. The RPC above runs as its owner and the webhook as
  -- service_role; both have already computed the ledger themselves.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  -- The pending bank-payment marker is the webhook's alone.
  new.pay_pending_at := old.pay_pending_at;
  new.pay_pending_amount := old.pay_pending_amount;
  new.pay_pending_session := old.pay_pending_session;

  if new.payments is distinct from old.payments or new.amount_paid is distinct from old.amount_paid then
    v_old := case when jsonb_typeof(old.payments) = 'array' then old.payments else '[]'::jsonb end;
    v_new := case when jsonb_typeof(new.payments) = 'array' then new.payments else '[]'::jsonb end;
    -- Union by id: every entry the server holds stays exactly as it is; an
    -- entry only the device has (a check recorded offline) is added.
    v_merged := v_old;
    select coalesce(array_agg(e ->> 'id'), '{}') into v_ids
      from jsonb_array_elements(v_old) e
     where jsonb_typeof(e) = 'object' and jsonb_typeof(e -> 'id') = 'string';
    for v_el in select value from jsonb_array_elements(v_new) loop
      if jsonb_typeof(v_el) = 'object' and jsonb_typeof(v_el -> 'id') = 'string'
         and length(btrim(v_el ->> 'id')) > 0
         and not ((v_el ->> 'id') = any (v_ids)) then
        v_merged := v_merged || jsonb_build_array(v_el);
        v_ids := v_ids || (v_el ->> 'id');
      end if;
    end loop;
    new.payments := v_merged;
    v_paid := greatest(0, public.invoice_ledger_sum(v_merged));
    new.amount_paid := v_paid;
    v_net := public.invoice_net_payable(new.total_due, new.subtotal, new.retention_percent,
                                        new.retention_amount, new.retention_released);
    -- The device's status was computed from its stale balance; the money decides.
    new.status := public.invoice_settlement_status(old.status, v_paid, v_net);
  elsif new.status is distinct from old.status and new.status in ('sent', 'partially_paid', 'paid') then
    -- A status-only write (a retention release re-opening the invoice, Mark
    -- sent) is judged against the SERVER's ledger, not the device's copy.
    v_net := public.invoice_net_payable(new.total_due, new.subtotal, new.retention_percent,
                                        new.retention_amount, new.retention_released);
    new.status := public.invoice_settlement_status(new.status, coalesce(new.amount_paid, 0), v_net);
  end if;
  return new;
end
$$;

drop trigger if exists invoices_ledger_guard on public.invoices;
create trigger invoices_ledger_guard
  before update on public.invoices
  for each row execute function public.invoices_ledger_guard();

-- The AIA pay app's marker is the webhook's alone too. The certified-row
-- freeze trigger (freeze_certified_aia_pay_app) lists its columns explicitly,
-- so these three were never frozen and need no change there.
create or replace function public.aia_pay_apps_pending_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.pay_pending_at := old.pay_pending_at;
    new.pay_pending_amount := old.pay_pending_amount;
    new.pay_pending_session := old.pay_pending_session;
  end if;
  return new;
end
$$;

drop trigger if exists aia_pay_apps_pending_guard on public.aia_pay_apps;
create trigger aia_pay_apps_pending_guard
  before update on public.aia_pay_apps
  for each row execute function public.aia_pay_apps_pending_guard();
