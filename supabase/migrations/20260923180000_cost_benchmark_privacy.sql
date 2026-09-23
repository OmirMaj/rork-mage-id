-- 20260923180000_cost_benchmark_privacy.sql — wave 5, lane benchmark-financing
--
-- Two findings on one table, fixed together (#79 + #84):
--
-- #79  THE PUBLIC PRICE INDEX OPT-IN SILENTLY DID NOTHING.
--      The opt-in lived on each cost_benchmark_samples row. The switch ran
--      `update … set public_index_opt_in = X where user_id = me`, which matches
--      zero rows for a contractor who has contributed nothing yet (production:
--      0 samples) and reports no error; the switch read On, then Off on the
--      next open. Rows contributed AFTER opting in were inserted with the
--      column default (false) and never reached the index.
--      FIX: the choice is stored ONCE PER ACCOUNT (cost_benchmark_prefs), each
--      contribution copies it, and the switch is written and read through RPCs
--      that return the stored value — the client shows what the server kept,
--      not an optimistic flip. The index itself publishes nothing yet (#84,
--      READ SIDE below) and the app says so; the stored choice is what a
--      reopened index will read.
--
-- #84  THE COST TRUTH BENCHMARK COULD BE DE-ANONYMISED AND POISONED.
--      cbs_own was FOR ALL, so any account wrote any row with any `region`
--      (the primary key includes it) and any price. cost_benchmark_stats pooled
--      every region for 'US' and gated on count(*) — ROWS, not contractors.
--      Four junk-region rows from one free account plus one real contractor
--      passed k = 5, and the median it returned was that contractor's price.
--      Fifty junk rows moved the "market" every GC is shown.
--      FIX, WRITE SIDE:
--        • clients can no longer write the table at all: INSERT / UPDATE /
--          DELETE revoked from anon + authenticated, cbs_own becomes SELECT of
--          your own rows only (construction-answer reads your own rates with
--          your JWT, so SELECT-own stays);
--        • contributions go through contribute_benchmark_rate(), SECURITY
--          DEFINER: user_id is always auth.uid(), region is always 'US'
--          (plus CHECK region = 'US'), category / unit are lower-cased and
--          trimmed, a price outside 0 < p <= 1,000,000 is refused, and one
--          account may hold at most 200 trade/unit keys.
--      FIX, READ SIDE — NOTHING IS PUBLISHED. cost_benchmark_stats and
--      public_cost_index keep their signatures and grants and return ZERO
--      ROWS for every input.
--        Why, after two failed review rounds: every figure computed from
--        rates a contractor POSTS can be probed by the poster. Round 0's
--        distinct-contractor k fell to one extra account. Round 1's 5% price
--        grid fell to a threshold search: the attacker moves his own rate
--        (binary search) until a published quartile flips to the next grid
--        point; at the flip the quartile equals a grid boundary he can
--        compute, and the interpolation then gives a neighbour's price to the
--        cent (review probe, PGlite: three competitors' exact prices in 141
--        RPC calls from one opted-in account). Any deterministic figure over
--        a pool the attacker can re-query after changing his own input leaks
--        the same way; rate limits, coarser rounding or noise make that
--        slower, not impossible, while signup is open. The rule that can be
--        PROVEN is: no aggregate of posted rates leaves the server.
--        WHAT IT GIVES UP: the in-app "vs the market" Cost Truth chip and the
--        public Price Index at mageid.app/costs stay empty. Production has 0
--        samples (2026-09-23), so no figure anyone has seen disappears. They
--        come back only when a later wave derives each contractor's rate ON
--        THE SERVER from recorded job-cost actuals rather than a posted
--        number — and that wave replays the threshold search (PGlite) before
--        anything is published.
--        Zero rows, not a row of NULLs: a pre-wave-5 build maps a NULL row
--        to "building · 0 of 5" (a count nobody measured); with no row it
--        shows no chip at all.
--      Kept, so that later wave starts from a clean table: the per-account
--      opt-in (#79), server-only writes, region 'US', the band, the key cap.
--
-- Also: public_cost_index's return type gains updated_at (the day of the
-- freshest contribution) so public-cost-index sends the DATA's freshness as
-- `updated` instead of stamping the request time (#174). With no row
-- published there is none, and the page prints no "Updated" line.
--
-- OLD BUILDS. A device on the pre-wave-5 build upserts the table directly;
-- after this migration that write is refused (permission denied). The old
-- client fires it and forgets it, so nothing breaks — the contribution is
-- simply best-effort until the OTA lands. Its opt-in switch reverts on the
-- refused UPDATE, which is honest.
--
-- Production 2026-09-23 (read-only): cost_benchmark_samples has 0 rows, no
-- trigger, cbs_own FOR ALL TO public, and anon/authenticated hold every table
-- privilege. cost_benchmark_stats: SECURITY DEFINER, search_path=public,
-- EXECUTE authenticated + service_role. public_cost_index: SECURITY DEFINER,
-- search_path=public, EXECUTE anon + authenticated + service_role. Both kept.
--
-- Apply BEFORE the OTA. Idempotent (tested twice in a row in PGlite:
-- scratchpad w5bf_pg/w5_benchmark.mjs).


-- ════════════════════════════════════════════════════════════════════════════
-- (1) #79 · the account-level opt-in
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.cost_benchmark_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  public_index_opt_in boolean not null default false,
  updated_at timestamptz not null default now()
);

comment on table public.cost_benchmark_prefs is
  'Per-account Public Price Index opt-in (20260923180000, #79). Written only by set_benchmark_public_opt_in (SECURITY DEFINER). The index publishes nothing yet (#84); a reopened public_cost_index reads this flag, never the per-row mirror.';

alter table public.cost_benchmark_prefs enable row level security;
revoke all on public.cost_benchmark_prefs from public, anon, authenticated;
grant select on public.cost_benchmark_prefs to authenticated;
grant all on public.cost_benchmark_prefs to service_role;

drop policy if exists cbp_own_select on public.cost_benchmark_prefs;
create policy cbp_own_select on public.cost_benchmark_prefs
  for select to authenticated
  using (auth.uid() = user_id);

-- Carry any per-row opt-in that did land (production: 0) up to the account.
insert into public.cost_benchmark_prefs (user_id, public_index_opt_in)
select distinct s.user_id, true
  from public.cost_benchmark_samples s
 where s.public_index_opt_in
on conflict (user_id) do update set public_index_opt_in = true;


-- ════════════════════════════════════════════════════════════════════════════
-- (2) #84 · the samples table: server-written only, one region, a sane band
-- ════════════════════════════════════════════════════════════════════════════
-- The CHECKs are added NOT VALID and validated only when every existing row
-- already passes (production: 0 rows) — never by deleting data. NOT VALID
-- still enforces them on every new write.
do $mig$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.cost_benchmark_samples'::regclass
                    and conname = 'cbs_region_us') then
    alter table public.cost_benchmark_samples
      add constraint cbs_region_us check (region = 'US') not valid;
  end if;
  if not exists (select 1 from public.cost_benchmark_samples where region is distinct from 'US') then
    alter table public.cost_benchmark_samples validate constraint cbs_region_us;
  else
    raise notice '[180000] cbs_region_us left NOT VALID: legacy non-US rows exist (the aggregates pool one value per contractor, so they cannot stack)';
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.cost_benchmark_samples'::regclass
                    and conname = 'cbs_unit_price_band') then
    alter table public.cost_benchmark_samples
      add constraint cbs_unit_price_band check (unit_price > 0 and unit_price <= 1000000) not valid;
  end if;
  if not exists (select 1 from public.cost_benchmark_samples
                  where not (unit_price > 0 and unit_price <= 1000000)) then
    alter table public.cost_benchmark_samples validate constraint cbs_unit_price_band;
  else
    raise notice '[180000] cbs_unit_price_band left NOT VALID: legacy out-of-band rows exist (each contractor still counts once)';
  end if;
