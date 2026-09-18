-- 20260918120100_rfp_notify_reach.sql
--
-- Record how many contractors a homeowner RFP actually reached.
--
-- ── WHY (audit round 2, finding #8) ──────────────────────────────────────────
-- post-rfp told every homeowner "Contractors near Austin who match the
-- requirements will be notified" whatever happened next. The fan-out
-- (notify-nearby-contractors, fired by public_bids_notify_nearby over pg_net)
-- computed matched_count and dispatched, then returned them to a pg_net call
-- that discards its response. Production today: 0 companies rows and 0
-- contractor_licenses rows, so every post has reached nobody — and a post with
-- "Notify verified pros only" on reaches nobody by construction — while the
-- homeowner was told otherwise and waited out a 14-day deadline.
--
-- ── WHAT ─────────────────────────────────────────────────────────────────────
-- Two nullable columns the fan-out writes back when it finishes:
--   notified_count  contractors whose alert was dispatched
--   notified_at     when the fan-out finished (NULL = it has not reported)
-- post-rfp and my-rfps read them and say what really happened, including 0.
--
-- ── WHO MAY WRITE THEM ───────────────────────────────────────────────────────
-- public_bids_update lets the owner update their whole row, so without a guard
-- a homeowner (or a modified client) could stamp any count. It only misleads
-- themselves, but a number shown as fact must come from the fan-out. The
-- trigger below keeps both columns server-owned: any write that is not the
-- service role (the function's REST PATCH) or a superuser migration is reset
-- to NULL on INSERT and to the old values on UPDATE.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
-- DROP TRIGGER IF EXISTS. Test: scratchpad pgtest/rfp_notify_reach.mjs.
-- Reverse path:
--   drop trigger if exists public_bids_keep_notify_result on public.public_bids;
--   drop function if exists public.public_bids_keep_notify_result();
--   alter table public.public_bids drop column if exists notified_count,
--                                  drop column if exists notified_at;

alter table public.public_bids
  add column if not exists notified_count integer,
  add column if not exists notified_at timestamptz;

comment on column public.public_bids.notified_count is
  'Contractors notify-nearby-contractors dispatched an alert to for this homeowner RFP. NULL until the fan-out reports. Server-owned (trigger public_bids_keep_notify_result).';
comment on column public.public_bids.notified_at is
  'When notify-nearby-contractors finished for this RFP. NULL = no report yet (or the fan-out failed).';

create or replace function public.public_bids_keep_notify_result()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  -- The fan-out PATCHes with the service-role key (auth.role() = 'service_role');
  -- migrations and the dashboard run as a superuser role. Everyone else — the
  -- homeowner's own client included — cannot author the reach figure.
  if coalesce(auth.role(), '') = 'service_role'
     or current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.notified_count := null;
    new.notified_at := null;
  else
    new.notified_count := old.notified_count;
    new.notified_at := old.notified_at;
  end if;
  return new;
end
$$;

revoke execute on function public.public_bids_keep_notify_result() from public, anon, authenticated;

drop trigger if exists public_bids_keep_notify_result on public.public_bids;
create trigger public_bids_keep_notify_result
  before insert or update on public.public_bids
  for each row execute function public.public_bids_keep_notify_result();
