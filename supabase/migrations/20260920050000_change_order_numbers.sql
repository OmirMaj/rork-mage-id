-- 20260920050000_change_order_numbers.sql — wave 4, lane co-workflow
--
-- What this fixes (audit 2026-09-19, findings #77 / #141, merged):
--
--   The owner's iPhone, offline on site, writes CO #4 (max of ITS cached list
--   + 1) and it waits in the offline queue. Back at the office, before the
--   phone syncs, the web app also computes max+1 = #4. Both INSERTs land: the
--   client gets two "Change order #4" emails and e-sign records and the G703
--   lists two #4 lines. change_orders had no (project_id, number) constraint
--   (only change_orders_pkey), so nothing caught it.
--
--   §1 numbers every INSERT on the server under a per-project lock. Unlike the
--      RFI trigger (20260919080000 §3, which renumbers every insert), a CO
--      KEEPS the number the client sent when no other row of the project holds
--      it — a CO created online keeps the number the GC already saw — and only
--      a collider (or a missing number) moves to max + 1.
--   §2 pins `number` on client UPDATEs. Once §1 may move a CO's number, the
--      phone's queued edits of that CO still carry the OLD number; written as
--      sent they would either re-create the duplicate or, with §3's index, fail
--      with a non-pkey 23505 — which utils/offlineQueue treats as TERMINAL and
--      drops (the edit would be lost with only a toast). Numbers never change
--      after insert from the app, so a client write simply keeps the server's.
--      service_role (repairs) is not pinned.
--   §3 the unique (project_id, number) index, as the backstop. It ships WITH §1
--      and §2 (never alone: alone, an offline collider's INSERT would hit a
--      non-pkey 23505 and be dropped by the queue).
--   §4 change_orders.revises_change_order_id — #73's "Revise & re-issue" makes
--      a NEW draft CO that points at the declined one (ChangeOrder
--      .revisesChangeOrderId). Nullable, no FK: a declined CO may be deleted
--      later and the revision must survive it. The app also stamps the link in
--      the new CO's audit trail, so the history holds even before a mapper
--      writes this column.
--
-- CLIENT CONTRACT (app/change-order.tsx, hooks/useServerChangeOrderNumber.ts):
--   the number a device computes is PROVISIONAL until it has been read back
--   from the server. The CO screen shows "(pending #)" while the INSERT is
--   queued, holds the email / portal / PDF until the number is confirmed, and
--   says when it was renumbered.
--
-- Production facts read before writing this (read-only, 2026-09-19):
--   change_orders: 4 rows, 0 duplicate (project_id, number) pairs, 0 null
--   numbers; number integer NOT NULL; project_id uuid NOT NULL; only trigger
--   change_orders_updated_at; no revises_change_order_id column. So §3 builds
--   cleanly; the §3 renumber loop is a no-op there.
--
-- Idempotent: CREATE OR REPLACE / DROP … IF EXISTS / IF NOT EXISTS throughout.
-- Apply BEFORE the OTA (the app reads the number back after every CO insert).

-- ── §1. Server-assigned CO numbers ───────────────────────────────────────────
-- SECURITY DEFINER: the collision check and the max must see every row of the
-- project, whatever the caller's RLS shows him. The lock is per (table,
-- project), so two inserts on the same job serialize and never share a number.
create or replace function public.change_orders_assign_number_fn()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  perform pg_advisory_xact_lock(hashtext('change_orders'), hashtext(NEW.project_id::text));
  if NEW.number is null
     or NEW.number < 1
     or exists (
       select 1 from public.change_orders c
        where c.project_id = NEW.project_id
          and c.number = NEW.number
          and c.id is distinct from NEW.id
     ) then
    select coalesce(max(c.number), 0) + 1 into NEW.number
      from public.change_orders c
     where c.project_id = NEW.project_id;
  end if;
  return NEW;
end;
$function$;

revoke execute on function public.change_orders_assign_number_fn() from public, anon, authenticated;

drop trigger if exists change_orders_assign_number on public.change_orders;
create trigger change_orders_assign_number
  before insert on public.change_orders
  for each row execute function public.change_orders_assign_number_fn();

-- ── §2. A client UPDATE never moves the number ───────────────────────────────
-- SECURITY INVOKER on purpose: current_user must be the CALLER's role
-- (inside a definer function it would be the owner, and every write would look
-- like a repair).
create or replace function public.change_orders_keep_number_fn()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $function$
begin
  if current_user in ('authenticated', 'anon') and NEW.number is distinct from OLD.number then
    NEW.number := OLD.number;
  end if;
  return NEW;
end;
$function$;

revoke execute on function public.change_orders_keep_number_fn() from public, anon, authenticated;

drop trigger if exists change_orders_keep_number on public.change_orders;
create trigger change_orders_keep_number
  before update on public.change_orders
  for each row execute function public.change_orders_keep_number_fn();

-- ── §3. Unique (project_id, number) — the backstop ───────────────────────────
-- Any duplicates where this runs are renumbered deterministically: the oldest
-- (created_at, id) keeps its number, each later one moves to the project's next
-- free number. Production has none (see header).
do $renumber$
declare
  r record;
begin
  for r in
    select id, project_id from (
      select id, project_id,
             row_number() over (partition by project_id, number order by created_at nulls last, id) as rn
        from public.change_orders
    ) d where d.rn > 1 order by project_id, id
  loop
    update public.change_orders
       set number = (select coalesce(max(x.number), 0) + 1 from public.change_orders x where x.project_id = r.project_id)
     where id = r.id;
  end loop;
end
$renumber$;

create unique index if not exists change_orders_project_number_key on public.change_orders (project_id, number);

-- ── §4. The revision link (#73) ──────────────────────────────────────────────
alter table public.change_orders add column if not exists revises_change_order_id uuid;
