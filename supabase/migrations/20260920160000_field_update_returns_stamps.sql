-- ============================================================================
-- field_update_schedule_tasks returns the stamps it wrote (wave 4, audit #87).
--
-- WHY. The RPC stamps tasks[i].fieldEditedAt[key] with the SERVER clock, but
-- it only answered {applied, missing}, so the foreman's phone copied the new
-- VALUES into its local schedule and never learned the stamp. When the
-- realtime echo that would have carried it was lost (patchy signal), his next
-- failed send captured the old local stamp, and the retry — which re-sends a
-- key only while the server's value AND stamp are still what the phone held
-- (utils/fieldScheduleUpdate.ts pendingFieldRetryPatches, #138) — found the
-- server's stamp different and dropped his 60% with "it was changed elsewhere
-- while you had no signal", when nobody else had touched the task.
--
-- WHAT CHANGES. Additive only: the answer gains
--   stamps: { <taskId>: { <key>: <iso stamp this call wrote> } }
-- for every applied task (CONTRACT 11). Validation, gating, the merge, the
-- stamps written and the trigger are byte-for-byte the 20260917160000 logic;
-- same signature, same grants (re-stated below). The client merges these
-- stamps into its local copy (applyFieldTaskPatches) instead of deciding the
-- retry on value alone, which would re-open the GC-changed-it-and-back case the
-- stamp check exists for.
--
-- Old clients ignore the extra key. Executed twice on PGlite before shipping.
-- ============================================================================

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
  -- wave 4 #87: the stamps THIS call wrote, per task id, per key.
  v_written jsonb := '{}'::jsonb;
  v_task_written jsonb;
  v_stamp text;
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
      v_task_written := coalesce(v_written -> v_id, '{}'::jsonb);
      for v_key in select key from jsonb_each(v_by_id -> v_id) loop
        v_prev := public.schedule_field_stamp_ts(v_stamps ->> v_key);
        v_stamp := to_char(
          greatest(v_now, coalesce(v_prev + interval '1 millisecond', v_now)) at time zone 'utc',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
        v_stamps := v_stamps || jsonb_build_object(v_key, v_stamp);
        v_task_written := v_task_written || jsonb_build_object(v_key, v_stamp);
      end loop;
      v_written := v_written || jsonb_build_object(v_id, v_task_written);
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

  return jsonb_build_object('applied', to_jsonb(v_applied), 'missing', to_jsonb(v_missing), 'stamps', v_written);
end;
$$;

revoke all on function public.field_update_schedule_tasks(uuid, jsonb) from public, anon;
grant execute on function public.field_update_schedule_tasks(uuid, jsonb) to authenticated;

-- WHY (integration round 2, field lens). The trigger projects_keep_newer_field_
-- progress (20260917160000) is SECURITY INVOKER and fires `before update of
-- schedule`; for every task that carries fieldEditedAt stamps it calls
-- schedule_field_stamp_ts AS THE CALLER. Production's default function
-- privileges gave that helper to postgres + service_role only, so once a job's
-- schedule held one stamp (the owner's own progress edit stamps it —
-- stampFieldEdits), EVERY later schedule save of that job from the app was
-- refused with "42501 permission denied for function schedule_field_stamp_ts",
-- and the offline queue parked every later write of the project row behind it.
-- The helper is pure (text -> timestamptz, no table access), so granting it to
-- the signed-in role exposes nothing. anon stays out: it never updates projects.
revoke all on function public.schedule_field_stamp_ts(text) from public, anon;
grant execute on function public.schedule_field_stamp_ts(text) to authenticated, service_role;

comment on function public.field_update_schedule_tasks(uuid, jsonb) is
  'Field-access schedule progress: merges ONLY progress/status/notes/actual start+finish onto projects.schedule.tasks by id, gated on can_access_project(pid, ''field''). Any other key fails the call. Returns {applied, missing, stamps: {taskId: {key: iso}}}. Called by utils/fieldScheduleUpdate.ts.';
