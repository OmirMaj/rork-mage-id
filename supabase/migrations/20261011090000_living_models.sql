-- 20261011090000_living_models.sql — the job model of the Living Model, saved
-- to the account (lane LIVINGSYNC).
--
-- WHY. The Living Model (LIVING_MODEL_ENABLED = false, owner preview) kept a
--   job's model of placed rooms on ONE DEVICE (AsyncStorage key
--   mageid_living_model::<user>::<project>). A model made on the web did not
--   reach the phone, and the reverse. This file adds the one row per job that
--   lets the same model open on the person's other devices and for a teammate
--   who may edit that job's schedule.
--
-- WHAT A ROW IS. One job's whole model, as the app's JobModel JSON
--   (utils/livingModel/types.ts), cut down by the app to the fields it draws
--   (utils/livingModel/syncCore.ts modelForAccount):
--     project_id     the job. PRIMARY KEY, so one row per job. Deleting the
--                    project deletes the row (ON DELETE CASCADE).
--     owner_id       the project's owner (projects.user_id), written by the
--                    function, never by the caller. Deleting that account
--                    deletes the row (the project goes with it anyway).
--     model          jsonb, an object whose projectId is this row's project
--                    and whose rooms is an array. At most 3 MiB as text
--                    (the app stops at 1,500,000 characters).
--     schema_version the JobModel version the writer used (1 today). A writer
--                    with an OLDER version than the row's is refused, so an
--                    old build never flattens a newer model.
--     revision       1 at the first save, plus one at every save. It only
--                    ever goes up, and only the function moves it.
--     last_write_id  the id the app made for the save that produced this
--                    revision. The app reads it back to tell "my save landed"
--                    from "someone else's did", and a replay of the same save
--                    (a flush killed half way) answers saved and writes nothing.
--     recent_writes  the last 8 saves of this row, oldest first, each as
--                    {"w": write id, "r": the revision it landed at, "u": who}.
--                    Written only by the function. It is how a device whose
--                    save landed, and was then saved over by a teammate
--                    before the device looked, learns "mine landed at r and
--                    the account is now ahead" and not "both changed". A
--                    replay of any save still in the list answers saved with
--                    the revision it landed at and writes nothing.
--     updated_at     THE SERVER'S CLOCK at the save. Never a time the app sent.
--     updated_by     auth.uid() at the save. NULL after that account is deleted.
--     created_at     the server's clock at the first save.
--   WHAT MAY BE IN `model`: room names a person typed, room sizes (walls,
--   doors, windows, fixtures, the floor outline, the ceiling height), where
--   each room sits, which schedule tasks a person ticked for it and the stage
--   he picked. A room that came from a phone scan carries its name, that
--   scan's SIZES and the one word "scan", and nothing else of the scan: the app
--   asks the person first (for each scanned room, when it is first sent) and
--   sends nothing until he says yes. NEVER IN A ROW: a photo, a video, Apple's
--   raw scan data, the scan list, the scan's id, the device model, a location,
--   an address.
--   HOW MUCH. At most 60 rooms; in one room at most 200 walls, 400 doors and
--   windows and 400 fixtures. Those are the app's own limits (the Room Editor
--   stops at 60 rooms; utils/livingModel/syncCore.ts ACCOUNT_LIMITS) so the API
--   cannot store what the app would never make. Over them the save answers
--   {saved:false, code:'out_of_bounds'} and writes nothing.
--
-- WHO WRITES. A signed-in person who may EDIT THE JOB'S SCHEDULE, and nobody
--   else: the project owner or an accepted collaborator whose role is owner or
--   editor. That is public.can_access_project(project_id, 'editor'), the same
--   predicate projects_update uses (20260728140000: auth.uid() = user_id or
--   is_project_collaborator(id, 'editor')) and the same one takeoff_docs
--   writes at (20260926180000). No new permission is invented here. The write
--   goes through ONE function, public.living_model_save(project, model, base
--   revision, write id, schema version): SECURITY DEFINER, empty search_path,
--   the caller from auth.uid(), the time from the server. No client holds
--   INSERT, UPDATE or DELETE on the table.
-- WHO READS. The project owner and every accepted collaborator on the job
--   (public.can_access_project(project_id), any role): the people who can
--   already read the project row and so its schedule (projects_select). A
--   viewer or a field seat reads and cannot write. A person who is not on the
--   job reads nothing. anon holds nothing: no table privilege, no function.
--
-- ONE SAVE AT A TIME (optimistic concurrency). A save carries the revision it
--   was BASED ON (0 for "I saw no row"). The function locks the row and:
--     the row's revision equals the base   -> saves, revision + 1
--     the row's last_write_id is this save -> answers saved, writes nothing
--     anything else                        -> REFUSED, writes nothing, answers
--                                             {saved:false, code:'stale_revision'}
--   The refusal is a returned verdict and not a raised error on purpose: the
--   app sends this call through its offline queue (utils/offlineQueue), which
--   retries or parks a raised error and would report a teammate's ordinary
--   save as a failure. The app reads the row back after every save, sees a
--   write id that is not its own, and ASKS the person which model to keep. It
--   never picks for him (utils/livingModel/syncCore.ts reconcile).
--   Other verdicts: code 'too_large' (over the cap), 'out_of_bounds' (more
--   rooms or parts than the app makes) and 'newer_schema' (the row was written
--   by a newer build). Every {saved:true} carries `revision`: the revision THAT
--   save landed at (for a replay, the one it landed at the first time). A caller with no right to the job, or
--   no session, gets a raised 42501; a malformed call gets 22023.
--
-- REMOVING THE ACCOUNT COPY. "Keep on This Phone" after a save has gone out is
--   a promise only if the account's copy can be taken away again. One function,
--   public.living_model_remove(project): the same people who may save (the
--   owner and editors), SECURITY DEFINER, deletes the one row and nothing else.
--   The app calls it only from a button the person confirms; nothing calls it
--   on its own. It does not touch any device: every device keeps the model it
--   holds, and one that had matched the account's copy then finds none, says
--   so, and sends nothing until its person asks. public.living_model_removals
--   keeps one line per job that had its copy removed: who, when, and the
--   revision the row had reached. The next first save of that job starts ABOVE
--   that revision, so "revision 3" never means two different models and a
--   device that was at 3 is never told it is up to date. No client reads or
--   writes that table. Removing when there is no row answers {removed:false}.
--
-- ACCOUNT DELETION. supabase/functions/delete-account does not list this table
--   and does not need to: the row belongs to the PROJECT (owner_id is the
--   project owner, whoever saved it), so an editor who saved the model and then
--   deleted his account takes nothing with him (updated_by goes to NULL), and
--   the owner's deletion removes his projects and with them these rows.
--
-- DEPLOY ORDER. Apply this before or after the app update; neither order
--   breaks anything. Before it is applied the app reads the table, is told it
--   does not exist (42P01 / PGRST205), stays device-only with today's sentence
--   and queues NOTHING. After it is applied the next time the screen opens the
--   model is saved to the account. Apply through the Supabase MCP
--   apply_migration, never `supabase db push`.
--   Depends on: auth.users, public.projects, public.can_access_project(uuid,
--   text) with its 'editor' tier (20260826130000_field_role.sql).
--
-- VERIFY AFTER
--   select relrowsecurity from pg_class where oid = 'public.living_models'::regclass;            -- true
--   select policyname, cmd, roles from pg_policies where tablename = 'living_models';             -- one row: living_models_read, SELECT, {authenticated}
--   select has_table_privilege('anon', 'public.living_models', 'select'),                         -- false
--          has_table_privilege('authenticated', 'public.living_models', 'select'),                -- true
--          has_table_privilege('authenticated', 'public.living_models', 'insert'),                -- false
--          has_table_privilege('authenticated', 'public.living_models', 'update'),                -- false
--          has_table_privilege('authenticated', 'public.living_models', 'delete');                -- false
--   select has_function_privilege('anon', 'public.living_model_save(uuid,jsonb,integer,uuid,integer)', 'execute'),          -- false
--          has_function_privilege('authenticated', 'public.living_model_save(uuid,jsonb,integer,uuid,integer)', 'execute'); -- true
--   select has_function_privilege('anon', 'public.living_model_remove(uuid)', 'execute'),          -- false
--          has_function_privilege('authenticated', 'public.living_model_remove(uuid)', 'execute'); -- true
--   select has_table_privilege('authenticated', 'public.living_model_removals', 'select');        -- false
--   select proname, prosecdef, proconfig from pg_proc where proname in ('living_model_save', 'living_model_remove'); -- both true, {search_path=""}
--   -- after the owner opens the Living Model on a job with rooms:
--   select project_id, revision, schema_version, octet_length(model::text), updated_at from public.living_models order by updated_at desc limit 3;
--
-- UNDO (by hand; export the rows first if anyone has saved a model)
--   drop function if exists public.living_model_save(uuid, jsonb, integer, uuid, integer);
--   drop function if exists public.living_model_remove(uuid);
--   drop table if exists public.living_model_removals;
--   drop table if exists public.living_models;
--   The app then reads "no such table" again and goes back to device-only.
--
-- PROOF. scripts/pgq/living-models.mjs applies this file twice on PGlite and
--   runs the cases; `--all` plants each mutation and shows which cases go red.
--   scripts/validate-living-model-sync.ts pins this file's text.
--
-- Additive and idempotent.

