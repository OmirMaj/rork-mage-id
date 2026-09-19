-- 20260919180000_gc_labor_rates_and_project_crew.sql  (wave 3, lane labor-cost)
--
-- Two fixes, both additive. Idempotent: every statement can run twice.
--
-- ── 1. #61: the GC's labor rates live on his ACCOUNT ──────────────────────
-- Rates lived only in AsyncStorage on the device where he typed them, and the
-- tenant sweep erases every `mageid_` key on sign-in and sign-out. On the web
-- app, or after any sign-out, every clocked hour priced at $0 on Job Costing,
-- the Living Estimate, Margin Alerts and the cost book.
--
-- NOT the shared `labor_rates` table: that is the BLS market reference
-- (trade/region/median), readable by everyone, with no owner column. These
-- are one GC's own payroll numbers, so they get their own per-user tables:
--
--   gc_labor_rates     one row per (user, trade). id = '<user>:<trade>' so the
--                      client's offline queue serializes two edits to one trade
--                      (it groups queued writes by `id`); a CHECK pins the id
--                      to the row's own user and trade, so no one can occupy
--                      another user's id. rate NULL = "cleared" — a clear is a
--                      dated edit like any other, never a delete.
--   gc_labor_settings  one row per user: the overtime multiplier (#153) and
--                      the overtime rule (#65: weekly threshold, optional daily
--                      threshold, payroll-week start).
--
-- NEWEST EDIT WINS, on the server too. The client dates every edit and may
-- replay an old one late from its offline queue. A BEFORE UPDATE trigger keeps
-- the stored row when the incoming updated_at is OLDER, so a queued edit from
-- a phone that was offline all day cannot roll back the rate he set on the
-- web an hour ago. (Returning NULL skips the row: PostgREST reports success,
-- which is right — the newer value is already there.)
--
-- RLS: user_id = auth.uid() for every command, authenticated role only.
--
-- ── 2. #62: a field / editor seat can clock the GC's crew in ──────────────
-- A foreman on a field seat opened Time Tracking and (with the client gate
-- fixed) still saw "No crew added yet": crew_members is readable only by its
-- owner or the worker who claimed it, and certifications only by their owner,
-- so the GC's roster and his lapsed-card warnings never reached the foreman.
--
-- NOT a SELECT policy on crew_members. A policy grants whole rows, and a crew
-- row carries claim_token (the single-use token that claims the worker's
-- profile), phone, email, the ID scan path and masked ID digits — none of
-- which a foreman needs to clock someone in, and the claim token must never
-- leave the GC. So two SECURITY DEFINER functions return ONLY what the clock-in
-- sheet reads, for ONE project, and only to a caller who can_access_project(
-- project, 'field') — owner, editor or field; a viewer gets nothing:
--
--   project_crew_roster(p_project_id text)      id, full_name, trades, status
--     — crew rows OWNED BY THE PROJECT OWNER whose project_ids list the job.
--     A row someone else owns that happens to list this project id is not
--     the GC's crew and is never returned.
--   project_crew_cert_flags(p_project_id text)  id, worker_id, type, expires_date
--     — the GC's certifications for exactly those workers; the four fields
--     utils/safety/crewCerts.certFlagsForWorker reads, nothing else
--     (no document_url, no holder PII beyond the id join).
--
-- crew_members.project_ids is jsonb (an array of project id strings); projects
-- .id is uuid, so the join compares p.id::text. Existing crew / certification
-- policies are untouched: writes stay owner-only (claimed-worker update stays).

-- ── 1. per-user labor rates + overtime settings ─────────────────────────────
create table if not exists public.gc_labor_rates (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  trade_key text not null,
  rate numeric(10,2),
  updated_at timestamptz not null default now(),
  constraint gc_labor_rates_id_is_user_trade check (id = user_id::text || ':' || trade_key),
  constraint gc_labor_rates_trade_key_nonempty check (length(trade_key) between 1 and 120),
  constraint gc_labor_rates_rate_positive check (rate is null or (rate > 0 and rate < 100000))
);
create unique index if not exists gc_labor_rates_user_trade_uidx on public.gc_labor_rates (user_id, trade_key);

create table if not exists public.gc_labor_settings (
  id uuid primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  overtime_multiplier numeric(4,2) not null default 1.5,
  ot_weekly_threshold numeric(5,2) default 40,
  ot_daily_threshold numeric(5,2),
  week_starts_on smallint not null default 1,
  updated_at timestamptz not null default now(),
  constraint gc_labor_settings_id_is_user check (id = user_id),
  constraint gc_labor_settings_multiplier_range check (overtime_multiplier between 1 and 3),
  constraint gc_labor_settings_weekly_range check (ot_weekly_threshold is null or (ot_weekly_threshold > 0 and ot_weekly_threshold <= 168)),
  constraint gc_labor_settings_daily_range check (ot_daily_threshold is null or (ot_daily_threshold > 0 and ot_daily_threshold <= 24)),
  constraint gc_labor_settings_week_start_range check (week_starts_on between 0 and 6)
);

alter table public.gc_labor_rates enable row level security;
alter table public.gc_labor_settings enable row level security;

drop policy if exists gc_labor_rates_own on public.gc_labor_rates;
create policy gc_labor_rates_own on public.gc_labor_rates
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists gc_labor_settings_own on public.gc_labor_settings;
create policy gc_labor_settings_own on public.gc_labor_settings
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

revoke all on public.gc_labor_rates, public.gc_labor_settings from anon;
grant select, insert, update, delete on public.gc_labor_rates, public.gc_labor_settings to authenticated;

-- Newest edit wins: an older replayed write leaves the stored row alone.
create or replace function public.gc_labor_keep_newest()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.updated_at < old.updated_at then
    return null;
  end if;
  -- The row's owner and key never move (the CHECKs pin id to them too).
  new.user_id := old.user_id;
  return new;
end;
$$;

drop trigger if exists gc_labor_rates_keep_newest on public.gc_labor_rates;
create trigger gc_labor_rates_keep_newest
  before update on public.gc_labor_rates
  for each row execute function public.gc_labor_keep_newest();

drop trigger if exists gc_labor_settings_keep_newest on public.gc_labor_settings;
create trigger gc_labor_settings_keep_newest
  before update on public.gc_labor_settings
  for each row execute function public.gc_labor_keep_newest();

-- ── 2. the GC's crew roster + cert flags for a field / editor seat ─────────
create or replace function public.project_crew_roster(p_project_id text)
returns table (id uuid, full_name text, trades jsonb, status text)
language sql
stable
security definer
set search_path = public
as $$
  select cm.id, cm.full_name, coalesce(cm.trades, '[]'::jsonb), coalesce(cm.status, 'active')
  from public.projects p
  join public.crew_members cm on cm.user_id = p.user_id
  where p.id::text = p_project_id
    and public.can_access_project(p.id, 'field')
    and jsonb_typeof(cm.project_ids) = 'array'
    and cm.project_ids ? p_project_id
  order by cm.full_name;
$$;

create or replace function public.project_crew_cert_flags(p_project_id text)
returns table (id text, worker_id text, type text, expires_date text)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.worker_id, c.type, c.expires_date
  from public.projects p
  join public.crew_members cm on cm.user_id = p.user_id
  join public.certifications c on c.user_id = p.user_id and c.worker_id = cm.id::text
  where p.id::text = p_project_id
    and public.can_access_project(p.id, 'field')
    and jsonb_typeof(cm.project_ids) = 'array'
    and cm.project_ids ? p_project_id;
$$;

revoke all on function public.project_crew_roster(text) from public, anon;
revoke all on function public.project_crew_cert_flags(text) from public, anon;
grant execute on function public.project_crew_roster(text) to authenticated;
grant execute on function public.project_crew_cert_flags(text) to authenticated;
