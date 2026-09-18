-- ============================================================================
-- field_update_schedule_tasks — the one path a FIELD collaborator's schedule
-- progress reaches the database by.
--
-- ⚠ APPLY THIS MIGRATION BEFORE THE OTA THAT CALLS IT. The client (Home's Quick
-- Field Update, Schedule Pro) calls this RPC for role 'field'. Before it exists
-- PostgREST answers 404/PGRST202 and the app tells the foreman his update did
-- not save — honest, but every update is still lost until this lands.
--
-- WHY (audit round 2, account-data-security #25). utils/roleBlinding sells the
-- field role as "Schedule & field work — no costs or margins", and the app let a
-- field user edit the schedule. Every schedule write went out as a PATCH of the
-- whole projects row, and projects_update only admits the owner or an 'editor'
-- (supabase/schema.sql; 20260826130000_field_role.sql says so). PostgREST
-- answers an RLS-refused UPDATE with 200 and zero rows, the offline queue does
-- not count rows (deliberately — utils/offlineQueue.ts explains why), so the
-- foreman saw "Framing → 60%", nothing reached the server, and his next reload
-- put the old 0% back. Progress is the main reason a GC puts a foreman on the
-- job.
--
-- WHY AN RPC AND NOT A WIDER projects_update. RLS is row-level. A foreman's
-- schedule change travels in the same UPDATE as name, status, scope,
-- collaborators, handover_checklist, closed_at, client_portal and the legacy
-- money columns (ProjectContext syncProjectToSupabase `base`). Letting 'field'
-- pass projects_update would let a foreman rewrite the collaborator list or
-- close the project — exactly what the role promises he cannot touch.
--
-- WHAT IT WRITES — AND NOTHING ELSE:
--   projects.schedule.tasks[i] where tasks[i].id = patch.id, these keys only:
--     progress         number 0..100
--     status           'not_started' | 'in_progress' | 'on_hold' | 'done'
--     notes            text (≤ 20 000 chars)
--     actualStartDate  / actualEndDate   ISO date-time text or null (≤ 40 chars)
--     actualStartDay   / actualEndDay    integer ≥ 1 or null
--   plus schedule.updatedAt and projects.updated_at.
-- Any OTHER key in a patch (startDay, durationDays, title, estimate, …) fails
-- the whole call with 22023 and writes nothing, so a client bug or a hand-rolled
-- request can never smuggle a date move or a money field through here. Dates,
-- durations, dependencies and task add/delete stay editor work.
--
-- It merges onto the schedule AS IT IS ON THE SERVER, under a row lock, so a
-- GC's concurrent edit to other tasks is not overwritten by the foreman's stale
-- copy.
--
-- THE OTHER DIRECTION (integration round, #25 end to end). Every owner/editor
-- project write PATCHes the whole `schedule` from that device's local copy, and
-- on iOS that copy is usually hours old. The GC opens his phone at 07:00, the
-- foreman sets Framing to 60% at 10:00 through this function, the GC files a
-- daily report at 15:00 — and the upsert carried the 07:00 schedule, putting
-- Framing back to 0% with nobody told. Closed here, below the app, so no build
-- and no code path can bypass it:
--   • this function stamps tasks[i].fieldEditedAt[key] for every key it
--     writes — never earlier than the stamp already there, so a device clock
--     running ahead cannot outrank the foreman's later write;
--   • the app stamps the same map when an owner/editor CHANGES a field-owned
--     value on a copy that had seen the latest stamp (utils/fieldScheduleUpdate
--     stampFieldEdits, applied in ProjectContext.updateProject);
--   • BEFORE UPDATE trigger projects_keep_newer_field_progress: for each task
--     in both the old and the new schedule, a field-owned key whose incoming
--     stamp is missing or older than the stored one keeps the STORED value and
--     stamp. A stale copy cannot undo field progress; an owner who really
--     changed a task's progress after the field update still wins. Tasks the
--     writer added or removed, and every non-field key, are the writer's.
-- AMENDED IN PLACE rather than a second file because this migration had not
-- been applied to production when the trigger was added (2026-09-17).
--
-- Ship note: a device on a build older than the stamping OTA sends no stamps,
-- so on a task the foreman has updated, that device's own later change to
-- progress/status/notes/actuals is refused by the trigger (the foreman's value
-- stays). That is the safe side of the conflict; the OTA ends it.
--
-- Gate: can_access_project(pid, 'field') — owner, editor or field; a viewer or
-- an unrelated user gets 42501. Unknown task ids are skipped and reported back
-- (`missing`) rather than failing the batch: a task deleted by the GC since the
-- foreman loaded the schedule must not block his other updates.
--
-- Executed on PGlite (field caller, editor, viewer, unrelated user, money-key
-- attempt, disallowed-key attempt, concurrent-edit merge; then the second
-- writer: an owner upsert and an editor PATCH built from the pre-RPC schedule
-- keep the RPC values, an owner's newer progress change wins, clock-skewed
-- stamps, ownership and money untouched) before shipping. Idempotent.
-- ============================================================================

-- A stamp as a time, or NULL for anything that is not one — a hand-edited or
-- truncated stamp must read as "no stamp", never fail the write it rides on.
create or replace function public.schedule_field_stamp_ts(p_stamp text)
returns timestamptz
language plpgsql
stable
set search_path = public
as $$
begin
  if p_stamp is null or length(p_stamp) > 40 then return null; end if;
  return p_stamp::timestamptz;
exception when others then
  return null;
end;
$$;

create or replace function public.field_update_schedule_tasks(
  p_project_id uuid,
  p_task_patches jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed constant text[] := array[
    'id', 'progress', 'status', 'notes',
    'actualStartDate', 'actualEndDate', 'actualStartDay', 'actualEndDay'
  ];
  v_schedule jsonb;
  v_tasks jsonb;
  v_patch jsonb;
  v_key text;
  v_val jsonb;
  v_by_id jsonb := '{}'::jsonb;
  v_new_tasks jsonb;
  v_fix jsonb := '{}'::jsonb;
  v_task jsonb;
  v_ord bigint;
  v_applied text[] := array[]::text[];
  v_missing text[] := array[]::text[];
  v_id text;
  v_stamps jsonb;
  v_now timestamptz := now();
  v_prev timestamptz;
begin
  if auth.uid() is null then
    raise exception 'field_update_schedule_tasks: not signed in' using errcode = '28000';
  end if;
  if p_project_id is null or not public.can_access_project(p_project_id, 'field') then
    raise exception 'field_update_schedule_tasks: field access to this project is required' using errcode = '42501';
  end if;
  if p_task_patches is null or jsonb_typeof(p_task_patches) <> 'array' then
    raise exception 'field_update_schedule_tasks: task patches must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_task_patches) > 500 then
    raise exception 'field_update_schedule_tasks: at most 500 task patches per call' using errcode = '22023';
  end if;

  -- Validate every patch BEFORE touching the row: one bad key writes nothing.
  for v_patch in select value from jsonb_array_elements(p_task_patches) loop
    -- coalesce: jsonb_typeof of a MISSING key is SQL NULL, and `NULL <> 'string'`
    -- is NULL, not true — without it a patch with no id slipped past this check.
    if jsonb_typeof(v_patch) <> 'object' or coalesce(jsonb_typeof(v_patch -> 'id'), '') <> 'string' or length(v_patch ->> 'id') = 0 then
      raise exception 'field_update_schedule_tasks: every patch needs a task id' using errcode = '22023';
    end if;
    for v_key, v_val in select key, value from jsonb_each(v_patch) loop
      if not (v_key = any (v_allowed)) then
        raise exception 'field_update_schedule_tasks: "%" is not a field-access schedule field (progress, status, notes and actual start/finish only)', v_key
          using errcode = '22023';
      end if;
      -- Type first, value second, in separate IFs: SQL does not promise to
      -- short-circuit OR, so a combined test could cast "sixty"::numeric and
      -- fail with a cast error instead of this function's own 22023.
      if v_key = 'progress' then
        if jsonb_typeof(v_val) <> 'number' then
          raise exception 'field_update_schedule_tasks: progress must be a number from 0 to 100' using errcode = '22023';
        end if;
        if (v_val #>> '{}')::numeric < 0 or (v_val #>> '{}')::numeric > 100 then
          raise exception 'field_update_schedule_tasks: progress must be a number from 0 to 100' using errcode = '22023';
        end if;
      elsif v_key = 'status' then
        if jsonb_typeof(v_val) <> 'string' or not ((v_val #>> '{}') = any (array['not_started','in_progress','on_hold','done'])) then
          raise exception 'field_update_schedule_tasks: status must be not_started, in_progress, on_hold or done' using errcode = '22023';
        end if;
      elsif v_key = 'notes' then
        if jsonb_typeof(v_val) <> 'string' or length(v_val #>> '{}') > 20000 then
          raise exception 'field_update_schedule_tasks: notes must be text of at most 20000 characters' using errcode = '22023';
        end if;
      elsif v_key in ('actualStartDate','actualEndDate') then
        if jsonb_typeof(v_val) not in ('null','string') or length(coalesce(v_val #>> '{}', '')) > 40 then
          raise exception 'field_update_schedule_tasks: % must be a date string or null', v_key using errcode = '22023';
        end if;
      elsif v_key in ('actualStartDay','actualEndDay') then
        if jsonb_typeof(v_val) not in ('null','number') then
          raise exception 'field_update_schedule_tasks: % must be a whole day number or null', v_key using errcode = '22023';
        end if;
        if jsonb_typeof(v_val) = 'number' and ((v_val #>> '{}')::numeric < 1 or (v_val #>> '{}')::numeric <> trunc((v_val #>> '{}')::numeric)) then
          raise exception 'field_update_schedule_tasks: % must be a whole day number or null', v_key using errcode = '22023';
        end if;
      end if;
    end loop;
    -- Later patches for the same task win, key by key.
    v_by_id := jsonb_set(v_by_id, array[v_patch ->> 'id'], coalesce(v_by_id -> (v_patch ->> 'id'), '{}'::jsonb) || (v_patch - 'id'));
  end loop;

  select schedule into v_schedule from public.projects where id = p_project_id for update;
  if not found then
    raise exception 'field_update_schedule_tasks: project not found' using errcode = 'P0002';
  end if;
  v_tasks := v_schedule -> 'tasks';
  if v_tasks is null or jsonb_typeof(v_tasks) <> 'array' then
    raise exception 'field_update_schedule_tasks: this project has no schedule tasks' using errcode = 'P0002';
  end if;

  -- Linear in the task count (integration round 1). The array used to be
  -- rebuilt one `v_new_tasks || jsonb_build_array(v_task)` at a time, each
  -- append copying everything before it: O(n²), 679 ms for one patch on a
  -- 1000-task schedule (import-schedule's MAX_ROWS). Now only the patched
  -- tasks are collected, keyed by their position, and the array is rebuilt
  -- ONCE with jsonb_agg in the original order.
  for v_task, v_ord in select value, ordinality from jsonb_array_elements(v_tasks) with ordinality loop
    v_id := v_task ->> 'id';
    if v_id is not null and v_by_id ? v_id then
      -- Stamp every key this call writes (see the header): never earlier than
      -- the stamp already stored, so the trigger below always lets this
      -- write through, whatever clock stamped the previous value.
      v_stamps := case when jsonb_typeof(v_task -> 'fieldEditedAt') = 'object' then v_task -> 'fieldEditedAt' else '{}'::jsonb end;
      for v_key in select key from jsonb_each(v_by_id -> v_id) loop
        v_prev := public.schedule_field_stamp_ts(v_stamps ->> v_key);
        v_stamps := v_stamps || jsonb_build_object(v_key, to_char(
          greatest(v_now, coalesce(v_prev + interval '1 millisecond', v_now)) at time zone 'utc',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
      end loop;
      v_task := v_task || (v_by_id -> v_id) || jsonb_build_object('fieldEditedAt', v_stamps);
      v_applied := array_append(v_applied, v_id);
      v_fix := v_fix || jsonb_build_object(v_ord::text, v_task);
    end if;
  end loop;

  for v_id in select key from jsonb_each(v_by_id) loop
    if not (v_id = any (v_applied)) then v_missing := array_append(v_missing, v_id); end if;
  end loop;

  if coalesce(array_length(v_applied, 1), 0) > 0 then
    select jsonb_agg(coalesce(v_fix -> e.ordinality::text, e.value) order by e.ordinality)
      into v_new_tasks
      from jsonb_array_elements(v_tasks) with ordinality as e(value, ordinality);
    update public.projects
       set schedule = jsonb_set(
             jsonb_set(v_schedule, '{tasks}', v_new_tasks),
             '{updatedAt}',
             to_jsonb(to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
           ),
           updated_at = now()
     where id = p_project_id;
  end if;

  return jsonb_build_object('applied', to_jsonb(v_applied), 'missing', to_jsonb(v_missing));
end;
$$;

revoke all on function public.field_update_schedule_tasks(uuid, jsonb) from public, anon;
grant execute on function public.field_update_schedule_tasks(uuid, jsonb) to authenticated;

comment on function public.field_update_schedule_tasks(uuid, jsonb) is
  'Field-access schedule progress: merges ONLY progress/status/notes/actual start+finish onto projects.schedule.tasks by id, gated on can_access_project(pid, ''field''). Any other key fails the call. Called by utils/fieldScheduleUpdate.ts.';

-- ============================================================================
-- projects_keep_newer_field_progress — the second writer (header, "THE OTHER
-- DIRECTION"). Runs for EVERY update of projects.schedule: the owner's upsert,
-- an editor's PATCH, this file's RPC, a service-role repair. It only ever puts
-- back a field-owned value the incoming row did not know about; it never
-- touches a non-field key, a task the writer added or removed, or any other
-- column.
-- ============================================================================
create or replace function public.projects_keep_newer_field_progress()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  -- Same list as field_update_schedule_tasks' v_allowed (minus id) and
  -- utils/fieldScheduleUpdate FIELD_TASK_PATCH_KEYS; the validator reads all three.
  v_keys constant text[] := array[
    'progress', 'status', 'notes',
    'actualStartDate', 'actualEndDate', 'actualStartDay', 'actualEndDay'
  ];
  v_old_by_id jsonb := '{}'::jsonb;
  v_task jsonb;
  v_old jsonb;
  v_os jsonb;
  v_ns jsonb;
  v_k text;
  v_ots timestamptz;
  v_nts timestamptz;
  v_fix jsonb := '{}'::jsonb;
  v_ord bigint;
  v_task_changed boolean;
begin
  if jsonb_typeof(OLD.schedule -> 'tasks') is distinct from 'array'
     or jsonb_typeof(NEW.schedule -> 'tasks') is distinct from 'array' then
    return NEW;
  end if;
  -- Only tasks that carry stamps can be protected; a schedule no field write
  -- has touched costs one pass over the old tasks. Built with ONE aggregate —
  -- appending key by key copied the growing object each time (O(n²),
  -- integration round 1). A repeated id keeps its last copy, as before.
  select coalesce(jsonb_object_agg(t.value ->> 'id', t.value order by t.ordinality), '{}'::jsonb)
    into v_old_by_id
    from jsonb_array_elements(OLD.schedule -> 'tasks') with ordinality as t(value, ordinality)
   where jsonb_typeof(t.value) = 'object'
     and jsonb_typeof(t.value -> 'id') = 'string'
     and jsonb_typeof(t.value -> 'fieldEditedAt') = 'object';
  if v_old_by_id = '{}'::jsonb then
    return NEW;
  end if;

  -- Only the tasks this trigger changes are collected, keyed by position; the
  -- array is rebuilt once, and not at all when nothing changed (the common
  -- case — the owner's edit carried the stamps). The old per-task append
  -- rebuilt it on every owner write: 347 ms at 1000 tasks.
  for v_task, v_ord in select value, ordinality from jsonb_array_elements(NEW.schedule -> 'tasks') with ordinality loop
    v_task_changed := false;
    if jsonb_typeof(v_task) = 'object'
       and jsonb_typeof(v_task -> 'id') = 'string'
       and v_old_by_id ? (v_task ->> 'id') then
      v_old := v_old_by_id -> (v_task ->> 'id');
      v_os := v_old -> 'fieldEditedAt';
      v_ns := case when jsonb_typeof(v_task -> 'fieldEditedAt') = 'object' then v_task -> 'fieldEditedAt' else '{}'::jsonb end;
      foreach v_k in array v_keys loop
        v_ots := public.schedule_field_stamp_ts(v_os ->> v_k);
        continue when v_ots is null;
        v_nts := public.schedule_field_stamp_ts(v_ns ->> v_k);
        if v_nts is null or v_nts < v_ots then
          -- The incoming copy never saw this value: keep the stored one.
          if v_old ? v_k then
            v_task := v_task || jsonb_build_object(v_k, v_old -> v_k);
          else
            v_task := v_task - v_k;
          end if;
          v_ns := v_ns || jsonb_build_object(v_k, v_os -> v_k);
          v_task_changed := true;
        end if;
      end loop;
      if v_task_changed then
        v_task := v_task || jsonb_build_object('fieldEditedAt', v_ns);
        v_fix := v_fix || jsonb_build_object(v_ord::text, v_task);
      end if;
    end if;
  end loop;

  if v_fix <> '{}'::jsonb then
    NEW.schedule := jsonb_set(NEW.schedule, '{tasks}', (
      select jsonb_agg(coalesce(v_fix -> e.ordinality::text, e.value) order by e.ordinality)
        from jsonb_array_elements(NEW.schedule -> 'tasks') with ordinality as e(value, ordinality)
    ));
  end if;
  return NEW;
end;
$$;

drop trigger if exists projects_keep_newer_field_progress on public.projects;
create trigger projects_keep_newer_field_progress
  before update of schedule on public.projects
  for each row
  when (NEW.schedule is distinct from OLD.schedule)
  execute function public.projects_keep_newer_field_progress();

comment on function public.projects_keep_newer_field_progress() is
  'Keeps a field-owned schedule task value (progress/status/notes/actuals) whose stored fieldEditedAt stamp is newer than the incoming one, so a stale owner/editor copy cannot erase field progress. Stamps: field_update_schedule_tasks and utils/fieldScheduleUpdate.stampFieldEdits.';
