-- RFP post credits: idempotency + payment ledger.
--
-- Stripe can deliver checkout.session.completed more than once, and the credit
-- grant is additive — so key the grant by the Stripe session id and grant at
-- most once per session. Also gives the owner a receipt trail.

create table if not exists public.rfp_post_payments (
  session_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount_cents integer,
  created_at timestamptz not null default now()
);

alter table public.rfp_post_payments enable row level security;

drop policy if exists rfp_payments_select_own on public.rfp_post_payments;
create policy rfp_payments_select_own on public.rfp_post_payments
  for select using (auth.uid() = user_id);

-- Replace the 2-arg grant with an idempotent, session-keyed version:
-- returns true when it actually granted, false on a duplicate delivery.
drop function if exists public.grant_rfp_post_credit(uuid, integer);

create or replace function public.grant_rfp_post_credit(p_user uuid, p_session text, p_n integer default 1)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.rfp_post_payments (session_id, user_id)
  values (p_session, p_user)
  on conflict (session_id) do nothing;
  if not found then
    return false;  -- duplicate webhook delivery for this session — no double-grant
  end if;
  insert into public.rfp_post_credits (user_id, credits, lifetime_purchased, updated_at)
  values (p_user, p_n, p_n, now())
  on conflict (user_id) do update
    set credits = public.rfp_post_credits.credits + excluded.credits,
        lifetime_purchased = public.rfp_post_credits.lifetime_purchased + excluded.credits,
        updated_at = now();
  return true;
end;
$$;

revoke all on function public.grant_rfp_post_credit(uuid, text, integer) from public;
grant execute on function public.grant_rfp_post_credit(uuid, text, integer) to service_role;