-- ── 0. what this file stands on ──────────────────────────────────────────────
do $pre$
declare
  v_src text;
begin
  if to_regclass('public.projects') is null then
    raise exception '[living_models] public.projects is missing';
  end if;
  if to_regprocedure('public.can_access_project(uuid,text)') is null then
    raise exception '[living_models] public.can_access_project(uuid,text) is missing. Apply 20260826130000_field_role.sql first.';
  end if;
  select p.prosrc into v_src from pg_proc p where p.oid = to_regprocedure('public.can_access_project(uuid,text)');
  if v_src is null or position('when ''editor''' in v_src) = 0 then
    raise exception '[living_models] public.can_access_project(uuid,text) has no editor tier';
  end if;
end
$pre$;

-- ── 1. the table ─────────────────────────────────────────────────────────────
create table if not exists public.living_models (
  project_id     uuid primary key references public.projects(id) on delete cascade,
  owner_id       uuid not null references auth.users(id) on delete cascade,
  model          jsonb not null,
  schema_version integer not null default 1,
  revision       integer not null default 1,
  last_write_id  uuid not null,
  recent_writes  jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references auth.users(id) on delete set null,
  constraint living_models_model_object_check check (jsonb_typeof(model) = 'object'),
  -- The cap. One job's model can never be a place to park megabytes.
  constraint living_models_model_size_check   check (octet_length(model::text) <= 3145728),
  -- lower() on both sides: a uuid is the same job however its letters are cased.
  constraint living_models_model_project_check check (lower(model ->> 'projectId') = lower(project_id::text)),
  constraint living_models_model_rooms_check   check (jsonb_typeof(model -> 'rooms') = 'array' and jsonb_array_length(model -> 'rooms') <= 60),
  constraint living_models_recent_writes_check check (jsonb_typeof(recent_writes) = 'array' and jsonb_array_length(recent_writes) <= 8),
  constraint living_models_revision_check     check (revision >= 1),
  constraint living_models_schema_check       check (schema_version between 1 and 1000)
);