end
$mig$;

-- No client writes. SELECT of your own rows only.
revoke insert, update, delete, truncate, references, trigger
  on public.cost_benchmark_samples from public, anon, authenticated;
revoke select on public.cost_benchmark_samples from public, anon;
grant select on public.cost_benchmark_samples to authenticated;
grant all on public.cost_benchmark_samples to service_role;

drop policy if exists cbs_own on public.cost_benchmark_samples;
drop policy if exists cbs_own_select on public.cost_benchmark_samples;
create policy cbs_own_select on public.cost_benchmark_samples
  for select to authenticated
  using (auth.uid() = user_id);

comment on column public.cost_benchmark_samples.public_index_opt_in is
  'MIRROR of cost_benchmark_prefs.public_index_opt_in, kept so a pre-wave-5 build''s read of it shows the account''s real choice. Nothing may publish off this column; the account flag is the source (20260923180000).';


-- ════════════════════════════════════════════════════════════════════════════
-- (3) the write RPCs
-- ════════════════════════════════════════════════════════════════════════════
-- One measured rate. The client decides WHICH rates are measured
-- (hooks/useCostBenchmark isPublishableRate); the server decides everything
-- that makes a row safe to pool: whose it is, its region, its shape, its band.
create or replace function public.contribute_benchmark_rate(
  p_category text,
  p_unit text,
  p_unit_price numeric
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $function$
declare
  v_uid  uuid := auth.uid();
  v_cat  text := lower(btrim(coalesce(p_category, '')));
  v_unit text := lower(btrim(coalesce(p_unit, '')));
  v_opt  boolean;
begin
  if v_uid is null then
    raise exception 'benchmark_sign_in_required' using errcode = '42501';
  end if;
  if v_cat = '' or length(v_cat) > 80 or v_unit = '' or length(v_unit) > 24 then
    raise exception 'benchmark_bad_key' using errcode = '22023';
  end if;
  -- numeric NaN sorts above every number, so the upper bound refuses it too;
  -- it is named anyway so nobody "simplifies" the band into a gap.
  if p_unit_price is null or p_unit_price = 'NaN'::numeric
     or p_unit_price <= 0 or p_unit_price > 1000000 then
    raise exception 'benchmark_price_out_of_band' using errcode = '22023';
  end if;
  -- Flood guard: an account holds at most 200 trade/unit keys. The app sends
  -- at most 40 (MAX_KEYS); only a script reaches this.
  if not exists (select 1 from public.cost_benchmark_samples
                  where user_id = v_uid and category = v_cat and unit = v_unit and region = 'US')
     and (select count(*) from public.cost_benchmark_samples where user_id = v_uid) >= 200 then
    raise exception 'benchmark_key_limit' using errcode = '54000';
  end if;

  select p.public_index_opt_in into v_opt
    from public.cost_benchmark_prefs p where p.user_id = v_uid;

  insert into public.cost_benchmark_samples
    (user_id, category, unit, region, unit_price, updated_at, public_index_opt_in)
  values
    (v_uid, v_cat, v_unit, 'US', p_unit_price, now(), coalesce(v_opt, false))
  on conflict (user_id, category, unit, region) do update
    set unit_price = excluded.unit_price,
        updated_at = excluded.updated_at,
        public_index_opt_in = excluded.public_index_opt_in;
  return true;
end
$function$;

-- The switch. Returns what is now STORED, so the screen shows the server's
-- answer, plus how many measured rates the account has on file (0 = "On —
-- nothing to publish yet").
create or replace function public.set_benchmark_public_opt_in(p_on boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $function$
declare
  v_uid uuid := auth.uid();
  v_on  boolean;
  v_n   integer;
begin
  if v_uid is null then
    raise exception 'benchmark_sign_in_required' using errcode = '42501';
  end if;
  if p_on is null then
    raise exception 'benchmark_opt_in_null' using errcode = '22023';
  end if;
  insert into public.cost_benchmark_prefs (user_id, public_index_opt_in, updated_at)
  values (v_uid, p_on, now())
  on conflict (user_id) do update
    set public_index_opt_in = excluded.public_index_opt_in,
        updated_at = excluded.updated_at
  returning public_index_opt_in into v_on;

  -- Keep the per-row mirror in step (old builds read it).
  update public.cost_benchmark_samples
     set public_index_opt_in = v_on
   where user_id = v_uid
     and public_index_opt_in is distinct from v_on;

  select count(*)::int into v_n from public.cost_benchmark_samples where user_id = v_uid;
  return jsonb_build_object('public_index_opt_in', v_on, 'rates_on_file', v_n);
end
$function$;

create or replace function public.get_benchmark_public_opt_in()
returns jsonb
language sql
stable
security definer
set search_path = public
as $function$
  select jsonb_build_object(
    'public_index_opt_in',
      coalesce((select p.public_index_opt_in from public.cost_benchmark_prefs p
                 where p.user_id = auth.uid()), false),
    'rates_on_file',
      (select count(*)::int from public.cost_benchmark_samples s where s.user_id = auth.uid())
  )
  where auth.uid() is not null;
$function$;

revoke all on function public.contribute_benchmark_rate(text, text, numeric) from public, anon;
grant execute on function public.contribute_benchmark_rate(text, text, numeric) to authenticated, service_role;
revoke all on function public.set_benchmark_public_opt_in(boolean) from public, anon;
grant execute on function public.set_benchmark_public_opt_in(boolean) to authenticated, service_role;
revoke all on function public.get_benchmark_public_opt_in() from public, anon;
grant execute on function public.get_benchmark_public_opt_in() to authenticated, service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- (4) #84 · the in-app benchmark: publishes nothing (header, READ SIDE)
-- ════════════════════════════════════════════════════════════════════════════
-- Signature, return type, SECURITY DEFINER, search_path and grants unchanged
-- (live pg_get_functiondef 2026-09-23), so an old build's call still succeeds
-- — it gets no row and shows no chip. The parameters are deliberately unread.
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
as $function$
  -- NOTHING IS PUBLISHED: zero rows for every input. Do not put an aggregate
  -- of cost_benchmark_samples back here — posted rates can be probed to the
  -- cent by their poster (20260923180000 header). Reopen only on rates the
  -- server derives from recorded actuals, with the threshold-search replay.
  select null::numeric, null::numeric, null::numeric, null::integer
   where false;
$function$;

revoke all on function public.cost_benchmark_stats(text, text, text) from public, anon;
grant execute on function public.cost_benchmark_stats(text, text, text) to authenticated, service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- (5) #79 + #84 + #174 · the public index: publishes nothing, return type
--     carries freshness for the day it reopens
-- ════════════════════════════════════════════════════════════════════════════
-- The return type gains updated_at, which CREATE OR REPLACE cannot do, so the
-- function is dropped and re-created with the live grants re-stated (anon +
-- authenticated + service_role). Its only caller is the public-cost-index edge
-- function, which reads columns by name (the pre-wave-5 deploy simply ignores
-- the new one) and treats rows: [] as "not published yet".
drop function if exists public.public_cost_index(text, text, text);

create function public.public_cost_index(
  p_category text default null,
  p_unit text default null,
  p_region text default 'US'
)
returns table(category text, unit text, region text, median numeric, p25 numeric, p75 numeric, n integer, updated_at timestamptz)
language sql
stable
security definer
set search_path = public
as $function$
  -- NOTHING IS PUBLISHED: zero rows for every input, anon or not. Same rule
  -- as cost_benchmark_stats. When it reopens (server-derived rates only), it
  -- reads the ACCOUNT opt-in (cost_benchmark_prefs), never the per-row mirror.
  select null::text, null::text, null::text,
         null::numeric, null::numeric, null::numeric,
         null::integer, null::timestamptz
   where false;
$function$;

revoke all on function public.public_cost_index(text, text, text) from public;
grant execute on function public.public_cost_index(text, text, text) to anon, authenticated, service_role;


-- ════════════════════════════════════════════════════════════════════════════
-- Post-conditions — fail loudly if the matrix did not land
-- ════════════════════════════════════════════════════════════════════════════
do $mig$
begin
  if has_table_privilege('authenticated', 'public.cost_benchmark_samples', 'INSERT')
     or has_table_privilege('authenticated', 'public.cost_benchmark_samples', 'UPDATE')
     or has_table_privilege('authenticated', 'public.cost_benchmark_samples', 'DELETE')
     or has_table_privilege('anon', 'public.cost_benchmark_samples', 'INSERT') then
    raise exception '[180000] a client role can still write cost_benchmark_samples';
  end if;
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'cost_benchmark_samples'
                and cmd <> 'SELECT') then
    raise exception '[180000] a non-SELECT policy survives on cost_benchmark_samples';
  end if;
  if has_function_privilege('anon', 'public.cost_benchmark_stats(text,text,text)', 'EXECUTE') then
    raise exception '[180000] anon can execute cost_benchmark_stats';
  end if;
  if not has_function_privilege('anon', 'public.public_cost_index(text,text,text)', 'EXECUTE') then
    raise exception '[180000] anon lost public_cost_index (the marketing page reads it anonymously)';
  end if;
  if has_function_privilege('anon', 'public.contribute_benchmark_rate(text,text,numeric)', 'EXECUTE') then
    raise exception '[180000] anon can execute contribute_benchmark_rate';
  end if;
  -- The read-side rule, checked on the live bodies: no aggregate of posted
  -- rates comes back, whatever the table holds.
  if exists (select 1 from public.cost_benchmark_stats('roofing', 'sq', 'US'))
     or exists (select 1 from public.public_cost_index(null, null, 'US')) then
    raise exception '[180000] an aggregate of posted benchmark rates is still published';
  end if;
end
$mig$;
