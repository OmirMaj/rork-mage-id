-- The Price Index: publish real paid prices as free public data.
--
-- RSMeans/Craftsman/PriceBook sell quarterly CITY AVERAGES that exclude
-- contractor margin for $2k–$25k/yr. MAGE has the thing nobody publishes:
-- actual paid rates by trade + unit + region. Publishing it free is the
-- acquisition engine for both sides of the marketplace.
--
-- PRIVACY — this is the important part. mageid.app promises: "Your numbers are
-- yours … it never hands your hard-won costs to the contractor down the
-- street." So publishing is STRICTLY OPT-IN:
--   * public_index_opt_in defaults FALSE — existing contributors are untouched
--     and nothing of theirs can ever appear publicly until they choose.
--   * The public aggregate counts ONLY opted-in rows.
--   * k-anonymity floor of 5 CONTRIBUTORS, and it returns median/quartiles
--     only — never a raw price, never a per-contractor value.
--   * The in-app benchmark (cost_benchmark_stats) is unchanged and still
--     covers everyone; opting in only affects the PUBLIC surface.

alter table public.cost_benchmark_samples
  add column if not exists public_index_opt_in boolean not null default false;

-- Fast lookup for the public aggregate (opted-in rows only).
create index if not exists cost_benchmark_public_idx
  on public.cost_benchmark_samples (category, unit, region)
  where public_index_opt_in;

-- PUBLIC aggregate. Anon-executable (the marketing site + AI crawlers read it
-- with no account), but it can only ever emit k-anonymized aggregates of
-- contributors who explicitly opted in.
create or replace function public.public_cost_index(
  p_category text default null,
  p_unit text default null,
  p_region text default 'US'
)
returns table(category text, unit text, region text, median numeric, p25 numeric, p75 numeric, n integer)
language sql
stable
security definer
set search_path = public
as $$
  with pool as (
    select s.category, s.unit, s.region, s.unit_price
    from public.cost_benchmark_samples s
    where s.public_index_opt_in
      and (p_category is null or s.category = lower(p_category))
      and (p_unit is null or s.unit = lower(p_unit))
      and (p_region = 'US' or s.region = p_region)
  ), agg as (
    select
      pool.category, pool.unit, pool.region,
      count(*)::int as n,
      percentile_cont(0.5)  within group (order by pool.unit_price) as median,
      percentile_cont(0.25) within group (order by pool.unit_price) as p25,
      percentile_cont(0.75) within group (order by pool.unit_price) as p75
    from pool
    group by pool.category, pool.unit, pool.region
  )
  -- Below the k-anonymity floor we emit NOTHING for that group (not even a
  -- suppressed row), so a thin pool can't be probed by differencing.
  select agg.category, agg.unit, agg.region, agg.median, agg.p25, agg.p75, agg.n
  from agg
  where agg.n >= 5
  order by agg.n desc, agg.category;
$$;

revoke all on function public.public_cost_index(text, text, text) from public;
grant execute on function public.public_cost_index(text, text, text) to anon, authenticated;