comment on table public.living_models is
  'The Living Model: one job model (placed rooms, ticked tasks, picked stages) per project, as jsonb. Written only through living_model_save() by a person who may edit the job''s schedule (can_access_project(project_id, ''editor'')); read by everyone on the job. revision goes up by one at every save and a save based on an older revision is refused. No photo, video or raw scan data is ever in a row.';
comment on column public.living_models.revision is
  'Starts at 1, plus one at every save. Only living_model_save() moves it.';
comment on column public.living_models.updated_at is
  'The server clock at the save. Never a client time.';
comment on column public.living_models.recent_writes is
  'The last 8 saves of this row, oldest first: {"w": write id, "r": revision it landed at, "u": who}. Only living_model_save() writes it.';
comment on column public.living_models.last_write_id is
  'The id the app made for the save that produced this revision. A replay of that save answers saved and writes nothing.';

-- ── 2. locks ─────────────────────────────────────────────────────────────────
alter table public.living_models enable row level security;
revoke all on public.living_models from public, anon, authenticated;
grant select on public.living_models to authenticated;

drop policy if exists living_models_read on public.living_models;
create policy living_models_read on public.living_models
  for select to authenticated
  using (public.can_access_project(project_id));

-- The line a removed copy leaves behind: no model, only who, when and how far
-- the revision had got. No client holds anything on it.
create table if not exists public.living_model_removals (
  project_id    uuid primary key references public.projects(id) on delete cascade,
  last_revision integer not null,
  removed_at    timestamptz not null default now(),
  removed_by    uuid references auth.users(id) on delete set null,
  constraint living_model_removals_revision_check check (last_revision >= 1)
);
comment on table public.living_model_removals is
  'One line per job whose Living Model copy was removed from the account (living_model_remove): who, when, and the revision the row had reached, so the next first save starts above it. Holds no model. No client reads or writes it.';
