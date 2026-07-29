-- Client/RFP one-off payment: server-authoritative post credits.
--
-- The property-owner "$25 to post an RFP" fee. Until now the credit lived in
-- AsyncStorage (utils/clientPricing.ts) — it charged nothing, was trivially
-- bypassable, and wiped on logout. This makes it real:
--   create-rfp-checkout (Stripe Checkout) → stripe-webhook grants one credit
--   here → the post-rfp flow spends one atomically via consume_rfp_post_credit.
--
-- Reversible: drop the two functions + table.

create table if not exists public.rfp_post_credits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  credits integer not null default 0 check (credits >= 0),
  lifetime_purchased integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.rfp_post_credits enable row level security;

-- Owner may READ their own balance. There is NO client write policy: grants
-- come from the webhook (service role), spend from the SECURITY DEFINER RPC
-- below. So a client can never mint itself credits.
drop policy if exists rfp_credits_select_own on public.rfp_post_credits;
create policy rfp_credits_select_own on public.rfp_post_credits
  for select using (auth.uid() = user_id);

-- Atomic spend: decrement one credit for the CALLER iff they have one.
-- Returns true when a credit was spent, false otherwise. SECURITY DEFINER so
-- it writes past RLS, but hard-scoped to auth.uid() + credits > 0, so a caller
-- can only ever spend their OWN credits and can never drive the balance below 0.
create or replace function public.consume_rfp_post_credit()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  spent boolean;
begin
  update public.rfp_post_credits
     set credits = credits - 1, updated_at = now()
   where user_id = auth.uid() and credits > 0
  returning true into spent;
  return coalesce(spent, false);
end;
$$;

revoke all on function public.consume_rfp_post_credit() from public;
grant execute on function public.consume_rfp_post_credit() to authenticated;

-- Grant helper used by the webhook (service role) after a paid checkout.
-- Upserts +p_n credits atomically. Not callable by clients.
create or replace function public.grant_rfp_post_credit(p_user uuid, p_n integer default 1)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.rfp_post_credits (user_id, credits, lifetime_purchased, updated_at)
  values (p_user, p_n, p_n, now())
  on conflict (user_id) do update
    set credits = public.rfp_post_credits.credits + excluded.credits,
        lifetime_purchased = public.rfp_post_credits.lifetime_purchased + excluded.credits,
        updated_at = now();
end;
$$;

revoke all on function public.grant_rfp_post_credit(uuid, integer) from public;
grant execute on function public.grant_rfp_post_credit(uuid, integer) to service_role;
