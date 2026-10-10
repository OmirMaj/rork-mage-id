-- 20261012090000_deliveries_follow_schedule.sql — a delivery can belong to a
-- schedule task (lane DELIVERIES-1, Deliveries That Follow The Schedule,
-- Phase 1).
--
-- WHY. public.deliveries (20260826200000_deliveries.sql) records what is due
--   on site and the date the supplier gave. It has no link to the schedule
--   task that needs the load, so when a task moved nothing happened to its
--   deliveries, and there was no lead time, no "ordered on" and no record of
--   who gave a date or what it was before. This file adds the few nullable
--   columns that let the app (DELIVERIES_FOLLOW_SCHEDULE_ENABLED = false,
--   owner preview) link a delivery to a task and keep that record.
--
-- WHAT IS ADDED (every column NULLABLE, no default, no backfill: an existing
--   row is untouched and an older build that never names these columns keeps
--   inserting and updating exactly as before):
--     task_id          text. The schedule task that needs the load. TEXT with
--                      NO foreign key, on purpose: a task id is a string the
--                      app makes, and tasks live inside projects.schedule
--                      (jsonb), not in a table. The same choice as
--                      submittals.linked_task_id (20260919090000). A task that
--                      is later removed simply fails to match, and the app
--                      then shows "the task was removed". At most 200 chars.
--     buffer_days      integer, 0 to 60. WORKING days before the task's start
--                      that the load is needed on site. NULL = the app's
--                      default (2).
--     lead_time_days   integer, 1 to 730. The lead time the contractor typed,
--                      in CALENDAR days. NULL = none typed. There is no
--                      starter value anywhere.
--     ordered_on       date. The day the contractor marked it ordered.
--     promised_date    date. The ORIGINAL promised date. The app sets it in
--                      three ways only (utils/deliveries/provenance.ts):
--                      (1) the first date recorded with the source "the
--                      supplier said so", when the row has none; (2) the
--                      supplier date standing when the delivery is marked
--                      ordered, when the row has none; (3) a person's own
--                      labelled correction in the dates form. A date that was
--                      only typed, or a date from before these columns (no
--                      record of who gave it), is NOT made the promise by a
--                      later edit. It is not moved by a later change of
--                      expected_date. The Supplier Scorecard scores lateness
--                      against it, so editing the date to match a late truck
--                      no longer erases the slip. WRITTEN ONCE, HELD BY THE
--                      TABLE: see "THE ONE TRIGGER" below.
--     date_history     jsonb. NULL, or an ARRAY of at most 40 entries and at
--                      most 16,384 bytes as text (the app keeps 20). Each
--                      entry is one change of the supplier date:
--                      {"date", "previousDate", "at", "source", "note", "by",
--                      "byName"}. "source" is 'supplier_said' or 'typed'.
--                      "note" is the person's own short note of how they were
--                      told ("by phone"). A correction of promised_date is an
--                      entry too, with "kind": "promise_corrected",
--                      "promisedDate" (what it became) and
--                      "previousPromisedDate" (what it was), and "by" /
--                      "byName" of the account that made it. No price, no
--                      client name, no contact detail of the supplier is put
--                      here by the app. NEVER SHRUNK, HELD BY THE TABLE: see
--                      "THE ONE TRIGGER" below.
--     task_start_seen  date. The linked task's start date the person last
--                      looked at. The app's "the schedule moved" reminder is
--                      today's start against this. A record of what a person
--                      saw; it is NOT a needed-by date.
--   AND ONE CHANGE: expected_date DROPS NOT NULL. "No date yet" is a real
--     state: a delivery linked to a task before the supplier has given a date
--     could not be saved at all. A NULL expected_date is shown as "No date
--     yet" everywhere and is never counted as before the day it is needed.
--
-- THE ONE TRIGGER. deliveries_fs_keep_record, BEFORE UPDATE OF promised_date,
--   date_history, FOR EACH ROW, running public.deliveries_fs_keep_record():
--   SECURITY INVOKER (it runs as the person making the update, with their
--   rights and no more), search_path empty, and it reads and writes nothing
--   but the two columns of the row being updated. It holds two lines the app
--   also holds, so a second device with an old copy of the row cannot undo
--   the record:
--     (a) THE PROMISE IS WRITTEN ONCE. An update that would change a
--         promised_date that is already set leaves it as it was, UNLESS the
--         same update's date_history ends with a correction entry that says
--         so: "kind" = 'promise_corrected', "promisedDate" = the new date and
--         "previousPromisedDate" = the date being replaced. Setting it for the
--         first time (it was NULL) is not held back.
--     (b) THE HISTORY IS NOT SHRUNK. An update that would set date_history to
--         NULL, to something that is not an array, or to fewer entries than
--         the row has, leaves it as it was.
--   IT DOES NOT REFUSE THE UPDATE. The rest of the update lands (a stale
--   phone's "Received" is not lost); those two columns keep their value, and
--   the phone reads them back on its next load. It raises nothing, calls
--   nothing, notifies nobody, and touches no other row or table. It does not
--   fire for an update that names neither column, so an older build's writes
--   never run it. The function is not callable by anon, authenticated or
--   PUBLIC (EXECUTE is revoked; a trigger needs none to fire).
--
-- WHAT IS NOT ADDED, ON PURPOSE. There is NO "needed on site by" column and
--   NO "order by" column. Both are worked out by the app on every read from
--   today's schedule (utils/deliveries/neededBy.ts, orderBy.ts), so they move
--   when the task moves and there is nothing for a trigger, a job or a
--   function to do about them. Apart from the one trigger above this file adds
--   no trigger, no function, no cron job and no notification. Nothing in the
--   database moves a task or contacts anyone.
--
-- WHO WRITES / WHO READS. Unchanged. This file touches no policy and gives no
--   grant (its one privilege statement is a REVOKE on its own new function):
--   the four policies of 20260826200000_deliveries.sql stand as they are
--   (read: the row's owner or anyone who can access the project; insert: the
--   caller as owner with field access to the project; update: field access to
--   the project; delete: the row's owner). The same people who could read and
--   write a delivery yesterday can read and write these columns today, and
--   nobody else can. The self-check below refuses to finish if the policies
--   are not those four.
--
-- ACCOUNT DELETION AND EXPORT. No new table, so supabase/functions/delete-account
--   and the data export need no change: the columns go with the delivery row
--   they sit on. date_history holds a user id ("by") and a display name
--   ("byName") of the account that typed a date; both go when the row goes.
--
-- DEPLOY ORDER. Apply this BEFORE the feature is opened to anyone. Either
--   order of this file and the app update is safe:
--   - app update first: the app asks the table for the new columns once
--     (hooks/useDeliveriesFollowSchedule), is told they do not exist, and
--     keeps the feature closed on that device. A delivery made the old way is
--     written with exactly the old columns, so the offline queue never sends
--     a column this table does not have.
--   - this file first: older builds never name the new columns, so they never
--     fire the trigger. AN OLDER BUILD DOES NOT LIST A DELIVERY WITH A NULL
--     expected_date AT ALL: its look-ahead keeps only loads that are late or
--     due inside the window, and a load with no date is neither, so on an
--     older build such a row is on no screen and cannot be marked received
--     there. Such a row can only be made by the owner account while the flag
--     is off. The build that ships with this file lists them for everyone who
--     can see the job, under "No Date Yet" with Received, whether or not the
--     feature is open for that person.
--   Apply through the Supabase MCP apply_migration, never `supabase db push`.
--   Depends on: public.deliveries (20260826200000_deliveries.sql).
--
-- VERIFY AFTER
--   select column_name, data_type, is_nullable from information_schema.columns
--    where table_schema = 'public' and table_name = 'deliveries'
--      and column_name in ('task_id','buffer_days','lead_time_days','ordered_on','promised_date','date_history','task_start_seen','expected_date')
--    order by column_name;                                   -- 8 rows, every is_nullable = YES
--   select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'deliveries' order by policyname;
--     -- deliveries_collab_insert INSERT, deliveries_collab_select SELECT, deliveries_collab_update UPDATE, deliveries_owner_delete DELETE
--   select conname from pg_constraint where conrelid = 'public.deliveries'::regclass and conname like 'deliveries_fs_%' order by 1;
--     -- deliveries_fs_buffer_days_check, deliveries_fs_date_history_check, deliveries_fs_lead_time_days_check, deliveries_fs_task_id_check
--   select count(*) from public.deliveries where task_id is not null;   -- 0 until the owner links one
--   select t.tgname, p.prosecdef from pg_trigger t join pg_proc p on p.oid = t.tgfoid
--    where t.tgrelid = 'public.deliveries'::regclass and not t.tgisinternal and t.tgname like 'deliveries_fs_%';
--     -- deliveries_fs_keep_record, false (SECURITY INVOKER)
--   select has_function_privilege('authenticated', 'public.deliveries_fs_keep_record()', 'execute'),
--          has_function_privilege('anon', 'public.deliveries_fs_keep_record()', 'execute');   -- false, false
--
-- UNDO (by hand; the columns hold nothing until the owner uses the feature)
--   drop trigger if exists deliveries_fs_keep_record on public.deliveries;
--   drop function if exists public.deliveries_fs_keep_record();
--   alter table public.deliveries
--     drop constraint if exists deliveries_fs_task_id_check,
--     drop constraint if exists deliveries_fs_buffer_days_check,
--     drop constraint if exists deliveries_fs_lead_time_days_check,
--     drop constraint if exists deliveries_fs_date_history_check,
--     drop column if exists task_id, drop column if exists buffer_days,
--     drop column if exists lead_time_days, drop column if exists ordered_on,
--     drop column if exists promised_date, drop column if exists date_history,
--     drop column if exists task_start_seen;
--   -- only if no row has a NULL expected_date:
--   -- alter table public.deliveries alter column expected_date set not null;
--
-- Idempotent throughout: run it twice and the second run changes nothing.
-- ============================================================================

alter table public.deliveries add column if not exists task_id text;
alter table public.deliveries add column if not exists buffer_days integer;
alter table public.deliveries add column if not exists lead_time_days integer;
alter table public.deliveries add column if not exists ordered_on date;
alter table public.deliveries add column if not exists promised_date date;
alter table public.deliveries add column if not exists date_history jsonb;
alter table public.deliveries add column if not exists task_start_seen date;

-- "No date yet" is a real state.
alter table public.deliveries alter column expected_date drop not null;

-- The checks. Dropped and re-added so a second run lands on the same text.
alter table public.deliveries drop constraint if exists deliveries_fs_task_id_check;
alter table public.deliveries add constraint deliveries_fs_task_id_check
  check (task_id is null or (char_length(task_id) between 1 and 200));

alter table public.deliveries drop constraint if exists deliveries_fs_buffer_days_check;
alter table public.deliveries add constraint deliveries_fs_buffer_days_check
  check (buffer_days is null or (buffer_days between 0 and 60));

alter table public.deliveries drop constraint if exists deliveries_fs_lead_time_days_check;
alter table public.deliveries add constraint deliveries_fs_lead_time_days_check
  check (lead_time_days is null or (lead_time_days between 1 and 730));

alter table public.deliveries drop constraint if exists deliveries_fs_date_history_check;
alter table public.deliveries add constraint deliveries_fs_date_history_check
  check (date_history is null or (
    jsonb_typeof(date_history) = 'array'
    and jsonb_array_length(date_history) <= 40
    and octet_length(date_history::text) <= 16384
  ));

-- "Everything that needs this task", for the schedule's task sheet. Partial:
-- most deliveries are never linked.
create index if not exists deliveries_task_idx
  on public.deliveries (project_id, task_id)
  where task_id is not null;

comment on column public.deliveries.task_id is
  'The schedule task (an id inside projects.schedule jsonb) that needs this load. Text, no foreign key. Needed On Site By is worked out by the app from that task on every read and is never stored.';
comment on column public.deliveries.buffer_days is
  'Working days before the linked task''s start that the load is needed on site. NULL = the app default (2).';
comment on column public.deliveries.lead_time_days is
  'The lead time the contractor typed, in calendar days. NULL = none typed. Order By is worked out by the app and is never stored.';
comment on column public.deliveries.ordered_on is
  'The day the contractor marked the delivery ordered.';
comment on column public.deliveries.promised_date is
  'The original promised date: the first date recorded as said by the supplier, or the supplier date standing when it was marked ordered, or a person''s recorded correction. Once set, changed only by an update whose date_history ends with a promise_corrected entry (trigger deliveries_fs_keep_record). The Supplier Scorecard scores against it.';
comment on column public.deliveries.date_history is
  'Changes of the supplier date and corrections of promised_date, oldest first: [{date, previousDate, at, source, note, by, byName, kind, promisedDate, previousPromisedDate}]. At most 40 entries and 16,384 bytes. Never shrunk by an update (trigger deliveries_fs_keep_record).';
comment on column public.deliveries.task_start_seen is
  'The linked task''s start date the person last looked at. Not a needed-by date.';

-- ── The one trigger: the promise is written once, the history is not shrunk ──
-- SECURITY INVOKER, search_path empty, and it touches nothing but NEW's two
-- columns. It does not refuse the update: it keeps those two columns as they
-- were and lets the rest land. See "THE ONE TRIGGER" in the header.
create or replace function public.deliveries_fs_keep_record()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_last jsonb;
begin
  -- (b) the history is not shrunk (checked first, so a cut-down history cannot carry a correction).
  if old.date_history is not null
     and jsonb_typeof(old.date_history) = 'array'
     and jsonb_array_length(old.date_history) > 0
     and (new.date_history is null
          or jsonb_typeof(new.date_history) <> 'array'
          or jsonb_array_length(new.date_history) < jsonb_array_length(old.date_history)) then
    new.date_history := old.date_history;
  end if;

  -- (a) the promise is written once.
  if old.promised_date is not null and new.promised_date is distinct from old.promised_date then
    v_last := case
      when new.date_history is not null
       and jsonb_typeof(new.date_history) = 'array'
       and jsonb_array_length(new.date_history) > 0
      then new.date_history -> -1
    end;
    if v_last is null
       or new.promised_date is null
       or (v_last ->> 'kind') is distinct from 'promise_corrected'
       or (v_last ->> 'promisedDate') is distinct from to_char(new.promised_date, 'YYYY-MM-DD')
       or (v_last ->> 'previousPromisedDate') is distinct from to_char(old.promised_date, 'YYYY-MM-DD') then
      new.promised_date := old.promised_date;
    end if;
  end if;

  return new;
end
$fn$;

-- Not callable by anyone: a trigger needs no EXECUTE to fire.
revoke all on function public.deliveries_fs_keep_record() from public, anon, authenticated;

drop trigger if exists deliveries_fs_keep_record on public.deliveries;
create trigger deliveries_fs_keep_record
  before update of promised_date, date_history on public.deliveries
  for each row execute function public.deliveries_fs_keep_record();

comment on function public.deliveries_fs_keep_record() is
  'Trigger function of public.deliveries (BEFORE UPDATE OF promised_date, date_history). SECURITY INVOKER. Keeps a set promised_date unless the update''s date_history ends with a matching promise_corrected entry, and keeps date_history when an update would shrink or null it. Refuses nothing, writes nothing else, notifies nobody.';

-- ── Self-check: refuse to finish on a table that is not what the header says ──
do $$
declare
  v_col text;
  v_n integer;
  v_names text;
begin
  foreach v_col in array array['task_id', 'buffer_days', 'lead_time_days', 'ordered_on', 'promised_date', 'date_history', 'task_start_seen', 'expected_date'] loop
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'deliveries' and column_name = v_col and is_nullable = 'YES') then
      raise exception '[deliveries_follow_schedule] verify: column % is missing or is NOT NULL', v_col;
    end if;
  end loop;
  -- Needed On Site By and Order By are worked out, never stored.
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'deliveries'
                and (column_name like 'needed%' or column_name like 'order_by%')) then
    raise exception '[deliveries_follow_schedule] verify: a needed-by or order-by column exists; those dates are worked out and never stored';
  end if;
  foreach v_col in array array['deliveries_fs_task_id_check', 'deliveries_fs_buffer_days_check', 'deliveries_fs_lead_time_days_check', 'deliveries_fs_date_history_check'] loop
    if not exists (select 1 from pg_constraint where conrelid = 'public.deliveries'::regclass and conname = v_col and contype = 'c') then
      raise exception '[deliveries_follow_schedule] verify: the check % is missing', v_col;
    end if;
  end loop;
  if not (select relrowsecurity from pg_class where oid = 'public.deliveries'::regclass) then
    raise exception '[deliveries_follow_schedule] verify: row level security is off on public.deliveries';
  end if;
  -- The same four policies as before this file, and no other.
  select count(*), string_agg(policyname || ':' || cmd, ',' order by policyname) into v_n, v_names
    from pg_policies where schemaname = 'public' and tablename = 'deliveries';
  if v_n <> 4 or v_names is distinct from
     'deliveries_collab_insert:INSERT,deliveries_collab_select:SELECT,deliveries_collab_update:UPDATE,deliveries_owner_delete:DELETE' then
    raise exception '[deliveries_follow_schedule] verify: the policies on public.deliveries are not the four from 20260826200000 (found %)', coalesce(v_names, 'none');
  end if;
  -- The lane's ONE trigger: deliveries_fs_keep_record, a row trigger BEFORE
  -- UPDATE of the two columns, running a SECURITY INVOKER function with an
  -- empty search_path that nobody can call. No other trigger of this lane.
  select count(*), string_agg(t.tgname, ',' order by t.tgname) into v_n, v_names
    from pg_trigger t
   where t.tgrelid = 'public.deliveries'::regclass and not t.tgisinternal
     and (t.tgname like 'deliveries_fs_%' or t.tgname like '%follow_schedule%');
  if v_n <> 1 or v_names is distinct from 'deliveries_fs_keep_record' then
    raise exception '[deliveries_follow_schedule] verify: the lane''s triggers on public.deliveries are not the one deliveries_fs_keep_record (found %)', coalesce(v_names, 'none');
  end if;
  if not exists (
    select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
     where t.tgrelid = 'public.deliveries'::regclass and t.tgname = 'deliveries_fs_keep_record'
       and p.oid = 'public.deliveries_fs_keep_record()'::regprocedure
       and (t.tgtype & 1) = 1      -- FOR EACH ROW
       and (t.tgtype & 2) = 2      -- BEFORE
       and (t.tgtype & 16) = 16    -- UPDATE
       and (t.tgtype & (4 | 8 | 32)) = 0   -- not INSERT, DELETE or TRUNCATE
       and t.tgattr::text = (
         select string_agg(a.attnum::text, ' ' order by a.attnum) from pg_attribute a
          where a.attrelid = 'public.deliveries'::regclass and a.attname in ('promised_date', 'date_history'))
  ) then
    raise exception '[deliveries_follow_schedule] verify: deliveries_fs_keep_record is not a row trigger BEFORE UPDATE OF promised_date, date_history';
  end if;
  if (select p.prosecdef from pg_proc p where p.oid = 'public.deliveries_fs_keep_record()'::regprocedure) then
    raise exception '[deliveries_follow_schedule] verify: deliveries_fs_keep_record() is SECURITY DEFINER; it must run as the caller';
  end if;
  if not exists (select 1 from pg_proc p where p.oid = 'public.deliveries_fs_keep_record()'::regprocedure
                    and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where c in ('search_path=', 'search_path=""'))) then
    raise exception '[deliveries_follow_schedule] verify: deliveries_fs_keep_record() does not pin an empty search_path';
  end if;
  if has_function_privilege('anon', 'public.deliveries_fs_keep_record()', 'execute')
     or has_function_privilege('authenticated', 'public.deliveries_fs_keep_record()', 'execute') then
    raise exception '[deliveries_follow_schedule] verify: anon or authenticated can call deliveries_fs_keep_record()';
  end if;
end $$;

notify pgrst, 'reload schema';