alter table public.living_model_removals enable row level security;
revoke all on public.living_model_removals from public, anon, authenticated;

-- ── 3. the one writer ────────────────────────────────────────────────────────
create or replace function public.living_model_save(
  p_project_id uuid,
  p_model jsonb,
  p_base_revision integer,
  p_write_id uuid,
  p_schema_version integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_row public.living_models%rowtype;
  v_rev integer;
  v_at timestamptz;
  v_room jsonb;
  v_hit jsonb;
  v_start integer;
  v_recent jsonb;
begin
  if v_uid is null then
    raise exception 'living_model_save: not authenticated' using errcode = '42501';
  end if;
  if p_project_id is null or p_model is null or p_write_id is null
     or p_base_revision is null or p_base_revision < 0
     or p_schema_version is null or p_schema_version < 1 or p_schema_version > 1000 then
    raise exception 'living_model_save: violates the call contract (project, model, base revision, write id and schema version are all required)' using errcode = '22023';
  end if;
  -- The right to edit this job's schedule, and nothing wider. The same answer
  -- for "no such project" and "not yours", so the call is not a way to learn
  -- which project ids exist.
  if not public.can_access_project(p_project_id, 'editor') then
    raise exception 'living_model_save: permission denied for this project' using errcode = '42501';
  end if;
  if pg_catalog.jsonb_typeof(p_model) <> 'object'
     or pg_catalog.lower(p_model ->> 'projectId') is distinct from pg_catalog.lower(p_project_id::text)
     or pg_catalog.jsonb_typeof(p_model -> 'rooms') is distinct from 'array' then
    raise exception 'living_model_save: violates the call contract (the model must be an object for this project with a rooms array)' using errcode = '22023';
  end if;
  if pg_catalog.octet_length(p_model::text) > 3145728 then
    return pg_catalog.jsonb_build_object('saved', false, 'code', 'too_large', 'limit_bytes', 3145728);
  end if;
  -- No more than the app itself makes: 60 rooms, and in one room 200 walls,
  -- 400 doors and windows, 400 fixtures.
  if pg_catalog.jsonb_array_length(p_model -> 'rooms') > 60 then
    return pg_catalog.jsonb_build_object('saved', false, 'code', 'out_of_bounds', 'what', 'rooms', 'limit', 60);
  end if;
  for v_room in select r.value from pg_catalog.jsonb_array_elements(p_model -> 'rooms') as r(value) loop
    if pg_catalog.jsonb_typeof(v_room -> 'room' -> 'walls') = 'array' and pg_catalog.jsonb_array_length(v_room -> 'room' -> 'walls') > 200 then
      return pg_catalog.jsonb_build_object('saved', false, 'code', 'out_of_bounds', 'what', 'walls', 'limit', 200);
    end if;
    if pg_catalog.jsonb_typeof(v_room -> 'room' -> 'openings') = 'array' and pg_catalog.jsonb_array_length(v_room -> 'room' -> 'openings') > 400 then
      return pg_catalog.jsonb_build_object('saved', false, 'code', 'out_of_bounds', 'what', 'openings', 'limit', 400);
    end if;
    if pg_catalog.jsonb_typeof(v_room -> 'room' -> 'objects') = 'array' and pg_catalog.jsonb_array_length(v_room -> 'room' -> 'objects') > 400 then
      return pg_catalog.jsonb_build_object('saved', false, 'code', 'out_of_bounds', 'what', 'objects', 'limit', 400);
    end if;
  end loop;

  select p.user_id into v_owner from public.projects p where p.id = p_project_id;
  if v_owner is null then
    raise exception 'living_model_save: permission denied for this project' using errcode = '42501';
  end if;

  select * into v_row from public.living_models m where m.project_id = p_project_id for update;
  if not found then
    if p_base_revision = 0 then
      -- A job whose copy was removed starts again ABOVE the revision it had reached.
      select coalesce((select x.last_revision from public.living_model_removals x where x.project_id = p_project_id), 0) + 1 into v_start;
      insert into public.living_models
        (project_id, owner_id, model, schema_version, revision, last_write_id, recent_writes, created_at, updated_at, updated_by)
      values
        (p_project_id, v_owner, p_model, p_schema_version, v_start, p_write_id,
         pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('w', p_write_id, 'r', v_start, 'u', v_uid)),
         pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp(), v_uid)
      on conflict (project_id) do nothing
      returning revision, updated_at into v_rev, v_at;
      if v_rev is not null then
        return pg_catalog.jsonb_build_object('saved', true, 'revision', v_rev, 'updated_at', v_at, 'replay', false);
      end if;
      -- Two first saves at once: the other one made the row. Judge this save against it.
      select * into v_row from public.living_models m where m.project_id = p_project_id for update;
    end if;
    if v_row.project_id is null then
      return pg_catalog.jsonb_build_object('saved', false, 'code', 'stale_revision', 'revision', 0);
    end if;
  end if;

  -- The same save again (a flush killed half way and sent twice): it is already here.
  if v_row.last_write_id = p_write_id and v_row.updated_by is not distinct from v_uid then
    return pg_catalog.jsonb_build_object('saved', true, 'revision', v_row.revision, 'updated_at', v_row.updated_at, 'replay', true);
  end if;
  -- The same save again after someone else saved on top of it: it landed, at the revision the row remembers.
  select e.value into v_hit from pg_catalog.jsonb_array_elements(v_row.recent_writes) as e(value)
   where e.value ->> 'w' = p_write_id::text and e.value ->> 'u' = v_uid::text limit 1;
  if v_hit is not null then
    return pg_catalog.jsonb_build_object('saved', true, 'revision', (v_hit ->> 'r')::integer, 'updated_at', v_row.updated_at, 'replay', true, 'head_revision', v_row.revision);
  end if;
  -- Based on a revision that is no longer the row's: refused, nothing written.
  if v_row.revision <> p_base_revision then
    return pg_catalog.jsonb_build_object('saved', false, 'code', 'stale_revision', 'revision', v_row.revision, 'updated_at', v_row.updated_at);
  end if;
  -- An older build never writes over a model a newer build saved.
  if p_schema_version < v_row.schema_version then
    return pg_catalog.jsonb_build_object('saved', false, 'code', 'newer_schema', 'schema_version', v_row.schema_version, 'revision', v_row.revision);
  end if;

  -- The last 8 saves, this one last.
  select coalesce(pg_catalog.jsonb_agg(t.value order by t.ord), '[]'::jsonb) into v_recent
    from (select e.value, e.ord from pg_catalog.jsonb_array_elements(
            v_row.recent_writes || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('w', p_write_id, 'r', v_row.revision + 1, 'u', v_uid))
          ) with ordinality as e(value, ord)
           order by e.ord desc limit 8) t;
  update public.living_models m
     set model = p_model,
         schema_version = p_schema_version,
         revision = m.revision + 1,
         last_write_id = p_write_id,
         recent_writes = v_recent,
         updated_at = pg_catalog.clock_timestamp(),
         updated_by = v_uid
   where m.project_id = p_project_id
  returning m.revision, m.updated_at into v_rev, v_at;
  return pg_catalog.jsonb_build_object('saved', true, 'revision', v_rev, 'updated_at', v_at, 'replay', false);
