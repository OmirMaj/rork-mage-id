-- ============================================================================
-- Account deletion backstops: the user-keyed tables that had no FK at all.
--
-- Audit IDs: DB-F7 / AUTH-F1 (data survives account deletion), SYNC-F15
--            (time_entries orphans after a project delete — see the note).
--
-- WHY. supabase/functions/delete-account deletes rows table by table and then
-- calls auth.admin.deleteUser. Three tables carry a user_id with NO foreign
-- key to auth.users (verified live 2026-09-04 via pg_constraint):
--     memory_embeddings.user_id   (embedded plan / project text)
--     ai_daily_usage.user_id      (17 live rows)
--     rate_overrides.user_id
-- so nothing in the database removes them when the auth row goes. The edge
-- function now deletes them explicitly (belt); this file makes the database
-- do it on ANY delete path — admin console, support script, a future refactor
-- (braces). Same shape as 20260902120000_collaborator_fk_cascade.sql.
--
-- Each constraint is added only if:
--   • the column is uuid (checked, not assumed), and
--   • no orphan row references a missing auth.users row — an ALTER TABLE
--     ADD CONSTRAINT would fail on the first orphan and abort the whole file,
--     so the guard skips that table with a NOTICE naming the count instead.
--     Live counts 2026-09-04: 0 orphans in all three (0 / 17 / 0 rows).
--
-- ── time_entries.project_id — deliberately NOT constrained ──────────────────
-- time_entries.project_id is TEXT, not uuid (created that way in
-- create_time_entries.sql; field_tickets.project_id likewise), and Postgres
-- cannot declare a foreign key across a text → uuid boundary. Converting the
-- column would ripple into the text overload of can_access_project, the
-- time_entries_collab_* policies and the offline queue's id handling, and is
-- its own migration with its own app change. Until then, SYNC-F15 stands:
-- a deleted project's time entries are orphaned server-side and the app's
-- deleteProject() hand-cascade is the only thing removing them. (Account
-- deletion is unaffected: time_entries.user_id already cascades.)
--
-- Idempotent: each block re-checks pg_constraint by SHAPE — (table, column,
-- referenced table) — before acting, so the same FK under another name is
-- recognised and skipped rather than duplicated (review 2026-09-05; the first
-- draft matched on the constraint NAME only).
-- ============================================================================

do $mig$
declare
  t record;
  targets text[][] := array[
    ['memory_embeddings', 'user_id', 'memory_embeddings_user_id_fkey'],
    ['ai_daily_usage',    'user_id', 'ai_daily_usage_user_id_fkey'],
    ['rate_overrides',    'user_id', 'rate_overrides_user_id_fkey']
  ];
  i int;
  v_table text; v_col text; v_con text;
  v_type text;
  v_orphans bigint;
  v_existing text;
  v_existing_action text;
begin
  for i in 1 .. array_length(targets, 1) loop
    v_table := targets[i][1]; v_col := targets[i][2]; v_con := targets[i][3];

    if to_regclass('public.' || v_table) is null then
      raise notice '[100700] public.% does not exist — skipped', v_table;
      continue;
    end if;

    -- Shape match, not name match: a FK on this column to auth.users that was
    -- added under another name — by hand, from the dashboard, by a later
    -- refactor — must not be duplicated. Two FKs on one column both fire on
    -- every write, and if the other one is not CASCADE it blocks or nulls the
    -- auth delete no matter what this one says.
    select k.conname, k.confdeltype::text
      into v_existing, v_existing_action
      from pg_constraint k
     where k.contype = 'f'
       and k.conrelid = ('public.' || v_table)::regclass
       and k.confrelid = 'auth.users'::regclass
       and k.conkey = array[(select a.attnum from pg_attribute a
                              where a.attrelid = k.conrelid and a.attname = v_col)]
     limit 1;
    if v_existing is not null then
      if v_existing_action = 'c' then
        raise notice '[100700] %.% → auth.users already present as % (ON DELETE CASCADE) — skipped',
          v_table, v_col, v_existing;
      else
        raise notice '[100700] %.% → auth.users already present as % with ON DELETE % (NOT cascade) — not duplicated; that constraint decides what happens to the row on account deletion and must be altered by hand',
          v_table, v_col, v_existing,
          case v_existing_action when 'a' then 'NO ACTION' when 'r' then 'RESTRICT'
                                 when 'n' then 'SET NULL'  when 'd' then 'SET DEFAULT'
                                 else v_existing_action end;
      end if;
      continue;
    end if;

    select data_type into v_type
      from information_schema.columns
     where table_schema = 'public' and table_name = v_table and column_name = v_col;
    if v_type is distinct from 'uuid' then
      raise notice '[100700] %.% is % not uuid — constraint NOT added', v_table, v_col, coalesce(v_type, '<missing>');
      continue;
    end if;

    execute format(
      'select count(*) from public.%I x where x.%I is not null and not exists (select 1 from auth.users u where u.id = x.%I)',
      v_table, v_col, v_col) into v_orphans;
    if v_orphans > 0 then
      raise notice '[100700] %.%: % orphan row(s) reference a missing auth.users row — constraint NOT added; delete or reassign them and re-run',
        v_table, v_col, v_orphans;
      continue;
    end if;

    execute format(
      'alter table public.%I add constraint %I foreign key (%I) references auth.users(id) on delete cascade',
      v_table, v_con, v_col);
    execute format(
      'comment on constraint %I on public.%I is %L',
      v_con, v_table,
      'ON DELETE CASCADE backstop for account deletion (DB-F7 / AUTH-F1, 20260904100700). delete-account also removes these rows explicitly; see scripts/validate-account-deletion.ts.');
    raise notice '[100700] added %', v_con;
  end loop;
end
$mig$;

comment on column public.time_entries.project_id is
  'TEXT, not uuid, so no FK to projects is possible (SYNC-F15). The app hand-cascades on project delete; account deletion cascades via time_entries_user_id_fkey.';

-- Post-conditions: report what landed. A NOTICE, not an exception — a skipped
-- table (orphans present) is a documented outcome of this file, not a failure
-- of it; the account-deletion guard and the edge function's explicit deletes
-- cover the gap in the meantime.
-- Checked by shape, like the guard: a CASCADE FK from that column to
-- auth.users under ANY name counts, and a constraint that merely shares the
-- name on some other table does not.
do $mig$
declare
  targets text[][] := array[
    ['memory_embeddings', 'user_id'],
    ['ai_daily_usage',    'user_id'],
    ['rate_overrides',    'user_id']
  ];
  i int;
  v_missing text[] := '{}';
begin
  for i in 1 .. array_length(targets, 1) loop
    if to_regclass('public.' || targets[i][1]) is null then continue; end if;
    if not exists (
      select 1 from pg_constraint k
       where k.contype = 'f'
         and k.conrelid = ('public.' || targets[i][1])::regclass
         and k.confrelid = 'auth.users'::regclass
         and k.confdeltype = 'c'
         and k.conkey = array[(select a.attnum from pg_attribute a
                                where a.attrelid = k.conrelid and a.attname = targets[i][2])]
    ) then
      v_missing := v_missing || (targets[i][1] || '.' || targets[i][2]);
    end if;
  end loop;
  if array_length(v_missing, 1) > 0 then
    raise notice '[100700] no CASCADE FK to auth.users on % (see notices above)', v_missing;
  else
    raise notice '[100700] all three account-deletion FKs are in place (CASCADE, matched by shape)';
  end if;
end
$mig$;
