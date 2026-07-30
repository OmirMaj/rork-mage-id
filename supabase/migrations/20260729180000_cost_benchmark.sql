-- Cost Truth: the cross-contractor cost benchmark (the data-network flywheel).
--
-- Every contractor's price book already learns their REAL paid rate per trade
-- + unit (utils/costDatabase). This table collects those learned rates,
-- anonymized, so MAGE can show "your rate vs the regional median" — actual
-- paid prices, not stale catalog averages. The value compounds: every new
-- contractor sharpens everyone's benchmark.
--
-- PRIVACY: one row per contributor per (category, unit, region) — a rate, not a
-- job. Raw rows are NEVER readable cross-tenant (RLS = own rows only). The only
-- cross-contractor read is the aggregate RPC below, which returns median /
-- quartiles / count and ONLY when the pool has >= 5 contributors (k-anonymity).

create table if not exists public.cost_benchmark_samples (
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,   -- trade/category, lowercased
  unit text not null,       -- unit, lowercased
  region text not null default 'US',
  unit_price numeric not null check (unit_price >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, category, unit, region)
);

alter table public.cost_benchmark_samples enable row level security;

-- Contributor manages ONLY their own rows. No cross-tenant raw select at all —
-- the benchmark is reachable exclusively through the aggregate RPC.
drop policy if exists cbs_own on public.cost_benchmark_samples;
create policy cbs_own on public.cost_benchmark_samples
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Aggregate-only, k-anonymized benchmark. Returns median/p25/p75 ONLY when the
-- pool has >= 5 contributors; always returns the count n (a count leaks nothing)
-- so the UI can show "benchmark building — n of 5". Never returns raw prices.
create or replace function public.cost_benchmark_stats(
  p_category text,
  p_unit text,
  p_region text default 'US'
)
returns table(median numeric, p25 numeric, p75 numeric, n integer)
language sql
stable
security definer
set search_path = public
as $$
  with pool as (
    select unit_price
    from public.cost_benchmark_samples
    where category = lower(p_category)
      and unit = lower(p_unit)
      and (p_region = 'US' or region = p_region)
  ), agg as (
    select
      count(*)::int as n,
      percentile_cont(0.5)  within group (order by unit_price) as median,
      percentile_cont(0.25) within group (order by unit_price) as p25,
      percentile_cont(0.75) within group (order by unit_price) as p75
    from pool
  )
  select
    case when n >= 5 then median end,
    case when n >= 5 then p25 end,
    case when n >= 5 then p75 end,
    n
  from agg;
$$;

revoke all on function public.cost_benchmark_stats(text, text, text) from public;
grant execute on function public.cost_benchmark_stats(text, text, text) to authenticated;