end
$function$;

comment on function public.living_model_save(uuid, jsonb, integer, uuid, integer) is
  'The only writer of public.living_models. The caller must be able to edit the job''s schedule (can_access_project(project, ''editor'')). Saves when p_base_revision is the row''s revision (0 = no row yet); answers {saved:false, code:''stale_revision''} and writes nothing otherwise. The time and the author are the server''s.';

revoke all on function public.living_model_save(uuid, jsonb, integer, uuid, integer) from public, anon;
grant execute on function public.living_model_save(uuid, jsonb, integer, uuid, integer) to authenticated;

-- ── 4. the one delete ────────────────────────────────────────────────────────
create or replace function public.living_model_remove(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_rev integer;
begin
  if v_uid is null then
    raise exception 'living_model_remove: not authenticated' using errcode = '42501';
  end if;
  if p_project_id is null then
    raise exception 'living_model_remove: violates the call contract (the project is required)' using errcode = '22023';
  end if;
  -- The same people who may save, and the same answer for "no such project" and "not yours".
  if not public.can_access_project(p_project_id, 'editor') then
    raise exception 'living_model_remove: permission denied for this project' using errcode = '42501';
  end if;
  delete from public.living_models m where m.project_id = p_project_id returning m.revision into v_rev;
  if v_rev is null then
    return pg_catalog.jsonb_build_object('removed', false);
  end if;
  insert into public.living_model_removals (project_id, last_revision, removed_at, removed_by)
  values (p_project_id, v_rev, pg_catalog.clock_timestamp(), v_uid)
  on conflict (project_id) do update
    set last_revision = greatest(public.living_model_removals.last_revision, excluded.last_revision),
        removed_at = excluded.removed_at,
        removed_by = excluded.removed_by;
  return pg_catalog.jsonb_build_object('removed', true, 'revision', v_rev);
end
$function$;

comment on function public.living_model_remove(uuid) is
  'Deletes the one Living Model row of a project from the account, for a caller who may edit the job''s schedule. Called only from a button the person confirms. Leaves a line in living_model_removals (who, when, the revision reached); touches no device and no other table.';

revoke all on function public.living_model_remove(uuid) from public, anon;
grant execute on function public.living_model_remove(uuid) to authenticated;

-- ── self-check ───────────────────────────────────────────────────────────────
do $$
declare
  v_priv text;
  v_cfg text[];
  v_def boolean;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.living_models'::regclass) then
    raise exception '[living_models] verify: row level security is off';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'living_models') <> 1
     or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'living_models'
                     and policyname = 'living_models_read' and cmd = 'SELECT') then
    raise exception '[living_models] verify: the table must have exactly one policy, the SELECT for people on the job';
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    foreach v_priv in array array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
      if has_table_privilege('anon', 'public.living_models', v_priv) then
        raise exception '[living_models] verify: anon holds % on the table', v_priv;
      end if;
    end loop;
    if has_function_privilege('anon', 'public.living_model_save(uuid,jsonb,integer,uuid,integer)', 'execute') then
      raise exception '[living_models] verify: anon can call the save function';
    end if;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    foreach v_priv in array array['insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
      if has_table_privilege('authenticated', 'public.living_models', v_priv) then
        raise exception '[living_models] verify: authenticated holds % on the table', v_priv;
      end if;
    end loop;
    if not has_table_privilege('authenticated', 'public.living_models', 'select') then
      raise exception '[living_models] verify: authenticated cannot read the table';
    end if;
    if not has_function_privilege('authenticated', 'public.living_model_save(uuid,jsonb,integer,uuid,integer)', 'execute') then
      raise exception '[living_models] verify: authenticated cannot call the save function';
    end if;
  end if;
  select p.prosecdef, p.proconfig into v_def, v_cfg from pg_proc p
   where p.oid = 'public.living_model_save(uuid,jsonb,integer,uuid,integer)'::regprocedure;
  if v_def is not true or v_cfg is null or not ('search_path=""' = any (v_cfg)) then
    raise exception '[living_models] verify: the save function must be SECURITY DEFINER with an empty search_path';
  end if;
  select p.prosecdef, p.proconfig into v_def, v_cfg from pg_proc p
   where p.oid = 'public.living_model_remove(uuid)'::regprocedure;
  if v_def is not true or v_cfg is null or not ('search_path=""' = any (v_cfg)) then
    raise exception '[living_models] verify: the remove function must be SECURITY DEFINER with an empty search_path';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.living_model_removals'::regclass) then
    raise exception '[living_models] verify: row level security is off on the removals table';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'living_model_removals') then
    raise exception '[living_models] verify: the removals table must have no policy';
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    if has_function_privilege('anon', 'public.living_model_remove(uuid)', 'execute') then
      raise exception '[living_models] verify: anon can call the remove function';
    end if;
    foreach v_priv in array array['select', 'insert', 'update', 'delete', 'truncate'] loop
      if has_table_privilege('anon', 'public.living_model_removals', v_priv) then
        raise exception '[living_models] verify: anon holds % on the removals table', v_priv;
      end if;
    end loop;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    if not has_function_privilege('authenticated', 'public.living_model_remove(uuid)', 'execute') then
      raise exception '[living_models] verify: authenticated cannot call the remove function';
    end if;
    foreach v_priv in array array['select', 'insert', 'update', 'delete', 'truncate'] loop
      if has_table_privilege('authenticated', 'public.living_model_removals', v_priv) then
        raise exception '[living_models] verify: authenticated holds % on the removals table', v_priv;
      end if;
    end loop;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.living_models'::regclass and conname = 'living_models_model_size_check') then
    raise exception '[living_models] verify: the size cap is missing';
  end if;
  if not exists (select 1 from pg_constraint c where c.conrelid = 'public.living_models'::regclass
                  and c.contype = 'f' and c.confrelid = 'public.projects'::regclass and c.confdeltype = 'c') then
    raise exception '[living_models] verify: the row must go when its project goes';
  end if;
end $$;

notify pgrst, 'reload schema';
